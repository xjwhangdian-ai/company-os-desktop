/**
 * 炬视科技 · 公众号固定视觉主题（单一样式来源）
 * 改公众号风格只改这个文件。所有样式内联（微信编辑器会剥离 <style> 和 class）。
 * 品牌色：墨蓝 #142E4C / 火炬橙 #F39A0E / 科技青 #149AAE / 浅青 #7FD3DC
 */
const NAVY='#142E4C', ORANGE='#F39A0E', TEAL='#149AAE', LTEAL='#7FD3DC';
const TEXT='#3f3f3f', SUB='#8a94a0', LINE='#ececec';
const FONT="-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei','Helvetica Neue',sans-serif";

// 签名卡 logo：从 tools/gzh/assets/ 读干净 logo 转 base64 内嵌（缺失则不显示 logo，卡片照常）
const _fs = require('fs'), _path = require('path');
function logoData(file){
  try {
    const p = _path.join(__dirname, '..', 'assets', file);
    return `data:image/png;base64,${_fs.readFileSync(p).toString('base64')}`;
  } catch (e) { return null; }
}
const LOGO = logoData('炬视_字标白.png');

const T = {
  // 文章容器（微信正文宽度）
  article: `max-width:677px;margin:0 auto;padding:8px 2px;font-family:${FONT};color:${TEXT};`+
           `font-size:16px;line-height:1.5;letter-spacing:.4px;text-align:left;`,

  // H1 文章主标题（居中，墨蓝，橙色下划线）
  h1: `margin:18px 0 4px;font-size:23px;line-height:1.45;font-weight:bold;color:${NAVY};text-align:center;letter-spacing:.5px;`,
  h1rule: `<section style="text-align:center;margin:6px 0 24px;"><span style="display:inline-block;width:44px;height:4px;border-radius:2px;background:${ORANGE};"></span></section>`,

  // H2 章节标题（橙色竖条 + 圆角序号牌 + 墨蓝粗体）
  h2: (txt,no)=>`<section style="margin:34px 0 16px;display:flex;align-items:center;">`+
      `<span style="display:inline-block;width:5px;height:22px;border-radius:3px;background:${ORANGE};margin-right:10px;"></span>`+
      `<span style="display:inline-block;min-width:24px;height:24px;line-height:24px;text-align:center;background:${NAVY};color:#fff;border-radius:6px;font-size:14px;font-weight:bold;margin-right:9px;padding:0 5px;">${no}</span>`+
      `<span style="font-size:19px;font-weight:bold;color:${NAVY};letter-spacing:.5px;">${txt}</span></section>`,

  // H3 小节标题（科技青小方块 + 墨蓝粗体）
  h3: `margin:22px 0 10px;font-size:16.5px;font-weight:bold;color:${NAVY};`,
  h3mark: `display:inline-block;width:9px;height:9px;border-radius:2px;background:${TEAL};margin-right:8px;vertical-align:middle;`,

  // 正文段落
  p: `margin:14px 0;font-size:16px;line-height:1.9;color:${TEXT};letter-spacing:.4px;text-align:justify;`,

  // 行内
  strong: `font-weight:bold;color:${NAVY};`,
  code: `background:#f2f4f6;color:${TEAL};padding:1px 6px;border-radius:4px;font-size:14px;font-family:Menlo,Consolas,monospace;`,
  link: `color:${TEAL};border-bottom:1px solid ${LTEAL};text-decoration:none;`,

  // 引用卡片（科技青左条 + 浅青底）
  quote: `margin:18px 0;padding:14px 18px;background:#eef7f8;border-left:4px solid ${TEAL};border-radius:0 8px 8px 0;`+
         `font-size:15.5px;line-height:1.85;color:${NAVY};letter-spacing:.4px;`,

  // 列表
  listWrap: `margin:14px 0;`,
  uliItem: `margin:9px 0;font-size:16px;line-height:1.85;color:${TEXT};display:flex;align-items:flex-start;`,
  uliDot:  `display:inline-block;width:7px;height:7px;border-radius:2px;background:${ORANGE};margin:9px 11px 0 2px;flex-shrink:0;`,
  oliItem: `margin:9px 0;font-size:16px;line-height:1.85;color:${TEXT};display:flex;align-items:flex-start;`,
  olNum:   `display:inline-block;min-width:21px;height:21px;line-height:21px;text-align:center;background:${TEAL};color:#fff;`+
           `border-radius:50%;font-size:13px;font-weight:bold;margin:2px 10px 0 0;flex-shrink:0;`,

  // 表格
  tableWrap: `margin:18px 0;overflow-x:auto;`,
  table: `width:100%;border-collapse:collapse;font-size:14.5px;`,
  th: `background:${NAVY};color:#fff;font-weight:bold;padding:10px 12px;text-align:left;border:1px solid ${NAVY};`,
  trBase: `background:#fff;`,
  trAlt:  `background:#f3f6f8;`,
  td: `padding:9px 12px;border:1px solid #dfe4ea;color:${TEXT};line-height:1.6;`,

  // 配图位占位（走心文用：发布时在公众号编辑器插入真图）
  photoSlot: `margin:24px 0;padding:30px 18px;border:2px dashed #B9C4CE;border-radius:10px;background:#F5F8FA;text-align:center;`,
  photoSlotLabel: `margin:0;font-size:15px;font-weight:bold;color:${NAVY};letter-spacing:.3px;`,
  photoSlotHint: `margin:7px 0 0;font-size:12.5px;color:#9aa4ae;`,
  photoCaption: `margin:9px 0 2px;font-size:13px;color:${SUB};text-align:center;letter-spacing:.3px;`,

  // 图片
  figWrap: `margin:22px 0;text-align:center;`,
  img: `max-width:100%;border-radius:8px;box-shadow:0 2px 14px rgba(20,46,76,.12);`,
  caption: `margin:8px 0 0;font-size:13px;color:${SUB};text-align:center;letter-spacing:.3px;`,

  // 分隔线（中间三点呼应 logo 节点）
  divider: `<section style="text-align:center;margin:30px 0;">`+
    `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${ORANGE};margin:0 6px;vertical-align:middle;"></span>`+
    `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${TEAL};margin:0 6px;vertical-align:middle;"></span>`+
    `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${ORANGE};margin:0 6px;vertical-align:middle;"></span></section>`,

  // 代码块
  codeblock: `margin:16px 0;padding:14px 16px;background:#0f2740;color:#cfe6ea;border-radius:8px;`+
    `font-family:Menlo,Consolas,monospace;font-size:13.5px;line-height:1.7;overflow-x:auto;`,

  // 文末品牌签名卡
  footer: `<section style="margin:38px 0 10px;padding:28px 20px 24px;background:${NAVY};border-radius:12px;text-align:center;">`+
    (LOGO ? `<img src="${LOGO}" style="height:42px;width:auto;display:block;margin:0 auto 14px;" alt="炬视科技 JUSIGHT"/>` : '')+
    `<p style="margin:0 0 14px;font-size:14px;color:${LTEAL};letter-spacing:1.5px;">为人类点亮科技之光</p>`+
    `<div style="width:44px;height:2px;background:${ORANGE};border-radius:1px;margin:0 auto 14px;opacity:.85;"></div>`+
    `<p style="margin:0 0 4px;font-size:15px;font-weight:bold;color:#fff;letter-spacing:1px;">台州炬视科技有限公司</p>`+
    `<p style="margin:0;font-size:13px;color:${LTEAL};letter-spacing:1px;">具身智能 · 视检万物</p>`+
    `</section>`,
};

// 整页外壳（带「一键复制」按钮；按钮区 user-select:none，复制只取文章节点）
T.page = (article) => `<!doctype html><html lang="zh"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>炬视公众号排版预览</title></head>
<body style="margin:0;background:#e9edf1;font-family:${FONT};">
<div style="position:sticky;top:0;z-index:9;background:#fff;border-bottom:1px solid ${LINE};padding:12px 16px;display:flex;align-items:center;justify-content:space-between;user-select:none;">
  <span style="font-size:13px;color:${SUB};">炬视公众号排版预览 · 点右侧按钮复制后粘贴进公众号编辑器</span>
  <button id="copyBtn" style="background:${ORANGE};color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:14px;font-weight:bold;cursor:pointer;">📋 一键复制全文</button>
</div>
<div style="padding:24px 12px 60px;">
  <div id="art" style="background:#fff;border-radius:10px;box-shadow:0 4px 24px rgba(20,46,76,.08);padding:26px 20px;max-width:701px;margin:0 auto;">
    ${article}
  </div>
</div>
<script>
document.getElementById('copyBtn').addEventListener('click',function(){
  var node=document.getElementById('art');
  var r=document.createRange(); r.selectNodeContents(node);
  var sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  try{ document.execCommand('copy'); this.textContent='✓ 已复制，去公众号粘贴'; this.style.background='${TEAL}'; }
  catch(e){ this.textContent='复制失败，请手动全选'; }
  setTimeout(()=>{ this.textContent='📋 一键复制全文'; this.style.background='${ORANGE}'; },2500);
});
</script>
</body></html>`;

module.exports = T;
