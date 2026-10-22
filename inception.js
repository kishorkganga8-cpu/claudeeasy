'use strict';
const crypto = require('node:crypto');

function textParts(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  if (value.some(part => part.type === 'image' || part.type === 'document')) throw new Error('Mercury 3 accepts text input only. Remove images and documents from this request.');
  return value.filter(part => part.type === 'text').map(part => part.text || '').join('\n');
}
function toOpenAI(input, model, tokenField = 'max_completion_tokens') {
  const messages = [];
  if (input.system) messages.push({ role: 'system', content: textParts(input.system) });
  for (const message of input.messages || []) {
    const parts = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content || [];
    const text = textParts(parts);
    if (message.role === 'assistant') {
      const calls = parts.filter(part => part.type === 'tool_use').map(part => ({ id: part.id, type: 'function', function: { name: part.name, arguments: JSON.stringify(part.input || {}) } }));
      messages.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      const results = parts.filter(part => part.type === 'tool_result');
      if (results.length) {
        if (text) messages.push({ role: 'user', content: text });
        for (const result of results) messages.push({ role: 'tool', tool_call_id: result.tool_use_id, content: textParts(result.content) });
      } else messages.push({ role: 'user', content: text });
    }
  }
  const output = { model, messages, [tokenField]: input.max_tokens || 1024, stream: false };
  if (input.temperature !== undefined) output.temperature = input.temperature;
  if (input.stop_sequences?.length) output.stop = input.stop_sequences;
  if (input.tools?.length) output.tools = input.tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description || '', parameters: tool.input_schema || { type: 'object', properties: {} } } }));
  if (input.tool_choice?.type === 'none') output.tool_choice = 'none';
  else if (input.tool_choice?.type === 'any') output.tool_choice = 'required';
  else if (input.tool_choice?.type === 'tool') output.tool_choice = { type: 'function', function: { name: input.tool_choice.name } };
  return output;
}
function fromOpenAI(result, model) {
  const choice = result.choices?.[0] || {};
  const message = choice.message || {};
  const content = [];
  if (message.content) content.push({ type: 'text', text: typeof message.content === 'string' ? message.content : JSON.stringify(message.content) });
  for (const call of message.tool_calls || []) {
    let input = {}; try { input = JSON.parse(call.function?.arguments || '{}'); } catch { input = {}; }
    content.push({ type: 'tool_use', id: call.id || `toolu_${crypto.randomBytes(12).toString('hex')}`, name: call.function?.name || 'unknown', input });
  }
  const finish = choice.finish_reason;
  return { id: result.id || `msg_${crypto.randomBytes(12).toString('hex')}`, type: 'message', role: 'assistant', model: result.model || model, content, stop_reason: finish === 'tool_calls' ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end_turn', stop_sequence: null, usage: { input_tokens: result.usage?.prompt_tokens || 0, output_tokens: result.usage?.completion_tokens || 0 } };
}
function sendSse(res, message) {
  const event = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  event('message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: message.usage.input_tokens, output_tokens: 0 } } });
  message.content.forEach((block, index) => {
    event('content_block_start', { type: 'content_block_start', index, content_block: block.type === 'text' ? { type: 'text', text: '' } : { type: 'tool_use', id: block.id, name: block.name, input: {} } });
    event('content_block_delta', { type: 'content_block_delta', index, delta: block.type === 'text' ? { type: 'text_delta', text: block.text } : { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    event('content_block_stop', { type: 'content_block_stop', index });
  });
  event('message_delta', { type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: message.usage.output_tokens } });
  event('message_stop', { type: 'message_stop' });
  res.end();
}
module.exports = { toOpenAI, fromOpenAI, sendSse };
