// 政策效果的数据契约：客户端兜底评估器与服务器 AI 裁决共用同一套钳制规则，
// 保证无论效果来自大模型还是关键词启发式，进入游戏引擎的数值形状都一致且安全。
//
// 契约（V2）：政策效果由 AI 直接定夺「逐回合持续量」（perTurn），
// 而非百分比再经固定系数折算。快照含国力与亩产，模型有足够语境定夺合理数值；
// 服务器钳制仍是最终防线，防止提示注入刷数值。

export const VERDICTS = ['positive', 'neutral', 'negative'];

// 逐回合持续量的硬区间。设计参照：千人小邦年产粮约 30~60，
// 故粮食上限 120/回合已是重症猛药；吸引力直接左右迁移速率，区间更窄。
export const CLAMPS = {
  perTurnPop: [-30, 30],
  perTurnAppeal: [-8, 10],
  perTurnStability: [-8, 10],
  perTurnFood: [-80, 120],
  perTurnMinerals: [-40, 60],
  perTurnEnergy: [-40, 60],
};

// 模型偶尔无视指令包裹 ```json 围栏或附加说明文字；这里取第一个配平的花括号块。
export function extractJson(text) {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('no json object found');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('unbalanced json object');
}

function clampNum(v, [lo, hi], fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n * 10) / 10));
}

// 把任意来源（模型/兜底器）的效果对象规整为安全形状。
export function clampPolicyResult(raw) {
  const pt = (raw && typeof raw.perTurn === 'object' && raw.perTurn) || {};
  const verdict = VERDICTS.includes(raw?.verdict) ? raw.verdict : 'neutral';
  return {
    verdict,
    narrative: String(raw?.narrative || '').slice(0, 300),
    perTurn: {
      pop: clampNum(pt.pop, CLAMPS.perTurnPop),
      appeal: clampNum(pt.appeal, CLAMPS.perTurnAppeal),
      stability: clampNum(pt.stability, CLAMPS.perTurnStability),
      food: clampNum(pt.food, CLAMPS.perTurnFood),
      minerals: clampNum(pt.minerals, CLAMPS.perTurnMinerals),
      energy: clampNum(pt.energy, CLAMPS.perTurnEnergy),
    },
    risks: Array.isArray(raw?.risks) ? raw.risks.slice(0, 3).map((r) => String(r).slice(0, 60)) : [],
    source: raw?.source === 'fallback' ? 'fallback' : 'qwen',
  };
}
