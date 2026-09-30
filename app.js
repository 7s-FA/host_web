'use strict';
const $=id=>document.getElementById(id);
const photoPath=key=>window.EMBEDDED_PHOTOS?.[key]||`assets/${key}.jpg`;
const photos={
 'full-map':{title:'전체 맵 · 현장 배치',detail:'왼쪽 아래 초기위치, 중앙 위 자재창고, 오른쪽 아래 제작공정. 중앙 아래 테이프 박스가 교대 대기장소입니다.'},
 route:{title:'운반경로 및 대기위치',detail:'자재창고와 제작공정 사이의 운반 경로, 교대를 위한 대기장소입니다.'},
 warehouse:{title:'자재창고',detail:'로봇팔 1이 A제품 한 세트에 필요한 부품 3개를 준비하는 공간입니다.'},
 loading:{title:'버거 1 부품 적재',detail:'로봇팔 1이 버거 상판에 부품 3개를 싣습니다. 버거 2도 같은 적재 순서를 사용합니다.'},
 assembly:{title:'로봇팔 2 · 티칭 조립',detail:'버거가 도착하고 A지그 위치가 준비되면 티칭 동작으로 제품을 조립합니다.'},
 process:{title:'제작공정 · 리니어 모터',detail:'조립 전에는 A지그 위치로, 조립 후에는 초기위치로 이동합니다.'},
 pallet:{title:'로봇팔 3 · 완제품 적재',detail:'완제품을 파렛트로 옮긴 뒤 성공을 확인하면 Host의 완제품 잔여 카운트가 줄어듭니다.'},
 waiting:{title:'버거 대기장소',detail:'교차 통로에서 대기장소를 바라보도록 정렬한 뒤 전진 주차합니다. ArUco 마커 없이 후방 IR 센서가 검은 감지선을 감지하면 정지합니다. 출차할 때는 10cm 후진·정지 후 180° 회전해 전진 주행합니다.'},
 home:{title:'버거 초기위치',detail:'두 버거는 왼쪽 벽의 마커를 바라보고 주차합니다. 로컬 cmd_vel로 10cm 후진·정지 후 180° 회전하고 Nav2 전진 주행을 시작합니다. 복귀 시에는 전진 진입 후 후방 센서가 감지선에 닿는 위치에서 멈춥니다.'}
};
let plan=null,time=0,playing=false,speed=1,following=true,currentPhoto='full-map',lastEventKey='',lastFrame=0;
let manualMode=false,manualTarget=null,stages=[],stepBusy=false;
const idlePlan=RobotSimulation.makePlan(2);
// Dock cues are schematic placeholders; no physical marker IDs are assigned here.
const svgNS='http://www.w3.org/2000/svg';
Object.entries(RobotSimulation.POINTS).forEach(([place,point])=>{
 const kind=place.startsWith('home')?'home':place;
 const cue=document.createElementNS(svgNS,'g');
 cue.setAttribute('class','dock-cue');
 cue.setAttribute('transform',`translate(${point.join(' ')}) rotate(${RobotSimulation.DOCK_HEADINGS[kind]})`);
 const title=document.createElementNS(svgNS,'title');
 title.textContent=kind==='waiting'?'대기장소: ArUco 마커 없음 · 후방 IR 센서용 검은 정지선':`${place}: ArUco 위치 표식과 후방 적외선 센서용 검은 정지선 (개념 표시)`;
 cue.append(title);
 const line=document.createElementNS(svgNS,'path');
 line.setAttribute('d','M-29 21 H29');line.setAttribute('stroke','#111');line.setAttribute('stroke-width','6');
 cue.append(line);
 if(kind!=='waiting'){
 const marker=document.createElementNS(svgNS,'g');marker.setAttribute('transform',`translate(0 -55) rotate(${-RobotSimulation.DOCK_HEADINGS[kind]})`);
 marker.innerHTML='<rect x="-14" y="-14" width="28" height="28" fill="white" stroke="#111" stroke-width="3"/><text y="5" text-anchor="middle" font-size="13" font-weight="800" fill="#111">AR</text>';
 cue.append(marker);
 }
 $('dock-cues').append(cue);
});

// Shared schematic waypoints; real map coordinates are documented separately.
Object.entries(RobotSimulation.WAYPOINTS).forEach(([id,point])=>{
 const marker=document.createElementNS(svgNS,'g');
 marker.setAttribute('class','waypoint-marker');
 marker.setAttribute('data-waypoint-id',id);
 marker.setAttribute('transform',`translate(${point.join(' ')})`);
 const title=document.createElementNS(svgNS,'title');
 title.textContent=`WP${id} · ${({1:'버거 1 초기위치 합류',2:'자재창고 통로',3:'제작공정 합류',4:'버거 2 초기위치 합류'})[id]} · 공통 경유·회전 지점`;
 const dot=document.createElementNS(svgNS,'circle');
 dot.setAttribute('r','10');
 const label=document.createElementNS(svgNS,'text');
 label.textContent=`WP${id}`;
 label.setAttribute('x',id==='3'?-14:14);
 label.setAttribute('y',id==='3'?-13:-12);
 if(id==='3')label.setAttribute('text-anchor','end');
 marker.append(title,dot,label);
 $('waypoint-markers').append(marker);
});

let navigationRobot=0,navigationPinned=false;
for(const robot of [0,1])$('navigation-b'+(robot+1)).onclick=()=>{navigationRobot=robot;navigationPinned=true;render();};
function renderNavigation(s){
 const active=s.active.filter(t=>t.type==='move');
 if(!navigationPinned&&active.length&&!active.some(t=>t.actor===navigationRobot))navigationRobot=active[0].actor;
 for(const robot of [0,1])$('navigation-b'+(robot+1)).setAttribute('aria-pressed',String(navigationRobot===robot));
 const task=plan?.tasks.filter(t=>t.type==='move'&&t.actor===navigationRobot&&t.start<=time).sort((a,b)=>b.start-a.start)[0];
 const list=$('navigation-steps');
 if(!task){
  $('navigation-summary').textContent=`버거 ${navigationRobot+1} · 초기위치 대기`;
  if(list.dataset.items!=='idle'){list.replaceChildren();list.dataset.items='idle';}
  return;
 }
 const nav=RobotSimulation.navigationState(task,time),current=nav.steps[nav.index];
 $('navigation-summary').textContent=nav.done?'IR 정지 완료 · 도착 완료 회신':`${nav.index+1}/${nav.steps.length} · ${current.label} · ${current.controller}`;
 const key=JSON.stringify([task.id,nav.index,nav.steps.map(step=>step.done)]);
 if(list.dataset.items===key)return;
 list.replaceChildren(...nav.steps.map((step,index)=>{
  const li=document.createElement('li');li.className=step.done?'navigation-done':index===nav.index?'navigation-current':'';
  const dot=document.createElement('i');dot.setAttribute('aria-hidden','true');
  const label=document.createElement('span');label.textContent=`${index+1}. ${step.label}`;
  const state=document.createElement('small');state.textContent=step.done?'완료':index===nav.index?'실행 중':'대기';
  li.title=`${step.controller} · 다음 단계 조건: ${step.condition} · 웹 모의 신호`;
  li.append(dot,label,state);return li;
 }));list.dataset.items=key;
}

function formatTime(t){return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;}
function quantityPolicy(){return HostBridge.enabled&&HostBridge.state?.order_policy||window.SYSTEM_ORDER_POLICY||{quantity_min:1,quantity_max:20};}
function validateQuantity(){const n=Number($('quantity').value),p=quantityPolicy();if(!Number.isInteger(n)||n<p.quantity_min||n>p.quantity_max)throw Error(`주문 수량을 ${p.quantity_min}~${p.quantity_max} 사이의 정수로 입력해 주세요.`);return n;}
function setPhoto(key){if(currentPhoto!==key||!$('scene-image').getAttribute('src')){$('scene-image').src=photoPath(key);currentPhoto=key;}$('scene-image').alt=photos[key].title;}
function openPhoto(key){$('dialog-image').src=photoPath(key);$('dialog-image').alt=photos[key].title;$('dialog-title').textContent=photos[key].title;$('dialog-description').textContent=photos[key].detail;$('photo-dialog').showModal();}
function begin(run=true){manualMode=false;manualTarget=null;if(HostBridge.enabled){try{HostBridge.start(validateQuantity());}catch(e){$('form-error').textContent=e.message;}return;}try{plan=RobotSimulation.makePlan(validateQuantity(),SimulationSettings.read().config);stages=RobotSimulation.stagesFor(plan.quantity,plan.config);time=0;playing=run;following=true;lastEventKey='';$('form-error').textContent='';render();}catch(e){$('form-error').textContent=e.message;}}
function reset(){if(HostBridge.enabled)return;navigationPinned=false;navigationRobot=0;plan=null;manualMode=false;manualTarget=null;stages=[];time=0;playing=false;following=true;lastEventKey='';setPhoto('full-map');render();}
function step(direction){if(HostBridge.enabled)return;manualMode=false;manualTarget=null;if(!plan){begin(false);return;}playing=false;const times=[...new Set(plan.events.map(e=>e.time))];time=direction>0?(times.find(t=>t>time+0.001)??plan.duration):([...times].reverse().find(t=>t<time-0.001)??0);render();}
function togglePlay(){if(HostBridge.enabled)return;if(manualMode){if(playing){playing=false;render();}else runStage();return;}if(!plan){begin();return;}if(time>=plan.duration){time=0;lastEventKey='';}playing=!playing;render();}
async function runStage(){
 if(stepBusy||playing)return;
 if(HostBridge.enabled){
  stepBusy=true;render();
  try{await HostBridge.step(validateQuantity());}catch(e){$('form-error').textContent=e.message;}
  finally{stepBusy=false;render();}return;
 }
 if(!plan||time>=plan.duration){try{validateQuantity();}catch(e){$('form-error').textContent=e.message;return;}begin(false);}
 if(!plan)return;
 manualMode=true;
 manualTarget=stages.find(s=>s.time>time+1e-7)?.time??plan.duration;
 playing=true;render();
}
$('step-order').onclick=runStage;
$('order-form').addEventListener('submit',e=>{e.preventDefault();begin();});
$('plus').onclick=()=>$('quantity').value=Math.min(quantityPolicy().quantity_max,Math.max(quantityPolicy().quantity_min,Number($('quantity').value)||quantityPolicy().quantity_min)+1);
$('minus').onclick=()=>$('quantity').value=Math.max(quantityPolicy().quantity_min,(Number($('quantity').value)||quantityPolicy().quantity_min)-1);
$('play').onclick=togglePlay;$('reset').onclick=reset;$('next').onclick=()=>step(1);$('previous').onclick=()=>step(-1);
$('speed').onchange=e=>speed=Number(e.target.value);
$('timeline').oninput=e=>{if(!plan||HostBridge.enabled)return;playing=false;manualMode=false;manualTarget=null;time=Number(e.target.value);render();};
$('follow').onclick=()=>{following=!following;render();};
$('photo-open').onclick=()=>openPhoto(currentPhoto);
$('open-details').onclick=()=>$('detail-dialog').showModal();
$('close-details').onclick=()=>$('detail-dialog').close();
$('detail-dialog').onclick=e=>{if(e.target===$('detail-dialog'))$('detail-dialog').close();};
$('close-dialog').onclick=()=>$('photo-dialog').close();
$('photo-dialog').onclick=e=>{if(e.target===$('photo-dialog'))$('photo-dialog').close();};
document.querySelectorAll('[data-photo]').forEach(el=>{const activate=()=>{following=false;setPhoto(el.dataset.photo);render();openPhoto(el.dataset.photo);};el.addEventListener('click',activate);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}});});
document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b===button));$('simulation-view').hidden=button.dataset.tab!=='simulation';$('gallery-view').hidden=button.dataset.tab!=='gallery';});
Object.entries(photos).forEach(([key,data])=>{const card=document.createElement('button');card.className='gallery-card';card.innerHTML=`<img src="${photoPath(key)}" alt="${data.title}" loading="lazy"><div><h3>${data.title} ↗</h3><p>${data.detail}</p></div>`;card.onclick=()=>openPhoto(key);$('gallery-grid').append(card);});
$('export').onclick=()=>{if(!plan)return;const s=RobotSimulation.snapshot(plan,time);const data={product:'A',ordered:plan.quantity,simulationTime:time,transportRemaining:s.transport,productRemaining:s.remaining,completed:s.completed,events:s.events.map(({time,kind,text,robot,job,phase,controller})=>({time,kind,text,phase,controller,robot:robot==null?null:`burger${robot+1}`,productNumber:job==null?null:job+1}))};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='robot3-simulation-log.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
document.addEventListener('keydown',e=>{if(['INPUT','SELECT','BUTTON','TEXTAREA'].includes(e.target.tagName)||$('photo-dialog').open||$('detail-dialog').open)return;if(e.code==='Space'){e.preventDefault();togglePlay();}if(e.code==='ArrowRight'){e.preventDefault();step(1);}if(e.code==='ArrowLeft'){e.preventDefault();step(-1);}});
function getScene(s){
 if(s.done)return {key:'pallet',kicker:'ORDER COMPLETE',title:'A제품 주문 완료',detail:`완제품 ${plan.quantity}개가 파렛트에 적재됐고, 버거 1·2가 모두 초기위치로 돌아왔습니다.`};
 const f=s.focus;
 if(!f)return {key:s.events.at(-1)?.photo||'route',kicker:'WAITING FOR NEXT EVENT',title:'다음 공정을 준비합니다',detail:s.events.at(-1)?.text||'장비가 다음 단계를 기다립니다.'};
 const p=f.job==null?'':`제품 #${f.job+1} · `;
 if(f.type==='move'&&s.robots[f.actor].parking)return {key:'waiting',kicker:'FORWARD PARKING',title:`버거 ${f.actor+1} · 전진 주차`,detail:'대기 박스 안으로 전진하고, 후방 적외선 센서가 검은 감지선을 감지하면 정지합니다. 대기장소에는 ArUco 마커가 없습니다.'};
 if(f.type==='move'&&s.robots[f.actor].reversing)return {key:'route',kicker:'LOCAL UNDOCK · 10 CM',title:`버거 ${f.actor+1} · 도킹 위치 10cm 후진`,detail:'도킹 위치에서 로컬 cmd_vel로 10cm 후진·정지한 뒤 180° 회전합니다. 이후 Nav2 전진 주행으로 전환합니다. 화면의 이동 거리는 개념 표시입니다.'};
 if(f.type==='move'&&s.robots[f.actor].navigation?.steps[s.robots[f.actor].navigation.index]?.code==='ARUCO_DOCK')return {key:f.to==='warehouse'?'warehouse':f.to==='home'?'home':'process',kicker:'ARUCO DOCKING · SIMULATED',title:`버거 ${f.actor+1} · ArUco 정렬·전진`,detail:'Nav2 경유점에 도착했습니다. 전방 카메라로 ArUco 마커를 추종하며 정렬·전진하고, 후방 IR 센서가 감지선을 감지하면 정지한 뒤 Host에 도착 완료를 회신합니다. 화면은 모의 동작입니다.'};
 if(f.type==='move'&&s.robots[f.actor].turning)return {key:'route',kicker:'TURNING IN PLACE',title:`버거 ${f.actor+1} · 제자리 회전`,detail:'이동을 멈추고 다음 주행 방향으로 차체를 돌립니다. 방향 정렬이 끝나면 직선 주행을 시작합니다.'};
 if(f.type==='assemble')return {key:'assembly',kicker:'ASSEMBLY IN PROGRESS',title:`${p}티칭 조립`,detail:'로봇팔 2가 A지그에서 조립합니다. 다음 주문이 있으면 다른 버거가 자재창고에서 부품을 준비합니다.'};
 if(f.type==='load')return {key:'loading',kicker:'LOADING 3 PARTS',title:`버거 ${f.robot+1} · 부품 적재`,detail:`${p}로봇팔 1이 부품 3개를 차례로 싣습니다. 적재가 모두 끝나야 제작공정으로 이동할 수 있습니다.`};
 if(f.type==='pallet')return {key:'pallet',kicker:'PALLET TRANSFER',title:`${p}완제품 이송`,detail:'로봇팔 3이 완제품을 파렛트에 놓습니다. 적재 성공을 확인한 시점에 완제품 잔여가 1 감소합니다.'};
 if(f.type==='prepare'||f.type==='reset')return {key:'process',kicker:'LINEAR MOTOR',title:f.type==='prepare'?'A지그 위치 준비':'리니어 모터 복귀',detail:f.type==='prepare'?'다음 조립에 사용할 A지그를 작업 위치로 이동합니다.':'조립이 끝나 리니어 모터를 초기위치로 되돌립니다.'};
 if(f.type==='gate')return {key:'waiting',kicker:'INTERLOCK WAIT',title:'제작공정 진입 대기',detail:'부품 적재 완료. 앞 제품의 파렛트 적재와 앞 버거의 대기장소 도착을 기다립니다.'};
 const names={home:'초기위치 복귀',waiting:'대기장소 이동',warehouse:'자재창고 이동',assembly:'제작공정 이동'};
 return {key:f.to==='home'?'home':f.to==='waiting'?'waiting':f.to==='warehouse'?'warehouse':'route',kicker:`BURGER ${f.actor+1} · MOVING`,title:`버거 ${f.actor+1} · ${names[f.to]}`,detail:f.to==='assembly'?'Host가 운송 시작을 확인해 운송 잔여를 1 감소시켰습니다. 조립 위치로 이동 중입니다.':f.to==='home'?(f.from==='waiting'?'마지막 운송 버거의 제작공정 도킹이 끝나 통로가 비었습니다. 대기장소에서 초기위치로 복귀합니다.':'조립 작업을 마쳐 초기위치로 복귀합니다. 진행 중인 완제품 적재는 계속됩니다.'):f.to==='waiting'?'교차 통로까지 이동한 뒤 대기장소를 바라보도록 정렬하고 전진 주차합니다.':'자재창고에 도착하면 로봇팔 1이 A제품 부품 3개를 적재합니다.'};
}
function renderCurrentStage(s){
 const hs=HostBridge.enabled?HostBridge.state:null;
 const names={home:'초기위치',waiting:'대기장소',warehouse:'자재창고',assembly:'제작공정'};
 const set=(id,value)=>{if($(id).textContent!==value)$(id).textContent=value;};
 let status=!plan?'주문 대기':s.done?'주문 완료':playing?'실행 중':'일시정지';
 let title=plan?getScene(s).title:'주문을 기다리고 있어요';
 let detail=plan?getScene(s).detail:'수량을 입력하고 주문을 시작하세요.';
 let label='함께 진행 중인 작업';
 let items=plan?s.active.filter(t=>t.type!=='gate').map(t=>{
  const product=t.job==null?'':` · 제품 #${t.job+1}`;
  if(t.type==='move')return `버거 ${t.actor+1} → ${names[t.to]} · ${s.robots[t.actor].turning?'제자리 회전':s.robots[t.actor].reversing?'후진':'전진'}`;
  return ({load:'로봇팔 1 · 부품 적재',assemble:'로봇팔 2 · 조립',pallet:'로봇팔 3 · 파렛트 적재',prepare:'리니어 · A지그 준비',reset:'리니어 · 원점 복귀'}[t.type]||t.type)+product;
 }):[];
 if(HostBridge.enabled){
  status=!HostBridge.online?'연결 대기 · 정지':({idle:'주문 대기',running:'호스트 지시 실행 중',waiting:'완료 · 다음 지시 대기',paused:'호스트 일시정지',done:'주문 완료'}[hs?.status]||'연결 대기');
  if(hs?.status==='waiting'){
   title=`${hs.acked_seq}단계 완료`;
   detail='목적지까지의 이동 또는 작업을 마쳤습니다. 호스트의 다음 지시를 기다립니다.';
   label='이번 단계에서 완료한 작업';
   items=(hs.counters?.events||[]).filter(e=>['arrive','assembly_end','jig_ready','jig_home','pallet_end'].includes(e.kind)||(e.kind==='part'&&e.part===3)).map(e=>e.text);
  }else if(!HostBridge.online||hs?.status==='paused'){
   label='정지된 작업';
   detail=!HostBridge.online?'호스트 연결을 확인하세요. 연결 복구 후 재개 지시가 필요합니다.':'호스트에서 재개하면 현재 위치부터 이어서 실행합니다.';
  }else if(hs?.status==='running'&&!playing){status='완료 회신 확인 중';}
 }
 if(manualMode&&!playing&&plan&&!s.done&&time>=manualTarget){status='단계 완료 · 다음 실행 대기';title='다음 단계 실행 대기';detail='왼쪽 완료 조건을 확인한 뒤 단계별 실행 버튼을 누르세요.';label='단계 실행 대기';items=['다음 지시를 기다립니다.'];}
 const number=HostBridge.enabled?(hs?.quantity?`호스트 단계 ${hs.command?.seq??hs.acked_seq} / ${hs.stage_count??'—'}`:'호스트 통신 모드'):manualMode?'단계별 시뮬레이션':'자동 시뮬레이션';
 if(!items.length){label='장비 상태';items=[s.done?'버거 1·2 복귀 및 파렛트 적재 완료':!plan?'버거 1·2 초기위치 대기':'다음 작업 준비'];}
 set('stage-status',status);set('stage-number',number);set('stage-title',title);set('stage-detail',detail);$('stage-detail').title=detail;set('stage-work-label',label);
 const list=$('stage-work-list'),key=JSON.stringify(items);
 if(list.dataset.items!==key){list.replaceChildren(...items.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));list.dataset.items=key;}
}
function renderConditions(){
 const hs=HostBridge.enabled?HostBridge.state:null;
 const stage=plan?(HostBridge.enabled?stages[(hs?.command?.seq??hs?.acked_seq??1)-1]:manualMode&&manualTarget!=null?stages.find(s=>s.time===manualTarget):stages.find(s=>s.time>time+1e-7)??stages.at(-1)):null;
 const items=stage?RobotSimulation.stageConditions(plan,stage,time):[{label:'주문 시작 및 실행 지시',signal:'start',done:false}];
 if(HostBridge.enabled){
  items.push({label:'Host 연결',signal:'heartbeat',done:HostBridge.online});
  items.push({label:'Host 완료 회신 수신',signal:stage?`ACK · order_id / seq ${stage.seq}`:'ACK',done:!!stage&&(hs?.acked_seq??0)>=stage.seq});
 }
 $('conditions-title').textContent=stage?`${stage.seq}단계 → 다음 상태 조건`:'다음 단계 전환 조건';
 $('conditions-note').textContent=HostBridge.enabled?'작업 완료는 웹 모의 신호입니다. ACK는 Host 응답으로 확인합니다. 실제 로봇·IR 센서 신호는 아직 연결되지 않았습니다.':'빨강: 미완료 · 초록: 완료. 웹 모의 신호이며 단계별 실행은 모든 조건 완료 후 다음 버튼을 기다립니다.';
 const list=$('conditions-list'),key=JSON.stringify(items);
 if(list.dataset.items!==key){
  list.replaceChildren(...items.map(item=>{
   const li=document.createElement('li');li.className=item.done?'condition-done':'';
   const dot=document.createElement('i');dot.className='condition-dot';dot.setAttribute('aria-hidden','true');
   const label=document.createElement('span');label.textContent=item.label.replace(' · 후방 감지선 도달·정지',' · IR 정지').replace('대기장소 전진 주차 완료','대기 주차 완료').replace('리니어 모터','리니어').replace('파렛트 적재 성공 / 완제품 잔여 −1','파렛트 적재 완료').replace('초기위치 복귀 완료','원점 복귀 완료');label.title=`${item.label} · ${item.signal}`;
   const small=document.createElement('small');small.textContent=item.done?'완료':'미완료';
   label.append(small);li.append(dot,label);return li;
  }));list.dataset.items=key;
  $('condition-signals').replaceChildren(...items.map(item=>{const li=document.createElement('li');li.textContent=`${item.done?'완료':'미완료'} · ${item.label} — ${item.signal}`;return li;}));
 }
 const ready=HostBridge.enabled?HostBridge.online&&['idle','done','waiting'].includes(hs?.status):!playing;
 $('step-order').disabled=stepBusy||!ready;
 $('step-order').textContent=plan&&!RobotSimulation.snapshot(plan,time).done?'다음 단계 실행':'단계별 실행';
}
function render(){
 const s=plan?RobotSimulation.snapshot(plan,time):{...RobotSimulation.snapshot(idlePlan,0),events:[],active:[],robots:[0,1].map(id=>({id,position:RobotSimulation.POINTS['home'+(id+1)],parts:0,heading:RobotSimulation.DOCK_HEADINGS.home,status:'초기위치 대기'})),linear:0,arms:['대기','대기','대기'],done:false};
 renderCurrentStage(s);renderConditions();renderNavigation(s);
 $('total').textContent=plan?plan.quantity:'—';$('transport').textContent=plan?s.transport:'—';$('remaining').textContent=plan?s.remaining:'—';$('completed').textContent=plan?s.completed:0;
 const percent=plan?Math.round(s.completed/plan.quantity*100):0;$('completion-percent').textContent=percent+'%';$('completion-bar').style.width=percent+'%';$('pallet-count').textContent=(plan?s.completed:0)+'개 적재';
 $('run-status').textContent=!plan?'주문 대기':s.done?'주문 완료':playing?'시뮬레이션 진행 중':manualMode&&time>=manualTarget?'다음 단계 실행 대기':'일시정지';
 $('order-id').textContent=plan?`A제품 ${plan.quantity}개 · ${formatTime(time)} / ${formatTime(plan.duration)}`:'수량을 정하고 시작하세요';
 document.querySelector('.order-status').className='order-status'+(playing?' running':s.done?' complete':'');
 ['quantity','plus','minus','product'].forEach(id=>$(id).disabled=!!plan&&!s.done);$('start').disabled=!!plan&&!s.done;$('start').innerHTML=s.done?'<span>↻</span> 새 주문 · 시작':'<span>▶</span> 주문 · 시작';
 $('play').textContent=playing?'Ⅱ':'▶';$('play').setAttribute('aria-label',playing?'일시정지':'재생');$('elapsed').textContent=formatTime(time);$('duration').textContent=formatTime(plan?.duration||0);$('timeline').max=plan?.duration||100;$('timeline').value=time;$('timeline').disabled=!plan;$('previous').disabled=!plan||time===0;$('next').disabled=!!plan&&s.done;$('export').disabled=!plan;
 const moves=s.active.filter(t=>t.type==='move'&&t.via.length);
 for(const robot of [0,1]){
  const move=moves.find(t=>t.actor===robot);
  const activeRoute=$(robot===0?'active-waypoint-route':'active-waypoint-route-b2');
  activeRoute.setAttribute('d',move?RobotSimulation.path(move.from,move.to,robot).map((p,i)=>`${i?'L':'M'}${p.join(' ')}`).join(' '):'');
 }
 document.querySelectorAll('.waypoint-marker').forEach(marker=>{
  const id=Number(marker.dataset.waypointId),point=RobotSimulation.WAYPOINTS[id];
  marker.classList.toggle('on-route',moves.some(move=>move.via.includes(id)));
  marker.classList.toggle('current',moves.some(move=>move.via.includes(id)&&Math.hypot(s.robots[move.actor].position[0]-point[0],s.robots[move.actor].position[1]-point[1])<20));
 });
 s.robots.forEach((r,i)=>{const g=$('robot'+(i+1));g.setAttribute('transform',`translate(${r.position.join(' ')})`);g.querySelector('.robot-body').setAttribute('transform',`rotate(${r.heading})`);g.querySelector('.cargo').innerHTML=Array.from({length:r.parts},(_,n)=>`<rect x="${n*9}" width="7" height="6" rx="1" fill="${i?'#d99032':'#3979c6'}"/>`).join('');const d=$('device-b'+(i+1));d.querySelector('.device-status').textContent=r.status;d.querySelector('.part-dots').innerHTML=Array.from({length:3},(_,n)=>`<i class="${n<r.parts?'filled':''}"></i>`).join('');d.classList.toggle('working',s.active.some(t=>t.actor===i&&t.type==='move'));});
 $('jig').setAttribute('transform',`translate(${600-s.linear*95} 812)`);
 s.arms.forEach((v,i)=>{const d=$('device-a'+(i+1));d.querySelector('.device-status').textContent=v;d.classList.toggle('working',v!=='대기');const g=$('arm'+(i+1)+'-map');g.classList.toggle('active-arm',v!=='대기');g.querySelector('use').setAttribute('transform',v!=='대기'?`rotate(${Math.sin(time*2.6)*12})`:'rotate(0)');});
 if(plan){const scene=getScene(s);if(following)setPhoto(scene.key);$('scene-kicker').textContent=following?scene.kicker:'ON-SITE REFERENCE';$('scene-title').textContent=following?scene.title:photos[currentPhoto].title;$('scene-detail').textContent=following?scene.detail:photos[currentPhoto].detail;}
 else {$('scene-kicker').textContent=following?'READY TO START':'ON-SITE REFERENCE';$('scene-title').textContent=following?'주문을 기다리고 있어요':photos[currentPhoto].title;$('scene-detail').textContent=following?'Host PC에서 제품 수량을 입력하면 두 카운트가 설정되고 시뮬레이션이 시작됩니다.':photos[currentPhoto].detail;}
 $('follow').classList.toggle('active',following);$('follow').setAttribute('aria-pressed',String(following));
 const next=plan?.jobs.find(j=>j.dispatch>time+1e-7);const prev=next?plan.jobs[next.id-1]:null;
 const gates=plan?[!prev||time>=prev.palletEnd,!prev||time>=prev.waitEnd,!!next?time>=next.loaded:true]:[false,false,false];
 $('gates').querySelectorAll('li').forEach((li,i)=>li.classList.toggle('passed',gates[i]));
 if(HostBridge.enabled){
  ['play','reset','next','previous','timeline'].forEach(id=>$(id).disabled=true);
  const hs=HostBridge.state;
  if(hs?.quantity){
   const c=hs.counters||{transport:hs.quantity,remaining:hs.quantity,completed:0};
   $('transport').textContent=c.transport;$('remaining').textContent=c.remaining;$('completed').textContent=c.completed;
   const pct=Math.round(c.completed/hs.quantity*100);$('completion-percent').textContent=pct+'%';$('completion-bar').style.width=pct+'%';
  }
  const ready=HostBridge.online&&['idle','done'].includes(hs?.status);
  ['quantity','plus','minus','start'].forEach(id=>$(id).disabled=!ready);
  $('run-status').textContent=!HostBridge.online?'호스트 연결 대기':hs?.status==='waiting'?'호스트 다음 지시 대기':hs?.status==='paused'?'호스트 일시정지':hs?.status==='done'?'호스트 주문 완료':playing?'호스트 단계 실행 중':'호스트 주문 대기';
 }else{$('play').disabled=false;$('reset').disabled=false;}
 const key=plan?`${plan.quantity}:${s.events.length}`:'idle';
 if(key!==lastEventKey){lastEventKey=key;$('event-count').textContent=s.events.length+'건';$('event-log').innerHTML=s.events.length?[...s.events].reverse().map(e=>`<div class="event-row ${['order','dispatch','pallet_end','complete'].includes(e.kind)?'counter':''}"><time>${formatTime(e.time)}</time><i class="event-dot"></i><span>${e.text}</span><span class="tag">${e.kind.toUpperCase()}</span></div>`).join(''):'<div class="empty-log">주문을 시작하면 장비 동작과 카운트 변경 이력이 표시됩니다.</div>';}
}
function applyHostState(state){
 playing=false;
 if(!HostBridge.enabled){const p=quantityPolicy();$('quantity').min=p.quantity_min;$('quantity').max=p.quantity_max;$('quantity').value=p.quantity_default||2;delete $('quantity').dataset.policy;reset();return;}
 if(!state){render();return;}
 if(state.order_policy){const p=state.order_policy;$('quantity').min=p.quantity_min;$('quantity').max=p.quantity_max;const key=JSON.stringify(p);if(!state.quantity&&$('quantity').dataset.policy!==key)$('quantity').value=p.quantity_default;$('quantity').dataset.policy=key;}
 if(!state.quantity){plan=null;time=0;lastEventKey='';}
 else{
  if(!plan||plan.hostOrder!==state.order_id){plan=RobotSimulation.makePlan(state.quantity,state.simulation_config||SimulationSettings.defaults);stages=RobotSimulation.stagesFor(state.quantity,plan.config);manualMode=false;manualTarget=null;plan.hostOrder=state.order_id;time=state.time;following=true;lastEventKey='';}
  time=Math.max(time,state.time);
  playing=HostBridge.online&&state.status==='running';
 }
 render();
}
function frame(now){
 if(lastFrame&&playing&&plan){
  const limit=HostBridge.enabled?(HostBridge.state?.command?.target_time??time):manualMode?(manualTarget??time):plan.duration;
  time=Math.min(limit,time+Math.min((now-lastFrame)/1000,.2)*speed);
  if(time>=limit){playing=false;if(HostBridge.enabled)HostBridge.complete();}
  render();
 }
 lastFrame=now;requestAnimationFrame(frame);
}
if(window.SYSTEM_ORDER_POLICY){const p=window.SYSTEM_ORDER_POLICY;$('quantity').min=p.quantity_min;$('quantity').max=p.quantity_max;$('quantity').value=p.quantity_default;}
render();HostBridge.init(applyHostState);requestAnimationFrame(frame);

// Preserve the teammate telemetry contract: quantity/product strings, playing boolean.
window.RosTelemetry?.init(()=>({quantity:$('quantity').value,playing,product:$('product').value}));
