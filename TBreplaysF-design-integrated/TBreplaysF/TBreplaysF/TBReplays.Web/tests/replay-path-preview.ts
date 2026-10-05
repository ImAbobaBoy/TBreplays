import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ReplayLayer } from '../src/engine/layers/ReplayLayer';
import { DrawingLayer } from '../src/engine/layers/DrawingLayer';
import { buildReplayTimeline } from '../src/engine/replay/ReplayTrackBuilder';

const host=document.getElementById('preview')!;
const heading=document.createElement('p'); heading.textContent='Градиент по длине пути · толстая выбранная траектория · линии перекрываются объектами'; host.append(heading);
const bar=document.createElement('div'); bar.style.marginBottom='12px'; host.append(bar);
const renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setSize(1000,600); host.append(renderer.domElement);
const scene=new THREE.Scene(); scene.background=new THREE.Color('#101418');
scene.add(new THREE.AmbientLight(0xffffff,2)); const light=new THREE.DirectionalLight(0xffffff,2); light.position.set(-20,70,50); scene.add(light);
const camera=new THREE.PerspectiveCamera(45,1000/600,.1,1000); camera.position.set(0,85,110); camera.lookAt(0,0,0);
const controls=new OrbitControls(camera,renderer.domElement);
const terrain=new THREE.Group(); scene.add(terrain);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(160,120),new THREE.MeshStandardMaterial({color:'#45543d',side:THREE.DoubleSide})); ground.rotation.x=-Math.PI/2; terrain.add(ground);
const obstacle=new THREE.Mesh(new THREE.BoxGeometry(18,18,25),new THREE.MeshStandardMaterial({color:'#6b6260'})); obstacle.position.set(0,9,0); terrain.add(obstacle);
const root=new THREE.Group(); scene.add(root); const replay=new ReplayLayer(root);
const movement=(z:number)=>Array.from({length:11},(_,time)=>({time,x:-50+time*10,y:1,z,yawRadians:0,segmentIndex:0}));
const fixture={recorderTeamId:1,outcome:{status:'unknown'},vehicles:[1,2].map(entityId=>({entityId,teamId:entityId,nickname:entityId===1?'Союзник':'Противник',vehicleClass:'mediumTank',vehicleName:'СТ',initialHp:2000,extras:[]})),
  playback:{startTime:0,endTime:300,scoreboard:[],projectiles:[],vehicles:[1,2].map(entityId=>({entityId,teamId:entityId,movement:movement(entityId===1?0:-15),turret:[],states:[{time:0,isAlive:true,isVisible:true,health:2000,extras:[]}],
    visibility:entityId===1?[{startTime:0,endTime:10}]:[{startTime:0,endTime:3},{startTime:7,endTime:10}],consumableUses:[],shots:entityId===1?[{time:2,shooterEntityId:1,directionX:1,directionY:0,directionZ:0}]:[]}))}};
replay.load(buildReplayTimeline('preview',fixture as unknown as Parameters<typeof buildReplayTimeline>[1]),null); replay.setTime(3); replay.selectEntity(1);
const drawingsRoot=new THREE.Group(); scene.add(drawingsRoot);
const drawings=new DrawingLayer(drawingsRoot,terrain,camera,renderer,controls);
drawings.setStrokes([{id:'line',style:'solid',color:'#ff981f',width:5,arrowMode:'none',points:[{x:-50,y:1,z:7},{x:50,y:1,z:7}]}]);
const status=document.createElement('p'); host.append(status);
function selected(id:number|null) {replay.selectEntity(id);status.textContent=id===null?'Выделение снято':`Выбран ${id===1?'союзник':'противник'}: голубой — начало, жёлтый — конец движения`;}
for(const [label,action] of [['Союзник',()=>selected(1)],['Противник',()=>selected(2)],['Снять выделение',()=>selected(null)],['Показать / скрыть объект',()=>{obstacle.visible=!obstacle.visible;}]] as const) {
  const button=document.createElement('button'); button.textContent=label; button.onclick=action; button.style.marginRight='8px'; bar.append(button);
}
selected(1);
let frame=0; const render=()=>{controls.update();replay.updateView(camera,600);renderer.render(scene,camera);frame=requestAnimationFrame(render);}; render();
if(import.meta.hot) import.meta.hot.dispose(()=>{cancelAnimationFrame(frame);drawings.dispose();replay.dispose();controls.dispose();ground.geometry.dispose();obstacle.geometry.dispose();renderer.dispose();renderer.domElement.remove();heading.remove();bar.remove();status.remove();});
