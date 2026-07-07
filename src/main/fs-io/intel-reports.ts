import { existsSync, readdirSync, readFileSync } from 'node:fs'
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
