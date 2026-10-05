import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(fs.readFileSync('src/engine/MapSceneSessionCache.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const { MapSceneSessionCache } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
let loads = 0; const freed = [];
const cache = new MapSceneSessionCache(async id => {
  loads++; return { id, bytes: () => 10, dispose: () => freed.push(id) };
});
const [background, foreground] = await Promise.all([cache.get('A', false), cache.get('A')]);
assert.equal(background, foreground); assert.equal(loads, 1);
await cache.get('B'); assert.equal(await cache.get('A'), foreground); assert.equal(loads, 2);
await cache.get('C', false);
await cache.get('D');
for (let index = 0; index < 100; index++) await cache.get('large-' + index);
assert.deepEqual(freed, []); assert.equal(await cache.get('A'), foreground);
assert.equal(cache.has('C'), true); assert.equal(loads, 104);
cache.dispose(); assert.equal(freed.length, 104); assert.deepEqual(freed.slice(0, 4), ['A', 'B', 'C', 'D']);
await assert.rejects(cache.get('A'), /закрыт/);
let attempts = 0;
const retry = new MapSceneSessionCache(async () => { if (++attempts === 1) throw new Error('network'); return { bytes: () => 1, dispose() {} }; });
await assert.rejects(retry.get('A'), /network/); await retry.get('A'); assert.equal(attempts, 2); retry.dispose();
let complete; let disposed = 0;
const late = new MapSceneSessionCache(() => new Promise(resolve => { complete = resolve; }));
const pending = late.get('slow'); await Promise.resolve(); late.dispose();
complete({ bytes: () => 1, dispose() { disposed++; } });
await assert.rejects(pending, /закрыт/); assert.equal(disposed, 1);
console.log('PASS: session map retention without eviction, shared load, retry and disposal during load');
