/* Host reports drive the dashboard; robot-stop.js handles direct M1/M2 stop requests. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const names={M1:'M1',M2:'M2',warehouse:'자재창고',production:'제작공정'};
 const components={M1:'이동 로봇',M2:'이동 로봇',warehouse:'자재 공급 · 로봇팔 1',production:'로봇팔 2·3 · 리니어 · 카메라'};
 const labels={unknown:'확인 불가',offline:'연결 끊김',idle:'대기',running:'작업 중',done:'완료',failed:'오류'};
 const orderLabels={idle:'주문 대기',running:'작업 중',waiting:'다음 지시 대기',paused:'일시정지',done:'주문 완료',failed:'오류'};
 const productButtons=[...document.querySelectorAll('[data-product-type]')],quantityButtons=[...document.querySelectorAll('[data-quantity]')];
 const destinations={GO_TO_MAT:'자재창고',GO_TO_ASM:'조립대',GO_TO_REST:'대기장소',GO_TO_PARK:'지정 주차장'};
 let recovery=null,autoDraftKey=null,resetRobot=null,resetSelection=null,robotControls=null,resetOutcome='';
 $('auto-advance').checked=true;
 let resetOrderId=null,current=null,busy=false,polling=false,productType='A',quantity=2,selectionInitialized=false,logTarget='host',logSignature='';
 const list=$('device-list');
 for(const [key,name] of Object.entries(names)){
  const item=document.createElement('article');item.className='device-item';item.id='device-'+key;
  const header=document.createElement('header'),title=document.createElement('strong'),state=document.createElement('p'),connection=document.createElement('span'),dot=document.createElement('i'),connectionText=document.createElement('span'),caption=document.createElement('p'),detail=document.createElement('p'),button=document.createElement('button');
  title.textContent=name;state.className='device-work-state';state.textContent='작업 · 확인 불가';
  connection.className='device-connection';connection.dataset.deviceConnection=key;connection.dataset.state='waiting';connection.setAttribute('role','status');dot.className='connection-dot';dot.setAttribute('aria-hidden','true');connectionText.className='connection-text';connectionText.textContent='확인 중';connection.append(dot,connectionText);
  caption.className='device-components';caption.textContent=components[key];detail.className='device-detail';detail.textContent='Host 보고 대기';
  button.type='button';button.className='log-button';button.textContent='로그 보기 ↗';button.setAttribute('aria-label',name+' 로그 보기');button.onclick=()=>openLog(key);
  const workRow=document.createElement('div');workRow.className='device-work-row';workRow.append(state,button);
  header.append(title,connection);item.append(header,caption,workRow,detail);
  if(key==='M1'||key==='M2'){
   const batteryRow=document.createElement('div'),batteryLabel=document.createElement('span'),battery=document.createElement('p');
   batteryRow.className='robot-battery-control';batteryLabel.textContent='실제 배터리';battery.className='robot-battery';battery.dataset.batteryRobot=key;battery.setAttribute('role','status');battery.textContent='배터리 수신 대기';
   batteryRow.append(batteryLabel,battery);item.append(batteryRow);
   const controls=document.createElement('div'),label=document.createElement('span'),stop=document.createElement('button'),restart=document.createElement('button'),buttons=document.createElement('div'),status=document.createElement('p');
   controls.className='robot-stop-control';label.className='robot-stop-label';label.textContent='실제 로봇 정지';
   stop.type='button';stop.className='robot-stop-button';stop.dataset.stopRobot=key;stop.textContent=key+' 정지';stop.setAttribute('aria-label','실제 '+key+' 정지');stop.disabled=true;
   restart.type='button';restart.className='robot-restart-button';restart.dataset.restartRobot=key;restart.textContent=key+' 정지 해제';restart.setAttribute('aria-label','실제 '+key+' 정지 해제');restart.disabled=true;
   buttons.className='robot-stop-buttons';buttons.append(stop,restart);
   status.className='robot-stop-status';status.dataset.stopStatus=key;status.setAttribute('role','status');status.textContent='정지 연결 확인 중';
   const errorReset=document.createElement('button');
   errorReset.type='button';errorReset.className='robot-error-reset-button';errorReset.dataset.errorResetRobot=key;
   errorReset.textContent=key+' 이동 오류 초기화';errorReset.disabled=true;
   errorReset.title='해당 로봇의 오류 잠금과 실패 주문을 함께 초기화합니다.';
   errorReset.onclick=()=>openReset(key);
   controls.append(label,buttons,errorReset,status);item.append(controls);
   const move=document.createElement('div'),select=document.createElement('select'),send=document.createElement('button'),hint=document.createElement('p');
   move.className='manual-move-control';select.dataset.moveDestination=key;select.setAttribute('aria-label',key+' 수동 이동 목적지');
   for(const [value,text] of Object.entries(destinations)){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
   send.type='button';send.dataset.moveRobot=key;send.textContent=key+' 수동 이동';send.disabled=true;
   send.onclick=()=>openRecovery('manual_move',{device:key,destination:select.value});
   hint.className='subtle';hint.dataset.moveStatus=key;hint.textContent='주문 대기 또는 실패 작업 종료 후 사용';
   move.append(select,send,hint);item.append(move);
  }
  list.append(item);
 }
 function alert(text,ok=false){$('control-alert').textContent=text;$('control-alert').classList.toggle('ok',ok);}
 function quantityPolicy(){
  const p=current?.order_policy||{quantity_min:1,quantity_max:2,quantity_default:2};
  return {min:Math.max(1,Math.min(2,p.quantity_min)),max:Math.min(2,p.quantity_max),default:Math.min(2,p.quantity_default)};
 }
 function paintSelection(locked){
  const policy=quantityPolicy();
  for(const button of productButtons){button.setAttribute('aria-pressed',String(button.dataset.productType===productType));button.disabled=locked;}
  for(const button of quantityButtons){const value=Number(button.dataset.quantity);button.setAttribute('aria-pressed',String(value===quantity));button.disabled=locked||value<policy.min||value>policy.max;}
  $('order-selection').textContent=`${productType}제품 · ${quantity}개 선택`;
 }
 function renderLog(){
  if(!$('log-dialog').open)return;
  const entries=(logTarget==='host'?current?.log:current?.devices?.[logTarget]?.log)||[];
  $('log-dialog-title').textContent=(logTarget==='host'?'Host':names[logTarget])+' 로그';
  $('log-dialog-status').textContent=`최근 ${entries.length}건 · ${current?.bridge_connected?'보고 수신 중':'연결 안 됨 · 마지막 수신 기록'}`;
  $('log-dialog-detail').textContent=logTarget==='host'?$('order-id').textContent:`${components[logTarget]} · ${labels[current?.devices?.[logTarget]?.state]||'확인 불가'}\n${current?.devices?.[logTarget]?.detail||'Host 보고 대기'}`;
  const signature=JSON.stringify(entries);
  if(signature===logSignature)return;
  logSignature=signature;
  const log=$('log-entries');log.replaceChildren();$('log-empty').hidden=entries.length>0;
  for(const entry of entries){const li=document.createElement('li');li.textContent=entry;log.append(li);}
 }
 function openLog(target){logTarget=target;logSignature='';$('log-dialog').showModal();renderLog();}
 function paint(data){
  if(resetOutcome&&!busy&&data.order?.id&&data.order.id!==current?.order?.id)resetOutcome='';
  current=data;
  for(const key of ['M1','M2']){
   const button=document.querySelector(`[data-error-reset-robot="${key}"]`);
   button.disabled=!data.bridge_connected||busy||data.pending_commands>0||!data.can_reset||!robotControls?.robots[key]?.canRestart;
   button.title=button.disabled?'실패 주문·장치 연결·작업 종료 확인 후 사용':'실패 주문 초기화 후 해당 로봇 정지 잠금 해제 · 자동 이동 없음';
  }
  const connected=!!data.bridge_connected,order=data.order;
  $('bridge-pill').textContent=connected?(data.runtime_mode==='mock'?'모의 장치 · 실물 연결 없음':'실물 장치 · ROS Host 보고 수신 중'):data.bridge_configured?'ROS Host 보고 끊김':'ROS Host 어댑터 미설정';
  $('bridge-pill').classList.toggle('connected',connected);
  alert(connected?'Host 어댑터에서 작업 결과를 수신하고 있습니다.':data.bridge_configured?'Host 어댑터 보고가 끊겼습니다. 다음 지시를 보류합니다.':'ROS 2 Host 어댑터가 연결되지 않아 주문·작업 로그를 기다립니다. 장치 연결 표시등은 별도로 확인합니다.',connected);
  const policy=quantityPolicy();
  if(!selectionInitialized){quantity=policy.default;selectionInitialized=true;}
  quantity=Math.max(policy.min,Math.min(policy.max,quantity));
  const status=order?.status||'idle',locked=busy||data.pending_commands>0||!!order&&!['idle','done'].includes(status);
  if(order&&!['idle','done'].includes(status)){productType=order.product_type||'A';quantity=order.quantity;}
  paintSelection(locked);
  $('auto-advance').disabled=locked;
  if(connected){
   if(order&&!['idle','done'].includes(status)){
    $('auto-advance').checked=order.auto_advance!==false;autoDraftKey=null;
   }else{
    const draftKey=order?`${order.id}:${status}`:'new';
    if(autoDraftKey!==draftKey){$('auto-advance').checked=true;autoDraftKey=draftKey;}
   }
  }
  $('order-status').textContent=orderLabels[status]||'주문 없음';$('order-status').className='status-tag '+status;
  $('order-id').textContent=order?`주문 ID ${order.id} · ${order.product_type||'A'}제품 ${order.quantity}개`:'주문 ID —';
  $('stage-number').textContent=order?`${order.stage} / ${order.stage_count}`:'—';
  $('stage-label').textContent=order?.stage_label||'—';
  $('transport-count').textContent=order?.transport_remaining??'—';$('product-count').textContent=order?.product_remaining??'—';$('completed-count').textContent=order?.completed??'—';
  $('retry-order').hidden=status!=='failed';
  $('retry-order').disabled=!connected||busy||data.pending_commands>0||!data.can_retry;
  const sameRecovery=recovery&&(order?.id??null)===recovery.order_id&&(order?.stage??0)===recovery.stage
   &&(order?order.recovery_revision||0:data.manual_revision||0)===recovery.recovery_revision;
  const recoveryAllowed=connected&&!busy&&!data.pending_commands&&sameRecovery&&(recovery.action==='retry'?data.can_retry:data.can_manual_move);
  $('confirm-recovery').disabled=!recoveryAllowed;
  $('recovery-dialog-note').textContent=recoveryAllowed?'': '주문·연결·진행 상태가 변경되었습니다. 창을 닫고 상태를 다시 확인하세요.';
  for(const key of ['M1','M2']){
   const allowed=connected&&!busy&&!data.pending_commands&&data.can_manual_move;
   document.querySelector(`[data-move-robot="${key}"]`).disabled=!allowed;
   document.querySelector(`[data-move-destination="${key}"]`).disabled=!allowed;
   document.querySelector(`[data-move-status="${key}"]`).textContent=data.manual_move?.device===key
     ?`${destinations[data.manual_move.command]||data.manual_move.command} · ${data.manual_move.failed?'정지·최종 응답 확인 중':'이동 결과 대기'}`
     :allowed?(status==='failed'?'실패 복구용 · 주문 단계와 수량 유지':'목적지 선택 → 수동 이동 · 확인 후 출발')
       :!connected?'Host 연결 확인 후 사용':data.manual_move?'수동 이동 종료 후 사용':'주문 대기 또는 실패 작업 종료 후 사용';
  }
  $('reset-order').hidden=status!=='failed';
  $('reset-order').disabled=!connected||busy||data.pending_commands>0||!data.can_reset;
  $('reset-order').title=data.can_reset?'현장 확인 후 실패 주문을 초기화합니다.':'장치 연결 또는 이전 지시 응답 확인 필요';
  $('confirm-reset').disabled=!connected||busy||!data.can_reset||order?.id!==resetOrderId||(resetRobot&&(!robotControls?.robots[resetRobot]?.canRestart||order?.stage!==resetSelection?.stage||(order?.recovery_revision||0)!==resetSelection?.revision));
  $('reset-dialog-note').textContent=order?.id!==resetOrderId?'주문이 변경되었습니다. 창을 닫고 다시 확인하세요.':!data.can_reset?'장치 연결 또는 이전 지시 응답을 확인한 뒤 초기화할 수 있습니다.':'';
  $('start-order').disabled=!connected||locked||data.can_start===false;
  $('next-stage').disabled=!connected||busy||!data.can_advance;
  $('pause-order').disabled=!connected||busy||data.pending_commands>0||order?.pause_requested&&status!=='paused'||!['running','waiting','paused'].includes(status);
  $('pause-order').textContent=status==='paused'?'재개':order?.pause_requested?'현재 동작 완료 대기':'단계 후 일시정지';
  $('command-note').textContent=data.pending_commands?`Host 어댑터 지시 수락 대기 · ${data.pending_commands}건`:order?.plan_mode==='parallel-v1'?'선행 작업 완료 후 병렬 진행 · 공용 통로는 이동로봇 1대만 사용':'장치 완료와 선행 조건은 Host가 판정합니다.';
  if(order?.pause_requested&&status==='running')$('command-note').textContent='실행 중인 모든 작업의 완료 Result를 기다립니다. 새 작업은 시작하지 않습니다.';
  if(order?.fault){$('command-note').textContent=order.fault;alert(order.fault);}
  if(data.manual_move)$('command-note').textContent=`${data.manual_move.device} 수동 이동 중 · 재시도와 다른 이동은 결과 확인 후 가능`;
  if(data.reset_pending){$('command-note').textContent='실패 장치 정지 응답 확인 중 · 초기화 대기';alert('정지 응답 확인 후 실패 주문을 초기화합니다.');}
  for(const key of Object.keys(names)){
   const item=$('device-'+key),value=connected&&data.devices?.[key]||{state:'unknown',detail:'Host 보고 대기'};
   item.dataset.state=value.state;item.querySelector('.device-work-state').textContent='작업 · '+(labels[value.state]||'확인 불가');item.querySelector('.device-detail').textContent=value.detail||'—';item.querySelector('.device-detail').title=value.detail||'—';
  }
  const conditions=$('condition-list');conditions.replaceChildren();
  if(!data.conditions?.length){const li=document.createElement('li');li.textContent='Host의 완료 조건 보고를 기다립니다.';conditions.append(li);}
  else for(const condition of data.conditions){const li=document.createElement('li'),dot=document.createElement('i'),label=document.createElement('span');li.className=condition.done?'done':'';label.textContent=condition.label;li.append(dot,label);conditions.append(li);}
  $('advance-tag').textContent=data.can_advance?'다음 단계 가능':'조건 확인 대기';$('advance-tag').className=data.can_advance?'ready':'';
  $('host-log-summary').textContent=data.latest_event||data.log?.at(-1)||'수신한 Host 로그가 없습니다.';
  if(resetOutcome&&connected)alert(resetOutcome,resetOutcome.includes('초기화 완료 · 자동'));
  renderLog();
 }
 async function refresh(){
  if(polling)return;polling=true;
  try{const response=await fetch('/api/live/state',{cache:'no-store'});if(!response.ok)throw Error('로컬 Host API를 사용할 수 없습니다.');paint(await response.json());}
  catch(error){paint({...current,bridge_connected:false,order:null,conditions:[],can_advance:false});alert('관제 화면은 Host PC에서 서버를 실행한 뒤 127.0.0.1:8082/control.html로 접속하세요.');}
  finally{polling=false;}
 }
 async function issue(action,data={}){
  if(busy)return;resetOutcome='';busy=true;if(current)paint(current);let errorText='';
  try{const response=await fetch('/api/live/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const body=await response.json();if(!response.ok)throw Error(body.error||'지시 실패');paint(body);}
  catch(error){errorText=error.message;}
  finally{busy=false;if(current)paint(current);if(errorText)alert(errorText);}
 }
 for(const button of productButtons)button.onclick=()=>{productType=button.dataset.productType;paintSelection(false);};
 for(const button of quantityButtons)button.onclick=()=>{quantity=Number(button.dataset.quantity);paintSelection(false);};
 $('start-order').onclick=()=>{
  const policy=quantityPolicy();
  if(!['A','B'].includes(productType))return alert('A제품 또는 B제품을 선택하세요.');
  if(!Number.isInteger(quantity)||quantity<policy.min||quantity>policy.max)return alert('주문 수량은 1~2 사이의 정수로 선택하세요.');
  issue('start',{product_type:productType,quantity,...($('auto-advance').checked?{}:{auto_advance:false})});
 };
 $('next-stage').onclick=()=>issue('next');
 $('pause-order').onclick=()=>issue(current?.order?.status==='paused'?'resume':'pause');
 $('host-log').onclick=()=>openLog('host');
 function openRecovery(action,extra={}){
  const order=current?.order;
  if(!current||!(action==='retry'?order&&current.can_retry:current.can_manual_move))return;
  recovery={action,order_id:order?.id??null,stage:order?.stage??0,
   recovery_revision:order?order.recovery_revision||0:current.manual_revision||0,...extra};
  $('recovery-title').textContent=action==='retry'?'실패 단계 재시도':extra.device+' 수동 이동';
  $('recovery-description').textContent=action==='retry'
   ?`${order.plan_mode==='parallel-v1'?'미완료 작업부터 선행 조건에 맞춰 다시 실행합니다.':order.stage_label+'만 다시 실행합니다.'} 완료한 단계와 수량은 유지합니다. ${order.auto_advance!==false?'자동 진행이 켜져 있어 성공 후 다음 단계로 자동 진행합니다.':'수동 진행이므로 성공 후 다음 단계 버튼을 기다립니다.'}`
   :`${extra.device}를 ${destinations[extra.destination]}로 이동합니다. ${order?.status==='failed'
     ?'주문은 실패 상태로 유지됩니다. 재시도 전 공정에 필요한 위치로 복구하세요.'
     :'개별 동작만 실행하며 주문이나 다음 공정을 시작하지 않습니다.'}`;
  $('recovery-start-warning').hidden=action!=='retry';
  $('recovery-confirmed').checked=false;paint(current);$('recovery-dialog').showModal();
 }
 $('retry-order').onclick=()=>openRecovery('retry');
 $('cancel-recovery').onclick=()=>$('recovery-dialog').close();
 $('recovery-form').onsubmit=event=>{
  event.preventDefault();
  if(!$('recovery-confirmed').checked||$('confirm-recovery').disabled)return;
  const {action,...payload}=recovery;$('recovery-dialog').close();issue(action,{...payload,operator_confirmed:true});
 };
 function openReset(robot=null){
  if(!current?.can_reset||busy||(robot&&!robotControls?.robots[robot]?.canRestart))return;
  resetRobot=robot;resetOrderId=current.order.id;
  resetSelection={stage:current.order.stage,revision:current.order.recovery_revision||0};
  $('reset-title').textContent=robot?robot+' 오류·실패 주문 초기화':'실패 주문 초기화';
  $('reset-description').textContent=robot?'실패 주문을 기록에 보관하고 비운 뒤 '+robot+'의 정지 잠금을 해제합니다. 둘 다 확인돼야 완료로 표시합니다.':'실패 기록을 보관하고 주문을 비웁니다. 정지 여부가 미확인된 실패 장치는 정지 응답을 받은 뒤 초기화합니다.';
  $('reset-effect').textContent=robot?'해제 후 자동 이동하지 않습니다. 현재 위치·적재물은 그대로이며 처음부터 시험하려면 초기 배치가 필요합니다.':'로봇 이동·모터 활성화·정지 잠금 해제·주차 좌표 재설정은 하지 않습니다.';
  $('reset-confirmed').checked=false;paint(current);$('reset-dialog').showModal();
 }
 $('reset-order').onclick=()=>openReset();
 $('cancel-reset').onclick=()=>$('reset-dialog').close();
 window.addEventListener('robot-controls-state',event=>{robotControls=event.detail;if(current)paint(current);});
 $('reset-form').onsubmit=async event=>{
  event.preventDefault();
  if(!$('reset-confirmed').checked||$('confirm-reset').disabled)return;
  $('reset-dialog').close();
  if(!resetRobot){issue('reset',{order_id:resetOrderId,operator_confirmed:true});return;}
  const robot=resetRobot,orderId=resetOrderId,selection={...resetSelection};
  busy=true;resetOutcome='초기화 상태 확인 중';paint(current);
  const read=async()=>{const response=await fetch('/api/live/state',{cache:'no-store'});if(!response.ok)throw Error('Host 상태 조회 실패');const state=await response.json();paint(state);return state;};
  try{
   resetOutcome=await CombinedReset.run({robot,orderId,...selection,read,
    reset:async payload=>{const response=await fetch('/api/live/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw Error(result.error||'주문 초기화 거절');},
    release:key=>window.RobotStopControls.release(key),
    progress:message=>{resetOutcome=message;paint(current);}});
  }catch(error){resetOutcome=error.message;}
  finally{busy=false;paint(current);}
 };
 refresh();setInterval(refresh,1000);
})();
