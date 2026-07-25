import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import type { CellValue } from 'exceljs'

// ============ 政采云上架数据包导出（销售分身/人工用，纯机械不经过 AI）============
// 通道A（批量导入模板）落地：把产品库选中产品导出为 上架数据包：
//   商品清单.xlsx（通用版式，含品目甄别打标）+ 图片包/（主图按 瑾智型号.jpg 规范命名）+ 使用说明.md
// 政采云各类目的官方导入模板字段不一（须从供应商后台按类目下载），因此 v1 出"通用清单+图片包"，
// 人工对照官方模板粘贴/导入；后续拿到固定类目模板后可加机械填充。

interface ProductLike {
  id: string
  产品名称: string
  产品分类: string
  品牌: string
  型号: string
  瑾智型号: string
  技术参数: string
  单位: string
  税率: string
  质保期: string
  建议销售价: string
  图片?: string
}

/** 品目甄别（机械预打标，人工终审）：管制/需资质核验/可上架 */
const CONTROLLED_RE = /警棍|手铐|脚铐|催泪|辣椒水|电击|警械|镇暴|抓捕器|约束/
const LICENSE_RE = /执法记录|金属探测|X光|X射线|酒精|背散射|核素|辐射|剂量|防弹|防刺|头盔|盾牌|对讲|图传|无线/

function classify(p: ProductLike): '⛔ 管制-禁止公开上架' | '⚠ 需资质核验' | '✅ 可上架' {
  const hay = `${p.产品名称} ${p.产品分类} ${p.技术参数}`
  if (CONTROLLED_RE.test(hay)) return '⛔ 管制-禁止公开上架'
  if (LICENSE_RE.test(hay)) return '⚠ 需资质核验'
  return '✅ 可上架'
}

export interface ZcyExportResult {
  ok: boolean
  outDir?: string
  count?: number
  管制数?: number
  缺图?: string[]
  说明: string
}

export async function exportZcyPackage(
  dataDir: string,
  products: ProductLike[]
): Promise<ZcyExportResult> {
  if (products.length === 0) return { ok: false, 说明: '没有可导出的产品' }
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const outDir = join(dataDir, 'outputs', '01_销售_sales', `${date}_政采云上架数据包`)
  const imgDir = join(outDir, '图片包')
  mkdirSync(imgDir, { recursive: true })

  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('政采云商品清单')
  const COLS = [
    { h: '序号', w: 6 },
    { h: '品目甄别(人工终审)', w: 18 },
    { h: '商品名称', w: 26 },
    { h: '品牌', w: 10 },
    { h: '型号(对外)', w: 14 },
    { h: '市场价(元)', w: 12 },
    { h: '商品参数', w: 60 },
    { h: '单位', w: 6 },
    { h: '税率', w: 8 },
    { h: '质保期(月)', w: 10 },
    { h: '主图文件名', w: 26 },
    { h: '备注', w: 20 }
  ]
  COLS.forEach((c, i) => (ws.getColumn(i + 1).width = c.w))
  const thin = { style: 'thin' as const, color: { argb: 'FFBBBBBB' } }
  const border = { top: thin, bottom: thin, left: thin, right: thin }
  ws.mergeCells(1, 1, 1, COLS.length)
  const t = ws.getCell(1, 1)
  t.value = `台州市瑾智安防设备有限公司 · 政采云上架商品清单（${date}）`
  t.font = { name: '微软雅黑', size: 13, bold: true }
  t.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.mergeCells(2, 1, 2, COLS.length)
  const sub = ws.getCell(2, 1)
  sub.value =
    '型号取瑾智型号（未赋号回退原厂型号）；涉标品类上架型号必须与检测报告一致（双轨制）；⛔管制品目严禁公开上架；价格为市场价口径，成本与供应商信息不出现在本包任何文件中。'
  sub.font = { name: '微软雅黑', size: 9, color: { argb: 'FF888888' } }
  const HR = 3
  COLS.forEach((c, i) => {
    const cell = ws.getRow(HR).getCell(i + 1)
    cell.value = c.h
    cell.font = { name: '微软雅黑', size: 10, bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EEF5' } }
    cell.border = border
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })

  let 管制数 = 0
  const 缺图: string[] = []
  products.forEach((p, i) => {
    const tag = classify(p)
    if (tag.startsWith('⛔')) 管制数++
    const model = (p.瑾智型号 || p.型号 || '').trim()
    let imgName = ''
    if (p.图片) {
      const src = join(dataDir, p.图片)
      if (existsSync(src)) {
        imgName = `${model || p.产品名称}`.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) + extname(src)
        copyFileSync(src, join(imgDir, imgName))
      }
    }
    if (!imgName) 缺图.push(p.产品名称)
    const row = ws.getRow(HR + 1 + i)
    const vals: CellValue[] = [
      i + 1,
      tag,
      p.品牌 ? `${p.品牌} ${p.产品名称}` : p.产品名称,
      '瑾智',
      model,
      p.建议销售价 || '',
      p.技术参数 || '',
      p.单位 || '台',
      p.税率 || '13%',
      p.质保期 || '',
      imgName || '（缺图，需补 ≥800×800 主图）',
      tag.startsWith('⚠') ? '核对检测报告后再上架' : ''
    ]
    vals.forEach((v, ci) => {
      const cell = row.getCell(ci + 1)
      cell.value = v
      cell.border = border
      cell.font = { name: '微软雅黑', size: 9 }
      cell.alignment = { vertical: 'middle', wrapText: true }
      if (tag.startsWith('⛔') && ci === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } }
      } else if (tag.startsWith('⚠') && ci === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }
      }
    })
  })

  const xlsxPath = join(outDir, `${date}_政采云商品清单.xlsx`)
  await wb.xlsx.writeFile(xlsxPath)

  const readme = [
    `# 政采云上架数据包（${date}）`,
    '',
    '## 用法',
    '1. 登录政采云供应商后台 → 商品管理 → 对应类目下载官方「商品批量导入模板」。',
    '2. 打开本包《政采云商品清单.xlsx》，把各列内容对照粘贴进官方模板（字段名以官方模板为准）。',
    '3. 图片包/ 内主图已按型号规范命名、分辨率 ≥800×800，直接上传。',
    '4. ⛔ 管制行严禁公开上架；⚠ 行先核对检测报告（型号/品牌须与报告一致）再上架。',
    '5. 提交审核后，驳回原因回写产品库备注。',
    '',
    `共 ${products.length} 条；缺主图 ${缺图.length} 条${缺图.length > 0 ? '：' + 缺图.join('、') : ''}。`
  ].join('\n')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(join(outDir, '使用说明.md'), readme, 'utf-8')

  return {
    ok: true,
    outDir,
    count: products.length,
    管制数,
    缺图,
    说明: `已生成上架数据包：${products.length} 条商品清单 + ${products.length - 缺图.length} 张主图（${relative(resolve(dataDir), resolve(outDir))}）${管制数 > 0 ? `；⛔ ${管制数} 条管制品目已标红，严禁公开上架` : ''}${缺图.length > 0 ? `；${缺图.length} 条缺主图` : ''}`
  }
}
