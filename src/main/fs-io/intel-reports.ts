import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { IntelReport } from '@shared/agent-types'

// ============ 研报情报（sgpjbg.com）：行业趋势 + 政策文件 ============
// 数据源：outputs/09_情报_intel/研报追踪/{日期}_研报信息流.json
//   由 tools/intel-reports/run_reports.sh（launchd 每天 07:20）抓取，每份带下载页链接，不下 PDF。
// 只读展示，无"确认"动作——研报是参考资料，不像招投标要建项目卡。

const TRACK_DIR_REL = join('outputs', '09_情报_intel', '研报追踪')
const REPORT_STATE_REL = join('outputs', '09_情报_intel', '研报处理状态.json')
const REPORT_FILES_REL = join('outputs', '09_情报_intel', '研报文件')

// ── 处理状态（忽略/已下载，按链接为键；App 托管）────────────────────────────

interface ReportState {
  动作: '已忽略' | '已下载'
  时间: number
  文件?: string
}

function readReportState(dataDir: string): Record<string, ReportState> {
  const p = join(dataDir, REPORT_STATE_REL)
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return {}
  }
}

function writeReportState(dataDir: string, state: Record<string, ReportState>): void {
  const p = join(dataDir, REPORT_STATE_REL)
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
  renameSync(tmp, p)
}

export function ignoreIntelReport(dataDir: string, 链接: string): void {
  const state = readReportState(dataDir)
  state[链接] = { 动作: '已忽略', 时间: Date.now() }
  writeReportState(dataDir, state)
}

// ── 研报关键词（抓取与分组都用它；存管线配置 reports_config.json，改完下次抓取生效）──

const REPORTS_CONFIG_REL = join('tools', 'intel-reports', 'scripts', 'reports_config.json')

export function getReportKeywords(dataDir: string): string[] {
  const p = join(dataDir, REPORTS_CONFIG_REL)
  if (!existsSync(p)) return []
  try {
    const cfg = JSON.parse(readFileSync(p, 'utf-8'))
    return Array.isArray(cfg?.关键词) ? cfg.关键词.map(String) : []
  } catch {
    return []
  }
}

export function setReportKeywords(dataDir: string, keywords: string[]): { ok: boolean; 说明: string } {
  const p = join(dataDir, REPORTS_CONFIG_REL)
  if (!existsSync(p)) return { ok: false, 说明: '本数据仓库没有研报抓取管线配置（tools/intel-reports），无法修改关键词' }
  const clean = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))]
  if (clean.length === 0) return { ok: false, 说明: '关键词不能全删空——至少保留一个' }
  try {
    const cfg = JSON.parse(readFileSync(p, 'utf-8'))
    cfg.关键词 = clean
    const tmp = `${p}.tmp`
    writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf-8')
    renameSync(tmp, p)
    return { ok: true, 说明: `已保存 ${clean.length} 个关键词，明早 07:20 抓取生效（或点「刷新」立即按新词重抓）` }
  } catch {
    return { ok: false, 说明: '关键词配置文件读写失败' }
  }
}

/** 读取最新一天的研报信息流（按文件名日期取最新）。无数据返回空数组。 */
export function listIntelReports(dataDir: string): IntelReport[] {
  const dir = join(dataDir, TRACK_DIR_REL)
  if (!existsSync(dir)) return []
  const files = readdirSync(dir)
    .filter((n) => /^\d{4}-\d{2}-\d{2}_研报信息流\.json$/.test(n))
    .sort()
    .reverse()
  if (files.length === 0) return []

  try {
    const state = readReportState(dataDir)
    const feed = JSON.parse(readFileSync(join(dir, files[0]), 'utf-8'))
    const items = Array.isArray(feed?.报告) ? feed.报告 : []
    const feedDate = String(feed?.日期 ?? files[0].slice(0, 10))
    return items
      .map((r: Record<string, unknown>): IntelReport | null => {
        const 标题 = String(r?.标题 ?? '').trim()
        const 链接 = String(r?.链接 ?? '').trim()
        if (!标题 || !链接) return null
        const st = state[链接]
        if (st?.动作 === '已忽略') return null
        const 分类 = r?.分类 === '政策文件' ? '政策文件' : '行业趋势'
        return {
          分类,
          关键词: String(r?.关键词 ?? ''),
          标题,
          链接,
          页数: typeof r?.页数 === 'number' ? r.页数 : 0,
          发布日期: String(r?.日期 ?? ''),
          VIP: Boolean(r?.VIP),
          抓取日期: feedDate,
          已下载文件: st?.动作 === '已下载' && st.文件 && existsSync(join(dataDir, st.文件)) ? st.文件 : undefined
        }
      })
      .filter((r: IntelReport | null): r is IntelReport => r !== null)
  } catch {
    return []
  }
}

// ── 人工触发重抓（定时任务之外的手动「刷新」）────────────────────────────
// 拉起数据仓库的 run_reports.sh（脚本自带 Chrome 调试实例检测与拉起），
// 抓完与已有当日数据按「链接」去重合并：定时任务已抓到的保留，只补新增。

function fmtToday(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface ReportsFetchResult {
  ok: boolean
  新增条数: number
  说明: string
}

// ── 单份报告下载（「下载」按钮）────────────────────────────────────────────
// 复用调试 Chrome（9222）的 sgpjbg 会员登录态调下载接口拿直链后落盘。
// 仅管理员 Mac 可用；其他机器返回提示，前端退化为打开报告网页手动下载。

async function chromeDebugUp(): Promise<boolean> {
  try {
    const resp = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(3000) })
    return resp.ok
  } catch {
    return false
  }
}

export interface ReportDownloadResult {
  ok: boolean
  说明: string
  /** 成功时的绝对路径（前端 showItemInFolder 用） */
  文件?: string
}

export async function downloadIntelReport(dataDir: string, report: IntelReport): Promise<ReportDownloadResult> {
  if (process.platform !== 'darwin') {
    return { ok: false, 说明: '自动下载依赖管理员 Mac 的登录态浏览器——已为你打开报告网页，请手动下载' }
  }
  const script = join(dataDir, 'tools', 'intel-reports', 'scripts', 'sgpjbg_download.py')
  if (!existsSync(script)) {
    return { ok: false, 说明: '本数据仓库没有研报下载脚本（tools/intel-reports），请手动下载' }
  }
  if (!(await chromeDebugUp())) {
    // 拉起调试 Chrome（与 run_reports.sh 同参数），给它几秒起身
    try {
      spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
        '--remote-debugging-port=9222',
        '--no-proxy-server',
        `--user-data-dir=${process.env.HOME}/.openclaw/chrome-debug-profile`
      ], { detached: true, stdio: 'ignore' }).unref()
      await new Promise((r) => setTimeout(r, 8000))
    } catch {
      // 拉不起来就让脚本自己报错
    }
  }

  const outDir = join(dataDir, REPORT_FILES_REL, report.分类)
  const run = await new Promise<{ code: number; out: string }>((resolve) => {
    const child = spawn('/usr/bin/python3', [script, '--url', report.链接, '--out', outDir, '--title', report.标题], {
      cwd: join(dataDir, 'tools', 'intel-reports', 'scripts')
    })
    let out = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ code: -1, out: out + '{"ok":false,"msg":"下载超时（180秒）"}' })
    }, 180_000)
    child.stdout.on('data', (d) => (out += String(d)))
    child.stderr.on('data', (d) => (out += String(d)))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, out })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: -1, out: JSON.stringify({ ok: false, msg: String(err).slice(0, 80) }) })
    })
  })

  // 脚本 stdout 最后一行是 JSON 结果
  let result: { ok?: boolean; file?: string; msg?: string } = {}
  const lines = run.out.trim().split('\n').reverse()
  for (const line of lines) {
    try {
      result = JSON.parse(line)
      break
    } catch {
      // 继续往上找
    }
  }
  if (result.ok && result.file) {
    const state = readReportState(dataDir)
    state[report.链接] = { 动作: '已下载', 时间: Date.now(), 文件: result.file.replace(`${dataDir}/`, '') }
    writeReportState(dataDir, state)
    return { ok: true, 说明: result.msg ?? '已下载', 文件: result.file }
  }
  return { ok: false, 说明: result.msg ?? '下载失败（未知原因），请点标题到网页手动下载' }
}

export async function fetchReportsNow(dataDir: string): Promise<ReportsFetchResult> {
  if (process.platform !== 'darwin') {
    return { ok: false, 新增条数: 0, 说明: '研报抓取依赖管理员 Mac 上的登录态浏览器，本机不支持手动重抓——数据由管理员机每日更新' }
  }
  const script = join(dataDir, 'tools', 'intel-reports', 'run_reports.sh')
  if (!existsSync(script)) {
    return { ok: false, 新增条数: 0, 说明: '本数据仓库没有研报抓取管线（tools/intel-reports），无法手动重抓' }
  }

  const date = fmtToday()
  const feedPath = join(dataDir, TRACK_DIR_REL, `${date}_研报信息流.json`)

  // 抓取前快照：已有条目按链接留底，避免脚本整文件覆盖时丢掉旧数据
  let before: Record<string, unknown>[] = []
  if (existsSync(feedPath)) {
    try {
      const feed = JSON.parse(readFileSync(feedPath, 'utf-8'))
      if (Array.isArray(feed?.报告)) before = feed.报告
    } catch {
      // 损坏就当没有
    }
  }
  const beforeLinks = new Set(before.map((r) => String(r?.链接 ?? '')))

  const run = await new Promise<{ ok: boolean; output: string }>((resolve) => {
    const child = spawn('/bin/bash', [script, date], { cwd: join(dataDir, 'tools', 'intel-reports') })
    let out = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ ok: false, output: out + '\n抓取超时（300秒）' })
    }, 300_000)
    child.stdout.on('data', (d) => (out += String(d)))
    child.stderr.on('data', (d) => (out += String(d)))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0 && out.includes('OK:'), output: out })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, output: String(err) })
    })
  })

  if (!run.ok) {
    const needsLogin = /未登录|登录|验证/.test(run.output)
    return {
      ok: false,
      新增条数: 0,
      说明: needsLogin
        ? '抓取失败：需要在弹出的调试 Chrome 里登录 sgpjbg 会员（或通过人机验证）后再点一次「刷新」'
        : `抓取失败：${run.output.trim().slice(-120) || '未知错误'}`
    }
  }

  // 去重合并：新抓的为主，把旧有而新抓缺失的条目补回（按链接去重）
  let merged = 0
  try {
    const feed = JSON.parse(readFileSync(feedPath, 'utf-8'))
    const fresh: Record<string, unknown>[] = Array.isArray(feed?.报告) ? feed.报告 : []
    const freshLinks = new Set(fresh.map((r) => String(r?.链接 ?? '')))
    const carried = before.filter((r) => !freshLinks.has(String(r?.链接 ?? '')))
    const 新增 = fresh.filter((r) => !beforeLinks.has(String(r?.链接 ?? ''))).length
    if (carried.length > 0) {
      const tmp = `${feedPath}.tmp`
      writeFileSync(tmp, JSON.stringify({ ...feed, 报告: [...fresh, ...carried] }, null, 2), 'utf-8')
      renameSync(tmp, feedPath)
    }
    merged = 新增
  } catch {
    return { ok: true, 新增条数: 0, 说明: '已重新抓取（结果文件解析异常，请点刷新查看）' }
  }
  return { ok: true, 新增条数: merged, 说明: merged > 0 ? `已重新抓取，新增 ${merged} 份研报（已与定时任务数据去重）` : '已重新抓取，无新增（与定时任务数据一致）' }
}
