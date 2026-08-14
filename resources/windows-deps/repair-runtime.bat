@echo off
setlocal EnableExtensions

rem This script is embedded in every Windows installer. It intentionally uses
rem only the adjacent offline payload, so repairing an installation never needs
rem winget, an administrator, or an Internet connection.
set "RUNTIME_ROOT=%~dp0"
set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
set "TESSERACT_ROOT=%APPDATA%\AgentWorkbench\runtime\tesseract"
set "TESSERACT_EXE=%TESSERACT_ROOT%\tesseract.exe"
set "POPLER_ROOT=%APPDATA%\AgentWorkbench\runtime\poppler"

if not exist "%RUNTIME_ROOT%python-installer.exe" goto :missing_payload
if not exist "%RUNTIME_ROOT%tesseract\tesseract.exe" goto :missing_payload
if not exist "%RUNTIME_ROOT%poppler.zip" goto :missing_payload
if not exist "%RUNTIME_ROOT%wheels" goto :missing_payload

if not exist "%PYTHON_EXE%" (
  "%RUNTIME_ROOT%python-installer.exe" /quiet InstallAllUsers=0 PrependPath=0 Include_test=0
  if errorlevel 1 goto :install_failed
)
if not exist "%PYTHON_EXE%" goto :install_failed

robocopy "%RUNTIME_ROOT%tesseract" "%TESSERACT_ROOT%" /E /NFL /NDL /NJH /NJS >nul
if errorlevel 8 goto :install_failed
if not exist "%TESSERACT_EXE%" goto :install_failed

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath '%RUNTIME_ROOT%poppler.zip' -DestinationPath '%POPLER_ROOT%' -Force; if (-not (Get-ChildItem -LiteralPath '%POPLER_ROOT%' -Filter pdftoppm.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1)) { exit 1 }"
if errorlevel 1 goto :install_failed

"%PYTHON_EXE%" -m pip install --user --no-index --find-links "%RUNTIME_ROOT%wheels" pypdf==6.15.0 pillow==12.3.0 numpy==2.5.2 openpyxl==3.1.5 pytesseract==0.3.13
if errorlevel 1 goto :install_failed
"%PYTHON_EXE%" -c "import pypdf,PIL,numpy,openpyxl,pytesseract"
if errorlevel 1 goto :install_failed

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$paths=@('%LOCALAPPDATA%\Programs\Python\Python312','%LOCALAPPDATA%\Programs\Python\Python312\Scripts','%TESSERACT_ROOT%'); $pdf=Get-ChildItem -LiteralPath '%POPLER_ROOT%' -Filter pdftoppm.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1; if($pdf){$paths += $pdf.DirectoryName}; $current=[Environment]::GetEnvironmentVariable('Path','User'); foreach($p in $paths){if((Test-Path -LiteralPath $p) -and (($current -split ';' | Where-Object { $_ -eq $p }).Count -eq 0)){$current=if([string]::IsNullOrWhiteSpace($current)){$p}else{$current+';'+$p}}}; [Environment]::SetEnvironmentVariable('Path',$current,'User')"
if errorlevel 1 goto :install_failed

exit /b 0

:missing_payload
echo Required offline runtime files are missing from this installer.
exit /b 2

:install_failed
echo Windows runtime installation did not complete successfully.
exit /b 1
