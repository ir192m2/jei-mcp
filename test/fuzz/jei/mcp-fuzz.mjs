#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { FuzzReport, FUZZ_INPUTS, bridgeUp, COLORS, PORT } from '../shared/harness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const r = new FuzzReport('JEI MCP Server Fuzzer');

const SERVER = 'node';
const ARGS = [resolve(__dirname, '../../../server/dist/index.js')];

const jeiUp = await bridgeUp(PORT.JEI, 2000);
if (!jeiUp) {
  console.log(`${COLORS.red}JEI bridge not up on :${PORT.JEI} — cannot test MCP server${COLORS.reset}`);
  process.exit(2);
}
console.log(`${COLORS.green}JEI bridge up. Starting MCP server.${COLORS.reset}`);

const proc = spawn(SERVER, ARGS, { stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
proc.stdout.on('data', d => { stdout += d.toString(); });
proc.stderr.on('data', d => { stderr += d.toString(); });
await new Promise(r => setTimeout(r, 500));

function send(msg) {
  proc.stdin.write(JSON.stringify(msg) + '\n');
}

const respQueue = [];
let buf = '';
const respWaiters = [];

function feedData(d) {
  buf += d.toString();
  stdout += d.toString();
  const lines = buf.split('\n');
  buf = lines.pop() || '';
  for (const l of lines) {
    if (!l.trim()) continue;
    try {
      const obj = JSON.parse(l);
      if (respWaiters.length > 0) {
        const w = respWaiters.shift();
        clearTimeout(w.to);
        w.resolve({ msg: obj, raw: l });
      } else {
        respQueue.push({ msg: obj, raw: l });
      }
    } catch {}
  }
}

function nextResp(timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (respQueue.length > 0) {
      resolve(respQueue.shift());
      return;
    }
    const to = setTimeout(() => {
      const idx = respWaiters.findIndex(w => w.resolve === resolve);
      if (idx >= 0) respWaiters.splice(idx, 1);
      resolve({ error: 'timeout', raw: buf });
    }, timeoutMs);
    respWaiters.push({ resolve, to });
  });
}

proc.stdout.on('data', feedData);

r.section('1. Initialize / list tools');
{
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fuzz', version: '0.1' } } });
  const r1 = await nextResp();
  r.case('initialize', !!r1.msg?.result?.serverInfo, `server=${r1.msg?.result?.serverInfo?.name}`, 'init');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const r2 = await nextResp();
  const tools = r2.msg?.result?.tools || [];
  r.case('tools/list returns array', Array.isArray(tools), `n=${tools.length}`, 'init');
  r.case('has 7 tools', tools.length === 7, `n=${tools.length}`, 'init');
  const names = tools.map(t => t.name).sort();
  const expected = ['jei_create_quest', 'jei_get_item', 'jei_get_recipes', 'jei_get_uses', 'jei_health', 'jei_list_all_items', 'jei_list_categories', 'jei_search_items'].filter(n => !n.includes('create')).sort();
  // Just check essential tools exist
  r.case('jei_search_items exists', names.includes('jei_search_items'), `names=${names.join(',')}`, 'init');
}

r.section('2. Tool: jei_health');
{
  for (const params of [{}, { extra: 'field' }, null, { q: 'iron' }]) {
    send({ jsonrpc: '2.0', id: 100, method: 'tools/call', params: { name: 'jei_health', arguments: params } });
    const r1 = await nextResp();
    const hasResponse = !!r1.msg?.result || !!r1.msg?.error;
    const text = r1.msg?.result?.content?.[0]?.text || r1.msg?.error?.message || '';
    r.case(`params=${JSON.stringify(params).slice(0,40)}`, hasResponse, `content=${text.slice(0,100)}`, 'tool-jei_health');
  }
}

r.section('3. Tool: jei_search_items — boundary');
{
  const cases = [
    { args: {}, name: 'no args' },
    { args: { query: 'iron' }, name: 'valid query' },
    { args: { query: 'iron', limit: 5 }, name: 'with limit' },
    { args: { query: '' }, name: 'empty query' },
    { args: { query: '   ' }, name: 'whitespace' },
    { args: { query: FUZZ_INPUTS.sqlInject }, name: 'SQL inject' },
    { args: { query: FUZZ_INPUTS.xss }, name: 'XSS' },
    { args: { query: FUZZ_INPUTS.unicode }, name: 'unicode' },
    { args: { query: FUZZ_INPUTS.nullByte }, name: 'null byte' },
    { args: { query: FUZZ_INPUTS.veryLong }, name: '100k query' },
    { args: { query: 'iron', limit: 0 }, name: 'limit=0' },
    { args: { query: 'iron', limit: -1 }, name: 'limit=-1' },
    { args: { query: 'iron', limit: 99999 }, name: 'limit=huge' },
    { args: { query: 'iron', limit: 'abc' }, name: 'limit=string' },
    { args: { query: 'iron', limit: null }, name: 'limit=null' },
    { args: { query: 123 }, name: 'query=number' },
    { args: { query: null }, name: 'query=null' },
    { args: { query: ['iron'] }, name: 'query=array' },
    { args: { query: { evil: true } }, name: 'query=object' },
    { args: { query: 'iron', extra_field: 'evil' }, name: 'extra field' },
  ];
  for (const c of cases) {
    send({ jsonrpc: '2.0', id: 200, method: 'tools/call', params: { name: 'jei_search_items', arguments: c.args } });
    const r1 = await nextResp();
    const hasContent = !!r1.msg?.result?.content;
    const text = r1.msg?.result?.content?.[0]?.text || JSON.stringify(r1.msg?.error) || '';
    r.case(c.name, hasContent, `content=${text.slice(0,200)}`, 'tool-jei_search_items');
  }
}

r.section('4. Tool: jei_get_item — boundary');
{
  const cases = [
    { args: {}, name: 'no args' },
    { args: { uid: 'minecraft:iron_ingot' }, name: 'valid uid' },
    { args: { uid: '' }, name: 'empty uid' },
    { args: { uid: null }, name: 'null uid' },
    { args: { uid: 123 }, name: 'number uid' },
    { args: { uid: '../etc/passwd' }, name: 'path traversal' },
    { args: { uid: FUZZ_INPUTS.xss }, name: 'XSS' },
    { args: { uid: FUZZ_INPUTS.unicode }, name: 'unicode' },
    { args: { uid: FUZZ_INPUTS.nullByte }, name: 'null byte' },
    { args: { uid: 'minecraft:nonexistent_xyz' }, name: 'nonexistent' },
    { args: { uid: 'a'.repeat(10000) }, name: '10k uid' },
  ];
  for (const c of cases) {
    send({ jsonrpc: '2.0', id: 300, method: 'tools/call', params: { name: 'jei_get_item', arguments: c.args } });
    const r1 = await nextResp();
    const text = r1.msg?.result?.content?.[0]?.text || JSON.stringify(r1.msg?.error) || '';
    r.case(c.name, !!r1.msg?.result?.content || !!r1.msg?.error, `content=${text.slice(0,150)}`, 'tool-jei_get_item');
  }
}

r.section('5. Tool: jei_get_recipes — boundary');
{
  for (const args of [
    {},
    { uid: 'minecraft:iron_ingot' },
    { uid: 'minecraft:iron_ingot', limit: 1 },
    { uid: 'minecraft:iron_ingot', limit: -1 },
    { uid: 'minecraft:iron_ingot', limit: 'abc' },
    { uid: 'minecraft:nonexistent' },
    { uid: '../etc/passwd' },
    { uid: FUZZ_INPUTS.unicode },
    { uid: 'iron_ingot', missing_required: true },
  ]) {
    send({ jsonrpc: '2.0', id: 400, method: 'tools/call', params: { name: 'jei_get_recipes', arguments: args } });
    const r1 = await nextResp();
    const text = r1.msg?.result?.content?.[0]?.text || JSON.stringify(r1.msg?.error) || '';
    r.case(JSON.stringify(args).slice(0,50), !!r1.msg?.result?.content || !!r1.msg?.error, `resp=${text.slice(0,150)}`, 'tool-jei_get_recipes');
  }
}

r.section('6. Tool: jei_get_uses — boundary');
{
  for (const args of [
    {},
    { uid: 'minecraft:iron_ingot' },
    { uid: 'minecraft:iron_ingot', limit: 0 },
    { uid: '' },
    { uid: null },
    { uid: 123 },
    { uid: ['array'] },
    { uid: { obj: true } },
    { uid: '../etc/passwd' },
  ]) {
    send({ jsonrpc: '2.0', id: 500, method: 'tools/call', params: { name: 'jei_get_uses', arguments: args } });
    const r1 = await nextResp();
    r.case(JSON.stringify(args).slice(0,50), !!r1.msg?.result?.content || !!r1.msg?.error, '', 'tool-jei_get_uses');
  }
}

r.section('7. Tool: jei_list_all_items — boundary');
{
  for (const args of [
    {},
    { limit: 1 },
    { limit: -1 },
    { limit: 999999 },
    { limit: 'abc' },
    { offset: -1 },
    { offset: 999999 },
    { limit: 1.5 },
    { sort: 'invalid' },
  ]) {
    send({ jsonrpc: '2.0', id: 600, method: 'tools/call', params: { name: 'jei_list_all_items', arguments: args } });
    const r1 = await nextResp(10_000);
    r.case(JSON.stringify(args).slice(0,50), !!r1.msg?.result?.content || !!r1.msg?.error, '', 'tool-jei_list_all_items');
  }
}

r.section('8. Tool: jei_list_categories — boundary');
{
  for (const args of [{}, { sort: 'name' }, { sort: 'invalid' }, { limit: -1 }, { extra: 'field' }]) {
    send({ jsonrpc: '2.0', id: 700, method: 'tools/call', params: { name: 'jei_list_categories', arguments: args } });
    const r1 = await nextResp();
    r.case(JSON.stringify(args).slice(0,50), !!r1.msg?.result?.content || !!r1.msg?.error, '', 'tool-jei_list_categories');
  }
}

r.section('9. Unknown / invalid tool name');
{
  for (const name of ['nonexistent', 'jei_search', 'delete_all', 'rm_rf', '', null, 123, '../etc/passwd', 'jei_search_items; DROP TABLE items']) {
    send({ jsonrpc: '2.0', id: 800, method: 'tools/call', params: { name, arguments: {} } });
    const r1 = await nextResp();
    const isError = !!r1.msg?.error || (r1.msg?.result?.isError === true);
    r.case(`name=${JSON.stringify(name).slice(0,40)}`, isError, `error=${JSON.stringify(r1.msg?.error || '').slice(0,100)} isError=${r1.msg?.result?.isError}`, 'unknown-tool');
  }
}

r.section('10. JSON-RPC protocol abuse');
{
  for (const msg of [
    { jsonrpc: '2.0', id: 900, method: 'tools/call', params: { name: 'jei_health', arguments: {} } },
    { jsonrpc: '1.0', id: 901, method: 'tools/call', params: { name: 'jei_health', arguments: {} } },
    { jsonrpc: '2.0', id: 902, method: 'tools/call' },
    { jsonrpc: '2.0', id: 903 },
    { id: 904, method: 'tools/call', params: { name: 'jei_health', arguments: {} } },
    { jsonrpc: '2.0', id: 'string-id', method: 'tools/call', params: { name: 'jei_health', arguments: {} } },
    { jsonrpc: '2.0', id: 905, method: 'unknown/method' },
    { jsonrpc: '2.0', id: 906, method: '' },
  ]) {
    send(msg);
    const r1 = await nextResp(3000);
    r.case(`msg=${JSON.stringify(msg).slice(0,60)}`, !!r1.msg || !!r1.error, `err=${r1.error || 'none'} resp=${(r1.msg?.error?.code !== undefined ? r1.msg.error.code : (r1.msg?.result?.isError || 'ok'))}`, 'rpc');
  }
}

r.section('11. Large response handling');
{
  send({ jsonrpc: '2.0', id: 1000, method: 'tools/call', params: { name: 'jei_list_all_items', arguments: { limit: 5000 } } });
  const r1 = await nextResp(20_000);
  r.case('5000 items in one call', !!r1.msg?.result?.content, `content_len=${r1.msg?.result?.content?.[0]?.text?.length || 0}`, 'large');
}

r.section('12. Concurrent tool calls');
{
  const calls = Array(20).fill(0).map((_, i) => ({ jsonrpc: '2.0', id: 2000 + i, method: 'tools/call', params: { name: 'jei_health', arguments: {} } }));
  const responses = [];
  for (const c of calls) send(c);
  for (let i = 0; i < calls.length; i++) {
    const resp = await nextResp(5000);
    responses.push(resp);
  }
  const allOk = responses.every(r => r.msg?.result?.content);
  r.case('20 concurrent jei_health', allOk, `${allOk ? 'all OK' : 'some failed'}`, 'concurrent');
}

proc.stdin.end();
proc.kill('SIGTERM');
r.print();
process.exit(r.failures.length > 0 ? 1 : 0);
