import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { CompanyOsApi, FileFilter, RunAgentRequest, UploadResult } from '@shared/api-types'
import type { AgentStreamEvent } from '@shared/stream-events'
import type {
  AgentName,
  FinanceEmployee,
  IntelReport,
  OpsDocState,
  BidProjectCard,
  MemberRole,
  ContractCategory,
  CustomerFields,
  LinkedFile,
  ProductFields,
  ProviderConfig,
  ProviderId,
  VideoModelConfigPatch,
  QuoteLineInput,
  SolutionFileKind,
} from '@shared/agent-types'

const api: CompanyOsApi = {
  config: {
    get: () => ipcRenderer.invoke(IPC.configGet),
    pickDataDir: () => ipcRenderer.invoke(IPC.configPickDataDir),
    setActiveProvider: (id: ProviderId) => ipcRenderer.invoke(IPC.configSetActiveProvider, id),
    setProviderConfig: (id: ProviderId, patch: Partial<Omit<ProviderConfig, 'id'>>) =>
      ipcRenderer.invoke(IPC.configSetProviderConfig, id, patch),
    setVideoModelConfig: (patch: VideoModelConfigPatch) => ipcRenderer.invoke(IPC.configSetVideoModelConfig, patch),
    addCompany: (name: string) => ipcRenderer.invoke(IPC.configAddCompany, name),
    removeCompany: (id: string) => ipcRenderer.invoke(IPC.configRemoveCompany, id),
    setCompanyDataDir: (id: string, dir: string) => ipcRenderer.invoke(IPC.configSetCompanyDataDir, id, dir),
    setActiveCompany: (id: string) => ipcRenderer.invoke(IPC.configSetActiveCompany, id),
    initDataDir: (companyId: string) => ipcRenderer.invoke(IPC.configInitDataDir, companyId),
    repairDataDir: () => ipcRenderer.invoke(IPC.configRepairDataDir)
  },
  brand: {
    listMatters: () => ipcRenderer.invoke(IPC.brandListMatters),
    setMatter: (key: string, patch: Record<string, string>) => ipcRenderer.invoke(IPC.brandSetMatter, key, patch)
  },
  env: {
    check: () => ipcRenderer.invoke(IPC.envCheck),
    install: (key: string) => ipcRenderer.invoke(IPC.envInstall, key)
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
  mba: {
    listCourses: () => ipcRenderer.invoke(IPC.mbaListCourses),
    uploadCourse: (course: string, category: '课件' | '作业与要求' | '课堂录音', sourcePath: string) =>
      ipcRenderer.invoke(IPC.mbaUploadCourse, course, category, sourcePath)
  },
  shell: {
    showItemInFolder: (path: string) => ipcRenderer.invoke(IPC.shellShowItemInFolder, path),
    saveAsCopy: (path: string) => ipcRenderer.invoke(IPC.shellSaveAsCopy, path),
    openPath: (path: string) => ipcRenderer.invoke(IPC.shellOpenPath, path)
  },
  help: {
    memberGuide: () => ipcRenderer.invoke(IPC.helpMemberGuide)
  },
  upload: {
    generic: (agentName: AgentName, sourcePath: string): Promise<UploadResult> =>
      ipcRenderer.invoke(IPC.uploadGeneric, agentName, sourcePath),
    biddingProject: (sourcePath: string) => ipcRenderer.invoke(IPC.uploadBiddingProject, sourcePath),
    biddingMaterial: (category: string, sourcePath: string): Promise<UploadResult> =>
      ipcRenderer.invoke(IPC.uploadBiddingMaterial, category, sourcePath),
    legalPending: (sourcePath: string, category: ContractCategory): Promise<UploadResult> =>
      ipcRenderer.invoke(IPC.uploadLegalPending, sourcePath, category),
    operationTheme: (theme: string, sourcePath: string): Promise<UploadResult> =>
      ipcRenderer.invoke(IPC.uploadOperationTheme, theme, sourcePath)
  },
  operation: {
    applyImageNames: (theme: string): Promise<{ renamed: number; listRelative: string; total: number }> =>
      ipcRenderer.invoke(IPC.operationApplyImageNames, theme),
    uploadTemplate: (sourcePath: string): Promise<UploadResult> =>
      ipcRenderer.invoke(IPC.operationUploadTemplate, sourcePath),
    listTemplates: () => ipcRenderer.invoke(IPC.operationListTemplates),
    recentArticles: () => ipcRenderer.invoke(IPC.operationRecentArticles)
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
      ipcRenderer.invoke(IPC.uploadBiddingClarification, projectFolder, sourcePath),
    uploadTenderFile: (projectFolder: string, sourcePath: string) =>
      ipcRenderer.invoke(IPC.uploadBiddingTenderFile, projectFolder, sourcePath),
    listCandidates: () => ipcRenderer.invoke(IPC.biddingListCandidates),
    confirmCandidate: (key: string) => ipcRenderer.invoke(IPC.biddingConfirmCandidate, key),
    ignoreCandidate: (key: string) => ipcRenderer.invoke(IPC.biddingIgnoreCandidate, key),
    listPriorityProjects: () => ipcRenderer.invoke(IPC.biddingListPriorityProjects),
    markPriority: (key: string) => ipcRenderer.invoke(IPC.biddingMarkPriority, key),
    moveProjectToPriority: (folderName: string) => ipcRenderer.invoke(IPC.biddingMoveProjectToPriority, folderName),
    followWinner: (key: string) => ipcRenderer.invoke(IPC.biddingFollowWinner, key),
    downloadTender: (folderName: string) => ipcRenderer.invoke(IPC.biddingDownloadTender, folderName),
    probeTender: (folderName: string) => ipcRenderer.invoke(IPC.biddingProbeTender, folderName),
    deleteProject: (folderName: string) => ipcRenderer.invoke(IPC.biddingDeleteProject, folderName)
  },
  intel: {
    listReports: () => ipcRenderer.invoke(IPC.intelListReports),
    purgeStale: () => ipcRenderer.invoke(IPC.intelPurgeStale),
    fetchNow: (force?: boolean) => ipcRenderer.invoke(IPC.intelFetchNow, force ?? false),
    saveReportToSolution: (report: IntelReport) => ipcRenderer.invoke(IPC.intelSaveReportToSolution, report),
    fetchReports: () => ipcRenderer.invoke(IPC.intelFetchReports),
    getKeywords: () => ipcRenderer.invoke(IPC.intelGetKeywords),
    keywordSuggestions: () => ipcRenderer.invoke(IPC.intelKeywordSuggestions),
    setKeywords: (keywords: string[]) => ipcRenderer.invoke(IPC.intelSetKeywords, keywords),
    getKeywordGroups: () => ipcRenderer.invoke(IPC.intelGetKeywordGroups),
    setKeywordGroups: (groups) => ipcRenderer.invoke(IPC.intelSetKeywordGroups, groups),
    ignoreReport: (链接: string) => ipcRenderer.invoke(IPC.intelIgnoreReport, 链接),
    downloadReport: (report: IntelReport) => ipcRenderer.invoke(IPC.intelDownloadReport, report),
    getReportKeywords: () => ipcRenderer.invoke(IPC.intelReportKeywordsGet),
    setReportKeywords: (keywords: string[]) => ipcRenderer.invoke(IPC.intelReportKeywordsSet, keywords)
  },
  legal: {
    listDocs: () => ipcRenderer.invoke(IPC.legalListDocs),
    markReviewed: (fileName: string) => ipcRenderer.invoke(IPC.legalMarkReviewed, fileName),
    generateRedline: (fileName: string) => ipcRenderer.invoke(IPC.legalGenerateRedline, fileName),
    listTemplates: () => ipcRenderer.invoke(IPC.legalListTemplates),
    uploadTemplate: (category: ContractCategory, sourcePath: string): Promise<UploadResult> =>
      ipcRenderer.invoke(IPC.legalUploadTemplate, category, sourcePath)
  },
  docgen: {
    exportMarkdownFile: (markdownPath: string) => ipcRenderer.invoke(IPC.docgenExportMarkdownFile, markdownPath),
    exportMarkdownPptx: (markdownPath: string) => ipcRenderer.invoke(IPC.docgenExportMarkdownPptx, markdownPath),
    exportBiddingTriSplit: (markdownPath: string) =>
      ipcRenderer.invoke(IPC.docgenExportBiddingTriSplit, markdownPath)
  },
  update: {
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    appVersion: () => ipcRenderer.invoke(IPC.appVersion),
    download: (info: unknown) => ipcRenderer.invoke(IPC.updateDownload, info),
    getTokenSet: () => ipcRenderer.invoke(IPC.updateGetTokenSet),
    setToken: (token: string | null) => ipcRenderer.invoke(IPC.updateSetToken, token),
    onProgress: (cb: (p: { pct: number; received: number; total: number }) => void) => {
      const listener = (_e: unknown, payload: { pct: number; received: number; total: number }): void => cb(payload)
      ipcRenderer.on('update:progress', listener)
      return () => ipcRenderer.removeListener('update:progress', listener)
    }
  },
  gzh: {
    runStyle: (inputMdPath: string, theme?: '炬视' | '瑾智') => ipcRenderer.invoke(IPC.gzhRunStyle, inputMdPath, theme),
    generateCover: (inputMdPath: string, theme: '炬视' | '瑾智') =>
      ipcRenderer.invoke(IPC.gzhGenerateCover, inputMdPath, theme)
  },
  identity: {
    list: () => ipcRenderer.invoke(IPC.identityList),
    register: (name: string, pin: string) => ipcRenderer.invoke(IPC.identityRegister, name, pin),
    add: (name: string, role?: MemberRole, 可见分身?: AgentName[]) => ipcRenderer.invoke(IPC.identityAdd, name, role, 可见分身),
    changePin: (id: string, oldPin: string, newPin: string) => ipcRenderer.invoke(IPC.identityChangePin, id, oldPin, newPin),
    resetPin: (id: string) => ipcRenderer.invoke(IPC.identityResetPin, id),
    setAgents: (id: string, agents: AgentName[] | null) => ipcRenderer.invoke(IPC.identitySetAgents, id, agents),
    remove: (id: string) => ipcRenderer.invoke(IPC.identityRemove, id),
    verifyPin: (id: string, pin?: string) => ipcRenderer.invoke(IPC.identityVerifyPin, id, pin),
    resetAllMembers: () => ipcRenderer.invoke(IPC.identityResetAllMembers),
    setRole: (id: string, role: MemberRole) => ipcRenderer.invoke(IPC.identitySetRole, id, role),
    notifyLogin: (name: string) => ipcRenderer.invoke(IPC.identityNotifyLogin, name)
  },
  sync: {
    status: () => ipcRenderer.invoke(IPC.syncStatus),
    now: (userName: string) => ipcRenderer.invoke(IPC.syncNow, userName),
    products: (userName: string) => ipcRenderer.invoke(IPC.syncProducts, userName),
    lastAt: () => ipcRenderer.invoke(IPC.syncLastAt)
  },
  sales: {
    listProducts: () => ipcRenderer.invoke(IPC.salesListProducts),
    listCategoryDict: () => ipcRenderer.invoke(IPC.salesListCategoryDict),
    saveProduct: (fields: ProductFields, id?: string) => ipcRenderer.invoke(IPC.salesSaveProduct, fields, id),
    removeProduct: (id: string) => ipcRenderer.invoke(IPC.salesRemoveProduct, id),
    setProductImage: (id: string, sourcePath: string) => ipcRenderer.invoke(IPC.salesSetProductImage, id, sourcePath),
    uploadSupplierDoc: (sourcePath: string) => ipcRenderer.invoke(IPC.salesUploadSupplierDoc, sourcePath),
    importExcel: (relativePath: string) => ipcRenderer.invoke(IPC.salesImportExcel, relativePath),
    exportQuoteImages: (productIds: string[], customerName: string) =>
      ipcRenderer.invoke(IPC.salesExportQuoteImages, productIds, customerName),
    genPdfQuoteList: (pdfFileName: string) => ipcRenderer.invoke(IPC.salesGenPdfQuoteList, pdfFileName),
    extractPdfCatalog: (pdfFileName: string) => ipcRenderer.invoke(IPC.salesExtractPdfCatalog, pdfFileName),
    applyCatalogPairing: (pdfFileName: string) => ipcRenderer.invoke(IPC.salesApplyCatalogPairing, pdfFileName),
    catalogProgress: (pdfFileName: string) => ipcRenderer.invoke(IPC.salesCatalogProgress, pdfFileName),
    exportZcy: (productIds: string[]) => ipcRenderer.invoke(IPC.salesExportZcy, productIds),
    publishProductCatalog: () => ipcRenderer.invoke(IPC.salesPublishProductCatalog),
    generateQuoteXlsx: (
      lines: QuoteLineInput[],
      customerName: string,
      templateFileName: string | null,
      projectName: string
    ) => ipcRenderer.invoke(IPC.salesGenerateQuoteXlsx, lines, customerName, templateFileName, projectName),
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
    removeFile: (relativePath: string) => ipcRenderer.invoke(IPC.solutionRemoveFile, relativePath)
  },
  finance: {
    overview: (ym?: string) => ipcRenderer.invoke(IPC.financeOverview, ym),
    toggleTask: (ym: string, taskKey: string, done: boolean) => ipcRenderer.invoke(IPC.financeToggleTask, ym, taskKey, done),
    saveEmployees: (员工: FinanceEmployee[], 发薪日: number) => ipcRenderer.invoke(IPC.financeSaveEmployees, 员工, 发薪日),
    uploadReceipt: (ym: string, sourcePath: string) => ipcRenderer.invoke(IPC.financeUploadReceipt, ym, sourcePath),
    processInvoices: (files: string[]) => ipcRenderer.invoke(IPC.financeProcessInvoices, files),
    listReceipts: (ym: string) => ipcRenderer.invoke(IPC.financeListReceipts, ym)
  },
  ops: {
    listPolicyDocs: () => ipcRenderer.invoke(IPC.opsListPolicyDocs),
    setPolicyDocState: (relativePath: string, target: OpsDocState) =>
      ipcRenderer.invoke(IPC.opsSetPolicyDocState, relativePath, target),
    listGovernanceDocs: () => ipcRenderer.invoke(IPC.opsListGovernanceDocs),
    setGovernanceState: (relativePath: string, state: OpsDocState) =>
      ipcRenderer.invoke(IPC.opsSetGovernanceState, relativePath, state)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  window.api = api
}
