#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
发票 OCR 批量识别（finance 分身/App 财务工作台用；macOS Vision / Windows Tesseract）
输入：发票图片路径列表（png/jpg）或目录
输出：JSON 到 stdout —— {"records": [...], "failures": [...]}
  record: 发票号码/开票日期(YYYY-MM-DD)/购买方/销售方/金额(价税合计,红字为负)/方向(销项|进项|待确认)/建议文件名/原文件
识别不到的字段留待确认，绝不猜数。macOS 依赖 ocrmac；Windows 依赖 Tesseract（含中文语言包）+ pytesseract。
"""
import json
import os
import re
import sys

OCR_BACKEND = None
try:
    if sys.platform == "darwin":
        from ocrmac import ocrmac
        OCR_BACKEND = "ocrmac"
    else:
        import pytesseract
        from PIL import Image
        OCR_BACKEND = "tesseract"
except ImportError:
    pass

if not OCR_BACKEND:
    hint = "缺少 ocrmac：pip3 install ocrmac" if sys.platform == "darwin" else "缺少 pytesseract 或 Tesseract：先安装 Tesseract 中文语言包，再执行 python -m pip install --user pytesseract"
    print(json.dumps({"error": "MISSING_OCR", "说明": hint}, ensure_ascii=False))
    sys.exit(2)

# 我方主体关键词：销售方含之=销项(开出)，购买方含之=进项(收到)
OUR_KEYWORDS = ["瑾智", "谨智", "炬视", "宏朗"]


def clean_name(s):
    return re.sub(r'[\\/:*?"<>|]', "", s)[:40]


def parse_one(path):
    if OCR_BACKEND == "ocrmac":
        lines = ocrmac.OCR(path, language_preference=["zh-Hans"]).recognize()
    else:
        text = pytesseract.image_to_string(Image.open(path), lang="chi_sim+eng")
        # Tesseract 没有 Vision 的坐标信息；按文本顺序保留字段提取，购销方无法可靠左右区分时待确认。
        lines = [(t, None, (0, 0, 0, 0)) for t in text.splitlines() if t.strip()]
    full = " ".join(t for t, _, _ in lines)
    num = re.search(r"发票号码[：:]\s*(\d{8,})", full)
    date = re.search(r"开票日期[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日", full)
    buyer = seller = ""
    for t, _, bbox in lines:
        m = re.match(r"名称[：:]\s*(.+)", t.strip())
        if m:
            if OCR_BACKEND == "tesseract" and not buyer:
                buyer = m.group(1).strip()
            elif bbox[0] < 0.45 and not buyer:
                buyer = m.group(1).strip()
            elif bbox[0] >= 0.45 and not seller:
                seller = m.group(1).strip()
    # 价税合计（小写），兼容红字负数
    amt = ""
    m = re.search(r"小写）?\s*[¥￥]\s*(-?[0-9,]+\.\d{2})", full)
    if not m:
        m = re.search(r"[¥￥]\s*(-?[0-9,]+\.\d{2})", full)
    if m:
        amt = m.group(1).replace(",", "")
    # OCR 常见误识归一
    buyer = buyer.replace("谨智", "瑾智")
    seller = seller.replace("谨智", "瑾智")
    missing = []
    if not num:
        missing.append("发票号码")
    if not date:
        missing.append("开票日期")
    if not buyer:
        missing.append("购买方")
    if not amt:
        missing.append("金额")
    if missing:
        return None, "缺失字段：" + "、".join(missing) + "（图片可能截断/模糊，请补拍完整发票）"
    d = f"{date.group(1)}-{int(date.group(2)):02d}-{int(date.group(3)):02d}"
    compact = d.replace("-", "")
    direction = "待确认"
    if any(k in seller for k in OUR_KEYWORDS):
        direction = "销项"
    elif any(k in buyer for k in OUR_KEYWORDS):
        direction = "进项"
    ext = os.path.splitext(path)[1].lower()
    amt_name = ("红冲" + amt[1:]) if amt.startswith("-") else amt
    suggest = f"{compact}-{clean_name(buyer)}-{amt_name}{ext}"
    return {
        "原文件": os.path.basename(path),
        "原路径": path,
        "发票号码": num.group(1),
        "开票日期": d,
        "购买方": buyer,
        "销售方": seller or "〔待确认〕",
        "金额": amt,
        "方向": direction,
        "建议文件名": suggest,
    }, None


def main():
    args = sys.argv[1:]
    paths = []
    for a in args:
        if os.path.isdir(a):
            paths += [os.path.join(a, f) for f in sorted(os.listdir(a))
                      if f.lower().endswith((".png", ".jpg", ".jpeg"))]
        elif os.path.isfile(a):
            paths.append(a)
    records, failures = [], []
    for p in paths:
        try:
            rec, err = parse_one(p)
        except Exception as e:  # 单张失败不影响其余
            rec, err = None, f"OCR异常：{e}"
        if rec:
            records.append(rec)
        else:
            failures.append({"原文件": os.path.basename(p), "原路径": p, "原因": err})
    print(json.dumps({"records": records, "failures": failures}, ensure_ascii=False))


if __name__ == "__main__":
    main()
