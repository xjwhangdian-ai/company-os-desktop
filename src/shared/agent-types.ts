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

export interface BiddingProject {
  folderName: string
  path: string
  projectName: string
  date: string
  hasSourceFile: boolean
  hasParseReport: boolean
  hasChallengeLetter: boolean
  hasDraft: boolean
  files: OutputEntry[]
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
