# 格子天下 · PolitGrid

一颗被分成格子的星球：有大陆、有岛屿。你从**一个随机格子**起步，是部族首领——
靠**文字颁布国策**招揽散落大陆的人口，聚众建国、加冕为王、改制共和/主席国，
人口足了才能征兵，兵强马壮方可开疆拓土，直至一统天下。

**每一项政策的效果都由千问 3.7（qwen3.7-flash）扮演的「天命史官」现场裁决**：
得民心，四方流民闻风来投；失民心，人口流失、国将不国。

## 启动

```bash
npm start        # http://localhost:8787（本地/自托管入口）
```

需要 Node ≥ 18。API 配置在 `.env`（勿提交/泄露）：

```
QWEN_API_KEY=...          # DashScope 兼容模式 Key
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3.7-flash
```

## 部署

- **GitHub**：`git push` 到 `BotTony329/Boardgame1`。
- **Vercel**：已部署 https://boardgame1-virid.vercel.app
  - 架构：静态文件（`public/`）+ Serverless Function（`api/ai/policy.js`），
    Function 与本地服务器共用同一份裁决逻辑（`server/handler.js`）。
  - 密钥：Vercel 项目环境变量 `QWEN_API_KEY`（production），不在仓库中。
  - CLI 流程：`vercel link --project boardgame1` → `vercel env add QWEN_API_KEY production` → `vercel --prod`。
  - 注意：当前 Vercel 项目未连接 Git 仓库，推送后需手动 `vercel --prod`；
    若要 push 自动部署，在 Vercel 控制台 Project → Settings → Git 连接 `BotTony329/Boardgame1` 即可。

开发快捷方式：`http://localhost:8787/?autostart=1&seed=ocean1` 可跳过开局弹窗直达地图；
同一种子生成同一颗星球，可分享种子复现世界。

断网 / API 故障时自动降级为本地启发式评估，游戏永远可玩（政策回执上会标注「离线·启发式裁定」）。

## 玩法

| 里程碑 | 条件 | 解锁 |
|---|---|---|
| 征兵 | 人口 ≥ 600 | 兵事面板可征募（耗粮/矿，抽人口） |
| 加冕为王 | 人口 ≥ 800 | 正式立国 |
| 改制共和 / 主席国 | 人口 ≥ 5000 且稳定 ≥ 50 | 国体红利：稳定+15、吸引+10 |
| 一统天下 | 攻占 120 格 | 胜局 |

**文明与兵制等级（决定城市/士兵图像换装）**：由 `engine/civ.js` 按人口+稳定+政体三重门槛判定——
文明 L1 荒陬营地 → L2 篝火村落(300人) → L3 邑落城邦(1200人) → L4 王城都会(3000人+称王) → L5 煌煌都邑(8000人+共和)；
兵制 L1 猎手民兵 → L2 部族武士(兵100) → L3 常备军团(800+称王) → L4 职业军队(3000+共和)。
**门槛失守会降级**，城市随治乱兴衰变装；升降均记入编年史。

**美术包**：城市/士兵/地形/UI 资产按约定路径放入 `public/art/` 即自动生效（缺失回退程序化占位），
委托规格见 [ART-BRIEF.md](ART-BRIEF.md)。

**回合循环（手动推进）**：回合内自由行动——以文字**颁布施政**（千问裁定力度后进入施政列表）、
征兵、开战、外交——然后点「进入下一回合」结算：施政兑现、生产、饥荒、流民迁移、万国事件、AI 列国。

**持续施政**：政策颁布后**持续生效**（逐回合兑现、效力 100 起每回合 −15，约 7 年耗尽自动载入典章），
可随时下诏罢行；政务至多同时施行 4 道。续行现行施政 = **守成**（稳定 +1、效力回满）；
颁布新策 = **变法**（稳定 −3，新策录入典章）。效果数值按颁布时国力折算为固定量，不随国库复利。

**散落人口**：无主之地上遍布部民聚落（地图上的小黑点）。你的「吸引力」越高，
周边聚落迁入越多；吸引力不足 15 的暴政之邦无人问津。列国也在和你争夺这些人。

**资源禀赋**：每国产量不同——平原产粮、丘陵山地产矿、荒漠海岸产能。
征兵耗矿、远征耗能（补给不足战力打八折）、断粮即饥荒。

**战争**：征伐模式下点击相邻敌格开战。军力 = 兵数 × 士气(稳定) × 地形 × 补给 ± 运气。
被打上门不必慌，被灭国就要拼死一搏了。

## 架构

```
server.js               本地/自托管入口：静态托管 + /api/ai/policy
api/ai/policy.js        Vercel Serverless Function（与本地共用 handler）
server/
  config.js             .env / 环境变量加载
  handler.js            政策裁决请求处理（本地与 Vercel 共用）
  ai-proxy.js           提示词构建 → qwen3.7-flash → JSON 提取 → 服务端数值钳制（非法 JSON 自动重试）
  static.js             静态文件 + 防路径穿越 + 请求体限长
public/
  index.html / style.css
  js/
    ui.js               地图画布（canvas）、面板、弹窗、编年史渲染
    main.js             回合编排：政策提交 → AI 裁决 → 结算 → 事件弹窗队列
    engine/             浏览器与 Node 测试共用的引擎（无 DOM 依赖）
      constants.js      地形表 + 平衡数值（改这里即可调游戏节奏）
      rng.js / mapgen.js  种子随机 + 值噪声地图：大陆、岛屿、资源、散落人口
      nation.js         国家状态、阶段守卫（部落/王国/共和）
      growth.js         回合结算：生产、饥荒、增长、流民迁移、AI 列国策略表
      war.js            征兵三重上限、战斗解算、领土易主
      policy-schema.js  政策效果契约：钳制范围 + 健壮 JSON 提取（服务端/兜底器共用）
      heuristic.js      断网兜底评估器（关键词规则表）
      ai-client.js      fetch 代理调用 + 自动降级
      game.js           开局、存档（localStorage 自动保存）、高层动作
      policies.js       持续施政：力度折算、逐回合兑现、效力衰减、上限
      statutes.js       典章制度（现存国策库、守成/变法语境）
test/                   node:test 单元测试（29 项）：npm test
```

安全设计：API Key 永不进前端；AI 返回数值一律服务端钳制（单回合人口 ±8% 封顶），
提示注入刷不了数值；请求体限长 64KB；静态服务阻断目录穿越。

## 已知边界（V1）

- AI 列国由策略表规则驱动（不逐一调用大模型，控制费用与延迟），仅复仇性参战
- 战报与建国事件的叙事为模板文案，政策裁决（核心体验）为千问实时生成
- 无存档导出；存档在浏览器 localStorage，清除浏览器数据会丢档
