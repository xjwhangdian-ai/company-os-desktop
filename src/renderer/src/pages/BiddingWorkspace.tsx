import { useEffect, useState } from 'react'
import type { AgentDisplayMeta, BiddingProject } from '@shared/agent-types'
import { AgentChat } from '../components/AgentChat'
import { MaterialChecklist } from '../components/MaterialChecklist'
import { HelpButton } from '../components/HelpPanel'
import { HELP_CONTENT } from '../lib/help-content'

function Badge({ active, label }: { active: boolean; label: string }): React.JSX.Element {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'
      }`}
    >
      {label}
    </span>
  )
}

/** 项目的招标原件（inbox 侧文件），供提示词点名让分身读 */
function sourceFilesOf(project: BiddingProject): string[] {
  const flat = (entries: BiddingProject['files']): string[] =>
    entries.flatMap((e) => (e.isDirectory ? flat(e.children ?? []) : [e.relativePath]))
  return flat(project.files).filter((rel) => rel.startsWith('inbox/'))
}

function outputsDirOf(project: BiddingProject): string {
  return `outputs/03_招投标_bidding/${project.folderName}`
}

/** 解析提示词：输入/输出路径全部由 App 点名，分身不用猜文件在哪、该写到哪 */
function buildParsePrompt(project: BiddingProject): string {
  const sources = sourceFilesOf(project)
  return [
    `解析招标文件（项目「${project.projectName}」）。`,
    `招标原件：`,
    ...sources.map((s) => `- ${s}`),
    `按 bidding 分身的解析流程产出《招标解析报告》（评分拆解/资质缺口/标书目录框架/可质疑条款/可投标性）。`,
    `产出路径：${outputsDirOf(project)}/${project.folderName}_招标解析.md`
  ].join('\n')
}

export function BiddingWorkspace({ agent }: { agent: AgentDisplayMeta }): React.JSX.Element {
  const [projects, setProjects] = useState<BiddingProject[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [showMaterialLib, setShowMaterialLib] = useState(false)
  const [showProjectUpload, setShowProjectUpload] = useState(false)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  async function refresh(): Promise<void> {
    setProjects(await window.api.bidding.listProjects())
  }

  useEffect(() => {
    refresh()
  }, [refreshKey])

  async function handleNewProject(): Promise<void> {
    const paths = await window.api.dialog.pickFiles()
    if (paths.length === 0) return
    const r = await window.api.upload.biddingProject(paths[0])
    await refresh()
    setSelected(r.projectFolder)
    setShowMaterialLib(false)
    setPendingPrompt(
      [
        `解析招标文件（项目「${r.projectFolder.slice(11)}」）。`,
        `招标原件：${r.relativePath}`,
        `按 bidding 分身的解析流程产出《招标解析报告》（评分拆解/资质缺口/标书目录框架/可质疑条款/可投标性）。`,
        `产出路径：${r.outputsDirRelative}/${r.projectFolder}_招标解析.md`
      ].join('\n')
    )
  }

  const project = projects.find((p) => p.folderName === selected) ?? null
  const flatFiles = (entries: BiddingProject['files']): typeof entries =>
    entries.flatMap((e) => (e.isDirectory ? flatFiles(e.children ?? []) : [e]))
  const draftFile = project ? flatFiles(project.files).find((f) => f.name.endsWith('_投标文件初稿.md')) : undefined

  return (
    <div className="flex h-full">
      <div className="w-72 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-3">
        <div className="app-drag mb-2 flex items-center justify-between pt-1">
          <h2 className="text-xs font-semibold text-slate-500">招投标项目</h2>
          <div className="app-no-drag">
            <HelpButton content={HELP_CONTENT.bidding} />
          </div>
        </div>
        <div className="mb-3 flex gap-2">
          <button
            onClick={handleNewProject}
            className="flex-1 rounded-lg bg-jushi-accent px-3 py-2 text-xs font-medium text-white"
          >
            ＋ 新招标项目
          </button>
          <button
            onClick={() => {
              setShowMaterialLib(true)
              setSelected(null)
            }}
            className={`rounded-lg border px-3 py-2 text-xs font-medium ${
              showMaterialLib ? 'border-jushi-accent text-jushi-accent' : 'border-slate-300 text-slate-500'
            }`}
          >
            素材库
          </button>
        </div>

        <div className="space-y-1.5">
          {projects.map((p) => (
            <button
              key={p.folderName}
              onClick={() => {
                setSelected(p.folderName)
                setShowMaterialLib(false)
                setShowProjectUpload(false)
              }}
              className={`block w-full rounded-lg border px-3 py-2 text-left text-xs ${
                selected === p.folderName ? 'border-jushi-accent bg-white shadow-sm' : 'border-transparent bg-white hover:border-slate-200'
              }`}
            >
              <div className="truncate font-medium text-slate-700">{p.projectName}</div>
              <div className="mt-1 text-slate-400">{p.date}</div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <Badge active={p.hasParseReport} label="解析" />
                <Badge active={p.hasChallengeLetter} label="质疑" />
                <Badge active={p.hasDraft} label="投标" />
              </div>
            </button>
          ))}
          {projects.length === 0 && <p className="px-2 py-4 text-center text-xs text-slate-400">还没有招标项目</p>}
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        {showMaterialLib ? (
          <div className="flex-1 overflow-y-auto p-6">
            <h2 className="mb-4 text-sm font-semibold text-slate-800">素材库</h2>
            <MaterialChecklist refreshKey={refreshKey} />
          </div>
        ) : (
          <>
            {project && (
              <div className="border-b border-slate-200 bg-white px-5 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-800">{project.projectName}</h2>
                    <p className="text-xs text-slate-400">{project.folderName}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPendingPrompt(buildParsePrompt(project))}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      解析
                    </button>
                    <button
                      disabled={!project.hasParseReport}
                      onClick={() =>
                        setPendingPrompt(
                          `对项目「${project.projectName}」写质疑函：依据 ${outputsDirOf(project)}/ 下的招标解析报告里「可质疑条款」一节，质疑函写到 ${outputsDirOf(project)}/${project.folderName}_质疑函.md`
                        )
                      }
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                    >
                      写质疑函
                    </button>
                    <button
                      disabled={!project.hasParseReport}
                      onClick={() =>
                        setPendingPrompt(
                          [
                            `对项目「${project.projectName}」生成投标文件初稿。`,
                            `解析报告在 ${outputsDirOf(project)}/ 下；招标原件：${sourceFilesOf(project).join('、') || '（inbox 侧未找到，先确认）'}。`,
                            `严格按解析报告的标书目录框架、调用 bidding/_素材库/ 与 knowledge/，遵守 bidding 分身的全部投标规则。`,
                            `产出：${outputsDirOf(project)}/${project.folderName}_投标文件初稿.md（三册一级标题结构）`
                          ].join('\n')
                        )
                      }
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                    >
                      生成投标文件
                    </button>
                    {draftFile && (
                      <button
                        onClick={async () => {
                          await window.api.docgen.exportBiddingTriSplit(draftFile.path)
                          setRefreshKey((k) => k + 1)
                        }}
                        className="rounded-md bg-jushi-accent px-3 py-1.5 text-xs font-medium text-white"
                      >
                        导出三册 Word
                      </button>
                    )}
                    <button
                      onClick={() => setShowProjectUpload((v) => !v)}
                      className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                        showProjectUpload ? 'border-jushi-accent text-jushi-accent' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      📎 上传素材
                    </button>
                  </div>
                </div>
                {!project.hasParseReport && (
                  <p className="mt-2 text-xs text-amber-600">尚未解析——解析是投标流程的必做入口，请先点「解析」。</p>
                )}
                {showProjectUpload && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="mb-2 text-xs text-slate-500">
                      为「{project.projectName}」补充素材——这些材料存进 bidding/_素材库/，其它项目生成投标文件时也能用到，不是这一个项目专属。
                    </p>
                    <MaterialChecklist refreshKey={refreshKey} />
                  </div>
                )}
              </div>
            )}
            <div className="flex-1 overflow-hidden">
              <AgentChat
                agent={agent}
                pendingPrompt={pendingPrompt}
                onPendingPromptConsumed={() => setPendingPrompt(null)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
