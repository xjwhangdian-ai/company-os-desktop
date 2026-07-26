import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { FeedEntry } from './intel-fetch'

// ============ 招投标信息 Excel 累计台账（只增不覆盖）============
// 每次抓取的新增条目追加到 outputs/09_情报_intel/招投标每日追踪/招投标信息台账.xlsx。
// 与「保留3天」策略互补：JSON 信息流 3 天自动清理（工作台只看最新），
// Excel 台账永久累计（历史留档、可筛可查）。追加前按 类型+项目名称 与已有行去重，双保险防重复。

const LEDGER_REL = join('outputs', '09_情报_intel', '招投标每日追踪', '招投标信息台账.xlsx')

const COLUMNS: { header: string; key: string; width: number }[] = [
  { header: '抓取时间', key: '抓取时间', width: 16 },
  { header: '公告日期', key: '公告日期', width: 12 },
  { header: '类型', key: '类型', width: 12 },
  { header: '项目名称', key: '项目名称', width: 50 },
  { header: '采购单位', key: '采购单位', width: 26 },
  { header: '区县', key: '区县', width: 10 },
  { header: '预算', key: '预算', width: 12 },
  { header: '中标单位', key: '中标单位', width: 24 },
  { header: '中标金额', key: '中标金额', width: 12 },
  { header: '征询截止', key: '征询截止', width: 12 },
  { header: '平台', key: '平台', width: 14 },
  { header: '链接', key: '链接', width: 60 }
]

function nowStamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function intelLedgerPath(dataDir: string): string {
  return join(dataDir, LEDGER_REL)
}

/** 追加新增条目到累计台账；返回实际追加行数（台账内已有同名同类型的跳过） */
export async function appendIntelLedger(
  dataDir: string,
  entries: FeedEntry[]
): Promise<{ appended: number; path: string }> {
  const ExcelJS = (await import('exceljs')).default
  const path = intelLedgerPath(dataDir)
  mkdirSync(join(dataDir, 'outputs', '09_情报_intel', '招投标每日追踪'), { recursive: true })

  const wb = new ExcelJS.Workbook()
  let ws: import('exceljs').Worksheet
  if (existsSync(path)) {
    try {
      await wb.xlsx.readFile(path)
      ws = wb.worksheets[0]
    } catch {
      // 文件损坏：换名保留残件，重建新台账（绝不静默覆盖旧数据）
      const bak = path.replace(/\.xlsx$/, `_损坏备份_${Date.now()}.xlsx`)
      try {
        renameSync(path, bak)
      } catch {
        // 连改名都失败（多半被 Excel 锁着）——放弃本次追加
        throw new Error('台账文件无法读取也无法备份，可能正被 Excel 打开')
      }
      ws = newSheet(wb)
    }
  } else {
    ws = newSheet(wb)
  }

  function newSheet(book: import('exceljs').Workbook): import('exceljs').Worksheet {
    const sheet = book.addWorksheet('招投标信息台账', { views: [{ state: 'frozen', ySplit: 1 }] })
    sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }))
    const head = sheet.getRow(1)
    head.font = { bold: true }
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF6' } }
    return sheet
  }

  // 已有行的 类型|项目名称 集合（防跨清理周期重复追加）
  const nameCol = COLUMNS.findIndex((c) => c.key === '项目名称') + 1
  const typeCol = COLUMNS.findIndex((c) => c.key === '类型') + 1
  const seen = new Set<string>()
  ws.eachRow((row, n) => {
    if (n === 1) return
    seen.add(`${String(row.getCell(typeCol).value ?? '')}|${String(row.getCell(nameCol).value ?? '').trim()}`)
  })

  const stamp = nowStamp()
  let appended = 0
  for (const e of entries) {
    const key = `${e.类型}|${e.项目名称.trim()}`
    if (!e.项目名称.trim() || seen.has(key)) continue
    seen.add(key)
    // 按列序数组写入——从文件读回的工作表没有列 key 映射，对象键名写法会落成空行
    const row = ws.addRow([
      stamp,
      e.日期,
      e.类型,
      e.项目名称,
      e.采购单位,
      e.区县,
      e.预算,
      e.中标单位,
      e.中标金额,
      e.征询截止,
      e.平台,
      e.链接
    ])
    if (e.类型 === '意见征询') {
      // 意见征询整行淡黄底——重点关注阶段
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF6DE' } }
      })
    }
    appended += 1
  }

  if (appended > 0) await wb.xlsx.writeFile(path)
  return { appended, path }
}
