'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function keyFor(file) {
  const keyFile = path.join(path.dirname(file), 'vault.key');
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32), { mode: 0o600 });
  const key = fs.readFileSync(keyFile);
  if (key.length !== 32) throw new Error('Invalid local vault key.');
  return key;
}
function load(file) {
  if (!fs.existsSync(file)) return [];
  const payload = Buffer.from(fs.readFileSync(file, 'utf8'), 'base64');
  if (payload.length < 29) throw new Error('Invalid provider vault.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(file), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  const value = JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8'));
  if (!Array.isArray(value)) throw new Error('Invalid provider vault.');
  return value;
}
function save(file, connections) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(file), nonce);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(connections), 'utf8'), cipher.final()]);
  fs.writeFileSync(file, Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64'), { mode: 0o600 });
}
module.exports = { load, save };
