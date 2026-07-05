// 与主进程/渲染进程共享的类型定义。这里只放"契约"，不放实现。

export type AgentName =
  | 'sales'
  | 'solution'
  | 'bidding'
  | 'legal'
  | 'operation'
  | 'brand'
  | 'ops-policy'
  | 'finance'
  | 'intel'

export interface AgentDefinition {
  name: AgentName
  description: string
  tools: string[]
  /** frontmatter 里的别名，如 'opus' | 'sonnet' | 'haiku'，映射解析在主进程完成 */
  model?: string
  /** system prompt 正文（.md 去掉 frontmatter 之后的部分），仅供 UI 展示，不用于调用 */
  promptPreview: string
}

export interface AgentDisplayMeta {
  name: AgentName
  displayName: string
  role: string
  whenToUse: string
  color: string
  icon: string
}

export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatAttachment {
  /** 上传后在数据目录内的绝对路径 */
  path: string
  fileName: string
  /** 相对数据目录的路径，用于展示 */
  relativePath: string
}

export interface ToolUseSummary {
  id: string
  name: string
  input: unknown
  /** 工具执行结果的简短摘要，用于时间线展示 */
  resultSummary?: string
  status: 'running' | 'done' | 'error'
}

export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  attachments?: ChatAttachment[]
  toolUses?: ToolUseSummary[]
  createdAt: number
  /** 是否仍在流式输出中 */
  streaming?: boolean
  /** 出错信息（如未登录/网络错误） */
  error?: string
}

export interface RunResultMeta {
  costUsd?: number
  numTurns?: number
  durationMs?: number
  isError: boolean
}

export interface OutputEntry {
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
  size: number
  mtimeMs: number
  children?: OutputEntry[]
}

/**
 * 招投标项目 = inbox/03_招投标_bidding/{项目}/（招标原件）+ outputs/03_招投标_bidding/{项目}/（解析/质疑/投标产出）
 * 同名文件夹配对；两侧任一存在即视为一个项目。
 */
export interface BiddingProject {
  folderName: string
  projectName: string
  date: string
  /** inbox 侧项目文件夹绝对路径（可能还没有，比如手工只建了产出侧） */
  inboxPath?: string
  /** outputs 侧项目文件夹绝对路径 */
  outputsPath?: string
  hasSourceFile: boolean
  hasParseReport: boolean
  hasChallengeLetter: boolean
  hasDraft: boolean
  /** 两侧文件合并列表（relativePath 以 inbox/ 或 outputs/ 开头区分来源） */
  files: OutputEntry[]
}

export interface BiddingUploadResult {
  absPath: string
  relativePath: string
  /** 项目文件夹名（YYYY-MM-DD_项目名，由文件名派生，两侧同名配对） */
  projectFolder: string
  /** 产出应写入的 outputs 侧目录（相对数据目录） */
  outputsDirRelative: string
}

export interface MaterialLibraryCounts {
  产品资料: number
  产品检测报告: number
  产品解决方案: number
  人员资质: number
  类似项目合同: number
}

export type ContractCategory = '销售合同' | '工程合同' | '其他'

export const CONTRACT_CATEGORIES: ContractCategory[] = ['销售合同', '工程合同', '其他']

export interface LegalDoc {
  fileName: string
  path: string
  status: 'pending' | 'reviewed'
  mtimeMs: number
  /** 从文件名里的【类型】前缀解析出来，没有前缀视为"其他" */
  category: ContractCategory
}

export interface ContractTemplate {
  fileName: string
  path: string
  category: ContractCategory
}

/** 渲染进程展示用——只暴露"是否设了 PIN"，真实 PIN 哈希留在主进程 */
export interface TeamMember {
  id: string
  name: string
  hasPin: boolean
}

// ============ 销售工作台 ============
// 产品库/客户库是 App 托管的规范化 JSON（销售/产品库/产品库.json、销售/客户库.json），
// 字段名直接用中文——用户会直接打开这两个 JSON 看，也和上传的供应商资料表头对得上。
// 采购侧敏感字段（供应商联系人/联系方式）只进产品库，绝不进对外报价文件。

export interface ProductEntry {
  id: string
  产品名称: string
  产品分类: string
  技术参数: string
  /** 供应商给我们的进货价——采购侧口径，严禁进对外产出 */
  成本价: string
  /** 对客户的常规建议售价，报价单默认取它 */
  建议销售价: string
  /** 投标场景用的报价口径，可从投标报价文件自动识别回填 */
  投标报价: string
  供应商名称: string
  供应商联系人: string
  供应商联系方式: string
  /** 产品图片，相对数据目录路径（销售/产品库/图片库/xxx.png），由 App 托管 */
  图片?: string
  备注?: string
  /** 这条记录最初从哪份上传资料提取而来 */
  来源文件?: string
  更新时间: number
}

/** 产品库可编辑字段（去掉 id/更新时间 这类 App 托管字段） */
export type ProductFields = Omit<ProductEntry, 'id' | '更新时间'>

export type CustomerStatus = '线索' | '跟进中' | '已报价' | '已成交' | '搁置'

export const CUSTOMER_STATUSES: CustomerStatus[] = ['线索', '跟进中', '已报价', '已成交', '搁置']

export type ContactRole = '经办人' | '决策人' | '干系人'

export const CONTACT_ROLES: ContactRole[] = ['经办人', '决策人', '干系人']

export interface CustomerContact {
  角色: ContactRole
  姓名: string
  联系方式: string
}

export interface LinkedFile {
  类型: '报价文件' | '合同文件'
  /** 数据目录内的文件存相对路径（跨机器同步不失效），目录外的存绝对路径 */
  路径: string
  时间: number
}

export interface FollowUpRecord {
  时间: number
  内容: string
}

export interface CustomerEntry {
  id: string
  客户名称: string
  项目名称: string
  招采网址: string
  状态: CustomerStatus
  联系人列表: CustomerContact[]
  /** 已报价→关联报价文件；已成交→关联合同文件（不强制，UI 只做提示） */
  关联文件: LinkedFile[]
  备注?: string
  跟进记录: FollowUpRecord[]
  更新时间: number
}

/** 客户可编辑字段（跟进记录/关联文件走各自的专用接口） */
export type CustomerFields = Omit<CustomerEntry, 'id' | '跟进记录' | '关联文件' | '更新时间'>

export interface QuotationTemplate {
  fileName: string
  path: string
  relativePath: string
  /** docx/xlsx 模板会有一个 App 预提取的纯文本伴生文件，agent 读它来模仿模板结构 */
  companionRelativePath?: string
}

// ============ 解决方案工作台 ============

export type SolutionFileKind = 'requirement' | 'productLib' | 'solutionLib' | 'template'

export interface SolutionFile {
  fileName: string
  path: string
  relativePath: string
  size: number
  mtimeMs: number
  /** 音频文件（mp3/m4a/wav）→ 可转写 */
  isAudio: boolean
  /** 该音频已有对应的 _转写.md */
  hasTranscript: boolean
  /** docx/xlsx 的 App 预提取文本伴生文件 */
  companionRelativePath?: string
}

export interface WhisperStatus {
  found: boolean
  /** 找到的 whisper 可执行文件路径 */
  whisperPath?: string
  ffmpegFound: boolean
}

export type TranscribeEvent =
  | { jobId: string; type: 'progress'; text: string }
  | { jobId: string; type: 'done'; outputRelativePath: string }
  | { jobId: string; type: 'error'; message: string }

/** 供应商资料上传后的解析预览：Excel 表头机械识别的结果（识别不出来就走 AI 解析） */
export interface SupplierDocPreview {
  relativePath: string
  fileName: string
  /** 提取出的伴生纯文本文件（docx/doc/xlsx 生成；pdf/文本类无需） */
  companionRelativePath?: string
  /** 仅 xlsx/csv：识别到的表头行 */
  headers?: string[]
  /** 仅 xlsx/csv：字段 → 命中的表头列序号（未命中的字段不出现） */
  fieldMapping?: Partial<Record<keyof ProductFields, number>>
  /** 仅 xlsx/csv：可导入的数据行数（表头行之后、产品名称非空的行） */
  importableRows?: number
  /** 仅 xlsx/csv：前几行数据预览 */
  sampleRows?: string[][]
}

/**
 * 支持切换的模型供应商。均以 ANTHROPIC_BASE_URL + 认证环境变量的方式接入——
 * DeepSeek/MiniMax/Qwen 官方都提供了原生兼容 Anthropic Messages API 协议的端点
 * （不是 OpenAI 协议，不需要转换代理），所以复用同一套 Claude Agent SDK 调用链路即可，
 * 换供应商本质是换 base URL + 密钥 + 模型名，不用另起一套 agent 循环。
 * 'custom' 是通用逃生舱：任何其它自建/自托管的 Anthropic 协议兼容端点（如
 * claude-code-router）都能通过这个槽位接入，不用为每个新供应商改代码。
 */
export type ProviderId = 'anthropic' | 'deepseek' | 'minimax-intl' | 'minimax-cn' | 'qwen' | 'custom'

export interface ModelMapping {
  opus: string
  sonnet: string
  haiku: string
}

export interface ProviderConfig {
  id: ProviderId
  label: string
  /** null = 官方 Anthropic API，不设 ANTHROPIC_BASE_URL */
  baseUrl: string | null
  /** 认证信息通过哪个环境变量传给 SDK 底层 CLI——多数第三方兼容端点用 Bearer 语义的 AUTH_TOKEN，而非 Anthropic 原生的 API_KEY */
  authEnvVar: 'ANTHROPIC_API_KEY' | 'ANTHROPIC_AUTH_TOKEN'
  apiKey: string | null
  modelMapping: ModelMapping
}

/** 一家公司 = 一个独立的 company-os 数据目录。团队成员/模型供应商配置是全局的，不按公司拆分——
 * 同一个人、同一套 API Key 可能两家公司的活都要干，只有"分身读哪套 knowledge/bidding/outputs"按公司区分。 */
export interface Company {
  id: string
  name: string
  dataDir: string | null
}

export interface AppConfig {
  companies: Company[]
  activeCompanyId: string | null
  activeProviderId: ProviderId
  providers: Record<ProviderId, ProviderConfig>
}
