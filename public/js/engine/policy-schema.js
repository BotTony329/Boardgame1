// 政策效果的数据契约：客户端兜底评估器与服务器 AI 裁决共用同一套钳制规则，
// 保证无论效果来自大模型还是关键词启发式，进入游戏引擎的数值形状都一致且安全。

export const VERDICTS = ['positive', 'neutral', 'negative'];

// 各项效果的硬上限。模型输出永远不是数值真源（提示注入可刷数值），
// 钳制是最终防线；这个区间也保证单条政策不会一回合颠覆国运。
export const CLAMPS = {
  populationChangePct: [-8, 8],
  stabilityChange: [-20, 20],
  appealChange: [-15, 20],
  resourcePct: [-40, 60],
};

const RESOURCE_KEYS = ['food', 'minerals', 'energy'];

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
  const rc = (raw && typeof raw.resourceChanges === 'object' && raw.resourceChanges) || {};
  const verdict = VERDICTS.includes(raw?.verdict) ? raw.verdict : 'neutral';
  return {
    verdict,
    narrative: String(raw?.narrative || '').slice(0, 300),
    populationChangePct: clampNum(raw?.populationChangePct, CLAMPS.populationChangePct),
    stabilityChange: clampNum(raw?.stabilityChange, CLAMPS.stabilityChange),
    appealChange: clampNum(raw?.appealChange, CLAMPS.appealChange),
    resourceChanges: Object.fromEntries(
      RESOURCE_KEYS.map((k) => [k, clampNum(rc[k], CLAMPS.resourcePct)]),
    ),
    risks: Array.isArray(raw?.risks) ? raw.risks.slice(0, 3).map((r) => String(r).slice(0, 60)) : [],
    source: raw?.source === 'fallback' ? 'fallback' : 'qwen',
  };
}
