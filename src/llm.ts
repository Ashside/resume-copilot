import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import * as vscode from 'vscode';

export interface LLMConfig {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
}

export function getLLMConfig(): LLMConfig {
  const config = vscode.workspace.getConfiguration('resumeCopilot');
  return {
    apiBaseUrl: config.get<string>('apiBaseUrl') || 'https://api.openai.com/v1',
    apiKey: config.get<string>('apiKey') || '',
    model: config.get<string>('model') || 'gpt-4o-mini',
  };
}

export function getVisionConfig(): LLMConfig {
  const config = vscode.workspace.getConfiguration('resumeCopilot');
  return {
    apiBaseUrl: config.get<string>('apiBaseUrl') || 'https://api.openai.com/v1',
    apiKey: config.get<string>('apiKey') || '',
    model: config.get<string>('visionModel') || 'gpt-4o',
  };
}

export interface TextContentPart {
  type: 'text';
  text: string;
}

export interface ImageContentPart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

export type ChatMessageContent = string | (TextContentPart | ImageContentPart)[];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: ChatMessageContent;
}

export interface ChatCompletionOptions {
  maxTokens?: number;
  temperature?: number;
}

export async function chatCompletion(
  messages: ChatMessage[],
  config?: LLMConfig,
  options?: ChatCompletionOptions
): Promise<string> {
  const cfg = config || getLLMConfig();
  if (!cfg.apiKey) {
    throw new Error(
      'Resume Copilot: API key is not configured. Please set resumeCopilot.apiKey in VS Code settings.'
    );
  }

  const base = cfg.apiBaseUrl.replace(/\/$/, '');
  const url = new URL(`${base}/chat/completions`);
  const requestModule = url.protocol === 'https:' ? https : http;
  const body = JSON.stringify({
    model: cfg.model,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 512,
  });

  return new Promise((resolve, reject) => {
    const req = requestModule.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.apiKey}`,
          'Accept': 'application/json',
        },
      },
      (res: http.IncomingMessage) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Resume Copilot: API returned ${res.statusCode}: ${data}`));
            return;
          }
          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.message?.content;
            if (typeof content === 'string') {
              resolve(content.trim());
            } else {
              reject(new Error('Resume Copilot: Unexpected API response format.'));
            }
          } catch (e) {
            reject(new Error(`Resume Copilot: Failed to parse API response: ${e}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
