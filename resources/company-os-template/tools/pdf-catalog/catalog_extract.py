#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
产品画册 PDF → 抽图 + 文本提取 + 配对定稿（供 sales 分身/人工整理成产品清单用）。

两个阶段：
  阶段1 抽取：python3 catalog_extract.py <画册.pdf> <产出目录>
    _候选图/       每页检测到的候选产品照（P{页}_{序}.jpg）——中间产物，数量偏多是正常的
    _整页/         每页整页位图，配对/复核时看整页
    _标注/         每页标注候选框编号的图（原图1/2大小），分身照它核对"编号↔产品"
    文本提取.md    每页文本层（型号/名称/参数原文）
    _候选.json     结构化候选框坐标

  阶段2 定稿：python3 catalog_extract.py --apply <产出目录>
    读分身写的 <产出目录>/_配对.json：
      [{"序号":1,"型号":"HW-1","产品名称":"排爆服","页":5,"候选":0}, {"...","框":[x0,y0,x1,y1]}]
      候选=阶段1候选编号；候选不合适时用 框（按 _整页/P{页}.jpg 原图像素）。
    产出 <产出目录>/产品图片/：每个产品一张成品图，命名 序号_型号_产品名称_P页.jpg。

说明：数字排版画册效果最好；整页扫描件抽不出独立图。一页多产品的精确图文配对由
sales 分身照 _标注/ 逐页核对后写 _配对.json（配图铁律），机械只负责抠图与执行清单。
依赖：pypdf、Pillow、numpy（缺失时 App 会提示 pip 安装）。
"""
import sys, os, json, re, warnings
warnings.filterwarnings("ignore")

try:
    from pypdf import PdfReader
    from PIL import Image, ImageFilter, ImageDraw, ImageFont
    import numpy as np
except ImportError as e:
    print("MISSING_DEP:" + str(e), file=sys.stderr)
    sys.exit(3)


def page_bitmap(page):
    """取该页最大的嵌入位图（数字画册每页通常一张整页底图）。"""
    imgs = list(page.images)
    if not imgs:
        return None
    main = max(imgs, key=lambda im: len(im.data))
    import io
    try:
        return Image.open(io.BytesIO(main.data)).convert("RGB")
    except Exception:
        return None


def detect_boxes(im, min_area_frac=0.004):
    """在整页位图上找"产品照候选块"：饱和/暗的密集连通域，过滤扁长条(标题栏)与稀碎文字。"""
    W, H = im.size
    k = 4
    sm = im.resize((max(1, W // k), max(1, H // k)))
    a = np.asarray(sm).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = mx - mn
    fg = (mx < 180) | (sat > 40)
    m = np.asarray(Image.fromarray((fg * 255).astype("uint8")).filter(ImageFilter.MaxFilter(7))) > 0
    h, w = m.shape
    seen = np.zeros_like(m, bool)
    out = []
    for y in range(h):
        for x in range(w):
            if m[y, x] and not seen[y, x]:
                st = [(y, x)]
                seen[y, x] = True
                n = 0
                x0 = x1 = x
                y0 = y1 = y
                while st:
                    cy, cx = st.pop()
                    n += 1
                    x0 = min(x0, cx); x1 = max(x1, cx); y0 = min(y0, cy); y1 = max(y1, cy)
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w and m[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            st.append((ny, nx))
                bw, bh = (x1 - x0 + 1), (y1 - y0 + 1)
                area = bw * bh
                if area < h * w * min_area_frac:
                    continue
                ar = bw / bh
                fill = n / area
                if ar > 4 or ar < 0.15 or fill < 0.25:
                    continue
                out.append(dict(x0=x0 * k, y0=y0 * k, x1=x1 * k, y1=y1 * k,
                                w=bw * k, h=bh * k, fill=round(fill, 2)))
    # 左栏在前、上到下，编号稳定
    out.sort(key=lambda bx: (0 if (bx["x0"] + bx["x1"]) / 2 < W / 2 else 1, bx["y0"]))
    return out


def _slug(s):
    return re.sub(r'[\\/:*?"<>|\s]+', "_", str(s or "")).strip("_")[:36]


def apply_pairing(out):
    """阶段2：按分身写的 _配对.json 产出成品图 产品图片/序号_型号_产品名称_P页.jpg"""
    pairing = os.path.join(out, "_配对.json")
    if not os.path.exists(pairing):
        print(json.dumps({"ok": False, "needPairing": True,
                          "说明": "还没有 _配对.json——先让分身照 _标注/ 核对并生成配对清单"}, ensure_ascii=False))
        return
    try:
        items = json.load(open(pairing, encoding="utf-8"))
        assert isinstance(items, list) and items
    except Exception as e:
        print(json.dumps({"ok": False, "needPairing": True,
                          "说明": "_配对.json 解析失败（%s）——请让分身重新生成" % e}, ensure_ascii=False))
        return
    dest = os.path.join(out, "产品图片")
    os.makedirs(dest, exist_ok=True)
    # 兼容旧目录名
    cand_dir = os.path.join(out, "_候选图")
    if not os.path.isdir(cand_dir):
        cand_dir = os.path.join(out, "产品图候选")
    import shutil
    okn, miss = 0, []
    for it in items:
        try:
            seq = int(it.get("序号"))
            pg = int(it.get("页"))
        except Exception:
            miss.append(str(it.get("产品名称") or it.get("型号") or "?"))
            continue
        fn = "%03d_%s_%s_P%02d.jpg" % (seq, _slug(it.get("型号")), _slug(it.get("产品名称")), pg)
        dst = os.path.join(dest, fn)
        cand = it.get("候选")
        box = it.get("框")
        done = False
        if cand is not None:
            src = os.path.join(cand_dir, "P%02d_%d.jpg" % (pg, int(cand)))
            if os.path.exists(src):
                shutil.copyfile(src, dst)
                done = True
        if not done and box and len(box) == 4:
            page_img = os.path.join(out, "_整页", "P%02d.jpg" % pg)
            if os.path.exists(page_img):
                im = Image.open(page_img).convert("RGB")
                x0, y0, x1, y1 = [int(v) for v in box]
                x0, y0 = max(0, x0), max(0, y0)
                x1, y1 = min(im.size[0], x1), min(im.size[1], y1)
                if x1 - x0 > 20 and y1 - y0 > 20:
                    im.crop((x0, y0, x1, y1)).save(dst, quality=92)
                    done = True
        if done:
            okn += 1
        else:
            miss.append("%s(P%d 候选%s)" % (it.get("产品名称") or it.get("型号") or "?", pg, cand))
    print(json.dumps({"ok": True, "count": okn, "missing": miss, "outDir": dest,
                      "说明": "已按配对清单产出 %d 张成品图到 产品图片/（命名 序号_型号_产品名称_P页）%s"
                              % (okn, ("；%d 条未命中：%s" % (len(miss), "、".join(miss[:5]))) if miss else "")},
                     ensure_ascii=False))


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == "--apply":
        apply_pairing(sys.argv[2])
        return
    if len(sys.argv) < 3:
        print("用法: catalog_extract.py <画册.pdf> <产出目录> | --apply <产出目录>", file=sys.stderr)
        sys.exit(1)
    pdf, out = sys.argv[1], sys.argv[2]
    d_crop = os.path.join(out, "_候选图")
    d_page = os.path.join(out, "_整页")
    d_mark = os.path.join(out, "_标注")
    for d in (d_crop, d_page, d_mark):
        os.makedirs(d, exist_ok=True)

    reader = PdfReader(pdf)
    font = None
    for fp in ("/System/Library/Fonts/Helvetica.ttc",          # macOS
               "C:/Windows/Fonts/arial.ttf",                    # Windows
               "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):  # Linux 兜底
        try:
            font = ImageFont.truetype(fp, 64)
            break
        except Exception:
            continue
    if font is None:
        font = ImageFont.load_default()

    md = ["# %s · 文本提取\n" % os.path.basename(pdf),
          "> 每页文本层原文（型号/名称/参数），配合 _标注/ 里的候选框编号核对配图。\n"]
    meta = []
    n_crop = 0
    for i, page in enumerate(reader.pages):
        pno = i + 1
        text = (page.extract_text() or "").strip()
        im = page_bitmap(page)
        boxes = []
        if im is not None:
            im.save(os.path.join(d_page, "P%02d.jpg" % pno), quality=85)
            boxes = detect_boxes(im)
            mark = im.copy()
            dr = ImageDraw.Draw(mark)
            for idx, b in enumerate(boxes):
                pad = 12
                crop = im.crop((max(0, b["x0"] - pad), max(0, b["y0"] - pad),
                                min(im.size[0], b["x1"] + pad), min(im.size[1], b["y1"] + pad)))
                crop.save(os.path.join(d_crop, "P%02d_%d.jpg" % (pno, idx)), quality=90)
                n_crop += 1
                dr.rectangle([b["x0"], b["y0"], b["x1"], b["y1"]], outline=(255, 0, 0), width=8)
                dr.rectangle([b["x0"], b["y0"] - 74, b["x0"] + 96, b["y0"]], fill=(255, 0, 0))
                dr.text((b["x0"] + 12, b["y0"] - 72), str(idx), fill=(255, 255, 255), font=font)
            mark.resize((mark.size[0] // 2, mark.size[1] // 2)).save(
                os.path.join(d_mark, "P%02d.jpg" % pno), quality=80)
        if text:
            md.append("## 第 %d 页\n\n%s\n" % (pno, text))
        meta.append(dict(page=pno, text=text, boxes=boxes))

    with open(os.path.join(out, "文本提取.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md))
    with open(os.path.join(out, "_候选.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)

    print(json.dumps({
        "ok": True, "pages": len(reader.pages), "crops": n_crop,
        "outDir": out,
        "说明": "阶段1完成：抽出 %d 张候选图（_候选图/，中间产物）+ 逐页文本 + 标注图；"
                "下一步由分身照 _标注/ 核对生成 _配对.json，再执行定稿出成品图" % n_crop
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
