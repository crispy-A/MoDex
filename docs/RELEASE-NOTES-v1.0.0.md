# MoDex v1.0.0

轻量化 Markdown 桌面编辑器首个公开版本：本地优先、无需账号、渲染层零构建。

## 功能

- **Codex 风格单条 40px 导航栏**：文件/编辑/视图/帮助 自绘菜单 + 视图切换 + 主题，保留原生快捷键。
- **Markdown 编辑与实时预览**：标题/列表/任务列表/表格/引用/代码块/图片/链接、标题锚点、滚动同步。
- **多文件夹工作区**：同时打开多个文件夹、各自监听外部变更、启动恢复。
- **7 套预览样式**：Codex 极简 / GitHub / Vue / Notion / 飞书 / Tailwind Typography / 报刊衬线，深浅主题各自适配。
- **自动保存**：切换文件 / 新建 / 关闭文档 / 关闭软件时自动保存，关闭软件不再弹保存询问。
- **AI 写作助手（可选）**：右侧对话面板，DeepSeek Responses API（deepseek-flash / deepseek-v4-pro），流式回答、思考折叠、停止/重试、当前文档上下文、本地会话历史；API Key 用系统密钥环加密，仅主进程使用。
- **克制的微动效**：菜单/面板/消息出现、侧栏与 AI 面板开合过渡，`prefers-reduced-motion` 自动降级。
- **品牌 Logo**：暗色圆角磁贴 + 暖白 M + 石板蓝输入光标，接入窗口/任务栏/exe/安装包/快捷方式。

## 下载

- `MoDex-1.0.0-setup.exe`：Windows 安装包（Inno Setup，按用户安装、无需管理员、中文向导）。
- `MoDex-1.0.0-win32-x64-portable.zip`：绿色便携版，解压后运行 `MoDex.exe`。
- 两个 `.sha256` 文件用于校验下载内容。

## 说明

- 安装包未做代码签名，首次运行 SmartScreen 可能提示「未知发布者」。
- 安装/卸载保留用户数据 `%APPDATA%\MoDex`（设置、AI 历史、加密后的 API Key）。
- 系统要求：Windows 10/11 x64；AI 功能需自备 DeepSeek API Key，未配置时应用完全离线可用。

## 校验

```
3e13c845b82a3a938cbbaec33835f1144d624fcabd7790e1349d25382ed55270  MoDex-1.0.0-setup.exe
9361c1b3a9f4f7f2df49644e7df1a8fa0960347f4eff552e86047592ad84bc1a  MoDex-1.0.0-win32-x64-portable.zip
```
