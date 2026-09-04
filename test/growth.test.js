import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, playerNation } from '../public/js/engine/game.js';
import { resolveTurn, migrateScatteredPop } from '../public/js/engine/growth.js';
import { policyFromVerdict, applyActivePolicies, POTENCY_DECAY_PER_TURN } from '../public/js/engine/policies.js';
import { RULES } from '../public/js/engine/constants.js';

function makeGame() {
  return newGame({ nationName: '测试邦', leaderName: ' tester', seed: 'growth-seed' });
}

test('持续施政：效果逐回合兑现、效力衰减、耗尽自动载入典章', () => {
  const game = makeGame();
  const n = playerNation(game);
  n.pop = 1000; n.food = 500; n.minerals = 100; n.energy = 100;
  n.appeal = 20; n.stability = 50;
  n.statutes = [];

  const judged = {
    verdict: 'positive', narrative: '民大悦',
    perTurn: { pop: 3, appeal: 2, stability: 3, food: 24, minerals: 0, energy: 0 },
  };
  // 数值由千问直接定夺：引擎原样落账
  const policy = policyFromVerdict(judged, { turn: 1, domain: 'economy', text: '轻徭薄赋' });
  assert.equal(policy.perTurn.appeal, 2);
  assert.equal(policy.perTurn.stability, 3);
  assert.equal(policy.perTurn.pop, 3);
  assert.equal(policy.perTurn.food, 24);

  game.activePolicies = [policy];
  const appeal0 = n.appeal, food0 = n.food;
  applyActivePolicies(game, []);
  assert.ok(Math.abs(n.appeal - (appeal0 + 2)) < 0.01, '吸引力按回合兑现');
  assert.ok(n.food > food0, '粮食按回合兑现');
  assert.equal(policy.potency, 100 - POTENCY_DECAY_PER_TURN, '效力逐回合衰减');

  for (let i = 0; i < 10; i++) applyActivePolicies(game, []);
  assert.equal(game.activePolicies.length, 0, '效力耗尽后移出施政');
  assert.ok(n.statutes.some((s) => s.text === '轻徭薄赋'), '到期政策载入典章');
});

test('吸引力高的国家能吸引散落人口，吸引力低的国家无人问津', () => {
  const game = makeGame();
  const n = playerNation(game);
  const wildBefore = game.map.cells.reduce((s, c) => s + c.wild, 0);

  n.appeal = 60;
  migrateScatteredPop(game, []);
  const playerGain = n.pop - 100;
  assert.ok(playerGain > 0, `高吸引力应招来流民，实际 ${playerGain}`);

  // 重开一局：低吸引力(<15)时迁移不应发生
  const game2 = makeGame();
  const n2 = playerNation(game2);
  n2.appeal = 5;
  migrateScatteredPop(game2, []);
  assert.ok(Math.abs(n2.pop - 100) < 1e-9, '低吸引力不应有迁移');

  // 散落人口总量守恒（只减不增，本回合无再生）
  const wildAfter = game.map.cells.reduce((s, c) => s + c.wild, 0);
  assert.ok(wildAfter < wildBefore);
});

test('断粮触发饥荒：人口骤减、编年史记录灾情', () => {
  const game = makeGame();
  const n = playerNation(game);
  n.food = 0;
  n.pop = 2000; // 口粮消耗远超初始一格产量
  const before = n.pop;
  const report = resolveTurn(game);
  assert.ok(playerNation(game).pop < before * 0.95, '饥荒应减少人口');
  assert.ok(report.logs.some((e) => e.kind === 'famine'), '编年史应有饥荒记录');
});

test('人口达到 800 触发加冕事件（部落→王国）', () => {
  const game = makeGame();
  const n = playerNation(game);
  n.pop = 850;
  n.food = 5000; // 防止饥荒干扰
  const report = resolveTurn(game);
  assert.equal(n.stage, 'kingdom');
  assert.ok(report.events.some((e) => e.kind === 'coronation'), '应产生加冕事件');
});

test('人口 5000 且稳定 50 触发改制之议', () => {
  const game = makeGame();
  const n = playerNation(game);
  n.stage = 'kingdom';
  n.pop = 5200;
  n.stability = 60;
  n.food = 20000;
  const report = resolveTurn(game);
  assert.ok(game.pendingRepublic, '应置位改制待决');
  assert.ok(report.events.some((e) => e.kind === 'republic'));
});

test('人口跌破下限判负，phase 变为 gameover', () => {
  const game = makeGame();
  const n = playerNation(game);
  n.pop = 10;
  resolveTurn(game);
  assert.equal(game.phase, 'gameover');
});

test('回合正常推进：turn+1 且产出编年史与迁移报告', () => {
  const game = makeGame();
  const n = playerNation(game);
  n.appeal = 50;
  n.stability = 80;
  n.food = 1000;
  const report = resolveTurn(game);
  assert.equal(game.turn, 2);
  assert.ok(Array.isArray(report.logs));
  assert.ok(Number.isFinite(report.migrants));
});

test('AI 国家随回合成长并拓殖新格', () => {
  const game = makeGame();
  const ai = game.nations.ai1;
  playerNation(game).food = 999999; // 玩家不断粮，避免其亡国截断长程模拟
  const before = ai.pop;
  for (let i = 0; i < 60 && game.phase === 'playing'; i++) {
    resolveTurn(game);
  }
  assert.ok(ai.pop > before, `AI 国家人口应增长：${before} -> ${ai.pop}`);
  assert.ok(ai.cells.length > 1, '60 回合内 AI 应向外拓殖');
  assert.ok(Object.values(game.nations).every((x) => x.pop > 20), '任何国家都不应自然消亡');
});
