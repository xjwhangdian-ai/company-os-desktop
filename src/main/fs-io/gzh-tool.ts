import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { BrowserWindow } from 'electron'

const execFileAsync = promisify(execFile)

export type GzhTheme = '炬视' | '瑾智'

/**
 * 公众号排版是 CLAUDE.md 里明确标注的例外：不经过 AI，纯脚本调用
 * tools/gzh/gzh_style.js。产出 HTML 放在与输入 md 同一个文件夹。
 * theme 选风格（炬视/瑾智），透传给脚本第 4 参数（themes/<品牌>.js）。
 */
export async function runGzhStyle(dataDir: string, inputMdPath: string, theme?: GzhTheme): Promise<string> {
  const scriptPath = join(dataDir, 'tools', 'gzh', 'gzh_style.js')
  if (!existsSync(scriptPath)) {
    throw new Error('未找到 tools/gzh/gzh_style.js，请确认数据目录是否是完整的 company-os 仓库')
  }
  const outputPath = inputMdPath.replace(/\.md$/i, '') + '_排版预览.html'
  const args = [scriptPath, inputMdPath, outputPath]
  if (theme) args.push(theme)
  // 用 App 自带的 Electron 运行时充当 Node（ELECTRON_RUN_AS_NODE），
  // Windows 成员机无需另装 Node.js 也能跑排版脚本；mac/win 通用。
  await execFileAsync(process.execPath, args, {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  return outputPath
}

// ============ 公众号封面首图生成 ============
// 封面走 Electron 离屏窗口渲染 HTML→PNG（纯脚本 node 渲不了图），按所选品牌风格。

interface CoverBrand {
  navy: string
  deep: string
  accent: string
  accent2: string
  name: string
  short: string
  en: string
  slogan: string
}

const COVER_BRANDS: Record<GzhTheme, CoverBrand> = {
  炬视: {
    navy: '#142E4C',
    deep: '#0A1626',
    accent: '#F39A0E',
    accent2: '#149AAE',
    name: '台州炬视科技',
    short: '炬视',
    en: 'JUSIGHT',
    slogan: '具身智能 · 视检万物'
  },
  瑾智: {
    navy: '#0D1B33',
    deep: '#060E1C',
    accent: '#C7A24E',
    accent2: '#1E3C6E',
    name: '台州瑾智安防',
    short: '瑾智',
    en: 'JINZHI SECURITY',
    slogan: '警用装备，瑾智都有'
  }
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 从 md 取第一个 # 标题作为封面主标题；取不到用文件名 */
function coverTitle(mdPath: string): string {
  try {
    const text = readFileSync(mdPath, 'utf-8')
    for (const line of text.split('\n')) {
      const m = /^#\s+(.+)$/.exec(line.trim())
      if (m) return m[1].replace(/\*\*/g, '').replace(/[#*`>]/g, '').trim()
    }
  } catch {
    /* ignore */
  }
  return basename(mdPath).replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}_/, '')
}

/** 按标题长度选字号（banner 横版 / square 方版分别给系数） */
function titleFont(title: string, square: boolean): number {
  const n = [...title].length
  const base = square ? 46 : 52
  if (n <= 10) return base
  if (n <= 16) return base - 8
  if (n <= 24) return base - 16
  return base - 22
}

function coverHtml(brand: CoverBrand, title: string, w: number, h: number, square: boolean): string {
  const pad = square ? 46 : 52
  const tf = titleFont(title, square)
  const FONT =
    "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei','Helvetica Neue',sans-serif"
  return `<div style="width:${w}px;height:${h}px;position:relative;overflow:hidden;box-sizing:border-box;
    background:linear-gradient(135deg,${brand.navy} 0%,${brand.deep} 100%);font-family:${FONT};">
    <div style="position:absolute;right:-90px;top:-90px;width:340px;height:340px;border-radius:50%;
      background:radial-gradient(circle,${brand.accent}44,transparent 68%);"></div>
    <div style="position:absolute;left:-70px;bottom:-70px;width:260px;height:260px;border-radius:50%;
      background:radial-gradient(circle,${brand.accent2}33,transparent 70%);"></div>
    <div style="position:absolute;inset:0;padding:${pad}px;display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box;">
      <div style="display:flex;align-items:center;gap:11px;">
        <span style="display:inline-block;width:30px;height:6px;border-radius:3px;background:${brand.accent};"></span>
        <span style="color:${brand.accent};font-size:${square ? 19 : 20}px;font-weight:700;letter-spacing:1.5px;">${esc(brand.short)} · ${esc(brand.en)}</span>
      </div>
      <div style="color:#ffffff;font-size:${tf}px;font-weight:800;line-height:1.3;letter-spacing:1px;
        text-shadow:0 2px 12px rgba(0,0,0,.25);max-width:100%;">${esc(title)}</div>
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:14px;">
        <span style="color:${brand.accent};font-size:${square ? 17 : 18}px;font-weight:600;letter-spacing:.5px;">${esc(brand.slogan)}</span>
        <span style="color:#c9d3de;font-size:${square ? 15 : 16}px;white-space:nowrap;">${esc(brand.name)}</span>
      </div>
    </div>
  </div>`
}

async function renderPng(html: string, w: number, h: number, outPath: string): Promise<void> {
  const win = new BrowserWindow({
    width: w,
    height: h,
    show: false,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: false }
  })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    // 给字体/布局一点结算时间，避免截到空白
    await new Promise((r) => setTimeout(r, 150))
    const img = await win.capturePage()
    const norm = img.resize({ width: w, height: h })
    writeFileSync(outPath, norm.toPNG())
  } finally {
    win.destroy()
  }
}

export interface CoverResult {
  banner: string
  square: string
  title: string
  theme: GzhTheme
}

/**
 * 生成两张封面：横版 900×383（公众号首图 2.35:1）+ 方版 500×500（朋友圈/小图）。
 * 标题取自 md 的一级标题；风格按 theme。产出与 md 同目录。
 */
export async function generateGzhCover(mdPath: string, theme: GzhTheme): Promise<CoverResult> {
  const brand = COVER_BRANDS[theme] ?? COVER_BRANDS['炬视']
  const title = coverTitle(mdPath)
  const stem = mdPath.replace(/\.md$/i, '')
  const banner = `${stem}_封面_${theme}_横版900x383.png`
  const square = `${stem}_封面_${theme}_方版500x500.png`
  await renderPng(coverHtml(brand, title, 900, 383, false), 900, 383, banner)
  await renderPng(coverHtml(brand, title, 500, 500, true), 500, 500, square)
  return { banner, square, title, theme }
}
