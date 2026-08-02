import { useMemo, useState } from 'react'
import type { AgentDisplayMeta, OutputEntry, SolutionFile, SolutionFileKind } from '@shared/agent-types'
import { AgentChat } from '../components/AgentChat'
import { ChatCollapseRail } from '../components/ChatCollapseRail'
import { CHAT_PANE, CHAT_PANE_KEY, VDragHandle, usePersistedSize } from '../components/PaneDivider'
import { OutputsPanel } from '../components/OutputsPanel'
import { HelpButton } from '../components/HelpPanel'
import { HELP_CONTENT } from '../lib/help-content'
import { useEffect } from 'react'

type SolutionTab = '需求文件' | '资料库' | '生成方案'

// v0.1.2：需求文件不再收录音（本地转写引擎模块已移除），只收文档类
const REQUIREMENT_FILTERS = [{ name: '需求文件（文档）', extensions: ['md', 'docx', 'doc', 'pdf', 'txt'] }]
const LIB_FILTERS = [{ name: '资料文档', extensions: ['md', 'docx', 'doc', 'pdf', 'txt', 'xlsx', 'pptx'] }]
const TEMPLATE_FILTERS = [{ name: '方案模板', extensions: ['docx', 'pdf', 'md', 'txt'] }]

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

function fmtDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function today(): string {
  return fmtDate(Date.now())
}

/** 构造"生成解决方案"的提示词 */
function buildSolutionPrompt(
  projectName: string,
  requirements: SolutionFile[],
  libs: { productLib: number; solutionLib: number; policyLib: number; trendLib: number },
  template: SolutionFile | null
): string {
  const project = projectName.trim() || '未命名项目'
  const reqLines = requirements.map((f) => {
    if (f.fileName.endsWith('_转写.md')) return `- ${f.relativePath}（会议录音 AI 转写，可能有错别字/专有名词错误，理解大意为主，关键数字如有疑义标「待核对」）`
    if (f.companionRelativePath) return `- ${f.relativePath}（二进制格式，读提取文本 ${f.companionRelativePath}）`
    return `- ${f.relativePath}`
  })
  const templatePart = template
    ? `模板：${template.relativePath}${template.companionRelativePath ? `（二进制格式请读提取文本 ${template.companionRelativePath}）` : ''}——严格按模板的章节结构组织内容。`
    : `没有指定模板，用标准方案结构：项目理解与需求分析 → 需求清单与逐项响应 → 总体架构（知枢OS + 天空地水装备组合，按本项目场景裁剪）→ 分项技术方案 → 实施与交付计划 → 培训与售后服务 → 配置与报价清单（价格留占位）。`
  const dir = `outputs/02_解决方案_solution/${today()}_${project}`
  return [
    `生成一份解决方案（markdown）。`,
    ``,
    `项目名称：${project}`,
    `需求文件（先完整阅读，客户需求以此为准）：`,
    ...reqLines,
    ``,
    `资料库（按需检索取材，不要整篇照搬）：`,
    `- 基础产品库：解决方案/基础产品库/（共 ${libs.productLib} 份，用 Glob 列出后按相关性选读）`,
    `- 基础解决方案库：解决方案/基础解决方案库/（共 ${libs.solutionLib} 份，找同类场景方案参考结构与打法）`,
    `- 政策文件库：解决方案/政策文件库/（共 ${libs.policyLib} 份，方案涉及政策背景/合规依据时引用；情报线索卡只有链接没有原文，引用观点须注明"据线索，待核原文"）`,
    `- 行业趋势库：解决方案/行业趋势库/（共 ${libs.trendLib} 份，写行业背景/市场趋势章节时取材，同样注意线索卡与原文的区别）`,
    `- 产品统一口径：knowledge/products/（产品名称/参数以此为准，与上述资料冲突时以 knowledge 为准）`,
    ``,
    templatePart,
    `红线：knowledge/internal/ 严禁引用；无来源的参数/性能数字一律写「待确认」，不臆造；产品名用「知」字体系；不承诺公司不具备的资质与业绩。`,
    `产出路径：${dir}/${today()}_${project}_解决方案.md`,
    `完成后一句话总结：方案主线 + 最主要的「待确认」项。`
  ].join('\n')
}

export function SolutionWorkspace({ agent }: { agent: AgentDisplayMeta }): React.JSX.Element {
  const [tab, setTab] = useState<SolutionTab>('需求文件')
  const [files, setFiles] = useState<Record<SolutionFileKind, SolutionFile[]>>({
    requirement: [],
    productLib: [],
    solutionLib: [],
    policyLib: [],
    trendLib: [],
    template: []
  })
  const [notice, setNotice] = useState<string | null>(null)

  const [selectedReqs, setSelectedReqs] = useState<Set<string>>(new Set())
  const [projectName, setProjectName] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const [showOutputs, setShowOutputs] = useState(false)
  const [showChat, setShowChat] = useState(true)
  const [chatW, setChatW] = usePersistedSize(CHAT_PANE_KEY, CHAT_PANE.def, CHAT_PANE.min, CHAT_PANE.max)
  const [outputsRefresh, setOutputsRefresh] = useState(0)

  useEffect(() => {
    if (pendingPrompt) setShowChat(true)
  }, [pendingPrompt])

  function flash(text: string): void {
    setNotice(text)
    setTimeout(() => setNotice(null), 4500)
  }

  async function refresh(): Promise<void> {
    setFiles(await window.api.solution.listFiles())
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleUpload(kind: SolutionFileKind, filters: { name: string; extensions: string[] }[]): Promise<void> {
    const paths = await window.api.dialog.pickFiles(filters)
    for (const p of paths) {
      await window.api.solution.upload(kind, p)
    }
    if (paths.length > 0) {
      flash(`已上传 ${paths.length} 份文件`)
      await refresh()
    }
  }

  // 旧的录音文件（历史遗留）不可选作需求输入；已转写出的 _转写.md 是普通文档可选
  const selectableReqs = useMemo(() => files.requirement.filter((f) => !f.isAudio), [files.requirement])
  const selectedTemplateFile = files.template.find((t) => t.fileName === selectedTemplate) ?? null

  function jumpToGenerate(file: SolutionFile): void {
    setSelectedReqs(new Set([file.relativePath]))
    setTab('生成方案')
  }

  function handleGenerate(): void {
    const reqs = selectableReqs.filter((f) => selectedReqs.has(f.relativePath))
    if (reqs.length === 0) return
    setPendingPrompt(
      buildSolutionPrompt(
        projectName,
        reqs,
        {
          productLib: files.productLib.length,
          solutionLib: files.solutionLib.length,
          policyLib: files.policyLib.length,
          trendLib: files.trendLib.length
        },
        selectedTemplateFile
      )
    )
  }

  return (
    <div className="flex h-full">
      {/* 左：工作区 */}
      <div className="flex min-w-0 flex-1 flex-col border-r border-slate-200">
        <div className="app-drag flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
          <div className="app-no-drag flex gap-1">
            {(['需求文件', '资料库', '生成方案'] as SolutionTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  tab === t ? 'bg-jushi-accent text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {t}
                {t === '生成方案' && selectedReqs.size > 0 && (
                  <span className="ml-1 rounded-full bg-white/25 px-1.5 text-xs">{selectedReqs.size}</span>
                )}
              </button>
            ))}
          </div>
          <div className="app-no-drag">
            <HelpButton content={HELP_CONTENT.solution} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* ============ 需求文件 ============ */}
          {tab === '需求文件' && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => handleUpload('requirement', REQUIREMENT_FILTERS)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                >
                  📎 上传需求文件（纪要 md / docx / pdf）
                </button>
                <span className="text-xs text-slate-400">会议录音请先在外部转成文字纪要再上传</span>
              </div>

              <div className="space-y-1.5">
                {files.requirement.map((f) => (
                  <div key={f.relativePath} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">{f.isAudio ? '🎙️' : '📄'}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{f.fileName}</span>
                      {f.isAudio && (
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-400" title="转写模块已移除，历史录音仅存档">
                          历史录音
                        </span>
                      )}
                      <span className="shrink-0 text-xs text-slate-300">
                        {fmtSize(f.size)} · {fmtDate(f.mtimeMs)}
                      </span>
                      {!f.isAudio && (
                        <button
                          onClick={() => jumpToGenerate(f)}
                          className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:border-jushi-accent hover:text-jushi-accent"
                        >
                          用它生成方案 →
                        </button>
                      )}
                      <button
                        onClick={() => window.api.shell.showItemInFolder(f.path)}
                        className="shrink-0 text-xs text-slate-400 hover:text-jushi-accent"
                      >
                        定位
                      </button>
                      <button
                        onClick={async () => {
                          await window.api.solution.removeFile(f.relativePath)
                          await refresh()
                        }}
                        className="shrink-0 text-xs text-slate-300 hover:text-red-500"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
                {files.requirement.length === 0 && (
                  <p className="py-8 text-center text-xs text-slate-400">
                    还没有需求文件——把需求纪要（md/docx/pdf）传上来
                  </p>
                )}
              </div>
            </>
          )}

          {/* ============ 资料库 ============ */}
          {tab === '资料库' && (
            <div className="space-y-5">
              {(
                [
                  {
                    kind: 'template' as SolutionFileKind,
                    title: '方案模板库',
                    hint: '方案文档模板（docx/pdf/md）。「生成方案」时可选定一份，分身会严格按模板的章节结构组织内容；产出的 md 在右侧产出面板可一键「转Word / 转PPT」。'
                  },
                  {
                    kind: 'productLib' as SolutionFileKind,
                    title: '基础产品库',
                    hint: '基础产品资料（手册/彩页/参数表）。注意：产品名称与参数的统一口径以 knowledge/products/ 为准，这里是补充材料。'
                  },
                  {
                    kind: 'solutionLib' as SolutionFileKind,
                    title: '基础解决方案库',
                    hint: '历史方案 / 行业通用方案，生成新方案时供分身参考结构与打法。'
                  },
                  {
                    kind: 'policyLib' as SolutionFileKind,
                    title: '政策文件库',
                    hint: '政策文件与解读。可手动上传原文，也可在「行业情报」工作台对感兴趣的政策一键转存线索卡（含下载链接）。'
                  },
                  {
                    kind: 'trendLib' as SolutionFileKind,
                    title: '行业趋势库',
                    hint: '行业趋势/研报资料。与行业情报分身打通：情报页「→ 存入方案资料库」一键转入。'
                  }
                ] as const
              ).map(({ kind, title, hint }) => (
                <section key={kind}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-700">
                      {title}（{files[kind].length}）
                    </h3>
                    <button
                      onClick={() => handleUpload(kind, kind === 'template' ? TEMPLATE_FILTERS : LIB_FILTERS)}
                      className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      📎 上传
                    </button>
                  </div>
                  <p className="mb-2 text-xs text-slate-400">{hint}</p>
                  <div className="space-y-1">
                    {files[kind].map((f) => (
                      <div key={f.relativePath} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{f.fileName}</span>
                        <span className="shrink-0 text-xs text-slate-300">
                          {fmtSize(f.size)} · {fmtDate(f.mtimeMs)}
                        </span>
                        <button onClick={() => window.api.shell.showItemInFolder(f.path)} className="shrink-0 text-xs text-slate-400 hover:text-jushi-accent">
                          定位
                        </button>
                        <button
                          onClick={async () => {
                            await window.api.solution.removeFile(f.relativePath)
                            await refresh()
                          }}
                          className="shrink-0 text-xs text-slate-300 hover:text-red-500"
                        >
                          删除
                        </button>
                      </div>
                    ))}
                    {files[kind].length === 0 && <p className="py-3 text-center text-xs text-slate-300">暂无资料</p>}
                  </div>
                </section>
              ))}
            </div>
          )}

          {/* ============ 生成方案 ============ */}
          {tab === '生成方案' && (
            <>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-0.5 block text-xs text-slate-400">项目名称</label>
                  <input
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="如：XX市局智慧巡检项目"
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-jushi-accent"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-slate-400">方案模板（可选）</label>
                  <div className="flex gap-2">
                    <select
                      value={selectedTemplate}
                      onChange={(e) => setSelectedTemplate(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-600 outline-none"
                    >
                      <option value="">不用模板（标准方案结构）</option>
                      {files.template.map((t) => (
                        <option key={t.fileName} value={t.fileName}>
                          {t.fileName}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleUpload('template', TEMPLATE_FILTERS)}
                      className="shrink-0 rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      📎 上传模板
                    </button>
                  </div>
                </div>
              </div>

              <h3 className="mb-1.5 text-sm font-semibold text-slate-700">选择需求文件（可多选）</h3>
              <div className="space-y-1">
                {selectableReqs.map((f) => (
                  <label key={f.relativePath} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
                    <input
                      type="checkbox"
                      checked={selectedReqs.has(f.relativePath)}
                      onChange={(e) => {
                        setSelectedReqs((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(f.relativePath)
                          else next.delete(f.relativePath)
                          return next
                        })
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{f.fileName}</span>
                    {f.fileName.endsWith('_转写.md') && (
                      <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">会议转写</span>
                    )}
                  </label>
                ))}
                {selectableReqs.length === 0 && (
                  <p className="py-4 text-center text-xs text-slate-400">
                    没有可选的需求文件——去「需求文件」页签上传 md/docx/pdf
                  </p>
                )}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  取材范围：产品库 {files.productLib.length} · 方案库 {files.solutionLib.length} · 政策 {files.policyLib.length} · 趋势 {files.trendLib.length} · knowledge/products/（口径基准）
                </span>
                <button
                  disabled={selectedReqs.size === 0}
                  onClick={handleGenerate}
                  className="rounded-lg bg-jushi-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  ✍️ 生成解决方案
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                方案落在 outputs/02_解决方案_solution/，右侧产出面板点「转Word」得正式文件、点「转PPT」得汇报版幻灯片。
              </p>
            </>
          )}
        </div>

        {notice && <div className="border-t border-slate-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">{notice}</div>}
      </div>

      {/* 中：分身对话（可收起） */}
      {showChat && <VDragHandle size={chatW} onSize={setChatW} sign={-1} min={CHAT_PANE.min} max={CHAT_PANE.max} />}
      <ChatCollapseRail open={showChat} onToggle={() => setShowChat((v) => !v)} />
      <div className="shrink-0 overflow-hidden transition-all" style={{ width: showChat ? chatW : 0 }}>
        <div className="h-full" style={{ width: chatW }}>
          <AgentChat agent={agent} pendingPrompt={pendingPrompt} onPendingPromptConsumed={() => setPendingPrompt(null)} />
        </div>
      </div>

      {/* 右：产出面板 */}
      <div className={`shrink-0 overflow-hidden border-l border-slate-200 bg-slate-50 transition-all ${showOutputs ? 'w-72' : 'w-10'}`}>
        <button
          onClick={() => setShowOutputs((v) => !v)}
          className="flex w-full items-center justify-center py-3 text-slate-400 hover:text-jushi-accent"
          title="产出文件"
        >
          {showOutputs ? '›' : '‹'}
        </button>
        {showOutputs && (
          <>
            <h3 className="px-3 pb-1 text-xs font-semibold text-slate-500">产出：outputs/solution</h3>
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(100% - 60px)' }}>
              <OutputsPanel
                agentName="solution"
                refreshKey={outputsRefresh}
                extraFileAction={(entry: OutputEntry) =>
                  entry.name.endsWith('.md') ? (
                    <>
                      <button
                        onClick={async () => {
                          const docxPath = await window.api.docgen.exportMarkdownFile(entry.path)
                          await window.api.shell.showItemInFolder(docxPath)
                          setOutputsRefresh((k) => k + 1)
                        }}
                        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-400 opacity-0 hover:bg-slate-100 hover:text-jushi-accent group-hover:opacity-100"
                        title="把这份 markdown 转成 Word 并在文件夹里定位"
                      >
                        转Word
                      </button>
                      <button
                        onClick={async () => {
                          const pptxPath = await window.api.docgen.exportMarkdownPptx(entry.path)
                          await window.api.shell.showItemInFolder(pptxPath)
                          setOutputsRefresh((k) => k + 1)
                        }}
                        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-400 opacity-0 hover:bg-slate-100 hover:text-jushi-accent group-hover:opacity-100"
                        title="把这份方案转成汇报版 PPT（章节自动分页，细节以 Word 版为准）"
                      >
                        转PPT
                      </button>
                    </>
                  ) : null
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
