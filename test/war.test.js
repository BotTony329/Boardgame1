import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, playerNation, doAttack } from '../public/js/engine/game.js';
import { maxConscript, conscript, attackableCells, neighbors } from '../public/js/engine/war.js';

function makeGame() {
  return newGame({ nationName: '兵试邦', leaderName: '武测试', seed: 'war-seed' });
}

test('人口不足 600 时禁止征兵（需求门槛）', () => {
  const n = { pop: 599, food: 9999, minerals: 9999, soldiers: 0, stability: 60 };
  assert.equal(maxConscript(n), 0);
  assert.deepEqual(conscript(n, 10), { recruited: 0 });
  assert.equal(n.soldiers, 0);
});

test('征兵受人口、粮食、矿产三重上限约束，并正确扣减', () => {
  const n = { pop: 2000, food: 300, minerals: 20, soldiers: 0, stability: 60 };
  // 人口上限 (2000-200)*0.1=180，粮食 300/2=150，矿产 20/0.5=40 → 40
  assert.equal(maxConscript(n), 40);
  const { recruited } = conscript(n, 100);
  assert.equal(recruited, 40);
  assert.equal(n.soldiers, 40);
  assert.equal(n.pop, 1960);
  assert.equal(n.food, 220);
  assert.ok(n.minerals < 1);
  assert.equal(n.stability, 58);
});

test('attackableCells 只含与本国相邻的他人陆地格', () => {
  const game = makeGame();
  const player = playerNation(game);
  const start = player.cells[0];
  const targets = attackableCells(game, 'p1');
  assert.ok(targets.length > 0, '初始都城四周必有可攻目标');
  for (const t of targets) {
    assert.ok(neighbors(game, start).includes(t), '必须是相邻格');
    assert.notEqual(game.map.cells[t].t, 'ocean', '不能是海洋');
  }
  // 别国领地不在本国目标中重复计算归属
  for (const t of targets) assert.notEqual(game.map.cells[t].owner, 'p1');
});

test('强军可攻占无主之地：格子易主、人口收编、军力折损', () => {
  const game = makeGame();
  const player = playerNation(game);
  const target = attackableCells(game, 'p1')
    .filter((i) => game.map.cells[i].owner === null)
    .sort((a, b) => game.map.cells[a].wild - game.map.cells[b].wild)[0];
  assert.ok(target != null, '应存在无主邻格');

  player.soldiers = 5000;
  player.stability = 80;
  player.energy = 9999;
  player.pop = 20000;
  const before = player.cells.length;
  // doAttack 内部走 game.turn 种子，结果确定
  const report = doAttack(game, target);
  assert.ok(report, '应返回战报');
  assert.equal(report.captured, true, '5000 兵打无主散民必胜');
  assert.equal(player.cells.length, before + 1);
  assert.equal(game.map.cells[target].owner, 'p1');
  assert.ok(player.soldiers < 5000, '应有战损');
  assert.ok(player.enemies.length === 0, '攻打无主之地不开启战争状态');
});

test('攻打他国会开启战争状态，守方记仇', () => {
  const game = makeGame();
  const player = playerNation(game);
  const enemyCell = attackableCells(game, 'p1').find((i) => game.map.cells[i].owner === 'ai0');
  if (enemyCell == null) return; // 种子地图上 ai0 不与玩家相邻时跳过
  player.soldiers = 20000;
  player.stability = 80;
  player.energy = 99999;
  player.pop = 50000;
  const report = doAttack(game, enemyCell);
  assert.ok(report.captured, '碾压兵力应攻占');
  assert.ok(player.enemies.includes('ai0'), '玩家应记敌');
  assert.ok(game.nations.ai0.enemies.includes('p1'), 'AI 应记仇，此后会反攻');
});

test('弱旅进攻必败且损失惨重', () => {
  const game = makeGame();
  const player = playerNation(game);
  const target = attackableCells(game, 'p1')[0];
  const wildBefore = game.map.cells[target].wild;
  player.soldiers = 2;
  player.stability = 50;
  player.energy = 9999;
  const report = doAttack(game, target);
  assert.equal(report.captured, false);
  assert.equal(game.map.cells[target].owner, null);
  assert.ok(player.soldiers <= 2, '败军所剩无几');
  assert.ok(game.map.cells[target].wild <= wildBefore + 1, '无主之地人口不应凭空增多');
});
