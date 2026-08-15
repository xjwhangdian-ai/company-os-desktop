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
const os = require('os');
const { execFileSync } = require('child_process');

const SRC = process.argv[2];
if (!SRC) { console.error('用法: node gzh_style.js <输入.md> [输出.html] [风格:炬视|瑾智]'); process.exit(1); }
const OUT = process.argv[3] || SRC.replace(/\.md$/i, '') + '_公众号排版.html';
// 第 4 参数选风格：themes/<品牌>.js；缺省或找不到则用本仓库默认 theme.js
const THEME = process.argv[4];
let T;
try { T = THEME ? require('./themes/' + THEME + '.js') : require('./theme.js'); }
catch (e) { T = require('./theme.js'); }
const SRCDIR = path.dirname(path.resolve(SRC));

const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// 解析图片实际路径：绝对路径直用；相对路径先按 md 所在目录找，
// 找不到再从 md 目录逐级向上，直到命中（分身写的图多是相对数据根的 input/…，
// 而 md 在 outputs/… 下，两者基准不同——向上兜底即可两种写法都命中）。
function resolveImg(rel){
  if(path.isAbsolute(rel)) return fs.existsSync(rel) ? rel : null;
  let dir = SRCDIR;
  for(let up=0; up<10; up++){
    const cand = path.resolve(dir, rel);
    if(fs.existsSync(cand)) return cand;
    const parent = path.dirname(dir);
    if(parent === dir) break;
    dir = parent;
  }
  return null;
}

// 大图先缩到 1080px 再内嵌——手机原图动辄十几 MB，base64 后公众号编辑器根本粘不动。
// macOS 用系统 sips 缩放；Windows 不强依赖图像工具，保留原图以保证排版流程不中断。
function shrunk(p, ext){
  try{
    if(fs.statSync(p).size < 500*1024) return p;                 // 小图不折腾
    if(!(ext==='jpg'||ext==='jpeg'||ext==='png')) return p;      // 只缩位图
    const tmp = path.join(os.tmpdir(), `gzh_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext==='png'?'png':'jpg'}`);
    if(process.platform !== 'darwin') return p;
    execFileSync('/usr/bin/sips', ['-Z', '1080', p, '--out', tmp], { stdio: 'ignore' });
    // EXIF 方向转正：iPhone 竖拍照片像素是横的、靠方向标记显示——浏览器认标记，
    // 公众号编辑器不认，粘贴后就旋转90度。这里把像素按标记真正转正并清掉标记。
    try{
      execFileSync('python3', ['-c',
        'import sys\nfrom PIL import Image, ImageOps\nim=Image.open(sys.argv[1])\n' +
        'o=im.getexif().get(274,1)\n' +
        'ImageOps.exif_transpose(im).convert("RGB").save(sys.argv[1],quality=90) if o!=1 else None',
        tmp], { stdio: 'ignore' });
    }catch(e){ /* 无 python3/PIL 时跳过：仅方向标记异常的图仍可能旋转，其余不受影响 */ }
    if(fs.existsSync(tmp) && fs.statSync(tmp).size > 0) return tmp;
  }catch(e){ /* sips 缺失或失败：用原图 */ }
  return p;
}

// 图片转 base64 内嵌
function imgData(rel){
  const src = resolveImg(rel);
  if(!src) return null;
  const ext = src.split('.').pop().toLowerCase();
  const mime = ext==='jpg'||ext==='jpeg' ? 'image/jpeg' : ext==='svg' ? 'image/svg+xml' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(shrunk(src, ext)).toString('base64')}`;
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
      // 若紧跟的下一非空行已是 *图注* 斜体行，就不再把 alt 也渲染成图注（否则出现两行相同说明）。
      let j = i + 1;
      while(j < lines.length && lines[j].trim() === '') j++;
      const nextT = j < lines.length ? lines[j].trim() : '';
      const nextIsCaption = /^\*([^*].*?)\*$/.test(nextT) && !nextT.startsWith('**');
      const cap = (m[1] && !nextIsCaption) ? `<p style="${T.caption}">${esc(m[1])}</p>` : '';
      out.push(`<section style="${T.figWrap}"><img src="${d}" style="${T.img}" alt="${esc(m[1])}"/>${cap}</section>`);
    } else {
      // 找不到图片：给醒目占位并在控制台告警，绝不静默丢图
      console.error('⚠ 图片未找到，已占位：', m[2]);
      out.push(`<section style="${T.photoSlot}"><p style="${T.photoSlotLabel}">📷 图片未找到：${esc(m[1]||'配图')}</p>`
        + `<p style="${T.photoSlotHint}">路径 ${esc(m[2])} 未定位到文件——请核对图片是否已上传到 input/05_运营_operation/，或在编辑器手动插入</p></section>`);
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
