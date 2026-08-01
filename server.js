const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = CONFIG.port || 8080;
const ROOT = __dirname;

// 读取 config.json
let CONFIG = {};
try {
  CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf-8'));
  console.log('config.json loaded');
} catch (e) {
  console.warn('config.json not found, using defaults:', e.message);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

// 代理飞书 API 请求
function proxyRequest(feishuPath, method, headers, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'open.feishu.cn',
      port: 443,
      path: feishuPath,
      method: method,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// 重试包装：关键 API 调用失败后重试 3 次，间隔 2 秒
async function proxyWithRetry(feishuPath, method, headers, body, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await proxyRequest(feishuPath, method, headers, body);
    } catch (e) {
      if (i === retries - 1) throw e;
      console.warn(`API retry ${i + 1}/${retries - 1}: ${feishuPath} (${e.message})`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // API 代理
  if (parsedUrl.pathname.startsWith('/api/proxy')) {
    const target = parsedUrl.query.target;
    if (!target) { res.writeHead(400); res.end('Missing target'); return; }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const authHeader = req.headers['x-feishu-token'] ? { 'Authorization': `Bearer ${req.headers['x-feishu-token']}` } : {};
        const result = await proxyWithRetry(decodeURIComponent(target), req.method, authHeader, body || null);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(result);
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 调试：查看原始记录
  if (parsedUrl.pathname === '/api/debug-records') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { baseToken, tableId, token } = JSON.parse(body || '{}');
        const authHeader = token ? { 'Authorization': `Bearer ${token}` } : {};
        const result = await proxyWithRetry(`/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/records?page_size=3`, 'GET', authHeader);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(result);
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 前端配置接口（不泄露 API key）
  if (parsedUrl.pathname === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      app_id: CONFIG.app_id || '',
      llm_model: CONFIG.llm_model || ''
    }));
    return;
  }

  // LLM API 代理
  if (parsedUrl.pathname === '/api/llm') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        if (!CONFIG.llm_endpoint || !CONFIG.llm_api_key) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: { message: 'LLM 未配置，请检查 config.json' } }));
          return;
        }
        const { model, temperature, maxTokens, messages } = JSON.parse(body || '{}');
        const llmBody = JSON.stringify({ model, messages, temperature, max_tokens: maxTokens });
        const llmUrl = new URL(CONFIG.llm_endpoint);
        const options = {
          hostname: llmUrl.hostname,
          port: llmUrl.port || 443,
          path: llmUrl.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${CONFIG.llm_api_key}`
          }
        };
        const result = await new Promise((resolve, reject) => {
          const req2 = https.request(options, res2 => {
            let data = '';
            res2.on('data', chunk => data += chunk);
            res2.on('end', () => resolve(data));
          });
          req2.on('error', reject);
          req2.write(llmBody);
          req2.end();
        });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(result);
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: { message: e.message } }));
      }
    });
    return;
  }

  // OPTIONS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Feishu-Token' });
    res.end();
    return;
  }

  // 静态文件
  let filePath = path.join(ROOT, parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname);
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
