import http from 'node:http';
import { config } from './server/config.js';
import { serveStatic, readJsonBody } from './server/static.js';
import { handlePolicyRequest } from './server/handler.js';

// 本地开发/自托管入口。Vercel 部署使用 api/ai/policy.js（同一份处理逻辑）。
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/ai/policy') {
      const body = await readJsonBody(req);
      const { status, payload } = await handlePolicyRequest(body);
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
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
