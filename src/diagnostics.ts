import * as vscode from 'vscode';

const BULLET_REGEX = /^(\s*)([-*]|\d+\.)\s+/;

const WEAK_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /负责相关工作|负责一些|负责部分/g,
    message: '职责描述过于模糊，请具体说明做了什么、达成了什么。',
  },
  {
    pattern: /参与项目|参与相关/g,
    message: '“参与”不够有力，请突出你的具体贡献和可衡量成果。',
  },
  {
    pattern: /协助.*工作/g,
    message: '避免只用“协助”，尝试说明独立承担或主导的部分。',
  },
  {
    pattern: /等等/g,
    message: '避免用“等等”模糊列举，尽量给出完整、具体的信息。',
  },
];

const NUMBER_REGEX = /\d+(\.\d+)?%?|\d+\s*(人|万|千|百|亿|元|美元|个月|年|倍|GB|MB|TPS|QPS)/;

export function registerDiagnostics(context: vscode.ExtensionContext): vscode.DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection('resumeCopilot');
  context.subscriptions.push(collection);

  const refresh = (document: vscode.TextDocument) => {
    const enabled = vscode.workspace
      .getConfiguration('resumeCopilot')
      .get<boolean>('enableDiagnostics', true);

    if (!enabled || document.languageId !== 'markdown') {
      collection.delete(document.uri);
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];

    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
      const line = document.lineAt(lineIndex);
      const text = line.text;
      const bulletMatch = text.match(BULLET_REGEX);
      if (!bulletMatch) {
        continue;
      }

      const contentStart = bulletMatch[0].length;
      const content = text.slice(contentStart);

      // Skip very short bullets.
      if (content.trim().length < 5) {
        continue;
      }

      // Weak phrase checks.
      for (const weak of WEAK_PATTERNS) {
        for (const match of content.matchAll(weak.pattern)) {
          const start = contentStart + (match.index ?? 0);
          const range = new vscode.Range(lineIndex, start, lineIndex, start + match[0].length);
          const diagnostic = new vscode.Diagnostic(
            range,
            weak.message,
            vscode.DiagnosticSeverity.Warning
          );
          diagnostic.source = 'Resume Copilot';
          diagnostics.push(diagnostic);
        }
      }

      // Missing quantification.
      if (content.length > 20 && !NUMBER_REGEX.test(content)) {
        const range = new vscode.Range(
          lineIndex,
          contentStart,
          lineIndex,
          text.length
        );
        const diagnostic = new vscode.Diagnostic(
          range,
          '缺少量化指标。尝试加入数字、百分比或规模，让成果更具体。',
          vscode.DiagnosticSeverity.Information
        );
        diagnostic.source = 'Resume Copilot';
        diagnostics.push(diagnostic);
      }

      // Bullet too long.
      if (content.length > 120) {
        const range = new vscode.Range(lineIndex, 0, lineIndex, text.length);
        const diagnostic = new vscode.Diagnostic(
          range,
          '简历 bullet 建议控制在 120 字符以内，考虑拆分或精简。',
          vscode.DiagnosticSeverity.Information
        );
        diagnostic.source = 'Resume Copilot';
        diagnostics.push(diagnostic);
      }
    }

    collection.set(document.uri, diagnostics);
  };

  // Refresh active editor on activation.
  if (vscode.window.activeTextEditor) {
    refresh(vscode.window.activeTextEditor.document);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidSaveTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => refresh(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('resumeCopilot.refreshDiagnostics', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        refresh(editor.document);
      }
    })
  );

  return collection;
}
