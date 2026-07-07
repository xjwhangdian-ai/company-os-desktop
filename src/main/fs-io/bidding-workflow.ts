import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { BidProjectCard, BiddingProject, MaterialLibraryCounts, OutputEntry } from '@shared/agent-types'
import { BID_PROJECT_STATUSES } from '@shared/agent-types'
import { readTenderSource } from './intel-source'

// ============ 招投标项目 = inbox/outputs 两侧同名文件夹配对 ============
//   inbox/03_招投标_bidding/{YYYY-MM-DD_项目}/    ← 招标原件（App 上传时机械建夹）
//   outputs/03_招投标_bidding/{YYYY-MM-DD_项目}/  ← 解析报告/质疑函/投标文件（分身写入）
// 跨项目共享的素材库仍在 bidding/_素材库/（它是库，不是某个项目的输入或产出）。

const INBOX_ROOT_REL = join('inbox', '03_招投标_bidding')
const OUTPUTS_ROOT_REL = join('outputs', '03_招投标_bidding')
const PROJECT_FOLDER_PATTERN = /^\d{4}-\d{2}-\d{2}_.+/

const MATERIAL_CATEGORIES: Array<keyof MaterialLibraryCounts> = [
  '产品资料',
  '产品检测报告',
  '产品解决方案',
  '人员资质',
  '类似项目合同'
]

/** 递归列出目录下全部文件，relativePath 相对数据目录（inbox/... 或 outputs/... 开头，UI 靠它区分来源侧） */
function listFilesRecursive(dataDir: string, dir: string): OutputEntry[] {
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const entries: OutputEntry[] = []
  for (const name of names) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    const isDirectory = st.isDirectory()
    entries.push({
      name,
      path: full,
      relativePath: relative(dataDir, full),
      isDirectory,
      size: st.size,
      mtimeMs: st.mtimeMs,
      children: isDirectory ? listFilesRecursive(dataDir, full) : undefined
    })
  }
  entries.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))
  return entries
}

function listProjectFolders(root: string): string[] {
  let names: string[] = []
  try {
    names = readdirSync(root)
  } catch {
    return []
  }
  return names.filter((n) => {
    if (!PROJECT_FOLDER_PATTERN.test(n)) return false
    try {
      return statSync(join(root, n)).isDirectory()
    } catch {
      return false
    }
  })
}

function countFilesRecursive(dir: string): number {
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return 0
  }
  let count = 0
  for (const name of names) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) count += countFilesRecursive(full)
    else count += 1
  }
  return count
}

// ============ 项目卡（App 托管） ============

const CARD_FILE = '项目卡.json'
const CARD_BACKFILL_FILE = '_项目卡回填.json'

function emptyCard(): BidProjectCard {
  return {
    业主单位: '',
    招标编号: '',
    预算金额: '',
    我方报价: '',
    保证金: '',
    投标截止日: '',
    开标日: '',
    状态: '跟进中',
    备注: '',
    更新时间: Date.now()
  }
}

function cardPath(dataDir: string, folderName: string): string {
  return join(dataDir, OUTPUTS_ROOT_REL, folderName, CARD_FILE)
}

export function readProjectCard(dataDir: string, folderName: string): BidProjectCard | null {
  const p = cardPath(dataDir, folderName)
  if (!existsSync(p)) return null
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8'))
    const card = { ...emptyCard(), ...raw }
    if (!BID_PROJECT_STATUSES.includes(card.状态)) card.状态 = '跟进中'
    return card
  } catch {
    return null
  }
}

export function saveProjectCard(dataDir: string, folderName: string, card: BidProjectCard): BidProjectCard {
  const dir = join(dataDir, OUTPUTS_ROOT_REL, folderName)
  mkdirSync(dir, { recursive: true })
  const next = { ...emptyCard(), ...card, 更新时间: Date.now() }
  const p = cardPath(dataDir, folderName)
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify({ version: 1, ...next }, null, 2), 'utf-8')
  renameSync(tmp, p)
  return next
}

/** 分身回填只允许填这些"从招标文件里客观可提取"的字段；我方报价/状态/备注是人的决策，不给 AI 填 */
const BACKFILL_FIELDS = ['业主单位', '招标编号', '预算金额', '保证金', '投标截止日', '开标日'] as const

/**
 * 合并分身写的 _项目卡回填.json：**只填卡里还是空的字段**——人工录入永远优先，
 * AI 回填只补空白，绝不覆盖。合并后暂存文件改名归档，避免重复合并。
 */
function ingestCardBackfill(dataDir: string, folderName: string): void {
  const backfillPath = join(dataDir, OUTPUTS_ROOT_REL, folderName, CARD_BACKFILL_FILE)
  if (!existsSync(backfillPath)) return
  try {
    const staged = JSON.parse(readFileSync(backfillPath, 'utf-8'))
    const card = readProjectCard(dataDir, folderName) ?? emptyCard()
    let changed = false
    for (const field of BACKFILL_FIELDS) {
      const v = staged?.[field]
      if (!card[field] && typeof v === 'string' && v.trim()) {
        card[field] = v.trim()
        changed = true
      }
    }
    if (changed) saveProjectCard(dataDir, folderName, card)
    renameSync(backfillPath, join(dataDir, OUTPUTS_ROOT_REL, folderName, '_项目卡回填.已合并.json'))
  } catch {
    // JSON 损坏：留在原地，人工检查
  }
}

// ============ 台账导出 ============

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** 导出跨项目台账 CSV（带 UTF-8 BOM，Numbers/Excel 打开中文不乱码）；每次导出整表重生成 */
export function exportBiddingLedger(dataDir: string): { path: string; count: number } {
  const projects = listBiddingProjects(dataDir)
  const header = ['项目文件夹', '项目名称', '日期', '状态', '投标截止日', '开标日', '业主单位', '招标编号', '预算金额', '我方报价', '保证金', '已解析', '已质疑', '已投标', '备注']
  const rows = projects.map((p) => {
    const c = p.card
    return [
      p.folderName,
      p.projectName,
      p.date,
      c?.状态 ?? '跟进中',
      c?.投标截止日 ?? '',
      c?.开标日 ?? '',
      c?.业主单位 ?? '',
      c?.招标编号 ?? '',
      c?.预算金额 ?? '',
      c?.我方报价 ?? '',
      c?.保证金 ?? '',
      p.hasParseReport ? '是' : '否',
      p.hasChallengeLetter ? '是' : '否',
      p.hasDraft ? '是' : '否',
      c?.备注 ?? ''
    ].map(csvCell).join(',')
  })
  const csv = '\uFEFF' + [header.join(','), ...rows].join('\n') + '\n'
  const outPath = join(dataDir, OUTPUTS_ROOT_REL, '招标项目台账.csv')
  mkdirSync(join(dataDir, OUTPUTS_ROOT_REL), { recursive: true })
  writeFileSync(outPath, csv, 'utf-8')
  return { path: outPath, count: projects.length }
}

/** 扫描 inbox/outputs 两侧的项目文件夹并按同名配对，供项目列表页展示进度徽章 */
export function listBiddingProjects(dataDir: string): BiddingProject[] {
  const inboxRoot = join(dataDir, INBOX_ROOT_REL)
  const outputsRoot = join(dataDir, OUTPUTS_ROOT_REL)
  const inboxFolders = new Set(listProjectFolders(inboxRoot))
  const outputsFolders = new Set(listProjectFolders(outputsRoot))
  const all = new Set([...inboxFolders, ...outputsFolders])

  const projects: BiddingProject[] = []
  for (const folderName of all) {
    const inboxPath = inboxFolders.has(folderName) ? join(inboxRoot, folderName) : undefined
    const outputsPath = outputsFolders.has(folderName) ? join(outputsRoot, folderName) : undefined
    // 有分身新写的回填暂存就先合并进项目卡（只补空字段）
    if (outputsPath) ingestCardBackfill(dataDir, folderName)
    const files = [
      ...(inboxPath ? listFilesRecursive(dataDir, inboxPath) : []),
      ...(outputsPath ? listFilesRecursive(dataDir, outputsPath) : [])
    ].filter((e) => e.name !== CARD_FILE && !e.name.startsWith('_项目卡回填'))
    const flat = (entries: OutputEntry[]): OutputEntry[] =>
      entries.flatMap((e) => (e.isDirectory ? flat(e.children ?? []) : [e]))
    const fileNames = flat(files).map((f) => f.name)

    projects.push({
      folderName,
      projectName: folderName.slice(11),
      date: folderName.slice(0, 10),
      inboxPath,
      outputsPath,
      card: readProjectCard(dataDir, folderName),
      tenderSource: readTenderSource(dataDir, folderName),
      hasSourceFile: inboxPath !== undefined && flat(listFilesRecursive(dataDir, inboxPath)).length > 0,
      hasParseReport: fileNames.some((f) => f.includes('招标解析')),
      hasChallengeLetter: fileNames.some((f) => f.includes('质疑函')),
      hasDraft: fileNames.some(
        (f) => f.includes('投标文件') || f.includes('资格证明文件') || f.includes('商务技术文件') || f.includes('报价文件')
      ),
      files
    })
  }

  projects.sort((a, b) => (a.date < b.date ? 1 : -1))
  return projects
}

/** 返回项目 inbox/outputs 两侧文件夹的绝对路径（仅返回磁盘上确实存在的一侧）。删除项目时用它拿到要清理的路径。 */
export function resolveBiddingProjectPaths(dataDir: string, folderName: string): string[] {
  if (!PROJECT_FOLDER_PATTERN.test(folderName)) return []
  const paths: string[] = []
  for (const rel of [INBOX_ROOT_REL, OUTPUTS_ROOT_REL]) {
    const p = join(dataDir, rel, folderName)
    if (existsSync(p)) paths.push(p)
  }
  return paths
}

/** 素材库五分类的文件数量粗判——只做数量统计，不做语义匹配（精确判断留给分身在生成时做） */
export function getMaterialLibraryCounts(dataDir: string): MaterialLibraryCounts {
  const libRoot = join(dataDir, 'bidding', '_素材库')
  const counts = {} as MaterialLibraryCounts
  for (const category of MATERIAL_CATEGORIES) {
    counts[category] = countFilesRecursive(join(libRoot, category))
  }
  return counts
}
