import { useEffect, useMemo, useState } from 'react'
import type { IntelCandidate, IntelFeedType } from '@shared/agent-types'
import { INTEL_FEED_TYPES } from '@shared/agent-types'

// ============ 招投标每日情报面板（四平台抓取 → 四类分组 → 确认跟进建档）============
// 原挂在「行业情报」工作台，按业务归属整合进「招投标」工作台：情报→确认→台账→解析投标一条线。

const FEED_TYPE_EMOJI: Record<IntelFeedType, string> = {
  采购意向: '📌',
  意见征询: '📋',
  采购公告: '📢',
  采购结果公告: '🏆'
}

/** 距 YYYY-MM-DD 的天数：正=还剩N天；null=没有/看不懂 */
function daysTo(dateStr: string | undefined): number | null {
  if (!dateStr) return null
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(dateStr.trim())
  if (!m) return null
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

/** 意见征询条目的截止徽章：越近越红——错过截止就无法提意见影响需求了 */
function ConsultDeadlineBadge({ c }: { c: IntelCandidate }): React.JSX.Element | null {
  if (c.类型 !== '意见征询') return null
  if (!c.征询截止) {
    return (
      <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
        征询截止待确认（点标题核对原文）
      </span>
    )
  }
  const days = daysTo(c.征询截止)
  const cls =
    days !== null && days <= 1
      ? 'bg-red-50 text-red-600 font-semibold'
      : days !== null && days <= 3
        ? 'bg-rose-50 text-rose-600 font-medium'
        : 'bg-amber-50 text-amber-600 font-medium'
  const tail = days === null ? '' : days < 0 ? `（已过 ${-days} 天）` : days === 0 ? '（今天截止！）' : `（还剩 ${days} 天）`
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${cls}`}>⏰ 征询截止 {c.征询截止}{tail}</span>
}

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
        c.跟进升级
          ? 'border-amber-400 shadow-sm'
          : c.类型 === '意见征询'
            ? 'border-amber-200'
            : c.相关度 === '高'
              ? 'border-rose-200'
              : 'border-slate-200'
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
        <ConsultDeadlineBadge c={c} />
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
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button
          disabled={disabled}
          onClick={onConfirm}
          title="建项目档并进入左侧台账（意见征询项目自动带上征询截止日）"
          className={`rounded px-3 py-1 text-[11px] font-medium text-white disabled:opacity-50 ${
            c.跟进升级 ? 'bg-amber-500' : 'bg-jushi-accent'
          }`}
        >
          {confirming ? '建档中…' : c.跟进升级 ? '跟进（归档进已有项目）' : '跟进'}
        </button>
        <button
          disabled={disabled}
          onClick={onIgnore}
          className="rounded border border-slate-300 px-3 py-1 text-[11px] text-slate-500 disabled:opacity-50"
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
  /** 非空=正在修改这个词：保存时原位替换而不是新增 */
  const [editing, setEditing] = useState<string | null>(null)
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

  function submit(): void {
    const val = input.trim()
    if (!val) return
    if (editing) {
      save(keywords.map((k) => (k === editing ? val : k)))
      setEditing(null)
    } else {
      save([...keywords, val])
    }
    setInput('')
  }

  return (
    <div className="mx-3 mb-2 rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-slate-600">关键词（抓取按它筛选入库 + 命中标红）</span>
        <button onClick={onClose} className="text-[11px] text-slate-400 hover:text-slate-600">收起 ✕</button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {keywords.map((k) => (
          <span
            key={k}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              editing === k ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-400' : 'bg-rose-50 text-rose-600'
            }`}
          >
            <button
              disabled={saving}
              onClick={() => {
                setEditing(k)
                setInput(k)
              }}
              className="hover:underline disabled:opacity-50"
              title={`修改关键词「${k}」——点击后在下方输入框改好按保存`}
            >
              {k}
            </button>
            <button
              disabled={saving}
              onClick={() => {
                if (editing === k) {
                  setEditing(null)
                  setInput('')
                }
                save(keywords.filter((x) => x !== k))
              }}
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
            if (e.key === 'Enter') submit()
          }}
          placeholder={editing ? `正在修改「${editing}」，改好按回车或点保存` : '如：电力 / 水利 / 巡检机器人 / 无人机'}
          className="flex-1 rounded border border-slate-300 px-2 py-1 text-[11px] outline-none focus:border-jushi-accent"
        />
        {editing && (
          <button
            onClick={() => {
              setEditing(null)
              setInput('')
            }}
            className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-500"
            title="取消修改"
          >
            取消
          </button>
        )}
        <button
          disabled={saving || !input.trim()}
          onClick={submit}
          className="rounded bg-jushi-accent px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
        >
          {saving ? '保存中…' : editing ? '保存修改' : '添加'}
        </button>
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-slate-400">
        增删改：点词本身=修改，点 × =删除，输入新词回车=添加。词库整合自黄药师管线（安防智能化+警用装备+采购部门，共百余词）。抓取时只保留 项目名称/采购单位/区县 命中任一关键词的公告——标红立即生效，抓取筛选下次「刷新」生效。
      </p>
    </div>
  )
}

/**
 * 招投标每日情报面板：四平台抓取的近3天公告，按四类分组；「确认跟进」建项目档进台账。
 * onConfirmed：确认建档后回调（招投标页用它刷新台账列表）。
 */
export function IntelBiddingFeed({
  onNotice,
  reloadKey,
  onConfirmed
}: {
  onNotice: (t: string) => void
  reloadKey: number
  onConfirmed?: () => void
}): React.JSX.Element {
  const [candidates, setCandidates] = useState<IntelCandidate[]>([])
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  const [onlyRelevant, setOnlyRelevant] = useState(false)
  const [showKeywords, setShowKeywords] = useState(false)
  const [query, setQuery] = useState('')
  const [dataDir, setDataDir] = useState('')
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
    window.api.config
      .get()
      .then((cfg) => {
        const active = cfg.companies.find((c) => c.id === cfg.activeCompanyId)
        setDataDir(active?.dataDir ?? '')
      })
      .catch(() => setDataDir(''))
  }, [reloadKey])

  async function handleConfirm(c: IntelCandidate): Promise<void> {
    setConfirmingKey(c.key)
    try {
      const r = await window.api.bidding.confirmCandidate(c.key)
      onNotice(r.ok ? `${r.说明}——已进入左侧台账` : r.说明)
      await refresh()
      if (r.ok) onConfirmed?.()
    } finally {
      setConfirmingKey(null)
    }
  }
  async function handleIgnore(c: IntelCandidate): Promise<void> {
    await window.api.bidding.ignoreCandidate(c.key)
    setCandidates((prev) => prev.filter((x) => x.key !== c.key))
  }

  const visible = useMemo(() => {
    let list = onlyRelevant ? candidates.filter((c) => c.相关度 || c.命中关键词 || c.台州公安) : candidates
    // 搜索：空格隔开多个词是"都要命中"，匹配 项目名称/采购单位/中标单位/区县/标签/平台
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length > 0) {
      list = list.filter((c) => {
        const hay = [c.项目名称, c.采购单位, c.中标单位, c.区县, c.标签, c.平台, c.预算].join(' ').toLowerCase()
        return tokens.every((t) => hay.includes(t))
      })
    }
    return list
  }, [candidates, onlyRelevant, query])
  const grouped = useMemo(() => {
    const g = new Map<IntelFeedType, IntelCandidate[]>()
    for (const t of INTEL_FEED_TYPES) g.set(t, [])
    for (const c of visible) g.get(c.类型)?.push(c)
    return g
  }, [visible])

  return (
    <>
      <div className="px-3 pb-2 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500">近3天抓取（{visible.length} 条）</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowKeywords((v) => !v)}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${
                showKeywords ? 'border-rose-400 bg-rose-50 text-rose-600' : 'border-slate-300 text-slate-500'
              }`}
              title="管理关键词（增删改）：抓取时只保留命中关键词的公告；命中的词在列表里标红"
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
        <div className="relative mt-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜项目 / 采购单位 / 区县 / 平台，空格隔开多个词…"
            className="w-full rounded-lg border border-slate-300 py-1.5 pl-3 pr-7 text-xs outline-none focus:border-jushi-accent"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              title="清空搜索"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
            >
              ✕
            </button>
          )}
        </div>
        <div className="mt-1 flex items-center justify-between">
          <p className="text-[11px] leading-snug text-slate-400">
            工作台只保留近3天；全部历史在信息台账.xlsx（每天追加不覆盖）
          </p>
          <button
            onClick={() => {
              if (!dataDir) return
              window.api.shell.showItemInFolder(
                `${dataDir}/outputs/09_情报_intel/招投标每日追踪/招投标信息台账.xlsx`
              )
            }}
            className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-jushi-accent hover:text-jushi-accent"
            title="打开累计 Excel 台账所在文件夹（每天抓取的新公告自动追加）"
          >
            📊 信息台账
          </button>
        </div>
      </div>
      {showKeywords && <KeywordManager onChanged={refresh} onClose={() => setShowKeywords(false)} />}
      <div className="flex-1 space-y-2 overflow-y-auto p-3 pt-0">
        {visible.length === 0 && (
          <p className="py-6 text-center text-xs text-slate-400">
            {query.trim() ? `没有匹配「${query.trim()}」的招投标信息` : '暂无待确认的招投标信息'}
          </p>
        )}
        {INTEL_FEED_TYPES.map((t) => {
          const items = grouped.get(t) ?? []
          if (items.length === 0) return null
          // 搜索时强制展开所有分组——命中的条目不能藏在收起的分组里
          const open = query.trim() ? true : openSections[t]
          return (
            <div key={t} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <button
                onClick={() => setOpenSections((s) => ({ ...s, [t]: !s[t] }))}
                className={`flex w-full items-center justify-between px-2.5 py-1.5 text-xs font-semibold ${
                  t === '意见征询' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'
                }`}
              >
                <span>
                  {FEED_TYPE_EMOJI[t]} {t}（{items.length}）
                  {t === '意见征询' && <span className="ml-1 font-normal">重点关注——赶在截止前提意见</span>}
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
