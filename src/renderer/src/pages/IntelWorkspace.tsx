import { useEffect, useMemo, useState } from 'react'
import type {
  AgentDisplayMeta,
  AgentName,
  IntelCandidate,
  IntelFeedType,
  IntelReport,
  IntelReportType
} from '@shared/agent-types'
import { INTEL_FEED_TYPES } from '@shared/agent-types'
import { AgentChat } from '../components/AgentChat'
import { OutputsPanel } from '../components/OutputsPanel'

type IntelTab = '招投标信息' | '行业趋势' | '政策文件'
const TABS: IntelTab[] = ['招投标信息', '行业趋势', '政策文件']

const FEED_TYPE_EMOJI: Record<IntelFeedType, string> = {
  采购意向: '📌',
  意见征询: '📋',
  采购公告: '📢',
  采购结果公告: '🏆'
}

// ── 招投标候选行 ──────────────────────────────────────────
function CandidateRow({
  c,
  confirming,
  disabled,
  onConfirm,
  onIgnore
}: {
  c: IntelCandidate
  confirming: boolean
  disabled: boolean
  onConfirm: () => void
  onIgnore: () => void
}): React.JSX.Element {
  return (
    <div
      className={`rounded-lg border bg-white p-2.5 ${
        c.跟进升级 ? 'border-amber-400 shadow-sm' : c.相关度 === '高' ? 'border-rose-200' : 'border-slate-200'
      }`}
    >
      {c.跟进升级 && (
        <div className="mb-1.5 rounded bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
          🔔 重点：你跟进中的项目发布了正式采购公告
        </div>
      )}
      <a
        href={c.链接 || undefined}
        target="_blank"
        rel="noreferrer"
        title={c.链接 ? '在浏览器打开公告原文' : undefined}
        className={`text-xs font-medium leading-snug ${
          c.链接 ? 'text-jushi-accent underline-offset-2 hover:underline' : 'text-slate-700'
        }`}
      >
        {c.项目名称}
        {c.链接 && <span className="ml-0.5 text-[10px]">↗</span>}
      </a>
      <div className="mt-1 text-[11px] text-slate-500">
        {c.采购单位 || '采购单位待确认'}
        {c.区县 ? ` · ${c.区县}` : ''}
        {c.预算 ? ` · ${c.预算}` : ''}
        {c.中标单位 ? ` · 中标：${c.中标单位}` : ''}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {c.相关度 && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              c.相关度 === '高' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'
            }`}
          >
            相关度{c.相关度}
          </span>
        )}
        {(c.命中关键词 || c.台州公安) && (
          <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600">
            🚨{c.命中关键词 || '公安系统'}
          </span>
        )}
        {c.标签 && <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-600">{c.标签}</span>}
        {c.平台 && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{c.平台}</span>}
        <span className="text-[10px] text-slate-400">{c.日期}</span>
      </div>
      {c.理由 && <div className="mt-1 text-[11px] leading-snug text-slate-400">{c.理由}</div>}
      <div className="mt-1.5 flex gap-1.5">
        <button
          disabled={disabled}
          onClick={onConfirm}
          className={`flex-1 rounded px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50 ${
            c.跟进升级 ? 'bg-amber-500' : 'bg-jushi-accent'
          }`}
        >
          {confirming ? '建档中…' : c.跟进升级 ? '✓ 归档进已有项目（更新为正式公告）' : '✓ 确认跟进 → 招投标'}
        </button>
        <button
          disabled={disabled}
          onClick={onIgnore}
          className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-500 disabled:opacity-50"
        >
          忽略
        </button>
      </div>
    </div>
  )
}

// ── 兴趣关键词管理（命中标红 + 计入「只看相关」）──────────────
function KeywordManager({ onChanged, onClose }: { onChanged: () => void; onClose: () => void }): React.JSX.Element {
  const [keywords, setKeywords] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.intel.getKeywords().then(setKeywords)
  }, [])

  async function save(next: string[]): Promise<void> {
    setSaving(true)
    try {
      const saved = await window.api.intel.setKeywords(next)
      setKeywords(saved)
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-3 mb-2 rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-slate-600">兴趣关键词（命中即标红并计入「只看相关」）</span>
        <button onClick={onClose} className="text-[11px] text-slate-400 hover:text-slate-600">收起 ✕</button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {keywords.map((k) => (
          <span key={k} className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-600">
            {k}
            <button
              disabled={saving}
              onClick={() => save(keywords.filter((x) => x !== k))}
              className="text-rose-400 hover:text-rose-700 disabled:opacity-50"
              title={`删除关键词「${k}」`}
            >
              ×
            </button>
          </span>
        ))}
        {keywords.length === 0 && <span className="text-[11px] text-slate-400">暂无关键词——全部公告都不会标红</span>}
      </div>
      <div className="mt-2 flex gap-1.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && input.trim()) {
              save([...keywords, input.trim()])
              setInput('')
            }
          }}
          placeholder="如：电力 / 水利 / 巡检机器人 / 无人机"
          className="flex-1 rounded border border-slate-300 px-2 py-1 text-[11px] outline-none focus:border-jushi-accent"
        />
        <button
          disabled={saving || !input.trim()}
          onClick={() => {
            save([...keywords, input.trim()])
            setInput('')
          }}
          className="rounded bg-jushi-accent px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
        >
          {saving ? '保存中…' : '添加'}
        </button>
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-slate-400">
        匹配范围=项目名称+采购单位；改完立即对现有列表生效，无需重新抓取。默认为公安系统一组词，删掉不需要的、加上你关心的行业词即可。
      </p>
    </div>
  )
}

// ── 招投标信息面板（四类分组 + 确认跟进）────────────────────
function BiddingFeedPanel({ onNotice, reloadKey }: { onNotice: (t: string) => void; reloadKey: number }): React.JSX.Element {
  const [candidates, setCandidates] = useState<IntelCandidate[]>([])
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  const [onlyRelevant, setOnlyRelevant] = useState(false)
  const [showKeywords, setShowKeywords] = useState(false)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    采购意向: true,
    意见征询: true,
    采购公告: true,
    采购结果公告: false
  })

  async function refresh(): Promise<void> {
    setCandidates(await window.api.bidding.listCandidates())
  }
  useEffect(() => {
    refresh()
  }, [reloadKey])

  async function handleConfirm(c: IntelCandidate): Promise<void> {
    setConfirmingKey(c.key)
    try {
      const r = await window.api.bidding.confirmCandidate(c.key)
      onNotice(r.ok ? `${r.说明}——项目卡已进入「招投标」页台账` : r.说明)
      await refresh()
    } finally {
      setConfirmingKey(null)
    }
  }
  async function handleIgnore(c: IntelCandidate): Promise<void> {
    await window.api.bidding.ignoreCandidate(c.key)
    setCandidates((prev) => prev.filter((x) => x.key !== c.key))
  }

  const visible = useMemo(
    () => (onlyRelevant ? candidates.filter((c) => c.相关度 || c.命中关键词 || c.台州公安) : candidates),
    [candidates, onlyRelevant]
  )
  const grouped = useMemo(() => {
    const g = new Map<IntelFeedType, IntelCandidate[]>()
    for (const t of INTEL_FEED_TYPES) g.set(t, [])
    for (const c of visible) g.get(c.类型)?.push(c)
    return g
  }, [visible])

  return (
    <>
      <div className="app-drag px-3 pb-2 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500">四平台每日抓取（{visible.length} 条）</span>
          <div className="app-no-drag flex items-center gap-1.5">
            <button
              onClick={() => setShowKeywords((v) => !v)}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${
                showKeywords ? 'border-rose-400 bg-rose-50 text-rose-600' : 'border-slate-300 text-slate-500'
              }`}
              title="管理兴趣关键词：命中的公告标红并计入「只看相关」"
            >
              ⚙ 关键词
            </button>
            <button
              onClick={() => setOnlyRelevant((v) => !v)}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${
                onlyRelevant ? 'border-jushi-accent bg-jushi-accent text-white' : 'border-slate-300 text-slate-500'
              }`}
              title="只显示：intel 分身标注过相关度的 + 命中兴趣关键词的"
            >
              只看相关
            </button>
            <button
              disabled={fetching}
              onClick={async () => {
                setFetching(true)
                try {
                  const r = await window.api.intel.fetchNow(true)
                  onNotice(r.说明 + (r.平台结果.length > 0 ? `（${r.平台结果.join('、')}）` : ''))
                } catch {
                  onNotice('抓取失败（网络问题），稍后重试')
                } finally {
                  setFetching(false)
                }
                await refresh()
              }}
              className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-500 hover:border-jushi-accent hover:text-jushi-accent disabled:opacity-50"
              title="立即从三平台抓取最新公告并刷新列表"
            >
              {fetching ? '抓取中…' : '刷新'}
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-slate-400">
          浙江政采（政采云）/台州公共资源/乐采云/台州阳光采购。「确认跟进」后进入招投标页台账并自动回填项目卡。
        </p>
      </div>
      {showKeywords && <KeywordManager onChanged={refresh} onClose={() => setShowKeywords(false)} />}
      <div className="flex-1 space-y-2 overflow-y-auto p-3 pt-0">
        {visible.length === 0 && <p className="py-6 text-center text-xs text-slate-400">暂无待确认的招投标信息</p>}
        {INTEL_FEED_TYPES.map((t) => {
          const items = grouped.get(t) ?? []
          if (items.length === 0) return null
          const open = openSections[t]
          return (
            <div key={t} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <button
                onClick={() => setOpenSections((s) => ({ ...s, [t]: !s[t] }))}
                className="flex w-full items-center justify-between bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600"
              >
                <span>
                  {FEED_TYPE_EMOJI[t]} {t}（{items.length}）
                </span>
                <span>{open ? '▾' : '▸'}</span>
              </button>
              {open && (
                <div className="space-y-1.5 bg-slate-50 p-2">
                  {items.map((c) => (
                    <CandidateRow
                      key={c.key}
                      c={c}
                      confirming={confirmingKey === c.key}
                      disabled={confirmingKey !== null}
                      onConfirm={() => handleConfirm(c)}
                      onIgnore={() => handleIgnore(c)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

// ── 研报面板（行业趋势 / 政策文件，按关键词分组）─────────────
function ReportRow({ r, onNotice }: { r: IntelReport; onNotice: (t: string) => void }): React.JSX.Element {
  const [saving, setSaving] = useState(false)
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5">
      <a
        href={r.链接}
        target="_blank"
        rel="noreferrer"
        title="在浏览器打开 sgpjbg.com 报告下载页"
        className="text-xs font-medium leading-snug text-jushi-accent underline-offset-2 hover:underline"
      >
        {r.标题}
        <span className="ml-0.5 text-[10px]">↗</span>
      </a>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {r.页数 > 0 && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{r.页数}页</span>}
        {r.VIP && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">皮匠出品</span>}
        {r.发布日期 && <span className="text-[10px] text-slate-400">{r.发布日期}</span>}
        <button
          disabled={saving}
          onClick={async () => {
            setSaving(true)
            try {
              const res = await window.api.intel.saveReportToSolution(r)
              onNotice(
                res.existed
                  ? '这份已经在方案资料库里了'
                  : `已存入解决方案${r.分类 === '政策文件' ? '政策文件库' : '行业趋势库'}（线索卡含下载链接）`
              )
            } finally {
              setSaving(false)
            }
          }}
          title="一键转存到解决方案分身的资料库（政策文件库/行业趋势库），生成含下载链接的线索卡"
          className="ml-auto shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-jushi-accent hover:text-jushi-accent disabled:opacity-50"
        >
          {saving ? '存入中…' : '→ 存入方案资料库'}
        </button>
      </div>
    </div>
  )
}

/** 研报抓取操作指引：首次登录 → 手动抓取 → 排查，命令可一键复制 */
function ReportsGuide({ dataDir, onNotice }: { dataDir: string; onNotice: (t: string) => void }): React.JSX.Element {
  const chromeCmd =
    '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir="$HOME/.openclaw/chrome-debug-profile" &'
  const runCmd = `cd "${dataDir || '<数据目录>'}/tools/intel-reports" && bash run_reports.sh`
  const logCmd = `open "${dataDir || '<数据目录>'}/tools/intel-reports/scripts/logs"`

  function CopyCmd({ cmd }: { cmd: string }): React.JSX.Element {
    return (
      <div className="mt-1 flex items-start gap-1">
        <code className="flex-1 break-all rounded bg-slate-800 px-1.5 py-1 text-[10px] leading-relaxed text-emerald-300">{cmd}</code>
        <button
          onClick={() => {
            navigator.clipboard.writeText(cmd)
            onNotice('命令已复制，去「终端」App 里粘贴回车即可')
          }}
          className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-jushi-accent hover:text-jushi-accent"
        >
          复制
        </button>
      </div>
    )
  }

  return (
    <div className="mx-3 mb-2 rounded-lg border border-slate-200 bg-white p-2.5 text-[11px] leading-relaxed text-slate-600">
      <div className="font-semibold text-slate-700">📖 研报抓取操作指引</div>
      <div className="mt-1.5 font-medium text-slate-700">① 平时不用管</div>
      <p className="text-slate-500">管理员 Mac 每天 07:20 自动抓取；想立刻要最新的，直接点上方「刷新」（App 会自己拉起抓取，约 1-2 分钟）。</p>
      <div className="mt-2 font-medium text-slate-700">② 首次使用 / 提示"需要登录"时（只需做一次）</div>
      <p className="text-slate-500">1. 打开「终端」App（启动台搜"终端"），粘贴下面命令回车，会弹出一个专用 Chrome 窗口：</p>
      <CopyCmd cmd={chromeCmd} />
      <p className="mt-1 text-slate-500">2. 在这个专用 Chrome 里打开 sgpjbg.com，登录三个皮匠会员账号（登录一次长期有效）；</p>
      <p className="text-slate-500">3. 回到本页点「刷新」重抓。</p>
      <div className="mt-2 font-medium text-slate-700">③ 「刷新」失败时的手动抓取</div>
      <p className="text-slate-500">在终端执行（跑完回本页点「刷新」看结果）：</p>
      <CopyCmd cmd={runCmd} />
      <div className="mt-2 font-medium text-slate-700">④ 还是 0 份？排查两件事</div>
      <p className="text-slate-500">
        · 多半是专用 Chrome 里 sgpjbg 掉线或遇到人机验证——去那个 Chrome 窗口重新登录/手动过一次验证；
        <br />· 看抓取日志定位原因：
      </p>
      <CopyCmd cmd={logCmd} />
      <p className="mt-1.5 text-[10px] text-slate-400">安全提醒：账号密码只存在这个专用 Chrome 的登录态里，绝不写进任何脚本/配置文件。</p>
    </div>
  )
}

function ReportsPanel({ type, reloadKey, onNotice }: { type: IntelReportType; reloadKey: number; onNotice: (t: string) => void }): React.JSX.Element {
  const [reports, setReports] = useState<IntelReport[]>([])
  const [loaded, setLoaded] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [dataDir, setDataDir] = useState('')

  async function refresh(): Promise<void> {
    setReports(await window.api.intel.listReports())
    setLoaded(true)
  }
  useEffect(() => {
    refresh()
    window.api.config
      .get()
      .then((cfg) => {
        const active = cfg.companies.find((c) => c.id === cfg.activeCompanyId)
        setDataDir(active?.dataDir ?? '')
      })
      .catch(() => setDataDir(''))
  }, [reloadKey])

  /** 刷新 = 真正重新抓取（拉起研报管线，约1-2分钟）+ 与定时任务数据去重合并 + 重读列表 */
  async function handleRefetch(): Promise<void> {
    setFetching(true)
    onNotice('正在重新抓取研报（约1-2分钟，首次会拉起浏览器）…')
    try {
      const r = await window.api.intel.fetchReports()
      onNotice(r.说明)
    } catch (err) {
      onNotice(`重抓失败：${err instanceof Error ? err.message : String(err)}——如果刚更新过程序，请完全退出后重新打开再试`)
    } finally {
      setFetching(false)
    }
    await refresh()
  }

  const mine = useMemo(() => reports.filter((r) => r.分类 === type), [reports, type])
  const byKeyword = useMemo(() => {
    const g = new Map<string, IntelReport[]>()
    for (const r of mine) {
      if (!g.has(r.关键词)) g.set(r.关键词, [])
      g.get(r.关键词)?.push(r)
    }
    return g
  }, [mine])
  const fetchDate = reports[0]?.抓取日期 ?? ''

  return (
    <>
      <div className="app-drag px-3 pb-2 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500">
            {type}（{mine.length} 份{fetchDate ? ` · ${fetchDate}` : ''}）
          </span>
          <div className="app-no-drag flex items-center gap-1.5">
            <button
              onClick={() => setShowGuide((v) => !v)}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${
                showGuide ? 'border-jushi-accent bg-jushi-accent text-white' : 'border-slate-300 text-slate-500'
              }`}
              title="首次登录 sgpjbg / 手动抓取 / 排查 0 份的分步操作说明"
            >
              操作指引
            </button>
            <button
              disabled={fetching}
              onClick={handleRefetch}
              title="立即重新抓取 sgpjbg 研报（与每日定时任务的数据按链接去重）"
              className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-500 hover:border-jushi-accent hover:text-jushi-accent disabled:opacity-50"
            >
              {fetching ? '重抓中…' : '刷新'}
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-slate-400">
          来自三个皮匠（sgpjbg.com），每天 07:20 抓取。点标题跳转报告下载页（需登录会员）。
        </p>
      </div>
      {showGuide && <ReportsGuide dataDir={dataDir} onNotice={onNotice} />}
      <div className="flex-1 space-y-2 overflow-y-auto p-3 pt-0">
        {loaded && mine.length === 0 && (
          <div className="py-6 text-center text-xs leading-relaxed text-slate-400">
            暂无{type}数据。
            <br />
            点右上角「刷新」立即抓取；
            <br />
            提示需要登录或仍为 0 份时，点「操作指引」按步骤处理。
            <button
              onClick={() => setShowGuide(true)}
              className="mx-auto mt-2 block rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-500 hover:border-jushi-accent hover:text-jushi-accent"
            >
              📖 查看操作指引
            </button>
          </div>
        )}
        {[...byKeyword.entries()].map(([kw, items]) => (
          <div key={kw} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600">
              {type === '政策文件' ? `${kw} + 政策` : kw}（{items.length}）
            </div>
            <div className="space-y-1.5 bg-slate-50 p-2">
              {items.map((r) => (
                <ReportRow key={r.链接} r={r} onNotice={onNotice} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

/**
 * 行业情报分身工作台：左侧三分类切换——招投标信息 / 行业趋势 / 政策文件。
 * 招投标信息=四平台每日抓取（可「确认跟进」进招投标台账）；行业趋势/政策文件=sgpjbg.com 研报（只读，带下载页链接）。
 */
export function IntelWorkspace({ agent }: { agent: AgentDisplayMeta }): React.JSX.Element {
  const [tab, setTab] = useState<IntelTab>('招投标信息')
  const [notice, setNotice] = useState<string | null>(null)
  const [showOutputs, setShowOutputs] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  function flash(text: string): void {
    setNotice(text)
    setTimeout(() => setNotice(null), 6000)
  }

  // 打开情报分身：①清理超过三天的旧机读数据 ②App 内置抓取最新招投标信息（30分钟内不重复抓）。
  // 数据不走 git 同步——任何装了 App 的电脑（mac/Windows）都自己拉，乐采云/研报仍来自管理员机管线。
  useEffect(() => {
    ;(async () => {
      const purged = await window.api.intel.purgeStale()
      setReloadKey((k) => k + 1)
      flash('正在抓取最新招投标信息（浙江政采/台州工程/台州阳光采购）…')
      try {
        const r = await window.api.intel.fetchNow()
        flash(
          [r.说明, r.平台结果.length > 0 ? `（${r.平台结果.join('、')}）` : '', purged.purged.length > 0 ? `；已清理 ${purged.purged.length} 项过期数据` : '']
            .join('')
        )
      } catch {
        flash('抓取失败（网络问题），点「刷新」重试')
      }
      setReloadKey((k) => k + 1)
    })()
  }, [])

  return (
    <div className="flex h-full">
      <div className="flex w-96 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
        <div className="app-drag flex gap-1 px-3 pb-1 pt-4">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`app-no-drag flex-1 rounded-lg px-2 py-1.5 text-xs font-medium ${
                tab === t ? 'bg-jushi-accent text-white' : 'border border-slate-300 text-slate-500 hover:border-jushi-accent'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === '招投标信息' && <BiddingFeedPanel onNotice={flash} reloadKey={reloadKey} />}
        {tab === '行业趋势' && <ReportsPanel type="行业趋势" reloadKey={reloadKey} onNotice={flash} />}
        {tab === '政策文件' && <ReportsPanel type="政策文件" reloadKey={reloadKey} onNotice={flash} />}

        {notice && (
          <div className="border-t border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] leading-snug text-emerald-700">
            {notice}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        <AgentChat agent={agent} />
      </div>
      <div
        className={`shrink-0 overflow-hidden border-l border-slate-200 bg-slate-50 transition-all ${showOutputs ? 'w-72' : 'w-10'}`}
      >
        <button
          onClick={() => setShowOutputs((v) => !v)}
          className="flex w-full items-center justify-center py-3 text-slate-400 hover:text-jushi-accent"
          title="产出文件"
        >
          {showOutputs ? '›' : '‹'}
        </button>
        {showOutputs && (
          <>
            <h3 className="px-3 pb-1 text-xs font-semibold text-slate-500">产出：outputs/{agent.name as AgentName}</h3>
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(100% - 60px)' }}>
              <OutputsPanel agentName={agent.name as AgentName} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
