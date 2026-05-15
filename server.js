#!/usr/bin/env node
/**
 * Model Discovery Server for OpenClaw
 * 输入 base URL + API key，自动发现可用模型，一键配置
 */
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18800;
const CONFIG_PATH = path.join(process.env.USERPROFILE || process.env.HOME, '.openclaw', 'openclaw.json');
const GATEWAY_PORT = 18789;

// --- CORS headers ---
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(res, status, data) {
  res.writeHead(status, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// --- Read openclaw.json ---
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

// --- Write openclaw.json ---
function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

// Load model metadata from JSON file (external knowledge base)
let MODEL_METADATA = {};
try {
  const metadataPath = path.join(__dirname, 'model-metadata.json');
  MODEL_METADATA = JSON.parse(fs.readFileSync(metadataPath, 'utf8')).models || {};
  console.log(`Loaded ${Object.keys(MODEL_METADATA).length} model specs from metadata file`);
} catch (e) {
  console.log('Warning: Could not load model-metadata.json:', e.message);
}

// Resolve model specs: metadata > API data > pattern matching > safe defaults
function resolveModelSpecs(modelId, apiContextWindow, apiMaxTokens) {
  // Priority 1: Use API-provided data if available
  if (apiContextWindow) {
    return {
      contextWindow: apiContextWindow,
      maxTokens: apiMaxTokens || 8192,
      input: ['text'],
      source: 'api'
    };
  }

  // Convert ModelScope ID to OpenRouter format for metadata lookup
  // e.g., 'deepseek-ai/DeepSeek-V4-Pro' -> 'deepseek/deepseek-v4-pro'
  let metadataKey = modelId.toLowerCase();
  metadataKey = metadataKey.replace(/^deepseek-ai\//, 'deepseek/');
  metadataKey = metadataKey.replace(/^qwen\//, 'qwen/');
  metadataKey = metadataKey.replace(/^zhipuai\//, 'zhipuai/');
  metadataKey = metadataKey.replace(/^moonshotai\//, 'moonshotai/');
  metadataKey = metadataKey.replace(/^inclusionai\//, 'inclusionai/');
  metadataKey = metadataKey.replace(/^minimax\//, 'minimax/');
  metadataKey = metadataKey.replace(/^google\//, 'google/');
  metadataKey = metadataKey.replace(/^meta-llama\//, 'meta-llama/');
  metadataKey = metadataKey.replace(/^mistralai\//, 'mistralai/');
  metadataKey = metadataKey.replace(/^stepfun-ai\//, 'stepfun/');
  metadataKey = metadataKey.replace(/^xiaomimimo\//, 'xiaomi/');
  metadataKey = metadataKey.replace(/^shanghai_ai_laboratory\//, 'baidu/');
  metadataKey = metadataKey.replace(/^nvidia\//, 'nvidia/');
  metadataKey = metadataKey.replace(/^meituan-longcat\//, 'meituan/');
  // Remove special characters but keep hyphens (e.g., 'ling-2.6-1t')
  // Remove common suffixes like -instruct, -chat, -thinking
  metadataKey = metadataKey.replace(/-instruct.*$/, '');
  metadataKey = metadataKey.replace(/-chat.*$/, '');
  metadataKey = metadataKey.replace(/-thinking.*$/, '');
  // Remove underscores and dots
  metadataKey = metadataKey.replace(/[_\.]/g, '');
  
  // Priority 2: Look up in external metadata JSON (with converted key)
  const metadata = MODEL_METADATA[metadataKey];
  if (metadata) {
    return { ...metadata, source: 'metadata' };
  }

  // Also try exact match (in case ID already matches)
  const exactMetadata = MODEL_METADATA[modelId];
  if (exactMetadata) {
    return { ...exactMetadata, source: 'metadata' };
  }

  // Priority 3: Pattern matching based on model name
  const patterns = [
    [/deepseek.*v4/i, { cw: 1000000, mt: 8192 }],
    [/deepseek.*v3/i, { cw: 128000, mt: 8192 }],
    [/deepseek.*r1/i, { cw: 1000000, mt: 8192 }],
    [/qwen3.*vl/i, { cw: 128000, mt: 8192 }],
    [/qwen3.*30b/i, { cw: 128000, mt: 8192 }],
    [/qwen3/i, { cw: 128000, mt: 8192 }],
    [/qwen2.*vl/i, { cw: 128000, mt: 8192 }],
    [/qwen2.*72b/i, { cw: 128000, mt: 8192 }],
    [/qwen2.*7b/i, { cw: 128000, mt: 8192 }],
    [/glm.*5/i, { cw: 200000, mt: 65536 }],
    [/glm.*4v/i, { cw: 128000, mt: 4096 }],
    [/glm.*4/i, { cw: 128000, mt: 4096 }],
    [/ling.*2\.6/i, { cw: 128000, mt: 8192 }],
    [/kimi.*k2/i, { cw: 256000, mt: 8192 }],
    [/gemma.*4/i, { cw: 128000, mt: 8192 }],
    [/llama.*4/i, { cw: 1000000, mt: 8192 }],
    [/llama.*3\.3/i, { cw: 128000, mt: 8192 }],
    [/mistral.*large/i, { cw: 128000, mt: 8192 }],
    [/mistral.*small/i, { cw: 128000, mt: 8192 }],
    [/.*70b.*|.*65b.*|.*-70b/i, { cw: 128000, mt: 8192 }],
    [/.*32b.*|.*-32b/i, { cw: 128000, mt: 8192 }],
    [/.*8b.*|.*-8b/i, { cw: 32000, mt: 8192 }],
    [/.*7b.*|.*-7b/i, { cw: 32000, mt: 8192 }],
  ];

  for (const [regex, spec] of patterns) {
    if (regex.test(modelId)) {
      return { contextWindow: spec.cw, maxTokens: spec.mt, input: ['text'], source: 'pattern' };
    }
  }

  // Priority 4: Safe defaults
  return { contextWindow: 32000, maxTokens: 8192, input: ['text'], source: 'default' };
}

// --- Proxy: fetch models from provider ---
async function fetchModels(baseUrl, apiKey) {
  // Normalize base URL
  const base = baseUrl.replace(/\/+$/, '');

  // Detect provider type for URL construction and auth method
  const isGoogle = baseUrl.includes('generativelanguage.googleapis.com') || baseUrl.includes('ai.google.dev');
  const isModelScope = baseUrl.includes('modelscope.cn') || baseUrl.includes('modelscope.com');
  const isHuggingFace = baseUrl.includes('huggingface.co') || baseUrl.includes('hf.co');

  // Build candidate URLs based on provider type
  let urls;
  if (isGoogle) {
    // Google AI Studio: endpoint is /v1beta/models?key=xxx (no /v1 prefix needed)
    urls = [`${base}/models?key=${apiKey}`];
  } else {
    // OpenAI-compatible providers: /v1/models or /models
    urls = [
      base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`,
      `${base}/models`,
    ];
  }

  let lastError;
  let officialModels = [];
  
  // Step 1: Get from official endpoint
  for (const url of urls) {
    try {
      // Google uses ?key=xxx auth, others use Bearer token
      const headers = isGoogle
        ? { 'Content-Type': 'application/json' }
        : { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

      const resp = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) {
        lastError = new Error(`Provider returned ${resp.status}`);
        continue;
      }

      const data = await resp.json();
      // Support multiple API response formats:
      // 1. OpenAI format: { data: [...] }
      // 2. Google format: { models: [...] }
      // 3. Direct array: [...]
      if (Array.isArray(data)) {
        officialModels = data;
      } else if (data.data && Array.isArray(data.data)) {
        officialModels = data.data;
      } else if (data.models && Array.isArray(data.models)) {
        officialModels = data.models;
      } else {
        lastError = new Error('Unexpected API response format');
        continue;
      }
      if (officialModels.length > 0) break; // Success
    } catch (err) {
      lastError = err;
    }
  }
  
  if (officialModels.length === 0 && lastError) {
    throw lastError || new Error('Failed to fetch models');
  }

  // Step 2: If this is ModelScope, also get hidden models from /dolphin/models
  let extraModels = [];
  
  if (isModelScope && apiKey) {
    try {
      console.log('Fetching additional ModelScope models from dolphin API...');
      const dolphinHeaders = {
        'x-modelscope-accept-language': 'zh_CN',
        'user-agent': 'Mozilla/5.0',
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/json',
      };
      
      // Fetch multiple pages of text models filtered by api_inference
      for (let pn = 1; pn <= 3; pn++) {
        const dolphinRes = await fetch('https://modelscope.cn/api/v1/dolphin/models', {
          method: 'PUT',
          headers: dolphinHeaders,
          body: JSON.stringify({
            PageSize: 100, PageNumber: pn, SortBy: 'Default',
            Target: 'api_inference', SingleCriterion: [], Criterion: []
          }),
          signal: AbortSignal.timeout(10000)
        });
        const dolphinData = await dolphinRes.json();
        const pageModels = dolphinData.Data?.Model?.Models || [];
        
        // Filter to only text models (LLMs)
        const txtModels = pageModels.filter(m => m.SupportInference === 'txt2txt' && m.IsPublished === 1);
        
        // Convert to standard format
        txtModels.forEach(m => {
          const modelId = m.Path + '/' + m.Name;
          extraModels.push({ id: modelId, owned_by: m.Path });
        });
        
        console.log(`Dolphin page ${pn}: found ${pageModels.length} models (${txtModels.length} text models)`);
        if (pageModels.length < 100) break; // No more pages
      }
      
      // Deduplicate - remove models already in official list
      const officialIds = new Set(officialModels.map(m => m.id));
      const seenIds = new Set(officialIds);
      const uniqueExtraModels = [];
      for (const m of extraModels) {
        if (!seenIds.has(m.id)) {
          seenIds.add(m.id);
          uniqueExtraModels.push(m);
        }
      }
      
      console.log(`Found ${uniqueExtraModels.length} hidden ModelScope models`);
      if (uniqueExtraModels.length > 0) {
        uniqueExtraModels.forEach(m => console.log(`  Hidden: ${m.id}`));
      }
      
      extraModels = uniqueExtraModels;
    } catch (e) {
      console.log('Note: Failed to fetch extra ModelScope models:', e.message.slice(0, 80));
    }
  }
  
  // Combine official + extra models
  const allModels = [...officialModels, ...extraModels];
  
  // For Google, workingBaseUrl stays as-is (no /v1 suffix needed)
  const workingBaseUrl = isGoogle ? base : (base.endsWith('/v1') ? `${base}` : `${base}/v1`);
  
  // Extract rate limit headers from first successful request (only for ModelScope)
  const rateLimit = {};
  if (isModelScope) {
    try {
      const testRes = await fetch(`${workingBaseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000)
      });
      const rateHeaders = [
        'modelscope-ratelimit-requests-limit',
        'modelscope-ratelimit-requests-remaining',
        'modelscope-ratelimit-model-requests-limit',
        'modelscope-ratelimit-model-requests-remaining'
      ];
      for (const h of rateHeaders) {
        const val = testRes.headers.get(h);
        if (val) rateLimit[h] = parseInt(val, 10);
      }
    } catch {}
  }
  
  // Map all models to standard format
  // Google format: { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: [...] }
  // OpenAI format: { id: "gemini-2.5-flash", owned_by: "google", ... }
  return { 
    models: allModels.map(m => {
      // Normalize model ID
      let modelId = m.id || m.name || m.model_id || '';
      // Google: strip "models/" prefix from name field
      if (modelId.startsWith('models/')) modelId = modelId.slice(7);
      
      // Extract context_window from various API formats
      let contextWindow = m.context_window || m.context_length || m.inputTokenLimit || null;
      let maxTokens = m.max_tokens || m.outputTokenLimit || null;

      // Hugging Face format: context_length is in providers array
      if (!contextWindow && Array.isArray(m.providers) && m.providers.length > 0) {
        for (const p of m.providers) {
          if (p.context_length) {
            contextWindow = p.context_length;
            break;
          }
        }
      }

      const specs = resolveModelSpecs(modelId, contextWindow, maxTokens);
      
      // Determine input modalities
      // Google models with generateContent support multimodal by default
      let input = specs.input;
      if (isGoogle && m.supportedGenerationMethods?.includes('generateContent')) {
        // Gemini models support text + image
        if (modelId.includes('flash') || modelId.includes('pro')) {
          if (!modelId.includes('embedding') && !modelId.includes('tts') && !modelId.includes('audio')) {
            input = ['text', 'image'];
          }
        }
      }

      // Determine display name
      const displayName = m.displayName || m.name || modelId;

      return {
        id: modelId,
        name: displayName,
        owned_by: m.owned_by || '',
        context_window: specs.contextWindow,
        max_tokens: specs.maxTokens,
        input: input,
        source: specs.source,
      };
    }), 
    workingBaseUrl, 
    rateLimit: Object.keys(rateLimit).length > 0 ? rateLimit : null 
  };
}

// --- Save model to openclaw.json ---
function saveModel(baseUrl, apiKey, modelId, contextWindow, maxTokens) {
  const config = readConfig();
  let normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedUrl = normalizedBase.toLowerCase();

  // Ensure structure
  if (!config.models) config.models = {};
  if (!config.models.providers) config.models.providers = {};
  if (!config.agents) config.agents = {};
  if (!config.agents.defaults) config.agents.defaults = {};

  // Find existing provider with same baseURL + apiKey
  // Also detect old-format provider IDs (without 'custom-' prefix) for migration
  let providerId = null;
  let oldProviderId = null;
  for (const [pid, p] of Object.entries(config.models.providers)) {
    if (p.baseUrl && p.apiKey &&
        p.baseUrl.replace(/\/+$/, '').toLowerCase() === normalizedUrl &&
        p.apiKey === apiKey) {
      providerId = pid;
      if (!pid.startsWith('custom-')) {
        oldProviderId = pid;
      }
      break;
    }
  }

  // Migrate old-format provider ID to new 'custom-' prefixed format
  if (oldProviderId) {
    const newProviderId = 'custom-' + oldProviderId;
    config.models.providers[newProviderId] = config.models.providers[oldProviderId];
    delete config.models.providers[oldProviderId];
    // Update model references in agents.defaults.models
    const models = config.agents?.defaults?.models;
    if (models) {
      for (const key of Object.keys(models)) {
        if (key.startsWith(oldProviderId + '/')) {
          const newKey = newProviderId + key.slice(oldProviderId.length);
          models[newKey] = models[key];
          delete models[key];
        }
      }
    }
    // Update primary model reference
    if (config.agents?.defaults?.model?.primary?.startsWith(oldProviderId + '/')) {
      config.agents.defaults.model.primary = newProviderId + config.agents.defaults.model.primary.slice(oldProviderId.length);
    }
    providerId = newProviderId;
  }

  // If not found, generate new provider ID
  // OpenClaw 2026.5.7+ requires custom provider IDs to start with 'custom-'
  if (!providerId) {
    const keyHash = crypto.createHash('sha256').update(normalizedUrl + '|' + apiKey).digest('hex').slice(0, 8);
    const urlObj = new URL(normalizedUrl);
    let hostPart = urlObj.hostname.replace(/\./g, '-').replace(/[^a-z0-9-]/g, '');
    if (hostPart.startsWith('-')) hostPart = hostPart.slice(1);
    if (!hostPart) hostPart = 'provider';
    providerId = 'custom-' + hostPart + '-' + keyHash;
  }

  // Build provider config
  let apiFormat = 'openai-completions';
  const baseLower = baseUrl.toLowerCase();
  if (baseLower.includes('ollama')) apiFormat = 'ollama';
  else if (baseLower.includes('anthropic') || baseLower.includes('claude')) apiFormat = 'anthropic-messages';

  // Build model entry using specs resolution
  const specs = resolveModelSpecs(modelId, contextWindow, maxTokens);
  const newModel = {
    id: modelId,
    name: modelId,
    contextWindow: specs.contextWindow,
    maxTokens: specs.maxTokens,
    input: specs.input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
  };

  // Merge: if provider exists, append model (skip duplicates); otherwise create new
  const existing = config.models.providers[providerId];
  if (existing) {
    // Update api key / baseUrl if changed
    existing.baseUrl = normalizedBase;
    existing.apiKey = apiKey;
    if (!existing.models) existing.models = [];
    if (!existing.models.some(m => m.id === modelId)) {
      existing.models.push(newModel);
    }
  } else {
    config.models.providers[providerId] = {
      baseUrl: normalizedBase,
      apiKey: apiKey,
      api: apiFormat,
      models: [newModel],
    };
  }

  writeConfig(config);

  // Sync to agents.defaults.models
  const fullModelId = `${providerId}/${modelId}`;
  if (!config.agents.defaults.models) config.agents.defaults.models = {};
  if (!config.agents.defaults.models[fullModelId]) {
    config.agents.defaults.models[fullModelId] = {};
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  }

  return { providerId };
}

// --- Delete model from openclaw.json ---
function deleteModel(providerId, modelId) {
  const config = readConfig();
  const provider = config.models?.providers?.[providerId];
  if (!provider) return { error: 'Provider not found' };

  // Remove model from provider
  if (provider.models) {
    provider.models = provider.models.filter(m => m.id !== modelId);
  }

  // If provider has no models left, remove the entire provider
  if (!provider.models || provider.models.length === 0) {
    delete config.models.providers[providerId];
  }

  // Remove from agents.defaults.models
  const fullModelId = `${providerId}/${modelId}`;
  if (config.agents?.defaults?.models) {
    delete config.agents.defaults.models[fullModelId];
  }

  // If this was the primary model, clear it
  if (config.agents?.defaults?.model?.primary === fullModelId) {
    config.agents.defaults.model.primary = '';
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  return { success: true, fullModelId };
}

// --- Restart gateway ---
async function restartGateway() {
  try {
    const { execSync } = await import('node:child_process');
    execSync('openclaw gateway restart', { timeout: 30000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// --- HTTP server ---
const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // GET /api/fetch-models?url=...&key=...
  if (url.pathname === '/api/fetch-models' && req.method === 'GET') {
    const baseUrl = url.searchParams.get('url');
    const apiKey = url.searchParams.get('key');
    if (!baseUrl || !apiKey) {
      return jsonResponse(res, 400, { error: 'Missing url or key parameter' });
    }
    try {
      const result = await fetchModels(baseUrl, apiKey);
      jsonResponse(res, 200, { models: result.models, workingBaseUrl: result.workingBaseUrl, rateLimit: result.rateLimit });
    } catch (err) {
      jsonResponse(res, 502, { error: err.message });
    }
    return;
  }

  // POST /api/save
  if (url.pathname === '/api/save' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const { baseUrl, apiKey, modelId, contextWindow, maxTokens } = JSON.parse(body);
      if (!baseUrl || !apiKey || !modelId) {
        return jsonResponse(res, 400, { error: 'Missing baseUrl, apiKey, or modelId' });
      }
      const result = saveModel(baseUrl, apiKey, modelId, contextWindow, maxTokens);
      jsonResponse(res, 200, { success: true, ...result });
    } catch (err) {
      jsonResponse(res, 500, { error: err.message });
    }
    return;
  }

  // POST /api/delete-model
  if (url.pathname === '/api/delete-model' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const { providerId, modelId } = JSON.parse(body);
      if (!providerId || !modelId) {
        return jsonResponse(res, 400, { error: 'Missing providerId or modelId' });
      }
      const result = deleteModel(providerId, modelId);
      if (result.error) {
        return jsonResponse(res, 404, { error: result.error });
      }
      jsonResponse(res, 200, result);
    } catch (err) {
      jsonResponse(res, 500, { error: err.message });
    }
    return;
  }

  // POST /api/restart
  if (url.pathname === '/api/restart' && req.method === 'POST') {
    const ok = await restartGateway();
    jsonResponse(res, 200, { success: ok });
    return;
  }

  // GET /api/providers - list all providers from openclaw.json
  if (url.pathname === '/api/providers') {
    const config = readConfig();
    const providers = config.models?.providers || {};
    const list = [];
    for (const [pid, p] of Object.entries(providers)) {
      list.push({
        id: pid,
        baseUrl: p.baseUrl || '',
        apiKey: p.apiKey || '',
        models: (p.models || []).map(m => m.id),
      });
    }
    jsonResponse(res, 200, { providers: list });
    return;
  }

  // GET /api/current-config
  if (url.pathname === '/api/current-config') {
    const config = readConfig();
    const providers = config.models?.providers || {};
    const current = {};
    for (const [pid, p] of Object.entries(providers)) {
      current[pid] = {
        baseUrl: p.baseUrl,
        models: (p.models || []).map(m => m.id),
      };
    }
    jsonResponse(res, 200, { current, primary: config.agents?.defaults?.model?.primary || '' });
    return;
  }

  // POST /api/test-chat (SSE streaming)
  if (url.pathname === '/api/test-chat' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const { baseUrl, apiKey, modelId, message } = JSON.parse(body);
      if (!baseUrl || !apiKey || !modelId || !message) {
        return jsonResponse(res, 400, { error: 'Missing baseUrl, apiKey, modelId, or message' });
      }

      // Detect provider type for chat URL and auth
      const isGoogle = baseUrl.includes('generativelanguage.googleapis.com') || baseUrl.includes('ai.google.dev');

      // Build chat completions URL
      let chatUrl = baseUrl.replace(/\/+$/, '');
      if (isGoogle) {
        // Google AI Studio OpenAI-compatible endpoint
        chatUrl += '/openai/chat/completions';
      } else if (chatUrl.endsWith('/v1')) {
        chatUrl += '/chat/completions';
      } else {
        chatUrl += '/v1/chat/completions';
      }

      // Auth headers: all providers use Bearer token (including Google OpenAI-compatible endpoint)
      const chatHeaders = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

      // Start SSE
      res.writeHead(200, {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const startTime = Date.now();
      let tokenCount = 0;

      const resp = await fetch(chatUrl, {
        method: 'POST',
        headers: chatHeaders,
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: message }],
          stream: true,
        }),
        signal: AbortSignal.timeout(60000),
      });

      // Try to extract rate limit headers (even from error responses)
      const rateLimit = {};
      const rateHeaders = ['modelscope-ratelimit-requests-limit', 'modelscope-ratelimit-requests-remaining', 'modelscope-ratelimit-model-requests-limit', 'modelscope-ratelimit-model-requests-remaining'];
      for (const h of rateHeaders) {
        const val = resp.headers.get(h);
        if (val) rateLimit[h] = parseInt(val, 10);
      }
      if (Object.keys(rateLimit).length > 0) {
        res.write(`data: ${JSON.stringify({ rateLimit })}\n\n`);
      }

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        res.write(`data: ${JSON.stringify({ error: `Provider returned ${resp.status}: ${text.slice(0, 200)}` })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            const elapsed = (Date.now() - startTime) / 1000;
            const tps = tokenCount > 0 && elapsed > 0 ? (tokenCount / elapsed).toFixed(1) : '0';
            res.write(`data: ${JSON.stringify({ done: true, tokens: tokenCount, elapsed: elapsed.toFixed(1), tps })}\n\n`);
            return res.end();
          }
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              tokenCount++;
              res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }
          } catch {}
        }
      }

      // If we get here without [DONE], send final stats
      const elapsed = (Date.now() - startTime) / 1000;
      const tps = tokenCount > 0 && elapsed > 0 ? (tokenCount / elapsed).toFixed(1) : '0';
      res.write(`data: ${JSON.stringify({ done: true, tokens: tokenCount, elapsed: elapsed.toFixed(1), tps })}\n\n`);
      res.end();
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
    return;
  }

  // Serve static files
  let filePath = path.join(__dirname, url.pathname === '/' ? 'index.html' : url.pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  jsonResponse(res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🔍 Model Discovery Server running at:`);
  console.log(`   http://127.0.0.1:${PORT}/`);
  console.log(`\n   Config: ${CONFIG_PATH}`);
  console.log(`   Press Ctrl+C to stop\n`);
});
