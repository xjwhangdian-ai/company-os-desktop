import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { copyFileSync, readFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { IPC } from '@shared/ipc-channels'
import type { FileFilter, RunAgentRequest } from '@shared/api-types'
import type {
  AgentName,
  AppConfig,
  BidProjectCard,
  MemberRole,
  CustomerFields,
  LinkedFile,
  ProductFields,
  ProviderConfig,
  ProviderId,
  SolutionFileKind,
  SupplierDocPreview
} from '@shared/agent-types'
import { getSyncStatus, syncNow } from '../fs-io/git-sync'
import {
  addCompany,
  addTeamMember,
  getConfig,
  getDataDir,
  listTeamMembers,
  removeCompany,
  removeTeamMember,
  setActiveCompany,
  setActiveProvider,
  setCompanyDataDir,
  setMemberRole,
  setProviderConfig,
  verifyPin,
  getActiveCompany,
  getLastSyncAt,
  setLastSyncAt
} from '../config/store'
import { buildAgentDisplayList } from '../agents/loader'
import { runAgent } from '../agents/runner'
import {
  uploadToBiddingClarification,
  uploadToBiddingProject,
  uploadToInbox,
  uploadToLegalPending,
  uploadToLegalTemplate,
  uploadToMaterialLibrary,
  uploadToSalesRawDoc,
  uploadToSalesTemplate
} from '../fs-io/upload-router'
import { scanAgentOutputs } from '../fs-io/outputs-scanner'
import { exportBiddingLedger, getMaterialLibraryCounts, listBiddingProjects, saveProjectCard } from '../fs-io/bidding-workflow'
import { listLegalDocs, listLegalTemplates, markReviewed } from '../fs-io/legal-workflow'
import {
  addFollowUp,
  exportQuoteImages,
  importExcelByHeader,
  linkCustomerFile,
  listCustomers,
  listProducts,
  listQuotationTemplates,
  removeCustomer,
  removeProduct,
  resolveLinkedPath,
  saveCustomer,
  saveProduct,
  setProductImage,
  unlinkCustomerFile
} from '../fs-io/sales-workflow'
import { detectHeader, extractCompanion, readWorkbookRows } from '../fs-io/doc-extract'
import { listSolutionFiles, removeSolutionFile, uploadSolutionFile } from '../fs-io/solution-workflow'
import { cancelTranscribe, getWhisperStatus, startTranscribe } from '../fs-io/transcriber'
import { exportMarkdownToDocx } from '../docgen/docx-export'
import { exportBiddingTriSplit } from '../docgen/bidding-tri-split'
import { runGzhStyle } from '../fs-io/gzh-tool'

const activeRuns = new Map<string, AbortController>()

/** 当前登录用户名（渲染进程登录成功后上报）——关闭前自动同步的提交署名用 */
let currentUserName = ''
export function getCurrentUserName(): string {
  return currentUserName
}

/** 只有一个入口注册全部 IPC handler，避免重启热重载时重复 registerHandler 报错 */
export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.configGet, (): AppConfig => getConfig())

  ipcMain.handle(IPC.configPickDataDir, async (): Promise<string | null> => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.configSetActiveProvider, (_e, id: ProviderId) => setActiveProvider(id))
  ipcMain.handle(IPC.configSetProviderConfig, (_e, id: ProviderId, patch: Partial<Omit<ProviderConfig, 'id'>>) =>
    setProviderConfig(id, patch)
  )

  ipcMain.handle(IPC.configAddCompany, (_e, name: string) => addCompany(name))
  ipcMain.handle(IPC.configRemoveCompany, (_e, id: string) => removeCompany(id))
  ipcMain.handle(IPC.configSetCompanyDataDir, (_e, id: string, dir: string) => setCompanyDataDir(id, dir))
  ipcMain.handle(IPC.configSetActiveCompany, (_e, id: string) => setActiveCompany(id))

  ipcMain.handle(IPC.agentsList, () => buildAgentDisplayList(getDataDir()))

  ipcMain.handle(IPC.agentRun, async (event, req: RunAgentRequest) => {
    const dataDir = getDataDir()
    const abortController = new AbortController()
    activeRuns.set(req.runId, abortController)

    ;(async () => {
      try {
        for await (const streamEvent of runAgent({
          agentName: req.agentName,
          prompt: req.prompt,
          dataDir,
          resumeSessionId: req.resumeSessionId,
          abortController,
          userName: req.userName
        })) {
          event.sender.send(IPC.agentStreamEvent, req.runId, streamEvent)
        }
      } finally {
        activeRuns.delete(req.runId)
      }
    })()
  })

  ipcMain.handle(IPC.agentCancel, (_e, runId: string) => {
    activeRuns.get(runId)?.abort()
    activeRuns.delete(runId)
  })

  ipcMain.handle(IPC.dialogPickFiles, async (_e, filters?: FileFilter[]) => {
    const win = getMainWindow()
    if (!win) return []
    const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters })
    if (result.canceled) return []
    return result.filePaths
  })

  ipcMain.handle(IPC.shellShowItemInFolder, (_e, path: string) => shell.showItemInFolder(path))

  ipcMain.handle(IPC.shellSaveAsCopy, async (_e, sourcePath: string) => {
    const win = getMainWindow()
    if (!win) return false
    const result = await dialog.showSaveDialog(win, { defaultPath: basename(sourcePath) })
    if (result.canceled || !result.filePath) return false
    copyFileSync(sourcePath, result.filePath)
    return true
  })

  ipcMain.handle(IPC.uploadGeneric, (_e, agentName: AgentName, sourcePath: string) =>
    uploadToInbox(getDataDir(), agentName, sourcePath)
  )
  ipcMain.handle(IPC.uploadBiddingProject, (_e, sourcePath: string) => uploadToBiddingProject(getDataDir(), sourcePath))
  ipcMain.handle(IPC.uploadBiddingMaterial, (_e, category: string, sourcePath: string) =>
    uploadToMaterialLibrary(getDataDir(), category, sourcePath)
  )
  ipcMain.handle(IPC.uploadLegalPending, (_e, sourcePath: string, category: string) =>
    uploadToLegalPending(getDataDir(), sourcePath, category)
  )
  ipcMain.handle(IPC.legalUploadTemplate, (_e, category: string, sourcePath: string) =>
    uploadToLegalTemplate(getDataDir(), category, sourcePath)
  )
  ipcMain.handle(IPC.legalListTemplates, () => listLegalTemplates(getDataDir()))

  ipcMain.handle(IPC.outputsScan, (_e, agentName: AgentName) => scanAgentOutputs(getDataDir(), agentName))

  ipcMain.handle(IPC.biddingListProjects, () => listBiddingProjects(getDataDir()))
  ipcMain.handle(IPC.biddingMaterialCounts, () => getMaterialLibraryCounts(getDataDir()))
  ipcMain.handle(IPC.biddingSaveCard, (_e, folderName: string, card: BidProjectCard) =>
    saveProjectCard(getDataDir(), folderName, card)
  )
  ipcMain.handle(IPC.biddingExportLedger, () => exportBiddingLedger(getDataDir()))
  ipcMain.handle(IPC.uploadBiddingClarification, (_e, projectFolder: string, sourcePath: string) =>
    uploadToBiddingClarification(getDataDir(), projectFolder, sourcePath)
  )

  ipcMain.handle(IPC.legalListDocs, () => listLegalDocs(getDataDir()))
  ipcMain.handle(IPC.legalMarkReviewed, (_e, fileName: string) => markReviewed(getDataDir(), fileName))

  ipcMain.handle(IPC.docgenExportMarkdownFile, async (_e, markdownPath: string) => {
    const markdown = readFileSync(markdownPath, 'utf-8')
    const outPath = markdownPath.replace(/\.md$/, '.docx')
    await exportMarkdownToDocx(markdown, outPath)
    return outPath
  })

  ipcMain.handle(IPC.docgenExportBiddingTriSplit, async (_e, markdownPath: string) => {
    const markdown = readFileSync(markdownPath, 'utf-8')
    const outDir = dirname(markdownPath)
    const baseName = basename(markdownPath).replace(/_投标文件初稿\.md$|\.md$/, '')
    return exportBiddingTriSplit(markdown, outDir, baseName)
  })

  ipcMain.handle(IPC.gzhRunStyle, (_e, inputMdPath: string) => runGzhStyle(getDataDir(), inputMdPath))
  ipcMain.handle(IPC.shellOpenPath, (_e, path: string) => shell.openPath(path))

  ipcMain.handle(IPC.identityList, () => listTeamMembers())
  ipcMain.handle(IPC.identityAdd, (_e, name: string, pin?: string) => addTeamMember(name, pin))
  ipcMain.handle(IPC.identityRemove, (_e, id: string) => removeTeamMember(id))
  ipcMain.handle(IPC.identityVerifyPin, (_e, id: string, pin?: string) => verifyPin(id, pin))
  ipcMain.handle(IPC.identitySetRole, (_e, id: string, role: MemberRole) => setMemberRole(id, role))
  ipcMain.handle(IPC.identityNotifyLogin, (_e, name: string) => {
    currentUserName = name
  })

  // ============ 一键同步 ============
  ipcMain.handle(IPC.syncStatus, () => getSyncStatus(getDataDir()))
  ipcMain.handle(IPC.syncNow, async (_e, userName: string) => {
    const result = await syncNow(getDataDir(), userName)
    if (result.ok) {
      const company = getActiveCompany()
      if (company) setLastSyncAt(company.id)
    }
    return result
  })
  ipcMain.handle(IPC.syncLastAt, () => {
    const company = getActiveCompany()
    return company ? getLastSyncAt(company.id) : null
  })

  // ============ 销售工作台 ============
  ipcMain.handle(IPC.salesListProducts, () => listProducts(getDataDir()))
  ipcMain.handle(IPC.salesSaveProduct, (_e, fields: ProductFields, id?: string) => saveProduct(getDataDir(), fields, id))
  ipcMain.handle(IPC.salesRemoveProduct, (_e, id: string) => removeProduct(getDataDir(), id))

  ipcMain.handle(IPC.salesUploadSupplierDoc, async (_e, sourcePath: string): Promise<SupplierDocPreview> => {
    const dataDir = getDataDir()
    const { absPath, relativePath } = uploadToSalesRawDoc(dataDir, sourcePath)
    const preview: SupplierDocPreview = { relativePath, fileName: basename(absPath) }

    const companionAbs = await extractCompanion(absPath)
    if (companionAbs) preview.companionRelativePath = `销售/产品库/原始资料/${basename(companionAbs)}`

    // xlsx/csv 顺带做表头机械识别，识别成功 UI 会提供"直接导入"（免 AI）
    if (/\.(xlsx|csv)$/i.test(absPath)) {
      const detection = detectHeader(await readWorkbookRows(absPath))
      if (detection) {
        preview.headers = detection.headers
        preview.fieldMapping = detection.fieldMapping as SupplierDocPreview['fieldMapping']
        preview.importableRows = detection.dataRows.length
        preview.sampleRows = detection.dataRows.slice(0, 5)
      }
    }
    return preview
  })

  ipcMain.handle(IPC.salesImportExcel, (_e, relativePath: string) => importExcelByHeader(getDataDir(), relativePath))

  ipcMain.handle(IPC.salesListTemplates, () => listQuotationTemplates(getDataDir()))
  ipcMain.handle(IPC.salesUploadTemplate, async (_e, sourcePath: string) => {
    const dataDir = getDataDir()
    const { absPath } = uploadToSalesTemplate(dataDir, sourcePath)
    // docx/xlsx 模板生成伴生提取文本，agent 才能读到模板结构
    await extractCompanion(absPath).catch(() => null)
    const fileName = basename(absPath)
    return listQuotationTemplates(dataDir).find((t) => t.fileName === fileName)
  })

  ipcMain.handle(IPC.salesSetProductImage, (_e, id: string, sourcePath: string) =>
    setProductImage(getDataDir(), id, sourcePath)
  )
  ipcMain.handle(IPC.salesExportQuoteImages, (_e, productIds: string[], customerName: string) =>
    exportQuoteImages(getDataDir(), productIds, customerName)
  )

  ipcMain.handle(IPC.salesListCustomers, () => listCustomers(getDataDir()))
  ipcMain.handle(IPC.salesSaveCustomer, (_e, fields: CustomerFields, id?: string) =>
    saveCustomer(getDataDir(), fields, id)
  )
  ipcMain.handle(IPC.salesRemoveCustomer, (_e, id: string) => removeCustomer(getDataDir(), id))
  ipcMain.handle(IPC.salesAddFollowUp, (_e, customerId: string, content: string) =>
    addFollowUp(getDataDir(), customerId, content)
  )
  ipcMain.handle(IPC.salesLinkCustomerFile, (_e, customerId: string, 类型: LinkedFile['类型'], filePath: string) =>
    linkCustomerFile(getDataDir(), customerId, 类型, filePath)
  )
  ipcMain.handle(IPC.salesUnlinkCustomerFile, (_e, customerId: string, index: number) =>
    unlinkCustomerFile(getDataDir(), customerId, index)
  )
  ipcMain.handle(IPC.salesResolveLinkedPath, (_e, stored: string) => resolveLinkedPath(getDataDir(), stored))

  // ============ 解决方案工作台 ============
  ipcMain.handle(IPC.solutionListFiles, () => listSolutionFiles(getDataDir()))
  ipcMain.handle(IPC.solutionUpload, (_e, kind: SolutionFileKind, sourcePath: string) =>
    uploadSolutionFile(getDataDir(), kind, sourcePath)
  )
  ipcMain.handle(IPC.solutionRemoveFile, (_e, relativePath: string) => removeSolutionFile(getDataDir(), relativePath))
  ipcMain.handle(IPC.solutionWhisperStatus, () => getWhisperStatus())
  ipcMain.handle(IPC.solutionTranscribeStart, (event, jobId: string, audioRelativePath: string, model: string) => {
    startTranscribe(jobId, getDataDir(), audioRelativePath, model, (e) => {
      event.sender.send(IPC.solutionTranscribeEvent, e)
    })
  })
  ipcMain.handle(IPC.solutionTranscribeCancel, (_e, jobId: string) => cancelTranscribe(jobId))
}
