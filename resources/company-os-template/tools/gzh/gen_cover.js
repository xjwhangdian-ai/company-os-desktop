#!/usr/bin/env node
/**
 * 公众号封面首图生成（脚本版，与 App 的「🖼️ 生成封面图」同款设计）。
 * 用法：node gen_cover.js <输入.md> <风格:炬视|瑾智> [输出目录]
 * 产出：横版 900×383（公众号首图 2.35:1）+ 方版 500×500（朋友圈/小图），2x 高清。
 * 标题取 md 的一级标题；渲染用系统 Chrome 无头截图（App 里走 Electron 窗口，无需 Chrome）。
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
]
function findChrome() {
  for (const p of CHROME_CANDIDATES) if (p && fs.existsSync(p)) return p
  return null
}

const BR = {
  炬视: { navy: '#142E4C', deep: '#0A1626', accent: '#F39A0E', accent2: '#149AAE', name: '台州炬视科技', short: '炬视', en: 'JUSIGHT', slogan: '具身智能 · 视检万物' },
  瑾智: { navy: '#0D1B33', deep: '#060E1C', accent: '#C7A24E', accent2: '#1E3C6E', name: '台州瑾智安防', short: '瑾智', en: 'JINZHI SECURITY', slogan: '警用装备，瑾智都有' }
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function tf(t, sq) { const n = [...t].length, b = sq ? 46 : 52; if (n <= 10) return b; if (n <= 16) return b - 8; if (n <= 24) return b - 16; return b - 24 }
function cover(brand, title, w, h, sq) {
  const pad = sq ? 46 : 52, t = tf(title, sq)
  const F = "-apple-system,'PingFang SC','Microsoft YaHei',sans-serif"
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}</style></head><body>
<div style="width:${w}px;height:${h}px;position:relative;overflow:hidden;box-sizing:border-box;background:linear-gradient(135deg,${brand.navy} 0%,${brand.deep} 100%);font-family:${F};">
<div style="position:absolute;right:-90px;top:-90px;width:340px;height:340px;border-radius:50%;background:radial-gradient(circle,${brand.accent}44,transparent 68%);"></div>
<div style="position:absolute;left:-70px;bottom:-70px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,${brand.accent2}33,transparent 70%);"></div>
<div style="position:absolute;inset:0;padding:${pad}px;display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box;">
<div style="display:flex;align-items:center;gap:11px;"><span style="display:inline-block;width:30px;height:6px;border-radius:3px;background:${brand.accent};"></span><span style="color:${brand.accent};font-size:${sq ? 19 : 20}px;font-weight:700;letter-spacing:1.5px;">${esc(brand.short)} · ${esc(brand.en)}</span></div>
<div style="color:#fff;font-size:${t}px;font-weight:800;line-height:1.32;letter-spacing:1px;text-shadow:0 2px 12px rgba(0,0,0,.28);">${esc(title)}</div>
<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:14px;"><span style="color:${brand.accent};font-size:${sq ? 17 : 18}px;font-weight:600;">${esc(brand.slogan)}</span><span style="color:#c9d3de;font-size:${sq ? 15 : 16}px;white-space:nowrap;">${esc(brand.name)}</span></div>
</div></div></body></html>`
}
function h1(md) { for (const l of fs.readFileSync(md, 'utf8').split('\n')) { const m = /^#\s+(.+)$/.exec(l.trim()); if (m) return m[1].replace(/\*\*/g, '').replace(/[#*`>]/g, '').trim() } return path.basename(md).replace(/\.md$/i, '') }

const MD = process.argv[2]
const THEME = process.argv[3] || '炬视'
if (!MD) { console.error('用法: node gen_cover.js <输入.md> <风格:炬视|瑾智> [输出目录]'); process.exit(1) }
const brand = BR[THEME] || BR['炬视']
const OUTDIR = process.argv[4] || path.dirname(path.resolve(MD))
const chrome = findChrome()
if (!chrome) { console.error('未找到 Chrome/Chromium/Edge，无法渲染封面。App 内请用「🖼️ 生成封面图」按钮（走 Electron 无需 Chrome）。'); process.exit(2) }

const title = h1(MD)
const stem = path.basename(MD).replace(/\.md$/i, '').replace(/_公众号推文$/, '')
function shoot(html, w, h, out) {
  const tmp = out + '.tmp.html'
  fs.writeFileSync(tmp, html)
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2', `--window-size=${w},${h}`, `--screenshot=${out}`, 'file://' + path.resolve(tmp)], { stdio: 'ignore' })
  fs.unlinkSync(tmp)
}
const banner = path.join(OUTDIR, `${stem}_封面_${THEME}_横版900x383.png`)
const square = path.join(OUTDIR, `${stem}_封面_${THEME}_方版500x500.png`)
shoot(cover(brand, title, 900, 383, false), 900, 383, banner)
shoot(cover(brand, title, 500, 500, true), 500, 500, square)
console.log('封面 OK ->', banner)
console.log('封面 OK ->', square)
