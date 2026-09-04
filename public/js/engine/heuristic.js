import { clampPolicyResult } from './policy-schema.js';

// 本地启发式评估器：千问 API 不可用（断网/欠费/超时）时的兜底，
// 用关键词规则表给出与 AI 同构的逐回合效果对象，保证游戏离线可玩。
// 数量级按当前国力（快照）折算，模拟"史官看国情定夺"。
const GROUPS = [
  { re: /减税|轻徭薄赋|免税|降税/, pop: 0.04, stab: 0.08, appeal: 0.25, res: { food: -0.06 }, why: '减税轻赋' },
  { re: /赈灾|放粮|开仓|济民|施粥/, pop: 0.03, stab: 0.1, appeal: 0.25, res: { food: -0.15 }, why: '开仓赈济' },
  { re: /加税|重税|横征|苛捐|征税/, pop: -0.04, stab: -0.1, appeal: -0.35, res: { food: 0.18 }, why: '加征赋税' },
  { re: /水利|灌溉|挖渠|开渠|修堤|治水|水库/, pop: 0.02, stab: 0.04, appeal: 0.15, res: { food: 0.28, minerals: -0.06 }, why: '兴修水利' },
  { re: /垦荒|屯田|开垦|劝农|农耕|耕种/, pop: 0.015, stab: 0.02, appeal: 0.1, res: { food: 0.32 }, why: '劝课农桑' },
  { re: /医疗|医药|医馆|防疫|卫生|大夫/, pop: 0.03, stab: 0.06, appeal: 0.15, res: { minerals: -0.06 }, why: '广设医馆' },
  { re: /教育|办学|书院|学堂|扫盲|开学/, pop: 0.008, stab: 0.04, appeal: 0.2, res: { food: -0.08, energy: 0.06 }, why: '兴办文教' },
  { re: /互市|贸易|通商|集市|市场|商会/, pop: 0.015, stab: 0.015, appeal: 0.15, res: { minerals: 0.2, energy: 0.14 }, why: '开互市通商' },
  { re: /修路|筑路|驿道|基建|架桥/, pop: 0.008, stab: 0.03, appeal: 0.1, res: { food: 0.06, energy: -0.08 }, why: '修桥铺路' },
  { re: /节庆|祭祀|庆典|庙会|歌舞/, pop: 0.008, stab: 0.04, appeal: 0.2, res: { food: -0.07 }, why: '庆典祭享' },
  { re: /宽容|平等|开放|自由|纳谏/, pop: 0.015, stab: 0.03, appeal: 0.25, why: '广开言路、宽以待民' },
  { re: /镇压|清洗|戒严|宵禁|压迫|禁言|文字狱|酷刑/, pop: -0.03, stab: 0.06, appeal: -0.45, why: '以严刑峻法压民' },
  { re: /征兵|扩军|练兵|备战|军营|武备/, pop: -0.015, stab: -0.03, appeal: -0.15, res: { minerals: -0.14 }, why: '扩军备战' },
  { re: /开战|征伐|进攻|讨伐|宣战/, pop: -0.02, stab: -0.04, appeal: -0.2, why: '兴兵动武' },
  { re: /外交|结盟|使节|和亲|会盟/, pop: 0.008, stab: 0.03, appeal: 0.15, why: '结好四邻' },
  { re: /采矿|开采|冶炼|铁矿|矿坑/, pop: 0, stab: 0.015, appeal: 0, res: { minerals: 0.3, food: -0.04 }, why: '开山采矿' },
  { re: /能源|薪柴|伐木|钻井|煤炭|火油/, pop: 0, stab: 0, appeal: -0.05, res: { energy: 0.3 }, why: '广集薪炭' },
  { re: /植树|休耕|环保|养护|封山/, pop: 0.008, stab: 0.015, appeal: 0.1, res: { food: 0.04, minerals: -0.06, energy: -0.06 }, why: '休养生息' },
  { re: /集权|独裁|专权|亲信/, pop: -0.008, stab: 0.07, appeal: -0.25, why: '收权于上' },
  { re: /放权|选举|议事|议会|民主|民选/, pop: 0.015, stab: 0.04, appeal: 0.3, res: { food: -0.03 }, why: '还政于民' },
  { re: /迁都|移民|迁民/, pop: 0.008, stab: -0.03, appeal: 0.1, why: '迁徙安民' },
];

const FLAVOR = [
  '民间议论纷纷。', '市井之间毁誉参半。', '部老们捻须不语。', '四方部民侧目而视。',
];

const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v * 10) / 10));

// 归一化聚合：命中规则按国力折算为逐回合量；未命中任何规则视为平淡之政。
export function heuristicEvaluate(snapshot, policy) {
  const text = policy.text || '';
  const matched = GROUPS.filter((g) => g.re.test(text));
  const pop0 = Math.max(50, snapshot.pop || 100);
  const stockOf = (k) => Math.max(30, snapshot[k] || 60);

  let appeal = 0, stab = 0;
  const res = { food: 0, minerals: 0, energy: 0 };
  let popPct = 0;
  for (const g of matched) {
    appeal += g.appeal || 0;
    stab += g.stab || 0;
    popPct += g.pop || 0;
    for (const [k, v] of Object.entries(g.res || {})) res[k] += v;
  }

  const scale = Math.min(1.6, 0.7 + text.length / 120); // 论述更详尽的政策效果更充分
  const perTurn = {
    appeal: clampN(appeal * scale, -8, 10),
    stability: clampN(stab * scale, -8, 10),
    pop: clampN(pop0 * popPct * scale, -30, 30),
    food: clampN(stockOf('food') * (res.food || 0) * scale, -80, 120),
    minerals: clampN(stockOf('minerals') * (res.minerals || 0) * scale, -40, 60),
    energy: clampN(stockOf('energy') * (res.energy || 0) * scale, -40, 60),
  };

  if (matched.length === 0) {
    perTurn.appeal = clampN(perTurn.appeal + (Math.random() - 0.5) * 1.5, -8, 10);
    perTurn.stability = clampN(perTurn.stability + (Math.random() - 0.5) * 1.5, -8, 10);
  }

  const score = perTurn.pop * 0.05 + perTurn.appeal * 0.4 + perTurn.stability * 0.2;
  const verdict = score > 1.2 ? 'positive' : score < -1.2 ? 'negative' : 'neutral';
  const why = matched.slice(0, 2).map((g) => g.why).join('、');

  return clampPolicyResult({
    verdict,
    narrative: why
      ? `${nationFlavor(snapshot)}推行${why}之策，${verdict === 'positive' ? '万民称便，流民相望于道' : verdict === 'negative' ? '民有怨言，或有携家远走者' : '民间反应平平'}。${pickOne(FLAVOR)}`
      : `${nationFlavor(snapshot)}所颁之政意涵晦涩，部老与民众皆未了然，一切如常。`,
    perTurn,
    risks: verdict === 'negative' ? ['民怨积聚，若连续苛政恐生动荡'] : [],
    source: 'fallback',
  });
}

function nationFlavor(snapshot) {
  return `${snapshot.nationName || '朝廷'}`;
}

function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
