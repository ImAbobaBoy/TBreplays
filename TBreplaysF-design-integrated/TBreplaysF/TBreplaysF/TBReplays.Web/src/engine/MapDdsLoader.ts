import { DDSLoader } from 'three/examples/jsm/loaders/DDSLoader.js';
import * as THREE from 'three';

/** Accept both packed RGBA and BGRA DDS without passing invalid textures to WebGL. */
export class MapDdsLoader extends DDSLoader {
  // Parsing inside Three's load callback can throw without rejecting loadAsync.
  // Keep parsing inside this async function so every request always settles.
  public override async loadAsync(url: string): Promise<THREE.CompressedTexture> {
    const response = await fetch(this.path + url, {
      credentials: this.withCredentials ? 'include' : 'same-origin',
      headers: this.requestHeader,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`DDS HTTP ${response.status}: ${url}`);
    const parsed = this.parse(await response.arrayBuffer());
    const texture = new THREE.CompressedTexture(parsed.mipmaps, parsed.width, parsed.height);
    // Three's DDS loader also uses CompressedTexture for uncompressed RGBA DDS.
    texture.format = parsed.format as THREE.CompressedPixelFormat;
    texture.minFilter = parsed.mipmapCount > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  public override parse(buffer: ArrayBuffer, loadMipmaps = true) {
    if (buffer.byteLength < 128) throw new Error('Повреждён заголовок DDS');
    const header = new DataView(buffer);
    let normalized = buffer;
    if (header.getUint32(84, true) === 0x30315844) {
      if (buffer.byteLength < 148) throw new Error('Повреждён заголовок DDS DX10');
      const dxgi = header.getUint32(128, true);
      const fourCC = ({ 71: 0x31545844, 72: 0x31545844, 74: 0x33545844,
        75: 0x33545844, 77: 0x35545844, 78: 0x35545844 } as Record<number, number>)[dxgi];
      // DAVA's legacy DX10 writer leaves dimension/array fields zero for single 2D images.
      if (!fourCC || ![0, 3].includes(header.getUint32(132, true)) || ![0, 1].includes(header.getUint32(140, true))
        || (header.getUint32(136, true) & 4)) throw new Error(`Неподдерживаемый DDS DX10: ${dxgi}`);
      // BC1/2/3 have the same block layout as DXT1/3/5; remove the DX10 extension.
      const bytes = new Uint8Array(buffer.byteLength - 20);
      bytes.set(new Uint8Array(buffer, 0, 128));
      bytes.set(new Uint8Array(buffer, 148), 128);
      new DataView(bytes.buffer).setUint32(84, fourCC, true);
      normalized = bytes.buffer;
    }
    if (header.getUint32(0, true) === 0x20534444 && header.getUint32(84, true) === 0
      && header.getUint32(88, true) === 32 && header.getUint32(92, true) === 0xff
      && header.getUint32(96, true) === 0xff00 && header.getUint32(100, true) === 0xff0000
      && header.getUint32(104, true) === 0xff000000) {
      normalized = buffer.slice(0);
      const bytes = new Uint8Array(normalized);
      const offset = header.getUint32(4, true) + 4;
      if (offset < 128 || offset > bytes.length || (bytes.length - offset) % 4) throw new Error('Повреждён payload DDS');
      for (let i = offset; i < bytes.length; i += 4) { const red = bytes[i]; bytes[i] = bytes[i + 2]; bytes[i + 2] = red; }
      const target = new DataView(normalized);
      target.setUint32(92, 0xff0000, true); target.setUint32(100, 0xff, true);
    }
    const result = super.parse(normalized, loadMipmaps);
    if (!result.width || !result.height || !result.format || !result.mipmaps.length)
      throw new Error('Неподдерживаемый формат DDS; текстура не будет передана в WebGL');
    return result;
  }
}
