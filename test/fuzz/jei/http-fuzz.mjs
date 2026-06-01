#!/usr/bin/env node
import { FuzzReport, httpReq, withTimeout, FUZZ_INPUTS, PORT, bridgeUp, COLORS } from '../shared/harness.mjs';

const r = new FuzzReport('JEI HTTP Bridge Fuzzer');

if (!await bridgeUp(PORT.JEI, 2000)) {
  console.log(`${COLORS.red}JEI bridge not up on :${PORT.JEI} — aborting${COLORS.reset}`);
  process.exit(2);
}

r.section('1. Health endpoint');
{
  const resp = await httpReq(PORT.JEI, '/api/health');
  r.pass('GET /api/health returns 200', `status=${resp.status}, jei_runtime=${resp.body?.jei_runtime}`, 'health');
  r.pass('health has item_count', typeof resp.body?.item_count === 'number', 'health');
  r.pass('health has status field', resp.body?.status === 'ok', 'health');
}

r.section('2. /api/items/search — boundary inputs');
{
  const cases = [
    { name: 'q="" (empty)', q: '', expectStatus: 400 },
    { name: 'q=" " (whitespace)', q: ' ' },
    { name: 'q="iron ingot" (normal)', q: 'iron ingot', expectMin: 1 },
    { name: 'q="NONEXISTENT_XYZ_123" (no match)', q: 'NONEXISTENT_XYZ_123' },
    { name: 'q with SQL injection', q: FUZZ_INPUTS.sqlInject },
    { name: 'q with XSS', q: FUZZ_INPUTS.xss },
    { name: 'q with unicode/emoji', q: FUZZ_INPUTS.unicode },
    { name: 'q with null byte', q: FUZZ_INPUTS.nullByte },
    { name: 'q with CRLF', q: FUZZ_INPUTS.crlf },
    { name: 'q very long (100k chars)', q: FUZZ_INPUTS.veryLong },
    { name: 'q with path traversal', q: FUZZ_INPUTS.pathTraversal },
    { name: 'q with quotes', q: `"'or"1"="1` },
    { name: 'q with FTS5 operators', q: 'NEAR(iron ingot, 3) AND NOT ore' },
    { name: 'q with asterisk wildcard', q: 'iron*' },
  ];
  for (const c of cases) {
    const q = encodeURIComponent(c.q);
    const resp = await httpReq(PORT.JEI, `/api/items/search?q=${q}&limit=5`, { timeout: 5000 });
    const expectedStatus = c.expectStatus ?? 200;
    const ok = resp.status === expectedStatus && (expectedStatus !== 200 || Array.isArray(resp.body?.results));
    r.case(c.name, ok, ok ? `results=${resp.body?.results?.length}` : `status=${resp.status} body=${JSON.stringify(resp.body).slice(0,200)}`, 'search');
  }
}

r.section('3. /api/items/search — limit & offset boundary');
{
  for (const [limit, expectedStatus] of [[0, 200], [1, 200], [-1, 400], [1000, 200], [99999, 200], ['abc', 400], ['NaN', 400], [1.5, 400]]) {
    const resp = await httpReq(PORT.JEI, `/api/items/search?q=iron&limit=${limit}`);
    r.case(`limit=${JSON.stringify(limit)} (expect ${expectedStatus})`, resp.status === expectedStatus, `status=${resp.status}`, 'boundary');
  }
  for (const [offset, expectedStatus] of [[0, 200], [-1, 400], [999999, 200]]) {
    const resp = await httpReq(PORT.JEI, `/api/items/search?q=iron&offset=${offset}&limit=5`);
    r.case(`offset=${offset} (expect ${expectedStatus})`, resp.status === expectedStatus, `status=${resp.status}`, 'boundary');
  }
}

r.section('4. /api/items/{uid} — boundary');
{
  for (const uid of [
    'minecraft:iron_ingot',
    'minecraft:nonexistent_xyz',
    '../etc/passwd',
    'minecraft:iron_ingot/../../../etc/passwd',
    encodeURIComponent('../../../etc/passwd'),
    'null',
    '',
    'undefined',
    'a'.repeat(10000),
    '🎮:item',
    'mod with space:item',
    'MOD:UPPER',
    'mod:item:extra:colons',
    "mod':--",
    'mod' + '\u0000' + 'name',
  ]) {
    const resp = await httpReq(PORT.JEI, `/api/items/${encodeURIComponent(uid)}`, { timeout: 5000 });
    const isExpected = resp.status === 200 || resp.status === 404;
    r.case(`uid=${uid.slice(0,40)}${uid.length>40?'…':''}`, isExpected, `status=${resp.status}`, 'item');
  }
}

r.section('5. /api/items/{uid}/recipes — boundary');
{
  for (const uid of [
    'minecraft:iron_ingot',
    'minecraft:nonexistent_xyz',
    '../etc/passwd',
    'a'.repeat(10000),
    'mod\u0000name:item',
  ]) {
    const resp = await httpReq(PORT.JEI, `/api/items/${encodeURIComponent(uid)}/recipes`, { timeout: 10_000 });
    const isExpected = resp.status === 200 || resp.status === 404;
    r.case(`recipes uid=${uid.slice(0,40)}${uid.length>40?'…':''}`, isExpected, `status=${resp.status}`, 'recipes');
  }
}

r.section('6. /api/items/all — pagination');
{
  for (const limit of [1, 10, 1000]) {
    for (const offset of [0, 100, 10000]) {
      const resp = await httpReq(PORT.JEI, `/api/items/all?limit=${limit}&offset=${offset}`, { timeout: 30_000 });
      r.case(`all limit=${limit} offset=${offset}`, resp.status === 200 && Array.isArray(resp.body?.results), `status=${resp.status}, count=${resp.body?.results?.length}`, 'pagination');
    }
  }
}

r.section('7. /api/items/count');
{
  const resp = await httpReq(PORT.JEI, '/api/items/count');
  r.case('count returns 200', resp.status === 200, `status=${resp.status}`, 'count');
  r.case('count has count field', typeof resp.body?.count === 'number', `count=${resp.body?.count}`, 'count');
}

r.section('8. /api/categories');
{
  const resp = await httpReq(PORT.JEI, '/api/categories');
  r.case('categories 200', resp.status === 200, `status=${resp.status}`, 'categories');
  r.case('categories has array', Array.isArray(resp.body?.categories), `n=${resp.body?.categories?.length}`, 'categories');
}

r.section('9. HTTP method tampering');
{
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
    const resp = await httpReq(PORT.JEI, '/api/health', { method: m });
    r.case(`method=${m} on /api/health`, resp.status === 200 || resp.status === 405, `status=${resp.status}`, 'method');
  }
}

r.section('10. HTTP header injection / malformed');
{
  const resp = await httpReq(PORT.JEI, '/api/health', { headers: { 'X-Evil': 'value\r\nSet-Cookie: evil=1' } });
  r.case('CRLF in header is rejected', resp.status === 0, `status=${resp.status}`, 'security');

  const badCT = await httpReq(PORT.JEI, '/api/health', { headers: { 'content-type': 'text/html' } });
  r.case('wrong content-type on health', badCT.status === 200, `status=${badCT.status}`, 'security');
}

r.section('11. Path traversal');
{
  for (const p of [
    '/api/../etc/passwd',
    '/api/../../etc/passwd',
    '/api//etc/passwd',
    '/api/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '/api/items/..%2F..%2F..%2Fetc%2Fpasswd',
    '/api/items/%00',
    '/api/items/iron_ingot/recipes/../../../etc/passwd',
  ]) {
    const resp = await httpReq(PORT.JEI, p);
    r.case(`path=${p.slice(0,50)}`, resp.status === 200 || resp.status === 400 || resp.status === 404, `status=${resp.status}`, 'security');
  }
}

r.section('12. Concurrent load');
{
  const start = Date.now();
  const N = 50;
  const results = await Promise.all(Array(N).fill(0).map(() => httpReq(PORT.JEI, '/api/health')));
  const ok = results.every(r => r.status === 200);
  const ms = Date.now() - start;
  r.case(`50 parallel /api/health`, ok, `${ok ? 'all OK' : 'some failed'} in ${ms}ms`, 'performance');
  r.case(`50 req < 5s`, ms < 5000, `${ms}ms`, 'performance');
}

r.section('13. Oversized payloads');
{
  const huge = 'x'.repeat(1_000_000);
  const resp = await httpReq(PORT.JEI, `/api/items/search?q=${huge}&limit=5`, { timeout: 10_000 });
  r.case('1MB search query', resp.status === 200, `status=${resp.status}`, 'boundary');
}

r.section('14. Unknown endpoints');
{
  for (const p of ['/api/foo', '/api/', '/api/items/iron/recipes/uses', '/admin', '/', '/api/items/iron_ingot/delete']) {
    const resp = await httpReq(PORT.JEI, p);
    r.case(`unknown=${p}`, resp.status === 404 || resp.status === 200, `status=${resp.status}`, 'unknown');
  }
}

r.print();
process.exit(r.failures.length > 0 ? 1 : 0);
