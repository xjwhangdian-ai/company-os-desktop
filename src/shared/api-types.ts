import type {
  AgentDisplayMeta,
  AgentName,
  AppConfig,
  BidProjectCard,
  BiddingProject,
  BiddingUploadResult,
  Company,
  ContractCategory,
  ContractTemplate,
  CustomerEntry,
  CustomerFields,
  FinanceEmployee,
  FinanceLedger,
  FinanceOverview,
  IntelCandidate,
  IntelConfirmResult,
  IntelReport,
  TenderDownloadResult,
  TenderProbeResult,
  LegalDoc,
  LinkedFile,
  MaterialLibraryCounts,
  MemberRole,
  OpsDocState,
  OpsGovernanceDoc,
  OpsPolicyDoc,
  OutputEntry,
  ProductEntry,
  ProductFields,
  ProviderConfig,
  ProviderId,
  QuotationTemplate,
  SolutionFile,
  SolutionFileKind,
  SupplierDocPreview,
  SyncResult,
  SyncStatus,
  TeamMember
} from './agent-types'
import type { AgentStreamEvent } from './stream-events'

export interface RunAgentRequest {
  runId: string
  agentName: AgentName
  prompt: string
  resumeSessionId?: string
  /** 当前登录的团队成员名字，用于产出文件落款；未登录/跳过身份选择时可不传 */
  userName?: string
}

export interface UploadResult {
  absPath: string
  relativePath: string
}

export interface FileFilter {
  name: string
  extensions: string[]
}

/** 渲染进程通过 preload 的 contextBridge 拿到的窗口全局 API */
export interface CompanyOsApi {
  config: {
    get(): Promise<AppConfig>
    pickDataDir(): Promise<string | null>
    setActiveProvider(id: ProviderId): Promise<void>
    setProviderConfig(id: ProviderId, patch: Partial<Omit<ProviderConfig, 'id'>>): Promise<void>
    addCompany(name: string): Promise<Company>
    removeCompany(id: string): Promise<void>
    setCompanyDataDir(id: string, dir: string): Promise<void>
    setActiveCompany(id: string): Promise<void>
  }
  agents: {
    list(): Promise<AgentDisplayMeta[]>
  }
  agentRun: {
    start(req: RunAgentRequest): Promise<void>
    cancel(runId: string): Promise<void>
    onEvent(callback: (runId: string, event: AgentStreamEvent) => void): () => void
  }
  dialog: {
    pickFiles(filters?: FileFilter[]): Promise<string[]>
  }
  shell: {
    showItemInFolder(path: string): Promise<void>
    saveAsCopy(path: string): Promise<boolean>
    openPath(path: string): Promise<void>
  }
  upload: {
    /** 通用聊天上传：按分身落 inbox/{编号_分身}/，与 outputs/ 分身文件夹镜像 */
    generic(agentName: AgentName, sourcePath: string): Promise<UploadResult>
    /** 招标原件落 inbox/03_招投标_bidding/{日期_项目}/，返回配对的 outputs 侧目录 */
    biddingProject(sourcePath: string): Promise<BiddingUploadResult>
    biddingMaterial(category: string, sourcePath: string): Promise<UploadResult>
    legalPending(sourcePath: string, category: ContractCategory): Promise<UploadResult>
  }
  outputs: {
    scan(agentName: AgentName): Promise<OutputEntry[]>
  }
  bidding: {
    listProjects(): Promise<BiddingProject[]>
    materialCounts(): Promise<MaterialLibraryCounts>
    /** 保存项目卡（App 托管；人工录入优先，分身只能写回填暂存） */
    saveCard(folderName: string, card: BidProjectCard): Promise<BidProjectCard>
    /** 导出跨项目台账 CSV 到 outputs/03_招投标_bidding/招标项目台账.csv */
    exportLedger(): Promise<{ path: string; count: number }>
    /** 答疑/澄清文件上传到项目 inbox 侧的 答疑澄清/ 子文件夹 */
    uploadClarification(projectFolder: string, sourcePath: string): Promise<UploadResult>
    /** 人工下载的招标文件导入项目 inbox 侧 01_招标文件/（网站需登录验证，自动下载已改人工） */
    uploadTenderFile(projectFolder: string, sourcePath: string): Promise<UploadResult>
    /** intel 每日追踪推送的待确认候选项目（已确认/已忽略的不再返回） */
    listCandidates(): Promise<IntelCandidate[]>
    /** 人工确认跟进：建项目档+项目卡（自动填业主单位/预算金额）+ 写机读溯源 sidecar；不下载招标文件 */
    confirmCandidate(key: string): Promise<IntelConfirmResult>
    ignoreCandidate(key: string): Promise<void>
    /** 下载某项目的招标文件（浙江政采源，登录感知）→ inbox 01_招标文件/，并回填招标编号 */
    downloadTender(folderName: string): Promise<TenderDownloadResult>
    /** 下载前探测招标公告附件清单（不下载），供 UI 弹「人工确认后再下载」提示 */
    probeTender(folderName: string): Promise<TenderProbeResult>
    /** 忽略/删除项目：inbox+outputs 两侧文件夹移入系统废纸篓（可从废纸篓恢复） */
    deleteProject(folderName: string): Promise<{ ok: boolean; 说明: string }>
  }
  intel: {
    /** sgpjbg.com 研报情报（行业趋势 + 政策文件），取最新一天信息流 */
    listReports(): Promise<IntelReport[]>
    /** 清除超过三天的旧情报机读数据（信息流/候选/研报 JSON + inbox 原始抓取），保留日报 */
    purgeStale(): Promise<{ purged: string[] }>
    /** App 内置抓取最近三天招投标信息（浙江政采/台州工程/台州阳光采购，跨平台可用，不依赖 git 同步） */
    fetchNow(force?: boolean): Promise<{ ok: boolean; 新增条数: number; 平台结果: string[]; 说明: string }>
    /** 研报条目一键转存进解决方案资料库（政策文件库/行业趋势库），存成情报线索卡 md */
    saveReportToSolution(report: IntelReport): Promise<{ ok: boolean; relativePath: string; existed: boolean }>
    /** 人工触发研报重抓（拉起 run_reports.sh），与定时任务数据按链接去重合并；仅管理员 Mac 可用 */
    fetchReports(): Promise<{ ok: boolean; 新增条数: number; 说明: string }>
  }
  legal: {
    listDocs(): Promise<{ pending: LegalDoc[]; reviewed: LegalDoc[] }>
    markReviewed(fileName: string): Promise<void>
    listTemplates(): Promise<ContractTemplate[]>
    uploadTemplate(category: ContractCategory, sourcePath: string): Promise<UploadResult>
  }
  docgen: {
    exportMarkdownFile(markdownPath: string): Promise<string>
    exportBiddingTriSplit(
      markdownPath: string
    ): Promise<{ bookTitle: string; fileName: string; path: string }[]>
  }
  gzh: {
    runStyle(inputMdPath: string): Promise<string>
  }
  identity: {
    list(): Promise<TeamMember[]>
    add(name: string, pin?: string): Promise<TeamMember>
    remove(id: string): Promise<void>
    verifyPin(id: string, pin?: string): Promise<boolean>
    /** 管理员改角色；不允许把最后一个管理员降级 */
    setRole(id: string, role: MemberRole): Promise<{ ok: boolean; message?: string }>
    /** 登录成功后告知主进程当前用户名（供关闭前同步的提交署名用） */
    notifyLogin(name: string): Promise<void>
  }
  sync: {
    /** 当前公司数据目录的 git 状态（不触网） */
    status(): Promise<SyncStatus>
    /** 一键同步：提交本地改动 → pull --rebase → push；冲突时恢复原状并报冲突文件 */
    now(userName: string): Promise<SyncResult>
    /** 当前公司最近一次成功同步的时间戳 */
    lastAt(): Promise<number | null>
  }
  sales: {
    /** 读取产品库（会先自动合并 _待入库/ 里 agent 暂存的解析结果）；skipped=同名多供应商无法定位的更新条目数 */
    listProducts(): Promise<{ products: ProductEntry[]; ingested: number; skipped: number }>
    /** 新增（不传 id）或整体更新（传 id）一条产品记录 */
    saveProduct(fields: ProductFields, id?: string): Promise<ProductEntry>
    removeProduct(id: string): Promise<void>
    /** 设置/替换产品图片（拷入 销售/产品库/图片库/，旧图自动清理） */
    setProductImage(id: string, sourcePath: string): Promise<ProductEntry>
    /** 供应商资料/投标报价文件上传到 销售/产品库/原始资料/，生成伴生提取文本，xlsx/csv 顺带做表头识别预览 */
    uploadSupplierDoc(sourcePath: string): Promise<SupplierDocPreview>
    /** 按表头识别结果把 xlsx/csv 机械导入产品库（不经过 AI） */
    importExcel(relativePath: string): Promise<{ added: number; updated: number; skipped: number }>
    /** 把报价单产品的图片导出到 outputs 报价目录的 图片/ 子文件夹 */
    exportQuoteImages(productIds: string[], customerName: string): Promise<{ dir: string; exported: number; missing: string[] }>
    listTemplates(): Promise<QuotationTemplate[]>
    uploadTemplate(sourcePath: string): Promise<QuotationTemplate>
    listCustomers(): Promise<CustomerEntry[]>
    saveCustomer(fields: CustomerFields, id?: string): Promise<CustomerEntry>
    removeCustomer(id: string): Promise<void>
    addFollowUp(customerId: string, content: string): Promise<void>
    linkCustomerFile(customerId: string, 类型: LinkedFile['类型'], filePath: string): Promise<void>
    unlinkCustomerFile(customerId: string, index: number): Promise<void>
    /** 关联文件存的相对路径 → 当前数据目录下的绝对路径（用于打开/定位） */
    resolveLinkedPath(stored: string): Promise<string>
  }
  solution: {
    listFiles(): Promise<Record<SolutionFileKind, SolutionFile[]>>
    upload(kind: SolutionFileKind, sourcePath: string): Promise<{ relativePath: string }>
    removeFile(relativePath: string): Promise<void>
  }
  finance: {
    /** 某月（缺省=本月）财税任务清单+员工配置+发薪日提醒+票据数 */
    overview(ym?: string): Promise<FinanceOverview>
    toggleTask(ym: string, taskKey: string, done: boolean): Promise<void>
    /** 保存员工配置与发薪日（财务/财税台账.json，App 托管） */
    saveEmployees(员工: FinanceEmployee[], 发薪日: number): Promise<FinanceLedger>
    /** 票据上传 → inbox/08_财务_finance/票据/{YYYY-MM}/ */
    uploadReceipt(ym: string, sourcePath: string): Promise<{ relativePath: string }>
    listReceipts(ym: string): Promise<OutputEntry[]>
  }
  ops: {
    /** 制度文件（四状态文件夹：未审核/初审/终审/定稿） */
    listPolicyDocs(): Promise<OpsPolicyDoc[]>
    /** 改状态 = 移动到目标状态文件夹 */
    setPolicyDocState(relativePath: string, target: OpsDocState): Promise<OpsPolicyDoc>
    /** 公司章程等治理文件直达（扫 outputs/04_法务_legal/ 文件名含 章程/代持/股权），附审核状态（默认未审核） */
    listGovernanceDocs(): Promise<OpsGovernanceDoc[]>
    /** 治理文件改审核状态：文件不动，状态记 App 托管 JSON */
    setGovernanceState(relativePath: string, state: OpsDocState): Promise<void>
  }
}

declare global {
  interface Window {
    api: CompanyOsApi
  }
}
