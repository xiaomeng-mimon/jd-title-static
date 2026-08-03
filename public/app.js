let analysisData = null;
let generatedData = null;

function showLoading(text) { document.getElementById('loading-text').textContent = text || '加载中...'; document.getElementById('loading').style.display = 'flex'; }
function hideLoading() { document.getElementById('loading').style.display = 'none'; }
function setStepStatus(id, cls, text) { const el = document.getElementById(id); el.className = 'step-status ' + cls; el.textContent = text; }

// ── 本地数据聚合工具（替代 data/query API） ──
function normalizeDate(str) { if (!str) return ''; return String(str).replace(/\//g, '-').substring(0, 10); }

function filterAndAggregate(records, dateRange) {
  const { start, end } = dateRange || {};
  const normStart = start ? normalizeDate(start) : null;
  const normEnd = end ? normalizeDate(end) : null;
  let filtered = records;
  if (normStart) filtered = filtered.filter(r => normalizeDate(r['时间']?.value || '') >= normStart);
  if (normEnd) filtered = filtered.filter(r => normalizeDate(r['时间']?.value || '') <= normEnd);

  const dates = [...new Set(filtered.map(r => normalizeDate(r['时间']?.value || '')).filter(Boolean))].sort();
  const actualRange = { start: dates[0] || start || null, end: dates[dates.length - 1] || end || null, totalDays: dates.length, allDates: dates };

  const viewsArr = filtered.map(r => parseInt(r['视频观看次数']?.value || 0));
  const detailArr = filtered.map(r => parseInt(r['引导进商详访客数']?.value || 0));
  const gmvArr = filtered.map(r => parseInt(r['7天引导成交金额']?.value || 0));
  const buyersArr = filtered.map(r => parseInt(r['7天引导成交人数']?.value || 0));
  const n = filtered.length || 1;

  const stats = {
    'avg(视频观看次数)': { value: (viewsArr.reduce((a, b) => a + b, 0) / n).toFixed(1) },
    'max(视频观看次数)': { value: Math.max(...viewsArr, 0) },
    'min(视频观看次数)': { value: Math.min(...viewsArr.filter(v => v > 0), 0) || 0 },
    'count(视频观看次数)': { value: filtered.length },
    'avg(引导进商详访客数)': { value: (detailArr.reduce((a, b) => a + b, 0) / n).toFixed(1) },
    'avg(7天引导成交金额)': { value: (gmvArr.reduce((a, b) => a + b, 0) / n).toFixed(1) },
    'max(7天引导成交金额)': { value: Math.max(...gmvArr, 0) },
    'sum(7天引导成交金额)': { value: gmvArr.reduce((a, b) => a + b, 0) },
    'avg(7天引导成交人数)': { value: (buyersArr.reduce((a, b) => a + b, 0) / n).toFixed(1) },
    'max(7天引导成交人数)': { value: Math.max(...buyersArr, 0) }
  };

  const byTitle = {};
  for (const r of filtered) {
    const title = r['视频名称']?.value || '未知';
    const model = r['型号']?.value || '未知';
    const key = `${title}|||${model}`;
    if (!byTitle[key]) {
      byTitle[key] = { '视频名称': { value: title }, '型号': { value: model }, 'sum(视频观看次数)': { value: 0 }, 'sum(7天引导成交金额)': { value: 0 }, 'sum(7天引导成交人数)': { value: 0 }, 'sum(引导进商详访客数)': { value: 0 }, 'count(视频观看次数)': { value: 0 } };
    }
    byTitle[key]['sum(视频观看次数)'].value += parseInt(r['视频观看次数']?.value || 0);
    byTitle[key]['sum(7天引导成交金额)'].value += parseInt(r['7天引导成交金额']?.value || 0);
    byTitle[key]['sum(7天引导成交人数)'].value += parseInt(r['7天引导成交人数']?.value || 0);
    byTitle[key]['sum(引导进商详访客数)'].value += parseInt(r['引导进商详访客数']?.value || 0);
    byTitle[key]['count(视频观看次数)'].value += 1;
  }

  const titles = Object.values(byTitle).sort((a, b) => (b['sum(7天引导成交金额)'].value || 0) - (a['sum(7天引导成交金额)'].value || 0));

  return { stats, titles, dateRange: actualRange, totalRecords: filtered.length };
}

function buildDailyFromRecords(records) {
  const byDate = {};
  for (const r of records) {
    const date = normalizeDate(r['时间']?.value || '');
    if (!date) continue;
    if (!byDate[date]) byDate[date] = { views: 0, detail: 0, gmv: 0, buyers: 0, count: 0 };
    byDate[date].views += parseInt(r['视频观看次数']?.value || 0);
    byDate[date].detail += parseInt(r['引导进商详访客数']?.value || 0);
    byDate[date].gmv += parseInt(r['7天引导成交金额']?.value || 0);
    byDate[date].buyers += parseInt(r['7天引导成交人数']?.value || 0);
    byDate[date].count += 1;
  }
  return Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({
    '时间': { value: date },
    'sum(视频观看次数)': { value: v.views },
    'sum(引导进商详访客数)': { value: v.detail },
    'sum(7天引导成交金额)': { value: v.gmv },
    'sum(7天引导成交人数)': { value: v.buyers },
    'count(视频观看次数)': { value: v.count }
  }));
}

function buildModelDailyFromRecords(records) {
  const byKey = {};
  for (const r of records) {
    const date = normalizeDate(r['时间']?.value || '');
    const model = r['型号']?.value || '未知';
    if (!date) continue;
    const key = `${date}|||${model}`;
    if (!byKey[key]) byKey[key] = { views: 0, detail: 0, gmv: 0 };
    byKey[key].views += parseInt(r['视频观看次数']?.value || 0);
    byKey[key].detail += parseInt(r['引导进商详访客数']?.value || 0);
    byKey[key].gmv += parseInt(r['7天引导成交金额']?.value || 0);
  }
  return Object.entries(byKey).map(([k, v]) => {
    const [date, model] = k.split('|||');
    return { '时间': { value: date }, '型号': { value: model }, 'sum(视频观看次数)': { value: v.views }, 'sum(引导进商详访客数)': { value: v.detail }, 'sum(7天引导成交金额)': { value: v.gmv } };
  });
}

// ── 历史链接 ──
function getHistory() { try { return JSON.parse(localStorage.getItem('jd-url-history') || '[]'); } catch { return []; } }
function addHistory(url) { const list = getHistory().filter(u => u !== url); list.unshift(url); localStorage.setItem('jd-url-history', JSON.stringify(list.slice(0, 20))); }
function renderHistoryDropdown() {
  const dd = document.getElementById('hist-dropdown');
  const list = getHistory();
  if (!list.length) { dd.classList.remove('show'); return; }
  dd.innerHTML = list.map(item => `<div class="hist-item" data-url="${item.replace(/"/g, '&quot;')}">${item}</div>`).join('') + '<div class="hist-clear">清空历史记录</div>';
}
document.getElementById('baseUrl').addEventListener('focus', () => { renderHistoryDropdown(); document.getElementById('hist-dropdown').classList.add('show'); });
document.getElementById('baseUrl').addEventListener('input', () => { document.getElementById('hist-dropdown').classList.remove('show'); });
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('hist-item')) { document.getElementById('baseUrl').value = e.target.dataset.url; document.getElementById('hist-dropdown').classList.remove('show'); }
  if (e.target.classList.contains('hist-clear')) { localStorage.removeItem('jd-url-history'); document.getElementById('hist-dropdown').classList.remove('show'); }
  if (!e.target.closest('#baseUrl') && !e.target.closest('#hist-dropdown')) { document.getElementById('hist-dropdown').classList.remove('show'); }
});

// ── 认证 ──
async function handleAuth() {
  const baseUrl = document.getElementById('baseUrl').value.trim();
  if (!baseUrl) { alert('请输入飞书链接'); return; }

  // OAuth 登录 → 从服务端获取 token
  if (window._oauthAuthed && !getToken()) {
    showLoading('正在获取 Token...');
    try {
      await initOAuthToken();
      document.getElementById('auth-status').className = 'step-status done';
      document.getElementById('auth-status').textContent = '已认证（飞书登录）';
      document.getElementById('config-panel').style.display = 'block';
      addHistory(baseUrl);
    } catch (e) {
      alert('Token 获取失败: ' + e.message);
    } finally {
      hideLoading();
    }
    return;
  }

  const manualToken = document.getElementById('manualToken').value.trim();
  if (manualToken) {
    setToken(manualToken);
    document.getElementById('auth-status').className = 'step-status done';
    document.getElementById('auth-status').textContent = '已认证（手动）';
    document.getElementById('config-panel').style.display = 'block';
    addHistory(baseUrl);
    return;
  }

  const appSecret = document.getElementById('appSecret').value.trim();
  if (!appSecret) { alert('请输入 App Secret 或手动输入 Token'); return; }

  showLoading('正在获取 Token...');
  try {
    await getTenantToken(appSecret);
    document.getElementById('auth-status').className = 'step-status done';
    document.getElementById('auth-status').textContent = '已认证';
    document.getElementById('config-panel').style.display = 'block';
    addHistory(baseUrl);
  } catch (e) {
    document.getElementById('auth-status').className = 'step-status error';
    document.getElementById('auth-status').textContent = '认证失败';
    alert('认证失败: ' + e.message);
  } finally {
    hideLoading();
  }
}

// ── 调试：查看原始字段名 ──
async function handleDebugRecords() {
  const baseUrl = document.getElementById('baseUrl').value.trim();
  if (!baseUrl) { alert('请输入飞书链接'); return; }
  if (!getToken()) { alert('请先完成认证'); return; }
  const debugEl = document.getElementById('debug-output');
  debugEl.style.display = 'block';
  debugEl.textContent = '正在获取...';
  try {
    const baseToken = await resolveBaseToken(baseUrl);
    const tables = await getTableListWithInfo(baseToken);
    let mainTable = tables.find(t => t.name.includes('数据') || t.name.includes('单品'));
    if (!mainTable) mainTable = tables[0];
    const fields = await getFieldList(baseToken, mainTable.id);
    const fieldNames = fields.map(f => f.name).join('\n');
    const rawRes = await fetch('/api/debug-records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseToken, tableId: mainTable.id, token: getToken() }) });
    const rawData = await rawRes.json();
    const recordCount = rawData.data?.items?.length || 0;
    const sampleFields = recordCount > 0 ? JSON.stringify(rawData.data.items[0].fields, null, 2) : '无记录';
    const apiCode = rawData.code;
    const apiMsg = rawData.msg || '';
    debugEl.textContent = `表: ${mainTable.name} (${mainTable.id})\nAPI 返回码: ${apiCode} ${apiMsg}\n记录数: ${recordCount}\n\n字段列表 (getFieldList) - ${fields.length} 个:\n${fieldNames}\n\n第一条记录完整 fields (API):\n${sampleFields}`;
  } catch (e) {
    debugEl.textContent = '获取失败: ' + e.message;
  }
}

// ── 分析 ──
async function handleAnalyze() {
  const baseUrl = document.getElementById('baseUrl').value.trim();
  if (!baseUrl) { alert('请输入飞书链接'); return; }
  if (!getToken()) { alert('请先完成认证'); return; }

  const btn = document.getElementById('btn-analyze');
  btn.disabled = true;
  showLoading('正在拉取数据并分析...');

  const dateStart = document.getElementById('date-start').value.trim();
  const dateEnd = document.getElementById('date-end').value.trim();
  const dateRange = {};
  if (dateStart) dateRange.start = dateStart;
  if (dateEnd) dateRange.end = dateEnd;

  try {
    // 1. 解析 URL 获取 baseToken
    const baseToken = await resolveBaseToken(baseUrl);
    addHistory(baseUrl);

    // 2. 获取表列表
    const tables = await getTableListWithInfo(baseToken);
    let mainTable = tables.find(t => t.name.includes('数据') || t.name.includes('单品'));
    if (!mainTable) mainTable = tables[0];

    // 3. 获取字段
    const fields = await getFieldList(baseToken, mainTable.id);

    // 4. 拉取所有原始记录（本地聚合，避免 data/query 权限问题）
    showLoading('正在拉取所有原始记录...');
    const records = await fetchRecordsCached(baseToken, mainTable.id);

    // 5. 按日期过滤 + 本地聚合
    const hasDateFilter = dateRange.start || dateRange.end;
    const aggregated = filterAndAggregate(records, hasDateFilter ? dateRange : {});
    const { stats, titles, dateRange: dateRangeResult } = aggregated;

    // 6. 拉取行业热搜词
    const keywordTables = tables.filter(t => t.name.includes('热搜词') || t.name.includes('流量大词'));
    let industryKeywords = [];
    for (const kt of keywordTables) {
      showLoading(`正在拉取热搜词: ${kt.name}...`);
      const records = await fetchRecordsCached(baseToken, kt.id);
      industryKeywords.push(...records);
    }
    // 按日期筛选热搜词
    if (hasDateFilter && industryKeywords.length) {
      const normStart = dateRange.start ? normalizeDate(dateRange.start) : null;
      const normEnd = dateRange.end ? normalizeDate(dateRange.end) : null;
      industryKeywords = industryKeywords.filter(r => {
        const raw = r['日期']?.value || '';
        const d = normalizeDate(raw);
        if (normStart && d < normStart) return false;
        if (normEnd && d > normEnd) return false;
        return true;
      });
    }

    // 8. 运行分析
    const analysis = runAnalysis({ stats, titles, dateRange: dateRangeResult, industryKeywords });
    analysisData = { ...analysis, baseToken, tableId: mainTable.id };

    renderAnalysis(analysisData);
    setStepStatus('step1-status', 'done', '已完成');
    document.getElementById('analysis-panel').style.display = 'block';
    document.getElementById('generate-panel').style.display = 'block';

    // 9. 趋势分析（从本地记录计算）
    showLoading('正在分析趋势...');
    try {
      const dailyRaw = buildDailyFromRecords(records);
      const modelDailyRaw = buildModelDailyFromRecords(records);
      const trendData = runTrendAnalysis(dailyRaw, modelDailyRaw, dateRange);
      renderTrend(trendData);
      document.getElementById('trend-panel').style.display = 'block';
    } catch (e) {
      console.warn('趋势分析失败:', e.message);
    }

  } catch (e) {
    setStepStatus('step1-status', 'error', '失败');
    alert('分析失败: ' + e.message);
  } finally {
    hideLoading();
    btn.disabled = false;
  }
}

// ── 渲染分析结果 ──
function renderAnalysis(data) {
  const grid = document.getElementById('stat-grid');
  const dr = data.dateRange || {};
  const dateLabel = dr.start && dr.end ? `${dr.start} ~ ${dr.end} (${dr.totalDays}天)` : '未知';
  grid.innerHTML = [
    { num: data.totalTitles || 0, label: '总标题数' },
    { num: data.samples?.length || 0, label: '合格样本' },
    { num: data.wordCount?.min || 0, label: '最小字数' },
    { num: data.wordCount?.max || 0, label: '最大字数' },
    { num: dateLabel, label: '数据日期范围' },
  ].map(s => `<div class="stat-card"><div class="num" style="font-size:${String(s.num).length > 15 ? '14px' : '20px'}">${s.num}</div><div class="label">${s.label}</div></div>`).join('');

  const wc = document.getElementById('word-cloud');
  const maxFreq = data.wordFreq?.[0]?.[1] || 1;
  wc.innerHTML = (data.wordFreq || []).slice(0, 10).map(([w, c]) => {
    const pct = (c / maxFreq * 100).toFixed(0);
    return `<div class="chart-item"><span class="label-text">${w}</span><div class="bar" style="width:${Math.max(pct * 2, 20)}px;background:#D4A574">${c}</div></div>`;
  }).join('');

  const mc = document.getElementById('model-chart');
  const models = data.byModel || [];
  const maxM = Math.max(...models.map(v => v.count || 0), 1);
  const modelColors = ['#D4A574','#E8C8A8','#C49464','#A0C080','#C97C7C','#B8A88A'];
  mc.innerHTML = models.length ? models.map((v, i) => {
    const pct = (v.count / maxM * 100).toFixed(0);
    const color = modelColors[i % modelColors.length];
    const modelWords = (v.wordFreq || []).slice(0, 8);
    const wordsHtml = modelWords.length ? `<div class="model-words">${modelWords.map(([w, c]) => `<span class="model-word-tag">${w}<small>(${c})</small></span>`).join('')}</div>` : '';
    const modelSP = (v.spFreq || []).slice(0, 6);
    const spHtml = modelSP.length ? `<div class="model-sp">${modelSP.map(([s, c]) => `<span class="model-sp-tag">${s}<small>(${c})</small></span>`).join('')}</div>` : '';
    return `<div class="model-card"><div class="chart-item"><span class="label-text">${v.model || '未知'}</span><div class="bar" style="width:${Math.max(pct * 2, 20)}px;background:${color}">${v.count}</div><span class="pct">${v.pct}%</span></div>${wordsHtml}${spHtml}</div>`;
  }).join('') : '<div style="color:#8B7355;font-size:13px;padding:8px;">暂无型号数据</div>';

  const ac = document.getElementById('attribute-chart');
  const attrs = data.titleAttributes?.distribution || [];
  const maxA = Math.max(...attrs.map(a => a.count), 1);
  const attrColors = { '功能型':'#D4A574', '场景型':'#A0C080', '人群型':'#D4A060', '情感型':'#C97090', '痛点型':'#C97C7C', '混合型':'#B8A88A' };
  ac.innerHTML = attrs.length ? attrs.map(a => {
    const pct = (a.count / maxA * 100).toFixed(0);
    return `<div class="attr-bar"><span class="attr-name">${a.type}</span><div class="attr-bar-fill" style="width:${Math.max(pct * 2, 30)}px;background:${attrColors[a.type] || '#86909c'}">${a.count}</div><span class="attr-stats">均展现${a.avgViews} · 均进商详${a.avgDetail} · 均成交¥${a.avgGmv}</span></div>`;
  }).join('') : '<div style="color:#8B7355;font-size:13px;padding:8px;">暂无属性数据</div>';

  const sc = document.getElementById('structure-chart');
  const maxS = data.structures?.length ? data.structures[0].count : 1;
  sc.innerHTML = (data.structures || []).slice(0, 6).map(s => {
    const pct = (s.count / maxS * 100).toFixed(0);
    return `<div class="chart-item"><span class="label-text">${s.name}</span><div class="bar" style="width:${Math.max(pct * 2, 20)}px;background:#E8C8A8">${s.count}</div><span class="pct">${s.pct}%</span></div>`;
  }).join('');

  const ikw = document.getElementById('industry-keywords');
  const ikwData = data.industryKeywordAnalysis?.ranked || [];
  ikw.innerHTML = ikwData.length
    ? ikwData.slice(0, 10).map(k => `<span class="industry-kw-tag">${k.term}<small>(${k.searchVolume.toLocaleString()})</small></span>`).join('')
    : '<div style="color:#8B7355;font-size:13px;padding:8px;">暂无行业热搜词数据</div>';

  const ts = document.getElementById('top-samples-table');
  ts.innerHTML = `<table class="sample-table"><thead><tr><th>#</th><th>标题</th><th>字数</th><th>观看</th><th>进商详</th><th>GMV</th><th>型号</th><th>属性</th></tr></thead><tbody>${(data.topSamples || []).map((s, i) => `<tr><td>${i + 1}</td><td>${s.title}</td><td>${s.views ? s.title.replace(/[\s！，。？、：💡✅～😭🥘❗🎁]/g, '').length : '-'}</td><td>${s.views}</td><td>${s.detail}</td><td>¥${s.gmv}</td><td>${s.model}</td><td>${s.type}</td></tr>`).join('')}</tbody></table>`;
}

// ── 趋势渲染 ──
function renderTrend(data) {
  renderTrendSummary(data);
  renderTrendComparison(data.comparisons, data.period);
  renderTrendChart(data.dailyTrend);
  if (data.modelTrends && data.modelTrends.length) renderTrendModels(data.modelTrends);
  renderTrendFindings(data.findings, data.summary);
  document.getElementById('trend-raw-json').textContent = JSON.stringify(data, null, 2);
}

function renderTrendComparison(comparisons, period) {
  const el = document.getElementById('trend-comparison');
  const cur = period.thisPeriod || {};
  const prev = period.lastPeriod || {};
  const splitNote = period.splitMethod ? ` [${period.splitMethod}]` : '';
  el.innerHTML = `<div style="font-size:12px;color:#86909c;margin-bottom:6px;">当前段 ${cur.start} ~ ${cur.end} (${cur.days || period.totalDays}天)  vs  环比段 ${prev.start} ~ ${prev.end} (${prev.days || ''}天)${splitNote}</div>
    <table class="trend-table"><thead><tr><th>指标</th><th>当前段</th><th>环比段</th><th>变化</th><th>环比</th></tr></thead>
    <tbody>${comparisons.map(c => {
      const cls = c.direction === 'up' ? 'up' : c.direction === 'down' ? 'down' : 'flat';
      const arrow = c.direction === 'up' ? '↑' : c.direction === 'down' ? '↓' : '→';
      return `<tr><td>${c.label}</td><td>${c.thisWeek}</td><td>${c.lastWeek}</td><td class="${cls}">${c.diff > 0 ? '+' : ''}${c.diff} ${arrow}</td><td class="${cls}">${c.pct}%</td></tr>`;
    }).join('')}</tbody></table>`;
}

function renderTrendChart(daily) {
  const el = document.getElementById('trend-chart-area');
  const maxViews = Math.max(...daily.map(d => d.views), 1);
  const maxDetail = Math.max(...daily.map(d => d.detail), 1);
  const maxGmv = Math.max(...daily.map(d => d.gmv), 1);
  el.innerHTML = `<div class="trend-chart-title">📊 每日趋势</div>
    <div class="trend-chart-grid">${daily.map(d => {
      const vPct = (d.views / maxViews * 100).toFixed(0);
      const dPct = (d.detail / maxDetail * 100).toFixed(0);
      const gPct = (d.gmv / maxGmv * 100).toFixed(0);
      return `<div class="trend-day"><div class="trend-day-label">${d.date.slice(5)}</div><div class="trend-bars">
        <div class="trend-bar-row"><div class="trend-bar views" style="width:${Math.max(vPct * 1.2, 4)}px">${d.views}</div></div>
        <div class="trend-bar-row"><div class="trend-bar detail" style="width:${Math.max(dPct * 1.2, 4)}px">${d.detail}</div></div>
        <div class="trend-bar-row"><div class="trend-bar gmv" style="width:${Math.max(gPct * 1.2, 4)}px">¥${d.gmv}</div></div>
      </div></div>`;
    }).join('')}</div>
    <div class="trend-legend"><span><span class="legend-dot views"></span> 观看</span><span><span class="legend-dot detail"></span> 进商详</span><span><span class="legend-dot gmv"></span> 成交金额</span></div>`;
}

function renderTrendModels(models) {
  const el = document.getElementById('trend-models');
  el.innerHTML = `<h4 class="trend-subtitle">🏷️ 型号级别趋势</h4>
    <table class="trend-table"><thead><tr><th>型号</th><th>当前段观看</th><th>环比段观看</th><th>观看环比</th><th>当前段GMV</th><th>环比段GMV</th><th>GMV环比</th></tr></thead>
    <tbody>${models.map(m => {
      const vCls = parseFloat(m.viewsHB) > 0 ? 'up' : parseFloat(m.viewsHB) < 0 ? 'down' : 'flat';
      const gCls = parseFloat(m.gmvHB) > 0 ? 'up' : parseFloat(m.gmvHB) < 0 ? 'down' : 'flat';
      return `<tr><td><strong>${m.model}</strong></td><td>${m.thisViews}</td><td>${m.lastViews}</td><td class="${vCls}">${m.viewsHB}%</td><td>¥${m.thisGmv}</td><td>¥${m.lastGmv}</td><td class="${gCls}">${m.gmvHB}%</td></tr>`;
    }).join('')}</tbody></table>`;
}

function renderTrendFindings(findings, summary) {
  const el = document.getElementById('trend-findings');
  el.innerHTML = findings && findings.length
    ? `<div class="trend-summary-box"><ul class="trend-findings">${findings.map(f => `<li>${f}</li>`).join('')}</ul></div>`
    : '';
  const summaryEl = document.getElementById('trend-summary');
  const directionIcon = summary.includes('↑') ? '🟢' : summary.includes('↓') ? '🔴' : '🟡';
  summaryEl.innerHTML = `<span class="trend-summary-badge">${directionIcon} 趋势判断</span> ${summary}`;
}

// ── 生成标题 ──
async function handleGenerate() {
  if (!analysisData) { alert('请先完成数据分析'); return; }
  showLoading('正在调用大模型生成标题...');
  const btn = document.getElementById('btn-generate');
  btn.disabled = true;
  try {
    const result = await generateAll(analysisData, {});
    generatedData = result;
    // 检查是否有错误
    const errors = Object.entries(result).filter(([_, v]) => v.error).map(([k, v]) => `${k}: ${v.error}`);
    if (errors.length) console.warn('部分型号生成失败:', errors);
    renderStrategy(result);
    renderTitles(result);
    document.getElementById('result-panel').style.display = 'block';
  } catch (e) {
    alert('生成失败: ' + e.message);
  } finally {
    hideLoading();
    btn.disabled = false;
  }
}

function renderStrategy(data) {
  const panel = document.getElementById('strategy-panel');
  panel.innerHTML = Object.entries(data || {}).map(([model, group]) => {
    if (!group.strategy) return '';
    return `<div style="margin-bottom:8px;"><strong>${model}</strong><br>${group.strategy.replace(/\n/g, '<br>')}</div>`;
  }).join('');
}

function renderTitles(data) {
  const container = document.getElementById('titles-container');
  container.innerHTML = Object.entries(data || {}).map(([model, group]) => {
    const productName = group.product?.name || '';
    const titles = (group.titles || []);
    if (group.error) return `<div class="model-group"><h3>${model} ${productName}</h3><div style="color:#C97C7C;font-size:13px;padding:8px;">生成失败: ${group.error}</div></div>`;
    if (!titles.length) return `<div class="model-group"><h3>${model} ${productName}</h3><div style="color:#8B7355;font-size:13px;padding:8px;">未生成有效标题，请检查 API 配置</div></div>`;
    return `<div class="model-group"><h3>${model} ${productName}（${titles.length}条）</h3>
      <div class="title-grid">${titles.map((t, i) => {
        const structLabel = t.structure === 'A' ? 'A·避坑防御' : t.structure === 'B' ? 'B·效率提升' : t.structure === 'C' ? 'C·痛点反转' : '';
        return `<div class="title-card">
        <div class="title-text"><span>${i + 1}. ${t.title}</span>${structLabel ? `<span class="word-count" style="background:#A0C080;color:white;font-size:11px;">${structLabel}</span>` : ''}<span class="word-count">${t.words}字</span></div>
        <div class="reasoning">${t.reasoning || ''}</div>
      </div>`;
      }).join('')}</div></div>`;
  }).join('');
}
