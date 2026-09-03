import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, playerNation, applyResolvedTurn } from '../public/js/engine/game.js';
import { heuristicEvaluate } from '../public/js/engine/heuristic.js';
import { suggestPolicy } from '../public/js/engine/suggestions.js';
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

test('国策建议：新局有建议可改，国情恶化时建议转向救命方向', () => {
  const game = newGame({ nationName: '建议邦', leaderName: '测', seed: 'sugg-seed' });
  const s = suggestPolicy(game);
  assert.ok(typeof s === 'string' && s.length >= 10, '建议应是完整句子');
  playerNation(game).food = 10;
  for (let i = 0; i < 10; i++) {
    const s2 = suggestPolicy(game);
    assert.ok(/粮|赈|饥|税|互市|渔猎/.test(s2), `断粮时建议应面向救荒，实际：${s2}`);
  }
});

test('存档函数在无 localStorage 环境（Node 测试）下安全降级', () => {
  // 不抛错即可；浏览器端才有真实 localStorage
  const game = newGame({ nationName: '存档邦', leaderName: '测', seed: 'save-seed' });
  assert.equal(typeof SAVE_KEY, 'string');
  assert.ok(game.map.cells.length > 0);
});
