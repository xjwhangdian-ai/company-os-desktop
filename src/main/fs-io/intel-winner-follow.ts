import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Worksheet, Workbook } from 'exceljs'
import { doFetch } from './intel-fetch'
import { htmlToText, parseWinnerAnnouncement, type WinnerParse } from './zjgov-winner'
import { findIntelCandidateByKey, markWinnerFollowed } from './intel-candidates'

// ============ 采购结果公告「跟进」闭环 ============
// 点「跟进」→ 抓公告详情 → 解析中标供应商/金额/评审专家（标注采购人代表）→
// 附件全部下载归档 outputs/09_情报_intel/中标公告库/{日期_项目}/ →
// 追加 中标公告台账.xlsx（Sheet1 每项目一行；Sheet2 专家索引每专家×项目一行，
// 后续在 Excel 里筛某个专家名即可看到 TA 评审过的全部项目）。
// 浙江政采走详情 API 全自动；其他平台接口不带结构化附件/专家，先落基础行并标注需人工补。

const WINNER_DIR_REL = join('outputs', '09_情报_intel', '中标公告库')
const LEDGER_REL = join('outputs', '09_情报_intel', '中标公告台账.xlsx')
const ZJGOV_BASE = 'https://zfcg.czt.zj.gov.cn'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export interface WinnerFollowResult {
  ok: boolean
  说明: string
  归档目录?: string
}

interface ZjgovDetail {
  title: string
  content: string
  attachments: { name: string; url: string }[]
}

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '').slice(0, 60) || '未命名'
}

async function fetchZjgovDetail(articleId: string): Promise<ZjgovDetail | null> {
  const resp = await doFetch(`${ZJGOV_BASE}/portal/detail?articleId=${encodeURIComponent(articleId)}`, {
    headers: { 'User-Agent': UA, Referer: `${ZJGOV_BASE}/site/detail` },
    signal: AbortSignal.timeout(15000)
  })
  if (!resp.ok) return null
  const data = (await resp.json()) as {
    result?: {
      data?: {
        title?: string
        content?: string
        attachmentVO?: { domain?: string; attachments?: { fileId?: string; name?: string; isShow?: boolean }[] }
      }
    }
  }
  const d = data?.result?.data
  if (!d?.content) return null
  const vo = d.attachmentVO
  const attachments = (vo?.attachments ?? [])
    .filter((a) => a.fileId && a.name)
    .map((a) => ({ name: String(a.name), url: `${vo?.domain ?? ''}${a.fileId}` }))
  return { title: String(d.title ?? ''), content: String(d.content), attachments }
}

/** 附件逐个下载；单个失败不影响其余，返回成功数 */
async function downloadAttachments(list: { name: string; url: string }[], dir: string): Promise<number> {
  let ok = 0
  for (const a of list.slice(0, 20)) {
    try {
      const resp = await doFetch(a.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) })
      if (!resp.ok) continue
      const buf = Buffer.from(await resp.arrayBuffer())
      if (buf.length === 0) continue
      writeFileSync(join(dir, sanitize(a.name)), buf)
      ok += 1
    } catch {
      // 单附件失败跳过
    }
  }
  return ok
}

const SHEET1_COLS = [
  { header: '跟进时间', width: 16 },
  { header: '公告日期', width: 12 },
  { header: '项目名称', width: 50 },
  { header: '采购单位', width: 26 },
  { header: '区县', width: 10 },
  { header: '中标供应商', width: 30 },
  { header: '中标金额', width: 14 },
  { header: '评审专家', width: 40 },
  { header: '采购人代表', width: 14 },
  { header: '平台', width: 12 },
  { header: '附件数', width: 8 },
  { header: '归档目录', width: 40 },
  { header: '链接', width: 60 }
]
const SHEET2_COLS = [
  { header: '专家姓名', width: 12 },
  { header: '角色', width: 12 },
  { header: '备注', width: 18 },
  { header: '项目名称', width: 50 },
  { header: '公告日期', width: 12 },
  { header: '采购单位', width: 26 },
  { header: '中标供应商', width: 30 },
  { header: '中标金额', width: 14 }
]

function ensureSheet(wb: Workbook, name: string, cols: { header: string; width: number }[]): Worksheet {
  const found = wb.worksheets.find((w) => w.name === name)
  if (found) return found
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width }))
  const head = ws.getRow(1)
  head.font = { bold: true }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF6' } }
  return ws
}

function nowStamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function appendWinnerLedger(
  dataDir: string,
  row: {
    日期: string
    项目名称: string
    采购单位: string
    区县: string
    平台: string
    链接: string
    附件数: number
    归档目录: string
    parsed: WinnerParse
  }
): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const path = join(dataDir, LEDGER_REL)
  const wb = new ExcelJS.Workbook()
  if (existsSync(path)) {
    try {
      await wb.xlsx.readFile(path)
    } catch {
      const bak = path.replace(/\.xlsx$/, `_损坏备份_${Date.now()}.xlsx`)
      try {
        renameSync(path, bak)
      } catch {
        throw new Error('中标公告台账无法读取也无法备份，可能正被 Excel 打开')
      }
    }
  }
  const ws1 = ensureSheet(wb, '中标公告', SHEET1_COLS)
  const ws2 = ensureSheet(wb, '专家索引', SHEET2_COLS)

  // Sheet1 按项目名称去重（读回的工作表没有列 key，必须按列序数组写行）
  const seen1 = new Set<string>()
  ws1.eachRow((r, n) => {
    if (n > 1) seen1.add(String(r.getCell(3).value ?? '').trim())
  })
  const p = row.parsed
  const 供应商全 = p.标项.length > 1 ? p.标项.map((l) => l.供应商).join('；') : p.中标单位
  const 代表 = p.专家.filter((e) => e.角色 === '采购人代表').map((e) => e.姓名).join('、')
  if (!seen1.has(row.项目名称.trim())) {
    ws1.addRow([
      nowStamp(),
      row.日期,
      row.项目名称,
      row.采购单位,
      row.区县,
      供应商全 || '待确认',
      p.中标金额 || '待确认',
      p.专家.map((e) => (e.角色 === '采购人代表' ? `${e.姓名}（采购人代表）` : e.姓名)).join('、') || '待确认',
      代表,
      row.平台,
      row.附件数,
      row.归档目录,
      row.链接
    ])
  }

  // Sheet2 专家索引：专家|项目 去重
  const seen2 = new Set<string>()
  ws2.eachRow((r, n) => {
    if (n > 1) seen2.add(`${String(r.getCell(1).value ?? '')}|${String(r.getCell(4).value ?? '').trim()}`)
  })
  for (const e of p.专家) {
    const k = `${e.姓名}|${row.项目名称.trim()}`
    if (seen2.has(k)) continue
    seen2.add(k)
    const r = ws2.addRow([e.姓名, e.角色, e.备注, row.项目名称, row.日期, row.采购单位, 供应商全, p.中标金额])
    if (e.角色 === '采购人代表') {
      r.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF6DE' } }
      })
    }
  }

  await wb.xlsx.writeFile(path)
}

export async function followWinnerAnnouncement(dataDir: string, key: string): Promise<WinnerFollowResult> {
  const c = findIntelCandidateByKey(dataDir, key)
  if (!c) return { ok: false, 说明: '候选条目不存在（可能已过 3 天清理），请刷新' }
  if (c.类型 !== '采购结果公告') return { ok: false, 说明: '仅采购结果公告支持中标归档跟进' }

  const dirName = `${c.日期}_${sanitize(c.项目名称)}`
  const dir = join(dataDir, WINNER_DIR_REL, dirName)
  mkdirSync(dir, { recursive: true })

  let parsed: WinnerParse = { 中标单位: c.中标单位 ?? '', 中标金额: c.中标金额 ?? '', 标项: [], 专家: [] }
  let 附件数 = 0
  let note = ''

  const articleId = /[?&]articleId=([^&]+)/.exec(c.链接 ?? '')?.[1]
  if (c.平台 === '浙江政采' && articleId) {
    try {
      const detail = await fetchZjgovDetail(decodeURIComponent(articleId))
      if (detail) {
        parsed = parseWinnerAnnouncement(htmlToText(detail.content))
        writeFileSync(
          join(dir, '公告原文.html'),
          `<meta charset="utf-8"><title>${detail.title}</title><h2>${detail.title}</h2>${detail.content}`,
          'utf-8'
        )
        writeFileSync(
          join(dir, '中标信息.json'),
          JSON.stringify({ 项目名称: c.项目名称, 采购单位: c.采购单位, 公告日期: c.日期, 链接: c.链接, ...parsed }, null, 2),
          'utf-8'
        )
        if (detail.attachments.length > 0) {
          const attDir = join(dir, '附件')
          mkdirSync(attDir, { recursive: true })
          附件数 = await downloadAttachments(detail.attachments, attDir)
          if (附件数 < detail.attachments.length) note = `；附件 ${detail.attachments.length} 个成功 ${附件数} 个（失败的点原文手动下载）`
        }
      } else {
        note = '；详情页没抓到，台账按列表信息落基础行'
      }
    } catch {
      note = '；详情页抓取失败，台账按列表信息落基础行'
    }
  } else {
    note = '；非政采平台无结构化详情，附件与专家请点原文人工补充'
  }

  try {
    await appendWinnerLedger(dataDir, {
      日期: c.日期,
      项目名称: c.项目名称,
      采购单位: c.采购单位,
      区县: c.区县 ?? '',
      平台: c.平台,
      链接: c.链接,
      附件数,
      归档目录: `中标公告库/${dirName}`,
      parsed
    })
  } catch (err) {
    return { ok: false, 说明: err instanceof Error ? err.message : '台账写入失败' }
  }

  markWinnerFollowed(dataDir, key)
  const expertNote = parsed.专家.length > 0 ? `，专家 ${parsed.专家.length} 人已入索引` : ''
  return {
    ok: true,
    说明: `已归档：${parsed.中标单位 || '中标单位待确认'} ${parsed.中标金额 || ''}${expertNote}，附件 ${附件数} 个${note}`,
    归档目录: dir
  }
}

export function winnerLedgerPath(dataDir: string): string {
  return join(dataDir, LEDGER_REL)
}
