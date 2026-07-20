import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { CompanyOsApi, FileFilter, RunAgentRequest, UploadResult } from '@shared/api-types'
import type { AgentStreamEvent } from '@shared/stream-events'
import type {
  AgentName,
  BidProjectCard,
  MemberRole,
  ContractCategory,
  CustomerFields,
  LinkedFile,
  ProductFields,
  ProviderConfig,
  ProviderId,
  SolutionFileKind,
  TranscribeEvent
} from '@shared/agent-types'

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
    pickFiles: (filters?: FileFilter[]) => ipcRenderer.invoke(IPC.dialogPickFiles, filters)
  },
  shell: {
    showItemInFolder: (path: string) => ipcRenderer.invoke(IPC.shellShowItemInFolder, path),
    saveAsCopy: (path: string) => ipcRenderer.invoke(IPC.shellSaveAsCopy, path),
    openPath: (path: string) => ipcRenderer.invoke(IPC.shellOpenPath, path)
  },
  upload: {
    generic: (agentName: AgentName, sourcePath: string): Promise<UploadResult> =>
      ipcRenderer.invoke(IPC.uploadGeneric, agentName, sourcePath),
    biddingProject: (sourcePath: string) => ipcRenderer.invoke(IPC.uploadBiddingProject, sourcePath),
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
    materialCounts: () => ipcRenderer.invoke(IPC.biddingMaterialCounts),
    saveCard: (folderName: string, card: BidProjectCard) => ipcRenderer.invoke(IPC.biddingSaveCard, folderName, card),
    exportLedger: () => ipcRenderer.invoke(IPC.biddingExportLedger),
    uploadClarification: (projectFolder: string, sourcePath: string) =>
      ipcRenderer.invoke(IPC.uploadBiddingClarification, projectFolder, sourcePath)
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
    verifyPin: (id: string, pin?: string) => ipcRenderer.invoke(IPC.identityVerifyPin, id, pin),
    setRole: (id: string, role: MemberRole) => ipcRenderer.invoke(IPC.identitySetRole, id, role),
    notifyLogin: (name: string) => ipcRenderer.invoke(IPC.identityNotifyLogin, name)
  },
  sync: {
    status: () => ipcRenderer.invoke(IPC.syncStatus),
    now: (userName: string) => ipcRenderer.invoke(IPC.syncNow, userName),
    lastAt: () => ipcRenderer.invoke(IPC.syncLastAt)
  },
  sales: {
    listProducts: () => ipcRenderer.invoke(IPC.salesListProducts),
    saveProduct: (fields: ProductFields, id?: string) => ipcRenderer.invoke(IPC.salesSaveProduct, fields, id),
    removeProduct: (id: string) => ipcRenderer.invoke(IPC.salesRemoveProduct, id),
    setProductImage: (id: string, sourcePath: string) => ipcRenderer.invoke(IPC.salesSetProductImage, id, sourcePath),
    uploadSupplierDoc: (sourcePath: string) => ipcRenderer.invoke(IPC.salesUploadSupplierDoc, sourcePath),
    importExcel: (relativePath: string) => ipcRenderer.invoke(IPC.salesImportExcel, relativePath),
    exportQuoteImages: (productIds: string[], customerName: string) =>
      ipcRenderer.invoke(IPC.salesExportQuoteImages, productIds, customerName),
    listTemplates: () => ipcRenderer.invoke(IPC.salesListTemplates),
    uploadTemplate: (sourcePath: string) => ipcRenderer.invoke(IPC.salesUploadTemplate, sourcePath),
    listCustomers: () => ipcRenderer.invoke(IPC.salesListCustomers),
    saveCustomer: (fields: CustomerFields, id?: string) => ipcRenderer.invoke(IPC.salesSaveCustomer, fields, id),
    removeCustomer: (id: string) => ipcRenderer.invoke(IPC.salesRemoveCustomer, id),
    addFollowUp: (customerId: string, content: string) => ipcRenderer.invoke(IPC.salesAddFollowUp, customerId, content),
    linkCustomerFile: (customerId: string, 类型: LinkedFile['类型'], filePath: string) =>
      ipcRenderer.invoke(IPC.salesLinkCustomerFile, customerId, 类型, filePath),
    unlinkCustomerFile: (customerId: string, index: number) =>
      ipcRenderer.invoke(IPC.salesUnlinkCustomerFile, customerId, index),
    resolveLinkedPath: (stored: string) => ipcRenderer.invoke(IPC.salesResolveLinkedPath, stored)
  },
  solution: {
    listFiles: () => ipcRenderer.invoke(IPC.solutionListFiles),
    upload: (kind: SolutionFileKind, sourcePath: string) => ipcRenderer.invoke(IPC.solutionUpload, kind, sourcePath),
    removeFile: (relativePath: string) => ipcRenderer.invoke(IPC.solutionRemoveFile, relativePath),
    whisperStatus: () => ipcRenderer.invoke(IPC.solutionWhisperStatus),
    transcribeStart: (jobId: string, audioRelativePath: string, model: string) =>
      ipcRenderer.invoke(IPC.solutionTranscribeStart, jobId, audioRelativePath, model),
    transcribeCancel: (jobId: string) => ipcRenderer.invoke(IPC.solutionTranscribeCancel, jobId),
    onTranscribeEvent: (callback: (event: TranscribeEvent) => void) => {
      const listener = (_e: unknown, event: TranscribeEvent): void => callback(event)
      ipcRenderer.on(IPC.solutionTranscribeEvent, listener)
      return () => ipcRenderer.removeListener(IPC.solutionTranscribeEvent, listener)
    }
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  window.api = api
}
