// afterPack：mac 包整体 ad-hoc 签名。
// 没有 Apple 开发者证书时 electron-builder 会跳过签名，产物只剩主可执行文件的
// linker 残缺签名（资源清单缺失）——下载后 Gatekeeper 校验失败直接报「已损坏」。
// 这里用 codesign -s -（ad-hoc）对整个 .app 深度重签：仍无法公证，但签名完整合法，
// 首次打开从「已损坏」降级为「无法验证开发者」，右键-打开 或 系统设置里「仍要打开」即可运行。
const { execSync } = require('child_process')
const path = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' })
  execSync(`codesign --verify --deep --strict "${appPath}"`, { stdio: 'inherit' })
  console.log('  • ad-hoc signed', appPath)
}
