import {
  newGame, loadGame, clearSave, doConscript, enactPolicy, cancelPolicy,
  resolveNextTurn, chooseRepublicType, playerNation, doSendEnvoy, doEstablishTrade, doSeverTies,
  doFormArmy, doMoveArmy, doArmyAttack, doBuildFort, doToggleDefend, doColonize, demandSubmission,
} from './engine/game.js';
import { snapshotForAI } from './engine/nation.js';
import { classifyArmyTarget, cellDefense, armyAt } from './engine/armies.js';
import { requestPolicyVerdict } from './engine/ai-client.js';
import { draftStatute } from './engine/statutes.js';
import { MAX_ACTIVE_POLICIES } from './engine/policies.js';
import { TERRAINS, RULES } from './engine/constants.js';
import { render, showModal, toast, setBusy, updateCellInfo } from './ui.js';

let game = null;
let busy = false;
const ui = { selectedIdx: null, hoverIdx: null, selectedArmyId: null, colonizePending: null, domain: 'politics', currentDraft: null, draftOffset: 0, worldTab: 'chronicle' };

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('zh-CN');
const sign = (n) => `${n > 0 ? '+' : ''}${fmt(n)}`;
const signPct = (n) => `${n > 0 ? '+' : ''}${Math.round(n * 10) / 10}%`;

function renderAll() {
  render(game, ui);
}

// ---------- 开局 ----------
// 预填本回合的典章底稿：随机轮转现存国策之一（可点「换一策」切换）。
// 原样颁布 = 守成（稳定+1）；改动 = 变法（稳定−3）——修改成本由此而来。
function prefillPolicyInput() {
  const player = playerNation(game);
  const statutes = player.statutes || [];
  if (statutes.length === 0) {
    ui.currentDraft = null;
    $('policyText').value = '';
    updateReformHint();
    return;
  }
  ui.draftOffset = 0;
  ui.currentDraft = draftStatute(player, game.turn);
  $('policyText').value = ui.currentDraft.text;
  updateReformHint();
}

// 「换一策」：在现存典章间轮换预填底稿
function cycleDraft() {
  const statutes = playerNation(game).statutes || [];
  if (statutes.length === 0) { toast('国无典章，请自撰国策'); return; }
  const base = game.turn - 1;
  ui.draftOffset = (ui.draftOffset + 1) % statutes.length;
  ui.currentDraft = statutes[(base + ui.draftOffset) % statutes.length];
  $('policyText').value = ui.currentDraft.text;
  updateReformHint();
  renderAll();
}

// 实时提示当前输入的改革成本
function updateReformHint() {
  const el = $('reformHint');
  const text = $('policyText').value.trim();
  if (!text) { el.textContent = ''; el.className = ''; return; }
  if ((game.activePolicies || []).some((p) => p.text === text)) {
    el.textContent = '✔ 守成续行：重申现行施政，效力回满，稳定 +1';
    el.className = 'hint-continue';
  } else if ((game.activePolicies || []).length >= MAX_ACTIVE_POLICIES) {
    el.textContent = '⚠ 政务已满（至多 4 道施行）：请先罢行一道，方可颁布新策';
    el.className = 'hint-reform';
  } else {
    el.textContent = '✦ 变法更张：颁布新施政（持续生效），稳定 −3，新策录入典章';
    el.className = 'hint-reform';
  }
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
        <li>以文字<b>颁布施政</b>，由千问3.7 裁定力度。施政<b>持续生效</b>（逐回合兑现、效力随岁月衰减），直至效力耗尽或你下诏罢行；时间由你手动推进（「进入下一回合」）。</li>
        <li>开局随机继承两道<b>现存典章</b>。续行现行施政为<b>守成</b>（稳定+1）；颁布新策为<b>变法</b>（稳定−3），新策录入典章。</li>
        <li>人口达到 <b>600</b> 方可征兵，人口 <b>800</b> 加冕为王，人口 <b>5000</b> 且安定可改制共和。</li>
        <li>城市与士兵随<b>文明等级</b>换装：治世城郭日盛，苛政则民生凋敝、等级跌落。</li>
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
        ui.selectedArmyId = null;
        ui.colonizePending = null;
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
// ---------- 颁布施政（不推进回合；施政持续生效至取消或效力耗尽） ----------
async function submitPolicy() {
  if (busy || game.phase !== 'playing') return;
  const text = $('policyText').value.trim();
  if (!text) { toast('施政不可为空——哪怕只写「与民休息」四字。'); return; }

  busy = true;
  setBusy(true);
  try {
    const snapshot = snapshotForAI(game, playerNation(game));
    // 与现行施政同文 = 重申续行（守成）；否则为颁布新策（变法）
    const continuation = (game.activePolicies || []).some((p) => p.text === text);
    const result = await requestPolicyVerdict(snapshot, { text, domain: ui.domain, continuation });
    const r = enactPolicy(game, result, { text, domain: ui.domain, continuation });
    busy = false;
    setBusy(false);
    if (!r.ok) { toast(r.reason); return; }
    renderAll();
    updateReformHint();
    showEnactReport(result, r.statuteEffect);
  } catch (err) {
    busy = false;
    setBusy(false);
    toast('颁布出错：' + err.message);
  }
}

// 颁布回执：只确认施政入列，不结算回合
function showEnactReport(result, statuteEffect) {
  const verdictName = { positive: '民心归附', neutral: '波澜不惊', negative: '怨声四起' }[result.verdict];
  const statuteTag = statuteEffect === 'continue'
    ? '<span class="verdict positive">守成续行 · 效力回满 · 稳定+1</span>'
    : '<span class="verdict negative">变法更张 · 稳定−3</span>';
  showModal({
    title: '颁布实录',
    html: `
    <span class="verdict ${result.verdict}">${verdictName}</span>
    ${statuteTag}
    ${result.source === 'fallback' ? '<span class="verdict fallback-tag">离线·启发式裁定</span>' : '<span class="verdict fallback-tag">千问史官裁定</span>'}
    <p>${result.narrative || '史官对此缄默不语。'}</p>
    <p class="hint">此政已列入施政，逐回合生效；效力随岁月衰减，耗尽后载入典章。可随时下诏罢行。点「进入下一回合」推进时间。</p>
    ${result.risks?.length ? `<p class="risks">⚠ ${result.risks.join('；')}</p>` : ''}`,
  });
}

// ---------- 手动推进回合 ----------
function nextTurn() {
  if (busy || game.phase !== 'playing') return;
  const report = resolveNextTurn(game);
  if (!report) return;
  ui.draftOffset = 0;
  ui.currentDraft = draftStatute(playerNation(game), game.turn);
  renderAll();
  updateReformHint();
  showTurnReport(report);
}

function showTurnReport(report) {
  const d = report?.deltas;
  const deltaRow = (label, v) =>
    `<div class="kv"><span class="k">${label}</span><span class="${v >= 0 ? 'up' : 'down'}">${sign(v)}</span></div>`;

  showModal({
    title: `岁末结算 · 第 ${game.turn - 1} 年`,
    html: `
    <p class="hint">本年国力变化（含施政、生产、迁移与万国事件）：</p>
    ${d ? `<div class="deltas">
      ${deltaRow('人口', d.pop)}
      ${deltaRow('稳定度', d.stability)}
      ${deltaRow('吸引力', d.appeal)}
      ${deltaRow('粮食', d.food)}
      ${deltaRow('矿产', d.minerals)}
      ${deltaRow('能源', d.energy)}
    </div>` : ''}
    ${report?.migrants ? `<p class="hint">本年四方共有约 ${report.migrants} 名散落部民迁入列国。</p>` : ''}`,
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
        <span class="t">第 ${p.turn} 年 · ${domainName[p.domain] || '综合'}${p.statute === 'continue' ? ' · <span class="v-positive">守成</span>' : p.statute === 'reform' ? ' · <span class="v-negative">变法</span>' : ''}</span>
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

// ---------- 军团指挥 ----------
function findPlayerArmy(armyId) {
  return (game.armies || []).find((a) => a.id === armyId && a.owner === game.playerId);
}

// 选中军团后点击相邻格：判定军机胜算并请战
function showArmyAttackConfirm(army, targetIdx) {
  const cell = game.map.cells[targetIdx];
  const nation = playerNation(game);
  const supplied = nation.energy >= army.soldiers * 0.2;
  const attPower = Math.round(army.soldiers * (nation.stability / 60 + 0.4) * (supplied ? 1 : 0.8));
  const def = cellDefense(game, targetIdx);
  const defPower = Math.round(def.strength);
  const odds = attPower > defPower * 1.1 ? '胜算较大' : attPower > defPower * 0.8 ? '胜负难料' : '胜算渺茫';
  const defenderName = def.kind === 'army' ? game.nations[def.army.owner].name
    : def.kind === 'militia' ? `${def.nation.name}（城邑民兵）` : '散落部民';

  showModal({
    title: '兵临城下',
    html: `
      <p>目标：${TERRAINS[cell.t].name}（地形防御 ×${terrainDefLabel(cell.t)}${cell.fort ? ` · 工事${cell.fort}级` : ''}）</p>
      <div class="deltas">
        <div class="kv"><span class="k">我军攻击力</span><span>${attPower}${supplied ? '' : '（能源不足）'}</span></div>
        <div class="kv"><span class="k">守方兵力</span><span>${defPower}（${defenderName}）</span></div>
      </div>
      <p class="hint">军机研判：${odds}。战事必有伤亡；攻占后军团进驻该地，民心略损。</p>`,
    actions: [
      { label: '暂缓', ghost: true, onClick: (close) => close() },
      { label: '开战', danger: true, onClick: (close) => {
        close();
        const report = doArmyAttack(game, army.id, targetIdx);
        if (!report.ok) { toast(report.reason); return; }
        renderAll();
        showArmyBattleReport(report);
      } },
    ],
  });
}

function terrainDefLabel(t) {
  return { beach: '1.0', plain: '1.0', forest: '1.25', hills: '1.4', mountain: '1.8', desert: '1.1' }[t] || '1.0';
}

function showArmyBattleReport(report) {
  showModal({
    title: report.captured ? '捷报' : '败讯',
    html: report.captured
      ? `<p>我军攻克目标！折损 ${report.losses} 人，${report.defenderName !== '散落部民' ? `${report.defenderName}守军溃散（折损 ${report.defenderLosses}），` : ''}${report.absorbed ? `收编归化之民 ${report.absorbed} 人，` : ''}军团进驻新土。</p>`
      : `<p>攻城不利！${report.defenderName}据险死守，我军折损 ${report.losses} 人，军心民气俱损。宜厚积再战。</p>`,
  });
  checkEnd();
}

// ---------- 事件绑定 ----------
function bindEvents() {
  $('btnPolicy').addEventListener('click', submitPolicy);
  $('btnNextTurn').addEventListener('click', nextTurn);
  $('policyText').addEventListener('input', updateReformHint);
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
    const cancelBtn = e.target.closest('[data-cancel]');
    if (cancelBtn) {
      const r = cancelPolicy(game, cancelBtn.dataset.cancel);
      if (r.ok) { toast('已下诏罢行该施政'); renderAll(); updateReformHint(); }
    }
    if (e.target.id === 'btnFormArmy') {
      const size = Math.floor(Number($('armySize').value) || 0);
      const r = doFormArmy(game, size);
      if (r.ok) { toast(`军团组建：${size} 人成军`); renderAll(); }
      else toast(r.reason);
    }
    const selBtn = e.target.closest('[data-army-sel]');
    if (selBtn) {
      ui.selectedArmyId = ui.selectedArmyId === selBtn.dataset.armySel ? null : selBtn.dataset.armySel;
      ui.colonizePending = null;
      toast(ui.selectedArmyId ? '军团听命：点击相邻格行动（绿=调防，红=开战/镇压）' : '已解除指挥');
      renderAll();
    }
    const fortBtn = e.target.closest('[data-army-fort]');
    if (fortBtn && !fortBtn.disabled) {
      const r = doBuildFort(game, fortBtn.dataset.armyFort);
      toast(r.ok ? `工事修筑至 ${r.level} 级（耗矿 ${r.cost}）` : r.reason);
      renderAll();
    }
    const defendBtn = e.target.closest('[data-army-defend]');
    if (defendBtn) {
      const r = doToggleDefend(game, defendBtn.dataset.armyDefend);
      toast(r.ok ? (r.stance === 'defend' ? '全军坚守：防御 +35%，不再主动出击' : '已解除坚守') : r.reason);
      renderAll();
    }
    const colonizeBtn = e.target.closest('[data-army-colonize]');
    if (colonizeBtn && !colonizeBtn.disabled) {
      ui.colonizePending = colonizeBtn.dataset.armyColonize;
      ui.selectedArmyId = ui.colonizePending;
      toast('拓疆待命：点击相邻无主之地，安抚部民、开疆拓土');
    }
    if (e.target.id === 'btnSuggest') cycleDraft();
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

  // 万国志：标签切换 + 外交动作（按钮由 renderWorld 动态生成，走事件委托）
  $('worldTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    ui.worldTab = tab.dataset.tab;
    renderAll();
  });
  $('worldPane').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-diplo]');
    if (!btn || btn.disabled) return;
    const { diplo, nation } = btn.dataset;
    if (diplo === 'demand') {
      const result = demandSubmission(game, nation);
      renderAll();
      if (!result.ok) { toast(result.reason); return; }
      showModal({
        title: result.surrendered ? '传檄而定' : '劝降被拒',
        html: result.surrendered
          ? `<p>${result.targetName}见我邦兵强邦睦，举国归顺——疆土、黎民、府库并入版图，不战而定一邦。</p><p class="hint">所谓上兵伐谋，其次邦交。以势压人者众叛，以德服人者来归。</p>`
          : `<p>${result.targetName}掷还国书，斥我为僭越：「吾国虽小，亦不跪！」两国就此断交开战。</p>`,
        actions: [{ label: result.surrendered ? '天下震动' : '整军备战', onClick: (close) => { close(); checkEnd(); } }],
      });
      return;
    }
    const result = diplo === 'envoy' ? doSendEnvoy(game, nation)
      : diplo === 'trade' ? doEstablishTrade(game, nation)
        : doSeverTies(game, nation);
    if (!result.ok) {
      toast(result.reason);
    } else if (diplo === 'envoy') {
      toast(`使节已返：关系 ${result.relation > 0 ? '+' : ''}${result.relation}`);
    } else if (diplo === 'trade') {
      toast('商约缔结，边市大开');
    } else {
      toast('已断绝往来');
    }
    renderAll();
  });

  const cv = $('map');
  cv.addEventListener('mousemove', (e) => {
    const idx = cellFromEvent(e);
    if (idx === ui.hoverIdx) return;
    ui.hoverIdx = idx;
    updateCellInfo(game, idx);
    if (ui.selectedArmyId) renderAll();
  });
  cv.addEventListener('mouseleave', () => {
    ui.hoverIdx = null;
    updateCellInfo(game, ui.selectedIdx);
  });
  cv.addEventListener('click', (e) => {
    const idx = cellFromEvent(e);
    if (idx == null) return;
    ui.selectedIdx = idx;

    // 拓疆待命：点相邻无主之地完成和平殖民
    if (ui.colonizePending) {
      const r = doColonize(game, ui.colonizePending, idx);
      ui.colonizePending = null;
      toast(r.ok ? `拓疆成功：安置部民 ${r.settlers} 人` : r.reason);
      renderAll();
      checkEnd();
      return;
    }

    // 军团指挥：选中军团后点击相邻格执行上下文行动
    const army = (game.armies || []).find((a) => a.id === ui.selectedArmyId);
    if (army && idx !== army.cell) {
      const kind = classifyArmyTarget(game, army, idx);
      if (kind === 'move') {
        const r = doMoveArmy(game, army.id, idx);
        if (!r.ok) toast(r.reason);
      } else if (kind === 'attack') {
        showArmyAttackConfirm(army, idx);
        return;
      } else if (kind === 'ocean') {
        toast('铁蹄不能渡海');
      } else if (kind === 'exhausted') {
        toast('该军团本回合已行动，待下回合再战');
      } else {
        toast('目标不在行军范围');
      }
      renderAll();
      return;
    }

    // 点击己方军团所在格：接管指挥
    const ownArmy = armyAt(game, idx);
    if (ownArmy && ownArmy.owner === game.playerId) {
      ui.selectedArmyId = ownArmy.id;
      toast('军团听命：点击相邻格行动（绿=调防，红=开战/镇压）');
    } else if (ui.selectedArmyId) {
      ui.selectedArmyId = null;
    }
    updateCellInfo(game, idx);
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
