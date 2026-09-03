import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(serverDir, '..');

function readEnvFile(file) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    // .env 缺失时允许纯环境变量方式运行（如已 export），不算错误
  }
}

readEnvFile(path.join(projectRoot, '.env'));

export const config = {
  port: Number(process.env.PORT || 8787),
  apiKey: process.env.QWEN_API_KEY || '',
  baseUrl: (process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, ''),
  model: process.env.QWEN_MODEL || 'qwen3.7-flash',
  publicDir: path.join(projectRoot, 'public'),
};
