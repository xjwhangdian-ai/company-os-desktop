import { useEffect, useState } from 'react'
import { useIdentityStore } from '../stores/useIdentityStore'
import { useConfigStore } from '../stores/useConfigStore'
import type { TeamMember } from '@shared/agent-types'

interface CompanyPickerProps {
  selectedCompanyId: string
  onSelect: (id: string) => void
}

function CompanyPicker({ selectedCompanyId, onSelect }: CompanyPickerProps): React.JSX.Element {
  const { config, addCompany } = useConfigStore()
  const [newName, setNewName] = useState('')

  if (!config) return <></>

  if (config.companies.length === 0) {
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

  return (
    <select
      value={selectedCompanyId}
      onChange={(e) => onSelect(e.target.value)}
      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-jushi-accent"
    >
      {config.companies.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  )
}

function AddMemberForm({
  onBeforeLogin,
  onDone,
  onCancel
}: {
  onBeforeLogin: () => Promise<void>
  onDone: () => void
  onCancel?: () => void
}): React.JSX.Element {
  const addMember = useIdentityStore((s) => s.addMember)
  const login = useIdentityStore((s) => s.login)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(): Promise<void> {
    if (!name.trim()) {
      setError('请输入名字')
      return
    }
    await onBeforeLogin()
    // 仅零成员时可见（创建首个管理员）；初始 PIN 固定 123456，登录后可改
    const member = await addMember(name.trim())
    await login(member.id, '123456')
    onDone()
  }

  return (
    <div className="w-72 space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700">创建管理员账号（首次使用）</h3>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="管理员名字"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-jushi-accent"
      />
      <p className="text-xs text-slate-400">初始 PIN 为 123456，登录后可修改；员工账号之后由管理员在「设置 → 团队成员」统一分配。</p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        {onCancel && (
          <button onClick={onCancel} className="flex-1 rounded-lg border border-slate-300 py-2 text-sm text-slate-500">
            取消
          </button>
        )}
        <button onClick={handleSubmit} className="flex-1 rounded-lg bg-jushi-accent py-2 text-sm font-medium text-white">
          开始使用
        </button>
      </div>
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
  const { config, loading: configLoading, setActiveCompany } = useConfigStore()
  const [selectedCompanyId, setSelectedCompanyId] = useState('')

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

  const noop = (): void => {}

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
        <p className="mt-1 text-sm text-slate-400">选择公司和身份继续</p>
      </div>

      <CompanyPicker selectedCompanyId={selectedCompanyId} onSelect={setSelectedCompanyId} />

      {members.length === 0 ? (
        <AddMemberForm onBeforeLogin={commitCompany} onDone={noop} />
      ) : (
        <div className="flex flex-wrap justify-center gap-3">
          {members.map((m) => (
            <MemberTile key={m.id} member={m} onBeforeLogin={commitCompany} onLogin={noop} />
          ))}
          <div className="flex w-full basis-full justify-center">
            <p className="mt-1 text-xs text-slate-400">账号由管理员在「设置 → 团队成员」统一分配 · 初始 PIN 123456</p>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
