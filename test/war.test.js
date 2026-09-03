import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, playerNation, doFormArmy, doMoveArmy, doArmyAttack, doColonize, demandSubmission, doConscript } from '../public/js/engine/game.js';
import { maxConscript, conscript } from '../public/js/engine/war.js';
import { classifyArmyTarget, cellDefense, armyAt, armiesOf, armySoldiersTotal, buildFort, toggleDefend } from '../public/js/engine/armies.js';
import { adjustRelation, getRelation } from '../public/js/engine/world.js';
import { RULES } from '../public/js/engine/constants.js';

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
  assert.equal(maxConscript(n), 40);
  const { recruited } = conscript(n, 100);
  assert.equal(recruited, 40);
  assert.equal(n.soldiers, 40);
  assert.equal(n.pop, 1960);
  assert.equal(n.stability, 58);
});

test('组建军团：从后备拨兵、落于无驻军之格', () => {
  const game = makeGame();
  const n = playerNation(game);
  n.pop = 20000; n.food = 99999; n.minerals = 9999; n.stability = 80; n.energy = 9999;
  doConscript(game, 500);
  assert.equal(n.soldiers, 500);
  const r = doFormArmy(game, 300);
  assert.equal(r.ok, true);
  assert.equal(n.soldiers, 200, '后备兵员拨入军团');
  assert.equal(armySoldiersTotal(game, 'p1'), 300);
  assert.equal(r.army.cell, n.cells[0], '默认驻都城');
  assert.equal(armiesOf(game, 'p1').length, 1);
});

test('军团调防：己方领地内移动耗行军力', () => {
  const game = makeGame();
  const n = playerNation(game);
  const cap = n.cells[0];
  // 把都城的相邻陆格并入领土，作为调防目的地
  const { w, h } = game.map;
  const x = cap % w, y = Math.floor(cap / w);
  let target = null;
  for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const ni = ny * w + nx;
    if (game.map.cells[ni].t === 'ocean') continue;
    if (!n.cells.includes(ni)) { game.map.cells[ni].owner = 'p1'; n.cells.push(ni); }
    if (!armyAt(game, ni)) { target = ni; break; }
  }
  n.pop = 20000; n.food = 99999; n.minerals = 9999;
  doConscript(game, 200);
  doFormArmy(game, 100);
  const army = armiesOf(game, 'p1')[0];
  army.cell = cap;
  assert.ok(target != null, '都城旁应有可调防之格');
  const r = doMoveArmy(game, army.id, target);
  assert.equal(r.ok, true, '调防成功');
  assert.equal(army.cell, target);
  assert.equal(army.moveLeft, 0, '调防耗尽行军力');
});

test('军团攻占无主之地：拓疆镇压、格子易主、军团进驻', () => {
  const game = makeGame();
  const n = playerNation(game);
  const target = adjacentOwnedToNeutral(game, n);
  assert.ok(target != null, '应有相邻无主格');
  const wildBefore = game.map.cells[target].wild;

  n.pop = 20000; n.food = 99999; n.minerals = 9999; n.stability = 80; n.energy = 9999;
  doConscript(game, 900);
  doFormArmy(game, 800);
  const army = armiesOf(game, 'p1')[0];
  const report = doArmyAttack(game, army.id, target);
  assert.equal(report.ok, true);
  assert.equal(report.captured, true, '800 兵镇压散民必胜');
  assert.equal(game.map.cells[target].owner, 'p1');
  assert.ok(n.cells.includes(target));
  assert.equal(army.cell, target, '军团进驻新土');
  assert.ok(armiesOf(game, 'p1').includes(army), '胜军存留');
});

test('工事提升防御：坚守与工事叠加', () => {
  const game = makeGame();
  const n = playerNation(game);
  n.pop = 20000; n.food = 99999; n.minerals = 9999;
  doConscript(game, 150);
  const cap = n.cells[0];
  game.map.cells[cap].fort = 0;
  doFormArmy(game, 100);
  const army = armiesOf(game, 'p1')[0];
  army.cell = cap;

  const def0 = cellDefense(game, cap).strength;
  const r1 = buildFort(game, army);
  assert.equal(r1.ok, true);
  assert.equal(game.map.cells[cap].fort, 1);
  assert.equal(n.minerals, 9999 - 75 - 30, '矿产应扣除征兵（75）与工事（30）');
  const def1 = cellDefense(game, cap).strength;
  assert.ok(def1 > def0 * 1.4, `工事应大幅提升防御：${def0} -> ${def1}`);

  toggleDefend(game, army);
  const def2 = cellDefense(game, cap).strength;
  assert.ok(def2 > def1, '坚守应再提升防御');
});

test('劝降：国力两倍且邦交友善则不战而并其国', () => {
  const game = makeGame();
  const n = playerNation(game);
  const target = game.nations.ai1;
  // 塑造压倒性国力与盟好关系
  n.pop = 50000; n.soldiers = 5000; n.stability = 100; n.food = 99999; n.minerals = 9999; n.energy = 9999;
  target.pop = 120; target.soldiers = 0;
  adjustRelation(game, 'p1', 'ai1', 60);
  const cellsBefore = n.cells.length;
  const theirCells = target.cells.length;

  const r = demandSubmission(game, 'ai1');
  assert.equal(r.ok, true);
  assert.equal(r.surrendered, true, '强国劝降盟友应成功');
  assert.equal(target.dead, true);
  assert.equal(n.cells.length, cellsBefore + theirCells, '疆土并入');
  assert.equal(target.cells.length, 0);
  assert.ok(getRelation(game, 'p1', 'ai1') === 80, '归顺后关系转为臣服之谊');
});

test('劝降失败：国力或邦交不足则触怒对方、即刻开战', () => {
  const game = makeGame();
  const n = playerNation(game);
  const target = game.nations.ai1;
  n.pop = 150; n.soldiers = 0; n.stability = 60;
  adjustRelation(game, 'p1', 'ai1', 60);
  const r = demandSubmission(game, 'ai1');
  assert.equal(r.surrendered, false, '弱国劝降必被拒');
  assert.ok(n.enemies.includes('ai1'), '被拒后即刻开战');
  assert.ok(target.enemies.includes('p1'));
  assert.equal(getRelation(game, 'p1', 'ai1'), -40, '关系跌至敌视');
});

test('相邻无主格查找工具可用（供拓疆测试）', () => {
  const game = makeGame();
  const n = playerNation(game);
  assert.ok(adjacentOwnedToNeutral(game, n) != null);
});

function adjacentOwnedToNeutral(game, n) {
  const owned = new Set(n.cells);
  for (const idx of n.cells) {
    const x = idx % game.map.w, y = Math.floor(idx / game.map.w);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= game.map.w || ny >= game.map.h) continue;
      const ni = ny * game.map.w + nx;
      const cell = game.map.cells[ni];
      if (!owned.has(ni) && cell.t !== 'ocean' && cell.owner === null) return ni;
    }
  }
  return null;
}
