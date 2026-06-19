import * as vscode from 'vscode';
import * as path from 'path';
import {
  addKnowledgeFromFile,
  loadKnowledgeBase,
  removeKnowledgeItem,
} from './knowledge';

export function registerKnowledgeCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('resumeCopilot.addKnowledge', async () => {
      if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('Resume Copilot: Please open a workspace folder first.');
        return;
      }

      const uris = await vscode.window.showOpenDialog({
        canSelectMany: true,
        openLabel: 'Upload as background knowledge',
        filters: {
          'Supported files': [
            'txt',
            'md',
            'markdown',
            'json',
            'csv',
            'png',
            'jpg',
            'jpeg',
            'gif',
            'webp',
          ],
          'Text files': ['txt', 'md', 'markdown', 'json', 'csv'],
          Images: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
        },
      });

      if (!uris || uris.length === 0) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Resume Copilot: Summarizing uploaded materials...',
          cancellable: false,
        },
        async () => {
          const results: string[] = [];
          for (const uri of uris) {
            try {
              const item = await addKnowledgeFromFile(uri);
              results.push(`✓ ${item.fileName}`);
            } catch (err) {
              results.push(`✗ ${path.basename(uri.fsPath)}: ${err}`);
            }
          }
          const message = results.join('  ');
          vscode.window.showInformationMessage(`Resume Copilot: ${message}`);
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('resumeCopilot.manageKnowledge', async () => {
      const kb = await loadKnowledgeBase();
      if (kb.items.length === 0) {
        vscode.window.showInformationMessage('Resume Copilot: No uploaded materials yet.');
        return;
      }

      const pickItems: vscode.QuickPickItem[] = kb.items.map((item) => ({
        label: item.fileName,
        description: `${item.type} · ${new Date(item.uploadedAt).toLocaleDateString()}`,
        detail: item.summary.slice(0, 120) + (item.summary.length > 120 ? '...' : ''),
      }));

      const selected = await vscode.window.showQuickPick(pickItems, {
        canPickMany: false,
        placeHolder: 'Select a material to view or delete',
      });
      if (!selected) {
        return;
      }

      const item = kb.items.find((i) => i.fileName === selected.label);
      if (!item) {
        return;
      }

      const action = await vscode.window.showInformationMessage(
        item.summary,
        { modal: true, detail: `Uploaded: ${new Date(item.uploadedAt).toLocaleString()}` },
        'Delete',
        'Close'
      );

      if (action === 'Delete') {
        await removeKnowledgeItem(item.id);
        vscode.window.showInformationMessage(`Resume Copilot: Deleted ${item.fileName}`);
      }
    })
  );
}
