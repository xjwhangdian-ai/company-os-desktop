import type {
  AgentDisplayMeta,
  AgentName,
  AppConfig,
  BidProjectCard,
  BiddingProject,
  BiddingUploadResult,
  CategoryL1,
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
  IntelKeywordGroups,
  PriorityIntelProject,
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
  VideoModelConfigPatch,
  QuotationTemplate,
  QuoteLineInput,
  QuoteXlsxResult,
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
    setVideoModelConfig(patch: VideoModelConfigPatch): Promise<void>
    addCompany(name: string): Promise<Company>
    removeCompany(id: string): Promise<void>
    setCompanyDataDir(id: string, dir: string): Promise<void>
    setActiveCompany(id: string): Promise<void>
    /** 从安装包内置的 company-os 模板初始化一个新数据目录（弹目录选择框），并绑定到该公司 */
    initDataDir(companyId: string): Promise<{ ok: boolean; dataDir?: string; 说明: string }>
    /** 把内置模板里缺失的部分（分身定义/knowledge/骨架）补进当前数据目录——只增不改 */
    repairDataDir(): Promise<{ ok: boolean; copied: number; 说明: string }>
  }
  brand: {
    listMatters(): Promise<{
      key: string
      名称: string
      图标: string
      状态: '未开始' | '进行中' | '待人工' | '已完成'
      待办: string
      截止日: string
      成果: { name: string; path: string; mtimeMs: number }[]
    }[]>
    setMatter(key: string, patch: { 状态?: string; 待办?: string; 截止日?: string }): Promise<void>
  }
  env: {
    check(): Promise<{
      items: {
        key: string
        name: string
        ok: boolean
        required: boolean
        用途: string
        说明: string
        安装命令: string
        canAutoInstall: boolean
      }[]
      missingRequired: string[]
    }>
    install(key: string): Promise<{ ok: boolean; 说明: string }>
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
  help: {
    memberGuide(): Promise<string | null>
  }
  upload: {
    /** 通用聊天上传：按分身落 inbox/{编号_分身}/，与 outputs/ 分身文件夹镜像 */
    generic(agentName: AgentName, sourcePath: string): Promise<UploadResult>
    /** 招标原件落 inbox/03_招投标_bidding/{日期_项目}/，返回配对的 outputs 侧目录 */
    biddingProject(sourcePath: string): Promise<BiddingUploadResult>
    biddingMaterial(category: string, sourcePath: string): Promise<UploadResult>
    legalPending(sourcePath: string, category: ContractCategory): Promise<UploadResult>
    /** 运营公众号素材按主题落 inbox/05_运营_operation/{主题}/，图片顺序重命名 {主题}_序号.ext */
    operationTheme(theme: string, sourcePath: string): Promise<UploadResult>
  }
  operation: {
    /** 读 {主题}/_配图识别.json（分身看图后写的），把图片重命名为 {主题}_序号_描述.ext 并生成 配图清单.md */
    applyImageNames(theme: string): Promise<{ renamed: number; listRelative: string; total: number }>
    /** 风格模板（html/md）与模板参考图上传到 inbox/05_运营_operation/_风格模板/ */
    uploadTemplate(sourcePath: string): Promise<UploadResult>
    listTemplates(): Promise<{ fileName: string; relativePath: string; kind: '模板' | '图片'; mtime: number }[]>
    /** outputs/05_运营_operation 下最近生成的推广文章（md/html，修改时间倒序前 10 条） */
    recentArticles(): Promise<{ fileName: string; relativePath: string; absPath: string; folder: string; mtime: number }[]>
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
    /** 重点项目单独保存在 outputs/03_招投标_bidding/重点项目/，不参与每日清理 */
    listPriorityProjects(): Promise<PriorityIntelProject[]>
    markPriority(key: string): Promise<{ ok: boolean; 文件夹: string; 说明: string }>
    /** 将“跟进中”项目迁入重点项目目录，保留文件但不再显示在跟进列表。 */
    moveProjectToPriority(folderName: string): Promise<{ ok: boolean; 文件夹: string; 说明: string }>
    /** 采购结果公告「跟进」——中标信息+评审专家（标注采购人代表）入中标公告台账.xlsx，附件下载归档 */
    followWinner(key: string): Promise<{ ok: boolean; 说明: string; 归档目录?: string }>
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
    /** 招投标信息的兴趣关键词（命中标红+计入「只看相关」；存数据仓库，改词立即生效） */
    getKeywords(): Promise<string[]>
    keywordSuggestions(): Promise<{ 建议添加: { 词: string; 次数: number }[]; 建议移除: { 词: string; 忽略次数: number }[] }>
    setKeywords(keywords: string[]): Promise<string[]>
    getKeywordGroups(): Promise<IntelKeywordGroups>
    setKeywordGroups(groups: IntelKeywordGroups): Promise<IntelKeywordGroups>
    /** 研报「忽略」——按链接记入处理状态，不再出现在列表 */
    ignoreReport(链接: string): Promise<void>
    /** 研报「下载」——复用登录态调试 Chrome 拿直链落盘 outputs/09_情报_intel/研报文件/；仅管理员 Mac */
    downloadReport(report: IntelReport): Promise<{ ok: boolean; 说明: string; 文件?: string }>
    /** 研报抓取关键词（存管线 reports_config.json，分组与下次抓取都用它） */
    getReportKeywords(): Promise<string[]>
    setReportKeywords(keywords: string[]): Promise<{ ok: boolean; 说明: string }>
  }
  mba: {
    /** 课程列表（inbox/10_MBA学习_mba/ 下的课程文件夹与三类文件计数） */
    listCourses(): Promise<{ name: string; 课件数: number; 作业数: number; 录音数: number }[]>
    /** 按课程归档上传：课件 / 作业与要求 / 课堂录音（含钉钉A1导出的转写与音频） */
    uploadCourse(course: string, category: '课件' | '作业与要求' | '课堂录音', sourcePath: string): Promise<{ absPath: string; relativePath: string }>
  }
  legal: {
    listDocs(): Promise<{ pending: LegalDoc[]; reviewed: LegalDoc[] }>
    markReviewed(fileName: string): Promise<void>
    /** 按分身产出的 修订清单.json，把修改意见以 Word 修订模式写回原合同（仅 .docx） */
    generateRedline(fileName: string): Promise<{ ok: boolean; outPath?: string; applied: number; missed: { 原文: string; 修改为: string; 理由?: string }[]; 说明: string }>
    listTemplates(): Promise<ContractTemplate[]>
    uploadTemplate(category: ContractCategory, sourcePath: string): Promise<UploadResult>
  }
  docgen: {
    exportMarkdownFile(markdownPath: string): Promise<string>
    /** markdown 方案 → 汇报版 PPT（H1 封面/H2 分章/要点自动分页/表格截断展示） */
    exportMarkdownPptx(markdownPath: string): Promise<string>
    exportBiddingTriSplit(
      markdownPath: string
    ): Promise<{ bookTitle: string; fileName: string; path: string }[]>
  }
  gzh: {
    /** 一键排版，theme 选风格（炬视/瑾智），返回排版 HTML 路径 */
    runStyle(inputMdPath: string, theme?: '炬视' | '瑾智'): Promise<string>
    /** 按品牌风格生成公众号封面（横版 900×383 + 方版 500×500），返回两图路径 */
    generateCover(
      inputMdPath: string,
      theme: '炬视' | '瑾智'
    ): Promise<{ banner: string; square: string; title: string; theme: '炬视' | '瑾智' }>
  }
  update: {
    /** 对比 GitHub Releases 最新版本与当前版本 */
    appVersion(): Promise<string>
    check(): Promise<{
      hasUpdate: boolean
      current: string
      latest: string
      notes: string
      assetName: string | null
      assetUrl: string | null
      assetSize: number
      releaseUrl: string
      说明: string
    }>
    /** 人工确认后：下载安装包（进度走 onProgress）并自动拉起安装 */
    download(info: Awaited<ReturnType<CompanyOsApi['update']['check']>>): Promise<{ ok: boolean; path?: string; 说明: string }>
    onProgress(cb: (p: { pct: number; received: number; total: number }) => void): () => void
    /** 私有仓库用：是否已配置只读 GitHub Token / 保存（null=清除）。Token 只存本机配置 */
    getTokenSet(): Promise<boolean>
    setToken(token: string | null): Promise<void>
  }
  identity: {
    list(): Promise<TeamMember[]>
    /** 添加成员（管理员在设置页分配；初始 PIN 123456）。首个成员强制管理员 */
    add(name: string, role?: MemberRole, 可见分身?: AgentName[]): Promise<TeamMember>
    remove(id: string): Promise<void>
    verifyPin(id: string, pin?: string): Promise<boolean>
    resetAllMembers(): Promise<void>
    /** 首次登录同步后，强制按管理员花名册重建本机账号。 */
    syncRoster(): Promise<TeamMember[]>
    /** 成员自助改 PIN（先验旧 PIN；新 PIN 4-8 位数字） */
    changePin(id: string, oldPin: string, newPin: string): Promise<{ ok: boolean; message?: string }>
    /** 管理员重置成员 PIN 回 123456 */
    resetPin(id: string): Promise<void>
    /** 管理员设置员工可见分身（null=全部） */
    setAgents(id: string, agents: AgentName[] | null): Promise<void>
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
    /** 产品页专用：通过已授权的公司数据仓库同步产品清单、分类字典和图片。 */
    products(userName: string): Promise<SyncResult>
    /** 当前公司最近一次成功同步的时间戳 */
    lastAt(): Promise<number | null>
  }
  sales: {
    /** 读取产品库（会先自动合并 _待入库/ 里 agent 暂存的解析结果）；skipped=同名多供应商无法定位的更新条目数 */
    listProducts(): Promise<{ products: ProductEntry[]; ingested: number; skipped: number }>
    /** 读《产品分类规范》分类字典，供一级/二级分类下拉取值；字典文件缺失返回空数组 */
    listCategoryDict(): Promise<CategoryL1[]>
    /** 新增（不传 id）或整体更新（传 id）一条产品记录 */
    saveProduct(fields: ProductFields, id?: string): Promise<ProductEntry>
    removeProduct(id: string): Promise<void>
    /** 设置/替换产品图片（拷入 销售/产品库/图片库/，旧图自动清理） */
    setProductImage(id: string, sourcePath: string): Promise<ProductEntry>
    /** 供应商资料/投标报价文件上传到 销售/产品库/原始资料/，生成伴生提取文本，xlsx/csv 顺带做表头识别预览 */
    uploadSupplierDoc(sourcePath: string): Promise<SupplierDocPreview>
    /** 按表头识别结果把 xlsx/csv 机械导入产品库（不经过 AI） */
    importExcel(relativePath: string): Promise<{ added: number; updated: number; skipped: number; attachedImages?: number }>
    /** 把报价单产品的图片导出到 outputs 报价目录的 图片/ 子文件夹 */
    exportQuoteImages(productIds: string[], customerName: string): Promise<{ dir: string; exported: number; missing: string[] }>
    /** PDF 产品手册 → 供应商报价清单骨架：分身先提取 JSON（needExtract 时），App 机械填模板生成 xlsx */
    genPdfQuoteList(
      pdfFileName: string
    ): Promise<{ ok: boolean; needExtract: boolean; jsonRel: string; outPath?: string; 行数?: number; 说明: string }>
    /** 产品画册 PDF 阶段1 抽取：候选图+逐页文本+标注图，产出到 供应商资料/{名}_画册抽取/ */
    extractPdfCatalog(pdfFileName: string): Promise<{
      ok: boolean
      pages?: number
      crops?: number
      autoPaired?: number
      degraded?: boolean
      usedOcr?: boolean
      outDir?: string
      说明: string
    }>
    /** 产品画册 阶段2 定稿：按分身写的 _配对.json 出成品图 产品图片/序号_型号_产品名称_P页.jpg */
    /** 政采云上架数据包：选中产品 → 商品清单xlsx(含品目甄别打标) + 规范命名图片包 + 使用说明 */
    exportZcy(
      productIds: string[]
    ): Promise<{ ok: boolean; outDir?: string; count?: number; 管制数?: number; 缺图?: string[]; 说明: string }>
    /** 分身核对进度（读 _核对进度.json）；无进度文件返回 null */
    catalogProgress(pdfFileName: string): Promise<{ 已核对页: number; 总页: number } | null>
    applyCatalogPairing(pdfFileName: string): Promise<{
      ok: boolean
      notExtracted?: boolean
      needPairing?: boolean
      count?: number
      missing?: string[]
      outDir?: string
      说明: string
    }>
    /** 机械生成对外报价单 Excel（不经过 AI）：xlsx 模板填充或内置版式，登记报价台账并自动关联同名客户 */
    generateQuoteXlsx(
      lines: QuoteLineInput[],
      customerName: string,
      templateFileName: string | null,
      projectName: string
    ): Promise<QuoteXlsxResult>
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
    processInvoices(files: string[]): Promise<{
      ok: boolean
      成功: number
      重复: number
      失败: { 原文件: string; 原因: string }[]
      销项合计: number
      进项合计: number
      台账路径: string
      说明: string
    }>
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
