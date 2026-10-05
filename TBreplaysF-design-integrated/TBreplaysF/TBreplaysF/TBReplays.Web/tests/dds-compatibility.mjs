import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';
function compile(file, imports = {}) {
  let code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [name, value] of Object.entries(imports)) code = code.replaceAll(`from '${name}'`, `from '${value}'`);
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
}
const rgbaUrl = compile('src/engine/DdsRgba.ts');
const { decodeDxt, reduceRgba } = await import(rgbaUrl);
const url = relative => pathToFileURL(path.resolve(relative)).href;
const { MapDdsLoader } = await import(compile('src/engine/MapDdsLoader.ts', {
  'three': url('node_modules/three/build/three.module.js'),
  'three/examples/jsm/loaders/DDSLoader.js': url('node_modules/three/examples/jsm/loaders/DDSLoader.js'),
  './DdsRgba': rgbaUrl,
}));
const bc1 = new Uint8Array(8);
const color = new DataView(bc1.buffer);
color.setUint16(0, 0xf800, true); color.setUint16(2, 0x001f, true);
color.setUint32(4, 0xe4e4e4e4, true);
const pixels = decodeDxt(bc1, 4, 4, 'DXT1');
assert.deepEqual([...pixels.slice(0, 16)], [255,0,0,255, 0,0,255,255, 170,0,85,255, 85,0,170,255]);
color.setUint16(0, 0, true); color.setUint16(2, 0xffff, true);
assert.deepEqual([...decodeDxt(bc1, 4, 4, 'DXT1').slice(8,16)], [127,127,127,255, 0,0,0,0]);
assert.equal(decodeDxt(bc1, 4, 4, 'DXT1', 1, false)[15], 255, 'RGB BC1 stays opaque');
const bc2 = new Uint8Array(16); bc2.set(bc1,8);
for (let i = 0; i < 8; i++) bc2[i] = (i * 2) | ((i * 2 + 1) << 4);
const decoded2 = decodeDxt(bc2,4,4,'DXT3');
assert.deepEqual(Array.from({length:16},(_,i)=>decoded2[i*4+3]), Array.from({length:16},(_,i)=>i*17));
assert.equal(decoded2[12], 170, 'BC2 always uses four opaque colors, regardless of endpoint order');
const bc3 = new Uint8Array(16); bc3.set(bc1,8);
for (let i = 0; i < 16; i++) {
  const bit = i * 3, n = i % 8;
  bc3[2 + (bit >> 3)] |= n << (bit & 7);
  if ((bit & 7) > 5) bc3[3 + (bit >> 3)] |= n >> (8 - (bit & 7));
}
for (const [a,b,expected] of [[255,0,[255,0,218,182,145,109,72,36]], [0,255,[0,255,51,102,153,204,0,255]]]) {
  bc3[0]=a; bc3[1]=b;
  const decoded = decodeDxt(bc3,4,4,'DXT5');
  assert.deepEqual(Array.from({length:16},(_,i)=>decoded[i*4+3]), [...expected,...expected]);
}
assert.equal(decodeDxt(bc3,3,2,'DXT5').length,24,'Partial edge blocks cropped');
assert.throws(()=>decodeDxt(new Uint8Array(7),4,4,'DXT1'),/DDS/);
assert.deepEqual([...reduceRgba(pixels,4,4,2)], [...decodeDxt(new Uint8Array([0,248,31,0,228,228,228,228]),4,4,'DXT1',2)]);

function dds(width,height,kind='DXT1',mips=1,dx10=false) {
  const payload = [];
  for(let i=0,w=width,h=height;i<mips;i++,w=Math.max(1,w>>1),h=Math.max(1,h>>1))
    payload.push(Math.ceil(w/4)*Math.ceil(h/4)*(kind==='DXT1'?8:16));
  const buffer = new ArrayBuffer((dx10?148:128)+payload.reduce((a,b)=>a+b,0));
  const h = new DataView(buffer);
  for(const [offset,value] of [[0,0x20534444],[4,124],[8,0x21007],[12,height],[16,width],[28,mips],[76,32],[80,4],[84,dx10?0x30315844:kind==='DXT1'?0x31545844:kind==='DXT3'?0x33545844:0x35545844],[108,0x1000]]) h.setUint32(offset,value,true);
  if(dx10){ h.setUint32(128,kind==='DXT1'?72:kind==='DXT3'?75:78,true); h.setUint32(132,3,true); h.setUint32(140,1,true); }
  return buffer;
}
const renderer = (base,srgb,maxTextureSize=4096)=>({extensions:{has:name=>name.endsWith('_srgb')?srgb:base},capabilities:{maxTextureSize}});
const originalFetch = globalThis.fetch;
let fixture = dds(4,4);
globalThis.fetch = async()=>new Response(fixture);
try {
  const desktop = new MapDdsLoader().setRenderer(renderer(true,true));
  const mobile = new MapDdsLoader().setRenderer(renderer(false,false));
  assert.equal((await desktop.loadAsync('/dds')).format,THREE.RGB_S3TC_DXT1_Format,'Desktop keeps compressed GPU path');
  for(const device of [renderer(false,false),renderer(true,false)]) for(const kind of ['DXT1','DXT3','DXT5']) {
    fixture=dds(8,8,kind,4,true);
    const texture=await new MapDdsLoader().setRenderer(device).loadAsync('/dds');
    assert.equal(texture.format,THREE.RGBAFormat);
    assert.equal(texture.mipmaps.length,4);
    for(const mip of texture.mipmaps) assert.equal(mip.data.length,mip.width*mip.height*4);
    texture.dispose();
  }
  fixture=dds(4096,4096,'DXT1',13);
  const mipTexture=await mobile.loadAsync('/dds');
  assert.equal(mipTexture.image.width,2048,'Fallback chooses an existing smaller mip');
  assert.equal(mipTexture.mipmaps.length,12); mipTexture.dispose();
  fixture=dds(16,8,'DXT5');
  const bounded=await new MapDdsLoader().setRenderer(renderer(false,false,4)).loadAsync('/dds');
  assert.equal(bounded.image.width,4); assert.equal(bounded.image.height,2);
  assert.equal(bounded.mipmaps[0].data.length,32); bounded.dispose();
  const boundedDesktop=await new MapDdsLoader().setRenderer(renderer(true,true,4)).loadAsync('/dds');
  assert.equal(boundedDesktop.format,THREE.RGBAFormat,'Oversize compressed image without mips also gets a fallback');
  boundedDesktop.dispose();
  fixture=new ArrayBuffer(128+8*4*4);
  const rawHeader=new DataView(fixture);
  for(const [offset,value] of [[0,0x20534444],[4,124],[8,0x1007],[12,4],[16,8],[28,1],
    [76,32],[80,0x41],[88,32],[92,0xff],[96,0xff00],[100,0xff0000],[104,0xff000000],[108,0x1000]])
    rawHeader.setUint32(offset,value,true);
  const rawPixels=new Uint8Array(fixture,128);
  for(let i=0;i<rawPixels.length;i+=4) rawPixels.set([i/4,50,100,150],i);
  const rawTexture=await new MapDdsLoader().setRenderer(renderer(false,false,4)).loadAsync('/dds');
  assert.equal(rawTexture.image.width,4); assert.equal(rawTexture.image.height,2);
  assert.deepEqual([...rawTexture.mipmaps[0].data.slice(0,8)],[0,50,100,150,2,50,100,150]);
  rawTexture.dispose();
  let realCount=0;
  if(process.argv[2]) {
    const root=process.argv[2], catalog=JSON.parse(fs.readFileSync(path.join(root,'map_catalog.json')));
    // One compressed asset per imported map: exercise the exact files served to mobile browsers.
    for(const map of catalog) {
      const dir=path.join(root,'Processed',map.name,'revisions',map.revision,'textures');
      if(!fs.existsSync(dir)) continue;
      for(const file of fs.readdirSync(dir)) {
        const fd=fs.openSync(path.join(dir,file),'r'), header=Buffer.alloc(128);
        fs.readSync(fd,header,0,128,0); fs.closeSync(fd);
        if(![0x31545844,0x33545844,0x35545844,0x30315844].includes(header.readUInt32LE(84))) continue;
        const bytes=fs.readFileSync(path.join(dir,file));
        fixture=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
        const texture=await mobile.loadAsync('/real');
        assert.equal(texture.format,THREE.RGBAFormat,map.name);
        assert.ok(texture.image.width<=2048 && texture.image.height<=2048,map.name);
        for(const mip of texture.mipmaps) assert.equal(mip.data.length,mip.width*mip.height*4,map.name);
        texture.dispose(); realCount++; break;
      }
    }
    assert.ok(realCount>=36,'Real assets cover all playable maps');
  }
  console.log(`PASS: BC1/2/3 colors/alpha, DX10, missing S3TC/sRGB, desktop path, mip selection, GPU size limits; ${realCount} real map assets.`);
} finally { globalThis.fetch=originalFetch; }
