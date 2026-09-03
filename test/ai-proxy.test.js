import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, clampPolicyResult, evaluatePolicy, CLAMPS } from '../server/ai-proxy.js';

test('extractJson 能处理裸 JSON、围栏包裹与前后杂文', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('裁决如下：{"a":1,"b":{"c":2}} 以上。'), { a: 1, b: { c: 2 } });
  // 字符串内的花括号不应破坏配平
  assert.deepEqual(extractJson('{"s":"包含 } 与 { 的文本","n":3}'), { s: '包含 } 与 { 的文本', n: 3 });
  assert.throws(() => extractJson('完全没有对象'));
});

test('clampPolicyResult 钳制越界数值并补齐缺省', () => {
  const out = clampPolicyResult({
    verdict: '超正',
    narrative: 'x'.repeat(500),
    populationChangePct: 999,
    stabilityChange: -100,
    appealChange: 55,
    resourceChanges: { food: 120, minerals: -999 },
    risks: ['a', 'b', 'c', 'd'],
  });
  assert.equal(out.verdict, 'neutral', '非法 verdict 回落 neutral');
  assert.equal(out.narrative.length, 300);
  assert.equal(out.populationChangePct, CLAMPS.populationChangePct[1]);
  assert.equal(out.stabilityChange, CLAMPS.stabilityChange[0]);
  assert.equal(out.appealChange, CLAMPS.appealChange[1]);
  assert.equal(out.resourceChanges.food, CLAMPS.resourcePct[1]);
  assert.equal(out.resourceChanges.minerals, CLAMPS.resourcePct[0]);
  assert.equal(out.resourceChanges.energy, 0, '缺失资源回 0');
  assert.equal(out.risks.length, 3);
  assert.equal(out.source, 'qwen');
});

test('clampPolicyResult 对完全畸形输入安全', () => {
  const out = clampPolicyResult(null);
  assert.equal(out.verdict, 'neutral');
  assert.equal(out.populationChangePct, 0);
  assert.equal(out.source, 'qwen');
  const out2 = clampPolicyResult({ source: 'fallback', narrative: 'ok' });
  assert.equal(out2.source, 'fallback');
});

const CONFIG = { baseUrl: 'https://mock', apiKey: 'k', model: 'm' };
const STATE = {
  turn: 3, stage: '部落', nationName: '测试', pop: 300, soldiers: 0,
  stability: 60, appeal: 15, cellCount: 1, food: 200, minerals: 40, energy: 40,
  landYield: { food: 6, minerals: 1, energy: 0.5 }, recentPolicies: [],
};
const POLICY = { domain: 'economy', text: '轻徭薄赋' };

function mockFetch(responses) {
  let call = 0;
  return async () => {
    const body = responses[Math.min(call, responses.length - 1)];
    call++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: body } }] }) };
  };
}

test('evaluatePolicy 正常路径：返回钳制后的裁决', async () => {
  const fetchImpl = mockFetch(['{"verdict":"positive","narrative":"万民称便","populationChangePct":3.5,"stabilityChange":5,"appealChange":6,"resourceChanges":{"food":-10,"minerals":0,"energy":0},"risks":[]}']);
  const result = await evaluatePolicy(CONFIG, STATE, POLICY, fetchImpl);
  assert.equal(result.verdict, 'positive');
  assert.equal(result.populationChangePct, 3.5);
  assert.equal(result.source, 'qwen');
});

test('evaluatePolicy 非法 JSON 自动重试一次后成功', async () => {
  const fetchImpl = mockFetch([
    '抱歉，我无法输出 JSON。',
    '{"verdict":"negative","narrative":"民怨沸腾","populationChangePct":-4,"stabilityChange":-8,"appealChange":-6,"resourceChanges":{"food":0,"minerals":0,"energy":0},"risks":["动荡"]}',
  ]);
  const result = await evaluatePolicy(CONFIG, STATE, POLICY, fetchImpl);
  assert.equal(result.verdict, 'negative');
});

test('evaluatePolicy 两次失败后抛错（走客户端兜底）', async () => {
  const fetchImpl = mockFetch(['还是不行']);
  await assert.rejects(() => evaluatePolicy(CONFIG, STATE, POLICY, fetchImpl));
});
