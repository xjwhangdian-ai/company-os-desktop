import { app, net, protocol, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc/handlers'
import { getConfig } from './config/store'

// appfile://：给渲染进程安全加载数据目录内的本地图片（产品图缩略图等）。
// 开发模式页面是 http://localhost，直接 <img src="file://..."> 会被 Chromium 拦，
// 自定义协议在 dev/打包两种模式下行为一致。secure:true 必须在 app ready 前注册。
protocol.registerSchemesAsPrivileged([
  { scheme: 'appfile', privileges: { secure: true, stream: true } }
])

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.jushi.company-os-desktop')

  // 只放行各公司数据目录内的文件——appfile 不是通用本地文件读取口
  protocol.handle('appfile', (request) => {
    const filePath = decodeURIComponent(new URL(request.url).pathname)
    const allowed = getConfig().companies.some((c) => c.dataDir && filePath.startsWith(c.dataDir + '/'))
    if (!allowed) return new Response('forbidden', { status: 403 })
    return net.fetch(pathToFileURL(filePath).toString())
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers(() => mainWindow)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
