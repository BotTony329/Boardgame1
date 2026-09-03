import { RULES } from './constants.js';

// 国策建议池：按当前国情挑选最要紧的方向，给玩家一条"看着改"的底稿。
// 只做 UI 建议，不参与结算；故意写得像玩家手笔，方便在其基础上增删。
const POOLS = {
  survival: [
    '开仓放粮，赈济饥民，同时遣人开挖沟渠引水灌田，先保住每一张嘴，再图春耕。',
    '减税一半，禁止征调民夫，让各部休养生息；余粮按户配给，老幼优先。',
    '与四邻开互市，以兽皮换粮；同时组织青壮结队渔猎，广积粮草以防青黄不接。',
  ],
  growth: [
    '广布告示于四方：凡来投者分田三亩、屋舍一间，三年的税赋分文不收。',
    '轻徭薄赋，与民休息；沿官道设粥棚接待流民，选贤能部老安抚编户。',
    '兴办讲堂，教民识字农耕；对生养子女的家庭发放粮布，鼓励人口滋长。',
    '整修道路，连通各部聚落；设市集通商，让四方货物与人口自然汇聚。',
  ],
  order: [
    '亲巡各部，公开审理积案，宽赦轻罪；选立部老议事会，民怨可直达王帐。',
    '整饬吏治，罢黜贪苛之吏；开放言路，许民议政而不加罪。',
    '举行盛大祭典与宴饮，与民同乐；给戍卒与孤寡发放抚恤，重振民心。',
  ],
  general: [
    '清丈田亩，编户齐民，按丁口授田；设常平仓，丰年籴粮歉年粜之。',
    '鼓励冶炼与采石，官营矿坑三成收益归部众共有；备兵器以修武备。',
    '遣使者携厚礼出访列国，缔结互不侵犯之盟；同时暗中修缮城防。',
    '定历法、兴水利、垦荒田，凡新垦之地五年免税。',
  ],
};

export function suggestPolicy(game) {
  const n = game.nations[game.playerId];
  // 择池优先级：先救命、再安民、后聚人，最后是万金油施政
  let key = 'general';
  if (n.food < Math.max(80, n.pop * RULES.foodPerPop * 6)) key = 'survival';
  else if (n.stability < 45) key = 'order';
  else if (n.pop < RULES.kingdomPop) key = 'growth';
  const pool = POOLS[key];
  return pool[Math.floor(Math.random() * pool.length)];
}
