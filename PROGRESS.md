# 项目进度：格子天下（PolitGrid）

> 最后更新：2026-09-04 07:20 · 会话：politgrid-v1
> 一句话现状：V1.1 已交付（用户首轮反馈三项全部修复），测试 31/31 绿，服务器运行于 http://localhost:8787 。

## ✅ 已完成
- [x] 需求判断：REQ/INF/ASM 区分，假设登记（见下）
- [x] 千问 API 验证：DashScope compatible-mode，Key 有效，模型定为 `qwen3.7-flash`（`qwen3.7` 不存在），`enable_thinking:false` 可用
- [x] 零依赖 Node 服务器：静态托管 + /api/ai/policy 代理（Key 不进前端）
- [x] 游戏引擎（浏览器/Node 共用 ESM）：rng / mapgen / constants / nation / growth / war / ai-client / game
- [x] UI：canvas 格子地图、状态面板、政策编辑器、编年史、事件弹窗、localStorage 存档
- [x] V1.0 验收：node:test 29/29、接口冒烟（含 413/400/403 错误路径）、无头 Chrome 视觉验收
- [x] V1.1 反馈修复：
  - 开局预填一条贴合国情的建议政策，可改后颁布；「换一策」按钮随时换建议（engine/suggestions.js）
  - 「现行国策」卡常显 + 「政策档案」弹窗（历道国策原文/裁决/数值可回溯）+ 编年史国策条目显示原文
  - 我的国家标识：玩家都城皇冠+金环、领土色罩更亮国界更粗、地图下方图例（你）、格点信息标「★你的国家」
  - 提交后 textarea 保留原文作为下回合底稿（game.policies 档案，向后兼容旧存档）

## 🔧 进行中（当前焦点）
- 无（V1.0 已交付）

## ⏭️ 下一步（Backlog，未承诺）
1. AI 国家之间的战争与外交（V1 仅玩家可发起战争 + 复仇反攻）
2. 战报/建国事件由 AI 生成叙事（当前为模板文案，控制成本）
3. 求和/停战机制、更多地形与奇观、技术树
4. 移动端适配、存档导出

## ✅ 验收记录
- 单元测试 29/29 通过（mapgen 确定性/大陆岛屿、迁移/饥荒/里程碑、征兵门槛/攻占/宣战、AI JSON 解析与钳制、启发式兜底）
- 接口冒烟：GET 静态 200、`..%2f.env` 穿越 403、空体 400、坏 JSON 400、超大 413、真实千问政策裁决返回结构化史官文风结果
- 视觉验收（无头 Chrome 截图）：开局弹窗、地图（大陆+海岛+四国都城+散民黑点+国界）、面板门槛锁定提示均正常
- 修复记录：naturalGrowth 参数错位、mapgen 岛屿保底、config 根目录错位、超大请求体 413 响应写不出、drawBorders 越界风险

## ⚠️ 待决问题 / 阻塞
- 无阻塞。注意：API Key 由用户在对话中明文提供，已写入 `.env`（未提交 git）；建议用户在合适时机轮换该 Key。

## 🧠 关键记忆（防上下文丢失）
- API：`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`，模型 `qwen3.7-flash`，需 `enable_thinking:false` 否则返回 reasoning_content 且慢；解析只取 `message.content`
- Key 在项目 `.env`：`QWEN_API_KEY`；启动 `npm start` → http://localhost:8787
- 引擎模块在 `public/js/engine/`，浏览器与 `test/` 共用同一套 ESM，无 DOM 依赖
- AI 输出必须服务端钳制（clamp）：populationChangePct ∈ [-8,8] 等，防提示注入刷数值
- 阶段阈值：征兵人口≥600；部落→王国 800；王国→共和/主席国 5000 且稳定≥50；胜利 120 格
- 用户偏好：中文交流；游戏为中文文案

## 📐 决策记录
- D1: 架构 = 零依赖 Node 服务器 + 浏览器引擎 ESM —— AI 调用需要代理保护 Key，引擎双端复用免打包器（2026-09-03）
- D2: AI 只裁决玩家政策（吸引力/人口/稳定/资源），AI 国家用策略表规则模拟 —— 控制费用与延迟，且玩家体验核心在"我的政策被怎么判"（2026-09-03）
- D3: API 失败时客户端启发式评估兜底，保证断网可玩（2026-09-03）

## 📋 假设登记册
- A01 [已验证] "千问3.7" → 该 Key 实际可用 `qwen3.7-flash`（置信度：确认）
- A02 单人玩家 + 3 个规则模拟的 AI 国家（影响：中，可逆：高）
- A03 每回合 1 条自由文本政策，AI 返回结构化 JSON，服务端钳制（影响：高，可逆：高）
- A04 阈值：征兵 600 / 王国 800 / 共和 5000+稳定50（影响：中，可逆：高，已做成 constants 可调）
