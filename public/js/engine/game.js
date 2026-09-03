import { generateWorld } from './mapgen.js';
import { createNation, AI_NATION_DEFS, establishRepublic, stageLabel } from './nation.js';
import { resolveTurn } from './growth.js';
import { conscript, attackableCells, resolveAttack } from './war.js';
import { hashSeed, mulberry32, pick } from './rng.js';
import { RULES, TERRAINS } from './constants.js';
import { pickStatutes } from './statutes.js';
import { getRelation, adjustRelation, establishRoute, breakRoute, routeBetween, routeYield } from './world.js';

export const SAVE_KEY = 'politgrid_save_v1';

// 开局选址：候选地避开高山荒漠，四国彼此保持距离；距离不够就逐级放宽（地图挤时仍可开局）
function pickStartCells(world, rng, count) {
  const good = world.cells
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => ['plain', 'beach', 'forest', 'hills'].includes(c.t));
  const pool = [...good].sort(() => rng() - 0.5);
  const chosen = [];
  for (let minDist = 9; minDist >= 3 && chosen.length < count; minDist -= 2) {
    for (const { i } of pool) {
      if (chosen.some((j) => chebyshev(i, j, world.w) < minDist)) continue;
      chosen.push(i);
      if (chosen.length === count) break;
    }
  }
  return chosen;
}

function chebyshev(aIdx, bIdx, w) {
  const ax = aIdx % w, ay = Math.floor(aIdx / w);
  const bx = bIdx % w, by = Math.floor(bIdx / w);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function newGame({ nationName, leaderName, seed }) {
  const seedStr = String(seed || Math.random().toString(36).slice(2, 9));
  const seedHash = hashSeed(seedStr);
  const world = generateWorld(seedHash);
  const rng = mulberry32(seedHash ^ 0x9e3779b9);

  const [playerCell, ...aiCells] = pickStartCells(world, rng, 1 + AI_NATION_DEFS.length);

  const player = createNation({
    id: 'p1', name: nationName || '无名之邦', leader: leaderName || '无名氏',
    color: '#e8b64c', isPlayer: true, startCell: playerCell,
  });
  const aiNations = AI_NATION_DEFS.map((def, k) => createNation({
    id: `ai${k}`, name: def.name, leader: `${def.name}首领`,
    color: def.color, isPlayer: false, startCell: aiCells[k], strategy: def.strategy,
  }));

  world.cells[playerCell].owner = 'p1';
  aiCells.forEach((idx, k) => { world.cells[idx].owner = `ai${k}`; });

  // 玩家开局随机继承两道祖制：治理从一开始就是在既有制度上修修补补
  player.statutes = pickStatutes(2, rng);

  return {
    version: 1,
    seed: seedStr,
    seedHash,
    map: world,
    turn: 1,
    phase: 'playing', // playing | gameover | victory
    pendingRepublic: false,
    playerId: 'p1',
    nations: { p1: player, ai0: aiNations[0], ai1: aiNations[1], ai2: aiNations[2] },
    relations: {},      // 邦交关系表（engine/world.js），键为 "a|b"（字典序）
    tradeRoutes: [],    // 现存商路
    log: [{
      turn: 1, kind: 'milestone',
      text: `新纪元元年：${player.leader}率族人在${TERRAINS[world.cells[playerCell].t].name}上点燃第一堆篝火，「${player.name}」于此立邦。天下散落部民无数，皆可被善政所感召。`,
    }],
  };
}

export function playerNation(game) {
  return game.nations[game.playerId];
}

// —— 存档：每回合自动保存到 localStorage ——
export function saveGame(game) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(game));
    return true;
  } catch {
    return false; // 隐身模式/存储满时静默失败，游戏仍可继续玩
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const game = JSON.parse(raw);
    if (!game?.map?.cells || !game?.nations?.[game.playerId]) return null;
    // 旧版存档迁移：补建典章（若无则随机授予，避免玩家面对空制度开局）
    const player = game.nations[game.playerId];
    if (!Array.isArray(player.statutes) || player.statutes.length === 0) {
      player.statutes = pickStatutes(2);
    }
    game.relations = game.relations || {};
    game.tradeRoutes = game.tradeRoutes || [];
    return game;
  } catch {
    return null;
  }
}

export function clearSave() {
  localStorage.removeItem(SAVE_KEY);
}

// —— 高层动作：UI 只调这三个，副作用与编年史记录集中在此 ——

export function applyResolvedTurn(game, effects) {
  const turn = game.turn; // resolveTurn 内部会自增，档案要记颁布时的回合
  const report = resolveTurn(game, effects);
  game.policies = game.policies || [];
  game.policies.push({
    turn,
    domain: effects.domain || '',
    text: effects.brief || '',
    verdict: effects.verdict,
    narrative: effects.narrative,
    pop: effects.populationChangePct,
    stab: effects.stabilityChange,
    appeal: effects.appealChange,
    statute: effects.statute || null,
  });
  saveGame(game);
  return report;
}

export function doConscript(game, count) {
  const nation = playerNation(game);
  const result = conscript(nation, count);
  if (result.recruited > 0) {
    game.log.push({ turn: game.turn, kind: 'military', text: `${nation.name}征募新军 ${result.recruited} 人，常备军达 ${nation.soldiers}。` });
  }
  saveGame(game);
  return result;
}

export function doAttack(game, cellIdx) {
  const nation = playerNation(game);
  if (!attackableCells(game, nation.id).includes(cellIdx)) return null;
  const report = resolveAttack(game, nation, cellIdx);
  game.log.push({
    turn: game.turn, kind: 'war', major: true,
    text: report.captured
      ? `${nation.name}攻克一处${TERRAINS[game.map.cells[cellIdx].t].name}，我军折损 ${report.losses} 人${report.defenderName !== '散落部民' ? `，${report.defenderName}守军溃败` : ''}，接纳归化之民 ${report.absorbed}。`
      : `进攻受挫！${report.defenderName}据险死守，我军折损 ${report.losses} 人，军心震动。`,
  });
  if (nation.cells.length >= RULES.victoryCells) game.phase = 'victory';
  saveGame(game);
  return report;
}

export function chooseRepublicType(game, type) {
  const nation = playerNation(game);
  if (!game.pendingRepublic) return false;
  establishRepublic(nation, type);
  game.pendingRepublic = false;
  game.log.push({
    turn: game.turn, kind: 'milestone', major: true,
    text: `${nation.name}改制为${stageLabel(nation)}！${nation.leader}与万民共订新约，声望日隆。`,
  });
  saveGame(game);
  return true;
}

// —— 邦交动作（万国志面板）——

export const DIPLO_COSTS = { envoy: { energy: 20 }, trade: { minerals: 30 } };

export function canAfford(nation, cost) {
  return (nation.energy >= (cost.energy ?? 0)) && (nation.minerals >= (cost.minerals ?? 0));
}

// 遣使修好：耗能源，关系 +12
export function doSendEnvoy(game, targetId) {
  const nation = playerNation(game);
  if (!canAfford(nation, DIPLO_COSTS.envoy)) return { ok: false, reason: '能源不足（需 20）' };
  const target = game.nations[targetId];
  if (!target || target.dead || atWarWith(game, nation, targetId)) return { ok: false, reason: '交战之际，使节不通' };
  nation.energy -= DIPLO_COSTS.envoy.energy;
  const rel = adjustRelation(game, nation.id, targetId, 12);
  game.log.push({ turn: game.turn, kind: 'diplo', text: `${nation.name}遣使赴${target.name}修好，两邦关系趋于${rel >= 15 ? '友善' : '缓和'}。` });
  saveGame(game);
  return { ok: true, relation: rel };
}

// 缔结商约：耗矿产，关系 ≥ 15 且非交战方可缔结
export function doEstablishTrade(game, targetId) {
  const nation = playerNation(game);
  if (!canAfford(nation, DIPLO_COSTS.trade)) return { ok: false, reason: '矿产不足（需 30）' };
  const target = game.nations[targetId];
  if (!target || target.dead || atWarWith(game, nation, targetId)) return { ok: false, reason: '交战之际，商路不通' };
  if (getRelation(game, nation.id, targetId) < 15) return { ok: false, reason: '邦交尚浅，对方不肯互市（需友善以上）' };
  nation.minerals -= DIPLO_COSTS.trade.minerals;
  establishRoute(game, nation.id, targetId, game.turn);
  const y = routeYield(game, routeBetween(game, nation.id, targetId));
  game.log.push({
    turn: game.turn, kind: 'trade', major: true,
    text: `${nation.name}与${target.name}缔结商约：每回合双向互通 粮${y.food} 矿${y.minerals} 能${y.energy}。`,
  });
  saveGame(game);
  return { ok: true };
}

// 断绝往来：关系 −25，商路断绝
export function doSeverTies(game, targetId) {
  const nation = playerNation(game);
  const target = game.nations[targetId];
  if (!target || target.dead) return { ok: false, reason: '该国已不存在' };
  adjustRelation(game, nation.id, targetId, -25);
  const hadRoute = breakRoute(game, nation.id, targetId);
  game.log.push({
    turn: game.turn, kind: 'diplo', major: true,
    text: `${nation.name}与${target.name}断绝往来${hadRoute ? '，商路就此罢市' : ''}。`,
  });
  saveGame(game);
  return { ok: true };
}

function atWarWith(game, nation, targetId) {
  return nation.enemies.includes(targetId) || game.nations[targetId]?.enemies.includes(nation.id);
}

export { attackableCells };
