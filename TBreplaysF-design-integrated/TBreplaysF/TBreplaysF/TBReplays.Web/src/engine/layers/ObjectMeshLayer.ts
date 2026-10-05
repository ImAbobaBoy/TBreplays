import * as THREE from 'three';
import { MapDdsLoader } from '../MapDdsLoader';
import { isTacticalDecoration } from '../TacticalMapObjects';

import type { TBReplaysApi } from '../../api/TBReplaysApi';
import type { MapObjectMeshManifest, MapObjectMeshMaterial } from '../../domain/MapModels';

export class ObjectMeshLayer {
  private generation = 0;
  private readonly root: THREE.Group;
  private readonly api: TBReplaysApi;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly ddsLoader = new MapDdsLoader().setWithCredentials(true);
  private clippingPlanes: THREE.Plane[] = [];
  private gameplayBounds: THREE.Box3 | null = null;
  private excludedRanges: Array<{ startIndex: number; indexCount: number }> = [];

  private readonly fallbackMaterial = new THREE.MeshStandardMaterial({
    color: 0xb08968,
    roughness: 0.88,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  public constructor(
    root: THREE.Group,
    api: TBReplaysApi,
    renderer: THREE.WebGLRenderer,
  ) {
    this.root = root;
    this.api = api;
    this.renderer = renderer;
    this.ddsLoader.setRenderer(renderer);
  }

  public async load(mapId: string, gameplayBounds: THREE.Box3): Promise<void> {
    this.clear();
    const generation = this.generation;
    this.gameplayBounds = gameplayBounds.clone();
    this.clippingPlanes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -gameplayBounds.min.x),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), gameplayBounds.max.x),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -gameplayBounds.min.z),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), gameplayBounds.max.z),
    ];
    this.renderer.localClippingEnabled = true;

    const manifest = await this.api.getObjectMeshManifest(mapId);
    if (generation !== this.generation) return;
    this.excludedRanges = (manifest.instances ?? []).filter(instance => isTacticalDecoration(instance.name));
    if (manifest.vertexCount <= 0 || manifest.indexCount <= 0) {
      return;
    }

    const buffer = await this.api.getObjectMesh(manifest.url);
    if (generation !== this.generation) return;
    const mesh = await this.parseObjectMesh(buffer);
    if (generation !== this.generation) { this.disposeObject(mesh); return; }

    this.root.add(mesh);
    if (new DataView(buffer).getInt32(0, true) === 0x324A424F) {
      const usedMaterials = new Set(mesh.geometry.groups.map(group => group.materialIndex));
      const materials = await this.createMaterials({ ...manifest, materials: manifest.materials?.filter(material => usedMaterials.has(material.index)) }, generation);
      if (generation !== this.generation) { for (const material of materials) if (material) this.disposeMaterial(material); return; }
      if (Array.isArray(mesh.material)) mesh.material.forEach(m => this.disposeMaterial(m));
      else if (mesh.material !== this.fallbackMaterial) this.disposeMaterial(mesh.material);
      mesh.material = materials;
    }
  }

  public clear(): void {
    this.generation++;
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      this.disposeObject(child);
    }
  }

  public dispose(): void {
    this.clear();
    this.fallbackMaterial.dispose();
  }

  private async parseObjectMesh(
    buffer: ArrayBuffer,
  ): Promise<THREE.Mesh> {
    const view = new DataView(buffer);

    const magic = view.getInt32(0, true);

    if (magic === 0x324A424F) {
      return await this.parseObjectMeshV2(buffer);
    }

    return this.parseObjectMeshV1(buffer);
  }

  private async parseObjectMeshV2(
    buffer: ArrayBuffer,
  ): Promise<THREE.Mesh> {
    const view = new DataView(buffer);

    const magic = view.getInt32(0, true);
    const version = view.getInt32(4, true);

    if (magic !== 0x324A424F || (version !== 2 && version !== 3)) {
      throw new Error(`Некорректный objects_mesh.bin. magic=${magic}, version=${version}`);
    }

    const vertexCount = view.getInt32(8, true);
    const indexCount = view.getInt32(12, true);
    const groupCount = view.getInt32(16, true);

    let offset = 20;

    const groups: Array<{
      startIndex: number;
      indexCount: number;
      materialIndex: number;
    }> = [];

    for (let i = 0; i < groupCount; i++) {
      groups.push({
        startIndex: view.getInt32(offset, true),
        indexCount: view.getInt32(offset + 4, true),
        materialIndex: view.getInt32(offset + 8, true),
      });

      offset += 12;
    }

    const positions = new Float32Array(buffer, offset, vertexCount * 3);
    offset += vertexCount * 3 * 4;

    const uvs = new Float32Array(buffer, offset, vertexCount * 2);
    offset += vertexCount * 2 * 4;

    const normals = version === 3 ? new Float32Array(buffer, offset, vertexCount * 3) : null;
    if (normals) offset += vertexCount * 3 * 4;
    const indices = new Uint32Array(buffer, offset, indexCount);
    offset += indexCount * 4;

    if (offset !== buffer.byteLength) {
      throw new Error(
        `Некорректный objects_mesh.bin размер. Ожидали ${offset}, получили ${buffer.byteLength}`,
      );
    }

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3),
    );

    geometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(uvs, 2),
    );

    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    for (const group of groups) {
      if (this.excludedRanges.some(range => group.startIndex >= range.startIndex
        && group.startIndex < range.startIndex + range.indexCount)) continue;
      const box = this.gameplayBounds;
      if (box) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (let i = group.startIndex; i < group.startIndex + group.indexCount; i++) {
          const vertex = indices[i] * 3;
          minX = Math.min(minX, positions[vertex]); maxX = Math.max(maxX, positions[vertex]);
          minZ = Math.min(minZ, positions[vertex + 2]); maxZ = Math.max(maxZ, positions[vertex + 2]);
        }
        if (maxX < box.min.x || minX > box.max.x || maxZ < box.min.z || minZ > box.max.z) continue;
      }
      geometry.addGroup(
        group.startIndex,
        group.indexCount,
        group.materialIndex,
      );
    }

    if (normals) geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    else geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const initialMaterials: THREE.Material[] = [];
    for (const group of geometry.groups) {
      const index = group.materialIndex ?? 0;
      if (!initialMaterials[index]) {
        initialMaterials[index] = this.fallbackMaterial.clone();
        initialMaterials[index].clippingPlanes = this.clippingPlanes;
      }
    }
    const mesh = new THREE.Mesh(geometry, initialMaterials);
    mesh.name = 'real_map_objects_mesh_v2';

    return mesh;
  }

  private parseObjectMeshV1(buffer: ArrayBuffer): THREE.Mesh {
    const view = new DataView(buffer);

    const vertexCount = view.getInt32(0, true);
    const indexCount = view.getInt32(4, true);

    if (vertexCount <= 0 || indexCount <= 0) {
      throw new Error(`Некорректный old objects mesh: vertices=${vertexCount}, indices=${indexCount}`);
    }

    const headerSize = 8;
    const positionsOffset = headerSize;
    const positionsByteLength = vertexCount * 3 * 4;
    const indicesOffset = positionsOffset + positionsByteLength;
    const indicesByteLength = indexCount * 4;

    const expectedLength = headerSize + positionsByteLength + indicesByteLength;

    if (buffer.byteLength !== expectedLength) {
      throw new Error(
        `Некорректный old objects_mesh.bin. Ожидалось ${expectedLength}, получено ${buffer.byteLength}.`,
      );
    }

    const positions = new Float32Array(buffer, positionsOffset, vertexCount * 3);
    const indices = new Uint32Array(buffer, indicesOffset, indexCount);

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3),
    );

    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.fallbackMaterial);
    mesh.name = 'real_map_objects_mesh_v1';

    return mesh;
  }

  private async createMaterials(
    manifest: MapObjectMeshManifest,
    generation: number,
  ): Promise<THREE.Material[]> {
    if (!manifest.materials?.length) {
      return [this.fallbackMaterial];
    }

    const materials: THREE.Material[] = [];

    const textures = new Map<string, Promise<THREE.CompressedTexture>>();
    const create = async (materialInfo: MapObjectMeshMaterial) => {
      if (!materialInfo.textureUrl) {
        materials[materialInfo.index] = this.fallbackMaterial.clone();
        materials[materialInfo.index].clippingPlanes = this.clippingPlanes;
        return;
      }

      try {
        const url = this.api.createUrl(materialInfo.textureUrl);
        let pending = textures.get(url);
        if (!pending) { pending = this.ddsLoader.loadAsync(url); textures.set(url, pending); }
        const texture = await pending;

        if (generation !== this.generation) { texture.dispose(); return; }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

        materials[materialInfo.index] = new THREE.MeshStandardMaterial({
          map: texture,
          color: 0xffffff,
          roughness: 0.9,
          metalness: 0.0,
          side: THREE.DoubleSide,
          clippingPlanes: this.clippingPlanes,
          alphaTest: 0.05,
        });
      } catch (error) {
        console.warn('Не удалось загрузить object texture:', materialInfo, error);
        materials[materialInfo.index] = this.fallbackMaterial.clone();
        materials[materialInfo.index].clippingPlanes = this.clippingPlanes;
      }
    };
    const infos = manifest.materials;
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, infos.length) }, async () => {
      while (next < infos.length && generation === this.generation) await create(infos[next++]);
    }));

    if (generation !== this.generation) return materials.filter(Boolean);
    return materials;
  }

  private disposeObject(object: THREE.Object3D): void {
    for (const child of object.children) {
      this.disposeObject(child);
    }

    if (
      object instanceof THREE.Mesh ||
      object instanceof THREE.Line ||
      object instanceof THREE.LineSegments
    ) {
      object.geometry.dispose();

      if (Array.isArray(object.material)) {
        for (const material of object.material) {
          if (material) this.disposeMaterial(material);
        }
      } else {
        this.disposeMaterial(object.material);
      }
    }
  }

  private disposeMaterial(material: THREE.Material): void {
    const maybeMaterial = material as THREE.Material & {
      map?: THREE.Texture | null;
    };

    if (maybeMaterial.map) {
      maybeMaterial.map.dispose();
    }

    material.dispose();
  }
}
