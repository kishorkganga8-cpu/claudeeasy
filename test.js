'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { resolveProvider, endpoint } = require('./providers');
const port = 43847, upstreamPort = 43848;
const dataDir = path.join(__dirname, 'test-data');
const probeScript = path.join(__dirname, 'launch-probe.ps1');
const probeMarker = path.join(__dirname, 'launch-probe.txt');
const fakeClaude = path.join(__dirname, 'claude.cmd');
const cliMarker = path.join(__dirname, 'claude-env-probe.txt');
let failInception = false;
let failKilo = false;
let last;
const mock = http.createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  last = { path: req.url, key: req.headers.authorization || req.headers['x-api-key'], session: req.headers['x-opencode-session'], body: raw ? JSON.parse(raw) : null };
  res.setHeader('content-type', 'application/json');
  if (req.method === 'GET' && req.url === '/v1/chat/completions/models') return res.end(JSON.stringify({ data: [{ id: 'mercury-3', name: 'Mercury 3' }] }));
  if (req.method === 'GET' && req.url === '/api/v1/models') return res.end(JSON.stringify({ data: [{ id: 'anthropic/claude-test', name: 'Claude Test' }] }));
  if (req.method === 'GET' && req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'openai/gpt-test', name: 'GPT Test' }] }));
  if (req.method === 'GET' && req.url === '/openai/v1/models') return res.end(JSON.stringify({ data: [{ id: 'groq-chat-test' }] }));
  if (req.method === 'GET' && req.url === '/models') return res.end(JSON.stringify({ data: [{ id: 'deepseek-chat-test' }] }));
  if (req.method === 'GET' && req.url === '/v1beta/openai/models') return res.end(JSON.stringify({ data: [{ id: 'gemini-chat-test' }] }));
  if (req.method === 'GET' && req.url === '/inference/go/v1/models') return res.end(JSON.stringify({ data: [{ id: 'gpt-6-luna' }, { id: 'claude-haiku-5-5' }, { id: 'minimax-m3' }, { id: 'qwen3.8-max' }] }));
  if (req.url === '/inference/go/anthropic/v1/messages') return res.end(JSON.stringify({ id: 'msg_go', type: 'message', model: last.body.model, role: 'assistant', content: [{ type: 'text', text: 'OpenCode Go OK' }], stop_reason: 'end_turn', usage: { input_tokens: 4, output_tokens: 2 } }));
  if (req.url === '/v1/chat/completions') {
    if (failInception) { res.writeHead(429); return res.end(JSON.stringify({ error: { message: 'Rate limit' } })); }
    return res.end(JSON.stringify({ id: 'chatcmpl_inception', model: last.body.model, choices: [{ finish_reason: 'stop', message: { content: last.body.model === 'mercury-empty' ? '' : 'Mercury OK' } }], usage: { prompt_tokens: 4, completion_tokens: 2 } }));
  }
  if (req.url === '/api/v1/chat/completions') {
    if (failKilo) { res.writeHead(503); return res.end(JSON.stringify({ error: { message: 'Unavailable' } })); }
    return res.end(JSON.stringify({ id: 'chatcmpl_kilo', model: last.body.model, choices: [{ finish_reason: 'stop', message: { content: 'Kilo fallback OK' } }], usage: { prompt_tokens: 4, completion_tokens: 3 } }));
  }
  if (req.url === '/v1/messages') {
    if (last.body.stream) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('event: message_start\ndata: {"type":"message_start"}\n\n'); return res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n'); }
    return res.end(JSON.stringify({ id: 'msg_xkiro', type: 'message', model: last.body.model, role: 'assistant', content: [{ type: 'text', text: 'xKiro OK' }], stop_reason: 'end_turn', usage: { input_tokens: 4, output_tokens: 2 } }));
  }
  res.writeHead(404); res.end('{}');
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function startServer() {
  return spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, CKC_PORT: String(port), CKC_DATA_DIR: dataDir, CKC_INCEPTION_UPSTREAM: `http://127.0.0.1:${upstreamPort}`, CKC_KILO_UPSTREAM: `http://127.0.0.1:${upstreamPort}`, CKC_XKIRO_UPSTREAM: `http://127.0.0.1:${upstreamPort}`, ...Object.fromEntries(['openrouter', 'openai', 'groq', 'deepseek', 'mistral', 'gemini', 'opencodego'].map(id => [`CKC_${id.toUpperCase()}_UPSTREAM`, `http://127.0.0.1:${upstreamPort}`])), CKC_LAUNCH_SCRIPT: probeScript }, stdio: 'ignore' });
}
async function ready() { for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/api/status`); if (r.ok) return; } catch { /* starting */ } await wait(100); } throw new Error('Server did not start'); }
async function api(route, method = 'GET', body, token) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { 'content-type': 'application/json', ...(token ? { 'x-api-key': token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, headers: response.headers, body: await response.text() };
}
async function run() {
  for (const [id, models, chat] of [
    ['openrouter', 'https://openrouter.ai/api/v1/models', 'https://openrouter.ai/api/v1/chat/completions'],
    ['openai', 'https://api.openai.com/v1/models', 'https://api.openai.com/v1/chat/completions'],
    ['groq', 'https://api.groq.com/openai/v1/models', 'https://api.groq.com/openai/v1/chat/completions'],
    ['deepseek', 'https://api.deepseek.com/models', 'https://api.deepseek.com/chat/completions'],
    ['mistral', 'https://api.mistral.ai/v1/models', 'https://api.mistral.ai/v1/chat/completions'],
    ['gemini', 'https://generativelanguage.googleapis.com/v1beta/openai/models', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'],
    ['opencodego', 'https://opencode.ai/inference/go/v1/models', 'https://opencode.ai/inference/go/anthropic/v1/messages']
  ]) { assert.equal(endpoint(resolveProvider(id), 'models'), models); assert.equal(endpoint(resolveProvider(id), 'chat'), chat); }
  assert.ok(path.resolve(dataDir).startsWith(path.resolve(__dirname) + path.sep));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.writeFileSync(probeScript, `Set-Content -LiteralPath '${probeMarker.replace(/'/g, "''")}' -Value 'launched'`);
  await new Promise(resolve => mock.listen(upstreamPort, '127.0.0.1', resolve));
  let child = startServer();
  try {
    await ready();
    let result = await api('/api/discover', 'POST', { provider: 'inception', apiKey: 'key-inception' }); assert.equal(result.status, 200); assert.deepEqual(JSON.parse(result.body).models.map(item => item.id), ['mercury-3']);
    result = await api('/api/discover', 'POST', { provider: 'kilo', apiKey: 'key-kilo' }); assert.equal(result.status, 200); assert.deepEqual(JSON.parse(result.body).models.map(item => item.id), ['anthropic/claude-test']);
    result = await api('/api/discover', 'POST', { provider: 'xkiro', apiKey: 'key-xkiro' }); assert.equal(result.status, 200); assert.deepEqual(JSON.parse(result.body).models.map(item => item.id), ['openai/gpt-test']);
    for (const provider of ['openrouter', 'openai', 'groq', 'deepseek', 'mistral', 'gemini']) {
      result = await api('/api/discover', 'POST', { provider, apiKey: `key-${provider}` });
      assert.equal(result.status, 200, `${provider}: ${result.body}`);
      assert.ok(JSON.parse(result.body).models.length > 0, provider);
      assert.equal(last.key, `Bearer key-${provider}`);
    }
    result = await api('/api/discover', 'POST', { provider: 'opencodego', apiKey: 'key-go' }); assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.body).models.map(item => item.id), ['claude-haiku-5-5', 'minimax-m3', 'qwen3.8-max']);
    assert.equal(last.key, 'Bearer key-go'); assert.match(last.session, /^ses_[0-9a-f]{24}$/);
    result = await api('/api/connections', 'POST', { provider: 'opencodego', apiKey: 'key-go', model: 'minimax-m3' }); assert.equal(result.status, 201);
    const goId = JSON.parse(result.body).connection.id;
    result = await api(`/api/connections/${goId}/test`, 'POST', {}); assert.equal(result.status, 200); assert.match(result.body, /OpenCode Go OK/);
    assert.equal(last.path, '/inference/go/anthropic/v1/messages'); assert.equal(last.key, 'Bearer key-go'); assert.match(last.session, /^ses_[0-9a-f]{24}$/);
    result = await api(`/api/connections/${goId}`, 'DELETE'); assert.equal(result.status, 200);
    result = await api('/api/discover', 'POST', { provider: 'custom', apiKey: 'key-custom', customBase: `http://127.0.0.1:${upstreamPort}/v1`, customDialect: 'openai' }); assert.equal(result.status, 200); assert.deepEqual(JSON.parse(result.body).models.map(item => item.id), ['openai/gpt-test']);
    for (const connection of [
      { provider: 'inception', apiKey: 'key-inception', model: 'mercury-3' },
      { provider: 'kilo', apiKey: 'key-kilo', model: 'anthropic/claude-test' },
      { provider: 'xkiro', apiKey: 'key-xkiro', model: 'openai/gpt-test' }
    ]) { result = await api('/api/connections', 'POST', connection); assert.equal(result.status, 201, result.body); }
    result = await api('/api/connections'); const list = JSON.parse(result.body).connections; assert.equal(list.length, 3); assert.ok(!result.body.includes('key-inception')); assert.equal(list[0].model, 'mercury-3');
    const vaultFile = fs.readFileSync(path.join(dataDir, 'providers.vault'), 'utf8'); assert.ok(!vaultFile.includes('key-inception'));
    result = await api(`/api/connections/${list[0].id}/test`, 'POST', {}); assert.equal(result.status, 200); assert.match(result.body, /Mercury OK/); assert.equal(last.body.max_completion_tokens, 128);
    result = await api('/api/launch', 'POST', {}); assert.equal(result.status, 200); assert.equal(fs.readFileSync(probeMarker, 'utf8').trim(), 'launched');
    const token = fs.readFileSync(path.join(dataDir, 'client-token'), 'utf8').trim();
    fs.writeFileSync(fakeClaude, `@echo off\r\n(echo %ANTHROPIC_BASE_URL%^|%ANTHROPIC_MODEL%^|%ANTHROPIC_AUTH_TOKEN%) > "${cliMarker}"\r\n`);
    execFileSync(process.execPath, ['cli.js'], { cwd: __dirname, env: { ...process.env, CKC_DATA_DIR: dataDir, CKC_PORT: String(port), PATH: `${__dirname};${process.env.PATH}` }, timeout: 10000 });
    assert.match(fs.readFileSync(cliMarker, 'utf8'), /127\.0\.0\.1:43847\|mercury-3\|/);
    failInception = true;
    const request = { model: 'ignored', max_tokens: 32, messages: [{ role: 'user', content: 'Hello' }] };
    result = await api('/v1/messages', 'POST', request, token); assert.equal(result.status, 200); assert.match(result.body, /Kilo fallback OK/); assert.equal(last.body.model, 'anthropic/claude-test'); assert.equal(last.body.max_tokens, 32);
    failKilo = true;
    result = await api('/v1/messages', 'POST', { ...request, stream: true }, token); assert.equal(result.status, 200); assert.match(result.body, /message_stop/); assert.equal(last.body.model, 'openai/gpt-test');
    result = await api('/v1/messages', 'POST', request, 'wrong'); assert.equal(result.status, 401);
    result = await api('/api/connections/reorder', 'POST', { ids: [list[2].id, list[0].id, list[1].id] }); assert.equal(result.status, 200); assert.equal(JSON.parse(result.body).connections[0].provider, 'xkiro');
    result = await api(`/api/connections/${list[0].id}`, 'PATCH', { model: 'mercury-empty' }); assert.equal(result.status, 200);
    failInception = false;
    result = await api(`/api/connections/${list[0].id}/test`, 'POST', {}); assert.equal(result.status, 502);
    child.kill(); await wait(250); child = startServer(); await ready();
    result = await api('/api/connections'); assert.equal(JSON.parse(result.body).connections[0].provider, 'xkiro'); assert.equal(JSON.parse(result.body).connections.length, 3);
    result = await api(`/api/connections/${list[1].id}`, 'DELETE'); assert.equal(result.status, 200);
    console.log('PASS: model discovery, encrypted persistence, launch, model selection, route order, provider fallback, streaming, and authentication');
  } finally {
    child.kill(); mock.close();
    for (const file of [probeScript, probeMarker, fakeClaude, cliMarker]) fs.rmSync(file, { force: true });
    assert.ok(path.resolve(dataDir).startsWith(path.resolve(__dirname) + path.sep));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}
run().catch(cause => { console.error(cause); process.exitCode = 1; });
