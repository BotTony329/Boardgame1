import { RULES, TERRAINS } from './constants.js';
import { mulberry32, pick } from './rng.js';
import { attackableCells, resolveAttack, conscript as doConscript } from './war.js';
import { coronationDue, republicDue, crownKingdom, stageLabel } from './nation.js';
import { civTierOf } from './civ.js';
import { upsertStatute } from './statutes.js';
import { rollWorldEvents, aiDiplomacy, resolveTrade, sweepHostilities } from './world.js';
import { applyActivePolicies } from './policies.js';

const clamp01to100 = (v) => Math.max(0, Math.min(100, v));

function territoryYield(game, nation) {
  let food = 0, minerals = 0, energy = 0;
  for (const idx of nation.cells) {
    const res = game.map.cells[idx].res;
    food += res.food; minerals += res.minerals; energy += res.energy;
  }
  return { food, minerals, energy };
}

// 生产与口粮：军马也要吃粮。断粮即饥荒——人口骤减、民怨沸腾。
function resolveEconomy(game, nation, logs) {
  const prod = territoryYield(game, nation);
  const consumption = nation.pop * RULES.foodPerPop + nation.soldiers * RULES.garrisonFoodPerSoldier;
  nation.food += prod.food - consumption;
  nation.minerals += prod.minerals;
  nation.energy += prod.energy;
  if (nation.food < 0) {
    nation.food = 0;
    nation.pop = Math.max(5, nation.pop * 0.92);
    nation.stability = clamp01to100(nation.stability - 10);
    if (nation.isPlayer) logs.push({ turn: game.turn, kind: 'famine', text: '饥荒蔓延！粮仓见底，饿殍载道，人口骤减，民怨沸腾。' });
  }
}

function naturalGrowth(nation) {
  // 声望越高来投越多；稳定度牵引生育与流亡；存粮短缺抑制生育
  let rate = 0.006 + nation.appeal * 0.0005 + (nation.stability - 50) * 0.0002;
  if (nation.food < nation.pop * 0.3) rate *= 0.4;
  nation.pop = Math.max(5, nation.pop * (1 + Math.max(-0.05, Math.min(0.05, rate))));
}

function chebyshev(aIdx, bIdx, w) {
  const ax = aIdx % w, ay = Math.floor(aIdx / w);
  const bx = bIdx % w, by = Math.floor(bIdx / w);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

// 核心：散落大陆的人口迁移。吸引力不足 15 的国家无人问津；
// 范围内（6 格）多个国家竞争时，流民只去最有吸引力的那个。
export function migrateScatteredPop(game, logs) {
  const { w } = game.map;
  const nations = Object.values(game.nations);
  let totalMigrants = 0;
  for (let i = 0; i < game.map.cells.length; i++) {
    const cell = game.map.cells[i];
    if (cell.t === 'ocean' || cell.owner !== null || cell.wild < 1) continue;

    let best = null, bestDist = Infinity;
    for (const nation of nations) {
      if (nation.appeal < 15 || nation.cells.length === 0) continue;
      let dist = Infinity;
      for (const idx of nation.cells) {
        const d = chebyshev(i, idx, w);
        if (d < dist) dist = d;
      }
      if (dist <= 6 && dist < bestDist) { best = nation; bestDist = dist; }
      else if (dist <= 6 && dist === bestDist && best && nation.appeal > best.appeal) { best = nation; }
    }
    if (!best) continue;

    const rate = Math.min(0.12, best.appeal / 500) / (1 + bestDist * 0.4);
    const migrants = cell.wild * rate;
    cell.wild -= migrants;
    best.pop += migrants;
    totalMigrants += migrants;
    if (best.isPlayer && migrants >= 8) {
      logs.push({ turn: game.turn, kind: 'migration', text: `四方流民闻风来投：一批约 ${Math.round(migrants)} 人迁入${best.name}。` });
    }
  }
  // 散落人口缓慢再生：聚落被吸引后仍能休养恢复，避免全图无人可吸的死局
  for (const cell of game.map.cells) {
    if (cell.owner === null && cell.wildBase > 0) {
      cell.wild = Math.min(cell.wildBase, cell.wild + cell.wildBase * 0.01);
    }
  }
  return totalMigrants;
}

// AI 国家：策略表驱动（无需调用大模型，控制成本），但同样受生产/迁移/饥荒规则约束。
const AI_APPEAL_TARGET = { militarist: 26, agrarian: 42, merchant: 47, culture: 56 };

const AI_ACTIONS = {
  agrarian(game, n) { n.food += n.pop * 0.05; },
  merchant(game, n) { n.minerals += n.pop * 0.02; n.energy += n.pop * 0.02; n.appeal = clamp01to100(n.appeal + 1); },
  culture(game, n) { n.appeal = clamp01to100(n.appeal + 1.5); n.food = Math.max(0, n.food - n.pop * 0.02); n.stability = clamp01to100(n.stability + 1); },
  militarist(game, n) {
    if (n.pop >= 600 && n.food >= 100) {
      const { recruited } = doConscript(n, Math.floor(n.pop * 0.02));
      if (recruited > 0) n.appeal = clamp01to100(n.appeal - 1);
    }
  },
};

function aiNationTurn(game, nation, rng, logs) {
  const target = AI_APPEAL_TARGET[nation.strategy] ?? 35;
  nation.appeal = clamp01to100(nation.appeal + (target - nation.appeal) * 0.12 + (rng() * 4 - 2));
  nation.stability = clamp01to100(nation.stability + (60 - nation.stability) * 0.1 + (rng() * 4 - 2));
  AI_ACTIONS[nation.strategy]?.(game, nation);

  // 殖民：人口滋长后向相邻无主之地拓殖（每回合约一半概率）
  if (nation.pop >= 400 && nation.food >= 50 && rng() < 0.5) {
    const targets = attackableCells(game, nation.id).filter((i) => game.map.cells[i].owner === null);
    if (targets.length) {
      const idx = pick(rng, targets);
      game.map.cells[idx].owner = nation.id;
      nation.cells.push(idx);
      nation.food -= 30;
    }
  }

  // 复仇：与玩家交战的国家会定期反攻边境
  if (nation.enemies.includes(game.playerId) && nation.soldiers >= 30 && game.turn % 3 === 0 && rng() < 0.7) {
    const targets = attackableCells(game, nation.id).filter((i) => game.map.cells[i].owner === game.playerId);
    if (targets.length) {
      const report = resolveAttack(game, nation, pick(rng, targets), `${game.seed}:ai:${game.turn}`);
      logs.push({
        turn: game.turn, kind: 'war', major: true,
        text: report.captured
          ? `${nation.name}大军来犯，夺走了我方一处${TERRAINS[game.map.cells[report.cellIdx].t].name}！`
          : `${nation.name}来犯被我军击退，我方伤亡 ${report.losses}。`,
      });
    }
  }

  // AI 的阶段演进（简化版）：跨过同样的人口门槛后称王/建制，声望水涨船高
  if (nation.stage === 'tribe' && nation.pop >= RULES.kingdomPop) {
    crownKingdom(nation);
    if (rng() < 0.6) logs.push({ turn: game.turn, kind: 'ai', text: `远方传来消息：${nation.name}首领加冕为王，声威大振。` });
  } else if (nation.stage === 'kingdom' && nation.pop >= RULES.republicPop) {
    nation.stage = 'republic';
    nation.republicType = 'presidential';
    nation.appeal = clamp01to100(nation.appeal + 5);
    if (rng() < 0.6) logs.push({ turn: game.turn, kind: 'ai', text: `${nation.name}建立共和政体，四方之士纷纷前往。` });
  }
}

// 文明等级结算：达标晋升、失守降级，城市与士兵图像随之换装。
// 等级变化写入编年史，让"我的政策让文明前进了还是倒退了"变得可见。
function updateCivTiers(game, logs) {
  for (const nation of Object.values(game.nations)) {
    if (nation.dead) continue;
    const tier = civTierOf(nation);
    if (nation.civTier == null) {
      nation.civTier = tier.level;
      continue;
    }
    if (tier.level > nation.civTier && nation.isPlayer) {
      logs.push({ turn: game.turn, kind: 'milestone', text: `文明演进！${nation.name}步入「${tier.name}」——${tier.desc}，城郭焕然一新。` });
    } else if (tier.level < nation.civTier && nation.isPlayer) {
      logs.push({ turn: game.turn, kind: 'famine', text: `民生凋敝：${nation.name}的文明由盛转衰，跌落至「${tier.name}」。` });
    }
    nation.civTier = tier.level;
  }
}

function checkMilestones(game, logs, events) {
  const player = game.nations[game.playerId];
  if (coronationDue(player)) {
    crownKingdom(player);
    player.appeal = clamp01to100(player.appeal + 5);
    events.push({ kind: 'coronation', title: '加冕为王', text: `四方部民归心，${player.leader}于万民面前加冕为王，「${player.name}」自此称为${stageLabel(player)}。往后可开征兵、行征伐。` });
  }
  if (republicDue(player) && !game.pendingRepublic) {
    game.pendingRepublic = true;
    events.push({ kind: 'republic', title: '政制之议', text: '国中贤良齐聚，请愿改制。是效法列邦行总统制共和，还是立主席国集众人之力？此为大政，一举而定。' });
  }
  if (player.cells.length >= RULES.victoryCells) {
    game.phase = 'victory';
  }
  if (player.pop < RULES.defeatPop) {
    game.phase = 'gameover';
  }
  // 附庸国覆灭检查
  for (const nation of Object.values(game.nations)) {
    if (!nation.isPlayer && nation.cells.length === 0) {
      nation.dead = true;
      logs.push({ turn: game.turn, kind: 'ai', text: `${nation.name}疆土尽失，族人流散，退出列国争霸。` });
    }
  }
}

// 一回合的完整结算：施政兑现 → 经济 → 增长 → 迁移 → 万国事件 → AI → 里程碑。
// 回合由玩家手动推进（UI 的「进入下一回合」），政策效果在施政期内逐回合自动兑现。
// 返回 {logs, events, migrants} 供 UI 渲染回合报告。
export function resolveTurn(game) {
  if (game.phase !== 'playing') return null;
  const logs = [];
  const events = [];

  // 持续施政：兑现效果、衰减效力、到期入典章
  applyActivePolicies(game, logs);

  for (const nation of Object.values(game.nations)) {
    if (nation.dead) continue;
    resolveEconomy(game, nation, logs);
    naturalGrowth(nation);
  }

  const migrants = migrateScatteredPop(game, logs);

  const rng = mulberry32((game.seedHash + game.turn * 104729) >>> 0);
  for (const nation of Object.values(game.nations)) {
    if (nation.dead || nation.isPlayer) continue;
    aiNationTurn(game, nation, rng, logs);
  }

  // 万国事件层：天灾丰年 → 列国外交 → 商路结算 → 战争的邦交后果
  rollWorldEvents(game, logs, rng);
  aiDiplomacy(game, logs, rng);
  resolveTrade(game, logs);
  sweepHostilities(game, logs);

  updateCivTiers(game, logs);
  checkMilestones(game, logs, events);
  game.turn += 1;
  game.log.push(...logs);
  if (game.log.length > 400) game.log = game.log.slice(-300); // 编年史上限，防止存档无限膨胀
  return { logs, events, migrants: Math.round(migrants) };
}
