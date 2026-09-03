import { generateWorld } from './mapgen.js';
import { createNation, AI_NATION_DEFS, establishRepublic, stageLabel } from './nation.js';
import { resolveTurn } from './growth.js';
import { conscript, attackableCells, resolveAttack } from './war.js';
import { hashSeed, mulberry32, pick } from './rng.js';
import { RULES, TERRAINS } from './constants.js';

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
    return game?.map?.cells && game?.nations?.[game.playerId] ? game : null;
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
    turn: game.turn, kind: 'war',
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
    turn: game.turn, kind: 'milestone',
    text: `${nation.name}改制为${stageLabel(nation)}！${nation.leader}与万民共订新约，声望日隆。`,
  });
  saveGame(game);
  return true;
}

export { attackableCells };
