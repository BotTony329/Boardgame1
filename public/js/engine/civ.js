import { RULES } from './constants.js';

// ===== 文明进步判定 =====
// 设计原则：城市与士兵的图像随「文明等级 / 兵制等级」变化，
// 等级由硬性门槛（人口、稳定、政体阶段）决定，而不是单一人口数——
// 苛政之下民生凋敝，城市理应破败倒退；达标即晋升，失守即降级，
// 图像因此成为国策好坏的可见反馈。

const STAGE_RANK = { tribe: 0, kingdom: 1, republic: 2 };

export function stageRank(nation) {
  return STAGE_RANK[nation.stage] ?? 0;
}

// 文明等级：越靠后门槛越高，判定取「全部门槛均满足的最高等级」
export const CIV_TIERS = [
  { level: 1, name: '荒陬营地', desc: '篝火与兽皮帐篷', gates: {} },
  { level: 2, name: '篝火村落', desc: '木屋聚落初成', gates: { pop: 300, stability: 40 } },
  { level: 3, name: '邑落城邦', desc: '栅栏环屋、市集初开', gates: { pop: 1200, stability: 50 } },
  { level: 4, name: '王城都会', desc: '城墙耸立、宫殿巍然', gates: { pop: 3000, stability: 55, minStage: 1 } },
  { level: 5, name: '煌煌都邑', desc: '万象竞辉的文明之都', gates: { pop: 8000, stability: 60, minStage: 2 } },
];

// 兵制等级：决定士兵图像；军力门槛 + 政体约束（部落养不出职业军团）
export const ARMY_TIERS = [
  { level: 1, name: '猎手民兵', desc: '持矛猎手与皮盾', gates: {} },
  { level: 2, name: '部族武士', desc: '皮甲战斧的武士', gates: { soldiers: 100 } },
  { level: 3, name: '常备军团', desc: '制式甲胄的军团', gates: { soldiers: 800, minStage: 1 } },
  { level: 4, name: '职业军队', desc: '训练有素的职业军', gates: { soldiers: 3000, minStage: 2 } },
];

function meetsGates(nation, gates = {}) {
  return (gates.pop ?? 0) <= nation.pop
    && (gates.stability ?? 0) <= nation.stability
    && (gates.soldiers ?? 0) <= nation.soldiers
    && (gates.minStage ?? 0) <= stageRank(nation);
}

export function civTierOf(nation) {
  let tier = CIV_TIERS[0];
  for (const t of CIV_TIERS) {
    if (meetsGates(nation, t.gates)) tier = t;
  }
  return tier;
}

export function armyTierOf(nation) {
  let tier = ARMY_TIERS[0];
  for (const t of ARMY_TIERS) {
    if (meetsGates(nation, t.gates)) tier = t;
  }
  return tier;
}

// 距下一文明等级还差什么（供 UI 提示）；已在顶 Returns null
export function nextCivGap(nation) {
  const cur = civTierOf(nation).level;
  const next = CIV_TIERS.find((t) => t.level === cur + 1);
  if (!next) return null;
  const g = next.gates;
  const gaps = [];
  if (nation.pop < (g.pop ?? 0)) gaps.push(`人口 ${Math.round(nation.pop)}/${g.pop}`);
  if (nation.stability < (g.stability ?? 0)) gaps.push(`稳定 ${Math.round(nation.stability)}/${g.stability}`);
  if ((g.minStage ?? 0) > stageRank(nation)) gaps.push(minStageName(g.minStage));
  return { tier: next, gaps };
}

function minStageName(rank) {
  return rank >= 2 ? '须先改制共和/主席国' : '须先加冕为王';
}
