// ===== 持续施政系统 =====
// 政策经 AI 裁决力度后进入"施政中"：效果逐回合兑现，效力（potency 0~100）
// 每回合衰减，耗尽后自动载入典章。数值在颁布时按国力折算为固定量，
// 避免百分比逐回合复利导致失控；续行相同文本可回满效力（守成）。

import { upsertStatute } from './statutes.js';

// 施政数量不设硬上限：每次颁布的变法成本（稳定−3）与效力自然衰减即是约束
export const POTENCY_DECAY_PER_TURN = 15;

const round1 = (v) => Math.round(v * 10) / 10;
const clampStat = (v) => Math.max(0, Math.min(100, v));

// 把 AI 裁决的一次性力度换算为逐回合固定量（按颁布时国力折算，防止百分比逐回合复利）
export function policyFromVerdict(judged, { turn, domain, text, stock }) {
  const perTurn = {
    appeal: Math.max(-6, Math.min(8, round1(judged.appealChange * 0.4))),
    stability: Math.max(-6, Math.min(6, round1(judged.stabilityChange * 0.3))),
    pop: clampAbs(Math.round(stock.pop * (judged.populationChangePct / 100) * 0.05), 80),
    food: clampAbs(Math.round(stock.food * (judged.resourceChanges.food / 100) * 0.12), 60),
    minerals: clampAbs(Math.round(stock.minerals * (judged.resourceChanges.minerals / 100) * 0.12), 60),
    energy: clampAbs(Math.round(stock.energy * (judged.resourceChanges.energy / 100) * 0.12), 60),
  };
  return {
    id: `pol-${turn}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    turn,
    domain,
    text,
    verdict: judged.verdict,
    potency: 100,
    perTurn,
  };
}

function clampAbs(v, limit) {
  return Math.max(-limit, Math.min(limit, v));
}

// 回合结算时兑现所有施政；效力耗尽的自动入典章并写编年史。
export function applyActivePolicies(game, logs) {
  const nation = game.nations[game.playerId];
  const active = game.activePolicies || [];
  for (const p of active) {
    const s = p.potency / 100;
    nation.appeal = clampStat(nation.appeal + p.perTurn.appeal * s);
    nation.stability = clampStat(nation.stability + p.perTurn.stability * s);
    nation.food = Math.max(0, nation.food + p.perTurn.food * s);
    nation.minerals = Math.max(0, nation.minerals + p.perTurn.minerals * s);
    nation.energy = Math.max(0, nation.energy + p.perTurn.energy * s);
    nation.pop = Math.max(5, nation.pop + p.perTurn.pop * s);
    p.potency -= POTENCY_DECAY_PER_TURN;
  }

  const expired = active.filter((p) => p.potency <= 0);
  if (expired.length > 0) {
    game.activePolicies = active.filter((p) => p.potency > 0);
    for (const p of expired) {
      upsertStatute(nation, { text: p.text, domain: p.domain, turn: game.turn });
      logs.push({
        turn: game.turn, kind: 'policy',
        text: `「${String(p.text).slice(0, 24)}${p.text.length > 24 ? '…' : ''}」效力已尽，载入典章。`,
      });
    }
  }
}

// 效力条文案：把逐回合效果渲染成可读文本（供 UI 复用）
export function policyEffectsText(p) {
  const e = p.perTurn;
  const parts = [];
  if (e.appeal) parts.push(`吸引 ${signed(e.appeal)}`);
  if (e.stability) parts.push(`稳定 ${signed(e.stability)}`);
  if (e.pop) parts.push(`人口 ${signed(e.pop)}`);
  if (e.food) parts.push(`粮 ${signed(e.food)}`);
  if (e.minerals) parts.push(`矿 ${signed(e.minerals)}`);
  if (e.energy) parts.push(`能 ${signed(e.energy)}`);
  return parts.length ? parts.join(' · ') : '无量化收益，唯象征意义';
}

function signed(v) {
  return `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}/回合`;
}
