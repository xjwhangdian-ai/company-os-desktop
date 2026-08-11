// ============ 浙江政采中标(成交)结果公告解析（纯函数，intel-fetch 与中标跟进共用）============
// 公告正文（去 HTML 标签后）结构固定：
//   三、中标（成交）信息 1.中标结果： 序号 中标（成交）金额(元) 中标供应商名称 中标供应商地址 评审总得分
//   1 总价：233600（元） XX有限公司 地址… 96.78 四、主要标的信息 …
//   五、评审专家（单一来源采购人员）名单 张三，李四（第1标项采购人代表），王五 六、代理服务收费标准及金额：… 3504
// 坑：金额绝不能用"金额"两个字全局兜底匹配——会命中"六、代理服务收费金额"（此前显示 ¥3,504 的错误来源）。

export interface WinnerLot {
  金额元: number
  供应商: string
}

export interface ExpertInfo {
  姓名: string
  /** 评审专家 / 采购人代表（公告在名字后括注"采购人代表"） */
  角色: '评审专家' | '采购人代表'
  /** 括注原文（如"第1标项采购人代表"），无括注为空 */
  备注: string
}

export interface WinnerParse {
  /** 公告正文的“采购人名称”，用于覆盖列表页缺失或错误的采购单位。 */
  采购单位: string
  中标单位: string
  中标金额: string
  标项: WinnerLot[]
  专家: ExpertInfo[]
}

const SUPPLIER_RE =
  /([^\s，,。；;：:（）()0-9]{3,40}?(?:有限公司|股份公司|有限责任公司|公司|中心|研究院|研究所|事务所|集团|医院|合作社|厂))/

/** HTML → 压平纯文本（&nbsp; 与多空白归一为单空格） */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function fmtYuan(n: number): string {
  if (n >= 10000) {
    const w = n / 10000
    return `¥${w % 1 === 0 ? w : w.toFixed(1)}万`
  }
  return `¥${Math.round(n).toLocaleString('en-US')}`
}

/** 从公告纯文本解析中标结果（多标项全收）与评审专家名单 */
export function parseWinnerAnnouncement(text: string): WinnerParse {
  // 采购人名称在成交结果表之前，取到下一字段标题为止；代理机构名称不能作为采购单位。
  const purchaserMatch = /(?:采购人名称|采购人)[：:\s]+(.{2,100}?)(?=(?:[一二三四五六七八九十]+[、.]|项目名称|项目编号|采购组织类型|采购方式|采购公告|开标日期|成交结果|$))/.exec(text)
  const 采购单位 = purchaserMatch?.[1].trim().replace(/[：:]\s*$/, '') ?? ''
  // ── 中标结果段：从「中标（成交）信息」截到下一大节，绝不跨入「代理服务收费」──
  let seg = text
  const start = text.search(/中标[（(]成交[）)]信息|成交信息|中标结果/)
  if (start >= 0) seg = text.slice(start)
  const end = seg.search(/主要标的信息|评审专家|代理服务收费|公告期限/)
  if (end > 0) seg = seg.slice(0, end)

  const 标项: WinnerLot[] = []
  // 主格式：总价/投标总价/报价：123456（元/万元） + 后随供应商名
  const lotRe = new RegExp(
    String.raw`(?:总价|报价|金额)[：:]\s*([0-9][0-9,，]*(?:\.[0-9]+)?)\s*[（(]?\s*(万?)元[）)]?\s*[，,]?\s*` + SUPPLIER_RE.source,
    'g'
  )
  for (const m of seg.matchAll(lotRe)) {
    const n = parseFloat(m[1].replace(/[,，]/g, ''))
    if (!isFinite(n) || n <= 0) continue
    标项.push({ 金额元: m[2] === '万' ? n * 10000 : n, 供应商: m[3] })
  }
  // 兜底：结果段里先出现的 数字（元）+ 段内第一个公司名。
  // 覆盖阳光采购等表格格式：「供应商名称 | 成交价格 | 备注 | 某公司 | 211460.00元」。
  if (标项.length === 0) {
    const am = /([0-9][0-9,，]*(?:\.[0-9]+)?)\s*[（(]?\s*(万?)元\s*[）)]?/.exec(seg)
    const sm = SUPPLIER_RE.exec(seg.replace(/中标供应商名称|供应商名称/g, ' '))
    if (am || sm) {
      const n = am ? parseFloat(am[1].replace(/[,，]/g, '')) : 0
      标项.push({ 金额元: am && isFinite(n) && n > 0 ? (am[2] === '万' ? n * 10000 : n) : 0, 供应商: sm?.[1] ?? '' })
    }
  }

  // ── 评审专家名单：截「评审专家…名单」到下一个「N、」大节 ──
  const 专家: ExpertInfo[] = []
  const em = /评审专家[^名。；]{0,20}名单[：:]?\s*([^。；]{2,200}?)\s*(?:[一二三四五六七八九十]、|$)/.exec(text)
  if (em) {
    for (const raw of em[1].split(/[，,、；;]/)) {
      const item = raw.trim()
      if (!item) continue
      const noteM = /[（(]([^（）()]*)[）)]/.exec(item)
      const 姓名 = item.replace(/[（(][^（）()]*[）)]/g, '').trim()
      // 人名 2~4 个汉字；过滤"名单""无"之类的杂词
      if (!/^[一-龥·]{2,4}$/.test(姓名) || ['名单', '如下', '无'].includes(姓名)) continue
      const 备注 = noteM?.[1]?.trim() ?? ''
      专家.push({ 姓名, 角色: 备注.includes('采购人代表') ? '采购人代表' : '评审专家', 备注 })
    }
  }

  const 中标单位 =
    标项.length === 0
      ? ''
      : 标项.length === 1
        ? 标项[0].供应商
        : `${标项[0].供应商} 等${标项.length}个标项`
  const total = 标项.reduce((s, l) => s + l.金额元, 0)
  return { 采购单位, 中标单位, 中标金额: total > 0 ? fmtYuan(total) : '', 标项, 专家 }
}
