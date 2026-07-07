import { useEffect, useRef, useState } from 'react'
import type { AgentName } from '@shared/agent-types'
import { useConfigStore } from './stores/useConfigStore'
import { useAgentsStore } from './stores/useAgentsStore'
import { useIdentityStore } from './stores/useIdentityStore'
import { AgentPicker } from './components/AgentPicker'
import { IdentityGate } from './components/IdentityGate'
import { SyncButton } from './components/SyncButton'
import { Settings } from './pages/Settings'
import { GenericAgentPage } from './pages/GenericAgentPage'
import { BiddingWorkspace } from './pages/BiddingWorkspace'
import { LegalWorkspace } from './pages/LegalWorkspace'
import { OperationWorkspace } from './pages/OperationWorkspace'
import { SalesWorkspace } from './pages/SalesWorkspace'
import { IntelWorkspace } from './pages/IntelWorkspace'
import { SolutionWorkspace } from './pages/SolutionWorkspace'

type View = 'settings' | { agent: AgentName }

export default function App(): React.JSX.Element {
  const { config, loading, load, setActiveCompany } = useConfigStore()
  const { list, loaded, load: loadAgents } = useAgentsStore()
  const currentUser = useIdentityStore((s) => s.currentUser)
  const logout = useIdentityStore((s) => s.logout)
  const [view, setView] = useState<View>('settings')
  const [gateKey, setGateKey] = useState(0)
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
  }, [ready, loaded, list, view])

  // 当前公司没配好（比如刚切到还没选数据目录的瑾智安防）时，自动跳到设置页，
  // 不让用户自己去找左下角的小设置按钮
  useEffect(() => {
    if (!loading && !ready && view !== 'settings') {
      setView('settings')
    }
  }, [loading, ready, view])

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-sm text-slate-400">加载中…</div>
  }

  // 每次启动 App（以及主动切换用户后）都要先选公司+选身份——纯本地校验，不是真账号系统，
  // 目的是给产出文件留一个"谁生成的"的痕迹，而不是做访问控制。
  if (!currentUser) {
    return <IdentityGate key={gateKey} />
  }

  const isAdmin = currentUser.role === 'admin'
  const activeAgentName = typeof view === 'object' ? view.agent : null
  const activeAgent = list.find((a) => a.name === activeAgentName) ?? null

  return (
    <div className="flex h-screen bg-slate-100 text-slate-900">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-slate-100 p-3">
        {/* app-drag：无标题栏窗口靠这块区域拖动；pt-7 给 macOS 红绿灯让位，避免压住公司名 */}
        <div className="app-drag mb-4 px-2 pb-1 pt-7">
          <h1 className="text-sm font-bold text-jushi-blue">{activeCompany?.name ?? '数字人分身工作台'}</h1>
          <p className="text-xs text-slate-400">数字人分身工作台</p>
        </div>

        {config && config.companies.length > 1 && (
          <select
            value={config.activeCompanyId ?? ''}
            onChange={(e) => setActiveCompany(e.target.value)}
            className="app-no-drag mb-3 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-600 outline-none focus:border-jushi-accent"
          >
            {config.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        <div className="flex-1 overflow-y-auto">
          {!ready ? (
            <p className="px-2 text-xs text-slate-400">请先完成设置页配置</p>
          ) : (
            <AgentPicker agents={list} activeName={activeAgentName} onSelect={(name) => setView({ agent: name })} />
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

      <main className="flex-1 overflow-hidden bg-white">
        {view === 'settings' && isAdmin && <Settings />}
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
        {view !== 'settings' && ready && activeAgent && activeAgent.name === 'legal' && (
          <LegalWorkspace agent={activeAgent} />
        )}
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
        {view !== 'settings' &&
          ready &&
          activeAgent &&
          !['bidding', 'legal', 'operation', 'sales', 'solution', 'intel'].includes(activeAgent.name) && (
            <GenericAgentPage agent={activeAgent} />
          )}
      </main>
    </div>
  )
}
