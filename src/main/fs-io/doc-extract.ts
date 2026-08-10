import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { extname } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// ============ 供应商资料/报价模板的"伴生提取文本" ============
// Agent SDK 里分身的 Read 工具能直接读 PDF 和纯文本，但读不了 docx/xlsx 这类二进制格式。
// 所以 App 在上传时做一次纯机械的文本提取，在原文件旁边落一个 _提取文本.txt/.csv 伴生文件，
// 分身解析/模仿模板结构时读伴生文件。提取只做格式转换，不做任何语义加工——语义是分身的事。

function csvEscape(cell: string): string {
  if (/[",\n]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`
  return cell
}

/** ExcelJS 单元格值转字符串：公式取 result、富文本拼接、日期转 ISO 日期部分 */
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if ('result' in value && value.result !== undefined) return cellToString(value.result as ExcelJS.CellValue)
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((t) => t.text).join('')
    if ('text' in value && typeof value.text === 'string') return value.text
    if ('hyperlink' in value && typeof value.hyperlink === 'string') return value.hyperlink
    if ('error' in value) return ''
    return String(value)
  }
  return String(value).trim()
}

export interface SheetData {
  name: string
  rows: string[][]
  /** 与 rows 对齐的原始 Excel 行号（1 基）——includeEmpty:false 跳过空行后行号会错位，内嵌图片按它对齐 */
  rowNumbers: number[]
}

export async function readWorkbookRows(filePath: string): Promise<SheetData[]> {
  const workbook = new ExcelJS.Workbook()
  const ext = extname(filePath).toLowerCase()
  if (ext === '.csv') {
    await workbook.csv.readFile(filePath)
  } else {
    await workbook.xlsx.readFile(filePath)
  }
  const sheets: SheetData[] = []
  workbook.eachSheet((ws) => {
    const rows: string[][] = []
    const rowNumbers: number[] = []
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : []
      rows.push(values.map((v) => cellToString(v as ExcelJS.CellValue).trim()))
      rowNumbers.push(rowNumber)
    })
    sheets.push({ name: ws.name, rows, rowNumbers })
  })
  return sheets
}

/**
 * 给 docx/doc/xlsx/csv 生成伴生提取文本，返回伴生文件绝对路径；
 * pdf/txt/md 类分身能直接读，返回 null。提取失败抛错（上传流程会把错误报给用户，不静默）。
 */
export async function extractCompanion(filePath: string): Promise<string | null> {
  const ext = extname(filePath).toLowerCase()

  if (ext === '.xlsx' || ext === '.csv') {
    const sheets = await readWorkbookRows(filePath)
    const parts = sheets.map(
      (s) => `### 工作表: ${s.name}\n` + s.rows.map((r) => r.map(csvEscape).join(',')).join('\n')
    )
    const out = `${filePath}_提取文本.csv`
    writeFileSync(out, parts.join('\n\n'), 'utf-8')
    return out
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath })
    const out = `${filePath}_提取文本.txt`
    writeFileSync(out, result.value, 'utf-8')
    return out
  }

  if (ext === '.doc') {
    // 老版 .doc 没有跨平台的轻量解析库，macOS 用系统自带 textutil 转；其他平台提示转存
    if (process.platform !== 'darwin') {
      throw new Error('旧版 .doc 仅在 macOS 上支持自动提取，请另存为 .docx 后重新上传')
    }
    const { stdout } = await execFileAsync('textutil', ['-convert', 'txt', '-stdout', filePath], {
      maxBuffer: 20 * 1024 * 1024
    })
    const out = `${filePath}_提取文本.txt`
    writeFileSync(out, stdout, 'utf-8')
    return out
  }

  if (ext === '.xls') {
    throw new Error('旧版 .xls 不支持自动解析，请用 Excel/WPS 另存为 .xlsx 后重新上传')
  }

  // pdf / txt / md：分身 Read 工具可直接读取，不需要伴生文件
  return null
}

// ============ Excel 表头机械识别 ============
// 供应商价格表大多是 Excel。若表头能对上产品库字段，直接机械导入——确定、免费、
// 不需要 API Key；对不上的（或 pdf/word）再走 AI 解析。同义词只做包含匹配，不做语义猜测。

// 注意字段顺序：投标报价/建议销售价的专用叫法先认领各自的列（一列只能配一个字段），
// 剩下的通用价格叫法（单价/价格/报价）才归成本价——供应商报价表里的价格就是我们的进货成本。
// 顺序即匹配优先级：具体字段在前（型号/品牌/制造商），泛化字段在后（技术参数/成本价），
// 每列只归一个字段，防止"规格型号"被技术参数抢走、"品牌"被供应商名称抢走。
const FIELD_SYNONYMS: Record<string, string[]> = {
  产品名称: ['产品名称', '品名', '货名', '设备名称', '商品名称', '名称', '产品'],
  型号: ['型号', '产品型号', '开票型号'],
  瑾智型号: ['瑾智型号', '我方型号', '自编型号', '本司型号'],
  品牌: ['品牌', '牌子'],
  生产制造商: ['生产制造商', '制造商', '生产厂家', '厂家', '厂商'],
  产地: ['产地'],
  单位: ['计量单位', '单位'],
  税率: ['税率'],
  质保期: ['质保期', '质保', '保修期'],
  交货期: ['交货期', '交货周期', '货期', '交期'],
  物料代码: ['物料代码', '物料编码', '物料号'],
  // 分类三列的顺序不能动：一级/二级先认领各自的列，泛化的"分类/类别"才归三级（产品分类）。
  // 反过来的话「一级分类」会被产品分类的包含匹配（'分类'）先抢走。
  一级分类: ['一级分类', '一级类别', '大类'],
  二级分类: ['二级分类', '二级类别', '中类'],
  产品分类: ['产品分类', '产品类别', '三级分类', '细分类', '分类', '类别', '品类', '类型', '产品线'],
  技术参数: ['技术参数', '规格参数', '技术规格', '规格型号', '参数', '规格', '配置'],
  投标报价: ['投标报价', '投标单价', '投标价', '中标价', '中标单价'],
  建议销售价: ['建议销售价', '建议零售价', '建议售价', '指导价', '零售价', '市场价'],
  成本价: ['成本价', '进货价', '采购价', '含税单价', '未税单价', '出厂价', '供货价', '单价', '价格', '报价', '销售价'],
  供应商名称: ['供应商名称', '供应商', '供货商', '经销商', '代理商'],
  供应商联系人: ['供应商联系人', '联系人'],
  供应商联系方式: ['供应商联系方式', '联系电话', '联系方式', '手机号', '电话', '手机'],
  // 映射备注列，好让机械导入也能识别"示例行"（备注写着"示例行，正式填写时删除"）并跳过
  备注: ['备注', '说明', '备注说明']
}

export interface HeaderDetection {
  sheetName: string
  headerRowIndex: number
  headers: string[]
  /** 字段名 → 命中的列序号 */
  fieldMapping: Record<string, number>
  dataRows: string[][]
  /** 与 dataRows 对齐的原始 Excel 行号（1 基），内嵌图片按行归属产品 */
  dataRowNumbers: number[]
}

function mapHeaderRow(row: string[]): Record<string, number> {
  const mapping: Record<string, number> = {}
  const usedCols = new Set<number>()
  for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS)) {
    // 匹配优先级：先精确相等再包含，且同义词按列表顺序逐个找——
    // "名称"列精确命中产品名称而不被"商品名称（开票名称）"抢占，
    // "型号"列优先于"开票型号"列（后者常是开票口径，区分度低）。
    let hit = -1
    outer: for (const exact of [true, false]) {
      for (const syn of synonyms) {
        for (let col = 0; col < row.length; col++) {
          if (usedCols.has(col)) continue
          const cell = (row[col] ?? '').replace(/\s/g, '')
          if (!cell) continue
          if (exact ? cell === syn : cell.includes(syn)) {
            hit = col
            break outer
          }
        }
      }
    }
    if (hit >= 0) {
      mapping[field] = hit
      usedCols.add(hit)
    }
  }
  return mapping
}

/**
 * 在每个工作表的前 30 行里选**命中字段最多**的一行当表头（并列取更靠前的）。
 * 不能用"第一个命中 ≥2 的行"：合并的大标题行（如"产品报价单"横跨全表）会把
 * 同一段文字铺到每一列，恰好凑出 产品名称+成本价 两个假命中。
 */
export function detectHeader(sheets: SheetData[]): HeaderDetection | null {
  for (const sheet of sheets) {
    const scanLimit = Math.min(sheet.rows.length, 30)
    let best: { i: number; mapping: Record<string, number> } | null = null
    for (let i = 0; i < scanLimit; i++) {
      const row = sheet.rows[i]
      // 非空值全部相同的行是合并标题行，不可能是表头
      const nonEmpty = row.map((c) => (c ?? '').trim()).filter(Boolean)
      if (nonEmpty.length > 1 && new Set(nonEmpty).size === 1) continue
      const mapping = mapHeaderRow(row)
      if (mapping['产品名称'] === undefined || Object.keys(mapping).length < 2) continue
      if (!best || Object.keys(mapping).length > Object.keys(best.mapping).length) best = { i, mapping }
    }
    if (best) {
      const { i, mapping } = best
      const dataRows: string[][] = []
      const dataRowNumbers: number[] = []
      for (let j = i + 1; j < sheet.rows.length; j++) {
        const r = sheet.rows[j]
        const name = (r[mapping['产品名称']] ?? '').trim()
        // 汇总行（"合计(元)"落在名称列）不是产品
        if (name === '' || /^合\s*计/.test(name)) continue
        dataRows.push(r)
        dataRowNumbers.push(sheet.rowNumbers[j])
      }
      return { sheetName: sheet.name, headerRowIndex: i, headers: sheet.rows[i], fieldMapping: mapping, dataRows, dataRowNumbers }
    }
  }
  return null
}

/**
 * 读取 xlsx 内嵌图片，按锚点行归属：Map<"工作表名|Excel行号(1基)", {ext, buffer}>。
 * 供应商清单常把产品图浮动锚在对应行上——每行取第一张；csv/无图返回空 Map。
 */
export async function readWorkbookRowImages(filePath: string): Promise<Map<string, { ext: string; buffer: Buffer }>> {
  const map = new Map<string, { ext: string; buffer: Buffer }>()
  if (extname(filePath).toLowerCase() !== '.xlsx') return map
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.readFile(filePath)
  } catch {
    return map
  }
  workbook.eachSheet((ws) => {
    let images: { imageId: string; range: { tl?: { nativeRow?: number } } }[] = []
    try {
      images = ws.getImages() as typeof images
    } catch {
      return
    }
    for (const img of images) {
      const excelRow = Math.floor(Number(img.range?.tl?.nativeRow ?? -1)) + 1
      if (excelRow <= 0) continue
      const key = `${ws.name}|${excelRow}`
      if (map.has(key)) continue
      try {
        const media = workbook.getImage(Number(img.imageId)) as unknown as { extension?: string; buffer?: Buffer }
        if (media?.buffer) map.set(key, { ext: media.extension || 'png', buffer: Buffer.from(media.buffer) })
      } catch {
        // 单张图取不出跳过
      }
    }
  })
  return map
}
