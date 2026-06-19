import * as vscode from 'vscode';
import { URLSearchParams } from 'url';
import { chatCompletion, getLLMConfig } from './llm';
import { buildKnowledgeContext, loadKnowledgeBase } from './knowledge';
import { loadProfile, buildProfileContext } from './profile';

const POLISH_SCHEME = 'resume-copilot-polish';

class PolishContentProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    const params = new URLSearchParams(uri.query);
    return params.get('content') || '';
  }
}

export function registerPolishCommand(context: vscode.ExtensionContext): void {
  const provider = new PolishContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(POLISH_SCHEME, provider)
  );

  const disposable = vscode.commands.registerCommand(
    'resumeCopilot.polishSelection',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showWarningMessage(
          'Resume Copilot: Please select text in a Markdown resume.'
        );
        return;
      }

      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);
      if (!selectedText.trim()) {
        vscode.window.showWarningMessage('Resume Copilot: Please select some text to polish.');
        return;
      }

      const config = getLLMConfig();
      if (!config.apiKey) {
        vscode.window.showErrorMessage(
          'Resume Copilot: API key is not configured. Set resumeCopilot.apiKey in settings.'
        );
        return;
      }

      try {
        const useProfileContext = vscode.workspace
          .getConfiguration('resumeCopilot')
          .get<boolean>('enableProfileContext', true);
        const profile = useProfileContext ? await loadProfile() : undefined;
        const profileContext = buildProfileContext(profile);
        const kb = useProfileContext ? await loadKnowledgeBase() : undefined;
        const knowledgeContext = buildKnowledgeContext(kb);

        let systemContent =
          'You are a resume editor. Improve the selected resume text to be more concise, impactful, and results-oriented. Preserve the original meaning and language. Use strong action verbs and include metrics where appropriate. Return only the polished text, without explanations.';

        if (profileContext || knowledgeContext) {
          systemContent =
            'You are a resume editor. You have access to background context about the candidate. Use it implicitly to improve the selected resume text. Preserve the original meaning and language. Use strong action verbs and include metrics where appropriate. When the selected text under-represents something in the background, bring it in naturally. Return only the polished text, without explanations. Do NOT reveal that you have read any uploaded materials.';
          if (profileContext) {
            systemContent += '\n\n' + profileContext;
          }
          if (knowledgeContext) {
            systemContent += '\n\n' + knowledgeContext;
          }
        }

        const polished = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Resume Copilot: Polishing selection...',
            cancellable: false,
          },
          async () => {
            return await chatCompletion(
              [
                {
                  role: 'system',
                  content: systemContent,
                },
                { role: 'user', content: selectedText },
              ],
              config
            );
          }
        );

        const originalUri = vscode.Uri.parse(
          `${POLISH_SCHEME}:original.md?${new URLSearchParams({ content: selectedText }).toString()}`
        );
        const polishedUri = vscode.Uri.parse(
          `${POLISH_SCHEME}:polished.md?${new URLSearchParams({ content: polished }).toString()}`
        );

        await vscode.commands.executeCommand(
          'vscode.diff',
          originalUri,
          polishedUri,
          'Resume Copilot: Original ↔ Polished'
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Resume Copilot: ${err}`);
      }
    }
  );

  context.subscriptions.push(disposable);
}
