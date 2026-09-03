// 千问政策裁决器：把「国家状态 + 玩家政策文本」交给大模型，收回结构化的政策效果。
// 数值钳制与 JSON 提取复用引擎里的共享 schema（public/js/engine/policy-schema.js），
// 客户端兜底评估器与这里遵守同一份契约。纯函数 + fetch 注入，便于单元测试。
import { clampPolicyResult, extractJson } from '../public/js/engine/policy-schema.js';

export { CLAMPS, clampPolicyResult, extractJson } from '../public/js/engine/policy-schema.js';

export function buildMessages(state, policy) {
  const system = `你是架空格子星球上的「天命史官」，裁决各国统治者颁布的政策对民心的真实影响。
你必须只输出一个 JSON 对象，不要输出任何其他文字或代码块标记。
裁决要考虑：政策的现实可行性、当前国情（资源短缺时激进福利会崩、人口稀少时强征民力会逃亡）、政策领域与历史连贯性。
人口变化逻辑：得民心的政策吸引散落大陆的流民迁入；苛政、战乱、饥荒导致人口流失。
JSON 结构（字段缺一不可）：
{
  "verdict": "positive" 或 "neutral" 或 "negative",
  "narrative": "60~120字的史官叙述，讲清这项政策在民间引起的真实反响",
  "populationChangePct": -8到8的数字（人口变化百分比）,
  "stabilityChange": -20到20的数字（稳定度变化）,
  "appealChange": -15到20的数字（对四方流民吸引力变化）,
  "resourceChanges": { "food": -40到60的百分比, "minerals": -40到60的百分比, "energy": -40到60的百分比 },
  "risks": ["0~3条简短风险提示"]
}`;

  const snapshot = {
    回合: state.turn,
    政体阶段: state.stage,
    国名: state.nationName,
    人口: Math.round(state.pop),
    常备军: state.soldiers,
    稳定度: Math.round(state.stability),
    四方吸引力: Math.round(state.appeal),
    领地格子数: state.cellCount,
    粮食: Math.round(state.food),
    矿产: Math.round(state.minerals),
    能源: Math.round(state.energy),
    领地亩产: state.landYield,
    近期政策: state.recentPolicies,
  };

  const domainName = { politics: '政治', economy: '经济', culture: '文化', military: '军事' }[policy.domain] || '综合';
  const nature = policy.continuation
    ? '延续既定国策（萧规曹随，守成有序，效果宜平稳）'
    : '推行新政（变法更张，吏民需要适应，或有短期震荡）';
  const user = `【当前国情】\n${JSON.stringify(snapshot, null, 1)}\n\n【现存典章】\n${(state.statutes || []).map((s, i) => `${i + 1}. ${s}`).join('\n') || '无'}\n\n【本回合政策 · 领域：${domainName} · ${nature}】\n${policy.text}\n\n请裁决并只输出 JSON。`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

const REQUEST_TIMEOUT_MS = 45_000;

export async function callQwen({ config, messages, fetchImpl = fetch }) {
  const res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      // 关闭思考模式：政策裁决是结构化小任务，思考链只增加几十倍时延不提升质量
      enable_thinking: false,
      temperature: 0.8,
      max_tokens: 800,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`qwen http ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('empty qwen content');
  return content;
}

// 非法 JSON 重试一次：给模型一次自纠机会，两次都失败则向上抛错走客户端兜底。
export async function evaluatePolicy(config, state, policy, fetchImpl = fetch) {
  const messages = buildMessages(state, policy);
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await callQwen({ config, messages, fetchImpl });
      return clampPolicyResult(extractJson(text));
    } catch (err) {
      lastErr = err;
      if (attempt === 0) {
        messages.push({ role: 'assistant', content: '输出不是合法 JSON。' });
        messages.push({ role: 'user', content: '请重新只输出符合结构的 JSON 对象，不要任何多余文字。' });
      }
    }
  }
  throw lastErr;
}
