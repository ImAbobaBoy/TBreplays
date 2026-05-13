import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { ViewerTool } from '../../app/AppState';
import type {
  ManualTankModel,
  TankTeamKind,
  TankVisualKey,
} from '../../domain/TankModels';
import {
  applyTankModelToVisual,
  createTankVisual,
  disposeTankVisual,
  getTankMuzzleWorldPosition,
  setTankSelected,
  type TankVisual,
} from '../tanks/TankMeshFactory';

export type TankLayerHandlers = {
  onTankCreated?: (tank: ManualTankModel) => void;
  onTankChanged?: (tank: ManualTankModel) => void;
  onTankSelected?: (tankId: string | null) => void;
};

type TankEntry = {
  model: ManualTankModel;
  visual: TankVisual;
};

export class TankLayer {
  private readonly root: THREE.Group;
  private readonly terrainRoot: THREE.Group;
  private readonly camera: THREE.Camera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly tanks = new Map<string, TankEntry>();

  private handlers: TankLayerHandlers = {};
  private tool: ViewerTool = 'select';
  private enabled = true;
  private selectedTankId: string | null = null;
  private draggedTankId: string | null = null;
  private nextTankNumber = 1;

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

  public setHandlers(handlers: TankLayerHandlers): void {
    this.handlers = handlers;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;

    if (!enabled) {
      this.finishDrag();
    }
  }

  public setTool(tool: ViewerTool): void {
    this.tool = tool;

    if (tool !== 'select') {
      this.finishDrag();
    }
  }

  public setSelectedTankId(tankId: string | null): void {
    this.selectedTankId = tankId;
    this.updateSelectionState();
  }

  public setManualTanks(tanks: ManualTankModel[]): void {
    const nextIds = new Set(tanks.map((tank) => tank.id));

    for (const [id, entry] of [...this.tanks.entries()]) {
      if (nextIds.has(id)) {
        continue;
      }

      this.root.remove(entry.visual.root);
      disposeTankVisual(entry.visual);
      this.tanks.delete(id);
    }

    for (const tank of tanks) {
      const existing = this.tanks.get(tank.id);

      if (existing) {
        const shouldRecreateVisual =
          existing.model.color !== tank.color ||
          existing.model.visualKey !== tank.visualKey ||
          existing.model.team !== tank.team;

        if (shouldRecreateVisual) {
          // TODO: Временное MVP-решение.
          // Сейчас при смене цвета/типа танка пересоздаём весь primitive-visual.
          // Потом заменить на точечное обновление материалов/mesh variant, когда появятся нормальные tank assets.
          // Убрать пересоздание visual на каждый color input, когда будет TankVisualController.
          this.root.remove(existing.visual.root);
          disposeTankVisual(existing.visual);

          const visual = createTankVisual(tank);
          this.root.add(visual.root);

          this.tanks.set(tank.id, {
            model: tank,
            visual,
          });

          continue;
        }

        existing.model = tank;
        applyTankModelToVisual(tank, existing.visual);
        continue;
      }

      const visual = createTankVisual(tank);
      this.root.add(visual.root);

      this.tanks.set(tank.id, {
        model: tank,
        visual,
      });
    }

    this.updateSelectionState();
  }

  public clear(): void {
    this.finishDrag();

    for (const entry of this.tanks.values()) {
      this.root.remove(entry.visual.root);
      disposeTankVisual(entry.visual);
    }

    this.tanks.clear();
    this.selectedTankId = null;
    this.nextTankNumber = 1;
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

  public getMuzzleWorldPosition(tankId: string): THREE.Vector3 | null {
    const entry = this.tanks.get(tankId);

    if (!entry) {
      return null;
    }

    return getTankMuzzleWorldPosition(entry.visual);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0) {
      return;
    }

    if (this.tool === 'tankPlacement') {
      this.stopViewerEvent(event);
      this.placeTank(event);
      return;
    }

    if (this.tool !== 'select') {
      return;
    }

    const tankId = this.pickTankId(event);

    if (!tankId) {
      this.handlers.onTankSelected?.(null);
      return;
    }

    this.stopViewerEvent(event);
    this.selectedTankId = tankId;
    this.handlers.onTankSelected?.(tankId);
    this.updateSelectionState();

    this.draggedTankId = tankId;
    this.controls.enabled = false;
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.enabled || !this.draggedTankId) {
      return;
    }

    this.stopViewerEvent(event);
    this.dragTank(event);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.draggedTankId) {
      return;
    }

    this.stopViewerEvent(event);
    this.finishDrag();
  };

  private placeTank(event: PointerEvent): void {
    const point = this.pickTerrainPoint(event);

    if (!point) {
      return;
    }

    const tank = this.createTankModelAtPoint(point);

    this.handlers.onTankCreated?.(tank);
    this.handlers.onTankSelected?.(tank.id);

    this.selectedTankId = tank.id;
    this.updateSelectionState();
  }

  private dragTank(event: PointerEvent): void {
    if (!this.draggedTankId) {
      return;
    }

    const entry = this.tanks.get(this.draggedTankId);
    const point = this.pickTerrainPoint(event);

    if (!entry || !point) {
      return;
    }

    // TODO: Временное MVP-решение.
    // Сейчас ручной танк хранит позицию прямо в Three.js world coordinates, потому что ставится raycast-ом по terrain.
    // Потом заменить coordinateSpace на map-space-v1/replay-space-v1 и конвертировать через map_calibration.json.
    // Убрать viewer-world-v1, когда появится backend-сохранение стратегических разборов.
    const nextTank: ManualTankModel = {
      ...entry.model,
      pose: {
        ...entry.model.pose,
        x: point.x,
        y: point.y,
        z: point.z,
      },
    };

    entry.model = nextTank;
    applyTankModelToVisual(nextTank, entry.visual);
    this.handlers.onTankChanged?.(nextTank);
  }

  private finishDrag(): void {
    this.draggedTankId = null;
    this.controls.enabled = true;
  }

  private createTankModelAtPoint(point: THREE.Vector3): ManualTankModel {
    const id = crypto.randomUUID();

    // TODO: Временное MVP-решение.
    // Сейчас новые танки создаются как neutral/medium с дефолтным цветом.
    // Потом брать team, vehicleCompactDescriptor/visualKey и цвет из панели или из replay parser.
    // Убрать дефолты, когда будет нормальная модель стратегического разбора.
    return {
      id,
      coordinateSpace: 'viewer-world-v1',
      label: `Танк ${this.nextTankNumber++}`,
      visualKey: 'medium' satisfies TankVisualKey,
      team: 'neutral' satisfies TankTeamKind,
      color: '#facc15',
      pose: {
        x: point.x,
        y: point.y,
        z: point.z,
        bodyYawDegrees: 0,
        turretYawDegrees: 0,
      },
    };
  }

  private pickTankId(event: PointerEvent): string | null {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const intersections = this.raycaster.intersectObjects(this.root.children, true);

    for (const intersection of intersections) {
      const tankId = this.findTankId(intersection.object);

      if (tankId) {
        return tankId;
      }
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
    point.y += 0.15;

    return point;
  }

  private findTankId(object: THREE.Object3D): string | null {
    let current: THREE.Object3D | null = object;

    while (current) {
      const tankId = current.userData.manualTankId;

      if (typeof tankId === 'string') {
        return tankId;
      }

      current = current.parent;
    }

    return null;
  }

  private updateSelectionState(): void {
    for (const [id, entry] of this.tanks.entries()) {
      setTankSelected(entry.visual, id === this.selectedTankId);
    }
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
}