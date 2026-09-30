'use strict';
const el=id=>document.getElementById(id), S=SimulationSettings;
const visibleFields=S.fields.filter(([group])=>group!=='process');
let processConfig={...S.defaults.process};
function message(text,error=false){el('settings-status').textContent=text;el('settings-status').className=error?'error':'';}
for(const [group,key,label,unit,min,max,step] of visibleFields){
 const row=document.createElement('div');row.className='setting-field';
 const text=document.createElement('label');text.htmlFor=group+'-'+key;text.textContent=label+' ('+unit+')';
 const hint=document.createElement('small');hint.textContent=`${min}~${max}${unit} · 기본 ${S.defaults[group][key]}${unit}`;text.append(hint);
 const input=document.createElement('input');Object.assign(input,{id:group+'-'+key,type:'number',min,max,step:'any',required:true});
 row.append(text,input);el(group+'-fields').append(row);
}
function collect(){const c={version:1,burger1:{},burger2:{},process:{...processConfig}};for(const [g,k] of visibleFields){const value=el(g+'-'+k).value;c[g][k]=value.trim()===''?NaN:Number(value);}return S.validate(c);}
function preview(){try{const c=collect(),p=RobotSimulation.makePlan(2,c);el('preview-time').textContent=p.duration.toFixed(1)+'초';el('preview-stages').textContent=`Host와 같은 경계 기준 ${RobotSimulation.stagesFor(2,c).length}단계 · 부품 3개 적재 ${(c.process.loadPartSeconds*3).toFixed(1)}초`;}catch(e){el('preview-time').textContent='입력값 확인';el('preview-stages').textContent=e.message;}}
function fill(c){const valid=S.validate(c);processConfig={...valid.process};for(const [g,k] of visibleFields)el(g+'-'+k).value=valid[g][k];preview();}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
el('settings-form').oninput=()=>{preview();message('변경 사항이 아직 저장되지 않았습니다.');};
el('settings-form').onsubmit=e=>{e.preventDefault();try{S.save(collect());message('저장했습니다. 시뮬레이션의 다음 새 주문부터 적용됩니다. Host 모드는 서버 설정을 사용합니다.');}catch(e){message('저장하지 못했습니다: '+e.message,true);}};
el('reset-settings').onclick=()=>{try{fill(S.reset());message('브라우저 저장값을 지우고 config.js 기본값으로 복원했습니다. 다음 새 주문부터 적용됩니다.');}catch(e){message('복원하지 못했습니다: '+e.message,true);}};
el('export-config').onclick=()=>{try{download('config.js',S.serialize(collect()),'text/javascript');message('config.js를 내보냈습니다. 프로젝트 파일 교체 후 적용하세요.');}catch(e){message(e.message,true);}};
el('export-json').onclick=()=>{try{download('simulation-settings.json',JSON.stringify(collect(),null,2),'application/json');}catch(e){message(e.message,true);}};
el('import-config').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>16000)throw Error('16KB 이하의 JSON 설정 파일만 가져올 수 있습니다.');fill(S.validate(JSON.parse(await file.text())));message('설정을 불러왔습니다. 적용하려면 이 브라우저에 저장을 누르세요.');}catch(e){message('가져오지 못했습니다: '+e.message,true);}finally{e.target.value='';}};
const saved=S.read();fill(saved.config);message(saved.warning||(saved.source==='browser'?'이 브라우저에 저장된 설정을 불러왔습니다.':'config.js 기본값을 사용 중입니다.'),!!saved.warning);
if(['127.0.0.1','localhost'].includes(location.hostname)&&location.protocol==='http:'){
 fetch('/api/state').then(r=>{if(!r.ok)throw Error();return r.json();}).then(s=>{
  if(!s.simulation_config)return;
  const p=RobotSimulation.makePlan(2,s.simulation_config);
  el('host-config-note').textContent=`연결된 Host 서버 기준: A제품 2개 ${p.duration.toFixed(1)}초 / ${s.sample_stage_count}단계. 아래 브라우저 설정과 별도로 적용됩니다.`;
 }).catch(()=>{});
}
