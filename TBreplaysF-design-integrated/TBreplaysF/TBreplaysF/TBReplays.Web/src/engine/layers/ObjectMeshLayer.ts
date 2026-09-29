import * as THREE from 'three';
import { DDSLoader } from 'three/examples/jsm/loaders/DDSLoader.js';

import type { TBReplaysApi } from '../../api/TBReplaysApi';
import type { MapObjectMeshManifest } from '../../domain/MapModels';

export class ObjectMeshLayer {
  private readonly root: THREE.Group;
  private readonly api: TBReplaysApi;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly ddsLoader = new DDSLoader();

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
  }

  public async load(mapId: string): Promise<void> {
    this.clear();

    const manifest = await this.api.getObjectMeshManifest(mapId);

    if (manifest.vertexCount <= 0 || manifest.indexCount <= 0) {
      return;
    }

    const buffer = await this.api.getObjectMesh(manifest.url);
    const mesh = await this.parseObjectMesh(buffer, manifest);

    this.root.add(mesh);
  }

  public clear(): void {
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
    manifest: MapObjectMeshManifest,
  ): Promise<THREE.Mesh> {
    const view = new DataView(buffer);

    const magic = view.getInt32(0, true);

    if (magic === 0x324A424F) {
      return await this.parseObjectMeshV2(buffer, manifest);
    }

    return this.parseObjectMeshV1(buffer);
  }

  private async parseObjectMeshV2(
    buffer: ArrayBuffer,
    manifest: MapObjectMeshManifest,
  ): Promise<THREE.Mesh> {
    const view = new DataView(buffer);

    const magic = view.getInt32(0, true);
    const version = view.getInt32(4, true);

    if (magic !== 0x324A424F || version !== 2) {
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
      geometry.addGroup(
        group.startIndex,
        group.indexCount,
        group.materialIndex,
      );
    }

    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const materials = await this.createMaterials(manifest);

    const mesh = new THREE.Mesh(geometry, materials);
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
  ): Promise<THREE.Material[]> {
    if (!manifest.materials?.length) {
      return [this.fallbackMaterial];
    }

    const materials: THREE.Material[] = [];

    for (const materialInfo of manifest.materials) {
      if (!materialInfo.textureUrl) {
        materials[materialInfo.index] = this.fallbackMaterial.clone();
        continue;
      }

      try {
        const texture = await this.ddsLoader.loadAsync(
          this.api.createUrl(materialInfo.textureUrl),
        );

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
        });
      } catch (error) {
        console.warn('Не удалось загрузить object texture:', materialInfo, error);
        materials[materialInfo.index] = this.fallbackMaterial.clone();
      }
    }

    for (let i = 0; i < manifest.materials.length; i++) {
      materials[i] ??= this.fallbackMaterial.clone();
    }

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
          this.disposeMaterial(material);
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