import { useEffect, useState } from 'react'
import type { AgentDisplayMeta, ChatAttachment, OutputEntry } from '@shared/agent-types'
import type { FileFilter } from '@shared/api-types'
import { AgentChat } from '../components/AgentChat'
import { FileDropzone } from '../components/FileDropzone'
import { OutputsPanel } from '../components/OutputsPanel'
import { GzhStyleButton } from '../components/GzhStyleButton'
import { HelpButton } from '../components/HelpPanel'
import { HELP_CONTENT } from '../lib/help-content'

type Platform = '小红书' | '微信公众号'

const PLATFORM_PROMPTS: Record<Platform, string> = {
  小红书:
    '生成一篇小红书笔记文案。风格要求：口语化、emoji 适度点缀、开头 3 秒抓人的钩子、正文分点或分段清晰、结尾带 3-8 个相关话题标签(#xxx)。主题/需求：〔请描述这次想推广什么产品/场景/卖点〕',
  微信公众号:
    '生成一篇公众号推文图文。按标准结构：标题(2-3个备选)+摘要 → 痛点引入 → 场景/方案 → 价值/数据(标来源) → 行动引导 → 配图建议。主题/需求：〔请描述这次想推广什么产品/场景/卖点〕'
}

const MEDIA_UPLOAD_KINDS: { key: string; buttonLabel: string; filters: FileFilter[] }[] = [
  { key: 'image', buttonLabel: '🖼️ 图片', filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'] }] },
  { key: 'video', buttonLabel: '🎬 视频', filters: [{ name: '视频', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }] },
  { key: 'doc', buttonLabel: '📄 其他文件', filters: [{ name: '文档', extensions: ['doc', 'docx', 'pdf', 'md'] }] }
]

function attachmentIcon(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) return '🖼️'
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return '🎬'
  if (['doc', 'docx', 'pdf', 'md'].includes(ext)) return '📄'
  return '📎'
}

type TemplateEntry = { fileName: string; relativePath: string; kind: '模板' | '图片'; mtime: number }
type RecentArticle = { fileName: string; relativePath: string; absPath: string; folder: string; mtime: number }

function fmtDay(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function OperationWorkspace({ agent }: { agent: AgentDisplayMeta }): React.JSX.Element {
  const [platform, setPlatform] = useState<Platform>('小红书')
  const [theme, setTheme] = useState('')
  const [mediaAttachments, setMediaAttachments] = useState<ChatAttachment[]>([])
  const [injectedPrompt, setInjectedPrompt] = useState<string | null>(null)
  const [injectedAttachments, setInjectedAttachments] = useState<ChatAttachment[] | null>(null)
  const [showOutputs, setShowOutputs] = useState(false)
  const [showChat, setShowChat] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [templates, setTemplates] = useState<TemplateEntry[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [recent, setRecent] = useState<RecentArticle[]>([])
  const [showRecent, setShowRecent] = useState(false)

  function flash(t: string): void {
    setNotice(t)
    setTimeout(() => setNotice(null), 6000)
  }

  async function refreshTemplates(): Promise<void> {
    setTemplates(await window.api.operation.listTemplates())
  }
  async function refreshRecent(): Promise<void> {
    setRecent(await window.api.operation.recentArticles())
  }
  useEffect(() => {
    refreshTemplates()
    refreshRecent()
  }, [refreshKey])

  async function handleUploadTemplate(filters: FileFilter[]): Promise<void> {
    const paths = await window.api.dialog.pickFiles(filters)
    for (const p of paths) {
      const r = await window.api.operation.uploadTemplate(p)
      const name = r.relativePath.split('/').pop() ?? ''
      if (/\.(html?|md)$/i.test(name)) setSelectedTemplate(name)
    }
    if (paths.length > 0) {
      await refreshTemplates()
      flash(`已上传 ${paths.length} 个风格模板文件到 inbox/05_运营_operation/_风格模板/`)
    }
  }

  /** 素材上传：填了主题就落主题文件夹并顺序改名，否则退回通用 inbox */
  function uploadMedia(p: string): Promise<{ absPath: string; relativePath: string }> {
    return theme.trim() ? window.api.upload.operationTheme(theme.trim(), p) : window.api.upload.generic('operation', p)
  }

  /** 让分身逐张看图，把内容识别写进 {主题}/_配图识别.json */
  function handleIdentify(): void {
    const t = theme.trim()
    if (!t) {
      flash('先填「主题」并上传图片，识别结果才好归到对应文件夹')
      return
    }
    setInjectedPrompt(
      [
        `识别这次公众号配图的内容，供写文章时精准配图注（防图文不符）。`,
        `1. 用 Read 工具**逐张打开** inbox/05_运营_operation/${t}/ 下的每张图片（jpg/png 等），看清实际画面。`,
        `2. 为每张图写一个 JSON 对象：{"文件名":"原文件名带扩展名","描述":"画面内容4-12字如 讲师手持话筒演讲/校园红砖路人物背影","图注":"图：适合放进文章的一句说明"}。`,
        `3. 用 Write 把 JSON 数组写到 inbox/05_运营_operation/${t}/_配图识别.json（只含 JSON 数组本身）。`,
        `4. 严格按真实画面写，绝不凭文件名臆测；看不清的图描述写"待人工确认"。`,
        `完成后回复识别了几张、有没有内容雷同或不适合入文的图。之后我点「应用重命名」App 会据此把图重命名并生成配图清单。`
      ].join('\n')
    )
  }

  async function handleApplyNames(): Promise<void> {
    const t = theme.trim()
    if (!t) {
      flash('先填主题')
      return
    }
    try {
      const r = await window.api.operation.applyImageNames(t)
      flash(`已按识别结果重命名 ${r.renamed}/${r.total} 张图，并生成配图清单：${r.listRelative}`)
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    if (injectedPrompt || injectedAttachments) setShowChat(true)
  }, [injectedPrompt, injectedAttachments])

  function handleGenerate(): void {
    const t = theme.trim()
    const themeLine = t
      ? `\n主题：${t}。产出写到 outputs/05_运营_operation/${t}_公众号/（先建子文件夹）。配图在 inbox/05_运营_operation/${t}/，若有 配图清单.md 先读它选图；插入每张图前用 Read 复核画面，图注严格对应画面内容，绝不张冠李戴。`
      : ''
    const tplImages = templates.filter((x) => x.kind === '图片')
    const templateLine = selectedTemplate
      ? `\n风格模板：先用 Read 读 inbox/05_运营_operation/_风格模板/${selectedTemplate}，仿照它的结构/语气/段落节奏组织本篇（内容仍以本次主题素材为准，不抄模板正文）。` +
        (tplImages.length > 0
          ? `同目录还有 ${tplImages.length} 张模板参考图（${tplImages
              .slice(0, 5)
              .map((x) => x.fileName)
              .join('、')}），可用 Read 查看作为版式/视觉风格参考，不要插进文章正文。`
          : '')
      : ''
    setInjectedPrompt(PLATFORM_PROMPTS[platform] + themeLine + templateLine)
    if (mediaAttachments.length > 0) {
      setInjectedAttachments(mediaAttachments)
      setMediaAttachments([])
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-slate-200 bg-white px-5 py-3">
          <div className="app-drag mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">运营推广素材与生成</h2>
            <div className="app-no-drag">
              <HelpButton content={HELP_CONTENT.operation} />
            </div>
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">主题：</span>
            <input
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="本篇主题，如 周末浙大充电学习"
              className="w-52 rounded-lg border border-slate-300 px-2.5 py-1 text-xs outline-none focus:border-jushi-accent"
              title="填主题后，上传的图片/视频会归到 inbox/05_运营_operation/{主题}/ 并顺序改名，便于识别与配文"
            />
            <span className="ml-1 text-xs text-slate-400">素材：</span>
            {MEDIA_UPLOAD_KINDS.map((kind) => (
              <FileDropzone
                key={kind.key}
                compact
                buttonLabel={kind.buttonLabel}
                filters={kind.filters}
                uploadFn={uploadMedia}
                onUploaded={(a) => setMediaAttachments((prev) => [...prev, ...a])}
              />
            ))}
            <button
              onClick={handleIdentify}
              disabled={!theme.trim()}
              title="让分身逐张看图识别内容（防图文不符），写出 _配图识别.json"
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              🔍 AI 识别配图
            </button>
            <button
              onClick={handleApplyNames}
              disabled={!theme.trim()}
              title="按识别结果把图片重命名为 主题_序号_内容 并生成配图清单"
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              ✅ 应用重命名
            </button>
            {mediaAttachments.map((a) => (
              <span key={a.path} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                {attachmentIcon(a.fileName)} {a.fileName}
              </span>
            ))}
          </div>
          {notice && <p className="mb-1 text-xs text-emerald-700">{notice}</p>}

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">风格模板：</span>
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              className="max-w-56 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 outline-none"
              title="选一个已上传的 html/md 风格模板，生成时分身会仿照它的结构与语气"
            >
              <option value="">不用模板</option>
              {templates
                .filter((x) => x.kind === '模板')
                .map((x) => (
                  <option key={x.fileName} value={x.fileName}>
                    {x.fileName}
                  </option>
                ))}
            </select>
            <button
              onClick={() => handleUploadTemplate([{ name: '风格模板', extensions: ['html', 'htm', 'md'] }])}
              title="上传 html/md 风格模板到 inbox/05_运营_operation/_风格模板/（跨主题复用）"
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              📎 上传模板
            </button>
            <button
              onClick={() => handleUploadTemplate([{ name: '模板图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }])}
              title="上传模板参考图（版式/视觉风格截图），生成时供分身参考"
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              🖼️ 上传模板图片
            </button>
            {templates.filter((x) => x.kind === '图片').length > 0 && (
              <span className="text-[11px] text-slate-400">已有 {templates.filter((x) => x.kind === '图片').length} 张模板图</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">平台：</span>
            {(['小红书', '微信公众号'] as Platform[]).map((p) => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  platform === p ? 'border-jushi-accent bg-jushi-accent text-white' : 'border-slate-300 text-slate-500'
                }`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={handleGenerate}
              className="ml-2 rounded-full bg-jushi-accent px-3 py-1 text-xs font-medium text-white"
            >
              ✍️ 生成内容
            </button>
            <button
              onClick={() => {
                setShowRecent((v) => !v)
                refreshRecent()
              }}
              className={`ml-auto rounded-full border px-3 py-1 text-xs font-medium ${
                showRecent ? 'border-jushi-accent text-jushi-accent' : 'border-slate-300 text-slate-500'
              }`}
              title="outputs/05_运营_operation 下最近生成的 10 篇推广文章"
            >
              🕘 最近生成{recent.length > 0 ? ` ${recent.length}` : ''}
            </button>
          </div>
        </div>

        {showRecent && (
          <div className="max-h-56 shrink-0 overflow-y-auto border-b border-slate-200 bg-slate-50 px-5 py-2">
            {recent.length === 0 && <p className="py-3 text-center text-xs text-slate-400">还没有生成过推广文章</p>}
            <div className="space-y-1">
              {recent.map((r) => (
                <div key={r.relativePath} className="flex items-center gap-2 rounded-md bg-white px-2.5 py-1.5 text-xs">
                  <button
                    onClick={() => window.api.shell.openPath(r.absPath)}
                    className="min-w-0 flex-1 truncate text-left text-slate-700 hover:text-jushi-accent"
                    title={`打开 ${r.relativePath}`}
                  >
                    {r.fileName.endsWith('.html') ? '🌐' : '📝'} {r.fileName}
                  </button>
                  {r.folder && <span className="max-w-40 shrink-0 truncate text-slate-400">{r.folder}</span>}
                  <span className="shrink-0 text-slate-300">{fmtDay(r.mtime)}</span>
                  {r.fileName.endsWith('.md') && (
                    <button
                      onClick={async () => {
                        const html = await window.api.gzh.runStyle(r.absPath)
                        await window.api.shell.openPath(html)
                        refreshRecent()
                      }}
                      className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-slate-500 hover:border-jushi-accent hover:text-jushi-accent"
                      title="按公众号固定风格一键排版"
                    >
                      排版
                    </button>
                  )}
                  <button
                    onClick={() => window.api.shell.showItemInFolder(r.absPath)}
                    className="shrink-0 text-slate-300 hover:text-jushi-accent"
                    title="在访达中显示"
                  >
                    📂
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {platform === '微信公众号' && showChat && <GzhStyleButton />}

        {/* 分身对话收起条 */}
        <button
          onClick={() => setShowChat((v) => !v)}
          className="flex shrink-0 items-center gap-1.5 border-t border-slate-200 bg-slate-50 px-4 py-1.5 text-xs text-slate-500 hover:text-jushi-accent"
          title={showChat ? '收起分身对话' : '展开分身对话'}
        >
          {showChat ? '▾' : '▸'} 💬 分身对话
        </button>
        <div className={`overflow-hidden ${showChat ? 'flex-1' : 'h-0'}`}>
          <AgentChat
            agent={agent}
            pendingPrompt={injectedPrompt}
            onPendingPromptConsumed={() => setInjectedPrompt(null)}
            pendingAttachments={injectedAttachments}
            onPendingAttachmentsConsumed={() => setInjectedAttachments(null)}
          />
        </div>
      </div>

      <div className={`shrink-0 overflow-hidden border-l border-slate-200 bg-slate-50 transition-all ${showOutputs ? 'w-80' : 'w-10'}`}>
        <button
          onClick={() => setShowOutputs((v) => !v)}
          className="flex w-full items-center justify-center py-3 text-slate-400 hover:text-jushi-accent"
          title="产出文件"
        >
          {showOutputs ? '›' : '‹'}
        </button>
        {showOutputs && (
          <>
            <h3 className="px-3 pb-1 text-xs font-semibold text-slate-500">产出：outputs/operation</h3>
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(100% - 60px)' }}>
              <OutputsPanel
                agentName="operation"
                refreshKey={refreshKey}
                extraFileAction={(entry: OutputEntry) =>
                  entry.name.endsWith('.md') ? (
                    <button
                      onClick={async () => {
                        const html = await window.api.gzh.runStyle(entry.path)
                        await window.api.shell.openPath(html)
                        setRefreshKey((k) => k + 1)
                      }}
                      className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-400 opacity-0 hover:bg-slate-100 hover:text-jushi-accent group-hover:opacity-100"
                      title="按公众号固定风格一键排版（小红书内容一般不需要这步）"
                    >
                      排版
                    </button>
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
