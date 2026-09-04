import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, playerNation, enactPolicy, cancelPolicy } from '../public/js/engine/game.js';
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

test('颁布施政：变法入列扣稳定并录档案，守成回满效力+1稳定', () => {
  const game = newGame({ nationName: '档案邦', leaderName: '测', seed: 'archive-seed' });
  playerNation(game).food = 99999; // 防饥荒干扰
  const judged = {
    verdict: 'positive', narrative: '万民称便', populationChangePct: 2,
    stabilityChange: 3, appealChange: 4,
    resourceChanges: { food: 0, minerals: 0, energy: 0 },
  };

  // 新政 = 变法：−3 稳定、进入施政列表、录入典章与档案
  const turnBefore = game.turn;
  let r = enactPolicy(game, judged, { text: '轻徭薄赋，与民休息', domain: 'economy', continuation: false });
  assert.equal(r.ok, true);
  assert.equal(r.statuteEffect, 'reform');
  assert.equal(game.activePolicies.length, 1, '施政应入列');
  assert.equal(Math.round(playerNation(game).stability), 57, '变法 −3 稳定');
  const p = game.policies[0];
  assert.equal(p.turn, turnBefore, '档案回合号应为颁布时的回合');
  assert.equal(p.text, '轻徭薄赋，与民休息');
  assert.equal(p.verdict, 'positive');

  // 守成 = 同文重申：效力回满、稳定 +1、不新增施政
  game.activePolicies[0].potency = 40;
  r = enactPolicy(game, judged, { text: '轻徭薄赋，与民休息', domain: 'economy', continuation: true });
  assert.equal(r.ok, true);
  assert.equal(r.statuteEffect, 'continue');
  assert.equal(game.activePolicies.length, 1, '守成不新增施政');
  assert.equal(game.activePolicies[0].potency, 100, '守成回满效力');
  assert.equal(Math.round(playerNation(game).stability), 58, '守成 +1 稳定');
  assert.equal(game.policies.length, 2, '档案每次颁布都记录');

  // 旧存档（无 policies/activePolicies 字段）不应崩
  const legacy = newGame({ nationName: '旧档邦', leaderName: '测', seed: 'legacy-seed' });
  delete legacy.policies;
  delete legacy.activePolicies;
  r = enactPolicy(legacy, { ...judged, verdict: 'neutral' }, { text: '维持现状', domain: 'politics', continuation: false });
  assert.equal(r.ok, true);
  assert.equal(legacy.policies.length, 1);
  assert.equal(legacy.activePolicies.length, 1);
});

test('施政不设硬上限：多道并行皆可颁布，罢行即刻生效', () => {
  const game = newGame({ nationName: '上限邦', leaderName: '测', seed: 'cap-seed' });
  const n = playerNation(game);
  n.food = 99999;
  const judged = {
    verdict: 'neutral', narrative: '如常', populationChangePct: 0, stabilityChange: 0,
    appealChange: 0, resourceChanges: { food: 0, minerals: 0, energy: 0 },
  };
  for (let i = 0; i < 8; i++) {
    const r = enactPolicy(game, judged, { text: `施政之策第${i}道：劝农桑、修水利、通商路`, domain: 'economy', continuation: false });
    assert.equal(r.ok, true, `第 ${i + 1} 道应可颁布（不设硬上限）`);
    n.stability = 60; // 重置，隔离变法成本对后续断言的干扰
  }
  assert.equal(game.activePolicies.length, 8, '八道施政并行');

  const cancel = cancelPolicy(game, game.activePolicies[0].id);
  assert.equal(cancel.ok, true);
  assert.equal(game.activePolicies.length, 7, '罢行即刻移出施政');
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

test('守成与变法：新政录入典章置前，续行不增典章', () => {
  const game = newGame({ nationName: '变法邦', leaderName: '测', seed: 'reform-seed' });
  const n = playerNation(game);
  n.food = 99999;
  const statutesBefore = n.statutes.length;

  const newPolicyText = '开凿新渠引水入城，垦荒千亩，减田租至二十分之一';
  const r = enactPolicy(game, {
    verdict: 'positive', narrative: '气象一新', populationChangePct: 2, stabilityChange: 0,
    appealChange: 3, resourceChanges: { food: 0, minerals: 0, energy: 0 },
  }, { text: newPolicyText, domain: 'economy', continuation: false });
  assert.equal(r.statuteEffect, 'reform');
  assert.equal(n.statutes.length, statutesBefore + 1, '新策应录入典章');
  assert.equal(n.statutes[0].text, newPolicyText, '新典章置于最前');

  // 同文再颁 = 守成续行，典章不重复录入
  const r2 = enactPolicy(game, {
    verdict: 'neutral', narrative: '一如常年', populationChangePct: 0, stabilityChange: 0,
    appealChange: 0, resourceChanges: { food: 0, minerals: 0, energy: 0 },
  }, { text: newPolicyText, domain: 'economy', continuation: true });
  assert.equal(r2.statuteEffect, 'continue');
  assert.equal(n.statutes.length, statutesBefore + 1, '守成不新增典章');
  assert.equal(game.policies[1].statute, 'continue', '政策档案应记录守成');
});

test('存档函数在无 localStorage 环境（Node 测试）下安全降级', () => {
  // 不抛错即可；浏览器端才有真实 localStorage
  const game = newGame({ nationName: '存档邦', leaderName: '测', seed: 'save-seed' });
  assert.equal(typeof SAVE_KEY, 'string');
  assert.ok(game.map.cells.length > 0);
});
