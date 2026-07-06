import { create } from 'zustand'
import type { TeamMember } from '@shared/agent-types'

interface IdentityState {
  members: TeamMember[]
  loaded: boolean
  /** 当前会话选中的身份，仅存在内存里，每次重启 App 都要求重新选择 */
  currentUser: TeamMember | null
  loadMembers: () => Promise<void>
  addMember: (name: string, pin?: string) => Promise<TeamMember>
  removeMember: (id: string) => Promise<void>
  /** 校验通过则设为 currentUser 并返回 true */
  login: (id: string, pin?: string) => Promise<boolean>
  logout: () => void
}

export const useIdentityStore = create<IdentityState>((set, get) => ({
  members: [],
  loaded: false,
  currentUser: null,
  loadMembers: async () => {
    const members = await window.api.identity.list()
    set({ members, loaded: true })
  },
  addMember: async (name, pin) => {
    const member = await window.api.identity.add(name, pin)
    await get().loadMembers()
    return member
  },
  removeMember: async (id) => {
    await window.api.identity.remove(id)
    await get().loadMembers()
    if (get().currentUser?.id === id) set({ currentUser: null })
  },
  login: async (id, pin) => {
    const ok = await window.api.identity.verifyPin(id, pin)
    if (!ok) return false
    const member = get().members.find((m) => m.id === id) ?? null
    set({ currentUser: member })
    // 告知主进程当前用户名——"关闭前同步"的提交署名用
    if (member) window.api.identity.notifyLogin(member.name)
    return true
  },
  logout: () => set({ currentUser: null })
}))
