import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
async function moduleFromSource(path) {
  const source = (await readFile(new URL(path, import.meta.url), 'utf8')).replace('import.meta.env.VITE_API_BASE', '""');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const { applySketchChange } = await moduleFromSource('../src/features/online/OnlineModels.ts');
const { authorizedFetch, resetCsrf, sessionEvents } = await moduleFromSource('../src/api/OnlineHttp.ts');
const empty = { revision: 0, mapId: 'map', mapRevision: 1, strokes: [] };
const stroke = { id: 'one', color: '#22c55e', width: 2, style: 'solid', arrowMode: 'none', points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }] };
const change = { operationId: 'uuid', revision: 1, mapRevision: 1, kind: 'upsert', stroke, userId: 'editor' };
test('same acknowledgement/event applies once; input state stays immutable', () => {
  const first = applySketchChange(empty, change);
  assert.equal(first.strokes.length, 1); assert.equal(empty.strokes.length, 0);
  assert.equal(applySketchChange(first, change), first);
});
test('gaps require resync; old events never roll back newer state', () => {
  assert.equal(applySketchChange(empty, { ...change, revision: 3 }), null);
  assert.equal(applySketchChange(null, change), null);
  const state = { ...empty, revision: 20 };
  assert.equal(applySketchChange(state, change), state);
});
test('independent editor lines survive, replacement keeps original author', () => {
  const first = applySketchChange(empty, change);
  const two = applySketchChange(first, { ...change, revision: 2, userId: 'other', stroke: { ...stroke, id: 'two' } });
  const edited = applySketchChange(two, { ...change, revision: 3, userId: 'other', stroke: { ...stroke, width: 3 } });
  assert.equal(edited.strokes.length, 2);
  assert.equal(edited.strokes.find(x => x.stroke.id === 'one').authorId, 'editor');
  assert.equal(edited.strokes.find(x => x.stroke.id === 'one').revision, 3);
});
test('remove/clear/map apply authoritative epochs without touching playback', () => {
  const first = applySketchChange(empty, change);
  const removed = applySketchChange(first, { ...change, kind: 'remove', stroke: undefined, strokeId: 'one', revision: 2 });
  assert.equal(removed.strokes.length, 0);
  const cleared = applySketchChange(first, { ...change, kind: 'clear', revision: 2, mapRevision: 2 });
  assert.equal(cleared.strokes.length, 0); assert.equal(cleared.mapId, 'map'); assert.equal(cleared.mapRevision, 2);
  const mapped = applySketchChange(first, { ...change, kind: 'setMap', revision: 2, mapRevision: 2, mapId: 'other-map' });
  assert.equal(mapped.mapId, 'other-map'); assert.equal(mapped.strokes.length, 0);
});
test('HTTP includes cookie credentials, refreshes CSRF once, preserves body', async () => {
  const original = globalThis.fetch;
  resetCsrf(); let tokens = 0; const commands = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(init.credentials, 'include');
    if (url.endsWith('/csrf')) return Response.json({ token: `token-${++tokens}` });
    commands.push(init);
    return commands.length === 1 ? Response.json({ error: 'csrf' }, { status: 400 }) : Response.json({ ok: true });
  };
  try {
    const response = await authorizedFetch('/api/sketch/commands', { method: 'POST', body: '{"operationId":"same-id"}' });
    assert.equal(response.status, 200); assert.equal(tokens, 2);
    assert.equal(commands[0].body, commands[1].body);
    assert.equal(commands[1].headers.get('X-CSRF-TOKEN'), 'token-2');
  } finally { globalThis.fetch = original; resetCsrf(); }
});
test('business errors are not retried; 401 expires sessions except failed login', async () => {
  const original = globalThis.fetch; let calls = 0; let expired = 0;
  const handler = () => expired++;
  sessionEvents.addEventListener('expired', handler);
  globalThis.fetch = async url => {
    if (url.endsWith('/csrf')) return Response.json({ token: 'test' });
    calls++; return Response.json({}, { status: url.endsWith('/commands') ? 409 : 401 });
  };
  try {
    await authorizedFetch('/api/sketch/commands', { method: 'POST' }); assert.equal(calls, 1);
    await authorizedFetch('/api/auth/login', { method: 'POST' }); assert.equal(expired, 0);
    await authorizedFetch('/api/auth/me'); assert.equal(expired, 1);
  } finally { globalThis.fetch = original; resetCsrf(); sessionEvents.removeEventListener('expired', handler); }
});

test('HTTP UUID generator works without randomUUID and produces UUID v4 identifiers', async () => {
  const { runInNewContext } = await import('node:vm');
  const { webcrypto } = await import('node:crypto');
  const source = await readFile(new URL('../src/utils/createId.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, crypto: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) } };
  runInNewContext(js, context);
  const ids = Array.from({ length: 1000 }, () => context.exports.createId());
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
