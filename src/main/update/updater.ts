import { app, shell, type BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// ============ 自更新：GitHub Releases 检查 + 人工确认后自动下载安装 ============
// 流程：启动后台静默检查（也可设置页手动查）→ 有新版给横幅提示 → 用户点「更新」→
// App 自己下载对应平台安装包并显示进度 →
//   Windows：直接拉起安装程序（NSIS 覆盖安装后自动重启 App）；
//   macOS：打开下载好的 dmg（App 自行下载的文件没有 quarantine 标记，不会提示"已损坏"），
//          用户把新版拖进"应用程序"替换即可——未签名应用无法做到静默替换，这是最顺的路径。
// 检查走 GitHub 公开 API，无需 token；网络双路回退（系统代理 → 直连），与情报抓取同策略。

const REPO = 'xjwhangdian-ai/company-os-desktop'
// 用 /releases 列表而不是 /releases/latest：后者在 GitHub 侧偶发 Unicorn 5xx（实测持续复现），列表端点稳定
const API_RELEASES = `https://api.github.com/repos/${REPO}/releases?per_page=10`
const UA = 'company-os-desktop-updater'

export interface UpdateInfo {
  hasUpdate: boolean
  current: string
  latest: string
  /** 更新说明（release body 前几行） */
  notes: string
  /** 本平台可用的安装包资产；找不到时为 null（提示去 Releases 页手动下） */
  assetName: string | null
  assetUrl: string | null
  assetSize: number
  releaseUrl: string
  说明: string
}

let routes: { name: string; f: typeof fetch }[] | null = null
async function getRoutes(): Promise<{ name: string; f: typeof fetch }[]> {
  if (routes) return routes
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { net, session } = require('electron') as typeof import('electron')
    const ses = session.fromPartition('updater-direct')
    await ses.setProxy({ proxyRules: 'direct://' })
    routes = [
      { name: '系统代理', f: net.fetch.bind(net) as typeof fetch },
      { name: '直连', f: ses.fetch.bind(ses) as typeof fetch }
    ]
  } catch {
    routes = [{ name: 'node', f: fetch }]
  }
  return routes
}

async function fetchAny(url: string, accept = 'application/vnd.github+json'): Promise<Response> {
  let lastErr: unknown = null
  let last: Response | null = null
  // 仓库已设为 Public：不再携带 GitHub Token（本机残留的过期 Token 反而会让公开端点返回 401）
  const headers: Record<string, string> = { 'User-Agent': UA, Accept: accept }
  for (const r of await getRoutes()) {
    try {
      const resp = await r.f(url, { headers, redirect: 'follow' })
      if (resp.ok) return resp
      last = resp
    } catch (err) {
      lastErr = err
    }
  }
  if (last) return last
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** "v0.1.6" / "0.1.6" → [0,1,6]；比较返回 a>b */
function semverGt(a: string, b: string): boolean {
  const pa = a.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

interface GhAsset {
  name: string
  browser_download_url: string
  /** API 资产地址——私有仓库必须走它 + Accept: octet-stream 才能下载 */
  url: string
  size: number
}

/** 按平台/架构挑安装包：mac 找 .dmg（优先带本机 arch 的），Windows 找 .exe */
function pickAsset(assets: GhAsset[]): GhAsset | null {
  if (process.platform === 'darwin') {
    const dmgs = assets.filter((a) => a.name.toLowerCase().endsWith('.dmg'))
    return dmgs.find((a) => a.name.toLowerCase().includes(process.arch)) ?? dmgs[0] ?? null
  }
  if (process.platform === 'win32') {
    const exes = assets.filter((a) => a.name.toLowerCase().endsWith('.exe'))
    return exes.find((a) => /setup|install/i.test(a.name)) ?? exes[0] ?? null
  }
  return null
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion()
  const base: Omit<UpdateInfo, '说明'> = {
    hasUpdate: false,
    current,
    latest: current,
    notes: '',
    assetName: null,
    assetUrl: null,
    assetSize: 0,
    releaseUrl: `https://github.com/${REPO}/releases/latest`
  }
  try {
    const resp = await fetchAny(API_RELEASES)
    if (!resp.ok) {
      const hint = `检查失败（GitHub 返回 ${resp.status}）——请确认网络可以访问 github.com`
      return { ...base, 说明: hint }
    }
    const list = (await resp.json()) as { tag_name?: string; body?: string; html_url?: string; assets?: GhAsset[]; draft?: boolean; prerelease?: boolean }[]
    const rel = (Array.isArray(list) ? list : []).find((r) => !r.draft && !r.prerelease)
    if (!rel) return { ...base, 说明: '仓库还没有发布正式版本' }
    const latest = String(rel.tag_name ?? '').replace(/^v/i, '')
    if (!latest) return { ...base, 说明: '检查失败（响应缺少版本号）' }
    const hasUpdate = semverGt(latest, current)
    const asset = pickAsset(rel.assets ?? [])
    const notes = String(rel.body ?? '')
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .slice(0, 5)
      .join('\n')
    return {
      ...base,
      hasUpdate,
      latest,
      notes,
      assetName: asset?.name ?? null,
      assetUrl: asset?.browser_download_url ?? null,
      assetSize: asset?.size ?? 0,
      releaseUrl: rel.html_url ?? base.releaseUrl,
      说明: hasUpdate ? `发现新版本 v${latest}（当前 v${current}）` : `已是最新版本（v${current}）`
    }
  } catch (err) {
    return { ...base, 说明: `检查失败：${err instanceof Error ? err.message : String(err)}（网络不可达 GitHub）` }
  }
}

export interface DownloadResult {
  ok: boolean
  path?: string
  说明: string
}

/**
 * 下载并启动安装。进度通过 `update:progress` 事件推给渲染进程（0-100，-1=未知总长）。
 * 下载放系统「下载」文件夹——即使自动启动失败，用户也能自己双击。
 */
export async function downloadAndInstall(win: BrowserWindow | null, info: UpdateInfo): Promise<DownloadResult> {
  if (!info.assetUrl || !info.assetName) {
    await shell.openExternal(info.releaseUrl)
    return { ok: false, 说明: '这次发布没有本平台的安装包，已打开 Releases 页面请手动下载' }
  }
  const dest = join(app.getPath('downloads'), info.assetName)
  try {
    const resp = await fetchAny(info.assetUrl, 'application/octet-stream')
    if (!resp.ok || !resp.body) return { ok: false, 说明: `下载失败（HTTP ${resp.status}），稍后重试或去 Releases 页手动下载` }
    const total = Number(resp.headers.get('content-length') ?? info.assetSize ?? 0)
    let received = 0
    let lastSent = 0
    const progress = new TransformStreamPolyfill((chunk: Uint8Array) => {
      received += chunk.byteLength
      const pct = total > 0 ? Math.round((received / total) * 100) : -1
      if (pct !== lastSent) {
        lastSent = pct
        win?.webContents.send('update:progress', { pct, received, total })
      }
    })
    // web ReadableStream → node stream，边写文件边报进度
    const nodeStream = Readable.fromWeb(resp.body as import('stream/web').ReadableStream, { highWaterMark: 1 << 20 })
    nodeStream.on('data', (chunk: Buffer) => progress.onChunk(chunk))
    await pipeline(nodeStream, createWriteStream(dest))
    if (!existsSync(dest) || statSync(dest).size === 0) return { ok: false, 说明: '下载的文件为空，请重试' }
  } catch (err) {
    return { ok: false, 说明: `下载失败：${err instanceof Error ? err.message : String(err)}` }
  }

  win?.webContents.send('update:progress', { pct: 100, received: 0, total: 0 })

  if (process.platform === 'win32') {
    // NSIS 安装包：拉起后退出当前 App，安装完成自动启动新版
    try {
      const child = spawn(dest, [], { detached: true, stdio: 'ignore' })
      child.unref()
      setTimeout(() => app.quit(), 800)
      return { ok: true, path: dest, 说明: '安装程序已启动，App 即将退出——安装完成后会自动打开新版本' }
    } catch (err) {
      await shell.showItemInFolder(dest)
      return { ok: false, path: dest, 说明: `安装包已下载但自动启动失败（${err instanceof Error ? err.message : err}），请双击安装` }
    }
  }
  // macOS：打开 dmg（App 下载的文件没有 quarantine，不会报"已损坏"），用户拖进"应用程序"替换
  await shell.openPath(dest)
  return {
    ok: true,
    path: dest,
    说明: '新版安装盘已打开：把「Agent工作台」拖进旁边的"应用程序"文件夹替换旧版，然后重新打开 App'
  }
}

/** 极简进度回调包装（避免引 web TransformStream 类型噪音） */
class TransformStreamPolyfill {
  constructor(private cb: (chunk: Uint8Array) => void) {}
  onChunk(chunk: Uint8Array): void {
    this.cb(chunk)
  }
}
