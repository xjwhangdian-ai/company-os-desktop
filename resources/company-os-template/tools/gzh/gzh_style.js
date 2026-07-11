#!/usr/bin/env node
/**
 * 炬视科技 · 公众号一键排版引擎
 * 用法：node gzh_style.js <输入.md> [输出.html]
 * 产出：自包含的样式化 HTML（图片转 base64 内嵌）。
 *   浏览器打开 → 点「一键复制」按钮 → 直接粘贴进微信公众号编辑器。
 * 固定风格：炬视 VI（墨蓝 #142E4C / 火炬橙 #F39A0E / 科技青 #149AAE）。
 * 主题定义见同目录 theme.js（单一来源），改样式只改 theme.js。
 */
const fs = require('fs');
const path = require('path');
const T = require('./theme.js');

const SRC = process.argv[2];
if (!SRC) { console.error('用法: node gzh_style.js <输入.md> [输出.html]'); process.exit(1); }
const OUT = process.argv[3] || SRC.replace(/\.md$/i, '') + '_公众号排版.html';
const SRCDIR = path.dirname(path.resolve(SRC));

const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// 图片转 base64 内嵌
function imgData(rel){
  const p = path.isAbsolute(rel) ? rel : path.resolve(SRCDIR, rel);
  if(!fs.existsSync(p)) return null;
  const ext = p.split('.').pop().toLowerCase();
  const mime = ext==='jpg'||ext==='jpeg' ? 'image/jpeg' : ext==='svg' ? 'image/svg+xml' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
}

// 行内：**粗体**、`代码`、[文字](链接)
function inline(text){
  let s = esc(text);
  s = s.replace(/\*\*([^*]+)\*\*/g, (_,m)=>`<strong style="${T.strong}">${m}</strong>`);
  s = s.replace(/`([^`]+)`/g, (_,m)=>`<code style="${T.code}">${m}</code>`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_,t,u)=>`<a href="${u}" style="${T.link}">${t}</a>`);
  return s;
}

const lines = fs.readFileSync(SRC,'utf8').replace(/\r/g,'').split('\n');
const out = [];
let i=0, h2no=0, inCode=false, codeBuf=[];
const isSep = s => /^\|?[\s:|-]+\|?\s*$/.test(s) && s.includes('-');
const cells = s => s.replace(/^\|/,'').replace(/\|\s*$/,'').split('|').map(c=>c.trim());

while(i<lines.length){
  const raw = lines[i], t = raw.trim();

  // 代码块
  if(t.startsWith('```')){
    if(!inCode){ inCode=true; codeBuf=[]; i++; continue; }
    inCode=false;
    out.push(`<section style="${T.codeblock}">${codeBuf.map(esc).join('<br/>')}</section>`);
    i++; continue;
  }
  if(inCode){ codeBuf.push(raw); i++; continue; }

  if(t===''){ i++; continue; }

  // 图片 ![alt](path)
  let m;
  if((m = t.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/))){
    const d = imgData(m[2]);
    if(d){
      out.push(`<section style="${T.figWrap}"><img src="${d}" style="${T.img}" alt="${esc(m[1])}"/>`
        + (m[1] ? `<p style="${T.caption}">${esc(m[1])}</p>` : '') + `</section>`);
    }
    i++; continue;
  }

  // 配图位占位：【配图位①：xxx】 → 醒目虚线占位框
  if((m = t.match(/^【\s*配图位([^】]*)】\s*$/))){
    const label = m[1].trim();
    out.push(`<section style="${T.photoSlot}"><p style="${T.photoSlotLabel}">📷 配图位${esc(label)}</p>`
      + `<p style="${T.photoSlotHint}">发布时在公众号编辑器此处插入图片</p></section>`);
    i++; continue;
  }
  // 图注：整行 *斜体* （非 **粗体**） → 居中灰色图注
  if((m = t.match(/^\*([^*].*?)\*$/)) && !t.startsWith('**')){
    out.push(`<p style="${T.photoCaption}">${inline(m[1])}</p>`); i++; continue;
  }

  // 分隔线
  if(/^---+$/.test(t) || /^\*\*\*+$/.test(t)){ out.push(T.divider); i++; continue; }

  // 表格
  if(t.startsWith('|') && i+1<lines.length && isSep(lines[i+1].trim())){
    const head = cells(t); i+=2; const rows=[];
    while(i<lines.length && lines[i].trim().startsWith('|')){ rows.push(cells(lines[i].trim())); i++; }
    let html = `<section style="${T.tableWrap}"><table style="${T.table}"><thead><tr>`;
    head.forEach(c=> html += `<th style="${T.th}">${inline(c)}</th>`);
    html += `</tr></thead><tbody>`;
    rows.forEach((r,ri)=>{ html += `<tr style="${ri%2? T.trAlt : T.trBase}">`;
      head.forEach((_,ci)=> html += `<td style="${T.td}">${inline(r[ci]||'')}</td>`); html += `</tr>`; });
    html += `</tbody></table></section>`;
    out.push(html); continue;
  }

  // 标题
  if((m = t.match(/^#\s+(.*)/))){ out.push(`<h1 style="${T.h1}">${inline(m[1])}</h1>${T.h1rule}`); i++; continue; }
  if((m = t.match(/^##\s+(.*)/))){ h2no++; out.push(T.h2(inline(m[1]), h2no)); i++; continue; }
  if((m = t.match(/^###\s+(.*)/))){ out.push(`<h3 style="${T.h3}"><span style="${T.h3mark}"></span>${inline(m[1])}</h3>`); i++; continue; }

  // 引用块（卡片）
  if((m = t.match(/^>\s?(.*)/))){
    const buf=[m[1]]; i++;
    while(i<lines.length && /^>\s?/.test(lines[i].trim())){ buf.push(lines[i].trim().replace(/^>\s?/,'')); i++; }
    out.push(`<section style="${T.quote}">${buf.map(inline).join('<br/>')}</section>`); continue;
  }

  // 有序列表
  if(/^\d+\.\s+/.test(t)){
    const items=[];
    while(i<lines.length && /^\d+\.\s+/.test(lines[i].trim())){ items.push(lines[i].trim().replace(/^\d+\.\s+/,'')); i++; }
    let html = `<section style="${T.listWrap}">`;
    items.forEach((it,k)=> html += `<p style="${T.oliItem}"><span style="${T.olNum}">${k+1}</span><span>${inline(it)}</span></p>`);
    out.push(html + `</section>`); continue;
  }

  // 无序列表
  if(/^[-*]\s+/.test(t)){
    const items=[];
    while(i<lines.length && /^[-*]\s+/.test(lines[i].trim())){ items.push(lines[i].trim().replace(/^[-*]\s+/,'')); i++; }
    let html = `<section style="${T.listWrap}">`;
    items.forEach(it=> html += `<p style="${T.uliItem}"><span style="${T.uliDot}"></span><span>${inline(it)}</span></p>`);
    out.push(html + `</section>`); continue;
  }

  // 普通段落
  out.push(`<p style="${T.p}">${inline(t)}</p>`); i++;
}

const article = `<section style="${T.article}">${out.join('\n')}${T.footer}</section>`;
const page = T.page(article);
fs.writeFileSync(OUT, page);
console.log('OK ->', OUT);
console.log('打开方式: 浏览器打开该 HTML → 点右上「一键复制」→ 粘贴进公众号编辑器');
