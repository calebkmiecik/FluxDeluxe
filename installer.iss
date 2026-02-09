; Inno Setup script for FluxDeluxe
; Download Inno Setup 6 from: https://jrsoftware.org/isdl.php
;
; This script packages the dist/FluxDeluxe/ folder into a single installer exe.
; Run via: ISCC.exe installer.iss
; Or let build.py invoke it automatically.

#define MyAppName "FluxDeluxe"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Axioforce"
#define MyAppExeName "FluxDeluxe.exe"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
OutputDir=output
OutputBaseFilename=FluxDeluxe_Setup_v{#MyAppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
; Uncomment the next line if you have an .ico file:
; SetupIconFile=fluxdeluxe\ui\assets\icons\fluxliteicon.ico

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Include the entire dist/FluxDeluxe folder
Source: "dist\FluxDeluxe\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent
