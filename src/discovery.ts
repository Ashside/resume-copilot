import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { chatCompletion, getLLMConfig } from './llm';
import { buildKnowledgeContext, loadKnowledgeBase } from './knowledge';
import { defaultProfile, getProfilePath, loadProfile, saveProfile, type Profile } from './profile';

const DISCOVERY_VIEW_TYPE = 'resumeCopilot.discovery';

interface WebviewMessage {
  command: 'sendMessage' | 'finishInterview';
  text?: string;
}

const SOCRATIC_SYSTEM_PROMPT = `You are a Socratic resume discovery assistant. Your goal is to help the user uncover what they have truly done, achieved, and learned, so the information can later be used to write a strong resume.

Rules:
1. Ask ONE concise question at a time.
2. Use the Socratic method: challenge vague answers, ask for specifics, probe for metrics, context, and impact.
3. Do not accept "I did some work" or "I participated in a project" at face value. Ask what exactly they did, why it mattered, and what changed as a result.
4. Progress through topics in this order: target role → recent work experience → earlier work experience → projects → education → skills. Move on only when you have enough detail.
5. Keep your questions in the same language as the user.
6. Do NOT write the resume for the user. Only ask clarifying questions and summarize understanding briefly when needed.
7. Encourage numbers: users, revenue, percentage, time saved, scale, team size, etc.

In addition, you may have access to background materials the user uploaded earlier. Use them only as implicit context to ask better, more specific Socratic questions. Do NOT mention the uploaded materials directly. Do NOT say "according to your file", "you wrote in the document", or any phrase that reveals you have read them. Your role is still to make the user articulate their own experiences.`;

const SUMMARY_SYSTEM_PROMPT = `You are a structured data extractor. Based on the conversation, produce a JSON profile object that captures the user's background for resume writing.

Schema:
{
  "version": "1.0",
  "targetRole": "string or omitted",
  "summary": "string or omitted: a one-sentence professional summary",
  "experiences": [
    {
      "id": "uuid-style-string",
      "company": "string or omitted",
      "title": "string or omitted",
      "period": "string or omitted",
      "situation": "string or omitted: the problem or context",
      "task": "string or omitted: the user's responsibility",
      "actions": ["array of strings"],
      "results": ["array of strings, preferably quantified"],
      "skills": ["array of strings"]
    }
  ],
  "projects": [
    {
      "id": "uuid-style-string",
      "name": "string or omitted",
      "role": "string or omitted",
      "situation": "string or omitted",
      "actions": ["array of strings"],
      "results": ["array of strings"],
      "skills": ["array of strings"]
    }
  ],
  "education": [
    { "school": "string", "degree": "string or omitted", "period": "string or omitted" }
  ],
  "skills": ["array of strings"]
}

Return ONLY valid JSON. Do not wrap it in markdown code fences. Do not add explanations.`;

export function registerDiscoveryCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('resumeCopilot.startDiscovery', async () => {
      try {
        await openDiscoveryWebview(context);
      } catch (err) {
        vscode.window.showErrorMessage(`Resume Copilot: ${err}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('resumeCopilot.openProfile', async () => {
      const profile = await loadProfile();
      if (!profile) {
        vscode.window.showInformationMessage(
          'Resume Copilot: No profile found yet. Start a discovery interview first.'
        );
        return;
      }
      const profilePath = getProfileUri();
      if (!profilePath) {
        return;
      }
      const doc = await vscode.workspace.openTextDocument(profilePath);
      await vscode.window.showTextDocument(doc);
    })
  );
}

function getProfileUri(): vscode.Uri | undefined {
  try {
    return vscode.Uri.file(getProfilePath());
  } catch (err) {
    vscode.window.showErrorMessage(`Resume Copilot: ${err}`);
    return undefined;
  }
}

async function openDiscoveryWebview(context: vscode.ExtensionContext): Promise<void> {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('Resume Copilot: Please open a workspace folder first.');
    return;
  }

  const config = getLLMConfig();
  if (!config.apiKey) {
    vscode.window.showErrorMessage(
      'Resume Copilot: API key is not configured. Set resumeCopilot.apiKey in settings before starting discovery.'
    );
    return;
  }

  const useKnowledgeContext = vscode.workspace
    .getConfiguration('resumeCopilot')
    .get<boolean>('enableKnowledgeContext', true);
  const kb = useKnowledgeContext ? await loadKnowledgeBase() : undefined;
  const knowledgeContext = buildKnowledgeContext(kb);
  const systemPrompt = knowledgeContext
    ? `${SOCRATIC_SYSTEM_PROMPT}\n\n${knowledgeContext}`
    : SOCRATIC_SYSTEM_PROMPT;

  const panel = vscode.window.createWebviewPanel(
    DISCOVERY_VIEW_TYPE,
    'Resume Copilot: Discovery Interview',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  const conversation: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemPrompt },
  ];

  panel.webview.html = getDiscoveryHtml(panel.webview);

  const postMessage = (command: string, data?: Record<string, unknown>) => {
    panel.webview.postMessage({ command, ...data });
  };

  // Send opening question.
  const openingQuestion =
    '你好，我是你的简历创作辅助 agent。在我们开始写简历之前，我想先通过一些问题了解你真正做过什么。\n\n你可以从最近的一段工作或项目开始介绍吗？请尽量具体，比如：你在什么团队、负责什么、解决了什么问题。';
  conversation.push({ role: 'assistant', content: openingQuestion });
  postMessage('appendMessage', { role: 'assistant', text: openingQuestion });

  panel.webview.onDidReceiveMessage(
    async (message: WebviewMessage) => {
      if (message.command === 'sendMessage' && message.text) {
        const userText = message.text.trim();
        if (!userText) {
          return;
        }

        conversation.push({ role: 'user', content: userText });

        try {
          postMessage('setLoading', { isLoading: true });
          const reply = await chatCompletion(conversation, config);
          conversation.push({ role: 'assistant', content: reply });
          postMessage('appendMessage', { role: 'assistant', text: reply });
        } catch (err) {
          vscode.window.showErrorMessage(`Resume Copilot: ${err}`);
          postMessage(
            'appendMessage',
            {
              role: 'assistant',
              text: '抱歉，调用 AI 时出错了。请检查 API 配置后重试。',
            }
          );
        } finally {
          postMessage('setLoading', { isLoading: false });
        }
      } else if (message.command === 'finishInterview') {
        try {
          postMessage('setLoading', { isLoading: true });
          const summaryMessages = [
            { role: 'system' as const, content: SUMMARY_SYSTEM_PROMPT },
            {
              role: 'user' as const,
              content:
                'Based on the following discovery conversation, generate the JSON profile.\n\n' +
                conversation
                  .filter((m) => m.role !== 'system')
                  .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
                  .join('\n\n'),
            },
          ];

          const rawJson = await chatCompletion(summaryMessages, config, { maxTokens: 2048 });
          const profile = parseProfileJson(rawJson);
          const profileUri = getProfileUri();
          if (!profileUri) {
            return;
          }
          await saveProfile(profile, profileUri.fsPath);

          postMessage('setFinished');
          postMessage('appendMessage', {
            role: 'assistant',
            text: `访谈完成，档案已保存到：${profileUri.fsPath}\n\n现在你可以回到 Markdown 简历继续写作，Resume Copilot 会基于这份档案给出更贴合你经历的补全和建议。`,
          });
        } catch (err) {
          vscode.window.showErrorMessage(`Resume Copilot: Failed to generate profile: ${err}`);
          postMessage('setLoading', { isLoading: false });
        }
      }
    },
    undefined,
    context.subscriptions
  );
}

function parseProfileJson(raw: string): Profile {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n```$/, '');
  }
  const parsed = JSON.parse(cleaned) as Partial<Profile>;
  return {
    version: '1.0',
    updatedAt: new Date().toISOString(),
    targetRole: parsed.targetRole,
    summary: parsed.summary,
    experiences: parsed.experiences || [],
    projects: parsed.projects || [],
    education: parsed.education || [],
    skills: parsed.skills || [],
  };
}

function getDiscoveryHtml(webview: vscode.Webview): string {
  const nonce = crypto.randomBytes(16).toString('base64');
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Resume Copilot: Discovery Interview</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      box-sizing: border-box;
      margin: 0;
    }
    h2 { margin-top: 0; }
    .hint {
      color: var(--vscode-descriptionForeground);
      font-size: 0.95em;
      margin-bottom: 12px;
    }
    #chat {
      flex: 1;
      overflow-y: auto;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 12px;
      background: var(--vscode-editor-background);
    }
    .message {
      margin: 8px 0;
      padding: 10px 12px;
      border-radius: 8px;
      line-height: 1.5;
      white-space: pre-wrap;
    }
    .user {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      margin-left: 32px;
    }
    .assistant {
      background: var(--vscode-editor-inactiveSelectionBackground);
      margin-right: 32px;
    }
    #input-row {
      display: flex;
      gap: 8px;
    }
    textarea {
      flex: 1;
      min-height: 72px;
      font-family: inherit;
      font-size: inherit;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      padding: 8px;
      resize: vertical;
    }
    button {
      padding: 8px 16px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    #actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 8px;
    }
    .loader {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
  </style>
</head>
<body>
  <h2>Resume Copilot：苏格拉底式经历挖掘</h2>
  <div class="hint">
    我会像苏格拉底一样不断追问，帮你把“我到底做过什么”梳理清楚。回答越具体越好，我会挑战模糊的说法，并引导你给出数据、影响和上下文。
  </div>
  <div id="chat"></div>
  <div id="input-row">
    <textarea id="input" placeholder="输入你的回答，按 Ctrl+Enter 发送..."></textarea>
    <button id="send">发送</button>
  </div>
  <div id="actions">
    <button id="finish">完成访谈，生成档案</button>
    <span id="status" class="loader" style="visibility:hidden;">AI 正在思考...</span>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const chat = document.getElementById('chat');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const finishBtn = document.getElementById('finish');
    const status = document.getElementById('status');

    function appendMessage(role, text) {
      const div = document.createElement('div');
      div.className = 'message ' + role;
      div.textContent = text;
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    }

    function setLoading(isLoading) {
      status.style.visibility = isLoading ? 'visible' : 'hidden';
      sendBtn.disabled = isLoading;
      finishBtn.disabled = isLoading;
      input.disabled = isLoading;
    }

    function sendInput() {
      const text = input.value.trim();
      if (!text || sendBtn.disabled) return;
      appendMessage('user', text);
      vscode.postMessage({ command: 'sendMessage', text });
      input.value = '';
    }

    sendBtn.addEventListener('click', sendInput);
    input.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
        sendInput();
      }
    });

    finishBtn.addEventListener('click', () => {
      if (finishBtn.disabled) return;
      if (confirm('确定要完成访谈并生成档案吗？')) {
        vscode.postMessage({ command: 'finishInterview' });
      }
    });

    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.command) {
        case 'appendMessage':
          appendMessage(message.role, message.text);
          break;
        case 'setLoading':
          setLoading(message.isLoading);
          break;
        case 'setFinished':
          input.disabled = true;
          sendBtn.disabled = true;
          finishBtn.disabled = true;
          break;
      }
    });
  </script>
</body>
</html>`;
}
