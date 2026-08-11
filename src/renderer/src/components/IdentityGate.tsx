import { useEffect, useState } from 'react'
import { useIdentityStore } from '../stores/useIdentityStore'
import { useConfigStore } from '../stores/useConfigStore'
import type { TeamMember } from '@shared/agent-types'

/** 手工输入只能登录管理员花名册中已有的账号，未知账号绝不自动创建。 */
function AccountLogin({ members, onBeforeLogin, onLogin }: { members: TeamMember[]; onBeforeLogin: () => Promise<void>; onLogin: () => void }): React.JSX.Element {
  const login = useIdentityStore((s) => s.login)
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  async function submit(): Promise<void> {
    const member = members.find((m) => m.name.trim().toLowerCase() === name.trim().toLowerCase())
    if (!member) { setMessage('该账号未由管理员分配。请先点击“一键同步账号信息”，不要自行创建账号。'); return }
    await onBeforeLogin()
    if (!(await window.api.identity.verifyPin(member.id, pin))) { setMessage('PIN 不正确。首次登录请使用默认 PIN 123456。'); return }
    if (member.usingDefaultPin) {
      const next = window.prompt('这是初始 PIN。可立即设置新的 4–8 位数字 PIN；留空则暂不修改。')?.trim()
      if (next) {
        const r = await window.api.identity.changePin(member.id, pin, next)
        if (!r.ok) { setMessage(r.message ?? 'PIN 修改失败'); return }
        await login(member.id, next)
      } else await login(member.id, pin)
    } else await login(member.id, pin)
    onLogin()
  }
  return <div className="w-72 space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-sm font-medium text-slate-700">账号登录</p>
    <label className="block text-xs text-slate-500">账号：填写管理员在“团队成员”中分配的账号。
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="管理员分配的账号" className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-jushi-accent" />
    </label>
    <label className="block text-xs text-slate-500">PIN：首次登录输入默认 PIN <b>123456</b>；登录后可自行修改。
      <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} placeholder="首次登录默认 123456" className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-jushi-accent" />
    </label>
    <button onClick={() => void submit()} title="校验账号和 PIN，正确后进入工作台" className="w-full rounded bg-jushi-accent py-1.5 text-sm font-medium text-white">登录</button>
    <p className="text-[11px] leading-4 text-slate-400">“登录”只验证管理员已分配的账号，不会创建新账号。</p>
    {message && <p className="text-xs leading-5 text-amber-700">{message}</p>}
  </div>
}

/**
 * 每次启动 App 都要先选公司+选身份（可选 PIN）才能进主界面——纯本地校验，用于产出留痕，
 * 不是真账号安全。登录成功后 useIdentityStore.currentUser 变化会让 App.tsx 自动重渲染
 * 切走这个页面，这里不需要也不接收"登录后做什么"的回调。
 *
 * 公司选择（下拉框，异步落盘 IPC）和身份登录（内存瞬时切换）走的是两个独立的 store，
 * 如果各自即点即触发、互不等待，"选完公司立刻点身份卡片"这个正常操作顺序会出现竞态——
 * App.tsx 读到的可能还是切换前的公司。所以这里把"选中哪家公司"做成本组件的同步本地
 * state（下拉框改变只更新这个，不直接落盘），登录动作统一先 await 把这个选择落盘
 * （commitCompany），再执行真正的登录，保证进主界面时公司一定是选中的那家。
 */
export function IdentityGate(): React.JSX.Element {
  const { members, loaded, loadMembers } = useIdentityStore()
  const { config, loading: configLoading, setActiveCompany } = useConfigStore()
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  useEffect(() => {
    loadMembers()
  }, [loadMembers])

  useEffect(() => {
    if (config?.activeCompanyId && !selectedCompanyId) setSelectedCompanyId(config.activeCompanyId)
  }, [config?.activeCompanyId, selectedCompanyId])

  async function commitCompany(): Promise<void> {
    if (selectedCompanyId && selectedCompanyId !== config?.activeCompanyId) {
      await setActiveCompany(selectedCompanyId)
    }
  }

  async function syncAccounts(): Promise<void> {
    await commitCompany()
    const company = config?.companies.find((c) => c.id === selectedCompanyId)
    if (!company?.dataDir) {
      setSyncMessage('默认公司数据目录尚未就绪。请完全退出并重新打开工作台；如仍未恢复，请在设置页更改数据目录。')
      return
    }
    setSyncing(true)
    setSyncMessage(null)
    try {
      // 即便远程 Git 同步失败，也先尝试应用当前目录已有花名册：重装/换机时可恢复初始 PIN。
      const localRoster = await window.api.identity.syncRoster()
      await loadMembers()
      const result = await window.api.sync.now('首次登录同步')
      if (!result.ok) {
        setSyncMessage(localRoster.length > 0 ? `已读取本机花名册并恢复员工初始 PIN（123456）；远程同步未完成：${result.message || '请确认所选目录已绑定公司 Git 仓库'}` : (result.message || '同步失败，请确认网络与公司数据目录后重试'))
        return
      }
      // 必须在 git pull 成功后再应用一次，才能读到刚下载的管理员花名册。
      const roster = await window.api.identity.syncRoster()
      await loadMembers()
      setSyncMessage(roster.length > 0 ? `已同步 ${roster.length} 个管理员分配的账号；初始 PIN 为 123456。` : '同步成功，但未找到账号花名册；请联系管理员在「设置 → 团队成员」分配账号。')
    } catch {
      setSyncMessage('同步失败，请确认网络、Git 连接和公司数据目录后重试。')
    } finally {
      setSyncing(false)
    }
  }

  const noop = (): void => {}
  const selectedCompany = config?.companies.find((c) => c.id === selectedCompanyId)

  if (!loaded || configLoading) {
    return <div className="flex h-screen items-center justify-center text-sm text-slate-400">加载中…</div>
  }

  return (
    <div className="h-screen overflow-y-auto bg-slate-100">
      {/* 无标题栏窗口在登录页也要能拖动：顶部整条做拖拽区（这一片没有可点元素） */}
      <div className="app-drag fixed inset-x-0 top-0 h-10" />
      <div className="flex min-h-full flex-col items-center justify-center gap-6 py-12">
      <div className="text-center">
        <h1 className="text-lg font-bold text-jushi-blue">Agent 工作台</h1>
        <p className="mt-1 text-sm text-slate-400">选择身份继续</p>
      </div>

      <div className="w-72 rounded-xl border border-sky-200 bg-sky-50 p-4 text-center">
        <p className="text-sm font-medium text-slate-700">首次安装或换电脑？</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">安装时已自动创建默认公司数据目录，无需在这里选择。只有管理员需要调整目录时，才到“设置 → 数据目录”操作。</p>
        {selectedCompany?.dataDir && <p className="mt-2 truncate rounded bg-white/70 px-2 py-1 text-[10px] text-slate-400" title={selectedCompany.dataDir}>默认数据目录：{selectedCompany.dataDir}</p>}
        <button
          onClick={syncAccounts}
          disabled={syncing || !selectedCompanyId}
          title={!selectedCompanyId ? '正在准备默认公司数据目录，请稍候' : '从公司数据仓库同步管理员已分配的账号'}
          className="mt-3 rounded-lg bg-jushi-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncing ? '正在同步…' : '☁️ 一键同步账号信息'}
        </button>
        <p className="mt-1.5 text-[11px] leading-4 text-slate-500">“一键同步”会下载管理员分配的账号；同步完成后，使用自己的账号和初始 PIN 123456 登录。</p>
        {syncMessage && <p className="mt-2 text-xs text-slate-600">{syncMessage}</p>}
      </div>

      {members.length === 0 ? (
        <p className="max-w-sm text-center text-xs leading-5 text-slate-400">尚未同步到可用账号。请点击上方“一键同步账号信息”；账号只能由管理员预先分配。</p>
      ) : (
        <div className="flex flex-col items-center gap-1">
          <p className="mt-1 text-xs text-slate-400">账号由管理员在「设置 → 团队成员」统一分配 · 初始 PIN 123456</p>
          <button
            onClick={async () => {
              const ok = window.confirm('忘记 PIN？\n\n将清空本机账号缓存，随后请使用上方“一键同步账号信息”重新获取管理员分配的账号（初始 PIN 123456）。\n公司数据、数据目录、API Key 均不受影响。\n\n确定重置吗？')
              if (!ok) return
              try { await window.api.identity.resetAllMembers(); await loadMembers() } catch { window.alert('重置失败——请完全退出后重新打开再试') }
            }}
            className="text-xs text-slate-400 underline-offset-2 hover:text-jushi-accent hover:underline"
          >
            PIN 一直不对？清除本机旧账号后重新同步（不会删除公司资料）
          </button>
        </div>
      )}
      <AccountLogin members={members} onBeforeLogin={commitCompany} onLogin={noop} />
      </div>
    </div>
  )
}
