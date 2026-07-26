import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// ============ App 内置招投标情报抓取（跨平台，mac/Windows 通用） ============
// 数据不走 git 同步：git 只管应用程序更新，情报数据由每台电脑的 App 自己抓。
// 三个纯 HTTP 平台直接抓：浙江政采（政采云）/ 台州公共资源（台州工程）/ 台州阳光采购。
// 乐采云需要登录态 Chrome、研报(sgpjbg)需要会员登录——仍只在管理员机的每日管线里跑。
// 产出与管理员机管线**同一格式**写 outputs/09_情报_intel/招投标每日追踪/{日期}_信息流.json，
// 按「项目名称」合并去重：已有条目（可能带更全的详情字段）永远保留，抓到的新条目只做补充。

const TRACK_DIR_REL = join('outputs', '09_情报_intel', '招投标每日追踪')
const FETCH_STATE_FILE = '_抓取状态.json'
/** 与三天保留策略对齐：抓最近三天窗口内的公告 */
const WINDOW_DAYS = 3
/** 距上次成功抓取不足该间隔时跳过（打开页面就触发，别把政府接口刷爆） */
const MIN_INTERVAL_MS = 30 * 60 * 1000

export interface FeedEntry {
  类型: '采购意向' | '意见征询' | '采购公告' | '采购结果公告'
  项目名称: string
  /** 只放真正的采购人名称；列表接口拿不到就留空（UI 显示"待确认"），绝不用区县名顶替 */
  采购单位: string
  /** 区县/地域归属（台州工程、阳光采购的列表接口只给这个） */
  区县: string
  预算: string
  中标单位: string
  中标金额: string
  /** 意见征询条目的征询/意见反馈截止日（YYYY-MM-DD，从详情页提取；提不到为空） */
  征询截止: string
  链接: string
  平台: string
  台州公安: boolean
  /** 归入哪天的信息流文件（YYYY-MM-DD） */
  日期: string
}

export interface IntelFetchResult {
  ok: boolean
  新增条数: number
  平台结果: string[]
  说明: string
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * 用 Electron 的 Chromium 网络栈发请求（政府网站 WAF 按 TLS 指纹拦非浏览器流量：
 * Node fetch 会被 zfcg 掐 TLS、被 tzztb 403，Chromium 栈是真实浏览器指纹）。
 * 网络路径**双路自动回退**：先走系统代理栈（net.fetch，机器配了 clash 等代理时随其分流），
 * 失败或被拒（非 2xx）再用强制直连的分区会话重试（等价管线 python 的 trust_env=False）。
 * 实测同一台机上三个政府站的可达路径各不相同，双路重试对管理员机/成员机通吃；
 * 没装代理的成员机上两路等价。兜底 globalThis.fetch 仅供脱离 Electron 的测试环境使用。
 */
let paths: { name: string; f: typeof fetch }[] | null = null
async function getPaths(): Promise<{ name: string; f: typeof fetch }[]> {
  if (paths) return paths
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { net, session } = require('electron') as typeof import('electron')
    const ses = session.fromPartition('intel-fetch-direct')
    await ses.setProxy({ proxyRules: 'direct://' })
    paths = [
      { name: '系统代理', f: net.fetch.bind(net) as typeof fetch },
      { name: '直连', f: ses.fetch.bind(ses) as typeof fetch }
    ]
  } catch {
    paths = [{ name: 'node', f: fetch }] // 非 Electron 环境（测试）
  }
  return paths
}

async function doFetch(url: string, init: RequestInit): Promise<Response> {
  const routes = await getPaths()
  let last: Response | null = null
  let lastErr: unknown = null
  for (const route of routes) {
    try {
      const resp = await route.f(url, init)
      if (resp.ok) return resp
      last = resp
    } catch (err) {
      lastErr = err
    }
  }
  if (last) return last
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

const POLICE_KW = ['公安', '交警', '交通警察', '特警', '巡特警', '海警', '消防', '应急管理']
const TZ_LOCATION_KW = ['台州', '椒江', '黄岩', '路桥', '温岭', '临海', '玉环', '天台', '仙居', '三门']
const YJZQ_TITLE_KW = ['意见征询', '征求意见', '需求公示', '采前公示']

function fmtDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 最近 N 天日期（含今天），新在前 */
function recentDates(n: number): string[] {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    out.push(fmtDate(d))
  }
  return out
}

/** 金额格式化，与管线 daily_aggregate.fmt_amount 对齐 */
function fmtAmount(val: unknown): string {
  if (val === null || val === undefined || val === '') return ''
  const v = parseFloat(String(val).replace(/[,，\s]/g, ''))
  if (!isFinite(v) || v <= 0) return ''
  if (v >= 10000) {
    const w = v / 10000
    if (w >= 10000) return `¥${(w / 10000).toFixed(2)}亿`
    return `¥${w.toFixed(1)}万`
  }
  return `¥${Math.round(v).toLocaleString('en-US')}`
}

function isPolice(text: string): boolean {
  return POLICE_KW.some((k) => text.includes(k))
}

/** 请求间礼貌延时（与 python 管线的 sleep 对齐），别把政府接口打限流 */
const politeDelay = (): Promise<void> => new Promise((r) => setTimeout(r, 400))

async function postJson(url: string, body: unknown, referer: string): Promise<unknown> {
  const resp = await doFetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Referer: referer },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.json()
}

// ── 平台一：浙江政采（政采云，zfcg.czt.zj.gov.cn）─────────────────────────

const ZJGOV_BASE = 'https://zfcg.czt.zj.gov.cn'
const ZJGOV_CATEGORIES: { 类型: FeedEntry['类型']; parentId: string; codes: string[]; titleLocation?: boolean }[] = [
  { 类型: '采购意向', parentId: '600007', codes: ['110-600268'] },
  { 类型: '采购公告', parentId: '600007', codes: ['110-684034', '110-511933'] },
  { 类型: '采购结果公告', parentId: '600007', codes: ['110-188043', '110-631167'] },
  // 意见征询类目 districtCode 常为空，用标题/采购单位里的台州区县词判归属
  { 类型: '意见征询', parentId: '115691', codes: ['110-328971'], titleLocation: true }
]

async function fetchZjgov(cutoffMs: number): Promise<FeedEntry[]> {
  const entries: FeedEntry[] = []
  for (const cat of ZJGOV_CATEGORIES) {
    for (const code of cat.codes) {
      for (let pageNo = 1; pageNo <= 3; pageNo++) {
        const data = (await postJson(
          `${ZJGOV_BASE}/portal/category`,
          { categoryCode: code, parentId: cat.parentId, pageNo, pageSize: 100 },
          `${ZJGOV_BASE}/site/category`
        )) as { success?: boolean; result?: { data?: { data?: Record<string, unknown>[] } } }
        const items = data?.result?.data?.data ?? []
        if (!data?.success || items.length === 0) break
        let anyFresh = false
        for (const it of items) {
          const pd = Number(it.publishDate ?? 0)
          if (pd < cutoffMs) continue
          anyFresh = true
          const title = String(it.title ?? '')
          const author = String(it.purchaseName ?? it.author ?? '')
          const dc = String(it.districtCode ?? '')
          const isTz = dc.startsWith('3310') || (cat.titleLocation && TZ_LOCATION_KW.some((k) => (title + author).includes(k)))
          if (!isTz) continue
          if (cat.titleLocation && !YJZQ_TITLE_KW.some((k) => title.includes(k))) continue
          const articleId = String(it.articleId ?? '')
          entries.push({
            类型: cat.类型,
            项目名称: title,
            采购单位: author,
            区县: String(it.districtName ?? ''),
            预算: fmtAmount(it.budgetPrice),
            中标单位: '',
            中标金额: '',
            征询截止: '',
            链接: `${ZJGOV_BASE}/site/detail?categoryCode=${code}&articleId=${encodeURIComponent(articleId)}`,
            平台: '浙江政采',
            台州公安: isPolice(title + author),
            日期: fmtDate(new Date(pd)),
            _articleId: articleId
          } as FeedEntry & { _articleId?: string })
        }
        // 本页全是窗口外的旧公告 → 后面更旧，翻页到此为止
        if (!anyFresh) break
        await politeDelay()
      }
    }
  }
  return entries
}

/** 详情正文里提"征询/意见反馈截止日"的正则组（去 HTML 标签后的纯文本上匹配） */
const DEADLINE_PATTERNS = [
  /(?:意见反馈|反馈意见|征求意见|征询意见|意见征询|公示)[^。；\n]{0,14}?(?:截止|结束)[^。；\n]{0,10}?(\d{4})[年.\-/](\d{1,2})[月.\-/](\d{1,2})/,
  /(?:截止|结束)(?:时间|日期)[^。；\n]{0,8}?(\d{4})[年.\-/](\d{1,2})[月.\-/](\d{1,2})/
]

function extractDeadline(text: string): string {
  for (const re of DEADLINE_PATTERNS) {
    const m = re.exec(text)
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  }
  return ''
}

/**
 * 意见征询条目补抓详情页，提取「征询/意见反馈截止日」——这是意见征询阶段最关键的日期
 * （错过截止就没法提意见影响采购需求了）。只对征询类少量条目发详情请求，单条失败不影响其余。
 */
async function enrichZjgovConsultDeadlines(entries: FeedEntry[]): Promise<void> {
  const targets = entries
    .filter((e) => e.类型 === '意见征询' && !e.征询截止)
    .slice(0, 15) as (FeedEntry & { _articleId?: string })[]
  for (const e of targets) {
    if (!e._articleId) continue
    try {
      const resp = await doFetch(`${ZJGOV_BASE}/portal/detail?articleId=${encodeURIComponent(e._articleId)}`, {
        headers: { 'User-Agent': UA, Referer: `${ZJGOV_BASE}/site/detail` },
        signal: AbortSignal.timeout(12000)
      })
      if (!resp.ok) continue
      const data = (await resp.json()) as { result?: { data?: { content?: string } } }
      const text = String(data?.result?.data?.content ?? '').replace(/<[^>]+>/g, '')
      e.征询截止 = extractDeadline(text)
      await politeDelay()
    } catch {
      // 详情页失败不影响列表数据
    }
  }
}

// ── 平台二：台州公共资源（ggzy.tzztb.zjtz.gov.cn，工程类）──────────────────

const TZGG_BASE = 'https://ggzy.tzztb.zjtz.gov.cn'
const TZGG_SITE_GUID = '7eb5f7f1-9041-43ad-8e13-8fcb82ea831a'
const TZGG_CATEGORIES: { num: string; 类型: FeedEntry['类型'] }[] = [
  { num: '002001002', 类型: '采购公告' },
  { num: '002001005', 类型: '采购结果公告' },
  { num: '002001006', 类型: '采购结果公告' }
]

async function fetchTzgg(dates: string[]): Promise<FeedEntry[]> {
  const entries: FeedEntry[] = []
  for (const date of dates) {
    for (const cat of TZGG_CATEGORIES) {
      const form = new URLSearchParams({
        siteGuid: TZGG_SITE_GUID,
        categoryNum: cat.num,
        content: '',
        pageIndex: '0',
        pageSize: '50',
        startdate: `${date} 00:00:00`,
        enddate: `${date} 23:59:59`,
        xiaqucode: '',
        projectjiaoyitype: '',
        jytype: ''
      })
      const resp = await doFetch(`${TZGG_BASE}/EpointWebBuilder/rest/secaction/getSecInfoListYzm`, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Referer: `${TZGG_BASE}/jyxx/002001/trade_infor.html`
        },
        body: form.toString(),
        signal: AbortSignal.timeout(15000)
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = (await resp.json()) as { custom?: { infodata?: Record<string, unknown>[] } }
      for (const it of data?.custom?.infodata ?? []) {
        const title = String(it.title ?? '')
        let url = String(it.infourl ?? '')
        if (url && !url.startsWith('http')) url = TZGG_BASE + url
        // 列表接口只给区县名，不给采购人——放 区县 字段，采购单位留空待确认（此前错放采购单位，属信息有误）
        const district = String(it.xiaquname ?? '')
        entries.push({
          类型: cat.类型,
          项目名称: title,
          采购单位: '',
          区县: district,
          预算: '',
          中标单位: '',
          中标金额: '',
          征询截止: '',
          链接: url,
          平台: '台州工程',
          台州公安: isPolice(title),
          日期: date
        })
      }
      await politeDelay()
    }
  }
  return entries
}

// ── 平台三：台州阳光采购（www.tzygcg.com）────────────────────────────────

const TZYGCG_BASE = 'https://www.tzygcg.com'
const TZYGCG_CATEGORIES: { classID: string; isZBCG: string; 类型: FeedEntry['类型'] }[] = [
  { classID: '20', isZBCG: '1', 类型: '意见征询' },
  { classID: '21', isZBCG: '1', 类型: '采购公告' },
  { classID: '22', isZBCG: '1', 类型: '采购结果公告' },
  { classID: '24', isZBCG: '1', 类型: '采购结果公告' },
  { classID: '20', isZBCG: '2', 类型: '意见征询' },
  { classID: '21', isZBCG: '2', 类型: '采购公告' },
  { classID: '22', isZBCG: '2', 类型: '采购结果公告' },
  { classID: '24', isZBCG: '2', 类型: '采购结果公告' }
]

async function fetchTzygcg(dates: string[]): Promise<FeedEntry[]> {
  const entries: FeedEntry[] = []
  const dateSet = new Set(dates)
  for (const cat of TZYGCG_CATEGORIES) {
    const data = (await postJson(
      `${TZYGCG_BASE}/siteapi/api/Portal/GetBulletinList`,
      {
        AreaName: null,
        InfoTypeId: null,
        ZtbTypeId: null,
        isZBCG: cat.isZBCG,
        keyword: '',
        pageIndex: 1,
        pageSize: 50,
        classID: cat.classID
      },
      `${TZYGCG_BASE}/Announcement`
    )) as { header?: { resultType?: number }; body?: { data?: { bulletinList?: Record<string, unknown>[] } } }
    if (data?.header?.resultType !== 1) continue
    for (const it of data?.body?.data?.bulletinList ?? []) {
      const pub = String(it.publishDate ?? '').slice(0, 10)
      if (!dateSet.has(pub)) continue
      const title = String(it.bulletinTitle ?? it.title ?? '')
      // 列表接口不带采购单位/预算——区域名放 区县 字段，采购单位留空待确认（此前错放采购单位，属信息有误）
      const area = String(it.areaName ?? '')
      entries.push({
        类型: cat.类型,
        项目名称: title,
        采购单位: '',
        区县: area,
        预算: '',
        中标单位: '',
        中标金额: '',
        征询截止: '',
        链接: `${TZYGCG_BASE}/NoticeDetail?projectId=${encodeURIComponent(String(it.prjId ?? ''))}&bulletinId=${encodeURIComponent(String(it.bulletinId ?? ''))}`,
        平台: '台州阳光采购',
        台州公安: isPolice(title + area),
        日期: pub
      })
    }
    await politeDelay()
  }
  return entries
}

// ── 合并写入信息流 ───────────────────────────────────────────────────────

/**
 * 把抓到的条目按日期合并进 {日期}_信息流.json。去重两层：
 * 同日按 名称+类型 不重复；跨天——同一 名称+类型 在近三天任一天的信息流里已存在，就不再新增
 * （政府网站会连续多天挂同一公告，只留首次出现的那条）。
 */
function mergeIntoFeeds(dataDir: string, entries: FeedEntry[]): { added: number; addedEntries: FeedEntry[] } {
  const dir = join(dataDir, TRACK_DIR_REL)
  mkdirSync(dir, { recursive: true })

  const ntKey = (类型: unknown, 名称: unknown): string => `${String(类型 ?? '')}|${String(名称 ?? '').trim()}`

  // 近三天所有信息流里已有的 名称+类型（跨天去重基准）
  const seenAll = new Set<string>()
  const feeds = new Map<string, { path: string; data: Record<string, unknown>; items: Record<string, unknown>[] }>()
  for (const d of recentDates(WINDOW_DAYS)) {
    const p = join(dir, `${d}_信息流.json`)
    let data: Record<string, unknown> = { 日期: d }
    let items: Record<string, unknown>[] = []
    if (existsSync(p)) {
      try {
        data = JSON.parse(readFileSync(p, 'utf-8'))
        if (Array.isArray(data?.项目)) items = data.项目 as Record<string, unknown>[]
      } catch {
        // 损坏就整个重写
      }
    }
    for (const x of items) seenAll.add(ntKey((x as { 类型?: unknown }).类型, (x as { 项目名称?: unknown }).项目名称))
    feeds.set(d, { path: p, data, items })
  }

  let added = 0
  const addedEntries: FeedEntry[] = []
  const touched = new Set<string>()
  for (const e of entries) {
    const name = e.项目名称.trim()
    if (!name) continue
    const key = ntKey(e.类型, name)
    if (seenAll.has(key)) continue
    const feed = feeds.get(e.日期)
    if (!feed) continue // 窗口外日期不写
    seenAll.add(key)
    // _articleId 之类的内部字段不落盘
    const { 日期: _drop, ...feedEntry } = { ...e } as FeedEntry & { _articleId?: string }
    delete (feedEntry as { _articleId?: string })._articleId
    feed.items.push(feedEntry)
    addedEntries.push(e)
    touched.add(e.日期)
    added += 1
  }

  for (const d of touched) {
    const feed = feeds.get(d)
    if (!feed) continue
    const tmp = `${feed.path}.tmp`
    writeFileSync(tmp, JSON.stringify({ ...feed.data, 日期: d, 项目: feed.items }, null, 2), 'utf-8')
    renameSync(tmp, feed.path)
  }
  return { added, addedEntries }
}

function readFetchState(dataDir: string): { lastFetchAt?: number } {
  const p = join(dataDir, TRACK_DIR_REL, FETCH_STATE_FILE)
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return {}
  }
}

function writeFetchState(dataDir: string): void {
  const dir = join(dataDir, TRACK_DIR_REL)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, FETCH_STATE_FILE), JSON.stringify({ lastFetchAt: Date.now() }, null, 2), 'utf-8')
}

/**
 * 抓取最近三天的招投标信息并合并进信息流（打开「行业情报」页自动触发）。
 * force=false 时 30 分钟内不重复抓。三个平台相互独立，单平台失败不影响其余。
 */
export async function fetchIntelNow(dataDir: string, force = false): Promise<IntelFetchResult> {
  if (!force) {
    const state = readFetchState(dataDir)
    if (state.lastFetchAt && Date.now() - state.lastFetchAt < MIN_INTERVAL_MS) {
      return { ok: true, 新增条数: 0, 平台结果: [], 说明: '距上次抓取不足30分钟，跳过（点「刷新」可强制）' }
    }
  }

  const dates = recentDates(WINDOW_DAYS)
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  const cutoffMs = cutoff.getTime() - (WINDOW_DAYS - 1) * 86400000

  const 平台结果: string[] = []
  const all: FeedEntry[] = []
  const platforms: { name: string; run: () => Promise<FeedEntry[]> }[] = [
    { name: '浙江政采', run: () => fetchZjgov(cutoffMs) },
    { name: '台州工程', run: () => fetchTzgg(dates) },
    { name: '台州阳光采购', run: () => fetchTzygcg(dates) }
  ]
  const results = await Promise.allSettled(platforms.map((p) => p.run()))
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      all.push(...r.value)
      平台结果.push(`${platforms[i].name} ${r.value.length}条`)
    } else {
      const why = r.reason instanceof Error ? r.reason.message.slice(0, 40) : String(r.reason).slice(0, 40)
      平台结果.push(`${platforms[i].name} 失败(${why})`)
    }
  })

  const okCount = results.filter((r) => r.status === 'fulfilled').length
  if (okCount === 0) {
    return { ok: false, 新增条数: 0, 平台结果, 说明: '三个平台都没抓到（多为网络问题），稍后点「刷新」重试' }
  }

  // 意见征询条目补抓详情页提取「征询截止日」（重点关注日期）
  await enrichZjgovConsultDeadlines(all)

  const { added, addedEntries } = mergeIntoFeeds(dataDir, all)
  writeFetchState(dataDir)

  // 新增条目累计追加进 Excel 台账（只增不覆盖；3天清理只清 JSON，不动它）
  let ledgerNote = ''
  if (addedEntries.length > 0) {
    try {
      const { appendIntelLedger } = await import('./intel-ledger')
      const r = await appendIntelLedger(dataDir, addedEntries)
      if (r.appended > 0) ledgerNote = `；已追加 ${r.appended} 条到信息台账.xlsx`
    } catch (err) {
      ledgerNote = `；台账追加失败（${err instanceof Error ? err.message.slice(0, 30) : '未知'}，若正开着 Excel 请先关闭）`
    }
  }

  return {
    ok: true,
    新增条数: added,
    平台结果,
    说明: (added > 0 ? `已抓取最近三天招投标信息，新增 ${added} 条` : '已抓取，无新增（信息流已是最新）') + ledgerNote
  }
}
