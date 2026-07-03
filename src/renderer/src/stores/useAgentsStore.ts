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
    const list = await window.api.agents.list()
    set({ list, loaded: true })
  },
  select: (name) => set({ selected: name })
}))
