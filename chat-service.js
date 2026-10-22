'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

function createChatService({ dataDir, gatewayUrl, getPrimary, clientToken, spawnClaude = spawn }) {
  const file = path.join(dataDir, 'chats.json');
  let chats = [];
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(saved)) chats = saved;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const active = new Map();
  function save() {
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(chats), { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  function summary(chat) { return { id: chat.id, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt, count: chat.messages.length }; }
  function list() { return chats.map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  function get(id) { return chats.find(chat => chat.id === id); }
  function create() {
    const now = new Date().toISOString();
    const chat = { id: crypto.randomUUID(), cliSessionId: crypto.randomUUID(), title: 'New chat', createdAt: now, updatedAt: now, messages: [], started: false };
    chats.unshift(chat); save(); return chat;
  }
  function remove(id) {
    if (active.has(id)) throw new Error('Stop the current reply first.');
    const index = chats.findIndex(chat => chat.id === id);
    if (index < 0) return false;
    chats.splice(index, 1); save(); return true;
  }
  function stop(id) {
    const job = active.get(id);
    if (!job) return false;
    job.stopped = true;
    job.child.kill();
    return true;
  }
  function reply(id, prompt, send) {
    const chat = get(id);
    if (!chat) throw new Error('Chat not found.');
    if (active.has(id)) throw new Error('This chat is already replying.');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 50000) throw new Error('Enter a message under 50,000 characters.');
    const primary = getPrimary();
    if (!primary) throw new Error('Add a provider in Connections first.');
    const text = prompt.trim();
    const env = { ...process.env, ANTHROPIC_BASE_URL: gatewayUrl, ANTHROPIC_AUTH_TOKEN: clientToken,
      ANTHROPIC_MODEL: primary.model, ANTHROPIC_SMALL_FAST_MODEL: primary.model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: primary.model, ANTHROPIC_DEFAULT_OPUS_MODEL: primary.model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: primary.model, CLAUDE_CODE_SUBAGENT_MODEL: primary.model };
    delete env.ANTHROPIC_API_KEY;
    if (/^(?:inception\/)?mercury/i.test(primary.model)) env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = '1000000';
    const args = ['-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose', '--tools', '', '--permission-mode', 'dontAsk', chat.started ? '--resume' : '--session-id', chat.cliSessionId || chat.id];
    const command = process.env.CKC_CLAUDE_BIN || 'claude.exe';
    const child = spawnClaude(command, args, { cwd: process.env.CKC_CHAT_CWD || process.cwd(), env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const job = { child, stopped: false };
    active.set(id, job);
    chat.messages.push({ role: 'user', text, at: new Date().toISOString() });
    if (chat.title === 'New chat') chat.title = text.replace(/\s+/g, ' ').slice(0, 48);
    chat.updatedAt = new Date().toISOString(); save();
    send({ type: 'start', chat: summary(chat) });
    child.stdin.on('error', () => {});
    child.stdin.end(text);
    let buffer = '', full = '', finalText = '', stderr = '', resultError = '', sawResult = false;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let event; try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'stream_event' && event.event?.type === 'content_block_delta' && event.event.delta?.type === 'text_delta') {
          const delta = event.event.delta.text || '';
          full += delta; send({ type: 'delta', text: delta });
        }
        if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
          finalText = event.message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
        }
        if (event.type === 'result') {
          sawResult = true;
          if (typeof event.result === 'string') finalText = event.result;
          if (event.is_error) resultError = String(event.result || 'Claude Code returned an error.');
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    child.on('error', error => { resultError = `Could not start Claude Code: ${error.message}`; });
    child.on('close', code => {
      active.delete(id);
      if (job.stopped) { if (!chat.started) { chat.cliSessionId = crypto.randomUUID(); save(); } send({ type: 'stopped' }); return; }
      if (finalText && !full) { full = finalText; send({ type: 'delta', text: finalText }); }
      else if (finalText.startsWith(full) && finalText.length > full.length) { const tail = finalText.slice(full.length); full = finalText; send({ type: 'delta', text: tail }); }
      if (resultError || code !== 0 || !sawResult || !full.trim()) {
        if (!chat.started) { chat.cliSessionId = crypto.randomUUID(); save(); }
        send({ type: 'error', message: (resultError || stderr.trim() || `Claude Code exited with code ${code}.`).slice(0, 500) });
        return;
      }
      chat.started = true;
      chat.messages.push({ role: 'assistant', text: full, at: new Date().toISOString() });
      chat.updatedAt = new Date().toISOString(); save();
      send({ type: 'done', chat: summary(chat) });
    });
    return child;
  }
  return { list, get, create, remove, stop, reply };
}
module.exports = { createChatService };
