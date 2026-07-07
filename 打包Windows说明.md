# 打 Windows 安装包（在一台 Windows 电脑上）

这台开发机是 arm64 Mac，本地直接打 Windows 包需要 wine（在 arm64 上很不稳定），所以
**Windows 安装包统一在一台 Windows 电脑上出**。已经把图标与配置备好，Windows 侧只需三步。

## 前置（Windows 电脑一次性装好）
- Node.js 20+（含 npm）：https://nodejs.org/ 下 LTS 安装包
- Git：https://git-scm.com/
- 网络能装 npm 依赖（首次会下载 Electron，约 100MB+）

## 三步出包
```powershell
# 1) 拉代码（已 push 到 GitHub 私有仓库 xjwhangdian-ai/company-os-desktop）
git clone https://github.com/xjwhangdian-ai/company-os-desktop.git
cd company-os-desktop

# 2) 装依赖
npm install

# 3) 打包（自动 electron-vite build + electron-builder --win nsis）
npm run build:win
```
产物在 `dist\` 下：`炬视数字人分身工作台 Setup <版本>.exe`（NSIS 安装程序，可自选安装目录）。

## 说明
- 图标：electron-builder 会自动从 `build/icon.png`（1024×1024）生成 Windows `.ico`，无需手动准备 .ico。
- 安装器配置在 `electron-builder.yml`（`win.target: nsis`、`oneClick: false`、可改安装目录）。
- 安装包**未做代码签名**，Windows SmartScreen 首次运行会提示"未知发布者"，点"更多信息 → 仍要运行"即可。要去掉提示需购买代码签名证书，后续再说。
- 数据目录：App 首次启动在"设置 → 数据目录"里选公司数据仓库（company-os）位置；配置不随安装包走，每台机器各自设。
- 员工机器若连不上 GitHub，clone 改用管理员机的局域网裸仓库或 Gitee（见 SETUP.md）。
