import * as THREE from 'three';
import type { MapCapturePointSet, MapCapturePoint } from '../../domain/MapModels';
import type { ReplayCapturePointEvent } from '../../domain/ReplayModels';
import { capturePointTracks, sampleCapturePoint } from '../replay/ReplayCapturePoints';

type Entry = { point: MapCapturePoint; ring: THREE.Mesh; progress: THREE.Mesh; label: THREE.Sprite; canvas: HTMLCanvasElement; signature: string };
export class CapturePointLayer {
  readonly root = new THREE.Group();
  private entries: Entry[] = [];
  private tracks = new Map<number, ReplayCapturePointEvent[]>();
  private recorderTeam: number | null = null;
  private readonly ray = new THREE.Raycaster();

  load(data: MapCapturePointSet, terrain: THREE.Group): void {
    this.clear();
    if (data.coordinateSystem !== 'three-world-v1') throw new Error('Unknown capture point coordinates');
    terrain.updateMatrixWorld(true);
    for (const point of data.points) {
      const ring = new THREE.Mesh(this.ringGeometry(point, terrain), this.material('#d8dce5',.85));
      const progress = new THREE.Mesh(ring.geometry.clone(), this.material('#4880ff',1));
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=144;
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({ map:texture,transparent:true, depthTest:false, depthWrite:false, toneMapped:false });
      const label = new THREE.Sprite(material); label.renderOrder=975;
      label.position.set(point.position.x,point.position.y+6,point.position.z); label.scale.set(8,9,1);
      ring.renderOrder=25;progress.renderOrder=26;
      this.root.add(ring,progress,label); this.entries.push({point,ring,progress,label,canvas,signature:''});
    }
    this.setTime(0);
  }
  setReplay(events: ReplayCapturePointEvent[], recorderTeam: number | null): void {
    this.tracks=capturePointTracks(events);this.recorderTeam=recorderTeam;
    // A single initialized base belongs to Encounter, not Supremacy.
    this.root.visible=events.length===0 || this.tracks.size>1;
    this.entries.forEach(e=>e.signature='');this.setTime(0);
  }
  setTime(time: number): void {
    const color = (team:number) => team===0?'#d8dce5':this.recorderTeam===null?'#d8dce5':team===this.recorderTeam?'#4880ff':'#ff174b';
    for (const e of this.entries) {
      const state=sampleCapturePoint(this.tracks.get(e.point.id)??[],time);
      const owner=state?.ownerTeamId??0, capturing=state?.capturingTeamId??0, fraction=state?.progress??0;
      (e.ring.material as THREE.MeshBasicMaterial).color.set(color(owner));
      (e.progress.material as THREE.MeshBasicMaterial).color.set(color(capturing));
      e.progress.geometry.setDrawRange(0,Math.floor(fraction*128)*6);e.progress.visible=capturing!==0 && fraction>0;
      const signature=`${owner}:${capturing}:${Math.round(fraction*100)}`;
      if(signature===e.signature) continue;e.signature=signature;
      const ctx=e.canvas.getContext('2d');if(!ctx)continue;
      ctx.clearRect(0,0,128,144);
      ctx.fillStyle='#252a30ee';ctx.beginPath();ctx.moveTo(12,8);ctx.lineTo(116,8);ctx.lineTo(104,110);ctx.lineTo(0,110);ctx.closePath();ctx.fill();
      ctx.strokeStyle=color(owner);ctx.lineWidth=5;ctx.stroke();ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 68px Arial';ctx.fillText(e.point.label,58,58);
      if(capturing) {ctx.fillStyle='#252a30';ctx.fillRect(0,120,128,15);ctx.fillStyle=color(capturing);ctx.fillRect(0,120,128*fraction,15);}
      e.label.material.map!.needsUpdate=true;
    }
  }
  private material(color:string,opacity:number):THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({color,opacity,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,toneMapped:false});
  }
  private ringGeometry(point:MapCapturePoint,terrain:THREE.Group):THREE.BufferGeometry {
    const vertices:number[]=[],indices:number[]=[];
    for(let i=0;i<=128;i++) {
      const angle=i/128*Math.PI*2;
      for(const radius of [point.radius-.35,point.radius+.35]) {
        const x=point.position.x+Math.cos(angle)*radius,z=point.position.z+Math.sin(angle)*radius;
        this.ray.set(new THREE.Vector3(x,10000,z),new THREE.Vector3(0,-1,0));
        const hit=this.ray.intersectObjects(terrain.children,true)[0];
        vertices.push(x,(hit?.point.y??point.position.y)+.15,z);
      }
      if(i<128) {const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);return geometry;
  }
  clear():void {
    for(const e of this.entries) {
      e.ring.geometry.dispose();e.progress.geometry.dispose();
      (e.ring.material as THREE.Material).dispose();(e.progress.material as THREE.Material).dispose();
      e.label.material.map?.dispose();e.label.material.dispose();
    }
    this.entries=[];this.root.clear();
  }
}
