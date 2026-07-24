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

const isWin = process.platform === 'win32'

/** 跨平台找 python3：mac 常见绝对路径 → PATH 里的 python3/python/py（Windows 官方装包是 python/py） */
function resolvePython(): string | null {
  const candidates = isWin
    ? ['python', 'py']
    : ['/usr/bin/python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3', 'python3']
  for (const c of candidates) {
    if (c.startsWith('/')) {
      if (existsSync(c)) return c
    } else {
      return c // 交给 PATH 解析；spawn error 时会落到"无法启动 Python"分支给出安装指引
    }
  }
  return null
}

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
    const child = spawn(python, [script, pdf, outDir], { windowsHide: true })
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
        if (j.ok) return resolve({ ok: true, pages: j.pages, crops: j.crops, outDir, 说明: j.说明 })
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
