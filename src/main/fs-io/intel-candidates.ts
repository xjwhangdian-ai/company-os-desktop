import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IntelCandidate, IntelConfirmResult } from '@shared/agent-types'
import { ensureBiddingProjectSkeleton } from './upload-router'
import { readProjectCard, saveProjectCard } from './bidding-workflow'
import { extractZjgovParams } from './intel-source'

// ============ intel 分身推送的招投标信息流：人工确认后才建招投标项目卡 ============
// 数据源（都在 outputs/09_情报_intel/招投标每日追踪/，由每日管线与 intel 分身产出）：
//   {日期}_信息流.json —— 四平台全量抓取，按 采购意向/意见征询/采购公告/采购结果公告 分类（daily_aggregate.py --feed-json）
//   {日期}_候选项目.json —— intel 分身标注的"有相关度"条目（相关度/理由/标签），按项目名合并到信息流上
// 处理状态：候选项目处理状态.json（App 托管——已确认/已忽略的不再出现在待确认列表）

const TRACK_DIR_REL = join('outputs', '09_情报_intel', '招投标每日追踪')
const OUTPUTS_BIDDING_REL = join('outputs', '03_招投标_bidding')
const STATE_FILE = '候选项目处理状态.json'
const FEED_FILES = 3
const CURATED_FILES = 14

type CandidateState = Record<string, { 动作: '已确认' | '已忽略'; 时间: number; 项目文件夹?: string }>

function statePath(dataDir: string): string {
  return join(dataDir, TRACK_DIR_REL, STATE_FILE)
}

function readState(dataDir: string): CandidateState {
  const p = statePath(dataDir)
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return {}
  }
}

function writeState(dataDir: string, state: CandidateState): void {
  const p = statePath(dataDir)
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
  renameSync(tmp, p)
}

function candidateKey(date: string, name: string): string {
  return `${date}|${name}`
}

/** intel 分身旧清单用的短类型 → 信息流的四类正名 */
const TYPE_ALIAS: Record<string, IntelCandidate['类型']> = {
  意向: '采购意向',
  招标: '采购公告',
  中标: '采购结果公告',
  采购意向: '采购意向',
  意见征询: '意见征询',
  采购公告: '采购公告',
  采购结果公告: '采购结果公告'
}

function listTrackFiles(dataDir: string, suffix: string, limit: number): { date: string; path: string }[] {
  const dir = join(dataDir, TRACK_DIR_REL)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => new RegExp(`^\\d{4}-\\d{2}-\\d{2}_${suffix}\\.json$`).test(n))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((n) => ({ date: n.slice(0, 10), path: join(dir, n) }))
}

/** 全量扫描：信息流（最近几天全部条目）+ intel 候选清单（相关度标注，按 key 合并） */
function scanAllCandidates(dataDir: string): IntelCandidate[] {
  const byKey = new Map<string, IntelCandidate>()

  for (const f of listTrackFiles(dataDir, '信息流', FEED_FILES)) {
    try {
      const feed = JSON.parse(readFileSync(f.path, 'utf-8'))
      const items = Array.isArray(feed?.项目) ? feed.项目 : []
      for (const raw of items) {
        const name = String(raw?.项目名称 ?? '').trim()
        if (!name) continue
        const key = candidateKey(f.date, name)
        byKey.set(key, {
          key,
          日期: f.date,
          类型: TYPE_ALIAS[String(raw?.类型 ?? '')] ?? '采购公告',
          项目名称: name,
          采购单位: String(raw?.采购单位 ?? ''),
          预算: String(raw?.预算 ?? ''),
          中标单位: String(raw?.中标单位 ?? ''),
          区县: '',
          标签: '',
          链接: String(raw?.链接 ?? ''),
          平台: String(raw?.平台 ?? ''),
          台州公安: Boolean(raw?.台州公安),
          相关度: null,
          理由: ''
        })
      }
    } catch {
      // 单日信息流损坏不影响其余日期
    }
  }

  for (const f of listTrackFiles(dataDir, '候选项目', CURATED_FILES)) {
    try {
      const arr = JSON.parse(readFileSync(f.path, 'utf-8'))
      if (!Array.isArray(arr)) continue
      for (const raw of arr) {
        const name = String(raw?.项目名称 ?? '').trim()
        if (!name) continue
        const key = candidateKey(f.date, name)
        const 相关度 = raw?.相关度 === '高' ? '高' : '中'
        const 理由 = String(raw?.一句话理由 ?? raw?.理由 ?? '')
        const 标签 = String(raw?.标签 ?? '')
        const 区县 = String(raw?.区县 ?? '')
        const existing = byKey.get(key)
        if (existing) {
          existing.相关度 = 相关度
          existing.理由 = 理由
          if (标签) existing.标签 = 标签
          if (区县) existing.区县 = 区县
        } else {
          byKey.set(key, {
            key,
            日期: f.date,
            类型: TYPE_ALIAS[String(raw?.类型 ?? '')] ?? '采购公告',
            项目名称: name,
            采购单位: String(raw?.采购单位 ?? ''),
            预算: typeof raw?.预算_万元 === 'number' ? `${raw.预算_万元}万元` : String(raw?.预算 ?? ''),
            中标单位: '',
            区县,
            标签,
            链接: String(raw?.链接 ?? ''),
            平台: '',
            台州公安: false,
            相关度,
            理由
          })
        }
      }
    } catch {
      // 单个清单损坏不影响其余日期
    }
  }

  return [...byKey.values()]
}

const REL_RANK = { 高: 0, 中: 1 } as const

/** 待确认列表：过滤掉已确认/已忽略的；日期新在前，同日相关度高在前 */
export function listIntelCandidates(dataDir: string): IntelCandidate[] {
  const state = readState(dataDir)
  return scanAllCandidates(dataDir)
    .filter((c) => !state[c.key])
    .sort((a, b) => {
      if (a.日期 !== b.日期) return a.日期 < b.日期 ? 1 : -1
      const ra = a.相关度 ? REL_RANK[a.相关度] : 2
      const rb = b.相关度 ? REL_RANK[b.相关度] : 2
      return ra - rb
    })
}

export function ignoreIntelCandidate(dataDir: string, key: string): void {
  const state = readState(dataDir)
  state[key] = { 动作: '已忽略', 时间: Date.now() }
  writeState(dataDir, state)
}

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '').slice(0, 60) || '未命名项目'
}

/** 找可复用的既有项目文件夹（聊天侧 /跟进项目 可能已用短名建过档），找不到就按候选派生新名 */
function resolveProjectFolder(dataDir: string, c: IntelCandidate): string {
  const cleanName = sanitizeName(c.项目名称)
  const root = join(dataDir, OUTPUTS_BIDDING_REL)
  if (existsSync(root)) {
    for (const f of readdirSync(root)) {
      if (!/^\d{4}-\d{2}-\d{2}_/.test(f) || !statSync(join(root, f)).isDirectory()) continue
      const existing = f.slice(11)
      if (existing.length >= 6 && (cleanName.includes(existing) || existing.includes(cleanName))) return f
    }
  }
  return `${c.日期}_${cleanName}`
}

function writeIntelSourceNote(dataDir: string, folderName: string, c: IntelCandidate): void {
  const p = join(dataDir, OUTPUTS_BIDDING_REL, folderName, '00_情报来源.md')
  if (existsSync(p)) return
  writeFileSync(
    p,
    [
      `# 情报来源 · ${c.项目名称}`,
      '',
      `- 公告链接：${c.链接 || '待确认'}`,
      `- 公告类型：${c.类型}（${c.日期}）`,
      `- 来源平台：${c.平台 || '待确认'}`,
      `- 区县：${c.区县 || '待确认'}`,
      `- 标签：${c.标签 || '—'}｜相关度：${c.相关度 ?? '未标注'}`,
      `- 推送理由：${c.理由 || '—'}`,
      `- 确认方式：工作台「行业情报」页人工确认`,
      ''
    ].join('\n'),
    'utf-8'
  )
}

/** 信息流的预算原文（如 "¥500.0万"）→ 项目卡预算金额字段 */
function normalizeBudget(raw: string): string {
  return raw.replace(/^[¥￥\s]+/, '').trim()
}

/** 机读溯源 sidecar：招投标分身的「下载招标文件」按钮与项目名超链接都读它 */
function writeSourceSidecar(dataDir: string, folderName: string, c: IntelCandidate): void {
  const params = extractZjgovParams(c.链接)
  const p = join(dataDir, OUTPUTS_BIDDING_REL, folderName, '_情报来源.json')
  const payload: Record<string, unknown> = {
    公告链接: c.链接 || '',
    来源平台: c.平台 || '',
    公告类型: c.类型
  }
  if (params) {
    payload.articleId = params.articleId
    payload.categoryCode = params.categoryCode
  }
  writeFileSync(p, JSON.stringify(payload, null, 2), 'utf-8')
}

/**
 * 人工确认候选项目：建两侧分桶骨架 → 项目卡自动填业主单位/预算金额（只补空字段，人工填过的不动）
 * → 落 00_情报来源.md（人读）+ _情报来源.json（机读，供招投标页下载按钮用）。
 * 招标文件不在此下载——由招投标分身项目详情的「下载招标文件」按钮按需下载（登录感知）。
 */
export function confirmIntelCandidate(dataDir: string, key: string): IntelConfirmResult {
  const candidate = scanAllCandidates(dataDir).find((c) => c.key === key)
  if (!candidate) return { ok: false, 项目文件夹: '', 说明: '候选项目不存在（清单可能已更新），请刷新' }

  const folderName = resolveProjectFolder(dataDir, candidate)
  ensureBiddingProjectSkeleton(dataDir, folderName)

  const card = readProjectCard(dataDir, folderName) ?? {
    业主单位: '',
    招标编号: '',
    预算金额: '',
    我方报价: '',
    保证金: '',
    投标截止日: '',
    开标日: '',
    状态: '跟进中' as const,
    备注: '',
    更新时间: Date.now()
  }
  if (!card.业主单位 && candidate.采购单位 && candidate.采购单位 !== '待确认') card.业主单位 = candidate.采购单位
  if (!card.预算金额 && candidate.预算) card.预算金额 = normalizeBudget(candidate.预算)
  saveProjectCard(dataDir, folderName, card)
  writeIntelSourceNote(dataDir, folderName, candidate)
  writeSourceSidecar(dataDir, folderName, candidate)

  const state = readState(dataDir)
  state[key] = { 动作: '已确认', 时间: Date.now(), 项目文件夹: folderName }
  writeState(dataDir, state)

  const canDownload = extractZjgovParams(candidate.链接) !== null
  return {
    ok: true,
    项目文件夹: folderName,
    说明: canDownload
      ? `已建档「${candidate.项目名称}」并进入招投标台账；在招投标页点「下载招标文件」即可抓取招标文件`
      : `已建档「${candidate.项目名称}」并进入招投标台账；该来源需在招投标页点公告链接手动下载招标文件`
  }
}
