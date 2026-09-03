import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../public/js/engine/mapgen.js';
import { TERRAINS } from '../public/js/engine/constants.js';
import { hashSeed } from '../public/js/engine/rng.js';

test('同一种子生成完全相同的世界', () => {
  const a = generateWorld(hashSeed('fixed-seed'));
  const b = generateWorld(hashSeed('fixed-seed'));
  assert.deepEqual(a.cells.map((c) => [c.t, c.wild]), b.cells.map((c) => [c.t, c.wild]));
});

test('不同种子生成不同世界', () => {
  const a = generateWorld(hashSeed('seed-a'));
  const b = generateWorld(hashSeed('seed-b'));
  assert.notDeepEqual(a.cells.map((c) => c.t), b.cells.map((c) => c.t));
});

test('陆地占比在可玩区间，且必有海洋与陆地', () => {
  for (const seed of ['s1', 's2', 's3', 's4', 's5']) {
    const world = generateWorld(hashSeed(seed));
    const land = world.cells.filter((c) => TERRAINS[c.t].land).length;
    assert.ok(world.landRatio >= 0.28 && world.landRatio <= 0.55, `seed=${seed} ratio=${world.landRatio}`);
    assert.ok(land > 100, '陆地格子足够四国开局');
    assert.ok(land < world.cells.length, '必须有海洋');
  }
});

test('所有格子的地形合法；陆地有散落人口与产量，海洋没有', () => {
  const world = generateWorld(hashSeed('shape'));
  for (const cell of world.cells) {
    assert.ok(TERRAINS[cell.t], `未知地形 ${cell.t}`);
    assert.equal(cell.owner, null);
    if (TERRAINS[cell.t].land) {
      assert.ok(cell.wild >= 4, '陆地散落人口下限');
      assert.ok(cell.res.food >= 0 && cell.res.minerals >= 0 && cell.res.energy >= 0);
    } else {
      assert.equal(cell.wild, 0);
    }
  }
});

test('大陆与岛屿并存：存在大块连通陆地与小块岛屿', () => {
  const world = generateWorld(hashSeed('continents'));
  const { w, h, cells } = world;
  const seen = new Array(cells.length).fill(false);
  const sizes = [];
  for (let i = 0; i < cells.length; i++) {
    if (seen[i] || !TERRAINS[cells[i].t].land) continue;
    // 泛洪统计连通陆地板块大小
    let size = 0;
    const stack = [i];
    seen[i] = true;
    while (stack.length) {
      const cur = stack.pop();
      size++;
      const x = cur % w, y = Math.floor(cur / w);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (!seen[ni] && TERRAINS[cells[ni].t].land) {
          seen[ni] = true;
          stack.push(ni);
        }
      }
    }
    sizes.push(size);
  }
  sizes.sort((a, b) => b - a);
  assert.ok(sizes[0] >= 40, `最大板块应成大陆规模，实际 ${sizes[0]}`);
  assert.ok(sizes.some((s) => s <= 25), '应存在小岛或半岛碎块');
});
