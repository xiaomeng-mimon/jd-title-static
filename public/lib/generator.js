function getUserLLMConfig() {
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem('jd-llm-config') || '{}'); } catch(e) {}
  // 优先取 DOM 当前值（避免 onchange 未触发），兜底 localStorage
  var model = document.getElementById('llm-model') ? document.getElementById('llm-model').value : '';
  var endpoint = document.getElementById('llm-endpoint') ? document.getElementById('llm-endpoint').value : '';
  var apiKey = document.getElementById('llm-apikey') ? document.getElementById('llm-apikey').value : '';
  return {
    model:    model    || saved.model    || '',
    endpoint: endpoint || saved.endpoint || '',
    apiKey:   apiKey   || saved.apiKey   || ''
  };
}

// ── LLM 配置（从 localStorage 用户配置读取） ──
var LLM_CONFIG = {
  get model() { return getUserLLMConfig().model; },
  temperature: 0,   // 固定为 0：保证同一输入生成结果稳定（每次一致）
  maxTokens: 6000  // 30条标题需要足够输出空间
};

// ── System Prompt ──
const SYSTEM_PROMPT = `(输出JSON)\n【角色设定】
你是一位资深的"京东逛逛"内容运营专家。你的目标受众是具有强购买意愿、注重产品品质与实用性的京东用户。你的任务是根据提供的【产品参数/卖点】，生成能够精准截流站内搜索、加速用户决策的"高点击、高转化"种草标题。

【参数转化三步法】
第一步：识别参数本质（What）
分析该参数属于哪个维度：重量（g/kg）、体积（ml/L）、效率（W/转速/秒）、材质（不锈钢/涂层），还是特定功能（N档调节/折叠）？

第二步：挖掘核心利益与痛点解决（Why & How）
思考这个参数究竟帮用户省了什么麻烦或提供了什么情绪价值：
- 体积/重量小 → 不占地、便携、减轻出行负担
- 功率大/转速高 → 不用等、口感好、提升效率
- 材质安全（如特定部件304） → 入口安心、无异味、母婴可用
- 多档位/智能化 → 免看管、精准满足挑剔需求（如泡奶/泡茶）

第三步：具象化结果表达（Result）
用生活化的类比、感官词汇或最终结果来重写，严格遵守广告合规底线（实事求是，不可无中生有夸大功能，没有的功能绝不乱写）。

【优秀推导学习样本（Few-Shot）】
输入参数：某水杯"重量200g"
推导：重量轻 → 携带无感 → 适合通勤
输出："塞进包里轻飘飘，通勤路上全靠它续命"

输入参数：某机器"15分钟快煮"
推导：效率参数 → 节省时间 → 适合打工人早上
输出："洗把脸的功夫就搞定，打工人多睡半小时的底气"

输入参数：某电器"进出水部件为304不锈钢"
推导：材质参数 → 核心涉水安全 → 规避异味痛点
输出："拒绝劣质塑料味，入口每一滴都安心"

输入参数：某风扇"12档变频风"
推导：档位参数 → 精准控制 → 怕冷又怕热的人群
输出："总有一阵风懂你的温度，轻柔得像自然风"

【京东文案生成核心法则：务实、精准、直击痛点】
- 场景前置化：直接圈定使用场景（如：差旅高铁、办公室工位、租房独居）
- 痛点具象化：戳中用户在特定场景下最烦恼的细节（如：酒店水壶不卫生、等烧水太慢、占地方）
- 结果断务化：将参数翻译成具体的解决方案，强调"效率"和"安心"

【绝对禁止指令（最高优先级）】
- 禁搜品牌词：标题中绝对不能出现品牌名称，将字数让给品类核心搜索词
- 严控事实与合规底线：必须严格依据提供的参数创作，绝不可自行脑补产品功能
- 如果未明确提及某功能，绝不允许编造
- 材质必须精准描述，不可夸大
- 性能必须实事求是，不可无中生有
- 摒弃无效营销词：严禁使用"绝绝子、yyds、闭眼入、仙女必备"等浮夸词汇

【字数要求】
每条标题严格控制在25字以内（包含标点符号、数字、emoji等所有字符）。请逐字数清楚。

【输出结构要求】
请从以下三种京东高转化结构中生成30条标题（A结构9条、B结构12条、C结构9条），每条都要不同，不要重复：

结构A（避坑防御型）：[直击痛点/劣质平替的坑] + [品类热搜词] + [靠谱结果]
范例：别再用酒店脏水壶了！自带折叠即热饮水机，差旅随时喝上干净温水。

结构B（效率提升型）：[精准场景/人群] + [品类热搜词] + [具体效率数据/结果]
范例：职场打工人必备！便携破壁机40秒出果汁，早上多睡十分钟。

结构C（痛点反转型）：[使用前的烦恼] + [品类热搜词] + [获得的使用体验]
范例：租房嫌烧水慢？工位放台小型即热饮水机，5档控温拯救挑剔胃。

【数量强制要求】
你必须输出恰好30条标题！A9条、B12条、C9条。少一条视为不合格。

【输出格式】
{"titles":[{"structure":"A","title":"标题1"},{"structure":"A","title":"标题2"},{"structure":"A","title":"标题3"},{"structure":"A","title":"标题4"},{"structure":"A","title":"标题5"},{"structure":"A","title":"标题6"},{"structure":"A","title":"标题7"},{"structure":"A","title":"标题8"},{"structure":"A","title":"标题9"},{"structure":"B","title":"标题10"},{"structure":"B","title":"标题11"},{"structure":"B","title":"标题12"},{"structure":"B","title":"标题13"},{"structure":"B","title":"标题14"},{"structure":"B","title":"标题15"},{"structure":"B","title":"标题16"},{"structure":"B","title":"标题17"},{"structure":"B","title":"标题18"},{"structure":"B","title":"标题19"},{"structure":"B","title":"标题20"},{"structure":"B","title":"标题21"},{"structure":"C","title":"标题22"},{"structure":"C","title":"标题23"},{"structure":"C","title":"标题24"},{"structure":"C","title":"标题25"},{"structure":"C","title":"标题26"},{"structure":"C","title":"标题27"},{"structure":"C","title":"标题28"},{"structure":"C","title":"标题29"},{"structure":"C","title":"标题30"}]}`;

// ── 调用 LLM API ──
async function callLLM(systemPrompt, userMessage) {
  var cfg = getUserLLMConfig();
  if (!cfg.model) {
    throw new Error('LLM 模型未配置，请在下方选择模型并填写 API Key');
  }
  if (!cfg.apiKey) {
    throw new Error('请填写 LLM API Key');
  }

  // 关思考模式避免 content 为空
  var extraOpts = { thinking: { type: 'disabled' } };
  var body = Object.assign({
    model: cfg.model,
    endpoint: cfg.endpoint,
    apiKey: cfg.apiKey,
    temperature: LLM_CONFIG.temperature,
    maxTokens: LLM_CONFIG.maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ]
  }, extraOpts);

  const res = await fetch('/api/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': sessionStorage.getItem('auth_token') || '' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM API 请求失败 (${res.status}): ${errText}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(`LLM API 错误: ${data.error.message || JSON.stringify(data.error)}`);

  // DeepSeek V4 默认 thinking 模式，需取 content + reasoning_content
  const msg = data.choices?.[0]?.message || {};
  const content = msg.content || msg.reasoning_content || '';
  if (!content.trim()) throw new Error('LLM 返回内容为空');

  return content;
}

// ── 组装 User Message（产品数据 + 分析数据） ──
function buildUserMessage(product, analysis) {
  const parts = [];

  parts.push(`【产品名称】${product.name}`);
  parts.push(`【品类热搜词】${getCategoryKW(product.name)}`);

  if (product.sellingPoints?.length) {
    parts.push(`【产品参数/卖点】\n${product.sellingPoints.join('、')}`);
  }
  if (product.scenes?.length) {
    parts.push(`【适用场景】${product.scenes.join('、')}`);
  }
  if (product.人群?.length) {
    parts.push(`【目标人群】${product.人群.join('、')}`);
  }

  // 分析数据补充
  if (analysis.wordFreq?.length) {
    const topWords = analysis.wordFreq.slice(0, 10).map(([w, c]) => `${w}(${c})`).join('、');
    parts.push(`【高绩效样本热门词根】${topWords}`);
  }
  if (analysis.industryKeywordAnalysis?.ranked?.length) {
    const kws = analysis.industryKeywordAnalysis.ranked.slice(0, 10).map(k => k.term).join('、');
    parts.push(`【行业热搜词】${kws}`);
  }
  if (analysis.titleAttributes?.bestType) {
    parts.push(`【样本中最佳标题属性】${analysis.titleAttributes.bestType}`);
  }
  if (analysis.byModel?.length) {
    const modelData = analysis.byModel.find(m => m.model === product.model);
    if (modelData?.wordFreq?.length) {
      const mw = modelData.wordFreq.slice(0, 8).map(([w, c]) => `${w}(${c})`).join('、');
      parts.push(`【该型号热门词根】${mw}`);
    }
  }

  parts.push('\n请根据以上信息，按照System Prompt中的参数转化三步法和三种结构要求，生成30条京东逛逛种草标题。每条标题严格控制在25字以内（含标点数字）。');

  return parts.join('\n');
}

function getCategoryKW(name) {
  if (name.includes('饮水') || name.includes('即热')) return '便携即热饮水机';
  if (name.includes('破壁') || name.includes('榨汁')) return '便携破壁机';
  if (name.includes('咖啡')) return '便携咖啡机';
  if (name.includes('火锅') || name.includes('锅')) return '电火锅';
  return name;
}

// ── 品牌词黑名单 ──
const KNOWN_BRANDS = typeof KNOWLEDGE_BASE !== 'undefined' ? KNOWLEDGE_BASE.brand.aliases : [];
const FORBIDDEN_TERMS = ['绝绝子','yyds','YYDS','闭眼入','仙女必备','必入','天花板','封神','无敌','杀疯了','给我冲','买它买它买它'];

function validateTitle(title) {
  if (KNOWN_BRANDS.some(b => title.includes(b))) return false;
  if (FORBIDDEN_TERMS.some(t => title.includes(t))) return false;
  const cleanLen = title.replace(/[\s]/g, '').length;
  if (cleanLen < 8 || cleanLen > 27) return false;
  return true;
}

// ── 解析 LLM 返回的 JSON ──
function parseLLMResponse(content) {
  var extractText = function(s) { return s; };

  // 尝试直接解析
  var parsed = null;
  try { parsed = JSON.parse(content); } catch(e) {}
  // 尝试 markdown 代码块
  if (!parsed) {
    var m = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) try { parsed = JSON.parse(m[1].trim()); } catch(e) {}
  }
  // 尝试提取 JSON 块
  if (!parsed) {
    var jm = content.match(/[\[{][\s\S]*[\]}]/);
    if (jm) try { parsed = JSON.parse(jm[0]); } catch(e) {}
  }

  if (parsed) {
    // {"titles":[...]} 格式
    if (parsed.titles && Array.isArray(parsed.titles)) return parsed.titles;
    // 纯数组格式 [{title:"..."},...]
    if (Array.isArray(parsed)) return parsed;
  }

  console.error('[解析失败] LLM 返回内容:', content.substring(0, 500));
  throw new Error('无法解析 LLM 返回内容');
}

// ── 主生成函数（每个型号一次LLM调用，15条取10条，5个型号并行） ──
async function generateAll(analysis, userInput) {
  // 构建产品数据
  var products = {};
  if (typeof KNOWLEDGE_BASE !== 'undefined') {
    for (var model in KNOWLEDGE_BASE.models) {
      var info = KNOWLEDGE_BASE.models[model];
      products[model] = {
        model: model,
        brand: KNOWLEDGE_BASE.brand.nameCn,
        name: info.name,
        sellingPoints: info.sellingPoints.slice(),
        scenes: info.scenes.slice(),
        人群: info.audience.slice()
      };
    }
  }

  if (userInput.customProduct) {
    var cp = userInput.customProduct;
    for (var m in products) {
      if (cp.name) products[m].name = cp.name;
      if (cp.sellingPoints && cp.sellingPoints.length) products[m].sellingPoints = cp.sellingPoints;
      if (cp.scenes && cp.scenes.length) products[m].scenes = cp.scenes;
      if (cp.人群 && cp.人群.length) products[m].人群 = cp.人群;
    }
  }

  var targetModels = Object.keys(products);
  if (userInput.model && products[userInput.model]) targetModels = [userInput.model];

  // 精简 Prompt（去掉冗长的 SYSTEM_PROMPT，每个调用自己带）
  var prompt = SYSTEM_PROMPT;

  var modelPromises = targetModels.map(function(model) {
    var product = products[model];
    var userMessage = buildUserMessage(product, analysis);

    // 偶发空响应时重试一次
    function tryCallLLM(retry) {
      return callLLM(prompt, userMessage).catch(function(e) {
        if (retry && e.message === 'LLM 返回内容为空') return callLLM(prompt, userMessage);
        throw e;
      });
    }
    return tryCallLLM(true).then(function(raw) {
      var parsed = parseLLMResponse(raw);
      // 自动推断缺失的 structure 字段（按 9A+12B+9C 顺序，与 Prompt 一致）
      var structureOrder = [];
      for (var s = 0; s < 9; s++) structureOrder.push('A');
      for (var s = 0; s < 12; s++) structureOrder.push('B');
      for (var s = 0; s < 9; s++) structureOrder.push('C');
      var valid = parsed
        .map(function(t, i) {
          return { title: (t.title||'').replace(/["""]|["""]$/g,'').trim(), structure: t.structure || structureOrder[i] || 'B', words: (t.title||'').replace(/[\s]/g,'').length };
        })
        .filter(function(t){ return validateTitle(t.title); });
      // 30条中按结构取：A取3 B取4 C取3
      var picked = [].concat(
        valid.filter(function(t){return t.structure==='A'}).slice(0,3),
        valid.filter(function(t){return t.structure==='B'}).slice(0,4),
        valid.filter(function(t){return t.structure==='C'}).slice(0,3)
      );
      var titles = picked.map(function(t){ return { title: t.title, structure: t.structure, words: t.words, reasoning: '结构'+t.structure+' · LLM生成' }; });
      var strategy = '大模型生成（'+LLM_CONFIG.model+'）\n  · 品类热搜词：'+getCategoryKW(product.name)+'\n  · 生成规则：A避坑防御(3条) / B效率提升(4条) / C痛点反转(3条)\n  · 字数限制：27字内（含标点数字）\n  · 禁止品牌词 + 禁止浮夸词 + 参数事实合规';
      return { model: model, result: { product: product, titles: titles, strategy: strategy } };
    }).catch(function(e) {
      return { model: model, result: { product: product, titles: [], strategy: '', error: e.message } };
    });
  });

  var results = await Promise.all(modelPromises);
  var allResults = {};
  for (var i = 0; i < results.length; i++) {
    allResults[results[i].model] = results[i].result;
  }
  return allResults;
}
