import pptxgen from 'pptxgenjs'
import { basename } from 'node:path'

// ============ markdown 方案 → 汇报版 PPT ============
// 面向"方案写完要去客户那讲一遍"的场景：md 的章节结构直接映射成幻灯片——
//   H1 → 封面；H2 → 章节页+内容页标题；正文/列表 → 要点（每页最多 6 条，超出自动分页）；
//   表格 → PPT 原生表格（列多行多时自动截断并注明"完整表格见 Word 版"）。
// 深蓝商务风（公司无关的中性配色），细节内容以 Word 版为准，PPT 是讲述版。

const BLUE = '1D5AF1'
const INK = '14161C'
const BODY = '3D4655'
const MUTED = '98A1B0'
const MIST = 'F5F6F8'
const WHITE = 'FFFFFF'
const FC = 'Microsoft YaHei'

const MAX_BULLETS_PER_SLIDE = 6
const MAX_TABLE_ROWS = 9
const MAX_TABLE_COLS = 6

interface Section {
  title: string
  /** 每个元素是一"块"：要点列表 或 表格 */
  blocks: ({ kind: 'bullets'; items: { text: string; sub: boolean }[] } | { kind: 'table'; rows: string[][] })[]
}

function stripInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim()
}

function parseMarkdown(markdown: string): { title: string; subtitle: string; sections: Section[] } {
  const lines = markdown.split(/\r?\n/)
  let title = ''
  const subtitleParts: string[] = []
  const sections: Section[] = []
  let cur: Section | null = null
  let curTable: string[][] | null = null

  const pushTable = (): void => {
    if (cur && curTable && curTable.length > 0) cur.blocks.push({ kind: 'table', rows: curTable })
    curTable = null
  }
  const addBullet = (text: string, sub: boolean): void => {
    if (!cur) return
    let last = cur.blocks[cur.blocks.length - 1]
    if (!last || last.kind !== 'bullets') {
      last = { kind: 'bullets', items: [] }
      cur.blocks.push(last)
    }
    last.items.push({ text, sub })
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    const t = line.trim()
    // 表格行
    if (/^\|.*\|$/.test(t)) {
      const cells = t.slice(1, -1).split('|').map((c) => stripInline(c))
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue // 分隔行
      if (!curTable) curTable = []
      curTable.push(cells)
      continue
    }
    pushTable()

    if (t.startsWith('# ')) {
      if (!title) title = stripInline(t.slice(2))
      continue
    }
    const h2 = /^##\s+(.+)$/.exec(t)
    if (h2) {
      cur = { title: stripInline(h2[1]), blocks: [] }
      sections.push(cur)
      continue
    }
    const h3 = /^###\s+(.+)$/.exec(t)
    if (h3) {
      addBullet(`【${stripInline(h3[1])}】`, false)
      continue
    }
    if (!t) continue
    // 引用块：标题下方的说明行进副标题（仅正文开始前）
    if (t.startsWith('>')) {
      if (!cur && subtitleParts.length < 3) subtitleParts.push(stripInline(t.replace(/^>+\s*/, '')))
      continue
    }
    const li = /^([-*]|\d+[.、])\s+(.+)$/.exec(t)
    const isSub = /^\s{2,}/.test(line) && Boolean(li)
    if (li) {
      addBullet(stripInline(li[2]), isSub)
      continue
    }
    // 普通段落：整段变一条要点（太长截断）
    if (cur) {
      const text = stripInline(t)
      if (text) addBullet(text.length > 120 ? `${text.slice(0, 118)}…` : text, false)
    }
  }
  pushTable()
  return { title, subtitle: subtitleParts.join('　'), sections }
}

export async function exportMarkdownToPptx(markdown: string, outputPath: string): Promise<void> {
  const { title, subtitle, sections } = parseMarkdown(markdown)
  const pres = new pptxgen()
  pres.layout = 'LAYOUT_WIDE' // 13.33 x 7.5

  const docTitle = title || basename(outputPath).replace(/\.pptx$/i, '')

  // ── 封面 ──
  {
    const s = pres.addSlide()
    s.background = { color: INK }
    s.addShape('rect', { x: 0, y: 7.32, w: 13.33, h: 0.18, fill: { color: BLUE } })
    s.addText(docTitle, {
      x: 0.9, y: 2.2, w: 11.5, h: 2.2, fontFace: FC, fontSize: docTitle.length > 22 ? 32 : 40,
      bold: true, color: WHITE, valign: 'middle'
    })
    if (subtitle) {
      s.addText(subtitle, { x: 0.92, y: 4.5, w: 11.4, h: 0.8, fontFace: FC, fontSize: 14, color: 'AEB7C6' })
    }
    s.addText('由方案文档自动生成 · 详细内容以 Word 版方案为准', {
      x: 0.92, y: 6.6, w: 11, h: 0.4, fontFace: FC, fontSize: 11, color: '6A7383'
    })
  }

  // ── 目录 ──
  if (sections.length > 1) {
    const s = pres.addSlide()
    s.background = { color: WHITE }
    s.addText('目录', { x: 0.85, y: 0.5, w: 6, h: 0.8, fontFace: FC, fontSize: 28, bold: true, color: INK })
    const items = sections.map((sec, i) => ({
      text: `${String(i + 1).padStart(2, '0')}  ${sec.title}`,
      options: { breakLine: true, paraSpaceAfter: 10 }
    }))
    s.addText(items, { x: 1.1, y: 1.6, w: 11, h: 5.4, fontFace: FC, fontSize: 16, color: BODY, valign: 'top' })
  }

  // ── 章节内容 ──
  sections.forEach((sec, idx) => {
    // 内容分页：把 blocks 摊平成"页"，每页要么一张表，要么最多 N 条要点
    const pages: Section['blocks'] = []
    for (const block of sec.blocks) {
      if (block.kind === 'table') {
        pages.push(block)
      } else {
        for (let i = 0; i < block.items.length; i += MAX_BULLETS_PER_SLIDE) {
          pages.push({ kind: 'bullets', items: block.items.slice(i, i + MAX_BULLETS_PER_SLIDE) })
        }
      }
    }
    if (pages.length === 0) pages.push({ kind: 'bullets', items: [{ text: '（本章详见 Word 版方案）', sub: false }] })

    pages.forEach((page, pi) => {
      const s = pres.addSlide()
      s.background = { color: WHITE }
      s.addText(`${String(idx + 1).padStart(2, '0')} / ${sec.title}`, {
        x: 0.85, y: 0.35, w: 10.5, h: 0.4, fontFace: FC, fontSize: 12, bold: true, color: BLUE, charSpacing: 2
      })
      s.addText(sec.title + (pages.length > 1 ? `（${pi + 1}/${pages.length}）` : ''), {
        x: 0.85, y: 0.72, w: 11.6, h: 0.8, fontFace: FC, fontSize: 24, bold: true, color: INK
      })
      s.addText(docTitle, { x: 9.0, y: 7.08, w: 3.5, h: 0.3, fontFace: FC, fontSize: 8, color: MUTED, align: 'right' })

      if (page.kind === 'bullets') {
        const items = page.items.map((it, j) => ({
          text: it.text.length > 90 ? `${it.text.slice(0, 88)}…` : it.text,
          options: {
            bullet: it.sub ? { characterCode: '2013', indent: 12 } : { characterCode: '25AA', indent: 14 },
            indentLevel: it.sub ? 1 : 0,
            breakLine: j < page.items.length - 1,
            paraSpaceAfter: 14
          }
        }))
        s.addText(items, { x: 1.0, y: 1.85, w: 11.3, h: 5.0, fontFace: FC, fontSize: 15, color: BODY, valign: 'top' })
      } else {
        const truncCols = page.rows[0].length > MAX_TABLE_COLS
        const truncRows = page.rows.length > MAX_TABLE_ROWS
        const rows = page.rows.slice(0, MAX_TABLE_ROWS).map((r) => r.slice(0, MAX_TABLE_COLS))
        const tableRows = rows.map((r, ri) =>
          r.map((c) => ({
            text: c.length > 40 ? `${c.slice(0, 38)}…` : c,
            options: {
              fontFace: FC, fontSize: rows.length > 7 ? 10 : 12, bold: ri === 0,
              color: ri === 0 ? WHITE : BODY,
              fill: { color: ri === 0 ? BLUE : ri % 2 ? MIST : WHITE },
              valign: 'middle' as const
            }
          }))
        )
        s.addTable(tableRows, {
          x: 0.85, y: 1.85, w: 11.6,
          border: { type: 'solid', color: 'FFFFFF', pt: 1 },
          autoPage: false
        })
        if (truncCols || truncRows) {
          s.addText('※ 表格过大已截断展示，完整表格见 Word 版方案', {
            x: 0.85, y: 6.7, w: 11, h: 0.35, fontFace: FC, fontSize: 10, italic: true, color: MUTED
          })
        }
      }
    })
  })

  // ── 结束页 ──
  {
    const s = pres.addSlide()
    s.background = { color: INK }
    s.addShape('rect', { x: 0, y: 7.32, w: 13.33, h: 0.18, fill: { color: BLUE } })
    s.addText('谢谢', { x: 0, y: 3.0, w: 13.33, h: 1.2, fontFace: FC, fontSize: 44, bold: true, color: WHITE, align: 'center' })
    s.addText(docTitle, { x: 0, y: 4.4, w: 13.33, h: 0.5, fontFace: FC, fontSize: 14, color: 'AEB7C6', align: 'center' })
  }

  await pres.writeFile({ fileName: outputPath })
}
