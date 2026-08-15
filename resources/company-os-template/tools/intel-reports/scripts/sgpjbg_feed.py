#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
三个皮匠研报（sgpjbg.com）信息流抓取——只抓「元数据 + 下载页链接」，不下载 PDF。
供桌面工作台「行业情报」页的「行业趋势 / 政策文件」两个分类展示。

- 行业趋势：各关键词（机器人 / AI产业 / 低空经济）直接搜。
- 政策文件：各关键词 + 「政策」组合搜。
- 每份报告的链接指向 sgpjbg.com 对应报告页（点击即到下载页）。

登录态：复用 Chrome 调试 profile 的持久会话（需人工在调试 Chrome 里登录过 sgpjbg 会员）。
安全红线：本脚本绝不内置账号密码；未登录时报错退出并提示人工登录，不自动填密码。

用法：python3 sgpjbg_feed.py [--out feed.json] [--date YYYY-MM-DD]
"""
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
import chromedriver_autoinstaller

SCRIPT_DIR = Path(__file__).parent
CONFIG = SCRIPT_DIR / "reports_config.json"
CHROME_DEBUG_PORT = 9222


def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", file=sys.stderr)


def load_config():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    return (
        cfg.get("关键词", ["机器人", "AI产业", "低空经济"]),
        int(cfg.get("搜索模式d", 3)),
        int(cfg.get("每关键词最多", 15)),
        int(cfg.get("最少页数", 0)),
    )


def extract_report_id(url):
    m = re.search(r"/baogao/(\d+)\.html", url)
    return m.group(1) if m else url


def connect_chrome():
    path = chromedriver_autoinstaller.install()
    opts = Options()
    opts.add_experimental_option("debuggerAddress", f"127.0.0.1:{CHROME_DEBUG_PORT}")
    try:
        return webdriver.Chrome(service=Service(path), options=opts)
    except Exception:
        log(f"❌ 无法连接 Chrome 调试端口 {CHROME_DEBUG_PORT}，请先启动调试模式 Chrome")
        sys.exit(2)


def ensure_logged_in(driver):
    driver.get("https://www.sgpjbg.com")
    time.sleep(4)
    body = driver.find_element(By.TAG_NAME, "body").text
    if "登录 | 注册" in body:
        log("❌ 未登录 sgpjbg 会员。请在调试 Chrome 里手动登录后重跑（本脚本不代填账号密码）。")
        driver.quit()
        sys.exit(3)
    log("✅ 已登录（复用调试 profile 会话）")


def search_reports(driver, query, days, min_pages, cap):
    """搜索一个查询词，返回报告元数据列表。"""
    from urllib.parse import quote

    driver.get(f"https://www.sgpjbg.com/Search.html?q={quote(query)}&d={days}&cd=1")
    for attempt in range(6):
        time.sleep(5)
        body = driver.find_element(By.TAG_NAME, "body").text
        if "验证中" in body or "正在验证" in body:
            log(f"   ⏳ 反爬验证中（{attempt + 1}/6）…")
            continue
        break
    if "验证中" in driver.find_element(By.TAG_NAME, "body").text:
        log(f"   ⚠️ 『{query}』被反爬拦截，跳过（请在调试 Chrome 手动过验证）")
        return []
    time.sleep(2)

    rows_json = driver.execute_script(
        """
        var rows = document.querySelectorAll('.ss-table-box tr');
        var data = [];
        for (var r of rows) {
            var link = r.querySelector('a[href*="/baogao/"]');
            if (!link) continue;
            var title = link.textContent.trim();
            if (!title || title.indexOf('.pdf') === -1) continue;
            var fullText = r.textContent;
            var pm = fullText.match(/(\\d+)页/);
            var pages = pm ? parseInt(pm[1]) : 0;
            var dm = fullText.match(/(20\\d{2}-\\d{2}-\\d{2})/);
            var date = dm ? dm[1] : '';
            var isVIP = title.indexOf('三个皮匠报告') >= 0;
            data.push({title: title, url: link.href, pages: pages, date: date, isVIP: isVIP});
        }
        return JSON.stringify(data);
        """
    )
    rows = json.loads(rows_json)
    out, seen = [], set()
    for r in rows:
        if min_pages and r.get("pages", 0) < min_pages:
            continue
        rid = extract_report_id(r["url"])
        if rid in seen:
            continue
        seen.add(rid)
        out.append(r)
        if len(out) >= cap:
            break
    log(f"   『{query}』→ {len(out)} 份")
    return out


def clean_title(t):
    # 去掉尾部 .pdf 与「（xx页）」冗余，保留正文
    return re.sub(r"\.pdf\s*$", "", t).strip()


def main():
    args = sys.argv[1:]
    out_path = None
    if "--out" in args:
        out_path = args[args.index("--out") + 1]
    date_str = datetime.now().strftime("%Y-%m-%d")
    if "--date" in args:
        date_str = args[args.index("--date") + 1]

    keywords, days, cap, min_pages = load_config()
    driver = connect_chrome()
    log(f"✅ Connected: {driver.title}")
    ensure_logged_in(driver)

    reports = []
    seen_global = set()

    def collect(分类, 关键词, query):
        for r in search_reports(driver, query, days, min_pages, cap):
            rid = extract_report_id(r["url"])
            gkey = f"{分类}|{rid}"
            if gkey in seen_global:
                continue
            seen_global.add(gkey)
            reports.append(
                {
                    "分类": 分类,
                    "关键词": 关键词,
                    "标题": clean_title(r["title"]),
                    "链接": r["url"],
                    "页数": r.get("pages", 0),
                    "日期": r.get("date", ""),
                    "VIP": bool(r.get("isVIP")),
                }
            )

    log("🔍 行业趋势 …")
    for kw in keywords:
        collect("行业趋势", kw, kw)
    log("🔍 政策文件 …")
    for kw in keywords:
        collect("政策文件", kw, f"{kw} 政策")

    driver.quit()

    payload = {"日期": date_str, "报告": reports}
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if out_path:
        Path(out_path).write_text(text, encoding="utf-8")
        log(f"✅ 写出 {out_path}（{len(reports)} 份）")
    else:
        print(text)


if __name__ == "__main__":
    main()
