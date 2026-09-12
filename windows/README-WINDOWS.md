# AI Council — Windows x64 便携预览版

这是供朋友试用的 release candidate，不是已通过 Windows 真机验收的正式稳定版。

## 第一次使用

1. 使用 Windows 10/11 的 x64 电脑，将整个 ZIP **全部解压**到普通文件夹。不要直接在压缩包预览中运行文件。
2. 如果没有 Claude Code / Codex，双击 `Install-Model-CLIs.cmd`。它会联网从官方 npm registry 安装固定版本的 Claude Code 2.1.261 和 Codex 0.153.4 到当前用户目录，不需要另外安装 Node.js、WSL 或管理员权限。已有 CLI 的用户可跳过。
3. 双击 `Start-AI-Council.cmd`。保留弹出的控制台窗口，默认浏览器会自动打开本地聊天界面。
4. 打开设置 → 模型 → 重新登录，在 PowerShell 和浏览器中登录你**自己的账号**。返回页面会刷新登录状态。
5. 先选择 Claude 或 Codex 单独发送一句话。确认成功后再尝试 Group、接力及 Code 模式；没有安装全部模型时，不要先用 Group。
6. 在 Code 模式点击 Projects 的 `＋`，通过 Windows 文件夹选择器选择你的项目。

退出时，在控制台按 Ctrl+C。关闭浏览器标签页不会停止后台服务。不要同时启动两份。

## 已有 CLI / 安装失败

- 本包内置 Node.js v24.20.0 LTS、npm 和前端资源。运行 App 本身不需要 npm install。
- 模型 CLI、网络连接、账号和相应服务权限仍是模型调用的前提；本包不赠送模型额度，也不包含制作者的账号。
- 可使用系统 PATH 中的现有 CLI；自定义位置可设置 `CLAUDE_BIN`、`CODEX_BIN`、`AGY_BIN` 后重启。
- Claude Code Windows 安装指南：https://code.claude.com/docs/en/installation
- Codex 官方仓库与 Windows 说明：https://github.com/openai/codex
- Claude 的文件工具可能需要 Git for Windows；若 CLI 提示缺少 shell，请按其官方指引安装。不会自动降低权限或开启自动批准。
- Gemini 使用 **Antigravity 的 agy CLI**，不是同名的其他 Gemini 工具。此预览版没有安装它；只有你已经拥有兼容的 Windows agy 时才尝试。Code 模式的工具授权尚需单独验证。

## 数据与升级

聊天记录、草案、模型设置和项目列表保存在 `%LOCALAPPDATA%\AI Council\data`。
可选安装器把 CLI 放在 `%LOCALAPPDATA%\AI Council\cli`。模型凭据仍由各厂商 CLI 管理。

升级时先退出应用，再将新 ZIP 解压到新目录；用户数据会继续使用，旧目录可以保留备份。
Code 模式按需读取你选择的项目并发送给所选模型服务，草案应用仍需手动批准。

## 验证范围与限制

- 已在 macOS 上执行 JavaScript 检查、模型协议模拟测试、归档检查，以及 Node.js 官方 SHA-256 校验。
- 未在 Windows 真机或虚拟机运行：首次安装、模型 OAuth、Windows 文件工具权限、控制台退出及中文路径仍需朋友试用验收。
- 界面使用系统浏览器，不是独立 Windows 桌面 EXE；双击入口为 CMD，运行时随包附带。
- 未签署 Windows 发布者证书；企业策略可能阻止脚本运行。不要关闭组织的安全策略；可交由管理员审查包内脚本。
- 首版仅 x64；不宣称支持 Windows ARM64。
- 完整 Git Council 自动开发流程不包含在此便携包中；本包提供聊天、计划评审和草案审批。

## 反馈时请提供

Windows 版本、故障步骤、错误文字和 CLI 版本即可。不要发送密码、授权码、token 或聊天数据目录。
