import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// ============ 招投标信息的"兴趣关键词" ============
// 命中关键词的公告在「行业情报 · 招投标信息」里标红、计入「只看相关」筛选。
// 默认是公安系统一组词；用户可在工作台增删（存数据仓库、随公司走，不进安装包）。
// 匹配发生在"读列表"时而不是"抓取"时——改完关键词立即生效，无需重抓。

const KEYWORDS_FILE_REL = join('outputs', '09_情报_intel', '兴趣关键词.json')

export const DEFAULT_INTEL_KEYWORDS = ['公安', '交警', '交通警察', '特警', '巡特警', '海警', '消防', '应急管理']

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
