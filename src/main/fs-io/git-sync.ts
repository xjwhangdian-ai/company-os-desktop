import { execFile } from 'node:child_process'
import { delimiter } from 'node:path'
import { promisify } from 'node:util'
import type { SyncResult, SyncStatus } from '@shared/agent-types'
import { syncPublishedProductCatalog } from './product-catalog'

const execFileAsync = promisify(execFile)

// ============ 一键同步（git pull --rebase + push） ============
// 数据仓库的同步中枢是 git 远程（管理员机器指 GitHub，成员机器可指内网裸仓库）。
// .gitignore 已把 inbox/outputs/knowledge-internal 排除在外——同步的只有"大脑与库"，
// 上传原件与分身产出天然留在本机，这里不需要再做任何过滤。
// 打包 App 从桌面启动时 PATH 可能不含 git 安装目录，这里按平台显式补上；
// 代理环境变量（如 HTTPS_PROXY）随 process.env 自然继承。

const EXTRA_GIT_DIRS =
  process.platform === 'win32'
    ? ['C:\\Program Files\\Git\\cmd', 'C:\\Program Files\\Git\\bin', 'C:\\Program Files (x86)\\Git\\cmd']
    : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

const GIT_ENV = {
  ...process.env,
  PATH: [...EXTRA_GIT_DIRS, process.env.PATH ?? ''].join(delimiter)
}

async function git(dataDir: string, args: string[], timeoutMs = 30000): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', ['-C', dataDir, ...args], { env: GIT_ENV, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 })
}

export async function getSyncStatus(dataDir: string): Promise<SyncStatus> {
  try {
    await git(dataDir, ['rev-parse', '--git-dir'])
  } catch {
    return { isRepo: false, hasRemote: false, branch: '', dirtyCount: 0, ahead: 0, behind: 0 }
  }
  let hasRemote = false
  try {
    const { stdout } = await git(dataDir, ['remote'])
    hasRemote = stdout.trim().length > 0
  } catch {
    /* 保持 false */
  }
  let branch = ''
  try {
    branch = (await git(dataDir, ['branch', '--show-current'])).stdout.trim()
  } catch {
    /* 空 */
  }
  let dirtyCount = 0
  try {
    const { stdout } = await git(dataDir, ['status', '--porcelain'])
    dirtyCount = stdout.split('\n').filter(Boolean).length
  } catch {
    /* 0 */
  }
  // ahead/behind 只看本地已知状态（不触网）——真实 behind 要 fetch，留给 syncNow 做
  let ahead = 0
  let behind = 0
  try {
    const { stdout } = await git(dataDir, ['rev-list', '--left-right', '--count', `${branch}...origin/${branch}`])
    const [a, b] = stdout.trim().split(/\s+/).map(Number)
    ahead = a ?? 0
    behind = b ?? 0
  } catch {
    /* 无上游时保持 0 */
  }
  return { isRepo: true, hasRemote, branch, dirtyCount, ahead, behind }
}

/**
 * 一键同步：本地改动全部提交 → pull --rebase → push。
 * 冲突时中止 rebase 恢复原状，把冲突文件列出来交人工处理——绝不自动"选一边"。
 */
export async function syncNow(dataDir: string, userName: string): Promise<SyncResult> {
  const status = await getSyncStatus(dataDir)
  if (!status.isRepo) return { ok: false, message: '该数据目录不是 git 仓库' }
  if (!status.hasRemote) return { ok: false, message: '还没配置远程仓库（origin）——管理员机器指 GitHub，成员机器指内网仓库，配置方法见使用说明' }
  const branch = status.branch || 'main'

  let committed = false
  try {
    if (status.dirtyCount > 0) {
      await git(dataDir, ['add', '-A'])
      const d = new Date()
      const pad = (n: number): string => String(n).padStart(2, '0')
      const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
      await git(dataDir, [
        '-c', 'user.name=' + (userName || 'company-os-desktop'),
        '-c', 'user.email=sync@company-os-desktop.local',
        'commit', '-q', '-m', `同步：${userName || '未署名'} ${stamp}`
      ])
      committed = true
    }
  } catch (err) {
    return { ok: false, message: `本地提交失败：${err instanceof Error ? err.message : String(err)}` }
  }

  try {
    await git(dataDir, ['pull', '--rebase', 'origin', branch], 120000)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // 冲突：中止 rebase，报出冲突文件
    try {
      const { stdout } = await git(dataDir, ['diff', '--name-only', '--diff-filter=U'])
      const conflicts = stdout.split('\n').filter(Boolean)
      await git(dataDir, ['rebase', '--abort']).catch(() => null)
      if (conflicts.length > 0) {
        return {
          ok: false,
          conflict: true,
          message: `与远程有冲突，已恢复原状不动你的文件。冲突文件：${conflicts.slice(0, 5).join('、')}${conflicts.length > 5 ? ` 等${conflicts.length}个` : ''}——请联系管理员处理后再同步`
        }
      }
    } catch {
      /* fallthrough */
    }
    return { ok: false, message: `拉取远程失败（网络/代理问题最常见）：${msg.slice(0, 200)}` }
  }

  try {
    await git(dataDir, ['push', 'origin', branch], 300000)
  } catch (err) {
    return { ok: false, message: `推送失败（网络/代理问题最常见）：${err instanceof Error ? err.message.slice(0, 200) : String(err)}` }
  }

  return { ok: true, committed, message: committed ? '本地改动已提交并与远程同步完成' : '已与远程同步完成（本地无新改动）' }
}

/**
 * 员工同步：产品库完全以管理员远程版本为准。
 * 先清掉本机产品库的改动、暂存资料和图片，再仅拉取远程；不提交、不推送任何员工端内容。
 */
export async function syncReadOnlyProductLibrary(dataDir: string): Promise<SyncResult> {
  const status = await getSyncStatus(dataDir)
  if (!status.isRepo) return { ok: false, message: '该数据目录不是 git 仓库' }
  if (!status.hasRemote) return { ok: false, message: '还没配置远程仓库，无法同步管理员产品库' }
  const branch = status.branch || 'main'
  const productPath = '销售/产品库'
  try {
    // 仅清理产品库范围，员工的 inbox、outputs 与其它工作文件不受影响。
    await git(dataDir, ['restore', '--source=HEAD', '--staged', '--worktree', '--', productPath]).catch(() => null)
    await git(dataDir, ['clean', '-fd', '--', productPath])
    await git(dataDir, ['pull', '--ff-only', 'origin', branch], 120000)
    return { ok: true, committed: false, message: '已同步管理员产品库（员工端为只读，不会提交本机产品数据）' }
  } catch (err) {
    return { ok: false, message: `同步管理员产品库失败：${err instanceof Error ? err.message.slice(0, 200) : String(err)}` }
  }
}

/**
 * 产品页统一入口：从独立的公开产品发布源读取脱敏销售目录。
 * 不再要求新装电脑的数据目录是 Git 仓库，也不会在安装包内携带私有产品数据。
 */
export async function syncProductLibraryData(dataDir: string, userName: string, isAdmin: boolean): Promise<SyncResult> {
  void userName
  void isAdmin
  return syncPublishedProductCatalog(dataDir)
}
