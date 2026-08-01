const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = __dirname;

// 读取 config.json
let CONFIG = {};
try {
  CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf-8'));
  console.log('config.json loaded');
} catch (e) {
  console.warn('config.json not found, using defaults:', e.message);
}

const PORT = CONFIG.port || 8080;

// ── OAuth 基础设施 ──

// 权限存储
const APPROVED_PATH = path.join(ROOT, 'approved.json');
let approved = {};
try { approved = JSON.parse(fs.readFileSync(APPROVED_PATH, 'utf-8')); } catch (e) { console.log('approved.json 不存在，初始化空列表'); }

function saveApproved() {
  fs.writeFileSync(APPROVED_PATH, JSON.stringify(approved, null, 2));
}

// 会话（内存，重启失效）
const sessions = new Map();       // sessionToken → { openId, userName, expires }
const pendingRequests = new Map(); // openId → { userName, department, requestedAt }

// app_access_token 缓存
let appAccessToken = null;
let appAccessTokenExpiry = 0;

async function getAppAccessToken() {
  if (appAccessToken && Date.now() < appAccessTokenExpiry) return appAccessToken;
  const result = await proxyRequest(
    '/open-apis/auth/v3/app_access_token/internal',
    'POST',
    {},
    JSON.stringify({ app_id: CONFIG.app_id, app_secret: CONFIG.app_secret })
  );
  const data = JSON.parse(result);
  if (data.code !== 0) throw new Error('获取 app_access_token 失败: ' + (data.msg || ''));
  appAccessToken = data.app_access_token;
  appAccessTokenExpiry = Date.now() + (data.expire - 300) * 1000;
  return appAccessToken;
}

// 应用所有者缓存（10 分钟）
let ownerCache = null;
let ownerCacheTime = 0;

async function getAppOwnerId() {
  if (ownerCache && Date.now() - ownerCacheTime < 600000) return ownerCache;
  try {
    // 需要 app_access_token，内部 API 会通过 Authorization header
    const token = await getAppAccessToken();
    const result = await proxyWithRetry(
      `/open-apis/application/v6/applications/${CONFIG.app_id}/collaborators`,
      'GET',
      { 'Authorization': `Bearer ${token}` },
      null
    );
    const data = JSON.parse(result);
    const owners = (data.data?.collaborators || []).filter(c => c.type === 'owner');
    ownerCache = owners.map(o => o.user_id);
    ownerCacheTime = Date.now();
    return ownerCache;
  } catch (e) {
    console.warn('getAppOwnerId 失败:', e.message);
    return ownerCache || [];
  }
}

function isAppOwner(openId) {
  return ownerCache && ownerCache.includes(openId);
}

// 生成 session token
function generateToken() {
  return 'st_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
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

  // 服务端飞书 Token（OAuth 登录后前端通过此接口拿 token，不用手动输 App Secret）
  if (parsedUrl.pathname === '/api/feishu-token') {
    try {
      const result = await proxyRequest(
        '/open-apis/auth/v3/tenant_access_token/internal',
        'POST',
        {},
        JSON.stringify({ app_id: CONFIG.app_id, app_secret: CONFIG.app_secret })
      );
      const data = JSON.parse(result);
      if (data.code !== 0) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: '获取 token 失败: ' + data.msg }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ token: data.tenant_access_token }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
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

  // ── OAuth 认证接口 ──

  // OAuth 回调：code 换 session token
  if (parsedUrl.pathname === '/api/auth/verify') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { code } = JSON.parse(body || '{}');
        if (!code) { res.writeHead(400); res.end(JSON.stringify({ error: '缺少 code' })); return; }

        // 1. 拿 app_access_token
        const appToken = await getAppAccessToken();

        // 2. code 换 user_access_token
        const tokenRes = JSON.parse(await proxyRequest(
          '/open-apis/authen/v1/access_token',
          'POST',
          { 'Authorization': `Bearer ${appToken}` },
          JSON.stringify({ grant_type: 'authorization_code', code })
        ));
        if (tokenRes.code !== 0) {
          res.writeHead(401);
          res.end(JSON.stringify({ error: 'token 交换失败: ' + tokenRes.msg }));
          return;
        }

        // 3. 拿用户信息
        const userRes = JSON.parse(await proxyRequest(
          '/open-apis/authen/v1/user_info',
          'GET',
          { 'Authorization': `Bearer ${tokenRes.data.access_token}` }
        ));
        if (userRes.code !== 0) {
          res.writeHead(401);
          res.end(JSON.stringify({ error: '获取用户信息失败: ' + userRes.msg }));
          return;
        }
        const openId = userRes.data.open_id;
        const userName = userRes.data.name || openId;

        // 4. 检查权限：应用所有者 or 在 approved.json 中
        const owners = await getAppOwnerId();
        const isOwner = owners.includes(openId);
        if (isOwner) {
          // 应用所有者自动通过
          const sessionToken = generateToken();
          sessions.set(sessionToken, { openId, userName, expires: Date.now() + 86400000 });
          approved[openId] = { userName, approvedAt: new Date().toISOString(), isOwner: true };
          saveApproved();
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ token: sessionToken, userName, openId, approved: true }));
          return;
        }

        if (approved[openId]) {
          const sessionToken = generateToken();
          sessions.set(sessionToken, { openId, userName, expires: Date.now() + 86400000 });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ token: sessionToken, userName, openId, approved: true }));
          return;
        }

        // 不在白名单 — 需要申请
        pendingRequests.set(openId, { userName, requestedAt: new Date().toISOString() });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ approved: false, openId, userName, message: '需要管理员审批' }));

      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 检查审批状态
  if (parsedUrl.pathname === '/api/auth/status') {
    const openId = parsedUrl.query.openId;
    if (!openId) { res.writeHead(400); res.end(JSON.stringify({ error: '缺少 openId' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ approved: !!approved[openId] }));
    return;
  }

  // 获取当前用户（从 session token）
  if (parsedUrl.pathname === '/api/auth/user') {
    const token = req.headers['x-auth-token'];
    if (!token || !sessions.has(token)) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: '未登录' }));
      return;
    }
    const session = sessions.get(token);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ openId: session.openId, userName: session.userName }));
    return;
  }

  // OPTIONS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Feishu-Token,X-Auth-Token' });
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
