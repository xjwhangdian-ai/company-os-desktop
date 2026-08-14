import { useEffect, useState } from 'react'
import { useIdentityStore } from '../stores/useIdentityStore'
import { useConfigStore } from '../stores/useConfigStore'
import type { TeamMember } from '@shared/agent-types'

/** 已创建的本机账号可用账号 + PIN 密码登录。 */
function AccountLogin({ members, onBeforeLogin }: { members: TeamMember[]; onBeforeLogin: () => Promise<void> }): React.JSX.Element {
  const login = useIdentityStore((s) => s.login)
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  async function submit(): Promise<void> {
    const member = members.find((m) => m.name.trim().toLowerCase() === name.trim().toLowerCase())
    if (!member) { setMessage('该账号不在这台电脑上。请核对账号，或清除本机账号后重新创建。'); return }
    await onBeforeLogin()
    if (!(await window.api.identity.verifyPin(member.id, pin))) { setMessage('PIN 密码不正确，请重试。'); return }
    if (member.usingDefaultPin) {
      const next = window.prompt('这是旧账号的默认 PIN。可立即设置新的 4–8 位数字 PIN；留空则暂不修改。')?.trim()
      if (next) {
        const result = await window.api.identity.changePin(member.id, pin, next)
        if (!result.ok) { setMessage(result.message ?? 'PIN 修改失败'); return }
        await login(member.id, next)
      } else await login(member.id, pin)
    } else await login(member.id, pin)
  }

  return <div className="w-72 space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-sm font-medium text-slate-700">账号登录</p>
    <label className="block text-xs text-slate-500">账号
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="这台电脑上已创建的账号" className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-jushi-accent" />
    </label>
    <label className="block text-xs text-slate-500">PIN 密码
      <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} placeholder="输入 PIN 密码" className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-jushi-accent" />
    </label>
    <button onClick={() => void submit()} title="校验账号和 PIN 密码，正确后进入工作台" className="w-full rounded bg-jushi-accent py-1.5 text-sm font-medium text-white">登录</button>
    <p className="text-[11px] leading-4 text-slate-400">账号与 PIN 密码只保存在当前电脑，不会同步到其他成员设备。</p>
    {message && <p className="text-xs leading-5 text-amber-700">{message}</p>}
  </div>
}

/** 新设备没有本机账号时，自助创建首个账号与 PIN 密码。 */
function RegisterAccount({ onRegistered }: { onRegistered: () => Promise<void> }): React.JSX.Element {
  const login = useIdentityStore((s) => s.login)
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  async function submit(): Promise<void> {
    if (pin !== confirmPin) { setMessage('两次输入的 PIN 密码不一致'); return }
    const result = await window.api.identity.register(name, pin)
    if (!result.ok || !result.member) { setMessage(result.message ?? '创建账号失败'); return }
    await onRegistered()
    if (!(await login(result.member.id, pin))) setMessage('账号已创建，请使用账号和 PIN 密码登录')
  }

  return <div className="w-72 space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-sm font-medium text-slate-700">创建本机账号</p>
    <p className="text-xs leading-5 text-slate-500">首次安装请创建自己的账号和 PIN 密码。每台电脑独立保存，不需要管理员分配或同步。</p>
    <label className="block text-xs text-slate-500">账号名称
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：ceshi" maxLength={32} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-jushi-accent" />
    </label>
    <label className="block text-xs text-slate-500">PIN 密码（4–8 位数字）
      <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="自行设置" className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-jushi-accent" />
    </label>
    <label className="block text-xs text-slate-500">确认 PIN 密码
      <input type="password" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} placeholder="再次输入 PIN 密码" className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-jushi-accent" />
    </label>
    <button onClick={() => void submit()} className="w-full rounded bg-jushi-accent py-1.5 text-sm font-medium text-white">创建并进入工作台</button>
    {message && <p className="text-xs leading-5 text-amber-700">{message}</p>}
  </div>
}

/** 每次启动均在本机选择已创建身份；账号仅用于本地工作留痕，不是统一认证系统。 */
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
    if (selectedCompanyId && selectedCompanyId !== config?.activeCompanyId) await setActiveCompany(selectedCompanyId)
  }

  if (!loaded || configLoading) {
    return <div className="flex h-screen items-center justify-center text-sm text-slate-400">加载中…</div>
  }

  return (
    <div className="h-screen overflow-y-auto bg-slate-100">
      <div className="app-drag fixed inset-x-0 top-0 h-10" />
      <div className="flex min-h-full flex-col items-center justify-center gap-6 py-12">
        <div className="text-center">
          <h1 className="text-lg font-bold text-jushi-blue">Agent 工作台</h1>
          <p className="mt-1 text-sm text-slate-400">选择身份继续</p>
        </div>

        {members.length === 0 ? (
          <RegisterAccount onRegistered={loadMembers} />
        ) : (
          <>
            <AccountLogin members={members} onBeforeLogin={commitCompany} />
            <div className="flex flex-col items-center gap-1">
              <p className="mt-1 text-xs text-slate-400">使用这台电脑上已创建的账号和 PIN 密码登录</p>
              <button
                onClick={async () => {
                  const ok = window.confirm('需要重新创建本机账号？\n\n将清空这台电脑保存的账号和 PIN 密码；公司数据、数据目录、API Key 均不受影响。\n\n确定继续吗？')
                  if (!ok) return
                  try { await window.api.identity.resetAllMembers(); await loadMembers() } catch { window.alert('重置失败——请完全退出后重新打开再试') }
                }}
                className="text-xs text-slate-400 underline-offset-2 hover:text-jushi-accent hover:underline"
              >
                PIN 密码不对或需要换账号？清除本机账号后重新创建（不会删除公司资料）
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
