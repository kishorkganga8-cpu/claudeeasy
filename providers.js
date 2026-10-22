'use strict';
const PRESETS = {
  inception: { label: 'Inception', dialect: 'openai', base: 'https://api.inceptionlabs.ai', modelsPath: '/v1/chat/completions/models', chatPath: '/v1/chat/completions', tokenField: 'max_completion_tokens' },
  kilo: { label: 'Kilo Gateway', dialect: 'openai', base: 'https://ai-gateway.kilo.ai', modelsPath: '/api/v1/models', chatPath: '/api/v1/chat/completions', tokenField: 'max_tokens' },
  xkiro: { label: 'xKiro', dialect: 'anthropic', base: 'https://api.xkiro.com', modelsPath: '/v1/models', chatPath: '/v1/messages' },
  anthropic: { label: 'Anthropic', dialect: 'anthropic', base: 'https://api.anthropic.com', modelsPath: '/v1/models?limit=1000', chatPath: '/v1/messages' }
};
function resolveProvider(id, customBase, customDialect) {
  if (PRESETS[id]) {
    const preset = { id, ...PRESETS[id] };
    const override = process.env[`CKC_${id.toUpperCase()}_UPSTREAM`];
    if (override) preset.base = override;
    return preset;
  }
  if (id !== 'custom') throw new Error('Unsupported provider.');
  if (!['openai', 'anthropic'].includes(customDialect)) throw new Error('Choose a custom API format.');
  let url; try { url = new URL(customBase); } catch { throw new Error('Enter a valid custom base URL.'); }
  if (url.username || url.password || url.search || url.hash) throw new Error('Custom base URL must not contain credentials or query parameters.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('Custom remote APIs must use HTTPS.');
  const base = url.toString().replace(/\/$/, '');
  return { id, label: 'Custom API', dialect: customDialect, base, modelsPath: '/models', chatPath: customDialect === 'anthropic' ? '/messages' : '/chat/completions', tokenField: 'max_tokens', customBase: base, customDialect };
}
function endpoint(provider, kind) {
  if (provider.id === 'custom') return `${provider.base}${kind === 'models' ? provider.modelsPath : provider.chatPath}`;
  return new URL(kind === 'models' ? provider.modelsPath : provider.chatPath, provider.base).toString();
}
function publicConnection(connection) {
  return { id: connection.id, provider: connection.provider, label: resolveProvider(connection.provider, connection.customBase, connection.customDialect).label, model: connection.model, customBase: connection.customBase || '', customDialect: connection.customDialect || '', keyHint: `••••${connection.key.slice(-4)}` };
}
module.exports = { PRESETS, resolveProvider, endpoint, publicConnection };
