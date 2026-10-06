import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';
let code=ts.transpileModule(fs.readFileSync('src/engine/BillboardTextureOverride.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
code=code.replace("from 'three'",`from '${pathToFileURL(path.resolve('node_modules/three/build/three.module.js')).href}'`);
const {remapBillboardFaces}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const geometry=new THREE.BufferGeometry();geometry.addGroup(0,30,4);geometry.addGroup(30,6,4);
const faces=[{name:'billboard_type1',startIndex:0,indexCount:6},{name:'billboard_type1_texture',startIndex:6,indexCount:6},
  {name:'bush_tuya_billboard_lod1',startIndex:18,indexCount:6}];
assert.equal(remapBillboardFaces(geometry,faces,9),6);
assert.deepEqual(geometry.groups,[{start:0,count:6,materialIndex:4},{start:6,count:6,materialIndex:9},
  {start:12,count:18,materialIndex:4},{start:30,count:6,materialIndex:4}], 'Shared original material stays on frames, bushes and other objects');
const clipped=new THREE.BufferGeometry();clipped.addGroup(30,6,4);
assert.equal(remapBillboardFaces(clipped,faces,9),0,'Excluded/outside-map faces are not resurrected');
const legacy=new THREE.BufferGeometry();legacy.addGroup(0,36,4);
assert.equal(remapBillboardFaces(legacy,undefined,9),0,'Unknown old manifests retain original textures');
assert.equal(legacy.groups.length,1);
geometry.dispose();clipped.dispose();legacy.dispose();
console.log('PASS: billboard faces only, shared materials, clipping and legacy fallback');
