import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { IntelKeywordGroups } from '@shared/agent-types'

// ============ 招投标信息的"关键词"（抓取筛选 + 标红）============
// 双重作用：①抓取筛选——抓取时只保留 项目名称/采购单位/区县 命中任一关键词的公告；
// ②展示标红——列表里显示命中的词并计入「只看相关」。
// 默认词库整合自原黄药师管线 keywords_config.json（安防智能化 + 警用装备 + 警用采购部门）；
// 用户可在工作台增删改（存数据目录、随公司走，不进安装包）。

const KEYWORDS_FILE_REL = join('outputs', '09_情报_intel', '兴趣关键词.json')

/** 整合自 ~/.openclaw/.../zjgov-fetcher/scripts/keywords_config.json（2026-07-26）：
 * 安防/智能化/弱电 42 词 + 警用装备 42 词 + 警用采购部门 19 词，去重合并 */
export const DEFAULT_ORG_KEYWORDS = [
  '公安局', '公安分局', '公安', '交通警察', '交警', '特警', '巡特警', '海警',
  '应急管理局', '应急管理', '应急',
  '消防救援', '消防支队', '消防大队', '消防',
  '交通运输局', '交通局',
  '城市管理局', '城管局', '综合行政执法',
  '司法局', '监狱', '戒毒'
]

export const DEFAULT_CONTENT_KEYWORDS = [
  // 安防/智能化/弱电
  '智能化', '监控', '安防', '音视频', 'LED', 'LCD', '网络', '弱电',
  '门禁', '道闸', '停车场', '报警', '视频', '对讲', '一卡通',
  '广播', '会议', '显示', '大屏', '投影', '音响', '扩声',
  '安全', '防范', '布线', '机房', '信息化', '数字化', '智慧',
  '安检', '闸机', '考勤', '访客', '人脸', '识别',
  '教学', '教育', '校园', '监所', '法院', '检察院',
  // 警用装备
  '警用', '警服', '警靴', '警鞋', '警帽', '警徽', '警衔',
  '警械', '警棍', '手铐', '盾牌', '防暴', '防弹',
  '防护背心', '反光背心', '防刺服', '防刺背心', '防割手套',
  '执勤服', '作训服', '战训服', '特警服', '骑行服',
  '执法记录仪', '对讲机', '强光手电', '催泪', '喷射器',
  '救援', '抢险', '救灾', '应急照明', '破拆', '生命探测', '搜救',
  '警戒带', '路锥', '反光', '警示'
]

export const DEFAULT_INTEL_KEYWORDS = [...DEFAULT_ORG_KEYWORDS, ...DEFAULT_CONTENT_KEYWORDS]

function cleanKeywords(input: unknown): string[] {
  const items = Array.isArray(input) ? input : []
  return [...new Set(items.map((k) => String(k).trim()).filter((k) => k.length > 0 && k.length <= 20))]
}

/** 兼容旧版扁平关键词文件：已知单位词归入「招投标单位」，其余归入「招标内容」。 */
export function getIntelKeywordGroups(dataDir: string): IntelKeywordGroups {
  const raw = readRaw(dataDir)
  const org = cleanKeywords(raw.招投标单位关键词)
  const content = cleanKeywords(raw.招标内容关键词)
  if (org.length > 0 || content.length > 0) {
    return {
      招投标单位: org.length > 0 ? org : [...DEFAULT_ORG_KEYWORDS],
      招标内容: content.length > 0 ? content : [...DEFAULT_CONTENT_KEYWORDS]
    }
  }
  const legacy = cleanKeywords(raw.关键词)
  if (legacy.length === 0) return { 招投标单位: [...DEFAULT_ORG_KEYWORDS], 招标内容: [...DEFAULT_CONTENT_KEYWORDS] }
  const orgSet = new Set(DEFAULT_ORG_KEYWORDS)
  const inferredOrg = legacy.filter((k) => orgSet.has(k))
  return { 招投标单位: inferredOrg, 招标内容: legacy.filter((k) => !orgSet.has(k)) }
}

export function getIntelKeywords(dataDir: string): string[] {
  const groups = getIntelKeywordGroups(dataDir)
  return [...new Set([...groups.招投标单位, ...groups.招标内容])]
}

function readRaw(dataDir: string): Record<string, unknown> {
  const p = join(dataDir, KEYWORDS_FILE_REL)
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return {}
  }
}

function writeRaw(dataDir: string, data: Record<string, unknown>): void {
  const p = join(dataDir, KEYWORDS_FILE_REL)
  mkdirSync(dirname(p), { recursive: true })
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, p)
}

export function setIntelKeywords(dataDir: string, keywords: string[]): string[] {
  const orgSet = new Set(DEFAULT_ORG_KEYWORDS)
  const cleaned = cleanKeywords(keywords)
  return flattenGroups(setIntelKeywordGroups(dataDir, {
    招投标单位: cleaned.filter((k) => orgSet.has(k)),
    招标内容: cleaned.filter((k) => !orgSet.has(k))
  }))
}

function flattenGroups(groups: IntelKeywordGroups): string[] {
  return [...new Set([...groups.招投标单位, ...groups.招标内容])]
}

export function setIntelKeywordGroups(dataDir: string, groups: IntelKeywordGroups): IntelKeywordGroups {
  const next: IntelKeywordGroups = {
    招投标单位: cleanKeywords(groups.招投标单位),
    招标内容: cleanKeywords(groups.招标内容)
  }
  // 同步保留扁平字段，确保旧版本客户端仍能读取。
  writeRaw(dataDir, {
    ...readRaw(dataDir),
    招投标单位关键词: next.招投标单位,
    招标内容关键词: next.招标内容,
    关键词: flattenGroups(next),
    更新时间: Date.now()
  })
  return next
}

// ── 关键词学习：跟进/忽略反馈驱动词库优化 ────────────────────────────────
// 用户每次点「跟进」或「忽略」，记录该项目的命中词与名称样本；
// 「⚙ 关键词」面板据此给两类建议（人工一键采纳，不自动改词库）：
//   建议添加——跟进样本里反复出现、但还不在词库的词片段（说明你关心的方向词库没覆盖全）
//   建议移除——命中它的项目全被忽略≥3次、从没被跟进过的词（说明它只带来噪音）

interface FeedbackSample {
  项目名称: string
  命中关键词: string | null
  时间: number
}

interface Learning {
  样本: { 跟进: FeedbackSample[]; 忽略: FeedbackSample[] }
  词统计: Record<string, { 跟进: number; 忽略: number }>
}

function readLearning(dataDir: string): Learning {
  const raw = readRaw(dataDir)
  const l = (raw.学习 ?? {}) as Partial<Learning>
  return {
    样本: { 跟进: l.样本?.跟进 ?? [], 忽略: l.样本?.忽略 ?? [] },
    词统计: l.词统计 ?? {}
  }
}

/** 跟进/忽略动作回写学习数据（confirm/ignore 时由主进程自动调用） */
export function recordKeywordFeedback(
  dataDir: string,
  sample: { 项目名称: string; 采购单位?: string; 动作: '跟进' | '忽略' }
): void {
  const keywords = getIntelKeywords(dataDir)
  const hit = matchIntelKeyword(`${sample.项目名称}${sample.采购单位 ?? ''}`, keywords)
  const learning = readLearning(dataDir)
  const list = learning.样本[sample.动作]
  list.push({ 项目名称: sample.项目名称, 命中关键词: hit, 时间: Date.now() })
  if (list.length > 100) list.splice(0, list.length - 100)
  if (hit) {
    const st = learning.词统计[hit] ?? { 跟进: 0, 忽略: 0 }
    st[sample.动作] += 1
    learning.词统计[hit] = st
  }
  writeRaw(dataDir, { ...readRaw(dataDir), 学习: learning })
}

/** 常见套话/地名，不作为建议词 */
const SUGGEST_STOP = new Set([
  '采购', '项目', '公告', '招标', '投标', '工程', '建设', '有限', '公司', '中心', '服务',
  '管理', '单位', '设备', '系统', '一批', '相关', '进行', '本次', '需求', '意向', '结果',
  '台州', '椒江', '黄岩', '路桥', '温岭', '临海', '玉环', '天台', '仙居', '三门', '浙江',
  '市区', '街道', '学校', '医院', '中学', '小学', '幼儿园'
])

export interface KeywordSuggestions {
  建议添加: { 词: string; 次数: number }[]
  建议移除: { 词: string; 忽略次数: number }[]
}

/** 基于跟进/忽略样本计算词库优化建议（只建议，不自动改） */
export function getKeywordSuggestions(dataDir: string): KeywordSuggestions {
  const keywords = getIntelKeywords(dataDir)
  const learning = readLearning(dataDir)

  // 建议添加：跟进样本项目名称里的 2-4 字中文片段，出现≥2次且与现有词库互不包含
  const freq = new Map<string, number>()
  for (const s of learning.样本.跟进) {
    const name = s.项目名称
    const seen = new Set<string>()
    for (let len = 2; len <= 4; len++) {
      for (let i = 0; i + len <= name.length; i++) {
        const frag = name.slice(i, i + len)
        if (!/^[\u4e00-\u9fa5]+$/.test(frag)) continue
        if (seen.has(frag)) continue
        seen.add(frag)
        freq.set(frag, (freq.get(frag) ?? 0) + 1)
      }
    }
  }
  const candidates = [...freq.entries()]
    .filter(([w, n]) => n >= 2 && !SUGGEST_STOP.has(w))
    .filter(([w]) => !keywords.some((k) => k.includes(w) || w.includes(k)))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
  // 去掉互为子串的重复建议（留长的）
  const picked: { 词: string; 次数: number }[] = []
  for (const [w, n] of candidates) {
    if (picked.some((p2) => p2.词.includes(w) || w.includes(p2.词))) continue
    picked.push({ 词: w, 次数: n })
    if (picked.length >= 5) break
  }

  // 建议移除：忽略≥3次、从没被跟进过的词
  const removals = Object.entries(learning.词统计)
    .filter(([w, st]) => keywords.includes(w) && st.忽略 >= 3 && st.跟进 === 0)
    .map(([w, st]) => ({ 词: w, 忽略次数: st.忽略 }))
    .sort((a, b) => b.忽略次数 - a.忽略次数)
    .slice(0, 5)

  return { 建议添加: picked, 建议移除: removals }
}

/** 返回文本命中的第一个关键词；未命中返回 null */
export function matchIntelKeyword(text: string, keywords: string[]): string | null {
  for (const k of keywords) {
    if (text.includes(k)) return k
  }
  return null
}
