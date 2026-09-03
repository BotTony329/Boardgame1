import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, playerNation, applyResolvedTurn } from '../public/js/engine/game.js';
import { heuristicEvaluate } from '../public/js/engine/heuristic.js';
import { draftStatute, pickStatutes, STATUTE_LIBRARY } from '../public/js/engine/statutes.js';
import { chooseRepublicType, SAVE_KEY } from '../public/js/engine/game.js';

test('newGame 开局：四国各占一格、互不相邻、世界可玩', () => {
  const game = newGame({ nationName: '开局邦', leaderName: '始祖', seed: 'boot-seed' });
  const nations = Object.values(game.nations);
  assert.equal(nations.length, 4);
  assert.equal(game.phase, 'playing');
  assert.equal(game.turn, 1);
  for (const n of nations) {
    assert.equal(n.cells.length, 1);
    assert.equal(game.map.cells[n.cells[0]].owner, n.id);
    assert.ok(TERRAIN_LAND(game, n.cells[0]), '开局格必须是陆地');
  }
  // 起始格两两距离 ≥ 3
  for (let i = 0; i < nations.length; i++) {
    for (let j = i + 1; j < nations.length; j++) {
      const a = nations[i].cells[0], b = nations[j].cells[0];
      const w = game.map.w;
      const d = Math.max(Math.abs(a % w - b % w), Math.abs(Math.floor(a / w) - Math.floor(b / w)));
      assert.ok(d >= 3, `开局距离过近: ${d}`);
    }
  }
});

function TERRAIN_LAND(game, idx) {
  return game.map.cells[idx].t !== 'ocean';
}

test('启发式兜底：善政得分、苛政失分，输出形状与 AI 契约一致', () => {
  const game = newGame({ nationName: '兜底邦', leaderName: '测', seed: 'h-seed' });
  const snapshot = { nationName: '兜底邦', pop: 100, stability: 60, appeal: 12, turn: 1 };

  const good = heuristicEvaluate(snapshot, { domain: 'economy', text: '轻徭薄赋，开仓放粮赈济流民，兴修水利劝课农桑' });
  assert.equal(good.verdict, 'positive');
  assert.ok(good.populationChangePct > 0);
  assert.ok(good.appealChange > 0);
  assert.equal(good.source, 'fallback');

  const bad = heuristicEvaluate(snapshot, { domain: 'politics', text: '加税横征，宵禁戒严，镇压异见' });
  assert.equal(bad.verdict, 'negative');
  assert.ok(bad.populationChangePct < 0);
  assert.ok(bad.appealChange < 0);

  const blank = heuristicEvaluate(snapshot, { domain: 'culture', text: 'zzz 无关内容' });
  assert.ok(['positive', 'neutral', 'negative'].includes(blank.verdict));
  for (const k of ['food', 'minerals', 'energy']) {
    assert.ok(Number.isFinite(blank.resourceChanges[k]));
  }
});

test('改制抉择：未到时机不可改制，置位后可定国体', () => {
  const game = newGame({ nationName: '共和邦', leaderName: '测', seed: 'rep-seed' });
  assert.equal(chooseRepublicType(game, 'presidential'), false, '未置位 pendingRepublic 时拒绝');
  game.pendingRepublic = true;
  assert.equal(chooseRepublicType(game, 'presidential'), true);
  const n = playerNation(game);
  assert.equal(n.stage, 'republic');
  assert.equal(n.republicType, 'presidential');
  assert.equal(game.pendingRepublic, false);
});

test('政策档案：每道国策连同裁决被完整记录，回合号正确', () => {
  const game = newGame({ nationName: '档案邦', leaderName: '测', seed: 'archive-seed' });
  playerNation(game).food = 99999; // 防饥荒干扰
  const turnBefore = game.turn;
  applyResolvedTurn(game, {
    verdict: 'positive', narrative: '万民称便', brief: '轻徭薄赋，与民休息', domain: 'economy',
    populationChangePct: 2, stabilityChange: 3, appealChange: 4,
    resourceChanges: { food: 0, minerals: 0, energy: 0 },
  });
  assert.equal(game.policies.length, 1, '应存档一道国策');
  const p = game.policies[0];
  assert.equal(p.turn, turnBefore, '档案回合号应为颁布时的回合');
  assert.equal(p.text, '轻徭薄赋，与民休息');
  assert.equal(p.domain, 'economy');
  assert.equal(p.verdict, 'positive');
  assert.equal(p.pop, 2);
  // 旧存档（无 policies 字段）不应崩：applyResolvedTurn 会补建数组
  const legacy = newGame({ nationName: '旧档邦', leaderName: '测', seed: 'legacy-seed' });
  delete legacy.policies;
  applyResolvedTurn(legacy, {
    verdict: 'neutral', narrative: '如常', brief: '维持现状', domain: 'politics',
    populationChangePct: 0, stabilityChange: 0, appealChange: 0,
    resourceChanges: { food: 0, minerals: 0, energy: 0 },
  });
  assert.equal(legacy.policies.length, 1);
});

test('典章制度：开局随机继承两道祖制，同种子可复现，逐回合轮转预填', () => {
  const game = newGame({ nationName: '典章邦', leaderName: '测', seed: 'statute-seed' });
  const n = playerNation(game);
  assert.equal(n.statutes.length, 2, '开局应继承两道祖制');
  assert.notEqual(n.statutes[0].id, n.statutes[1].id, '两道祖制不重复');
  assert.ok(n.statutes.every((s) => s.text.length >= 10));

  const game2 = newGame({ nationName: '典章邦', leaderName: '测', seed: 'statute-seed' });
  assert.deepEqual(
    n.statutes.map((s) => s.id),
    game2.nations.p1.statutes.map((s) => s.id),
    '同种子继承相同祖制',
  );

  const d1 = draftStatute(n, 1);
  const d2 = draftStatute(n, 2);
  assert.notEqual(d1.id, d2.id, '逐回合轮转预填不同典章');
  assert.ok(STATUTE_LIBRARY.length >= 16, '典章库规模足够');
  assert.equal(pickStatutes(3).length, 3);
});

test('守成与变法：续行祖制稳定+1，改动稳定−3且新策录入典章', () => {
  const game = newGame({ nationName: '变法邦', leaderName: '测', seed: 'reform-seed' });
  const n = playerNation(game);
  n.food = 99999;
  const draft = draftStatute(n, game.turn);

  const stab0 = n.stability;
  applyResolvedTurn(game, {
    verdict: 'neutral', narrative: '一如常年', brief: draft.text, domain: draft.domain,
    populationChangePct: 0, stabilityChange: 0, appealChange: 0,
    resourceChanges: { food: 0, minerals: 0, energy: 0 }, statute: 'continue',
  });
  assert.equal(Math.round(n.stability), stab0 + 1, '守成应+1稳定');
  assert.equal(n.statutes.length, 2, '守成不新增典章');

  const stab1 = n.stability;
  const newPolicyText = '开凿新渠引水入城，垦荒千亩，减田租至二十分之一';
  applyResolvedTurn(game, {
    verdict: 'positive', narrative: '气象一新', brief: newPolicyText, domain: 'economy',
    populationChangePct: 2, stabilityChange: 0, appealChange: 3,
    resourceChanges: { food: 0, minerals: 0, energy: 0 }, statute: 'reform',
  });
  assert.equal(Math.round(n.stability), stab1 - 3, '变法应−3稳定');
  assert.equal(n.statutes.length, 3, '新策应录入典章');
  assert.equal(n.statutes[0].text, newPolicyText, '新典章置于最前');
  assert.equal(game.policies[1].statute, 'reform', '政策档案应记录变法');
});

test('存档函数在无 localStorage 环境（Node 测试）下安全降级', () => {
  // 不抛错即可；浏览器端才有真实 localStorage
  const game = newGame({ nationName: '存档邦', leaderName: '测', seed: 'save-seed' });
  assert.equal(typeof SAVE_KEY, 'string');
  assert.ok(game.map.cells.length > 0);
});
