import { RULES } from './constants.js';

// 征兵：把人口转化为后备兵员。人口、存粮、矿产三重门槛——没有余粮养不起兵。
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

// 与本国领土正交相邻的格子（AI 殖民与军团行动的基础查询）
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

export function startWar(game, a, b) {
  if (!a.enemies.includes(b.id)) a.enemies.push(b.id);
  if (!b.enemies.includes(a.id)) b.enemies.push(a.id);
}
