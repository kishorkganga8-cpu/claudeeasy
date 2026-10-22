'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createChatService } = require('./chat-service');
const dataDir = path.join(__dirname, 'test-chat-data');
fs.mkdirSync(dataDir, { recursive: true });
const calls = [];
function fakeSpawn(command, args, options) {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let input = ''; child.stdin.on('data', chunk => input += chunk);
  calls.push({ command, args, options, get input() { return input; } });
  child.stdin.on('end', () => setImmediate(() => {
    child.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } } }) + '\n');
    child.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'there' } } }) + '\n');
    child.stdout.write(JSON.stringify({ type: 'result', result: 'Hello there', is_error: false }) + '\n');
    child.stdout.end(); child.emit('close', 0);
  }));
  child.kill = () => child.emit('close', 1);
  return child;
}
async function turn(service, id, prompt) {
  return new Promise((resolve, reject) => {
    const events = [];
    service.reply(id, prompt, event => { events.push(event); if (event.type === 'done') resolve(events); if (event.type === 'error') reject(new Error(event.message)); });
  });
}
(async () => {
  try {
    const service = createChatService({ dataDir, gatewayUrl: 'http://127.0.0.1:3848', getPrimary: () => ({ model: 'mercury-3' }), clientToken: 'local-only-token', spawnClaude: fakeSpawn });
    const chat = service.create();
    let events = await turn(service, chat.id, 'Hi');
    assert.equal(events.filter(event => event.type === 'delta').map(event => event.text).join(''), 'Hello there');
    assert.equal(calls[0].input, 'Hi');
    assert.equal(calls[0].options.env.ANTHROPIC_AUTH_TOKEN, 'local-only-token');
    assert.ok(calls[0].args.includes('--session-id'));
    assert.ok(calls[0].args.includes('dontAsk'));
    assert.equal(service.get(chat.id).messages.length, 2);
    events = await turn(service, chat.id, 'Again');
    assert.ok(calls[1].args.includes('--resume'));
    assert.equal(service.get(chat.id).messages.length, 4);
    const reloaded = createChatService({ dataDir, gatewayUrl: 'http://127.0.0.1:3848', getPrimary: () => ({ model: 'mercury-3' }), clientToken: 'local-only-token', spawnClaude: fakeSpawn });
    assert.equal(reloaded.get(chat.id).messages.length, 4);
    assert.ok(!fs.readFileSync(path.join(dataDir, 'chats.json'), 'utf8').includes('local-only-token'));
    console.log('PASS: chat streaming, Claude Code session resume, local persistence, and key isolation');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
