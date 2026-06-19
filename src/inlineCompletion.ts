import * as vscode from 'vscode';
import { chatCompletion, getLLMConfig } from './llm';
import { buildKnowledgeContext, loadKnowledgeBase } from './knowledge';
import { loadProfile, buildProfileContext } from './profile';

const BULLET_REGEX = /^(\s*)([-*]|\d+\.)\s+/;

export function registerInlineCompletionProvider(context: vscode.ExtensionContext): void {
  const provider: vscode.InlineCompletionItemProvider = {
    async provideInlineCompletionItems(document, position, _context, _token) {
      const config = getLLMConfig();
      const enabled = vscode.workspace
        .getConfiguration('resumeCopilot')
        .get<boolean>('enableInlineCompletion', true);
      const useProfileContext = vscode.workspace
        .getConfiguration('resumeCopilot')
        .get<boolean>('enableProfileContext', true);

      if (!enabled || !config.apiKey) {
        return;
      }

      const line = document.lineAt(position);
      const lineText = line.text;

      // Only trigger on resume bullet lines, and only when the cursor is at the end of the line.
      if (!BULLET_REGEX.test(lineText) || position.character !== lineText.length) {
        return;
      }

      const bulletMatch = lineText.match(BULLET_REGEX);
      const bulletPrefix = bulletMatch ? bulletMatch[0] : '';
      const bulletContent = lineText.slice(bulletPrefix.length);

      // Avoid calling the API for empty or very short bullets.
      if (bulletContent.trim().length < 3) {
        return;
      }

      const fullText = document.getText();
      const cursorOffset = document.offsetAt(position);
      const prefix = fullText.slice(0, cursorOffset);
      const suffix = fullText.slice(cursorOffset);

      const profile = useProfileContext ? await loadProfile() : undefined;
      const profileContext = buildProfileContext(profile);
      const kb = useProfileContext ? await loadKnowledgeBase() : undefined;
      const knowledgeContext = buildKnowledgeContext(kb);

      let systemContent = 'You are a resume writing assistant. Continue the current resume bullet point from where the user stopped typing. Keep it concise, professional, and results-oriented. Add metrics when natural. Do NOT repeat the text already written.';

      if (profileContext || knowledgeContext) {
        systemContent =
          'You are a resume writing assistant. You have access to background context about the candidate. Use it implicitly to continue the current resume bullet point accurately and naturally. Keep it concise, professional, and results-oriented. Add metrics when natural. Do NOT repeat the text already written. Do NOT reveal that you have read any uploaded materials.';
        if (profileContext) {
          systemContent += '\n\n' + profileContext;
        }
        if (knowledgeContext) {
          systemContent += '\n\n' + knowledgeContext;
        }
      }

      const messages = [
        {
          role: 'system' as const,
          content: systemContent,
        },
        {
          role: 'user' as const,
          content: `Resume (Markdown):
${prefix}|CURSOR|${suffix}

Continue the current bullet point after "${bulletContent.trim()}". Output only the continuation text.`,
        },
      ];

      try {
        const completion = await chatCompletion(messages, config);
        if (!completion) {
          return;
        }

        // Strip any accidental markdown bullet or duplicated prefix.
        let insertText = completion
          .replace(/^[-*]\s+/, '')
          .replace(/^\d+\.\s+/, '')
          .trimStart();

        if (insertText.toLowerCase().startsWith(bulletContent.trim().toLowerCase())) {
          insertText = insertText.slice(bulletContent.trim().length).trimStart();
        }

        if (!insertText) {
          return;
        }

        return [new vscode.InlineCompletionItem(insertText)];
      } catch (err) {
        console.error('[Resume Copilot] inline completion error:', err);
        return;
      }
    },
  };

  const selector: vscode.DocumentSelector = { scheme: 'file', language: 'markdown' };
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(selector, provider)
  );
}
