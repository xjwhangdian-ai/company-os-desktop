import { useEffect, useRef, useState } from 'react'
import type { AgentName } from '@shared/agent-types'
import { useConfigStore } from './stores/useConfigStore'
import { useAgentsStore } from './stores/useAgentsStore'
import { useIdentityStore } from './stores/useIdentityStore'
import { AgentPicker } from './components/AgentPicker'
import { IdentityGate } from './components/IdentityGate'
import { SyncButton } from './components/SyncButton'
import { UpdateBanner } from './components/UpdateBanner'
import { Settings } from './pages/Settings'
import { GenericAgentPage } from './pages/GenericAgentPage'
import { MbaWorkspace } from './pages/MbaWorkspace'
import { BiddingWorkspace } from './pages/BiddingWorkspace'
import { BrandWorkspace } from './pages/BrandWorkspace'
import { AdminLegalWorkspace } from './pages/AdminLegalWorkspace'
import { OperationWorkspace } from './pages/OperationWorkspace'
import { SalesWorkspace } from './pages/SalesWorkspace'
import { IntelWorkspace } from './pages/IntelWorkspace'
import { SolutionWorkspace } from './pages/SolutionWorkspace'
import { FinanceWorkspace } from './pages/FinanceWorkspace'

type View = 'settings' | { agent: AgentName }

export default function App(): React.JSX.Element {
  const { config, loading, load } = useConfigStore()
  const { list, loaded, load: loadAgents } = useAgentsStore()
  const currentUser = useIdentityStore((s) => s.currentUser)
  const logout = useIdentityStore((s) => s.logout)
  const [view, setView] = useState<View>('settings')
  const [gateKey, setGateKey] = useState(0)
  const [navCollapsed, setNavCollapsed] = useState(false)
  /** "配置就绪后自动离开设置页"只在启动时做一次——否则配置好之后每次点「设置」都会被立刻弹回分身页 */
  const autoLeftSettings = useRef(false)

  useEffect(() => {
    load()
  }, [load])

  const activeCompany = config?.companies.find((c) => c.id === config.activeCompanyId) ?? null
  const activeProviderApiKey = config ? config.providers[config.activeProviderId]?.apiKey : null
  const ready = Boolean(activeCompany?.dataDir && activeProviderApiKey)

  useEffect(() => {
    if (activeCompany?.dataDir) {
      loadAgents()
    }
  }, [activeCompany?.dataDir, loadAgents])

  useEffect(() => {
    if (!autoLeftSettings.current && ready && loaded && list.length > 0 && view === 'settings') {
      autoLeftSettings.current = true
      setView({ agent: list[0].name })
    }
    // 当前查看的分身对该员工不可见（如管理员刚调整了分配）→ 跳回第一个可见分身

  }, [ready, loaded, list, view])

  // 当前公司没配好（比如刚切到还没选数据目录的瑾智安防）时，自动跳到设置页，
  // 不让用户自己去找左下角的小设置按钮
  useEffect(() => {
    if (!loading && !ready && view !== 'settings') {
      setView('settings')
    }
  }, [loading, ready, view])

  // 发薪日提醒（默认每月10号）：打开 App 时检查，一天只提醒一次；打开财务工作台可看详情
  useEffect(() => {
    if (!ready || !currentUser) return
    window.api.finance
      .overview()
      .then((o) => {
        if (!o.今天是发薪日) return
        const stamp = `payday-notified-${o.月份}-${o.发薪日}`
        if (localStorage.getItem(stamp)) return
        localStorage.setItem(stamp, '1')
        new Notification('💰 今天是发工资日', {
          body: `每月${o.发薪日}号发放工资——打开「财务」工作台可生成本月工资表（${o.员工.filter((e) => e.参保).length} 人参保）`
        })
      })
      .catch(() => null)
  }, [ready, currentUser])

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-sm text-slate-400">加载中…</div>
  }

  // 每次启动 App（以及主动切换用户后）都要先选公司+选身份——纯本地校验，不是真账号系统，
  // 目的是给产出文件留一个"谁生成的"的痕迹，而不是做访问控制。
  if (!currentUser) {
    return <IdentityGate key={gateKey} />
  }

  const isAdmin = currentUser.role === 'admin'
  // 员工只看到管理员分配的分身（未配置=全部可见）；管理员恒为全部
  const visibleList = isAdmin
    ? list
    : list.filter((a) => !currentUser.可见分身 || currentUser.可见分身.includes(a.name))
  const activeAgentName = typeof view === 'object' ? view.agent : null
  const activeAgent = visibleList.find((a) => a.name === activeAgentName) ?? null

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-900">
      <UpdateBanner />
      <EnvBanner onGoSettings={() => setView('settings')} />
      <div className="flex min-h-0 flex-1">
      {!navCollapsed ? (
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-slate-100 p-3">
        {/* app-drag：无标题栏窗口靠这块区域拖动；pt-7 给 macOS 红绿灯让位，避免压住公司名 */}
        <div className="app-drag mb-4 flex items-center gap-2.5 px-2 pb-1 pt-7">
          {/* 品牌 logo（知行之眼，来自公司 VI 头像） */}
          <svg width="30" height="30" viewBox="0 0 800 800" className="shrink-0 rounded-lg" aria-label="炬视 logo">
            <rect width="800" height="800" rx="176" fill="#1D5AF1" />
            <g transform="translate(181,181) scale(4.38)">
              <path d="M 72 33.9 A 28 28 0 1 0 78 50" fill="none" stroke="#fff" strokeWidth="12" strokeLinecap="round" />
              <line x1="57" y1="50" x2="78" y2="50" stroke="#fff" strokeWidth="12" strokeLinecap="round" />
              <circle cx="47" cy="50" r="10" fill="#fff" />
              <circle cx="43" cy="46" r="3.4" fill="#1D5AF1" />
            </g>
          </svg>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-bold text-jushi-blue">{activeCompany?.name ?? 'Agent 工作台'}</h1>
            <p className="text-xs text-slate-400">Agent 工作台</p>
          </div>
          <button
            onClick={() => setNavCollapsed(true)}
            title="隐藏左侧菜单栏"
            className="app-no-drag shrink-0 rounded-md px-1.5 py-1 text-slate-400 hover:bg-white/70 hover:text-jushi-accent"
          >
            «
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!ready ? (
            <p className="px-2 text-xs text-slate-400">请先完成设置页配置</p>
          ) : (
            <AgentPicker agents={visibleList} activeName={activeAgentName} onSelect={(name) => setView({ agent: name })} />
          )}
        </div>

        <div className="mt-2 flex items-center gap-2 px-2 py-1.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-400 text-xs font-semibold text-white">
            {currentUser.name.slice(0, 1)}
          </span>
          <span className="flex-1 truncate text-xs text-slate-500">{currentUser.name}</span>
          <button
            onClick={() => {
              logout()
              setGateKey((k) => k + 1)
            }}
            className="text-xs text-slate-400 hover:text-jushi-accent"
          >
            切换
          </button>
        </div>

        <SyncButton userName={currentUser.name} />
        {isAdmin && (
          <button
            onClick={() => setView('settings')}
            className={`mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
              view === 'settings' ? 'bg-white shadow-sm text-jushi-accent' : 'text-slate-500 hover:bg-white/60'
            }`}
          >
            ⚙️ 设置
          </button>
        )}
      </aside>
      ) : (
      /* 收起态：留一条窄栏（顶部仍可拖动窗口/容纳 macOS 红绿灯），点 » 重新展开 */
      <aside className="flex w-8 shrink-0 flex-col items-center border-r border-slate-200 bg-slate-100">
        <div className="app-drag h-9 w-full" />
        <button
          onClick={() => setNavCollapsed(false)}
          title="显示左侧菜单栏"
          className="app-no-drag mt-1 rounded-md px-1.5 py-1.5 text-slate-400 hover:bg-white/70 hover:text-jushi-accent"
        >
          »
        </button>
      </aside>
      )}

      <main className="flex-1 overflow-hidden bg-white">
        {view === 'settings' && isAdmin && (
          <div className="flex h-full flex-col">
            {ready && loaded && list.length === 0 && (
              /* 数据目录缺 .claude/agents（比如「选择目录」指到了普通文件夹）→ 分身列表为空，
                 没有这条横幅用户会永远卡在设置页且不知道原因 */
              <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-6 py-3">
                <span className="flex-1 text-xs leading-snug text-amber-800">
                  ⚠ 当前数据目录里没有找到分身定义（.claude/agents/）——可能选择的不是 company-os 数据目录。
                  点右侧一键修复：把分身定义/知识库/目录骨架补进该目录（只补缺失，已有文件不动）；或在下方「数据目录」重新选择。
                </span>
                <button
                  onClick={async () => {
                    const r = await window.api.config.repairDataDir()
                    if (r.ok) await loadAgents()
                    alert(r.说明 + (r.ok ? '，即将进入工作台' : ''))
                  }}
                  className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
                >
                  🛠 一键修复数据目录
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1">
              <Settings />
            </div>
          </div>
        )}
        {view === 'settings' && !isAdmin && (
          <div className="flex h-full items-center justify-center px-8 text-center text-sm text-slate-400">
            设置页仅管理员可用——数据目录、模型供应商、成员权限由管理员统一配置；有需要请联系管理员。
          </div>
        )}
        {view !== 'settings' && !ready && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-400">
            <p>请先配置 {activeCompany?.name ?? '当前公司'} 的数据目录和 API Key</p>
            <button
              onClick={() => setView('settings')}
              className="rounded-lg bg-jushi-accent px-4 py-2 text-sm font-medium text-white"
            >
              打开设置
            </button>
          </div>
        )}
        {view !== 'settings' && ready && activeAgent && activeAgent.name === 'bidding' && (
          <BiddingWorkspace agent={activeAgent} />
        )}
        {view !== 'settings' && ready && activeAgent && activeAgent.name === 'brand' && (
          <BrandWorkspace agent={activeAgent} />
        )}
        {view !== 'settings' && ready && activeAgent && activeAgent.name === 'admin-legal' && <AdminLegalWorkspace agent={activeAgent} />}
        {view !== 'settings' && ready && activeAgent && activeAgent.name === 'operation' && (
          <OperationWorkspace agent={activeAgent} />
        )}
        {view !== 'settings' && ready && activeAgent && activeAgent.name === 'sales' && (
          <SalesWorkspace agent={activeAgent} />
        )}
        {view !== 'settings' && ready && activeAgent && activeAgent.name === 'solution' && (
          <SolutionWorkspace agent={activeAgent} />
        )}
        {view !== 'settings' && ready && activeAgent && activeAgent.name === 'intel' && (
          <IntelWorkspace agent={activeAgent} />
        )}
        {view !== 'settings' && ready && activeAgent && activeAgent.name === 'finance' && (
          <FinanceWorkspace agent={activeAgent} />
        )}
        {view !== 'settings' && ready && activeAgent && activeAgent.name === 'mba' && (
          <MbaWorkspace agent={activeAgent} />
        )}
        {view !== 'settings' &&
          ready &&
          activeAgent &&
          !['bidding', 'brand', 'admin-legal', 'operation', 'sales', 'solution', 'intel', 'finance', 'mba'].includes(activeAgent.name) && (
            <GenericAgentPage agent={activeAgent} />
          )}
      </main>
      </div>
    </div>
  )
}


/** 本地环境缺失横幅：启动时检测一次，缺核心组件（poppler/python等）就提示去设置页一键安装 */
function EnvBanner({ onGoSettings }: { onGoSettings: () => void }): React.JSX.Element | null {
  const [missing, setMissing] = useState<string[]>([])
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    window.api.env
      .check()
      .then((r) => setMissing(r.missingRequired))
      .catch(() => {})
  }, [])
  if (dismissed || missing.length === 0) return null
  return (
    <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800">
      <span>
        ⚠️ 本地环境缺失：{missing.join('、')}——会导致分身无法读取 PDF、画册抠图不可用等问题
      </span>
      <button
        onClick={onGoSettings}
        className="shrink-0 rounded bg-amber-500 px-2 py-0.5 font-medium text-white hover:bg-amber-600"
      >
        去设置页一键安装
      </button>
      <button onClick={() => setDismissed(true)} className="ml-auto shrink-0 text-amber-500 hover:text-amber-700">
        ✕
      </button>
    </div>
  )
}
