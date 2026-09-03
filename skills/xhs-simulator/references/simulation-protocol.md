# 模拟协议

## 目标

输出可用于发布前压力测试的“可能评论生态”，不是统计预测。既要覆盖目标人群，也要允许路人、质疑和沉默。

## 阶段

1. 解析笔记为 `noteCard`：`title/category/selling_points/emotional_hooks/sensitive_points/target_audience_hints/tone`。
2. 为每个人设生成一条 `reaction`：`id/relevance/behavior/attitude/trigger`。
3. 仅让 `behavior=评论` 的人设生成首评；`always_active` 人设必须评论。真实分布以划走为多数，评论为少数，但常驻人设除外。
4. 按请求的 `rounds` 演化回复。冲突、附和、答疑都可以发生；一轮允许无人新增。
5. 生成简短 Markdown 风险报告。

## 反应规则

- `behavior` 只能是：`划走/点赞/收藏/评论/分享`。
- `attitude` 只能是：`种草/观望/质疑/反感/无感`。
- `relevance` 为 0 到 1。
- `trigger` 必须落在笔记中的具体点，不能写空泛结论。
- 非常驻人设参考分布：划走约 60%，点赞 20–30%，收藏 5–10%，评论 3–8%，分享 1–3%。人设与内容高度匹配时可偏离。

## 评论规则

- 评论必须逐字贴近该人设的 `style` 与 `samples`，不能把人设介绍复述出来。
- 长度重尾：约 25% 为 0–12 字、35% 为 12–25 字、30% 为 25–45 字、10% 为 45–80 字；表达欲低的人更短。
- 一条只说一个点。允许半句话、突然收尾、口语、省略号和个体口癖。
- 禁止书面化总结、排比质疑、万能开场和称呼对方昵称。
- 不允许回复自己的评论；`parent` 只能指向更早存在的楼号，否则填 `null`。
- 同一人不得换措辞重复自己的观点。
- `cid` 从 1 连续递增；首评 `round=0`，后续为 1 到请求轮数。
- `likes` 可以省略或填 0；MCP 保存时会按固定种子统一分配帕累托式点赞。

## 保存字段

调用 `save_xhs_run` 时：

- `requestId`：Widget 请求 ID，原样返回。
- `noteText`：原文。
- `settings`：包含 `personaIds/rounds/passerby/seed`。
- `noteCard`：阶段 1 的结构化卡片。
- `reactions`：覆盖所有参与人设。
- `comments`：评论数组。每条含 `cid/persona/attitude/text/parent/round`。
- `reportMarkdown`：至少包含反应总览、争议预警、FAQ/回复预案和人群洞察。

保存工具会校验人设 ID、父子关系、楼号和枚举值，并补齐人名、来源与点赞。
