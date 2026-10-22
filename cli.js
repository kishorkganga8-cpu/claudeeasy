'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const tokenPath = path.join(path.resolve(process.env.CKC_DATA_DIR || path.join(__dirname, 'data')), 'client-token');
const port = Number(process.env.CKC_PORT || 3848);
const baseUrl = `http://127.0.0.1:${port}`;
if (!fs.existsSync(tokenPath)) { console.error('Start the website and connect your API key first.'); process.exit(1); }
http.get(`${baseUrl}/api/status`, response => {
  let raw = ''; response.on('data', chunk => raw += chunk);
  response.on('end', () => {
    let status; try { status = JSON.parse(raw); } catch { console.error('Gateway returned an invalid status.'); process.exit(1); }
    if (!status.configured || !status.model) { console.error('Connect your API key and model in the website first.'); process.exit(1); }
    const env = { ...process.env, ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_AUTH_TOKEN: fs.readFileSync(tokenPath, 'utf8').trim(), ANTHROPIC_MODEL: status.model, ANTHROPIC_SMALL_FAST_MODEL: status.model, ANTHROPIC_DEFAULT_SONNET_MODEL: status.model, ANTHROPIC_DEFAULT_OPUS_MODEL: status.model, ANTHROPIC_DEFAULT_HAIKU_MODEL: status.model, CLAUDE_CODE_SUBAGENT_MODEL: status.model };
    delete env.ANTHROPIC_API_KEY;
    if (/^(?:inception\/)?mercury/i.test(status.model)) env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = '1000000';
    const child = spawn('claude', process.argv.slice(2), { stdio: 'inherit', env, shell: process.platform === 'win32' });
    child.on('error', error => { console.error(`Could not launch Claude Code: ${error.message}`); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code || 0; });
  });
}).on('error', error => { console.error(`Gateway unavailable: ${error.message}`); process.exitCode = 1; });
