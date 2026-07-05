import { join, resolve, sep } from 'node:path'

/**
 * 等价复刻 company-os 仓库 .claude/settings.json 里的两条安全规则，
 * 并且比原规则更严格一层：原规则的 knowledge/ 保护只挡 Bash 重定向写入，
 * 不挡 Write/Edit 工具直接写——App 默认不会像 CLI 那样逐次弹权限确认框，
 * 所以这里对 Write/Edit 也做同等的路径拦截，见方案第四节"安全校验层"设计。
 */

const DANGEROUS_BASH_PATTERN = /rm -rf|knowledge\/[^ ]*[ ]*>/

export interface GuardResult {
  allowed: boolean
  reason?: string
}

function isInsideKnowledge(dataDir: string, targetPath: string): boolean {
  const knowledgeRoot = resolve(dataDir, 'knowledge') + sep
  const resolved = resolve(dataDir, targetPath)
  return (resolved + (resolved.endsWith(sep) ? '' : sep)).startsWith(knowledgeRoot) || resolved === resolve(dataDir, 'knowledge')
}

// 销售工作台的两个规范化数据库由 App 托管（合并/去重/落盘都是 App 的机械逻辑），
// 分身只允许写 _待入库/ 暂存文件——直接改库文件容易整库覆盖损坏，这里兜底拦截。
const APP_OWNED_FILES = [join('销售', '产品库', '产品库.json'), join('销售', '客户库.json')]

function isAppOwnedFile(dataDir: string, targetPath: string): boolean {
  const resolved = resolve(dataDir, targetPath)
  return APP_OWNED_FILES.some((rel) => resolved === resolve(dataDir, rel))
}

const FILE_MUTATING_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit'])
const FILE_PATH_INPUT_KEYS = ['file_path', 'path', 'notebook_path']

export function guardToolCall(
  toolName: string,
  input: Record<string, unknown>,
  dataDir: string
): GuardResult {
  if (FILE_MUTATING_TOOLS.has(toolName)) {
    for (const key of FILE_PATH_INPUT_KEYS) {
      const value = input[key]
      if (typeof value === 'string' && isInsideKnowledge(dataDir, value)) {
        return {
          allowed: false,
          reason: `已拦截：knowledge/ 为只读知识库，禁止分身写入或修改（${value}）`
        }
      }
      if (typeof value === 'string' && isAppOwnedFile(dataDir, value)) {
        return {
          allowed: false,
          reason: `已拦截：${value} 由桌面 App 托管，分身请把解析结果写到 销售/产品库/_待入库/ 暂存目录，由 App 校验合并`
        }
      }
    }
  }

  if (toolName === 'Bash') {
    const command = typeof input.command === 'string' ? input.command : ''
    if (DANGEROUS_BASH_PATTERN.test(command)) {
      return {
        allowed: false,
        reason: '已拦截：检测到危险删除操作（rm -rf）或试图覆写只读资料 knowledge/'
      }
    }
  }

  return { allowed: true }
}
