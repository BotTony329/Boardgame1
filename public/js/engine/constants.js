// 地形与资源定义。每格的产量系数乘以噪声（0.7~1.5），
// 这让不同国家的疆域天然有不同的资源禀赋。
export const TERRAINS = {
  ocean:    { name: '海洋', color: '#1d3d5e', land: false },
  beach:    { name: '海滩', color: '#d3c184', land: true,  base: { food: 3,   minerals: 0.5, energy: 1   }, defense: 1.0 },
  plain:    { name: '平原', color: '#79a75e', land: true,  base: { food: 6,   minerals: 0.8, energy: 0.5 }, defense: 1.0 },
  forest:   { name: '森林', color: '#41714b', land: true,  base: { food: 4,   minerals: 1.5, energy: 0.8 }, defense: 1.25 },
  hills:    { name: '丘陵', color: '#91895c', land: true,  base: { food: 2,   minerals: 4,   energy: 0.8 }, defense: 1.4 },
  mountain: { name: '山地', color: '#8a8178', land: true,  base: { food: 1,   minerals: 3,   energy: 1.5 }, defense: 1.8 },
  desert:   { name: '荒漠', color: '#c9b178', land: true,  base: { food: 0.5, minerals: 1,   energy: 3.5 }, defense: 1.1 },
};

// 阶段与门槛数值（均可在调试中调整；改这里即可平衡游戏节奏）
export const RULES = {
  conscriptMinPop: 600,     // 人口达到此数才可征兵（需求原文门槛）
  kingdomPop: 800,          // 部落 → 王国
  republicPop: 5000,        // 王国 → 共和/主席国
  republicStability: 50,
  victoryCells: 120,        // 统一 120 格获胜
  defeatPop: 20,            // 人口跌破此数 → 国家崩解
  garrisonFoodPerSoldier: 0.2,
  foodPerPop: 0.06,
};
