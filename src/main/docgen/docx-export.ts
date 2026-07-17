import { writeFileSync } from 'node:fs'
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IRunOptions
} from 'docx'

// A4 页面，标准页边距（与本 session 早前手工验证过的 md_to_docx.js 脚本保持一致的排版参数）
const PAGE_WIDTH = 11906
const PAGE_HEIGHT = 16838
const MARGIN = 1440
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

const cellBorder = { style: BorderStyle.SINGLE, size: 2, color: 'AAAAAA' } as const
const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder }

/**
 * 需人工确认的内容在 Word 里用黄色高亮标出（全部分身的 docx 导出统一生效）：
 * 「待确认/待核对/待核实/待补充/待落实/待定」及其所在括注、〔…〕占位符、（内部数据，对外不披露）。
 * 匹配整个括注（如「（待确认，以报价为准）」整段标黄）比只标关键词更醒目。
 */
const PENDING_RE =
  /〔[^〕]*〕|[（(][^（）()]*(?:待确认|待核对|待核实|待补充|待落实|内部数据[，,]对外不披露)[^（）()]*[)）]|待确认|待核对|待核实|待补充|待落实/g

/** 把一段纯文本按"待确认"标记切成 (文字, 是否高亮) 片段 */
function splitPending(text: string): { text: string; highlight: boolean }[] {
  const out: { text: string; highlight: boolean }[] = []
  let last = 0
  PENDING_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PENDING_RE.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), highlight: false })
    out.push({ text: m[0], highlight: true })
    last = PENDING_RE.lastIndex
  }
  if (last < text.length) out.push({ text: text.slice(last), highlight: false })
  return out
}

function pushRuns(runs: TextRun[], text: string, opts: Partial<IRunOptions>): void {
  for (const seg of splitPending(text)) {
    if (!seg.text) continue
    runs.push(new TextRun({ text: seg.text, ...opts, ...(seg.highlight ? { highlight: 'yellow' } : {}) }))
  }
}

function parseInline(text: string, baseOpts: Partial<IRunOptions> = {}): TextRun[] {
  const runs: TextRun[] = []
  const re = /\*\*(.+?)\*\*/g
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) pushRuns(runs, text.slice(lastIndex, m.index), baseOpts)
    pushRuns(runs, m[1], { ...baseOpts, bold: true })
    lastIndex = re.lastIndex
  }
  if (lastIndex < text.length) pushRuns(runs, text.slice(lastIndex), baseOpts)
  if (runs.length === 0) runs.push(new TextRun({ text: '', ...baseOpts }))
  return runs
}

function splitRow(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map((c) => c.trim())
}

const isDelimRow = (cells: string[]): boolean => cells.every((c) => /^:?-+:?$/.test(c))

function makeTable(tableLines: string[]): Table {
  const rows = tableLines.map(splitRow)
  const bodyRows = rows.filter((r) => !isDelimRow(r))
  const colCount = Math.max(...bodyRows.map((r) => r.length))
  const base = Math.floor(CONTENT_WIDTH / colCount)
  const colWidths = new Array(colCount).fill(base)
  colWidths[colCount - 1] = CONTENT_WIDTH - base * (colCount - 1)

  const trows = bodyRows.map((cells, ri) => {
    const isHeader = ri === 0
    return new TableRow({
      tableHeader: isHeader,
      children: colWidths.map(
        (w, ci) =>
          new TableCell({
            borders: cellBorders,
            width: { size: w, type: WidthType.DXA },
            shading: isHeader ? { fill: 'E7EEF5', type: ShadingType.CLEAR } : undefined,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            verticalAlign: 'center',
            children: [new Paragraph({ children: parseInline(cells[ci] || '', isHeader ? { bold: true } : {}) })]
          })
      )
    })
  })

  return new Table({ width: { size: CONTENT_WIDTH, type: WidthType.DXA }, columnWidths: colWidths, rows: trows })
}

const HEADING_MAP = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3]

/**
 * markdown 正文（逐行）转 docx 段落/表格数组。覆盖：# ~ #### 标题、GFM 表格、
 * 引用块（含内部标题/加粗）、无序/有序列表、加粗、代码块、分隔线。
 * 解析不了的行优雅降级为普通段落，不阻塞整体导出。
 *
 * pageBreakBeforeH2：bidding 三册拆分要求二级标题之间强制分页，其余场景不需要。
 */
export function markdownToDocxChildren(markdown: string, opts: { pageBreakBeforeH2?: boolean } = {}): (Paragraph | Table)[] {
  const lines = markdown.split('\n')
  const children: (Paragraph | Table)[] = []
  let sawFirstH2 = false
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (/^\s*---+\s*$/.test(line) && line.trim() !== '') {
      children.push(
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 1 } },
          spacing: { after: 200 },
          children: [new TextRun('')]
        })
      )
      i++
      continue
    }

    if (/^\s*```/.test(line)) {
      i++
      const codeLines: string[] = []
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        codeLines.push(lines[i])
        i++
      }
      i++
      codeLines.forEach((cl) =>
        children.push(new Paragraph({ children: [new TextRun({ text: cl.length ? cl : ' ', font: 'Courier New' })] }))
      )
      continue
    }

    if (/^\s*\|/.test(line)) {
      const tblLines: string[] = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        tblLines.push(lines[i])
        i++
      }
      children.push(makeTable(tblLines))
      children.push(new Paragraph({ text: '' }))
      continue
    }

    if (/^\s*>/.test(line)) {
      const qLines: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        qLines.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      qLines.forEach((ql) => {
        if (ql.trim() === '') {
          children.push(new Paragraph({ text: '' }))
          return
        }
        let text = ql
        let isHeading = false
        const hm = /^#{1,6}\s+(.*)$/.exec(text)
        if (hm) {
          text = hm[1]
          isHeading = true
        }
        children.push(
          new Paragraph({
            indent: { left: 360 },
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: '8FAADC', space: 8 } },
            shading: { fill: 'F2F6FA', type: ShadingType.CLEAR },
            spacing: { before: 80, after: 80 },
            children: parseInline(text, isHeading ? { bold: true, italics: true } : { italics: true })
          })
        )
      })
      continue
    }

    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1].length
      const pageBreakBefore = opts.pageBreakBeforeH2 && level === 2 && sawFirstH2
      if (level === 2) sawFirstH2 = true
      children.push(
        new Paragraph({
          heading: HEADING_MAP[level] || HeadingLevel.HEADING_3,
          pageBreakBefore: pageBreakBefore || undefined,
          children: parseInline(h[2])
        })
      )
      i++
      continue
    }

    const b = /^\s*[-*]\s+(.*)$/.exec(line)
    if (b) {
      children.push(new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: parseInline(b[1]) }))
      i++
      continue
    }

    const o = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (o) {
      children.push(new Paragraph({ numbering: { reference: 'numbers', level: 0 }, children: parseInline(o[1]) }))
      i++
      continue
    }

    if (line.trim() === '') {
      children.push(new Paragraph({ text: '' }))
      i++
      continue
    }

    children.push(new Paragraph({ children: parseInline(line), spacing: { after: 120 } }))
    i++
  }

  return children
}

export function buildDocument(children: (Paragraph | Table)[]): Document {
  return new Document({
    styles: {
      default: { document: { run: { font: 'Arial', size: 22 } } },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 32, bold: true, font: 'Arial' },
          paragraph: { spacing: { before: 240, after: 200 }, outlineLevel: 0 }
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 26, bold: true, font: 'Arial' },
          paragraph: { spacing: { before: 200, after: 160 }, outlineLevel: 1 }
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 24, bold: true, font: 'Arial' },
          paragraph: { spacing: { before: 160, after: 120 }, outlineLevel: 2 }
        }
      ]
    },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } }
            }
          ]
        },
        {
          reference: 'numbers',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } }
            }
          ]
        }
      ]
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN }
          }
        },
        children
      }
    ]
  })
}

export async function exportMarkdownToDocx(markdown: string, outputPath: string): Promise<void> {
  const children = markdownToDocxChildren(markdown)
  const buf = await Packer.toBuffer(buildDocument(children))
  writeFileSync(outputPath, buf)
}
