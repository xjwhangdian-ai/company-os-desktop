import { existsSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { spawn } from 'node:child_process'

// ============ 产品画册 PDF → 抽图 + 文本提取（销售分身用）============
// 机械管线（不经过 AI）：调数据仓库的 tools/pdf-catalog/catalog_extract.py，
// 把画册每个产品照单独抠出、逐页文本提取、生成带编号的标注图供人工/分身核对配图。
// 高精度"图文配对"仍需 sales 分身照标注图逐页核对（版式各异，机械无法保证）——见 sales.md 配图铁律。

export interface PdfCatalogResult {
  ok: boolean
  pages?: number
  crops?: number
  outDir?: string
  说明: string
}

// Python(pypdf/PIL/numpy) 抽图栈目前在 Mac 就绪；Windows 成员机给手动指引，避免 spawn 报错。
const SUPPORTED = process.platform === 'darwin'

/**
 * 抽取产品画册：pdfFileName 为 inbox/01_销售_sales/供应商资料/ 下的 PDF 文件名。
 * 产出到同目录的 {pdf名}_画册抽取/（产品图候选/ + 文本提取.md + _标注/ + _整页/）。
 */
export function extractPdfCatalog(dataDir: string, pdfFileName: string): Promise<PdfCatalogResult> {
  if (!SUPPORTED) {
    return Promise.resolve({
      ok: false,
      说明: '画册抽图目前仅 Mac 管理员机支持（依赖 Python 图像栈）；Windows 请把 PDF 发给销售分身逐页整理'
    })
  }
  const supplierDir = join(dataDir, 'inbox', '01_销售_sales', '供应商资料')
  const pdf = join(supplierDir, pdfFileName)
  if (!existsSync(pdf)) {
    return Promise.resolve({ ok: false, 说明: `找不到 PDF：${pdfFileName}（应在 inbox/01_销售_sales/供应商资料/ 下）` })
  }
  const script = join(dataDir, 'tools', 'pdf-catalog', 'catalog_extract.py')
  if (!existsSync(script)) {
    return Promise.resolve({ ok: false, 说明: '抽图脚本不存在（tools/pdf-catalog 未同步到数据目录）' })
  }
  const stem = basename(pdfFileName).replace(/\.[^.]+$/, '')
  const outDir = join(supplierDir, `${stem}_画册抽取`)
  mkdirSync(outDir, { recursive: true })

  return new Promise((resolve) => {
    const child = spawn('/usr/bin/python3', [script, pdf, outDir])
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
          说明: '缺少 Python 依赖，请在终端执行：pip3 install pypdf pillow numpy，然后重试'
        })
      }
      try {
        const j = JSON.parse(out.trim().split('\n').pop() ?? '{}')
        if (j.ok) return resolve({ ok: true, pages: j.pages, crops: j.crops, outDir, 说明: j.说明 })
      } catch {
        /* 落到下面的失败分支 */
      }
      resolve({ ok: false, outDir, 说明: `抽图失败：${(err || out).slice(0, 200)}` })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, outDir, 说明: `无法启动 Python：${String(e)}（确认已装 python3）` })
    })
  })
}
