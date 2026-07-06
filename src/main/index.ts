import { app, dialog, net, protocol, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { getCurrentUserName, registerIpcHandlers } from './ipc/handlers'
import { getActiveCompany, getConfig, getLastSyncAt, setLastSyncAt } from './config/store'
import { getSyncStatus, syncNow } from './fs-io/git-sync'

// appfile://：给渲染进程安全加载数据目录内的本地图片（产品图缩略图等）。
// 开发模式页面是 http://localhost，直接 <img src="file://..."> 会被 Chromium 拦，
// 自定义协议在 dev/打包两种模式下行为一致。secure:true 必须在 app ready 前注册。
protocol.registerSchemesAsPrivileged([
  { scheme: 'appfile', privileges: { secure: true, stream: true } }
])

let mainWindow: BrowserWindow | null = null
/** 关闭前同步提示的重入保护：用户已做出选择后放行本次关闭 */
let closeApproved = false

function isSameDay(ts: number | null): boolean {
  if (!ts) return false
  const a = new Date(ts)
  const b = new Date()
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * 每天关闭前的同步提示：当前公司有 git 远程、且（今天还没同步过 或 有未同步的本地改动）时，
 * 弹一次三选框。同步失败不拦着退出——把失败信息展示后仍然放行（不能把用户锁在 App 里）。
 */
async function confirmCloseWithSync(win: BrowserWindow): Promise<void> {
  const company = getActiveCompany()
  if (!company?.dataDir) {
    closeApproved = true
    win.close()
    return
  }
  try {
    const status = await getSyncStatus(company.dataDir)
    const syncedToday = isSameDay(getLastSyncAt(company.id))
    const needsPrompt = status.isRepo && status.hasRemote && (!syncedToday || status.dirtyCount > 0 || status.ahead > 0)
    if (!needsPrompt) {
      closeApproved = true
      win.close()
      return
    }
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['☁️ 同步后退出', '直接退出', '取消'],
      defaultId: 0,
      cancelId: 2,
      title: '关闭前同步',
      message: `「${company.name}」今天还有改动没同步`,
      detail: status.dirtyCount > 0 ? `本地有 ${status.dirtyCount} 处改动未同步。` : '今天还没同步过。'
    })
    if (response === 2) return
    if (response === 0) {
      const result = await syncNow(company.dataDir, getCurrentUserName() || '未署名')
      if (result.ok) {
        setLastSyncAt(company.id)
      } else {
        await dialog.showMessageBox(win, {
          type: 'warning',
          buttons: ['仍然退出'],
          title: '同步未成功',
          message: '同步失败，本次先退出（数据都在本机，不会丢）',
          detail: result.message
        })
      }
    }
    closeApproved = true
    win.close()
  } catch {
    closeApproved = true
    win.close()
  }
}

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

  // 每天关闭前提示同步（用户选择后放行；重入保护避免死循环）
  mainWindow.on('close', (e) => {
    if (closeApproved) {
      closeApproved = false
      return
    }
    e.preventDefault()
    if (mainWindow) void confirmCloseWithSync(mainWindow)
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
