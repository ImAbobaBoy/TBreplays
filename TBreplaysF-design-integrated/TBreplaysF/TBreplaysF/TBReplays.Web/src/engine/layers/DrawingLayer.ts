import { createId } from '../../utils/createId';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type {
  DrawingArrowMode,
  DrawingLineStyle,
  ViewerTool,
} from '../../app/AppState';
import type { DrawingStrokeModel } from '../../domain/DrawingModels';

export class DrawingLayer {
  private readonly root: THREE.Group;
  private readonly terrainRoot: THREE.Group;
  private readonly camera: THREE.Camera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly cylinderAxis = new THREE.Vector3(0, 1, 0);

  private tool: ViewerTool = 'select';
  private color = '#ffff00';
  private width = 4;
  private lineStyle: DrawingLineStyle = 'solid';
  private arrowMode: DrawingArrowMode = 'none';

  private activeStroke: THREE.Group | null = null;
  private activePoints: THREE.Vector3[] = [];
  private isDrawing = false;
  private enabled = true;
  private onlineHandlers: { upsert: (stroke: DrawingStrokeModel) => void; remove: (id: string) => void } | null = null;
  public setOnlineHandlers(handlers: typeof this.onlineHandlers): void { this.onlineHandlers = handlers; }


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

    if (tool !== 'draw' && tool !== 'drawLine') {
      this.cancelActiveStroke();
    }
  }

  public setColor(color: string): void {
    this.color = color;
  }

  public setWidth(width: number): void {
    this.width = THREE.MathUtils.clamp(width, 1, 16);
  }

  public setLineStyle(lineStyle: DrawingLineStyle): void {
    this.lineStyle = lineStyle;
  }

  public setArrowMode(arrowMode: DrawingArrowMode): void {
    this.arrowMode = arrowMode;
  }

  public getStrokes(): DrawingStrokeModel[] {
    return this.root.children
      .filter((child): child is THREE.Group => {
        return child instanceof THREE.Group && child.userData.kind === 'drawingStroke';
      })
      .map((stroke): DrawingStrokeModel => ({
        id: typeof stroke.userData.id === 'string'
          ? stroke.userData.id
          : stroke.uuid,
        color: typeof stroke.userData.color === 'string'
          ? stroke.userData.color
          : '#ffff00',
        width: typeof stroke.userData.width === 'number'
          ? stroke.userData.width
          : 4,
        style: stroke.userData.lineStyle === 'dashed'
          ? 'dashed'
          : 'solid',
        arrowMode: stroke.userData.arrowMode === 'end'
          ? 'end'
          : stroke.userData.arrowMode === 'dot'
            ? 'dot'
            : 'none',
        points: Array.isArray(stroke.userData.points)
          ? stroke.userData.points.map((point: { x: number; y: number; z: number }) => ({
            x: point.x,
            y: point.y,
            z: point.z,
          }))
          : [],
      }))
      .filter((stroke) => stroke.points.length >= 2);
  }

  public setStrokes(strokes: DrawingStrokeModel[]): void {
    this.clear();
    this.syncStrokes(strokes);
  }

  public syncStrokes(strokes: DrawingStrokeModel[]): void {
    const incoming = new Map(strokes.map(stroke => [stroke.id, stroke]));
    for (const child of [...this.root.children]) {
      if (child === this.activeStroke) continue;
      const stroke = incoming.get(child.userData.id);
      if (stroke && child.userData.onlineJson === JSON.stringify(stroke)) { incoming.delete(stroke.id); continue; }
      this.root.remove(child);
      this.disposeObject(child);
    }
    for (const stroke of incoming.values()) {
      const points = stroke.points.map((point) => {
        return new THREE.Vector3(point.x, point.y, point.z);
      });

      if (points.length < 2) {
        continue;
      }

      const group = new THREE.Group();
      group.name = 'drawing_stroke';
      group.renderOrder = 1000;
      group.userData.kind = 'drawingStroke';
      group.userData.id = stroke.id || createId();
      group.userData.onlineJson = JSON.stringify(stroke);
      group.userData.color = stroke.color;
      group.userData.width = stroke.width;
      group.userData.lineStyle = stroke.style;
      group.userData.arrowMode = stroke.arrowMode;

      // TODO: Временное MVP-решение.
      // Сейчас slide-local strokes восстанавливаются обратно в THREE.userData, чтобы переключение Slides не тащило полноценную модель стратегии.
      // Потом заменить на общий StrategyDocument/тактическую модель в map-space-v1 с backend persistence.
      // Убрать восстановление через THREE.userData, когда появится persistence стратегического разбора.
      group.userData.points = points.map((point) => ({
        x: point.x,
        y: point.y,
        z: point.z,
      }));

      this.root.add(group);
      this.rebuildStrokeGeometry(group, points);
    }
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

    if (this.tool === 'draw' || this.tool === 'drawLine') {
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
    if (!this.isDrawing || (this.tool !== 'draw' && this.tool !== 'drawLine')) {
      return;
    }

    this.stopViewerEvent(event);

    if (this.tool === 'drawLine') {
      this.updateLineStroke(event);
      return;
    }

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

    const stroke = new THREE.Group();
    stroke.name = 'drawing_stroke';
    stroke.renderOrder = 1000;
    stroke.userData.kind = 'drawingStroke';
    stroke.userData.id = createId();
    stroke.userData.color = this.color;
    stroke.userData.width = this.width;
    stroke.userData.lineStyle = this.lineStyle;
    stroke.userData.arrowMode = this.arrowMode;

    this.activeStroke = stroke;
    this.root.add(stroke);
    this.rebuildActiveStrokeGeometry();
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

    if (this.activePoints.length >= 4096) return;
    this.activePoints.push(point);
    this.rebuildActiveStrokeGeometry();
  }

  private updateLineStroke(event: PointerEvent): void {
    const point = this.pickTerrainPoint(event);

    if (!point || this.activePoints.length === 0) {
      return;
    }

    this.activePoints = [
      this.activePoints[0],
      point,
    ];

    this.rebuildActiveStrokeGeometry();
  }

  private finishStroke(): void {
    if (this.activeStroke && this.activePoints.length < 2) {
      this.root.remove(this.activeStroke);
      this.disposeObject(this.activeStroke);
    }

    if (this.activeStroke && this.activePoints.length >= 2) {
      // TODO: Временное MVP-решение.
      // Сейчас точки ручной линии дублируются в userData, чтобы PNG-экспорт мог прочитать stroke без полноценной модели тактики.
      // Потом заменить на общий StrategyDocument/тактическую модель в map-space-v1, из которой будут строиться viewer, PNG и backend-сохранение.
      // Убрать хранение points в THREE.userData, когда появится persistence стратегического разбора.
      this.activeStroke.userData.points = this.activePoints.map((point) => ({
        x: point.x,
        y: point.y,
        z: point.z,
      }));
    }

    const completedId = this.activeStroke?.userData.id as string | undefined;
    const completed = this.getStrokes().find(stroke => stroke.id === completedId);
    this.activeStroke = null;
    this.activePoints = [];
    this.isDrawing = false;
    this.controls.enabled = true;
    if (completed) this.onlineHandlers?.upsert(completed);
  }

  private cancelActiveStroke(): void {
    if (!this.activeStroke) {
      this.activePoints = [];
      this.isDrawing = false;
      this.controls.enabled = true;
      return;
    }

    this.root.remove(this.activeStroke);
    this.disposeObject(this.activeStroke);

    this.activeStroke = null;
    this.activePoints = [];
    this.isDrawing = false;
    this.controls.enabled = true;
  }

  private rebuildActiveStrokeGeometry(): void {
    if (!this.activeStroke) {
      return;
    }

    this.rebuildStrokeGeometry(this.activeStroke, this.activePoints);
  }

  private rebuildStrokeGeometry(
    stroke: THREE.Group,
    points: THREE.Vector3[],
  ): void {
    for (const child of [...stroke.children]) {
      stroke.remove(child);
      this.disposeObject(child);
    }

    if (points.length < 2) {
      return;
    }

    // TODO: Временное MVP-решение.
    // Сейчас линии рисуются как набор THREE.Mesh-сегментов в viewer-world coordinates.
    // Потом заменить на отдельную модель тактической разметки в map-space-v1 + экспорт/импорт.
    // Убрать, когда появится backend-сохранение стратегического разбора.
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(stroke.userData.color as string),
      depthTest: false,
      depthWrite: false,
    });

    const width = stroke.userData.width as number;
    const radius = this.getStrokeRadius(width);
    const lineStyle = stroke.userData.lineStyle as DrawingLineStyle;
    const arrowMode = stroke.userData.arrowMode as DrawingArrowMode;
    const chunks = lineStyle === 'dashed'
      ? this.createDashedChunks(points, width)
      : [points.map((point) => point.clone())];

    for (const chunk of chunks) {
      this.addChunkMeshes(stroke, chunk, material, radius);
    }

    if (arrowMode === 'dot') {
      const dot = this.createEndpointDotMesh(points, material, radius, width);

      if (dot) {
        stroke.add(dot);
      }
    }

    if (arrowMode === 'end') {
      const arrow = this.createArrowMesh(points, material, radius, width);

      if (arrow) {
        stroke.add(arrow);
      }
    }
  }

  private addChunkMeshes(
    stroke: THREE.Group,
    points: THREE.Vector3[],
    material: THREE.Material,
    radius: number,
  ): void {
    if (points.length < 2) {
      return;
    }

    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      const segment = this.createSegmentMesh(start, end, material, radius);

      if (segment) {
        stroke.add(segment);
      }
    }

    const jointGeometry = new THREE.SphereGeometry(radius, 8, 6);

    for (const point of points) {
      const joint = new THREE.Mesh(jointGeometry, material);
      joint.position.copy(point);
      joint.renderOrder = 1000;
      joint.userData.kind = 'drawingStrokePart';
      stroke.add(joint);
    }
  }

  private createSegmentMesh(
    start: THREE.Vector3,
    end: THREE.Vector3,
    material: THREE.Material,
    radius: number,
  ): THREE.Mesh | null {
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();

    if (length < 0.001) {
      return null;
    }

    direction.normalize();

    const geometry = new THREE.CylinderGeometry(radius, radius, length, 8, 1, true);
    const mesh = new THREE.Mesh(geometry, material);

    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(this.cylinderAxis, direction);
    mesh.renderOrder = 1000;
    mesh.userData.kind = 'drawingStrokePart';

    return mesh;
  }

  private createEndpointDotMesh(
    points: THREE.Vector3[],
    material: THREE.Material,
    radius: number,
    width: number,
  ): THREE.Mesh | null {
    const lastPoint = points[points.length - 1];

    if (!lastPoint) {
      return null;
    }

    const geometry = new THREE.SphereGeometry(Math.max(radius * 2.4, width * 0.2), 16, 12);
    const mesh = new THREE.Mesh(geometry, material);

    mesh.position.copy(lastPoint);
    mesh.renderOrder = 1001;
    mesh.userData.kind = 'drawingStrokePart';

    return mesh;
  }

  private createArrowMesh(
    points: THREE.Vector3[],
    material: THREE.Material,
    radius: number,
    width: number,
  ): THREE.Mesh | null {
    const lastPoint = points[points.length - 1];
    const previousPoint = this.findPreviousDistinctPoint(points);

    if (!previousPoint) {
      return null;
    }

    const direction = new THREE.Vector3().subVectors(lastPoint, previousPoint);
    const length = direction.length();

    if (length < 0.001) {
      return null;
    }

    direction.normalize();

    const arrowLength = Math.max(2.2, width * 0.85);
    const arrowRadius = Math.max(radius * 2.8, width * 0.25);
    const geometry = new THREE.ConeGeometry(arrowRadius, arrowLength, 16, 1);
    const mesh = new THREE.Mesh(geometry, material);

    mesh.position.copy(lastPoint).addScaledVector(direction, -arrowLength * 0.5);
    mesh.quaternion.setFromUnitVectors(this.cylinderAxis, direction);
    mesh.renderOrder = 1001;
    mesh.userData.kind = 'drawingStrokePart';

    return mesh;
  }

  private createDashedChunks(
    points: THREE.Vector3[],
    width: number,
  ): THREE.Vector3[][] {
    const totalLength = this.getPolylineLength(points);

    if (totalLength <= 0) {
      return [];
    }

    const dashLength = Math.max(0.75, width * 0.45);
    const gapLength = dashLength;
    const chunks: THREE.Vector3[][] = [];
    let cursor = 0;

    while (cursor < totalLength) {
      const dashEnd = Math.min(cursor + dashLength, totalLength);
      const chunk = this.slicePolyline(points, cursor, dashEnd);

      if (chunk.length >= 2) {
        chunks.push(chunk);
      }

      cursor = dashEnd + gapLength;
    }

    return chunks;
  }

  private slicePolyline(
    points: THREE.Vector3[],
    from: number,
    to: number,
  ): THREE.Vector3[] {
    if (to <= from) {
      return [];
    }

    const result: THREE.Vector3[] = [this.samplePolyline(points, from)];
    let travelled = 0;

    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      const segmentLength = start.distanceTo(end);
      const nextTravelled = travelled + segmentLength;

      if (nextTravelled > from && nextTravelled < to) {
        result.push(end.clone());
      }

      travelled = nextTravelled;
    }

    result.push(this.samplePolyline(points, to));

    return result;
  }

  private samplePolyline(
    points: THREE.Vector3[],
    distance: number,
  ): THREE.Vector3 {
    if (distance <= 0) {
      return points[0].clone();
    }

    let travelled = 0;

    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      const segmentLength = start.distanceTo(end);
      const nextTravelled = travelled + segmentLength;

      if (distance <= nextTravelled) {
        const t = segmentLength <= 0
          ? 0
          : (distance - travelled) / segmentLength;

        return start.clone().lerp(end, t);
      }

      travelled = nextTravelled;
    }

    return points[points.length - 1].clone();
  }

  private getPolylineLength(points: THREE.Vector3[]): number {
    let length = 0;

    for (let index = 1; index < points.length; index += 1) {
      length += points[index - 1].distanceTo(points[index]);
    }

    return length;
  }

  private findPreviousDistinctPoint(points: THREE.Vector3[]): THREE.Vector3 | null {
    const lastPoint = points[points.length - 1];

    for (let index = points.length - 2; index >= 0; index -= 1) {
      if (points[index].distanceTo(lastPoint) > 0.001) {
        return points[index];
      }
    }

    return null;
  }

  private getStrokeRadius(width: number): number {
    return Math.max(0.08, width * 0.08);
  }

  private eraseStroke(event: PointerEvent): void {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const intersections = this.raycaster.intersectObjects(this.root.children, true);
    const stroke = intersections
      .map((item) => this.findStrokeRoot(item.object))
      .find((item): item is THREE.Group => item !== null);

    if (!stroke) {
      return;
    }

    if (this.onlineHandlers) {
      this.onlineHandlers.remove(stroke.userData.id as string);
      return;
    }
    this.root.remove(stroke);
    this.disposeObject(stroke);
  }

  private findStrokeRoot(object: THREE.Object3D): THREE.Group | null {
    let current: THREE.Object3D | null = object;

    while (current && current !== this.root) {
      if (current instanceof THREE.Group && current.userData.kind === 'drawingStroke') {
        return current;
      }

      current = current.parent;
    }

    return null;
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
    for (const child of [...object.children]) {
      this.disposeObject(child);
    }

    if (object instanceof THREE.Mesh) {
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
