import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { augmentedPath, resolvePython } from './env-check'
import { spawn } from 'node:child_process'

// ============ 产品画册 PDF → 抽图 + 文本提取（销售分身用）============
// 机械管线（不经过 AI）：调数据仓库的 tools/pdf-catalog/catalog_extract.py，
// 把画册每个产品照单独抠出、逐页文本提取、生成带编号的标注图供人工/分身核对配图。
// 高精度"图文配对"仍需 sales 分身照标注图逐页核对（版式各异，机械无法保证）——见 sales.md 配图铁律。

export interface PdfCatalogResult {
  ok: boolean
  pages?: number
  crops?: number
  /** 机械自动配对出的产品条目数（文本层/OCR 标题 ↔ 候选图） */
  autoPaired?: number
  /** true=没识别到任何标题（纯扫描且无 OCR），兜底导出全部候选、名称留空 */
  degraded?: boolean
  /** 本次用了系统 OCR（扫描版画册，名称可能有个别识别误差） */
  usedOcr?: boolean
  outDir?: string
  说明: string
}

const isWin = process.platform === 'win32'

const INSTALL_HINT = isWin
  ? '本机没有可用的 Python——请安装 python.org 的 Python 3 并勾选 Add to PATH，再执行 pip install pypdf pillow numpy 后重试'
  : '本机没有可用的 python3——终端执行 xcode-select --install（或 brew install python3），再 pip3 install pypdf pillow numpy 后重试'

/**
 * 抽取产品画册：pdfFileName 为 inbox/01_销售_sales/供应商资料/ 下的 PDF 文件名。
 * 产出到同目录的 {pdf名}_画册抽取/（产品图候选/ + 文本提取.md + _标注/ + _整页/）。
 * 跨平台：mac / Windows 都尝试本机 Python；没装或缺依赖时给出对应平台的安装指引。
 */
export function extractPdfCatalog(dataDir: string, pdfFileName: string): Promise<PdfCatalogResult> {
  const supplierDir = join(dataDir, 'inbox', '01_销售_sales', '供应商资料')
  const pdf = join(supplierDir, pdfFileName)
  if (!existsSync(pdf)) {
    return Promise.resolve({ ok: false, 说明: `找不到 PDF：${pdfFileName}（应在 inbox/01_销售_sales/供应商资料/ 下）` })
  }
  const script = join(dataDir, 'tools', 'pdf-catalog', 'catalog_extract.py')
  if (!existsSync(script)) {
    return Promise.resolve({ ok: false, 说明: '抽图脚本不存在（tools/pdf-catalog 未同步到数据目录）' })
  }
  const python = resolvePython()
  if (!python) {
    return Promise.resolve({ ok: false, 说明: INSTALL_HINT })
  }
  const stem = basename(pdfFileName).replace(/\.[^.]+$/, '')
  const outDir = join(supplierDir, `${stem}_画册抽取`)
  mkdirSync(outDir, { recursive: true })

  return new Promise((resolve) => {
    const child = spawn(python, [script, pdf, outDir], { windowsHide: true, env: { ...process.env, PATH: augmentedPath() } })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ ok: false, outDir, 说明: '抽图超时（5分钟）——画册页数过多或图片过大，可拆分后重试' })
    }, 300_000)
    child.stdout.on('data', (d) => (out += String(d)))
    child.stderr.on('data', (d) => (err += String(d)))
    child.on('close', () => {
      clearTimeout(timer)
      if (err.includes('MISSING_DEP')) {
        return resolve({
          ok: false,
          outDir,
          说明: isWin
            ? '缺少 Python 依赖，请在命令提示符执行：pip install pypdf pillow numpy，然后重试'
            : '缺少 Python 依赖，请在终端执行：pip3 install pypdf pillow numpy，然后重试'
        })
      }
      try {
        const j = JSON.parse(out.trim().split('\n').pop() ?? '{}')
        if (j.ok)
          return resolve({ ok: true, pages: j.pages, crops: j.crops, autoPaired: j.autoPaired, degraded: Boolean(j.degraded), usedOcr: Boolean(j.usedOcr), outDir, 说明: j.说明 })
      } catch {
        /* 落到下面的失败分支 */
      }
      resolve({ ok: false, outDir, 说明: `抽图失败：${(err || out).slice(0, 200)}` })
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ ok: false, outDir, 说明: INSTALL_HINT })
    })
  })
}

export interface CatalogApplyResult {
  ok: boolean
  /** 抽取目录还不存在（要先跑阶段1抽取） */
  notExtracted?: boolean
  /** 缺 _配对.json（要先让分身核对生成配对清单） */
  needPairing?: boolean
  count?: number
  missing?: string[]
  outDir?: string
  说明: string
}

/** 抽取目录（相对 dataDir）：inbox/01_销售_sales/供应商资料/{pdf名}_画册抽取 */
export function catalogOutDirRel(pdfFileName: string): string {
  const stem = basename(pdfFileName).replace(/\.[^.]+$/, '')
  return join('inbox', '01_销售_sales', '供应商资料', `${stem}_画册抽取`)
}

/** 分身核对进度（分身每核对完一页更新 _核对进度.json）；没有/坏文件返回 null */
export function readCatalogProgress(dataDir: string, pdfFileName: string): { 已核对页: number; 总页: number } | null {
  try {
    const p = join(dataDir, catalogOutDirRel(pdfFileName), '_核对进度.json')
    if (!existsSync(p)) return null
    const j = JSON.parse(readFileSync(p, 'utf-8'))
    const done = Number(j.已核对页)
    const total = Number(j.总页)
    if (!isFinite(done) || !isFinite(total) || total <= 0) return null
    return { 已核对页: Math.min(done, total), 总页: total }
  } catch {
    return null
  }
}

/**
 * 阶段2 定稿：按分身写的 _配对.json 产出成品图 产品图片/序号_型号_产品名称_P页.jpg。
 * 抽取目录不存在 → notExtracted；缺 _配对.json → needPairing（前端据此注入核对提示词）。
 */
export function applyCatalogPairing(dataDir: string, pdfFileName: string): Promise<CatalogApplyResult> {
  const outDir = join(dataDir, catalogOutDirRel(pdfFileName))
  if (!existsSync(outDir)) {
    return Promise.resolve({ ok: false, notExtracted: true, 说明: '还没抽取过——先执行画册抠图阶段1' })
  }
  if (!existsSync(join(outDir, '_配对.json'))) {
    return Promise.resolve({ ok: false, needPairing: true, outDir, 说明: '缺配对清单——先让分身照 _标注/ 核对生成 _配对.json' })
  }
  const script = join(dataDir, 'tools', 'pdf-catalog', 'catalog_extract.py')
  if (!existsSync(script)) {
    return Promise.resolve({ ok: false, 说明: '抽图脚本不存在（tools/pdf-catalog 未同步到数据目录）' })
  }
  const python = resolvePython()
  if (!python) return Promise.resolve({ ok: false, 说明: INSTALL_HINT })

  return new Promise((resolve) => {
    const child = spawn(python, [script, '--apply', outDir, '--clean'], { windowsHide: true, env: { ...process.env, PATH: augmentedPath() } })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ ok: false, outDir, 说明: '定稿超时（2分钟）' })
    }, 120_000)
    child.stdout.on('data', (d) => (out += String(d)))
    child.stderr.on('data', (d) => (err += String(d)))
    child.on('close', () => {
      clearTimeout(timer)
      try {
        const j = JSON.parse(out.trim().split('\n').pop() ?? '{}')
        return resolve({
          ok: Boolean(j.ok),
          needPairing: Boolean(j.needPairing),
          count: j.count,
          missing: j.missing,
          outDir: j.outDir ?? outDir,
          说明: j.说明 ?? '定稿完成'
        })
      } catch {
        resolve({ ok: false, outDir, 说明: `定稿失败：${(err || out).slice(0, 200)}` })
      }
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ ok: false, outDir, 说明: INSTALL_HINT })
    })
  })
}
