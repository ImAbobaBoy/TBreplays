import {ViewerEngine} from '../src/engine/ViewerEngine';
import * as THREE from 'three';
const engine=new ViewerEngine(document.getElementById('map') as HTMLDivElement);
try {
  await engine.loadMap('29_skit_sk');
  const view=engine as unknown as {camera:THREE.PerspectiveCamera;controls:{target:THREE.Vector3;update:()=>void}};
  view.controls.target.set(-155.39,36.26,135);
  view.camera.position.set(-171.8,38,146.5);view.controls.update();
  document.getElementById('status')!.textContent='Твоя картинка на штатном щите. Геометрия и исходные файлы карты не менялись.';
} catch(error) {document.getElementById('status')!.textContent=String(error);}
if(import.meta.hot)import.meta.hot.dispose(()=>engine.dispose());
