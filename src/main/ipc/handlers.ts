import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { addCompany, addTeamMember, resetAllTeamMembers, changePin, getActiveCompany, getConfig, getDataDir, getGithubToken, getLastSyncAt, listTeamMembers, removeCompany, removeTeamMember, resetPin, setActiveCompany, setActiveProvider, setCompanyDataDir, setGithubToken, setLastSyncAt, setMemberAgents, setMemberRole, setProviderConfig, setVideoModelConfig, syncTeamRoster, verifyPin } from '../config/store'
import { copyFileSync, cpSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { IPC } from '@shared/ipc-channels'
import type { FileFilter, RunAgentRequest } from '@shared/api-types'
import type {
  AgentName,
  FinanceEmployee,
  OpsDocState,
  IntelReport,
  AppConfig,
  BidProjectCard,
  MemberRole,
  CustomerFields,
  LinkedFile,
  ProductFields,
  QuoteLineInput,
  ProviderConfig,
  ProviderId,
  SolutionFileKind,
  SupplierDocPreview
} from '@shared/agent-types'
import { applyCatalogPairing, extractPdfCatalog, readCatalogProgress } from '../fs-io/pdf-catalog'
import { exportZcyPackage } from '../fs-io/zcy-export'
import { repairDataDir, templateSrcPath } from '../config/first-run'
import { checkEnv, installEnvItem } from '../fs-io/env-check'
import { listBrandMatters, setBrandMatter } from '../fs-io/brand-workflow'
import { processInvoices } from '../fs-io/finance-invoice'
import { getSyncStatus, syncNow } from '../fs-io/git-sync'
import { buildAgentDisplayList } from '../agents/loader'
import { runAgent } from '../agents/runner'
import {
  uploadToBiddingClarification,
  uploadToBiddingTenderFile,
  uploadToBiddingProject,
  uploadToInbox,
  uploadToLegalPending,
  uploadToLegalTemplate,
  uploadToMaterialLibrary,
  uploadToOperationTheme,
  applyOperationImageNames,
  listOperationTemplates,
  listRecentOperationArticles,
  uploadOperationTemplate,
  uploadToSalesRawDoc,
  uploadToSalesTemplate
} from '../fs-io/upload-router'
import { scanAgentOutputs } from '../fs-io/outputs-scanner'
import {
  exportBiddingLedger,
  getMaterialLibraryCounts,
  listBiddingProjects,
  resolveBiddingProjectPaths,
  saveProjectCard
} from '../fs-io/bidding-workflow'
import { confirmIntelCandidate, ignoreIntelCandidate, listIntelCandidates, listPriorityIntelProjects, markIntelCandidatePriority, moveBiddingProjectToPriority } from '../fs-io/intel-candidates'
import { followWinnerAnnouncement } from '../fs-io/intel-winner-follow'
import { listMbaCourses, uploadToMbaCourse } from '../fs-io/upload-router'
import {
  downloadIntelReport,
  fetchReportsNow,
  getReportKeywords,
  ignoreIntelReport,
  listIntelReports,
  setReportKeywords
} from '../fs-io/intel-reports'
import { downloadTenderFile, probeTenderFile } from '../fs-io/tender-download'
import { purgeStaleIntelData } from '../fs-io/intel-purge'
import { fetchIntelNow } from '../fs-io/intel-fetch'
import { getIntelKeywords, setIntelKeywords, getKeywordSuggestions, getIntelKeywordGroups, setIntelKeywordGroups } from '../fs-io/intel-keywords'
import { listLegalDocs, listLegalTemplates, markReviewed, generateLegalRedline } from '../fs-io/legal-workflow'
import {
  addFollowUp,
  exportQuoteImages,
  generateQuoteExcel,
  generateSupplierQuoteList,
  importExcelByHeader,
  linkCustomerFile,
  listCategoryDict,
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
import { detectHeaders, extractCompanion, readWorkbookRows } from '../fs-io/doc-extract'
import { listSolutionFiles, removeSolutionFile, saveReportToSolutionLib, uploadSolutionFile } from '../fs-io/solution-workflow'
import { getOverview, listReceipts, saveEmployees, toggleTask, uploadReceipt } from '../fs-io/finance-workflow'
import { listGovernanceDocs, listPolicyDocs, setGovernanceDocState, setPolicyDocState } from '../fs-io/ops-workflow'
import { ensureCompanySkeleton } from '../fs-io/data-template'
import { exportMarkdownToDocx } from '../docgen/docx-export'
import { exportBiddingTriSplit } from '../docgen/bidding-tri-split'
import { exportMarkdownToPptx } from '../docgen/pptx-export'
import { checkForUpdate, downloadAndInstall, type UpdateInfo } from '../update/updater'
import { runGzhStyle, generateGzhCover, type GzhTheme } from '../fs-io/gzh-tool'

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
  ipcMain.handle(IPC.configSetVideoModelConfig, (_e, patch) => setVideoModelConfig(patch))

  ipcMain.handle(IPC.configAddCompany, (_e, name: string) => addCompany(name))
  ipcMain.handle(IPC.configRemoveCompany, (_e, id: string) => removeCompany(id))
  ipcMain.handle(IPC.configSetCompanyDataDir, (_e, id: string, dir: string) => {
    setCompanyDataDir(id, dir)
    // 用户可能把目录指到一个普通文件夹（没有 .claude/agents 分身定义）——分身列表会为空、
    // 卡在设置页进不了工作台。绑定时就地补齐模板缺失部分（只增不改，已有文件不动）。
    if (dir && !existsSync(join(dir, '.claude', 'agents'))) repairDataDir(dir)
  })
  ipcMain.handle(IPC.configSetActiveCompany, (_e, id: string) => setActiveCompany(id))
  ipcMain.handle(IPC.configRepairDataDir, () => repairDataDir(getDataDir()))
  ipcMain.handle(IPC.identityResetAllMembers, () => resetAllTeamMembers())
  ipcMain.handle(IPC.identitySyncRoster, () => syncTeamRoster())
  ipcMain.handle(IPC.financeProcessInvoices, (_e, files: string[]) => processInvoices(getDataDir(), files))
  ipcMain.handle(IPC.intelKeywordSuggestions, () => getKeywordSuggestions(getDataDir()))
  ipcMain.handle(IPC.brandListMatters, () => listBrandMatters(getDataDir()))
  ipcMain.handle(IPC.brandSetMatter, (_e, key: string, patch: Record<string, string>) => setBrandMatter(getDataDir(), key, patch))
  ipcMain.handle(IPC.appVersion, () => app.getVersion())
  ipcMain.handle(IPC.envCheck, () => checkEnv())
  ipcMain.handle(IPC.envInstall, (_e, key: string) => installEnvItem(key))

  // 从安装包内置模板初始化新数据目录：选一个空文件夹 → 拷贝模板 → 绑定到公司
  ipcMain.handle(IPC.configInitDataDir, async (_e, companyId: string) => {
    const win = getMainWindow()
    if (!win) return { ok: false, 说明: '窗口未就绪' }
    const templateSrc = app.isPackaged
      ? join(process.resourcesPath, 'company-os-template')
      : join(app.getAppPath(), 'resources', 'company-os-template')
    if (!existsSync(templateSrc)) return { ok: false, 说明: '安装包内未找到数据目录模板（company-os-template）' }
    const result = await dialog.showOpenDialog(win, {
      title: '选择一个空文件夹作为该公司的数据目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, 说明: '已取消' }
    const target = result.filePaths[0]
    const entries = readdirSync(target).filter((n) => !n.startsWith('.'))
    if (entries.length > 0) return { ok: false, 说明: '所选文件夹不是空的——请选择/新建一个空文件夹，避免覆盖已有资料' }
    cpSync(templateSrc, target, { recursive: true })
    ensureCompanySkeleton(target)
    setCompanyDataDir(companyId, target)
    return { ok: true, dataDir: target, 说明: `数据目录已初始化：${target}` }
  })

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
  ipcMain.handle(IPC.helpMemberGuide, () => {
    // 老安装目录可能在 v0.1.14 前就已初始化，里面没有新增手册；此时直接回退到
    // 当前安装包内置模板，保证首次登录的“下载/查看”永远可用。
    const dataGuide = join(getDataDir(), '使用说明', '成员首次使用手册.md')
    if (existsSync(dataGuide)) return dataGuide
    const bundledGuide = join(templateSrcPath(), '使用说明', '成员首次使用手册.md')
    return existsSync(bundledGuide) ? bundledGuide : null
  })

  ipcMain.handle(IPC.uploadGeneric, (_e, agentName: AgentName, sourcePath: string) =>
    uploadToInbox(getDataDir(), agentName, sourcePath)
  )
  ipcMain.handle(IPC.uploadBiddingProject, (_e, sourcePath: string) => uploadToBiddingProject(getDataDir(), sourcePath))
  ipcMain.handle(IPC.uploadBiddingMaterial, (_e, category: string, sourcePath: string) =>
    uploadToMaterialLibrary(getDataDir(), category, sourcePath)
  )
  ipcMain.handle(IPC.uploadOperationTheme, (_e, theme: string, sourcePath: string) =>
    uploadToOperationTheme(getDataDir(), theme, sourcePath)
  )
  ipcMain.handle(IPC.operationUploadTemplate, (_e, sourcePath: string) =>
    uploadOperationTemplate(getDataDir(), sourcePath)
  )
  ipcMain.handle(IPC.operationListTemplates, () => listOperationTemplates(getDataDir()))
  // 多取一些，渲染层按平台（公众号/小红书/抖音/视频号）分别过滤后各显示最近10条
  ipcMain.handle(IPC.operationRecentArticles, () => listRecentOperationArticles(getDataDir(), 100))
  ipcMain.handle(IPC.operationApplyImageNames, (_e, theme: string) =>
    applyOperationImageNames(getDataDir(), theme)
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
    // 人工在编辑器里保存过 → 打人工确认标，台账「待处理」随之消失（情报确认/分身回填不走这里，不打标）
    saveProjectCard(getDataDir(), folderName, { ...card, 人工确认: true })
  )
  ipcMain.handle(IPC.biddingExportLedger, () => exportBiddingLedger(getDataDir()))
  ipcMain.handle(IPC.uploadBiddingClarification, (_e, projectFolder: string, sourcePath: string) =>
    uploadToBiddingClarification(getDataDir(), projectFolder, sourcePath)
  )
  ipcMain.handle(IPC.uploadBiddingTenderFile, (_e, projectFolder: string, sourcePath: string) =>
    uploadToBiddingTenderFile(getDataDir(), projectFolder, sourcePath)
  )
  ipcMain.handle(IPC.biddingListCandidates, () => listIntelCandidates(getDataDir()))
  ipcMain.handle(IPC.biddingConfirmCandidate, (_e, key: string) => confirmIntelCandidate(getDataDir(), key))
  ipcMain.handle(IPC.biddingIgnoreCandidate, (_e, key: string) => ignoreIntelCandidate(getDataDir(), key))
  ipcMain.handle(IPC.biddingListPriorityProjects, () => listPriorityIntelProjects(getDataDir()))
  ipcMain.handle(IPC.biddingMarkPriority, (_e, key: string) => markIntelCandidatePriority(getDataDir(), key))
  ipcMain.handle(IPC.biddingMoveProjectToPriority, (_e, folderName: string) => moveBiddingProjectToPriority(getDataDir(), folderName))
  ipcMain.handle(IPC.biddingDownloadTender, (_e, folderName: string) => downloadTenderFile(getDataDir(), folderName))
  ipcMain.handle(IPC.biddingProbeTender, (_e, folderName: string) => probeTenderFile(getDataDir(), folderName))
  ipcMain.handle(IPC.biddingDeleteProject, async (_e, folderName: string) => {
    const paths = resolveBiddingProjectPaths(getDataDir(), folderName)
    if (paths.length === 0) return { ok: false, 说明: '项目文件夹不存在（可能已删除），请刷新' }
    try {
      for (const p of paths) await shell.trashItem(p)
      return { ok: true, 说明: `已把「${folderName.slice(11)}」移入废纸篓（可从废纸篓恢复）` }
    } catch (err) {
      return { ok: false, 说明: `删除失败：${String(err)}` }
    }
  })
  ipcMain.handle(IPC.intelListReports, () => listIntelReports(getDataDir()))
  ipcMain.handle(IPC.intelPurgeStale, () => purgeStaleIntelData(getDataDir()))
  ipcMain.handle(IPC.intelFetchNow, (_e, force: boolean) => fetchIntelNow(getDataDir(), force))
  ipcMain.handle(IPC.intelSaveReportToSolution, (_e, report: IntelReport) => saveReportToSolutionLib(getDataDir(), report))
  ipcMain.handle(IPC.intelFetchReports, () => fetchReportsNow(getDataDir()))
  ipcMain.handle(IPC.intelGetKeywords, () => getIntelKeywords(getDataDir()))
  ipcMain.handle(IPC.intelSetKeywords, (_e, keywords: string[]) => setIntelKeywords(getDataDir(), keywords))
  ipcMain.handle(IPC.intelGetKeywordGroups, () => getIntelKeywordGroups(getDataDir()))
  ipcMain.handle(IPC.intelSetKeywordGroups, (_e, groups) => setIntelKeywordGroups(getDataDir(), groups))
  ipcMain.handle(IPC.intelIgnoreReport, (_e, 链接: string) => ignoreIntelReport(getDataDir(), 链接))
  ipcMain.handle(IPC.intelDownloadReport, (_e, report: IntelReport) => downloadIntelReport(getDataDir(), report))
  ipcMain.handle(IPC.intelReportKeywordsGet, () => getReportKeywords(getDataDir()))
  ipcMain.handle(IPC.intelReportKeywordsSet, (_e, keywords: string[]) => setReportKeywords(getDataDir(), keywords))
  ipcMain.handle(IPC.biddingFollowWinner, (_e, key: string) => followWinnerAnnouncement(getDataDir(), key))
  ipcMain.handle(IPC.mbaListCourses, () => listMbaCourses(getDataDir()))
  ipcMain.handle(IPC.mbaUploadCourse, (_e, course: string, category: '课件' | '作业与要求' | '课堂录音', sourcePath: string) => uploadToMbaCourse(getDataDir(), course, category, sourcePath))

  ipcMain.handle(IPC.legalListDocs, () => listLegalDocs(getDataDir()))
  ipcMain.handle(IPC.legalMarkReviewed, (_e, fileName: string) => markReviewed(getDataDir(), fileName))
  ipcMain.handle(IPC.legalGenerateRedline, (_e, fileName: string) => generateLegalRedline(getDataDir(), fileName))

  ipcMain.handle(IPC.docgenExportMarkdownFile, async (_e, markdownPath: string) => {
    const markdown = readFileSync(markdownPath, 'utf-8')
    const outPath = markdownPath.replace(/\.md$/, '.docx')
    await exportMarkdownToDocx(markdown, outPath)
    return outPath
  })

  ipcMain.handle(IPC.docgenExportMarkdownPptx, async (_e, markdownPath: string) => {
    const markdown = readFileSync(markdownPath, 'utf-8')
    const outPath = markdownPath.replace(/\.md$/, '.pptx')
    await exportMarkdownToPptx(markdown, outPath)
    return outPath
  })

  ipcMain.handle(IPC.docgenExportBiddingTriSplit, async (_e, markdownPath: string) => {
    const markdown = readFileSync(markdownPath, 'utf-8')
    const outDir = dirname(markdownPath)
    const baseName = basename(markdownPath).replace(/_投标文件初稿\.md$|\.md$/, '')
    return exportBiddingTriSplit(markdown, outDir, baseName)
  })

  ipcMain.handle(IPC.gzhRunStyle, (_e, inputMdPath: string, theme?: GzhTheme) =>
    runGzhStyle(getDataDir(), inputMdPath, theme)
  )
  ipcMain.handle(IPC.gzhGenerateCover, (_e, inputMdPath: string, theme: GzhTheme) =>
    generateGzhCover(inputMdPath, theme)
  )

  ipcMain.handle(IPC.updateCheck, () => checkForUpdate())
  ipcMain.handle(IPC.updateDownload, (_e, info: UpdateInfo) => downloadAndInstall(getMainWindow(), info))
  ipcMain.handle(IPC.updateGetTokenSet, () => Boolean(getGithubToken()))
  ipcMain.handle(IPC.updateSetToken, (_e, token: string | null) => setGithubToken(token))
  ipcMain.handle(IPC.shellOpenPath, (_e, path: string) => shell.openPath(path))

  ipcMain.handle(IPC.identityList, () => listTeamMembers())
  ipcMain.handle(IPC.identityAdd, (_e, name: string, role?: MemberRole, agents?: AgentName[]) =>
    addTeamMember(name, role, agents)
  )
  ipcMain.handle(IPC.identityChangePin, (_e, id: string, oldPin: string, newPin: string) => changePin(id, oldPin, newPin))
  ipcMain.handle(IPC.identityResetPin, (_e, id: string) => resetPin(id))
  ipcMain.handle(IPC.identitySetAgents, (_e, id: string, agents: AgentName[] | null) => setMemberAgents(id, agents))
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
  ipcMain.handle(IPC.salesListCategoryDict, () => listCategoryDict(getDataDir()))
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
      const sheets = await readWorkbookRows(absPath)
      const detections = detectHeaders(sheets)
      const detection = detections[0]
      if (detection) {
        preview.headers = detection.headers
        preview.fieldMapping = detection.fieldMapping as SupplierDocPreview['fieldMapping']
        preview.importableRows = detections.reduce((total, item) => total + item.dataRows.length, 0)
        preview.importableSheets = detections.map((item) => item.sheetName)
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
  ipcMain.handle(
    IPC.salesGenerateQuoteXlsx,
    (_e, lines: QuoteLineInput[], customerName: string, templateFileName: string | null, projectName: string) =>
      generateQuoteExcel(getDataDir(), lines, customerName, templateFileName, projectName)
  )
  ipcMain.handle(IPC.salesGenPdfQuoteList, (_e, pdfFileName: string) =>
    generateSupplierQuoteList(getDataDir(), pdfFileName)
  )
  ipcMain.handle(IPC.salesExtractPdfCatalog, (_e, pdfFileName: string) =>
    extractPdfCatalog(getDataDir(), pdfFileName)
  )
  ipcMain.handle(IPC.salesCatalogProgress, (_e, pdfFileName: string) => readCatalogProgress(getDataDir(), pdfFileName))
  ipcMain.handle(IPC.salesExportZcy, async (_e, productIds: string[]) => {
    const { products } = await Promise.resolve(listProducts(getDataDir()))
    const picked = products.filter((p) => productIds.includes(p.id))
    return exportZcyPackage(getDataDir(), picked)
  })
  ipcMain.handle(IPC.salesApplyCatalogPairing, (_e, pdfFileName: string) =>
    applyCatalogPairing(getDataDir(), pdfFileName)
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

  ipcMain.handle(IPC.financeOverview, (_e, ym?: string) => getOverview(getDataDir(), ym))
  ipcMain.handle(IPC.financeToggleTask, (_e, ym: string, taskKey: string, done: boolean) => toggleTask(getDataDir(), ym, taskKey, done))
  ipcMain.handle(IPC.financeSaveEmployees, (_e, emp: FinanceEmployee[], payday: number) => saveEmployees(getDataDir(), emp, payday))
  ipcMain.handle(IPC.financeUploadReceipt, (_e, ym: string, sourcePath: string) => uploadReceipt(getDataDir(), ym, sourcePath))
  ipcMain.handle(IPC.financeListReceipts, (_e, ym: string) => listReceipts(getDataDir(), ym))

  ipcMain.handle(IPC.opsListPolicyDocs, () => listPolicyDocs(getDataDir()))
  ipcMain.handle(IPC.opsSetPolicyDocState, (_e, relativePath: string, target: OpsDocState) =>
    setPolicyDocState(getDataDir(), relativePath, target)
  )
  ipcMain.handle(IPC.opsListGovernanceDocs, () => listGovernanceDocs(getDataDir()))
  ipcMain.handle(IPC.opsSetGovernanceState, (_e, relativePath: string, state: OpsDocState) =>
    setGovernanceDocState(getDataDir(), relativePath, state)
  )
}
