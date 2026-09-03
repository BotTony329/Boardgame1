import { clampPolicyResult } from './policy-schema.js';
import { heuristicEvaluate } from './heuristic.js';

// 浏览器侧 AI 客户端：政策文本发往本地服务器，由服务器代理调用千问
// （API Key 只存在于服务器 .env，绝不进入前端）。
// 任何网络/服务故障都降级到本地启发式评估，游戏永不因 AI 挂掉而卡死。
export async function requestPolicyVerdict(snapshot, policy) {
  try {
    const res = await fetch('/api/ai/policy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: snapshot, policy }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const data = await res.json();
    if (!data?.result) throw new Error('empty result');
    return clampPolicyResult(data.result);
  } catch (err) {
    console.warn('千问裁决不可用，改用本地启发式评估：', err.message);
    return heuristicEvaluate(snapshot, policy);
  }
}
