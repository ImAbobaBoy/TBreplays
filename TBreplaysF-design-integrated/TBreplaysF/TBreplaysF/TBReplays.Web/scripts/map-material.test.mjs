import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MapDdsLoader } from '../src/engine/MapDdsLoader.ts';
import { landscapeProperty } from '../src/engine/LandscapeSurface.ts';
import { isTacticalDecoration } from '../src/engine/TacticalMapObjects.ts';

const loader = new MapDdsLoader();
const dds = Buffer.alloc(156);
dds.write('DDS '); dds.writeUInt32LE(124, 4); dds.writeUInt32LE(0x100f, 8);
dds.writeUInt32LE(4, 12); dds.writeUInt32LE(4, 16); dds.writeUInt32LE(32, 76);
dds.writeUInt32LE(4, 80); dds.write('DX10', 84); dds.writeUInt32LE(0x1000, 108); dds.writeUInt32LE(71, 128);
dds.writeUInt16LE(0xf800, 148); dds.writeUInt16LE(0x001f, 150);
const arrayBuffer = data => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
const parsed = loader.parse(arrayBuffer(dds));
assert.equal(parsed.width, 4); assert.equal(parsed.height, 4);
assert.deepEqual([...parsed.mipmaps[0].data], [...dds.subarray(148)]);
const fetchOriginal = globalThis.fetch;
try {
  globalThis.fetch = async () => new Response(new Uint8Array(10));
  await assert.rejects(Promise.race([loader.loadAsync('/bad.dds'), new Promise((_, reject) => setTimeout(() => reject(new Error('parse did not settle')), 500))]), /Повреждён заголовок DDS/);
} finally { globalThis.fetch = fetchOriginal; }
assert.deepEqual(landscapeProperty({ textureTiling: 'AQEAAAAAACBCAAAgQg==' }, 'textureTiling', [1, 1]), [40, 40]);
assert.throws(() => landscapeProperty({ textureTiling: 'AA==' }, 'textureTiling', [1, 1]), /Некорректный/);
for (const name of ['invisiblewall.sc2', 'floor_invis_wall_01', 'vst_mountain_07', 'env_mars_dome_glass_001', 'env_mars_roof']) assert.equal(isTacticalDecoration(name), true, name);
for (const name of ['env_lm_wall_01.sc2', 'env_mars_dome_wall_01', 'env_mars_dome_floor.sc2', 'env_mars_dome_gate_one', 'env_mars_main_dome_support']) assert.equal(isTacticalDecoration(name), false, name);

if (process.argv[2]) {
  const root = process.argv[2];
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'map_catalog.json'), 'utf8'));
  let count = 0;
  for (const entry of catalog) {
    assert.equal(entry.pipelineVersion, 5, entry.name);
    const revision = path.join(root, 'Processed', entry.name, 'revisions', entry.revision);
    const mesh = JSON.parse(fs.readFileSync(path.join(revision, 'objects_mesh_manifest.json'), 'utf8'));
    const surface = JSON.parse(fs.readFileSync(path.join(revision, 'surface_manifest.json'), 'utf8'));
    const used = new Set([...mesh.materials.map(material => material.textureUrl),
      ...surface.textures.filter(texture => ['colorTexture', 'tileTexture0', 'tileMask', 'tileMaskHeightBlend', 'tileHeightTexture'].includes(texture.role)).map(texture => texture.url)].filter(Boolean).map(url => url.split('/').at(-1)));
    for (const filename of used) {
      const image = loader.parse(arrayBuffer(fs.readFileSync(path.join(revision, 'textures', filename))));
      assert.ok(image.width > 0 && image.height > 0 && image.mipmaps.length > 0, `${entry.name}/${filename}`);
      count++;
    }
  }
  console.log(`PASS: ${catalog.length} pipeline-v5 maps, ${count} exported DDS textures parsed.`);
}
console.log('PASS: DX10 BC1 legacy headers, parse rejection settles, Landscape property decoding.');
