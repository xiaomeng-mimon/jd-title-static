function getAppId() {
  return (window.APP_CONFIG && window.APP_CONFIG.app_id) || '';
}
let accessToken = null;

// 通过本地代理调用飞书 API（避免 CORS）
async function feishuApi(method, path, body, params) {
  let targetPath = path;
  if (params) { const qs = new URLSearchParams(params).toString(); targetPath += '?' + qs; }

  const headers = {};
  if (accessToken) headers['x-feishu-token'] = accessToken;

  const opts = { method, headers };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const res = await fetch(`/api/proxy?target=${encodeURIComponent(targetPath)}`, opts);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`API ${path} failed: ${data.msg || JSON.stringify(data)}`);
  return data.data;
}

async function getTenantToken(appSecret) {
  const res = await fetch('/api/proxy?target=' + encodeURIComponent('/open-apis/auth/v3/tenant_access_token/internal'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: getAppId(), app_secret: appSecret })
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error('获取 token 失败: ' + (data.msg || JSON.stringify(data)));
  accessToken = data.tenant_access_token;
  return accessToken;
}

function setToken(token) { accessToken = token; }

// OAuth 登录后从服务端获取 token
async function initOAuthToken() {
  const res = await fetch('/api/feishu-token');
  const data = await res.json();
  if (data.token) {
    accessToken = data.token;
    return accessToken;
  }
  throw new Error('获取飞书 Token 失败');
}
function getToken() { return accessToken; }

async function getTableList(baseToken) {
  const data = await feishuApi('GET', `/open-apis/bitable/v1/apps/${baseToken}/tables`);
  return data.items;
}

async function getFieldList(baseToken, tableId) {
  const data = await feishuApi('GET', `/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/fields`);
  return data.items.map(f => ({ id: f.field_id, name: f.field_name, type: f.type }));
}

async function runDataQuery(baseToken, tableId, dslBody) {
  const dsl = { table_id: tableId, datasource: { table: { tableId } }, ...dslBody };
  const data = await feishuApi('POST', `/open-apis/base/v3/bases/${baseToken}/data/query`, dsl);
  return data.main_data;
}

async function fetchRecords(baseToken, tableId, pageSize = 200) {
  const allRecords = [];
  let pageToken = null;
  while (true) {
    const params = { page_size: pageSize };
    if (pageToken) params.page_token = pageToken;
    const data = await feishuApi('GET', `/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/records`, null, params);
    if (!data.items || !data.items.length) break;
    for (const item of data.items) {
      const flat = {};
      for (const [k, v] of Object.entries(item.fields)) {
        flat[k] = typeof v === 'object' && v !== null && 'value' in v ? v : { value: v };
      }
      flat['record_id'] = { value: item.record_id };
      allRecords.push(flat);
    }
    if (!data.has_more) break;
    pageToken = data.page_token;
  }
  return allRecords;
}

// 带缓存的记录拉取（通过服务端缓存，避免每次全量）
async function fetchRecordsCached(baseToken, tableId) {
  const res = await fetch('/api/cache/fetch-records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseToken, tableId })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '缓存取数失败');
  console.log(`[缓存] ${data.fromCache ? '命中' : '全量拉取'}，共 ${data.total} 条${data.cachedAt ? '，缓存时间: ' + data.cachedAt : ''}`);
  return data.records;
}

async function getTableListWithInfo(baseToken) {
  const tables = await getTableList(baseToken);
  return tables.map(t => ({ id: t.table_id, name: t.name }));
}

async function parseWikiToken(wikiToken) {
  const data = await feishuApi('GET', `/open-apis/wiki/v2/spaces/get_node`, null, { token: wikiToken });
  return data.node.obj_token;
}

function parseBaseUrl(url) {
  url = url.trim();
  const baseMatch = url.match(/\/base\/([a-zA-Z0-9]+)/);
  if (baseMatch) return { type: 'base', token: baseMatch[1] };
  const wikiMatch = url.match(/\/wiki\/([a-zA-Z0-9]+)/);
  if (wikiMatch) return { type: 'wiki', token: wikiMatch[1] };
  if (/^[a-zA-Z0-9]{20,}$/.test(url)) return { type: 'base', token: url };
  throw new Error('无法解析 URL 格式');
}

async function resolveBaseToken(url) {
  const parsed = parseBaseUrl(url);
  if (parsed.type === 'wiki') return await parseWikiToken(parsed.token);
  return parsed.token;
}
