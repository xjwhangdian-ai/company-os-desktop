import { useEffect, useMemo, useState } from 'react'
import type {
  AgentDisplayMeta,
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
import { OutputsPanel } from '../components/OutputsPanel'
import { HelpButton } from '../components/HelpPanel'
import { HELP_CONTENT } from '../lib/help-content'
import { useConfigStore } from '../stores/useConfigStore'

type SalesTab = '产品库' | '报价单' | '客户'
type UploadMode = 'supplier' | 'bid'

interface PreviewCard extends SupplierDocPreview {
  mode: UploadMode
}

interface CartLine {
  product: ProductEntry
  数量: string
  报价单价: string
}

const EMPTY_PRODUCT_FORM: ProductFields = {
  产品名称: '',
  产品分类: '',
  技术参数: '',
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
const TEMPLATE_FILTERS = [{ name: '报价模板', extensions: ['docx', 'pdf', 'md', 'txt', 'xlsx'] }]
const IMAGE_FILTERS = [{ name: '产品图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'] }]

function fmtTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function today(): string {
  return fmtTime(Date.now())
}

function appfileUrl(absPath: string): string {
  return 'appfile://' + absPath.split('/').map(encodeURIComponent).join('/')
}

/** 报价单默认取建议销售价，没有再退投标报价，最后退成本价（UI 会标出成本参考，避免误按成本报出去） */
function defaultQuotePrice(p: ProductEntry): string {
  return p.建议销售价 || p.投标报价 || p.成本价
}

/** 构造"AI 解析供应商资料/投标报价文件"的提示词——分身只写 _待入库/ 暂存 JSON，规范库由 App 合并 */
function buildParsePrompt(preview: PreviewCard): string {
  const readTarget = preview.companionRelativePath
    ? `${preview.companionRelativePath}（这是 App 从 ${preview.relativePath} 提取的纯文本，优先读它；需要时也可对照原文件）`
    : preview.relativePath
  const stagingFile = `销售/产品库/_待入库/入库_${Date.now()}.json`
  if (preview.mode === 'bid') {
    return [
      `解析这份投标报价文件，提取各产品的投标报价写入暂存区。`,
      `文件：${readTarget}`,
      `要求：`,
      `1. 每个产品提取为一个 JSON 对象，只填两个字段的值：产品名称、投标报价；其余字段（产品分类、技术参数、成本价、建议销售价、供应商名称、供应商联系人、供应商联系方式、备注）一律填空字符串""，来源文件填"${preview.fileName}"。`,
      `2. 产品名称照抄文件原文写法（App 会按名称匹配到产品库里的已有条目回填投标报价）；投标报价保留原文（含单位/含税说明）。`,
      `3. 用 Write 工具把 JSON 数组写入 ${stagingFile}，文件内容只有 JSON 数组本身。`,
      `4. 不要修改 销售/产品库/产品库.json。`,
      `完成后回复提取了多少条。`
    ].join('\n')
  }
  return [
    `解析这份供应商产品资料，提取产品条目写入暂存区。`,
    `资料文件：${readTarget}`,
    `要求：`,
    `1. 每个产品提取为一个 JSON 对象，字段名严格使用：产品名称、产品分类、技术参数、成本价、建议销售价、投标报价、供应商名称、供应商联系人、供应商联系方式、备注、来源文件（来源文件统一填"${preview.fileName}"）。`,
    `2. 供应商报价表里的价格是给我们的进货价，填进"成本价"；资料里明确写了建议零售价/指导价才填"建议销售价"，没有就留空。技术参数把规格/型号/关键参数拼成一段完整文字；所有价格保留资料原文写法（含单位、含税说明）；资料里没有的字段填空字符串""，禁止编造。`,
    `3. 用 Write 工具把 JSON 数组写入 ${stagingFile}，文件内容只有 JSON 数组本身，不要包裹代码块或其它文字。`,
    `4. 不要修改 销售/产品库/产品库.json——那是桌面 App 托管的规范库，你写的暂存文件会由 App 校验后合并进去。`,
    `完成后回复：提取了多少条产品、哪些字段缺失比较多。`
  ].join('\n')
}

/** 构造"生成对外报价文件"的提示词 */
function buildQuotationPrompt(
  lines: CartLine[],
  customerName: string,
  template: QuotationTemplate | null,
  imagesExported: number
): string {
  const customer = customerName.trim() || '通用'
  const rows = lines
    .map(
      (l) =>
        `| ${l.product.产品名称} | ${l.product.技术参数.replace(/\|/g, '，').slice(0, 200)} | ${l.product.供应商名称} | ${l.数量} | ${l.报价单价} |`
    )
    .join('\n')
  const templatePart = template
    ? `参考模板：${template.relativePath}${template.companionRelativePath ? `（二进制格式请读提取文本 ${template.companionRelativePath}）` : ''}——严格按模板的章节与表格结构组织内容。`
    : `没有指定模板，用标准报价单结构：公司抬头 → 报价日期与编号 → 客户名称 → 产品明细表 → 合计 → 税率与含税说明 → 报价有效期 → 交付与质保 → 我方联系方式。`
  const dir = `outputs/01_销售_sales/${today()}_${customer}_报价`
  const imagePart =
    imagesExported > 0
      ? `产品图片：App 已把 ${imagesExported} 张产品图导出到 ${dir}/图片/（文件名=产品名称）。在报价文件末尾加一节「产品图片清单」，逐行列出 产品名称 → 对应图片文件名。`
      : ''
  return [
    `生成一份对外报价文件（markdown）。`,
    ``,
    `客户名称：${customerName.trim() || '（未指定，做通用版，客户名留占位）'}`,
    `产品明细（共 ${lines.length} 项，"品牌"列即产品库里的供应商名称）：`,
    `| 产品名称 | 技术参数 | 品牌 | 数量 | 单价（元） |`,
    `|---|---|---|---|---|`,
    rows,
    ``,
    templatePart,
    imagePart,
    `如各行单价均为纯数字，计算每行小计与总计；否则合计处标注"以最终商务确认为准"。`,
    `红线：这是对外文件——除"品牌"外，严禁出现任何采购侧信息（供应商联系人/联系方式/成本价/进货口径）；公司抬头与联系方式以 knowledge/company/facts.md 为准，不臆造。`,
    `产出路径：${dir}/${today()}_${customer}_报价单.md`,
    `完成后一句话总结：共几项、合计金额（如可计算）、有哪些"待确认"占位需要人工补。`
  ]
    .filter(Boolean)
    .join('\n')
}

// ============ 产品表单 ============

function ProductForm({
  initial,
  onSave,
  onCancel
}: {
  initial: ProductFields
  onSave: (fields: ProductFields) => void
  onCancel: () => void
}): React.JSX.Element {
  const [form, setForm] = useState<ProductFields>(initial)
  const set = (k: keyof ProductFields, v: string): void => setForm((f) => ({ ...f, [k]: v }))
  const FIELDS: { key: keyof ProductFields; label: string; wide?: boolean }[] = [
    { key: '产品名称', label: '产品名称 *' },
    { key: '产品分类', label: '产品分类' },
    { key: '技术参数', label: '技术参数', wide: true },
    { key: '成本价', label: '成本价（采购侧，不进报价）' },
    { key: '建议销售价', label: '建议销售价' },
    { key: '投标报价', label: '投标报价' },
    { key: '供应商名称', label: '供应商名称' },
    { key: '供应商联系人', label: '供应商联系人' },
    { key: '供应商联系方式', label: '供应商联系方式' },
    { key: '备注', label: '备注', wide: true }
  ]
  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3">
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

export function SalesWorkspace({ agent }: { agent: AgentDisplayMeta }): React.JSX.Element {
  const config = useConfigStore((s) => s.config)
  const dataDir = config?.companies.find((c) => c.id === config.activeCompanyId)?.dataDir ?? null

  const [tab, setTab] = useState<SalesTab>('产品库')
  const [products, setProducts] = useState<ProductEntry[]>([])
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('全部')
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [previews, setPreviews] = useState<PreviewCard[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const [cart, setCart] = useState<CartLine[]>([])
  const [templates, setTemplates] = useState<QuotationTemplate[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [quoteCustomer, setQuoteCustomer] = useState('')

  const [customers, setCustomers] = useState<CustomerEntry[]>([])
  const [customerFilter, setCustomerFilter] = useState<'全部' | CustomerStatus>('全部')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [showCustomerForm, setShowCustomerForm] = useState(false)
  const [followUpInput, setFollowUpInput] = useState('')

  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const [outputsRefresh, setOutputsRefresh] = useState(0)
  const [showOutputs, setShowOutputs] = useState(false)

  function flash(text: string): void {
    setNotice(text)
    setTimeout(() => setNotice(null), 4500)
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
  async function refreshTemplates(): Promise<void> {
    setTemplates(await window.api.sales.listTemplates())
  }
  async function refreshCustomers(): Promise<void> {
    setCustomers(await window.api.sales.listCustomers())
  }

  useEffect(() => {
    refreshProducts()
    refreshTemplates()
    refreshCustomers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (tab === '产品库') refreshProducts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.产品分类).filter(Boolean))
    return ['全部', ...Array.from(set)]
  }, [products])

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter((p) => {
      if (categoryFilter !== '全部' && p.产品分类 !== categoryFilter) return false
      if (!q) return true
      return [p.产品名称, p.产品分类, p.技术参数, p.供应商名称, p.供应商联系人].some((v) =>
        (v ?? '').toLowerCase().includes(q)
      )
    })
  }, [products, query, categoryFilter])

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
      const { added, updated, skipped } = await window.api.sales.importExcel(preview.relativePath)
      flash(
        `「${preview.fileName}」已直接导入：新增 ${added} 条、更新 ${updated} 条` +
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

  function addToCart(product: ProductEntry): void {
    setCart((prev) => {
      if (prev.some((l) => l.product.id === product.id)) return prev
      return [...prev, { product, 数量: '1', 报价单价: defaultQuotePrice(product) }]
    })
    flash(`已加入报价单：${product.产品名称}${product.建议销售价 ? '' : '（无建议销售价，默认取了其它价格口径，注意核对）'}`)
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

  async function handleGenerateQuotation(): Promise<void> {
    const template = templates.find((t) => t.fileName === selectedTemplate) ?? null
    const withImages = cart.filter((l) => l.product.图片)
    let exported = 0
    if (withImages.length > 0) {
      const r = await window.api.sales.exportQuoteImages(
        withImages.map((l) => l.product.id),
        quoteCustomer
      )
      exported = r.exported
      if (r.exported > 0) flash(`已导出 ${r.exported} 张产品图到报价目录的 图片/ 文件夹`)
    }
    setPendingPrompt(buildQuotationPrompt(cart, quoteCustomer, template, exported))
  }

  async function handleExportImagesOnly(): Promise<void> {
    const withImages = cart.filter((l) => l.product.图片)
    if (withImages.length === 0) {
      flash('报价单里的产品都还没有关联图片')
      return
    }
    const r = await window.api.sales.exportQuoteImages(
      withImages.map((l) => l.product.id),
      quoteCustomer
    )
    flash(`已导出 ${r.exported} 张产品图` + (r.missing.length > 0 ? `；缺图：${r.missing.join('、')}` : ''))
    await window.api.shell.showItemInFolder(r.dir)
  }

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) ?? null
  const filteredCustomers = customers.filter((c) => customerFilter === '全部' || c.状态 === customerFilter)

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
            {(['产品库', '报价单', '客户'] as SalesTab[]).map((t) => (
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

        <div className="flex-1 overflow-y-auto p-4">
          {/* ============ 产品库 ============ */}
          {tab === '产品库' && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="按产品关键字 / 供应商搜索…"
                  className="w-56 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-jushi-accent"
                />
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-600 outline-none"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c === '全部' ? '全部分类' : c}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => handleUploadDocs('supplier')}
                  disabled={busy}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  📎 供应商资料
                </button>
                <button
                  onClick={() => handleUploadDocs('bid')}
                  disabled={busy}
                  title="上传投标报价文件，识别各产品的投标报价并回填产品库"
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  🏷️ 投标报价文件
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
                          ），可导入 {preview.importableRows} 行——直接导入不消耗 AI 额度。
                        </p>
                      ) : (
                        <p className="mt-1">该文件无法机械识别表头，需要 AI 解析（sales 分身提取后由 App 校验入库）。</p>
                      )}
                    </div>
                    <button onClick={() => setPreviews((prev) => prev.filter((x) => x !== preview))} className="shrink-0 text-slate-400 hover:text-slate-600">
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 flex gap-2">
                    {preview.fieldMapping && (
                      <button
                        onClick={() => handleDirectImport(preview)}
                        disabled={busy}
                        className="rounded-md bg-jushi-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                      >
                        直接导入 {preview.importableRows} 行
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setPendingPrompt(buildParsePrompt(preview))
                        setPreviews((prev) => prev.filter((x) => x !== preview))
                      }}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:border-jushi-accent hover:text-jushi-accent"
                    >
                      🤖 AI 解析入库
                    </button>
                  </div>
                </div>
              ))}

              {(showAddForm || editingId) && (
                <ProductForm
                  initial={editingId ? (products.find((p) => p.id === editingId) ?? EMPTY_PRODUCT_FORM) : EMPTY_PRODUCT_FORM}
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

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-left text-slate-500">
                      <th className="px-2 py-2 font-medium">图</th>
                      <th className="px-2 py-2 font-medium">产品名称</th>
                      <th className="px-2 py-2 font-medium">分类</th>
                      <th className="px-2 py-2 font-medium">技术参数</th>
                      <th className="px-2 py-2 font-medium">成本价</th>
                      <th className="px-2 py-2 font-medium">建议售价</th>
                      <th className="px-2 py-2 font-medium">投标报价</th>
                      <th className="px-2 py-2 font-medium">供应商</th>
                      <th className="px-2 py-2 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((p) => (
                      <tr key={p.id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                        <td className="px-2 py-1.5">
                          {p.图片 && dataDir ? (
                            <img
                              src={appfileUrl(`${dataDir}/${p.图片}`)}
                              className="h-9 w-9 cursor-pointer rounded object-cover"
                              title="点击更换图片"
                              onClick={() => handleSetImage(p.id)}
                            />
                          ) : (
                            <button
                              onClick={() => handleSetImage(p.id)}
                              title="上传产品图片"
                              className="flex h-9 w-9 items-center justify-center rounded border border-dashed border-slate-300 text-slate-300 hover:border-jushi-accent hover:text-jushi-accent"
                            >
                              +图
                            </button>
                          )}
                        </td>
                        <td className="max-w-40 px-2 py-2 font-medium text-slate-700">
                          {p.产品名称}
                          {(p.供应商联系人 || p.供应商联系方式) && (
                            <span className="block text-slate-400" title="供应商联系（采购侧信息，不进报价）">
                              {[p.供应商联系人, p.供应商联系方式].filter(Boolean).join(' / ')}
                            </span>
                          )}
                        </td>
                        <td className="max-w-20 px-2 py-2 text-slate-500">{p.产品分类 || '—'}</td>
                        <td className="max-w-52 px-2 py-2 text-slate-500" title={p.技术参数}>
                          <span className="line-clamp-2">{p.技术参数 || '—'}</span>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-slate-500">{p.成本价 || '—'}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-slate-700">{p.建议销售价 || '—'}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-slate-700">{p.投标报价 || '—'}</td>
                        <td className="max-w-28 px-2 py-2 text-slate-500">{p.供应商名称 || '—'}</td>
                        <td className="whitespace-nowrap px-2 py-2">
                          <button onClick={() => addToCart(p)} className="mr-1.5 text-jushi-accent hover:underline">
                            加入报价单
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
                              await window.api.sales.removeProduct(p.id)
                              await refreshProducts()
                            }}
                            className="text-slate-300 hover:text-red-500"
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredProducts.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-2 py-6 text-center text-slate-400">
                          {products.length === 0 ? '产品库为空——上传供应商资料或手动添加' : '没有匹配的产品'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
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
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-left text-slate-500">
                      <th className="px-2 py-2 font-medium">图</th>
                      <th className="px-2 py-2 font-medium">产品名称</th>
                      <th className="px-2 py-2 font-medium">品牌/供应商</th>
                      <th className="w-20 px-2 py-2 font-medium">数量</th>
                      <th className="w-32 px-2 py-2 font-medium">报价单价</th>
                      <th className="w-24 px-2 py-2 font-medium">成本参考</th>
                      <th className="w-24 px-2 py-2 font-medium">小计</th>
                      <th className="w-14 px-2 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((line) => {
                      const price = parseFloat(line.报价单价.replace(/[^\d.]/g, ''))
                      const qty = parseFloat(line.数量)
                      const subtotal = isFinite(price) && isFinite(qty) ? price * qty : null
                      return (
                        <tr key={line.product.id} className="border-t border-slate-100">
                          <td className="px-2 py-1.5">
                            {line.product.图片 && dataDir ? (
                              <img src={appfileUrl(`${dataDir}/${line.product.图片}`)} className="h-8 w-8 rounded object-cover" />
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-2 py-2 font-medium text-slate-700">{line.product.产品名称}</td>
                          <td className="px-2 py-2 text-slate-500">{line.product.供应商名称 || '—'}</td>
                          <td className="px-2 py-1.5">
                            <input
                              value={line.数量}
                              onChange={(e) =>
                                setCart((prev) =>
                                  prev.map((l) => (l.product.id === line.product.id ? { ...l, 数量: e.target.value } : l))
                                )
                              }
                              className="w-16 rounded border border-slate-300 px-1.5 py-1 text-xs outline-none focus:border-jushi-accent"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              value={line.报价单价}
                              onChange={(e) =>
                                setCart((prev) =>
                                  prev.map((l) => (l.product.id === line.product.id ? { ...l, 报价单价: e.target.value } : l))
                                )
                              }
                              className="w-28 rounded border border-slate-300 px-1.5 py-1 text-xs outline-none focus:border-jushi-accent"
                            />
                          </td>
                          <td className="px-2 py-2 text-slate-400" title="采购成本，仅内部参考，不会写进报价文件">
                            {line.product.成本价 || '—'}
                          </td>
                          <td className="px-2 py-2 text-slate-600">{subtotal !== null ? subtotal.toFixed(2) : '—'}</td>
                          <td className="px-2 py-2">
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
                        <td colSpan={8} className="px-2 py-6 text-center text-slate-400">
                          报价单为空——到「产品库」里查询产品并点「加入报价单」
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm text-slate-600">
                  {cartTotal !== null ? `合计（估算）：¥ ${cartTotal.toFixed(2)}` : cart.length > 0 ? '合计：单价含非数字内容，由分身在文件里标注' : ''}
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={cart.length === 0}
                    onClick={handleExportImagesOnly}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    title="把报价单里各产品的图片导出到报价产出目录的 图片/ 文件夹"
                  >
                    🖼️ 导出产品图片
                  </button>
                  <button
                    disabled={cart.length === 0}
                    onClick={handleGenerateQuotation}
                    className="rounded-lg bg-jushi-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                  >
                    ✍️ 生成报价文件
                  </button>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                报价单价默认取建议销售价（缺失时退投标报价/成本价，注意核对加价）。生成后在右侧产出面板找到 .md
                文件点「转Word」得到正式 .docx；成本价与供应商联系方式绝不会写进对外报价。
              </p>
            </>
          )}

          {/* ============ 客户（CRM） ============ */}
          {tab === '客户' && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {(['全部', ...CUSTOMER_STATUSES] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setCustomerFilter(s as '全部' | CustomerStatus)}
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      customerFilter === s ? 'border-jushi-accent bg-jushi-accent text-white' : 'border-slate-300 text-slate-500'
                    }`}
                  >
                    {s}
                  </button>
                ))}
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

        {notice && (
          <div className="border-t border-slate-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">{notice}</div>
        )}
      </div>

      {/* 中：分身对话 */}
      <div className="w-[400px] shrink-0">
        <AgentChat
          agent={agent}
          pendingPrompt={pendingPrompt}
          onPendingPromptConsumed={() => setPendingPrompt(null)}
        />
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
    </div>
  )
}
