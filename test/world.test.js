import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, playerNation, applyResolvedTurn } from '../public/js/engine/game.js';
import {
  getRelation, adjustRelation, relationLabel, atWar,
  establishRoute, breakRoute, routeBetween, routeYield, resolveTrade,
  rollWorldEvents, aiDiplomacy, sweepHostilities,
} from '../public/js/engine/world.js';
import { mulberry32 } from '../public/js/engine/rng.js';

function makeGame() {
  const game = newGame({ nationName: '万国邦', leaderName: '测', seed: 'world-seed' });
  game.nations.p1.food = 99999;
  return game;
}

test('邦交关系：钳制 ±100，标签分档', () => {
  const game = makeGame();
  assert.equal(getRelation(game, 'p1', 'ai0'), 0, '默认中立');
  adjustRelation(game, 'p1', 'ai0', 30);
  assert.equal(getRelation(game, 'p1', 'ai0'), 30, '键序无关');
  assert.equal(getRelation(game, 'ai0', 'p1'), 30);
  adjustRelation(game, 'p1', 'ai0', 200);
  assert.equal(getRelation(game, 'p1', 'ai0'), 100, '上限 100');
  adjustRelation(game, 'p1', 'ai0', -500);
  assert.equal(getRelation(game, 'p1', 'ai0'), -100, '下限 -100');
  assert.equal(relationLabel(-50), '敌视');
  assert.equal(relationLabel(-20), '冷淡');
  assert.equal(relationLabel(0), '中立');
  assert.equal(relationLabel(30), '友善');
  assert.equal(relationLabel(70), '盟好');
});

test('商路：缔结、收益双向、断绝', () => {
  const game = makeGame();
  assert.equal(establishRoute(game, 'p1', 'ai0', 3), true);
  assert.equal(establishRoute(game, 'ai0', 'p1', 4), false, '重复缔结被拒');
  const y = routeYield(game, routeBetween(game, 'p1', 'ai0'));
  assert.ok(y.food > 0 && y.minerals > 0 && y.energy > 0);
  const food0 = game.nations.p1.food;
  const foodAi = game.nations.ai0.food;
  const logs = [];
  resolveTrade(game, logs);
  assert.ok(game.nations.p1.food > food0 && game.nations.ai0.food > foodAi, '双方均获收益');

  // 战争断路
  game.nations.p1.enemies.push('ai0');
  resolveTrade(game, []);
  assert.equal(routeBetween(game, 'p1', 'ai0'), undefined, '交战应断商路');
});

test('大事件：天灾按种子发生并实际削减国家资源，计入大事记', () => {
  const game = makeGame();
  const n = playerNation(game);
  n.food = 1000;
  // 搜一段必然触发事件的 rng 种子
  let seed = 1, logs;
  for (; seed < 5000; seed++) {
    logs = [];
    n.food = 1000;
    rollWorldEvents(game, logs, mulberry32(seed));
    if (logs.length === 1) break;
  }
  assert.ok(logs.length === 1, '应命中一次大事件');
  assert.equal(logs[0].major, true, '大事件须入大事记');
  assert.ok(n.food !== 1000, '事件应实际改变资源');
});

test('AI 外交：交战双方可求和停战', () => {
  const game = makeGame();
  game.nations.p1.enemies.push('ai0');
  game.nations.ai0.enemies.push('p1');
  adjustRelation(game, 'p1', 'ai0', -40);
  // 脚本化 rng：0.1 过事件门 → 选 ai0 为发起国 → 选 p1 为对象 → 0.1<0.3 触发求和
  let call = 0;
  const scripted = [0.1, 0.3, 0.05, 0.1];
  aiDiplomacy(game, [], () => scripted[call++] ?? 0.5);
  assert.equal(atWar(game, 'p1', 'ai0'), false, '求和后应脱离战争');
  assert.ok(getRelation(game, 'p1', 'ai0') > -40, '和谈改善关系');
});

test('战争清扫：交国关系钉在 −40、商路断绝并记入大事记', () => {
  const game = makeGame();
  establishRoute(game, 'p1', 'ai1', 1);
  game.nations.p1.enemies.push('ai1');
  game.nations.ai1.enemies.push('p1');
  adjustRelation(game, 'p1', 'ai1', 50);
  const logs = [];
  sweepHostilities(game, logs);
  assert.equal(getRelation(game, 'p1', 'ai1'), -40);
  assert.equal(routeBetween(game, 'p1', 'ai1'), undefined);
  assert.ok(logs.some((e) => e.major), '开战应有大事记');
});

test('回合结算完整管线：多回合运转不崩，事件层正常推进', () => {
  const game = makeGame();
  for (let i = 0; i < 25 && game.phase === 'playing'; i++) {
    applyResolvedTurn(game, {
      verdict: 'neutral', narrative: '如常', brief: '清丈田亩、登记丁口', domain: 'politics',
      populationChangePct: 0, stabilityChange: 0, appealChange: 0,
      resourceChanges: { food: 0, minerals: 0, energy: 0 },
    });
  }
  assert.ok(Array.isArray(game.tradeRoutes));
  assert.ok(typeof game.relations === 'object');
});
