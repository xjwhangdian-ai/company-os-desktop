#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
产品画册 PDF → 抽图 + 文本提取（供 sales 分身/人工整理成产品清单用）。

用法：
    python3 catalog_extract.py <画册.pdf> <产出目录>

产出（<产出目录>/ 下）：
  产品图候选/    每页检测到的产品照，单独抠出（P{页}_{序}.jpg）——这是"把红框产品图抠出来"
  _整页/         每页整页位图（P{页}.jpg），配对/复核时看整页用
  _标注/         每页标注了候选框编号的图（P{页}.jpg），人工/分身照它核对"编号↔产品"
  文本提取.md    每页的文本层（型号/名称/参数原文），逐页列出
  _候选.json     结构化：每页 {文本, 候选框[{编号,坐标,填充率}]}，供 catalog_build 按坐标裁图

说明：
  - 数字排版画册（有文本层+独立图片对象）效果最好；整页扫描件只能抽整页图、文本可能为空。
  - "一页多产品"的图文精确配对需要人工/分身照 _标注/ 核对（版式各异，无法纯机械保证），
    这正是 sales 分身「配图铁律」的用武之地：逐页 Read 核对后再定稿。
依赖：pypdf、Pillow、numpy（缺失时 App 会提示 pip3 install）。
"""
import sys, os, json, warnings
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


def main():
    if len(sys.argv) < 3:
        print("用法: catalog_extract.py <画册.pdf> <产出目录>", file=sys.stderr)
        sys.exit(1)
    pdf, out = sys.argv[1], sys.argv[2]
    d_crop = os.path.join(out, "产品图候选")
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
        "说明": "已抽出 %d 张产品图候选（产品图候选/）+ 逐页文本（文本提取.md）+ 标注图（_标注/）；"
                "一页多产品时照 _标注/ 逐页核对编号↔产品后再定稿" % n_crop
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
