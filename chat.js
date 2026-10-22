'use strict';
const $ = id => document.getElementById(id);
let current = null, sessions = [], busy = false, controller = null;
async function request(url, method = 'GET', body) {
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
function notice(message) { $('notice').textContent = message || ''; }
function setBusy(value) { busy = value; $('send').textContent = value ? '■' : '↑'; $('send').setAttribute('aria-label', value ? 'Stop reply' : 'Send message'); $('prompt').disabled = value; }
function renderSessions() {
  $('sessions').replaceChildren(...sessions.map(session => {
    const row = document.createElement('div'); row.className = `session${session.id === current ? ' active' : ''}`; row.tabIndex = 0; row.setAttribute('role', 'button');
    const icon = document.createElement('span'); icon.textContent = '▤';
    const title = document.createElement('span'); title.className = 'session-title'; title.textContent = session.title;
    const remove = document.createElement('button'); remove.className = 'session-delete'; remove.type = 'button'; remove.title = 'Remove from this app (Claude Code transcript remains)'; remove.textContent = '×';
    remove.addEventListener('click', async event => { event.stopPropagation(); if (busy && current === session.id) return notice('Stop the reply before deleting this chat.'); try { await request(`/api/chat/sessions/${session.id}`, 'DELETE'); await loadSessions(); if (current === session.id) showWelcome(); } catch (error) { notice(error.message); } });
    row.append(icon, title, remove); row.addEventListener('click', () => openChat(session.id)); row.addEventListener('keydown', event => { if (event.key === 'Enter') openChat(session.id); }); return row;
  }));
}
async function loadSessions() { sessions = (await request('/api/chat/sessions')).sessions; renderSessions(); }
function showWelcome() { current = null; $('chatTitle').textContent = 'New chat'; $('thread').replaceChildren(); $('welcome').hidden = false; renderSessions(); }
function renderText(element, text) {
  element.replaceChildren();
  for (const [index, part] of text.split(/```/).entries()) {
    if (index % 2) { const pre = document.createElement('pre'); const code = document.createElement('code'); code.textContent = part.replace(/^\w+\n/, ''); pre.append(code); element.append(pre); }
    else if (part) { const span = document.createElement('span'); span.textContent = part; element.append(span); }
  }
}
function addMessage(role, text) {
  $('welcome').hidden = true;
  const row = document.createElement('div'); row.className = `message ${role}`;
  let content;
  if (role === 'assistant') {
    const mark = document.createElement('span'); mark.className = 'assistant-mark'; mark.textContent = '✳';
    content = document.createElement('div'); content.className = 'content';
    const body = document.createElement('div'); body.className = 'reply-body'; renderText(body, text); body.dataset.raw = text;
    row.append(mark, content);
    const copy = document.createElement('button'); copy.className = 'copy'; copy.type = 'button'; copy.textContent = 'Copy reply'; copy.addEventListener('click', async () => { await navigator.clipboard.writeText(body.dataset.raw || body.textContent); copy.textContent = 'Copied'; setTimeout(() => copy.textContent = 'Copy reply', 1500); });
    content.append(body, copy); content = body;
  } else { row.textContent = text; content = row; }
  $('thread').append(row); scrollBottom(); return content;
}
function scrollBottom() { $('messages').scrollTop = $('messages').scrollHeight; }
async function openChat(id) {
  if (busy) return notice('Stop the current reply before switching chats.');
  try { const chat = (await request(`/api/chat/sessions/${id}`)).session; current = id; $('chatTitle').textContent = chat.title; $('thread').replaceChildren(); $('welcome').hidden = chat.messages.length > 0; for (const item of chat.messages) addMessage(item.role, item.text); renderSessions(); $('sidebar').classList.remove('open'); scrollBottom(); notice(''); } catch (error) { notice(error.message); }
}
async function newChat() { if (busy) return notice('Stop the current reply first.'); const chat = (await request('/api/chat/sessions', 'POST')).session; await loadSessions(); await openChat(chat.id); $('prompt').focus(); }
async function send() {
  if (busy) { await request(`/api/chat/sessions/${current}/stop`, 'POST'); controller?.abort(); setBusy(false); notice('Reply stopped.'); return; }
  const text = $('prompt').value.trim(); if (!text) return;
  try {
    if (!current) await newChat();
    $('prompt').value = ''; addMessage('user', text); setBusy(true); notice('');
    const reply = addMessage('assistant', ''); reply.classList.add('typing');
    controller = new AbortController();
    const response = await fetch(`/api/chat/sessions/${current}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: controller.signal });
    if (!response.ok) { const error = await response.json(); throw new Error(error.error || `HTTP ${response.status}`); }
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', full = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
      let end; while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === 'delta') { full += event.text; renderText(reply, full); reply.dataset.raw = full; reply.classList.remove('typing'); scrollBottom(); }
        if (event.type === 'error') { reply.classList.remove('typing'); notice(event.message); }
        if (event.type === 'stopped') { reply.classList.remove('typing'); notice('Reply stopped.'); }
        if (event.type === 'done') { reply.classList.remove('typing'); $('chatTitle').textContent = event.chat.title; await loadSessions(); }
        if (event.type === 'start') { $('chatTitle').textContent = event.chat.title; await loadSessions(); }
      }
    }
    if (!full) reply.closest('.message').remove();
  } catch (error) { if (error.name !== 'AbortError') notice(error.message); }
  finally { controller = null; setBusy(false); $('prompt').focus(); }
}
$('newChat').addEventListener('click', () => newChat().catch(error => notice(error.message)));
$('send').addEventListener('click', send);
$('prompt').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); } });
$('menu').addEventListener('click', () => $('sidebar').classList.toggle('open'));
Promise.all([loadSessions(), request('/api/status')]).then(([, status]) => { $('routeLabel').textContent = status.configured ? `${status.provider} · ${status.model}` : 'No provider connected'; $('routeDot').classList.toggle('off', !status.configured); if (sessions.length) openChat(sessions[0].id); else showWelcome(); }).catch(error => notice(error.message));
