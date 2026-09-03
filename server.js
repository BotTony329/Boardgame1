import http from 'node:http';
import { config } from './server/config.js';
import { serveStatic, readJsonBody } from './server/static.js';
import { evaluatePolicy } from './server/ai-proxy.js';

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/ai/policy') {
      const body = await readJsonBody(req);
      const state = body?.state;
      const policy = body?.policy;
      // 只接收裁决必需的字段：客户端状态永不被信任为完整游戏状态
      if (!state || !policy?.text) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: '需要 state 与 policy.text' }));
        return;
      }
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
        recentPolicies: Array.isArray(state.recentPolicies)
          ? state.recentPolicies.slice(-3).map((p) => String(p).slice(0, 80))
          : [],
      };
      const cleanPolicy = {
        domain: String(policy.domain || ''),
        text: String(policy.text).slice(0, 500),
        continuation: Boolean(policy.continuation),
      };
      const result = await evaluatePolicy(config, snapshot, cleanPolicy);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ result }));
      return;
    }

    if (req.method === 'GET') {
      serveStatic(config.publicDir, req.url.split('?')[0], res);
      return;
    }

    res.writeHead(405).end('method not allowed');
  } catch (err) {
    const status = err.statusCode || (/invalid json|需要/.test(err.message) ? 400 : 502);
    res.writeHead(status, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: err.message || 'internal error' }));
  }
});

server.listen(config.port, () => {
  console.log(`格子天下已启动: http://localhost:${config.port}`);
  if (!config.apiKey) console.warn('警告: 未配置 QWEN_API_KEY，AI 裁决将不可用（客户端会走启发式兜底）');
});
