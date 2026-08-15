# 研报情报（行业趋势 + 政策文件 · sgpjbg.com）

从三个皮匠（sgpjbg.com）抓取研报**元数据 + 下载页链接**（不下整份 PDF），供工作台「行业情报」页的
「行业趋势」「政策文件」两个分类展示。点标题跳到 sgpjbg 报告下载页（需会员登录）。

## 每日流水线

```
07:20  launchd(com.juzhi.intel-reports-daily) → run_reports.sh
       ├─ 确保 Chrome 调试端口 9222（不在就拉起独立 profile）
       ├─ sgpjbg_feed.py：行业趋势=机器人/AI产业/低空经济 各自搜
       │                  政策文件=上述关键词 + 「政策」组合搜
       └─ 写 outputs/09_情报_intel/研报追踪/{日期}_研报信息流.json
工作台「行业情报」页 → 行业趋势 / 政策文件 两个 tab 读最新一天信息流，按关键词分组
```

## 关键文件

| 文件 | 说明 |
|------|------|
| `run_reports.sh` | 入口，`bash run_reports.sh [YYYY-MM-DD]` 可手动抓 |
| `scripts/sgpjbg_feed.py` | 列表抓取（只取元数据，不下 PDF） |
| `scripts/reports_config.json` | 关键词 + 搜索模式配置 |
| `~/Library/LaunchAgents/com.juzhi.intel-reports-daily.plist` | 每天 07:20 定时器 |

## 登录与安全

- **凭已登录的 Chrome 调试 profile 会话**（`~/.openclaw/chrome-debug-profile`）。需先在调试 Chrome 里
  手动登录一次 sgpjbg 会员，会话持久保存。
- **绝不在脚本/配置里写账号密码**（红线）。未登录时脚本报错退出并提示人工登录，不代填。
- 若某关键词被反爬拦截（页面显示"验证中"），该词跳过，其余继续；需人工在调试 Chrome 过一次验证。

## 搜索模式说明（重要，勿改 d 值）

`reports_config.json` 的 `搜索模式d` 固定为 **3**：sgpjbg 的 `Search.html?q=词&d=3` 走关键词相关度表格
（`.ss-table-box`），返回按相关度排的匹配报告，带页数/日期。`d>3` 会退化成**不按关键词过滤**的最新报告
列表（拿到的全是无关报告），所以只能用 d=3。

## 故障排查

- 页面为空 / 0 份：多为调试 Chrome 未登录 sgpjbg，或被反爬验证。手动跑 `bash run_reports.sh` 看
  `scripts/logs/run_reports_*.log`。
- Chrome 调试起不来：`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9222 --user-data-dir=~/.openclaw/chrome-debug-profile &`
