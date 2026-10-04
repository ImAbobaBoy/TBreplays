import * as THREE from 'three';

import type { DrawingStrokeModel } from '../../domain/DrawingModels';
import type { MapCalibration } from '../../domain/MapCalibration';
import type { ManualTankModel } from '../../domain/TankModels';
import { paintTextSign } from '../TextSign';

type TacticalPngExportRequest = {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  mapRoot: THREE.Group;
  replayRoot: THREE.Group;
  includeReplay: boolean;
  debugRoot: THREE.Group;
  workspaceRoot: THREE.Group;
  calibration: MapCalibration | null;
  manualTanks: ManualTankModel[];
  strokes: DrawingStrokeModel[];
  fileName: string;
  width: number;
  height: number;
};

type ProjectedPoint = {
  x: number;
  y: number;
};

export class TacticalPngExportService {
  public async export(request: TacticalPngExportRequest): Promise<void> {
    // TODO: Временное MVP-решение.
    // Сейчас PNG-экспорт рисует только top-down карту, ручные танки Blitz-style, ручные strokes и aim lines текущей сессии.
    // Потом заменить на экспорт из полноценного StrategyDocument с text blocks, markers, zones, настройками формата и backend-сохранением.
    // Убрать фиксированный local-only pipeline, когда появится полноценная модель стратегического разбора.
    const canvas = this.renderBackgroundToCanvas(request);
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Не удалось получить 2D context для PNG-экспорта.');
    }

    const exportCamera = this.createExportCamera(
      request.mapRoot,
      request.calibration,
      request.width,
      request.height,
    );

    this.drawStrokes(
      context,
      request.strokes,
      exportCamera,
      request.width,
      request.height,
    );

    this.drawManualTanks(
      context,
      request.manualTanks,
      exportCamera,
      request.width,
      request.height,
    );

    await this.downloadCanvas(canvas, request.fileName);
  }

  private renderBackgroundToCanvas(
    request: TacticalPngExportRequest,
  ): HTMLCanvasElement {
    const exportCamera = this.createExportCamera(
      request.mapRoot,
      request.calibration,
      request.width,
      request.height,
    );

    const renderTarget = new THREE.WebGLRenderTarget(
      request.width,
      request.height,
      {
        depthBuffer: true,
        stencilBuffer: false,
      },
    );

    renderTarget.texture.colorSpace = THREE.SRGBColorSpace;

    const previousRenderTarget = request.renderer.getRenderTarget();
    const previousReplayVisible = request.replayRoot.visible;
    const previousDebugVisible = request.debugRoot.visible;
    const previousWorkspaceVisible = request.workspaceRoot.visible;

    request.replayRoot.visible = request.includeReplay && previousReplayVisible;
    request.debugRoot.visible = false;
    request.workspaceRoot.visible = false;

    const pixels = new Uint8Array(request.width * request.height * 4);
    try {
      request.renderer.setRenderTarget(renderTarget);
      request.renderer.render(request.scene, exportCamera);
      request.renderer.readRenderTargetPixels(renderTarget, 0, 0, request.width, request.height, pixels);
    } finally {
      request.renderer.setRenderTarget(previousRenderTarget);
      request.replayRoot.visible = previousReplayVisible;
      request.debugRoot.visible = previousDebugVisible;
      request.workspaceRoot.visible = previousWorkspaceVisible;
      renderTarget.dispose();
    }

    const canvas = document.createElement('canvas');
    canvas.width = request.width;
    canvas.height = request.height;

    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Не удалось получить 2D context для фона PNG-экспорта.');
    }

    const imageData = context.createImageData(request.width, request.height);

    for (let y = 0; y < request.height; y += 1) {
      const sourceRow = request.height - y - 1;
      const sourceOffset = sourceRow * request.width * 4;
      const targetOffset = y * request.width * 4;

      imageData.data.set(
        pixels.subarray(sourceOffset, sourceOffset + request.width * 4),
        targetOffset,
      );
    }

    context.putImageData(imageData, 0, 0);

    return canvas;
  }

  private createExportCamera(
    mapRoot: THREE.Group,
    calibration: MapCalibration | null,
    width: number,
    height: number,
  ): THREE.OrthographicCamera {
    const mapBounds = new THREE.Box3().setFromObject(mapRoot);
    const mapSize = mapBounds.isEmpty()
      ? new THREE.Vector3(600, 200, 600)
      : mapBounds.getSize(new THREE.Vector3());

    const halfExtent = calibration?.world.horizontalHalfExtent
      ?? Math.max(mapSize.x, mapSize.z) / 2;

    const aspect = width / height;

    const horizontalHalfExtent = aspect >= 1
      ? halfExtent * aspect
      : halfExtent;

    const verticalHalfExtent = aspect >= 1
      ? halfExtent
      : halfExtent / aspect;

    // TODO: Временное MVP-решение.
    // Сейчас PNG-экспорт центрируется строго по мировому центру карты X/Z = 0, потому что mapBounds может смещаться из-за декораций и объектов, и тогда в кадр попадает пустой фон сцены.
    // Потом заменить на явный exportBounds/center из map_calibration.json или manifest, если появится отдельная экспортная рамка карты.
    // Убрать жёсткий центр (0, 0), когда появится полноценная экспортная геометрия границ карты.
    const centerX = 0;
    const centerZ = 0;
    const centerY = mapBounds.isEmpty()
      ? 0
      : (mapBounds.min.y + mapBounds.max.y) / 2;

    const topY = mapBounds.isEmpty()
      ? 1500
      : mapBounds.max.y + 1500;

    const camera = new THREE.OrthographicCamera(
      -horizontalHalfExtent,
      horizontalHalfExtent,
      verticalHalfExtent,
      -verticalHalfExtent,
      0.1,
      Math.max(3000, mapSize.y + 2500),
    );

    camera.position.set(centerX, topY, centerZ);
    camera.up.set(0, 0, -1);
    camera.lookAt(centerX, centerY, centerZ);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    return camera;
  }

  private drawStrokes(
    context: CanvasRenderingContext2D,
    strokes: DrawingStrokeModel[],
    camera: THREE.Camera,
    width: number,
    height: number,
  ): void {
    for (const stroke of strokes) {
      if (stroke.points.length < (stroke.style === 'marker' || stroke.style === 'text' ? 1 : 2)) {
        continue;
      }

      const projected = stroke.points.map((point) => {
        return this.projectPoint(
          new THREE.Vector3(point.x, point.y, point.z),
          camera,
          width,
          height,
        );
      });

      if (stroke.style === 'text') {
        const anchor = stroke.points[0];
        const offset = this.projectPoint(new THREE.Vector3(anchor.x + stroke.width, anchor.y, anchor.z), camera, width, height);
        const pixels = Math.hypot(offset.x - projected[0].x, offset.y - projected[0].y);
        paintTextSign(context, stroke.text ?? '', stroke.color, Math.max(10, pixels), projected[0].x, projected[0].y);
        continue;
      }
      if (stroke.style === 'marker') {
        context.save();
        context.fillStyle = stroke.color;
        context.beginPath();
        context.arc(projected[0].x, projected[0].y, Math.max(4, stroke.width * 1.35), 0, Math.PI * 2);
        context.fill();
        context.restore();
        continue;
      }
      context.save();
      context.strokeStyle = stroke.color;
      context.lineWidth = Math.max(2, stroke.width * 1.35);
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.setLineDash(stroke.style === 'dashed' ? [5, 5] : []);

      context.beginPath();
      context.moveTo(projected[0].x, projected[0].y);

      for (let index = 1; index < projected.length; index += 1) {
        context.lineTo(projected[index].x, projected[index].y);
      }

      context.stroke();

      if (stroke.arrowMode === 'end') {
        this.drawArrowHead(
          context,
          projected[projected.length - 2],
          projected[projected.length - 1],
          stroke.color,
          Math.max(14, stroke.width * 3.4),
        );
      }

      context.restore();
    }
  }

  private drawManualTanks(
    context: CanvasRenderingContext2D,
    manualTanks: ManualTankModel[],
    camera: THREE.Camera,
    width: number,
    height: number,
  ): void {
    for (const tank of manualTanks) {
      if (tank.aimTarget) {
        const from = this.projectPoint(
          new THREE.Vector3(tank.pose.x, tank.pose.y, tank.pose.z),
          camera,
          width,
          height,
        );

        const to = this.projectPoint(
          new THREE.Vector3(tank.aimTarget.x, tank.aimTarget.y, tank.aimTarget.z),
          camera,
          width,
          height,
        );

        context.save();
        context.strokeStyle = tank.color;
        context.fillStyle = tank.color;
        context.lineWidth = 3;
        context.globalAlpha = 0.92;
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.stroke();

        context.beginPath();
        context.arc(to.x, to.y, 5, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }

      const position = this.projectPoint(
        new THREE.Vector3(tank.pose.x, tank.pose.y, tank.pose.z),
        camera,
        width,
        height,
      );

      this.drawTankIcon(context, tank, position);
      this.drawTankLabel(context, tank.label, position.x + 34, position.y + 7);
    }
  }

  private drawTankIcon(
    context: CanvasRenderingContext2D,
    tank: ManualTankModel,
    position: ProjectedPoint,
  ): void {
    context.save();

    const fillColor = tank.color;
    const outerBorderColor = '#b8b8b8';
    const outlineColor = '#000000';

    if (tank.visualKey === 'td') {
      this.drawTankDestroyerIcon(
        context,
        position.x,
        position.y,
        fillColor,
        outerBorderColor,
        outlineColor,
      );

      context.restore();
      return;
    }

    this.drawRhombusTankIcon(
      context,
      position.x,
      position.y,
      tank.visualKey,
      fillColor,
      outerBorderColor,
      outlineColor,
    );

    context.restore();
  }

  private drawTankDestroyerIcon(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    fillColor: string,
    outerBorderColor: string,
    outlineColor: string,
  ): void {
    const outerHalfWidth = 21;
    const outerTopY = y - 18;
    const outerBottomY = y + 20;

    context.fillStyle = outerBorderColor;
    context.beginPath();
    context.moveTo(x - outerHalfWidth, outerTopY);
    context.lineTo(x + outerHalfWidth, outerTopY);
    context.lineTo(x, outerBottomY);
    context.closePath();
    context.fill();

    const innerInset = 4;
    const innerHalfWidth = outerHalfWidth - innerInset;
    const innerTopY = outerTopY + innerInset;
    const innerBottomY = outerBottomY - innerInset;

    context.fillStyle = fillColor;
    context.beginPath();
    context.moveTo(x - innerHalfWidth, innerTopY);
    context.lineTo(x + innerHalfWidth, innerTopY);
    context.lineTo(x, innerBottomY);
    context.closePath();
    context.fill();

    context.strokeStyle = outlineColor;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(x - innerHalfWidth, innerTopY);
    context.lineTo(x + innerHalfWidth, innerTopY);
    context.lineTo(x, innerBottomY);
    context.closePath();
    context.stroke();
  }

  private drawRhombusTankIcon(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    visualKey: ManualTankModel['visualKey'],
    fillColor: string,
    outerBorderColor: string,
    outlineColor: string,
  ): void {
    const outerHalfWidth = 22;
    const outerHalfHeight = 26;
    const innerInset = 4;
    const innerHalfWidth = outerHalfWidth - innerInset;
    const innerHalfHeight = outerHalfHeight - innerInset;

    this.buildRhombusPath(context, x, y, outerHalfWidth, outerHalfHeight);
    context.fillStyle = outerBorderColor;
    context.fill();

    this.buildRhombusPath(context, x, y, innerHalfWidth, innerHalfHeight);
    context.fillStyle = fillColor;
    context.fill();

    this.buildRhombusPath(context, x, y, innerHalfWidth, innerHalfHeight);
    context.strokeStyle = outlineColor;
    context.lineWidth = 3;
    context.stroke();

    const stripeCount = visualKey === 'heavy'
      ? 2
      : visualKey === 'medium'
        ? 1
        : 0;

    if (stripeCount === 0) {
      return;
    }

    context.strokeStyle = outlineColor;
    context.lineWidth = 3;
    context.lineCap = 'round';

    const stripeOffsets = stripeCount === 1
      ? [0]
      : [-6, 6];

    for (const stripeOffset of stripeOffsets) {
      context.beginPath();
      context.moveTo(x - 11 + stripeOffset, y + 12);
      context.lineTo(x + 11 + stripeOffset, y - 12);
      context.stroke();
    }
  }

  private buildRhombusPath(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    halfWidth: number,
    halfHeight: number,
  ): void {
    context.beginPath();
    context.moveTo(x, y - halfHeight);
    context.lineTo(x + halfWidth, y);
    context.lineTo(x, y + halfHeight);
    context.lineTo(x - halfWidth, y);
    context.closePath();
  }

  private drawTankLabel(
    context: CanvasRenderingContext2D,
    label: string,
    x: number,
    y: number,
  ): void {
    if (!label.trim()) {
      return;
    }

    context.save();
    context.font = '700 30px Inter, Arial, sans-serif';
    context.lineWidth = 6;
    context.strokeStyle = 'rgba(0, 0, 0, 0.95)';
    context.fillStyle = '#ffffff';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.strokeText(label, x, y);
    context.fillText(label, x, y);
    context.restore();
  }

  private drawArrowHead(
    context: CanvasRenderingContext2D,
    from: ProjectedPoint,
    to: ProjectedPoint,
    color: string,
    size: number,
  ): void {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);

    context.save();
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(to.x, to.y);
    context.lineTo(
      to.x - Math.cos(angle - Math.PI / 6) * size,
      to.y - Math.sin(angle - Math.PI / 6) * size,
    );
    context.lineTo(
      to.x - Math.cos(angle + Math.PI / 6) * size,
      to.y - Math.sin(angle + Math.PI / 6) * size,
    );
    context.closePath();
    context.fill();
    context.restore();
  }

  private projectPoint(
    point: THREE.Vector3,
    camera: THREE.Camera,
    width: number,
    height: number,
  ): ProjectedPoint {
    const projected = point.clone().project(camera);

    return {
      x: (projected.x * 0.5 + 0.5) * width,
      y: (-projected.y * 0.5 + 0.5) * height,
    };
  }

  private async downloadCanvas(
    canvas: HTMLCanvasElement,
    fileName: string,
  ): Promise<void> {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) {
          resolve(result);
          return;
        }

        reject(new Error('Браузер не смог сформировать PNG blob.'));
      }, 'image/png');
    });

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 10000);
  }
}
