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

from PIL import Image, ImageEnhance

try:
    import pytesseract
except ImportError:
    pytesseract = None

OCR_BACKEND = None
try:
    if sys.platform == "darwin":
        from ocrmac.ocrmac import text_from_image
        OCR_BACKEND = "ocrmac"
    # macOS 优先 ocrmac(Vision);仅当 ocrmac 不可用时才回退 tesseract,
    # 避免 pytesseract 可导入但 tesseract 二进制缺失时误选后端导致全批失败
    if OCR_BACKEND is None and pytesseract:
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


def _tesseract_text(image, psm=6):
    """Return normalized Chinese/English OCR text without altering source files."""
    if not pytesseract:
        return ""
    if image.width < 1600:
        image = image.resize((image.width * 2, image.height * 2))
    image = ImageEnhance.Contrast(image).enhance(1.4)
    return pytesseract.image_to_string(image, lang="chi_sim+eng", config=f"--psm {psm}")


def _ocr_text(image, psm=6):
    """按 OCR_BACKEND 分发:macOS 用 ocrmac(Vision),否则回退 tesseract。"""
    if OCR_BACKEND == "ocrmac":
        items = text_from_image(image, language_preference=["zh-Hans", "en-US"])
        # ocrmac 返回 [(text, confidence, bbox), ...]
        return " ".join(item[0] for item in items)
    return _tesseract_text(image, psm=6)


def _compact(text):
    return re.sub(r"[\s\u3000]+", "", text or "")


def _pick_amount(text):
    """按发票「价税合计」提取价税合计金额(小写)。

    优先级:①（小写/小号/小与）标记处、且位于「价税合计」标签之后的金额;
    ②任意（小写…）标记处的金额;③「价税合计」标签后 60 字符内的金额;④全文最后一个金额(兜底)。
    原实现直接取全文最后一个金额,会把税额/单价误作价税合计,已修复。
    """
    compact = _compact(text)
    marked = list(re.finditer(r"小[写号与][^0-9¥￥]{0,15}[¥￥]?\s*(-?[0-9]{1,3}(?:,[0-9]{3})*\.\d{2})", compact))
    m_label = re.search(r"价税合计", compact)
    label_end = m_label.end() if m_label else -1
    pick = ""
    for m in marked:
        if m.start() > label_end:
            pick = m.group(1)
            break
    if not pick and marked:
        pick = marked[0].group(1)
    if not pick and m_label:
        m_near = re.search(r"[¥￥]?\s*(-?[0-9]{1,3}(?:,[0-9]{3})*\.\d{2})", compact[m_label.end():m_label.end() + 60])
        if m_near:
            pick = m_near.group(1)
    if not pick:
        amounts = re.findall(r"[¥￥]?\s*(-?[0-9]{1,3}(?:,[0-9]{3})*\.\d{2})", text)
        pick = amounts[-1] if amounts else ""
    return pick.replace(",", "")


def _valid_date(match):
    if not match:
        return ""
    year, month, day = map(int, match.groups())
    if 2000 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31:
        return f"{year:04d}-{month:02d}-{day:02d}"
    return ""


def _crop_text(image, left, top, right, bottom):
    width, height = image.size
    crop = image.crop((int(width * left), int(height * top), int(width * right), int(height * bottom)))
    return _compact(_ocr_text(crop, psm=6))


def _name_from_region(text):
    # Tesseract occasionally drops the first character in “名称”; retain the
    # delimiter and stop at the following credit-code label.
    match = re.search(r"(?:名称|称)[：:,=]?(.+?)(?:信\|?统一社会信用代码|统一社会信用代码|纳税人识别号|$)", text)
    if not match:
        return ""
    name = match.group(1).strip("：:|，,。.")
    return name if "公司" in name or "单位" in name else ""


def parse_one(path):
    image = Image.open(path).convert("RGB")
    full = _compact(_ocr_text(image, psm=6))
    # 票号为 20 位数字时优先取该候选，避免把 18 位统一社会信用代码误作票号。
    numbers = re.findall(r"(?<!\d)(\d{16,24})(?!\d)", full)
    num_value = next((value for value in numbers if len(value) == 20), "")
    if not num_value:
        num_value = next((value for value in numbers if len(value) >= 16), "")
    date_text = _crop_text(image, 0.60, 0.12, 0.99, 0.26)
    date_match = re.search(r"开票(?:日期|日[期B])?[：:]?(20\d{2})[^0-9]{0,5}(\d{1,2})[^0-9]{0,5}(\d{1,2})", date_text)
    d = _valid_date(date_match)
    buyer = _name_from_region(_crop_text(image, 0.08, 0.27, 0.50, 0.40))
    seller = _name_from_region(_crop_text(image, 0.50, 0.27, 0.99, 0.40))
    amt = _pick_amount(full)
    missing = []
    if not num_value:
        missing.append("发票号码")
    if not d:
        missing.append("开票日期")
    if not buyer:
        missing.append("购买方")
    if not amt:
        missing.append("金额")
    # A partial OCR result is still useful for accounting review.  Keep every
    # readable invoice in the result set and explicitly flag only the fields
    # that need a human check instead of discarding extracted ticket numbers
    # and amounts wholesale.
    compact = d.replace("-", "") if d else "00000000"
    direction = "待确认"
    if any(k in seller for k in OUR_KEYWORDS):
        direction = "销项"
    elif any(k in buyer for k in OUR_KEYWORDS):
        direction = "进项"
    ext = os.path.splitext(path)[1].lower()
    amt_name = ("红冲" + amt[1:]) if amt.startswith("-") else (amt or "待确认")
    suggest = f"{compact}-{clean_name(buyer) or '待确认'}-{amt_name}{ext}"
    return {
        "原文件": os.path.basename(path),
        "原路径": path,
        "发票号码": num_value or "〔待确认〕",
        "开票日期": d or "〔待确认〕",
        "购买方": buyer or "〔待确认〕",
        "销售方": seller or "〔待确认〕",
        "金额": amt or "〔待确认〕",
        "方向": direction,
        "建议文件名": suggest,
        "待确认字段": "、".join(missing) if missing else "",
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
