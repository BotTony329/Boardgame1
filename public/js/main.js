import {
  newGame, loadGame, clearSave, applyResolvedTurn, doConscript, doAttack,
  chooseRepublicType, playerNation,
} from './engine/game.js';
import { snapshotForAI } from './engine/nation.js';
import { attackableCells } from './engine/war.js';
import { requestPolicyVerdict } from './engine/ai-client.js';
import { suggestPolicy } from './engine/suggestions.js';
import { TERRAINS, RULES } from './engine/constants.js';
import { render, showModal, toast, setBusy, updateCellInfo } from './ui.js';

let game = null;
let busy = false;
const ui = { selectedIdx: null, hoverIdx: null, attackMode: false, domain: 'politics' };

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('zh-CN');
const sign = (n) => `${n > 0 ? '+' : ''}${fmt(n)}`;
const signPct = (n) => `${n > 0 ? '+' : ''}${Math.round(n * 10) / 10}%`;

function renderAll() {
  render(game, ui);
}

// ---------- 开局 ----------
function prefillPolicyInput() {
  // 有政策史就沿用上一条（方便"看着改"），新局则给一条贴合国情的建议
  const policies = game.policies || [];
  $('policyText').value = policies.length
    ? policies[policies.length - 1].text
    : suggestPolicy(game);
}

function boot() {
  // 开发/演示快捷方式：?autostart=1&seed=xxx 跳过开局弹窗直接生成世界
  const params = new URLSearchParams(location.search);
  if (params.has('autostart')) {
    game = newGame({
      nationName: '演示之邦', leaderName: '观察者',
      seed: params.get('seed') || 'demo',
    });
    renderAll();
    prefillPolicyInput();
    return;
  }
  game = loadGame();
  if (game) {
    renderAll();
    prefillPolicyInput();
    toast(`已恢复存档：${game.nations[game.playerId].name} · 第 ${game.turn} 年`);
  } else {
    showNewGameModal();
  }
}

function showNewGameModal() {
  showModal({
    title: '开创纪元',
    html: `
      <p class="hint">你将以一个随机格子的部落首领起步，凭文字政策招揽散落大陆的人口，聚众建国、称王、改制，直至纵横天下。</p>
      <ul class="rulelist">
        <li>每回合颁布一条<b>自由文字国策</b>，由千问3.7 扮演的「天命史官」裁决其真实效果——得民心者人口来投，失民心者流民四散。</li>
        <li>人口达到 <b>600</b> 方可征兵，人口 <b>800</b> 加冕为王，人口 <b>5000</b> 且安定可改制共和。</li>
        <li>每国资源禀赋不同：粮、矿、能决定你养得起多少兵、打得起多少仗。</li>
        <li>攻占 <b>${RULES.victoryCells}</b> 格则天下一统。</li>
      </ul>
      <label>国号</label>
      <input type="text" id="inpNation" maxlength="12" placeholder="如：炎黄之邦">
      <label>领袖之名</label>
      <input type="text" id="inpLeader" maxlength="12" placeholder="如：启明">
      <label>世界种子（留空随机）</label>
      <input type="text" id="inpSeed" maxlength="20" placeholder="同一种子生成同一颗星球">`,
    actions: [{
      label: '开创新纪元',
      onClick: (close) => {
        const nationName = $('inpNation').value.trim() || '无名之邦';
        const leaderName = $('inpLeader').value.trim() || '无名氏';
        const seed = $('inpSeed').value.trim();
        clearSave();
        game = newGame({ nationName, leaderName, seed });
        ui.attackMode = false;
        ui.selectedIdx = null;
        close();
        renderAll();
        prefillPolicyInput();
        toast(`${nationName} 立邦于 ${TERRAINS[game.map.cells[game.nations.p1.cells[0]].t].name}之上`);
      },
    }],
  });
}

// ---------- 政策回合 ----------
async function submitPolicy() {
  if (busy || game.phase !== 'playing') return;
  const text = $('policyText').value.trim();
  if (!text) { toast('政策不可为空——哪怕只写「与民休息」四字。'); return; }

  busy = true;
  setBusy(true);
  try {
    const snapshot = snapshotForAI(game, playerNation(game));
    const result = await requestPolicyVerdict(snapshot, { text, domain: ui.domain });
    const effects = { ...result, brief: text, domain: ui.domain };
    const report = applyResolvedTurn(game, effects);
    renderAll();
    busy = false;
    setBusy(false);
    // 保留原文作为下一回合的底稿，方便在现有政策基础上修改
    $('policyText').value = text;
    showTurnReport(result, report);
  } catch (err) {
    busy = false;
    setBusy(false);
    toast('回合结算出错：' + err.message);
  }
}

function showTurnReport(result, report) {
  const d = report?.deltas;
  const verdictName = { positive: '民心归附', neutral: '波澜不惊', negative: '怨声四起' }[result.verdict];
  const deltaRow = (label, v, isPct) =>
    `<div class="kv"><span class="k">${label}</span><span class="${v >= 0 ? 'up' : 'down'}">${isPct ? signPct(v) : sign(v)}</span></div>`;

  showModal({
    title: '国策实录',
    html: `
    <span class="verdict ${result.verdict}">${verdictName}</span>
    ${result.source === 'fallback' ? '<span class="verdict fallback-tag">离线·启发式裁定</span>' : '<span class="verdict fallback-tag">千问史官裁定</span>'}
    <p>${result.narrative || '史官对此缄默不语。'}</p>
    ${d ? `<div class="deltas">
      ${deltaRow('人口', d.pop)}
      ${deltaRow('稳定度', d.stability)}
      ${deltaRow('吸引力', d.appeal)}
      ${deltaRow('粮食', d.food)}
      ${deltaRow('矿产', d.minerals)}
      ${deltaRow('能源', d.energy)}
    </div>` : ''}
    ${report?.migrants ? `<p class="hint">本回合四方共有约 ${report.migrants} 名散落部民迁入列国。</p>` : ''}
    ${result.risks?.length ? `<p class="risks">⚠ ${result.risks.join('；')}</p>` : ''}`,
    actions: [{
      label: '继续',
      onClick: (close) => { close(); processEvents(report?.events || []); },
    }],
  });
}

// ---------- 政策档案：历朝历代的国策与裁决，全部可回溯 ----------
function showPolicyArchive() {
  const policies = [...(game.policies || [])].reverse();
  if (policies.length === 0) {
    showModal({ title: '政策档案', html: '<p class="hint">尚未颁布任何国策。每一道国策与其裁决都会记录在此。</p>' });
    return;
  }
  const domainName = { politics: '政治', economy: '经济', culture: '文化', military: '军事' };
  const verdictName = { positive: '民心归附', neutral: '波澜不惊', negative: '怨声四起' };
  const rows = policies.map((p) => `
    <div class="archive-item">
      <div class="ar-head">
        <span class="t">第 ${p.turn} 年 · ${domainName[p.domain] || '综合'}</span>
        <span class="v-${p.verdict}">${verdictName[p.verdict] || ''}</span>
      </div>
      <div class="ar-text">「${p.text}」</div>
      <div class="ar-deltas hint">人口 ${signPct(p.pop)} · 稳定 ${sign(p.stab)} · 吸引 ${sign(p.appeal)}</div>
      <div class="ar-narrative hint">${p.narrative || ''}</div>
    </div>`).join('');
  showModal({ title: `政策档案（${policies.length} 道）`, html: rows });
}

// ---------- 事件队列：加冕、改制等里程碑依次弹窗 ----------
function processEvents(events) {
  const queue = [...events];
  const next = () => {
    const ev = queue.shift();
    if (!ev) { afterEvents(); return; }
    showModal({
      title: ev.title,
      html: `<p>${ev.text}</p>`,
      actions: [{ label: ev.kind === 'republic' ? '入朝议事' : '谨受命', onClick: (close) => { close(); next(); } }],
    });
  };
  next();
}

function afterEvents() {
  // 页面可能在改制弹窗出现前被刷新，存档里 pendingRepublic 需要补一次询问
  if (game.pendingRepublic && game.phase === 'playing') {
    showRepublicChoice();
    return;
  }
  checkEnd();
}

function showRepublicChoice() {
  showModal({
    title: '政制之议',
    html: `<p>国中贤良请愿改制。众议纷纷，或言当效列邦行<b>总统制共和</b>，民选元首；或言当立<b>主席国</b>，集众人之力行大事。此一举而定国运。</p>
      <p class="hint">改制红利：稳定 +15，吸引力 +10。</p>`,
    actions: [
      { label: '立总统制共和国', onClick: (close) => applyRepublic(close, 'presidential') },
      { label: '立主席国', onClick: (close) => applyRepublic(close, 'chairman') },
    ],
  });
}

function applyRepublic(close, type) {
  chooseRepublicType(game, type);
  ui.attackMode = false;
  close();
  renderAll();
  toast(`国体已定：${type === 'presidential' ? '总统制共和国' : '主席国'}`);
  checkEnd();
}

function checkEnd() {
  const n = playerNation(game);
  if (game.phase === 'victory') {
    showModal({
      title: '天下一统',
      html: `<p>第 ${game.turn} 年，${n.name}（${n.leader}）坐拥 ${n.cells.length} 格疆土、${fmt(n.pop)} 之众。四方部民尽入版图，乱世终成过往。</p>
        <p class="hint">国祚 ${game.turn} 年 · 编年史 ${game.log.length} 条 · 存档已保留，可继续巡视天下。</p>`,
      actions: [
        { label: '继续统治', ghost: true, onClick: (close) => close() },
        { label: '另开新纪元', onClick: (close) => { close(); showNewGameModal(); } },
      ],
    });
  } else if (game.phase === 'gameover') {
    showModal({
      title: '国祚终焉',
      html: `<p>第 ${game.turn} 年，${n.name}人口凋零至 ${fmt(n.pop)}，族人流散，宗庙倾覆。史官落笔：「苛政失民，虽盛必衰。」</p>`,
      actions: [{ label: '另开新纪元', onClick: (close) => { close(); showNewGameModal(); } }],
    });
  }
}

// ---------- 征兵与征伐 ----------
function onConscript() {
  const n = playerNation(game);
  const count = Math.floor(Number($('conscriptCount').value) || 0);
  if (count <= 0) { toast('请输入征兵数量'); return; }
  const { recruited } = doConscript(game, count);
  if (recruited === 0) {
    toast(n.pop < RULES.conscriptMinPop
      ? `人口不足 ${RULES.conscriptMinPop}，无法征兵`
      : '人口、粮食或矿产不足，无人可征');
  } else {
    toast(`征募新军 ${recruited} 人`);
  }
  renderAll();
}

function toggleAttackMode() {
  const n = playerNation(game);
  if (n.soldiers <= 0) { toast('先征募军队方可征伐'); return; }
  ui.attackMode = !ui.attackMode;
  if (ui.attackMode) toast('征伐模式：点击与本国相邻的目标格');
  renderAll();
}

function attackEstimate(targetIdx) {
  const n = playerNation(game);
  const cell = game.map.cells[targetIdx];
  const supplied = n.energy >= n.soldiers * 0.2;
  const attPower = n.soldiers * (n.stability / 60 + 0.4) * (supplied ? 1 : 0.8);
  const terrainDef = TERRAINS[cell.t].defense;
  const defOwner = cell.owner ? game.nations[cell.owner] : null;
  const defPower = defOwner
    ? defOwner.soldiers * terrainDef * (defOwner.stability / 60 + 0.4)
    : cell.wild * 0.6 * terrainDef + 5;
  return { attPower: Math.round(attPower), defPower: Math.round(defPower), defOwner, cell, supplied };
}

function showAttackConfirm(targetIdx) {
  const est = attackEstimate(targetIdx);
  const odds = est.attPower > est.defPower * 1.1 ? '胜算较大' : est.attPower > est.defPower * 0.8 ? '胜负难料' : '胜算渺茫';
  showModal({
    title: '兵临城下',
    html: `
      <p>目标：${TERRAINS[est.cell.t].name}（地形防御 ×${terrainDefLabel(est.cell.t)}）</p>
      <div class="deltas">
        <div class="kv"><span class="k">我军攻击力</span><span>${est.attPower}${est.supplied ? '' : '（能源不足）'}</span></div>
        <div class="kv"><span class="k">守方兵力</span><span>${est.defPower}${est.defOwner ? `（${est.defOwner.name}）` : '（散落部民）'}</span></div>
      </div>
      <p class="hint">军机研判：${odds}。战事必有伤亡，攻占后民心略损。</p>`,
    actions: [
      { label: '暂缓', ghost: true, onClick: (close) => close() },
      { label: '开战', danger: true, onClick: (close) => {
        close();
        const report = doAttack(game, targetIdx);
        ui.attackMode = false;
        renderAll();
        if (report) showBattleReport(report);
      } },
    ],
  });
}

function terrainDefLabel(t) {
  return { beach: '1.0', plain: '1.0', forest: '1.25', hills: '1.4', mountain: '1.8', desert: '1.1' }[t] || '1.0';
}

function showBattleReport(report) {
  showModal({
    title: report.captured ? '捷报' : '败讯',
    html: report.captured
      ? `<p>${report.attackerName}攻克目标！我军折损 ${report.losses} 人，${report.defenderName !== '散落部民' ? `${report.defenderName}守军溃散（折损 ${report.defenderLosses}），` : ''}收编归化之民 ${report.absorbed} 人。</p>`
      : `<p>攻城不利！${report.defenderName}据险死守，我军折损 ${report.losses} 人，军心民气俱损。宜厚积再战。</p>`,
  });
  checkEnd();
}

// ---------- 事件绑定 ----------
function bindEvents() {
  $('btnPolicy').addEventListener('click', submitPolicy);
  $('policyText').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submitPolicy();
  });

  // 政策领域选择：仅作为给史官的语境提示，不限制内容
  const domains = [['politics', '政治'], ['economy', '经济'], ['culture', '文化'], ['military', '军事']];
  const chipsEl = $('domainChips');
  chipsEl.innerHTML = domains.map(([k, label]) =>
    `<span class="chip ${k === ui.domain ? 'on' : ''}" data-domain="${k}">${label}</span>`).join('');
  chipsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    ui.domain = chip.dataset.domain;
    chipsEl.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.domain === ui.domain));
  });

  // 军事卡按钮是重绘生成的，用事件委托绑定
  document.addEventListener('click', (e) => {
    if (e.target.id === 'btnConscript') onConscript();
    if (e.target.id === 'btnAttackMode') toggleAttackMode();
    if (e.target.id === 'btnSuggest') {
      $('policyText').value = suggestPolicy(game);
      toast('已换入一条新建议，可自由修改');
    }
    if (e.target.id === 'btnArchive') showPolicyArchive();
    if (e.target.id === 'btnNewGame') {
      showModal({
        title: '另开新局',
        html: '<p>当前存档将被新纪元覆盖，确定？</p>',
        actions: [
          { label: '取消', ghost: true, onClick: (close) => close() },
          { label: '确定重开', danger: true, onClick: (close) => { close(); showNewGameModal(); } },
        ],
      });
    }
  });

  const cv = $('map');
  cv.addEventListener('mousemove', (e) => {
    const idx = cellFromEvent(e);
    if (idx === ui.hoverIdx) return;
    ui.hoverIdx = idx;
    updateCellInfo(game, idx);
    if (ui.attackMode) renderAll();
  });
  cv.addEventListener('mouseleave', () => {
    ui.hoverIdx = null;
    updateCellInfo(game, ui.selectedIdx);
  });
  cv.addEventListener('click', (e) => {
    const idx = cellFromEvent(e);
    if (idx == null) return;
    ui.selectedIdx = idx;
    if (ui.attackMode && attackableCells(game, game.playerId).includes(idx)) {
      showAttackConfirm(idx);
    } else {
      updateCellInfo(game, idx);
    }
    renderAll();
  });
}

function cellFromEvent(e) {
  const cv = $('map');
  const rect = cv.getBoundingClientRect();
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * game.map.w);
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * game.map.h);
  if (x < 0 || y < 0 || x >= game.map.w || y >= game.map.h) return null;
  return y * game.map.w + x;
}

bindEvents();
boot();
