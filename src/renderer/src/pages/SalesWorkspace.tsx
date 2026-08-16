import { Fragment, useEffect, useMemo, useState } from 'react'
import type {
  AgentDisplayMeta,
  CategoryL1,
  ContactRole,
  CustomerContact,
  CustomerEntry,
  CustomerFields,
  CustomerStatus,
  OutputEntry,
  ProductEntry,
  ProductFields,
  QuotationTemplate,
  SupplierDocPreview
} from '@shared/agent-types'
import { CONTACT_ROLES, CUSTOMER_STATUSES } from '@shared/agent-types'
import { AgentChat } from '../components/AgentChat'
import { ChatCollapseRail } from '../components/ChatCollapseRail'
import { CHAT_PANE, CHAT_PANE_KEY, VDragHandle, usePersistedSize } from '../components/PaneDivider'
import { OutputsPanel } from '../components/OutputsPanel'
import { HelpButton } from '../components/HelpPanel'
import { HELP_CONTENT } from '../lib/help-content'
import { useConfigStore } from '../stores/useConfigStore'
import { ResultNotice, noticeKindOf } from '../components/ResultNotice'
import type { NoticeKind, NoticeState } from '../components/ResultNotice'

type SalesTab = '产品库' | '选型' | '报价单' | '客户'
type UploadMode = 'supplier' | 'bid'
/** 排序下拉；毛利率按 (售-成本)/售 计算，仅内部参考 */
type SortMode = '默认排序' | '价格从低到高' | '价格从高到低' | '毛利率排序(内部)'
const SORT_MODES: SortMode[] = ['默认排序', '价格从低到高', '价格从高到低', '毛利率排序(内部)']

/** 产品库表格列（key 与 colW 状态一一对应；支持拖拽调整列宽） */
const PROD_COLS: { key: string; label: string }[] = [
  { key: '图', label: '图' },
  { key: '品牌', label: '品牌' },
  { key: '名称', label: '产品名称' },
  { key: '型号', label: '产品型号' },
  { key: '制造商', label: '生产制造商' },
  { key: '产地', label: '产地' },
  { key: '分类', label: '一级分类' },
  { key: '二级分类', label: '二级分类' },
  { key: '参数', label: '技术参数' },
  { key: '税率', label: '税率' },
  { key: '成本价', label: '成本价' },
  { key: '建议售价', label: '建议售价' },
  { key: '操作', label: '操作' }
]

/** 报价单表格列（与产品库同一套拖拽调宽机制；key 加 q 前缀与产品库列区分） */
const QUOTE_COLS: { key: string; label: string; title?: string }[] = [
  { key: 'q图', label: '图' },
  { key: 'q名称', label: '产品名称' },
  { key: 'q品牌', label: '品牌/供应商' },
  { key: 'q单位', label: '单位' },
  { key: 'q数量', label: '数量' },
  { key: 'q税率', label: '税率' },
  { key: 'q质保期', label: '质保期' },
  { key: 'q标准价', label: '标准价', title: '产品库建议销售价' },
  { key: 'q折扣率', label: '折扣率', title: '报价单价÷标准价，改折扣率自动算单价' },
  { key: 'q单价', label: '报价单价' },
  { key: 'q成本', label: '成本参考' },
  { key: 'q小计', label: '小计' },
  { key: 'q操作', label: '' }
]

interface PreviewCard extends SupplierDocPreview {
  mode: UploadMode
}

/** 画册抠图分步状态（按 PDF 文件名记，常驻显示在预览卡上，替代一闪而过的 flash） */
interface CatalogFlowState {
  stage: 'extracting' | 'applying' | 'done' | 'error'
  text: string
  outDir?: string
}

interface CartLine {
  product: ProductEntry
  数量: string
  报价单价: string
}

/** 选型页：一条客户需求 + 匹配到的候选产品（候选可单选/多选） */
interface NeedMatch {
  need: string
  qty: string
  candidates: { product: ProductEntry; score: number }[]
  chosenIds: string[]
}

const EMPTY_PRODUCT_FORM: ProductFields = {
  产品名称: '',
  一级分类: '',
  二级分类: '',
  产品分类: '',
  品牌: '',
  型号: '',
  生产制造商: '',
  产地: '',
  技术参数: '',
  单位: '',
  税率: '',
  质保期: '',
  物料代码: '',
  瑾智型号: '',
  交货期: '',
  成本价: '',
  建议销售价: '',
  投标报价: '',
  供应商名称: '',
  供应商联系人: '',
  供应商联系方式: '',
  图片: '',
  备注: '',
  来源文件: ''
}

const SUPPLIER_DOC_FILTERS = [{ name: '供应商资料', extensions: ['xlsx', 'csv', 'pdf', 'docx', 'doc', 'txt', 'md'] }]
const MEMBER_CATALOG_FILTERS = [{ name: '产品库 Excel', extensions: ['xlsx'] }]
const TEMPLATE_FILTERS = [{ name: '报价模板', extensions: ['docx', 'pdf', 'md', 'txt', 'xlsx'] }]
const IMAGE_FILTERS = [{ name: '产品图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'] }]

function fmtTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function appfileUrl(absPath: string): string {
  return 'appfile://' + absPath.split('/').map(encodeURIComponent).join('/')
}

/** 报价单默认取建议销售价，没有再退投标报价，最后退成本价（UI 会标出成本参考，避免误按成本报出去） */
function defaultQuotePrice(p: ProductEntry): string {
  return p.建议销售价 || p.投标报价 || p.成本价
}

/** 税率展示：库里存的是 Excel 原文（0.13 / 13 / 13%），列表统一显示成百分数 */
function fmtTaxRate(s: string): string {
  const raw = (s ?? '').trim()
  if (!raw) return '—'
  if (raw.endsWith('%')) return raw
  const n = parseFloat(raw)
  if (!isFinite(n)) return raw
  return `${n <= 1 ? +(n * 100).toFixed(2) : n}%`
}

function priceNum(s: string): number | null {
  const n = parseFloat((s ?? '').replace(/[^\d.]/g, ''))
  return isFinite(n) && /\d/.test(s ?? '') ? n : null
}


/**
 * 选型匹配打分（纯前端，不消耗 AI 额度）：把需求拆成词元，
 * 命中产品名称权重最高，其次品牌/型号/分类，最后技术参数。
 */
function scoreProduct(p: ProductEntry, tokens: string[]): number {
  let score = 0
  for (const t of tokens) {
    if (p.产品名称.includes(t)) score += 5
    if (p.品牌.includes(t) || p.型号.includes(t)) score += 3
    if (catText(p).includes(t)) score += 3
    if (p.技术参数.includes(t)) score += 1
    if ((p.备注 ?? '').includes(t)) score += 1
  }
  return score
}

/**
 * 产品库搜索（SPS 式）：空格分词 AND 匹配——每个词都要命中任一字段才算；
 * 返回相关度得分用于排序（0 = 不匹配），型号精确命中排最前。
 *
 * 分类可直接当搜索词用：既能搜分类名（"摄像机与云台"），也能搜分类编码（"E1"）——
 * 编码走前缀匹配，搜 "E" 出整个一级、搜 "E1" 收敛到该二级。
 */
function searchScore(p: ProductEntry, tokens: string[], catCode: (p: ProductEntry) => string): number {
  let total = 0
  for (const t of tokens) {
    const T = t.toLowerCase()
    let s = 0
    if (p.型号.toLowerCase() === T) s = Math.max(s, 100)
    else if (p.型号.toLowerCase().startsWith(T)) s = Math.max(s, 60)
    else if (p.型号.toLowerCase().includes(T)) s = Math.max(s, 30)
    if (p.产品名称.toLowerCase() === T) s = Math.max(s, 80)
    else if (p.产品名称.toLowerCase().includes(T)) s = Math.max(s, 25)
    if (p.品牌.toLowerCase().includes(T)) s = Math.max(s, 15)
    const code = catCode(p).toLowerCase()
    if (code && code.startsWith(T)) s = Math.max(s, 20)
    if (catText(p).toLowerCase().includes(T)) s = Math.max(s, 10)
    if (
      p.生产制造商.toLowerCase().includes(T) ||
      p.供应商名称.toLowerCase().includes(T) ||
      (p.产地 ?? '').toLowerCase().includes(T)
    )
      s = Math.max(s, 8)
    if (p.技术参数.toLowerCase().includes(T) || (p.备注 ?? '').toLowerCase().includes(T)) s = Math.max(s, 5)
    if (s === 0) return 0 // AND 语义：有一个词不命中就整条出局
    total += s
  }
  return total
}

/**
 * 一条产品的分类路径（一级/二级/三级）。一二级取《产品分类规范》固定枚举字段；
 * 三级取 产品分类（细分品类，仍允许用 / 再分层，多余层级截断到 3 级）。
 * 三个都空 → 未分类；一级空但三级有值（老数据/外部导入）→ 直接把三级当一级展示，不丢条目。
 */
function catParts(p: { 一级分类?: string; 二级分类?: string; 产品分类?: string }): string[] {
  const split = (value: string | undefined): string[] =>
    (value || '').split(/[/＞>]/).map((t) => t.trim()).filter(Boolean)
  const l1Parts = split(p.一级分类)
  const l2Parts = split(p.二级分类)
  const tail = (p.产品分类 || '')
    .split(/[/＞>]/)
    .map((t) => t.trim())
    .filter(Boolean)
  // 兼容旧导入数据把“一级 / 二级”一并写进一级分类：表格和目录均按规范拆开显示。
  const parts = [l1Parts[0], l2Parts[0] || l1Parts[1], ...tail].filter(Boolean).slice(0, 3)
  return parts.length > 0 ? parts : ['未分类']
}

/** 分类的一行展示文本（表格「分类」列、搜索命中都用它） */
function catText(p: { 一级分类?: string; 二级分类?: string; 产品分类?: string }): string {
  const parts = catParts(p)
  return parts[0] === '未分类' ? '' : parts.join(' / ')
}

/** 左侧目录只承担一级、二级筛选；三级细分仍可在表格详情与搜索中使用。 */
function navCatParts(p: { 一级分类?: string; 二级分类?: string; 产品分类?: string }): string[] {
  return catParts(p).slice(0, 2)
}

interface CatNode {
  name: string
  /** 从根到本节点的完整路径（'/'.join），作为选中/展开的 key */
  key: string
  count: number
  children: CatNode[]
}

/** 展示价：建议售价优先（对外口径），无价则空 */
function displayPrice(p: ProductEntry): string {
  return p.建议销售价 || p.投标报价 || ''
}

/** 毛利率（内部）：(售-成本)/售，两价都是数字才有 */
function marginRate(p: ProductEntry): number | null {
  const sell = priceNum(displayPrice(p))
  const cost = priceNum(p.成本价)
  if (sell === null || cost === null || sell <= 0) return null
  return ((sell - cost) / sell) * 100
}

/** 一行需求解析：末尾的 "x3 / ×3 / *3" 当数量 */
function parseNeedLine(line: string): { need: string; qty: string } {
  const m = /^(.*?)[x×*]\s*(\d+)\s*$/i.exec(line.trim())
  return m ? { need: m[1].trim(), qty: m[2] } : { need: line.trim(), qty: '1' }
}

function matchNeed(need: string, products: ProductEntry[]): { product: ProductEntry; score: number }[] {
  const tokens = need
    .split(/[\s,，、;；/]+/)
    .flatMap((t) => {
      // 长中文短语再切 2 字词元，"单警执法记录仪"也能命中"执法记录仪"
      if (/^[一-龥]{4,}$/.test(t)) {
        const grams: string[] = [t]
        for (let i = 0; i + 2 <= t.length; i++) grams.push(t.slice(i, i + 2))
        return grams
      }
      return [t]
    })
    .filter((t) => t.length >= 2)
  if (tokens.length === 0) return []
  return products
    .map((product) => ({ product, score: scoreProduct(product, tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
}

/** 构造"PDF 产品手册 → 报价清单提取"的提示词：分身读 PDF 写 JSON，App 再机械填模板出 xlsx */
function buildPdfQuoteListPrompt(preview: PreviewCard, jsonRel: string): string {
  return [
    `读取这份供应商产品手册 PDF，提取产品条目供生成《供应商报价清单》骨架。`,
    `PDF 文件：${preview.relativePath}（用 Read 工具直接读，PDF 可分页读取；页数多就分批读完，不要只读前几页）。`,
    `要求：`,
    `1. 逐页识别产品，每个产品一个 JSON 对象，字段名严格使用：产品名称、分类、品牌、型号、手册页码。`,
    `2. 分类按手册的章节/目录归类；品牌、型号只有页面上明确标注才填，否则填空字符串""——绝不猜测编造。`,
    `3. 手册页码填印刷页码（字符串），方便人工回查原文。`,
    `4. 用 Write 把 JSON 数组写入 ${jsonRel}，文件内容只有 JSON 数组本身。`,
    `5. 不要修改 libraries/01_销售_sales/产品库/产品库.json。`,
    `完成后回复提取了多少个产品、哪些字段普遍缺失。之后我会在工作台点「生成报价清单」由 App 机械填模板出 xlsx（价格等留空待人工）。`
  ].join('\n')
}

/** 构造"AI 解析供应商资料/投标报价文件"的提示词——分身只写 _待入库/ 暂存 JSON，规范库由 App 合并 */
function buildParsePrompt(preview: PreviewCard): string {
  const readTarget = preview.companionRelativePath
    ? `${preview.companionRelativePath}（这是 App 从 ${preview.relativePath} 提取的纯文本，优先读它；需要时也可对照原文件）`
    : preview.relativePath
  const stagingFile = `libraries/01_销售_sales/产品库/_待入库/入库_${Date.now()}.json`
  if (preview.mode === 'bid') {
    return [
      `解析这份投标报价文件，提取各产品的投标报价写入暂存区。`,
      `文件：${readTarget}`,
      `要求：`,
      `1. 每个产品提取为一个 JSON 对象，只填两个字段的值：产品名称、投标报价；其余字段（一级分类、二级分类、产品分类、品牌、型号、瑾智型号、生产制造商、产地、技术参数、单位、税率、质保期、交货期、物料代码、成本价、建议销售价、供应商名称、供应商联系人、供应商联系方式、备注）一律填空字符串""，来源文件填"${preview.fileName}"。`,
      `2. 产品名称照抄文件原文写法（App 会按名称匹配到产品库里的已有条目回填投标报价）；投标报价保留原文（含单位/含税说明）。`,
      `3. 用 Write 工具把 JSON 数组写入 ${stagingFile}，文件内容只有 JSON 数组本身。`,
      `4. 不要修改 libraries/01_销售_sales/产品库/产品库.json。`,
      `完成后回复提取了多少条。`
    ].join('\n')
  }
  return [
    `解析这份供应商产品资料，提取产品条目写入暂存区。`,
    `资料文件：${readTarget}`,
    `要求：`,
    `0. 只提取"产品明细表格里的真实产品行"（每行有型号/规格和价格）；表头行、标题、致供应商说明、填写说明/须知、示例行（备注写着"示例"）、公司落款、日期/联系人等一律不是产品，绝对不要提取。`,
    `1. 每个产品提取为一个 JSON 对象，字段名严格使用：产品名称、一级分类、二级分类、产品分类、品牌、型号、瑾智型号、生产制造商、产地、技术参数、单位、税率、质保期、交货期、物料代码、成本价、建议销售价、投标报价、供应商名称、供应商联系人、供应商联系方式、备注、来源文件（来源文件统一填"${preview.fileName}"）。瑾智型号是我方自编型号（资料里通常没有，留空）；交货期照原文（如"30天/现货"）。`,
    `1.1 分类按《产品分类规范》填：先读 libraries/01_销售_sales/产品库/分类字典.json 的「分类树」和「归属规则」，一级分类填字典里一级的"名称"原文（如"视频监控与智能感知"），二级分类填该一级下二级的"名称"原文（如"摄像机与云台"），产品分类填三级细分品类（字典三级里有就用原文，没有就照产品自身品类写短词）。一款产品只能归一个三级分类；拿不准归哪类就把三个分类字段都留空由人工补，禁止硬凑。`,
    `2. 供应商报价表里的价格是给我们的进货价，填进"成本价"；资料里明确写了建议零售价/指导价才填"建议销售价"，没有就留空。品牌/型号/生产制造商/产地/单位/税率照资料原文填（质保期折算成月数，如"三年"填"36"）；注意区分：品牌是产品品牌（如海康威视），供应商名称是把货卖给我们的渠道公司，两者可能不同。技术参数把规格/关键参数拼成一段完整文字；所有价格保留资料原文写法（含单位、含税说明）；资料里没有的字段填空字符串""，禁止编造。`,
    `3. 用 Write 工具把 JSON 数组写入 ${stagingFile}，文件内容只有 JSON 数组本身，不要包裹代码块或其它文字。`,
    `4. 不要修改 libraries/01_销售_sales/产品库/产品库.json——那是桌面 App 托管的规范库，你写的暂存文件会由 App 校验后合并进去。`,
    `完成后回复：提取了多少条产品、哪些字段缺失比较多。`
  ].join('\n')
}

// ============ 产品表单 ============

function ProductForm({
  initial,
  catDict,
  onSave,
  onCancel
}: {
  initial: ProductFields
  /** 《产品分类规范》分类字典；为空（字典文件缺失）时一级/二级降级成自由填写 */
  catDict: CategoryL1[]
  onSave: (fields: ProductFields) => void
  onCancel: () => void
}): React.JSX.Element {
  const [form, setForm] = useState<ProductFields>(initial)
  const set = (k: keyof ProductFields, v: string): void => setForm((f) => ({ ...f, [k]: v }))
  const l1 = catDict.find((c) => c.名称 === form.一级分类) ?? null
  const l2List = l1?.二级 ?? []
  const l3List = l2List.find((c) => c.名称 === form.二级分类)?.三级 ?? []
  // Excel 导入/老数据里的分类值可能不在字典里（错字、字典还没收录）。下拉里补一个"字典外"选项
  // 把原值显示出来——否则 select 渲染成空白，看着像数据丢了，人一保存就真丢了。
  const offDictL1 = Boolean(form.一级分类) && !l1
  const offDictL2 = Boolean(form.二级分类) && !l2List.some((c) => c.名称 === form.二级分类)
  const FIELDS: { key: keyof ProductFields; label: string; wide?: boolean }[] = [
    { key: '产品名称', label: '产品名称 *' },
    { key: '品牌', label: '品牌（对外报价用）' },
    { key: '型号', label: '型号' },
    { key: '生产制造商', label: '生产制造商' },
    { key: '产地', label: '产地' },
    { key: '技术参数', label: '技术参数', wide: true },
    { key: '单位', label: '单位（台/套/个）' },
    { key: '税率', label: '税率' },
    { key: '质保期', label: '质保期（月）' },
    { key: '物料代码', label: '物料代码' },
    { key: '瑾智型号', label: '瑾智型号（我方自编，对外报价用）' },
    { key: '交货期', label: '交货期（如 30天/现货）' },
    { key: '成本价', label: '成本价（采购侧，不进报价）' },
    { key: '建议销售价', label: '建议销售价' },
    { key: '投标报价', label: '投标报价' },
    { key: '供应商名称', label: '供应商名称（采购渠道）' },
    { key: '供应商联系人', label: '供应商联系人' },
    { key: '供应商联系方式', label: '供应商联系方式' },
    { key: '备注', label: '备注', wide: true }
  ]
  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3">
      {/* 分类三级：一级/二级从《产品分类规范》分类字典取值（固定枚举），三级随入库生长可自由填写 */}
      <div className="mb-2 grid grid-cols-3 gap-2 rounded-md bg-slate-50 p-2">
        <div>
          <label className="mb-0.5 block text-xs text-slate-400">一级分类</label>
          <select
            value={form.一级分类 ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, 一级分类: e.target.value, 二级分类: '', 产品分类: '' }))}
            disabled={catDict.length === 0}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-jushi-accent disabled:bg-slate-100"
          >
            <option value="">— 未分类 —</option>
            {offDictL1 && <option value={form.一级分类}>{form.一级分类}（字典外，建议改选）</option>}
            {catDict.map((c) => (
              <option key={c.编码} value={c.名称}>
                {c.编码} {c.名称}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-slate-400">二级分类</label>
          <select
            value={form.二级分类 ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, 二级分类: e.target.value, 产品分类: '' }))}
            disabled={l2List.length === 0 && !offDictL2}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-jushi-accent disabled:bg-slate-100"
          >
            <option value="">{l1 ? '— 请选择 —' : '— 先选一级 —'}</option>
            {offDictL2 && <option value={form.二级分类}>{form.二级分类}（字典外，建议改选）</option>}
            {l2List.map((c) => (
              <option key={c.编码} value={c.名称}>
                {c.编码} {c.名称}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-slate-400">三级分类（细分品类）</label>
          <input
            list="cat-l3-options"
            value={form.产品分类 ?? ''}
            onChange={(e) => set('产品分类', e.target.value)}
            placeholder={l3List.length > 0 ? '从字典选或直接填新品类' : '选完二级后可选'}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-jushi-accent"
          />
          <datalist id="cat-l3-options">
            {l3List.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        {catDict.length === 0 && (
          <p className="col-span-3 text-[11px] text-amber-600">
            没读到分类字典（libraries/01_销售_sales/产品库/分类字典.json），一二级下拉不可用——补上字典文件后重开工作台即可。
          </p>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.wide ? 'col-span-3' : ''}>
            <label className="mb-0.5 block text-xs text-slate-400">{f.label}</label>
            <input
              value={form[f.key] ?? ''}
              onChange={(e) => set(f.key, e.target.value)}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-jushi-accent"
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => form.产品名称.trim() && onSave(form)}
          className="rounded-md bg-jushi-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          disabled={!form.产品名称.trim()}
        >
          保存
        </button>
        <button onClick={onCancel} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-500">
          取消
        </button>
      </div>
    </div>
  )
}

// ============ 主工作台 ============

/** 供应商重复导入复核：取文件名与产品库既有供应商名的核心词做双向包含匹配 */
function matchExistingSuppliers(
  fileName: string,
  products: { 供应商名称?: string }[]
): { 名称: string; 产品数: number }[] {
  const core = (s: string): string =>
    s.replace(/(有限公司|有限责任公司|股份有限公司|科技|商贸|贸易|设备|电子|工程)/g, '').replace(/^(台州市?|浙江省?|杭州市?|椒江区?)/, '')
  const counts = new Map<string, number>()
  for (const p of products) {
    const n = (p.供应商名称 ?? '').trim()
    if (n) counts.set(n, (counts.get(n) ?? 0) + 1)
  }
  const hits: { 名称: string; 产品数: number }[] = []
  for (const [name, cnt] of counts) {
    const c = core(name)
    if (c.length >= 2 && (fileName.includes(c) || c.includes(fileName.replace(/\.[^.]+$/, '')))) {
      hits.push({ 名称: name, 产品数: cnt })
    }
  }
  return hits
}

export function SalesWorkspace({ agent }: { agent: AgentDisplayMeta }): React.JSX.Element {
  const config = useConfigStore((s) => s.config)
  const dataDir = config?.companies.find((c) => c.id === config.activeCompanyId)?.dataDir ?? null

  const [tab, setTab] = useState<SalesTab>('产品库')
  const [products, setProducts] = useState<ProductEntry[]>([])
  /** 《产品分类规范》分类字典（libraries/01_销售_sales/产品库/分类字典.json），一级/二级下拉的取值来源 */
  const [catDict, setCatDict] = useState<CategoryL1[]>([])
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('全部') // '全部' 或分类路径 '一级/二级/三级'
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())
  const [showCatNav, setShowCatNav] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>('默认排序')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [bulkRate, setBulkRate] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [previews, setPreviews] = useState<PreviewCard[]>([])
  const [catalogFlow, setCatalogFlow] = useState<Record<string, CatalogFlowState>>({})
  const [pendingAutoSend, setPendingAutoSend] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<NoticeState | null>(null)

  const [cart, setCart] = useState<CartLine[]>([])
  const [templates, setTemplates] = useState<QuotationTemplate[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [quoteCustomer, setQuoteCustomer] = useState('')
  const [quoteProject, setQuoteProject] = useState('')
  const [budget, setBudget] = useState('')

  const [needsText, setNeedsText] = useState('')
  const [needMatches, setNeedMatches] = useState<NeedMatch[]>([])
  const [onlyInBudget, setOnlyInBudget] = useState(false)

  // 产品库 + 报价单列宽（px，可拖拽调整）——键与表头列一一对应（报价单列带 q 前缀）
  const [colW, setColW] = useState<Record<string, number>>({
    图: 44,
    品牌: 84,
    名称: 168,
    型号: 132,
    制造商: 96,
    产地: 64,
    分类: 132,
    二级分类: 132,
    参数: 240,
    税率: 56,
    成本价: 80,
    建议售价: 80,
    操作: 150,
    q图: 44,
    q名称: 176,
    q品牌: 120,
    q单位: 56,
    q数量: 60,
    q税率: 60,
    q质保期: 76,
    q标准价: 84,
    q折扣率: 70,
    q单价: 96,
    q成本: 72,
    q小计: 84,
    q操作: 48
  })
  const [customers, setCustomers] = useState<CustomerEntry[]>([])
  const [customerFilter, setCustomerFilter] = useState<'全部' | '待跟进' | CustomerStatus>('全部')
  const [customerQuery, setCustomerQuery] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [showCustomerForm, setShowCustomerForm] = useState(false)
  const [followUpInput, setFollowUpInput] = useState('')

  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const [outputsRefresh, setOutputsRefresh] = useState(0)
  const [showOutputs, setShowOutputs] = useState(false)
  const [showChat, setShowChat] = useState(true)
  const [chatW, setChatW] = usePersistedSize(CHAT_PANE_KEY, CHAT_PANE.def, CHAT_PANE.min, CHAT_PANE.max)

  // 收起状态下派了 AI 任务（解析入库/AI 报价/分身推荐/跟进话术），自动展开对话栏
  useEffect(() => {
    if (pendingPrompt) setShowChat(true)
  }, [pendingPrompt])

  function flash(text: string, kind?: NoticeKind): void {
    setNotice({ text, kind: kind ?? noticeKindOf(text) })
  }

  /** 画册抠图：把某个 PDF 的分步状态写入常驻状态条 */
  function setCatalog(fileName: string, s: CatalogFlowState): void {
    setCatalogFlow((prev) => ({ ...prev, [fileName]: s }))
  }

  /** 拖拽表头右缘调整列宽（最小 40px） */
  function startResize(key: string, e: React.MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = colW[key] ?? 100
    const onMove = (ev: MouseEvent): void => {
      setColW((w) => ({ ...w, [key]: Math.max(40, startW + (ev.clientX - startX)) }))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  async function refreshProducts(): Promise<void> {
    const { products: list, ingested, skipped } = await window.api.sales.listProducts()
    setProducts(list)
    if (ingested > 0 || skipped > 0) {
      flash(
        `已自动合并 AI 解析暂存 ${ingested} 条` +
          (skipped > 0 ? `；${skipped} 条因产品库里有多条同名产品（不同供应商）无法自动定位，已跳过，请手动更新` : '')
      )
    }
  }
  async function refreshCategoryDict(): Promise<void> {
    setCatDict(await window.api.sales.listCategoryDict())
  }
  async function refreshTemplates(): Promise<void> {
    setTemplates(await window.api.sales.listTemplates())
  }
  async function refreshCustomers(): Promise<void> {
    setCustomers(await window.api.sales.listCustomers())
  }

  useEffect(() => {
    setProducts([])
    setCatDict([])
    void refreshProducts()
    void refreshCategoryDict()
    refreshTemplates()
    refreshCustomers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.activeCompanyId])

  useEffect(() => {
    if (tab === '产品库') {
      refreshProducts()
      refreshCategoryDict()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, config?.activeCompanyId])

  async function handleImportMemberCatalog(): Promise<void> {
    const paths = await window.api.dialog.pickFiles(MEMBER_CATALOG_FILTERS)
    if (paths.length === 0) return
    setBusy(true)
    try {
      const result = await window.api.sales.importMemberCatalog(paths[0])
      flash(`✅ 已导入产品库：新增 ${result.added} 条、更新 ${result.updated} 条${result.attachedImages ? `，导入图片 ${result.attachedImages} 张` : ''}`)
      await refreshProducts()
      await refreshCategoryDict()
    } catch (err) {
      flash(`导入失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleExportMemberCatalog(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.api.sales.exportMemberCatalog()
      flash(`✅ 已导出 ${result.count} 条成员产品库数据`)
      await window.api.shell.showItemInFolder(result.outPath)
    } catch (err) {
      flash(`导出失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 分类名 → 规范编码（一级 A-L / 二级 A1-L6），供搜索按编码检索、导航树标注 */
  const catCodeByName = useMemo(() => {
    const m = new Map<string, string>()
    for (const l1 of catDict) {
      if (l1.名称) m.set(l1.名称, l1.编码)
      for (const l2 of l1.二级) if (l2.名称) m.set(l2.名称, l2.编码)
    }
    return m
  }, [catDict])

  /** 一条产品的分类编码（取二级，无二级退一级）——搜 "E1"/"E" 都能命中 */
  const catCodeOf = useMemo(
    () => (p: ProductEntry): string => catCodeByName.get(p.二级分类) || catCodeByName.get(p.一级分类) || '',
    [catCodeByName]
  )

  /** 分类导航树（仅一级/二级）：每级 名称→数量，按数量排序 */
  const categoryTree = useMemo(() => {
    const root: CatNode[] = []
    for (const p of products) {
      let list = root
      const acc: string[] = []
      for (const part of navCatParts(p)) {
        acc.push(part)
        let node = list.find((n) => n.name === part)
        if (!node) {
          node = { name: part, key: acc.join('/'), count: 0, children: [] }
          list.push(node)
        }
        node.count++
        list = node.children
      }
    }
    const sortRec = (l: CatNode[]): void => {
      l.sort((a, b) => b.count - a.count)
      l.forEach((n) => sortRec(n.children))
    }
    sortRec(root)
    return root
  }, [products])

  const filteredProducts = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const min = priceNum(priceMin)
    const max = priceNum(priceMax)
    const scored: { p: ProductEntry; score: number }[] = []
    const selectedCatParts = categoryFilter === '全部' ? null : categoryFilter.split('/')
    for (const p of products) {
      if (selectedCatParts) {
        // 选中某级分类 = 该级及其所有子级都算命中（按路径前缀匹配）
        const parts = catParts(p)
        if (!selectedCatParts.every((s, idx) => parts[idx] === s)) continue
      }
      if (min !== null || max !== null) {
        // 价格筛选按对外口径（建议售价→投标价），都没填价的产品在价格筛选下隐藏
        const price = priceNum(displayPrice(p))
        if (price === null) continue
        if (min !== null && price < min) continue
        if (max !== null && price > max) continue
      }
      let score = 0
      if (tokens.length > 0) {
        score = searchScore(p, tokens, catCodeOf)
        if (score === 0) continue
      }
      scored.push({ p, score })
    }
    if (tokens.length > 0) scored.sort((a, b) => b.score - a.score || b.p.更新时间 - a.p.更新时间)
    return scored.map((x) => x.p)
  }, [products, query, categoryFilter, priceMin, priceMax, catCodeOf])

  /** 排序（在筛选结果之上；"默认"= 有搜索词按相关度、无搜索词按更新时间） */
  const sortedProducts = useMemo(() => {
    if (sortMode === '默认排序') return filteredProducts
    const list = [...filteredProducts]
    const price = (p: ProductEntry): number | null => priceNum(displayPrice(p))
    if (sortMode === '价格从低到高') list.sort((a, b) => (price(a) ?? Infinity) - (price(b) ?? Infinity))
    else if (sortMode === '价格从高到低') list.sort((a, b) => (price(b) ?? -Infinity) - (price(a) ?? -Infinity))
    else list.sort((a, b) => (marginRate(b) ?? -Infinity) - (marginRate(a) ?? -Infinity))
    return list
  }, [filteredProducts, sortMode])

  async function handleUploadDocs(mode: UploadMode): Promise<void> {
    const paths = await window.api.dialog.pickFiles(SUPPLIER_DOC_FILTERS)
    if (paths.length === 0) return
    setBusy(true)
    try {
      for (const p of paths) {
        try {
          const preview = await window.api.sales.uploadSupplierDoc(p)
          setPreviews((prev) => [{ ...preview, mode }, ...prev])
        } catch (err) {
          flash(err instanceof Error ? err.message : String(err))
        }
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleDirectImport(preview: PreviewCard): Promise<void> {
    setBusy(true)
    try {
      const { added, updated, skipped, attachedImages } = await window.api.sales.importExcel(preview.relativePath)
      flash(
        `「${preview.fileName}」已直接导入：新增 ${added} 条、更新 ${updated} 条` +
          ((attachedImages ?? 0) > 0 ? `、表格内嵌图片自动挂图 ${attachedImages} 张` : '') +
          (skipped > 0 ? `、跳过 ${skipped} 条（多条同名产品无法定位，请手动更新）` : '')
      )
      setPreviews((prev) => prev.filter((x) => x !== preview))
      await refreshProducts()
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleSetImage(productId: string): Promise<void> {
    const paths = await window.api.dialog.pickFiles(IMAGE_FILTERS)
    if (paths.length === 0) return
    await window.api.sales.setProductImage(productId, paths[0])
    await refreshProducts()
  }

  function addToCart(product: ProductEntry, qty = '1'): void {
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id)
      if (existing) {
        // 重复加购按 SPS 习惯累加数量
        const merged = String((parseFloat(existing.数量) || 0) + (parseFloat(qty) || 1))
        return prev.map((l) => (l.product.id === product.id ? { ...l, 数量: merged } : l))
      }
      return [...prev, { product, 数量: qty, 报价单价: defaultQuotePrice(product) }]
    })
    flash(`已加入报价单：${product.产品名称} x${qty}${product.建议销售价 ? '' : '（无建议销售价，默认取了其它价格口径，注意核对）'}`)
  }

  const cartTotal = useMemo(() => {
    let total = 0
    for (const l of cart) {
      const price = parseFloat(l.报价单价.replace(/[^\d.]/g, ''))
      const qty = parseFloat(l.数量)
      if (!isFinite(price) || !isFinite(qty)) return null
      total += price * qty
    }
    return cart.length > 0 ? total : null
  }, [cart])

  /** 毛利估算（内部参考）：所有行的报价与成本价都是数字时才给出 */
  const cartMargin = useMemo(() => {
    if (cartTotal === null) return null
    let cost = 0
    for (const l of cart) {
      const c = priceNum(l.product.成本价)
      const qty = parseFloat(l.数量)
      if (c === null || !isFinite(qty)) return null
      cost += c * qty
    }
    return cartTotal > 0 ? { 毛利: cartTotal - cost, 毛利率: ((cartTotal - cost) / cartTotal) * 100 } : null
  }, [cart, cartTotal])

  /** 选型：需求清单逐行匹配产品库（纯前端打分，不消耗 AI 额度） */
  function handleMatchNeeds(): void {
    const lines = needsText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length === 0) {
      flash('先在需求清单里输入采购需求，一行一条（行尾可加 x数量）')
      return
    }
    const bNum = priceNum(budget)
    setNeedMatches(
      lines.map((line) => {
        const { need, qty } = parseNeedLine(line)
        const candidates = matchNeed(need, products)
        const q = parseFloat(qty) || 1
        // 有预算时默认勾选"相关度高且预算内"的第一条；没有预算内的就退相关度最高
        let pick = candidates[0]
        if (bNum !== null) {
          const inBudget = candidates.find(({ product }) => {
            const u = priceNum(defaultQuotePrice(product))
            return u !== null && u * q <= bNum
          })
          if (inBudget) pick = inBudget
        }
        return { need, qty, candidates, chosenIds: pick ? [pick.product.id] : [] }
      })
    )
  }

  /** 某候选按"报价参考单价 × 本条数量"是否落在采购预算内（预算未填时返回 null=不判断） */
  function candidateInBudget(p: ProductEntry, qty: string): boolean | null {
    if (budgetNum === null) return null
    const u = priceNum(defaultQuotePrice(p))
    if (u === null) return null
    return u * (parseFloat(qty) || 1) <= budgetNum
  }

  /** 切换某条需求下某个候选产品的勾选（多选） */
  function toggleChosen(mi: number, id: string): void {
    setNeedMatches((prev) =>
      prev.map((x, xi) =>
        xi === mi
          ? { ...x, chosenIds: x.chosenIds.includes(id) ? x.chosenIds.filter((c) => c !== id) : [...x.chosenIds, id] }
          : x
      )
    )
  }

  const chosenTotal = useMemo(() => {
    let total = 0
    for (const m of needMatches) {
      const qty = parseFloat(m.qty)
      for (const id of m.chosenIds) {
        const p = products.find((x) => x.id === id)
        if (!p) continue
        const price = priceNum(defaultQuotePrice(p))
        if (price === null || !isFinite(qty)) return null
        total += price * qty
      }
    }
    return total
  }, [needMatches, products])

  const budgetNum = priceNum(budget)

  function addChosenToCart(): void {
    let added = 0
    setCart((prev) => {
      let next = [...prev]
      for (const m of needMatches) {
        for (const id of m.chosenIds) {
          const p = products.find((x) => x.id === id)
          if (!p || next.some((l) => l.product.id === p.id)) continue
          next = [...next, { product: p, 数量: m.qty, 报价单价: defaultQuotePrice(p) }]
          added++
        }
      }
      return next
    })
    setTab('报价单')
    flash(added > 0 ? `已把 ${added} 个选中产品加入报价单` : '选中的产品都已在报价单里')
  }

  /** 选型没匹配到/要更专业的推荐时，把需求+预算丢给分身（分身只读产品库，回复推荐清单） */
  function buildRecommendPrompt(): string {
    return [
      `按客户采购需求从产品库里选型推荐。`,
      quoteCustomer.trim() ? `客户：${quoteCustomer.trim()}（公安/政法客户口径）` : '',
      budget.trim() ? `采购预算：${budget.trim()} 元——推荐组合的合计要卡在预算内，留出谈判空间。` : '',
      `需求清单：`,
      needsText.trim(),
      ``,
      `要求：读 libraries/01_销售_sales/产品库/产品库.json（只读，禁止写入），对每条需求给出 1-2 个推荐产品（产品名称/品牌/型号/关键参数/建议报价），同一产品多家供应商时按成本价低、货源稳的优先并说明理由；没有匹配产品的需求明确说"库里没有"，不要硬凑。最后给推荐组合的合计金额${budget.trim() ? '与预算对比' : ''}。只在对话里回复，不用写文件。注意：回复里不要出现供应商联系人/联系方式（采购侧信息）。`
    ]
      .filter(Boolean)
      .join('\n')
  }

  /** 机械生成报价单（秒出，不经过 AI）：填 Excel + 自动导出产品图 */
  async function handleGenerateQuoteXlsx(): Promise<void> {
    setBusy(true)
    try {
      const template = templates.find((t) => t.fileName === selectedTemplate) ?? null
      const r = await window.api.sales.generateQuoteXlsx(
        cart.map((l) => ({ productId: l.product.id, 数量: l.数量, 单价: l.报价单价 })),
        quoteCustomer,
        template && template.fileName.toLowerCase().endsWith('.xlsx') ? template.fileName : null,
        quoteProject
      )
      flash(
        `报价单已生成（${r.单号}${r.合计 !== null ? `，合计 ¥${r.合计.toLocaleString()}` : ''}` +
          (r.导出图片 > 0 ? `，随附 ${r.导出图片} 张产品图` : '') +
          `）` +
          (r.warnings.length > 0 ? ` ⚠ ${r.warnings[0]}` : '')
      )
      await window.api.shell.showItemInFolder(r.outPath)
      setOutputsRefresh((k) => k + 1)
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) ?? null
  const todayStr = fmtTime(Date.now())
  const isDue = (c: CustomerEntry): boolean => !!c.下次跟进日期 && c.下次跟进日期 <= todayStr
  /** 各状态客户数 + 待跟进数，用于过滤条上的角标 */
  const customerCounts = useMemo(() => {
    const m: Record<string, number> = { 待跟进: 0 }
    for (const c of customers) {
      m[c.状态] = (m[c.状态] ?? 0) + 1
      if (isDue(c)) m.待跟进 += 1
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, todayStr])
  const filteredCustomers = customers.filter((c) => {
    if (customerFilter === '待跟进') {
      if (!isDue(c)) return false
    } else if (customerFilter !== '全部' && c.状态 !== customerFilter) {
      return false
    }
    const q = customerQuery.trim().toLowerCase()
    if (q) {
      const hay = [
        c.客户名称,
        c.项目名称,
        c.备注 ?? '',
        ...c.联系人列表.flatMap((x) => [x.姓名, x.联系方式])
      ]
        .join(' ')
        .toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  function draftFollowUpPrompt(c: CustomerEntry): string {
    const contacts = c.联系人列表.map((x) => `${x.角色}${x.姓名}${x.联系方式 ? `(${x.联系方式})` : ''}`).join('、')
    const recent = c.跟进记录
      .slice(-3)
      .map((r) => `${fmtTime(r.时间)}：${r.内容}`)
      .join('；')
    return [
      `为客户「${c.客户名称}」起草跟进话术。`,
      c.项目名称 ? `相关项目：${c.项目名称}` : '',
      `客户当前状态：${c.状态}${c.备注 ? `；备注：${c.备注}` : ''}`,
      contacts ? `对接人：${contacts}——话术区分对经办人（讲配合与省事）和对决策人（讲价值与风险）两种口吻。` : '',
      recent ? `最近跟进记录：${recent}` : `暂无历史跟进记录（首次接触）。`,
      `要求：给两个版本——①简短微信消息版（100字内）②正式电话/拜访开场版；产品口径从 knowledge/products/ 取，语气专业克制不浮夸；只在对话里输出，不用写文件。`
    ]
      .filter(Boolean)
      .join('\n')
  }

  return (
    <div className="flex h-full">
      {/* 左：工作区 */}
      <div className="flex min-w-0 flex-1 flex-col border-r border-slate-200">
        <div className="app-drag flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
          <div className="app-no-drag flex gap-1">
            {(['产品库', '选型', '报价单', '客户'] as SalesTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  tab === t ? 'bg-jushi-accent text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {t}
                {t === '报价单' && cart.length > 0 && (
                  <span className="ml-1 rounded-full bg-white/25 px-1.5 text-xs">{cart.length}</span>
                )}
              </button>
            ))}
          </div>
          <div className="app-no-drag">
            <HelpButton content={HELP_CONTENT.sales} />
          </div>
        </div>

        <div
          className={
            tab === '产品库'
              ? 'flex min-h-0 flex-1 flex-col overflow-hidden p-4'
              : 'flex-1 overflow-y-auto p-4'
          }
        >
          {/* ============ 产品库 ============ */}
          {tab === '产品库' && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜产品 / 品牌 / 型号 / 分类 / 制造商 / 参数，空格隔开多个关键词…"
                  title="分类可直接搜：分类名（摄像机与云台）或规范编码（E / E1）都能命中"
                  autoFocus
                  className="w-80 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-jushi-accent"
                />
                <div className="flex items-center gap-1 text-xs text-slate-400">
                  <input
                    value={priceMin}
                    onChange={(e) => setPriceMin(e.target.value)}
                    placeholder="价格≥"
                    className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-jushi-accent"
                  />
                  <span>—</span>
                  <input
                    value={priceMax}
                    onChange={(e) => setPriceMax(e.target.value)}
                    placeholder="价格≤"
                    className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-jushi-accent"
                  />
                </div>
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-600 outline-none"
                >
                  {SORT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => void handleImportMemberCatalog()}
                  disabled={busy}
                  title="导入产品库 Excel，只写当前电脑的数据目录，不会联网同步"
                  className="rounded-lg border border-sky-300 px-3 py-1.5 text-sm text-jushi-accent hover:bg-sky-50 disabled:opacity-50"
                >
                  📥 导入产品库 Excel
                </button>
                <button
                  onClick={() => void handleExportMemberCatalog()}
                  disabled={busy || products.length === 0}
                  title="导出可交付给其他成员的产品库 Excel（不含成本、供应商与联系人）"
                  className="rounded-lg border border-emerald-300 px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                >
                  📤 导出产品库 Excel
                </button>
                <button
                  onClick={() => handleUploadDocs('supplier')}
                  disabled={busy}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  📎 供应商资料
                </button>
                <button
                  onClick={() => {
                    setShowAddForm((v) => !v)
                    setEditingId(null)
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                >
                  ＋ 手动添加
                </button>
                <button
                  disabled={busy || sortedProducts.length === 0}
                  onClick={async () => {
                    if (typeof window.api.sales.exportZcy !== 'function') {
                      flash('⚠ 当前运行的 App 主程序版本过旧——请完全退出（Cmd+Q）重新打开')
                      return
                    }
                    setBusy(true)
                    try {
                      const r = await window.api.sales.exportZcy(sortedProducts.map((p) => p.id))
                      flash((r.ok ? '✅ ' : '⚠ ') + r.说明)
                      if (r.ok && r.outDir) await window.api.shell.showItemInFolder(r.outDir)
                    } catch (err) {
                      flash(err instanceof Error ? err.message : String(err))
                    } finally {
                      setBusy(false)
                    }
                  }}
                  title="把当前筛选出的产品导出为政采云上架数据包：商品清单xlsx（含品目甄别打标：管制标红/需资质标黄）+ 按型号规范命名的主图图片包 + 使用说明。对照官方类目模板粘贴导入即可。"
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  🛒 政采云导出
                </button>
                <button
                  onClick={refreshProducts}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                  title="重新读取产品库（会顺带合并 AI 解析的暂存结果）"
                >
                  ↻
                </button>
                <span className="text-xs text-slate-400">共 {products.length} 条</span>
              </div>

              {previews.map((preview, i) => (
                <div key={`${preview.relativePath}-${i}`} className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 text-xs text-slate-600">
                      <p className="font-medium">
                        {preview.mode === 'bid' ? '🏷️' : '📄'} {preview.fileName}
                        {preview.mode === 'bid' && <span className="ml-1.5 rounded bg-purple-100 px-1.5 py-0.5 text-purple-600">投标报价识别</span>}
                      </p>
                      {preview.fieldMapping ? (
                        <p className="mt-1">
                          已机械识别表头（
                          {Object.entries(preview.fieldMapping)
                            .map(([field, col]) => `${field}←“${preview.headers?.[col as number] ?? ''}”`)
                            .join('、')}
                          ），可导入 {preview.importableRows} 行
                          {preview.importableSheets && preview.importableSheets.length > 1 ? `（${preview.importableSheets.length} 个工作表：${preview.importableSheets.join('、')}）` : ''}
                          ——直接导入不消耗 AI 额度。
                        </p>
                      ) : (
                        <p className="mt-1">该文件无法机械识别表头，需要 AI 解析（sales 分身提取后由 App 校验入库）。</p>
                      )}
                      {matchExistingSuppliers(preview.fileName, products).map((h) => (
                        <p key={h.名称} className="mt-1 rounded bg-rose-50 px-1.5 py-1 font-medium text-rose-600">
                          ⚠ 复核：产品库已有来自「{h.名称}」的 {h.产品数} 条产品——若是同一批资料请勿重复导入；
                          若是更新版报价可继续导入（按 品名+型号 合并更新，不会重复建条目）。
                        </p>
                      ))}
                    </div>
                    <button onClick={() => setPreviews((prev) => prev.filter((x) => x !== preview))} className="shrink-0 text-slate-400 hover:text-slate-600">
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 flex gap-2">
                    {preview.fieldMapping && (
                      <button
                        onClick={() => {
                          const hits = matchExistingSuppliers(preview.fileName, products)
                          if (hits.length > 0 && !window.confirm(`产品库已有「${hits.map((h) => h.名称).join('、')}」的产品共 ${hits.reduce((s, h) => s + h.产品数, 0)} 条。\n\n确认继续导入吗？（同 品名+型号 会合并更新，不会重复）`)) return
                          handleDirectImport(preview)
                        }}
                        disabled={busy}
                        className="rounded-md bg-jushi-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                      >
                        直接导入 {preview.importableRows} 行{preview.importableSheets && preview.importableSheets.length > 1 ? `（${preview.importableSheets.length} 个 Sheet）` : ''}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const hits = matchExistingSuppliers(preview.fileName, products)
                        if (hits.length > 0 && !window.confirm(`产品库已有「${hits.map((h) => h.名称).join('、')}」的产品共 ${hits.reduce((s, h) => s + h.产品数, 0)} 条。\n\n确认继续 AI 解析入库吗？（重复条目会按 品名+型号 合并）`)) return
                        setPendingPrompt(buildParsePrompt(preview))
                        setPreviews((prev) => prev.filter((x) => x !== preview))
                      }}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:border-jushi-accent hover:text-jushi-accent"
                    >
                      🤖 AI 解析入库
                    </button>
                    {preview.fileName.toLowerCase().endsWith('.pdf') && (
                      <button
                        onClick={async () => {
                          if (typeof window.api.sales.genPdfQuoteList !== 'function') {
                            flash('⚠ 当前运行的 App 主程序版本过旧——请完全退出（Cmd+Q）重新打开；若仍提示，请在「设置 → 关于与更新」升级到最新版')
                            return
                          }
                          try {
                            const r = await window.api.sales.genPdfQuoteList(preview.fileName)
                            if (r.ok && r.outPath) {
                              flash(`✅ ${r.说明}`)
                              await window.api.shell.showItemInFolder(r.outPath)
                            } else if (r.needExtract) {
                              setPendingPrompt(buildPdfQuoteListPrompt(preview, r.jsonRel))
                              flash('已让分身读 PDF 提取产品条目——分身完成后，再点一次「生成报价清单」即可出 xlsx')
                            } else {
                              flash(r.说明)
                            }
                          } catch (err) {
                            flash(err instanceof Error ? err.message : String(err))
                          }
                        }}
                        title="产品手册类 PDF：分身读 PDF 提取 产品名称/分类/品牌/型号/页码 → App 按《供应商报价清单》模板生成 xlsx 骨架（价格等留空待人工）。第一次点让分身提取，提取完成后再点一次生成"
                        className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:border-jushi-accent hover:text-jushi-accent"
                      >
                        📋 生成报价清单
                      </button>
                    )}
                    {preview.fileName.toLowerCase().endsWith('.pdf') &&
                      (() => {
                        const f = preview.fileName
                        const cat = catalogFlow[f]
                        const busyStage = cat?.stage === 'extracting' || cat?.stage === 'applying'
                        const label =
                          cat?.stage === 'extracting'
                            ? '⏳ ① 抽取配对中…'
                            : cat?.stage === 'applying'
                              ? '⏳ ② 定稿出图中…'
                              : cat?.stage === 'done'
                                ? '📂 查看成品图'
                                : '📖 画册抠图'
                        return (
                          <button
                            disabled={busyStage}
                            onClick={async () => {
                              if (
                                typeof window.api.sales.extractPdfCatalog !== 'function' ||
                                typeof window.api.sales.applyCatalogPairing !== 'function'
                              ) {
                                setCatalog(f, { stage: 'error', text: '⚠ 当前运行的 App 主程序版本过旧——请完全退出（Cmd+Q）重新打开；若仍提示，请在「设置 → 关于与更新」升级到最新版' })
                                return
                              }
                              if (cat?.stage === 'done' && cat.outDir) {
                                await window.api.shell.showItemInFolder(cat.outDir)
                                return
                              }
                              try {
                                // 全自动纯机械：抽取(含 文本层/OCR 自动配对) → 立即定稿出图，不经过分身、无需任何人工步骤
                                setCatalog(f, { stage: 'extracting', text: '① 机械抽取+自动配对中（抠产品图、识别型号/名称）。扫描版画册会做整页 OCR，约 1-3 分钟，请勿关闭窗口…' })
                                const r = await window.api.sales.extractPdfCatalog(f)
                                if (!r.ok) {
                                  setCatalog(f, { stage: 'error', text: '⚠ ' + r.说明 })
                                  return
                                }
                                setCatalog(f, { stage: 'applying', text: `① 完成：${r.pages} 页、自动配对 ${r.autoPaired ?? 0} 个产品。② 正在定稿出图并清理中间产物…` })
                                const a = await window.api.sales.applyCatalogPairing(f)
                                if (a.ok) {
                                  const note = r.degraded
                                    ? '。⚠ 本画册无文本层且 OCR 不可用，产品名称留空（文件名仅含序号和页码）——Mac 终端执行 pip3 install ocrmac 后重试可自动识别名称'
                                    : r.usedOcr
                                      ? '。名称由系统 OCR 从扫描页识别，个别字可能有误差，可直接改文件名修正'
                                      : ''
                                  setCatalog(f, {
                                    stage: 'done',
                                    outDir: a.outDir,
                                    text: `✅ 全自动完成：已产出 ${a.count ?? '?'} 张成品图 ＋ 产品清单.xlsx（名称/型号/技术参数已填、品牌/制造商按画册自动补全、抠图已嵌入表格，缺型号的行标黄待补；发供应商补价后可「直接导入」产品库），中间产物已清理${note}` +
                                      (a.missing && a.missing.length > 0 ? `；${a.missing.length} 条未命中：${a.missing.slice(0, 3).join('、')}` : '')
                                  })
                                  if (a.outDir) await window.api.shell.showItemInFolder(a.outDir)
                                } else {
                                  setCatalog(f, { stage: 'error', text: '⚠ ' + a.说明 })
                                }
                              } catch (err) {
                                setCatalog(f, { stage: 'error', text: '⚠ ' + (err instanceof Error ? err.message : String(err)) })
                              }
                            }}
                            title="产品画册一键全自动（纯机械，不依赖 AI 模型）：抠出每个产品照 + 用文本层/系统OCR识别型号名称自动配对 → 直出成品图（序号_型号_产品名称_P页.jpg）＋ 产品清单.xlsx（按供应商资料解析模板：名称/型号/技术参数已填、备注含手册页码、最后一列对应成品图文件名），中间产物自动清理。"
                            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:border-jushi-accent hover:text-jushi-accent disabled:opacity-60"
                          >
                            {label}
                          </button>
                        )
                      })()}
                  </div>
                  {catalogFlow[preview.fileName] && (
                    <p
                      className={`mt-2 rounded-md px-2.5 py-1.5 text-[11px] leading-relaxed ${
                        catalogFlow[preview.fileName].stage === 'done'
                          ? 'bg-emerald-50 text-emerald-700'
                          : catalogFlow[preview.fileName].stage === 'error'
                            ? 'bg-red-50 text-red-600'
                            : 'bg-sky-50 text-sky-800'
                      }`}
                    >
                      {catalogFlow[preview.fileName].text}
                    </p>
                  )}
                </div>
              ))}

              {(showAddForm || editingId) && (
                <ProductForm
                  initial={editingId ? (products.find((p) => p.id === editingId) ?? EMPTY_PRODUCT_FORM) : EMPTY_PRODUCT_FORM}
                  catDict={catDict}
                  onSave={async (fields) => {
                    await window.api.sales.saveProduct(fields, editingId ?? undefined)
                    setShowAddForm(false)
                    setEditingId(null)
                    await refreshProducts()
                  }}
                  onCancel={() => {
                    setShowAddForm(false)
                    setEditingId(null)
                  }}
                />
              )}

              <div className="flex min-h-0 flex-1 items-stretch gap-3">
                {/* 左侧分类导航（可隐藏） */}
                {showCatNav ? (
                  <div className="h-full w-44 shrink-0 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5">
                    <div className="mb-1 flex items-center justify-between px-1.5">
                      <span className="text-[11px] font-medium text-slate-400">分类</span>
                      <button
                        onClick={() => setShowCatNav(false)}
                        title="隐藏分类栏"
                        className="text-slate-400 hover:text-jushi-accent"
                      >
                        «
                      </button>
                    </div>
                    <button
                      onClick={() => setCategoryFilter('全部')}
                      className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs ${
                        categoryFilter === '全部' ? 'bg-jushi-accent/10 font-medium text-jushi-accent' : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span>全部产品</span>
                      <span className="text-slate-400">{products.length}</span>
                    </button>
                    {(function renderCats(nodes: CatNode[], depth: number): React.JSX.Element[] {
                      return nodes.map((n) => {
                        const open = expandedCats.has(n.key) || categoryFilter.startsWith(n.key)
                        return (
                          <Fragment key={n.key}>
                            <div
                              className={`flex w-full cursor-pointer items-center justify-between rounded-md py-1.5 pr-2.5 text-left text-xs ${
                                categoryFilter === n.key
                                  ? 'bg-jushi-accent/10 font-medium text-jushi-accent'
                                  : 'text-slate-600 hover:bg-slate-50'
                              }`}
                              style={{ paddingLeft: 10 + depth * 14 }}
                              onClick={() => {
                                setCategoryFilter(n.key)
                                if (n.children.length > 0)
                                  setExpandedCats((prev) => {
                                    const next = new Set(prev)
                                    next.add(n.key)
                                    return next
                                  })
                              }}
                            >
                              <span className="flex min-w-0 items-center gap-0.5">
                                {n.children.length > 0 && (
                                  <span
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setExpandedCats((prev) => {
                                        const next = new Set(prev)
                                        if (next.has(n.key)) next.delete(n.key)
                                        else next.add(n.key)
                                        return next
                                      })
                                    }}
                                    className="shrink-0 text-slate-400 hover:text-jushi-accent"
                                    title={open ? '收起子分类' : '展开子分类'}
                                  >
                                    {open ? '▾' : '▸'}
                                  </span>
                                )}
                                <span className="truncate" title={catCodeByName.get(n.name) ? `${catCodeByName.get(n.name)} ${n.name}` : n.name}>
                                  {catCodeByName.has(n.name) && (
                                    <span className="mr-1 text-[10px] text-slate-400">{catCodeByName.get(n.name)}</span>
                                  )}
                                  {n.name}
                                </span>
                              </span>
                              <span className="ml-1 shrink-0 text-slate-400">{n.count}</span>
                            </div>
                            {open && n.children.length > 0 && renderCats(n.children, depth + 1)}
                          </Fragment>
                        )
                      })
                    })(categoryTree, 0)}
                  </div>
                ) : (
                  <button
                    onClick={() => setShowCatNav(true)}
                    title="显示分类栏"
                    className="shrink-0 self-start rounded-lg border border-slate-200 bg-white px-1.5 py-2 text-slate-400 hover:text-jushi-accent"
                  >
                    »
                  </button>
                )}

                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="h-full min-h-0 overflow-auto rounded-lg border border-slate-200">
                <table
                  className="table-fixed text-xs"
                  style={{ width: PROD_COLS.reduce((s, c) => s + (colW[c.key] ?? 100), 0) }}
                >
                  <colgroup>
                    {PROD_COLS.map((c) => (
                      <col key={c.key} style={{ width: colW[c.key] ?? 100 }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-50 text-left text-slate-500">
                      {PROD_COLS.map((c) => (
                        <th key={c.key} className="relative select-none px-2 py-1.5 font-medium">
                          {c.label}
                          <span
                            onMouseDown={(e) => startResize(c.key, e)}
                            title="拖拽调整列宽"
                            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-jushi-accent/40"
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProducts.map((p) => (
                      <Fragment key={p.id}>
                        <tr className="h-[20px] border-t border-slate-100 align-middle hover:bg-slate-50">
                          <td className="px-2 py-0.5">
                            {p.图片 && dataDir ? (
                              <img
                                src={appfileUrl(`${dataDir}/${p.图片}`)}
                                className="h-7 w-7 cursor-pointer rounded object-cover"
                                title="点击打开产品图片所在文件夹"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void window.api.shell.showItemInFolder(`${dataDir}/${p.图片}`)
                                }}
                                onDoubleClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <button
                                onClick={() => handleSetImage(p.id)}
                                title="上传产品图片"
                                className="flex h-7 w-7 items-center justify-center rounded border border-dashed border-slate-300 text-[10px] text-slate-300 hover:border-jushi-accent hover:text-jushi-accent"
                              >
                                +图
                              </button>
                            )}
                          </td>
                          <td className="truncate px-2 py-0.5 text-slate-500" title={p.品牌}>
                            {p.品牌 || '—'}
                          </td>
                          <td className="truncate px-2 py-0.5" title={p.产品名称}>
                            <span className="font-medium text-slate-700">{p.产品名称}</span>
                          </td>
                          <td className="truncate px-2 py-0.5 text-slate-500" title={p.型号}>
                            {p.型号 || '—'}
                          </td>
                          <td className="truncate px-2 py-0.5 text-slate-500" title={p.生产制造商}>
                            {p.生产制造商 || '—'}
                          </td>
                          <td className="truncate px-2 py-0.5 text-slate-500" title={p.产地}>
                            {p.产地 || '—'}
                          </td>
                          <td
                            className="truncate px-2 py-0.5 text-slate-500"
                            title={catCodeOf(p) ? `${catCodeOf(p)} ${catParts(p)[0] ?? ''}` : (catParts(p)[0] ?? '')}
                          >
                            {catParts(p)[0] === '未分类' ? '—' : (catParts(p)[0] || '—')}
                          </td>
                          <td className="truncate px-2 py-0.5 text-slate-500" title={catParts(p)[1]}>
                            {catParts(p)[1] || '—'}
                          </td>
                          <td className="px-1 py-0.5">
                            <div
                              onDoubleClick={() => setExpandedId((cur) => (cur === p.id ? null : p.id))}
                              title="双击显示完整技术参数；修改请点右侧“编辑”"
                              className="cursor-pointer truncate text-slate-500 hover:text-slate-700"
                            >
                              {p.技术参数 || <span className="text-slate-300">双击查看/编辑</span>}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-2 py-0.5 text-slate-500">{fmtTaxRate(p.税率)}</td>
                          <td className="whitespace-nowrap px-2 py-0.5 text-slate-500">{p.成本价 || '—'}</td>
                          <td className="whitespace-nowrap px-2 py-0.5 text-slate-700">{p.建议销售价 || '—'}</td>
                          <td className="whitespace-nowrap px-2 py-0.5">
                            <button onClick={() => addToCart(p)} className="mr-1.5 text-jushi-accent hover:underline">
                              加入
                            </button>
                            <button
                              onClick={() => setExpandedId((cur) => (cur === p.id ? null : p.id))}
                              className={`mr-1.5 ${expandedId === p.id ? 'text-jushi-accent' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                              更多{expandedId === p.id ? '▴' : '▾'}
                            </button>
                            <button
                              onClick={() => {
                                setEditingId(p.id)
                                setShowAddForm(false)
                              }}
                              className="mr-1.5 text-slate-400 hover:text-slate-600"
                            >
                              编辑
                            </button>
                            <button
                              onClick={async () => {
                                if (!window.confirm(`确认删除产品「${p.产品名称}」吗？此操作会同时移除该产品关联的图片。`)) return
                                try {
                                  await window.api.sales.removeProduct(p.id)
                                  await refreshProducts()
                                  flash(`已删除「${p.产品名称}」`)
                                } catch (err) {
                                  flash(err instanceof Error ? err.message : String(err))
                                }
                              }}
                              className="text-slate-300 hover:text-red-500"
                            >
                              删除
                            </button>
                          </td>
                        </tr>
                        {expandedId === p.id && (
                          <tr className="border-t border-slate-100 bg-slate-50/60">
                            <td colSpan={PROD_COLS.length} className="px-3 py-2">
                              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-600 md:grid-cols-3">
                                {(
                                  [
                                    ['分类', catCodeOf(p) ? `${catCodeOf(p)} ${catText(p)}` : catText(p)],
                                    ['瑾智型号', p.瑾智型号],
                                    ['单位', p.单位],
                                    ['质保期', p.质保期 ? `${p.质保期} 个月` : ''],
                                    ['交货期', p.交货期],
                                    ['物料代码', p.物料代码],
                                    ['投标报价', p.投标报价],
                                    ['备注', p.备注 ?? '']
                                  ] as [string, string][]
                                )
                                  .filter(([, v]) => v)
                                  .map(([k, v]) => (
                                    <p key={k}>
                                      <span className="mr-1 text-slate-400">{k}：</span>
                                      {v}
                                    </p>
                                  ))}
                              </div>
                              {(p.供应商名称 || p.供应商联系人 || p.供应商联系方式) && (
                                <p className="mt-1.5 text-xs text-slate-400" title="采购侧信息，仅内部可见，绝不进对外报价">
                                  供应商（内部）：{p.供应商名称 || '—'}
                                  {(p.供应商联系人 || p.供应商联系方式) &&
                                    ` · ${[p.供应商联系人, p.供应商联系方式].filter(Boolean).join(' / ')}`}
                                </p>
                              )}
                              {p.技术参数 && (
                                <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-slate-500">
                                  <span className="text-slate-400">技术参数：</span>
                                  {p.技术参数}
                                </p>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                    {filteredProducts.length === 0 && (
                      <tr>
                        <td colSpan={PROD_COLS.length} className="px-2 py-6 text-center text-slate-400">
                          {products.length === 0 ? '产品库为空——请导入产品库 Excel、上传供应商资料或手动添加' : '没有匹配的产品'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
                </div>
              </div>
            </div>
          )}

          {/* ============ 选型（按需求+预算快速筛选） ============ */}
          {tab === '选型' && (
            <>
              <div className="mb-3 grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="mb-0.5 block text-xs text-slate-400">
                    客户采购需求清单（一行一条，行尾可加数量如「执法记录仪 x20」）
                  </label>
                  <textarea
                    value={needsText}
                    onChange={(e) => setNeedsText(e.target.value)}
                    rows={5}
                    placeholder={'例如：\n单警执法记录仪 x20\n4G布控球\n防暴头盔 x50'}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-jushi-accent"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-slate-400">采购预算（元，可选）</label>
                  <input
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    placeholder="如 200000"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-jushi-accent"
                  />
                  <label
                    className={`mt-1.5 flex items-center gap-1.5 text-xs ${
                      budgetNum === null ? 'text-slate-300' : 'cursor-pointer text-slate-500'
                    }`}
                    title="按候选的报价参考单价×本条数量与预算比对，只保留预算内的候选"
                  >
                    <input
                      type="checkbox"
                      disabled={budgetNum === null}
                      checked={onlyInBudget}
                      onChange={(e) => setOnlyInBudget(e.target.checked)}
                    />
                    只看预算内候选
                  </label>
                  <div className="mt-2 flex flex-col gap-1.5">
                    <button
                      onClick={handleMatchNeeds}
                      className="rounded-lg bg-jushi-accent px-3 py-2 text-sm font-medium text-white"
                    >
                      🔍 匹配产品库
                    </button>
                    <button
                      onClick={() => needsText.trim() && setPendingPrompt(buildRecommendPrompt())}
                      disabled={!needsText.trim()}
                      title="把需求清单和预算交给 sales 分身做专业选型推荐（消耗 AI 额度）"
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    >
                      🤖 让分身推荐
                    </button>
                  </div>
                </div>
              </div>

              {needMatches.length > 0 && (
                <>
                  <div className="space-y-2">
                    {needMatches.map((m, mi) => (
                      <div key={mi} className="rounded-lg border border-slate-200 bg-white p-3">
                        {(() => {
                          const shown = onlyInBudget
                            ? m.candidates.filter(({ product }) => candidateInBudget(product, m.qty) !== false)
                            : m.candidates
                          const hidden = m.candidates.length - shown.length
                          return (
                            <>
                              <div className="mb-1.5 flex items-center gap-2">
                                <span className="text-sm font-medium text-slate-700">{m.need}</span>
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">x{m.qty}</span>
                                {m.candidates.length === 0 && (
                                  <span className="text-xs text-amber-600">产品库里没匹配到——换个关键词，或点「让分身推荐」</span>
                                )}
                                {hidden > 0 && (
                                  <span className="text-xs text-slate-400">已按预算隐藏 {hidden} 个超预算候选</span>
                                )}
                              </div>
                              <div className="space-y-1">
                                {shown.map(({ product: p }) => {
                                  const chosen = m.chosenIds.includes(p.id)
                                  const inBudget = candidateInBudget(p, m.qty)
                                  return (
                                    <label
                                      key={p.id}
                                      className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                                        chosen ? 'border-jushi-accent bg-jushi-accent/5' : 'border-slate-200 hover:border-slate-300'
                                      }`}
                                    >
                                      <input type="checkbox" checked={chosen} onChange={() => toggleChosen(mi, p.id)} />
                                      <span className="font-medium text-slate-700">{p.产品名称}</span>
                                      <span className="text-slate-400">{[p.品牌, p.型号].filter(Boolean).join(' · ')}</span>
                                      {inBudget !== null && (
                                        <span
                                          className={`rounded px-1 py-0.5 text-[10px] ${
                                            inBudget ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
                                          }`}
                                          title="按报价参考单价×本条数量与采购预算比对"
                                        >
                                          {inBudget ? '预算内' : '超预算'}
                                        </span>
                                      )}
                                      <span className="ml-auto whitespace-nowrap text-slate-500">
                                        报价参考 {defaultQuotePrice(p) || '—'}
                                      </span>
                                      <span className="whitespace-nowrap text-slate-400" title="进价，仅内部参考">
                                        进价 {p.成本价 || '—'}
                                      </span>
                                      <span className="whitespace-nowrap text-slate-400">{p.供应商名称 || ''}</span>
                                    </label>
                                  )
                                })}
                                {shown.length === 0 && m.candidates.length > 0 && (
                                  <p className="px-2 text-[11px] text-amber-600">这条需求下没有预算内候选——放宽预算或取消「只看预算内」</p>
                                )}
                                {m.candidates.length > 1 && (
                                  <p className="px-2 text-[11px] text-slate-400">可勾选多个（如同款多供应商都要报价），不勾则本条不加入</p>
                                )}
                              </div>
                            </>
                          )
                        })()}
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <span className="text-sm">
                      {chosenTotal !== null ? (
                        <>
                          <span className="text-slate-600">已选合计（按默认报价估算）：¥ {chosenTotal.toLocaleString()}</span>
                          {budgetNum !== null && (
                            <span className={`ml-2 font-medium ${chosenTotal > budgetNum ? 'text-red-600' : 'text-emerald-600'}`}>
                              {chosenTotal > budgetNum
                                ? `超预算 ¥ ${(chosenTotal - budgetNum).toLocaleString()}`
                                : `预算内，剩余 ¥ ${(budgetNum - chosenTotal).toLocaleString()}`}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400">部分选中产品价格非数字，合计以报价单页为准</span>
                      )}
                    </span>
                    <button
                      onClick={addChosenToCart}
                      disabled={!needMatches.some((m) => m.chosenIds.length > 0)}
                      className="rounded-lg bg-jushi-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                    >
                      ➕ 加入报价单
                    </button>
                  </div>
                </>
              )}
              {needMatches.length === 0 && (
                <p className="py-8 text-center text-xs text-slate-400">
                  输入客户需求清单后点「匹配产品库」——按产品名/品牌/型号/分类/参数即时打分匹配，不消耗 AI 额度
                </p>
              )}
            </>
          )}

          {/* ============ 报价单 ============ */}
          {tab === '报价单' && (
            <>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-0.5 block text-xs text-slate-400">关联客户（可选，也可直接手填）</label>
                  <div className="flex gap-2">
                    <select
                      value=""
                      onChange={(e) => e.target.value && setQuoteCustomer(e.target.value)}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-600 outline-none"
                    >
                      <option value="">从客户库选…</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.客户名称}>
                          {c.客户名称}
                        </option>
                      ))}
                    </select>
                    <input
                      value={quoteCustomer}
                      onChange={(e) => setQuoteCustomer(e.target.value)}
                      placeholder="客户名称"
                      className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-jushi-accent"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-slate-400">项目名称（可选，会写进报价单抬头）</label>
                  <input
                    value={quoteProject}
                    onChange={(e) => setQuoteProject(e.target.value)}
                    placeholder="如 市公安局巡特警智能化装备采购"
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-jushi-accent"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-slate-400">报价模板（可选）</label>
                  <div className="flex gap-2">
                    <select
                      value={selectedTemplate}
                      onChange={(e) => setSelectedTemplate(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-600 outline-none"
                    >
                      <option value="">不用模板（标准报价单结构）</option>
                      {templates.map((t) => (
                        <option key={t.fileName} value={t.fileName}>
                          {t.fileName}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={async () => {
                        const paths = await window.api.dialog.pickFiles(TEMPLATE_FILTERS)
                        for (const p of paths) {
                          const t = await window.api.sales.uploadTemplate(p)
                          if (t) setSelectedTemplate(t.fileName)
                        }
                        await refreshTemplates()
                      }}
                      className="shrink-0 rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      📎 上传模板
                    </button>
                  </div>
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-slate-400">客户预算（元，可选）</label>
                  <input
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    placeholder="用于对比合计，不会写进报价"
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-jushi-accent"
                  />
                </div>
              </div>

              <div className="max-h-[calc(100vh-385px)] overflow-auto rounded-lg border border-slate-200">
                <table
                  className="table-fixed text-xs"
                  style={{ width: QUOTE_COLS.reduce((s, c) => s + (colW[c.key] ?? 100), 0) }}
                >
                  <colgroup>
                    {QUOTE_COLS.map((c) => (
                      <col key={c.key} style={{ width: colW[c.key] ?? 100 }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-50 text-left text-slate-500">
                      {QUOTE_COLS.map((c) => (
                        <th key={c.key} title={c.title} className="relative select-none px-2 py-1.5 font-medium">
                          {c.label}
                          <span
                            onMouseDown={(e) => startResize(c.key, e)}
                            title="拖拽调整列宽"
                            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-jushi-accent/40"
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((line) => {
                      const price = parseFloat(line.报价单价.replace(/[^\d.]/g, ''))
                      const qty = parseFloat(line.数量)
                      const subtotal = isFinite(price) && isFinite(qty) ? price * qty : null
                      const std = priceNum(line.product.建议销售价)
                      const rate = std !== null && std > 0 && isFinite(price) ? (price / std) * 100 : null
                      return (
                        <tr key={line.product.id} className="h-[20px] border-t border-slate-100 align-middle">
                          <td className="px-2 py-0.5">
                            {line.product.图片 && dataDir ? (
                              <img src={appfileUrl(`${dataDir}/${line.product.图片}`)} className="h-7 w-7 rounded object-cover" />
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="max-w-40 truncate px-2 py-0.5 font-medium text-slate-700" title={line.product.产品名称}>
                            {line.product.产品名称}
                          </td>
                          <td className="max-w-28 truncate px-2 py-0.5 text-slate-500">
                            {[line.product.品牌, line.product.供应商名称].filter(Boolean).join(' / ') || '—'}
                          </td>
                          <td className="whitespace-nowrap px-2 py-0.5 text-slate-500">{line.product.单位 || '—'}</td>
                          <td className="px-2 py-0.5">
                            <input
                              value={line.数量}
                              onChange={(e) =>
                                setCart((prev) =>
                                  prev.map((l) => (l.product.id === line.product.id ? { ...l, 数量: e.target.value } : l))
                                )
                              }
                              className="w-11 rounded border border-slate-300 px-1 py-0.5 text-xs outline-none focus:border-jushi-accent"
                            />
                          </td>
                          <td className="whitespace-nowrap px-2 py-0.5 text-slate-500">{fmtTaxRate(line.product.税率)}</td>
                          <td className="whitespace-nowrap px-2 py-0.5 text-slate-500">
                            {line.product.质保期 ? `${line.product.质保期}个月` : '—'}
                          </td>
                          <td className="whitespace-nowrap px-2 py-0.5 text-slate-400">{line.product.建议销售价 || '—'}</td>
                          <td className="px-2 py-0.5">
                            {std !== null && std > 0 ? (
                              <div className="flex items-center gap-0.5">
                                <input
                                  value={rate !== null ? (Math.round(rate * 10) / 10).toString() : ''}
                                  onChange={(e) => {
                                    const r = parseFloat(e.target.value)
                                    if (!isFinite(r)) return
                                    const newPrice = (std * r) / 100
                                    setCart((prev) =>
                                      prev.map((l) =>
                                        l.product.id === line.product.id
                                          ? { ...l, 报价单价: String(Math.round(newPrice * 100) / 100) }
                                          : l
                                      )
                                    )
                                  }}
                                  className="w-10 rounded border border-slate-300 px-1 py-0.5 text-right text-xs outline-none focus:border-jushi-accent"
                                />
                                <span className="text-slate-400">%</span>
                              </div>
                            ) : (
                              <span className="text-slate-300" title="没有标准价（建议销售价），无法按折扣率算价">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-0.5">
                            <input
                              value={line.报价单价}
                              onChange={(e) =>
                                setCart((prev) =>
                                  prev.map((l) => (l.product.id === line.product.id ? { ...l, 报价单价: e.target.value } : l))
                                )
                              }
                              className="w-20 rounded border border-slate-300 px-1.5 py-0.5 text-xs outline-none focus:border-jushi-accent"
                            />
                          </td>
                          <td className="whitespace-nowrap px-2 py-0.5 text-slate-400" title="采购成本，仅内部参考，不会写进报价文件">
                            {line.product.成本价 || '—'}
                          </td>
                          <td className="whitespace-nowrap px-2 py-0.5 text-slate-600">{subtotal !== null ? subtotal.toFixed(2) : '—'}</td>
                          <td className="px-2 py-0.5">
                            <button
                              onClick={() => setCart((prev) => prev.filter((l) => l.product.id !== line.product.id))}
                              className="text-slate-300 hover:text-red-500"
                            >
                              移除
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                    {cart.length === 0 && (
                      <tr>
                        <td colSpan={13} className="px-2 py-6 text-center text-slate-400">
                          报价单为空——到「产品库」里查询产品并点「加入报价单」
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm text-slate-600">
                  {cartTotal !== null ? (
                    <>
                      合计（估算）：¥ {cartTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      {budgetNum !== null && (
                        <span className={`ml-2 font-medium ${cartTotal > budgetNum ? 'text-red-600' : 'text-emerald-600'}`}>
                          {cartTotal > budgetNum
                            ? `超预算 ¥ ${(cartTotal - budgetNum).toLocaleString()}`
                            : `预算内，剩余 ¥ ${(budgetNum - cartTotal).toLocaleString()}`}
                        </span>
                      )}
                      {cartMargin !== null && (
                        <span className="ml-2 text-xs text-slate-400" title="按成本价估算，仅内部参考，不会出现在报价文件里">
                          毛利估算(内部)：¥ {cartMargin.毛利.toLocaleString(undefined, { maximumFractionDigits: 0 })}（
                          {cartMargin.毛利率.toFixed(1)}%）
                        </span>
                      )}
                    </>
                  ) : cart.length > 0 ? (
                    '合计：单价含非数字内容，生成时在文件里标注'
                  ) : (
                    ''
                  )}
                </span>
                <div className="flex items-center gap-2">
                  {cart.length > 0 && (
                    <div className="flex items-center gap-1 text-xs text-slate-500" title="对有标准价的行统一按折扣率重算报价单价">
                      <span>整单折扣</span>
                      <input
                        value={bulkRate}
                        onChange={(e) => setBulkRate(e.target.value)}
                        placeholder="95"
                        className="w-12 rounded border border-slate-300 px-1 py-1 text-right outline-none focus:border-jushi-accent"
                      />
                      <span>%</span>
                      <button
                        onClick={() => {
                          const r = parseFloat(bulkRate)
                          if (!isFinite(r) || r <= 0) {
                            flash('先填一个有效的折扣率，如 95')
                            return
                          }
                          let applied = 0
                          setCart((prev) =>
                            prev.map((l) => {
                              const std = priceNum(l.product.建议销售价)
                              if (std === null || std <= 0) return l
                              applied++
                              return { ...l, 报价单价: String(Math.round(std * r) / 100) }
                            })
                          )
                          flash(`已按 ${r}% 重算 ${applied} 行报价（无标准价的行未动）`)
                        }}
                        className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                      >
                        应用
                      </button>
                    </div>
                  )}
                  <button
                    disabled={cart.length === 0 || busy}
                    onClick={handleGenerateQuoteXlsx}
                    title="不经过 AI，秒出 Excel：选了 .xlsx 模板就往模板里填行（保留模板抬头/报价说明/落款），否则用内置标准版式；自动随附产品图、登记报价台账并关联同名客户"
                    className="rounded-lg bg-jushi-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                  >
                    ⚡ 生成报价单
                  </button>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                报价单价默认取建议销售价（缺失时退投标报价/成本价，注意核对加价）。品牌列只取产品的「品牌」字段，成本价与供应商信息绝不会写进对外报价。
                内置版式会内嵌产品缩略图，并把原图导出到报价目录的 图片/ 子文件夹；每张报价单自动登记进 libraries/01_销售_sales/报价台账.json（进销存的单据源头）。
              </p>
            </>
          )}

          {/* ============ 客户（CRM） ============ */}
          {tab === '客户' && (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <input
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  placeholder="搜客户 / 项目 / 联系人…"
                  className="w-52 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-jushi-accent"
                />
                <button
                  onClick={() => {
                    setShowCustomerForm((v) => !v)
                    setSelectedCustomerId(null)
                  }}
                  className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                >
                  ＋ 新客户
                </button>
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setCustomerFilter('待跟进')}
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    customerFilter === '待跟进'
                      ? 'border-amber-500 bg-amber-500 text-white'
                      : customerCounts.待跟进 > 0
                        ? 'border-amber-400 text-amber-600'
                        : 'border-slate-300 text-slate-400'
                  }`}
                >
                  🔔 待跟进{customerCounts.待跟进 > 0 ? ` ${customerCounts.待跟进}` : ''}
                </button>
                {(['全部', ...CUSTOMER_STATUSES] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setCustomerFilter(s as '全部' | CustomerStatus)}
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      customerFilter === s ? 'border-jushi-accent bg-jushi-accent text-white' : 'border-slate-300 text-slate-500'
                    }`}
                  >
                    {s}
                    {s !== '全部' && customerCounts[s] ? ` ${customerCounts[s]}` : ''}
                    {s === '全部' ? ` ${customers.length}` : ''}
                  </button>
                ))}
              </div>

              {showCustomerForm && (
                <CustomerForm
                  initial={null}
                  onSave={async (fields) => {
                    await window.api.sales.saveCustomer(fields)
                    setShowCustomerForm(false)
                    await refreshCustomers()
                  }}
                  onCancel={() => setShowCustomerForm(false)}
                />
              )}

              <div className="grid grid-cols-5 gap-3">
                <div className="col-span-2 space-y-1.5">
                  {filteredCustomers.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedCustomerId(c.id)}
                      className={`block w-full rounded-lg border px-3 py-2 text-left ${
                        selectedCustomerId === c.id ? 'border-jushi-accent bg-white shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-700">{c.客户名称}</span>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{c.状态}</span>
                        {c.下次跟进日期 && (
                          <span
                            className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                              c.下次跟进日期 < todayStr
                                ? 'bg-red-50 text-red-600'
                                : c.下次跟进日期 === todayStr
                                  ? 'bg-amber-50 text-amber-600'
                                  : 'bg-slate-50 text-slate-400'
                            }`}
                            title="下次跟进日期"
                          >
                            📅 {c.下次跟进日期 < todayStr ? '逾期 ' : c.下次跟进日期 === todayStr ? '今天' : c.下次跟进日期.slice(5)}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-400">
                        {c.项目名称 || '未填项目'} · {c.联系人列表[0] ? `${c.联系人列表[0].角色}${c.联系人列表[0].姓名}` : '未填联系人'} ·{' '}
                        {fmtTime(c.更新时间)}
                      </p>
                    </button>
                  ))}
                  {filteredCustomers.length === 0 && <p className="py-6 text-center text-xs text-slate-400">暂无客户</p>}
                </div>

                <div className="col-span-3">
                  {selectedCustomer ? (
                    <CustomerDetail
                      customer={selectedCustomer}
                      followUpInput={followUpInput}
                      setFollowUpInput={setFollowUpInput}
                      onSave={async (fields) => {
                        await window.api.sales.saveCustomer(fields, selectedCustomer.id)
                        await refreshCustomers()
                      }}
                      onRemove={async () => {
                        await window.api.sales.removeCustomer(selectedCustomer.id)
                        setSelectedCustomerId(null)
                        await refreshCustomers()
                      }}
                      onAddFollowUp={async () => {
                        if (!followUpInput.trim()) return
                        await window.api.sales.addFollowUp(selectedCustomer.id, followUpInput)
                        setFollowUpInput('')
                        await refreshCustomers()
                      }}
                      onDraft={() => setPendingPrompt(draftFollowUpPrompt(selectedCustomer))}
                      onLinkFile={async (类型) => {
                        const paths = await window.api.dialog.pickFiles()
                        if (paths.length === 0) return
                        for (const p of paths) await window.api.sales.linkCustomerFile(selectedCustomer.id, 类型, p)
                        await refreshCustomers()
                      }}
                      onUnlinkFile={async (index) => {
                        await window.api.sales.unlinkCustomerFile(selectedCustomer.id, index)
                        await refreshCustomers()
                      }}
                      onOpenFile={async (stored) => {
                        const abs = await window.api.sales.resolveLinkedPath(stored)
                        await window.api.shell.showItemInFolder(abs)
                      }}
                    />
                  ) : (
                    <p className="py-6 text-center text-xs text-slate-300">选中左侧客户查看详情与跟进记录</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {notice && <ResultNotice notice={notice} onClose={() => setNotice(null)} />}
      </div>

      {/* 中：分身对话（可收起——查产品/出报价都是机械操作，不占对话就把它折起来；派 AI 任务时自动展开） */}
      {showChat && <VDragHandle size={chatW} onSize={setChatW} sign={-1} min={CHAT_PANE.min} max={CHAT_PANE.max} />}
      <ChatCollapseRail open={showChat} onToggle={() => setShowChat((v) => !v)} />
      <div className="shrink-0 overflow-hidden transition-all" style={{ width: showChat ? chatW : 0 }}>
        {/* 收起时只折宽度不卸载组件，对话记录与进行中的任务都保留 */}
        <div className="h-full" style={{ width: chatW }}>
          <AgentChat
            agent={agent}
            pendingPrompt={pendingPrompt}
            pendingAutoSend={pendingAutoSend}
            onPendingPromptConsumed={() => {
              setPendingPrompt(null)
              setPendingAutoSend(false)
            }}
          />
        </div>
      </div>

      {/* 右：产出面板 */}
      <div className={`shrink-0 overflow-hidden border-l border-slate-200 bg-slate-50 transition-all ${showOutputs ? 'w-72' : 'w-10'}`}>
        <button
          onClick={() => setShowOutputs((v) => !v)}
          className="flex w-full items-center justify-center py-3 text-slate-400 hover:text-jushi-accent"
          title="产出文件"
        >
          {showOutputs ? '›' : '‹'}
        </button>
        {showOutputs && (
          <>
            <h3 className="px-3 pb-1 text-xs font-semibold text-slate-500">产出：outputs/sales</h3>
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(100% - 60px)' }}>
              <OutputsPanel
                agentName="sales"
                refreshKey={outputsRefresh}
                extraFileAction={(entry: OutputEntry) =>
                  entry.name.endsWith('.md') ? (
                    <button
                      onClick={async () => {
                        const docxPath = await window.api.docgen.exportMarkdownFile(entry.path)
                        await window.api.shell.showItemInFolder(docxPath)
                        setOutputsRefresh((k) => k + 1)
                      }}
                      className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-400 opacity-0 hover:bg-slate-100 hover:text-jushi-accent group-hover:opacity-100"
                      title="把这份 markdown 转成 Word 并在 Finder 里定位"
                    >
                      转Word
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

// ============ 客户表单 / 详情 ============

const EMPTY_CONTACT: CustomerContact = { 角色: '经办人', 姓名: '', 联系方式: '' }

function ContactListEditor({
  contacts,
  onChange
}: {
  contacts: CustomerContact[]
  onChange: (next: CustomerContact[]) => void
}): React.JSX.Element {
  const list = contacts.length > 0 ? contacts : [EMPTY_CONTACT]
  const update = (i: number, patch: Partial<CustomerContact>): void =>
    onChange(list.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  return (
    <div className="space-y-1.5">
      {list.map((c, i) => (
        <div key={i} className="flex gap-1.5">
          <select
            value={c.角色}
            onChange={(e) => update(i, { 角色: e.target.value as ContactRole })}
            className="w-20 shrink-0 rounded-md border border-slate-300 bg-white px-1.5 py-1.5 text-xs outline-none"
          >
            {CONTACT_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <input
            value={c.姓名}
            onChange={(e) => update(i, { 姓名: e.target.value })}
            placeholder="姓名"
            className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-jushi-accent"
          />
          <input
            value={c.联系方式}
            onChange={(e) => update(i, { 联系方式: e.target.value })}
            placeholder="电话/微信"
            className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-jushi-accent"
          />
          <button
            onClick={() => onChange(list.filter((_, idx) => idx !== i))}
            className="shrink-0 px-1 text-slate-300 hover:text-red-500"
            title="删除这个联系人"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...list, { ...EMPTY_CONTACT, 角色: '干系人' }])}
        className="rounded-md border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-400 hover:border-jushi-accent hover:text-jushi-accent"
      >
        ＋ 添加联系人
      </button>
    </div>
  )
}

function CustomerForm({
  initial,
  onSave,
  onCancel
}: {
  initial: CustomerEntry | null
  onSave: (fields: CustomerFields) => void
  onCancel: () => void
}): React.JSX.Element {
  const [form, setForm] = useState<CustomerFields>({
    客户名称: initial?.客户名称 ?? '',
    项目名称: initial?.项目名称 ?? '',
    招采网址: initial?.招采网址 ?? '',
    状态: initial?.状态 ?? '线索',
    联系人列表: initial?.联系人列表 ?? [],
    下次跟进日期: initial?.下次跟进日期 ?? '',
    备注: initial?.备注 ?? ''
  })
  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-0.5 block text-xs text-slate-400">客户名称 *</label>
          <input
            value={form.客户名称}
            onChange={(e) => setForm((f) => ({ ...f, 客户名称: e.target.value }))}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-jushi-accent"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-slate-400">状态</label>
          <select
            value={form.状态}
            onChange={(e) => setForm((f) => ({ ...f, 状态: e.target.value as CustomerStatus }))}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none"
          >
            {CUSTOMER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-slate-400">项目名称</label>
          <input
            value={form.项目名称}
            onChange={(e) => setForm((f) => ({ ...f, 项目名称: e.target.value }))}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-jushi-accent"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-slate-400">招采网址</label>
          <input
            value={form.招采网址}
            onChange={(e) => setForm((f) => ({ ...f, 招采网址: e.target.value }))}
            placeholder="https://…"
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-jushi-accent"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-slate-400">下次跟进日期</label>
          <input
            type="date"
            value={form.下次跟进日期 ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, 下次跟进日期: e.target.value }))}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-jushi-accent"
          />
        </div>
        <div className="col-span-2">
          <label className="mb-0.5 block text-xs text-slate-400">联系人（经办人 / 决策人 / 干系人）</label>
          <ContactListEditor contacts={form.联系人列表} onChange={(next) => setForm((f) => ({ ...f, 联系人列表: next }))} />
        </div>
        <div className="col-span-2">
          <label className="mb-0.5 block text-xs text-slate-400">备注</label>
          <input
            value={form.备注 ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, 备注: e.target.value }))}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-jushi-accent"
          />
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => form.客户名称.trim() && onSave(form)}
          disabled={!form.客户名称.trim()}
          className="rounded-md bg-jushi-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          保存
        </button>
        <button onClick={onCancel} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-500">
          取消
        </button>
      </div>
    </div>
  )
}

function CustomerDetail({
  customer,
  followUpInput,
  setFollowUpInput,
  onSave,
  onRemove,
  onAddFollowUp,
  onDraft,
  onLinkFile,
  onUnlinkFile,
  onOpenFile
}: {
  customer: CustomerEntry
  followUpInput: string
  setFollowUpInput: (v: string) => void
  onSave: (fields: CustomerFields) => void
  onRemove: () => void
  onAddFollowUp: () => void
  onDraft: () => void
  onLinkFile: (类型: '报价文件' | '合同文件') => void
  onUnlinkFile: (index: number) => void
  onOpenFile: (stored: string) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const quoteLinked = customer.关联文件.some((f) => f.类型 === '报价文件')
  const contractLinked = customer.关联文件.some((f) => f.类型 === '合同文件')
  const todayStr = fmtTime(Date.now())
  /** 从当前客户构造可保存字段（用于内联改"下次跟进日期"等，不进编辑态） */
  const fieldsWith = (over: Partial<CustomerFields>): CustomerFields => ({
    客户名称: customer.客户名称,
    项目名称: customer.项目名称,
    招采网址: customer.招采网址,
    状态: customer.状态,
    联系人列表: customer.联系人列表,
    下次跟进日期: customer.下次跟进日期 ?? '',
    备注: customer.备注 ?? '',
    ...over
  })

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      {editing ? (
        <CustomerForm
          initial={customer}
          onSave={(fields) => {
            onSave(fields)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-800">{customer.客户名称}</h4>
            <div className="flex gap-2 text-xs">
              <button onClick={() => setEditing(true)} className="text-slate-400 hover:text-slate-600">
                编辑
              </button>
              <button onClick={onRemove} className="text-slate-300 hover:text-red-500">
                删除
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {customer.状态}
            {customer.项目名称 && <> · 项目：{customer.项目名称}</>}
            {customer.招采网址 && (
              <>
                {' · '}
                <a href={customer.招采网址} target="_blank" rel="noreferrer" className="text-jushi-accent hover:underline">
                  招采网址 ↗
                </a>
              </>
            )}
            {customer.下次跟进日期 && (
              <>
                {' · '}
                <span
                  className={
                    customer.下次跟进日期 < todayStr
                      ? 'text-red-600'
                      : customer.下次跟进日期 === todayStr
                        ? 'text-amber-600'
                        : 'text-slate-500'
                  }
                >
                  下次跟进 {customer.下次跟进日期}
                  {customer.下次跟进日期 < todayStr ? '（已逾期）' : customer.下次跟进日期 === todayStr ? '（今天）' : ''}
                </span>
              </>
            )}
          </p>
          {customer.联系人列表.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {customer.联系人列表.map((c, i) => (
                <span key={i} className="rounded bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                  <span className={c.角色 === '决策人' ? 'font-semibold text-jushi-blue' : ''}>{c.角色}</span> {c.姓名}
                  {c.联系方式 && <span className="text-slate-400"> {c.联系方式}</span>}
                </span>
              ))}
            </div>
          )}
          {customer.备注 && <p className="mt-1 text-xs text-slate-400">{customer.备注}</p>}
        </>
      )}

      <button
        onClick={onDraft}
        className="mt-2 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:border-jushi-accent hover:text-jushi-accent"
      >
        🤖 起草跟进话术
      </button>

      {/* 关联文件：已报价关联报价文件、已成交关联合同文件（提示不强制） */}
      <div className="mt-3">
        <div className="mb-1 flex items-center gap-2">
          <h5 className="text-xs font-semibold text-slate-500">关联文件（{customer.关联文件.length}）</h5>
          <button
            onClick={() => onLinkFile('报价文件')}
            className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-500 hover:border-jushi-accent hover:text-jushi-accent"
          >
            ＋报价文件
          </button>
          <button
            onClick={() => onLinkFile('合同文件')}
            className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-500 hover:border-jushi-accent hover:text-jushi-accent"
          >
            ＋合同文件
          </button>
        </div>
        {customer.状态 === '已报价' && !quoteLinked && (
          <p className="mb-1 text-xs text-amber-600">状态是「已报价」——建议把报价文件关联进来（outputs/01_销售_sales/ 里找）。</p>
        )}
        {customer.状态 === '已成交' && !contractLinked && (
          <p className="mb-1 text-xs text-amber-600">状态是「已成交」——建议把合同文件关联进来（法务/已审/ 里找）。</p>
        )}
        <div className="space-y-1">
          {customer.关联文件.map((f, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded bg-slate-50 px-2 py-1 text-xs">
              <span className={`shrink-0 rounded px-1.5 py-0.5 ${f.类型 === '合同文件' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                {f.类型}
              </span>
              <button onClick={() => onOpenFile(f.路径)} className="min-w-0 flex-1 truncate text-left text-slate-600 hover:text-jushi-accent" title={f.路径}>
                {f.路径.split('/').pop()}
              </button>
              <span className="shrink-0 text-slate-300">{fmtTime(f.时间)}</span>
              <button onClick={() => onUnlinkFile(i)} className="shrink-0 text-slate-300 hover:text-red-500">
                ✕
              </button>
            </div>
          ))}
          {customer.关联文件.length === 0 && <p className="py-1 text-xs text-slate-300">还没有关联文件</p>}
        </div>
      </div>

      <h5 className="mb-1 mt-3 text-xs font-semibold text-slate-500">跟进记录（{customer.跟进记录.length}）</h5>
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {[...customer.跟进记录].reverse().map((r, i) => (
          <div key={i} className="rounded bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
            <span className="mr-1.5 text-slate-400">{fmtTime(r.时间)}</span>
            {r.内容}
          </div>
        ))}
        {customer.跟进记录.length === 0 && <p className="py-2 text-center text-xs text-slate-300">暂无跟进记录</p>}
      </div>
      <div className="mt-2 flex gap-1.5">
        <input
          value={followUpInput}
          onChange={(e) => setFollowUpInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAddFollowUp()}
          placeholder="记一条跟进（Enter 保存）…"
          className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-jushi-accent"
        />
        <button onClick={onAddFollowUp} className="rounded-md border border-slate-300 px-2.5 text-xs text-slate-600 hover:bg-slate-50">
          记录
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400">
        <span>下次跟进</span>
        <input
          type="date"
          value={customer.下次跟进日期 ?? ''}
          onChange={(e) => onSave(fieldsWith({ 下次跟进日期: e.target.value }))}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 outline-none focus:border-jushi-accent"
        />
        {customer.下次跟进日期 && (
          <button
            onClick={() => onSave(fieldsWith({ 下次跟进日期: '' }))}
            className="text-slate-300 hover:text-red-500"
            title="清除下次跟进日期"
          >
            清除
          </button>
        )}
      </div>
    </div>
  )
}
