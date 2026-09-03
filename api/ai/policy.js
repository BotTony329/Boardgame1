// Vercel Serverless Function：路由 /api/ai/policy
// 与本地服务器（server.js）共用同一份裁决逻辑（server/handler.js）。
// 环境变量 QWEN_API_KEY 在 Vercel 项目设置中配置，不落仓库。
import { handlePolicyRequest } from '../../server/handler.js';

// 千问调用存在长尾延迟，给满 Hobby 计划上限
export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  // Vercel Node 运行时会自动解析 JSON body；兼容字符串与对象两种形态
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const { status, payload } = await handlePolicyRequest(body);
  res.status(status).json(payload);
}
