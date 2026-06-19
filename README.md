# Resume Copilot

一个在 VS Code 里辅助你写 Markdown 简历的扩展，灵感来自 GitHub Copilot。它不会替你写完整简历，而是先通过苏格拉底式诘问帮你梳理清楚“我到底做过什么”，再在你打字的过程中提供贴合你真实经历的补全、润色和诊断，让你始终掌握主导权。

## 功能

### 0. 苏格拉底式经历挖掘（Discovery Interview）

在开始写简历之前，运行 **Resume Copilot: Start Discovery Interview**，会打开一个访谈窗口。AI 会像一个苏格拉底式的追问者，不断向你提问：

- 你当时具体负责什么？
- 那个问题的背景是什么？
- 你采取了什么行动？
- 结果如何？能用数字描述吗？
- 这件事体现了你什么能力？

对话结束后，AI 会把访谈内容整理成一份结构化档案 `.resume-copilot/profile.json`。之后的补全和润色都会基于这份档案，给出更贴合你真实背景的建议。

### 0.5 上传背景资料作为隐式知识库

在访谈之前，你可以运行 **Resume Copilot: Add Background Knowledge**，上传文字或图片资料：

- 绩效评估、年终总结
- 项目文档、PRD、技术方案
- 获奖证书、作品集截图
- 任何能证明你做过什么的材料

扩展会对每份资料调用 LLM 生成摘要，存入 `.resume-copilot/knowledge.json`。在苏格拉底式访谈中，AI 会**隐性参考**这些资料，提出更具体、更有针对性的问题——但它不会直接说“根据你上传的文件”，而是引导你自己把经历讲出来。

上传后可以用 **Resume Copilot: Manage Background Knowledge** 查看或删除已保存的资料。

### 1. 幽灵补全（Inline Completion）

在 Markdown 简历的 bullet point 行输入时，Resume Copilot 会像 Copilot 一样给出灰色幽灵补全。按 `Tab` 接受，继续写你自己的版本则忽略。

触发条件：
- 文件类型为 Markdown
- 当前行是 `- ` 或 `* ` 开头的 bullet point
- 光标位于行尾
- 当前 bullet 已输入至少 3 个字符

可在设置中关闭：`resumeCopilot.enableInlineCompletion`

### 2. 一键润色选中文本

选中任意一段经历描述，执行命令 **Resume Copilot: Polish Selection**（默认快捷键 `Ctrl+Shift+R` / `Cmd+Shift+R`），扩展会调用 LLM 生成润色版本，并以 diff 形式展示原文 vs 润色后的对比。

你可以逐行查看改动，选择手动合并到简历中。

### 3. 简历问题诊断

保存 Markdown 文件时，扩展会自动扫描简历 bullet，对常见问题给出波浪线提示：

- **空话套话**：如“负责相关工作”“参与项目”“协助工作”等模糊表达
- **缺少量化指标**：过长的 bullet 中没有数字、百分比或规模
- **句子过长**：单条 bullet 超过 120 字符时建议精简

可在设置中关闭：`resumeCopilot.enableDiagnostics`

## 安装

### 本地运行（开发模式）

```bash
cd resume-copilot
npm install
npm run compile
```

然后在 VS Code 中按 `F5` 打开 Extension Development Host，或者通过命令面板运行 **Developer: Install from VSIX...** 安装打包后的 `.vsix` 文件。

### 打包

```bash
npm install -g @vscode/vsce
npm run package
```

会生成 `resume-copilot-1.0.0.vsix`。

## 配置

打开 VS Code 设置，搜索 `resumeCopilot`：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `resumeCopilot.apiBaseUrl` | OpenAI 兼容 API 的基础 URL | `https://api.openai.com/v1` |
| `resumeCopilot.apiKey` | 你的 API Key | （空） |
| `resumeCopilot.model` | 模型名称 | `gpt-4o-mini` |
| `resumeCopilot.enableInlineCompletion` | 是否启用幽灵补全 | `true` |
| `resumeCopilot.enableDiagnostics` | 是否启用简历诊断 | `true` |
| `resumeCopilot.profilePath` | 经历档案保存路径 | `.resume-copilot/profile.json` |
| `resumeCopilot.enableProfileContext` | 是否在补全/润色中携带档案上下文 | `true` |
| `resumeCopilot.knowledgePath` | 知识库保存路径 | `.resume-copilot/knowledge.json` |
| `resumeCopilot.visionModel` | 图片摘要用的视觉模型 | `gpt-4o` |
| `resumeCopilot.enableKnowledgeContext` | 是否在访谈/补全/润色中携带知识库上下文 | `true` |

### 使用非 OpenAI 服务

支持任何 OpenAI 兼容接口，例如：

- **DeepSeek**：`https://api.deepseek.com/v1`，模型 `deepseek-chat`
- **Ollama 本地**：`http://localhost:11434/v1`，模型如 `llama3`
- **Azure OpenAI**：填写对应的 endpoint 和模型名

## 使用建议

1. **先上传资料（可选）**：运行 **Resume Copilot: Add Background Knowledge**，把绩效、项目文档、证书截图等上传为隐式知识库。
2. **再访谈**：运行 **Resume Copilot: Start Discovery Interview**，AI 会基于已有资料更有针对性地追问，生成 `profile.json`。
3. **写简历**：把你的简历写成 Markdown，每条经历用 bullet 列表组织。
4. **利用上下文**：写 bullet 时，幽灵补全和润色都会同时参考 profile 和上传资料，给出更精准的建议。
5. **自己把关**：对不满意的句子，选中后用 **Polish Selection** 看 AI 建议，然后手动决定是否采纳。
6. **定期更新**：有新项目或新成果时，补充上传资料并重新运行访谈。

## 项目结构

```
resume-copilot/
├── src/
│   ├── extension.ts        # 扩展入口
│   ├── llm.ts              # LLM API 客户端
│   ├── profile.ts          # 经历档案类型与读写
│   ├── knowledge.ts        # 背景知识库类型、读写与摘要
│   ├── knowledgeCommands.ts# 上传/管理背景知识命令
│   ├── discovery.ts        # 苏格拉底式访谈 Webview
│   ├── inlineCompletion.ts # 幽灵补全
│   ├── polish.ts           # 润色命令
│   └── diagnostics.ts      # 简历诊断
├── package.json            # 扩展清单与配置
├── tsconfig.json
└── README.md
```

## 已知限制

- 目前只支持 Markdown 文件。
- 润色功能只展示 diff，不会自动替换原文，这是有意设计的——让你保持最终决定权。
- 诊断规则基于启发式，可能误报，欢迎根据自己的行业调整规则。
- 背景资料目前支持 `.txt`、`.md`、`.json`、`.csv` 和常见图片格式。PDF/Word 需先复制文字到文本文件或截图上传。
- 图片摘要依赖视觉模型（默认 `gpt-4o`），请确保你使用的 API 支持该模型或手动切换为其他 vision 模型。

## License

MIT
