import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { augmentedPath } from './env-check'

// ============ 财务：发票 OCR 识别入台账（纯机械，不经过 AI）============
// 选发票图片 → macOS Vision OCR 提取（发票号码/日期/购销双方/价税合计，红字负数）→
// 按「开票日期-购买方-金额」重命名；输入侧保留一份到 inbox/08_财务_finance/票据/{开票月份}/，
// 输出侧把重命名发票与累计台账统一放进 outputs/08_财务_finance/发票台账/。
// 台账只增不覆盖，按发票号码去重；识别失败件统一放同一输出目录下的 待人工/。
// 方向自动判定：销售方含我方主体词=销项(开出)，购买方含=进项(收到)。

const LEDGER_DIR_REL = join('outputs', '08_财务_finance', '发票台账')
const LEDGER_NAME = '发票台账.xlsx'
const RECEIPTS_REL = join('inbox', '08_财务_finance', '票据')

const isWin = process.platform === 'win32'

interface InvoiceRecord {
  原文件: string
  原路径: string
  发票号码: string
  开票日期: string
  购买方: string
  销售方: string
  金额: string
  方向: string
  建议文件名: string
}

export interface InvoiceProcessResult {
  ok: boolean
  成功: number
  重复: number
  失败: { 原文件: string; 原因: string }[]
  销项合计: number
  进项合计: number
  台账路径: string
  说明: string
}

function resolvePython(): string | null {
  const candidates = ['/usr/bin/python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3', 'python3']
  for (const c of candidates) {
    if (c.startsWith('/')) {
      if (existsSync(c)) return c
    } else return c
  }
  return null
}

function runOcr(dataDir: string, files: string[]): Promise<{ records: InvoiceRecord[]; failures: { 原文件: string; 原因: string }[] }> {
  return new Promise((resolve, reject) => {
    const script = join(dataDir, 'tools', 'invoice-ocr', 'invoice_ocr.py')
    if (!existsSync(script)) return reject(new Error('识别脚本不存在（tools/invoice-ocr 未同步到数据目录）'))
    const python = resolvePython()
    if (!python) return reject(new Error('本机没有可用的 python3'))
    const child = spawn(python, [script, ...files], {
      windowsHide: true,
      env: { ...process.env, PATH: augmentedPath() }
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += String(d)))
    child.stderr.on('data', (d) => (err += String(d)))
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('识别超时（10分钟）——单批发票太多可分批'))
    }, 600_000)
    child.on('close', () => {
      clearTimeout(timer)
      try {
        const j = JSON.parse(out.trim().split('\n').pop() ?? '{}')
        if (j.error === 'MISSING_OCR') {
          return reject(new Error(isWin ? '发票识别目前仅支持 macOS（依赖系统离线 OCR）——请在 Mac 上操作' : j.说明))
        }
        resolve({ records: j.records ?? [], failures: j.failures ?? [] })
      } catch {
        reject(new Error(`识别失败：${(err || out).slice(-200)}`))
      }
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })
}

const COLS = ['录入时间', '发票号码', '开票日期', '方向', '购买方名称', '销售方名称', '价税合计金额(元)', '归档文件', '备注']

/** 同名但不是同一张发票时追加发票号/序号，避免覆盖已有成果。 */
function uniqueOutputName(dir: string, suggested: string, invoiceNo: string): string {
  if (!existsSync(join(dir, suggested))) return suggested
  const ext = extname(suggested)
  const stem = suggested.slice(0, suggested.length - ext.length)
  const suffix = invoiceNo.replace(/\D/g, '').slice(-8)
  const first = `${stem}-${suffix || '副本'}${ext}`
  if (!existsSync(join(dir, first))) return first
  for (let i = 2; ; i++) {
    const candidate = `${stem}-${suffix || '副本'}-${i}${ext}`
    if (!existsSync(join(dir, candidate))) return candidate
  }
}

/**
 * 处理一批发票图片：OCR → 重命名归档 → 台账追加（发票号码去重）。
 * 台账与重命名发票统一输出在 发票台账/；输入侧票据目录保留副本供 AI 记账读取。
 * 红字发票金额为负、行标黄；识别失败件放 发票台账/待人工/，输入侧也保留副本。
 */
export async function processInvoices(dataDir: string, files: string[]): Promise<InvoiceProcessResult> {
  const { records, failures } = await runOcr(dataDir, files)

  const ExcelJS = (await import('exceljs')).default
  const ledgerDir = join(dataDir, LEDGER_DIR_REL)
  mkdirSync(ledgerDir, { recursive: true })
  const ledgerPath = join(ledgerDir, LEDGER_NAME)

  const wb = new ExcelJS.Workbook()
  let ws: import('exceljs').Worksheet
  let ledgerChanged = false
  if (existsSync(ledgerPath)) {
    try {
      await wb.xlsx.readFile(ledgerPath)
      ws = wb.worksheets[0]
    } catch {
      throw new Error('发票台账.xlsx 无法读取——若正开着 Excel 请先关闭再试')
    }
  } else {
    ws = wb.addWorksheet('发票台账', { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.columns = COLS.map((h, i) => ({ header: h, width: [16, 24, 12, 8, 32, 32, 16, 44, 30][i] }))
    ws.getRow(1).font = { bold: true }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF6' } }
  }

  // 已有发票号码集合（跨批次去重）
  const seen = new Set<string>()
  ws.eachRow((row, n) => {
    if (n > 1) seen.add(String(row.getCell(2).value ?? ''))
  })

  // v0.1.14 前的台账把发票只归档在 inbox/票据/{月份}/，第 8 列写「票据/月份/文件名」。
  // 读旧台账时机械补齐到输出目录，并把第 8 列改成与台账同目录的文件名。
  ws.eachRow((row, n) => {
    if (n <= 1) return
    const stored = String(row.getCell(8).value ?? '').trim()
    if (!stored || !stored.startsWith('票据/')) return
    const outputName = basename(stored)
    const source = join(dataDir, 'inbox', '08_财务_finance', stored)
    const output = join(ledgerDir, outputName)
    try {
      if (existsSync(source) && !existsSync(output)) copyFileSync(source, output)
      if (existsSync(output)) {
        row.getCell(8).value = outputName
        ledgerChanged = true
      }
    } catch {
      // 源文件缺失时保留旧路径，避免把台账改成无效链接
    }
  })

  const now = new Date()
  const p2 = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}`

  let 成功 = 0
  let 重复 = 0
  let 销项合计 = 0
  let 进项合计 = 0
  for (const r of records) {
    if (seen.has(r.发票号码)) {
      重复 += 1
      continue
    }
    seen.add(r.发票号码)
    // 输出成果：台账与重命名发票放同一目录；输入侧仍保留副本供后续 AI 记账。
    const ym = r.开票日期.slice(0, 7)
    const outputName = uniqueOutputName(ledgerDir, r.建议文件名, r.发票号码)
    const outputDest = join(ledgerDir, outputName)
    const inputDir = join(dataDir, RECEIPTS_REL, ym)
    mkdirSync(inputDir, { recursive: true })
    try {
      copyFileSync(r.原路径, outputDest)
      const inputDest = join(inputDir, outputName)
      if (!existsSync(inputDest)) copyFileSync(r.原路径, inputDest)
    } catch {
      // 归档失败不阻塞台账
    }
    const amount = Number(r.金额)
    const 备注 = amount < 0 ? '红字发票（负数）' : ''
    const row = ws.addRow([stamp, r.发票号码, r.开票日期, r.方向, r.购买方, r.销售方, amount, outputName, 备注])
    row.getCell(7).numFmt = '#,##0.00'
    if (amount < 0 || r.方向 === '待确认') {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2A8' } }
      })
    }
    if (r.方向 === '销项') 销项合计 += amount
    if (r.方向 === '进项') 进项合计 += amount
    成功 += 1
  }

  // 识别失败件放输出目录的 待人工/；输入侧也保留副本，不丢件。
  for (const f of failures as { 原文件: string; 原路径?: string; 原因: string }[]) {
    if (!f.原路径) continue
    const outputPending = join(ledgerDir, '待人工')
    const inputPending = join(dataDir, RECEIPTS_REL, '待人工')
    mkdirSync(outputPending, { recursive: true })
    mkdirSync(inputPending, { recursive: true })
    try {
      const outputDest = join(outputPending, f.原文件)
      const inputDest = join(inputPending, f.原文件)
      if (!existsSync(outputDest)) copyFileSync(f.原路径, outputDest)
      if (!existsSync(inputDest)) copyFileSync(f.原路径, inputDest)
    } catch {
      // 忽略
    }
  }

  if (成功 > 0 || ledgerChanged) await wb.xlsx.writeFile(ledgerPath)

  return {
    ok: true,
    成功,
    重复,
    失败: failures.map((f) => ({ 原文件: f.原文件, 原因: f.原因 })),
    销项合计,
    进项合计,
    台账路径: ledgerPath,
    说明:
      `识别入账 ${成功} 张` +
      (重复 > 0 ? `，跳过重复 ${重复} 张` : '') +
      (failures.length > 0 ? `，失败 ${failures.length} 张（已放入 发票台账/待人工/）` : '') +
      `；本批销项 ¥${销项合计.toFixed(2)}、进项 ¥${进项合计.toFixed(2)}；台账与重命名发票已统一输出到 发票台账/`
  }
}
