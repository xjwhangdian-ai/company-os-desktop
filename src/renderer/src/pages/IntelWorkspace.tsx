import { useEffect, useMemo, useState } from 'react'
import type { AgentDisplayMeta, AgentName, IntelReport, IntelReportType } from '@shared/agent-types'
import { AgentChat } from '../components/AgentChat'
import { ChatCollapseRail } from '../components/ChatCollapseRail'
import { VDragHandle, usePersistedSize } from '../components/PaneDivider'
import { OutputsPanel } from '../components/OutputsPanel'

type IntelTab = '行业趋势' | '政策文件'
const TABS: IntelTab[] = ['行业趋势', '政策文件']


// ── 研报面板（行业趋势 / 政策文件，按关键词分组）─────────────
function ReportRow({
  r,
  onNotice,
  onRemoved
}: {
  r: IntelReport
  onNotice: (t: string) => void
  onRemoved: () => void
}): React.JSX.Element {
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [localFile, setLocalFile] = useState<string | null>(null)
  const downloaded = localFile ?? r.已下载文件

  async function handleDownload(): Promise<void> {
    setDownloading(true)
    onNotice('正在下载报告（复用登录态浏览器，约半分钟）…')
    try {
      const res = await window.api.intel.downloadReport(r)
      onNotice(res.说明)
      if (res.ok && res.文件) {
        setLocalFile(res.文件)
        window.api.shell.showItemInFolder(res.文件)
      } else if (/手动下载/.test(res.说明)) {
        window.open(r.链接, '_blank')
      }
    } catch (err) {
      onNotice(`下载失败：${err instanceof Error ? err.message : String(err)}——如果刚更新过程序，请完全退出后重新打开再试`)
    } finally {
      setDownloading(false)
    }
  }

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
        {downloaded ? (
          <button
            onClick={() => window.api.shell.openPath(downloaded)}
            title={`已下载：${downloaded}——点击打开文件`}
            className="shrink-0 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700"
          >
            📄 打开
          </button>
        ) : (
          <button
            disabled={downloading}
            onClick={handleDownload}
            title="自动下载报告文件到 outputs/09_情报_intel/研报文件/（复用登录态浏览器；非管理员机自动改为打开网页）"
            className="shrink-0 rounded bg-jushi-accent px-1.5 py-0.5 text-[10px] font-medium text-white disabled:opacity-50"
          >
            {downloading ? '下载中…' : '下载'}
          </button>
        )}
        <button
          onClick={async () => {
            await window.api.intel.ignoreReport(r.链接)
            onRemoved()
          }}
          title="不感兴趣——从列表移除，之后抓到也不再显示"
          className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-500"
        >
          忽略
        </button>
      </div>
    </div>
  )
}

/** 研报抓取操作指引：首次登录 → 手动抓取 → 排查，命令可一键复制；Windows 机器给单独说明 */
function ReportsGuide({ dataDir, onNotice }: { dataDir: string; onNotice: (t: string) => void }): React.JSX.Element {
  const isWin = navigator.userAgent.includes('Windows')
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

  if (isWin) {
    return (
      <div className="mx-3 mb-2 rounded-lg border border-slate-200 bg-white p-2.5 text-[11px] leading-relaxed text-slate-600">
        <div className="font-semibold text-slate-700">📖 研报抓取说明（Windows 电脑）</div>
        <div className="mt-1.5 font-medium text-slate-700">① 这台电脑不用配置抓取</div>
        <p className="text-slate-500">
          研报抓取管线依赖管理员 Mac 上的专用组件（每日 07:20 定时任务 + 登录态 Chrome），Windows 电脑不在本机抓取——点「刷新」提示失败属正常现象，不是故障。
        </p>
        <div className="mt-2 font-medium text-slate-700">② 想在这台电脑上看研报，两条路</div>
        <p className="text-slate-500">
          1. 让管理员 Mac 当天抓取后，把数据目录里 <code className="rounded bg-slate-100 px-1">outputs\09_情报_intel\研报追踪\</code>
          下的当日 JSON 文件（通过微信/内网共享）拷到本机数据目录的相同位置，回到本页即可看到列表；
          <br />
          2. 直接用浏览器打开 sgpjbg.com，按关键词（机器人 / AI产业 / 低空经济）搜索查看（需皮匠会员登录）。
        </p>
        <div className="mt-2 font-medium text-slate-700">③ 列表里的链接正常可用</div>
        <p className="text-slate-500">只要本机有数据，点报告标题即可跳转下载页；「→ 存入方案资料库」等按钮也都正常工作。</p>
      </div>
    )
  }

  return (
    <div className="mx-3 mb-2 rounded-lg border border-slate-200 bg-white p-2.5 text-[11px] leading-relaxed text-slate-600">
      <div className="font-semibold text-slate-700">📖 研报抓取操作指引（管理员 Mac）</div>
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

/** 研报抓取关键词管理（增删改；存管线配置，分组与下次抓取都按它） */
function ReportKeywordManager({ onClose, onNotice }: { onClose: () => void; onNotice: (t: string) => void }): React.JSX.Element {
  const [keywords, setKeywords] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.intel.getReportKeywords().then(setKeywords)
  }, [])

  async function save(next: string[]): Promise<void> {
    setSaving(true)
    try {
      const r = await window.api.intel.setReportKeywords(next)
      onNotice(r.说明)
      if (r.ok) setKeywords(await window.api.intel.getReportKeywords())
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
    } else if (!keywords.includes(val)) {
      save([...keywords, val])
    }
    setInput('')
  }

  return (
    <div className="mx-3 mb-2 rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-slate-600">研报关键词（每个词分别搜「行业趋势」与「词+政策」）</span>
        <button onClick={onClose} className="text-[11px] text-slate-400 hover:text-slate-600">收起 ✕</button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {keywords.map((k) => (
          <span
            key={k}
            className={`group inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] ${
              editing === k ? 'bg-jushi-accent text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            <button
              onClick={() => {
                setEditing(k)
                setInput(k)
              }}
              title="点击修改这个词"
            >
              {k}
            </button>
            <button
              disabled={saving}
              onClick={() => save(keywords.filter((x) => x !== k))}
              className="text-slate-400 hover:text-rose-500"
              title="删除"
            >
              ×
            </button>
          </span>
        ))}
        {keywords.length === 0 && <span className="text-[11px] text-slate-300">（无关键词——本机可能没有抓取管线配置）</span>}
      </div>
      <div className="mt-1.5 flex gap-1">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={editing ? `修改「${editing}」为…` : '新增关键词，回车保存'}
          className="flex-1 rounded border border-slate-200 px-2 py-1 text-[11px] outline-none focus:border-jushi-accent"
        />
        <button
          disabled={saving}
          onClick={submit}
          className="rounded bg-jushi-accent px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
        >
          {editing ? '保存修改' : '添加'}
        </button>
        {editing && (
          <button
            onClick={() => {
              setEditing(null)
              setInput('')
            }}
            className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-500"
          >
            取消
          </button>
        )}
      </div>
      <p className="mt-1 text-[10px] text-slate-400">改词后明早 07:20 自动生效；想立即看新词结果，点上方「刷新」重抓。</p>
    </div>
  )
}

function ReportsPanel({ type, reloadKey, onNotice }: { type: IntelReportType; reloadKey: number; onNotice: (t: string) => void }): React.JSX.Element {
  const [reports, setReports] = useState<IntelReport[]>([])
  const [loaded, setLoaded] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [showKeywords, setShowKeywords] = useState(false)
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
              onClick={() => setShowKeywords((v) => !v)}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${
                showKeywords ? 'border-jushi-accent bg-jushi-accent text-white' : 'border-slate-300 text-slate-500'
              }`}
              title="管理研报抓取关键词（增删改，抓取与分组都按它）"
            >
              ⚙ 关键词
            </button>
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
      {showKeywords && <ReportKeywordManager onClose={() => setShowKeywords(false)} onNotice={onNotice} />}
      <div className="flex-1 space-y-2 overflow-y-auto p-3 pt-0">
        {loaded && mine.length === 0 && (
          <div className="py-6 text-center text-xs leading-relaxed text-slate-400">
            暂无{type}数据。
            <br />
            {navigator.userAgent.includes('Windows')
              ? 'Windows 电脑不在本机抓取（依赖管理员 Mac 的每日管线）——点「操作指引」看怎么拿到数据。'
              : '点右上角「刷新」立即抓取；提示需要登录或仍为 0 份时，点「操作指引」按步骤处理。'}
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
                <ReportRow
                  key={r.链接}
                  r={r}
                  onNotice={onNotice}
                  onRemoved={() => setReports((prev) => prev.filter((x) => x.链接 !== r.链接))}
                />
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
  const [tab, setTab] = useState<IntelTab>('行业趋势')
  const [notice, setNotice] = useState<string | null>(null)
  const [showOutputs, setShowOutputs] = useState(false)
  const [showChat, setShowChat] = useState(true)
  const [leftW, setLeftW] = usePersistedSize("intelLeftWidth", 384, 300, 900)
  const [reloadKey, setReloadKey] = useState(0)

  function flash(text: string): void {
    setNotice(text)
    setTimeout(() => setNotice(null), 6000)
  }

  // 打开情报分身：清理超过三天的旧机读数据。招投标信息的抓取与确认已整合进「招投标」工作台。
  useEffect(() => {
    ;(async () => {
      const purged = await window.api.intel.purgeStale()
      if (purged.purged.length > 0) flash(`已清理 ${purged.purged.length} 项过期情报数据`)
      setReloadKey((k) => k + 1)
    })()
  }, [])

  return (
    <div className="flex h-full">
      <div className={`flex shrink-0 flex-col border-r border-slate-200 bg-slate-50 ${showChat ? '' : 'flex-1'}`} style={showChat ? { width: leftW } : undefined}>
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

        <p className="px-3 pb-1 text-[11px] leading-snug text-slate-400">
          💡 招投标信息已整合进「招投标」工作台（每日情报页签）——情报确认、台账、解析投标一条线。
        </p>
        {tab === '行业趋势' && <ReportsPanel type="行业趋势" reloadKey={reloadKey} onNotice={flash} />}
        {tab === '政策文件' && <ReportsPanel type="政策文件" reloadKey={reloadKey} onNotice={flash} />}

        {notice && (
          <div className="border-t border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] leading-snug text-emerald-700">
            {notice}
          </div>
        )}
      </div>

      {showChat && <VDragHandle size={leftW} onSize={setLeftW} sign={1} min={260} max={900} />}
      <ChatCollapseRail open={showChat} onToggle={() => setShowChat((v) => !v)} />
      <div className={`overflow-hidden transition-all ${showChat ? 'flex-1' : 'w-0'}`}>
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
