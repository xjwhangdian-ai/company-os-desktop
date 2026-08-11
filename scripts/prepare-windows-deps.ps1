$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$deps = Join-Path $root 'resources\windows-deps'
$wheels = Join-Path $deps 'wheels'
New-Item -ItemType Directory -Force -Path $wheels | Out-Null

# 固定经验证的 Python 3.12 x64 安装器，避免 Windows 终端用户通过 winget/商店联网下载。
$python = Join-Path $deps 'python-installer.exe'
if (!(Test-Path $python)) {
  Invoke-WebRequest 'https://www.python.org/ftp/python/3.12.6/python-3.12.6-amd64.exe' -OutFile $python
}

# winget download 只在 CI 构建机执行；最终用户拿到的是已嵌入 NSIS 的离线文件。
function Get-WingetPackage($id, $pattern, $target) {
  if (Test-Path $target) { return }
  $staging = Join-Path $env:TEMP ("agent-workbench-" + $id.Replace('.', '-'))
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $staging | Out-Null
  winget download --id $id --exact --source winget --download-directory $staging --accept-package-agreements --accept-source-agreements
  $source = Get-ChildItem $staging -Recurse -File | Where-Object { $_.Name -match $pattern } | Select-Object -First 1
  if (!$source) { throw "未找到 $id 的离线安装文件" }
  Copy-Item $source.FullName $target -Force
}

Get-WingetPackage 'UB-Mannheim.TesseractOCR' '\.exe$' (Join-Path $deps 'tesseract-installer.exe')
Get-WingetPackage 'oschwartz10612.Poppler' '\.zip$' (Join-Path $deps 'poppler.zip')

# 在 Windows 上下载匹配 ABI 的 wheels，安装阶段完全离线。
$pythonForWheels = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
if (!(Test-Path $pythonForWheels)) {
  Start-Process -FilePath $python -ArgumentList '/quiet InstallAllUsers=0 PrependPath=0 Include_test=0' -Wait
}
& $pythonForWheels -m pip download --only-binary=:all: --dest $wheels pypdf pillow numpy openpyxl pytesseract
