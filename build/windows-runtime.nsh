!include "LogicLib.nsh"

!macro customInstall
  ; One embedded offline script handles install, repair, package imports and PATH.
  ; It targets the bundled Python 3.12 path and does not select an arbitrary
  ; Python that happened to be installed on the member's computer.
  DetailPrint "正在部署内置 Python、OCR 和 PDF 运行环境…"
  ${IfNot} ${FileExists} "$INSTDIR\resources\windows-deps\repair-runtime.bat"
    MessageBox MB_ICONSTOP|MB_OK "安装包缺少 Windows 运行环境文件，请重新下载安装包。"
    Abort
  ${EndIf}
  ExecWait '"$SYSDIR\cmd.exe" /C ""$INSTDIR\resources\windows-deps\repair-runtime.bat""' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "Windows 运行环境未能完整安装（错误代码：$0）。请重新运行安装包；安装完成前不会创建不可用的工作台快捷方式。"
    Abort
  ${EndIf}
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000

  ; 创建快捷方式前确认 x64 主程序确实落地。若安装文件缺失或被安全软件隔离，
  ; 直接终止并给出可执行的处理建议，避免留下指向不存在文件的快捷方式。
  ${IfNot} ${FileExists} "$INSTDIR\AgentWorkbench.exe"
    MessageBox MB_ICONSTOP|MB_OK "Agent 工作台主程序安装失败。请检查 Windows 安全中心的‘保护历史记录’，确认是否拦截了 AgentWorkbench.exe；恢复后重新运行安装程序。"
    Abort
  ${EndIf}
  DetailPrint "环境检查完成，所需路径已自动加入当前用户 PATH。"
!macroend
