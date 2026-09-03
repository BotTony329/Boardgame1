import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, playerNation } from '../public/js/engine/game.js';
import { applyPolicyEffects, resolveTurn, migrateScatteredPop } from '../public/js/engine/growth.js';
import { RULES } from '../public/js/engine/constants.js';

function makeGame() {
  return newGame({ nationName: '测试邦', leaderName: ' tester', seed: 'growth-seed' });
}

test('政策效果正确落到国家状态', () => {
  const game = makeGame();
  const n = playerNation(game);
  n.food = 100; n.minerals = 100; n.energy = 100;
  const deltas = applyPolicyEffects(n, {
    populationChangePct: 5, stabilityChange: 10, appealChange: 8,
    resourceChanges: { food: -10, minerals: 0, energy: 20 },
  });
  assert.ok(Math.abs(n.pop - 105) < 0.01);
  assert.equal(n.stability, 70);
  assert.equal(n.appeal, 20);
  assert.equal(n.food, 90);
  assert.equal(n.energy, 120);
  assert.ok(deltas.pop > 0);
});

test('吸引力高的国家能吸引散落人口，吸引力低的国家无人问津', () => {
  const game = makeGame();
  const n = playerNation(game);
  const wildBefore = game.map.cells.reduce((s, c) => s + c.wild, 0);

  n.appeal = 60;
  const logs1 = [];
  migrateScatteredPop(game, logs1);
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
  const report = resolveTurn(game, null);
  assert.ok(playerNation(game).pop < before * 0.95, '饥荒应减少人口');
  assert.ok(report.logs.some((e) => e.kind === 'famine'), '编年史应有饥荒记录');
});

test('人口达到 800 触发加冕事件（部落→王国）', () => {
  const game = makeGame();
  const n = playerNation(game);
  n.pop = 850;
  n.food = 5000; // 防止饥荒干扰
  const report = resolveTurn(game, null);
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
  const report = resolveTurn(game, null);
  assert.ok(game.pendingRepublic, '应置位改制待决');
  assert.ok(report.events.some((e) => e.kind === 'republic'));
});

test('人口跌破下限判负，phase 变为 gameover', () => {
  const game = makeGame();
  const n = playerNation(game);
  n.pop = 10;
  resolveTurn(game, null);
  assert.equal(game.phase, 'gameover');
});

test('回合正常推进：turn+1 且产出编年史与迁移报告', () => {
  const game = makeGame();
  const n = playerNation(game);
  n.appeal = 50;
  n.stability = 80;
  n.food = 1000;
  const report = resolveTurn(game, null);
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
    resolveTurn(game, null);
  }
  assert.ok(ai.pop > before, `AI 国家人口应增长：${before} -> ${ai.pop}`);
  assert.ok(ai.cells.length > 1, '60 回合内 AI 应向外拓殖');
  assert.ok(Object.values(game.nations).every((x) => x.pop > 20), '任何国家都不应自然消亡');
});
