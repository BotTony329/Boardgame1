import { TERRAINS, RULES } from './engine/constants.js';
import { stageLabel, canConscript } from './engine/nation.js';
import { attackableCells, maxConscript } from './engine/war.js';
import { mulberry32 } from './engine/rng.js';
import { civTierOf, armyTierOf, nextCivGap } from './engine/civ.js';
import { drawArt, ART_PATHS } from './engine/art.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('zh-CN');

// 每回合整体重绘。数据量小（<800 格），全量重绘比增量更新更简单可靠。
export function render(game, ui) {
  renderHeader(game);
  renderNationCard(game);
  renderCurrentPolicy(game);
  renderMilitaryCard(game, ui);
  renderLog(game);
  renderLegend(game);
  renderMap(game, ui);
  updateCellInfo(game, ui.selectedIdx ?? ui.hoverIdx);
}

function renderHeader(game) {
  const n = game.nations[game.playerId];
  $('nationBadge').innerHTML =
    `<b>${n.name}</b> · ${n.leader}<span class="stage">${stageLabel(n)}</span>`;
  $('resBar').innerHTML = `
    <span class="stat">回合 <b>${game.turn}</b></span>
    <span class="stat">👥 人口 <b>${fmt(n.pop)}</b></span>
    <span class="stat">⚔ 军队 <b>${fmt(n.soldiers)}</b></span>
    <span class="stat">🌾 粮 <b>${fmt(n.food)}</b></span>
    <span class="stat">⛏ 矿 <b>${fmt(n.minerals)}</b></span>
    <span class="stat">⚡ 能 <b>${fmt(n.energy)}</b></span>
    <span class="stat">✨ 吸引 <b>${Math.round(n.appeal)}</b></span>
    <span class="stat">⚖ 稳定 <b>${Math.round(n.stability)}</b></span>`;
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
    <div class="kv"><span class="k">🏛 文明</span><span>${civ.level} 级 · ${civ.name}</span></div>
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
};

export function renderLog(game) {
  const list = $('logList');
  const entries = [...game.log].reverse().slice(0, 80);
  list.innerHTML = entries.map((e) => {
    // 国策条目要把玩家写的原文亮出来，否则回看时只剩史官转述
    const brief = e.kind === 'policy' && e.brief ? `<b>「${String(e.brief).slice(0, 100)}${e.brief.length > 100 ? '…' : ''}」</b>` : '';
    return `<div class="log-item kind-${e.kind}"><span class="t">${e.turn}年·${KIND_LABEL[e.kind] || '记'}</span>${brief}${e.text}</div>`;
  }).join('');
}

// 图例：一眼认出哪个国家是你的
export function renderLegend(game) {
  const el = $('mapLegend');
  el.innerHTML = Object.values(game.nations)
    .filter((n) => n.cells.length > 0)
    .map((n) => `<span class="legend-item ${n.isPlayer ? 'me' : ''}">
      <i style="background:${n.color}"></i>${n.name}${n.isPlayer ? '（你）' : ''}</span>`)
    .join('');
}

// 现行国策：上一条仍然"在桌上"，看得见才谈得上延续或改弦更张
export function renderCurrentPolicy(game) {
  const el = $('currentPolicy');
  const policies = game.policies || [];
  if (policies.length === 0) {
    el.innerHTML = `<div class="current-policy none">尚未颁布国策——下方已备好一条建议，可直接修改后颁布。</div>`;
    return;
  }
  const p = policies[policies.length - 1];
  const domainName = { politics: '政治', economy: '经济', culture: '文化', military: '军事' }[p.domain] || '综合';
  const verdictName = { positive: '民心归附', neutral: '波澜不惊', negative: '怨声四起' }[p.verdict] || '';
  el.innerHTML = `<div class="current-policy">
    <b>现行国策</b>（第 ${p.turn} 年 · ${domainName} · <span class="v-${p.verdict}">${verdictName}</span>）
    <div class="cp-text">${p.text}</div>
  </div>`;
}

// ---- 地图渲染 ----
const CS = 26; // 每格边长（CSS 像素）

export function renderMap(game, ui) {
  const cv = $('map');
  const { w, h, cells } = game.map;
  const dpr = window.devicePixelRatio || 1;
  cv.width = w * CS * dpr;
  cv.height = h * CS * dpr;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const targets = ui.attackMode ? new Set(attackableCells(game, game.playerId)) : null;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const x = (i % w) * CS;
    const y = Math.floor(i / w) * CS;
    ctx.fillStyle = TERRAINS[cell.t].color;
    ctx.fillRect(x, y, CS, CS);

    const nation = cell.owner ? game.nations[cell.owner] : null;
    if (nation) {
      // 玩家领土用更高饱和的色罩与更粗的国界，确保在地图上一眼可辨
      ctx.fillStyle = nation.color + (nation.isPlayer ? '8c' : '55');
      ctx.fillRect(x, y, CS, CS);
      ctx.strokeStyle = nation.color;
      ctx.lineWidth = nation.isPlayer ? 3 : 2;
      drawBorders(ctx, i, w, h, cells, x, y, cell.owner);
    } else if (cell.wild >= 4) {
      // 散落部民：用小点表示人口规模，让「可吸引的人口」在地图上可见
      const dot = mulberry32(i * 7919);
      ctx.fillStyle = 'rgba(30, 26, 18, 0.55)';
      const r = Math.min(3.2, 0.8 + cell.wild / 38);
      const cx = x + CS / 2 + (dot() - 0.5) * 6;
      const cy = y + CS / 2 + (dot() - 0.5) * 6;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (targets?.has(i)) {
      ctx.strokeStyle = '#e0564a';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, CS - 4, CS - 4);
      ctx.setLineDash([]);
    }
  }

  // 城郭与驻军：每块领土按文明等级画城市，都城另标驻军兵力
  for (const nation of Object.values(game.nations)) {
    if (nation.cells.length === 0) continue;
    const tier = nation.civTier || civTierOf(nation).level;
    const army = armyTierOf(nation);
    for (const idx of nation.cells) {
      drawCity(ctx, (idx % w) * CS, Math.floor(idx / w) * CS, {
        tier, capital: idx === nation.cells[0], color: nation.color,
      });
    }
    const capIdx = nation.cells[0];
    drawGarrison(ctx, (capIdx % w) * CS, Math.floor(capIdx / w) * CS, {
      army: army.level, soldiers: nation.soldiers, color: nation.color,
    });
  }

  // 都城标记：玩家的都城画皇冠并配金色光环，列国画星标
  for (const nation of Object.values(game.nations)) {
    if (nation.cells.length === 0) continue;
    const idx = nation.cells[0];
    const x = (idx % w) * CS + CS / 2;
    const y = Math.floor(idx / w) * CS + CS / 2;
    ctx.font = `${CS * 0.72}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (nation.isPlayer) {
      ctx.beginPath();
      ctx.arc(x, y, CS * 0.62, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd97a';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillText('👑', x, y + 1);
    } else {
      ctx.fillStyle = '#fff';
      ctx.fillText('✦', x, y + 1);
    }
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
function drawCity(ctx, x, y, { tier, capital, color }) {
  if (drawArt(ctx, ART_PATHS.city(tier, capital), x + 2, y + 2, CS - 4, CS - 4)) {
    drawPennant(ctx, x, y, color);
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
  drawPennant(ctx, x, y, color);
}

function drawPennant(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x + 2, y + 2, 4, 3);
  ctx.fillStyle = 'rgba(20,16,10,0.9)';
  ctx.fillRect(x + 2, y + 2, 1, 5);
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
    btn.onclick = () => a.onClick?.(() => root.replaceChildren());
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
  btn.textContent = busy ? '天命史官推演中…' : '颁布政策';
}
