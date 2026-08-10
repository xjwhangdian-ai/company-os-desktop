# 产品推广视频生成（数字人口播管线，operation 分身用）

> 需求场景：视频号/抖音产品推广。默认采用“**ChatGPT 静态关键帧 → Seedance 2.5 / Kling 3.0 动态镜头 → 人工剪辑**”的创意蓝图工作流；本目录脚本仅作为已配置账号后的可选自动化能力。
> 触发方式：在运营工作台选择「数字人短视频」，先生成创意蓝图；把每镜头的 ChatGPT 静态图提示词生成并挑选关键帧，再把关键帧和 Seedance/Kling 提示词上传到相应平台。

## 零、推荐创意蓝图工作流（无需配置 API）

1. 运营分身生成一份 `创意蓝图与动态视频提示词包.md`，其中每个镜头都包含 ChatGPT 图像模型静态关键帧提示词、Seedance 2.5 图生视频提示词及 Kling 3.0 图生视频提示词；
2. 将每条“ChatGPT 静态图提示词”粘贴到 ChatGPT，生成并人工挑选该镜头的 9:16 关键帧，保存为 `01_镜头名_关键帧.png`；
3. 将关键帧及对应 Seedance 2.5 或 Kling 3.0 提示词上传，逐镜生成动态视频；
4. 将审核通过的镜头、口播和字幕放回同一输出目录剪辑。发布前标注 AI 生成内容。

运营分身不读取、保存或索取 Seedance/Kling 的平台密钥。涉及真人肖像或声音时，先取得书面授权。

## 一、技术路线（2026-07 选型）

**默认走字节火山引擎全家桶**（性价比与效果综合最优，2026-07 比价见下），可灵作备选（config 里 provider 切换）：

| 环节 | 默认（火山 volcano） | 备选（可灵 kling） |
|---|---|---|
| 数字人口播 | **即梦 OmniHuman**：照片+音频**一步生成**，口型/表情/肢体全驱动（数字人自然度业界标杆） | 图生视频+对口型 两步串联 |
| 产品动态画面 | **Seedance**（方舟 API）：lite 档 720P 5秒约 ¥1 | 图生视频 std 5秒约 ¥2.5-5 |
| 声音克隆 | 阿里云百炼 **CosyVoice 声音复刻**（两条路线共用）：录 10-20 秒样本→音色ID→任意文案合成"你的声音" | 同左 |
| 成片 | 本机 **ffmpeg**：口播主轨 + B-roll 插播 + 可选 BGM，1080×1920 竖版 | 同左 |

比价要点（以各官网价目页为准）：Seedance B-roll 单价约为可灵一半以下且生成更快（pro fast 10 秒出片）；数字人环节 OmniHuman 一步直驱效果优于"图生视频+对口型"拼接且总价相近；火山一个账号同时拿 Seedance+OmniHuman（+可选豆包声音复刻），开通链路最短。

## 二、一次性开通与配置（人工，约 20 分钟）

1. **火山引擎**（volcengine.com）：①方舟控制台开通 Seedance 模型（推荐最新 **Seedance 2.5**；开通页会显示完整模型 ID，形如 doubao-seedance-2-5-xxxxxx，原样填进 config 的 SEEDANCE_MODEL）、拿 **ARK_API_KEY**；②开通即梦「数字人快速模式」（文档 85621/1810468），访问控制拿 **VOLC_AK/SK**，按文档把 **OMNIHUMAN_REQ_KEY** 填入 config；
2. **阿里云百炼**（bailian.console.aliyun.com）：开通「声音复刻」CosyVoice → 拿 DASHSCOPE_API_KEY；
   （备选：可灵开放平台企业认证拿 KLING_AK/SK，config 里 provider 改 "kling"）
3. 把密钥写入 `tools/video-gen/config.local.json`（**本文件已 gitignore，绝不入库**）：

```json
{ "DASHSCOPE_API_KEY": "sk-xxx", "KLING_AK": "xxx", "KLING_SK": "xxx", "voice_id": "" }
```

4. **录声音样本**：安静环境、单人、无背景音乐，10-20 秒，讲一段自然的产品介绍即可（wav/mp3）；
5. **备人像照**：正面、光线好、上半身、背景干净的单人照。

## 三、生成流程（分身自动执行，也可手动逐步跑）

```bash
cd tools/video-gen
# ①（仅首次）克隆音色：样本音频先放到可公网访问的 URL
python3 video_gen.py clone-voice-url https://xxx/voice_sample.wav
# ② 文案→你的声音（口播脚本由 operation 分身按产品卖点生成）
python3 video_gen.py tts 口播文案.txt 口播.mp3
# ③ 照片→开口讲话的数字人视频（图生视频+对口型两步自动串联）
python3 video_gen.py avatar 人像.jpg 口播.mp3 口播视频.mp4
# ④ 产品图→动态 B-roll（可多条，产品图直接从 销售/产品库/图片库/ 取）
python3 video_gen.py broll 产品图.jpg "产品特写缓慢环绕展示" b1.mp4
# ⑤ 成片：口播为主轨，B-roll 第3秒起依次插播，竖版 1080×1920
python3 video_gen.py assemble 口播视频.mp4 成片.mp4 --broll b1.mp4,b2.mp4 [--bgm 音乐.mp3]
```

产出归档：`outputs/05_运营_operation/{日期_产品}_视频号/`（成片 + 口播文案 + 发布文案材料包）。

## 四、红线与注意

- **密钥只进 config.local.json**，绝不写入任何进 git 的文件；
- **人脸与声音属个人生物信息**：样本与人像只用于本公司宣传视频，素材存 `inbox/05_运营_operation/_数字人素材/`（gitignore），不外发；
- 生成视频发布前**人工审看**：口型自然度、产品参数口径（以 knowledge/products/ 为准）、平台合规（AI 生成内容按平台要求标注）；
- 单条成本估算：口播 10s + 2 条 B-roll ≈ 5-10 元〔待确认——以可灵价目页为准〕；
- API 响应结构若与脚本不符（服务商改版），错误信息会给出待确认提示，按官方文档微调 `video_gen.py` 对应函数即可。
