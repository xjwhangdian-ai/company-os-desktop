import { useEffect, useState } from 'react'
import type { AgentDisplayMeta, FinanceEmployee, FinanceOverview, OutputEntry } from '@shared/agent-types'
import { AgentChat } from '../components/AgentChat'
import { ChatCollapseRail } from '../components/ChatCollapseRail'
import { CHAT_PANE, CHAT_PANE_KEY, VDragHandle, usePersistedSize } from '../components/PaneDivider'
import { OutputsPanel } from '../components/OutputsPanel'
import { HelpButton } from '../components/HelpPanel'
import { HELP_CONTENT } from '../lib/help-content'

type FinanceTab = '财税日历' | '记账报税' | '工资社保'

const RECEIPT_FILTERS = [{ name: '票据（发票/回单/扫描件）', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'ofd', 'xlsx', 'csv'] }]

/** 常见财税咨询快捷入口（填入输入框，改好再发） */
const CONSULT_CHIPS = [
  '我们刚升级为一般纳税人，和小规模比，增值税上要注意什么？',
  '这张进项发票能不能抵扣？（把发票传上来后问）',
  '给客户开13%专票，税负大概怎么算？',
  '公司两个人的社保医保，台州最新的缴费基数和比例是多少？',
  '本月有一笔研发支出，能享受加计扣除吗？'
]

function currentYm(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/** AI 记账提示词：读本月票据 → 编制凭证/账册/报表底稿 */
function buildBookkeepingPrompt(ym: string, receipts: OutputEntry[]): string {
  return [
    `为 ${ym} 月做记账（公司为一般纳税人，账套按小企业会计准则）。`,
    `本月票据（先逐份查看，图片/PDF 直接读取）：`,
    ...receipts.map((r) => `- ${r.relativePath}`),
    receipts.length === 0 ? '（本月还没有上传票据——先提示我把发票/银行回单传到「记账报税」页，再继续）' : '',
    ``,
    `产出到 outputs/08_财务_finance/${ym}_记账/：`,
    `1. ${ym}_记账凭证清单.md —— 每笔业务一条凭证（日期/摘要/借贷科目/金额/对应票据文件名）；拿不准科目的单独列出问我`,
    `2. ${ym}_月度报表底稿.md —— 简易资产负债表+利润表（基于本月凭证与你已知的期初，缺期初就标「待补期初」）`,
    `红线：只做底稿供人工复核，不代替正式账套；金额以票据原件为准，看不清的标「待人工核对」，绝不估数。`
  ].filter(Boolean).join('\n')
}

/** 报税底稿提示词 */
function buildTaxPrompt(ym: string): string {
  return [
    `为 ${ym} 月做报税底稿（一般纳税人月报）。先读 outputs/08_财务_finance/${ym}_记账/ 下的凭证清单与报表底稿（没有就先提示我做记账）。`,
    `产出 outputs/08_财务_finance/${ym}_报税/${ym}_报税底稿.md，包含：`,
    `1. 增值税：销项明细、进项抵扣清单（注明哪些票需要先在电子税务局勾选认证）、应纳税额试算`,
    `2. 附加税费：城建税/教育费附加/地方教育附加试算（台州市区口径，比例标注来源）`,
    `3. 个税（工资薪金）：按 财务/财税台账.json 的员工与工资，用累计预扣法试算本期应预扣个税`,
    `4. 印花税：本月合同（如有）按次试算并提示`,
    `5. 申报操作清单：去电子税务局逐项申报的步骤勾选表`,
    `红线：这是试算底稿，最终以电子税务局申报表自动计算为准；税率/口径不确定的联网查证并标注来源与「待确认」。`
  ].join('\n')
}

/** 工资表提示词 */
function buildSalaryPrompt(ym: string, employees: FinanceEmployee[], payday: number): string {
  const 参保 = employees.filter((e) => e.参保)
  return [
    `为 ${ym} 月做工资表与社保核对（发薪日：每月${payday}号）。员工配置（来自 财务/财税台账.json）：`,
    ...employees.map((e) => `- ${e.姓名}（${e.角色}）月工资 ${e.月工资 || '【未填，先问我】'} 元，社保基数 ${e.社保基数 || '【未填：按工资与最低基数4986取高】'} 元，${e.参保 ? '参保' : '不参保'}`),
    ``,
    `产出 outputs/08_财务_finance/${ym}_工资社保/${ym}_工资表.md：`,
    `1. 工资表：应发 → 社保医保公积金个人部分 → 累计预扣个税 → 实发（每人一行）`,
    `2. 公司承担部分：${参保.length} 人的单位社保/医保明细与合计`,
    `3. 社保基数与比例：直接用你分身定义里「台州社保参数」一节的已确认口径（养老16%/8%、医疗7.5%/1%、失业0.5%/0.5%、工伤0.2%单位、最低基数4986、不缴公积金），并与最近完税证明实缴对照校验；发现口径对不上以完税证明反推为准并提示我`,
    `4. 银行发放清单：${payday}号发放用`,
    `红线：社保比例/基数每年调整，查不到确切数字就标「待确认：以台州社保经办机构口径为准」；个税用累计预扣法并说明累计口径假设。`
  ].join('\n')
}

export function FinanceWorkspace({ agent }: { agent: AgentDisplayMeta }): React.JSX.Element {
  const [tab, setTab] = useState<FinanceTab>('财税日历')
  const [ym] = useState(currentYm())
  const [overview, setOverview] = useState<FinanceOverview | null>(null)
  const [receipts, setReceipts] = useState<OutputEntry[]>([])
  const [employees, setEmployees] = useState<FinanceEmployee[]>([])
  const [payday, setPayday] = useState(10)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const [showOutputs, setShowOutputs] = useState(false)
  const [showChat, setShowChat] = useState(true)
  const [chatW, setChatW] = usePersistedSize(CHAT_PANE_KEY, CHAT_PANE.def, CHAT_PANE.min, CHAT_PANE.max)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (pendingPrompt) setShowChat(true)
  }, [pendingPrompt])

  function flash(text: string): void {
    setNotice(text)
    setTimeout(() => setNotice(null), 5000)
  }

  async function refresh(): Promise<void> {
    const o = await window.api.finance.overview(ym)
    setOverview(o)
    setEmployees(o.员工)
    setPayday(o.发薪日)
    setReceipts(await window.api.finance.listReceipts(ym))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleToggle(taskKey: string, done: boolean): Promise<void> {
    await window.api.finance.toggleTask(ym, taskKey, done)
    await refresh()
  }

  async function handleUploadReceipts(): Promise<void> {
    const paths = await window.api.dialog.pickFiles(RECEIPT_FILTERS)
    for (const p of paths) await window.api.finance.uploadReceipt(ym, p)
    if (paths.length > 0) {
      flash(`已归档 ${paths.length} 份票据到 票据/${ym}/`)
      await refresh()
    }
  }

  const [invoiceBusy, setInvoiceBusy] = useState(false)
  /** 发票识别入台账：选图片→OCR提取五要素→按 日期-购买方-金额 归档→追加累计台账（号码去重） */
  async function handleProcessInvoices(): Promise<void> {
    const paths = await window.api.dialog.pickFiles([
      { name: '发票图片', extensions: ['png', 'jpg', 'jpeg'] }
    ])
    if (paths.length === 0) return
    if (typeof window.api.finance.processInvoices !== 'function') {
      flash('主进程还是旧版本——请完全退出（Cmd+Q）后重新打开再试')
      return
    }
    setInvoiceBusy(true)
    flash(`正在识别 ${paths.length} 张发票（本机离线OCR，约每张1-2秒）…`)
    try {
      const r = await window.api.finance.processInvoices(paths)
      flash(r.说明 + '——输出文件夹已打开定位')
      await window.api.shell.showItemInFolder(r.台账路径)
      if (r.失败.length > 0) {
        setTimeout(() => flash(`识别失败明细：${r.失败.map((f) => `${f.原文件}(${f.原因})`).join('；').slice(0, 160)}`), 6500)
      }
      await refresh()
    } catch (err) {
      flash(`发票识别失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setInvoiceBusy(false)
    }
  }

  async function handleSaveEmployees(): Promise<void> {
    await window.api.finance.saveEmployees(employees, payday)
    setSavedAt(Date.now())
    await refresh()
  }

  const doneCount = overview?.任务.filter((t) => t.done).length ?? 0

  return (
    <div className="flex h-full">
      {/* 左：工作区 */}
      <div className="flex min-w-0 flex-1 flex-col border-r border-slate-200">
        <div className="app-drag flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
          <div className="app-no-drag flex gap-1">
            {(['财税日历', '记账报税', '工资社保'] as FinanceTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  tab === t ? 'bg-jushi-accent text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="app-no-drag">
            <HelpButton content={HELP_CONTENT.finance} />
          </div>
        </div>

        {/* 发薪日横幅 */}
        {overview?.今天是发薪日 && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700">
            💰 今天是 {overview.发薪日} 号——发工资日！发放前可在「工资社保」页生成本月工资表。
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {/* ============ 财税日历 ============ */}
          {tab === '财税日历' && overview && (
            <>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">
                  {overview.月份} 财税任务（{doneCount}/{overview.任务.length}）
                </h3>
                <span className="text-xs text-slate-400">申报期遇节假日顺延，以电子税务局当月公告为准</span>
              </div>
              <div className="space-y-1.5">
                {overview.任务.map((t) => (
                  <label
                    key={t.key}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 ${
                      t.done ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(t.done)}
                      onChange={(e) => handleToggle(t.key, e.target.checked)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${t.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                          {t.名称}
                        </span>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                          截止 {t.截止.slice(5)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400">{t.说明}</p>
                    </div>
                  </label>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-400">
                任务清单按一般纳税人口径自动生成（季度首月含企业所得税预缴；5月汇算清缴、6月工商年报）。
              </p>
            </>
          )}

          {/* ============ 记账报税 ============ */}
          {tab === '记账报税' && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={handleUploadReceipts}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                >
                  📎 上传本月票据（发票/回单）
                </button>
                <button
                  disabled={invoiceBusy}
                  onClick={handleProcessInvoices}
                  title="选发票图片（可多选）：本机OCR提取 发票号码/日期/购销双方/价税合计（红字负数），按「日期-购买方-金额」重命名；重命名发票与累计《发票台账.xlsx》统一输出到 outputs/08_财务_finance/发票台账/。仅 macOS。"
                  className="rounded-md border border-jushi-accent px-3 py-1.5 text-xs font-medium text-jushi-accent hover:bg-jushi-accent/5 disabled:opacity-50"
                >
                  {invoiceBusy ? '识别中…' : '🧾 发票识别入台账'}
                </button>
                <button
                  onClick={() => setPendingPrompt(buildBookkeepingPrompt(ym, receipts))}
                  className="rounded-lg bg-jushi-accent px-3 py-1.5 text-sm font-medium text-white"
                >
                  ✍️ AI 记账（凭证+报表底稿）
                </button>
                <button
                  onClick={() => setPendingPrompt(buildTaxPrompt(ym))}
                  className="rounded-lg border border-jushi-accent px-3 py-1.5 text-sm font-medium text-jushi-accent hover:bg-jushi-accent/5"
                >
                  🧾 生成报税底稿
                </button>
              </div>
              <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
                流程：票据传上来 → AI 编制记账凭证与报表底稿 → 人工复核 → 按「报税底稿」去电子税务局申报。
                <b className="text-slate-600">App 与分身只做底稿与提醒，正式申报由人在电子税务局完成，口径以税务机关为准。</b>
              </p>
              <h3 className="mb-1.5 text-sm font-semibold text-slate-700">
                {ym} 票据（{receipts.length}）
              </h3>
              <div className="space-y-1">
                {receipts.map((r) => (
                  <div key={r.relativePath} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
                    <span className="text-slate-400">🧾</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{r.name}</span>
                    <span className="shrink-0 text-xs text-slate-300">{fmtSize(r.size)}</span>
                    <button
                      onClick={() => window.api.shell.showItemInFolder(r.path)}
                      className="shrink-0 text-xs text-slate-400 hover:text-jushi-accent"
                    >
                      定位
                    </button>
                  </div>
                ))}
                {receipts.length === 0 && (
                  <p className="py-6 text-center text-xs text-slate-400">本月还没有票据——收到发票/回单就传进来，月底一次性记账</p>
                )}
              </div>
            </>
          )}

          {/* ============ 工资社保 ============ */}
          {tab === '工资社保' && (
            <>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">员工与发薪配置（{employees.filter((e) => e.参保).length} 人参保）</h3>
                <label className="flex items-center gap-1.5 text-xs text-slate-500">
                  发薪日：每月
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={payday}
                    onChange={(e) => setPayday(Number(e.target.value))}
                    className="w-14 rounded-md border border-slate-300 px-1.5 py-1 text-center text-xs outline-none focus:border-jushi-accent"
                  />
                  号
                </label>
              </div>
              <div className="space-y-1.5">
                {employees.map((emp, i) => (
                  <div key={emp.id} className="grid grid-cols-[1fr_96px_92px_92px_60px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <input
                      value={emp.姓名}
                      onChange={(e) => setEmployees((prev) => prev.map((x, xi) => (xi === i ? { ...x, 姓名: e.target.value } : x)))}
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-jushi-accent"
                      placeholder="姓名"
                    />
                    <input
                      value={emp.角色}
                      onChange={(e) => setEmployees((prev) => prev.map((x, xi) => (xi === i ? { ...x, 角色: e.target.value } : x)))}
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-jushi-accent"
                      placeholder="角色"
                    />
                    <input
                      value={emp.月工资}
                      onChange={(e) => setEmployees((prev) => prev.map((x, xi) => (xi === i ? { ...x, 月工资: e.target.value } : x)))}
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-jushi-accent"
                      placeholder="月工资(元)"
                    />
                    <input
                      value={emp.社保基数 ?? ''}
                      onChange={(e) => setEmployees((prev) => prev.map((x, xi) => (xi === i ? { ...x, 社保基数: e.target.value } : x)))}
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-jushi-accent"
                      placeholder="社保基数(元)"
                      title="社保核定基数；工资低于最低基数(4986)时按最低基数缴"
                    />
                    <label className="flex items-center gap-1 text-xs text-slate-500">
                      <input
                        type="checkbox"
                        checked={emp.参保}
                        onChange={(e) => setEmployees((prev) => prev.map((x, xi) => (xi === i ? { ...x, 参保: e.target.checked } : x)))}
                      />
                      参保
                    </label>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() =>
                    setEmployees((prev) => [
                      ...prev,
                      { id: `emp-${Date.now()}`, 姓名: '', 角色: '员工', 月工资: '', 参保: true }
                    ])
                  }
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  ＋ 加一人
                </button>
                <button onClick={handleSaveEmployees} className="rounded-lg bg-jushi-accent px-3 py-1.5 text-xs font-medium text-white">
                  保存配置
                </button>
                {savedAt && <span className="text-xs text-emerald-600">已保存</span>}
                <button
                  onClick={() => setPendingPrompt(buildSalaryPrompt(ym, employees, payday))}
                  className="ml-auto rounded-lg border border-jushi-accent px-3 py-1.5 text-xs font-medium text-jushi-accent hover:bg-jushi-accent/5"
                >
                  ✍️ 生成本月工资表
                </button>
              </div>
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
                工资表含：应发 → 社保医保个人部分 → 累计预扣个税 → 实发 + 单位承担明细。
                社保基数与比例由分身联网查台州现行口径并标注来源；<b className="text-slate-600">最终以社保经办机构核定为准</b>。
              </p>
            </>
          )}
        </div>

        {notice && <div className="border-t border-slate-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">{notice}</div>}
      </div>

      {/* 中：分身对话（财税咨询，可收起） */}
      {showChat && <VDragHandle size={chatW} onSize={setChatW} sign={-1} min={CHAT_PANE.min} max={CHAT_PANE.max} />}
      <ChatCollapseRail open={showChat} onToggle={() => setShowChat((v) => !v)} />
      <div className="shrink-0 overflow-hidden transition-all" style={{ width: showChat ? chatW : 0 }}>
      <div className="flex h-full flex-col" style={{ width: chatW }}>
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
          <p className="mb-1.5 text-xs font-semibold text-slate-500">💬 财税咨询（点一个填入输入框，改好再发）</p>
          <div className="flex flex-wrap gap-1">
            {CONSULT_CHIPS.map((q) => (
              <button
                key={q}
                onClick={() => setPendingPrompt(q)}
                className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-500 hover:border-jushi-accent hover:text-jushi-accent"
                title={q}
              >
                {q.slice(0, 14)}…
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <AgentChat agent={agent} pendingPrompt={pendingPrompt} onPendingPromptConsumed={() => setPendingPrompt(null)} />
        </div>
      </div>
      </div>

      {/* 右：产出面板 */}
      <div className={`shrink-0 overflow-hidden border-l border-slate-200 bg-slate-50 transition-all ${showOutputs ? 'w-72' : 'w-10'}`}>
        <button
          onClick={() => setShowOutputs((v) => !v)}
          className="flex w-full items-center justify-center py-3 text-slate-400 hover:text-jushi-accent"
          title="产出文件"
        >
          {showOutputs ? '›' : '‹'}
        </button>
        {showOutputs && (
          <>
            <h3 className="px-3 pb-1 text-xs font-semibold text-slate-500">产出：outputs/finance</h3>
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(100% - 60px)' }}>
              <OutputsPanel
                agentName="finance"
                extraFileAction={(entry: OutputEntry) =>
                  entry.name.endsWith('.md') ? (
                    <button
                      onClick={async () => {
                        const docxPath = await window.api.docgen.exportMarkdownFile(entry.path)
                        await window.api.shell.showItemInFolder(docxPath)
                      }}
                      className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-400 opacity-0 hover:bg-slate-100 hover:text-jushi-accent group-hover:opacity-100"
                      title="转成 Word 并定位"
                    >
                      转Word
                    </button>
                  ) : null
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
