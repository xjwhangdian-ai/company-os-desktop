import { create } from 'zustand'
import type { AgentDisplayMeta, AgentName } from '@shared/agent-types'

interface AgentsState {
  list: AgentDisplayMeta[]
  loaded: boolean
  selected: AgentName | null
  load: () => Promise<void>
  select: (name: AgentName | null) => void
}

export const useAgentsStore = create<AgentsState>((set) => ({
  list: [],
  loaded: false,
  selected: null,
  load: async () => {
    try {
      const list = await window.api.agents.list()
      set({ list, loaded: true })
    } catch {
      // 数据目录不可读等异常也要置 loaded，让界面能显示"分身列表为空"的修复引导而不是永远加载中
      set({ list: [], loaded: true })
    }
  },
  select: (name) => set({ selected: name })
}))
