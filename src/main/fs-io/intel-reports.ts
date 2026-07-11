import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { IntelReport } from '@shared/agent-types'

// ============ 研报情报（sgpjbg.com）：行业趋势 + 政策文件 ============
// 数据源：outputs/09_情报_intel/研报追踪/{日期}_研报信息流.json
//   由 tools/intel-reports/run_reports.sh（launchd 每天 07:20）抓取，每份带下载页链接，不下 PDF。
// 只读展示，无"确认"动作——研报是参考资料，不像招投标要建项目卡。

const TRACK_DIR_REL = join('outputs', '09_情报_intel', '研报追踪')

/** 读取最新一天的研报信息流（按文件名日期取最新）。无数据返回空数组。 */
export function listIntelReports(dataDir: string): IntelReport[] {
  const dir = join(dataDir, TRACK_DIR_REL)
  if (!existsSync(dir)) return []
  const files = readdirSync(dir)
    .filter((n) => /^\d{4}-\d{2}-\d{2}_研报信息流\.json$/.test(n))
    .sort()
    .reverse()
  if (files.length === 0) return []

  try {
    const feed = JSON.parse(readFileSync(join(dir, files[0]), 'utf-8'))
    const items = Array.isArray(feed?.报告) ? feed.报告 : []
    const feedDate = String(feed?.日期 ?? files[0].slice(0, 10))
    return items
      .map((r: Record<string, unknown>): IntelReport | null => {
        const 标题 = String(r?.标题 ?? '').trim()
        const 链接 = String(r?.链接 ?? '').trim()
        if (!标题 || !链接) return null
        const 分类 = r?.分类 === '政策文件' ? '政策文件' : '行业趋势'
        return {
          分类,
          关键词: String(r?.关键词 ?? ''),
          标题,
          链接,
          页数: typeof r?.页数 === 'number' ? r.页数 : 0,
          发布日期: String(r?.日期 ?? ''),
          VIP: Boolean(r?.VIP),
          抓取日期: feedDate
        }
      })
      .filter((r: IntelReport | null): r is IntelReport => r !== null)
  } catch {
    return []
  }
}

// ── 人工触发重抓（定时任务之外的手动「刷新」）────────────────────────────
// 拉起数据仓库的 run_reports.sh（脚本自带 Chrome 调试实例检测与拉起），
// 抓完与已有当日数据按「链接」去重合并：定时任务已抓到的保留，只补新增。

function fmtToday(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface ReportsFetchResult {
  ok: boolean
  新增条数: number
  说明: string
}

export async function fetchReportsNow(dataDir: string): Promise<ReportsFetchResult> {
  if (process.platform !== 'darwin') {
    return { ok: false, 新增条数: 0, 说明: '研报抓取依赖管理员 Mac 上的登录态浏览器，本机不支持手动重抓——数据由管理员机每日更新' }
  }
  const script = join(dataDir, 'tools', 'intel-reports', 'run_reports.sh')
  if (!existsSync(script)) {
    return { ok: false, 新增条数: 0, 说明: '本数据仓库没有研报抓取管线（tools/intel-reports），无法手动重抓' }
  }

  const date = fmtToday()
  const feedPath = join(dataDir, TRACK_DIR_REL, `${date}_研报信息流.json`)

  // 抓取前快照：已有条目按链接留底，避免脚本整文件覆盖时丢掉旧数据
  let before: Record<string, unknown>[] = []
  if (existsSync(feedPath)) {
    try {
      const feed = JSON.parse(readFileSync(feedPath, 'utf-8'))
      if (Array.isArray(feed?.报告)) before = feed.报告
    } catch {
      // 损坏就当没有
    }
  }
  const beforeLinks = new Set(before.map((r) => String(r?.链接 ?? '')))

  const run = await new Promise<{ ok: boolean; output: string }>((resolve) => {
    const child = spawn('/bin/bash', [script, date], { cwd: join(dataDir, 'tools', 'intel-reports') })
    let out = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ ok: false, output: out + '\n抓取超时（300秒）' })
    }, 300_000)
    child.stdout.on('data', (d) => (out += String(d)))
    child.stderr.on('data', (d) => (out += String(d)))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0 && out.includes('OK:'), output: out })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, output: String(err) })
    })
  })

  if (!run.ok) {
    const needsLogin = /未登录|登录|验证/.test(run.output)
    return {
      ok: false,
      新增条数: 0,
      说明: needsLogin
        ? '抓取失败：需要在弹出的调试 Chrome 里登录 sgpjbg 会员（或通过人机验证）后再点一次「刷新」'
        : `抓取失败：${run.output.trim().slice(-120) || '未知错误'}`
    }
  }

  // 去重合并：新抓的为主，把旧有而新抓缺失的条目补回（按链接去重）
  let merged = 0
  try {
    const feed = JSON.parse(readFileSync(feedPath, 'utf-8'))
    const fresh: Record<string, unknown>[] = Array.isArray(feed?.报告) ? feed.报告 : []
    const freshLinks = new Set(fresh.map((r) => String(r?.链接 ?? '')))
    const carried = before.filter((r) => !freshLinks.has(String(r?.链接 ?? '')))
    const 新增 = fresh.filter((r) => !beforeLinks.has(String(r?.链接 ?? ''))).length
    if (carried.length > 0) {
      const tmp = `${feedPath}.tmp`
      writeFileSync(tmp, JSON.stringify({ ...feed, 报告: [...fresh, ...carried] }, null, 2), 'utf-8')
      renameSync(tmp, feedPath)
    }
    merged = 新增
  } catch {
    return { ok: true, 新增条数: 0, 说明: '已重新抓取（结果文件解析异常，请点刷新查看）' }
  }
  return { ok: true, 新增条数: merged, 说明: merged > 0 ? `已重新抓取，新增 ${merged} 份研报（已与定时任务数据去重）` : '已重新抓取，无新增（与定时任务数据一致）' }
}
