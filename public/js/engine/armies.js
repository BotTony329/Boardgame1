// ===== 军团系统：地图上的可指挥武装力量 =====
// 军团是国家兵力的具象化：从后备兵员组建、在地图上行军（每回合 1 格）、
// 攻击/修筑工事/坚守/殖民拓疆。进入无主之地即镇压当地部民完成拓疆；
// 击败敌军或民兵即攻城拔寨。战斗消耗能源，补给不足战力打折。

import { TERRAINS, RULES } from './constants.js';
import { mulberry32 } from './rng.js';

export const FORT_MAX = 2;
export const FORT_COSTS = [30, 60];          // 修筑工事的矿产造价（一级/二级）
export const COLONIZE_FOOD_COST = 40;
export const DEFEND_BONUS = 1.35;             // 坚守姿态防御加成
export const ARMY_MOVE_PER_TURN = 1;

export function armyAt(game, cellIdx) {
  return (game.armies || []).find((a) => a.cell === cellIdx);
}

export function armiesOf(game, nationId) {
  return (game.armies || []).filter((a) => a.owner === nationId);
}

export function armySoldiersTotal(game, nationId) {
  return armiesOf(game, nationId).reduce((s, a) => s + a.soldiers, 0);
}

export function totalStrength(game, nationId) {
  const nation = game.nations[nationId];
  const morale = nation.stability / 60 + 0.4;
  return (nation.soldiers + armySoldiersTotal(game, nationId)) * morale;
}

// 行军力：每回合结算时重置
export function resetArmyMoves(game) {
  for (const army of game.armies || []) army.moveLeft = ARMY_MOVE_PER_TURN;
}

function neighbors(game, cellIdx) {
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

// 目标格分类：己方=调防；无主=拓疆（镇压）；敌方=进攻
export function classifyArmyTarget(game, army, targetIdx) {
  if (!neighbors(game, army.cell).includes(targetIdx)) return 'unreachable';
  if (army.moveLeft <= 0) return 'exhausted';
  const cell = game.map.cells[targetIdx];
  if (cell.t === 'ocean') return 'ocean';
  if (cell.owner === army.owner) return 'move';
  return 'attack'; // 无主或敌方
}

// 格子防御力量：驻防军团 > 城邑民兵 > 散落部民
export function cellDefense(game, cellIdx) {
  const cell = game.map.cells[cellIdx];
  const terrain = TERRAINS[cell.t].defense;
  const fortMult = 1 + (cell.fort || 0) * 0.5;
  const army = armyAt(game, cellIdx);
  if (army) {
    const nation = game.nations[army.owner];
    const morale = nation.stability / 60 + 0.4;
    let strength = army.soldiers * morale * terrain * fortMult;
    if (army.stance === 'defend') strength *= DEFEND_BONUS;
    return { kind: 'army', army, strength };
  }
  if (cell.owner) {
    const nation = game.nations[cell.owner];
    const strength = (10 + nation.pop * 0.06) * terrain * fortMult * (nation.stability / 60 + 0.4);
    return { kind: 'militia', nation, strength };
  }
  return { kind: 'wild', strength: cell.wild * 0.6 * terrain + 5 };
}

function removeArmy(game, army) {
  game.armies = (game.armies || []).filter((a) => a !== army);
}

function captureCell(game, army, cellIdx) {
  const cell = game.map.cells[cellIdx];
  const attacker = game.nations[army.owner];
  const prevOwner = cell.owner;
  if (prevOwner) {
    const prev = game.nations[prevOwner];
    prev.cells = prev.cells.filter((i) => i !== cellIdx);
    if (!attacker.enemies.includes(prevOwner) && !prev.isPlayer) {
      // 首次攻入他国即宣战
      attacker.enemies.push(prevOwner);
      prev.enemies.push(attacker.id);
    } else if (prev.isPlayer && !attacker.enemies.includes('p1')) {
      attacker.enemies.push('p1');
      prev.enemies.push(attacker.id);
    }
  }
  const absorbed = Math.round((cell.wild || 0) * 0.5);
  attacker.pop += absorbed;
  cell.wild = Math.round((cell.wild || 0) * 0.5);
  cell.owner = army.owner;
  cell.fort = 0; // 城防易手即毁
  attacker.cells.push(cellIdx);
  attacker.stability = Math.max(0, attacker.stability - 2);
  army.cell = cellIdx; // 胜军进驻
  return { absorbed, prevOwnerName: prevOwner ? game.nations[prevOwner].name : null, prevOwner };
}

// 军团攻击相邻目标（无主/敌方）。胜则攻占领土并进驻；败则重损士气。
export function resolveArmyAttack(game, army, targetIdx, rngSeed) {
  const cell = game.map.cells[targetIdx];
  if (cell.t === 'ocean') return { ok: false, reason: '铁蹄不能渡海' };
  if (!neighbors(game, army.cell).includes(targetIdx)) return { ok: false, reason: '目标不在行军范围' };
  if (army.moveLeft <= 0) return { ok: false, reason: '本回合行军力已耗尽' };
  if (cell.owner === army.owner) return { ok: false, reason: '那是本国领土' };

  const rng = mulberry32(rngSeedHash(rngSeed || `army:${game.turn}:${army.id}:${targetIdx}`));
  const nation = game.nations[army.owner];
  const def = cellDefense(game, targetIdx);

  const energyNeed = army.soldiers * 0.2;
  const supplied = nation.energy >= energyNeed;
  nation.energy = Math.max(0, nation.energy - energyNeed);

  const morale = nation.stability / 60 + 0.4;
  const attStr = army.soldiers * morale * (supplied ? 1 : 0.8) * (0.85 + rng() * 0.3);
  const defStr = def.strength * (0.9 + rng() * 0.2);
  const ratio = attStr / (attStr + defStr || 1);
  const captured = attStr > defStr * 1.1;

  army.moveLeft = 0;
  const attLossRate = captured ? 0.08 + (1 - ratio) * 0.45 : 0.22 + (1 - ratio) * 0.6;
  const losses = Math.round(army.soldiers * attLossRate);
  army.soldiers = Math.max(0, army.soldiers - losses);
  nation.pop = Math.max(10, nation.pop - Math.round(losses * 0.4));
  nation.stability = Math.max(0, nation.stability - (captured ? 2 : 6));

  let defenderLosses = 0;
  let defenderName = '散落部民';
  if (def.kind === 'army') {
    defenderName = game.nations[def.army.owner].name;
    defenderLosses = Math.round(def.army.soldiers * (captured ? 0.5 : 0.3));
    def.army.soldiers = Math.max(0, def.army.soldiers - defenderLosses);
  } else if (def.kind === 'militia') {
    defenderName = def.nation.name;
  }

  let captureInfo = null;
  if (captured) {
    // 守军被击溃：残部撤往相邻己土，无处可退则覆灭
    if (def.kind === 'army' && def.army.soldiers > 0) {
      const retreat = neighbors(game, targetIdx).find((i) =>
        game.map.cells[i].owner === def.army.owner && !armyAt(game, i));
      if (retreat != null) def.army.cell = retreat;
      else removeArmy(game, def.army);
    }
    captureInfo = captureCell(game, army, targetIdx);
  }
  if (army.soldiers <= 0) removeArmy(game, army);

  return {
    ok: true,
    captured,
    losses,
    defenderLosses,
    defenderName,
    defenderKind: def.kind,
    absorbed: captureInfo?.absorbed || 0,
    targetIdx,
  };
}

// 调防：进入己方领土（工事后留在原地，属城防不随军）
export function moveArmyTo(game, army, targetIdx) {
  const cell = game.map.cells[targetIdx];
  if (cell.t === 'ocean') return { ok: false, reason: '铁蹄不能渡海' };
  if (!neighbors(game, army.cell).includes(targetIdx)) return { ok: false, reason: '目标不在行军范围' };
  if (army.moveLeft <= 0) return { ok: false, reason: '本回合行军力已耗尽' };
  if (cell.owner !== army.owner) return { ok: false, reason: '非本国领土' };
  if (armyAt(game, targetIdx)) return { ok: false, reason: '该地已有军团驻防' };
  army.cell = targetIdx;
  army.moveLeft = 0;
  return { ok: true, moved: true };
}

// 修筑工事：驻留原地，两级（防御 ×1.5 / ×2.0）
export function buildFort(game, army) {
  const cell = game.map.cells[army.cell];
  if (cell.owner !== army.owner) return { ok: false, reason: '只能在本国领土修筑工事' };
  if (army.moveLeft <= 0) return { ok: false, reason: '本回合行军力已耗尽' };
  const level = cell.fort || 0;
  if (level >= FORT_MAX) return { ok: false, reason: '工事已固若金汤' };
  const cost = FORT_COSTS[level];
  const nation = game.nations[army.owner];
  if (nation.minerals < cost) return { ok: false, reason: `矿产不足（需 ${cost}）` };
  nation.minerals -= cost;
  cell.fort = level + 1;
  army.moveLeft = 0;
  return { ok: true, level: cell.fort, cost };
}

// 坚守姿态切换：不耗行军力；坚守 +35% 防御，但该军团不会主动出战
export function toggleDefend(game, army) {
  army.stance = army.stance === 'defend' ? 'idle' : 'defend';
  return { ok: true, stance: army.stance };
}

// 殖民拓疆（和平版）：安抚相邻无主之地，不诉诸刀兵
export function colonizeAdjacent(game, army, targetIdx) {
  const cell = game.map.cells[targetIdx];
  if (cell.t === 'ocean') return { ok: false, reason: '不能殖民海洋' };
  if (!neighbors(game, army.cell).includes(targetIdx)) return { ok: false, reason: '目标不在行军范围' };
  if (cell.owner) return { ok: false, reason: '此地已有归属' };
  if (army.moveLeft <= 0) return { ok: false, reason: '本回合行军力已耗尽' };
  const nation = game.nations[army.owner];
  if (nation.food < COLONIZE_FOOD_COST) return { ok: false, reason: `移民粮草不足（需 ${COLONIZE_FOOD_COST}）` };
  nation.food -= COLONIZE_FOOD_COST;
  const settlers = Math.round((cell.wild || 0) * 0.3);
  cell.owner = army.owner;
  nation.cells.push(targetIdx);
  nation.pop += settlers;
  cell.wild = Math.round((cell.wild || 0) * 0.7);
  army.moveLeft = 0;
  return { ok: true, settlers };
}

// —— AI 军团行为：参战则向敌进军接战；否则拓疆或加固边防 ——

export function aiArmiesTurn(game, logs, rng) {
  for (const army of [...(game.armies || [])]) {
    if (army.owner === game.playerId || army.moveLeft <= 0) continue;
    const nation = game.nations[army.owner];
    if (!nation || nation.dead) continue;

    const adjacent = neighbors(game, army.cell);
    const enemyCells = adjacent.filter((i) => {
      const owner = game.map.cells[i].owner;
      return owner && nation.enemies.includes(owner);
    });

    // 战时：攻击防备最弱的相邻敌格
    if (enemyCells.length > 0) {
      const target = enemyCells.sort((a, b) => cellDefense(game, a).strength - cellDefense(game, b).strength)[0];
      const report = resolveArmyAttack(game, army, target, `ai:${game.turn}:${army.id}:${target}`);
      if (report.ok) {
        logs.push({
          turn: game.turn, kind: 'war', major: report.captured,
          text: report.captured
            ? `${nation.name}军团攻陷我方一处${TERRAINS[game.map.cells[target].t].name}！我军折损 ${report.losses}。`
            : `${nation.name}军团进犯被我击退，敌军折损 ${report.defenderLosses}、我军折损 ${report.losses}。`,
        });
      }
      continue;
    }

    // 战时行军：向最近的敌占格逼近一步
    if (nation.enemies.length > 0) {
      const step = adjacent.find((i) => {
        const c = game.map.cells[i];
        return c.t !== 'ocean' && !armyAt(game, i) && (c.owner === army.owner || !c.owner);
      });
      if (step != null) { army.cell = step; army.moveLeft = 0; continue; }
    }

    // 和平期：拓疆或修筑边防工事
    const neutral = adjacent.filter((i) => !game.map.cells[i].owner && game.map.cells[i].t !== 'ocean');
    if (neutral.length > 0 && rng() < 0.5) {
      const r = colonizeAdjacent(game, army, neutral[Math.floor(rng() * neutral.length)]);
      if (r.ok) {
        logs.push({ turn: game.turn, kind: 'ai', text: `${nation.name}移殖民于新地，开疆拓土。` });
        continue;
      }
    }
    const ownCell = game.map.cells[army.cell];
    if ((ownCell.fort || 0) < 1 && nation.minerals >= FORT_COSTS[0] && rng() < 0.3) {
      buildFort(game, army);
    }
  }
}

// 组建军团（引擎层）：从后备兵员拨付，落于本国无驻军的格子（默认都城）
export function formArmyFor(game, nation, soldiers, rngSeed = 'form') {
  const size = Math.floor(soldiers);
  if (size <= 0) return { ok: false, reason: '兵力过少，不足以成军' };
  if (nation.soldiers < size) return { ok: false, reason: '后备兵员不足' };
  const spots = nation.cells.filter((i) => game.map.cells[i].t !== 'ocean' && !armyAt(game, i));
  if (spots.length === 0) return { ok: false, reason: '国土上已无可用驻营地（每格至多一军）' };
  // 优先都城
  const cell = nation.cells[0] && !armyAt(game, nation.cells[0]) ? nation.cells[0]
    : spots.sort((a, b) => (a === nation.cells[0] ? -1 : b === nation.cells[0] ? 1 : 0))[0];
  nation.soldiers -= size;
  const army = {
    id: `army-${nation.id}-${Math.floor(mulberry32(rngSeedHash(rngSeed))() * 1e9).toString(36)}`,
    owner: nation.id,
    cell,
    soldiers: size,
    stance: 'idle',
    moveLeft: ARMY_MOVE_PER_TURN,
  };
  game.armies = game.armies || [];
  game.armies.push(army);
  return { ok: true, army };
}

function rngSeedHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
