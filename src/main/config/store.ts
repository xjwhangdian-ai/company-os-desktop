import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppConfig, Company, ModelMapping, ProviderConfig, ProviderId, TeamMember } from '@shared/agent-types'

// 手写的极简本地 JSON 配置持久化，替代 electron-store：
// 1) electron-store v10 依赖的 conf v14 是纯 exports-map 包，在本项目
//    moduleResolution: "node" 下类型解析不出来，会连累 ElectronStore 的
//    .get/.set 类型丢失；2) 配置项字段不多，electron-store 的 schema
//    校验/迁移等能力用不上；3) electron-store 的 encryptionKey 本身也只是
//    混淆而非真加密，跟这里的方案安全强度相当，没必要为此扛一个类型不兼容的依赖。

/**
 * 各供应商默认值。DeepSeek/MiniMax/Qwen 官方文档确认三家都提供原生兼容
 * Anthropic Messages API 协议的端点（非 OpenAI 协议、不需要转换代理）。
 * model 名称能确认的（DeepSeek 文档明确写"claude-opus-* 等名称服务端自动
 * 重映射到 deepseek 自己的模型"）给了默认值；MiniMax/Qwen 的具体模型名 /
 * Qwen 的端点地址会随地区、套餐变化，查证时没能定下唯一确定值，留空
 * 用 UI 占位提示用户去查官方文档当前值，不编造一个可能过时的字符串。
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
    // DeepSeek 官方文档：claude-opus-* 系列名称服务端自动映射到 deepseek-v4-pro，
    // sonnet/haiku 映射到 deepseek-v4-flash——沿用 Anthropic 的模型名即可透传生效。
    modelMapping: {
      opus: 'claude-opus-4-8',
      sonnet: 'claude-sonnet-5',
      haiku: 'claude-haiku-4-5-20251001'
    }
  },
  'minimax-intl': {
    id: 'minimax-intl',
    label: 'MiniMax（国际版）',
    baseUrl: 'https://api.minimax.io/anthropic',
    authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
    apiKey: null,
    modelMapping: { opus: '', sonnet: '', haiku: '' }
  },
  'minimax-cn': {
    id: 'minimax-cn',
    label: 'MiniMax（中国版）',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
    apiKey: null,
    modelMapping: { opus: '', sonnet: '', haiku: '' }
  },
  qwen: {
    id: 'qwen',
    label: 'Qwen 通义千问',
    // 阿里云文档里这个端点地址会随地区/套餐变化，查证时没能定下一个稳定值，
    // 留空强制用户去 Model Studio 当前文档核实，不编造一个可能已经过期的 URL。
    baseUrl: '',
    authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
    apiKey: null,
    modelMapping: { opus: '', sonnet: '', haiku: '' }
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

/** PIN 只做"防止别人顺手冒充你"的轻量校验，不是真账号安全——纯本地 sha256，不加盐，跟这个威胁模型相称就够了 */
interface TeamMemberRecord {
  id: string
  name: string
  pinHash: string | null
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

const DEFAULTS: StoreSchemaV3 = {
  version: 3,
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

function readAll(): StoreSchemaV3 {
  const path = getConfigPath()
  if (!existsSync(path)) return structuredClone(DEFAULTS)
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'))
    if (isV1Schema(raw)) {
      const migrated = migrateV2ToV3(migrateV1ToV2(raw))
      writeAll(migrated)
      return migrated
    }
    if (isV2Schema(raw)) {
      const migrated = migrateV2ToV3(raw)
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

function writeAll(data: StoreSchemaV3): void {
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

function toPublicMember(m: TeamMemberRecord): TeamMember {
  return { id: m.id, name: m.name, hasPin: m.pinHash !== null }
}

export function listTeamMembers(): TeamMember[] {
  return readAll().teamMembers.map(toPublicMember)
}

export function addTeamMember(name: string, pin?: string): TeamMember {
  const record: TeamMemberRecord = { id: randomUUID(), name, pinHash: pin ? hashPin(pin) : null }
  const all = readAll()
  writeAll({ ...all, teamMembers: [...all.teamMembers, record] })
  return toPublicMember(record)
}

export function removeTeamMember(id: string): void {
  const all = readAll()
  writeAll({ ...all, teamMembers: all.teamMembers.filter((m) => m.id !== id) })
}

/** 无 PIN 的成员：任何 pin 参数（含 undefined）都直接放行 */
export function verifyPin(id: string, pin: string | undefined): boolean {
  const member = readAll().teamMembers.find((m) => m.id === id)
  if (!member) return false
  if (!member.pinHash) return true
  return Boolean(pin) && hashPin(pin as string) === member.pinHash
}
