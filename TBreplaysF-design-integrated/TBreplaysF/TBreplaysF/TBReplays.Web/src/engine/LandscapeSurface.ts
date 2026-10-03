import * as THREE from 'three';
import type { MapSurfaceManifest } from '../domain/MapModels';

/** SC2 material property payload: type byte, element count UInt32, then float values. */
export function landscapeProperty(properties: Record<string, string>, name: string, fallback: number[]): number[] {
  const encoded = properties?.[name];
  if (!encoded) return fallback;
  const bytes = Uint8Array.from(atob(encoded), ch => ch.charCodeAt(0));
  if (bytes.length !== 5 + fallback.length * 4) throw new Error(`Некорректный Landscape.${name}`);
  const view = new DataView(bytes.buffer);
  const values = fallback.map((_, i) => view.getFloat32(5 + i * 4, true));
  if (!values.every(Number.isFinite)) throw new Error(`Некорректный Landscape.${name}`);
  return values;
}

/** Reproduce the game's non-PBR tilemask path, independent of camera/light direction. */
export function bakeLandscape(renderer: THREE.WebGLRenderer, surface: MapSurfaceManifest,
  textures: Record<string, THREE.Texture>): THREE.WebGLRenderTarget {
  const p = surface.properties;
  const property = (name: string, fallback: number[]) => landscapeProperty(p, name, fallback);
  const heightBlend = !!surface.flags?.LANDSCAPE_HEIGHT_BLEND;
  if (heightBlend && (!textures.tileMaskHeightBlend || !textures.tileHeightTexture))
    throw new Error('Landscape height blending требует mask и height texture');
  const uniforms: Record<string, THREE.IUniform> = {
    colorMap: { value: textures.colorTexture }, tiles: { value: textures.tileTexture0 },
    maskMap: { value: heightBlend ? textures.tileMaskHeightBlend : textures.tileMask },
    heightMap: { value: textures.tileHeightTexture ?? textures.tileTexture0 },
    tiling: { value: new THREE.Vector2(...property('textureTiling', [50, 50])) },
    scaled: { value: !!surface.flags?.LANDSCAPE_SCALED_TILES_NON_PBR },
    heightBlend: { value: heightBlend }, separateLightmap: { value: !!surface.flags?.LANDSCAPE_SEPARATE_LIGHTMAP_CHANNEL },
    scales: { value: new THREE.Vector4(...[0, 1, 2, 3].map(i => property(`tileScale${i}`, [1])[0])) },
    heightScale: { value: new THREE.Vector4(...property('heightMapScaleColor', [1, 1, 1, 1])) },
    heightOffset: { value: new THREE.Vector4(...property('heightMapOffsetColor', [0, 0, 0, 0])) },
    softness: { value: new THREE.Vector4(...property('heightMapSoftnessColor', [0.1, 0.1, 0.1, 0.1])) },
    maskWeight: { value: property('tilemaskWeight', [0.15])[0] },
  };
  for (let i = 0; i < 4; i++) uniforms[`tileColor${i}`] = { value: new THREE.Vector3(...property(`tileColor${i}`, [1, 1, 1])) };
  const material = new THREE.ShaderMaterial({ uniforms, depthTest: false, depthWrite: false,
    // tilemask-vp.sl maps landscape sample Y to 1-relativePosition.y.
    vertexShader: 'varying vec2 uvMap; void main(){uvMap=vec2(uv.x,1.0-uv.y);gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: `
      varying vec2 uvMap;
      uniform sampler2D colorMap, tiles, maskMap, heightMap;
      uniform vec2 tiling;
      uniform vec4 scales, heightScale, heightOffset, softness;
      uniform vec3 tileColor0, tileColor1, tileColor2, tileColor3;
      uniform bool scaled, heightBlend, separateLightmap;
      uniform float maskWeight;
      vec4 fetchChannels(sampler2D image, vec2 uvTile) {
        if (!scaled) return texture2D(image, uvTile);
        return vec4(texture2D(image, uvTile*scales.x).r, texture2D(image, uvTile*scales.y).g,
                    texture2D(image, uvTile*scales.z).b, texture2D(image, uvTile*scales.w).a);
      }
      void main(){
        vec4 mask=texture2D(maskMap,uvMap);
        vec4 tile=fetchChannels(tiles,uvMap*tiling);
        vec4 weights=mask;
        if(heightBlend){
          vec4 h=clamp(maskWeight*(mask*2.0-1.0)+fetchChannels(heightMap,uvMap*tiling)*heightScale+heightOffset,0.0,1.0);
          float peak=max(max(h.x,h.y),max(h.z,h.w));
          weights=max(h-(vec4(peak)-softness),vec4(0.001));
          weights/=dot(weights,vec4(1.0));
        }
        vec4 color=texture2D(colorMap,uvMap);
        vec3 result=(tile.r*weights.r*tileColor0+tile.g*weights.g*tileColor1+
                     tile.b*weights.b*tileColor2+tile.a*weights.a*tileColor3)*color.rgb*2.0;
        if(separateLightmap)result*=color.a;
        result=clamp(result,0.0,1.0);
        // Inputs and the legacy shader operate in encoded RGB. Store the result in linear space.
        vec3 linear=mix(result/12.92,pow((result+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),result));
        gl_FragColor=vec4(linear,1.0);
      }`,
  });
  const target = new THREE.WebGLRenderTarget(Math.min(2048, renderer.capabilities.maxTextureSize), Math.min(2048, renderer.capabilities.maxTextureSize), {
    depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter,
  });
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(2, 2);
  const scene = new THREE.Scene(); scene.add(new THREE.Mesh(geometry, material));
  const previous = renderer.getRenderTarget(), viewport = renderer.getViewport(new THREE.Vector4());
  const scissor = renderer.getScissor(new THREE.Vector4()), scissorTest = renderer.getScissorTest();
  try { renderer.setRenderTarget(target); renderer.setScissorTest(false); renderer.render(scene, new THREE.Camera()); }
  catch (error) { target.dispose(); throw error; }
  finally { renderer.setRenderTarget(previous); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest); material.dispose(); geometry.dispose(); }
  return target;
}
