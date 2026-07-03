import type {
  AgentDisplayMeta,
  AgentName,
  AppConfig,
  BiddingProject,
  Company,
  ContractCategory,
  ContractTemplate,
  LegalDoc,
  MaterialLibraryCounts,
  OutputEntry,
  ProviderConfig,
  ProviderId,
  TeamMember
} from './agent-types'
import type { AgentStreamEvent } from './stream-events'

export interface RunAgentRequest {
  runId: string
  agentName: AgentName
  prompt: string
  resumeSessionId?: string
  /** 当前登录的团队成员名字，用于产出文件落款；未登录/跳过身份选择时可不传 */
  userName?: string
}

export interface UploadResult {
  absPath: string
  relativePath: string
}

/** 渲染进程通过 preload 的 contextBridge 拿到的窗口全局 API */
export interface CompanyOsApi {
  config: {
    get(): Promise<AppConfig>
    pickDataDir(): Promise<string | null>
    setActiveProvider(id: ProviderId): Promise<void>
    setProviderConfig(id: ProviderId, patch: Partial<Omit<ProviderConfig, 'id'>>): Promise<void>
    addCompany(name: string): Promise<Company>
    removeCompany(id: string): Promise<void>
    setCompanyDataDir(id: string, dir: string): Promise<void>
    setActiveCompany(id: string): Promise<void>
  }
  agents: {
    list(): Promise<AgentDisplayMeta[]>
  }
  agentRun: {
    start(req: RunAgentRequest): Promise<void>
    cancel(runId: string): Promise<void>
    onEvent(callback: (runId: string, event: AgentStreamEvent) => void): () => void
  }
  dialog: {
    pickFiles(): Promise<string[]>
  }
  shell: {
    showItemInFolder(path: string): Promise<void>
    saveAsCopy(path: string): Promise<boolean>
    openPath(path: string): Promise<void>
  }
  upload: {
    generic(sourcePath: string): Promise<UploadResult>
    biddingRoot(sourcePath: string): Promise<UploadResult>
    biddingMaterial(category: string, sourcePath: string): Promise<UploadResult>
    legalPending(sourcePath: string, category: ContractCategory): Promise<UploadResult>
  }
  outputs: {
    scan(agentName: AgentName): Promise<OutputEntry[]>
  }
  bidding: {
    listProjects(): Promise<BiddingProject[]>
    materialCounts(): Promise<MaterialLibraryCounts>
  }
  legal: {
    listDocs(): Promise<{ pending: LegalDoc[]; reviewed: LegalDoc[] }>
    markReviewed(fileName: string): Promise<void>
    listTemplates(): Promise<ContractTemplate[]>
    uploadTemplate(category: ContractCategory, sourcePath: string): Promise<UploadResult>
  }
  docgen: {
    exportMarkdownFile(markdownPath: string): Promise<string>
    exportBiddingTriSplit(
      markdownPath: string
    ): Promise<{ bookTitle: string; fileName: string; path: string }[]>
  }
  gzh: {
    runStyle(inputMdPath: string): Promise<string>
  }
  identity: {
    list(): Promise<TeamMember[]>
    add(name: string, pin?: string): Promise<TeamMember>
    remove(id: string): Promise<void>
    verifyPin(id: string, pin?: string): Promise<boolean>
  }
}

declare global {
  interface Window {
    api: CompanyOsApi
  }
}
