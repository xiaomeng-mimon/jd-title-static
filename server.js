const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

// ── 配置 ──
let CONFIG = {};
try {
  CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf-8'));
} catch (e) { console.warn('config.json not found'); }

const APP_ID = CONFIG.app_id || '';
const APP_SECRET = CONFIG.app_secret || '';
const PORT = CONFIG.port || 8080;
const APP_URL = `http://192.168.101.13:${PORT}`;

const CT_JSON = { 'Content-Type': 'application/json; charset=utf-8' };
const CT_HTML = { 'Content-Type': 'text/html; charset=utf-8' };
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'
};

// ── 权限存储 ──
const APPROVED_PATH = path.join(ROOT, 'approved.json');
function loadApproved() { try { return JSON.parse(fs.readFileSync(APPROVED_PATH, 'utf-8')); } catch { return {}; } }
function saveApproved(data) { fs.writeFileSync(APPROVED_PATH, JSON.stringify(data, null, 2)); }
function isApproved(openId) { const a = loadApproved(); return !!(a[openId]); }
function approveUser(openId, userName, department) {
  const a = loadApproved();
  a[openId] = { userName, department: department || '', approvedAt: new Date().toISOString() };
  saveApproved(a);
}

// ── 数据缓存（记忆机制，避免每次全量拉取） ──
const CACHE_DIR = path.join(ROOT, 'cache');
function ensureCacheDir() { if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true }); }
function getCachePath(tableId) { return path.join(CACHE_DIR, `records_${tableId}.json`); }
function getCacheMetaPath() { return path.join(CACHE_DIR, '_meta.json'); }

function loadCacheMeta() {
  try { return JSON.parse(fs.readFileSync(getCacheMetaPath(), 'utf-8')); } catch { return {}; }
}
function saveCacheMeta(meta) {
  ensureCacheDir();
  fs.writeFileSync(getCacheMetaPath(), JSON.stringify(meta, null, 2));
}

function loadCachedRecords(tableId) {
  try { return JSON.parse(fs.readFileSync(getCachePath(tableId), 'utf-8')); } catch { return null; }
}
function saveCachedRecords(tableId, records, total) {
  ensureCacheDir();
  fs.writeFileSync(getCachePath(tableId), JSON.stringify(records));
  const meta = loadCacheMeta();
  meta[tableId] = { total, updatedAt: new Date().toISOString() };
  saveCacheMeta(meta);
}

// 单次分页拉取
async function fetchRecordsOnce(baseToken, tableId) {
  const t = await getTenantToken();
  const all = [];
  let pageToken = null;
  while (true) {
    const qs = `page_size=200${pageToken ? '&page_token=' + pageToken : ''}`;
    const data = await feishuReq('GET',
      `/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/records?${qs}`, null, t);
    if (data.code !== 0 || !data.data) throw new Error(data.msg || 'fetch failed');
    const items = data.data.items || [];
    for (const item of items) {
      const flat = {};
      for (const [k, v] of Object.entries(item.fields)) {
        flat[k] = typeof v === 'object' && v !== null && 'value' in v ? v : { value: v };
      }
      flat['record_id'] = { value: item.record_id };
      all.push(flat);
    }
    if (!data.data.has_more) break;
    pageToken = data.data.page_token;
  }
  return all;
}

// 双重拉取合并去重，消除分页漂移
async function fetchAllRecords(baseToken, tableId) {
  const [batch1, batch2] = await Promise.all([
    fetchRecordsOnce(baseToken, tableId),
    fetchRecordsOnce(baseToken, tableId)
  ]);
  const seen = new Set();
  const merged = batch1.concat(batch2).filter(r => {
    const id = r.record_id?.value;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  saveCachedRecords(tableId, merged, merged.length);
  return merged;
}

const sessions = new Map();
const pendingRequests = new Map();

// ── 工具 ──
function parseBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
  });
}
function sendJSON(res, code, data) {
  res.writeHead(code, { ...CT_JSON, 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

// ── 飞书 API ──
function feishuReq(method, feishuPath, data, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'open.feishu.cn', port: 443, path: feishuPath, method,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    };
    const r = https.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({ raw: body }); } });
    });
    r.on('error', reject);
    if (data) r.write(JSON.stringify(data));
    r.end();
  });
}

// app_access_token 缓存
let appToken = null, appTokenExpiry = 0;
async function getAppToken() {
  if (appToken && Date.now() < appTokenExpiry) return appToken;
  const d = await feishuReq('POST', '/open-apis/auth/v3/app_access_token/internal',
    { app_id: APP_ID, app_secret: APP_SECRET });
  if (d.code !== 0 || !d.app_access_token) throw new Error('app token failed');
  appToken = d.app_access_token;
  appTokenExpiry = Date.now() + (d.expire - 300) * 1000;
  return appToken;
}

// tenant_access_token 缓存
let tenantToken = null, tenantTokenExpiry = 0;
async function getTenantToken() {
  if (tenantToken && Date.now() < tenantTokenExpiry) return tenantToken;
  const d = await feishuReq('POST', '/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: APP_ID, app_secret: APP_SECRET });
  if (d.code !== 0) throw new Error('tenant token failed');
  tenantToken = d.tenant_access_token;
  tenantTokenExpiry = Date.now() + (d.expire - 300) * 1000;
  return tenantToken;
}

// 应用所有者（缓存 1 分钟，避免权限转让后旧主还能进管理页太久）
let ownerCache = null, ownerCacheTime = 0;
async function getAppOwnerId() {
  if (ownerCache && Date.now() - ownerCacheTime < 60000) return ownerCache;
  try {
    const t = await getAppToken();
    const d = await feishuReq('GET',
      `/open-apis/application/v6/applications/${APP_ID}/collaborators`, null, t);
    const owners = (d.data?.collaborators || []).filter(c => c.type === 'owner');
    ownerCache = owners.length > 0 ? owners[0].user_id : '';
    ownerCacheTime = Date.now();
    return ownerCache;
  } catch (e) { console.warn('getAppOwnerId failed:', e.message); return ownerCache || ''; }
}

// 部门查询
async function getDepartment(openId, userToken) {
  if (userToken) {
    try {
      const d = await feishuReq('GET',
        `/open-apis/contact/v3/users/${openId}`, null, userToken);
      if (d.code === 0 && d.data?.user?.department_ids?.length > 0) {
        console.log('[部门] 获取成功:', d.data.user.department_ids.join(','));
        return d.data.user.department_ids.join(',');
      }
      if (d.code !== 0) console.warn('[部门] 用户token查询失败:', d.code, d.msg);
    } catch (e) { console.error('[部门] 用户token方式失败:', e.message); }
  }

  try {
    const t = await getTenantToken();
    const d = await feishuReq('GET',
      `/open-apis/contact/v3/users/${openId}`, null, t);
    if (d.code === 0 && d.data?.user?.department_ids?.length > 0) {
      console.log('[部门] 租户token获取成功:', d.data.user.department_ids.join(','));
      return d.data.user.department_ids.join(',');
    }
    if (d.code !== 0) console.warn('[部门] 租户token查询失败:', d.code, d.msg);
  } catch (e) { console.error('[部门] 租户token方式失败:', e.message); }

  return '';
}

// ── 机器人发消息 ──
async function sendBotMsg(openId, title, content, url, color) {
  try {
    const t = await getTenantToken();
    const parts = content.split('\n');
    const divs = parts.map(p => '{"tag":"div","text":{"tag":"lark_md","content":"' + p.replace(/"/g, '\\"') + '"}}').join(',');
    const elements = [divs];
    if (url) {
      elements.push('{"tag":"action","actions":[{"tag":"button","text":{"tag":"plain_text","content":"进入应用"},"type":"primary","multi_url":{"url":"' + url + '"}}]}');
    }
    const card = '{"header":{"title":{"tag":"plain_text","content":"' + title + '"},"template":"' + (color || 'blue') + '"},"elements":[' + elements.join(',') + ']}';
    await feishuReq('POST', '/open-apis/im/v1/messages?receive_id_type=open_id',
      { receive_id: openId, msg_type: 'interactive', content: card }, t);
  } catch (e) { console.error('sendBotMsg failed:', e.message); }
}

async function sendApproveCard(userName, openId, department) {
  try {
    const owner = await getAppOwnerId();
    if (!owner) return;
    const content = '用户：' + userName + '\n' + (department ? '部门：' + department + '\n' : '') + '申请访问米萌标题智能运营';
    const parts = content.split('\n');
    const divs = parts.map(p => '{"tag":"div","text":{"tag":"lark_md","content":"' + p.replace(/"/g, '\\"') + '"}}').join(',');
    const adminUrl = APP_URL + '/admin.html';
    const card = '{"header":{"title":{"tag":"plain_text","content":"权限申请"},"template":"blue"},"elements":[' + divs +
      ',{"tag":"action","actions":[{"tag":"button","text":{"tag":"plain_text","content":"查看申请"},"type":"primary","multi_url":{"url":"' + adminUrl + '"}}]}]}';
    await feishuReq('POST', '/open-apis/im/v1/messages?receive_id_type=open_id',
      { receive_id: owner, msg_type: 'interactive', content: card }, await getTenantToken());
  } catch (e) { console.error('sendApproveCard failed:', e.message); }
}

// ── 重试 API（供 /api/proxy 使用） ──
function proxyRequest(feishuPath, method, headers, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'open.feishu.cn', port: 443, path: feishuPath, method,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
    };
    const r = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function proxyWithRetry(feishuPath, method, headers, body, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await proxyRequest(feishuPath, method, headers, body); }
    catch (e) { if (i === retries - 1) throw e; await new Promise(r => setTimeout(r, 2000)); }
  }
}

// ── Router ──
const router = {

  'POST /api/auth/verify': async (req, res) => {
    try {
      const body = await parseBody(req);
      if (!body.code) { sendJSON(res, 400, { ok: false, error: '缺少 code' }); return; }
      const appToken = await getAppToken();
      const uData = await feishuReq('POST', '/open-apis/authen/v1/access_token',
        { grant_type: 'authorization_code', code: body.code }, appToken);
      if (uData.code !== 0 || !uData.data) throw new Error(uData.msg || 'code 无效');
      const iData = await feishuReq('GET', '/open-apis/authen/v1/user_info', null, uData.data.access_token);
      if (iData.code !== 0 || !iData.data) throw new Error('用户信息获取失败');
      const openId = iData.data.open_id;
      const userName = iData.data.name;
      let department = '';
      try { department = await getDepartment(openId, uData.data.access_token); } catch (e) { /* ignore */ }
      const appOwner = await getAppOwnerId();
      const isOwner = (openId === appOwner);
      const approved = isOwner || isApproved(openId);
      if (isOwner && !isApproved(openId)) { approveUser(openId, userName, department); }
      if (approved && department) {
        const a = loadApproved();
        if (a[openId] && !a[openId].department) {
          a[openId].department = department;
          saveApproved(a);
          console.log('[部门] 已更新', userName, '部门:', department);
        }
      }
      const crypto = require('crypto');
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, { openId, userName, department, approved, createdAt: Date.now() });
      sendJSON(res, 200, { ok: true, token, userName, department, pending: !approved, openId });
    } catch (e) { sendJSON(res, 500, { ok: false, error: e.message }); }
  },

  'POST /api/auth/request': async (req, res) => {
    try {
      const body = await parseBody(req);
      const { openId, userName } = body;
      if (!openId || !userName) { sendJSON(res, 400, { ok: false, error: '参数不全' }); return; }
      if (isApproved(openId)) { sendJSON(res, 200, { ok: true, message: '你的权限已审批通过，请刷新页面' }); return; }
      pendingRequests.set(openId, { userName, department: body.department || '', requestedAt: new Date().toISOString() });
      sendApproveCard(userName, openId, body.department || '');
      sendJSON(res, 200, { ok: true, message: '已提交申请，等待管理员审批' });
    } catch (e) { sendJSON(res, 500, { ok: false, error: e.message }); }
  },

  'GET /api/auth/status': async (req, res) => {
    const parsed = new URL(req.url, 'http://localhost');
    const openId = parsed.searchParams.get('openId');
    if (!openId) { sendJSON(res, 400, { approved: false }); return; }
    sendJSON(res, 200, { approved: isApproved(openId) });
  },

  'GET /api/approve': async (req, res) => {
    const parsed = new URL(req.url, 'http://localhost');
    const openId = parsed.searchParams.get('openId');
    const userName = parsed.searchParams.get('userName');
    const action = parsed.searchParams.get('action');
    if (!openId || !action) { res.writeHead(400, CT_HTML); res.end('<h2>参数错误</h2>'); return; }
    const isApprove = action === 'approve';
    const reqInfo = pendingRequests.get(openId);
    pendingRequests.delete(openId);
    if (isApprove) {
      approveUser(openId, userName, reqInfo?.department || '');
      sendBotMsg(openId, '审批通过', (reqInfo?.department ? '部门：' + reqInfo.department + '\n' : '') + '你的访问权限已通过，现在可以正常使用了。', APP_URL, 'green');
    } else {
      sendBotMsg(openId, '审批未通过', (reqInfo?.department ? '部门：' + reqInfo.department + '\n' : '') + '你的访问申请未通过，如有疑问请联系管理员。', '', 'red');
    }
    const color = isApprove ? '#2e7d32' : '#c62828';
    const bg = isApprove ? '#f0f8f0' : '#fff5f5';
    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="text-align:center;padding:60px 20px;font-family:sans-serif;background:' + bg + '"><p style="font-size:18px;color:' + color + '">' + (isApprove ? '已通过 ' : '已拒绝 ') + (userName || '') + '</p><script>setTimeout(function(){location.href="/admin.html"},800)</script></body></html>';
    res.writeHead(200, CT_HTML);
    res.end(html);
  },

  'POST /api/approve': async (req, res) => {
    const body = await parseBody(req);
    const { openId, userName, action } = body;
    if (!openId || !action) { sendJSON(res, 400, { ok: false }); return; }
    const isApprove = action === 'approve';
    const reqInfo = pendingRequests.get(openId);
    pendingRequests.delete(openId);
    if (isApprove) {
      approveUser(openId, userName, reqInfo?.department || '');
      sendBotMsg(openId, '审批通过', (reqInfo?.department ? '部门：' + reqInfo.department + '\n' : '') + '你的访问权限已通过，现在可以正常使用了。', APP_URL, 'green');
    } else {
      sendBotMsg(openId, '审批未通过', (reqInfo?.department ? '部门：' + reqInfo.department + '\n' : '') + '你的访问申请未通过，如有疑问请联系管理员。', '', 'red');
    }
    sendJSON(res, 200, { ok: true });
  },

  'GET /api/admin/users': async (req, res) => {
    const tok = req.headers['x-auth-token'] || '';
    const session = sessions.get(tok);
    if (!session || session.openId !== await getAppOwnerId()) { sendJSON(res, 403, { ok: false, error: '仅应用所有者可操作' }); return; }
    const pending = [];
    pendingRequests.forEach((v, k) => { pending.push({ openId: k, ...v }); });
    sendJSON(res, 200, { ok: true, users: loadApproved(), pending });
  },

  'POST /api/admin/revoke': async (req, res) => {
    try {
      const tok = req.headers['x-auth-token'] || '';
      const session = sessions.get(tok);
      if (!session || session.openId !== await getAppOwnerId()) { sendJSON(res, 403, { ok: false, error: '仅应用所有者可操作' }); return; }
      const body = await parseBody(req);
      if (!body.openId) { sendJSON(res, 400, { ok: false }); return; }
      const a = loadApproved();
      if (a[body.openId]?.isOwner) { sendJSON(res, 400, { ok: false, error: '不能撤销应用所有者' }); return; }
      delete a[body.openId];
      saveApproved(a);
      sendJSON(res, 200, { ok: true });
    } catch (e) { sendJSON(res, 500, { ok: false, error: e.message }); }
  },

  'GET /api/feishu-token': async (req, res) => {
    try {
      const token = await getTenantToken();
      sendJSON(res, 200, { token });
    } catch (e) { sendJSON(res, 500, { error: e.message }); }
  },

  'GET /api/config': async (req, res) => {
    sendJSON(res, 200, {
      app_id: APP_ID,
      llm_model: CONFIG.llm_model || ''
    });
  },

  'POST /api/cache/fetch-records': async (req, res) => {
    try {
      const body = await parseBody(req);
      const { baseToken, tableId } = body;
      if (!baseToken || !tableId) { sendJSON(res, 400, { ok: false, error: '缺少 baseToken 或 tableId' }); return; }

      // 有缓存直接返回
      const meta = loadCacheMeta();
      const cached = meta[tableId];
      if (cached && cached.total > 0) {
        const records = loadCachedRecords(tableId);
        if (records) {
          sendJSON(res, 200, { ok: true, fromCache: true, total: cached.total, records, cachedAt: cached.updatedAt });
          return;
        }
      }

      // 无缓存 → 双重拉取合并去重
      const records = await fetchAllRecords(baseToken, tableId);
      sendJSON(res, 200, { ok: true, fromCache: false, total: records.length, records, cachedAt: new Date().toISOString() });
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: e.message });
    }
  },

  'POST /api/debug-records': async (req, res) => {
    try {
      const body = await parseBody(req);
      const { baseToken, tableId, token } = body;
      if (!baseToken || !tableId) { sendJSON(res, 400, { ok: false }); return; }
      const data = await feishuReq('GET',
        `/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/records?page_size=1`, null, token || await getTenantToken());
      sendJSON(res, 200, data);
    } catch (e) { sendJSON(res, 500, { ok: false, error: e.message }); }
  },

  'POST /api/cache/invalidate': async (req, res) => {
    try {
      const body = await parseBody(req);
      const { tableId } = body;
      if (!tableId) { sendJSON(res, 400, { ok: false, error: '缺少 tableId' }); return; }
      const cachePath = getCachePath(tableId);
      if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
      const meta = loadCacheMeta();
      delete meta[tableId];
      saveCacheMeta(meta);
      sendJSON(res, 200, { ok: true, message: '缓存已清除' });
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: e.message });
    }
  }
};

// ── HTTP Server ──
http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const k = `${req.method} ${parsed.pathname}`;

  if (router[k]) { await router[k](req, res); return; }

  if (parsed.pathname.startsWith('/api/proxy')) {
    const target = parsed.searchParams.get('target');
    if (!target) { res.writeHead(400); res.end('Missing target'); return; }
    try {
      const body = await parseBody(req);
      const authHeader = req.headers['x-feishu-token'] ? { 'Authorization': `Bearer ${req.headers['x-feishu-token']}` } : {};
      const proxyBody = body.body ? JSON.stringify(body.body) : (Object.keys(body).length > 0 ? JSON.stringify(body) : null);
      const result = await proxyWithRetry(decodeURIComponent(target), req.method, authHeader, proxyBody);
      res.writeHead(200, { ...CT_JSON, 'Access-Control-Allow-Origin': '*' });
      res.end(result);
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (parsed.pathname === '/api/llm') {
    try {
      const body = await parseBody(req);
      console.log("[LLM]", body.model || "?", "-> xinmeiti");
      const payload = JSON.stringify({
        model: body.model,
        messages: body.messages,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
        endpoint: body.endpoint || '',
        apiKey: body.apiKey || '',
        thinking: body.thinking
      });
      const result = await new Promise((resolve, reject) => {
        const r = http.request({
          hostname: 'localhost', port: 5000, path: '/api/llm', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, res2 => { let d = ''; res2.on('data', c => d += c); res2.on('end', () => resolve(d)); });
        r.on('error', reject); r.write(payload); r.end();
      });
      res.writeHead(200, { ...CT_JSON, 'Access-Control-Allow-Origin': '*' });
      res.end(result);
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: { message: e.message } }));
    }
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-Feishu-Token,X-Auth-Token'
    });
    res.end();
    return;
  }

  let p = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  const fp = path.join(ROOT, 'public', p);
  if (!fp.startsWith(path.join(ROOT, 'public'))) { res.writeHead(403); res.end(); return; }
  const ext = path.extname(fp);
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
