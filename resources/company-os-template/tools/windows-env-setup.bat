@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Agent工作台 - Windows 本机环境安装

echo.
echo ==================================================
echo   Agent工作台 Windows 本机环境一键安装
echo   将安装 Python、Poppler、Tesseract 及 Python 依赖
echo ==================================================
echo.

where winget >nul 2>nul
if errorlevel 1 (
  echo 未找到 Windows App Installer（winget）。
  echo 请先在 Microsoft Store 安装“App Installer”，然后重新运行本脚本。
  pause
  exit /b 1
)

echo [1/4] 安装 Python 3...
winget install --id Python.Python.3.12 -e --source winget --accept-package-agreements --accept-source-agreements

echo [2/4] 安装 Poppler（PDF 渲染）...
winget install --id oschwartz10612.Poppler -e --source winget --accept-package-agreements --accept-source-agreements

echo [3/4] 安装 Tesseract OCR（发票识别）...
winget install --id UB-Mannheim.TesseractOCR -e --source winget --accept-package-agreements --accept-source-agreements

echo [4/4] 安装 Python 依赖库...
py -3 -m pip install --user pypdf pillow numpy openpyxl pytesseract

echo.
echo 安装命令已执行完成。请关闭本窗口，完全退出并重新打开 Agent工作台，
echo 再进入“本机环境”点击“重新检测”。如有单项失败，请将本窗口截图发给管理员。
pause
