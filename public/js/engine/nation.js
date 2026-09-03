import { RULES } from './constants.js';

export const STAGE_NAMES = {
  tribe: '部落',
  kingdom: '王国',
  republic_presidential: '总统制共和国',
  republic_chairman: '主席国',
};

export const AI_NATION_DEFS = [
  { name: '玄岩氏', color: '#c0564a', strategy: 'militarist' },
  { name: '苍狼氏', color: '#5a7fbf', strategy: 'agrarian' },
  { name: '潮汐氏', color: '#7a5aa0', strategy: 'merchant' },
];

export function stageLabel(nation) {
  if (nation.stage === 'republic') return STAGE_NAMES[`republic_${nation.republicType}`];
  return STAGE_NAMES[nation.stage];
}

export function createNation({ id, name, leader, color, isPlayer, startCell, strategy }) {
  return {
    id, name, leader, color, isPlayer,
    stage: 'tribe',
    republicType: null,
    cells: [startCell],
    pop: 100,
    soldiers: 0,
    food: 200,
    minerals: 40,
    energy: 40,
    stability: 60,
    appeal: 12,
    strategy: strategy || null,
    enemies: [],
    civTier: 1, // 文明等级（engine/civ.js），开局即初始化以便记录晋升
    statutes: [], // 现存典章（engine/statutes.js），开局由 newGame 随机授予
  };
}

// —— 阶段演进守卫：集中在这里，避免条件散落在 UI 与回合结算两处 ——

export function canConscript(nation) {
  return nation.pop >= RULES.conscriptMinPop;
}

export function coronationDue(nation) {
  return nation.stage === 'tribe' && nation.pop >= RULES.kingdomPop;
}

export function republicDue(nation) {
  return nation.stage === 'kingdom'
    && nation.pop >= RULES.republicPop
    && nation.stability >= RULES.republicStability;
}

export function crownKingdom(nation) {
  nation.stage = 'kingdom';
}

export function establishRepublic(nation, type) {
  if (!['presidential', 'chairman'].includes(type)) return;
  nation.stage = 'republic';
  nation.republicType = type;
  // 政制革新红利：新政权向民众让权，换取一波稳定与声望
  nation.stability = Math.min(100, nation.stability + 15);
  nation.appeal = Math.min(100, nation.appeal + 10);
}

// 供 AI 裁决的国情快照：只暴露裁决需要的字段，且都是服务端会再校验的基础类型
export function snapshotForAI(game, nation) {
  const owned = nation.cells.map((i) => game.map.cells[i]);
  const res = owned.reduce(
    (acc, c) => ({
      food: acc.food + c.res.food,
      minerals: acc.minerals + c.res.minerals,
      energy: acc.energy + c.res.energy,
    }),
    { food: 0, minerals: 0, energy: 0 },
  );
  return {
    turn: game.turn,
    stage: stageLabel(nation),
    nationName: nation.name,
    pop: nation.pop,
    soldiers: nation.soldiers,
    stability: nation.stability,
    appeal: nation.appeal,
    cellCount: nation.cells.length,
    food: nation.food,
    minerals: nation.minerals,
    energy: nation.energy,
    landYield: res,
    statutes: (nation.statutes || []).map((s) => s.text.slice(0, 60)),
    recentPolicies: game.log
      .filter((e) => e.kind === 'policy' && e.turn > game.turn - 4)
      .map((e) => e.brief)
      .filter(Boolean),
  };
}
