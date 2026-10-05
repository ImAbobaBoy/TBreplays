import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
const moduleUrl = file => pathToFileURL(path.resolve(file)).href;
function compile(file, imports = {}) {
  let code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  code = code.replace("import './replayBattleOverlay.css';",'');
  for(const [from,to] of Object.entries(imports)) for(const quote of ["'",'"']) code=code.replaceAll(`from ${quote}${from}${quote}`,`from '${to}'`);
  return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
}
const {ReplayBattleOverlay}=await import(compile('src/features/replay/ReplayBattleOverlay.tsx',{'react/jsx-runtime':moduleUrl('node_modules/react/jsx-runtime.js'),'../../engine/replay/ReplayTrackBuilder':compile('src/engine/replay/ReplayTrackBuilder.ts'),'../../engine/replay/ReplayReload':compile('src/engine/replay/ReplayReload.ts')}));
const vehicles=Array.from({length:14},(_,id)=>({entityId:id,nickname:`Player${id}`,vehicleName:`Tank${id}`,teamId:id<7?1:2,initialHp:2000,extras:[]}));
const team={initialHp:14000,lastKnownHp:7000,hasUnobservedHealth:false,aliveCount:7,confirmedKills:2,supremacyPoints:220};
const data={ally:{...team,teamId:1,label:'Команда автора'},enemy:{...team,teamId:2,label:'Противники'},states:new Map(vehicles.map(v=>[v.entityId,{health:v.entityId===1?0:1000,healthIsLastKnown:v.entityId===8,isAlive:v.entityId!==1,confirmedKills:0,extras:[]} ])),resultVisible:false,presentation:{recorderTeamId:1,vehicles,outcome:{status:'unknown'}}};
const html=renderToStaticMarkup(createElement(ReplayBattleOverlay,{data}));
assert.equal((html.match(/class="replay-battle-player/g)||[]).length,14,'Both full seven-player teams remain visible');
assert.ok(html.includes('Player13')&&html.includes('Tank13'));
assert.ok(html.includes('width:50%'),'Health fill follows current battle HP');
assert.ok(html.includes('width:0%'),'Destroyed vehicles have an empty HP fill');
assert.ok(html.includes('≈ '),'Hidden enemy health remains marked as last known');
assert.ok(html.includes('Фраги')&&html.includes('220'));
assert.equal(renderToStaticMarkup(createElement(ReplayBattleOverlay,{data:null})), '');
const {selectReplayReload}=await import(compile('src/engine/replay/ReplayReload.ts'));
const reloadFrames=[{time:0,durationSeconds:10,startedAt:null,readyAt:null},
  {time:20,durationSeconds:10,startedAt:20,readyAt:30},
  {time:24,durationSeconds:10,startedAt:20,readyAt:36},
  {time:26,durationSeconds:10,startedAt:20,readyAt:28}];
assert.equal(selectReplayReload(reloadFrames,19).fraction,1,'Loaded before the shot');
assert.equal(selectReplayReload(reloadFrames,20).fraction,0,'Shot empties the bar immediately');
assert.equal(selectReplayReload(reloadFrames,22).fraction,.2,'Fill follows replay time');
assert.equal(selectReplayReload(reloadFrames,24).fraction,.25,'Module damage extends the active reload');
assert.equal(selectReplayReload(reloadFrames,26).fraction,.75,'Repair shortens the active reload');
assert.equal(selectReplayReload(reloadFrames,28).fraction,1,'Loaded at countdown completion');
assert.equal(selectReplayReload(reloadFrames,22).fraction,.2,'Seeking backwards reconstructs progress');
assert.equal(selectReplayReload([],20).fraction,null,'Unknown data never invents a ready gun');
data.time=22;
data.presentation.playback={vehicles:[{entityId:0,reload:reloadFrames}]};
const reloadHtml=renderToStaticMarkup(createElement(ReplayBattleOverlay,{data}));
assert.equal((reloadHtml.match(/aria-label="Player\d+: перезарядка"/g)||[]).length,7,'Only allies get reload bars');
assert.ok(reloadHtml.includes('width:20%')&&reloadHtml.includes('Перезарядка: 8.0 с'),'Real per-player progress reaches the HUD');
const {orbitWheelDistance,orbitPanSpeed}=await import(compile('src/engine/OrbitNavigation.ts'));
assert.equal(orbitWheelDistance(1000,-100,0,20)-1000,orbitWheelDistance(50,-100,0,20)-50,'Wheel step is independent of zoom distance');
assert.equal(orbitWheelDistance(3,-100,0,20),2,'Wheel never crosses the orbit target');
assert.equal(1000*orbitPanSpeed(1000,750),50*orbitPanSpeed(50,750),'World-space panning speed remains constant');
console.log('PASS: full replay rosters, live HP fills, frags, supremacy, unknown health and constant orbit navigation');
