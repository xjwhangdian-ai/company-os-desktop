!include "LogicLib.nsh"

!macro customInstall
  DetailPrint "正在检查 Agent 工作台本机运行环境…"

  ; Python：已有则跳过；缺失才运行安装包内置静默安装器。
  nsExec::ExecToStack '"$SYSDIR\cmd.exe" /C "where python >nul 2>nul"'
  Pop $0
  ${If} $0 != 0
    DetailPrint "正在安装内置 Python…"
    ExecWait '"$INSTDIR\resources\windows-deps\python-installer.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0' $0
  ${EndIf}

  ; Tesseract（发票识别必选环境）：已有则跳过，缺失时由安装包自动部署。
  nsExec::ExecToStack '"$SYSDIR\cmd.exe" /C "where tesseract >nul 2>nul"'
  Pop $0
  ${If} $0 != 0
    DetailPrint "正在安装内置 OCR 引擎…"
    ExecWait '"$INSTDIR\resources\windows-deps\tesseract-installer.exe" /S' $0
  ${EndIf}

  ; Poppler 仅解压到当前用户运行时目录，不改动系统已有组件。
  nsExec::ExecToStack '"$SYSDIR\cmd.exe" /C "where pdftoppm >nul 2>nul"'
  Pop $0
  ${If} $0 != 0
    DetailPrint "正在部署内置 PDF 渲染组件…"
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath ''$INSTDIR\resources\windows-deps\poppler.zip'' -DestinationPath ''$APPDATA\Agent工作台\runtime\poppler'' -Force"'
  ${EndIf}

  ; 统一写入当前用户 PATH：Python、OCR 与解压后的 Poppler 都可被桌面程序直接找到。
  ; PowerShell 变量以 $$ 转义，避免被 NSIS 当成安装器变量展开。
  DetailPrint "正在自动配置本机环境变量…"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$$paths=@(''$LOCALAPPDATA\Programs\Python\Python312'',''$LOCALAPPDATA\Programs\Python\Python312\Scripts'',''$PROGRAMFILES\Tesseract-OCR''); $$root=''$APPDATA\Agent工作台\runtime\poppler''; if(Test-Path -LiteralPath $$root){$$pdf=Get-ChildItem -LiteralPath $$root -Filter pdftoppm.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1; if($$pdf){$$paths += $$pdf.DirectoryName}}; $$current=[Environment]::GetEnvironmentVariable(''Path'',''User''); foreach($$p in $$paths){if((Test-Path -LiteralPath $$p) -and (($$current -split '';'' | Where-Object { $$_ -eq $$p }).Count -eq 0)){$$current=if([string]::IsNullOrWhiteSpace($$current)){$$p}else{$$current+'';''+$$p}}}; [Environment]::SetEnvironmentVariable(''Path'',$$current,''User')"'
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000

  ; Python wheels：即使 Python 已有也可离线补齐，失败不阻止主程序安装。
  DetailPrint "正在安装离线 Python 依赖库…"
  nsExec::ExecToLog '"$SYSDIR\cmd.exe" /C "py -3 -m pip install --user --no-index --find-links=\"$INSTDIR\resources\windows-deps\wheels\" pypdf pillow numpy openpyxl pytesseract"'

  ; 创建快捷方式前确认 x64 主程序确实落地。若安装文件缺失或被安全软件隔离，
  ; 直接终止并给出可执行的处理建议，避免留下指向不存在文件的快捷方式。
  ${IfNot} ${FileExists} "$INSTDIR\AgentWorkbench.exe"
    MessageBox MB_ICONSTOP|MB_OK "Agent 工作台主程序安装失败。请检查 Windows 安全中心的‘保护历史记录’，确认是否拦截了 AgentWorkbench.exe；恢复后重新运行安装程序。"
    Abort
  ${EndIf}
  DetailPrint "环境检查完成，所需路径已自动加入当前用户 PATH。"
!macroend
