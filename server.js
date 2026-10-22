'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { execFile } = require('node:child_process');
const { toOpenAI, fromOpenAI, sendSse } = require('./inception');
const { PRESETS, resolveProvider, endpoint, publicConnection, supportsClaudeCodeModel } = require('./providers');
const vault = require('./vault');

const HOST = '127.0.0.1';
const PORT = Number(process.env.CKC_PORT || 3848);
const DATA = path.resolve(process.env.CKC_DATA_DIR || path.join(__dirname, 'data'));
const TOKEN_FILE = path.join(DATA, 'client-token');
const VAULT_FILE = path.join(DATA, 'providers.vault');
fs.mkdirSync(DATA, { recursive: true });
const clientToken = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8').trim() : crypto.randomBytes(32).toString('hex');
if (!fs.existsSync(TOKEN_FILE)) fs.writeFileSync(TOKEN_FILE, clientToken, { mode: 0o600 });
let connections = vault.load(VAULT_FILE);

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(data);
}
function error(res, status, message) { return json(res, status, { error: message }); }
function readBody(req, limit = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > limit) { reject(new Error('Request too large')); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, limit) { return JSON.parse((await readBody(req, limit)).toString('utf8')); }
function validModel(value) { return typeof value === 'string' && /^[a-zA-Z0-9._:/+-]{1,160}$/.test(value.trim()); }
function authorize(req) {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  const supplied = req.headers['x-api-key'] || (bearer && bearer[1]) || '';
  const a = Buffer.from(String(supplied)); const b = Buffer.from(clientToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function allowed(req) {
  const host = req.headers.host;
  if (!['127.0.0.1', 'localhost', '[::1]'].some(value => host === `${value}:${PORT}`)) return false;
  const origin = req.headers.origin;
  return !origin || origin === `http://127.0.0.1:${PORT}` || origin === `http://localhost:${PORT}`;
}
function save(next) { vault.save(VAULT_FILE, next); connections = next; }
function credentials(provider, key) {
  if (provider.id === 'opencodego') return { authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01', 'x-opencode-session': `ses_${crypto.createHash('sha256').update(clientToken).digest('hex').slice(0, 24)}` };
  return provider.dialect === 'anthropic'
    ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    : { authorization: `Bearer ${key}` };
}
async function upstream(provider, key, kind, method, body) {
  const response = await fetch(endpoint(provider, kind), { method, headers: { ...credentials(provider, key), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(kind === 'models' ? 30000 : 600000) });
  return response;
}
function upstreamError(raw, status) {
  let message = raw.slice(0, 500);
  try { const parsed = JSON.parse(raw); message = parsed.error?.message || parsed.message || message; } catch { /* text response */ }
  return { status, message: String(message).slice(0, 500) };
}
async function discover(provider, key) {
  const response = await upstream(provider, key, 'models', 'GET');
  const raw = await response.text();
  if (!response.ok) throw new Error(upstreamError(raw, response.status).message);
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed.data) ? parsed.data : Array.isArray(parsed.models) ? parsed.models : [];
  const models = list.map(item => typeof item === 'string' ? { id: item, name: item } : { id: item.id || item.name, name: item.display_name || item.name || item.id }).filter(item => validModel(item.id) && supportsClaudeCodeModel(provider, item.id));
  models.sort((a, b) => a.name.localeCompare(b.name));
  return models;
}
async function callRoute(connection, input) {
  const provider = resolveProvider(connection.provider, connection.customBase, connection.customDialect);
  let payload;
  try {
    if (provider.dialect === 'anthropic') payload = { ...input, model: connection.model };
    else {
      payload = toOpenAI(input, connection.model, provider.tokenField || 'max_tokens');
      if (connection.provider === 'inception' && !input.tools?.length) payload.reasoning_effort = 'low';
    }
  } catch (cause) { return { ok: false, status: 400, message: cause.message }; }
  let response;
  try { response = await upstream(provider, connection.key, 'chat', 'POST', payload); }
  catch (cause) { return { ok: false, status: 502, message: cause.message }; }
  if (!response.ok) return { ok: false, ...upstreamError(await response.text(), response.status) };
  if (provider.dialect === 'anthropic' && input.stream) return { ok: true, stream: response.body, contentType: response.headers.get('content-type') || 'text/event-stream', provider };
  let data;
  try { data = await response.json(); } catch { return { ok: false, status: 502, message: 'Provider returned invalid JSON.' }; }
  if (provider.dialect !== 'anthropic') data = fromOpenAI(data, connection.model);
  if (!Array.isArray(data.content) || data.content.length === 0) return { ok: false, status: 502, message: 'Provider returned no visible content.' };
  return { ok: true, data, provider };
}
async function handle(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const pathname = url.pathname;
  if (!allowed(req)) return error(res, 403, 'Invalid host or origin.');
  if (req.method === 'GET' && (pathname === '/' || pathname === '/app.js')) {
    const file = path.join(__dirname, pathname === '/' ? 'index.html' : 'app.js');
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'content-type': pathname === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store', ...(pathname === '/' ? { 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'" } : {}) });
    return res.end(body);
  }
  if (req.method === 'GET' && pathname === '/api/status') return json(res, 200, { configured: connections.length > 0, model: connections[0]?.model || '', provider: connections[0]?.provider || '', count: connections.length, endpoint: `http://${HOST}:${PORT}` });
  if (req.method === 'GET' && pathname === '/api/connections') return json(res, 200, { connections: connections.map(publicConnection), providers: Object.entries(PRESETS).map(([id, value]) => ({ id, label: value.label })) });
  if (req.method === 'POST' && pathname === '/api/discover') {
    const input = await readJson(req, 64 * 1024);
    const provider = resolveProvider(input.provider, input.customBase, input.customDialect);
    if (typeof input.apiKey !== 'string' || !input.apiKey.trim()) return error(res, 400, 'Enter an API key first.');
    try { return json(res, 200, { models: await discover(provider, input.apiKey.trim()) }); }
    catch (cause) { return error(res, 502, `Model lookup failed: ${cause.message}`); }
  }
  if (req.method === 'POST' && pathname === '/api/connections') {
    const input = await readJson(req, 64 * 1024);
    const provider = resolveProvider(input.provider, input.customBase, input.customDialect);
    if (typeof input.apiKey !== 'string' || !input.apiKey.trim() || !validModel(input.model)) return error(res, 400, 'Enter an API key and choose a model.');
    const connection = { id: crypto.randomUUID(), provider: provider.id, key: input.apiKey.trim(), model: input.model.trim(), ...(provider.id === 'custom' ? { customBase: provider.customBase, customDialect: provider.customDialect } : {}) };
    save([...connections, connection]);
    return json(res, 201, { connection: publicConnection(connection) });
  }
  if (req.method === 'POST' && pathname === '/api/connections/reorder') {
    const input = await readJson(req, 64 * 1024);
    if (!Array.isArray(input.ids) || input.ids.length !== connections.length || new Set(input.ids).size !== connections.length) return error(res, 400, 'Invalid fallback order.');
    const byId = new Map(connections.map(connection => [connection.id, connection]));
    if (input.ids.some(id => !byId.has(id))) return error(res, 400, 'Invalid fallback order.');
    save(input.ids.map(id => byId.get(id)));
    return json(res, 200, { connections: connections.map(publicConnection) });
  }
  const connectionPath = /^\/api\/connections\/([0-9a-f-]+)(?:\/(models|test))?$/.exec(pathname);
  if (connectionPath) {
    const index = connections.findIndex(connection => connection.id === connectionPath[1]);
    if (index < 0) return error(res, 404, 'Connection not found.');
    const connection = connections[index];
    if (req.method === 'DELETE' && !connectionPath[2]) { save(connections.filter((_, n) => n !== index)); return json(res, 200, { removed: true }); }
    if (req.method === 'PATCH' && !connectionPath[2]) {
      const input = await readJson(req, 64 * 1024);
      if (!validModel(input.model)) return error(res, 400, 'Choose a valid model.');
      const updated = { ...connection, model: input.model.trim() };
      save(connections.map((item, n) => n === index ? updated : item));
      return json(res, 200, { connection: publicConnection(updated) });
    }
    if (req.method === 'GET' && connectionPath[2] === 'models') {
      try { return json(res, 200, { models: await discover(resolveProvider(connection.provider, connection.customBase, connection.customDialect), connection.key) }); }
      catch (cause) { return error(res, 502, `Model lookup failed: ${cause.message}`); }
    }
    if (req.method === 'POST' && connectionPath[2] === 'test') {
      const result = await callRoute(connection, { max_tokens: 128, messages: [{ role: 'user', content: 'Reply with OK.' }] });
      if (!result.ok) return error(res, result.status, result.message);
      const reply = result.data.content.filter(part => part.type === 'text').map(part => part.text).join(' ');
      if (!reply.trim()) return error(res, 502, 'Provider returned no visible reply.');
      return json(res, 200, { ok: true, model: result.data.model, reply });
    }
  }
  if (req.method === 'POST' && pathname === '/api/launch') {
    if (!connections.length) return error(res, 400, 'Add a provider and select a model first.');
    const script = process.env.CKC_LAUNCH_SCRIPT || path.join(__dirname, 'Launch Claude Code.ps1');
    return execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { cwd: __dirname, windowsHide: true, timeout: 15000 }, (cause, stdout, stderr) => {
      if (cause) return error(res, 500, (stderr || cause.message).trim().slice(0, 500));
      json(res, 200, { launched: true });
    });
  }
  if (pathname === '/v1/messages' && req.method === 'POST') {
    if (!authorize(req)) return json(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'Invalid gateway token.' } });
    if (!connections.length) return json(res, 503, { type: 'error', error: { type: 'api_error', message: 'Add a provider in the local website first.' } });
    let input; try { input = await readJson(req); } catch { return json(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'Invalid JSON.' } }); }
    const failures = [];
    for (const connection of connections) {
      const result = await callRoute(connection, input);
      if (!result.ok) { failures.push(`${connection.provider}/${connection.model}: ${result.status} ${result.message}`); continue; }
      if (result.stream) {
        res.writeHead(200, { 'content-type': result.contentType, 'cache-control': 'no-store', 'x-ckc-route': connection.provider });
        Readable.fromWeb(result.stream).pipe(res);
        return;
      }
      if (input.stream) { res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-ckc-route': connection.provider }); return sendSse(res, result.data); }
      return json(res, 200, result.data);
    }
    return json(res, 502, { type: 'error', error: { type: 'api_error', message: `All configured providers failed. ${failures.join(' | ').slice(0, 1500)}` } });
  }
  if (pathname === '/v1/models' && req.method === 'GET') {
    if (!authorize(req)) return json(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'Invalid gateway token.' } });
    const models = [...new Set(connections.map(connection => connection.model))];
    return json(res, 200, { data: models.map(id => ({ id, type: 'model', display_name: id, created_at: new Date().toISOString() })), has_more: false, first_id: models[0] || null, last_id: models.at(-1) || null });
  }
  return error(res, 404, 'Not found.');
}
const server = http.createServer((req, res) => Promise.resolve(handle(req, res)).catch(cause => {
  if (!res.headersSent) error(res, 500, cause.message);
  else res.destroy(cause);
}));
server.listen(PORT, HOST, () => console.log(`Claude Key Connect running at http://${HOST}:${PORT}`));
