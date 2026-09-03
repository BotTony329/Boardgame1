// 政策裁决请求的共用处理器：本地服务器（server.js）与 Vercel Function（api/ai/policy.js）
// 挂载同一份逻辑，避免两套实现漂移。
import { evaluatePolicy } from './ai-proxy.js';
import { config } from './config.js';

export async function handlePolicyRequest(body) {
  const state = body?.state;
  const policy = body?.policy;
  if (!state || !policy?.text) {
    return { status: 400, payload: { error: '需要 state 与 policy.text' } };
  }
  // 只接收裁决必需的字段：客户端状态永不被信任为完整游戏状态
  const snapshot = {
    turn: Number(state.turn) || 1,
    stage: String(state.stage || '部落'),
    nationName: String(state.nationName || '无名之邦').slice(0, 30),
    pop: Number(state.pop) || 0,
    soldiers: Number(state.soldiers) || 0,
    stability: Number(state.stability) || 50,
    appeal: Number(state.appeal) || 10,
    cellCount: Number(state.cellCount) || 1,
    food: Number(state.food) || 0,
    minerals: Number(state.minerals) || 0,
    energy: Number(state.energy) || 0,
    landYield: state.landYield && typeof state.landYield === 'object' ? state.landYield : undefined,
    statutes: Array.isArray(state.statutes) ? state.statutes.slice(0, 5).map((s) => String(s).slice(0, 60)) : [],
    activePolicies: Array.isArray(state.activePolicies)
      ? state.activePolicies.slice(0, 4).map((p) => ({
        text: String(p?.text || '').slice(0, 60),
        potency: Number(p?.potency) || 0,
      }))
      : [],
    recentPolicies: Array.isArray(state.recentPolicies)
      ? state.recentPolicies.slice(-3).map((p) => String(p).slice(0, 80))
      : [],
  };
  const cleanPolicy = {
    domain: String(policy.domain || ''),
    text: String(policy.text).slice(0, 500),
    continuation: Boolean(policy.continuation),
  };
  try {
    const result = await evaluatePolicy(config, snapshot, cleanPolicy);
    return { status: 200, payload: { result } };
  } catch (err) {
    const status = err.statusCode || (/invalid json|需要/.test(err.message) ? 400 : 502);
    return { status, payload: { error: err.message || 'internal error' } };
  }
}
