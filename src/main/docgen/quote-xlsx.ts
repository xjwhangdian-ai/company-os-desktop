import ExcelJS from 'exceljs'

// ============ 机械生成对外报价单 Excel（不经过 AI，秒出） ============
// 两条路径：
//  1) 用户上传的 .xlsx 报价模板：识别表头行与合计行，把产品行填进模板原有版式
//     （抬头/报价说明/联系人落款原样保留——那是模板作者已经写好的对外内容）；
//  2) 无模板：内置标准版式（对齐行业通行的"产品报价单"列结构）。
// 红线：本模块的列映射表里根本没有 成本价/供应商联系人/供应商联系方式 字段，
// 采购侧信息在类型层面就进不了对外报价单。

/** 对外报价单一行——只含可对外字段 */
export interface QuoteRow {
  产品名称: string
  生产制造商: string
  产地: string
  品牌: string
  型号: string
  技术参数: string
  税率: string
  单位: string
  质保期: string
  物料代码: string
  备注: string
  数量: number | null
  数量原文: string
  单价: number | null
  单价原文: string
}

export interface QuoteXlsxOutput {
  合计: number | null
  warnings: string[]
}

// 模板列识别同义词（顺序即优先级；与进货侧表头识别是两套——这里"单价"指我方对外报价）
const QUOTE_COL_SYNONYMS: Record<string, string[]> = {
  序号: ['序号'],
  产品名称: ['产品名称', '品名', '货名', '设备名称', '名称', '产品'],
  型号: ['型号', '规格型号', '开票型号'],
  品牌: ['品牌'],
  生产制造商: ['生产制造商', '制造商', '生产厂家', '厂家', '厂商'],
  产地: ['产地'],
  单位: ['计量单位', '单位'],
  税率: ['税率'],
  质保期: ['质保期', '质保', '保修期'],
  物料代码: ['物料代码', '物料编码'],
  技术参数: ['技术规格', '技术参数', '规格参数', '规格', '参数', '配置'],
  数量: ['数量'],
  单价: ['单价', '含税单价', '报价', '价格'],
  合价: ['合价', '小计', '金额', '总价'],
  备注: ['备注']
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('')
    if ('result' in v) return String(v.result ?? '')
    if ('text' in v) return String(v.text ?? '')
  }
  return String(v)
}

/** 在前 30 行里找表头行：至少要同时命中 产品名称+数量+单价 三列才算报价表头 */
function detectQuoteHeader(ws: ExcelJS.Worksheet): { rowIndex: number; colMap: Record<string, number> } | null {
  const limit = Math.min(ws.rowCount, 30)
  for (let r = 1; r <= limit; r++) {
    const row = ws.getRow(r)
    const colMap: Record<string, number> = {}
    const used = new Set<number>()
    for (const [field, synonyms] of Object.entries(QUOTE_COL_SYNONYMS)) {
      // 先精确后包含、同义词按列表顺序优先（与进货侧表头识别同一套规则）
      let hit = -1
      outer: for (const exact of [true, false]) {
        for (const syn of synonyms) {
          for (let c = 1; c <= ws.columnCount; c++) {
            if (used.has(c)) continue
            const text = cellText(row.getCell(c).value).replace(/\s/g, '')
            if (!text) continue
            if (exact ? text === syn : text.includes(syn)) {
              hit = c
              break outer
            }
          }
        }
      }
      if (hit >= 0) {
        colMap[field] = hit
        used.add(hit)
      }
    }
    if (colMap['产品名称'] && colMap['数量'] && colMap['单价']) return { rowIndex: r, colMap }
  }
  return null
}

function colLetter(n: number): string {
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function fillRow(
  ws: ExcelJS.Worksheet,
  rowIndex: number,
  colMap: Record<string, number>,
  line: QuoteRow,
  seq: number
): void {
  const row = ws.getRow(rowIndex)
  const set = (field: string, value: ExcelJS.CellValue): void => {
    const c = colMap[field]
    if (c) row.getCell(c).value = value
  }
  set('序号', seq)
  set('产品名称', line.产品名称)
  set('生产制造商', line.生产制造商)
  set('产地', line.产地)
  set('品牌', line.品牌)
  set('型号', line.型号)
  set('技术参数', line.技术参数)
  set('税率', line.税率)
  set('单位', line.单位)
  set('质保期', line.质保期)
  set('物料代码', line.物料代码)
  set('备注', line.备注)
  set('数量', line.数量 ?? line.数量原文)
  set('单价', line.单价 ?? line.单价原文)
  if (colMap['合价']) {
    if (line.数量 !== null && line.单价 !== null && colMap['数量'] && colMap['单价']) {
      const f = `${colLetter(colMap['数量'])}${rowIndex}*${colLetter(colMap['单价'])}${rowIndex}`
      row.getCell(colMap['合价']).value = { formula: f, result: line.数量 * line.单价 }
    } else {
      row.getCell(colMap['合价']).value = ''
    }
  }
  row.commit()
}

function sumTotal(lines: QuoteRow[]): number | null {
  let total = 0
  for (const l of lines) {
    if (l.数量 === null || l.单价 === null) return null
    total += l.数量 * l.单价
  }
  return lines.length > 0 ? total : null
}

/** 路径一：往用户的 .xlsx 模板里填行，保留模板自身的抬头/说明/落款版式 */
async function fillTemplate(
  templatePath: string,
  outPath: string,
  lines: QuoteRow[],
  customerName: string
): Promise<QuoteXlsxOutput> {
  const warnings: string[] = []
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(templatePath)
  const ws = wb.worksheets.find((s) => s.name.includes('报价')) ?? wb.worksheets[0]
  if (!ws) throw new Error('模板里没有工作表')
  // 红线：模板工作簿里报价页之外的工作表（如带进货价的"产品清单"页）一律不进对外文件
  for (const other of [...wb.worksheets]) {
    if (other.id !== ws.id) {
      wb.removeWorksheet(other.id)
      warnings.push(`模板里的工作表「${other.name}」未随对外报价输出（防止采购侧信息外流）`)
    }
  }
  // 删表后工作簿的活动页指针可能悬空，重置视图指向仅剩的报价页
  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 0, visibility: 'visible' }]
  const header = detectQuoteHeader(ws)
  if (!header) throw new Error('模板里没识别到报价表头（至少要有 产品名称/名称、数量、单价 三列）——请改用「AI 生成报价文件」')
  const { rowIndex: headerRow, colMap } = header

  // 找合计行：表头之后第一行任一单元格含"合计"
  let totalRow = -1
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    for (let c = 1; c <= ws.columnCount; c++) {
      if (cellText(row.getCell(c).value).includes('合计')) {
        totalRow = r
        break
      }
    }
    if (totalRow > 0) break
  }
  const existingDataRows = totalRow > 0 ? totalRow - headerRow - 1 : 0

  // 行数对齐：保留模板第一条示例行当样式原型，多退少补
  if (existingDataRows === 0) {
    ws.insertRows(headerRow + 1, Array.from({ length: lines.length }, () => []), 'o')
  } else {
    if (existingDataRows > 1) ws.spliceRows(headerRow + 2, existingDataRows - 1)
    if (lines.length > 1) ws.duplicateRow(headerRow + 1, lines.length - 1, true)
  }

  lines.forEach((line, i) => fillRow(ws, headerRow + 1 + i, colMap, line, i + 1))

  // 重新定位合计行并写 SUM 公式
  const total = sumTotal(lines)
  const newTotalRow = headerRow + 1 + lines.length
  const totalRowObj = ws.getRow(newTotalRow)
  let isTotalRow = false
  for (let c = 1; c <= ws.columnCount; c++) {
    if (cellText(totalRowObj.getCell(c).value).includes('合计')) isTotalRow = true
  }
  if (isTotalRow && colMap['合价']) {
    const L = colLetter(colMap['合价'])
    totalRowObj.getCell(colMap['合价']).value =
      total !== null
        ? { formula: `SUM(${L}${headerRow + 1}:${L}${newTotalRow - 1})`, result: total }
        : '以最终商务确认为准'
    totalRowObj.commit()
  } else if (totalRow > 0) {
    warnings.push('模板合计行在插行后没有对上位置，合计请人工核对')
  }

  // 模板里的 {{客户名称}} / {{日期}} 占位符替换（模板没有占位符就跳过）
  const today = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const dateStr = `${today.getFullYear()}年${pad(today.getMonth() + 1)}月${pad(today.getDate())}日`
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      const t = cellText(cell.value)
      if (t.includes('{{')) {
        cell.value = t.replace(/\{\{客户名称\}\}/g, customerName).replace(/\{\{日期\}\}/g, dateStr)
      }
    })
  })

  const missingBrand = lines.filter((l) => !l.品牌 && colMap['品牌'])
  if (missingBrand.length > 0) {
    warnings.push(`${missingBrand.length} 个产品没填"品牌"字段，报价单品牌列留空（供应商名称属采购侧信息，不会代填）`)
  }
  warnings.push('模板里的报价说明/有效期/联系人为模板原文，发出前请人工核对日期与落款')

  await wb.xlsx.writeFile(outPath)
  return { 合计: total, warnings }
}

/** 路径二：内置标准版式（无模板时） */
async function buildStandard(outPath: string, lines: QuoteRow[], customerName: string): Promise<QuoteXlsxOutput> {
  const warnings: string[] = []
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('报价单')
  const COLS = [
    { field: '序号', w: 6 },
    { field: '产品名称', w: 20 },
    { field: '生产制造商', w: 14 },
    { field: '产地', w: 8 },
    { field: '品牌', w: 10 },
    { field: '型号', w: 22 },
    { field: '技术参数', w: 40 },
    { field: '税率', w: 10 },
    { field: '单位', w: 6 },
    { field: '数量', w: 8 },
    { field: '单价', w: 12 },
    { field: '质保期', w: 10 },
    { field: '合价', w: 14 },
    { field: '备注', w: 10 }
  ]
  const HEADER_LABEL: Record<string, string> = {
    技术参数: '技术规格',
    单价: '单价(元)',
    质保期: '质保期(月)',
    合价: '合价(元)'
  }
  const colMap: Record<string, number> = {}
  COLS.forEach((c, i) => {
    colMap[c.field] = i + 1
    ws.getColumn(i + 1).width = c.w
  })

  const thin: Partial<ExcelJS.Borders> = {
    top: { style: 'thin' },
    bottom: { style: 'thin' },
    left: { style: 'thin' },
    right: { style: 'thin' }
  }

  // 标题
  ws.mergeCells(1, 1, 2, COLS.length)
  const title = ws.getCell(1, 1)
  title.value = '产品报价单'
  title.font = { name: '微软雅黑', size: 16, bold: true }
  title.alignment = { horizontal: 'center', vertical: 'middle' }

  // 客户与日期行
  const today = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  ws.mergeCells(3, 1, 3, Math.floor(COLS.length / 2))
  ws.getCell(3, 1).value = `致：${customerName || '〔待确认——填客户单位全称〕'}`
  ws.mergeCells(3, Math.floor(COLS.length / 2) + 1, 3, COLS.length)
  const dateCell = ws.getCell(3, Math.floor(COLS.length / 2) + 1)
  dateCell.value = `报价日期：${today.getFullYear()}年${pad(today.getMonth() + 1)}月${pad(today.getDate())}日`
  dateCell.alignment = { horizontal: 'right' }

  // 表头
  const headerRow = 4
  const hr = ws.getRow(headerRow)
  COLS.forEach((c, i) => {
    const cell = hr.getCell(i + 1)
    cell.value = HEADER_LABEL[c.field] ?? c.field
    cell.font = { name: '微软雅黑', size: 10, bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EEF5' } }
    cell.border = thin
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })

  // 数据行
  lines.forEach((line, i) => {
    const r = headerRow + 1 + i
    fillRow(ws, r, colMap, line, i + 1)
    const row = ws.getRow(r)
    for (let c = 1; c <= COLS.length; c++) {
      const cell = row.getCell(c)
      cell.border = thin
      cell.font = { name: '微软雅黑', size: 10 }
      cell.alignment = { vertical: 'middle', wrapText: true }
    }
    row.getCell(colMap['单价']).numFmt = '#,##0.00'
    row.getCell(colMap['合价']).numFmt = '#,##0.00'
  })

  // 合计行
  const total = sumTotal(lines)
  const totalRowIdx = headerRow + 1 + lines.length
  const tr = ws.getRow(totalRowIdx)
  tr.getCell(2).value = '合计(元)'
  tr.getCell(2).font = { name: '微软雅黑', size: 10, bold: true }
  const L = colLetter(colMap['合价'])
  tr.getCell(colMap['合价']).value =
    total !== null
      ? { formula: `SUM(${L}${headerRow + 1}:${L}${totalRowIdx - 1})`, result: total }
      : '以最终商务确认为准'
  tr.getCell(colMap['合价']).numFmt = '#,##0.00'
  tr.getCell(colMap['合价']).font = { name: '微软雅黑', size: 10, bold: true }
  for (let c = 1; c <= COLS.length; c++) tr.getCell(c).border = thin

  // 报价说明与落款（联系人留人工填——机械生成不猜业务代表是谁）
  const notes = [
    '报价说明：',
    '1、以上报价为含税价。',
    '2、本报价有效期为自报价日期起 60 天。',
    '3、以上报价适用于贵单位采购本清单全部产品的情形，如仅采购部分货物，价格需重新确认。',
    '4、本报价为意向性报价，最终价格及交付、质保等条款以双方签订的合同为准。',
    '',
    '联系人：〔待确认——填业务代表姓名〕',
    '联系电话：〔待确认〕',
    '联系地址：〔待确认〕'
  ]
  notes.forEach((text, i) => {
    const r = totalRowIdx + 2 + i
    ws.mergeCells(r, 1, r, COLS.length)
    const cell = ws.getCell(r, 1)
    cell.value = text
    cell.font = { name: '微软雅黑', size: 10, bold: text === '报价说明：' }
  })
  warnings.push('内置版式的联系人/电话/地址留了〔待确认〕占位，发出前人工补上；或上传公司自己的 xlsx 报价模板后自动沿用其落款')
  const missingBrand = lines.filter((l) => !l.品牌)
  if (missingBrand.length > 0) {
    warnings.push(`${missingBrand.length} 个产品没填"品牌"字段，品牌列留空（供应商名称属采购侧信息，不会代填）`)
  }

  await wb.xlsx.writeFile(outPath)
  return { 合计: total, warnings }
}

export async function generateQuoteXlsx(opts: {
  templatePath: string | null
  outPath: string
  lines: QuoteRow[]
  customerName: string
}): Promise<QuoteXlsxOutput> {
  if (opts.lines.length === 0) throw new Error('报价单没有产品行')
  return opts.templatePath
    ? fillTemplate(opts.templatePath, opts.outPath, opts.lines, opts.customerName)
    : buildStandard(opts.outPath, opts.lines, opts.customerName)
}
