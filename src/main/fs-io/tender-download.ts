import { copyFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { TenderDownloadResult, TenderProbeResult } from '@shared/agent-types'
import { readProjectCard, saveProjectCard } from './bidding-workflow'
import { extractZjgovParams, readTenderSource } from './intel-source'

// ============ 招标文件下载（招投标分身用）============
// 公告链接从项目 outputs 侧的 _情报来源.json / 00_情报来源.md 读（见 intel-source.ts）。
// 下载走数据仓库的 zjgov_downloader.py（Selenium 复用 Chrome 调试 profile 登录态）——仅浙江政采源可自动下载。

const INBOX_BIDDING_REL = join('input', '03_招投标_bidding')

// 自动下载/探测依赖 Python(Selenium)+ 已登录调试 Chrome 的抓取栈，目前只在 Mac 管理员机就绪。
// 非 macOS（如 Windows 成员机）直接给出手动下载指引，避免 spawn 不存在的可执行文件报错。
const AUTO_DOWNLOAD_SUPPORTED = process.platform === 'darwin'
const WIN_MANUAL_HINT = '当前系统不支持自动下载招标文件，请点项目名超链接在浏览器手动下载后，把文件拖进项目 input/01_招标文件/'

/** Chrome 调试端口 9222 是否就绪；未就绪则拉起（独立 profile，需已登录政采会员） */
function ensureChromeDebug(): Promise<boolean> {
  return new Promise((resolve) => {
    const check = spawn('/usr/bin/curl', ['-s', '-m', '3', 'http://127.0.0.1:9222/json/version'])
    check.on('close', (code) => {
      if (code === 0) return resolve(true)
      spawn(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        [
          '--remote-debugging-port=9222',
          '--no-proxy-server',
          `--user-data-dir=${join(process.env.HOME ?? '', '.openclaw', 'chrome-debug-profile')}`
        ],
        { detached: true, stdio: 'ignore' }
      ).unref()
      setTimeout(() => resolve(true), 8000)
    })
    check.on('error', () => resolve(false))
  })
}

function runDownloader(
  dataDir: string,
  articleId: string,
  categoryCode: string
): Promise<{ ok: boolean; output: string; needsLogin: boolean }> {
  const scriptsDir = join(dataDir, 'tools', 'bidding-intel', 'scripts')
  const script = join(scriptsDir, 'zjgov_downloader.py')
  if (!existsSync(script)) {
    return Promise.resolve({ ok: false, output: '下载脚本不存在（tools/bidding-intel 未同步）', needsLogin: false })
  }
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/python3', [script, articleId, '--source', 'zjgov', '--category-code', categoryCode], {
      cwd: scriptsDir
    })
    let out = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ ok: false, output: out + '\n下载超时（180秒）', needsLogin: false })
    }, 180_000)
    child.stdout.on('data', (d) => (out += String(d)))
    child.stderr.on('data', (d) => (out += String(d)))
    child.on('close', (code) => {
      clearTimeout(timer)
      const needsLogin = /登录|验证中|正在验证|请.*登录|not logged|verification/i.test(out)
      resolve({ ok: code === 0 && out.includes('下载完成'), output: out, needsLogin })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, output: String(err), needsLogin: false })
    })
  })
}

function runProbe(
  dataDir: string,
  articleId: string,
  categoryCode: string
): Promise<{ ok: boolean; 附件: { name: string }[]; needsLogin: boolean; output: string }> {
  const scriptsDir = join(dataDir, 'tools', 'bidding-intel', 'scripts')
  const script = join(scriptsDir, 'zjgov_downloader.py')
  if (!existsSync(script)) {
    return Promise.resolve({ ok: false, 附件: [], needsLogin: false, output: '下载脚本不存在（tools/bidding-intel 未同步）' })
  }
  return new Promise((resolve) => {
    const child = spawn(
      '/usr/bin/python3',
      [script, articleId, '--source', 'zjgov', '--category-code', categoryCode, '--probe'],
      { cwd: scriptsDir }
    )
    let out = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ ok: false, 附件: [], needsLogin: false, output: out + '\n探测超时（60秒）' })
    }, 60_000)
    child.stdout.on('data', (d) => (out += String(d)))
    child.stderr.on('data', (d) => (out += String(d)))
    child.on('close', () => {
      clearTimeout(timer)
      const needsLogin = /登录|验证中|正在验证|请.*登录|not logged|verification/i.test(out)
      const m = out.match(/PROBE_START\s*([\s\S]*?)\s*PROBE_END/)
      if (!m) return resolve({ ok: false, 附件: [], needsLogin, output: out })
      try {
        const parsed = JSON.parse(m[1])
        const 附件 = Array.isArray(parsed?.attachments)
          ? parsed.attachments.map((a: { name?: string }) => ({ name: String(a?.name ?? '').trim() })).filter((a) => a.name)
          : []
        resolve({ ok: true, 附件, needsLogin, output: out })
      } catch {
        resolve({ ok: false, 附件: [], needsLogin, output: out })
      }
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, 附件: [], needsLogin: false, output: String(err) })
    })
  })
}

/**
 * 下载前探测招标公告的附件清单（不落盘）。仅浙江政采源可探测；
 * 采购意向类公告的「无招标文件」判断在 UI 侧按 公告类型 拦截，不走这里。
 */
export async function probeTenderFile(dataDir: string, folderName: string): Promise<TenderProbeResult> {
  if (!AUTO_DOWNLOAD_SUPPORTED) {
    return { ok: false, needsLogin: false, 附件: [], 说明: WIN_MANUAL_HINT }
  }
  const src = readTenderSource(dataDir, folderName)
  if (!src || !src.公告链接) {
    return { ok: false, needsLogin: false, 附件: [], 说明: '本项目无公告链接，请手动拖入招标文件' }
  }
  const params = extractZjgovParams(src.公告链接)
  if (!params) {
    return {
      ok: false,
      needsLogin: false,
      附件: [],
      说明: `来源「${src.来源平台 || '未知'}」暂不支持自动下载，请点公告链接手动下载后拖入项目`
    }
  }
  const r = await runProbe(dataDir, params.articleId, params.categoryCode)
  if (r.needsLogin && !r.ok) {
    return { ok: false, needsLogin: true, 附件: [], 说明: '招标网站需要登录或人工过验证：请在弹出的调试 Chrome 里登录后重试' }
  }
  if (!r.ok) {
    return { ok: false, needsLogin: false, 附件: [], 说明: '探测附件失败，可点公告链接手动下载后拖入项目' }
  }
  if (r.附件.length === 0) {
    return { ok: true, needsLogin: false, 附件: [], 说明: '该公告页未探测到附件（可能正文即公告内容），点项目名超链接查看原文即可' }
  }
  return { ok: true, needsLogin: false, 附件: r.附件, 说明: `探测到 ${r.附件.length} 个附件` }
}

/**
 * 下载某项目的招标文件到 input 侧 01_招标文件/，成功则回填项目卡招标编号。
 * 登录感知：脚本复用 Chrome 调试 profile 的登录态；若被反爬/未登录拦截，返回 needsLogin=true 让 UI 提示先登录。
 */
export async function downloadTenderFile(dataDir: string, folderName: string): Promise<TenderDownloadResult> {
  if (!AUTO_DOWNLOAD_SUPPORTED) {
    return { ok: false, 已下载文件数: 0, needsLogin: false, 说明: WIN_MANUAL_HINT }
  }
  const src = readTenderSource(dataDir, folderName)
  if (!src || !src.公告链接) {
    return { ok: false, 已下载文件数: 0, needsLogin: false, 说明: '本项目无公告链接（非情报推送来的项目），请手动拖入招标文件' }
  }
  const params = extractZjgovParams(src.公告链接)
  if (!params) {
    return {
      ok: false,
      已下载文件数: 0,
      needsLogin: false,
      说明: `来源「${src.来源平台 || '未知'}」暂不支持自动下载，请点公告链接手动下载后拖入项目`
    }
  }

  await ensureChromeDebug()
  const r = await runDownloader(dataDir, params.articleId, params.categoryCode)
  if (!r.ok) {
    if (r.needsLogin) {
      return {
        ok: false,
        已下载文件数: 0,
        needsLogin: true,
        说明: '招标网站需要登录或人工过验证：请在弹出的调试 Chrome 里登录/通过验证后，再点一次「下载招标文件」'
      }
    }
    return { ok: false, 已下载文件数: 0, needsLogin: false, 说明: '自动下载失败，请点公告链接手动下载后拖入项目' }
  }

  let 已下载文件数 = 0
  const dirMatch = r.output.match(/本地路径:\s*(.+)/)
  const localDir = dirMatch?.[1]?.trim()
  if (localDir && existsSync(localDir)) {
    const destDir = join(dataDir, INBOX_BIDDING_REL, folderName, '01_招标文件')
    for (const f of readdirSync(localDir)) {
      const s = join(localDir, f)
      if (!statSync(s).isFile() || f.endsWith('.json')) continue
      const dest = join(destDir, f)
      if (!existsSync(dest)) {
        copyFileSync(s, dest)
        已下载文件数 += 1
      }
    }
  }

  // 有些公告正文即通知、页面本就无附件，要和"下载失败"区分开
  const noAttachment = /发现 0 个附件|附件:\s*0\/0/.test(r.output)

  const codeMatch = r.output.match(/项目编号:\s*(\S+)/)
  if (codeMatch) {
    const card = readProjectCard(dataDir, folderName)
    if (card && !card.招标编号) {
      card.招标编号 = codeMatch[1]
      saveProjectCard(dataDir, folderName, card)
    }
  }

  if (已下载文件数 > 0) {
    return { ok: true, 已下载文件数, needsLogin: false, 说明: `招标文件已下载（${已下载文件数} 个），已放入项目 01_招标文件/` }
  }
  return {
    ok: false,
    已下载文件数: 0,
    needsLogin: false,
    说明: noAttachment
      ? '该招标公告页无附件（正文即公告内容），点项目名超链接查看原文即可'
      : '未获取到新附件（可能此前已下载过，见项目 01_招标文件/）'
  }
}
