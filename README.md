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
cd /Users/reinyu/Documents/Code/ai-council-workspace
npm run doctor
$EDITOR .ai-team/CONTEXT.md
$EDITOR .ai-team/TASK.md
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

