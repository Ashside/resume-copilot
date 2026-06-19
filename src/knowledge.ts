import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import Jimp from 'jimp';
import { chatCompletion, getLLMConfig, getVisionConfig } from './llm';

export interface KnowledgeItem {
  id: string;
  fileName: string;
  type: 'text' | 'image';
  storedPath: string;
  summary: string;
  uploadedAt: string;
}

export interface KnowledgeBase {
  version: '1.0';
  updatedAt: string;
  items: KnowledgeItem[];
}

const SUPPORTED_TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.csv']);
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const MAX_IMAGE_SIZE_MB = 5;

export function defaultKnowledgeBase(): KnowledgeBase {
  return {
    version: '1.0',
    updatedAt: new Date().toISOString(),
    items: [],
  };
}

export function getKnowledgeDir(): string {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error('Resume Copilot: No workspace folder is open. Please open a folder first.');
  }
  return path.join(workspaceFolders[0].uri.fsPath, '.resume-copilot', 'knowledge');
}

export function getKnowledgeBasePath(): string {
  const config = vscode.workspace.getConfiguration('resumeCopilot');
  const configured = config.get<string>('knowledgePath') || '.resume-copilot/knowledge.json';

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error('Resume Copilot: No workspace folder is open. Please open a folder first.');
  }

  if (path.isAbsolute(configured)) {
    return configured;
  }
  return path.join(workspaceFolders[0].uri.fsPath, configured);
}

export async function loadKnowledgeBase(kbPath?: string): Promise<KnowledgeBase> {
  const filePath = kbPath || getKnowledgeBasePath();
  if (!fs.existsSync(filePath)) {
    return defaultKnowledgeBase();
  }
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as KnowledgeBase;
    return {
      ...defaultKnowledgeBase(),
      ...parsed,
      items: parsed.items || [],
    };
  } catch (err) {
    console.error('[Resume Copilot] Failed to load knowledge base:', err);
    return defaultKnowledgeBase();
  }
}

export async function saveKnowledgeBase(kb: KnowledgeBase, kbPath?: string): Promise<void> {
  const filePath = kbPath || getKnowledgeBasePath();
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const toSave: KnowledgeBase = {
    ...kb,
    updatedAt: new Date().toISOString(),
  };
  await fs.promises.writeFile(filePath, JSON.stringify(toSave, null, 2), 'utf-8');
}

export function buildKnowledgeContext(kb?: KnowledgeBase): string {
  if (!kb || kb.items.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('=== Background Materials ===');
  lines.push('The following summaries are derived from materials the user uploaded earlier. Use them only as implicit context; do NOT mention them directly.\n');

  for (const item of kb.items) {
    lines.push(`File: ${item.fileName}`);
    lines.push(`Summary: ${item.summary}`);
    lines.push('');
  }

  lines.push('=== End Background Materials ===\n');
  return lines.join('\n');
}

export async function addKnowledgeFromFile(sourceUri: vscode.Uri): Promise<KnowledgeItem> {
  const ext = path.extname(sourceUri.fsPath).toLowerCase();
  const isText = SUPPORTED_TEXT_EXTENSIONS.has(ext);
  const isImage = SUPPORTED_IMAGE_EXTENSIONS.has(ext);

  if (!isText && !isImage) {
    throw new Error(
      `Unsupported file type: ${ext}. Supported: ${Array.from(SUPPORTED_TEXT_EXTENSIONS).concat(Array.from(SUPPORTED_IMAGE_EXTENSIONS)).join(', ')}`
    );
  }

  const kb = await loadKnowledgeBase();
  const id = crypto.randomUUID();
  const fileName = path.basename(sourceUri.fsPath);
  const storedFileName = `${id}${ext}`;
  const knowledgeDir = getKnowledgeDir();
  await fs.promises.mkdir(knowledgeDir, { recursive: true });
  const storedPath = path.join(knowledgeDir, storedFileName);

  await fs.promises.copyFile(sourceUri.fsPath, storedPath);

  let summary: string;
  if (isText) {
    const content = await fs.promises.readFile(storedPath, 'utf-8');
    summary = await summarizeText(content, fileName);
  } else {
    let imageBuffer: Buffer<ArrayBufferLike> = await fs.promises.readFile(storedPath);
    let sizeMb = imageBuffer.length / (1024 * 1024);
    if (sizeMb > MAX_IMAGE_SIZE_MB) {
      imageBuffer = await compressImage(imageBuffer, ext);
      sizeMb = imageBuffer.length / (1024 * 1024);
      if (sizeMb > MAX_IMAGE_SIZE_MB) {
        throw new Error(
          `Image still too large after compression (${sizeMb.toFixed(1)} MB). Please resize to under ${MAX_IMAGE_SIZE_MB} MB or use a lower resolution image.`
        );
      }
    }
    const base64 = imageBuffer.toString('base64');
    summary = await summarizeImage(base64, ext, fileName);
  }

  const relativeStoredPath = path.relative(path.dirname(getKnowledgeBasePath()), storedPath);

  const item: KnowledgeItem = {
    id,
    fileName,
    type: isText ? 'text' : 'image',
    storedPath: relativeStoredPath,
    summary,
    uploadedAt: new Date().toISOString(),
  };

  kb.items.push(item);
  await saveKnowledgeBase(kb);
  return item;
}

export async function removeKnowledgeItem(id: string): Promise<void> {
  const kb = await loadKnowledgeBase();
  const item = kb.items.find((i) => i.id === id);
  if (!item) {
    throw new Error('Knowledge item not found.');
  }

  const storedFullPath = path.isAbsolute(item.storedPath)
    ? item.storedPath
    : path.join(path.dirname(getKnowledgeBasePath()), item.storedPath);

  if (fs.existsSync(storedFullPath)) {
    await fs.promises.unlink(storedFullPath);
  }

  kb.items = kb.items.filter((i) => i.id !== id);
  await saveKnowledgeBase(kb);
}

async function summarizeText(content: string, fileName: string): Promise<string> {
  const config = getLLMConfig();
  if (!config.apiKey) {
    throw new Error('Resume Copilot: API key is not configured.');
  }

  const truncated = content.slice(0, 12000);
  const prompt = `Summarize the following document in 2-4 sentences, focusing on content that might be relevant for writing a resume: achievements, responsibilities, projects, skills, metrics, awards, or impact. Be concise.\n\nFile name: ${fileName}\n\nDocument content:\n${truncated}`;

  return await chatCompletion(
    [
      { role: 'system', content: 'You are a resume research assistant.' },
      { role: 'user', content: prompt },
    ],
    config,
    { maxTokens: 512 }
  );
}

async function compressImage(buffer: Buffer<ArrayBufferLike>, ext: string): Promise<Buffer<ArrayBufferLike>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const image = await Jimp.read(buffer as any);
  const maxDimension = 2048;
  if (image.getWidth() > maxDimension || image.getHeight() > maxDimension) {
    image.resize(maxDimension, Jimp.AUTO);
  }
  image.quality(80);

  const mimeType =
    ext === '.png'
      ? Jimp.MIME_PNG
      : ext === '.gif'
      ? Jimp.MIME_GIF
      : Jimp.MIME_JPEG;

  const compressed = await image.getBufferAsync(mimeType);
  return Buffer.from(compressed);
}

async function summarizeImage(base64: string, ext: string, fileName: string): Promise<string> {
  const config = getVisionConfig();
  if (!config.apiKey) {
    throw new Error('Resume Copilot: API key is not configured.');
  }

  const mimeType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const dataUrl = `data:${mimeType};base64,${base64}`;

  return await chatCompletion(
    [
      {
        role: 'system',
        content:
          'You are a resume research assistant. Describe the image concisely, focusing on details that might be relevant for a resume: names, dates, roles, achievements, metrics, awards, projects, or skills.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `This image is named "${fileName}". Summarize its content in 2-4 sentences, focusing on resume-relevant information.`,
          },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } },
        ],
      },
    ],
    config,
    { maxTokens: 512 }
  );
}
