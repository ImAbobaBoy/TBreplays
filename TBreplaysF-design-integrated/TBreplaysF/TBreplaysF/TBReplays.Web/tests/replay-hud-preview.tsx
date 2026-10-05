import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { ReplayBattleOverlay } from '../src/features/replay/ReplayBattleOverlay';
import { updateReplayTankPlate } from '../src/engine/replay/ReplayTankPlate';
import { useReplayClock } from '../src/features/replay/useReplayClock';
import type { ReplayTeamHealthState, ReplayPlaybackState } from '../src/domain/ReplayModels';
import type { ViewerEngine } from '../src/engine/ViewerEngine';
import '../src/styles/userWorkspace.css';

let selected: number | null = null;
const listeners = new Set<(id: number | null) => void>();
const engine = {
  getSelectedReplayEntity: () => selected,
  selectReplayEntity: (id: number) => { selected = id; listeners.forEach(fn => fn(id)); },
  subscribeReplaySelection: (fn: (id:number|null)=>void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
} as unknown as ViewerEngine;
const vehicles = Array.from({length:14},(_,id)=>({entityId:id,teamId:id<7?1:2,nickname:id===0?'ant200501':`Player_${id}_LongNickname`,vehicleName:id%2?'Объект 260':'VK 120.03 (H) Tiger-Maus',initialHp:2600,extras:[]}));
const team = {initialHp:18200,lastKnownHp:14000,confirmedKills:2,supremacyPoints:220};
const base = {ally:{...team,teamId:1,label:'Команда автора'},enemy:{...team,teamId:2,label:'Противники'},
  states:new Map(vehicles.map(v=>[v.entityId,{health:2000,isAlive:true,extras:[]} ])),resultVisible:false,
  presentation:{recorderTeamId:1,vehicleStateProtocolVersion:1,vehicles,outcome:{status:'unknown'},playback:{vehicles:vehicles.map(v=>({entityId:v.entityId,reload:[{time:0,durationSeconds:10,startedAt:0,readyAt:10}]}))}}} as unknown as ReplayTeamHealthState;

function Plate({enemy=false}:{enemy?:boolean}) {
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true}); renderer.setSize(512,160); host.current!.appendChild(renderer.domElement);
    const scene=new THREE.Scene(), camera=new THREE.OrthographicCamera(-11,11,3.4375,-3.4375,.1,50); camera.position.z=10;
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({transparent:true})); scene.add(sprite);
    let frame=0; const start=performance.now();
    const render=()=>{ updateReplayTankPlate(sprite,enemy?'Chill_Loss':'ant200501',enemy?'Объект 260':'Tiger-Maus',2000,2600,false,enemy?null:((performance.now()-start)/1000%10)/10,enemy); renderer.render(scene,camera); frame=requestAnimationFrame(render); };
    render(); return()=>{cancelAnimationFrame(frame); sprite.material.map?.dispose(); sprite.material.dispose(); renderer.dispose(); renderer.domElement.remove();};
  },[enemy]);
  return <div ref={host} aria-label="Плашка танка"/>;
}
function Preview() {
  const [size,setSize]=useState('1214,526');
  const [playback,setPlayback]=useState<ReplayPlaybackState>({replayId:'qa',minTime:0,maxTime:300,time:0,isPlaying:true,speed:1,revision:0});
  const [selection,setSelection]=useState<number|null>(null);
  useEffect(()=>engine.subscribeReplaySelection(setSelection),[]);
  useEffect(()=>{if(!playback.isPlaying)return; const at=performance.now(), time=playback.time;
    const interval=setInterval(()=>setPlayback(p=>({...p,time:time+(performance.now()-at)/1000*p.speed})),100);
    return()=>clearInterval(interval);
  },[playback.isPlaying,playback.revision]);
  const time=useReplayClock(playback), [width,height]=size.split(',').map(Number);
  return <main style={{padding:18,fontFamily:'Arial'}}>
    <label>Размер карты <select value={size} onChange={e=>setSize(e.target.value)}><option value="1214,526">Планшет 1214 × 526</option><option value="900,430">Низкая область 900 × 430</option><option value="600,760">Портрет 600 × 760</option></select></label>
    <button onClick={()=>setPlayback(p=>({...p,isPlaying:!p.isPlaying,revision:p.revision+1}))}>Пуск / пауза</button>
    <button onClick={()=>setPlayback(p=>({...p,time:0,revision:p.revision+1}))}>В начало</button>
    <p>Время: {Math.floor(time/60).toString().padStart(2,'0')}:{Math.floor(time%60).toString().padStart(2,'0')} · Выбран: {selection??'—'}</p>
    <div className="tbr-design" style={{position:'relative',width,maxWidth:'100%',height,background:'linear-gradient(145deg,#3d5141,#213335 55%,#61543e)'}}>
      <div className="viewer-slot"><ReplayBattleOverlay data={{...base,time:playback.time}} playback={playback} engine={engine}/></div>
    </div><div style={{display:'flex',gap:12,flexWrap:'wrap'}}><Plate/><Plate enemy/></div>
  </main>;
}
const previewRoot=createRoot(document.getElementById('root')!);
previewRoot.render(<Preview/>);
if(import.meta.hot) import.meta.hot.dispose(()=>previewRoot.unmount());
