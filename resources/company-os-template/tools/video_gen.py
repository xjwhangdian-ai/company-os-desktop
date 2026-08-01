#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
产品推广视频生成管线（视频号/抖音口播数字人）
================================================
输入：人像照片 + 声音样本（一次性克隆音色）+ 产品图 + 口播文案
输出：口型同步的数字人推广视频（人像口播 + 产品动态画面 + 拼接成片）

服务选型（2026-07 核实）：
  声音克隆+TTS：阿里云百炼 CosyVoice 声音复刻（录 10-20 秒样本→音色ID→任意文案合成）
  照片→动态人像：可灵开放平台 图生视频（image2video）
  对口型：可灵 对口型（lip-sync：人物视频+音频→口型帧级同步）
  成片拼接：本机 ffmpeg（口播主轨 + 产品B-roll + 可选字幕/BGM）

密钥配置（config.local.json，不进 git）——两套平台按需配一套即可：
  { "provider": "volcano",                  ← volcano(默认，字节火山) 或 kling(可灵)
    "ARK_API_KEY": "...",                   ← 火山方舟 API Key（Seedance 产品B-roll）
    "VOLC_AK": "...", "VOLC_SK": "...",     ← 火山引擎 IAM 密钥（即梦 OmniHuman 数字人）
    "OMNIHUMAN_REQ_KEY": "",                ← 按火山文档「数字人快速模式」填 req_key
    "SEEDANCE_MODEL": "doubao-seedance-1-0-lite-i2v-250428",
    "KLING_AK": "...", "KLING_SK": "...",   ← （可选备选）可灵开放平台
    "DASHSCOPE_API_KEY": "sk-...",          ← 百炼（CosyVoice 声音克隆）
    "voice_id": "" }                         ← clone-voice 成功后自动写入

用法：
  python3 video_gen.py clone-voice 声音样本.wav          # 一次性：克隆音色
  python3 video_gen.py tts 文案.txt 口播.mp3             # 文案→你的声音
  python3 video_gen.py avatar 人像.jpg 口播.mp3 口播视频.mp4   # 照片→开口说话
  python3 video_gen.py broll 产品图.jpg "产品缓慢旋转展示" b1.mp4  # 产品图→动态
  python3 video_gen.py assemble 口播视频.mp4 成片.mp4 --broll b1.mp4,b2.mp4 [--bgm x.mp3]
"""
import base64
import json
import os
import subprocess
import sys
import time

try:
    import requests
except ImportError:
    print("缺少 requests：pip3 install requests", file=sys.stderr)
    sys.exit(2)

HERE = os.path.dirname(os.path.abspath(__file__))
CFG_PATH = os.path.join(HERE, "config.local.json")
KLING_BASE = "https://api-beijing.klingai.com"
DASHSCOPE_BASE = "https://dashscope.aliyuncs.com/api/v1"


def load_cfg():
    if not os.path.exists(CFG_PATH):
        # 无密钥 → 免费体验模式：本机TTS+ffmpeg动效，零成本跑通全流程（效果为演示级，非真口型）
        print("ℹ️ 未找到 config.local.json，进入【免费体验模式】（本地生成，零API成本）", file=sys.stderr)
        return {"provider": "free"}
    return json.load(open(CFG_PATH, encoding="utf-8"))


def save_cfg(cfg):
    json.dump(cfg, open(CFG_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)


# ── 可灵：JWT 鉴权（HS256，iss=AK，SK 签名，官方指定方式）────────────────
def kling_token(cfg):
    import hashlib, hmac
    if not cfg.get("KLING_AK") or not cfg.get("KLING_SK"):
        print("config.local.json 缺 KLING_AK/KLING_SK（可灵开放平台→访问密钥）", file=sys.stderr)
        sys.exit(2)
    def b64(d):
        return base64.urlsafe_b64encode(json.dumps(d, separators=(",", ":")).encode()).rstrip(b"=")
    now = int(time.time())
    header = b64({"alg": "HS256", "typ": "JWT"})
    payload = b64({"iss": cfg["KLING_AK"], "exp": now + 1800, "nbf": now - 5})
    signing = header + b"." + payload
    sig = base64.urlsafe_b64encode(
        hmac.new(cfg["KLING_SK"].encode(), signing, hashlib.sha256).digest()).rstrip(b"=")
    return (signing + b"." + sig).decode()


def kling_submit_and_wait(cfg, path, body, timeout_s=900):
    """可灵异步任务通用模式：POST 提交 → 轮询查询 → 返回视频 URL"""
    headers = {"Authorization": f"Bearer {kling_token(cfg)}", "Content-Type": "application/json"}
    r = requests.post(f"{KLING_BASE}{path}", headers=headers, json=body, timeout=60)
    j = r.json()
    if j.get("code") != 0:
        print(f"可灵任务提交失败：{j.get('code')} {j.get('message')}", file=sys.stderr)
        sys.exit(1)
    task_id = j["data"]["task_id"]
    print(f"  可灵任务已提交 task_id={task_id}，生成中（通常 2-5 分钟）…")
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        time.sleep(15)
        headers["Authorization"] = f"Bearer {kling_token(cfg)}"
        q = requests.get(f"{KLING_BASE}{path}/{task_id}", headers=headers, timeout=60).json()
        st = q.get("data", {}).get("task_status")
        if st == "succeed":
            videos = q["data"]["task_result"]["videos"]
            return videos[0]["url"]
        if st == "failed":
            print(f"可灵任务失败：{q['data'].get('task_status_msg')}", file=sys.stderr)
            sys.exit(1)
        print(f"  …{st}（{int(time.time()-t0)}s）")
    print("可灵任务超时", file=sys.stderr)
    sys.exit(1)


def download(url, out):
    with requests.get(url, stream=True, timeout=300) as r:
        r.raise_for_status()
        with open(out, "wb") as f:
            for chunk in r.iter_content(1 << 16):
                f.write(chunk)
    print(f"✅ 已保存 {out}")


# ── 火山方舟 Seedance：图生视频（产品B-roll）──────────────────────────────
ARK_BASE = "https://ark.cn-beijing.volces.com/api/v3"


def seedance_broll(cfg, image, prompt, out_mp4):
    if not cfg.get("ARK_API_KEY"):
        print("config.local.json 缺 ARK_API_KEY（火山方舟控制台→API Key）", file=sys.stderr)
        sys.exit(2)
    headers = {"Authorization": f"Bearer {cfg['ARK_API_KEY']}", "Content-Type": "application/json"}
    model = cfg.get("SEEDANCE_MODEL") or "doubao-seedance-1-0-lite-i2v-250428"
    body = {
        "model": model,
        "content": [
            {"type": "text", "text": (prompt or "产品特写，缓慢环绕展示，专业打光，商业广告质感") + " --ratio 9:16 --dur 5"},
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + _b64file(image)}},
        ],
    }
    r = requests.post(f"{ARK_BASE}/contents/generations/tasks", headers=headers, json=body, timeout=60)
    j = r.json()
    task_id = j.get("id")
    if not task_id:
        print(f"Seedance 提交失败：{j}\n〔待确认——模型ID以方舟控制台开通列表为准，可在 config 的 SEEDANCE_MODEL 改〕", file=sys.stderr)
        sys.exit(1)
    print(f"  Seedance 任务已提交 {task_id}，生成中…")
    t0 = time.time()
    while time.time() - t0 < 600:
        time.sleep(10)
        q = requests.get(f"{ARK_BASE}/contents/generations/tasks/{task_id}", headers=headers, timeout=60).json()
        st = q.get("status")
        if st == "succeeded":
            download(q["content"]["video_url"], out_mp4)
            return
        if st in ("failed", "cancelled"):
            print(f"Seedance 任务失败：{q}", file=sys.stderr)
            sys.exit(1)
        print(f"  …{st}（{int(time.time()-t0)}s）")
    print("Seedance 任务超时", file=sys.stderr)
    sys.exit(1)


# ── 火山 即梦 OmniHuman：照片+音频→数字人视频（一步到位）──────────────────
def _volc_sign(ak, sk, method, host, path, query, body_bytes, region="cn-north-1", service="cv"):
    """火山引擎 OpenAPI HMAC-SHA256 签名（SigV4 同构）"""
    import hashlib, hmac
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    xdate = now.strftime("%Y%m%dT%H%M%SZ")
    short = xdate[:8]
    payload_hash = hashlib.sha256(body_bytes).hexdigest()
    canonical_headers = f"content-type:application/json\nhost:{host}\nx-content-sha256:{payload_hash}\nx-date:{xdate}\n"
    signed_headers = "content-type;host;x-content-sha256;x-date"
    canonical = "\n".join([method, path, query, canonical_headers, signed_headers, payload_hash])
    scope = f"{short}/{region}/{service}/request"
    to_sign = "\n".join(["HMAC-SHA256", xdate, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    def h(key, msg):
        return hmac.new(key, msg.encode(), hashlib.sha256).digest()
    k = h(h(h(h(sk.encode(), short), region), service), "request")
    sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    auth = f"HMAC-SHA256 Credential={ak}/{scope}, SignedHeaders={signed_headers}, Signature={sig}"
    return {"Authorization": auth, "Content-Type": "application/json",
            "X-Date": xdate, "X-Content-Sha256": payload_hash, "Host": host}


def _cv_call(cfg, action, body):
    host = "visual.volcengineapi.com"
    query = f"Action={action}&Version=2022-08-31"
    data = json.dumps(body).encode()
    headers = _volc_sign(cfg["VOLC_AK"], cfg["VOLC_SK"], "POST", host, "/", query, data)
    r = requests.post(f"https://{host}/?{query}", headers=headers, data=data, timeout=60)
    return r.json()


def omnihuman_avatar(cfg, photo, audio, out_mp4):
    if not cfg.get("VOLC_AK") or not cfg.get("VOLC_SK"):
        print("config.local.json 缺 VOLC_AK/VOLC_SK（火山引擎控制台→访问控制→密钥管理）", file=sys.stderr)
        sys.exit(2)
    req_key = cfg.get("OMNIHUMAN_REQ_KEY")
    if not req_key:
        print("config.local.json 缺 OMNIHUMAN_REQ_KEY——开通即梦「数字人快速模式」后，"
              "按文档 volcengine.com/docs/85621/1810471 把 req_key 填进来", file=sys.stderr)
        sys.exit(2)
    body = {
        "req_key": req_key,
        "image_base64": _b64file(photo),
        "audio_base64": _b64file(audio),
    }
    j = _cv_call(cfg, "CVSync2AsyncSubmitTask", body)
    task_id = j.get("data", {}).get("task_id")
    if not task_id:
        print(f"OmniHuman 提交失败：{j}\n〔待确认——入参字段名以火山「数字人快速模式-调用步骤」文档为准，"
              "常见为 image_url/audio_url（需公网URL）或 binary_data_base64 数组，按文档微调本函数〕", file=sys.stderr)
        sys.exit(1)
    print(f"  OmniHuman 任务已提交 {task_id}，生成中（1-5 分钟）…")
    t0 = time.time()
    while time.time() - t0 < 900:
        time.sleep(15)
        q = _cv_call(cfg, "CVSync2AsyncGetResult", {"req_key": req_key, "task_id": task_id})
        st = q.get("data", {}).get("status")
        if st in ("done", "success", "succeed"):
            url = q["data"].get("video_url") or (q["data"].get("resp_data") or {}).get("video_url")
            if url:
                download(url, out_mp4)
                return
            print(f"任务完成但未取到视频URL：{q}", file=sys.stderr)
            sys.exit(1)
        if st in ("failed", "error"):
            print(f"OmniHuman 任务失败：{q}", file=sys.stderr)
            sys.exit(1)
        print(f"  …{st}（{int(time.time()-t0)}s）")
    print("OmniHuman 任务超时", file=sys.stderr)
    sys.exit(1)


# ── 百炼 CosyVoice：声音复刻 + 合成 ──────────────────────────────────────
def ds_headers(cfg):
    if not cfg.get("DASHSCOPE_API_KEY"):
        print("config.local.json 缺 DASHSCOPE_API_KEY（百炼控制台→API-KEY）", file=sys.stderr)
        sys.exit(2)
    return {"Authorization": f"Bearer {cfg['DASHSCOPE_API_KEY']}", "Content-Type": "application/json"}


def cmd_clone_voice(sample_path):
    """声音复刻：上传 10-20 秒清晰人声样本，得到专属音色ID（一次即可，永久复用）。
    样本要求：安静环境、单人、无BGM，wav/mp3 均可。音频需先可公网访问——用百炼临时上传接口。"""
    cfg = load_cfg()
    # 百炼声音复刻要求公网可访问的音频 URL；这里用 dashscope 文件上传接口拿临时 URL
    up = requests.post(
        f"{DASHSCOPE_BASE}/uploads",
        headers=ds_headers(cfg),
        json={"model": "cosyvoice-v2", "file_name": os.path.basename(sample_path)},
        timeout=60,
    )
    if up.status_code != 200:
        print("提示：如上传接口不可用，把样本音频放到任意可公网访问的 URL，然后执行：\n"
              "  python3 video_gen.py clone-voice-url <音频URL>", file=sys.stderr)
        sys.exit(1)
    print("上传接口响应：", up.json())
    print("〔待确认——百炼文件直传的具体流程以控制台文档为准；最稳妥路径是先把样本传 OSS/图床得到 URL，再用 clone-voice-url〕")


def cmd_clone_voice_url(audio_url):
    cfg = load_cfg()
    body = {
        "model": "voice-enrollment",
        "input": {"action": "create_voice", "target_model": "cosyvoice-v2",
                  "prefix": "jushi", "url": audio_url},
    }
    r = requests.post(f"{DASHSCOPE_BASE}/services/audio/tts/customization",
                      headers=ds_headers(cfg), json=body, timeout=120)
    j = r.json()
    vid = j.get("output", {}).get("voice_id")
    if not vid:
        print(f"复刻失败：{j}", file=sys.stderr)
        sys.exit(1)
    cfg["voice_id"] = vid
    save_cfg(cfg)
    print(f"✅ 音色克隆成功 voice_id={vid}（已写入 config，后续 tts 自动使用）")


def cmd_tts(text_path, out_mp3):
    cfg = load_cfg()
    if cfg.get("provider") == "free":
        free_tts(text_path, out_mp3)
        return
    if not cfg.get("voice_id"):
        print("还没有克隆音色——先执行 clone-voice-url <声音样本URL>", file=sys.stderr)
        sys.exit(2)
    text = open(text_path, encoding="utf-8").read().strip()
    body = {
        "model": "cosyvoice-v2",
        "input": {"text": text, "voice": cfg["voice_id"]},
    }
    r = requests.post(f"{DASHSCOPE_BASE}/services/aigc/multimodal-generation/generation",
                      headers=ds_headers(cfg), json=body, timeout=300)
    # CosyVoice 非实时 HTTP 返回音频 URL 或 base64，两种都处理
    j = r.json()
    url = j.get("output", {}).get("audio", {}).get("url") or j.get("output", {}).get("audio_url")
    if url:
        download(url, out_mp3)
        return
    b64a = j.get("output", {}).get("audio", {}).get("data")
    if b64a:
        open(out_mp3, "wb").write(base64.b64decode(b64a))
        print(f"✅ 已保存 {out_mp3}")
        return
    print(f"合成失败：{j}\n〔待确认——CosyVoice HTTP 响应结构以官方 API 参考为准，必要时改用官方 Python SDK dashscope〕",
          file=sys.stderr)
    sys.exit(1)


# ── 可灵：照片→动态人像→对口型 / 产品图→B-roll ──────────────────────────
def _b64file(p):
    return base64.b64encode(open(p, "rb").read()).decode()


def cmd_avatar(photo, audio, out_mp4):
    cfg = load_cfg()
    if cfg.get("provider") == "free":
        free_avatar(photo, audio, out_mp4)
        return
    if cfg.get("provider", "volcano") == "volcano":
        # 火山 OmniHuman：照片+音频一步生成（口型/表情/肢体全驱动，数字人自然度业界标杆）
        omnihuman_avatar(cfg, photo, audio, out_mp4)
        return
    # 可灵路线：图生视频 + 对口型 两步串联
    # 第一步：图生视频——让照片"活"起来（轻微自然动作，正对镜头）
    print("① 图生视频：照片→动态人像…")
    url1 = kling_submit_and_wait(cfg, "/v1/videos/image2video", {
        "model_name": "kling-v1-6",
        "image": _b64file(photo),
        "prompt": "人物正对镜头自然讲话状态，轻微头部动作与眨眼，上半身稳定，摄像机固定",
        "negative_prompt": "夸张动作，镜头移动，变形",
        "mode": "std", "duration": "10",
    })
    tmp1 = out_mp4 + ".stage1.mp4"
    download(url1, tmp1)
    # 第二步：对口型——把口播音频对到人物视频上
    print("② 对口型：人像视频 + 口播音频…")
    url2 = kling_submit_and_wait(cfg, "/v1/videos/lip-sync", {
        "input": {
            "mode": "audio2video",
            "video_url": url1,
            "audio_type": "file",
            "audio_file": _b64file(audio),
        }
    })
    download(url2, out_mp4)
    try:
        os.remove(tmp1)
    except OSError:
        pass


def cmd_broll(image, prompt, out_mp4):
    cfg = load_cfg()
    if cfg.get("provider") == "free":
        free_broll(image, out_mp4)
        return
    if cfg.get("provider", "volcano") == "volcano":
        seedance_broll(cfg, image, prompt, out_mp4)
        return
    url = kling_submit_and_wait(cfg, "/v1/videos/image2video", {
        "model_name": "kling-v1-6",
        "image": _b64file(image),
        "prompt": prompt or "产品特写，缓慢环绕展示，专业打光，商业广告质感",
        "mode": "std", "duration": "5",
    })
    download(url, out_mp4)


# ── 免费体验模式（零API成本，全本地）────────────────────────────────────
# tts: macOS 自带中文语音（say -v Tingting）；avatar/broll: ffmpeg Ken Burns 动效。
# 用途：不充值先跑通"文案→配音→人像→产品画面→成片"全流程，验证脚本与节奏；
# 正式出片再配密钥切换真数字人（OmniHuman 口型驱动 + Seedance 画面）。

def free_tts(text_path, out_mp3):
    import tempfile
    voice = "Tingting"
    chk = subprocess.run(["say", "-v", "?"], capture_output=True, text=True)
    if voice not in chk.stdout:
        voice = ""  # 没装婷婷就用系统默认
    tmp = tempfile.mktemp(suffix=".aiff")
    cmd = ["say", "-o", tmp, "-f", text_path] + (["-v", voice] if voice else [])
    subprocess.run(cmd, check=True)
    subprocess.run([ffmpeg_bin(), "-y", "-i", tmp, "-b:a", "160k", out_mp3],
                   check=True, capture_output=True)
    os.remove(tmp)
    print(f"✅ 已保存 {out_mp3}（体验模式：系统TTS音色；正式版将用你克隆的声音）")


def _audio_dur(path):
    r = subprocess.run([ffmpeg_bin().replace("ffmpeg", "ffprobe"), "-v", "error",
                        "-show_entries", "format=duration", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 15.0


def free_avatar(photo, audio, out_mp4):
    dur = _audio_dur(audio)
    vf = ("scale=1300:2311:force_original_aspect_ratio=increase,crop=1300:2311,"
          "zoompan=z='min(1+0.0004*on,1.12)':x='iw/2-(iw/zoom/2)':y='ih/5-(ih/zoom/5)'"
          ":d=1:s=1080x1920:fps=25")
    subprocess.run([ffmpeg_bin(), "-y", "-loop", "1", "-i", photo, "-i", audio,
                    "-t", str(dur), "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-shortest", out_mp4], check=True, capture_output=True)
    print(f"✅ 已保存 {out_mp4}（体验模式：照片动效+配音，无口型；正式版 OmniHuman 口型全驱动）")


def free_broll(image, out_mp4):
    vf = ("scale=1300:2311:force_original_aspect_ratio=increase,crop=1300:2311,"
          "zoompan=z='min(1+0.0008*on,1.2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
          ":d=1:s=1080x1920:fps=25")
    subprocess.run([ffmpeg_bin(), "-y", "-loop", "1", "-i", image, "-t", "5",
                    "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", out_mp4],
                   check=True, capture_output=True)
    print(f"✅ 已保存 {out_mp4}（体验模式：产品图动效；正式版 Seedance 动态生成）")


# ── ffmpeg 成片拼接 ──────────────────────────────────────────────────────
def ffmpeg_bin():
    for c in ("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"):
        if c == "ffmpeg" or os.path.exists(c):
            return c
    return "ffmpeg"


def cmd_assemble(main_mp4, out_mp4, broll_csv=None, bgm=None):
    """成片：口播视频为主轨；B-roll 依次插入到口播的中段（保留口播音频不断）。
    简单可靠的排布：开头口播 3s → B-roll 轮播（每段5s，画中画铺满）→ 回到口播收尾。"""
    ff = ffmpeg_bin()
    brolls = [b for b in (broll_csv.split(",") if broll_csv else []) if b.strip()]
    if not brolls:
        # 无 B-roll：只做规格统一（1080x1920 竖版，方便视频号/抖音）
        subprocess.run([ff, "-y", "-i", main_mp4,
                        "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,"
                               "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black",
                        "-c:a", "aac", out_mp4], check=True)
        print(f"✅ 成片 {out_mp4}")
        return
    # 有 B-roll：主轨音频全程保留，B-roll 从第3秒起每段5秒覆盖画面
    inputs = ["-i", main_mp4]
    for b in brolls:
        inputs += ["-i", b]
    overlays = []
    last = "[base]"
    fc = ["[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,"
          "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black[base]"]
    for i, _ in enumerate(brolls, start=1):
        start = 3 + (i - 1) * 5
        fc.append(f"[{i}:v]scale=1080:1920:force_original_aspect_ratio=increase,"
                  f"crop=1080:1920,setpts=PTS-STARTPTS+{start}/TB[b{i}]")
        nxt = f"[v{i}]"
        fc.append(f"{last}[b{i}]overlay=enable='between(t,{start},{start+5})'{nxt}")
        last = nxt
    cmd = [ff, "-y", *inputs, "-filter_complex", ";".join(fc),
           "-map", last, "-map", "0:a", "-c:a", "aac", "-shortest", out_mp4]
    if bgm:
        # BGM 低音量混入
        cmd = [ff, "-y", *inputs, "-i", bgm, "-filter_complex",
               ";".join(fc) + f";[{len(brolls)+1}:a]volume=0.15[bg];[0:a][bg]amix=inputs=2:duration=first[aout]",
               "-map", last, "-map", "[aout]", "-c:a", "aac", "-shortest", out_mp4]
    subprocess.run(cmd, check=True)
    print(f"✅ 成片 {out_mp4}")


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(0)
    cmd = args[0]
    if cmd == "clone-voice" and len(args) >= 2:
        cmd_clone_voice(args[1])
    elif cmd == "clone-voice-url" and len(args) >= 2:
        cmd_clone_voice_url(args[1])
    elif cmd == "tts" and len(args) >= 3:
        cmd_tts(args[1], args[2])
    elif cmd == "avatar" and len(args) >= 4:
        cmd_avatar(args[1], args[2], args[3])
    elif cmd == "broll" and len(args) >= 4:
        cmd_broll(args[1], args[2], args[3])
    elif cmd == "assemble" and len(args) >= 3:
        broll = None
        bgm = None
        rest = args[3:]
        for i, a in enumerate(rest):
            if a == "--broll" and i + 1 < len(rest):
                broll = rest[i + 1]
            if a == "--bgm" and i + 1 < len(rest):
                bgm = rest[i + 1]
        cmd_assemble(args[1], args[2], broll, bgm)
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
