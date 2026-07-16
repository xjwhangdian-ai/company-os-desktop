import JSZip from 'jszip'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// ============ 合同修订版生成：把分身的修改意见以 Word「修订模式」写回原合同 ============
// 输入：原合同 .docx + 修订清单 [{原文, 修改为, 理由}]（原文必须逐字来自合同）。
// 做法：解包 docx → 逐段落把命中"原文"的文字改写成 <w:del>原文</w:del><w:ins>修改为</w:ins>，
// 保留原 run 的字体格式；作者署名"炬视法务分身"。Word/WPS 打开即是标准修订模式，
// 人工可逐条"接受/拒绝修订"。理由不进正文（正文保持干净），随意见书查看。

export interface RedlineItem {
  原文: string
  修改为: string
  理由?: string
}

export interface RedlineResult {
  ok: boolean
  outPath?: string
  applied: number
  missed: RedlineItem[]
  说明: string
}

const AUTHOR = '炬视法务分身'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

interface Run {
  xml: string
  text: string
  rPr: string
}

/** 提取一个段落里的 run 序列（只处理带 <w:t> 的普通文字 run，其余节点原样保留位置信息） */
function parseRuns(pXml: string): { runs: Run[]; template: string[] } {
  // template: 段落被 run 分割后的碎片（run 之间的其他 XML），runs[i] 位于 template[i] 与 template[i+1] 之间
  const runs: Run[] = []
  const template: string[] = []
  const re = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(pXml)) !== null) {
    const runXml = m[0]
    // 只把"纯文字 run"纳入可编辑序列；含图片/域代码等复杂 run 不动
    const tMatch = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/.exec(runXml)
    const hasComplex = /<w:(drawing|pict|fldChar|instrText|object)\b/.test(runXml)
    if (!tMatch || hasComplex) continue
    template.push(pXml.slice(last, m.index))
    const rPr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(runXml)?.[0] ?? ''
    const text = tMatch[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
    runs.push({ xml: runXml, text, rPr })
    last = m.index + runXml.length
  }
  template.push(pXml.slice(last))
  return { runs, template }
}

function makeRun(rPr: string, text: string): string {
  return `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
}

let revId = 9000
function makeDelIns(rPr: string, delText: string, insText: string): string {
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  let out = ''
  if (delText) {
    out += `<w:del w:id="${revId++}" w:author="${AUTHOR}" w:date="${date}"><w:r>${rPr}<w:delText xml:space="preserve">${esc(delText)}</w:delText></w:r></w:del>`
  }
  if (insText) {
    out += `<w:ins w:id="${revId++}" w:author="${AUTHOR}" w:date="${date}">${makeRun(rPr, insText)}</w:ins>`
  }
  return out
}

/** 在单个段落 XML 里应用一条修订；命中返回新段落 XML，未命中返回 null */
function applyToParagraph(pXml: string, item: RedlineItem): string | null {
  const { runs, template } = parseRuns(pXml)
  if (runs.length === 0) return null
  const joined = runs.map((r) => r.text).join('')
  const idx = joined.indexOf(item.原文)
  if (idx < 0) return null

  const end = idx + item.原文.length
  // 逐 run 重建：命中区间之前/之后的文字保留原格式，命中区间替换为 del+ins
  let cursor = 0
  let insertedMark = false
  const rebuilt: string[] = []
  for (let i = 0; i < runs.length; i++) {
    rebuilt.push(template[i])
    const r = runs[i]
    const rStart = cursor
    const rEnd = cursor + r.text.length
    cursor = rEnd
    if (rEnd <= idx || rStart >= end) {
      rebuilt.push(r.xml) // 完全在命中区间外，原样保留
      continue
    }
    // 与命中区间有交集：拆出前缀/后缀
    const prefix = r.text.slice(0, Math.max(0, idx - rStart))
    const suffix = r.text.slice(Math.min(r.text.length, end - rStart))
    if (prefix) rebuilt.push(makeRun(r.rPr, prefix))
    if (!insertedMark) {
      const anchorRPr = runs.find((x, j) => j >= i && x.rPr)?.rPr ?? r.rPr
      rebuilt.push(makeDelIns(anchorRPr, item.原文, item.修改为))
      insertedMark = true
    }
    if (suffix) rebuilt.push(makeRun(r.rPr, suffix))
  }
  rebuilt.push(template[runs.length])
  return rebuilt.join('')
}

/**
 * 生成修订版合同。matched-first 策略：每条修订只应用第一次命中（合同同句多处出现时，
 * 分身应在"原文"里带足上下文使其唯一）。跨段落的原文无法命中（清单里应按段拆条）。
 */
export async function generateContractRedline(
  originalDocxPath: string,
  items: RedlineItem[],
  outPath: string
): Promise<RedlineResult> {
  if (!/\.docx$/i.test(originalDocxPath)) {
    return { ok: false, applied: 0, missed: items, 说明: '只支持 .docx 格式的原合同（pdf/doc 请先转成 docx 再上传）' }
  }
  if (!existsSync(originalDocxPath)) {
    return { ok: false, applied: 0, missed: items, 说明: '原合同文件不存在（可能已被移动）' }
  }
  const zip = await JSZip.loadAsync(readFileSync(originalDocxPath))
  const docFile = zip.file('word/document.xml')
  if (!docFile) return { ok: false, applied: 0, missed: items, 说明: '合同文件损坏（缺 document.xml）' }
  let xml = await docFile.async('string')

  const missed: RedlineItem[] = []
  let applied = 0

  for (const item of items) {
    const 原文 = String(item.原文 ?? '').trim()
    if (!原文) {
      missed.push(item)
      continue
    }
    // 逐段落尝试（避免跨段正则灾难）：找到第一个包含命中文本的段落
    const pRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g
    let done = false
    let m: RegExpExecArray | null
    while (!done && (m = pRe.exec(xml)) !== null) {
      const replaced = applyToParagraph(m[0], { ...item, 原文 })
      if (replaced) {
        xml = xml.slice(0, m.index) + replaced + xml.slice(m.index + m[0].length)
        applied++
        done = true
      }
    }
    if (!done) missed.push(item)
  }

  if (applied === 0) {
    return { ok: false, applied: 0, missed, 说明: '没有任何一条修订能在合同原文中定位（原文引用与合同不一致），修订版未生成' }
  }

  zip.file('word/document.xml', xml)
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  writeFileSync(outPath, buf)
  return {
    ok: true,
    outPath,
    applied,
    missed,
    说明:
      missed.length === 0
        ? `已生成修订版合同（${applied} 处修订，Word 打开即为修订模式，可逐条接受/拒绝）`
        : `已生成修订版合同（${applied} 处修订；另有 ${missed.length} 条因原文引用不一致未能定位，详见意见书）`
  }
}
