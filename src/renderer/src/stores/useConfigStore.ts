import { create } from 'zustand'
import type { AppConfig, Company, ProviderConfig, ProviderId } from '@shared/agent-types'

interface ConfigState {
  config: AppConfig | null
  loading: boolean
  load: () => Promise<void>
  addCompany: (name: string) => Promise<Company>
  removeCompany: (id: string) => Promise<void>
  /** 打开系统目录选择框，选好后直接绑定到这家公司 */
  pickCompanyDataDir: (companyId: string) => Promise<void>
  setActiveCompany: (id: string) => Promise<void>
  setActiveProvider: (id: ProviderId) => Promise<void>
  saveProviderConfig: (id: ProviderId, patch: Partial<Omit<ProviderConfig, 'id'>>) => Promise<void>
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: null,
  loading: true,
  load: async () => {
    set({ loading: true })
    const config = await window.api.config.get()
    set({ config, loading: false })
  },
  addCompany: async (name: string) => {
    const company = await window.api.config.addCompany(name)
    await get().load()
    return company
  },
  removeCompany: async (id: string) => {
    await window.api.config.removeCompany(id)
    await get().load()
  },
  pickCompanyDataDir: async (companyId: string) => {
    const dir = await window.api.config.pickDataDir()
    if (!dir) return
    await window.api.config.setCompanyDataDir(companyId, dir)
    await get().load()
  },
  setActiveCompany: async (id: string) => {
    await window.api.config.setActiveCompany(id)
    await get().load()
  },
  setActiveProvider: async (id: ProviderId) => {
    await window.api.config.setActiveProvider(id)
    await get().load()
  },
  saveProviderConfig: async (id: ProviderId, patch: Partial<Omit<ProviderConfig, 'id'>>) => {
    await window.api.config.setProviderConfig(id, patch)
    await get().load()
  }
}))
