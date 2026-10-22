'use strict';

function zero(value) { return (typeof value === 'number' || typeof value === 'string') && value !== '' && Number.isFinite(Number(value)) && Number(value) === 0; }
function isFreeModel(provider, item) {
  if (!item || typeof item !== 'object' || typeof item.id !== 'string') return false;
  const price = item.pricing;
  if (provider.id === 'xkiro') return zero(price?.input) && zero(price?.output);
  if (provider.id === 'kilo') return (item.id.endsWith(':free') || item.id === 'kilo-auto/free') && zero(price?.prompt) && zero(price?.completion) && (price?.request === undefined || zero(price.request));
  if (provider.id === 'openrouter') return (item.id.endsWith(':free') || item.id === 'openrouter/free') && zero(price?.prompt) && zero(price?.completion) && (price?.request === undefined || zero(price.request));
  return false;
}
module.exports = { isFreeModel };
