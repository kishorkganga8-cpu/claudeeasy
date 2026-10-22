'use strict';
const $ = id => document.getElementById(id);
let routes = [];
let discoveryTimer;
function status(id, message, kind = '') { $(id).textContent = message; $(id).className = `status ${kind}`; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
async function request(url, method = 'GET', body) {
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || data.error || `HTTP ${response.status}`);
  return data;
}
function config() { return { provider: $('provider').value, apiKey: $('apiKey').value.trim(), customBase: $('customBase').value.trim(), customDialect: $('customDialect').value }; }
function fillDatalist(element, models) {
  element.replaceChildren(...models.map(model => { const option = document.createElement('option'); option.value = model.id; option.label = model.name || model.id; return option; }));
}
async function discoverNew() {
  const input = config();
  if (!input.apiKey) return;
  if (input.provider === 'custom' && !input.customBase) return;
  status('addStatus', 'Fetching models…'); $('fetchModels').disabled = true;
  try {
    const data = await request('/api/discover', 'POST', input);
    fillDatalist($('newModels'), data.models);
    $('modelHint').textContent = `${data.models.length} models loaded. Start typing to search, or enter an exact ID.`;
    if (!$('model').value && input.provider === 'inception' && data.models.some(model => model.id === 'mercury-3')) $('model').value = 'mercury-3';
    status('addStatus', `${data.models.length} models loaded from ${$('provider').selectedOptions[0].text}.`, 'good');
  } catch (error) { status('addStatus', error.message, 'bad'); }
  finally { $('fetchModels').disabled = false; }
}
function scheduleDiscovery() { clearTimeout(discoveryTimer); discoveryTimer = setTimeout(discoverNew, 650); }
function render() {
  $('launch').disabled = !routes.length;
  if (!routes.length) { $('routes').innerHTML = '<div class="empty">No providers yet. Add a key above to start building your fallback list.</div>'; return; }
  $('routes').innerHTML = routes.map((route, index) => `<div class="route" data-id="${escapeHtml(route.id)}"><div class="route-top"><div><div class="route-title">${index + 1}. ${escapeHtml(route.label)} <span class="badge">${index === 0 ? 'Primary' : 'Fallback'}</span></div><div class="route-sub">${escapeHtml(route.keyHint)}${route.customBase ? ` · ${escapeHtml(route.customBase)}` : ''}</div></div></div><div class="route-model"><input class="model-edit" list="list-${escapeHtml(route.id)}" value="${escapeHtml(route.model)}" aria-label="Model for ${escapeHtml(route.label)}"><datalist id="list-${escapeHtml(route.id)}"></datalist><button class="button minor" data-action="models">Fetch models</button><button class="button minor" data-action="save-model">Save model</button></div><div class="route-actions"><button class="button minor" data-action="test">Test</button><button class="button minor" data-action="up" ${index === 0 ? 'disabled' : ''}>↑ Move up</button><button class="button minor" data-action="down" ${index === routes.length - 1 ? 'disabled' : ''}>↓ Move down</button><button class="button minor danger" data-action="remove">Remove</button></div></div>`).join('');
}
async function refresh() { const data = await request('/api/connections'); routes = data.connections; render(); }
$('provider').addEventListener('change', () => { $('customFields').style.display = $('provider').value === 'custom' ? 'grid' : 'none'; $('model').value = ''; $('newModels').replaceChildren(); scheduleDiscovery(); });
$('apiKey').addEventListener('input', scheduleDiscovery);
$('customBase').addEventListener('change', scheduleDiscovery);
$('customDialect').addEventListener('change', scheduleDiscovery);
$('fetchModels').addEventListener('click', discoverNew);
$('addForm').addEventListener('submit', async event => {
  event.preventDefault(); $('add').disabled = true; status('addStatus', 'Adding provider…');
  try { await request('/api/connections', 'POST', { ...config(), model: $('model').value.trim() }); $('apiKey').value = ''; $('model').value = ''; $('newModels').replaceChildren(); await refresh(); status('addStatus', 'Provider added. Use Test to verify its key and model.', 'good'); }
  catch (error) { status('addStatus', error.message, 'bad'); }
  finally { $('add').disabled = false; }
});
$('routes').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]'); if (!button) return;
  const card = button.closest('.route'); const id = card.dataset.id; const action = button.dataset.action;
  const index = routes.findIndex(route => route.id === id); if (index < 0) return;
  button.disabled = true; status('routeStatus', `${button.textContent.trim()}…`);
  try {
    if (action === 'test') { const result = await request(`/api/connections/${id}/test`, 'POST', {}); status('routeStatus', `${routes[index].label} works · ${result.model} replied: ${result.reply}`, 'good'); }
    else if (action === 'models') { const data = await request(`/api/connections/${id}/models`); fillDatalist(card.querySelector('datalist'), data.models); status('routeStatus', `${data.models.length} models loaded for ${routes[index].label}. Edit the model field, then save.`, 'good'); }
    else if (action === 'save-model') { await request(`/api/connections/${id}`, 'PATCH', { model: card.querySelector('.model-edit').value.trim() }); await refresh(); status('routeStatus', 'Model updated.', 'good'); }
    else if (action === 'remove') { await request(`/api/connections/${id}`, 'DELETE'); await refresh(); status('routeStatus', 'Provider removed.', 'good'); }
    else if (action === 'up' || action === 'down') { const ids = routes.map(route => route.id); const other = index + (action === 'up' ? -1 : 1); [ids[index], ids[other]] = [ids[other], ids[index]]; await request('/api/connections/reorder', 'POST', { ids }); await refresh(); status('routeStatus', 'Fallback order updated.', 'good'); }
  } catch (error) { status('routeStatus', error.message, 'bad'); }
  finally { button.disabled = false; }
});
$('launch').addEventListener('click', async () => { $('launch').disabled = true; status('routeStatus', 'Opening Claude Code…'); try { await request('/api/launch', 'POST', {}); status('routeStatus', 'Claude Code opened with your fallback list.', 'good'); } catch (error) { status('routeStatus', error.message, 'bad'); } finally { $('launch').disabled = false; } });
refresh().catch(error => status('routeStatus', error.message, 'bad'));
