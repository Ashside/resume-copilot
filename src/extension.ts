import * as vscode from 'vscode';
import { registerInlineCompletionProvider } from './inlineCompletion';
import { registerPolishCommand } from './polish';
import { registerDiagnostics } from './diagnostics';
import { registerDiscoveryCommand } from './discovery';
import { registerKnowledgeCommands } from './knowledgeCommands';

export function activate(context: vscode.ExtensionContext): void {
  registerDiscoveryCommand(context);
  registerKnowledgeCommands(context);
  registerInlineCompletionProvider(context);
  registerPolishCommand(context);
  registerDiagnostics(context);
}

export function deactivate(): void {
  // Nothing to clean up explicitly.
}
