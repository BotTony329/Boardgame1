// ===== 典章制度（现存国策）=====
// 玩家开局即随机继承若干道「已经存在的国策」；每回合预填其中一道。
// 原样颁布 = 萧规曹随（稳定 +1，无改革成本）；
// 改动颁行 = 变法更张（稳定 -3，朝令夕改之弊），但新策会入典章，
// 成为往后可继承的现存国策。修改成本由此成为真实的决策权衡。

export const STATUTE_LIBRARY = [
  { id: 'lib-p01', domain: 'politics', text: '官吏考绩之法：岁末按垦田、狱讼、钱粮三簿考成，优者升迁，劣者黜降。' },
  { id: 'lib-p02', domain: 'politics', text: '开言路：设谤木肺石，许吏民上书言事，言者无罪。' },
  { id: 'lib-p03', domain: 'politics', text: '编户齐民：清丈田亩、登记丁口，赋役按册摊派，豪强不得隐匿。' },
  { id: 'lib-p04', domain: 'politics', text: '乡饮耆老礼：岁首郡县宴请耆老，宣读乡约，敦化民风。' },
  { id: 'lib-p05', domain: 'politics', text: '恤刑慎狱：狱案三审，笞杖之刑减半，冤狱者官府赔偿。' },
  { id: 'lib-e01', domain: 'economy', text: '常平仓法：丰年平价籴粮储仓，歉年平价粜出，以稳谷价。' },
  { id: 'lib-e02', domain: 'economy', text: '盐铁官营：山泽之利收归官府，设盐官铁官主其事，利入国库。' },
  { id: 'lib-e03', domain: 'economy', text: '轻徭薄赋：田租什一，徭役岁不过三日，农忙停征。' },
  { id: 'lib-e04', domain: 'economy', text: '开互市：与四方部族通商，设互市监主其事，抽税十一。' },
  { id: 'lib-e05', domain: 'economy', text: '垦荒令：凡新垦荒田，五年免税，地归垦者，官给牛种。' },
  { id: 'lib-e06', domain: 'economy', text: '铸钱之法：官铸标准钱币，禁私铸，商旅通货用钱帛各半。' },
  { id: 'lib-c01', domain: 'culture', text: '办学养士：郡县皆设学，延师儒教童蒙，岁试择优入仕。' },
  { id: 'lib-c02', domain: 'culture', text: '岁终大傩之礼：驱疫逐鬼，聚民宴饮，同乐以聚人心。' },
  { id: 'lib-c03', domain: 'culture', text: '修史立档：设史官记言记事，国之大政皆入典册，以鉴后世。' },
  { id: 'lib-c04', domain: 'culture', text: '统一度量衡：斗斛尺度皆依官颁之器，违者没其器而罚之。' },
  { id: 'lib-c05', domain: 'culture', text: '旌表义行：岁举孝悌力田、拾金不昧者，授匾免役，风化四方。' },
  { id: 'lib-m01', domain: 'military', text: '寓兵于农：闲时屯田操练，战时按户抽丁，兵农合一。' },
  { id: 'lib-m02', domain: 'military', text: '边戍轮换：戍卒一岁一更，官给冬衣口粮，免久戍之怨。' },
  { id: 'lib-m03', domain: 'military', text: '马政：官设牧场蕃息战马，民间养马可折徭役。' },
  { id: 'lib-m04', domain: 'military', text: '武选升授：设较场春秋两试弓马刀枪，胜者入军籍、授田赏帛。' },
];

// 开局随机继承 n 道典章（可带 rng 保证同种子同开局）
export function pickStatutes(n, rng = Math.random) {
  const pool = [...STATUTE_LIBRARY];
  const out = [];
  while (out.length < n && pool.length > 0) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out.map((s) => ({ ...s }));
}

// 每回合预填哪道：按回合轮转，玩家可点「换一策」在本国道章间切换
export function draftStatute(nation, turn) {
  if (!nation.statutes || nation.statutes.length === 0) return null;
  return nation.statutes[(turn - 1) % nation.statutes.length];
}

// 变法成功后，新策入典章（置于最前），典章上限 5 道，旧的自然淘汰
export function upsertStatute(nation, { text, domain, turn }) {
  nation.statutes = nation.statutes || [];
  const existing = nation.statutes.findIndex((s) => s.text === text);
  if (existing !== -1) nation.statutes.splice(existing, 1);
  nation.statutes.unshift({ id: `own-${turn}`, domain, text });
  if (nation.statutes.length > 5) nation.statutes.length = 5;
}
