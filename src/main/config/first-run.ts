import { app } from 'electron'
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { addCompany, listCompanies, setCompanyDataDir } from './store'
import { ensureCompanySkeleton } from '../fs-io/data-template'

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
      const templateSrc = app.isPackaged
        ? join(process.resourcesPath, 'company-os-template')
        : join(app.getAppPath(), 'resources', 'company-os-template')
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
