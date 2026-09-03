import { test } from 'node:test';
import assert from 'node:assert/strict';
import { civTierOf, armyTierOf, nextCivGap, stageRank } from '../public/js/engine/civ.js';
import { newGame, playerNation } from '../public/js/engine/game.js';
import { resolveTurn } from '../public/js/engine/growth.js';

function nation(over = {}) {
  return { stage: 'tribe', pop: 100, stability: 60, soldiers: 0, ...over };
}

test('文明等级门槛：人口、稳定、政体三重门槛全部满足才晋升', () => {
  assert.equal(civTierOf(nation()).level, 1, '开局是荒陬营地');
  // 2 级：pop 300 + stab 40
  assert.equal(civTierOf(nation({ pop: 299 })).level, 1);
  assert.equal(civTierOf(nation({ pop: 300, stability: 39 })).level, 1, '稳定不足卡等级');
  assert.equal(civTierOf(nation({ pop: 300, stability: 40 })).level, 2);
  // 3 级
  assert.equal(civTierOf(nation({ pop: 1200, stability: 50 })).level, 3);
  // 4 级需称王
  assert.equal(civTierOf(nation({ pop: 3000, stability: 55, stage: 'tribe' })).level, 3, '部落养不出王城');
  assert.equal(civTierOf(nation({ pop: 3000, stability: 55, stage: 'kingdom' })).level, 4);
  // 5 级需共和/主席国
  assert.equal(civTierOf(nation({ pop: 8000, stability: 60, stage: 'kingdom' })).level, 4);
  assert.equal(civTierOf(nation({ pop: 8000, stability: 60, stage: 'republic' })).level, 5);
});

test('文明会倒退：稳定崩坏或人口流失应降级（驱动城市图像破败）', () => {
  const prosperous = nation({ pop: 1200, stability: 55 });
  assert.equal(civTierOf(prosperous).level, 3);
  assert.equal(civTierOf({ ...prosperous, stability: 20 }).level, 1, '稳定崩坏跌回荒陬营地');
  assert.equal(civTierOf({ ...prosperous, pop: 500 }).level, 2, '人口流失降至村落');
});

test('兵制等级：军力门槛 + 政体约束', () => {
  assert.equal(armyTierOf(nation({ soldiers: 50 })).level, 1);
  assert.equal(armyTierOf(nation({ soldiers: 100 })).level, 2, '部落武士只需军力达标');
  assert.equal(armyTierOf(nation({ soldiers: 800, stage: 'tribe' })).level, 2, '部落养不出常备军团');
  assert.equal(armyTierOf(nation({ soldiers: 800, stage: 'kingdom' })).level, 3);
  assert.equal(armyTierOf(nation({ soldiers: 3000, stage: 'republic' })).level, 4);
});

test('晋升提示：指出下一级名称与具体差距；满级返回 null', () => {
  const n = nation({ pop: 100 });
  const gap = nextCivGap(n);
  assert.equal(gap.tier.name, '篝火村落');
  assert.ok(gap.gaps.some((g) => g.includes('人口')), '应提示人口差距');
  const maxed = nation({ pop: 8000, stability: 60, stage: 'republic' });
  assert.equal(nextCivGap(maxed), null);
});

test('回合结算联动：达标后 civTier 更新且编年史记录文明演进', () => {
  const game = newGame({ nationName: '文明邦', leaderName: '测', seed: 'civ-seed' });
  const n = playerNation(game);
  n.pop = 350;   // 满足 2 级：pop≥300 & stab≥40
  n.food = 99999;
  const report = resolveTurn(game);
  assert.equal(n.civTier, 2, '首回合应完成等级初始化并升至 2 级');
  assert.ok(report.logs.some((e) => e.kind === 'milestone' && e.text.includes('篝火村落')), '编年史应记录文明演进');
});
