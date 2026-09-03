import { TERRAINS, RULES } from './constants.js';
import { mulberry32 } from './rng.js';

// 征兵：把人口转化为常备军。人口与存粮双门槛——没有余粮养不起兵。
export function maxConscript(nation) {
  if (nation.pop < RULES.conscriptMinPop) return 0;
  const byPop = Math.floor((nation.pop - 200) * 0.1);
  const byFood = Math.floor(nation.food / 2);
  const byMinerals = Math.floor(nation.minerals / 0.5); // 每兵 0.5 矿产打造兵器
  return Math.max(0, Math.min(byPop, byFood, byMinerals));
}

export function conscript(nation, count) {
  const cap = maxConscript(nation);
  const n = Math.max(0, Math.min(Math.floor(count), cap));
  if (n === 0) return { recruited: 0 };
  nation.pop -= n;
  nation.food -= n * 2;
  nation.minerals -= n * 0.5;
  nation.soldiers += n;
  nation.stability = Math.max(0, nation.stability - 2); // 抽调劳力引发轻微民怨
  return { recruited: n };
}

export function neighbors(game, cellIdx) {
  const { w, h } = game.map;
  const x = cellIdx % w;
  const y = Math.floor(cellIdx / w);
  const out = [];
  if (x > 0) out.push(cellIdx - 1);
  if (x < w - 1) out.push(cellIdx + 1);
  if (y > 0) out.push(cellIdx - w);
  if (y < h - 1) out.push(cellIdx + w);
  return out;
}

// 可攻击目标：与本国领土正交相邻、且不属于本国的陆地格
export function attackableCells(game, nationId) {
  const owned = new Set(game.nations[nationId].cells);
  const targets = new Set();
  for (const idx of owned) {
    for (const nb of neighbors(game, idx)) {
      const cell = game.map.cells[nb];
      if (cell.t !== 'ocean' && !owned.has(nb)) targets.add(nb);
    }
  }
  return [...targets];
}

function cellDefense(game, cellIdx) {
  const cell = game.map.cells[cellIdx];
  const terrainDef = TERRAINS[cell.t].defense;
  if (cell.owner === null) {
    return { strength: cell.wild * 0.6 * terrainDef + 5, defender: null };
  }
  const defender = game.nations[cell.owner];
  const morale = defender.stability / 60 + 0.4;
  return { strength: defender.soldiers * terrainDef * morale, defender };
}

// 战斗解算：军力对比 + 地形防御 + 士气（稳定度）+ 少量运气。
// 返回战报对象供 UI 与编年史使用，副作用直接落到 game 状态。
export function resolveAttack(game, attacker, cellIdx, rngSeed = `${game.seed}:${game.turn}:${cellIdx}`) {
  const rng = mulberry32(mulberry32Hash(rngSeed));
  const cell = game.map.cells[cellIdx];
  const { strength: defStr, defender } = cellDefense(game, cellIdx);
  const morale = attacker.stability / 60 + 0.4;

  // 远征消耗能源；补给不足则军心涣散，战力打八折——让能源禀赋影响扩张节奏
  const energyNeed = attacker.soldiers * 0.2;
  const supplied = attacker.energy >= energyNeed;
  attacker.energy = Math.max(0, attacker.energy - energyNeed);

  const attStr = attacker.soldiers * morale * (supplied ? 1 : 0.8) * (0.85 + rng() * 0.3);

  const ratio = attStr / (attStr + defStr || 1);
  const captured = attStr > defStr * 1.1;

  // 伤亡与胜负差挂钩：险胜惨胜、碾压轻损
  const attLossRate = captured ? 0.1 + (1 - ratio) * 0.5 : 0.25 + (1 - ratio) * 0.6;
  const losses = Math.round(attacker.soldiers * attLossRate);
  attacker.soldiers = Math.max(0, attacker.soldiers - losses);
  attacker.pop = Math.max(10, attacker.pop - Math.round(losses * 0.4)); // 伤亡同样来自人口

  let defenderNote = '';
  let defenderLosses = 0;
  if (defender) {
    defenderLosses = Math.round(defender.soldiers * (captured ? 0.5 : 0.3));
    defender.soldiers = Math.max(0, defender.soldiers - defenderLosses);
    defenderNote = `，守军${defender.name}折损${defenderLosses}`;
    if (captured && defender.cells.length <= 1) {
      defender.pop = Math.round(defender.pop * 0.5);
    }
  }

  let absorbed = 0;
  if (captured) {
    if (defender) {
      removeCell(defender, cellIdx);
      startWar(game, attacker, defender);
    }
    // 攻占之地吸收一半原住民，其余逃散四方
    absorbed = Math.round(cell.wild * 0.5);
    attacker.pop += absorbed;
    cell.wild = Math.round(cell.wild * 0.5);
    cell.owner = attacker.id;
    attacker.cells.push(cellIdx);
    attacker.stability = Math.max(0, attacker.stability - 3); // 战争消耗民心
  } else {
    attacker.stability = Math.max(0, attacker.stability - 8);
  }

  return {
    captured,
    cellIdx,
    losses,
    defenderLosses,
    defenderName: defender?.name || '散落部民',
    absorbed,
    attackerName: attacker.name,
  };
}

export function removeCell(nation, cellIdx) {
  nation.cells = nation.cells.filter((i) => i !== cellIdx);
}

export function startWar(game, a, b) {
  if (!a.enemies.includes(b.id)) a.enemies.push(b.id);
  if (!b.enemies.includes(a.id)) b.enemies.push(a.id);
}

function mulberry32Hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
