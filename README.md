# AI Council Workspace

这是一个供 Claude Code、Codex CLI 和 Google Antigravity（Gemini）共同读取文件、交换上下文并协作的本地 Git 仓库。编排器使用 Claw Orchestrator，三种模型继续使用各自已经登录的订阅账号，不需要把订阅改成 API Key。

## 工作方式

1. 稳定背景写入 `.ai-team/CONTEXT.md`。
2. 当前目标和验收标准写入 `.ai-team/TASK.md`。
3. 已确认的长期决定写入 `.ai-team/DECISIONS.md`。
4. 提交这些文件，使三个模型看到完全相同的 Git 状态。
5. `npm run team` 启动三模型 Council。Claude、Codex、Gemini 会在独立 worktree 中工作，并通过 Council 的回合历史交换结论。
6. 运行结束后先用 `npm run team:review` 查看证据，再决定接受或拒绝。

## 第一次使用

```bash
cd /path/to/ai-council-workspace
npm run doctor
$EDITOR .ai-team/CONTEXT.md
$EDITOR .ai-team/TASK.md
# 将 TASK.md 中的 Status 改为 READY
git add .ai-team
git commit -m "Define council task"
npm run team:dry-run
npm run team
```

Council 完成后：

```bash
npm run team:status
npm run team:review
npm run team:accept
```

拒绝并留下反馈：

```bash
npm run team:reject -- "说明需要修改的内容"
```

## 安全边界

- 启动器只允许从本仓库的 `main` 分支运行，并要求工作区事先完全干净。
- 每次运行前都会创建 `safety/before-<时间>` 备份分支。
- Claw Council 的内置协作协议会让代理在本地合并到 `main`；不会自动 push。
- Codex 默认运行在 `workspace-write` 沙盒中。Claw 的无头模式要求 Claude 和 Antigravity 自动批准工具，因此它们主要依赖 `AGENTS.md` 和 Council 系统提示中的仓库边界。只在这个专用仓库中运行，不要把工作目录指向主目录或包含私密文件的目录。
- `.ai-team/runtime/`、模型 worktree、运行日志和依赖不会进入 Git。
- `team:accept` 会清理 Council worktree/分支，并把本轮摘要归档到 `.ai-team/history/`。
- `npm run team` 会在派发模型之前从宿主工作区执行一次登录预检。模型自己的隔离 worktree 可能无法读取其他厂商的登录凭据，因此 worktree 内的登录检查不能替代宿主预检。
- `.ai-team/TASK.md` 默认是 `Status: WAITING`；必须写清目标和验收标准并改为 `Status: READY`，启动器才会调用模型。

## 常用文件

| 文件 | 用途 |
| --- | --- |
| `AGENTS.md` | 所有模型必须遵守的安全与协作规则 |
| `.ai-team/CONTEXT.md` | 项目背景和稳定事实 |
| `.ai-team/TASK.md` | 当前唯一任务与验收标准 |
| `.ai-team/DECISIONS.md` | 已确认的长期决定 |
| `.ai-team/team.json` | 三个模型的角色、轮数、超时和预算上限 |
| `.ai-team/runtime/last-run.json` | 最近一次运行状态；已忽略，不提交 |

## 注意

三个模型并不是共享一个厂商侧聊天记录。共享上下文由 Git 文件、`plan.md`、Council 的历史摘要和本地运行账本共同实现。把重要事实写入共享文件，比依赖某个模型的临时记忆更可靠。

## 本地计划审阅聊天室

### macOS App（推荐）

项目已经包含一个原生 macOS 壳。首次构建一次：

```bash
npm run macos:build
open "dist/AI Council.app"
```

之后可直接在 Finder 中双击 `dist/AI Council.app`。首次打开会让你选择一次 Projects 文件夹；选择 `Documents/Code` 后，安全书签会保存在本机。此后可通过 Code 模式 Projects 栏的 `＋` 或“文件 → 添加项目文件夹…”从磁盘任意位置一次添加一个或多个目录，每个目录单独保存安全书签。App 会自动启动仅监听本机的聊天室服务、复用最近的聊天室和设置，并在退出时关闭自己启动的后台服务；不需要再手动运行 `npm run chat` 或重复执行环境检查。

App 目前为本机 ad-hoc 签名，仅用于这台 Mac；重新拉取代码或修改原生入口后，再运行一次 `npm run macos:build` 即可。

### 多会话与多窗口

同一个项目文件夹可以同时保留多个互不干扰的会话，每个会话有自己的完整历史：

- 顶部工具栏的会话名旁边会列出当前项目的全部会话，按最近活动排序；会话名默认取自你在这个会话里说的第一句话，也可以随时重命名或删除。
- `＋` 在当前窗口新建一个空会话（macOS App 中为 `⇧⌘N`，菜单“文件 → 新建会话”）。
- `⧉` 在新窗口打开一个新会话（macOS App 中为 `⌘N`，菜单“文件 → 新建窗口”）。窗口可以按 macOS 原生方式合并成标签页。
- 所有窗口共用同一个本地服务与同一份登录状态。不同会话可以同时向模型提问并各自等待；同一个会话在上一轮回复结束前不接受新的提问。
- 窗口地址栏里记录了 `project` 与 `session`，重新载入或重启后会回到同一段对话。升级前旧版本留下的聊天室会自动作为会话导入，历史不会丢失。
- 会话记录写在 `.ai-team/chat/runtime/`（当前 workspace）或 `.ai-team/chat/runtime/projects/<项目>/`（其他项目）下，每个会话一个目录，均不进入 Git。

### 浏览器入口

```bash
npm run chat
```

终端会打印一个只在本机有效、带随机访问令牌的地址。打开后可以：

- 在 `Chat` 模式讨论、分析和审阅，不生成文件草案。
- 在 `Code` 模式提出 `artifacts/` 下的文件草案，再由你确认是否应用。
- 在 `Code` 模式从 Projects 栏切换项目；直接子目录会按 Node.js、Python、Swift、Rust、Go、JVM、混合环境和其他自动分组。
- 在同一个项目下开多个会话，并把任意会话放到独立窗口里并行进行。
- 独立收起或展开 Projects 和草案栏；Chat/Code 模式与布局状态会跨 App 重启保留。
- 顶部可在中文与 English、亮色与深色之间即时切换；页面、动态状态、macOS 标题栏和原生菜单会同步更新并记住选择。
- 界面采用 Reddit / Discord 风格的扁平信息层级：紧凑顶栏、频道式 Projects、无气泡模型回复和低阴影输入区。
- 手动加入 Projects 自动发现目录之外的任意本地、外置磁盘或网络卷文件夹。
- 选择 Group、Claude、Codex 或 Gemini；也可以重复点击头像组成最多 8 回合的接力队列（如 Claude → Claude → Gemini → Claude），点击队列节点可移除该回合。输入 `@Gemini @Claude` 也同样支持接力。
- 在设置面板中分别覆盖 Claude、Codex、Gemini 的模型与可选预置 prompt；留空时使用 CLI 默认模型且不注入预置 prompt。
- Code 模式让模型按需只读访问当前项目，不在首屏扫描或展示完整文件清单。

### Code 模式的前提

Code 模式下模型要先列目录、读文件，再回答，因此回合上限和预算比 Chat 模式高（24 回合 / 1 USD，Chat 为 6 回合 / 0.2 USD）。回答本身用 `<final_answer>` 包裹，模型在读文件途中写的过程说明不会混进正文。

这样一轮可能要跑一分钟以上，所以 `/api/chat` 以 NDJSON 流式返回：等待期间气泡里会实时显示已用时间、模型当前正在读的文件或执行的命令，以及正在写入的思考摘要；接力模式下每一棒答完就立刻显示，不必等整条链跑完。

三个 CLI 的位置由 `scripts/agent-binaries.mjs` 统一解析：先看 `CLAUDE_BIN` / `CODEX_BIN` / `AGY_BIN` 环境变量，再查 PATH，最后回落到已知安装位置。Codex 随 ChatGPT 桌面版发布在 `/Applications/ChatGPT.app/Contents/Resources/codex`，通常不在 PATH 上，因此这一步是必需的——`npm run doctor`、聊天室健康指示灯和 macOS App 的 PATH 都走同一份解析结果。

Gemini 在 Code 模式下还有一个额外前提：Antigravity CLI 无人值守运行时无法弹出工具授权提示，会自动拒绝**所有**工具并静默返回空结果。不处理的话 Gemini 只在 Chat 模式可用（聊天室会直接说明原因，而不是报“空回复”）。

`npm run gemini:access -- status|enable|verify|revert` 用来管理这条授权（`enable` 会先自动备份，`revert` 可随时还原）。

但**默认不建议开**。在 Antigravity 1.1.23 上实测的结果是：

| 规则写法 | 结果 |
| --- | --- |
| `read_file(/绝对路径/目录)` | 拒绝 |
| `read_file(/绝对路径/目录/**)`、`.../*` | 拒绝 |
| `read_file(*)` | 生效 |
| `command(ls)`、`command(cat)`… | 生效，但 agy 会自行组合模型选的 shell 命令，固定白名单立刻又被挡住 |

也就是说唯一能让 Code 模式跑起来的组合是 `read_file(*)` + `command(*)` —— 对**这台机器上所有** agy 无人值守运行开放“读任意文件 + 执行任意 shell 命令”，而不只是这个 App。Code 模式会带 `--mode plan`，理论上仍是只读，但 plan 模式能否真正约束住 `command(*)` 尚未验证。因此 `enable` 默认拒绝执行，必须显式加 `--wildcard`；执行后请立刻跑 `verify`（它会在受控目录里同时验证“读得到”和“改不了、删不掉、建不出”），任一写入成功就应立即 `revert`。

不开的话，Gemini 在 Chat 模式完全正常，Claude 和 Codex 都能在 Code 模式读项目文件。
- 查看三个模型的独立回复、共享聊天室记录和可折叠的高层推理摘要。
- 正常渲染 Markdown 标题、列表、表格、引用和代码块。

聊天室没有删除接口。Chat 模式的模型会话运行在 `.ai-team/chat/runtime/` 下的空目录；Code 模式则以当前项目为工作目录，并由各 CLI 的只读沙箱阻止直接写入。不同项目的历史和 artifact 注册表彼此隔离。只有聊天室已经登记创建的 artifact 才能再次修改，其他现有文件即使位于 `artifacts/` 也不会被覆盖。完整边界见 `.ai-team/chat/README.md`。

隐私提醒：Code 模式中的模型可以按需读取当前项目；被读取的内容会通过对应厂商 CLI 发送给该模型服务。不要把不希望交给相应服务商的目录加入 Projects。

macOS 仍会保护邮件、浏览器数据、其他用户目录等敏感位置；这类目录即使位于磁盘上，也可能要求你在“系统设置 → 隐私与安全性 → 完全磁盘访问权限”中自行授权 AI Council。App 不会绕过系统权限，也不会因为目录已加入 Projects 就自动读取其中的文件。

### 会话恢复与草案保存

- 对话历史完整保存在本地；发送给模型的上下文仍限制为最近 16 条、最多 48,000 字符。
- 接力和并行回复均在每个模型完成时立即保存、显示，无需等待最慢的模型。
- 未应用草案随会话保存，切换会话或重启后可继续审批。草案生成时自动展开草案栏。
- 应用草案使用已保存的版本；重复点击不会重复写入，文件在审批前被修改时会拒绝覆盖。
- 重命名其他会话不会切换当前对话。切换或新建会话期间暂时阻止发送，以免消息进入错误会话。
- 连接提前中断时会显示恢复提示。重新载入可以查看已经保存的回复；模型可能仍在后台继续运行。

这些改进无法恢复旧版本已删除的早期消息或未保存草案。

## Windows 便携预览版

下载可直接转发的 Windows x64 ZIP：[v1.0.0-rc.1 预发布版本](https://github.com/7s-24/ai-council/releases/tag/v1.0.0-rc.1)。该版本尚未经过 Windows 真机验收。

运行 `npm run windows:build` 可构建 `dist/AI-Council-1.0.0-rc.1-windows-x64.zip`。首次构建从 Node.js 官方站点下载固定版本的 Windows x64 LTS 运行时并核验 SHA-256。只按白名单打包应用代码和公开依赖，不包含本机账号、历史、日志、项目或 macOS App。

朋友解压后双击 `Start-AI-Council.cmd`；没有模型 CLI 时先运行可选的 `Install-Model-CLIs.cmd`，它使用包内 npm 安装固定版本的 Claude/Codex 到当前用户目录。无需 WSL，也无需单独安装 Node.js。Windows 入口使用系统浏览器，项目选择和登录由原生 PowerShell 窗口处理。

这是尚未通过 Windows 真机验证的 RC，不应当作稳定版发布。完整前提、数据路径和验收清单见 `windows/README-WINDOWS.md`。`node scripts/windows-package-smoke.mjs` 可在本机模拟 Windows 服务分支验证打包文件与 HTTP 功能，但不能替代 Windows 运行验证。
