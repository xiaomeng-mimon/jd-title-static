function normalizeDate(str) { if (!str) return ''; return String(str).replace(/\//g, '-').substring(0, 10); }

function addDays(dateStr, days) {
  const d = new Date(dateStr.replace(/\//g, '-'));
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function parseDailyRecord(r) {
  return { date: r['时间']?.value || '', views: parseInt(r['sum(视频观看次数)']?.value || 0), detail: parseInt(r['sum(引导进商详访客数)']?.value || 0), gmv: parseInt(r['sum(7天引导成交金额)']?.value || 0), buyers: parseInt(r['sum(7天引导成交人数)']?.value || 0), count: parseInt(r['count(视频观看次数)']?.value || 0) };
}

function parseModelDailyRecord(r) {
  return { date: r['时间']?.value || '', model: r['型号']?.value || '未知', views: parseInt(r['sum(视频观看次数)']?.value || 0), detail: parseInt(r['sum(引导进商详访客数)']?.value || 0), gmv: parseInt(r['sum(7天引导成交金额)']?.value || 0) };
}

function sumWeek(records) {
  const s = { views:0, detail:0, gmv:0, buyers:0, count:0, days:records.length };
  records.forEach(r => { s.views+=r.views; s.detail+=r.detail; s.gmv+=r.gmv; s.buyers+=r.buyers; s.count+=r.count; });
  s.avgViews = s.days>0?Math.round(s.views/s.days):0;
  s.avgDetail = s.days>0?Math.round(s.detail/s.days):0;
  s.avgGmv = s.days>0?Math.round(s.gmv/s.days):0;
  return s;
}

function calcHB(thisWeek, lastWeek, label) {
  const now = thisWeek || 0, prev = lastWeek || 0;
  const diff = now - prev;
  const pct = prev > 0 ? ((diff / prev) * 100).toFixed(1) : (now > 0 ? '+∞' : '0.0');
  return { label, thisWeek: now, lastWeek: prev, diff, pct, direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat' };
}

function runTrendAnalysis(dailyRaw, modelDailyRaw, dateRange = {}) {
  const daily = dailyRaw.map(parseDailyRecord).filter(r => r.date).sort((a, b) => a.date.localeCompare(b.date));
  const normStart = dateRange.start ? normalizeDate(dateRange.start) : null;
  const normEnd = dateRange.end ? normalizeDate(dateRange.end) : null;
  let thisPeriod = daily;
  if (normStart) thisPeriod = thisPeriod.filter(r => normalizeDate(r.date) >= normStart);
  if (normEnd) thisPeriod = thisPeriod.filter(r => normalizeDate(r.date) <= normEnd);
  if (thisPeriod.length < 2) throw new Error(`日期范围内数据不足（仅${thisPeriod.length}天），无法做趋势分析`);
  const thisDays = thisPeriod.length;
  const thisStart = normalizeDate(thisPeriod[0].date);
  const prevEndDate = addDays(thisStart, -1);
  const prevStartDate = addDays(thisStart, -thisDays);
  const lastPeriod = daily.filter(r => { const d = normalizeDate(r.date); return d >= prevStartDate && d <= prevEndDate; });
  const thisSum = sumWeek(thisPeriod);
  const lastSum = sumWeek(lastPeriod);
  const period = {
    thisPeriod: { start: thisStart, end: normalizeDate(thisPeriod[thisPeriod.length-1]?.date) || '', days: thisPeriod.length },
    lastPeriod: { start: prevStartDate, end: prevEndDate, days: lastPeriod.length },
    splitMethod: `环比: ${prevStartDate}~${prevEndDate} (${lastPeriod.length}天) vs ${thisStart}~${normalizeDate(thisPeriod[thisPeriod.length-1]?.date)} (${thisPeriod.length}天)`,
    totalDays: thisPeriod.length
  };
  const comparisons = [calcHB(thisSum.views,lastSum.views,'视频观看次数'),calcHB(thisSum.detail,lastSum.detail,'引导进商详'),calcHB(thisSum.gmv,lastSum.gmv,'7天成交金额'),calcHB(thisSum.buyers,lastSum.buyers,'成交人数'),calcHB(thisSum.count,lastSum.count,'视频数量')];
  const upCount = comparisons.filter(c => c.direction === 'up').length;
  const downCount = comparisons.filter(c => c.direction === 'down').length;
  let summary;
  if (upCount >= 4) summary = '整体↑上升趋势，成交和流量均增长，建议加大优质内容投放';
  else if (downCount >= 4) summary = '整体↓下降趋势，需复盘近期内容策略，优化标题和卖点';
  else if (comparisons.find(c => c.label === '7天成交金额')?.direction === 'up') summary = '成交↑增长但流量波动，维持优质标题策略，重点提升转化';
  else summary = '整体平稳，建议在热门词根基础上测试新句式';

  let modelTrends = [];
  if (modelDailyRaw && modelDailyRaw.length) {
    const modelDaily = modelDailyRaw.map(parseModelDailyRecord).filter(r => r.date && r.model);
    const modelGroups = {};
    modelDaily.forEach(r => { if (!modelGroups[r.model]) modelGroups[r.model] = []; modelGroups[r.model].push(r); });
    modelTrends = Object.entries(modelGroups).map(([model, records]) => {
      const sorted = records.sort((a, b) => a.date.localeCompare(b.date));
      const mThis = sorted.filter(r => { const d = normalizeDate(r.date); return d >= period.thisPeriod.start && d <= period.thisPeriod.end; });
      const mLast = sorted.filter(r => { const d = normalizeDate(r.date); return d >= period.lastPeriod.start && d <= period.lastPeriod.end; });
      const tGmv = mThis.reduce((s, r) => s + r.gmv, 0);
      const lGmv = mLast.reduce((s, r) => s + r.gmv, 0);
      const tViews = mThis.reduce((s, r) => s + r.views, 0);
      const lViews = mLast.reduce((s, r) => s + r.views, 0);
      return { model, viewsHB: lViews>0?(((tViews-lViews)/lViews)*100).toFixed(1):'∞', gmvHB: lGmv>0?(((tGmv-lGmv)/lGmv)*100).toFixed(1):'∞', thisViews: tViews, lastViews: lViews, thisGmv: tGmv, lastGmv: lGmv };
    }).sort((a, b) => parseFloat(b.gmvHB || 0) - parseFloat(a.gmvHB || 0) || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0));
  }

  const dailyTrend = thisPeriod.map(d => ({ date: d.date, views: d.views, detail: d.detail, gmv: d.gmv, buyers: d.buyers, count: d.count }));
  const findings = [];
  const bestDay = [...dailyTrend].sort((a, b) => b.gmv - a.gmv || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0];
  if (bestDay) findings.push(`最佳成交日: ${bestDay.date} (GMV ¥${bestDay.gmv})`);
  const worstDay = [...dailyTrend].sort((a, b) => a.gmv - b.gmv || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0];
  if (worstDay && worstDay.date !== bestDay?.date) findings.push(`最差成交日: ${worstDay.date} (GMV ¥${worstDay.gmv})`);
  const gmvComp = comparisons.find(c => c.label === '7天成交金额');
  if (gmvComp) { if (gmvComp.direction === 'up') findings.push(`成交金额环比${gmvComp.pct}%↑，增长${gmvComp.diff}元`); else if (gmvComp.direction === 'down') findings.push(`成交金额环比${gmvComp.pct}%↓，减少${Math.abs(gmvComp.diff)}元`); }
  const viewsComp = comparisons.find(c => c.label === '视频观看次数');
  if (viewsComp && viewsComp.direction === 'up') findings.push(`观看量环比${viewsComp.pct}%↑，流量向好`);
  else if (viewsComp && viewsComp.direction === 'down') findings.push(`观看量环比${viewsComp.pct}%↓，需关注内容曝光`);
  if (modelTrends.length) {
    const bestModel = modelTrends[0]; if (parseFloat(bestModel.gmvHB) > 0) findings.push(`型号 ${bestModel.model} 成交增长最快 (+${bestModel.gmvHB}%)`);
    const worstModel = modelTrends[modelTrends.length - 1]; if (parseFloat(worstModel.gmvHB) < 0) findings.push(`型号 ${worstModel.model} 成交下滑 (${worstModel.gmvHB}%)`);
  }
  return { period, comparisons, summary, dailyTrend, modelTrends, findings };
}
