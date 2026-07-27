import { Packer } from 'docx'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildDocument, markdownToDocxChildren } from './docx-export'

interface BookSection {
  title: string
  body: string
}

interface SplitResult {
  /** 第一个 "# 第X册" 标题之前的内容（通常是第一页·废标项自检表） */
  preamble: string
  books: BookSection[]
}

/** 按 "# 第X册 …" 一级标题拆分投标文件初稿 markdown；册数不限（两册体系2个、三册体系3个） */
export function splitIntoBooks(markdown: string): SplitResult {
  const lines = markdown.split('\n')
  const books: BookSection[] = []
  const preambleLines: string[] = []
  let current: BookSection | null = null

  for (const line of lines) {
    const m = /^#\s+(第[一二三四五]册.*)$/.exec(line)
    if (m) {
      if (current) books.push(current)
      current = { title: m[1].trim(), body: '' }
    } else if (current) {
      current.body += line + '\n'
    } else {
      preambleLines.push(line)
    }
  }
  if (current) books.push(current)
  return { preamble: preambleLines.join('\n'), books }
}

/** 从册前导言里提取「废标项自检表」段落块（标题含"废标"，到下一个同级/更高级标题为止） */
export function extractInvalidBidSection(preamble: string): string {
  const lines = preamble.split('\n')
  let start = -1
  let level = 0
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,3})\s+(.*)$/.exec(lines[i])
    if (m && m[2].includes('废标')) {
      start = i
      level = m[1].length
      break
    }
  }
  if (start < 0) return ''
  for (let j = start + 1; j < lines.length; j++) {
    const m = /^(#{1,3})\s+/.exec(lines[j])
    if (m && m[1].length <= level) return lines.slice(start, j).join('\n')
  }
  return lines.slice(start).join('\n')
}

/** 老口径兜底：册标题只写了"第X册"没带册名时按此推断文件名 */
const BOOK_FILE_SUFFIX: Record<string, string> = {
  第一册: '资格证明文件',
  第二册: '商务技术文件',
  第三册: '报价文件'
}

/**
 * bidding 投标文件初稿分册导出：按 "# 第X册 〔册名〕" 切开，各自导出独立 .docx——
 * 册数与册名跟着招标文件走（两册体系出2个、三册体系出3个，文件名=项目名_册名）。
 * 每册第一页自动带上「废标项自检表」（取初稿里第一个册标题之前的废标段落，复制进每册开头）。
 * 每册内部二级标题（##）之间强制分页。对应 bid-draft："不得合并成一个 Word 文件交付"。
 */
export async function exportBiddingTriSplit(
  markdown: string,
  outputDir: string,
  baseName: string
): Promise<{ bookTitle: string; fileName: string; path: string }[]> {
  const { preamble, books } = splitIntoBooks(markdown)
  if (books.length === 0) {
    throw new Error('markdown 中未找到 "# 第X册" 一级标题，无法分册拆分')
  }
  const invalidBidBlock = extractInvalidBidSection(preamble)

  const results: { bookTitle: string; fileName: string; path: string }[] = []
  const usedNames = new Set<string>()
  for (const book of books) {
    // 册名优先取标题里"第X册"之后的文字（跟招标文件口径），没写才按序号兜底
    const bookKey = book.title.slice(0, 3)
    const named = book.title
      .replace(/^第[一二三四五]册[\s·:：、-]*/, '')
      .replace(/[\\/:*?"<>|]/g, '')
      .trim()
    let suffix = named || BOOK_FILE_SUFFIX[bookKey] || book.title
    if (usedNames.has(suffix)) suffix = `${bookKey}_${suffix}`
    usedNames.add(suffix)
    const fileName = `${baseName}_${suffix}.docx`
    const outPath = join(outputDir, fileName)

    const bodyWithChecklist = invalidBidBlock ? `${invalidBidBlock}\n\n${book.body}` : book.body
    const children = markdownToDocxChildren(bodyWithChecklist, { pageBreakBeforeH2: true })
    const buf = await Packer.toBuffer(buildDocument(children))
    writeFileSync(outPath, buf)

    results.push({ bookTitle: book.title, fileName, path: outPath })
  }
  return results
}
