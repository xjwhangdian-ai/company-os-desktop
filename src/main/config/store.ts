import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentName, AppConfig, Company, MemberRole, ModelMapping, ProviderConfig, ProviderId, TeamMember } from '@shared/agent-types'

// 手写的极简本地 JSON 配置持久化，替代 electron-store：
// 1) electron-store v10 依赖的 conf v14 是纯 exports-map 包，在本项目
//    moduleResolution: "node" 下类型解析不出来，会连累 ElectronStore 的
//    .get/.set 类型丢失；2) 配置项字段不多，electron-store 的 schema
//    校验/迁移等能力用不上；3) electron-store 的 encryptionKey 本身也只是
//    混淆而非真加密，跟这里的方案安全强度相当，没必要为此扛一个类型不兼容的依赖。

/**
 * 各供应商默认值。DeepSeek/MiniMax/Qwen 官方文档确认三家都提供原生兼容
 * Anthropic Messages API 协议的端点（非 OpenAI 协议、不需要转换代理）。
 * 下面的具体模型名是 2026-07-03 对三家官方文档做实时核查后的结果（两轮独立
 * 调研互相印证），但这几家模型迭代很快，本身就不该假设"设一次以后不用管"——
 * 这也是把它做成用户可编辑设置项而不是硬编码进 .claude/agents/*.md 的原因。
 */
const DEFAULT_PROVIDERS: Record<ProviderId, ProviderConfig> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic 官方',
    baseUrl: null,
    authEnvVar: 'ANTHROPIC_API_KEY',
    apiKey: null,
    modelMapping: {
      opus: 'claude-opus-4-8',
      sonnet: 'claude-sonnet-5',
      haiku: 'claude-haiku-4-5-20251001'
    }
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
    apiKey: null,
    // DeepSeek 目前只有两档（Pro/Flash，没有第三档），官方 Anthropic 接入文档明确列出
    // 这两个模型名可以直接用；sonnet 和 haiku 都对应 flash（反正服务端把两者都映射到
    // flash，直接写清楚更透明，不依赖 claude-opus-* 这种别名自动重映射的隐式行为）。
    // 注意：deepseek-chat / deepseek-reasoner 这两个旧别名将在 2026-07-24 停用，不要用。
    modelMapping: {
      opus: 'deepseek-v4-pro',
      sonnet: 'deepseek-v4-flash',
      haiku: 'deepseek-v4-flash'
    }
  },
  'minimax-intl': {
    id: 'minimax-intl',
    label: 'MiniMax（国际版）',
    baseUrl: 'https://api.minimax.io/anthropic',
    authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
    apiKey: null,
    // M3 是最新旗舰（原生多模态，支持看图/视频，适合 brand 这类需要理解素材的场景）；
    // M2.7 是主力档（纯文本+工具调用，性价比最好）；M2 是最便宜档。
    modelMapping: { opus: 'MiniMax-M3', sonnet: 'MiniMax-M2.7', haiku: 'MiniMax-M2' }
  },
  'minimax-cn': {
    id: 'minimax-cn',
    label: 'MiniMax（中国版）',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
    apiKey: null,
    modelMapping: { opus: 'MiniMax-M3', sonnet: 'MiniMax-M2.7', haiku: 'MiniMax-M2' }
  },
  qwen: {
    id: 'qwen',
    label: 'Qwen 通义千问',
    // 阿里云这个端点地址按地区/套餐分裂成好几种（国内/国际/美区 PAYG、按 WorkspaceId
    // 分的专属节点、Coding Plan/Token Plan 各自的域名），没有唯一默认值，留空强制用户
    // 对着自己开通的那个套餐去查——设置页会给出这几种常见形态供参照，不要瞎填。
    baseUrl: '',
    authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
    apiKey: null,
    // qwen3.7-max 是当前旗舰（2026-05 上线，取代了 qwen3.5/qwen3.6 那一代）；
    // qwen3.7-plus 是官方 Claude Code 接入示例里日常用的主力档；qwen3.6-flash 是最便宜档。
    modelMapping: { opus: 'qwen3.7-max', sonnet: 'qwen3.7-plus', haiku: 'qwen3.6-flash' }
  },
  zhipu: {
    id: 'zhipu',
    label: '智谱 GLM',
    // 智谱官方提供 Anthropic 协议兼容端点（GLM 接入 Claude Code 的官方方式）
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
    apiKey: null,
    // 按智谱官方 Claude Code 接入文档的对应关系预填（glm-4.5 旗舰 / glm-4.5-air 轻量）；
    // 智谱迭代快，若有更新一代模型（如 glm-5 系列），在设置页对着官方文档改即可。
    modelMapping: { opus: 'glm-4.5', sonnet: 'glm-4.5', haiku: 'glm-4.5-air' }
  },
  custom: {
    id: 'custom',
    label: '自定义（如自建 claude-code-router）',
    baseUrl: '',
    authEnvVar: 'ANTHROPIC_API_KEY',
    apiKey: null,
    modelMapping: { opus: '', sonnet: '', haiku: '' }
  }
}

/** PIN 只做"防止别人顺手冒充你"的轻量校验，不是真账号安全——纯本地 sha256，不加盐，跟这个威胁模型相称就够了。
 *  role 同理是界面级权限（管理员/普通员工），不是安全边界。 */
interface TeamMemberRecord {
  id: string
  name: string
  pinHash: string | null
  role?: MemberRole
  /** 员工可见分身；undefined=全部 */
  可见分身?: AgentName[]
}

interface StoreSchemaV4 {
  version: 4
  companies: Company[]
  activeCompanyId: string | null
  activeProviderId: ProviderId
  providers: Record<ProviderId, ProviderConfig>
  teamMembers: TeamMemberRecord[]
  /** 每公司最近一次成功同步的时间戳（驱动每日开/关同步提示）；老配置没有此字段 */
  lastSyncAt?: Record<string, number>
}

interface StoreSchemaV3 {
  version: 3
  companies: Company[]
  activeCompanyId: string | null
  activeProviderId: ProviderId
  providers: Record<ProviderId, ProviderConfig>
  teamMembers: TeamMemberRecord[]
}

interface StoreSchemaV2 {
  version: 2
  dataDir: string | null
  activeProviderId: ProviderId
  providers: Record<ProviderId, ProviderConfig>
  teamMembers: TeamMemberRecord[]
}

/** 旧版单供应商配置形状（切换供应商功能上线前），仅用于一次性迁移 */
interface StoreSchemaV1 {
  dataDir: string | null
  apiKey: string | null
  modelMapping: ModelMapping
}

function isV1Schema(data: unknown): data is StoreSchemaV1 {
  return Boolean(data) && typeof data === 'object' && !('version' in (data as object)) && 'apiKey' in (data as object)
}

function isV2Schema(data: unknown): data is StoreSchemaV2 {
  return Boolean(data) && typeof data === 'object' && (data as { version?: number }).version === 2
}

function isV3Schema(data: unknown): data is StoreSchemaV3 {
  return Boolean(data) && typeof data === 'object' && (data as { version?: number }).version === 3
}

function migrateV1ToV2(v1: StoreSchemaV1): StoreSchemaV2 {
  const providers = structuredClone(DEFAULT_PROVIDERS)
  providers.anthropic.apiKey = v1.apiKey
  if (v1.modelMapping) providers.anthropic.modelMapping = v1.modelMapping
  return {
    version: 2,
    dataDir: v1.dataDir,
    activeProviderId: 'anthropic',
    providers,
    teamMembers: []
  }
}

/**
 * 多公司支持上线时的一次性迁移：原来单个 dataDir 变成"公司列表，每家公司一个 dataDir"。
 * 老配置里已经指向的那个目录（炬视科技）保留为第一家公司；用户明确提过的第二家公司
 * （台州瑾智安防）预置一个空壳条目（dataDir: null），省得用户自己手动新建——但不猜它的
 * 数据目录在哪，等用户自己在设置页选。供应商/团队成员配置保持全局，不按公司拆分。
 */
function migrateV2ToV3(v2: StoreSchemaV2): StoreSchemaV3 {
  const jushiId = randomUUID()
  const jinzhiId = randomUUID()
  return {
    version: 3,
    companies: [
      { id: jushiId, name: '台州炬视科技', dataDir: v2.dataDir },
      { id: jinzhiId, name: '台州瑾智安防', dataDir: null }
    ],
    activeCompanyId: jushiId,
    activeProviderId: v2.activeProviderId,
    providers: v2.providers,
    teamMembers: v2.teamMembers
  }
}

/**
 * 一次性刷新非 Anthropic 供应商的默认模型名（2026-07-03 两轮独立联网调研核实过的结果）。
 * 只覆盖 modelMapping，用户已经填的 apiKey/baseUrl 不动——如果用户已经手动改过模型映射，
 * 这次刷新会覆盖掉那次手改，但考虑到这几个供应商是这次调研之前才刚支持、字段基本都是
 * 空的默认值，直接刷新成最新推荐值比"假装用户可能手改过"更符合实际情况，改错了在设置页
 * 改回来也就一分钟的事。
 */
function migrateV3ToV4(v3: StoreSchemaV3): StoreSchemaV4 {
  const REFRESH_IDS: ProviderId[] = ['deepseek', 'minimax-intl', 'minimax-cn', 'qwen']
  const providers = { ...v3.providers }
  for (const id of REFRESH_IDS) {
    providers[id] = { ...providers[id], modelMapping: DEFAULT_PROVIDERS[id].modelMapping }
  }
  return { ...v3, version: 4, providers }
}

const DEFAULTS: StoreSchemaV4 = {
  version: 4,
  companies: [],
  activeCompanyId: null,
  activeProviderId: 'anthropic',
  providers: DEFAULT_PROVIDERS,
  teamMembers: []
}

function getConfigPath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'company-os-desktop-config.json')
}

function readAll(): StoreSchemaV4 {
  const path = getConfigPath()
  if (!existsSync(path)) return structuredClone(DEFAULTS)
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'))
    if (isV1Schema(raw)) {
      const migrated = migrateV3ToV4(migrateV2ToV3(migrateV1ToV2(raw)))
      writeAll(migrated)
      return migrated
    }
    if (isV2Schema(raw)) {
      const migrated = migrateV3ToV4(migrateV2ToV3(raw))
      writeAll(migrated)
      return migrated
    }
    if (isV3Schema(raw)) {
      const migrated = migrateV3ToV4(raw)
      writeAll(migrated)
      return migrated
    }
    // 补全新增供应商预设（用户配置文件可能是旧版本 app 写入的，缺新供应商的默认槽位）
    const providers = { ...structuredClone(DEFAULT_PROVIDERS), ...raw.providers }
    return { ...structuredClone(DEFAULTS), ...raw, providers }
  } catch {
    return structuredClone(DEFAULTS)
  }
}

function writeAll(data: StoreSchemaV4): void {
  writeFileSync(getConfigPath(), JSON.stringify(data, null, 2), 'utf-8')
}

export function getConfig(): AppConfig {
  const { companies, activeCompanyId, activeProviderId, providers } = readAll()
  return { companies, activeCompanyId, activeProviderId, providers }
}

export function listCompanies(): Company[] {
  return readAll().companies
}

export function addCompany(name: string): Company {
  const company: Company = { id: randomUUID(), name, dataDir: null }
  const all = readAll()
  writeAll({ ...all, companies: [...all.companies, company] })
  return company
}

export function removeCompany(id: string): void {
  const all = readAll()
  const companies = all.companies.filter((c) => c.id !== id)
  const activeCompanyId = all.activeCompanyId === id ? (companies[0]?.id ?? null) : all.activeCompanyId
  writeAll({ ...all, companies, activeCompanyId })
}

export function setCompanyDataDir(id: string, dir: string | null): void {
  const all = readAll()
  writeAll({ ...all, companies: all.companies.map((c) => (c.id === id ? { ...c, dataDir: dir } : c)) })
}

export function setActiveCompany(id: string): void {
  writeAll({ ...readAll(), activeCompanyId: id })
}

export function getActiveCompany(): Company | null {
  const { activeCompanyId, companies } = readAll()
  return companies.find((c) => c.id === activeCompanyId) ?? null
}

export function setActiveProvider(id: ProviderId): void {
  writeAll({ ...readAll(), activeProviderId: id })
}

export function setProviderConfig(id: ProviderId, patch: Partial<Omit<ProviderConfig, 'id'>>): void {
  const all = readAll()
  const current = all.providers[id]
  writeAll({ ...all, providers: { ...all.providers, [id]: { ...current, ...patch } } })
}

export function getDataDir(): string {
  const company = getActiveCompany()
  if (!company) {
    throw new Error('尚未选择公司，请先在登录页选择公司')
  }
  if (!company.dataDir) {
    throw new Error(`「${company.name}」还没配置数据目录，请先在设置页选择它的 company-os 数据目录`)
  }
  return company.dataDir
}

export function getActiveProvider(): ProviderConfig {
  const { activeProviderId, providers } = readAll()
  return providers[activeProviderId]
}

function hashPin(pin: string): string {
  return createHash('sha256').update(pin).digest('hex')
}

/** 管理员分配账号的初始 PIN；员工首次登录会被提示修改 */
const DEFAULT_PIN = '123456'
const DEFAULT_PIN_HASH = createHash('sha256').update(DEFAULT_PIN).digest('hex')

/** 老配置里的成员没有 role 字段：一律视为管理员（现存成员都是装机人自己建的；界面级权限，从宽迁移） */
function roleOf(m: TeamMemberRecord): MemberRole {
  return m.role ?? 'admin'
}

function toPublicMember(m: TeamMemberRecord): TeamMember {
  return {
    id: m.id,
    name: m.name,
    hasPin: m.pinHash !== null,
    role: roleOf(m),
    usingDefaultPin: m.pinHash === DEFAULT_PIN_HASH,
    可见分身: m.可见分身
  }
}

export function listTeamMembers(): TeamMember[] {
  return readAll().teamMembers.map(toPublicMember)
}

/**
 * 添加成员（账号由管理员在设置页统一分配；登录页仅在"零成员"时允许创建首个管理员）。
 * 初始 PIN 固定 123456，成员首次登录会被提示修改。第一个成员强制管理员。
 */
export function addTeamMember(name: string, role?: MemberRole, 可见分身?: AgentName[]): TeamMember {
  const all = readAll()
  const finalRole: MemberRole = all.teamMembers.length === 0 ? 'admin' : (role ?? 'member')
  const record: TeamMemberRecord = {
    id: randomUUID(),
    name,
    pinHash: DEFAULT_PIN_HASH,
    role: finalRole,
    可见分身: finalRole === 'member' ? 可见分身 : undefined
  }
  writeAll({ ...all, teamMembers: [...all.teamMembers, record] })
  return toPublicMember(record)
}

/** 成员自助改 PIN：先验旧 PIN */
export function changePin(id: string, oldPin: string, newPin: string): { ok: boolean; message?: string } {
  const all = readAll()
  const member = all.teamMembers.find((m) => m.id === id)
  if (!member) return { ok: false, message: '成员不存在' }
  if (member.pinHash && hashPin(oldPin) !== member.pinHash) return { ok: false, message: '原 PIN 不正确' }
  if (!/^\d{4,8}$/.test(newPin)) return { ok: false, message: '新 PIN 需为 4-8 位数字' }
  member.pinHash = hashPin(newPin)
  writeAll(all)
  return { ok: true }
}

/** 管理员重置某成员 PIN 回初始值 123456 */
export function resetPin(id: string): void {
  const all = readAll()
  const member = all.teamMembers.find((m) => m.id === id)
  if (!member) return
  member.pinHash = DEFAULT_PIN_HASH
  writeAll(all)
}

/** 管理员设置员工可见分身（null=全部可见）；管理员角色忽略此配置 */
export function setMemberAgents(id: string, agents: AgentName[] | null): void {
  const all = readAll()
  const member = all.teamMembers.find((m) => m.id === id)
  if (!member) return
  member.可见分身 = agents ?? undefined
  writeAll(all)
}

export function removeTeamMember(id: string): void {
  const all = readAll()
  writeAll({ ...all, teamMembers: all.teamMembers.filter((m) => m.id !== id) })
}

/** 改角色時兜底：不允许把最后一个管理员降级，防止把自己锁在设置页外面 */
export function setMemberRole(id: string, role: MemberRole): { ok: boolean; message?: string } {
  const all = readAll()
  const target = all.teamMembers.find((m) => m.id === id)
  if (!target) return { ok: false, message: '成员不存在' }
  if (role === 'member') {
    const adminCount = all.teamMembers.filter((m) => roleOf(m) === 'admin').length
    if (roleOf(target) === 'admin' && adminCount <= 1) {
      return { ok: false, message: '至少要保留一名管理员' }
    }
  }
  target.role = role
  writeAll(all)
  return { ok: true }
}

/** 无 PIN 的成员：任何 pin 参数（含 undefined）都直接放行 */
export function verifyPin(id: string, pin: string | undefined): boolean {
  const member = readAll().teamMembers.find((m) => m.id === id)
  if (!member) return false
  if (!member.pinHash) return true
  return Boolean(pin) && hashPin(pin as string) === member.pinHash
}

// ============ 每公司的最近同步时间（驱动"每日开/关同步提示"） ============

export function getLastSyncAt(companyId: string): number | null {
  return readAll().lastSyncAt?.[companyId] ?? null
}

export function setLastSyncAt(companyId: string): void {
  const all = readAll()
  writeAll({ ...all, lastSyncAt: { ...(all.lastSyncAt ?? {}), [companyId]: Date.now() } })
}
