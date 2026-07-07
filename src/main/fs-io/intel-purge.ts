import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// ============ 行业情报「保留最近三天」自动清理 ============
// 每日管线（launchd 07:00/07:20）不断落新数据，旧的机读数据会堆积。
// 打开「行业情报」分身时自动清一次：只清超过三天的**机读数据**（JSON 信息流/候选 + inbox 原始抓取），
// 保留人读产出（日报 .md、跟进台账.md、台账 CSV）。
//
// 清理目标：
//   outputs/09_情报_intel/招投标每日追踪/{YYYY-MM-DD}_*.json   （信息流/候选项目）
//   outputs/09_情报_intel/研报追踪/{YYYY-MM-DD}_*.json          （研报信息流）
//   inbox/09_情报_intel/招投标每日/{YYYY-MM-DD}/                （整个原始抓取目录）
//   outputs/09_情报_intel/招投标每日追踪/候选项目处理状态.json    （逐条删除三天前的记录，文件保留）

const OUTPUTS_TRACK_REL = join('outputs', '09_情报_intel', '招投标每日追踪')
const OUTPUTS_REPORTS_REL = join('outputs', '09_情报_intel', '研报追踪')
const INBOX_DAILY_REL = join('inbox', '09_情报_intel', '招投标每日')
const STATE_FILE = '候选项目处理状态.json'

/** 保留天数（含今天）：3 = 今天 + 前两天 */
const KEEP_DAYS = 3
const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/

/** 返回保留下限日期字符串（YYYY-MM-DD）；早于它的按 < 比较即算"超过三天" */
function cutoffDate(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (KEEP_DAYS - 1))
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 删某目录下"日期前缀 + 指定后缀"且早于 cutoff 的文件，返回被删相对路径 */
function purgeDatedFiles(dataDir: string, relDir: string, matcher: RegExp, cutoff: string): string[] {
  const dir = join(dataDir, relDir)
  if (!existsSync(dir)) return []
  const purged: string[] = []
  for (const name of readdirSync(dir)) {
    const m = DATE_PREFIX.exec(name)
    if (!m || !matcher.test(name)) continue
    if (m[1] >= cutoff) continue
    try {
      unlinkSync(join(dir, name))
      purged.push(join(relDir, name))
    } catch {
      // 单个删除失败不影响其余
    }
  }
  return purged
}

/** 删 inbox 每日抓取目录里早于 cutoff 的整日目录 */
function purgeDatedDirs(dataDir: string, relDir: string, cutoff: string): string[] {
  const dir = join(dataDir, relDir)
  if (!existsSync(dir)) return []
  const purged: string[] = []
  for (const name of readdirSync(dir)) {
    const m = DATE_PREFIX.exec(name)
    if (!m || m[1] >= cutoff) continue
    const full = join(dir, name)
    try {
      if (!statSync(full).isDirectory()) continue
      rmSync(full, { recursive: true, force: true })
      purged.push(join(relDir, name))
    } catch {
      // 忽略
    }
  }
  return purged
}

/** 逐条删候选项目处理状态里三天前的记录（key 形如 `YYYY-MM-DD|项目名`），文件本身保留 */
function pruneStateEntries(dataDir: string, cutoff: string): number {
  const p = join(dataDir, OUTPUTS_TRACK_REL, STATE_FILE)
  if (!existsSync(p)) return 0
  try {
    const state = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>
    let removed = 0
    for (const key of Object.keys(state)) {
      const date = key.slice(0, 10)
      if (DATE_PREFIX.test(date) && date < cutoff) {
        delete state[key]
        removed += 1
      }
    }
    if (removed > 0) {
      const tmp = `${p}.tmp`
      writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
      renameSync(tmp, p)
    }
    return removed
  } catch {
    return 0
  }
}

/**
 * 清除超过三天的旧情报机读数据。幂等、可反复调用（打开情报分身时触发）。
 * 只删机读 JSON 与 inbox 原始抓取，保留 .md 日报 / .csv 台账等人读产出。
 */
export function purgeStaleIntelData(dataDir: string): { purged: string[] } {
  const cutoff = cutoffDate()
  const purged = [
    ...purgeDatedFiles(dataDir, OUTPUTS_TRACK_REL, /\.json$/i, cutoff),
    ...purgeDatedFiles(dataDir, OUTPUTS_REPORTS_REL, /\.json$/i, cutoff),
    ...purgeDatedDirs(dataDir, INBOX_DAILY_REL, cutoff)
  ]
  const prunedState = pruneStateEntries(dataDir, cutoff)
  if (prunedState > 0) purged.push(`${STATE_FILE}（清理 ${prunedState} 条三天前记录）`)
  return { purged }
}
