/**
 * 瑾智安防 · 公众号固定视觉主题（单一样式来源）
 * 改公众号风格只改这个文件。所有样式内联（微信编辑器会剥离 <style> 和 class）。
 * 品牌色（与门牌/盾徽一致）：深藏蓝 #0D1B33 / 字标蓝 #1E3C6E / 金 #C7A24E
 * 基调：警务蓝金、克制稳重。
 *
 * 2026-08-17 微信兼容性修复：
 *  - 移除全部 display:flex（微信粘贴会剥离 flex 导致序号/圆点与文字分行错乱）
 *  - 空背景 span（竖条/圆点/方块）改文本字形 ▍•■（微信会丢弃空元素）
 *  - font-family 下沉到每个文本块（微信不继承外层 section 的字体）
 *  - 小数号字号改为整数
 */
const NAVY='#0D1B33', BLUE='#1E3C6E', GOLD='#C7A24E', LGOLD='#E5D2A0';
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
const LOGO = logoData('瑾智_盾徽.png');

const T = {
  // 文章容器（微信正文宽度）
  article: `max-width:677px;margin:0 auto;padding:8px 2px;font-family:${FONT};color:${TEXT};`+
           `font-size:16px;line-height:1.5;letter-spacing:.4px;text-align:left;`,

  // H1 文章主标题（居中，深藏蓝，金色下划线）
  h1: `margin:18px 0 4px;font-size:23px;line-height:1.45;font-weight:bold;color:${NAVY};text-align:center;letter-spacing:.5px;font-family:${FONT};`,
  h1rule: `<div style="width:44px;height:4px;border-radius:2px;background:${GOLD};margin:6px auto 24px;"></div>`,

  // H2 章节标题（金色文本竖条 + 藏蓝序号牌 + 深蓝粗体；无 flex，微信安全）
  h2: (txt,no)=>`<section style="margin:34px 0 16px;">`+
      `<span style="color:${GOLD};font-size:22px;font-weight:bold;line-height:1;margin-right:9px;vertical-align:middle;">▍</span>`+
      `<span style="display:inline-block;min-width:24px;height:24px;line-height:24px;text-align:center;background:${NAVY};color:${GOLD};border-radius:6px;font-size:14px;font-weight:bold;margin-right:9px;padding:0 5px;vertical-align:middle;font-family:${FONT};">${no}</span>`+
      `<span style="font-size:19px;font-weight:bold;color:${NAVY};letter-spacing:.5px;vertical-align:middle;font-family:${FONT};">${txt}</span></section>`,

  // H3 小节标题（金色文本方块 + 深蓝粗体）
  h3: `margin:22px 0 10px;font-size:17px;font-weight:bold;color:${NAVY};font-family:${FONT};`,
  h3mark: `color:${GOLD};font-size:13px;margin-right:6px;`,

  // 正文段落
  p: `margin:14px 0;font-size:16px;line-height:1.9;color:${TEXT};letter-spacing:.4px;text-align:justify;font-family:${FONT};`,

  // 行内
  strong: `font-weight:bold;color:${NAVY};`,
  code: `background:#f3f2ee;color:${BLUE};padding:1px 6px;border-radius:4px;font-size:14px;font-family:Menlo,Consolas,monospace;`,
  link: `color:${BLUE};border-bottom:1px solid ${LGOLD};text-decoration:none;`,

  // 引用卡片（金色左条 + 米金底）
  quote: `margin:18px 0;padding:14px 18px;background:#f9f5ea;border-left:4px solid ${GOLD};border-radius:0 8px 8px 0;`+
         `font-size:16px;line-height:1.85;color:${NAVY};letter-spacing:.4px;font-family:${FONT};`,

  // 列表（文本字形圆点/序号，无 flex，微信安全）
  listWrap: `margin:14px 0;`,
  uliItem: `margin:9px 0;font-size:16px;line-height:1.85;color:${TEXT};font-family:${FONT};`,
  uliDot:  `color:${GOLD};font-weight:bold;margin-right:8px;`,
  oliItem: `margin:9px 0;font-size:16px;line-height:1.85;color:${TEXT};font-family:${FONT};`,
  olNum:   `display:inline-block;min-width:21px;height:21px;line-height:21px;text-align:center;background:${BLUE};color:#fff;`+
           `border-radius:50%;font-size:13px;font-weight:bold;margin:2px 10px 0 0;vertical-align:middle;font-family:${FONT};`,

  // 表格
  tableWrap: `margin:18px 0;overflow-x:auto;`,
  table: `width:100%;border-collapse:collapse;font-size:15px;font-family:${FONT};`,
  th: `background:${NAVY};color:${LGOLD};font-weight:bold;padding:10px 12px;text-align:left;border:1px solid ${NAVY};`,
  trBase: `background:#fff;`,
  trAlt:  `background:#f4f5f8;`,
  td: `padding:9px 12px;border:1px solid #dfe2e8;color:${TEXT};line-height:1.6;`,

  // 配图位占位（发布时在公众号编辑器插入真图）
  photoSlot: `margin:24px 0;padding:30px 18px;border:2px dashed #C3BFB2;border-radius:10px;background:#F8F7F3;text-align:center;`,
  photoSlotLabel: `margin:0;font-size:15px;font-weight:bold;color:${NAVY};letter-spacing:.3px;font-family:${FONT};`,
  photoSlotHint: `margin:7px 0 0;font-size:13px;color:#9aa4ae;`,
  photoCaption: `margin:9px 0 2px;font-size:13px;color:${SUB};text-align:center;letter-spacing:.3px;font-family:${FONT};`,

  // 图片
  figWrap: `margin:22px 0;text-align:center;`,
  img: `max-width:100%;border-radius:8px;box-shadow:0 2px 14px rgba(13,27,51,.14);`,
  caption: `margin:8px 0 0;font-size:13px;color:${SUB};text-align:center;letter-spacing:.3px;font-family:${FONT};`,

  // 分隔线（文本三点呼应盾徽五星）
  divider: `<p style="text-align:center;margin:30px 0;letter-spacing:10px;">`+
    `<span style="color:${GOLD};">●</span><span style="color:${BLUE};">●</span><span style="color:${GOLD};">●</span></p>`,

  // 代码块
  codeblock: `margin:16px 0;padding:14px 16px;background:${NAVY};color:#e8e2d2;border-radius:8px;`+
    `font-family:Menlo,Consolas,monospace;font-size:14px;line-height:1.7;overflow-x:auto;`,

  // 文末品牌签名卡（藏蓝底 + 金字）
  footer: `<section style="margin:38px 0 10px;padding:26px 20px 22px;background:${NAVY};border-radius:12px;text-align:center;font-family:${FONT};">`+
    (LOGO ? `<img src="${LOGO}" style="height:64px;width:auto;display:block;margin:0 auto 12px;" alt="瑾智安防盾徽"/>` : '')+
    `<p style="margin:0 0 4px;font-size:20px;font-weight:bold;color:${GOLD};letter-spacing:2px;">瑾智 · JINZHI SECURITY</p>`+
    `<p style="margin:0 0 12px;font-size:13px;color:${LGOLD};letter-spacing:1.5px;">警用装备，瑾智都有；智慧装备，瑾智先行</p>`+
    `<div style="width:44px;height:2px;background:${GOLD};border-radius:1px;margin:0 auto 12px;opacity:.85;"></div>`+
    `<p style="margin:0;font-size:14px;color:#c9d2df;line-height:1.75;">台州市瑾智安防设备有限公司<br/>智慧警用装备 · 无人装备 场景化服务商</p>`+
    `</section>`,
};

// 整页外壳（带「一键复制」按钮；按钮区 user-select:none，复制只取文章节点）
T.page = (article) => `<!doctype html><html lang="zh"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>瑾智公众号排版预览</title></head>
<body style="margin:0;background:#eceef1;font-family:${FONT};">
<div style="position:sticky;top:0;z-index:9;background:#fff;border-bottom:1px solid ${LINE};padding:12px 16px;display:flex;align-items:center;justify-content:space-between;user-select:none;">
  <span style="font-size:13px;color:${SUB};">瑾智公众号排版预览 · 点右侧按钮复制后粘贴进公众号编辑器</span>
  <button id="copyBtn" style="background:${GOLD};color:${NAVY};border:none;border-radius:8px;padding:9px 18px;font-size:14px;font-weight:bold;cursor:pointer;">📋 一键复制全文</button>
</div>
<div style="padding:24px 12px 60px;">
  <div id="art" style="background:#fff;border-radius:10px;box-shadow:0 4px 24px rgba(13,27,51,.08);padding:26px 20px;max-width:701px;margin:0 auto;">
    ${article}
  </div>
</div>
<script>
document.getElementById('copyBtn').addEventListener('click',function(){
  var node=document.getElementById('art');
  var r=document.createRange(); r.selectNodeContents(node);
  var sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  try{ document.execCommand('copy'); this.textContent='✓ 已复制，去公众号粘贴'; this.style.background='${BLUE}'; this.style.color='#fff'; }
  catch(e){ this.textContent='复制失败，请手动全选'; }
  setTimeout(()=>{ this.textContent='📋 一键复制全文'; this.style.background='${GOLD}'; this.style.color='${NAVY}'; },2500);
});
</script>
</body></html>`;

module.exports = T;
