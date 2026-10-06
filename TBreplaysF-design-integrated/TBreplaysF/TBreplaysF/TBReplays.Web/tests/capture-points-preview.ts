import {ViewerEngine} from '../src/engine/ViewerEngine';
import type {ReplayPresentation,ReplayCapturePointEvent} from '../src/domain/ReplayModels';
import type {TBReplaysApi} from '../src/api/TBReplaysApi';
import events from './capture-points-fixture.json';
const status=document.getElementById('status')!,selector=document.getElementById('maps') as HTMLSelectElement;
const slider=document.getElementById('time') as HTMLInputElement;
const engine=new ViewerEngine(document.getElementById('map') as HTMLDivElement);
// Exercise the production map cache, map loader, capture layer and replay controls;
// only the replay HTTP response is replaced with wire states from a real recording.
const api=(engine as unknown as {api:TBReplaysApi}).api;
api.getReplayPresentation=async()=>({schemaVersion:2,recorderTeamId:2,recorderEntityId:null,mapName:'skit',mapId:35,
  vehicles:[],outcome:{winnerTeamId:null,reason:'unknown',reasonName:'',status:'unknown',endTime:null,sourcesAgree:true},
  playback:{timeBasis:'replaySeconds',startTime:0,endTime:80,vehicles:[],scoreboard:[],projectiles:[],capturePoints:events as ReplayCapturePointEvent[]}} as ReplayPresentation);
async function load() {
  status.textContent='Загрузка карты…';
  try {
    await engine.loadMap(selector.value);
    if(selector.value==='29_skit_sk') {await engine.loadReplay('capture-qa');engine.seekReplayTo(Number(slider.value));}
    const data=await api.getMapCapturePoints(selector.value);
    status.textContent=`${data.points.length} точек из SC2. ${selector.value==='29_skit_sk'?'Состояния A/C — из реального реплея; перемотка доступна.':'Нейтральные точки.'}`;
  } catch(error) {status.textContent=String(error);}
}
const maps=await fetch('/api/maps').then(r=>r.json()) as {name:string;displayName:string}[];
for(const map of maps) {const option=document.createElement('option');option.value=map.name;option.textContent=map.displayName;selector.append(option);}
selector.value=new URLSearchParams(location.search).get('map')??'29_skit_sk';selector.onchange=()=>void load();
slider.oninput=()=>{engine.seekReplayTo(Number(slider.value));document.getElementById('clock')!.textContent=`${Math.floor(Number(slider.value)/60)}:${Math.floor(Number(slider.value)%60).toString().padStart(2,'0')}`;};
document.getElementById('reset')!.onclick=()=>engine.clearReplay();
await load();
if(import.meta.hot) import.meta.hot.dispose(()=>engine.dispose());
