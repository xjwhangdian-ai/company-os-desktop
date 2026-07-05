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
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : []
      rows.push(values.map((v) => cellToString(v as ExcelJS.CellValue).trim()))
    })
    sheets.push({ name: ws.name, rows })
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
const FIELD_SYNONYMS: Record<string, string[]> = {
  产品名称: ['产品名称', '品名', '产品', '货名', '设备名称', '名称'],
  产品分类: ['产品分类', '产品类别', '分类', '类别', '品类', '类型', '产品线'],
  技术参数: ['技术参数', '规格参数', '技术规格', '规格型号', '参数', '规格', '配置', '型号'],
  投标报价: ['投标报价', '投标单价', '投标价', '中标价', '中标单价'],
  建议销售价: ['建议销售价', '建议零售价', '建议售价', '指导价', '零售价', '市场价'],
  成本价: ['成本价', '进货价', '采购价', '含税单价', '未税单价', '出厂价', '供货价', '单价', '价格', '报价', '销售价'],
  供应商名称: ['供应商名称', '供应商', '生产厂家', '厂家', '厂商', '品牌'],
  供应商联系人: ['供应商联系人', '联系人'],
  供应商联系方式: ['供应商联系方式', '联系电话', '联系方式', '手机号', '电话', '手机']
}

export interface HeaderDetection {
  sheetName: string
  headerRowIndex: number
  headers: string[]
  /** 字段名 → 命中的列序号 */
  fieldMapping: Record<string, number>
  dataRows: string[][]
}

/** 在第一个工作表的前 30 行里找表头行：至少命中"产品名称"字段的同义词才算有效表头 */
export function detectHeader(sheets: SheetData[]): HeaderDetection | null {
  for (const sheet of sheets) {
    const scanLimit = Math.min(sheet.rows.length, 30)
    for (let i = 0; i < scanLimit; i++) {
      const row = sheet.rows[i]
      const mapping: Record<string, number> = {}
      const usedCols = new Set<number>()
      for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS)) {
        for (let col = 0; col < row.length; col++) {
          if (usedCols.has(col)) continue
          const cell = row[col].replace(/\s/g, '')
          if (!cell) continue
          if (synonyms.some((syn) => cell.includes(syn))) {
            mapping[field] = col
            usedCols.add(col)
            break
          }
        }
      }
      if (mapping['产品名称'] !== undefined && Object.keys(mapping).length >= 2) {
        return {
          sheetName: sheet.name,
          headerRowIndex: i,
          headers: row,
          fieldMapping: mapping,
          dataRows: sheet.rows.slice(i + 1).filter((r) => (r[mapping['产品名称']] ?? '').trim() !== '')
        }
      }
    }
  }
  return null
}
