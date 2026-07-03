import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { copyFileSync, readFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { IPC } from '@shared/ipc-channels'
import type { RunAgentRequest } from '@shared/api-types'
import type { AgentName, AppConfig, ProviderConfig, ProviderId } from '@shared/agent-types'
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
  setProviderConfig,
  verifyPin
} from '../config/store'
import { buildAgentDisplayList } from '../agents/loader'
import { runAgent } from '../agents/runner'
import {
  uploadToBiddingRoot,
  uploadToInbox,
  uploadToLegalPending,
  uploadToLegalTemplate,
  uploadToMaterialLibrary
} from '../fs-io/upload-router'
import { scanAgentOutputs } from '../fs-io/outputs-scanner'
import { getMaterialLibraryCounts, listBiddingProjects } from '../fs-io/bidding-workflow'
import { listLegalDocs, listLegalTemplates, markReviewed } from '../fs-io/legal-workflow'
import { exportMarkdownToDocx } from '../docgen/docx-export'
import { exportBiddingTriSplit } from '../docgen/bidding-tri-split'
import { runGzhStyle } from '../fs-io/gzh-tool'

const activeRuns = new Map<string, AbortController>()

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

  ipcMain.handle(IPC.dialogPickFiles, async () => {
    const win = getMainWindow()
    if (!win) return []
    const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] })
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

  ipcMain.handle(IPC.uploadGeneric, (_e, sourcePath: string) => uploadToInbox(getDataDir(), sourcePath))
  ipcMain.handle(IPC.uploadBiddingRoot, (_e, sourcePath: string) => uploadToBiddingRoot(getDataDir(), sourcePath))
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
}
