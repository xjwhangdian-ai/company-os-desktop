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
        {c.台州公安 && (
          <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600">🚨公安系统</span>
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

// ── 招投标信息面板（四类分组 + 确认跟进）────────────────────
function BiddingFeedPanel({ onNotice, reloadKey }: { onNotice: (t: string) => void; reloadKey: number }): React.JSX.Element {
  const [candidates, setCandidates] = useState<IntelCandidate[]>([])
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  const [onlyRelevant, setOnlyRelevant] = useState(false)
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
    () => (onlyRelevant ? candidates.filter((c) => c.相关度 || c.台州公安) : candidates),
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
              onClick={() => setOnlyRelevant((v) => !v)}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${
                onlyRelevant ? 'border-jushi-accent bg-jushi-accent text-white' : 'border-slate-300 text-slate-500'
              }`}
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

function ReportsPanel({ type, reloadKey, onNotice }: { type: IntelReportType; reloadKey: number; onNotice: (t: string) => void }): React.JSX.Element {
  const [reports, setReports] = useState<IntelReport[]>([])
  const [loaded, setLoaded] = useState(false)
  const [fetching, setFetching] = useState(false)

  async function refresh(): Promise<void> {
    setReports(await window.api.intel.listReports())
    setLoaded(true)
  }
  useEffect(() => {
    refresh()
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
          <button
            disabled={fetching}
            onClick={handleRefetch}
            title="立即重新抓取 sgpjbg 研报（与每日定时任务的数据按链接去重）"
            className="app-no-drag rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-500 hover:border-jushi-accent hover:text-jushi-accent disabled:opacity-50"
          >
            {fetching ? '重抓中…' : '刷新'}
          </button>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-slate-400">
          来自三个皮匠（sgpjbg.com），每天 07:20 抓取。点标题跳转报告下载页（需登录会员）。
        </p>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3 pt-0">
        {loaded && mine.length === 0 && (
          <p className="py-6 text-center text-xs leading-relaxed text-slate-400">
            暂无{type}数据。
            <br />
            确认调试 Chrome 已登录 sgpjbg 会员后，
            <br />
            在终端跑 tools/intel-reports/run_reports.sh
          </p>
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
