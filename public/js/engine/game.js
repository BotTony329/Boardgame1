import { generateWorld } from './mapgen.js';
import { createNation, AI_NATION_DEFS, establishRepublic, stageLabel } from './nation.js';
import { resolveTurn } from './growth.js';
import { conscript, attackableCells, startWar } from './war.js';
import { formArmyFor, totalStrength, resolveArmyAttack, moveArmyTo, buildFort, toggleDefend, colonizeAdjacent, armyAt } from './armies.js';
import { hashSeed, mulberry32, pick } from './rng.js';
import { RULES, TERRAINS } from './constants.js';
import { pickStatutes, upsertStatute } from './statutes.js';
import { getRelation, adjustRelation, setRelation, establishRoute, breakRoute, routeBetween, routeYield } from './world.js';
import { policyFromVerdict, MAX_ACTIVE_POLICIES } from './policies.js';

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
    activePolicies: [], // 施政中（engine/policies.js），逐回合生效直至效力耗尽或手动取消
    armies: [],         // 野战军团（engine/armies.js），在地图上行军作战
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
    game.activePolicies = game.activePolicies || [];
    game.armies = game.armies || [];
    return game;
  } catch {
    return null;
  }
}

export function clearSave() {
  localStorage.removeItem(SAVE_KEY);
}

// —— 高层动作：UI 只调这三个，副作用与编年史记录集中在此 ——

// —— 施政（持续政策）——
// 颁布：AI 裁决力度 → 折算为逐回合固定量 → 进入施政列表。
// 与现行施政同文 = 守成续行（效力回满、稳定+1）；新策 = 变法更张（稳定−3）并录入典章。
// 回合由「进入下一回合」手动推进，施政在结算时自动兑现。
export function enactPolicy(game, judged, { text, domain, continuation }) {
  const nation = playerNation(game);
  if (game.phase !== 'playing') return { ok: false, reason: '国祚已终，无可施政' };
  game.activePolicies = game.activePolicies || [];

  const existing = game.activePolicies.find((p) => p.text === text);
  let statuteEffect;
  if (existing) {
    existing.potency = 100;
    nation.stability = Math.min(100, nation.stability + 1);
    statuteEffect = 'continue';
    game.log.push({ turn: game.turn, kind: 'policy', brief: text, statute: 'continue', text: `${nation.name}重申「${String(text).slice(0, 20)}…」之政，萧规曹随，民心益安。` });
  } else {
    if (game.activePolicies.length >= MAX_ACTIVE_POLICIES) {
      return { ok: false, reason: `政务已满（至多 ${MAX_ACTIVE_POLICIES} 道施行），请先取消一道` };
    }
    const policy = policyFromVerdict(judged, {
      turn: game.turn, domain, text,
      stock: { pop: nation.pop, food: nation.food, minerals: nation.minerals, energy: nation.energy },
    });
    game.activePolicies.push(policy);
    nation.stability = Math.max(0, nation.stability - 3);
    statuteEffect = 'reform';
    upsertStatute(nation, { text, domain, turn: game.turn });
    game.log.push({ turn: game.turn, kind: 'policy', brief: text, statute: 'reform', text: judged.narrative });
  }

  game.policies = game.policies || [];
  game.policies.push({
    turn: game.turn,
    domain: domain || '',
    text,
    verdict: judged.verdict,
    narrative: judged.narrative,
    pop: judged.populationChangePct,
    stab: judged.stabilityChange,
    appeal: judged.appealChange,
    statute: statuteEffect,
  });
  saveGame(game);
  return { ok: true, statuteEffect, policy: existing };
}

// 手动取消施政：即刻停止兑现（祖制仍留存典章）
export function cancelPolicy(game, policyId) {
  const nation = playerNation(game);
  const policy = (game.activePolicies || []).find((p) => p.id === policyId);
  if (!policy) return { ok: false, reason: '查无此政' };
  game.activePolicies = game.activePolicies.filter((p) => p.id !== policyId);
  game.log.push({
    turn: game.turn, kind: 'policy',
    text: `${nation.name}下诏罢行「${String(policy.text).slice(0, 20)}${policy.text.length > 20 ? '…' : ''}」之政。`,
  });
  saveGame(game);
  return { ok: true };
}

// 手动进入下一回合：结算施政与天下大势，返回聚合的国力变化
export function resolveNextTurn(game) {
  const nation = playerNation(game);
  const before = statSnapshot(nation);
  const report = resolveTurn(game);
  if (!report) return null;
  report.deltas = diffStats(before, statSnapshot(nation));
  saveGame(game);
  return report;
}

function statSnapshot(nation) {
  return {
    pop: nation.pop, stability: nation.stability, appeal: nation.appeal,
    food: nation.food, minerals: nation.minerals, energy: nation.energy,
  };
}

function diffStats(before, after) {
  return Object.fromEntries(Object.keys(before).map((k) => [k, after[k] - before[k]]));
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

// —— 军团动作（军局面板）——
// 统一入口：校验归属 → 调引擎 → 写编年史 → 存档。

function findPlayerArmy(game, armyId) {
  return (game.armies || []).find((a) => a.id === armyId && a.owner === game.playerId);
}

function logWar(game, report, nation) {
  game.log.push({
    turn: game.turn, kind: 'war', major: true,
    text: report.captured
      ? `${nation.name}军团攻克一处${TERRAINS[game.map.cells[report.targetIdx].t].name}，我军折损 ${report.losses} 人${report.defenderName !== '散落部民' ? `，${report.defenderName}守军溃败（折损 ${report.defenderLosses}）` : ''}${report.absorbed ? `，收编归化之民 ${report.absorbed}` : ''}。`
      : `进攻受挫！${report.defenderName}据险死守，我军折损 ${report.losses} 人，军心震动。`,
  });
}

// 组建军团：从后备兵员拨付，落于本国无驻军之格（优先都城）
export function doFormArmy(game, size) {
  const nation = playerNation(game);
  const r = formArmyFor(game, nation, size, `${game.seed}:form:${game.turn}:${game.armies.length}`);
  if (!r.ok) return r;
  game.log.push({ turn: game.turn, kind: 'military', text: `${nation.name}组建军团：${size} 之众于营成军。` });
  saveGame(game);
  return r;
}

export function doMoveArmy(game, armyId, targetIdx) {
  const army = findPlayerArmy(game, armyId);
  if (!army) return { ok: false, reason: '查无此军团' };
  const r = moveArmyTo(game, army, targetIdx);
  if (r.ok) saveGame(game);
  return r;
}

export function doArmyAttack(game, armyId, targetIdx) {
  const army = findPlayerArmy(game, armyId);
  if (!army) return { ok: false, reason: '查无此军团' };
  const nation = playerNation(game);
  const report = resolveArmyAttack(game, army, targetIdx);
  if (!report.ok) return report;
  logWar(game, report, nation);
  if (report.captured && nation.cells.length >= RULES.victoryCells) game.phase = 'victory';
  saveGame(game);
  return report;
}

export function doBuildFort(game, armyId) {
  const army = findPlayerArmy(game, armyId);
  if (!army) return { ok: false, reason: '查无此军团' };
  const r = buildFort(game, army);
  if (r.ok) {
    const nation = playerNation(game);
    game.log.push({ turn: game.turn, kind: 'military', text: `${nation.name}于边境修筑工事至 ${r.level} 级，耗矿 ${r.cost}。` });
    saveGame(game);
  }
  return r;
}

export function doToggleDefend(game, armyId) {
  const army = findPlayerArmy(game, armyId);
  if (!army) return { ok: false, reason: '查无此军团' };
  const r = toggleDefend(game, army);
  saveGame(game);
  return r;
}

export function doColonize(game, armyId, targetIdx) {
  const army = findPlayerArmy(game, armyId);
  if (!army) return { ok: false, reason: '查无此军团' };
  const nation = playerNation(game);
  const r = colonizeAdjacent(game, army, targetIdx);
  if (r.ok) {
    game.log.push({
      turn: game.turn, kind: 'military',
      text: `${nation.name}移殖民于相邻无主之地，安置部民 ${r.settlers} 人，拓疆一格。`,
    });
    if (nation.cells.length >= RULES.victoryCells) game.phase = 'victory';
    saveGame(game);
  }
  return r;
}

// —— 邦交归降：传檄而定 ——
// 国力（后备+军团，含士气折算）至少两倍于彼、且邦交达友善（≥40）时，
// 可劝其举国归顺；条件不足而强行劝降，则触怒对方，即刻开战。
export function demandSubmission(game, targetId) {
  const player = playerNation(game);
  const target = game.nations[targetId];
  if (!target || target.dead) return { ok: false, reason: '该国已不存在' };
  if (player.enemies.includes(targetId)) return { ok: false, reason: '交战之际，无劝降可言' };

  const myPower = totalStrength(game, player.id);
  const theirPower = totalStrength(game, targetId);
  const rel = getRelation(game, player.id, targetId);

  // 归降门槛：绝对国力至少 30（乌合之众劝不动任何人），且为对方两倍
  if (myPower >= Math.max(theirPower * 2, 30) && rel >= 40) {
    // 举国归顺：疆土、民、兵、粮悉数并入（折价收纳）
    for (const idx of [...target.cells]) {
      const cell = game.map.cells[idx];
      cell.owner = player.id;
      cell.fort = 0;
      player.cells.push(idx);
    }
    target.cells = [];
    player.pop += Math.round(target.pop * 0.6);
    player.soldiers += Math.round(target.soldiers * 0.5);
    player.food += Math.round(target.food * 0.5);
    player.minerals += Math.round(target.minerals * 0.5);
    player.energy += Math.round(target.energy * 0.5);
    // 残军就地解散
    game.armies = (game.armies || []).filter((a) => a.owner !== targetId);
    target.dead = true;
    adjustRelation(game, player.id, targetId, 20);
    game.log.push({
      turn: game.turn, kind: 'diplo', major: true,
      text: `传檄而定！${target.name}见${player.name}兵强邦睦，举国归顺：献土 ${player.cells.length} 格、民 ${Math.round(target.pop * 0.6)} 口。`,
    });
    if (player.cells.length >= RULES.victoryCells) game.phase = 'victory';
    saveGame(game);
    return { ok: true, surrendered: true, targetName: target.name };
  }

  // 条件不足：触怒对方，邦交钉在敌视，即刻开战
  setRelation(game, player.id, targetId, -40);
  startWar(game, player, target);
  breakRoute(game, player.id, targetId);
  game.log.push({
    turn: game.turn, kind: 'diplo', major: true,
    text: `${player.name}遣使劝降，${target.name}掷书于地：「吾国虽小，亦不跪！」两国即刻开战。`,
  });
  saveGame(game);
  return { ok: true, surrendered: false, targetName: target.name };
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
