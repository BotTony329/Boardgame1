import { TERRAINS, RULES } from './engine/constants.js';
import { stageLabel, canConscript } from './engine/nation.js';
import { attackableCells, maxConscript } from './engine/war.js';
import { mulberry32 } from './engine/rng.js';
import { civTierOf, armyTierOf, nextCivGap } from './engine/civ.js';
import { drawArt, ART_PATHS } from './engine/art.js';
import { getRelation, relationLabel, atWar, routeYield } from './engine/world.js';
import { DIPLO_COSTS, canAfford, playerNation } from './engine/game.js';
import { MAX_ACTIVE_POLICIES, policyEffectsText } from './engine/policies.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('zh-CN');

const MAP_ART = [
  ...Object.keys(TERRAINS).map((terrain) => ART_PATHS.tile(terrain)),
  ...Object.keys(TERRAINS).flatMap((terrain) => [1, 2, 3].map((variant) => `art/tiles/${terrain}${variant}.png`)),
  ...Array.from({ length: 5 }, (_, i) => ART_PATHS.city(i + 1, false)),
  ...Array.from({ length: 5 }, (_, i) => ART_PATHS.city(i + 1, true)),
  ...Array.from({ length: 4 }, (_, i) => ART_PATHS.unit(i + 1)),
];
let latestMapState = null;

// Canvas 不会在图片加载完后自行重绘。统一预载并只刷新地图，
// 可保证首屏素材出现，同时不让游戏引擎依赖 DOM 生命周期。
Promise.allSettled(MAP_ART.map((src) => new Promise((resolve) => {
  const image = new Image();
  image.onload = image.onerror = resolve;
  image.src = src;
}))).then(() => {
  if (latestMapState) renderMap(latestMapState.game, latestMapState.ui);
});

// 每回合整体重绘。数据量小（<800 格），全量重绘比增量更新更简单可靠。
export function render(game, ui) {
  renderHeader(game);
  renderNationCard(game);
  renderCurrentPolicy(game, ui);
  renderActivePolicies(game);
  renderMilitaryCard(game, ui);
  renderWorld(game, ui);
  renderLegend(game);
  renderMap(game, ui);
  updateCellInfo(game, ui.selectedIdx ?? ui.hoverIdx);
}

const DOMAIN_LABEL = { politics: '政治', economy: '经济', culture: '文化', military: '军事' };

// 现存典章：国家既有的制度。高亮为本回合预填的一道——
// 原样颁布是守成（稳定+1），改动是变法（稳定−3）。
export function renderCurrentPolicy(game, ui) {
  const el = $('currentPolicy');
  const statutes = game.nations[game.playerId].statutes || [];
  if (statutes.length === 0) {
    el.innerHTML = '<div class="current-policy none">国无典章。你颁布的国策将录为制度，传之来年。</div>';
    return;
  }
  const items = statutes.map((s) => `
    <div class="statute ${ui.currentDraft?.id === s.id ? 'on' : ''}">
      <span class="st-domain">${DOMAIN_LABEL[s.domain] || ''}</span>${s.text}
    </div>`).join('');
  el.innerHTML = `<div class="cp-title">现存典章 · 可作为施政底稿（续行现行施政 <b class="good">稳定+1</b> / 颁布新策 <b class="bad">稳定−3</b>）</div>${items}`;
}

// 施政中：持续生效的政策，效力逐回合衰减；可随时下诏罢行
export function renderActivePolicies(game) {
  const el = $('activePolicies');
  const list = game.activePolicies || [];
  if (list.length === 0) {
    el.innerHTML = '<div class="hint" style="margin-top:10px">国中暂无施行之政。颁布施政后将持续生效，直至效力耗尽或下诏罢行。</div>';
    return;
  }
  const rows = list.map((p) => `
    <div class="ap-row">
      <div class="ap-top">
        <span class="st-domain">${DOMAIN_LABEL[p.domain] || ''}</span>
        <span class="ap-text">${p.text}</span>
        <button class="ghost small" data-cancel="${p.id}">罢行</button>
      </div>
      <div class="hint">${policyEffectsText(p)} · 效力 ${Math.round(p.potency)}/100</div>
      <div class="potency"><i style="width:${Math.max(0, p.potency)}%"></i></div>
    </div>`).join('');
  el.innerHTML = `<div class="ap-head">施政中（${list.length}/${MAX_ACTIVE_POLICIES}）</div>${rows}`;
}

function renderHeader(game) {
  const n = game.nations[game.playerId];
  $('nationBadge').innerHTML =
    `<span class="nation-label">治下</span><b>${n.name}</b><span class="leader">${n.leader}</span><span class="stage">${stageLabel(n)}</span>`;
  const stat = (icon, label, value) => `<span class="stat"><img src="art/ui/${icon}.png" alt=""><span>${label}<b>${value}</b></span></span>`;
  $('resBar').innerHTML = `
    <span class="turn-stat"><span>纪年</span><b>${game.turn}</b></span>
    ${stat('pop', '人口', fmt(n.pop))}
    ${stat('army', '军队', fmt(n.soldiers))}
    ${stat('food', '粮食', fmt(n.food))}
    ${stat('minerals', '矿产', fmt(n.minerals))}
    ${stat('energy', '能源', fmt(n.energy))}
    ${stat('appeal', '吸引', Math.round(n.appeal))}
    ${stat('stability', '稳定', Math.round(n.stability))}`;
}

function renderNationCard(game) {
  const n = game.nations[game.playerId];
  let rows = '';
  // 阶段晋升进度：把「下一步怎么赢」始终摆在玩家眼前
  if (n.stage === 'tribe') {
    rows = `<div class="kv"><span class="k">晋身之路</span><span>聚拢 ${RULES.kingdomPop} 人口即可加冕为王</span></div>
      <div class="progress"><i style="width:${Math.min(100, n.pop / RULES.kingdomPop * 100)}%"></i></div>
      <div class="hint">当前 ${fmt(n.pop)} 人，还差 ${fmt(Math.max(0, RULES.kingdomPop - n.pop))} 人</div>`;
  } else if (n.stage === 'kingdom') {
    rows = `<div class="kv"><span class="k">改制共和</span><span>人口 ${fmt(n.pop)} / ${fmt(RULES.republicPop)} · 稳定 ${Math.round(n.stability)} / ${RULES.republicStability}</span></div>
      <div class="progress"><i style="width:${Math.min(100, n.pop / RULES.republicPop * 100)}%"></i></div>
      <div class="hint">人口与稳定双双达标，即可改制为共和国或主席国</div>`;
  } else {
    rows = `<div class="kv"><span class="k">一统之路</span><span>领地 ${n.cells.length} / ${RULES.victoryCells} 格</span></div>
      <div class="progress"><i style="width:${Math.min(100, n.cells.length / RULES.victoryCells * 100)}%"></i></div>
      <div class="hint">攻占 ${RULES.victoryCells} 格即可终结乱世，一统天下</div>`;
  }
  const civ = civTierOf(n);
  const army = armyTierOf(n);
  const gap = nextCivGap(n);
  const civRows = `
    <div class="kv civ-row"><span class="k"><img src="art/ui/crown.png" alt="">文明</span><span>${civ.level} 级 · ${civ.name}</span></div>
    <div class="hint">${civ.desc} · 兵制「${army.name}」：${army.desc}</div>
    ${gap ? `<div class="hint">迈向「${gap.tier.name}」还差：${gap.gaps.join('、')}</div>` : '<div class="hint">文明已臻此世之巅。</div>'}
  `;
  $('nationCard').innerHTML = `<h3>国势</h3>${rows}${civRows}`;
}

function renderMilitaryCard(game, ui) {
  const n = game.nations[game.playerId];
  const cap = maxConscript(n);
  const power = Math.round(n.soldiers * (n.stability / 60 + 0.4));
  const enemies = Object.values(game.nations).filter((o) => !o.isPlayer && n.enemies.includes(o.id));

  const lockHint = canConscript(n)
    ? `<span class="hint">每征一兵耗粮 2、矿产 0.5，并抽走 1 人口</span>`
    : `<span class="hint warn">🔒 人口达到 ${RULES.conscriptMinPop} 方可征兵（当前 ${fmt(n.pop)}）</span>`;

  const attackHint = n.soldiers > 0
    ? `<span class="hint">攻击力约 ${power}${n.energy < n.soldiers * 0.2 ? '（能源不足，战力打折）' : ''}。开启征伐模式后点击相邻敌格。</span>`
    : `<span class="hint warn">🔒 先征募军队方可对外征伐</span>`;

  $('militaryCard').innerHTML = `
    <h3>兵事</h3>
    <div class="row">
      <input type="number" id="conscriptCount" min="1" max="${cap}" value="${Math.max(1, Math.min(cap, 50))}" ${cap === 0 ? 'disabled' : ''}>
      <button id="btnConscript" class="small" ${cap === 0 ? 'disabled' : ''}>征募</button>
      <span class="hint">可征上限 ${cap}</span>
    </div>
    ${lockHint}
    <div class="row">
      <button id="btnAttackMode" class="small ${ui.attackMode ? 'danger' : 'ghost'}">${ui.attackMode ? '退出征伐模式' : '开启征伐模式'}</button>
    </div>
    ${attackHint}
    ${enemies.length ? `<div class="hint warn">交战中：${enemies.map((e) => e.name).join('、')}</div>` : ''}`;
}

const KIND_LABEL = {
  policy: '策', war: '战', famine: '灾', migration: '迁',
  milestone: '典', ai: '闻', military: '军', economy: '政',
  disaster: '灾', harvest: '瑞', diplo: '盟', trade: '商',
};

function logItemHtml(e) {
  // 国策条目要把玩家写的原文亮出来，否则回看时只剩史官转述
  const brief = e.kind === 'policy' && e.brief ? `<b>「${String(e.brief).slice(0, 100)}${e.brief.length > 100 ? '…' : ''}」</b>` : '';
  const tag = e.statute === 'continue' ? '<span class="tag continue">守成</span>'
    : e.statute === 'reform' ? '<span class="tag reform">变法</span>' : '';
  const star = e.major ? '<span class="major-star">◆</span>' : '';
  return `<div class="log-item kind-${e.kind}"><span class="t">${e.turn}年·${KIND_LABEL[e.kind] || '记'}</span>${star}${tag}${brief}${e.text}</div>`;
}

// 万国志：编年史 / 大事记 / 列国关系 / 贸易往来，四视图共用一个面板
export function renderWorld(game, ui) {
  const body = $('worldBody');
  document.querySelectorAll('#worldTabs .tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === ui.worldTab));
  if (ui.worldTab === 'events') {
    const majors = game.log.filter((e) => e.major).reverse();
    body.innerHTML = majors.length
      ? majors.map(logItemHtml).join('')
      : '<div class="empty-hint">天下尚无大事。天灾、邦交、战争等大事件会记录于此。</div>';
    return;
  }
  if (ui.worldTab === 'relations') {
    body.innerHTML = relationsViewHtml(game);
    return;
  }
  if (ui.worldTab === 'trade') {
    body.innerHTML = tradeViewHtml(game);
    return;
  }
  const entries = [...game.log].reverse().slice(0, 80);
  body.innerHTML = `<div id="logList">${entries.map(logItemHtml).join('')}</div>`;
}

function meterHtml(v) {
  const pct = Math.round(((v + 100) / 200) * 100);
  const band = v <= -40 ? 'hostile' : v < 15 ? 'cool' : v < 50 ? 'warm' : 'ally';
  return `<div class="meter"><i class="${band}" style="width:${pct}%"></i></div>`;
}

function relationsViewHtml(game) {
  const player = playerNation(game);
  const others = Object.values(game.nations).filter((n) => !n.isPlayer && !n.dead);
  const rows = others.map((o) => {
    const rel = getRelation(game, player.id, o.id);
    const war = atWar(game, player.id, o.id);
    const affordable = canAfford(player, DIPLO_COSTS.envoy);
    const affordableTrade = canAfford(player, DIPLO_COSTS.trade) && rel >= 15;
    return `<div class="rel-row">
      <i class="rel-dot" style="background:${o.color}"></i>
      <div class="rel-main">
        <div class="rel-name">${o.name}
          ${war ? '<span class="rel-state war">交战中</span>' : `<span class="rel-state">${relationLabel(rel)}</span>`}
          ${routeBetweenFlag(game, player.id, o.id)}
        </div>
        ${meterHtml(rel)}
      </div>
      <span class="rel-val">${rel > 0 ? '+' : ''}${rel}</span>
      <div class="rel-actions">
        <button class="ghost small" data-diplo="envoy" data-nation="${o.id}" ${war || !affordable ? 'disabled' : ''}>遣使<em>${DIPLO_COSTS.envoy.energy}能</em></button>
        <button class="ghost small" data-diplo="trade" data-nation="${o.id}" ${war || !affordableTrade ? 'disabled' : ''}>通商<em>${DIPLO_COSTS.trade.minerals}矿</em></button>
        <button class="ghost small" data-diplo="sever" data-nation="${o.id}">断交</button>
      </div>
    </div>`;
  }).join('');

  // 其余列国之间的关系速览
  const aiPairs = [];
  for (let i = 0; i < others.length; i++) {
    for (let j = i + 1; j < others.length; j++) {
      const rel = getRelation(game, others[i].id, others[j].id);
      aiPairs.push(`<div class="rel-pair">${others[i].name} × ${others[j].name}
        ${atWar(game, others[i].id, others[j].id) ? '<span class="rel-state war">交战</span>' : `<span class="rel-state">${relationLabel(rel)}</span>`}
        <em>${rel > 0 ? '+' : ''}${rel}</em></div>`);
    }
  }
  return `${rows}<div class="rel-subhead">列国之间</div>${aiPairs.join('')}`;
}

function routeBetweenFlag(game, a, b) {
  const route = (game.tradeRoutes || []).find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
  return route ? '<span class="rel-state trade">通商</span>' : '';
}

function tradeViewHtml(game) {
  const routes = game.tradeRoutes || [];
  if (routes.length === 0) {
    return '<div class="empty-hint">天下尚无商路。与关系「友善」以上的国家「通商」即可开辟；每回合双向互通粮矿能源。</div>';
  }
  const rows = routes.map((r) => {
    const a = game.nations[r.a], b = game.nations[r.b];
    if (!a || !b) return '';
    const y = routeYield(game, r);
    return `<div class="trade-row">
      <div class="trade-head"><i class="rel-dot" style="background:${a.color}"></i><b>${a.name}</b>
        <span class="trade-arrow">⇄</span>
        <i class="rel-dot" style="background:${b.color}"></i><b>${b.name}</b>
        <span class="hint">自第 ${r.since} 年</span></div>
      <div class="trade-flows hint">每回合双向：粮 <b class="good">+${y.food}</b> · 矿 <b class="good">+${y.minerals}</b> · 能 <b class="good">+${y.energy}</b></div>
    </div>`;
  }).join('');
  return `<div class="hint" style="margin-bottom:8px">商路因战争或邦交跌破中立而断绝。</div>${rows}`;
}

// 图例：一眼认出哪个国家是你的
export function renderLegend(game) {
  const el = $('mapLegend');
  const nations = Object.values(game.nations)
    .filter((n) => n.cells.length > 0)
    .map((n) => `<span class="legend-item ${n.isPlayer ? 'me' : ''}">
      <i style="background:${n.color}"></i>${n.name}${n.isPlayer ? '（你）' : ''}</span>`)
    .join('');
  el.innerHTML = `<span class="legend-item terrain-key"><i class="river-key"></i>河流</span>${nations}`;
}

// ---- 地图渲染 ----
const CS = 26; // 每格边长（CSS 像素）
const TERRAIN_HEIGHT = { ocean: 0, beach: 1, plain: 2, desert: 2.2, forest: 2.5, hills: 4, mountain: 6 };
const riverCache = new WeakMap();

function visualHash(seed, index, salt = 0) {
  const text = `${seed}:${index}:${salt}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nearestWaterPath(map, source, joinedRiver) {
  const { w, h, cells } = map;
  const dist = new Float64Array(cells.length).fill(Infinity);
  const previous = new Int32Array(cells.length).fill(-1);
  const pending = [{ index: source, cost: 0 }];
  dist[source] = 0;
  let goal = -1;

  while (pending.length) {
    pending.sort((a, b) => b.cost - a.cost);
    const current = pending.pop();
    if (current.cost !== dist[current.index]) continue;
    if (current.index !== source && (cells[current.index].t === 'ocean' || joinedRiver.has(current.index))) {
      goal = current.index;
      break;
    }
    const x = current.index % w;
    const y = Math.floor(current.index / w);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const next = ny * w + nx;
      const rise = Math.max(0, TERRAIN_HEIGHT[cells[next].t] - TERRAIN_HEIGHT[cells[current.index].t]);
      const step = dx && dy ? 1.42 : 1;
      const cost = current.cost + step + TERRAIN_HEIGHT[cells[next].t] * .18 + rise * 2.8;
      if (cost >= dist[next]) continue;
      dist[next] = cost;
      previous[next] = current.index;
      pending.push({ index: next, cost });
    }
  }

  if (goal < 0) return [];
  const path = [];
  for (let cursor = goal; cursor >= 0; cursor = previous[cursor]) {
    path.push(cursor);
    if (cursor === source) break;
  }
  return path.reverse();
}

// 河流是由现有地形派生的视觉层，不写入地图状态，也不参与任何规则结算。
function riversFor(game) {
  if (riverCache.has(game.map)) return riverCache.get(game.map);
  const { w, cells } = game.map;
  const candidates = cells
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell }) => cell.t === 'mountain' || cell.t === 'hills')
    .sort((a, b) => visualHash(game.seed, a.index, 17) - visualHash(game.seed, b.index, 17));
  const sourceLimit = Math.max(2, Math.min(5, Math.round(cells.filter((cell) => cell.t !== 'ocean').length / 90)));
  const sources = [];
  const joinedRiver = new Set();
  const paths = [];

  for (const { index } of candidates) {
    const x = index % w, y = Math.floor(index / w);
    if (sources.some((other) => Math.hypot(x - other % w, y - Math.floor(other / w)) < 6)) continue;
    const path = nearestWaterPath(game.map, index, joinedRiver);
    if (path.length < 4) continue;
    sources.push(index);
    paths.push(path);
    path.slice(0, -1).forEach((cellIndex) => joinedRiver.add(cellIndex));
    if (sources.length >= sourceLimit) break;
  }
  riverCache.set(game.map, paths);
  return paths;
}

function drawRivers(ctx, game) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const path of riversFor(game)) {
    const points = path.map((index, order) => {
      const jitter = visualHash(game.seed, index, 73 + order);
      const scale = order === 0 || order === path.length - 1 ? 3 : 12;
      return {
        x: (index % game.map.w) * CS + CS / 2 + (((jitter & 255) / 255) - .5) * scale,
        y: Math.floor(index / game.map.w) * CS + CS / 2 + ((((jitter >>> 8) & 255) / 255) - .5) * scale,
      };
    });
    const stroke = () => {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i++) {
        const midpoint = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
        ctx.quadraticCurveTo(points[i].x, points[i].y, midpoint.x, midpoint.y);
      }
      ctx.lineTo(points.at(-1).x, points.at(-1).y);
      ctx.stroke();
    };
    ctx.strokeStyle = 'rgba(18, 37, 43, .72)';
    ctx.lineWidth = 4.4;
    stroke();
    ctx.strokeStyle = '#4f91a4';
    ctx.lineWidth = 2.3;
    stroke();
    ctx.strokeStyle = 'rgba(184, 224, 222, .72)';
    ctx.lineWidth = .65;
    stroke();
  }
  ctx.restore();
}

function drawTerrainFeature(ctx, terrain, index, x, y, seed) {
  const random = mulberry32(visualHash(seed, index, 91));
  ctx.save();
  if (terrain === 'forest') {
    const count = 2 + Math.floor(random() * 2);
    for (let i = 0; i < count; i++) {
      const cx = x + 6 + random() * 14, cy = y + 7 + random() * 13, radius = 3 + random() * 2;
      ctx.fillStyle = 'rgba(15, 38, 25, .5)';
      ctx.beginPath(); ctx.arc(cx + 1, cy + 1.5, radius + .8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = i % 2 ? 'rgba(64, 104, 58, .88)' : 'rgba(48, 88, 52, .9)';
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(151, 174, 102, .38)';
      ctx.beginPath(); ctx.arc(cx - 1, cy - 1, radius * .42, 0, Math.PI * 2); ctx.fill();
    }
  } else if (terrain === 'mountain' && random() > .5) {
    const offset = random() * 5;
    ctx.fillStyle = 'rgba(41, 42, 41, .72)';
    ctx.beginPath(); ctx.moveTo(x + 3, y + 22); ctx.lineTo(x + 12 + offset, y + 3); ctx.lineTo(x + 24, y + 22); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(139, 137, 130, .92)';
    ctx.beginPath(); ctx.moveTo(x + 5, y + 21); ctx.lineTo(x + 12 + offset, y + 4); ctx.lineTo(x + 14 + offset, y + 21); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(225, 220, 201, .64)';
    ctx.beginPath(); ctx.moveTo(x + 10 + offset, y + 8); ctx.lineTo(x + 12 + offset, y + 4); ctx.lineTo(x + 15 + offset, y + 9); ctx.lineTo(x + 13 + offset, y + 8); ctx.closePath(); ctx.fill();
  } else if (terrain === 'hills' && random() > .78) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(55, 60, 43, .48)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x + 12, y + 18, 10, Math.PI * 1.08, Math.PI * 1.9); ctx.stroke();
    ctx.strokeStyle = 'rgba(202, 191, 128, .58)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x + 11, y + 16, 9, Math.PI * 1.1, Math.PI * 1.88); ctx.stroke();
  } else if (terrain === 'plain') {
    ctx.strokeStyle = 'rgba(45, 89, 48, .62)'; ctx.lineWidth = .8;
    for (let i = 0; i < 3; i++) {
      const gx = x + 5 + random() * 16, gy = y + 10 + random() * 11;
      ctx.beginPath(); ctx.moveTo(gx, gy + 4); ctx.lineTo(gx - 1.5, gy); ctx.moveTo(gx, gy + 4); ctx.lineTo(gx + 2, gy + 1); ctx.stroke();
    }
  } else if (terrain === 'desert') {
    ctx.strokeStyle = 'rgba(111, 79, 37, .35)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x + 5, y + 9, 14, .15, 1.75); ctx.stroke();
  } else if (terrain === 'ocean' && random() > .62) {
    ctx.strokeStyle = 'rgba(159, 197, 205, .18)'; ctx.lineWidth = .8;
    ctx.beginPath(); ctx.arc(x + 5, y + 11, 8, .2, 1.2); ctx.stroke();
  }
  ctx.restore();
}

function drawCoastlines(ctx, w, h, cells) {
  ctx.save();
  ctx.lineCap = 'round';
  for (let index = 0; index < cells.length; index++) {
    if (cells[index].t === 'ocean') continue;
    const x = (index % w) * CS, y = Math.floor(index / w) * CS;
    const segments = [];
    if (y > 0 && cells[index - w].t === 'ocean') segments.push([x, y, x + CS, y]);
    if (y < h - 1 && cells[index + w].t === 'ocean') segments.push([x, y + CS, x + CS, y + CS]);
    if (x > 0 && cells[index - 1].t === 'ocean') segments.push([x, y, x, y + CS]);
    if (x < (w - 1) * CS && cells[index + 1].t === 'ocean') segments.push([x + CS, y, x + CS, y + CS]);
    for (const [x1, y1, x2, y2] of segments) {
      ctx.strokeStyle = 'rgba(7, 21, 27, .7)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.strokeStyle = 'rgba(234, 222, 175, .7)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
  }
  ctx.restore();
}

export function renderMap(game, ui) {
  latestMapState = { game, ui };
  const cv = $('map');
  const { w, h, cells } = game.map;
  const dpr = window.devicePixelRatio || 1;
  cv.width = w * CS * dpr;
  cv.height = h * CS * dpr;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;

  const targets = ui.attackMode ? new Set(attackableCells(game, game.playerId)) : null;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const x = (i % w) * CS;
    const y = Math.floor(i / w) * CS;
    const tileVariant = cell.t === 'ocean' ? 1 : visualHash(game.seed, i, 5) % 3 + 1;
    if (!drawArt(ctx, `art/tiles/${cell.t}${tileVariant}.png`, x, y, CS, CS)
      && !drawArt(ctx, ART_PATHS.tile(cell.t), x, y, CS, CS)) {
      ctx.fillStyle = TERRAINS[cell.t].color;
      ctx.fillRect(x, y, CS, CS);
    }
    drawTerrainFeature(ctx, cell.t, i, x, y, game.seed);

    const nation = cell.owner ? game.nations[cell.owner] : null;
    if (nation) {
      // 玩家领土用更高饱和的色罩与更粗的国界，确保在地图上一眼可辨
      ctx.fillStyle = nation.color + (nation.isPlayer ? '66' : '42');
      ctx.fillRect(x, y, CS, CS);
    } else if (cell.wild >= 4) {
      // 散落部民以小型聚落簇呈现；控制尺寸，避免旧版大黑点抢过山川层级。
      const dot = mulberry32(i * 7919);
      const count = Math.min(3, Math.max(1, Math.round(cell.wild / 24)));
      for (let village = 0; village < count; village++) {
        const cx = x + CS / 2 + (dot() - .5) * 7;
        const cy = y + CS / 2 + (dot() - .5) * 7;
        const r = .75 + Math.min(.75, cell.wild / 90);
        ctx.fillStyle = 'rgba(38, 31, 21, .78)';
        ctx.beginPath(); ctx.arc(cx, cy, r + .6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(194, 160, 94, .78)';
        ctx.beginPath(); ctx.arc(cx, cy - .25, r, 0, Math.PI * 2); ctx.fill();
      }
    }

    if (targets?.has(i)) {
      ctx.strokeStyle = '#e0564a';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, CS - 4, CS - 4);
      ctx.setLineDash([]);
    }
  }

  drawRivers(ctx, game);
  drawCoastlines(ctx, w, h, cells);

  // 国界最后覆盖河流与地形，确保政治归属始终清楚。
  for (const nation of Object.values(game.nations)) {
    for (const index of nation.cells) {
      const x = (index % w) * CS;
      const y = Math.floor(index / w) * CS;
      ctx.strokeStyle = 'rgba(8, 12, 14, .78)';
      ctx.lineWidth = nation.isPlayer ? 5 : 4;
      drawBorders(ctx, index, w, h, cells, x, y, nation.id);
      ctx.strokeStyle = nation.color;
      ctx.lineWidth = nation.isPlayer ? 2.5 : 1.6;
      drawBorders(ctx, index, w, h, cells, x, y, nation.id);
    }
  }

  // 城郭与驻军：每块领土按文明等级画城市，都城另标驻军兵力
  for (const nation of Object.values(game.nations)) {
    if (nation.cells.length === 0) continue;
    const tier = nation.civTier || civTierOf(nation).level;
    const army = armyTierOf(nation);
    for (const idx of nation.cells) {
      drawCity(ctx, (idx % w) * CS, Math.floor(idx / w) * CS, {
        tier, capital: idx === nation.cells[0], color: nation.color, nationId: nation.id,
      });
    }
    const capIdx = nation.cells[0];
    drawGarrison(ctx, (capIdx % w) * CS, Math.floor(capIdx / w) * CS, {
      army: army.level, soldiers: nation.soldiers, color: nation.color,
    });
  }

  // 都城标记与国名统一收在政治识别层，避免旗帜、建筑和文字互相遮挡。
  for (const nation of Object.values(game.nations)) {
    if (nation.cells.length === 0) continue;
    const idx = nation.cells[0];
    const x = (idx % w) * CS + CS / 2;
    const y = Math.floor(idx / w) * CS + CS / 2;
    ctx.beginPath();
    ctx.arc(x, y, CS * .59, 0, Math.PI * 2);
    ctx.strokeStyle = nation.isPlayer ? '#ffe091' : 'rgba(236, 231, 210, .52)';
    ctx.lineWidth = nation.isPlayer ? 2 : 1;
    ctx.stroke();
    drawNationLabel(ctx, game, nation, idx);
  }

  if (ui.hoverIdx != null) {
    const x = (ui.hoverIdx % w) * CS;
    const y = Math.floor(ui.hoverIdx / w) * CS;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 1, y + 1, CS - 2, CS - 2);
  }
  if (ui.selectedIdx != null) {
    const x = (ui.selectedIdx % w) * CS;
    const y = Math.floor(ui.selectedIdx / w) * CS;
    ctx.strokeStyle = '#ffd97a';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, CS - 2, CS - 2);
  }
}

const fmtShort = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(Math.round(n / 100) / 10).toFixed(1)}k` : `${Math.round(n)}`);

// 城市绘制：优先用美术包（art/cities/…），缺失时退化为程序化屋舍剪影。
// 剪影随文明等级长高变密，都城更宏大；国旗角标始终用国家色标识归属。
function drawCity(ctx, x, y, { tier, capital, color, nationId }) {
  if (drawArt(ctx, ART_PATHS.city(tier, capital), x + 2, y + 2, CS - 4, CS - 4)) {
    drawPennant(ctx, x, y, color, capital, nationId);
    return;
  }
  const base = y + CS - 3;
  const hutW = 4;
  const huts = capital ? Math.min(5, tier + 1) : Math.min(3, tier);
  const totalW = huts * (hutW + 1) - 1;
  let hx = x + CS / 2 - totalW / 2;
  for (let i = 0; i < huts; i++) {
    const isKeep = capital && i === Math.floor(huts / 2);
    const bh = 3 + tier + (isKeep ? 3 : 0);
    ctx.fillStyle = isKeep ? '#55432e' : '#3d3227';
    ctx.fillRect(hx, base - bh, hutW, bh);
    ctx.fillStyle = isKeep ? '#7a6a4d' : '#63543d';
    ctx.fillRect(hx, base - bh - 1, hutW, 1); // 屋脊
    hx += hutW + 1;
  }
  drawPennant(ctx, x, y, color, capital, nationId);
}

function drawPennant(ctx, x, y, color, capital, nationId) {
  const poleX = x + (capital ? 4 : 3);
  const top = y + (capital ? 1 : 3);
  const width = capital ? 10 : 5;
  const height = capital ? 7 : 4;
  ctx.strokeStyle = 'rgba(29, 25, 20, .92)';
  ctx.lineWidth = capital ? 1.4 : 1;
  ctx.beginPath();
  ctx.moveTo(poleX, top);
  ctx.lineTo(poleX, top + height + (capital ? 7 : 3));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(poleX, top);
  ctx.lineTo(poleX + width, top + 1);
  ctx.lineTo(poleX + width - 2, top + height);
  ctx.lineTo(poleX, top + height - 1);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.42)';
  ctx.lineWidth = .6;
  ctx.stroke();
  if (!capital) return;
  const emblem = visualHash(nationId, 0, 29) % 3;
  ctx.fillStyle = 'rgba(255, 246, 205, .9)';
  if (emblem === 0) ctx.fillRect(poleX + 4, top + 2, 2, 3);
  else if (emblem === 1) {
    ctx.beginPath();
    ctx.arc(poleX + 5, top + 3.5, 1.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(poleX + 5, top + 1.5);
    ctx.lineTo(poleX + 7, top + 3.5);
    ctx.lineTo(poleX + 5, top + 5.5);
    ctx.lineTo(poleX + 3, top + 3.5);
    ctx.closePath();
    ctx.fill();
  }
}

function drawNationLabel(ctx, game, nation, capitalIndex) {
  const capX = (capitalIndex % game.map.w) * CS + CS / 2;
  const capY = Math.floor(capitalIndex / game.map.w) * CS + CS / 2;
  const name = `${nation.isPlayer ? '你 · ' : ''}${nation.name}`;
  ctx.save();
  ctx.font = `${nation.isPlayer ? '600' : '500'} 9px "PingFang SC", sans-serif`;
  const width = Math.ceil(ctx.measureText(name).width) + 13;
  const placeLeft = capX + width + 22 > game.map.w * CS;
  const x = placeLeft ? capX - width - 18 : capX + 17;
  const y = Math.max(3, capY - 15);
  ctx.fillStyle = 'rgba(7, 11, 13, .82)';
  ctx.beginPath();
  ctx.roundRect(x, y, width, 17, 3);
  ctx.fill();
  ctx.fillStyle = nation.color;
  ctx.fillRect(x, y, 3, 17);
  ctx.fillStyle = nation.isPlayer ? '#ffe4a0' : '#eee9db';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, x + 7, y + 8.5);
  ctx.restore();
}

// 都城驻军角标：优先美术包（art/units/…），缺失时画盾徽 + 兵力数字
function drawGarrison(ctx, x, y, { army, soldiers, color }) {
  if (soldiers <= 0) return;
  const ux = x + CS - 12, uy = y + 2;
  if (!drawArt(ctx, ART_PATHS.unit(army), ux, uy, 11, 11)) {
    ctx.fillStyle = '#6e7b8a';
    ctx.fillRect(ux + 2, uy, 7, 7);
    ctx.fillStyle = color;
    ctx.fillRect(ux + 4, uy + 2, 3, 3);
    ctx.beginPath();
    ctx.moveTo(ux + 2, uy + 7);
    ctx.lineTo(ux + 9, uy + 7);
    ctx.lineTo(ux + 5.5, uy + 11);
    ctx.closePath();
    ctx.fillStyle = '#56626f';
    ctx.fill();
  }
  ctx.font = 'bold 8px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  const label = fmtShort(soldiers);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(10,12,15,0.85)';
  ctx.strokeText(label, x + CS - 1, y + CS - 1.5);
  ctx.fillStyle = '#ffd97a';
  ctx.fillText(label, x + CS - 1, y + CS - 1.5);
}

function drawBorders(ctx, i, w, h, cells, x, y, owner) {
  // 地图边缘没有邻居，同样视为「异邦」，需要画出国界
  const segments = [];
  if (y === 0 || cells[i - w]?.owner !== owner) segments.push([x, y, x + CS, y]);
  if (y === h - 1 || cells[i + w]?.owner !== owner) segments.push([x, y + CS, x + CS, y + CS]);
  if (x === 0 || cells[i - 1]?.owner !== owner) segments.push([x, y, x, y + CS]);
  if (x === w - 1 || cells[i + 1]?.owner !== owner) segments.push([x + CS, y, x + CS, y + CS]);
  for (const [x1, y1, x2, y2] of segments) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}

export function updateCellInfo(game, idx) {
  const el = $('cellInfo');
  if (idx == null) { el.textContent = '点击格子查看详情'; return; }
  const cell = game.map.cells[idx];
  const pos = `(${idx % game.map.w}, ${Math.floor(idx / game.map.w)})`;
  const ownerText = cell.owner === null
    ? `无主之地 · 散落部民 ${Math.round(cell.wild)} 人`
    : `「${game.nations[cell.owner].name}」领地${cell.owner === game.playerId ? ' ★你的国家' : ''}`;
  el.textContent =
    `${pos} ${TERRAINS[cell.t].name} · 亩产 粮${cell.res.food} 矿${cell.res.minerals} 能${cell.res.energy} · ${ownerText}`;
}

// ---- 弹窗与提示 ----
export function showModal({ title, html, actions = [] }) {
  const root = $('modalRoot');
  const box = document.createElement('div');
  box.className = 'modal';
  box.innerHTML = `<h2>${title}</h2><div class="body">${html}</div><div class="actions"></div>`;
  const actRow = box.querySelector('.actions');
  const list = actions.length ? actions : [{ label: '知道了' }];
  for (const a of list) {
    const btn = document.createElement('button');
    btn.textContent = a.label;
    if (a.danger) btn.className = 'danger';
    if (a.ghost) btn.className = 'ghost';
    // 未显式给出 onClick 的按钮（如默认的「知道了」）职责就是关闭弹窗——
    // 此前默认按钮是死按钮，会卡死整个弹窗层
    btn.onclick = () => {
      const close = () => root.replaceChildren();
      if (a.onClick) a.onClick(close);
      else close();
    };
    actRow.appendChild(btn);
  }
  root.replaceChildren(box);
}

export function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('toastRoot').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

export function setBusy(busy) {
  const btn = $('btnPolicy');
  btn.disabled = busy;
  btn.textContent = busy ? '天命史官推演中…' : '颁布施政';
  const next = $('btnNextTurn');
  if (next) next.disabled = busy;
}
