import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IntelFeedType, TenderSource } from '@shared/agent-types'
import { INTEL_FEED_TYPES } from '@shared/agent-types'

function asFeedType(v: string): IntelFeedType | '' {
  return (INTEL_FEED_TYPES as readonly string[]).includes(v) ? (v as IntelFeedType) : ''
}

/** 从 00_情报来源.md 的「- 公告类型：采购公告（2026-07-08）」行解析类型 */
function readTypeFromNote(dir: string): IntelFeedType | '' {
  const mdPath = join(dir, '00_情报来源.md')
  if (!existsSync(mdPath)) return ''
  try {
    const md = readFileSync(mdPath, 'utf-8')
    return asFeedType((md.match(/公告类型[：:]\s*([^（(\s]+)/)?.[1] ?? '').trim())
  } catch {
    return ''
  }
}

// ============ 项目情报来源读取（无其它 fs-io 依赖，避免循环引用）============
// 情报推送来的项目在 outputs 侧存：
//   _情报来源.json（机读，新版确认写）—— {公告链接, 来源平台, articleId, categoryCode}
//   00_情报来源.md（人读，含「- 公告链接：...」行）—— 旧版确认只有它，作兜底解析
// 招标文件下载与项目名超链接都靠这里拿到公告链接。

const OUTPUTS_BIDDING_REL = join('outputs', '03_招投标_bidding')
const ZJGOV_HOST = 'zfcg.czt.zj.gov.cn'

export function extractZjgovParams(link: string): { articleId: string; categoryCode: string } | null {
  if (!link || !link.includes(ZJGOV_HOST)) return null
  const aid = link.match(/[?&]articleId=([^&\s]+)/)?.[1]
  const code = link.match(/[?&]categoryCode=([^&\s]+)/)?.[1]
  if (!aid || !code) return null
  return { articleId: decodeURIComponent(aid), categoryCode: decodeURIComponent(code) }
}

/** 读项目情报来源：优先 _情报来源.json，无则从 00_情报来源.md 解析公告链接/来源平台。手工项目返回 null。 */
export function readTenderSource(dataDir: string, folderName: string): TenderSource | null {
  const dir = join(dataDir, OUTPUTS_BIDDING_REL, folderName)
  const jsonPath = join(dir, '_情报来源.json')
  if (existsSync(jsonPath)) {
    try {
      const s = JSON.parse(readFileSync(jsonPath, 'utf-8'))
      const link = String(s?.公告链接 ?? '')
      let 公告类型 = asFeedType(String(s?.公告类型 ?? ''))
      // 旧版确认写的 sidecar 没有公告类型字段——退回人读版 00_情报来源.md 里解析，老项目也能正确分类
      if (!公告类型) 公告类型 = readTypeFromNote(dir)
      return {
        公告链接: link,
        来源平台: String(s?.来源平台 ?? ''),
        可自动下载: extractZjgovParams(link) !== null,
        公告类型
      }
    } catch {
      // 落到 md 兜底
    }
  }
  const mdPath = join(dir, '00_情报来源.md')
  if (existsSync(mdPath)) {
    try {
      const md = readFileSync(mdPath, 'utf-8')
      const link = md.match(/公告链接[：:]\s*(\S+)/)?.[1] ?? ''
      const platform = md.match(/来源平台[：:]\s*(\S+)/)?.[1] ?? ''
      // md 里形如「- 公告类型：采购公告（2026-07-06）」
      const 公告类型 = asFeedType((md.match(/公告类型[：:]\s*([^（(\s]+)/)?.[1] ?? '').trim())
      if (link) return { 公告链接: link, 来源平台: platform, 可自动下载: extractZjgovParams(link) !== null, 公告类型 }
    } catch {
      // ignore
    }
  }
  return null
}
