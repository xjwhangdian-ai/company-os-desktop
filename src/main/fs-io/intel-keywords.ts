import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// ============ 招投标信息的"关键词"（抓取筛选 + 标红）============
// 双重作用：①抓取筛选——抓取时只保留 项目名称/采购单位/区县 命中任一关键词的公告；
// ②展示标红——列表里显示命中的词并计入「只看相关」。
// 默认词库整合自原黄药师管线 keywords_config.json（安防智能化 + 警用装备 + 警用采购部门）；
// 用户可在工作台增删改（存数据目录、随公司走，不进安装包）。

const KEYWORDS_FILE_REL = join('outputs', '09_情报_intel', '兴趣关键词.json')

/** 整合自 ~/.openclaw/.../zjgov-fetcher/scripts/keywords_config.json（2026-07-26）：
 * 安防/智能化/弱电 42 词 + 警用装备 42 词 + 警用采购部门 19 词，去重合并 */
export const DEFAULT_INTEL_KEYWORDS = [
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
  '警戒带', '路锥', '反光', '警示',
  // 警用采购部门/单位
  '公安局', '公安分局', '公安', '交通警察', '交警', '特警', '巡特警', '海警',
  '应急管理局', '应急管理', '应急',
  '消防救援', '消防支队', '消防大队', '消防',
  '交通运输局', '交通局',
  '城市管理局', '城管局', '综合行政执法',
  '司法局', '监狱', '戒毒'
]

export function getIntelKeywords(dataDir: string): string[] {
  const p = join(dataDir, KEYWORDS_FILE_REL)
  if (!existsSync(p)) return [...DEFAULT_INTEL_KEYWORDS]
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8'))
    const arr = Array.isArray(raw?.关键词) ? raw.关键词 : []
    const cleaned = arr.map((k: unknown) => String(k).trim()).filter((k: string) => k.length > 0)
    return cleaned.length > 0 ? cleaned : [...DEFAULT_INTEL_KEYWORDS]
  } catch {
    return [...DEFAULT_INTEL_KEYWORDS]
  }
}

export function setIntelKeywords(dataDir: string, keywords: string[]): string[] {
  const cleaned = [...new Set(keywords.map((k) => k.trim()).filter((k) => k.length > 0 && k.length <= 20))]
  const p = join(dataDir, KEYWORDS_FILE_REL)
  mkdirSync(dirname(p), { recursive: true })
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify({ 关键词: cleaned, 更新时间: Date.now() }, null, 2), 'utf-8')
  renameSync(tmp, p)
  return cleaned
}

/** 返回文本命中的第一个关键词；未命中返回 null */
export function matchIntelKeyword(text: string, keywords: string[]): string | null {
  for (const k of keywords) {
    if (text.includes(k)) return k
  }
  return null
}
