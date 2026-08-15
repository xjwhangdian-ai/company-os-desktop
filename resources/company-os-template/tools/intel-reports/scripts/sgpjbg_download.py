#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
三个皮匠研报（sgpjbg.com）单份报告下载——工作台「行业情报」页「下载」按钮的后端。

正确流程（2026-08-02 实测修正）：报告下载走 /bgdown/{id}.html 页面上的
FlexPaper/BookDownLoad.aspx 直链，用登录态浏览器**真实点击**即可下载
（旧版调 /baogao/ 页的 BookDownLoad ajax 接口，对普通会员档位一律返回 -2 误报超限，已弃用）。
下载会落到浏览器默认下载目录，脚本监视新文件出现后搬运改名到指定归档目录。

登录红线与 feed 脚本一致：绝不内置账号密码，未登录报错退出。

用法：python3 sgpjbg_download.py --url https://www.sgpjbg.com/baogao/1167999.html \
        --out /path/to/dir --title 报告标题
输出：stdout 一行 JSON {"ok":bool,"file":路径,"msg":说明}
"""
import glob
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
import chromedriver_autoinstaller

CHROME_DEBUG_PORT = 9222
DEFAULT_DOWNLOAD_DIR = Path.home() / "Downloads"


def out(ok, file="", msg=""):
    print(json.dumps({"ok": ok, "file": file, "msg": msg}, ensure_ascii=False))
    sys.exit(0 if ok else 1)


def newest_files(dirs, since_ts):
    found = []
    for dd in dirs:
        for f in glob.glob(str(dd) + "/*"):
            if f.endswith(".crdownload") or f.endswith(".tmp"):
                continue
            try:
                if os.path.getmtime(f) >= since_ts and os.path.getsize(f) > 10 * 1024:
                    found.append(f)
            except OSError:
                pass
    return sorted(found, key=os.path.getmtime, reverse=True)


def main():
    args = sys.argv[1:]

    def arg(name, default=""):
        return args[args.index(name) + 1] if name in args else default

    url = arg("--url")
    out_dir = arg("--out")
    title = arg("--title", "报告")
    m = re.search(r"/(?:baogao|bgdown)/(\d+)\.html", url)
    if not m or not out_dir:
        out(False, msg="参数错误：需要 --url（/baogao/{id}.html）与 --out")
    report_id = m.group(1)

    path = chromedriver_autoinstaller.install()
    opts = Options()
    opts.add_experimental_option("debuggerAddress", f"127.0.0.1:{CHROME_DEBUG_PORT}")
    try:
        driver = webdriver.Chrome(service=Service(path), options=opts)
    except Exception:
        out(False, msg="无法连接调试 Chrome（9222）——请先在工作台点一次研报「刷新」拉起并登录")

    Path(out_dir).mkdir(parents=True, exist_ok=True)
    try:
        # 下载页（服务端会话按它定位报告；普通报告 bgdown 与 baogao 同 id）
        driver.get(f"https://www.sgpjbg.com/bgdown/{report_id}.html")
        time.sleep(4)
        body = driver.execute_script("return document.body.innerText.slice(0, 3000)")
        if "登录 | 注册" in body:
            # 未登录：把专用 Chrome 弹到前台并停在 sgpjbg 首页，引导人工登录（绝不代填账号密码）
            try:
                driver.get("https://www.sgpjbg.com/")
                driver.execute_cdp_cmd("Page.bringToFront", {})
            except Exception:
                pass
            out(False, msg="请先人工登录：已在弹出的专用 Chrome 里打开 sgpjbg.com（点右上角「登录」），登录成功后回到本页再点一次「下载」即可自动下载")
        if "尚未审核通过" in body or "已经被删除" in body:
            # 没有对应下载页：多为「皮匠出品」自研 VIP 专享报告——普通会员档位不可下
            driver.get(url if "/baogao/" in url else f"https://www.sgpjbg.com/baogao/{report_id}.html")
            time.sleep(3)
            page = driver.page_source
            if "ShengJi2" in page or "VIP专享" in page:
                out(False, msg="该报告为「皮匠出品」VIP专享，当前会员档位不含此类下载——请点标题到网页确认或升级档位")
            import re as _re
            alt = _re.findall(r"/bgdown/(\d+)\.html", page)
            if alt:
                driver.get(f"https://www.sgpjbg.com/bgdown/{alt[0]}.html")
                time.sleep(4)
                body = driver.execute_script("return document.body.innerText.slice(0, 3000)")
            else:
                out(False, msg="没找到该报告的下载页——请点标题到网页手动下载")
        # 配额提示必须是精确短语（报告正文常出现"已达XX家"之类的词，宽匹配会误杀）
        if re.search(r"下载(次数|量)[^。\n]{0,12}(已达上限|已用完)|已达[^。\n]{0,8}最大[^。\n]{0,8}下载", body):
            out(False, msg="会员下载量已达上限（页面提示），请明天再试")

        # 尽力把下载目录指到归档目录（新标签页可能不吃这个设置，所以同时监视默认下载目录）
        try:
            driver.execute_cdp_cmd("Browser.setDownloadBehavior", {"behavior": "allow", "downloadPath": out_dir})
        except Exception:
            try:
                driver.execute_cdp_cmd("Page.setDownloadBehavior", {"behavior": "allow", "downloadPath": out_dir})
            except Exception:
                pass

        since = time.time() - 2
        # 真实点击链（2026-08-02 实测）：「立即下载」→ 弹层「下载PDF」→ 页面回发触发下载
        clicked = driver.execute_script(
            "var b=[...document.querySelectorAll('input')].find(x=>x.value=='立即下载');"
            "if(!b) return '没有立即下载按钮'; b.click(); return 'ok';"
        )
        if clicked != "ok":
            out(False, msg=f"下载页异常（{clicked}）——可能需要购买/积分或页面改版，请点标题到网页确认")
        time.sleep(2)
        # 第二步（尽力而为）：部分报告第一步点完即直接开下，没有格式弹层——所以这步不作为失败条件
        step2 = driver.execute_script(
            "var sp=[...document.querySelectorAll('span')].find(x=>x.offsetParent&&x.innerText.trim()=='下载PDF');"
            "if(sp){sp.click(); return 'ok';}"
            "var any=[...document.querySelectorAll(\"[onclick*='selBookType']\")].find(x=>x.offsetParent);"
            "if(any){any.click(); return 'ok';} return '无格式弹层（可能已直接开下）';"
        )
        sys.stderr.write(f"step2: {step2}\n")

        # 等新文件出现（归档目录或默认下载目录），最长 300 秒（大文件慢网留足余量）
        got = None
        for _ in range(150):
            time.sleep(2)
            # 还在下载中就继续等
            downloading = glob.glob(str(DEFAULT_DOWNLOAD_DIR / "*.crdownload")) + glob.glob(out_dir + "/*.crdownload")
            fresh = newest_files([out_dir, DEFAULT_DOWNLOAD_DIR], since)
            if fresh and not downloading:
                got = fresh[0]
                break
        if not got:
            if glob.glob(out_dir + "/*.crdownload") or glob.glob(str(DEFAULT_DOWNLOAD_DIR / "*.crdownload")):
                out(False, msg="文件较大仍在下载中——已在后台继续，几分钟后到 研报文件 目录查看即可")
            out(False, msg="点击后 300 秒未见文件落盘——请点标题到网页手动下载并反馈")
    finally:
        try:
            driver.quit()
        except Exception:
            pass

    ext = Path(got).suffix or ".pdf"
    # 全部空白（含换行）压掉；去掉标题里混进的 .pdf / 「最新」角标尾巴
    clean = re.sub(r"\s+", "", title)
    clean = re.sub(r"(\.pdf)?(最新)?$", "", clean, flags=re.I)
    safe = re.sub(r'[\\/:*?"<>|]', "", clean)[:80] or f"report_{report_id}"
    dest = Path(out_dir) / f"{safe}{ext}"
    if Path(got).resolve() != dest.resolve():
        shutil.move(got, dest)
    out(True, file=str(dest), msg=f"已下载 {dest.name}（{dest.stat().st_size // 1024}KB）")


if __name__ == "__main__":
    main()
