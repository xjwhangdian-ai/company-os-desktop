import { app } from 'electron'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { addCompany, listCompanies, setCompanyDataDir } from './store'
import { ensureCompanySkeleton } from '../fs-io/data-template'

/** 安装包内置数据目录模板的位置（打包后在 resources/，开发时在仓库 resources/） */
export function templateSrcPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'company-os-template')
    : join(app.getAppPath(), 'resources', 'company-os-template')
}

/** 递归把模板里"目标缺失的文件"拷过去——只补缺失，绝不覆盖已有文件。返回补了几个文件 */
function copyMissingFromTemplate(srcDir: string, destDir: string): number {
  let copied = 0
  mkdirSync(destDir, { recursive: true })
  for (const name of readdirSync(srcDir)) {
    const src = join(srcDir, name)
    const dest = join(destDir, name)
    if (statSync(src).isDirectory()) {
      copied += copyMissingFromTemplate(src, dest)
    } else if (!existsSync(dest)) {
      copyFileSync(src, dest)
      copied++
    }
  }
  return copied
}

/**
 * 修复数据目录：把内置模板里缺失的部分（.claude/agents 分身定义、CLAUDE.md、knowledge/、
 * 目录骨架）补进当前数据目录。典型场景：用户把「选择目录」指到了一个普通文件夹
 * （里面没有分身定义），分身列表为空、卡在设置页无法进工作台。只增不改，已有文件原样保留。
 */
export function repairDataDir(dataDir: string): { ok: boolean; copied: number; 说明: string } {
  const src = templateSrcPath()
  if (!existsSync(src)) return { ok: false, copied: 0, 说明: '安装包内未找到数据目录模板（company-os-template）' }
  const copied = copyMissingFromTemplate(src, dataDir)
  ensureCompanySkeleton(dataDir)
  return {
    ok: true,
    copied,
    说明: copied > 0 ? `已补齐 ${copied} 个缺失文件（分身定义/知识库/目录骨架），已有文件未动` : '数据目录完整，无需修复'
  }
}

/**
 * 首启自动初始化数据目录（修复"新用户装完卡在设置页"）：
 * 没有公司或公司还没绑数据目录时，自动在 文稿/company-os 建目录、拷贝安装包内置模板并绑定——
 * 用户装完即用，不需要在设置页手动"选择目录/初始化目录"。
 * 已绑定过目录的老用户完全不受影响（原样跳过，也不做失联目录的自动改绑）。
 */
export function ensureDefaultDataDir(): void {
  try {
    let company = listCompanies()[0] ?? null
    if (company?.dataDir) return // 已配置过（即使目录暂时不可达也不擅自改绑，交给设置页人工处理）

    const docs = app.getPath('documents')
    const looksLikeDataDir = (p: string): boolean => existsSync(join(p, 'CLAUDE.md')) || existsSync(join(p, 'knowledge'))
    const nonHidden = (p: string): string[] => (existsSync(p) ? readdirSync(p).filter((n) => !n.startsWith('.')) : [])

    let target = join(docs, 'company-os')
    if (nonHidden(target).length > 0 && !looksLikeDataDir(target)) {
      // 同名目录被别的东西占用：换一个后缀名，绝不覆盖用户已有文件
      let i = 2
      while (nonHidden(join(docs, `company-os-${i}`)).length > 0 && !looksLikeDataDir(join(docs, `company-os-${i}`))) i++
      target = join(docs, `company-os-${i}`)
    }

    if (!looksLikeDataDir(target)) {
      const templateSrc = templateSrcPath()
      mkdirSync(target, { recursive: true })
      if (existsSync(templateSrc)) cpSync(templateSrc, target, { recursive: true })
    }
    ensureCompanySkeleton(target)

    if (!company) company = addCompany('台州炬视科技')
    setCompanyDataDir(company.id, target)
    console.log('[first-run] 数据目录已自动初始化:', target)
  } catch (err) {
    // 初始化失败不阻塞启动——设置页仍保留"选择目录/初始化目录"人工兜底
    console.error('[first-run] 自动初始化数据目录失败:', err)
  }
}
