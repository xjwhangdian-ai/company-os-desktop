import { useEffect, useMemo, useState } from 'react'
import type { AgentDisplayMeta, BidProjectCard, BidProjectStatus, BiddingProject } from '@shared/agent-types'
import { BID_PROJECT_STATUSES } from '@shared/agent-types'
import { AgentChat } from '../components/AgentChat'
import { MaterialChecklist } from '../components/MaterialChecklist'
import { HelpButton } from '../components/HelpPanel'
import { HELP_CONTENT } from '../lib/help-content'

function Badge({ active, label }: { active: boolean; label: string }): React.JSX.Element {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'
      }`}
    >
      {label}
    </span>
  )
}

/** 招投标台账按公告类型分组：采购意向/意见征询/采购公告 + 手工或旧项目归「其他」 */
const BID_CATEGORIES = ['采购意向', '意见征询', '采购公告', '其他'] as const
type BidCategory = (typeof BID_CATEGORIES)[number]
const CATEGORY_EMOJI: Record<BidCategory, string> = { 采购意向: '📌', 意见征询: '📋', 采购公告: '📢', 其他: '📁' }

function categoryOf(p: BiddingProject): BidCategory {
  const t = p.tenderSource?.公告类型
  return t === '采购意向' || t === '意见征询' || t === '采购公告' ? t : '其他'
}

/** 待处理 = 情报推来、还没解析、人工也没动过项目卡的项目；人工保存过项目卡（改过状态）就按实际状态显示 */
function isPending(p: BiddingProject): boolean {
  return (
    p.tenderSource !== null &&
    !p.hasParseReport &&
    !p.card?.人工确认 &&
    (p.card?.状态 ?? '跟进中') === '跟进中'
  )
}

const STATUS_STYLE: Record<BidProjectStatus, string> = {
  跟进中: 'bg-blue-50 text-blue-600',
  已投标: 'bg-amber-50 text-amber-600',
  已中标: 'bg-emerald-50 text-emerald-600',
  未中标: 'bg-slate-100 text-slate-500',
  已放弃: 'bg-slate-100 text-slate-400'
}

/** 解析 YYYY-MM-DD（容忍 / 分隔），返回距今天数：正=还剩N天，负=已过N天，null=没填/看不懂 */
function daysToDeadline(dateStr: string | undefined): number | null {
  if (!dateStr) return null
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(dateStr.trim())
  if (!m) return null
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

function DeadlineTag({ card }: { card: BidProjectCard | null }): React.JSX.Element | null {
  const days = daysToDeadline(card?.投标截止日)
  if (days === null) return null
  const terminal = card && ['已中标', '未中标', '已放弃'].includes(card.状态)
  if (terminal) return <span className="text-slate-300">截止 {card?.投标截止日}</span>
  if (days < 0) return <span className="font-medium text-red-500">已过截止 {-days} 天</span>
  if (days === 0) return <span className="font-semibold text-red-600">今天截止！</span>
  if (days <= 3) return <span className="font-semibold text-red-500">还剩 {days} 天</span>
  if (days <= 7) return <span className="font-medium text-amber-600">还剩 {days} 天</span>
  return <span className="text-slate-400">还剩 {days} 天</span>
}

/** 台账排序：活跃且有截止日的按最近截止优先，其余按项目日期倒序垫底 */
function ledgerSort(projects: BiddingProject[]): BiddingProject[] {
  const urgency = (p: BiddingProject): number => {
    const active = !p.card || ['跟进中', '已投标'].includes(p.card.状态)
    const days = daysToDeadline(p.card?.投标截止日)
    if (active && days !== null && days >= 0) return days
    return Number.MAX_SAFE_INTEGER
  }
  return [...projects].sort((a, b) => {
    const ua = urgency(a)
    const ub = urgency(b)
    if (ua !== ub) return ua - ub
    return a.date < b.date ? 1 : -1
  })
}

/** 项目的招标原件（inbox 侧文件），供提示词点名让分身读 */
function sourceFilesOf(project: BiddingProject): string[] {
  const flat = (entries: BiddingProject['files']): string[] =>
    entries.flatMap((e) => (e.isDirectory ? flat(e.children ?? []) : [e.relativePath]))
  return flat(project.files).filter((rel) => rel.startsWith('inbox/'))
}

function clarificationFilesOf(project: BiddingProject): string[] {
  return sourceFilesOf(project).filter((rel) => rel.includes('/02_答疑澄清/'))
}

function outputsDirOf(project: BiddingProject): string {
  return `outputs/03_招投标_bidding/${project.folderName}`
}

/** 解析提示词共用尾段：项目卡回填协议（分身只写暂存，App 只补空字段） */
function backfillInstruction(outputsDir: string): string {
  return `同时把从招标文件里提取到的关键信息写入 ${outputsDir}/_项目卡回填.json（JSON 对象，字段名严格用：业主单位、招标编号、预算金额、保证金、投标截止日、开标日；日期统一 YYYY-MM-DD；提取不到的字段填空字符串""，禁止编造）。不要写 项目卡.json——那是 App 托管文件，你的回填会由 App 校验后只补人没填过的空字段。`
}

/** 解析提示词：输入/输出路径全部由 App 点名，分身不用猜文件在哪、该写到哪 */
function buildParsePrompt(project: BiddingProject): string {
  const sources = sourceFilesOf(project).filter((rel) => !rel.includes('/02_答疑澄清/'))
  const clarifications = clarificationFilesOf(project)
  return [
    `解析招标文件（项目「${project.projectName}」）。`,
    `招标原件：`,
    ...sources.map((s) => `- ${s}`),
    ...(clarifications.length > 0
      ? [`答疑/澄清文件（一并纳入解析，与原件冲突时以澄清为准并标注）：`, ...clarifications.map((s) => `- ${s}`)]
      : []),
    `按 bidding 分身的解析流程产出《招标解析报告》（评分拆解/资质缺口/标书目录框架/可质疑条款/可投标性）。`,
    `产出路径：${outputsDirOf(project)}/01_招标解析/${project.folderName}_招标解析.md`,
    backfillInstruction(outputsDirOf(project))
  ].join('\n')
}

const EMPTY_CARD_FORM: Omit<BidProjectCard, '更新时间'> = {
  业主单位: '',
  招标编号: '',
  预算金额: '',
  我方报价: '',
  保证金: '',
  投标截止日: '',
  开标日: '',
  状态: '跟进中',
  备注: ''
}

function ProjectCardEditor({
  project,
  onSaved
}: {
  project: BiddingProject
  onSaved: () => void
}): React.JSX.Element {
  const [form, setForm] = useState<Omit<BidProjectCard, '更新时间'>>(project.card ?? EMPTY_CARD_FORM)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    setForm(project.card ?? EMPTY_CARD_FORM)
    setSavedAt(null)
  }, [project.folderName, project.card])

  const set = (k: keyof typeof form, v: string): void => setForm((f) => ({ ...f, [k]: v }))

  const FIELDS: { key: keyof typeof form; label: string; placeholder?: string }[] = [
    { key: '业主单位', label: '业主单位' },
    { key: '招标编号', label: '招标编号' },
    { key: '预算金额', label: '预算金额' },
    { key: '我方报价', label: '我方报价' },
    { key: '保证金', label: '保证金' },
    { key: '投标截止日', label: '投标截止日', placeholder: 'YYYY-MM-DD' },
    { key: '开标日', label: '开标日', placeholder: 'YYYY-MM-DD' }
  ]

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="grid grid-cols-4 gap-2">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="mb-0.5 block text-xs text-slate-400">{f.label}</label>
            <input
              value={form[f.key] as string}
              onChange={(e) => set(f.key, e.target.value)}
              placeholder={f.placeholder ?? ''}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-jushi-accent"
            />
          </div>
        ))}
        <div>
          <label className="mb-0.5 block text-xs text-slate-400">状态</label>
          <select
            value={form.状态}
            onChange={(e) => set('状态', e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none"
          >
            {BID_PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-4">
          <label className="mb-0.5 block text-xs text-slate-400">备注</label>
          <input
            value={form.备注}
            onChange={(e) => set('备注', e.target.value)}
            placeholder="未中标时建议记下中标人/中标价，作历史中标对比数据"
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-jushi-accent"
          />
        </div>
      </div>

      {/* 状态动作钩子：中标/未中标各自的闭环提示 */}
      {form.状态 === '已中标' && (
        <div className="mt-2 rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700">
          🎉 已中标——两步闭环别忘：① 中标合同上传到「法务审核」工作台送审（inbox/04_法务_legal/）；② 合同签署版存入
          bidding/_素材库/类似项目合同/ 对应分类（智能化类/装备类）——它就是下次投标的"类似项目业绩"。
        </div>
      )}
      {form.状态 === '未中标' && (
        <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
          建议把中标人/中标价记进上面备注（公告出来后），它是历史中标对比的宝贵数据，下次同类项目解析用得上。
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={async () => {
            await window.api.bidding.saveCard(project.folderName, { ...form, 更新时间: Date.now() })
            setSavedAt(Date.now())
            onSaved()
          }}
          className="rounded-md bg-jushi-accent px-3 py-1.5 text-xs font-medium text-white"
        >
          保存项目卡
        </button>
        {savedAt && <span className="text-xs text-emerald-600">已保存</span>}
        <span className="ml-auto text-xs text-slate-400">
          解析时分身会自动回填空白字段（人工填过的不会被覆盖）
        </span>
      </div>
    </div>
  )
}

export function BiddingWorkspace({ agent }: { agent: AgentDisplayMeta }): React.JSX.Element {
  const [projects, setProjects] = useState<BiddingProject[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'全部' | '待处理' | BidProjectStatus>('全部')
  const [showMaterialLib, setShowMaterialLib] = useState(false)
  const [showProjectUpload, setShowProjectUpload] = useState(false)
  const [showCard, setShowCard] = useState(true)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [openCat, setOpenCat] = useState<Record<BidCategory, boolean>>({
    采购意向: true,
    意见征询: true,
    采购公告: true,
    其他: true
  })

  function flash(text: string): void {
    setNotice(text)
    setTimeout(() => setNotice(null), 6000)
  }

  /** 人工下载招标文件后导入项目：招标网站需登录验证，自动下载已改为"打开公告页自己下 + 这里导入" */
  async function handleImportTenderFiles(p: BiddingProject): Promise<void> {
    try {
      const paths = await window.api.dialog.pickFiles()
      if (paths.length === 0) return
      for (const path of paths) await window.api.bidding.uploadTenderFile(p.folderName, path)
      flash(`已导入 ${paths.length} 份招标文件到项目 01_招标文件/，可以点「解析」了`)
      await refresh()
    } catch (err) {
      flash(`导入失败：${err instanceof Error ? err.message : String(err)}——如果刚更新过程序，请完全退出后重新打开再试`)
    }
  }

  /** 待处理项目点「确认跟进」：状态落为跟进中并打人工确认标（saveCard 的 IPC 侧会加 人工确认:true） */
  async function handleConfirmFollow(p: BiddingProject): Promise<void> {
    try {
      await window.api.bidding.saveCard(p.folderName, {
        ...(p.card ?? { ...EMPTY_CARD_FORM, 更新时间: 0 }),
        状态: '跟进中',
        更新时间: Date.now()
      })
      flash(`已确认跟进「${p.projectName}」`)
      await refresh()
    } catch (err) {
      flash(`操作失败：${err instanceof Error ? err.message : String(err)}——如果刚更新过程序，请完全退出后重新打开再试`)
    }
  }

  /** 忽略项目（与行业情报页的「忽略」同款交互）：两侧文件夹移入系统废纸篓，可恢复 */
  async function handleDeleteProject(p: BiddingProject): Promise<void> {
    try {
      const r = await window.api.bidding.deleteProject(p.folderName)
      flash(r.ok ? `已忽略「${p.projectName}」——移入系统废纸篓（macOS 废纸篓/Windows 回收站，误删可恢复）` : r.说明)
      if (r.ok) {
        if (selected === p.folderName) setSelected(null)
        await refresh()
      }
    } catch (err) {
      flash(`忽略失败：${err instanceof Error ? err.message : String(err)}——如果刚更新过程序，请完全退出后重新打开再试`)
    }
  }

  async function refresh(): Promise<void> {
    setProjects(await window.api.bidding.listProjects())
  }

  useEffect(() => {
    refresh()
  }, [refreshKey])

  async function handleNewProject(): Promise<void> {
    const paths = await window.api.dialog.pickFiles()
    if (paths.length === 0) return
    const r = await window.api.upload.biddingProject(paths[0])
    await refresh()
    setSelected(r.projectFolder)
    setShowMaterialLib(false)
    setPendingPrompt(
      [
        `解析招标文件（项目「${r.projectFolder.slice(11)}」）。`,
        `招标原件：${r.relativePath}`,
        `按 bidding 分身的解析流程产出《招标解析报告》（评分拆解/资质缺口/标书目录框架/可质疑条款/可投标性）。`,
        `产出路径：${r.outputsDirRelative}/01_招标解析/${r.projectFolder}_招标解析.md`,
        backfillInstruction(r.outputsDirRelative)
      ].join('\n')
    )
  }

  async function handleExportLedger(): Promise<void> {
    const r = await window.api.bidding.exportLedger()
    flash(`台账已导出（${r.count} 个项目）`)
    await window.api.shell.showItemInFolder(r.path)
  }

  const sorted = useMemo(() => ledgerSort(projects), [projects])
  const filtered = sorted.filter((p) => {
    if (statusFilter === '全部') return true
    if (statusFilter === '待处理') return isPending(p)
    return (p.card?.状态 ?? '跟进中') === statusFilter
  })
  const pendingCount = useMemo(() => projects.filter(isPending).length, [projects])
  const grouped = useMemo(() => {
    const g = new Map<BidCategory, BiddingProject[]>()
    for (const c of BID_CATEGORIES) g.set(c, [])
    for (const p of filtered) g.get(categoryOf(p))?.push(p)
    return g
  }, [filtered])

  const project = projects.find((p) => p.folderName === selected) ?? null
  const flatFiles = (entries: BiddingProject['files']): typeof entries =>
    entries.flatMap((e) => (e.isDirectory ? flatFiles(e.children ?? []) : [e]))
  const draftFile = project ? flatFiles(project.files).find((f) => f.name.endsWith('_投标文件初稿.md')) : undefined

  return (
    <div className="flex h-full">
      <div className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
        <div className="p-3 pb-0">
          <div className="app-drag mb-2 flex items-center justify-between pt-1">
            <h2 className="text-xs font-semibold text-slate-500">招投标台账</h2>
            <div className="app-no-drag flex items-center gap-1.5">
              <button
                onClick={handleExportLedger}
                title="导出全部项目台账 CSV（Numbers/Excel 可开）"
                className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-500 hover:border-jushi-accent hover:text-jushi-accent"
              >
                导出CSV
              </button>
              <HelpButton content={HELP_CONTENT.bidding} />
            </div>
          </div>
          <div className="mb-2 flex gap-2">
            <button
              onClick={handleNewProject}
              className="flex-1 rounded-lg bg-jushi-accent px-3 py-2 text-xs font-medium text-white"
            >
              ＋ 新招标项目
            </button>
            <button
              onClick={() => {
                setShowMaterialLib(true)
                setSelected(null)
              }}
              className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                showMaterialLib ? 'border-jushi-accent text-jushi-accent' : 'border-slate-300 text-slate-500'
              }`}
            >
              素材库
            </button>
          </div>
          <div className="mb-2 flex flex-wrap gap-1">
            {(['全部', '待处理', ...BID_PROJECT_STATUSES] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s as typeof statusFilter)}
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  statusFilter === s
                    ? 'border-jushi-accent bg-jushi-accent text-white'
                    : s === '待处理' && pendingCount > 0
                      ? 'border-amber-400 bg-amber-50 text-amber-600'
                      : 'border-slate-300 text-slate-500'
                }`}
              >
                {s === '待处理' && pendingCount > 0 ? `待处理 ${pendingCount}` : s}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-3 pt-0">
          {BID_CATEGORIES.map((cat) => {
            const items = grouped.get(cat) ?? []
            if (items.length === 0) return null
            const open = openCat[cat]
            return (
              <div key={cat} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <button
                  onClick={() => setOpenCat((s) => ({ ...s, [cat]: !s[cat] }))}
                  className="flex w-full items-center justify-between bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600"
                >
                  <span>
                    {CATEGORY_EMOJI[cat]} {cat}（{items.length}）
                  </span>
                  <span>{open ? '▾' : '▸'}</span>
                </button>
                {open && (
                  <div className="space-y-1.5 bg-slate-50 p-2">
                    {items.map((p) => {
                      const status = p.card?.状态 ?? '跟进中'
                      return (
                        <div
                          key={p.folderName}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            setSelected(p.folderName)
                            setShowMaterialLib(false)
                            setShowProjectUpload(false)
                          }}
                          className={`block w-full cursor-pointer rounded-lg border px-3 py-2 text-left text-xs ${
                            selected === p.folderName
                              ? 'border-jushi-accent bg-white shadow-sm'
                              : 'border-transparent bg-white hover:border-slate-200'
                          }`}
                        >
                          <div className="truncate font-medium text-slate-700">{p.projectName}</div>
                          <div className="mt-1 flex items-center gap-1.5">
                            {isPending(p) ? (
                              <>
                                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-700">🆕 待处理</span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleConfirmFollow(p)
                                  }}
                                  title="确认跟进此项目：状态转为「跟进中」，待处理标记消失"
                                  className="rounded-full bg-jushi-accent px-2 py-0.5 font-medium text-white hover:opacity-90"
                                >
                                  确认跟进
                                </button>
                              </>
                            ) : (
                              <span className={`rounded-full px-1.5 py-0.5 ${STATUS_STYLE[status]}`}>{status}</span>
                            )}
                            <DeadlineTag card={p.card} />
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteProject(p)
                              }}
                              title="忽略此项目：两侧文件夹移入系统废纸篓（可恢复）"
                              className="ml-auto shrink-0 rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-500 hover:border-rose-300 hover:text-rose-500"
                            >
                              忽略
                            </button>
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            <Badge active={p.hasParseReport} label="解析" />
                            <Badge active={p.hasChallengeLetter} label="质疑" />
                            <Badge active={p.hasDraft} label="投标" />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
          {filtered.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-slate-400">
              {projects.length === 0 ? '还没有招标项目' : '该状态下没有项目'}
            </p>
          )}
        </div>
        {notice && <div className="border-t border-slate-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">{notice}</div>}
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        {showMaterialLib ? (
          <div className="flex-1 overflow-y-auto p-6">
            <h2 className="mb-4 text-sm font-semibold text-slate-800">素材库</h2>
            <MaterialChecklist refreshKey={refreshKey} />
          </div>
        ) : (
          <>
            {project && (
              <div className="max-h-[55%] overflow-y-auto border-b border-slate-200 bg-white px-5 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    {project.tenderSource?.公告链接 ? (
                      <a
                        href={project.tenderSource.公告链接}
                        target="_blank"
                        rel="noreferrer"
                        title="打开招标公告原文"
                        className="text-sm font-semibold text-jushi-accent underline-offset-2 hover:underline"
                      >
                        {project.projectName}
                        <span className="ml-0.5 text-[10px]">↗</span>
                      </a>
                    ) : (
                      <h2 className="text-sm font-semibold text-slate-800">{project.projectName}</h2>
                    )}
                    <p className="text-xs text-slate-400">
                      {project.folderName}
                      {project.card?.业主单位 && <> · {project.card.业主单位}</>}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleImportTenderFiles(project)}
                      title="招标网站需登录验证，请点项目名超链接打开公告页人工下载，然后在这里选中下载好的文件导入项目 01_招标文件/"
                      className="rounded-md border border-jushi-accent px-3 py-1.5 text-xs font-medium text-jushi-accent hover:bg-jushi-accent/5"
                    >
                      📥 导入招标文件
                    </button>
                    <button
                      onClick={() => setPendingPrompt(buildParsePrompt(project))}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      解析
                    </button>
                    <button
                      disabled={!project.hasParseReport}
                      onClick={() =>
                        setPendingPrompt(
                          `对项目「${project.projectName}」写质疑函：依据 ${outputsDirOf(project)}/01_招标解析/ 下的招标解析报告里「可质疑条款」一节，质疑函写到 ${outputsDirOf(project)}/04_投标文件成稿/${project.folderName}_质疑函.md`
                        )
                      }
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                    >
                      写质疑函
                    </button>
                    <button
                      disabled={!project.hasParseReport}
                      onClick={() =>
                        setPendingPrompt(
                          [
                            `对项目「${project.projectName}」生成投标文件初稿。`,
                            `解析报告在 ${outputsDirOf(project)}/01_招标解析/ 下；招标原件：${sourceFilesOf(project).filter((r) => !r.includes('/02_答疑澄清/')).join('、') || '（inbox 侧未找到，先确认）'}。`,
                            ...(clarificationFilesOf(project).length > 0
                              ? [`答疑/澄清文件（响应内容以最新澄清为准）：${clarificationFilesOf(project).join('、')}`]
                              : []),
                            `严格按解析报告的标书目录框架、调用 bidding/_素材库/ 与 knowledge/，遵守 bidding 分身的全部投标规则；项目 inbox 侧 04_资质材料/ 如有本项目专用资质（如合作方资质），一并核对使用。`,
                            `注意：${outputsDirOf(project)}/02_报价文件/ 下如有成本测算材料，只作内部参考，其内容严禁写入对外投标文件。`,
                            `产出：${outputsDirOf(project)}/04_投标文件成稿/${project.folderName}_投标文件初稿.md（三册一级标题结构）`
                          ].join('\n')
                        )
                      }
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                    >
                      生成投标文件
                    </button>
                    {draftFile && (
                      <button
                        onClick={async () => {
                          await window.api.docgen.exportBiddingTriSplit(draftFile.path)
                          setRefreshKey((k) => k + 1)
                        }}
                        className="rounded-md bg-jushi-accent px-3 py-1.5 text-xs font-medium text-white"
                      >
                        导出三册 Word
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteProject(project)}
                      title="忽略此项目：移入系统废纸篓（可恢复）"
                      className="rounded-md border border-rose-300 px-3 py-1.5 text-xs text-rose-500 hover:bg-rose-50"
                    >
                      忽略
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => setShowCard((v) => !v)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                      showCard ? 'border-jushi-accent text-jushi-accent' : 'border-slate-300 text-slate-500'
                    }`}
                  >
                    📋 项目卡{project.card ? '' : '（未填）'}
                  </button>
                  <button
                    onClick={async () => {
                      const paths = await window.api.dialog.pickFiles()
                      for (const p of paths) await window.api.bidding.uploadClarification(project.folderName, p)
                      if (paths.length > 0) {
                        flash(`已上传 ${paths.length} 份答疑/澄清文件，重新点「解析」可纳入`)
                        await refresh()
                      }
                    }}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    title="答疑、澄清、变更公告——存进项目 inbox 侧的 02_答疑澄清/，解析和投标时分身会读"
                  >
                    ＋ 答疑澄清
                  </button>
                  <button
                    onClick={() => setShowProjectUpload((v) => !v)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                      showProjectUpload ? 'border-jushi-accent text-jushi-accent' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    📎 上传素材
                  </button>
                  {!project.hasParseReport && (
                    <span className="text-xs text-amber-600">尚未解析——解析是投标流程的必做入口。</span>
                  )}
                </div>

                {showCard && <ProjectCardEditor project={project} onSaved={refresh} />}

                {showProjectUpload && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="mb-2 text-xs text-slate-500">
                      为「{project.projectName}」补充素材——这些材料存进 bidding/_素材库/，其它项目生成投标文件时也能用到，不是这一个项目专属。
                    </p>
                    <MaterialChecklist refreshKey={refreshKey} />
                  </div>
                )}
              </div>
            )}
            <div className="flex-1 overflow-hidden">
              <AgentChat
                key={project ? project.folderName : '__no_project__'}
                agent={agent}
                sessionKey={project ? `bidding::${project.folderName}` : 'bidding'}
                pendingPrompt={pendingPrompt}
                onPendingPromptConsumed={() => setPendingPrompt(null)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
