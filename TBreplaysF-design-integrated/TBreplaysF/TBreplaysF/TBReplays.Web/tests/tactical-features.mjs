import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';
const threeUrl = pathToFileURL(path.resolve('node_modules/three/build/three.module.js')).href;
function compile(file, imports = {}) {
  let code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [name, value] of Object.entries(imports)) code = code.replaceAll(`from '${name}'`, `from '${value}'`);
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
}
// Canvas is only used for labels; all geometry and raycasting use real Three.js.
globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => new Proxy({}, { get: (_, key) => key === 'measureText' ? text => ({ width: text.length * 18 }) : key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : key === 'createImageData' ? (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }) : () => {} }) }) };
const transforms = compile('src/engine/MapCalibrationTransforms.ts', { three: threeUrl });
const builder = compile('src/engine/replay/ReplayTrackBuilder.ts');
const shotGeometry = compile('src/engine/replay/ReplayShotGeometry.ts');
const tankFactory = compile('src/engine/tanks/TankMeshFactory.ts', { three: threeUrl });
const { createTankVisual, disposeTankVisual, updateTankLabel } = await import(tankFactory);
const { buildReplayTimeline } = await import(builder);
const { shotRayEnd } = await import(shotGeometry);
const { ReplayLayer } = await import(compile('src/engine/layers/ReplayLayer.ts', { three: threeUrl, '../MapCalibrationTransforms': transforms, '../replay/ReplayTrackBuilder': builder, '../replay/ReplayShotGeometry': shotGeometry, '../tanks/TankMeshFactory': tankFactory }));
assert.equal(shotRayEnd({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 260), null);
assert.equal(shotRayEnd({ x: 0, y: 0, z: 0 }, { x: NaN, y: 0, z: 0 }, 260), null);
const normalized = shotRayEnd({ x: 3, y: 4, z: 5 }, { x: 3000, y: 0, z: 4000 }, 260);
assert.ok(Math.abs(Math.hypot(normalized.x - 3, normalized.y - 4, normalized.z - 5) - 260) < 1e-8);
const signatures = new Set();
for (const visualKey of ['light', 'medium', 'heavy', 'td']) {
  const visual = createTankVisual({ id: visualKey, label: visualKey, visualKey, team: 'ally', color: '#22c55e', pose: { x: 0, y: 0, z: 0, bodyYawDegrees: 0, turretYawDegrees: 0 }, aimTarget: null });
  assert.equal(visual.root.children.filter(child => child.name === 'tank_track').length, 2);
  const turret = visual.turretPivot.children.find(child => child.name === 'manual_tank_turret');
  signatures.add(JSON.stringify([visual.root.children.length, turret.geometry.type, turret.geometry.parameters, turret.scale.toArray()]));
  visual.root.updateMatrixWorld(true);
  assert.ok(visual.muzzleSocket.getWorldPosition(new THREE.Vector3()).z > 0);
  disposeTankVisual(visual);
}
assert.equal(signatures.size, 4, 'All four classes have distinct silhouettes');
const blankTank = createTankVisual({ id: 'blank', label: '', visualKey: 'heavy', team: 'ally', color: '#ffd400', pose: { x: 0, y: 0, z: 0, bodyYawDegrees: 0, turretYawDegrees: 0 }, aimTarget: null });
assert.equal(blankTank.labelSprite.visible, false, 'Empty tank name draws no fallback label');
updateTankLabel(blankTank, 'ТТ'); assert.equal(blankTank.labelSprite.visible, true);
updateTankLabel(blankTank, ''); assert.equal(blankTank.labelSprite.visible, false);
disposeTankVisual(blankTank);
const makeVehicle = (entityId, vehicleClass) => ({ entityId, teamId: 1, nickname: String(entityId), vehicleClass, vehicleName: vehicleClass, vehicleCompactDescriptor: 1, consumables: [], modules: [] });
const movement = Array.from({ length: 11 }, (_, time) => ({ time, x: time * 5, y: 2, z: time * 5, yawRadians: 0, segmentIndex: 0 }));
const fixture = { vehicles: [makeVehicle(1, 'heavyTank'), makeVehicle(2, 'lightTank')], recorderTeamId: 1, outcome: {}, playback: { startTime: 0, endTime: 10, scoreboard: [], projectiles: [], vehicles: [1, 2].map(entityId => ({ entityId, teamId: 1, movement, turret: [], states: [{ time: 0, isAlive: true, isVisible: true, extras: [] }], visibility: [{ startTime: 0, endTime: 10 }], consumableUses: [], shots: entityId === 1 ? [{ time: 1, shooterEntityId: 1, directionX: 3000, directionY: 0, directionZ: 4000 }] : [] })) } };
const layer = new ReplayLayer(new THREE.Group());
layer.load(buildReplayTimeline('fixture', fixture));
assert.equal(layer.shotLinesRoot.children.length, 1, 'A shot without origin uses interpolated tank pose');
const beam = layer.shotLinesRoot.children[0];
assert.ok(Math.abs(beam.geometry.parameters.height - 260) < .001);
assert.equal(beam.material.depthTest, false, 'Shots remain visible above terrain');
layer.setTime(1.1); assert.equal(beam.visible, true);
const viewCamera = new THREE.PerspectiveCamera(50); viewCamera.position.set(0,1000,1000);
layer.updateView(viewCamera,600); assert.ok(beam.scale.x>4, 'A tracer stays at least 3 pixels wide from a distant camera');
layer.setTime(8); assert.equal(beam.visible, false);
layer.setTime(1.1); assert.equal(beam.visible, true, 'Seeking back restores the shot');
const selected = layer.tankEntries.get(1);
const addedSprite = new THREE.Sprite(); selected.visual.root.add(addedSprite);
layer.selectAt({ intersectObjects: () => [{ object: addedSprite }] });
assert.equal(selected.visual.selectionRing.visible, true, 'Child sprites resolve tank selection through ancestor');
assert.equal(selected.trackGroup.children[0].material.color.getHexString(), 'facc15');
layer.selectAt({ intersectObjects: () => [] });
assert.equal(selected.visual.selectionRing.visible, false);
layer.dispose();
const textSign = compile('src/engine/TextSign.ts', {three: threeUrl});
const { TacticalPngExportService } = await import(compile('src/engine/export/TacticalPngExportService.ts', { three: threeUrl, '../TextSign': textSign }));
const labelDocument = globalThis.document;
let exportedPixels;
globalThis.document = { createElement: () => ({ getContext: () => ({ createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }), putImageData: image => { exportedPixels = image.data; } }) }) };
const png = new TacticalPngExportService();
const replayRoot = new THREE.Group(), debugRoot = new THREE.Group(), workspaceRoot = new THREE.Group();
const visibility = []; let renderTarget = null;
const renderer = { getRenderTarget: () => renderTarget, setRenderTarget: value => { renderTarget = value; }, render: () => { visibility.push(replayRoot.visible); assert.equal(workspaceRoot.visible, false); }, readRenderTargetPixels: (...args) => { const pixels = args.at(-1); for (let index = 0; index < pixels.length; index += 4) pixels.set([111, 128, 88, 255], index); } };
const request = { renderer, replayRoot, debugRoot, workspaceRoot, mapRoot: new THREE.Group(), scene: new THREE.Scene(), calibration: null, width: 4, height: 4, includeReplay: true };
png.renderBackgroundToCanvas(request);
assert.deepEqual(Array.from(exportedPixels.slice(0, 4)), [111, 128, 88, 255], 'Actual render pixels survive the export');
png.renderBackgroundToCanvas({ ...request, includeReplay: false });
assert.deepEqual(visibility, [true, false], 'PNG can include or exclude the real replay layer');
renderer.render = () => { throw new Error('render failed'); };
assert.throws(() => png.renderBackgroundToCanvas(request), /render failed/);
assert.equal(renderTarget, null); assert.equal(replayRoot.visible, true); assert.equal(workspaceRoot.visible, true); assert.equal(debugRoot.visible, true);
console.log('PASS: PNG replay toggle and viewer recovery after export failure');
let dots = 0;
png.drawStrokes({ save() {}, restore() {}, beginPath() {}, arc() { dots++; }, fill() {} }, [{ id: 'point', color: '#123456', width: 4, style: 'marker', points: [{ x: 0, y: 0, z: 0 }] }], new THREE.PerspectiveCamera(), 100, 100);
assert.equal(dots, 1, 'Point markers are included in PNG');

const signs=[];
png.drawStrokes({save(){},restore(){},measureText:text=>({width:text.length*10}),fillRect(){},strokeRect(){},fillText(text){signs.push(text);}},
[{id:'text',style:'text',text:'Вперёд\nДержать позицию',color:'#ffff00',width:10,points:[{x:0,y:0,z:0}]}],new THREE.OrthographicCamera(-300,300,300,-300),2048,2048);
assert.deepEqual(signs,['Вперёд','Держать позицию'],'Multi-line text is explicitly painted into PNG');
globalThis.document = labelDocument;
const {createTextSign,textSignLines}=await import(textSign);
const sprite=createTextSign('Вперёд\nДержать позицию','#ffff00',10);
assert.ok(sprite instanceof THREE.Sprite && sprite.scale.y>20 && sprite.material.map instanceof THREE.CanvasTexture);
assert.equal(textSignLines('a'.repeat(80)).length,3); sprite.material.map.dispose(); sprite.material.dispose();

if (process.argv[2]) {
  const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const real = { ...raw, vehicles: raw.vehicleStatistics ?? raw.vehicles };
  const timeline = buildReplayTimeline('real', real);
  const actual = new ReplayLayer(new THREE.Group()); actual.load(timeline);
  assert.ok(timeline.shotEvents.length > 0);
  assert.equal(actual.shotLinesRoot.children.length, timeline.shotEvents.length, 'Every real replay fire event has visible geometry');
  for (const shot of actual.shotLinesRoot.children) assert.ok(Number.isFinite(shot.geometry.parameters.height) && shot.geometry.parameters.height > 0 && shot.geometry.parameters.height < 10000);
  actual.dispose(); console.log(`PASS: real replay, ${timeline.tracks.length} tanks, ${timeline.shotEvents.length} shots`);
}
console.log('PASS: four tank classes, selection paths, shot fallback, time seeking and visibility');
