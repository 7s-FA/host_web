/* Validation and browser overrides; no robot controller or remote write access. */
(function(root){
 'use strict';
 const defaults=typeof module!=='undefined'&&module.exports?require('./config.js'):root.SIMULATION_CONFIG;
 const fields=[
  ['burger1','forwardSpeed','버거 1 전진 속도','배',.25,3,.05],
  ['burger1','reverseSpeed','버거 1 후진 속도','배',.25,3,.05],
  ['burger1','turnSpeed','버거 1 회전 속도','°/초',15,180,5],
  ['burger2','forwardSpeed','버거 2 전진 속도','배',.25,3,.05],
  ['burger2','reverseSpeed','버거 2 후진 속도','배',.25,3,.05],
  ['burger2','turnSpeed','버거 2 회전 속도','°/초',15,180,5],
  ['process','loadPartSeconds','팔 1 부품 1개 적재 시간','초',.1,60,.1],
  ['process','assemblySeconds','팔 2 조립 시간','초',.1,120,.1],
  ['process','linearPrepareSeconds','리니어 A지그 준비 시간','초',.1,60,.1],
  ['process','linearHomeSeconds','리니어 원점 복귀 시간','초',.1,60,.1],
  ['process','palletSeconds','팔 3 파렛트 적재 시간','초',.1,120,.1]
 ];
 const key='robot3-simulation-settings-v1';
 function validate(value){
  if(!value||value.version!==1)throw Error('설정 version은 1이어야 합니다.');
  const result={version:1,burger1:{},burger2:{},process:{}};
  for(const [group,name,label,unit,min,max] of fields){
   const n=value[group]?.[name];
   if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw Error(`${label}: ${min}~${max}${unit} 범위의 숫자를 입력하세요.`);
   result[group][name]=n;
  }
  return result;
 }
 function read(){
  try{const raw=root.localStorage?.getItem(key);if(raw)return {config:validate(JSON.parse(raw)),source:'browser'};}
  catch(e){return {config:validate(defaults),source:'default',warning:'저장 설정을 읽을 수 없어 config.js 기본값을 사용합니다.'};}
  return {config:validate(defaults),source:'default'};
 }
 function save(config){const valid=validate(config);root.localStorage.setItem(key,JSON.stringify(valid));return valid;}
 function reset(){root.localStorage.removeItem(key);return validate(defaults);}
 function serialize(config){return '/* Robot3 simulation defaults. Rebuild Host scenarios after replacing this file. */\n(function(root){const config='+JSON.stringify(validate(config),null,2)+';\nif(typeof module!=="undefined"&&module.exports)module.exports=config;else root.SIMULATION_CONFIG=config;\n})(typeof window!=="undefined"?window:globalThis);\n';}
 const api={defaults:validate(defaults),fields,key,validate,read,save,reset,serialize};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SimulationSettings=api;
})(typeof window!=='undefined'?window:globalThis);
