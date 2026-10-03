import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';
const moduleUrl = relative => pathToFileURL(path.resolve(relative)).href;
const threeUrl = moduleUrl('node_modules/three/build/three.module.js');
const ddsUrl = moduleUrl('node_modules/three/examples/jsm/loaders/DDSLoader.js');
function compile(file, imports = {}) {
  let code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [name, value] of Object.entries(imports)) code = code.replaceAll(`from '${name}'`, `from '${value}'`);
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
}
const loaderUrl = compile('src/engine/MapDdsLoader.ts', { 'three': threeUrl, 'three/examples/jsm/loaders/DDSLoader.js': ddsUrl });
const decorationsUrl = compile('src/engine/TacticalMapObjects.ts');
const { MapDdsLoader } = await import(loaderUrl);
const { ObjectMeshLayer } = await import(compile('src/engine/layers/ObjectMeshLayer.ts', { 'three': threeUrl, '../MapDdsLoader': loaderUrl, '../TacticalMapObjects': decorationsUrl }));
const loader = new MapDdsLoader();
// Read existing imported assets; this test never writes to the game or map data.
const dataRoot = process.argv[2];
assert.ok(dataRoot, 'Pass the imported map data directory');
const catalog = JSON.parse(fs.readFileSync(path.join(dataRoot, 'map_catalog.json')));
const winter = catalog.find(x => x.name === '12_malinovka_ma');
const root = path.join(dataRoot, 'Processed', winter.name, 'revisions', winter.revision);
let rgbaCount = 0;
for (const file of fs.readdirSync(path.join(root, 'textures'))) {
  const bytes = fs.readFileSync(path.join(root, 'textures', file));
  if (bytes.readUInt32LE(84) !== 0 || bytes.readUInt32LE(92) !== 0xff) continue;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const decoded = loader.parse(buffer, true);
  assert.ok(decoded.width > 0 && decoded.height > 0 && decoded.mipmaps.length);
  assert.deepEqual(Array.from(decoded.mipmaps[0].data.slice(0, 4)), Array.from(bytes.subarray(128, 132)), 'RGBA colors preserved');
  rgbaCount++;
}
assert.ok(rgbaCount > 0, 'Real RGBA assets tested');
assert.throws(() => loader.parse(new ArrayBuffer(4)), /DDS/);
// Geometry must appear even while an object texture is still in flight.
const binary = new ArrayBuffer(140); const view = new DataView(binary);
[0x324a424f, 3, 3, 3, 1, 0, 3, 0].forEach((n, i) => view.setInt32(i * 4, n, true));
new Float32Array(binary, 32, 9).set([0,0,0, 1,0,0, 0,0,1]);
new Float32Array(binary, 92, 9).set([0,1,0, 0,1,0, 0,1,0]);
new Uint32Array(binary, 128, 3).set([0,1,2]);
const manifest = { vertexCount: 3, indexCount: 3, url: '/mesh', materials: [{ index: 0, textureUrl: '/slow-texture' }] };
const api = { getObjectMeshManifest: async () => manifest, getObjectMesh: async () => binary, createUrl: x => x };
const renderer = { capabilities: { getMaxAnisotropy: () => 1 } };
const group = new THREE.Group(); const layer = new ObjectMeshLayer(group, api, renderer);
let finishTexture;
let textureStarted;
const started = new Promise(resolve => { textureStarted = resolve; });
layer.ddsLoader.loadAsync = () => new Promise(resolve => { finishTexture = resolve; textureStarted(); });
const bounds = new THREE.Box3(new THREE.Vector3(-10, -10, -10), new THREE.Vector3(10, 10, 10));
const loading = layer.load('winter', bounds);
await started;
assert.equal(group.children.length, 1, 'Geometry visible before texture completes');
assert.deepEqual(Array.from(group.children[0].geometry.getAttribute('normal').array), [0,1,0, 0,1,0, 0,1,0]);
layer.clear(); finishTexture(new THREE.Texture());
await loading;
assert.equal(group.children.length, 0, 'Late texture does not revive cleared map');
let finishManifest; let meshRequested = false;
const staleGroup = new THREE.Group();
const stale = new ObjectMeshLayer(staleGroup, { ...api, getObjectMeshManifest: () => new Promise(resolve => { finishManifest = resolve; }), getObjectMesh: async () => { meshRequested = true; return binary; } }, renderer);
const pending = stale.load('old-map', bounds); stale.clear(); finishManifest(manifest); await pending;
assert.equal(meshRequested, false); assert.equal(staleGroup.children.length, 0);
layer.dispose(); stale.dispose();
console.log(`PASS: ${rgbaCount} real Winter Malinovka RGBA DDS files, preserved channels, geometry before textures, normals, stale loads.`);
