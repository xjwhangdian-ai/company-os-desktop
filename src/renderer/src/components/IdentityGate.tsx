import { useEffect, useState } from 'react'
import { useIdentityStore } from '../stores/useIdentityStore'
import { useConfigStore } from '../stores/useConfigStore'
import type { TeamMember } from '@shared/agent-types'

interface CompanyPickerProps {
  onSelect: (id: string) => void
}

function CompanyPicker({ onSelect }: CompanyPickerProps): React.JSX.Element {
  const { config, addCompany } = useConfigStore()
  const [newName, setNewName] = useState('')

  if (!config) return <></>

  // 工作台只服务一家公司：已存在公司时不再显示公司选择器（自动使用唯一那家）；
  // 仅在全新安装（0 家公司）时让用户创建第一家。
  if (config.companies.length > 0) return <></>

  return (
    <div className="flex items-center gap-2">
      <input
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        placeholder="第一次用，先输入公司名称"
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-jushi-accent"
      />
      <button
        onClick={async () => {
          if (!newName.trim()) return
          const company = await addCompany(newName.trim())
          onSelect(company.id)
          setNewName('')
        }}
        className="rounded-lg bg-jushi-accent px-3 py-1.5 text-sm font-medium text-white"
      >
        创建
      </button>
    </div>
  )
}

function MemberTile({
  member,
  onBeforeLogin,
  onLogin
}: {
  member: TeamMember
  onBeforeLogin: () => Promise<void>
  onLogin: () => void
}): React.JSX.Element {
  const login = useIdentityStore((s) => s.login)
  const [askingPin, setAskingPin] = useState(false)
  const [changingPin, setChangingPin] = useState(false)
  const [pin, setPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleClick(): Promise<void> {
    if (!member.hasPin) {
      await onBeforeLogin()
      await login(member.id)
      onLogin()
      return
    }
    setAskingPin(true)
  }

  async function handlePinSubmit(): Promise<void> {
    await onBeforeLogin()
    const ok = await window.api.identity.verifyPin(member.id, pin)
    if (!ok) {
      setError('PIN 不对')
      setPin('')
      return
    }
    // 还在用初始 PIN（123456）→ 先给一次改 PIN 的机会（可跳过）
    if (member.usingDefaultPin) {
      setError(null)
      setChangingPin(true)
      return
    }
    await login(member.id, pin)
    onLogin()
  }

  async function handleChangePin(skip: boolean): Promise<void> {
    if (!skip) {
      const r = await window.api.identity.changePin(member.id, pin, newPin.trim())
      if (!r.ok) {
        setError(r.message ?? '修改失败')
        return
      }
    }
    await login(member.id, skip ? pin : newPin.trim())
    onLogin()
  }

  if (changingPin) {
    return (
      <div className="flex w-44 flex-col items-center gap-2 rounded-xl border border-amber-300 bg-white p-3">
        <span className="text-xs font-medium text-amber-600">你还在用初始 PIN</span>
        <input
          autoFocus
          type="password"
          value={newPin}
          onChange={(e) => setNewPin(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleChangePin(false)}
          placeholder="设置新 PIN（4-8位数字）"
          className="w-full rounded border border-slate-300 px-2 py-1 text-center text-xs outline-none"
        />
        {error && <span className="text-xs text-red-500">{error}</span>}
        <div className="flex w-full gap-1.5">
          <button onClick={() => handleChangePin(true)} className="flex-1 rounded border border-slate-300 py-1 text-xs text-slate-500">
            暂不改
          </button>
          <button onClick={() => handleChangePin(false)} className="flex-1 rounded bg-jushi-accent py-1 text-xs font-medium text-white">
            保存并登录
          </button>
        </div>
      </div>
    )
  }

  if (askingPin) {
    return (
      <div className="flex w-32 flex-col items-center gap-2 rounded-xl border border-jushi-accent bg-white p-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-jushi-accent text-sm font-semibold text-white">
          {member.name.slice(0, 1)}
        </span>
        <input
          autoFocus
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handlePinSubmit()}
          placeholder="PIN"
          className={`w-full rounded border px-2 py-1 text-center text-xs outline-none ${error ? 'border-red-400' : 'border-slate-300'}`}
        />
        {error && <span className="text-xs text-red-500">{error}</span>}
        {member.usingDefaultPin && <span className="text-[10px] text-slate-400">初始 PIN：123456</span>}
      </div>
    )
  }

  return (
    <div className="group relative w-32">
      <button
        onClick={handleClick}
        className="flex w-32 flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 hover:border-jushi-accent"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-400 text-sm font-semibold text-white">
          {member.name.slice(0, 1)}
        </span>
        <span className="truncate text-sm text-slate-700">{member.name}</span>
        {member.hasPin && <span className="text-xs text-slate-400">🔒 需要 PIN</span>}
      </button>
    </div>
  )
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
  const { config, loading: configLoading, setActiveCompany, pickCompanyDataDir } = useConfigStore()
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
      setSyncMessage('请先选择管理员提供的 company-os 公司数据目录，再同步账号信息。')
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

      <CompanyPicker onSelect={setSelectedCompanyId} />

      <div className="w-72 rounded-xl border border-sky-200 bg-sky-50 p-4 text-center">
        <p className="text-sm font-medium text-slate-700">首次安装或换电脑？</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">Windows 首次使用：先选择管理员提供的公司数据目录，再同步账号；员工账号会恢复为初始 PIN 123456。</p>
        <button
            onClick={async () => {
              if (!selectedCompanyId) return
              await pickCompanyDataDir(selectedCompanyId)
              await commitCompany()
              setSyncMessage('已选择公司数据目录，请点击“一键同步账号信息”。')
            }}
            disabled={!selectedCompanyId}
            className="mt-3 rounded-lg border border-jushi-accent bg-white px-3 py-1.5 text-xs font-medium text-jushi-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {selectedCompany?.dataDir ? '更换公司数据目录' : '先选择公司数据目录'}
          </button>
        <button
          onClick={syncAccounts}
          disabled={syncing || !selectedCompanyId}
          title={!selectedCompanyId ? '请先选择或创建公司' : '从公司数据仓库同步账号信息'}
          className="mt-3 rounded-lg bg-jushi-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncing ? '正在同步…' : '☁️ 一键同步账号信息'}
        </button>
        {syncMessage && <p className="mt-2 text-xs text-slate-600">{syncMessage}</p>}
      </div>

      {members.length === 0 ? (
        <p className="max-w-sm text-center text-xs leading-5 text-slate-400">尚未同步到可用账号。请先选择管理员提供的公司数据目录并点击上方“一键同步账号信息”；账号只能由管理员预先分配。</p>
      ) : (
        <div className="flex flex-wrap justify-center gap-3">
          {members.map((m) => (
            <MemberTile key={m.id} member={m} onBeforeLogin={commitCompany} onLogin={noop} />
          ))}
          <div className="flex w-full basis-full flex-col items-center gap-1">
            <p className="mt-1 text-xs text-slate-400">账号由管理员在「设置 → 团队成员」统一分配 · 初始 PIN 123456</p>
            <button
              onClick={async () => {
                // 场景：重装/换机后旧配置残留、改过的 PIN 想不起来，且没人能登录进去重置。
                // PIN 是界面级留痕不是安全体系——允许本机自助清空，公司/数据/API Key 全不动。
                const ok = window.confirm(
                  '忘记 PIN？\n\n将清空本机全部登录账号，回到"创建管理员账号"页重新创建（初始 PIN 123456）。\n公司数据、数据目录、API Key 均不受影响。\n\n确定重置吗？'
                )
                if (!ok) return
                try {
                  await window.api.identity.resetAllMembers()
                  await loadMembers()
                } catch {
                  window.alert('重置失败——如果刚更新过程序，请完全退出后重新打开再试')
                }
              }}
              className="text-xs text-slate-400 underline-offset-2 hover:text-jushi-accent hover:underline"
            >
              PIN 一直不对？清除本机旧账号后重新同步
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
