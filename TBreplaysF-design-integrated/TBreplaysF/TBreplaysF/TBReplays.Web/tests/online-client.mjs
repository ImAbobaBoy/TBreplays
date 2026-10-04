import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const url = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
function compile(file, imports = {}) {
  let code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [name, value] of Object.entries(imports)) code = code.replaceAll(`from '${name}'`, `from '${value}'`);
  return url(code);
}
const hubUrl = url(`export const hub = { handlers: new Map(), connectionId: 'connection', state: 'Connected', on(name, callback) { this.handlers.set(name, callback); }, onreconnecting() {}, onreconnected() {}, onclose() {}, async stop() {} }; export class HubConnectionBuilder { withUrl() { return this; } withAutomaticReconnect() { return this; } configureLogging() { return this; } build() { return hub; } } export const HubConnectionState = { Disconnected: 'Disconnected' }; export const LogLevel = { Warning: 1 };`);
const httpUrl = url(`export const API_BASE = ''; export const http = { call: async () => ({}) }; export function onlineRequest(...args) { return http.call(...args); }`);
const { hub } = await import(hubUrl);
const { http } = await import(httpUrl);
const memory = new Map(); globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
const models = compile('src/features/online/OnlineModels.ts');
const clientUrl = compile('src/features/online/OnlineClient.ts', { '../../utils/createId': compile('src/utils/createId.ts'), '@microsoft/signalr': hubUrl, '../../api/OnlineHttp': httpUrl, './OnlineModels': models });
const { OnlineClient } = await import(clientUrl);
const client = new OnlineClient();
const workspace = { revision: 1, slides: [{ id: 'a', mapId: 'same-map' }, { id: 'b', mapId: 'same-map' }], presenterId: null, presenterConnectionId: null, presenterSlideId: null, activeSlideId: 'a' };
const boards = { a: { revision: 0, mapId: 'same-map', mapRevision: 0, strokes: [], tanks: [], slideId: 'a', undoCount: 0 }, b: { revision: 0, mapId: 'same-map', mapRevision: 0, strokes: [], tanks: [], slideId: 'b', undoCount: 0 } };
let active = 'a'; let getState;
hub.invoke = async (method, id) => {
  if (method === 'SelectSlide') { active = id; return { applied: true, state: { ...workspace, activeSlideId: id } }; }
  if (method === 'GetState') return getState ? getState() : structuredClone(boards[active]);
  if (method === 'GetReplay') return { serverId: 'server', sequence: 0, slideId: active, sessionId: active, replayId: null, serverNowUnixMs: Date.now() };
};
client.publish({ status: 'connected', workspace, connectionId: 'connection' });
await client.selectSlide('a');
client.receive({ slideId: 'b', revision: 1, kind: 'clear', mapRevision: 1 });
assert.equal(client.getSnapshot().board.slideId, 'a'); assert.equal(client.getSnapshot().board.revision, 0);
// An undo arrives while a snapshot computed just before the undo is still in flight.
let finishSnapshot; let first = true;
getState = () => first ? (first = false, new Promise(resolve => { finishSnapshot = resolve; })) : structuredClone(boards.a);
const refreshing = client.refresh();
boards.a = { ...boards.a, revision: 1, mapRevision: 1 };
client.receive({ slideId: 'a', revision: 1, operationId: 'undo', kind: 'undo', mapRevision: 1 });
finishSnapshot({ ...boards.a, revision: 0, mapRevision: 0 });
await refreshing; assert.equal(client.getSnapshot().board.revision, 1, 'Undo gap fetches another authoritative snapshot');
getState = null;
// An acknowledged operation must finish even when its event is buffered during refresh.
let finishHttp;
http.call = () => new Promise(resolve => { finishHttp = resolve; });
let finishOld; getState = () => new Promise(resolve => { finishOld = resolve; });
const inFlight = client.refresh();
const pending = client.apply({ kind: 'clear', expectedRevision: 1 });
const operationId = [...client.pendingSketch.keys()][0];
boards.a = { ...boards.a, revision: 2, mapRevision: 2 };
const acknowledged = { slideId: 'a', revision: 2, operationId, kind: 'clear', mapRevision: 2 };
client.receive(acknowledged); await pending;
assert.equal(client.pendingSketch.size, 0, 'Buffered acknowledgement completes without a false timeout');
finishOld(structuredClone(boards.a)); getState = null; await inFlight;
finishHttp({ applied: true, change: acknowledged });
await client.refresh();
// Late state from another slide cannot leak across a transition to the same map.
let finishA; getState = () => new Promise(resolve => { finishA = resolve; });
const oldSlide = client.refresh(); const switching = client.selectSlide('b');
await Promise.resolve(); await Promise.resolve();
getState = null; finishA(structuredClone(boards.a)); await oldSlide; await switching;
assert.equal(client.getSnapshot().board.slideId, 'b'); assert.equal(client.getSnapshot().replay.slideId, 'b');
workspace.presenterId = 'presenter'; workspace.presenterConnectionId = 'another'; workspace.presenterSlideId = 'a';
hub.handlers.get('WorkspaceChanged')({ ...workspace, activeSlideId: null }); await client.selecting;
assert.equal(client.getSnapshot().board.slideId, 'a');
workspace.presenterId = workspace.presenterConnectionId = workspace.presenterSlideId = null;
hub.handlers.get('WorkspaceChanged')({ ...workspace, activeSlideId: null }); await client.selecting;
assert.equal(client.getSnapshot().board.slideId, 'a', 'Presentation exit keeps the last presented slide');
await client.selectSlide('b'); assert.equal(client.getSnapshot().board.slideId, 'b', 'Independent navigation resumes after presentation');
client.dispose(); console.log('PASS: client slide isolation, in-flight undo, buffered acknowledgements, late snapshots and presentation exit');
