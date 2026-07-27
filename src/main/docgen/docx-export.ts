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

/** 中文文档字体：中文宋体、西文 Times New Roman（标书/公文通用口径，学习自范本投标文件） */
const CN_BODY_FONT = { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: '宋体' } as const
const CN_HEADING_FONT = { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: '宋体' } as const
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
 * 判断一个 ``` 围栏块是不是"中文纯文本文档"（合同正文/附件/声明），而不是真正的代码/JSON。
 * 法务分身习惯把合同正文塞进 ``` 里手工折行，若按代码渲染会变成等宽字体+死行，排版很糟。
 */
function isPlainTextBlock(lines: string[]): boolean {
  const text = lines.join('\n')
  const cjk = (text.match(/[一-龥]/g) || []).length
  if (cjk < 12) return false
  // 用中文占比判断，而不是"出现过 []/{}"——合同正文里 甲方[名义人]、(GP) 这类
  // ASCII 括号很常见，不能据此当成代码。中文占比高才是纯文本文档。
  const nonSpace = text.replace(/\s/g, '').length
  if (cjk / Math.max(1, nonSpace) < 0.3) return false
  const t = text.trim()
  if (t.startsWith('{') || t.startsWith('[')) return false // JSON/对象字面量
  if (/=>|\bfunction\b|\bconst\b|\breturn\b/.test(text)) return false
  return true
}

/** 明确的条款/段落起始标记：命中则强制另起一段（即使该行是缩进的，如缩进的【情形B】备选条款） */
const STRONG_MARKER =
  /^(第[一二三四五六七八九十百]+条|\d+(\.\d+)+[\s　]|\d+[.、]|[一二三四五六七八九十]+[、.]|（[一二三四五六七八九十]+）|【|附件|鉴于)/

/**
 * 把"中文纯文本文档块"里手工折行的续行并回段落。法务分身的排版惯例是：
 * 顶格行 = 新的条款/字段/落款行，缩进行 = 上一行的手工折行续行——据此还原成完整段落。
 * 另：命中明确条款标记（第X条/1.1/（一）/【/附件/鉴于）的缩进行也强制另起段。
 * 仅调整空白与换行，绝不改动任何文字内容。
 */
function unwrapPlainTextBlock(lines: string[]): string[] {
  const out: string[] = []
  let cur = ''
  const flush = (): void => {
    if (cur) out.push(cur)
    cur = ''
  }
  for (const raw of lines) {
    if (raw.trim() === '') {
      flush()
      if (out[out.length - 1] !== '') out.push('')
      continue
    }
    const indented = /^[ \t　]/.test(raw)
    const trimmed = raw.trim()
    if (cur === '' || !indented || STRONG_MARKER.test(trimmed)) {
      flush()
      cur = trimmed
    } else {
      cur += trimmed
    }
  }
  flush()
  return out
}

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
      if (isPlainTextBlock(codeLines)) {
        // 合同正文/附件这类中文纯文本文档块：用正文字体、并回段落、占位符照常黄色高亮
        for (const para of unwrapPlainTextBlock(codeLines)) {
          if (para === '') {
            children.push(new Paragraph({ text: '' }))
            continue
          }
          children.push(new Paragraph({ children: parseInline(para), spacing: { after: 100, line: 300 } }))
        }
      } else {
        codeLines.forEach((cl) =>
          children.push(new Paragraph({ children: [new TextRun({ text: cl.length ? cl : ' ', font: 'Courier New' })] }))
        )
      }
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
      // 中文公文/标书字体口径（学习自范本投标文件：宋体正文 + 宋体加粗标题；英文数字走 Times New Roman）。
      // 此前全 Arial 是"生成的 Word 格式不对"的主因之一。
      default: { document: { run: { font: CN_BODY_FONT, size: 24 } } },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 36, bold: true, font: CN_HEADING_FONT },
          paragraph: { spacing: { before: 240, after: 200 }, outlineLevel: 0 }
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 32, bold: true, font: CN_HEADING_FONT },
          paragraph: { spacing: { before: 200, after: 160 }, outlineLevel: 1 }
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 28, bold: true, font: CN_HEADING_FONT },
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
