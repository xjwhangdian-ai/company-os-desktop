import { useEffect, useState } from 'react'
import type { AgentDisplayMeta, ChatAttachment, OutputEntry } from '@shared/agent-types'
import type { FileFilter } from '@shared/api-types'
import { AgentChat } from '../components/AgentChat'
import { HDragHandle, usePersistedSize } from '../components/PaneDivider'
import { FileDropzone } from '../components/FileDropzone'
import { OutputsPanel } from '../components/OutputsPanel'
import { GzhStyleButton } from '../components/GzhStyleButton'
import { HelpButton } from '../components/HelpPanel'
import { HELP_CONTENT } from '../lib/help-content'

type Platform = '小红书' | '微信公众号' | '抖音' | '微信视频号' | '数字人短视频'
type VideoGenerator = 'Seedance 2.5' | 'Kling 3.0' | '两者都导出'

const SHORT_VIDEO_PACK = [
  '产出一份完整的短视频推广材料包（.md，含以下全部板块）：',
  '① 口播脚本：15-60 秒，用表格分镜（镜头序号/画面内容/口播台词/屏幕字幕/时长秒数），画面列优先引用已上传的素材文件名；',
  '② 视频标题：3 个备选（带钩子，前 5 个字抓住注意力）；',
  '③ 发布文案：正文 + 话题标签；',
  '④ 封面建议：封面画面 + 封面大字文案（不超过 12 字）；',
  '⑤ 发布建议：发布时间段、置顶评论话术、引导关注话术。',
  '素材使用规则：图片用 Read 逐张打开看清真实画面再写进分镜；视频文件无法直接观看，按文件名与我的描述引用，标注〔视频内容待人工核对〕。'
].join('\n')

/** 数字人短视频是运营分身的内容工厂模式：先产出可审核的完整包，有合规素材时再调用视频管线成片。 */
const DIGITAL_HUMAN_PACK = [
  '生成一套“数字人短视频创意蓝图与动态视频提示词包”（.md），面向企业采购/行业客户，内容形式 To C、转化目标 To B。工作方式：先在 ChatGPT 图像模型生成并挑选静态关键帧，再把对应关键帧与动态提示词交给 Seedance 2.5 或 Kling 3.0：',
  '① 选题卡：目标受众、场景痛点、单一传播主张、私信/企微 CTA；',
  '② 3 个 3 秒钩子 + 30-45 秒主口播脚本，必须用分镜表（时间/数字人口播/画面或 B-roll/屏幕字幕/素材来源）；',
  '③ 数字人出镜设定：服装、背景、镜头、语速、表情与禁用表达；不能假冒客户、专家或执法人员；',
  '④ 静态关键帧清单：每个镜头给出一条可直接粘贴到 ChatGPT 图像模型的中文提示词，包含主体、场景、机位、构图、光线、材质、情绪、9:16 竖版与“无文字、无水印”；只引用已上传产品/场景素材，缺素材明确列“待补素材”，绝不虚构客户现场；',
  '⑤ 动态视频提示词：每个镜头紧随关键帧提示词，给出可直接粘贴到 Seedance 2.5 的“图生视频”指令（镜头运动、人物/产品动作、节奏、时长、首帧保持项、禁止项），以及可直接粘贴到 Kling 3.0 的对应指令（主体运动、镜头运动、物理约束、负面提示）；',
  '⑥ 交接表：镜头编号、ChatGPT 参考图文件名、上传到视频平台的参考图、Seedance/Kling 提示词、建议时长、配音/字幕、审核状态；',
  '⑦ 抖音、小红书、微信视频号三版标题、封面、发布文案、话题与置顶评论；',
  '⑧ 发布前审核清单：产品参数来源、客户案例授权、AI 生成内容标识、敏感场景与联系方式；',
  '⑨ 数据复盘表：播放、3秒留存、完播、收藏/私信、有效线索、预约演示，附下轮优化假设。',
  '不调用任何外部视频服务，不生成或索取平台密钥；交付可复制的创意蓝图、ChatGPT 静态图提示词与 Seedance/Kling 动态视频提示词。'
].join('\n')

const PLATFORM_PROMPTS: Record<Platform, string> = {
  小红书:
    '生成一篇小红书笔记文案。风格要求：口语化、emoji 适度点缀、开头 3 秒抓人的钩子、正文分点或分段清晰、结尾带 3-8 个相关话题标签(#xxx)。主题/需求：〔请描述这次想推广什么产品/场景/卖点〕',
  微信公众号:
    '生成一篇公众号推文图文。按标准结构：标题(2-3个备选)+摘要 → 痛点引入 → 场景/方案 → 价值/数据(标来源) → 行动引导 → 配图建议。主题/需求：〔请描述这次想推广什么产品/场景/卖点〕',
  抖音:
    `生成抖音短视频推广材料。平台风格：节奏快、开头 3 秒必须有钩子（反差/提问/痛点），口语化短句，字幕节奏感强，话题标签 3-5 个（#行业词+#热点词）。\n${SHORT_VIDEO_PACK}\n主题/需求：〔请描述这次想推广什么产品/场景/卖点〕`,
  微信视频号:
    `生成微信视频号推广材料。平台风格：比抖音更稳重可信（观众多为行业客户与熟人圈），开头亮明价值点，结尾引导转发到微信群/朋友圈，可关联公众号文章。\n${SHORT_VIDEO_PACK}\n主题/需求：〔请描述这次想推广什么产品/场景/卖点〕`,
  数字人短视频: `生成数字人短视频推广材料。数字人只是讲解载体，不能伪造客户见证、现场实拍或执法身份；所有产品型号、参数与案例都必须有来源。\n${DIGITAL_HUMAN_PACK}\n主题/需求：〔请描述本次推广产品、场景与核心痛点〕`
}

/** 产出子文件夹后缀：outputs/05_运营_operation/{主题}_{后缀}/ */
const PLATFORM_FOLDER: Record<Platform, string> = {
  小红书: '小红书',
  微信公众号: '公众号',
  抖音: '抖音',
  微信视频号: '视频号',
  数字人短视频: '数字人短视频'
}

/** 各平台从素材到发布的操作步骤提示 */
const PLATFORM_STEPS: Record<Platform, string> = {
  小红书: '① 填主题 → ② 上传图片素材 → ③（可选）AI识别配图+应用重命名 → ④ 生成内容 → ⑤ 打开生成的 .md，复制文字+配图到小红书 App 发布',
  微信公众号: '① 填主题 → ② 上传图片素材 → ③ AI识别配图+应用重命名 → ④ 生成内容 → ⑤ 最近生成里点「排版」出公众号 HTML → ⑥ 浏览器「一键复制」粘进公众号编辑器，配封面图发布',
  抖音: '① 填主题 → ② 上传视频/图片素材（建议在需求里补一句视频内容描述）→ ③ 生成内容（分镜脚本+标题+文案+封面建议材料包）→ ④ 按分镜脚本在剪映等工具剪视频、贴字幕 → ⑤ 用备选标题+话题标签发布，置顶评论用材料包话术',
  微信视频号: '① 填主题 → ② 上传视频/图片素材 → ③ 生成内容（材料包）→ ④ 按分镜脚本剪视频 → ⑤ 视频号发布后转发到微信群/朋友圈，可挂关联公众号文章链接',
  数字人短视频: '① 填主题、目标和视频平台 → ② 上传产品/场景素材 → ③ 生成创意蓝图 → ④ 将每镜头“ChatGPT 静态图提示词”粘贴到 ChatGPT，挑选关键帧 → ⑤ 将关键帧和对应 Seedance 2.5 / Kling 3.0 提示词上传生成动态镜头 → ⑥ 剪辑、审核 AI 标识后分平台发布并回填数据复盘'
}

/** 判断一条生成记录属于哪个平台（按产出文件夹名里的平台词；都不含=通用旧记录，各平台都显示） */
function articlePlatform(folder: string): Platform | null {
  if (folder.includes('小红书')) return '小红书'
  if (folder.includes('公众号')) return '微信公众号'
  if (folder.includes('抖音')) return '抖音'
  if (folder.includes('视频号')) return '微信视频号'
  if (folder.includes('数字人')) return '数字人短视频'
  return null
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
  const [chatH, setChatH] = usePersistedSize('operationChatHeight', 340, 200, 800)
  const [refreshKey, setRefreshKey] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [templates, setTemplates] = useState<TemplateEntry[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [recent, setRecent] = useState<RecentArticle[]>([])
  const [showRecent, setShowRecent] = useState(false)
  const [digitalAudience, setDigitalAudience] = useState('企业采购与现场负责人')
  const [digitalGoal, setDigitalGoal] = useState('获取私信线索')
  const [digitalDuration, setDigitalDuration] = useState('30-45 秒')
  const [digitalCta, setDigitalCta] = useState('私信领取场景配置清单')
  const [videoGenerator, setVideoGenerator] = useState<VideoGenerator>('两者都导出')

  function flash(t: string): void {
    setNotice(t)
    setTimeout(() => setNotice(null), 6000)
  }

  /** 当前平台的最近生成（产出文件夹带平台词的归对应平台；没带平台词的通用旧记录各平台都显示） */
  const platformRecent = recent
    .filter((r) => {
      const p = articlePlatform(r.folder)
      return p === null || p === platform
    })
    .slice(0, 10)

  async function refreshTemplates(): Promise<void> {
    try {
      setTemplates(await window.api.operation.listTemplates())
    } catch {
      // 主进程还是旧版本（没有新 IPC 通道）时会走到这里——静默留空，上传时会给明确提示
    }
  }
  async function refreshRecent(): Promise<void> {
    try {
      setRecent(await window.api.operation.recentArticles())
    } catch {
      flash('读取最近文章失败——如果刚更新过 App，请完全退出（Cmd+Q）后重新打开再试')
    }
  }
  useEffect(() => {
    refreshTemplates()
    refreshRecent()
  }, [refreshKey])

  async function handleUploadTemplate(filters: FileFilter[]): Promise<void> {
    const paths = await window.api.dialog.pickFiles(filters)
    if (paths.length === 0) return
    const uploaded: string[] = []
    try {
      for (const p of paths) {
        const r = await window.api.operation.uploadTemplate(p)
        const name = r.relativePath.split('/').pop() ?? ''
        uploaded.push(name)
        if (/\.(html?|md)$/i.test(name)) setSelectedTemplate(name)
      }
    } catch (err) {
      flash(
        `❌ 上传失败：${err instanceof Error ? err.message : String(err)}——如果刚更新过 App，请完全退出（Cmd+Q）后重新打开再试`
      )
      return
    }
    await refreshTemplates()
    flash(`✅ 上传成功：${uploaded.join('、')}（已存入 inbox/05_运营_operation/_风格模板/）`)
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
    const isVideo = platform === '抖音' || platform === '微信视频号' || platform === '数字人短视频'
    const themeLine = t
      ? isVideo
        ? `\n主题：${t}。产出写到 outputs/05_运营_operation/${t}_${PLATFORM_FOLDER[platform]}/（先建子文件夹）。视频/图片素材在 inbox/05_运营_operation/${t}/——先用 Glob 列出该目录全部文件，图片逐张 Read 看清画面再写分镜。`
        : `\n主题：${t}。产出写到 outputs/05_运营_operation/${t}_${PLATFORM_FOLDER[platform]}/（先建子文件夹）。配图在 inbox/05_运营_operation/${t}/，若有 配图清单.md 先读它选图；插入每张图前用 Read 复核画面，图注严格对应画面内容，绝不张冠李戴。`
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
    const digitalLine =
      platform === '数字人短视频'
        ? `\n数字人内容设定：目标受众=${digitalAudience}；本次目标=${digitalGoal}；时长=${digitalDuration}；CTA=${digitalCta}；动态视频平台=${videoGenerator}。先输出可人工审核的创意蓝图；每镜头必须含 ChatGPT 图像模型静态关键帧提示词和 ${videoGenerator} 动态视频提示词，供人工复制使用。`
        : ''
    setInjectedPrompt(PLATFORM_PROMPTS[platform] + themeLine + templateLine + digitalLine)
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
            {(['小红书', '微信公众号', '抖音', '微信视频号', '数字人短视频'] as Platform[]).map((p) => (
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
              {platform === '数字人短视频' ? '🧠 生成创意蓝图' : '✍️ 生成内容'}
            </button>
            <button
              onClick={() => {
                setShowRecent((v) => !v)
                refreshRecent()
              }}
              className={`ml-auto rounded-full border px-3 py-1 text-xs font-medium ${
                showRecent ? 'border-jushi-accent text-jushi-accent' : 'border-slate-300 text-slate-500'
              }`}
              title={`当前平台（${platform}）最近生成的 10 条内容`}
            >
              🕘 最近生成{platformRecent.length > 0 ? ` ${platformRecent.length}` : ''}
            </button>
          </div>

          {platform === '数字人短视频' && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-2">
              <span className="text-xs font-medium text-violet-700">🤖 数字人设定</span>
              <input value={digitalAudience} onChange={(e) => setDigitalAudience(e.target.value)} placeholder="目标受众" className="w-40 rounded border border-violet-200 bg-white px-2 py-1 text-xs outline-none" />
              <select value={digitalGoal} onChange={(e) => setDigitalGoal(e.target.value)} className="rounded border border-violet-200 bg-white px-2 py-1 text-xs text-slate-600 outline-none">
                <option>获取私信线索</option><option>预约演示</option><option>品牌曝光</option><option>渠道招募</option>
              </select>
              <select value={digitalDuration} onChange={(e) => setDigitalDuration(e.target.value)} className="rounded border border-violet-200 bg-white px-2 py-1 text-xs text-slate-600 outline-none">
                <option>15-20 秒</option><option>30-45 秒</option><option>45-60 秒</option>
              </select>
              <select value={videoGenerator} onChange={(e) => setVideoGenerator(e.target.value as VideoGenerator)} className="rounded border border-violet-200 bg-white px-2 py-1 text-xs text-slate-600 outline-none" title="选择要导出的动态视频提示词格式">
                <option>Seedance 2.5</option><option>Kling 3.0</option><option>两者都导出</option>
              </select>
              <input value={digitalCta} onChange={(e) => setDigitalCta(e.target.value)} placeholder="转化动作" className="w-48 rounded border border-violet-200 bg-white px-2 py-1 text-xs outline-none" />
              <span className="text-[11px] text-violet-500">ChatGPT 先出静态关键帧，再交 Seedance/Kling 生成动态镜头；发布须标注 AI 生成内容。</span>
            </div>
          )}

          {/* 当前平台的操作步骤提示 */}
          <p className="mt-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-slate-500">
            📖 {platform}操作步骤：{PLATFORM_STEPS[platform]}
          </p>
        </div>

        {showRecent && (
          <div className="max-h-56 shrink-0 overflow-y-auto border-b border-slate-200 bg-slate-50 px-5 py-2">
            <p className="pb-1 text-[11px] font-semibold text-slate-500">最近生成 · {platform}</p>
            {platformRecent.length === 0 && (
              <p className="py-3 text-center text-xs text-slate-400">{platform}最近没有内容产生——按上方操作步骤生成第一条</p>
            )}
            <div className="space-y-1">
              {platformRecent.map((r) => (
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

        {/* 弹性占位：对话栏改为固定高后，用它把对话区推到底部 */}
        <div className="min-h-0 flex-1" />

        {platform === '微信公众号' && showChat && <GzhStyleButton />}

        {/* 分身对话收起条 + 上下拖拽调高 */}
        {showChat && <HDragHandle size={chatH} onSize={setChatH} sign={-1} min={200} max={800} />}
        <button
          onClick={() => setShowChat((v) => !v)}
          className="flex shrink-0 items-center gap-1.5 border-t border-slate-200 bg-slate-50 px-4 py-1.5 text-xs text-slate-500 hover:text-jushi-accent"
          title={showChat ? '收起分身对话' : '展开分身对话'}
        >
          {showChat ? '▾' : '▸'} 💬 分身对话
        </button>
        <div className="shrink-0 overflow-hidden" style={{ height: showChat ? chatH : 0 }}>
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
