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

  ; Tesseract：已有则跳过。
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

  ; Python wheels：即使 Python 已有也可离线补齐，失败不阻止主程序安装。
  DetailPrint "正在安装离线 Python 依赖库…"
  nsExec::ExecToLog '"$SYSDIR\cmd.exe" /C "py -3 -m pip install --user --no-index --find-links=\"$INSTDIR\resources\windows-deps\wheels\" pypdf pillow numpy openpyxl pytesseract"'
  DetailPrint "环境检查完成。首次启动后可在“本机环境”重新检测。"
!macroend
