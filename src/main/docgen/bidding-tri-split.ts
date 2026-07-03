import { Packer } from 'docx'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildDocument, markdownToDocxChildren } from './docx-export'

interface BookSection {
  title: string
  body: string
}

/** 按 "# 第一册/第二册/第三册" 一级标题拆分投标文件初稿 markdown */
export function splitIntoBooks(markdown: string): BookSection[] {
  const lines = markdown.split('\n')
  const sections: BookSection[] = []
  let current: BookSection | null = null

  for (const line of lines) {
    const m = /^#\s+(第[一二三]册.*)$/.exec(line)
    if (m) {
      if (current) sections.push(current)
      current = { title: m[1].trim(), body: '' }
    } else if (current) {
      current.body += line + '\n'
    }
  }
  if (current) sections.push(current)
  return sections
}

const BOOK_FILE_SUFFIX: Record<string, string> = {
  第一册: '资格证明文件',
  第二册: '商务技术文件',
  第三册: '报价文件'
}

/**
 * bidding 投标文件初稿三册拆分导出：按 "# 第一册/第二册/第三册" 切开，
 * 各自导出独立 .docx，且每册内部二级标题（##）之间强制分页。
 * 对应 bid-draft 步骤 9："不得合并成一个 Word 文件交付"。
 */
export async function exportBiddingTriSplit(
  markdown: string,
  outputDir: string,
  baseName: string
): Promise<{ bookTitle: string; fileName: string; path: string }[]> {
  const books = splitIntoBooks(markdown)
  if (books.length === 0) {
    throw new Error('markdown 中未找到 "# 第一册/第二册/第三册" 一级标题，无法按三册拆分')
  }

  const results: { bookTitle: string; fileName: string; path: string }[] = []
  for (const book of books) {
    const bookKey = book.title.slice(0, 3)
    const suffix = BOOK_FILE_SUFFIX[bookKey] ?? book.title
    const fileName = `${baseName}_${suffix}.docx`
    const outPath = join(outputDir, fileName)

    const children = markdownToDocxChildren(book.body, { pageBreakBeforeH2: true })
    const buf = await Packer.toBuffer(buildDocument(children))
    writeFileSync(outPath, buf)

    results.push({ bookTitle: book.title, fileName, path: outPath })
  }
  return results
}
