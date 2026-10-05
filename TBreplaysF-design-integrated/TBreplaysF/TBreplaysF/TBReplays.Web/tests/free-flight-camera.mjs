import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';
globalThis.window = new EventTarget();
globalThis.document = Object.assign(new EventTarget(), { activeElement: null, hidden: false });
class Canvas extends EventTarget {
  captures = new Set(); clientHeight = 600; classList = { toggle() {} };
  focus() { document.activeElement = this; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
}
function emit(target, type, values = {}) {
  const event = Object.assign(new Event(type, { cancelable: true }), values); target.dispatchEvent(event); return event;
}
let code = ts.transpileModule(fs.readFileSync('src/engine/FreeFlightCamera.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
code = code.replace("from 'three'", `from '${pathToFileURL(path.resolve('node_modules/three/build/three.module.js')).href}'`);
const { FreeFlightCamera } = await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const camera = new THREE.PerspectiveCamera(), canvas = new Canvas();
const flight = new FreeFlightCamera(camera, canvas); const speeds = [];
flight.onSpeedChanged = speed => speeds.push(speed);
emit(window, 'keydown', { code:'KeyW', key:'w' }); flight.update(.1); assert.equal(camera.position.length(),0);
flight.setEnabled(true); emit(window,'keydown',{code:'KeyW',key:'w'}); flight.update(.1);
assert.ok(camera.position.z < -4 && camera.position.z > -12, 'W accelerates smoothly towards 120 units per second');
emit(canvas,'blur'); camera.position.set(0,0,0);
emit(window,'keydown',{code:'KeyW',key:'w'}); emit(window,'keydown',{code:'KeyD',key:'d'}); flight.update(.1);
assert.ok(camera.position.length() > 4 && camera.position.length() < 12, 'Diagonal movement has the same speed');
emit(window,'blur'); const stopped=camera.position.clone(); flight.update(.1); assert.deepEqual(camera.position,stopped);
for(let speed=1;speed<=5;speed++) { emit(window,'keydown',{key:String(speed)}); camera.position.set(0,0,0); emit(window,'keydown',{code:'KeyW',key:'w'}); flight.update(.1); assert.ok(camera.position.length()>0); emit(window,'blur'); emit(window,'keyup',{code:'KeyW'}); }
assert.deepEqual(speeds,[1,2,3,4,5]);
document.activeElement={tagName:'INPUT'}; emit(window,'keydown',{key:'1',code:'Digit1'}); emit(window,'keydown',{code:'KeyW',key:'w'});
camera.position.set(0,0,0); flight.update(.1); assert.equal(camera.position.length(),0); assert.equal(speeds.at(-1),5);
canvas.focus(); let drawingClicks=0; canvas.addEventListener('pointerdown',()=>drawingClicks++);
const before=camera.quaternion.clone(); emit(canvas,'pointermove',{pointerId:1,clientX:100,clientY:100}); assert.ok(camera.quaternion.equals(before));
emit(canvas,'pointerdown',{button:0,pointerId:1,clientX:0,clientY:0});
assert.equal(canvas.hasPointerCapture(1),false); assert.equal(drawingClicks,1, 'Flight LMB reaches the active tool');
emit(canvas,'pointerdown',{button:2,pointerId:1,clientX:0,clientY:0});
assert.equal(canvas.hasPointerCapture(1),true); assert.equal(drawingClicks,1, 'Flight RMB is reserved for camera look');
emit(canvas,'pointermove',{pointerId:1,clientX:100,clientY:100}); flight.update(.1); assert.ok(!camera.quaternion.equals(before));
emit(canvas,'pointerup',{pointerId:1}); assert.equal(canvas.hasPointerCapture(1),false);
camera.position.set(0,0,0); emit(canvas,'wheel',{deltaY:-100,deltaMode:0}); flight.update(.1); assert.ok(camera.position.dot(camera.getWorldDirection(new THREE.Vector3()))>0);
document.hidden=true; emit(window,'keydown',{code:'KeyW',key:'w'}); const hidden=camera.position.clone(); flight.update(10); assert.deepEqual(camera.position,hidden); document.hidden=false;

// Release of a look drag must not forget a physically held movement key.
canvas.focus(); emit(window,'keydown',{code:'KeyW',key:'w'});
emit(canvas,'pointerdown',{button:2,pointerId:7,clientX:0,clientY:0});
emit(canvas,'pointerup',{pointerId:7}); emit(canvas,'lostpointercapture');
const afterLook=camera.position.clone(); flight.update(.1); assert.ok(camera.position.distanceTo(afterLook)>0);
// Toolbar focus does not require re-enabling flight mode.
emit(window,'blur'); document.activeElement={tagName:'BUTTON'}; camera.position.set(0,0,0);
emit(window,'keydown',{code:'KeyW',key:'w'}); flight.update(.1); assert.ok(camera.position.length()>0);
emit(window,'blur');
const travel = fps => { camera.position.set(0,0,0); camera.quaternion.identity(); flight.setEnabled(true); emit(window,'keydown',{code:'KeyW',key:'w'}); for(let i=0;i<fps;i++)flight.update(1/fps); return camera.position.z; };
assert.ok(Math.abs(travel(30)-travel(144)) < .00001, 'Smooth movement integrates equally at 30 and 144 FPS');
flight.dispose(); const final=camera.position.clone(); emit(canvas,'wheel',{deltaY:-100,deltaMode:0}); emit(window,'keydown',{code:'KeyW',key:'w'}); flight.update(.1); assert.deepEqual(camera.position,final);
console.log('PASS: flight RMB look, LMB tools, smooth WASD, speeds, wheel, focus, blur and cleanup');
