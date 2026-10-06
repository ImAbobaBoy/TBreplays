import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import * as THREE from 'three';
const code=ts.transpileModule(fs.readFileSync('src/engine/replay/ReplayCapturePoints.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {capturePointTracks,sampleCapturePoint}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const event=(time,progress,capturingTeamId=2,ownerTeamId=0,pointId=0)=>({time,progress,capturingTeamId,ownerTeamId,pointId,packetIndex:time*100,source:'wire'});
const tracks=capturePointTracks([event(1,.03),event(0,0,0),event(1.5,.07),event(2,.14),event(2.5,0,0,2),event(0,0,0,0,1)]);
const t=tracks.get(0);
assert.equal(sampleCapturePoint(t,-1),null);
assert.equal(sampleCapturePoint(t,.75).progress,0,'Do not invent progress before first measured capture');
assert.ok(Math.abs(sampleCapturePoint(t,1.25).progress-.05)<1e-8);
assert.ok(Math.abs(sampleCapturePoint(t,1.75).progress-.105)<1e-8,'Actual changing capture speed is preserved');
assert.equal(sampleCapturePoint(t,2.25).ownerTeamId,0,'Ownership never changes early');
assert.equal(sampleCapturePoint(t,2.5).ownerTeamId,2,'Ownership changes at the recorded event');
assert.equal(sampleCapturePoint(t,1.25).ownerTeamId,0,'Backward seeking restores old owner');
assert.equal(sampleCapturePoint([event(0,.2),event(3,.7)],1).progress,.2,'Do not bridge missing capture packets');
assert.equal(sampleCapturePoint([event(0,.7),event(.5,.2)],.25).progress,.7,'Capture resets are not smoothed away');
assert.equal(tracks.get(1).length,1,'Independent capture point tracks');
console.log('PASS: actual capture rates, ownership, resets, gaps and backward seeking');

// Real geometry/raycasting verifies that gameplay radii survive uneven ground.
globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>new Proxy({}, {get:()=>()=>{}})})};
let layerCode=ts.transpileModule(fs.readFileSync('src/engine/layers/CapturePointLayer.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
layerCode=layerCode.replace("from 'three'",`from '${pathToFileURL(path.resolve('node_modules/three/build/three.module.js')).href}'`).replace("from '../replay/ReplayCapturePoints'",`from 'data:text/javascript;base64,${Buffer.from(code).toString('base64')}'`);
const {CapturePointLayer}=await import('data:text/javascript;base64,'+Buffer.from(layerCode).toString('base64'));
const terrain=new THREE.Group(),ground=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
ground.rotation.x=-Math.PI/2;ground.position.y=7;terrain.add(ground);
const data={mapId:'test',coordinateSystem:'three-world-v1',points:[{id:0,label:'A',position:{x:2,y:1,z:3},radius:15},{id:1,label:'B',position:{x:20,y:1,z:3},radius:13}]};
const layer=new CapturePointLayer();layer.load(data,terrain);
const [ring,progress,label]=layer.root.children;
const positions=ring.geometry.getAttribute('position');
for(let i=0;i<positions.count;i++) {
  assert.ok(Math.abs(positions.getY(i)-7.15)<1e-5,'Ring follows actual terrain height');
  assert.ok(Math.abs(Math.hypot(positions.getX(i)-2,positions.getZ(i)-3)-(i%2?15.35:14.65))<1e-5,'World radius remains exact');
}
layer.setReplay([event(0,0,0),event(1,.5,2),event(2,0,0,2),event(0,0,0,0,1)],2);
const texture=label.material.map;layer.setTime(1);
assert.equal(progress.geometry.drawRange.count,384);assert.equal(progress.visible,true);
layer.setTime(2);assert.equal(ring.material.color.getHexString(),'4880ff');
layer.setTime(0);assert.equal(ring.material.color.getHexString(),'d8dce5');assert.equal(progress.visible,false);
assert.equal(label.material.map,texture,'Playback reuses the label texture');
let disposed=false;ring.geometry.addEventListener('dispose',()=>disposed=true);layer.clear();
assert.equal(disposed,true);assert.equal(layer.root.children.length,0);
layer.setReplay([],null);layer.load(data,terrain);assert.equal(layer.root.children.length,6,'Map revisit restores points');
layer.clear();ground.geometry.dispose();ground.material.dispose();
console.log('PASS: terrain draping, gameplay radii, replay colours, texture reuse and map revisit');
