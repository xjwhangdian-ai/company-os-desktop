import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { CompanyOsApi, RunAgentRequest, UploadResult } from '@shared/api-types'
import type { AgentStreamEvent } from '@shared/stream-events'
import type { AgentName, ContractCategory, ProviderConfig, ProviderId } from '@shared/agent-types'

const api: CompanyOsApi = {
  config: {
    get: () => ipcRenderer.invoke(IPC.configGet),
    pickDataDir: () => ipcRenderer.invoke(IPC.configPickDataDir),
    setActiveProvider: (id: ProviderId) => ipcRenderer.invoke(IPC.configSetActiveProvider, id),
    setProviderConfig: (id: ProviderId, patch: Partial<Omit<ProviderConfig, 'id'>>) =>
      ipcRenderer.invoke(IPC.configSetProviderConfig, id, patch),
    addCompany: (name: string) => ipcRenderer.invoke(IPC.configAddCompany, name),
    removeCompany: (id: string) => ipcRenderer.invoke(IPC.configRemoveCompany, id),
    setCompanyDataDir: (id: string, dir: string) => ipcRenderer.invoke(IPC.configSetCompanyDataDir, id, dir),
    setActiveCompany: (id: string) => ipcRenderer.invoke(IPC.configSetActiveCompany, id)
  },
  agents: {
    list: () => ipcRenderer.invoke(IPC.agentsList)
  },
  agentRun: {
    start: (req: RunAgentRequest) => ipcRenderer.invoke(IPC.agentRun, req),
    cancel: (runId: string) => ipcRenderer.invoke(IPC.agentCancel, runId),
    onEvent: (callback: (runId: string, event: AgentStreamEvent) => void) => {
      const listener = (_e: unknown, runId: string, event: AgentStreamEvent): void => callback(runId, event)
      ipcRenderer.on(IPC.agentStreamEvent, listener)
      return () => ipcRenderer.removeListener(IPC.agentStreamEvent, listener)
    }
  },
  dialog: {
    pickFiles: () => ipcRenderer.invoke(IPC.dialogPickFiles)
  },
  shell: {
    showItemInFolder: (path: string) => ipcRenderer.invoke(IPC.shellShowItemInFolder, path),
    saveAsCopy: (path: string) => ipcRenderer.invoke(IPC.shellSaveAsCopy, path),
    openPath: (path: string) => ipcRenderer.invoke(IPC.shellOpenPath, path)
  },
  upload: {
    generic: (sourcePath: string): Promise<UploadResult> => ipcRenderer.invoke(IPC.uploadGeneric, sourcePath),
    biddingRoot: (sourcePath: string): Promise<UploadResult> => ipcRenderer.invoke(IPC.uploadBiddingRoot, sourcePath),
    biddingMaterial: (category: string, sourcePath: string): Promise<UploadResult> =>
      ipcRenderer.invoke(IPC.uploadBiddingMaterial, category, sourcePath),
    legalPending: (sourcePath: string, category: ContractCategory): Promise<UploadResult> =>
      ipcRenderer.invoke(IPC.uploadLegalPending, sourcePath, category)
  },
  outputs: {
    scan: (agentName: AgentName) => ipcRenderer.invoke(IPC.outputsScan, agentName)
  },
  bidding: {
    listProjects: () => ipcRenderer.invoke(IPC.biddingListProjects),
    materialCounts: () => ipcRenderer.invoke(IPC.biddingMaterialCounts)
  },
  legal: {
    listDocs: () => ipcRenderer.invoke(IPC.legalListDocs),
    markReviewed: (fileName: string) => ipcRenderer.invoke(IPC.legalMarkReviewed, fileName),
    listTemplates: () => ipcRenderer.invoke(IPC.legalListTemplates),
    uploadTemplate: (category: ContractCategory, sourcePath: string): Promise<UploadResult> =>
      ipcRenderer.invoke(IPC.legalUploadTemplate, category, sourcePath)
  },
  docgen: {
    exportMarkdownFile: (markdownPath: string) => ipcRenderer.invoke(IPC.docgenExportMarkdownFile, markdownPath),
    exportBiddingTriSplit: (markdownPath: string) =>
      ipcRenderer.invoke(IPC.docgenExportBiddingTriSplit, markdownPath)
  },
  gzh: {
    runStyle: (inputMdPath: string) => ipcRenderer.invoke(IPC.gzhRunStyle, inputMdPath)
  },
  identity: {
    list: () => ipcRenderer.invoke(IPC.identityList),
    add: (name: string, pin?: string) => ipcRenderer.invoke(IPC.identityAdd, name, pin),
    remove: (id: string) => ipcRenderer.invoke(IPC.identityRemove, id),
    verifyPin: (id: string, pin?: string) => ipcRenderer.invoke(IPC.identityVerifyPin, id, pin)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  window.api = api
}
