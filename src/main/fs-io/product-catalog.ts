import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SyncResult } from '@shared/agent-types'

/**
 * 产品库分发通道与公司工作资料仓库分离：产品清单不进安装包，员工端也无需访问私有仓库。
 * 公开目录由下方严格字段白名单生成；采购侧信息、原始资料及本地图片路径绝不出现在发布源。
 */
const CATALOG_REPO = 'xjwhangdian-ai/company-os-desktop'
const CATALOG_DIR = 'product-catalog'
const API_BASE = `https://api.github.com/repos/${CATALOG_REPO}/contents/${CATALOG_DIR}`
const RAW_BASE = `https://raw.githubusercontent.com/${CATALOG_REPO}/main/${CATALOG_DIR}`
const USER_AGENT = 'company-os-desktop-product-catalog'
const MAX_PART_BYTES = 700 * 1024
const PRODUCT_DB_REL = join('销售', '产品库', '产品库.json')
const CATEGORY_DICT_REL = join('销售', '产品库', '分类字典.json')

interface ProductDb {
  version: number
  products: Record<string, unknown>[]
}

interface CatalogManifest {
  version: 1
  publishedAt: number
  productCount: number
  parts: string[]
  分类字典: Record<string, unknown> | null
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8')
  renameSync(tmp, path)
}

/** 对外发布的唯一字段清单。任何未列字段（成本/供应商/联系人/来源/图片路径等）均不会写出。 */
const PUBLIC_PRODUCT_FIELDS = [
  'id',
  '产品名称',
  '一级分类',
  '二级分类',
  '产品分类',
  '品牌',
  '型号',
  '瑾智型号',
  '生产制造商',
  '产地',
  '技术参数',
  '单位',
  '税率',
  '质保期',
  '交货期',
  '物料代码',
  '建议销售价',
  '投标报价',
  '备注',
  '更新时间'
] as const

function toPublicProduct(source: Record<string, unknown>): Record<string, unknown> {
  const product: Record<string, unknown> = {}
  for (const key of PUBLIC_PRODUCT_FIELDS) {
    const value = source[key]
    product[key] = typeof value === 'string' || typeof value === 'number' ? value : ''
  }
  // 本地数据层需要该字段存在；明确置空，绝不传成本。
  product.成本价 = ''
  product.供应商名称 = ''
  product.供应商联系人 = ''
  product.供应商联系方式 = ''
  product.来源文件 = ''
  product.图片 = ''
  return product
}

function splitProducts(products: Record<string, unknown>[]): { name: string; body: string }[] {
  const parts: Record<string, unknown>[][] = []
  let current: Record<string, unknown>[] = []
  for (const product of products) {
    const candidate = [...current, product]
    const bytes = Buffer.byteLength(JSON.stringify({ version: 1, products: candidate }), 'utf8')
    if (current.length > 0 && bytes > MAX_PART_BYTES) {
      parts.push(current)
      current = [product]
    } else {
      current = candidate
    }
  }
  if (current.length > 0 || parts.length === 0) parts.push(current)
  return parts.map((part, index) => ({
    name: `products-${String(index + 1).padStart(3, '0')}.json`,
    body: JSON.stringify({ version: 1, products: part })
  }))
}

function headers(token?: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }
}

async function readRemoteSha(fileName: string, token: string): Promise<string | null> {
  const response = await fetch(`${API_BASE}/${encodeURIComponent(fileName)}`, { headers: headers(token) })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`)
  const data = (await response.json()) as { sha?: unknown }
  return typeof data.sha === 'string' ? data.sha : null
}

async function putRemoteFile(fileName: string, body: string, token: string, message: string): Promise<void> {
  const sha = await readRemoteSha(fileName, token)
  const response = await fetch(`${API_BASE}/${encodeURIComponent(fileName)}`, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: Buffer.from(body, 'utf8').toString('base64'), ...(sha ? { sha } : {}) })
  })
  if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`)
}

/** 管理员主动发布私有库的脱敏副本；分片先传、清单最后切换，客户端下载不会读到半截数据。 */
export async function publishProductCatalog(dataDir: string, token: string | null): Promise<{ ok: boolean; message: string }> {
  if (!token) return { ok: false, message: '请先在「设置 → 产品库发布」配置 GitHub 发布令牌（只保存在本机）' }
  const db = readJson<ProductDb>(join(dataDir, PRODUCT_DB_REL), { version: 3, products: [] })
  const products = Array.isArray(db.products)
    ? db.products.filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object').map(toPublicProduct)
    : []
  const 分类字典 = readJson<Record<string, unknown> | null>(join(dataDir, CATEGORY_DICT_REL), null)
  const chunks = splitProducts(products)
  try {
    for (const chunk of chunks) await putRemoteFile(chunk.name, chunk.body, token, `产品库发布：更新 ${chunk.name}`)
    const manifest: CatalogManifest = {
      version: 1,
      publishedAt: Date.now(),
      productCount: products.length,
      parts: chunks.map((chunk) => chunk.name),
      分类字典
    }
    await putRemoteFile('manifest.json', JSON.stringify(manifest), token, `产品库发布：${products.length} 条`)
    return { ok: true, message: `已发布 ${products.length} 条产品；成员点击「同步数据」即可获取最新版（采购侧字段未发布）` }
  } catch (err) {
    return { ok: false, message: `发布产品库失败：${err instanceof Error ? err.message : String(err)}` }
  }
}

async function fetchPublicJson<T>(fileName: string): Promise<T> {
  const response = await fetch(`${RAW_BASE}/${encodeURIComponent(fileName)}`, { headers: { 'User-Agent': USER_AGENT } })
  if (response.status === 404) throw new Error('产品库尚未发布，请在维护产品库的电脑点击「发布产品库」')
  if (!response.ok) throw new Error(`产品库下载失败（GitHub 返回 ${response.status}）`)
  return (await response.json()) as T
}

/** 成员/新装电脑只下载公开销售目录：不依赖本机 Git 仓库，也不需要 GitHub 登录。 */
export async function syncPublishedProductCatalog(dataDir: string): Promise<SyncResult> {
  try {
    const manifest = await fetchPublicJson<CatalogManifest>('manifest.json')
    if (manifest.version !== 1 || !Array.isArray(manifest.parts) || manifest.parts.some((part) => typeof part !== 'string')) {
      return { ok: false, message: '产品库发布文件格式无效，请在管理员电脑重新发布' }
    }
    const chunks = await Promise.all(manifest.parts.map((part) => fetchPublicJson<{ products?: unknown }>(part)))
    const products = chunks.flatMap((chunk) =>
      Array.isArray(chunk.products) ? chunk.products.filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object') : []
    )
    if (products.length !== manifest.productCount) return { ok: false, message: '产品库下载不完整，请稍后重试' }
    writeJsonAtomic(join(dataDir, PRODUCT_DB_REL), { version: 3, products })
    if (manifest.分类字典 && typeof manifest.分类字典 === 'object') writeJsonAtomic(join(dataDir, CATEGORY_DICT_REL), manifest.分类字典)
    return { ok: true, committed: false, message: `已同步产品库：${products.length} 条（不含成本及供应商联系方式）` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
