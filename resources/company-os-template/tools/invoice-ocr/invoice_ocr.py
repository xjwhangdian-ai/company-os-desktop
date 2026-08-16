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

# Windows 控制台默认 GBK,JSON 中文输出前统一为 UTF-8,避免 UnicodeEncodeError
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

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
    # 提取「名称：XXX 统一社会信用代码/纳税人识别号」中的 XXX。
    # 边界标签兼容 OCR 繁体变体(統一/社會/納税/識别/代碼)与「名称」误读(名你/名杯/名祢)；
    # 不要求名称含「公司/单位」——个体工商户(商行/服装厂/餐饮店/加工厂等)也是合法主体。
    match = re.search(
        r"(?:名[称你杯祢]|称)[：:,=]?(.+?)"
        r"(?:統?一(?:社会|社會)信用代?[码碼]|納?税(?:人|務)識?别号|信用代码|$)",
        text,
    )
    if not match:
        return ""
    name = match.group(1).strip("：:|，,。.（）() \t")
    # 去掉 OCR 把「销售方信息/购买方信息」误并入名称开头的残留
    name = re.sub(r"^(销售方信息|销售方信|购买方信息|购买方信|销售方|购买方)", "", name)
    return name if 2 <= len(name) <= 40 else ""


def _names_from_full_text(full):
    """全文本兜底：提取「名称：XXX …信用代码」配对(成品油等异版式发票购销方不在固定裁剪区)。

    名称不允许含 `*`(挡掉「项目名称*汽油*…」行)与 `：`/`,`；返回 [(名称, 信用代码), ...]，
    名称尾部可能粘连信用代码首段数字，调用方按需清洗。
    """
    pairs = re.findall(
        r"名[称你杯祢][：:,=]([^：:,*]{2,40}?)(?:統?一(?:社会|社會)信用代?[码碼]|納?税(?:人|務)識?别号)[^0-9A-Z]{0,8}([0-9A-Z]{15,20})",
        full,
    )
    out = []
    for nm, code in pairs:
        nm = re.sub(r"\d{6,}$", "", nm).strip("（）() \t")
        if 2 <= len(nm) <= 40 and not any(k in nm for k in ("项目", "规格", "型号")):
            out.append((nm, code))
    return out


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
    # 区域若抓到货物行(项目名称/规格/型号/数量/单价/*)不算名称，视为缺失
    def _is_name_like(s):
        return bool(s) and not any(x in s for x in ("*", "项目", "规格", "型号", "数量", "单价"))
    if not _is_name_like(buyer):
        buyer = ""
    if not _is_name_like(seller):
        seller = ""
    # 全文本兜底：区域未取到购销方时，用「名称:XXX 信用代码」配对补全
    # （成品油等异版式发票购销方块不在固定裁剪区）；按我方关键词自动区分购销方。
    if not buyer or not seller:
        for nm, _code in _names_from_full_text(full):
            if any(k in nm for k in OUR_KEYWORDS):
                if not buyer:
                    buyer = nm
            elif not seller:
                seller = nm
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
    # 重命名规则(2026-08-15 起):进项按「日期-销售方-金额」、销项按「日期-购买方-金额」、
    # 方向待确认按「日期-购买方-金额」(与桌面端默认一致)。clean_name 保证跨平台文件名合法。
    name_key = seller if direction == "进项" else buyer
    suggest = f"{compact}-{clean_name(name_key) or '待确认'}-{amt_name}{ext}"
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
