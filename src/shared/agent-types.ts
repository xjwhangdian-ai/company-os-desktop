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

export type BidProjectStatus = '跟进中' | '已投标' | '已中标' | '未中标' | '已放弃'

export const BID_PROJECT_STATUSES: BidProjectStatus[] = ['跟进中', '已投标', '已中标', '未中标', '已放弃']

/**
 * 项目卡：招投标项目的结构化商务信息（吸收自"投标项目管理"参考系统的项目信息卡+台账设计）。
 * 存 outputs/03_招投标_bidding/{项目}/项目卡.json，App 托管——分身只能写 _项目卡回填.json 暂存，
 * App 按"只填人没填过的空字段"合并，人工录入永远优先于 AI 回填。
 */
export interface BidProjectCard {
  业主单位: string
  招标编号: string
  预算金额: string
  我方报价: string
  保证金: string
  /** YYYY-MM-DD；台账视图按它做倒计时排序 */
  投标截止日: string
  开标日: string
  状态: BidProjectStatus
  备注: string
  更新时间: number
  /** 人工在项目卡编辑器里保存过（触达过状态）→ 台账不再显示「待处理」；情报确认/分身回填不设此标 */
  人工确认?: boolean
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
  /** 项目卡；还没建卡时为 null（UI 显示"未填"并可一键创建） */
  card: BidProjectCard | null
  /** 情报推送来源（_情报来源.json）：公告链接 + 能否自动下载招标文件；手工建的项目为 null */
  tenderSource: TenderSource | null
  /** 两侧文件合并列表（relativePath 以 inbox/ 或 outputs/ 开头区分来源） */
  files: OutputEntry[]
}

export const INTEL_FEED_TYPES = ['采购意向', '意见征询', '采购公告', '采购结果公告'] as const
export type IntelFeedType = (typeof INTEL_FEED_TYPES)[number]

/** intel 每日追踪的招投标信息条目：全量信息流（{日期}_信息流.json）合并分身相关度标注（{日期}_候选项目.json） */
export interface IntelCandidate {
  /** `${日期}|${项目名称}`——处理状态文件用它去重 */
  key: string
  日期: string
  类型: IntelFeedType
  项目名称: string
  采购单位: string
  /** 预算/金额原文（如 "¥500.0万"），项目卡回填时去掉货币符号 */
  预算: string
  中标单位: string
  区县: string
  标签: string
  链接: string
  平台: string
  台州公安: boolean
  /** 命中的兴趣关键词（读列表时按用户配置动态匹配；未命中为 null） */
  命中关键词?: string | null
  /** intel 分身标注的相关度；未标注（纯信息流条目）为 null */
  相关度: '高' | '中' | null
  理由: string
  /** 已跟进项目（此前确认过征询/意向等阶段）发布了正式采购公告——置顶高亮，确认后归档进原项目 */
  跟进升级?: boolean
}

export interface IntelConfirmResult {
  ok: boolean
  项目文件夹: string
  说明: string
}

/** 招投标项目的招标文件下载来源信息（供 UI 判断按钮状态） */
export interface TenderSource {
  公告链接: string
  来源平台: string
  /** 是否支持自动下载（当前仅浙江政采源） */
  可自动下载: boolean
  /** 公告类型（来自 _情报来源.json）：采购意向无招标文件、意见征询/采购公告需人工确认后下载；手工项目为 '' */
  公告类型: IntelFeedType | ''
}

/** 下载前探测：列出招标公告的附件清单，供 UI 弹「人工确认后再下载」提示 */
export interface TenderProbeResult {
  ok: boolean
  /** true=招标网站需先登录/过验证 */
  needsLogin: boolean
  /** 探测到的附件（仅文件名，不下载） */
  附件: { name: string }[]
  说明: string
}

export interface TenderDownloadResult {
  ok: boolean
  已下载文件数: number
  /** true=招标网站需先登录/过验证，UI 提示用户在调试 Chrome 登录后重试 */
  needsLogin: boolean
  说明: string
}

export const INTEL_REPORT_TYPES = ['行业趋势', '政策文件'] as const
export type IntelReportType = (typeof INTEL_REPORT_TYPES)[number]

/** sgpjbg.com 研报情报条目：行业趋势 / 政策文件，链接指向报告下载页 */
export interface IntelReport {
  分类: IntelReportType
  关键词: string
  标题: string
  链接: string
  页数: number
  发布日期: string
  VIP: boolean
  抓取日期: string
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

/**
 * 角色：管理员管"大脑与库"（设置页、成员管理、数据目录/供应商配置），普通员工用分身干活
 * （上传 inbox、生成 outputs）。注意这是**轻量权限**（单机 App 的界面级区分），不是安全体系。
 */
export type MemberRole = 'admin' | 'member'

/** 渲染进程展示用——只暴露"是否设了 PIN"，真实 PIN 哈希留在主进程 */
export interface TeamMember {
  id: string
  name: string
  hasPin: boolean
  role: MemberRole
  /** 还在用初始 PIN（123456）——登录时提示修改 */
  usingDefaultPin: boolean
  /** 员工可见的分身列表；undefined=全部可见。管理员恒为全部，不受此字段限制 */
  可见分身?: AgentName[]
}

// ============ 一键同步 ============

export interface SyncStatus {
  isRepo: boolean
  hasRemote: boolean
  branch: string
  dirtyCount: number
  ahead: number
  behind: number
}

export interface SyncResult {
  ok: boolean
  committed?: boolean
  conflict?: boolean
  message: string
}

// ============ 销售工作台 ============
// 产品库/客户库是 App 托管的规范化 JSON（销售/产品库/产品库.json、销售/客户库.json），
// 字段名直接用中文——用户会直接打开这两个 JSON 看，也和上传的供应商资料表头对得上。
// 采购侧敏感字段（供应商联系人/联系方式）只进产品库，绝不进对外报价文件。

export interface ProductEntry {
  id: string
  产品名称: string
  产品分类: string
  /** 对外报价单的"品牌"列只取这个字段（供应商名称可能是经销渠道，属采购侧信息） */
  品牌: string
  型号: string
  生产制造商: string
  产地: string
  技术参数: string
  /** 台/套/个… 报价单的计量单位列 */
  单位: string
  税率: string
  /** 质保期，单位月 */
  质保期: string
  物料代码: string
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

/** 机械生成 Excel 报价单的一行输入（价格由用户在报价单页确认过，不是成本价） */
export interface QuoteLineInput {
  productId: string
  数量: string
  单价: string
}

export interface QuoteXlsxResult {
  /** 生成的 .xlsx 绝对路径 */
  outPath: string
  /** 报价产出目录 */
  dir: string
  /** 报价台账单号，如 BJ-20260718-01 */
  单号: string
  /** 可计算时的合计金额（元），含非数字单价时为 null */
  合计: number | null
  /** 随报价自动导出到 图片/ 子文件夹的产品图数量 */
  导出图片: number
  /** 需人工注意的事项（缺品牌、模板没识别到某列等） */
  warnings: string[]
}

// ============ 解决方案工作台 ============

export type SolutionFileKind = 'requirement' | 'productLib' | 'solutionLib' | 'policyLib' | 'trendLib' | 'template'

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
export type ProviderId = 'anthropic' | 'deepseek' | 'minimax-intl' | 'minimax-cn' | 'qwen' | 'zhipu' | 'custom'

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

// ============ 财务工作台（记账/报税/工资社保） ============

export interface FinanceEmployee {
  id: string
  姓名: string
  /** 法定代表人 / 员工 */
  角色: string
  /** 月工资（元，字符串存储便于留空） */
  月工资: string
  /** 社保核定基数（元；工资低于最低基数按最低基数缴，留空=按工资与最低基数取高） */
  社保基数?: string
  /** 是否参加社保/医保 */
  参保: boolean
}

/** 财务/财税台账.json —— App 托管（path-guard 拦分身直写） */
export interface FinanceLedger {
  version: 1
  /** 发薪日（1-28） */
  发薪日: number
  员工: FinanceEmployee[]
  /** { "YYYY-MM": { taskKey: true } } */
  月度勾选: Record<string, Record<string, boolean>>
}

export interface FinanceTask {
  key: string
  名称: string
  /** YYYY-MM-DD（通行口径，遇节假日顺延以电子税务局公告为准） */
  截止: string
  说明: string
  done?: boolean
}

export interface FinanceOverview {
  月份: string
  任务: FinanceTask[]
  员工: FinanceEmployee[]
  发薪日: number
  今天是发薪日: boolean
  本月票据数: number
}

// ============ 行政人力工作台（制度文件四状态） ============

export const OPS_DOC_STATES = ['未审核', '初审', '终审', '定稿'] as const
export type OpsDocState = (typeof OPS_DOC_STATES)[number]

export interface OpsPolicyDoc {
  name: string
  path: string
  relativePath: string
  state: OpsDocState
  size: number
  mtimeMs: number
}

/** 治理文件（章程/代持/股权，产出在 outputs/04_法务_legal/）：文件不动，审核状态记在 App 托管的状态 JSON 里 */
export interface OpsGovernanceDoc {
  name: string
  path: string
  relativePath: string
  state: OpsDocState
  mtimeMs: number
}
