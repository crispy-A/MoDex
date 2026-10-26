; ============================================================================
; MoDex 安装包脚本（Inno Setup 6）
; 构建：npm run installer（scripts/installer.mjs 会自动先执行 npm run package）
; 产物：release/MoDex-<version>-setup.exe
;
; 说明：
; - 按用户安装（PrivilegesRequired=lowest）：默认安装到 %LOCALAPPDATA%\Programs\MoDex，无需管理员
; - 安装后创建开始菜单/桌面快捷方式，提供标准卸载程序（unins000.exe）
; - 卸载只删除程序文件，保留 %APPDATA%\MoDex（设置、AI 会话与加密后的 API Key）
; - 未做代码签名：首次运行 SmartScreen 可能提示"未知发布者"
; ============================================================================

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\release\MoDex-1.0.0-win32-x64"
#endif
#ifndef OutputDir
  #define OutputDir "..\release"
#endif

#define AppName "MoDex"
#define AppPublisher "crispy-A"
#define AppURL "https://github.com/crispy-A/MoDex"
#define AppExeName "MoDex.exe"

[Setup]
AppId={{1A410687-CD96-40EB-93FE-B93A28544FAB}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
VersionInfoVersion={#AppVersion}.0
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppName} 安装程序
VersionInfoProductName={#AppName}

; 按用户安装，无需管理员权限
DefaultDirName={localappdata}\Programs\MoDex
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0

; 输出
OutputDir={#OutputDir}
OutputBaseFilename=MoDex-{#AppVersion}-setup
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
UsePreviousAppDir=yes

#ifdef ChineseIsl
[Languages]
Name: "chinesesimplified"; MessagesFile: "{#ChineseIsl}"
#else
[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
#endif

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\{#AppExeName}"; Comment: "轻量化 Markdown 编辑器"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; 卸载前尝试关闭正在运行的 MoDex（静默失败即可）
Filename: "{cmd}"; Parameters: "/c taskkill /IM {#AppExeName} /F"; Flags: runhidden; RunOnceId: "KillMoDex"
