import { TERRAINS } from './constants.js';
import { mulberry32 } from './rng.js';

// ---- 平滑值噪声：无依赖的地形生成基元 ----
function makeNoise(rng, gw, gh) {
  const grid = Array.from({ length: gw * gh }, () => rng());
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    // 越界取模让噪声在边缘平缓收尾，避免地图四边出现生硬条纹
    const fx = Math.min(x / (gw - 1), gw - 0.001);
    const fy = Math.min(y / (gh - 1), gh - 0.001);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smooth(fx - x0);
    const ty = smooth(fy - y0);
    const v = (gx, gy) => grid[Math.min(gy, gh - 1) * gw + Math.min(gx, gw - 1)];
    const a = v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx;
    const b = v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx;
    return a * (1 - ty) + b * ty;
  };
}

function rawField(rng, w, h, cellsX, cellsY) {
  const n = makeNoise(rng, cellsX, cellsY);
  return (x, y) => n((x / (w - 1)) * (cellsX - 1), (y / (h - 1)) * (cellsY - 1));
}

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[lo + 1] * frac;
}

// 从所有陆地格出发的多源 BFS，返回每格到最近陆地的格距（海洋深度）
function bfsDistanceToLand(elev, seaLevel, w, h) {
  const dist = new Array(elev.length).fill(Infinity);
  const queue = [];
  for (let i = 0; i < elev.length; i++) {
    if (elev[i] >= seaLevel) { dist[i] = 0; queue.push(i); }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const x = cur % w, y = Math.floor(cur / w);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (dist[ni] === Infinity) { dist[ni] = dist[cur] + 1; queue.push(ni); }
    }
  }
  return dist;
}

function normalize(arr) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of arr) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  return arr.map((v) => (v - min) / span);
}

function tryGenerate(worldSeed, w, h) {
  const rng = mulberry32(worldSeed);
  const elevLow = rawField(rng, w, h, 7, 5);
  const elevMid = rawField(rng, w, h, 13, 9);
  const elevHigh = rawField(rng, w, h, 25, 17);
  const moist = rawField(rng, w, h, 9, 7);
  const resNoise = Array.from({ length: w * h }, () => 0.7 + rng() * 0.8);
  const wildNoise = Array.from({ length: w * h }, () => 0.6 + rng() * 0.8);

  // 随机岛链：往噪声场上叠加若干高斯鼓包，制造近海岛屿
  const islands = Array.from({ length: 3 + Math.floor(rng() * 3) }, () => ({
    cx: rng() * w,
    cy: rng() * h,
    r: 2.2 + rng() * 2.8,
    boost: 0.1 + rng() * 0.14,
  }));

  const rawElev = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let e = elevLow(x, y) * 0.6 + elevMid(x, y) * 0.28 + elevHigh(x, y) * 0.12;
      for (const isle of islands) {
        const d = Math.hypot(x - isle.cx, y - isle.cy);
        if (d < isle.r * 2.5) e += isle.boost * Math.exp(-(d * d) / (isle.r * isle.r));
      }
      rawElev.push(e);
    }
  }

  const elev = normalize(rawElev);
  const moistNorm = normalize(Array.from({ length: w * h }, (_, i) => moist(i % w, Math.floor(i / w))));

  // 用分位数定海平面：无论噪声分布如何，陆地占比稳定在约 38%
  const sorted = [...elev].sort((a, b) => a - b);
  const seaLevel = quantile(sorted, 0.62);
  const beachLine = seaLevel + 0.045;

  // 保底岛屿：海平面确定后，在远离陆地的深海强设 2~4 个小岛。
  // 噪声岛链常常黏进大陆，不能兑现「有大陆有岛屿」的地貌承诺，故在此兜底。
  const distToLand = bfsDistanceToLand(elev, seaLevel, w, h);
  const reserved = new Set();
  const islandCount = 2 + Math.floor(rng() * 3);
  for (let k = 0; k < islandCount; k++) {
    const candidates = [];
    for (let i = 0; i < elev.length; i++) {
      if (elev[i] >= seaLevel || distToLand[i] < 3 || reserved.has(i)) continue;
      candidates.push(i);
    }
    if (candidates.length === 0) break;
    const center = candidates[Math.floor(rng() * candidates.length)];
    const r = 1.2 + rng() * 0.8;
    const cx = center % w, cy = Math.floor(center / w);
    for (let y = Math.max(0, cy - 3); y <= Math.min(h - 1, cy + 3); y++) {
      for (let x = Math.max(0, cx - 3); x <= Math.min(w - 1, cx + 3); x++) {
        const i = y * w + x;
        const d = Math.hypot(x - cx, y - cy);
        if (d > r * 1.8) continue;
        // 抬升量以海平面为基准：中心高出海面、边缘没入海中，天然带海滩环
        elev[i] = Math.max(elev[i], seaLevel - 0.03 + 0.14 * Math.exp(-(d * d) / (r * r)));
        reserved.add(i);
      }
    }
  }

  const cells = elev.map((e, i) => {
    const x = i % w;
    const y = Math.floor(i / w);
    let terrain;
    if (e < seaLevel) terrain = 'ocean';
    else if (e < beachLine) terrain = 'beach';
    else if (e > 0.82) terrain = 'mountain';
    else if (e > 0.7) terrain = 'hills';
    else if (moistNorm[i] < 0.34) terrain = 'desert';
    else if (moistNorm[i] > 0.6) terrain = 'forest';
    else terrain = 'plain';

    if (!TERRAINS[terrain].land) {
      return { t: terrain, res: { food: 0, minerals: 0, energy: 0 }, wild: 0, wildBase: 0, owner: null, fort: 0 };
    }
    const base = TERRAINS[terrain].base;
    const res = {
      food: +(base.food * resNoise[i]).toFixed(1),
      minerals: +(base.minerals * resNoise[i]).toFixed(1),
      energy: +(base.energy * resNoise[i]).toFixed(1),
    };
    // 散落人口：水草丰美处聚落大，山地荒漠人烟稀少——这就是可被政策吸引的“散落大陆的人口”
    const wildBase = Math.max(4, Math.round((8 + res.food * 7 + res.energy * 2.5) * wildNoise[i]));
    return { t: terrain, res, wild: wildBase, wildBase, owner: null, fort: 0 };
  });

  return { w, h, cells, landRatio: cells.filter((c) => TERRAINS[c.t].land).length / cells.length };
}

// 生成失败（极端地形）就换偏移重试，最多 12 次；兜底接受最后一次结果。
export function generateWorld(seed, w = 36, h = 22) {
  let last;
  for (let attempt = 0; attempt < 12; attempt++) {
    last = tryGenerate((seed + attempt * 7919) >>> 0, w, h);
    if (last.landRatio >= 0.28 && last.landRatio <= 0.55) return last;
  }
  return last;
}
