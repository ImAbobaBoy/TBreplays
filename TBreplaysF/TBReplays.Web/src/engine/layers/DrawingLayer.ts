import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { ViewerTool } from '../../app/AppState';

export class DrawingLayer {
  private readonly root: THREE.Group;
  private readonly terrainRoot: THREE.Group;
  private readonly camera: THREE.Camera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();

  private tool: ViewerTool = 'select';
  private color = '#ffff00';

  private activeLine: THREE.Line | null = null;
  private activePoints: THREE.Vector3[] = [];
  private isDrawing = false;
  private enabled = true;

  public constructor(
    root: THREE.Group,
    terrainRoot: THREE.Group,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    controls: OrbitControls,
  ) {
    this.root = root;
    this.terrainRoot = terrainRoot;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;

    this.raycaster.params.Line = {
      threshold: 3,
    };

    this.renderer.domElement.addEventListener(
      'pointerdown',
      this.handlePointerDown,
      true,
    );

    window.addEventListener(
      'pointermove',
      this.handlePointerMove,
      true,
    );

    window.addEventListener(
      'pointerup',
      this.handlePointerUp,
      true,
    );
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;

    if (!enabled) {
      this.cancelActiveStroke();
    }
  }

  public setTool(tool: ViewerTool): void {
    this.tool = tool;

    if (tool !== 'draw') {
      this.cancelActiveStroke();
    }
  }

  public setColor(color: string): void {
    this.color = color;
  }

  public clear(): void {
    this.cancelActiveStroke();

    for (const child of [...this.root.children]) {
      this.root.remove(child);
      this.disposeObject(child);
    }
  }

  public dispose(): void {
    this.clear();

    this.renderer.domElement.removeEventListener(
      'pointerdown',
      this.handlePointerDown,
      true,
    );

    window.removeEventListener(
      'pointermove',
      this.handlePointerMove,
      true,
    );

    window.removeEventListener(
      'pointerup',
      this.handlePointerUp,
      true,
    );
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0) {
      return;
    }

    if (this.tool === 'draw') {
      this.stopViewerEvent(event);
      this.startStroke(event);
      return;
    }

    if (this.tool === 'erase') {
      this.stopViewerEvent(event);
      this.eraseStroke(event);
    }
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.isDrawing || this.tool !== 'draw') {
      return;
    }

    this.stopViewerEvent(event);
    this.addPointToStroke(event);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.isDrawing) {
      return;
    }

    this.stopViewerEvent(event);
    this.finishStroke();
  };

  private startStroke(event: PointerEvent): void {
    const point = this.pickTerrainPoint(event);

    if (!point) {
      return;
    }

    this.controls.enabled = false;
    this.isDrawing = true;
    this.activePoints = [point];

    const geometry = new THREE.BufferGeometry().setFromPoints(this.activePoints);
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(this.color),
      depthTest: false,
      depthWrite: false,
    });

    const line = new THREE.Line(geometry, material);
    line.name = 'drawing_stroke';
    line.renderOrder = 1000;
    line.userData.kind = 'drawingStroke';

    this.activeLine = line;
    this.root.add(line);
  }

  private addPointToStroke(event: PointerEvent): void {
    const point = this.pickTerrainPoint(event);

    if (!point) {
      return;
    }

    const previousPoint = this.activePoints[this.activePoints.length - 1];

    if (previousPoint && previousPoint.distanceTo(point) < 1.25) {
      return;
    }

    this.activePoints.push(point);
    this.rebuildActiveLineGeometry();
  }

  private finishStroke(): void {
    if (this.activeLine && this.activePoints.length < 2) {
      this.root.remove(this.activeLine);
      this.disposeObject(this.activeLine);
    }

    this.activeLine = null;
    this.activePoints = [];
    this.isDrawing = false;
    this.controls.enabled = true;
  }

  private cancelActiveStroke(): void {
    if (!this.activeLine) {
      this.activePoints = [];
      this.isDrawing = false;
      this.controls.enabled = true;
      return;
    }

    this.root.remove(this.activeLine);
    this.disposeObject(this.activeLine);

    this.activeLine = null;
    this.activePoints = [];
    this.isDrawing = false;
    this.controls.enabled = true;
  }

  private rebuildActiveLineGeometry(): void {
    if (!this.activeLine) {
      return;
    }

    this.activeLine.geometry.dispose();
    this.activeLine.geometry = new THREE.BufferGeometry().setFromPoints(this.activePoints);
  }

  private eraseStroke(event: PointerEvent): void {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const intersections = this.raycaster.intersectObjects(this.root.children, true);
    const intersection = intersections.find((item) => {
      return item.object.userData.kind === 'drawingStroke';
    });

    if (!intersection) {
      return;
    }

    const stroke = intersection.object;
    this.root.remove(stroke);
    this.disposeObject(stroke);
  }

  private pickTerrainPoint(event: PointerEvent): THREE.Vector3 | null {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const intersections = this.raycaster.intersectObjects(this.terrainRoot.children, true);

    if (intersections.length === 0) {
      return null;
    }

    const point = intersections[0].point.clone();
    point.y += 0.35;

    return point;
  }

  private updatePointer(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();

    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private stopViewerEvent(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  private disposeObject(object: THREE.Object3D): void {
    for (const child of object.children) {
      this.disposeObject(child);
    }

    if (
      object instanceof THREE.Line ||
      object instanceof THREE.LineSegments ||
      object instanceof THREE.Mesh
    ) {
      object.geometry.dispose();

      if (Array.isArray(object.material)) {
        for (const material of object.material) {
          material.dispose();
        }
      } else {
        object.material.dispose();
      }
    }
  }
}