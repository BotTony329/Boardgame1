// ===== 持续施政系统 =====
// 政策经千问裁定「逐回合持续量」（perTurn，数值由 AI 依国情定夺）后进入"施政中"：
// 效果逐回合兑现，效力（potency 0~100）每回合衰减，耗尽后自动载入典章；
// 续行相同文本可回满效力（守成）。

import { upsertStatute } from './statutes.js';

// 施政数量不设硬上限：每次颁布的变法成本（稳定−3）与效力自然衰减即是约束
export const POTENCY_DECAY_PER_TURN = 15;

const clampStat = (v) => Math.max(0, Math.min(100, v));

// 颁布：把千问裁定的 perTurn 效果落到施政列表（引擎只钳形状，不折算数值）
export function policyFromVerdict(judged, { turn, domain, text }) {
  const base = judged.perTurn || {};
  const zero = { pop: 0, appeal: 0, stability: 0, food: 0, minerals: 0, energy: 0 };
  return {
    id: `pol-${turn}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    turn,
    domain,
    text,
    verdict: judged.verdict,
    potency: 100,
    perTurn: { ...zero, ...base },
  };
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
