import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IntelCandidate, IntelConfirmResult, PriorityIntelProject } from '@shared/agent-types'
import { ensureBiddingProjectSkeleton } from './upload-router'
import { migrateTrackDir } from './intel-fetch'
import { readProjectCard, saveProjectCard } from './bidding-workflow'
import { extractZjgovParams } from './intel-source'
import { getIntelKeywordGroups, matchIntelKeyword, recordKeywordFeedback } from './intel-keywords'

// ============ intel 分身推送的招投标信息流：人工确认后才建招投标项目卡 ============
// 数据源（都在 outputs/03_招投标_bidding/招投标每日追踪/，由每日管线与 intel 分身产出）：
//   {日期}_信息流.json —— 四平台全量抓取，按 采购意向/意见征询/采购公告/采购结果公告 分类（daily_aggregate.py --feed-json）
//   {日期}_候选项目.json —— intel 分身标注的"有相关度"条目（相关度/理由/标签），按项目名合并到信息流上
// 处理状态：候选项目处理状态.json（App 托管——已确认/已忽略的不再出现在待确认列表）

const TRACK_DIR_REL = join('outputs', '03_招投标_bidding', '招投标每日追踪')
const OUTPUTS_BIDDING_REL = join('outputs', '03_招投标_bidding')
const PRIORITY_DIR_REL = join(OUTPUTS_BIDDING_REL, '重点项目')
const STATE_FILE = '候选项目处理状态.json'
const FEED_FILES = 3
const CURATED_FILES = 14

type CandidateState = Record<string, { 动作: '已确认' | '已忽略'; 时间: number; 项目文件夹?: string; 类型?: string }>

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

function priorityRoot(dataDir: string): string {
  return join(dataDir, PRIORITY_DIR_REL)
}

function priorityJsonPath(dataDir: string, folder: string): string {
  return join(priorityRoot(dataDir), folder, '重点项目.json')
}

function readPriorityProjects(dataDir: string): PriorityIntelProject[] {
  const root = priorityRoot(dataDir)
  if (!existsSync(root)) return []
  const projects: PriorityIntelProject[] = []
  for (const folder of readdirSync(root)) {
    const path = priorityJsonPath(dataDir, folder)
    try {
      if (!statSync(join(root, folder)).isDirectory() || !existsSync(path)) continue
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<PriorityIntelProject>
      if (!raw.项目 || typeof raw.项目.项目名称 !== 'string') continue
      projects.push({ 文件夹: folder, 路径: join(root, folder), 重点时间: Number(raw.重点时间) || 0, 项目: raw.项目 })
    } catch {
      // 人工正在整理或单个重点项目文件损坏时，不影响其他项目。
    }
  }
  return projects.sort((a, b) => b.重点时间 - a.重点时间)
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
  migrateTrackDir(dataDir)
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
          中标金额: String(raw?.中标金额 ?? ''),
          区县: String(raw?.区县 ?? ''),
          标签: '',
          征询截止: String(raw?.征询截止 ?? ''),
          需求概况: String(raw?.需求概况 ?? ''),
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

/**
 * 待确认列表。三层处理：
 * ① 跨天去重——同一项目（名称+类型相同）在多天信息流里重复出现时只留最新一条（相关度标注就高合并）；
 * ② 状态按名匹配——忽略过的项目名，后续任何日期/类型再出现都不再打扰；确认过的默认也不再出现；
 * ③ 升级跟踪——例外：已确认跟进的项目（如意见征询阶段）后续发布「采购公告」时，
 *    作为重点条目重新出现并标 跟进升级，置顶提醒；确认后按名称归档进原项目档。
 */
export function listIntelCandidates(dataDir: string): IntelCandidate[] {
  const state = readState(dataDir)
  const keywordGroups = getIntelKeywordGroups(dataDir)
  const priorityKeys = new Set(readPriorityProjects(dataDir).map((p) => p.项目.key))

  // 状态按名索引：忽略名单 + 每个名字已确认过的类型集合
  const ignoredNames = new Set<string>()
  const confirmedTypesByName = new Map<string, Set<string>>()
  for (const [key, st] of Object.entries(state)) {
    const name = key.slice(key.indexOf('|') + 1).trim()
    if (!name) continue
    if (st.动作 === '已忽略') ignoredNames.add(name)
    else {
      if (!confirmedTypesByName.has(name)) confirmedTypesByName.set(name, new Set())
      confirmedTypesByName.get(name)?.add(st.类型 ?? '')
    }
  }

  // 跨天去重：名称+类型 相同只留日期最新的一条；相关度标注从旧条目合并
  const byNameType = new Map<string, IntelCandidate>()
  for (const c of scanAllCandidates(dataDir)) {
    const nt = `${c.类型}|${c.项目名称.trim()}`
    const prev = byNameType.get(nt)
    if (!prev || prev.日期 < c.日期) {
      if (prev?.相关度 && !c.相关度) {
        c.相关度 = prev.相关度
        c.理由 = c.理由 || prev.理由
        c.标签 = c.标签 || prev.标签
      }
      byNameType.set(nt, c)
    } else if (c.相关度 && !prev.相关度) {
      prev.相关度 = c.相关度
      prev.理由 = prev.理由 || c.理由
      prev.标签 = prev.标签 || c.标签
    }
  }

  const out: IntelCandidate[] = []
  for (const c of byNameType.values()) {
    const name = c.项目名称.trim()
    // 两类关键词独立匹配：单位只匹配采购单位，内容匹配项目名称+需求概况。
    const contentText = `${c.项目名称}${c.需求概况 ?? ''}`
    c.命中单位关键词 = keywordGroups.招投标单位.filter((k) => c.采购单位.includes(k))
    c.命中内容关键词 = keywordGroups.招标内容.filter((k) => contentText.includes(k))
    c.命中关键词 =
      matchIntelKeyword(c.采购单位, keywordGroups.招投标单位) ??
      matchIntelKeyword(contentText, keywordGroups.招标内容)
    c.已重点 = priorityKeys.has(c.key)
    if (state[c.key]) continue // 本条已处理过
    if (ignoredNames.has(name)) continue // 忽略过的项目名不再打扰
    const confirmedTypes = confirmedTypesByName.get(name)
    if (confirmedTypes) {
      // 已确认跟进的项目：只有"正式采购公告"作为升级提醒重新出现（此前确认的不是公告阶段时）
      if (c.类型 === '采购公告' && !confirmedTypes.has('采购公告')) {
        c.跟进升级 = true
        out.push(c)
      }
      continue
    }
    out.push(c)
  }

  return out.sort((a, b) => {
    if (Boolean(a.跟进升级) !== Boolean(b.跟进升级)) return a.跟进升级 ? -1 : 1
    if (a.日期 !== b.日期) return a.日期 < b.日期 ? 1 : -1
    const ra = a.相关度 ? REL_RANK[a.相关度] : 2
    const rb = b.相关度 ? REL_RANK[b.相关度] : 2
    return ra - rb
  })
}

/** 重点项目只从专用目录读取，日常情报清理不会触及；不提供应用内删除入口。 */
export function listPriorityIntelProjects(dataDir: string): PriorityIntelProject[] {
  return readPriorityProjects(dataDir)
}

/** 标记重点：将当时的完整项目快照写入专用目录，重复点击不覆盖人工补充内容。 */
export function markIntelCandidatePriority(
  dataDir: string,
  key: string
): { ok: boolean; 文件夹: string; 说明: string } {
  const candidate = scanAllCandidates(dataDir).find((c) => c.key === key)
  if (!candidate) return { ok: false, 文件夹: '', 说明: '项目信息不存在（每日清单可能已更新），请刷新后重试' }

  const groups = getIntelKeywordGroups(dataDir)
  candidate.命中单位关键词 = groups.招投标单位.filter((k) => candidate.采购单位.includes(k))
  candidate.命中内容关键词 = groups.招标内容.filter((k) => `${candidate.项目名称}${candidate.需求概况 ?? ''}`.includes(k))
  const existing = readPriorityProjects(dataDir).find((p) => p.项目.key === key)
  if (existing) return { ok: true, 文件夹: existing.文件夹, 说明: `「${candidate.项目名称}」已在重点项目中保留` }

  const folder = `${candidate.日期}_${sanitizeName(candidate.项目名称)}`
  const dir = join(priorityRoot(dataDir), folder)
  mkdirSync(dir, { recursive: true })
  const payload: PriorityIntelProject = { 文件夹: folder, 路径: dir, 重点时间: Date.now(), 项目: candidate }
  writeFileSync(priorityJsonPath(dataDir, folder), JSON.stringify(payload, null, 2), 'utf-8')
  writeFileSync(
    join(dir, '00_情报来源.md'),
    [
      `# 重点项目 · ${candidate.项目名称}`,
      '',
      `- 重点关注时间：${new Date(payload.重点时间).toLocaleString('zh-CN', { hour12: false })}`,
      `- 招投标单位：${candidate.采购单位 || '待确认'}`,
      `- 公告类型：${candidate.类型}（${candidate.日期}）`,
      `- 招标内容关键词：${candidate.命中内容关键词?.join('、') || '待确认'}`,
      `- 单位关键词：${candidate.命中单位关键词?.join('、') || '待确认'}`,
      `- 公告链接：${candidate.链接 || '待确认'}`,
      `- 预算：${candidate.预算 || '待确认'}`,
      ...(candidate.需求概况 ? [`- 需求概况：${candidate.需求概况}`] : []),
      '',
      '> 本目录不参与每日情报清理。若不再关注，请由人工直接删除本项目文件夹。',
      ''
    ].join('\n'),
    'utf-8'
  )
  return { ok: true, 文件夹: folder, 说明: `已加入重点项目；数据已永久保留在「重点项目/${folder}」` }
}

export function findIntelCandidateByKey(dataDir: string, key: string): IntelCandidate | null {
  return scanAllCandidates(dataDir).find((c) => c.key === key) ?? null
}

/** 中标公告「跟进」归档后标记已处理（从待确认列表消失）+ 关键词学习 */
export function markWinnerFollowed(dataDir: string, key: string): void {
  const state = readState(dataDir)
  const candidate = scanAllCandidates(dataDir).find((c) => c.key === key)
  state[key] = { 动作: '已确认', 时间: Date.now(), 类型: candidate?.类型 }
  writeState(dataDir, state)
  if (candidate) recordKeywordFeedback(dataDir, { 项目名称: candidate.项目名称, 采购单位: candidate.采购单位, 动作: '跟进' })
}

export function ignoreIntelCandidate(dataDir: string, key: string): void {
  const state = readState(dataDir)
  const candidate = scanAllCandidates(dataDir).find((c) => c.key === key)
  state[key] = { 动作: '已忽略', 时间: Date.now(), 类型: candidate?.类型 }
  writeState(dataDir, state)
  // 关键词学习：忽略动作回写样本与词统计（供「⚙ 关键词」面板生成移除建议）
  if (candidate) recordKeywordFeedback(dataDir, { 项目名称: candidate.项目名称, 采购单位: candidate.采购单位, 动作: '忽略' })
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
      ...(c.类型 === '意见征询' ? [`- ⚠️ 征询截止日：${c.征询截止 || '待确认——打开公告原文核对意见反馈截止时间'}`] : []),
      ...(c.需求概况 ? [`- 采购需求概况：${c.需求概况}`] : []),
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
  // 意见征询阶段的重点日期：征询/意见反馈截止日（错过就无法提意见影响需求了）
  if (candidate.类型 === '意见征询' && !card.征询截止日 && candidate.征询截止) card.征询截止日 = candidate.征询截止
  saveProjectCard(dataDir, folderName, card)
  writeIntelSourceNote(dataDir, folderName, candidate)
  writeSourceSidecar(dataDir, folderName, candidate)

  const state = readState(dataDir)
  state[key] = { 动作: '已确认', 时间: Date.now(), 项目文件夹: folderName, 类型: candidate.类型 }
  writeState(dataDir, state)
  // 关键词学习：跟进动作回写样本与词统计（供「⚙ 关键词」面板生成添加建议）
  recordKeywordFeedback(dataDir, { 项目名称: candidate.项目名称, 采购单位: candidate.采购单位, 动作: '跟进' })

  const canDownload = extractZjgovParams(candidate.链接) !== null
  return {
    ok: true,
    项目文件夹: folderName,
    说明: canDownload
      ? `已建档「${candidate.项目名称}」并进入招投标台账；在招投标页点「下载招标文件」即可抓取招标文件`
      : `已建档「${candidate.项目名称}」并进入招投标台账；该来源需在招投标页点公告链接手动下载招标文件`
  }
}
