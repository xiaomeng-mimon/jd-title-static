function calcThresholds(stats) {
  const avgViews = parseFloat(stats['avg(视频观看次数)']?.value || 7);
  const avgDetail = parseFloat(stats['avg(引导进商详访客数)']?.value || 1);
  return {
    avgViews, avgDetail,
    highViews: Math.ceil(avgViews * CONFIG.thresholds.viewMultiplier),
    highDetail: Math.ceil(avgDetail * CONFIG.thresholds.detailMultiplier)
  };
}

function filterSamples(titles, thresholds) {
  return titles.filter(r => {
    const views = parseInt(r['sum(视频观看次数)']?.value || 0);
    const gmv = parseInt(r['sum(7天引导成交金额)']?.value || 0);
    const detail = parseInt(r['sum(引导进商详访客数)']?.value || 0);
    const buyers = parseInt(r['sum(7天引导成交人数)']?.value || 0);
    let score = 0;
    if (views >= thresholds.highViews) score++;
    if (detail >= thresholds.highDetail) score++;
    if (gmv > 0 || buyers > 0) score++;
    return score >= CONFIG.qualifyMinScore;
  });
}

function breakdownByModel(samples) {
  const byModel = {};
  samples.forEach(r => {
    const m = r['型号']?.value || '未知';
    if (!byModel[m]) byModel[m] = [];
    byModel[m].push(r);
  });
  return byModel;
}

function extractWordFrequencies(samples) {
  const allWords = {};
  const brands = ['IMiMONE', 'imimone', '米萌'];
  samples.forEach(r => {
    const t = r['视频名称']?.value || '';
    let clean = t;
    for (const brand of brands) {
      const regex = new RegExp(brand, 'gi');
      const matches = clean.match(regex);
      if (matches) { allWords[brand] = (allWords[brand] || 0) + matches.length; clean = clean.replace(regex, ''); }
    }
    const parts = [];
    const segments = clean.split(/[\s，。！？、｜｜,，!?|#＃✅～~（）()【】\[\]""「」：:、；;]+/);
    for (const seg of segments) {
      if (!seg) continue;
      const sub = seg.match(/[\u4e00-\u9fff]+|[a-zA-Z]+|\d+/g);
      if (sub) parts.push(...sub);
    }
    parts.forEach(w => {
      if (w.length < 2 || /^[a-zA-Z0-9]+$/.test(w)) return;
      if (/[\u4e00-\u9fff]/.test(w)) allWords[w] = (allWords[w] || 0) + 1;
    });
    for (const w of parts) {
      if (w.length < 4 || !/[\u4e00-\u9fff]/.test(w)) continue;
      for (let len = 2; len <= 3; len++) {
        for (let i = 0; i <= w.length - len; i++) {
          const ng = w.substring(i, i + len);
          allWords[ng] = (allWords[ng] || 0) + 1;
        }
      }
    }
  });
  const minCount = samples.length <= 5 ? 1 : samples.length <= 15 ? 2 : 3;
  const entries = Object.entries(allWords).filter(([w, c]) => c >= minCount).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  const result = [];
  for (const [w, c] of entries) {
    if (w.length <= 3) {
      const dominatedBy = entries.find(([lw, lc]) => { if (lw === w || lw.length <= w.length || !lw.includes(w)) return false; return lc >= c * 0.7; });
      if (dominatedBy) continue;
    }
    result.push([w, c]);
  }
  return result.slice(0, 30);
}

function extractSellingPoints(samples) {
  const spWords = { "便携":0,"即热":0,"速热":0,"3秒":0,"1秒":0,"破壁":0,"研磨":0,"咖啡":0,"一键":0,"小巧":0,"无线":0,"迷你":0,"折叠":0,"出行":0,"酒店":0,"居家":0,"出差":0,"户外":0,"露营":0,"租房":0,"宝妈":0,"带娃":0,"泡奶":0,"泡茶":0,"冲奶":0,"神器":0,"必备":0,"推荐":0,"幸福":0,"自由":0,"强劲":0,"强悍":0,"细腻":0,"无渣":0,"多档":0,"控温":0,"分体":0,"可拆洗":0,"0涂层":0,"不锈钢":0,"办公室":0,"小家庭":0,"一人食":0 };
  samples.forEach(r => {
    const t = r['视频名称']?.value || '';
    Object.keys(spWords).forEach(sp => { if (t.includes(sp)) spWords[sp]++; });
  });
  return Object.entries(spWords).filter(([_, c]) => c > 0).sort((a, b) => b[1] - a[1]);
}

function analyzeStructures(samples) {
  const structCounts = {};
  samples.forEach(r => {
    const t = r['视频名称']?.value || '';
    if (/^IMiMONE|^米萌/i.test(t) && /便携|即热|烧水|研磨|破壁|迷你|榨汁/.test(t)) structCounts['品牌+产品+属性'] = (structCounts['品牌+产品+属性'] || 0) + 1;
    else if (/^IMiMONE|^米萌/i.test(t)) structCounts['简单品牌+品类'] = (structCounts['简单品牌+品类'] || 0) + 1;
    else if (/！|!|？|\?/.test(t)) structCounts['痛点/感叹+产品+卖点'] = (structCounts['痛点/感叹+产品+卖点'] || 0) + 1;
    else if (/租房|宝妈|出门|酒店|户外|露营|差旅|办公|宿舍/.test(t)) structCounts['人群+场景+产品'] = (structCounts['人群+场景+产品'] || 0) + 1;
    else if (/推荐|种草|值得|必备|分享/.test(t)) structCounts['促销/推荐引导型'] = (structCounts['促销/推荐引导型'] || 0) + 1;
    else structCounts['其他/卖点堆叠'] = (structCounts['其他/卖点堆叠'] || 0) + 1;
  });
  const total = samples.length;
  return Object.entries(structCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count, pct: (count / total * 100).toFixed(0) }));
}

function analyzeWordCount(samples) {
  const counts = samples.map(r => { const t = r['视频名称']?.value || ''; return { title: t.substring(0,30), len: t.replace(/[\s💡✅～😭🥘❗🎁]/g, '').length }; });
  const lens = counts.map(c => c.len);
  const sorted = [...lens].sort((a, b) => a - b);
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
  // 调试：打印异常标题
  var bad = counts.filter(function(c) { return c.len < 5 || c.len > 27; });
  if (bad.length) console.warn('[字数异常]', bad.length, '条:', JSON.stringify(bad.slice(0,5)));
  return { avg: avg.toFixed(1), min: sorted[0], max: sorted[sorted.length - 1], p25: sorted[Math.floor(sorted.length * 0.25)], p75: sorted[Math.floor(sorted.length * 0.75)], all: lens };
}

function classifyTitle(title) {
  const types = [];
  if (/便携|即热|速热|破壁|研磨|强劲|细腻|无线|小巧|迷你|折叠|高速|一键|多档|控温|分体|可拆洗|不锈钢|大火力|0涂层|续航|醇香|无渣|出杯|可调/.test(title)) types.push('功能型');
  if (/居家|出差|酒店|户外|露营|租房|办公室|厨房|家用|宿舍|出行|家庭/.test(title)) types.push('场景型');
  if (/租房党|宝妈|上班族|差旅|健身|咖啡控|露营玩家|小家庭|美食控|一人食|轻食族|带娃/.test(title)) types.push('人群型');
  if (/必备|神器|推荐|首选|不容错过|闭眼入|超好用|超方便|真香|后悔|好物|搭子|锁死|挖到宝|幸福|自由/.test(title)) types.push('情感型');
  if (/贵？|难喝？|难打碎？|难磨？|久等？|不干净|不香？|饿了|犯了/.test(title)) types.push('痛点型');
  if (types.length === 0) types.push('混合型');
  if (types.length > 1) return '混合型';
  return types[0];
}

function analyzeTitleAttributes(samples, rawTitles) {
  const metricMap = {};
  rawTitles.forEach(r => {
    const t = (r['视频名称']?.value || '').trim();
    if (!t) return;
    metricMap[t] = { views: parseInt(r['sum(视频观看次数)']?.value || 0), detail: parseInt(r['sum(引导进商详访客数)']?.value || 0), gmv: parseInt(r['sum(7天引导成交金额)']?.value || 0), buyers: parseInt(r['sum(7天引导成交人数)']?.value || 0) };
  });
  const typeData = {};
  samples.forEach(r => {
    const t = r['视频名称']?.value || '';
    const type = classifyTitle(t);
    if (!typeData[type]) typeData[type] = { count: 0, views: [], detail: [], gmv: [] };
    typeData[type].count++;
    const m = metricMap[t] || {};
    typeData[type].views.push(m.views || 0);
    typeData[type].detail.push(m.detail || 0);
    typeData[type].gmv.push(m.gmv || 0);
  });
  const total = samples.length;
  const distribution = Object.entries(typeData).sort((a, b) => b[1].count - a[1].count).map(([type, d]) => ({
    type, count: d.count, pct: (d.count / total * 100).toFixed(0),
    avgViews: (d.views.reduce((s, v) => s + v, 0) / d.count).toFixed(0),
    avgDetail: (d.detail.reduce((s, v) => s + v, 0) / d.count).toFixed(0),
    avgGmv: (d.gmv.reduce((s, v) => s + v, 0) / d.count).toFixed(0)
  }));
  const bestType = distribution.sort((a, b) => parseFloat(b.avgGmv) - parseFloat(a.avgGmv))[0]?.type || '混合型';
  return { distribution, bestType };
}

function getTopSamples(samples, n = 15) {
  const scored = samples.map(r => {
    const title = r['视频名称']?.value || '';
    const views = parseInt(r['sum(视频观看次数)']?.value || 0);
    const detail = parseInt(r['sum(引导进商详访客数)']?.value || 0);
    const gmv = parseInt(r['sum(7天引导成交金额)']?.value || 0);
    const buyers = parseInt(r['sum(7天引导成交人数)']?.value || 0);
    const model = r['型号']?.value || '';
    return { title, views, detail, gmv, buyers, model, type: classifyTitle(title), score: Math.round(gmv * 0.5 + detail * 0.3 + views * 0.2) };
  });
  return scored.filter(s => s.title).sort((a, b) => b.score - a.score).slice(0, n);
}

function parseSearchVolume(val) {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  const s = String(val).replace(/,/g, '');
  if (s.includes('万')) { const [low, high] = s.replace(/万/g, '').split('~').map(v => parseFloat(v) * 10000); return Math.round((low + (high || low)) / 2); }
  const [low, high] = s.split('~').map(v => parseFloat(v));
  return Math.round((low + (high || low)) / 2);
}

function parseConversionRate(val) {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  const s = String(val);
  const [low, high] = s.replace(/%/g, '').split('~').map(v => parseFloat(v));
  return (low + (high || low)) / 2;
}

function classifyKeywordToModel(keyword) {
  const k = keyword.toLowerCase();
  if (/饮水机|即热|烧水|热水壶|净饮|直饮|便携/.test(k)) return 'IM101';
  if (/破壁|榨汁|果汁|豆浆|养生壶/.test(k)) return 'IM102';
  if (/意式|浓缩|咖啡/.test(k) && !/美式|研磨/.test(k)) return 'IM201';
  if (/美式|研磨一体|磨豆/.test(k)) return 'IM202';
  if (/火锅|电煮锅|涮锅|多功能锅/.test(k)) return 'IM301';
  if (/咖啡/.test(k)) return 'IM201';
  if (/锅|煮|炒|煎|烤/.test(k)) return 'IM301';
  return '通用';
}

function getFieldValue(r, ...names) {
  for (const n of names) { const v = r[n]?.value ?? r[`sum(${n})`]?.value ?? r[`avg(${n})`]?.value; if (v != null) return v; }
  return null;
}

function analyzeIndustryKeywords(industryKeywords) {
  if (!industryKeywords || !industryKeywords.length) return { ranked: [], topByModel: {}, summary: '无行业流量大词数据' };
  const grouped = {};
  for (const r of industryKeywords) {
    const term = getFieldValue(r, '搜索词', '关键词', 'term', 'keyword');
    if (!term) continue;
    if (!grouped[term]) grouped[term] = { term, searchVolumes: [], conversionRates: [], clickRates: [], count: 0 };
    grouped[term].searchVolumes.push(parseSearchVolume(getFieldValue(r, '搜索人数', '搜索量', '热度')));
    grouped[term].conversionRates.push(parseConversionRate(getFieldValue(r, '成交转化率')));
    grouped[term].clickRates.push(parseConversionRate(getFieldValue(r, '点击率')));
    grouped[term].count++;
  }
  const ranked = Object.values(grouped).map(g => ({
    term: g.term,
    searchVolume: Math.round(g.searchVolumes.reduce((a, b) => a + b, 0) / g.count),
    conversionRate: parseFloat((g.conversionRates.reduce((a, b) => a + b, 0) / g.count).toFixed(2)),
    clickRate: parseFloat((g.clickRates.reduce((a, b) => a + b, 0) / g.count).toFixed(2)),
    model: classifyKeywordToModel(g.term), recordCount: g.count
  })).sort((a, b) => b.searchVolume - a.searchVolume);
  const topByModel = {};
  for (const kw of ranked) { const m = kw.model; if (!topByModel[m]) topByModel[m] = []; if (topByModel[m].length < 10) topByModel[m].push(kw); }
  return { ranked, topByModel, summary: `行业热搜词 ${ranked.length}个，TOP5: ${ranked.slice(0, 5).map(k => k.term).join('、')}` };
}

function normalizeDate(str) { if (!str) return ''; return String(str).replace(/\//g, '-').substring(0, 10); }

function filterAndAggregate(records, dateRange) {
  const { start, end } = dateRange || {};
  const normStart = start ? normalizeDate(start) : null;
  const normEnd = end ? normalizeDate(end) : null;
  let filtered = records;
  if (normStart) filtered = filtered.filter(r => normalizeDate(r['时间']) >= normStart);
  if (normEnd) filtered = filtered.filter(r => normalizeDate(r['时间']) <= normEnd);
  const dates = [...new Set(filtered.map(r => normalizeDate(r['时间'])).filter(Boolean))].sort();
  const actualRange = { start: dates[0] || start || null, end: dates[dates.length - 1] || end || null, totalDays: dates.length, allDates: dates };
  const viewsArr = filtered.map(r => parseInt(r['视频观看次数']) || 0);
  const detailArr = filtered.map(r => parseInt(r['引导进商详访客数']) || 0);
  const gmvArr = filtered.map(r => parseInt(r['7天引导成交金额']) || 0);
  const buyersArr = filtered.map(r => parseInt(r['7天引导成交人数']) || 0);
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
    const title = r['视频名称'] || '未知';
    const model = r['型号'] || '未知';
    const key = `${title}|||${model}`;
    if (!byTitle[key]) byTitle[key] = { '视频名称': { value: title }, '型号': { value: model }, 'sum(视频观看次数)': { value: 0 }, 'sum(7天引导成交金额)': { value: 0 }, 'sum(7天引导成交人数)': { value: 0 }, 'sum(引导进商详访客数)': { value: 0 }, 'count(视频观看次数)': { value: 0 } };
    byTitle[key]['sum(视频观看次数)'].value += parseInt(r['视频观看次数']) || 0;
    byTitle[key]['sum(7天引导成交金额)'].value += parseInt(r['7天引导成交金额']) || 0;
    byTitle[key]['sum(7天引导成交人数)'].value += parseInt(r['7天引导成交人数']) || 0;
    byTitle[key]['sum(引导进商详访客数)'].value += parseInt(r['引导进商详访客数']) || 0;
    byTitle[key]['count(视频观看次数)'].value += 1;
  }
  const titles = Object.values(byTitle).sort((a, b) => (b['sum(7天引导成交金额)'].value || 0) - (a['sum(7天引导成交金额)'].value || 0));
  return { stats, titles, dateRange: actualRange, totalRecords: filtered.length };
}

function runAnalysis(data) {
  const { stats, titles, dateRange, industryKeywords } = data;
  const thresholds = calcThresholds(stats);
  const samples = filterSamples(titles, thresholds);
  const byModelRaw = breakdownByModel(samples);
  const total = samples.length;
  const byModel = Object.entries(byModelRaw).sort((a, b) => b[1].length - a[1].length).map(([model, items]) => ({
    model, count: items.length, pct: (items.length / total * 100).toFixed(0),
    wordFreq: extractWordFrequencies(items), spFreq: extractSellingPoints(items)
  }));
  const wordFreq = extractWordFrequencies(samples);
  const spFreq = extractSellingPoints(samples);
  const structures = analyzeStructures(samples);
  const wordCount = analyzeWordCount(samples);
  const titleAttributes = analyzeTitleAttributes(samples, titles);
  const topSamples = getTopSamples(samples, 15);
  const industryKeywordAnalysis = analyzeIndustryKeywords(industryKeywords);
  return { thresholds, samples, byModel, wordFreq, spFreq, structures, wordCount, titleAttributes, topSamples, totalTitles: titles.length, dateRange: dateRange || { start: null, end: null, totalDays: 0 }, industryKeywordAnalysis };
}
