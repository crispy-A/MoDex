# MoDex Windows 安装包

> 除了绿色便携版，MoDex 现在可以生成标准 Windows 安装包（Inno Setup）。
> 构建产物：`release/MoDex-<version>-setup.exe`（本版本 **98.2 MB**，含 MoDex Logo）。
> **分发方式**：安装包与便携版通过 GitHub Releases 发布（仓库不提交二进制）；本版本 Release：<https://github.com/crispy-A/MoDex/releases/tag/v1.0.0>。

![安装向导](installer/installer-wizard.png)

## 下载（GitHub Releases）

- 安装包：`MoDex-1.0.0-setup.exe`（98.2 MB，SHA256 `3e13c845b82a3a938cbbaec33835f1144d624fcabd7790e1349d25382ed55270`）
- 便携版压缩包：`MoDex-1.0.0-win32-x64-portable.zip`（130.8 MB，SHA256 `9361c1b3a9f4f7f2df49644e7df1a8fa0960347f4eff552e86047592ad84bc1a`）
- 校验文件：两个 `.sha256` 与资产同页提供。

## 构建

前置要求：Node.js 24+；构建机安装 [Inno Setup 6](https://jrsoftware.org/isinfo.php)（仅构建需要，应用本身不依赖）。

```powershell
winget install JRSoftware.InnoSetup     # 首次安装构建工具
cd md-editor
npm run installer                       # 先打包便携版，再生成安装包
npm run installer -- --skip-package     # 复用已有 portable 产物，快速重打安装包
```

- 安装包：`release/MoDex-1.0.0-setup.exe`
- 安装脚本：`installer/MoDex.iss`；构建脚本：`scripts/installer.mjs`
- 中文安装界面：`installer/ChineseSimplified.isl`（Inno Setup 6.5+ 官方中文语言文件）
- 若 `ISCC.exe` 不在默认路径，可设置环境变量 `INNO_SETUP_ISCC` 指向它。

## 安装行为

| 项目 | 行为 |
| --- | --- |
| 安装范围 | **按用户安装**，默认目录 `%LOCALAPPDATA%\Programs\MoDex`，**不需要管理员权限**（安装页可改目录） |
| 快捷方式 | 开始菜单「MoDex」；桌面快捷方式（可在安装页取消勾选） |
| 卸载 | 标准卸载程序 `unins000.exe`，控制面板「应用和功能」可见「MoDex 1.0.0」；卸载前会尝试关闭正在运行的 MoDex |
| 升级 | 固定 AppId 覆盖安装/升级，保留原有安装目录与设置 |
| 用户数据 | **卸载不删除** `%APPDATA%\MoDex`（设置、AI 会话、加密后的 API Key），重装后自动恢复 |
| 运行 | 安装完成页可直接启动；静默安装不自动启动 |

安装包内为完整应用（Electron 运行时 + `resources/app`），安装后目录约 338.8 MB、150 个文件；安装需要约 339 MB 磁盘空间。

## 验证记录（本版本实测）

- 静默安装：`MoDex-1.0.0-setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR=<临时目录>` → 退出码 0；
  exe、`resources/app/src/main/ai/ai-service.js`、`unins000.exe` 均存在；开始菜单与桌面快捷方式创建成功；
  HKCU 卸载注册项 `DisplayName=MoDex / DisplayVersion=1.0.0` 正确。
- **用已安装的 exe 跑完整两阶段 smoke**：`npm run smoke -- --app "<安装目录>\MoDex.exe"` → **141/141 + 阶段二通过**（与便携版一致）。
- 静默卸载：退出码 0；安装目录、开始菜单/桌面快捷方式、卸载注册项全部清理干净；`%APPDATA%\MoDex` 用户数据保留。
- 安装包 SHA256（本版本）：`3e13c845b82a3a938cbbaec33835f1144d624fcabd7790e1349d25382ed55270`
- 独立 QA 验收（报告 §19）已通过：安装/卸载/快捷方式/注册项/用户数据保留全部符合预期，安装后 exe 两阶段 smoke 141/141，
  `npm run installer -- --skip-package` 重建产物 SHA256 一致（可复现构建）。

## 注意

- 安装包**未做代码签名**：首次运行时 Windows SmartScreen 可能提示「未知发布者」，选择「更多信息 → 仍要运行」即可；
  如需消除提示，可购买代码签名证书后用 `signtool` 对 `MoDex-*.exe` 与安装包签名。
- 便携版与安装版可共存，但共用 `%APPDATA%\MoDex` 用户数据；建议二选一使用。
- 卸载保留用户数据是刻意设计（避免误删 AI Key / 会话）；彻底清理需手动删除 `%APPDATA%\MoDex`。



