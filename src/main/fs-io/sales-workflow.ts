import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  CategoryL1,
  CustomerEntry,
  CustomerFields,
  LinkedFile,
  ProductEntry,
  ProductFields,
  QuotationTemplate,
  QuoteLineInput,
  QuoteXlsxResult
} from '@shared/agent-types'
import { generateQuoteXlsx, type QuoteRow } from '../docgen/quote-xlsx'
import type { CellValue } from 'exceljs'
import { detectHeaders, readWorkbookRows, readWorkbookRowImages } from './doc-extract'

// ============ 销售工作台的数据层 ============
// 统一 inbox/outputs 约定后，供应商资料原件在输入侧 inbox/01_销售_sales/供应商资料/（见 upload-router），
// 报价成品在 outputs/01_销售_sales/{日期_客户_报价}/；本模块只管跨项目复用的"库"：
//   销售/产品库/产品库.json      ← 产品库规范数据，App 托管（分身禁止直接写，见 path-guard）
//   销售/产品库/_待入库/         ← 分身解析产出的暂存 JSON，App 校验合并后归档到 已合并/
//   销售/产品库/图片库/          ← 产品图片，文件名由 App 生成并关联到产品记录
//   销售/_模板/报价模板/         ← 报价文件模板
//   销售/客户库.json             ← CRM 客户数据，App 托管
// 设计原则同 bidding/legal：AI 只做语义提取（写暂存文件），规范库的合并/去重/落盘由 App 机械完成。
//
// 为什么产品库是"一个 JSON"而不是按供应商拆多个文件：查询/去重都是跨供应商的（同一产品
// 多家供货要合并对比），单文件一次读取全量过滤最简单；量级是公司采购目录（几百到几千条），
// 单文件毫秒级；Google Drive 双机同步下文件越少冲突面越小；"多个供应商资料库"的原始形态
// 已经完整保留在 inbox/01_销售_sales/供应商资料/ 里，产品库.json 只是合并后的索引。
const PRODUCT_DB_REL = join('销售', '产品库', '产品库.json')
const CUSTOMER_DB_REL = join('销售', '客户库.json')
const STAGING_DIR_REL = join('销售', '产品库', '_待入库')
const STAGING_DONE_REL = join('销售', '产品库', '_待入库', '已合并')
const IMAGE_DIR_REL = join('销售', '产品库', '图片库')
const TEMPLATE_DIR_REL = join('销售', '_模板', '报价模板')
/** 产品分类规范：一级/二级固定枚举的唯一来源（人工维护，App 只读） */
const CATEGORY_DICT_REL = join('销售', '产品库', '分类字典.json')

interface ProductDb {
  version: number
  products: ProductEntry[]
}

interface CustomerDb {
  version: number
  customers: CustomerEntry[]
}

export function ensureSalesDirs(dataDir: string): void {
  for (const rel of [STAGING_DONE_REL, IMAGE_DIR_REL, TEMPLATE_DIR_REL]) {
    mkdirSync(join(dataDir, rel), { recursive: true })
  }
  const readmePath = join(dataDir, '销售', 'README.md')
  if (!existsSync(readmePath)) {
    writeFileSync(
      readmePath,
      `# 销售工作区（库）

由 company-os-desktop 的销售工作台管理。本目录只放跨项目复用的"库"：

- \`产品库/产品库.json\` — 产品信息库（App 托管，请通过桌面 App 增删改，不要手改也不要让分身直接写）
- \`产品库/_待入库/\` — sales 分身解析产出的暂存 JSON，App 校验合并进产品库后移入 已合并/
- \`产品库/图片库/\` — 产品图片（App 托管，与产品记录关联）
- \`_模板/报价模板/\` — 对外报价文件模板
- \`客户库.json\` — CRM 客户与跟进记录（App 托管）

输入与产出走统一约定：供应商资料/投标报价原件在 \`inbox/01_销售_sales/供应商资料/\`；报价成品在 \`outputs/01_销售_sales/{日期_客户_报价}/\`。

红线：产品库里的供应商联系人/联系方式/成本价是采购侧信息，**严禁出现在对外报价文件**里。
`,
      'utf-8'
    )
  }
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try {
    return { ...fallback, ...JSON.parse(readFileSync(path, 'utf-8')) }
  } catch {
    return fallback
  }
}

/** 先写临时文件再 rename，避免写一半时被 Google Drive 同步拽走出现半截 JSON */
function writeJsonAtomic(path: string, data: unknown): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, path)
}

const PRODUCT_FIELD_KEYS: (keyof ProductFields)[] = [
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
  '成本价',
  '建议销售价',
  '投标报价',
  '供应商名称',
  '供应商联系人',
  '供应商联系方式',
  '图片',
  '备注',
  '来源文件'
]

/** v3 新增的贸易型字段（对齐对外报价单列结构），老库就地迁移补空串 */
const V3_NEW_KEYS = ['品牌', '型号', '生产制造商', '产地', '单位', '税率', '质保期', '物料代码'] as const
/** v3.1 追加：我方自编型号与交货期（对外报价关键项），老库同样补空串 */
const V3_1_NEW_KEYS = ['瑾智型号', '交货期'] as const
/** v3.2 追加：按《产品分类规范》把分类拆成一级/二级（固定枚举）+ 产品分类（三级细分） */
const V3_2_NEW_KEYS = ['一级分类', '二级分类'] as const

/**
 * v1（单价字段）→ v2（三档价格）→ v3（品牌/型号/制造商等贸易字段）→ v3.2（分类三级拆分）就地迁移。
 * v3.2 迁移顺带把老库里写成路径的分类（"视频监控与智能感知/摄像机与云台/云台"，旧 UI 用 / 分隔
 * 表示层级）按位拆到一级/二级/三级，不丢原有的分类导航结构。
 */
function readProductDb(dataDir: string): ProductDb {
  const path = join(dataDir, PRODUCT_DB_REL)
  const db = readJson<ProductDb>(path, { version: 3, products: [] })
  let changed = false
  for (const p of db.products as unknown as Record<string, string>[]) {
    if ('单价' in p) {
      if (!p.成本价) p.成本价 = p.单价
      delete p.单价
      changed = true
    }
    const 缺分类字段 = p.一级分类 === undefined && p.二级分类 === undefined
    for (const k of [
      '产品分类',
      '成本价',
      '建议销售价',
      '投标报价',
      ...V3_NEW_KEYS,
      ...V3_1_NEW_KEYS,
      ...V3_2_NEW_KEYS
    ] as const) {
      if (p[k] === undefined) {
        p[k] = ''
        changed = true
      }
    }
    if (缺分类字段 && p.产品分类) {
      const parts = p.产品分类
        .split(/[/＞>]/)
        .map((t) => t.trim())
        .filter(Boolean)
      if (parts.length > 1) {
        p.一级分类 = parts[0]
        p.二级分类 = parts[1] ?? ''
        p.产品分类 = parts.slice(2).join('/')
        changed = true
      }
    }
    // 既有库里留下的未分类产品也按当前分类字典补齐一、二级，避免升级后历史清单仍全是“—”。
    const inferred = autoFillCategory(dataDir, p as unknown as ProductFields) as unknown as Record<string, string>
    for (const key of ['一级分类', '二级分类', '产品分类'] as const) {
      if (inferred[key] !== p[key]) {
        p[key] = inferred[key]
        changed = true
      }
    }
  }
  if (db.version !== 3) {
    db.version = 3
    changed = true
  }
  // 迁移补出来的字段会追加在 JSON 对象末尾（一级分类排到了备注后面）。
  // 产品库.json 是人会直接打开看的文件，键序乱了就按 PRODUCT_FIELD_KEYS 的口径重排一次。
  const ordered = db.products.map(orderKeys)
  if (ordered.some((p, i) => Object.keys(p).join() !== Object.keys(db.products[i]).join())) {
    db.products = ordered
    changed = true
  }
  if (changed && existsSync(path)) writeJsonAtomic(path, db)
  return db
}

/** 按 PRODUCT_FIELD_KEYS 规定的顺序重建一条记录（id 在前、更新时间在后） */
function orderKeys(p: ProductEntry): ProductEntry {
  const src = p as unknown as Record<string, unknown>
  const out: Record<string, unknown> = { id: p.id }
  for (const k of PRODUCT_FIELD_KEYS) out[k] = src[k] ?? ''
  for (const k of Object.keys(src)) {
    if (k !== 'id' && k !== '更新时间' && !(k in out)) out[k] = src[k]
  }
  out.更新时间 = p.更新时间
  return out as unknown as ProductEntry
}

function writeProductDb(dataDir: string, db: ProductDb): void {
  ensureSalesDirs(dataDir)
  writeJsonAtomic(join(dataDir, PRODUCT_DB_REL), db)
}

// 报价模板里的“说明/落款/示例行”常被误当产品导入（尤其走 AI 解析时）。
// 这些行的“产品名称”有明显特征——在唯一入库口 sanitizeFields 一并挡掉，机械/AI 两条路都生效。
const NON_PRODUCT_NAME =
  /^\d+\s*[、.]|填写说明|价格口径|加盖公章|采购单位|采购对接人|采购部|致各位供应商|供应商报价清单|报价说明|^日期\s*[:：]|^序号$|^合\s*计|^【?示例/
/** 示例行的备注通常写“示例行，正式填写时删除”；据此额外拦一道 */
const isExampleRow = (备注: string): boolean => /示例行|正式(填写|报价)时删除/.test(备注)

function sanitizeFields(raw: Record<string, unknown>): ProductFields | null {
  const fields = {} as Record<string, string>
  for (const key of PRODUCT_FIELD_KEYS) {
    const v = raw[key]
    fields[key] = typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim()
  }
  const name = fields['产品名称']
  if (!name) return null
  if (NON_PRODUCT_NAME.test(name) || isExampleRow(fields['备注'] ?? '')) return null
  return fields as unknown as ProductFields
}

/**
 * 供应商资料常常没有按我方规范填写分类。这里仅按《产品分类规范》的二级/三级名称做可解释的
 * 关键字匹配：唯一命中才自动补齐一级、二级，多个候选则宁可留给人工确认，绝不硬归类。
 */
function autoFillCategory(dataDir: string, fields: ProductFields): ProductFields {
  if (fields.一级分类 && fields.二级分类) return fields
  const dict = listCategoryDict(dataDir)
  if (dict.length === 0) return fields
  const text = [fields.产品名称, fields.产品分类, fields.技术参数, fields.品牌, fields.型号].join(' ').toLowerCase()
  if (!text.trim()) return fields

  const candidates: { l1: CategoryL1; l2: CategoryL1['二级'][number]; score: number; l3?: string }[] = []
  for (const l1 of dict) {
    if (fields.一级分类 && fields.一级分类 !== l1.名称) continue
    for (const l2 of l1.二级) {
      if (fields.二级分类 && fields.二级分类 !== l2.名称) continue
      let score = text.includes(l2.名称.toLowerCase()) ? 80 : 0
      // 二级名里的并列功能词（如「摄像机与云台」）也是稳定的归类线索；
      // 这样「热成像双光谱 MINI 云台」即使没写完整品类，也能落到 E1。
      for (const term of l2.名称.split(/[与和、及]/).map((s) => s.trim()).filter((s) => s.length >= 2)) {
        if (text.includes(term.toLowerCase())) score = Math.max(score, 70 + term.length)
      }
      let matchedL3: string | undefined
      for (const l3 of l2.三级) {
        const term = l3.trim().toLowerCase()
        if (term.length >= 2 && text.includes(term) && term.length + 100 > score) {
          score = term.length + 100
          matchedL3 = l3
        }
      }
      if (score > 0) candidates.push({ l1, l2, score, l3: matchedL3 })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  // 同分不同二级说明语义不够明确，例如“手持设备”，不自动选择。
  if (!best || candidates.filter((c) => c.score === best.score && c.l2.名称 !== best.l2.名称).length > 0) return fields
  return {
    ...fields,
    一级分类: fields.一级分类 || best.l1.名称,
    二级分类: fields.二级分类 || best.l2.名称,
    产品分类: fields.产品分类 || best.l3 || ''
  }
}

function normName(s: string): string {
  return s.replace(/\s/g, '')
}

/** 去重键：产品名 + 型号 + 供应商 三元组——贸易业务里"同名不同型号"是常态（如两款数据存储），不能互相覆盖 */
function dedupKey(f: { 产品名称: string; 型号?: string; 供应商名称: string }): string {
  return `${normName(f.产品名称)}##${normName(f.型号 ?? '')}##${normName(f.供应商名称)}`
}

export interface MergeResult {
  added: number
  updated: number
  /** 供应商为空且按产品名匹配到多条同名产品——不知道该更新哪条，跳过待人工处理 */
  skipped: number
  /** 从表格内嵌图片自动挂到产品的张数（机械导入 xlsx 时按锚点行归属） */
  attachedImages?: number
}

/**
 * 合并逻辑：
 * - 带供应商的条目按 产品名称+供应商 去重（同键更新非空字段，否则新增）；
 * - 不带供应商的条目（典型：投标报价文件里只有产品名和价格）按产品名匹配——
 *   唯一命中→更新那条；多条同名（不同供应商）→跳过（宁可不动也不改错）；没命中→新增。
 * - 更新时"非空值覆盖"，暂存里的空字段不会抹掉库里已有的信息。
 */
function mergeEntries(dataDir: string, db: ProductDb, incoming: ProductFields[]): MergeResult {
  const byKey = new Map<string, ProductEntry>()
  for (const p of db.products) byKey.set(dedupKey(p), p)

  const applyUpdate = (target: ProductEntry, fields: ProductFields): void => {
    for (const k of PRODUCT_FIELD_KEYS) {
      const v = fields[k]
      if (v) (target as unknown as Record<string, string>)[k] = v
    }
    target.更新时间 = Date.now()
  }

  let added = 0
  let updated = 0
  let skipped = 0
  for (const rawFields of incoming) {
    const fields = autoFillCategory(dataDir, rawFields)
    let target: ProductEntry | undefined
    if (normName(fields.供应商名称)) {
      target = byKey.get(dedupKey(fields))
    } else {
      target = byKey.get(dedupKey(fields))
      if (!target) {
        const candidates = db.products.filter(
          (p) =>
            normName(p.产品名称) === normName(fields.产品名称) &&
            (!normName(fields.型号) || normName(p.型号) === normName(fields.型号))
        )
        if (candidates.length === 1) target = candidates[0]
        else if (candidates.length > 1) {
          skipped++
          continue
        }
      }
    }
    if (target) {
      applyUpdate(target, fields)
      updated++
    } else {
      const entry: ProductEntry = { id: randomUUID(), ...fields, 更新时间: Date.now() }
      db.products.push(entry)
      byKey.set(dedupKey(entry), entry)
      added++
    }
  }
  return { added, updated, skipped }
}

/** 合并 _待入库/ 里分身暂存的解析结果（损坏/不合规的文件跳过并保留原地，便于人工检查） */
function ingestStaging(dataDir: string, db: ProductDb): { ingested: number; skipped: number } {
  const stagingDir = join(dataDir, STAGING_DIR_REL)
  const doneDir = join(dataDir, STAGING_DONE_REL)
  let names: string[] = []
  try {
    // 「报价清单提取_」是 PDF 手册→报价清单骨架的中间产物（缺价格等关键字段），
    // 只供 generateSupplierQuoteList 机械填模板用，绝不能被当产品自动合并进产品库
    names = readdirSync(stagingDir).filter((n) => n.endsWith('.json') && !n.startsWith('报价清单提取_'))
  } catch {
    return { ingested: 0, skipped: 0 }
  }
  let ingested = 0
  let skipped = 0
  for (const name of names) {
    const full = join(stagingDir, name)
    if (!statSync(full).isFile()) continue
    try {
      const raw = JSON.parse(readFileSync(full, 'utf-8'))
      const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.products) ? raw.products : []
      const entries = list
        .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
        .map(sanitizeFields)
        .filter((e): e is ProductFields => e !== null)
      if (entries.length > 0) {
        const r = mergeEntries(dataDir, db, entries)
        ingested += r.added + r.updated
        skipped += r.skipped
      }
      renameSync(full, join(doneDir, `${Date.now()}_${name}`))
    } catch {
      // JSON 损坏：留在原地，用户能在 Finder 里看到没被合并的文件
    }
  }
  return { ingested, skipped }
}

/**
 * 普通成员只读产品库：不合并其本机暂存文件，确保产品库只以管理员同步下发的版本为准。
 */
export function listProducts(dataDir: string, ingest = true): { products: ProductEntry[]; ingested: number; skipped: number } {
  ensureSalesDirs(dataDir)
  const db = readProductDb(dataDir)
  const { ingested, skipped } = ingest ? ingestStaging(dataDir, db) : { ingested: 0, skipped: 0 }
  if (ingested > 0) writeProductDb(dataDir, db)
  const products = [...db.products].sort((a, b) => b.更新时间 - a.更新时间)
  return { products, ingested, skipped }
}

/**
 * 读《产品分类规范》分类字典（销售/产品库/分类字典.json）供一级/二级下拉取值。
 * 字典由人工维护、App 只读；文件缺失或格式不对就返回空数组——UI 降级成自由填写，不阻塞录入。
 */
export function listCategoryDict(dataDir: string): CategoryL1[] {
  const path = join(dataDir, CATEGORY_DICT_REL)
  if (!existsSync(path)) return []
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as { 分类树?: unknown }
    if (!Array.isArray(raw.分类树)) return []
    return (raw.分类树 as Record<string, unknown>[])
      .filter((a) => typeof a?.名称 === 'string' && a.名称)
      .map((a) => ({
        编码: String(a.编码 ?? ''),
        名称: String(a.名称),
        二级: (Array.isArray(a.二级) ? (a.二级 as Record<string, unknown>[]) : [])
          .filter((b) => typeof b?.名称 === 'string' && b.名称)
          .map((b) => ({
            编码: String(b.编码 ?? ''),
            名称: String(b.名称),
            三级: (Array.isArray(b.三级) ? b.三级 : []).map((c) => String(c)).filter(Boolean)
          }))
      }))
  } catch {
    return []
  }
}

export function saveProduct(dataDir: string, fields: ProductFields, id?: string): ProductEntry {
  const db = readProductDb(dataDir)
  const cleaned = sanitizeFields(fields as unknown as Record<string, unknown>)
  const clean = cleaned && autoFillCategory(dataDir, cleaned)
  if (!clean) throw new Error('产品名称不能为空')
  if (id) {
    const existing = db.products.find((p) => p.id === id)
    if (!existing) throw new Error('要更新的产品记录不存在，可能已被删除')
    Object.assign(existing, clean)
    existing.更新时间 = Date.now()
    writeProductDb(dataDir, db)
    return existing
  }
  const entry: ProductEntry = { id: randomUUID(), ...clean, 更新时间: Date.now() }
  db.products.push(entry)
  writeProductDb(dataDir, db)
  return entry
}

export function removeProduct(dataDir: string, id: string): void {
  const db = readProductDb(dataDir)
  const target = db.products.find((p) => p.id === id)
  if (target?.图片) {
    try {
      unlinkSync(join(dataDir, target.图片))
    } catch {
      /* 图片文件可能已被手动移走，不影响删除记录 */
    }
  }
  db.products = db.products.filter((p) => p.id !== id)
  writeProductDb(dataDir, db)
}

/** 设置/替换产品图片：拷入 图片库/，命名"产品名_ID前8位.扩展名"，旧图删除 */
export function setProductImage(dataDir: string, id: string, sourcePath: string): ProductEntry {
  const db = readProductDb(dataDir)
  const target = db.products.find((p) => p.id === id)
  if (!target) throw new Error('产品记录不存在，可能已被删除')
  ensureSalesDirs(dataDir)
  const ext = extname(sourcePath).toLowerCase() || '.png'
  const fileName = `${normName(target.产品名称).slice(0, 40)}_${id.slice(0, 8)}${ext}`
  const destAbs = join(dataDir, IMAGE_DIR_REL, fileName)
  copyFileSync(sourcePath, destAbs)
  const newRel = `销售/产品库/图片库/${fileName}`
  if (target.图片 && target.图片 !== newRel) {
    try {
      unlinkSync(join(dataDir, target.图片))
    } catch {
      /* 旧图不存在就算了 */
    }
  }
  target.图片 = newRel
  target.更新时间 = Date.now()
  writeProductDb(dataDir, db)
  return target
}

/** xlsx/csv 表头识别成功后的机械导入（完全不经过 AI）；投标报价表（只有产品名+投标价）同样适用 */
export async function importExcelByHeader(dataDir: string, relativePath: string): Promise<MergeResult> {
  const full = join(dataDir, relativePath)
  const sheets = await readWorkbookRows(full)
  const detections = detectHeaders(sheets)
  if (detections.length === 0) throw new Error('没有识别到可用表头（至少要有"产品名称"列），请改用 AI 解析')
  const sourceFile = basename(relativePath)
  // 表格内嵌产品图：按锚点行号归属到对应产品行（供应商清单常见做法）
  const rowImages = await readWorkbookRowImages(full)
  const entries: ProductFields[] = []
  const entryImages: ({ ext: string; buffer: Buffer } | null)[] = []
  // 一个供应商工作簿经常按产品线拆多个 Sheet。逐页导入所有已识别表头的工作表，封面/汇总/说明页不入库。
  for (const detection of detections) {
    for (let idx = 0; idx < detection.dataRows.length; idx++) {
      const row = detection.dataRows[idx]
      const raw: Record<string, unknown> = { 来源文件: sourceFile }
      for (const [field, col] of Object.entries(detection.fieldMapping)) {
        raw[field] = row[col] ?? ''
      }
      const clean = sanitizeFields(raw)
      if (clean) {
        entries.push(clean)
        entryImages.push(rowImages.get(`${detection.sheetName}|${detection.dataRowNumbers[idx]}`) ?? null)
      }
    }
  }
  const db = readProductDb(dataDir)
  const result = mergeEntries(dataDir, db, entries)
  // 附图：写入图片库并挂到对应产品（按 名称+型号+品牌 找回刚合并的记录；已有图片的不覆盖）
  let attached = 0
  if (entryImages.some(Boolean)) {
    ensureSalesDirs(dataDir)
    for (let i = 0; i < entries.length; i++) {
      const img = entryImages[i]
      if (!img) continue
      const e = entries[i]
      const target = [...db.products]
        .reverse()
        .find((p) => p.产品名称 === e.产品名称 && (p.型号 ?? '') === (e.型号 ?? '') && (p.品牌 ?? '') === (e.品牌 ?? ''))
      if (!target || target.图片) continue
      const fileName = `${normName(target.产品名称).slice(0, 40)}_${target.id.slice(0, 8)}.${img.ext.replace(/^\./, '') || 'png'}`
      try {
        writeFileSync(join(dataDir, IMAGE_DIR_REL, fileName), img.buffer)
        target.图片 = `销售/产品库/图片库/${fileName}`
        attached += 1
      } catch {
        // 单张写入失败不影响导入
      }
    }
  }
  writeProductDb(dataDir, db)
  return { ...result, attachedImages: attached }
}

/** 成员产品库交付只包含销售使用字段；成本、供应商与联系人不写入 Excel。 */
const MEMBER_CATALOG_COLUMNS: { key: keyof ProductFields; label: string; width: number }[] = [
  { key: '图片', label: '图片', width: 10 },
  { key: '产品名称', label: '产品名称', width: 24 },
  { key: '品牌', label: '品牌', width: 14 },
  { key: '型号', label: '产品型号', width: 20 },
  { key: '瑾智型号', label: '瑾智型号', width: 18 },
  { key: '生产制造商', label: '生产制造商', width: 18 },
  { key: '产地', label: '产地', width: 12 },
  { key: '一级分类', label: '一级分类', width: 22 },
  { key: '二级分类', label: '二级分类', width: 18 },
  { key: '产品分类', label: '产品分类', width: 18 },
  { key: '技术参数', label: '技术参数', width: 48 },
  { key: '单位', label: '单位', width: 10 },
  { key: '税率', label: '税率', width: 10 },
  { key: '质保期', label: '质保期', width: 14 },
  { key: '交货期', label: '交货期', width: 14 },
  { key: '物料代码', label: '物料代码', width: 18 },
  { key: '建议销售价', label: '建议销售价', width: 14 },
  { key: '投标报价', label: '投标报价', width: 14 },
  { key: '备注', label: '备注', width: 24 }
]

function memberCatalogDate(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function memberCatalogImageExt(path: string): 'jpeg' | 'png' | 'gif' | null {
  const ext = extname(path).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'jpeg'
  if (ext === '.png') return 'png'
  if (ext === '.gif') return 'gif'
  return null
}

/**
 * 管理员导出可交付给成员电脑的离线产品库 Excel。
 * 表内嵌入可用产品图片；成员在产品库点「导入产品库 Excel」后，图片会随行写入自己的本地库。
 */
export async function exportMemberProductCatalog(dataDir: string): Promise<{ outPath: string; count: number }> {
  const db = readProductDb(dataDir)
  const date = memberCatalogDate()
  const outDir = join(dataDir, 'outputs', '01_销售_sales', `${date}_成员产品库`)
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${date}_成员产品库.xlsx`)
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('成员产品库')
  sheet.columns = MEMBER_CATALOG_COLUMNS.map((column) => ({ header: column.label, key: column.key, width: column.width }))
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + MEMBER_CATALOG_COLUMNS.length)}1` }
  const header = sheet.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } }
  header.alignment = { vertical: 'middle', horizontal: 'center' }
  header.height = 24

  for (const product of db.products) {
    const row = sheet.addRow(MEMBER_CATALOG_COLUMNS.map((column) => (column.key === '图片' ? '' : product[column.key] ?? '')))
    row.height = 48
    row.alignment = { vertical: 'top', wrapText: true }
    const picturePath = product.图片 ? join(dataDir, product.图片) : ''
    const extension = picturePath && existsSync(picturePath) ? memberCatalogImageExt(picturePath) : null
    if (!extension) continue
    try {
      const imageId = workbook.addImage({ filename: picturePath, extension })
      sheet.addImage(imageId, {
        tl: { col: 0.12, row: row.number - 1 + 0.08 },
        ext: { width: 48, height: 48 },
        editAs: 'oneCell'
      })
    } catch {
      // 个别格式不兼容时跳过图片，不影响产品信息导出。
    }
  }
  await workbook.xlsx.writeFile(outPath)
  return { outPath, count: db.products.length }
}

/** 成员将管理员交付的 Excel 导入自己的本机产品库；不会访问网络或改变其他电脑的数据。 */
export async function importMemberProductCatalog(dataDir: string, sourcePath: string): Promise<MergeResult> {
  if (extname(sourcePath).toLowerCase() !== '.xlsx') throw new Error('请导入管理员导出的 .xlsx 产品库文件')
  const importDir = join(dataDir, '销售', '产品库', '成员导入')
  mkdirSync(importDir, { recursive: true })
  const localFile = join(importDir, `${Date.now()}_${basename(sourcePath)}`)
  copyFileSync(sourcePath, localFile)
  return importExcelByHeader(dataDir, relative(dataDir, localFile))
}

/** 把报价单勾选产品的图片导出到报价产出目录的 图片/ 子文件夹（文件名=产品名称），返回导出情况 */
export function exportQuoteImages(
  dataDir: string,
  productIds: string[],
  customerName: string
): { dir: string; exported: number; missing: string[] } {
  const db = readProductDb(dataDir)
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const customer = customerName.trim() || '通用'
  const dir = join(dataDir, 'outputs', '01_销售_sales', `${date}_${customer}_报价`, '图片')
  mkdirSync(dir, { recursive: true })
  let exported = 0
  const missing: string[] = []
  for (const id of productIds) {
    const p = db.products.find((x) => x.id === id)
    if (!p) continue
    const imgAbs = p.图片 ? join(dataDir, p.图片) : null
    if (imgAbs && existsSync(imgAbs)) {
      copyFileSync(imgAbs, join(dir, `${normName(p.产品名称).slice(0, 60)}${extname(imgAbs)}`))
      exported++
    } else {
      missing.push(p.产品名称)
    }
  }
  return { dir, exported, missing }
}

// ============ 机械报价单（Excel 秒出，不经过 AI） ============

const QUOTE_LOG_REL = join('销售', '报价台账.json')

interface QuoteLogEntry {
  单号: string
  客户: string
  项目?: string
  条目数: number
  /** 含非数字单价时为 null */
  合计: number | null
  文件: string
  时间: number
}

interface QuoteLog {
  version: number
  说明: string
  记录: QuoteLogEntry[]
}

/** 报价台账：每张机械生成的报价单记一笔——这是后续进销存（报价→订单→出入库）的单据源头 */
function appendQuoteLog(dataDir: string, entry: Omit<QuoteLogEntry, '单号'>, dateCode: string): QuoteLogEntry {
  const path = join(dataDir, QUOTE_LOG_REL)
  const log = readJson<QuoteLog>(path, {
    version: 1,
    说明: 'App 托管的报价台账（进销存单据源头），请勿手改；每张机械生成的 Excel 报价单自动登记一笔',
    记录: []
  })
  const seq = log.记录.filter((r) => r.单号.includes(dateCode)).length + 1
  const full: QuoteLogEntry = { 单号: `BJ-${dateCode}-${String(seq).padStart(2, '0')}`, ...entry }
  log.记录.push(full)
  writeJsonAtomic(path, log)
  return full
}

function parseNum(s: string): number | null {
  const n = parseFloat(s.replace(/[^\d.]/g, ''))
  return isFinite(n) && /\d/.test(s) ? n : null
}

/**
 * 机械生成对外报价单 Excel：产品库取数 → 只保留可对外字段 → 填进 xlsx 模板（或内置版式）
 * → 登记报价台账 → 客户库有同名客户时自动关联报价文件。
 * 红线在数据组装层落实：QuoteRow 里没有成本价/供应商联系人字段，品牌列只取"品牌"，不用供应商名称代替。
 */
export async function generateQuoteExcel(
  dataDir: string,
  lines: QuoteLineInput[],
  customerName: string,
  templateFileName: string | null,
  projectName = ''
): Promise<QuoteXlsxResult> {
  const db = readProductDb(dataDir)
  const rows: QuoteRow[] = []
  for (const l of lines) {
    const p = db.products.find((x) => x.id === l.productId)
    if (!p) continue
    const imgAbs = p.图片 ? join(dataDir, p.图片) : ''
    rows.push({
      产品名称: p.产品名称,
      生产制造商: p.生产制造商,
      产地: p.产地,
      品牌: p.品牌,
      型号: p.型号,
      瑾智型号: p.瑾智型号,
      技术参数: p.技术参数,
      税率: p.税率,
      单位: p.单位,
      质保期: p.质保期,
      交货期: p.交货期,
      物料代码: p.物料代码,
      备注: p.备注 ?? '',
      数量: parseNum(l.数量),
      数量原文: l.数量,
      单价: parseNum(l.单价),
      单价原文: l.单价,
      图片路径: imgAbs && existsSync(imgAbs) ? imgAbs : ''
    })
  }
  if (rows.length === 0) throw new Error('报价单里的产品在产品库里都不存在了，请刷新产品库')

  let templatePath: string | null = null
  if (templateFileName) {
    if (!templateFileName.toLowerCase().endsWith('.xlsx')) {
      throw new Error('只有 .xlsx 模板能机械填充；docx/pdf 模板请用「AI 生成报价文件」')
    }
    templatePath = join(dataDir, TEMPLATE_DIR_REL, templateFileName)
    if (!existsSync(templatePath)) throw new Error(`模板文件不存在：${templateFileName}`)
  }

  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const dateCode = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const customer = customerName.trim() || '通用'
  const dir = join(dataDir, 'outputs', '01_销售_sales', `${date}_${customer}_报价`)
  mkdirSync(dir, { recursive: true })
  const outPath = join(dir, `${date}_${customer}_报价单.xlsx`)

  const { 合计, warnings } = await generateQuoteXlsx({
    templatePath,
    outPath,
    lines: rows,
    customerName: customer,
    projectName
  })

  // 随报价自动把产品图导出到同目录 图片/ 子文件夹（文件名=产品名称），不再需要手动点「导出图片」
  const { exported: 导出图片 } = exportQuoteImages(dataDir, lines.map((l) => l.productId), customer)

  const logEntry = appendQuoteLog(
    dataDir,
    {
      客户: customer,
      项目: projectName.trim() || undefined,
      条目数: rows.length,
      合计,
      文件: relative(resolve(dataDir), resolve(outPath)),
      时间: Date.now()
    },
    dateCode
  )

  // 客户库里有同名客户就自动把报价文件关联上（没有就跳过，不强建客户）
  const matched = readCustomerDb(dataDir).customers.find((c) => c.客户名称 === customer)
  if (matched) linkCustomerFile(dataDir, matched.id, '报价文件', outPath)

  return { outPath, dir, 单号: logEntry.单号, 合计, 导出图片, warnings }
}

// ============ PDF 产品手册 → 供应商报价清单骨架 ============

interface QuoteListItem {
  产品名称: string
  分类?: string
  产品分类?: string
  产品类别?: string
  品牌?: string
  型号?: string
  手册页码?: string
  页码?: string
}

/** 分身提取结果的约定路径：销售/产品库/_待入库/报价清单提取_{pdf名去扩展}.json */
export function quoteListJsonRel(pdfFileName: string): string {
  const stem = pdfFileName.replace(/\.[^.]+$/, '')
  return `销售/产品库/_待入库/报价清单提取_${stem}.json`
}

/**
 * 把分身从 PDF 产品手册提取的产品条目（JSON）机械填进《供应商报价清单》模板，
 * 生成"待人工补充"的 xlsx（价格/税率等留空）。JSON 不存在时返回 needExtract，
 * 由前端注入提取提示词让分身先读 PDF 写 JSON。
 */
export async function generateSupplierQuoteList(
  dataDir: string,
  pdfFileName: string
): Promise<{ ok: boolean; needExtract: boolean; jsonRel: string; outPath?: string; 行数?: number; 说明: string }> {
  const jsonRel = quoteListJsonRel(pdfFileName)
  const jsonAbs = join(dataDir, jsonRel)
  if (!existsSync(jsonAbs)) {
    return { ok: false, needExtract: true, jsonRel, 说明: '还没有分身的提取结果——先让分身读 PDF 提取产品条目' }
  }
  let items: QuoteListItem[]
  try {
    const parsed = JSON.parse(readFileSync(jsonAbs, 'utf-8'))
    items = (Array.isArray(parsed) ? parsed : []).filter((x) => x && typeof x.产品名称 === 'string' && x.产品名称.trim())
  } catch {
    return { ok: false, needExtract: true, jsonRel, 说明: '提取结果 JSON 解析失败——请让分身重新提取' }
  }
  if (items.length === 0) return { ok: false, needExtract: true, jsonRel, 说明: '提取结果为空——请让分身重新提取' }

  // 模板：报价模板库里文件名含「报价清单」的 xlsx
  const tplDir = join(dataDir, TEMPLATE_DIR_REL)
  const tplName = existsSync(tplDir)
    ? readdirSync(tplDir).find((f) => f.includes('报价清单') && f.toLowerCase().endsWith('.xlsx'))
    : undefined
  if (!tplName) {
    return { ok: false, needExtract: false, jsonRel, 说明: '报价模板库里没有《供应商报价清单》模板（销售/_模板/报价模板/）' }
  }

  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(join(tplDir, tplName))
  const ws = wb.worksheets[0]
  if (!ws) return { ok: false, needExtract: false, jsonRel, 说明: '模板里没有工作表' }

  // 找表头行：同时含"产品名称"和"品牌"
  const text = (v: CellValue): string => {
    if (v === null || v === undefined) return ''
    if (typeof v === 'object' && 'richText' in (v as object)) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('')
    return String(v)
  }
  let headerRow = -1
  const colMap: Record<string, number> = {}
  for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
    const row = ws.getRow(r)
    const local: Record<string, number> = {}
    for (let c = 1; c <= ws.columnCount; c++) {
      const t = text(row.getCell(c).value).replace(/\s/g, '')
      if (!t) continue
      if (t === '序号') local['序号'] = c
      else if (t.includes('产品名称')) local['产品名称'] = c
      else if (t.includes('类别') || t.includes('分类')) local['分类'] = c
      else if (t === '品牌') local['品牌'] = c
      else if (t.includes('型号')) local['型号'] = c
      else if (t.includes('备注')) local['备注'] = c
    }
    if (local['产品名称'] && local['品牌']) {
      headerRow = r
      Object.assign(colMap, local)
      break
    }
  }
  if (headerRow < 0) return { ok: false, needExtract: false, jsonRel, 说明: '模板里没识别到报价清单表头（需含 产品名称/品牌 列）' }

  // 数据区现有行数 = 表头到"填写说明/合计"前的空档；保守按 1 行原型扩行
  let tailRow = -1
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    if (text(ws.getRow(r).getCell(1).value).includes('填写说明')) {
      tailRow = r
      break
    }
  }
  const have = tailRow > 0 ? tailRow - headerRow - 2 : 1 // 留一行空隔
  if (items.length > have && have > 0) ws.duplicateRow(headerRow + 1, items.length - have, true)

  items.forEach((it, i) => {
    const row = ws.getRow(headerRow + 1 + i)
    const set = (key: string, v: string | number): void => {
      if (colMap[key]) row.getCell(colMap[key]).value = v
    }
    // 先清原型行内容，再填提取到的字段——读不到的保持空白待人工
    for (let c = 1; c <= ws.columnCount; c++) row.getCell(c).value = ''
    set('序号', i + 1)
    set('产品名称', it.产品名称.trim())
    set('分类', (it.分类 || it.产品分类 || it.产品类别 || '').trim())
    set('品牌', (it.品牌 || '').trim())
    set('型号', (it.型号 || '').trim())
    const page = (it.手册页码 || it.页码 || '').toString().trim()
    if (page) set('备注', `手册P${page}`)
  })

  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const stem = pdfFileName.replace(/\.[^.]+$/, '')
  const outDir = join(dataDir, 'inbox', '01_销售_sales', '供应商资料')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${date}_供应商报价清单_${stem}_待补充.xlsx`)
  await wb.xlsx.writeFile(outPath)
  return { ok: true, needExtract: false, jsonRel, outPath, 行数: items.length, 说明: `已生成 ${items.length} 行报价清单骨架（价格等留空待人工/供应商补充）` }
}

export function listQuotationTemplates(dataDir: string): QuotationTemplate[] {
  ensureSalesDirs(dataDir)
  const dir = join(dataDir, TEMPLATE_DIR_REL)
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter((n) => !n.startsWith('.') && !n.includes('_提取文本') && statSync(join(dir, n)).isFile())
    .map((fileName) => {
      const companionCsv = `${fileName}_提取文本.csv`
      const companionTxt = `${fileName}_提取文本.txt`
      const companion = existsSync(join(dir, companionCsv))
        ? companionCsv
        : existsSync(join(dir, companionTxt))
          ? companionTxt
          : undefined
      return {
        fileName,
        path: join(dir, fileName),
        relativePath: `销售/_模板/报价模板/${fileName}`,
        companionRelativePath: companion ? `销售/_模板/报价模板/${companion}` : undefined
      }
    })
}

// ============ CRM 客户库 ============

/** v1（单联系人/联系方式字段）→ v2（角色化联系人列表 + 项目/招采网址/关联文件）就地迁移 */
function readCustomerDb(dataDir: string): CustomerDb {
  const path = join(dataDir, CUSTOMER_DB_REL)
  const db = readJson<CustomerDb>(path, { version: 2, customers: [] })
  let changed = false
  for (const c of db.customers as unknown as Record<string, unknown>[]) {
    if (!Array.isArray(c.联系人列表)) {
      const 姓名 = typeof c.联系人 === 'string' ? c.联系人 : ''
      const 联系方式 = typeof c.联系方式 === 'string' ? c.联系方式 : ''
      c.联系人列表 = 姓名 || 联系方式 ? [{ 角色: '经办人', 姓名, 联系方式 }] : []
      delete c.联系人
      delete c.联系方式
      changed = true
    }
    for (const k of ['项目名称', '招采网址'] as const) {
      if (typeof c[k] !== 'string') {
        c[k] = ''
        changed = true
      }
    }
    if (!Array.isArray(c.关联文件)) {
      c.关联文件 = []
      changed = true
    }
  }
  if (db.version !== 2) {
    db.version = 2
    changed = true
  }
  if (changed && existsSync(path)) writeJsonAtomic(path, db)
  return db
}

function writeCustomerDb(dataDir: string, db: CustomerDb): void {
  ensureSalesDirs(dataDir)
  writeJsonAtomic(join(dataDir, CUSTOMER_DB_REL), db)
}

export function listCustomers(dataDir: string): CustomerEntry[] {
  return [...readCustomerDb(dataDir).customers].sort((a, b) => b.更新时间 - a.更新时间)
}

export function saveCustomer(dataDir: string, fields: CustomerFields, id?: string): CustomerEntry {
  if (!fields.客户名称?.trim()) throw new Error('客户名称不能为空')
  const clean: CustomerFields = {
    ...fields,
    客户名称: fields.客户名称.trim(),
    联系人列表: (fields.联系人列表 ?? []).filter((c) => c.姓名.trim() || c.联系方式.trim())
  }
  const db = readCustomerDb(dataDir)
  if (id) {
    const existing = db.customers.find((c) => c.id === id)
    if (!existing) throw new Error('要更新的客户不存在，可能已被删除')
    Object.assign(existing, clean, { 更新时间: Date.now() })
    writeCustomerDb(dataDir, db)
    return existing
  }
  const entry: CustomerEntry = {
    id: randomUUID(),
    ...clean,
    关联文件: [],
    跟进记录: [],
    更新时间: Date.now()
  }
  db.customers.push(entry)
  writeCustomerDb(dataDir, db)
  return entry
}

export function removeCustomer(dataDir: string, id: string): void {
  const db = readCustomerDb(dataDir)
  db.customers = db.customers.filter((c) => c.id !== id)
  writeCustomerDb(dataDir, db)
}

export function addFollowUp(dataDir: string, customerId: string, content: string): void {
  if (!content.trim()) return
  const db = readCustomerDb(dataDir)
  const customer = db.customers.find((c) => c.id === customerId)
  if (!customer) throw new Error('客户不存在，可能已被删除')
  customer.跟进记录.push({ 时间: Date.now(), 内容: content.trim() })
  customer.更新时间 = Date.now()
  writeCustomerDb(dataDir, db)
}

/** 关联报价/合同文件：数据目录内的文件存相对路径（双机同步不失效），目录外的存绝对路径 */
export function linkCustomerFile(dataDir: string, customerId: string, 类型: LinkedFile['类型'], filePath: string): void {
  const db = readCustomerDb(dataDir)
  const customer = db.customers.find((c) => c.id === customerId)
  if (!customer) throw new Error('客户不存在，可能已被删除')
  const abs = resolve(filePath)
  const root = resolve(dataDir)
  const stored = abs.startsWith(root + '/') ? abs.slice(root.length + 1) : abs
  if (!customer.关联文件.some((f) => f.路径 === stored && f.类型 === 类型)) {
    customer.关联文件.push({ 类型, 路径: stored, 时间: Date.now() })
    customer.更新时间 = Date.now()
    writeCustomerDb(dataDir, db)
  }
}

export function unlinkCustomerFile(dataDir: string, customerId: string, index: number): void {
  const db = readCustomerDb(dataDir)
  const customer = db.customers.find((c) => c.id === customerId)
  if (!customer) throw new Error('客户不存在，可能已被删除')
  customer.关联文件.splice(index, 1)
  customer.更新时间 = Date.now()
  writeCustomerDb(dataDir, db)
}

export function resolveLinkedPath(dataDir: string, stored: string): string {
  return isAbsolute(stored) ? stored : join(dataDir, stored)
}
