/* Host reports drive the dashboard; robot-stop.js handles direct M1/M2 stop requests. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const names={M1:'M1',M2:'M2',warehouse:'자재창고',production:'제작공정'};
 const components={M1:'이동 로봇',M2:'이동 로봇',warehouse:'자재 공급 · 로봇팔 1',production:'로봇팔 2·3 · 리니어 · 카메라'};
 const labels={unknown:'확인 불가',offline:'연결 끊김',idle:'대기',running:'작업 중',done:'완료',failed:'오류'};
 const orderLabels={idle:'주문 대기',running:'작업 중',waiting:'다음 지시 대기',paused:'일시정지',done:'주문 완료',failed:'오류'};
 const productButtons=[...document.querySelectorAll('[data-product-type]')],quantityButtons=[...document.querySelectorAll('[data-quantity]')];
 const canMove=(data,device)=>data?.manual_move_available?.[device]??data?.can_manual_move;
 const destinations={GO_TO_MAT:'자재창고',GO_TO_ASM:'조립대',GO_TO_REST:'대기장소',GO_TO_PARK:'지정 주차장'};
 let fullResetSelection=null,layoutMode=null,batchSelection=null;
 let recovery=null,parkedSelection=null,autoDraftKey=null,resetRobot=null,resetSelection=null,robotControls=null,resetOutcome='';
 $('auto-advance').checked=true;
 let resetOrderId=null,current=null,busy=false,polling=false,productType='A',quantity=2,selectionInitialized=false,logTarget='host',logSignature='';
 const list=$('device-list');
 for(const [key,name] of Object.entries(names)){
  const item=document.createElement('article');item.className='device-item';item.id='device-'+key;
  const header=document.createElement('header'),title=document.createElement('strong'),state=document.createElement('p'),connection=document.createElement('span'),dot=document.createElement('i'),connectionText=document.createElement('span'),caption=document.createElement('p'),detail=document.createElement('p'),button=document.createElement('button');
  title.textContent=name;state.className='device-work-state';state.textContent='작업 · 확인 불가';
  connection.className='device-connection';connection.dataset.deviceConnection=key;connection.dataset.state='waiting';connection.setAttribute('role','status');dot.className='connection-dot';dot.setAttribute('aria-hidden','true');connectionText.className='connection-text';connectionText.textContent='확인 중';connection.append(dot,connectionText);
  caption.className='device-components';caption.textContent=components[key];detail.className='device-detail';detail.textContent='Host 보고 대기';
  button.type='button';button.className='log-button';button.textContent='로그';button.setAttribute('aria-label',name+' 로그 보기');button.onclick=()=>openLog(key);
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
   errorReset.textContent='이동 초기화';errorReset.setAttribute('aria-label',key+' 이동 초기화');errorReset.disabled=true;
   errorReset.title='해당 로봇의 오류 잠금만 해제하고 실패 단계와 완료 수량을 유지합니다.';
   errorReset.onclick=()=>openReset(key);
   controls.append(label,buttons,status);item.append(controls);
   const move=document.createElement('div'),select=document.createElement('select'),send=document.createElement('button'),hint=document.createElement('p');
   move.className='manual-move-control';select.dataset.moveDestination=key;select.setAttribute('aria-label',key+' 수동 이동 목적지');
   for(const [value,text] of Object.entries(destinations)){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
   send.type='button';send.dataset.moveRobot=key;send.textContent='이동';send.setAttribute('aria-label',key+' 수동 이동');send.disabled=true;
   send.onclick=()=>openRecovery('manual_move',{device:key,destination:select.value});
   hint.className='subtle';hint.dataset.moveStatus=key;hint.textContent='장치 연결·작업 상태 확인';
   move.append(select,send,hint);item.append(move);
   const parked=document.createElement('button'),parkedHint=document.createElement('p');
   parked.type='button';parked.dataset.parkedRobot=key;parked.disabled=true;
   parked.textContent='주차 위치 재설정';parked.setAttribute('aria-label',key+' 주차 위치로 옮긴 후 준비');
   parked.onclick=()=>openParked(key);
   parkedHint.className='subtle';parkedHint.dataset.parkedStatus=key;
   const recoveryTools=document.createElement('details'),recoveryTitle=document.createElement('summary');recoveryTools.className='device-recovery';recoveryTitle.textContent='복구·위치 설정';recoveryTools.append(recoveryTitle,errorReset,parked,parkedHint);item.append(recoveryTools);
  }
  list.append(item);
 }
 function alert(text,ok=false){$('control-alert').hidden=ok;$('control-alert').textContent=text;$('control-alert').classList.toggle('ok',ok);}
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
  const modeKey=data.manual_inspection?'manual':'production';
  if(data.bridge_connected&&layoutMode!==modeKey){layoutMode=modeKey;document.body.dataset.controlMode=modeKey;$('order-panel').open=modeKey!=='manual';}
  $('control-alert').hidden=!!data.bridge_connected;
  if(resetOutcome&&!busy&&data.order?.id&&data.order.id!==current?.order?.id)resetOutcome='';
  current=data;
  const fullResetAllowed=!!data.bridge_connected&&!busy&&!data.pending_commands&&!!data.can_full_reset;
  $('full-reset').disabled=!fullResetAllowed;
  $('full-reset-parked').disabled=data.runtime_mode!=='hardware'||!data.supports_parked_full_reset;
  $('full-reset').title=fullResetAllowed?'팔·리니어 초기 위치 및 M1·M2 주차 복귀':'장치 연결·모든 작업 종료 확인 후 사용';
  const fullResetCurrent=fullResetSelection&&fullResetSelection.order_id===(data.order?.id??null)&&fullResetSelection.recovery_revision===data.manual_revision;
  $('confirm-full-reset').disabled=!fullResetAllowed||!fullResetCurrent;
  $('full-reset-note').textContent=fullResetCurrent&&fullResetAllowed?'실제 이동이 시작됩니다.':'상태가 바뀌었거나 작업 중입니다. 창을 닫고 다시 확인하세요.';
  const fr=data.full_reset;
  window.hostInitialPreparationBusy=!!fr&&(fr.status==='running'||fr.uncertain);
  $('full-reset-progress').hidden=!fr;
  $('full-reset-label').textContent=fr?(fr.status==='done'?'전체 초기 준비 완료':fr.status==='failed'?'전체 초기화 중단':`전체 초기화 ${Math.min(fr.step+1,fr.total)}/${fr.total} · ${fr.label}`):'';
  $('full-reset-detail').textContent=fr?(fr.error||(fr.status==='done'?'팔1·2·3 초기 자세 · 리니어 바깥쪽 · M1·M2 지정 주차 완료':'단계별 완료 응답 확인 중 · 다른 이동 지시 보류'))+(fr.uncertain?' · 장치 결과 미확인, 현장 확인 필요':''):'';
  $('cancel-full-reset-run').hidden=fr?.status!=='running';
  $('cancel-full-reset-run').disabled=!data.bridge_connected||busy||!!data.pending_commands;

  const prepareAllowed=!!data.bridge_connected&&!busy&&!data.pending_commands&&!!data.can_prepare_parked;
  for(const key of ['M1','M2']){
   document.querySelector(`[data-parked-robot="${key}"]`).disabled=!prepareAllowed;
   document.querySelector(`[data-parked-status="${key}"]`).textContent=data.manual_move?.command==='PREPARE_PARKED'&&data.manual_move.device===key
    ?(data.manual_move.failed?'준비 결과 미확인 · Host 로그 확인':'주차 위치·센서·모터 준비 중')
    :prepareAllowed?'직접 주차 위치·방향에 놓은 뒤 사용 · 이동 목표 없음':'주문 초기화 및 다른 작업 종료 후 사용';
  }
  const parkedCurrent=parkedSelection&&parkedSelection.order_id===(data.order?.id??null)
    &&parkedSelection.recovery_revision===(data.manual_revision||0);
  $('confirm-parked').disabled=!prepareAllowed||!parkedCurrent;
  $('parked-note').textContent=prepareAllowed&&parkedCurrent?'선택한 로봇만 준비합니다.':'주문·연결·작업 상태가 변경됐습니다. 창을 닫고 다시 확인하세요.';
  for(const key of ['M1','M2']){
   const button=document.querySelector(`[data-error-reset-robot="${key}"]`);
   button.disabled=!data.bridge_connected||busy||data.pending_commands>0||!(data.movement_reset_available?.[key]);
   button.title=button.disabled?'작업 종료·Host 연결 확인 후 사용':'남은 이동 작업·정지 잠금 해제 · 위치 좌표 유지';
  }
  const connected=!!data.bridge_connected,order=data.order;
  $('bridge-pill').textContent=connected?(data.manual_inspection?'수동 점검':data.runtime_mode==='mock'?'모의 장치 · 실물 연결 없음':'실물 관제 · 연결됨'):data.bridge_configured?'ROS Host 보고 끊김':'ROS Host 어댑터 미설정';
  $('bridge-pill').classList.toggle('connected',connected);
  alert(connected?(data.manual_inspection?'수동 점검 모드 · 다른 장치의 연결·공정 완료 조건 없이 개별 이동 가능. 전체 공정은 hostrun에서 실행하세요.':'Host 어댑터에서 작업 결과를 수신하고 있습니다.'):data.bridge_configured?'Host 어댑터 보고가 끊겼습니다. 다음 지시를 보류합니다.':'ROS 2 Host 어댑터가 연결되지 않아 주문·작업 로그를 기다립니다. 장치 연결 표시등은 별도로 확인합니다.',connected);
  const policy=quantityPolicy();
  if(!selectionInitialized){quantity=policy.default;selectionInitialized=true;}
  quantity=Math.max(policy.min,Math.min(policy.max,quantity));
  const status=order?.status||'idle',locked=busy||data.pending_commands>0||!!order&&!['idle','done'].includes(status);
  if(order&&!['idle','done'].includes(status)){productType=order.product_type||'A';quantity=order.quantity;}
  paintSelection(locked);
  const queued=!!data.supports_order_queue;
  for(const field of document.querySelectorAll('[data-legacy-order]'))field.hidden=queued;
  $('mixed-order-fields').hidden=!queued;
  const continuous=!!data.supports_continuous_orders;
  for(const p of ['A','B']){
   const field=$('quantity-'+p),limit=continuous&&!data.can_start?(data.remaining_capacity?.[p]??0):2;
   for(const option of field.options)option.disabled=Number(option.value)>limit;
   if(Number(field.value)>limit)field.value=String(limit);
   field.disabled=busy||!!data.pending_commands||!connected||!(data.can_start||data.can_enqueue)||limit===0;
  }
  $('order-queue-panel').hidden=!queued;
  const batches=data.pending_batches||[];
  $('order-queue-summary').textContent=(order?'현재 묶음 '+(order.products||Array(order.quantity).fill(order.product_type)).join(' + ')+' · ':'')+(batches.length?'대기 '+batches.reduce((n,b)=>n+b.products.length,0)+'개 · '+batches.map((b,i)=>(i+1)+'차 '+b.products.join(' + ')).join(' → '):'대기 주문 없음');
  if(continuous){
   $('order-queue-summary').textContent=(order?'주문 '+(order.products||[]).join(' → '):'새 주문')+(batches.length?' · 이전 방식의 대기 주문 '+batches.reduce((n,b)=>n+b.products.length,0)+'개가 남아 있습니다. 삭제 후 새 주문을 시작하세요.':'');
   $('order-limit-note').textContent='A 최대 2개 · B 최대 2개 · '+(data.can_enqueue?'추가 가능 A '+data.remaining_capacity.A+'개 / B '+data.remaining_capacity.B+'개':'최대 4개 연속 생산');
  }
  $('next-batch').hidden=continuous;
  $('clear-queue').hidden=continuous&&!batches.length;
  $('clear-queue').textContent=continuous?'이전 대기 주문 삭제':'대기 주문 삭제';
  $('next-batch').disabled=busy||!!data.pending_commands||!connected||!data.can_next_batch;
  $('clear-queue').disabled=busy||!!data.pending_commands||!connected||!batches.length;
  $('batch-confirm').disabled=$('next-batch').disabled||!$('batch-confirmed').checked||!batchSelection||batchSelection.queue_revision!==data.queue_revision||batchSelection.order_id!==(order?.id??null);
  $('auto-advance').disabled=queued?(busy||!!data.pending_commands):locked;
  if(connected&&!queued){
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
  $('retry-order').disabled=!!window.hostDeviceErrorResetBusy||!connected||busy||data.pending_commands>0||!data.can_retry;
  const sameRecovery=recovery&&(order?.id??null)===recovery.order_id&&(order?.stage??0)===recovery.stage
   &&(order?order.recovery_revision||0:data.manual_revision||0)===recovery.recovery_revision;
  const recoveryAllowed=!window.hostDeviceErrorResetBusy&&connected&&!busy&&!data.pending_commands&&sameRecovery&&(recovery.action==='retry'?data.can_retry:canMove(data,recovery.device));
  $('confirm-recovery').disabled=!recoveryAllowed;
  $('recovery-dialog-note').textContent=recoveryAllowed?'': '주문·연결·진행 상태가 변경되었습니다. 창을 닫고 상태를 다시 확인하세요.';
  for(const key of ['M1','M2']){
   const allowed=connected&&!busy&&!data.pending_commands&&canMove(data,key);
   document.querySelector(`[data-move-robot="${key}"]`).disabled=!allowed;
   document.querySelector(`[data-move-destination="${key}"]`).disabled=!allowed;
   document.querySelector(`[data-move-status="${key}"]`).textContent=data.manual_move?.device===key
     ?data.manual_move.command==='PREPARE_PARKED'?'주차 준비 중'
      :`${destinations[data.manual_move.command]||data.manual_move.command} · ${data.manual_move.failed?'정지·최종 응답 확인 중':'이동 결과 대기'}`
     :allowed?(status==='failed'?'실패 복구용 · 주문 단계와 수량 유지':'목적지 선택 후 이동')
       :!connected?'Host 연결 확인 후 사용':data.manual_move?'수동 이동 종료 후 사용':'장치 연결·작업 상태 확인';
  }
  $('reset-order').hidden=status!=='failed';
  $('reset-order').disabled=!connected||busy||data.pending_commands>0||!data.can_reset;
  $('reset-order').title=data.can_reset?'현장 확인 후 실패 주문을 초기화합니다.':'장치 연결 또는 이전 지시 응답 확인 필요';
  $('confirm-reset').disabled=!connected||busy||!(resetRobot?data.movement_reset_available?.[resetRobot]:data.can_reset)||(order?.id??null)!==resetOrderId||(resetRobot&&data.manual_revision!==resetSelection?.revision);
  $('reset-dialog-note').textContent=(order?.id??null)!==resetOrderId?'주문이 변경되었습니다. 창을 닫고 다시 확인하세요.':!(resetRobot?data.movement_reset_available?.[resetRobot]:data.can_reset)?'장치 연결 또는 이전 지시 응답을 확인한 뒤 초기화할 수 있습니다.':'';
  $('start-order').disabled=queued?(!connected||busy||!!data.pending_commands||(!(data.can_start||data.can_enqueue)||Number($('quantity-A').value)+Number($('quantity-B').value)===0)):(!connected||locked||data.can_start===false);
  $('start-order').textContent=queued&&!data.can_start?'주문 추가':'주문 시작';
  if(queued&&order)$('order-id').textContent='현재 묶음 · '+(order.products||Array(order.quantity).fill(order.product_type)).join(' + ');
  $('next-stage').disabled=!!window.hostDeviceErrorResetBusy||!connected||busy||data.pending_commands>0||!(status==='failed'?data.can_retry:data.can_advance);
  $('next-stage').textContent=status==='failed'?'다음 단계 · 실패 작업 재시도':'다음 단계';
  $('pause-order').disabled=window.hostInitialPreparationBusy||!connected||busy||data.pending_commands>0||order?.pause_requested&&status!=='paused'||!['running','waiting','paused'].includes(status);
  $('pause-order').textContent=status==='paused'?'재개':order?.pause_requested?'현재 동작 완료 대기':'단계 후 일시정지';
  $('command-note').textContent=data.pending_commands?`Host 어댑터 지시 수락 대기 · ${data.pending_commands}건`:order?.plan_mode==='parallel-v1'?'선행 작업 완료 후 병렬 진행 · 공용 통로는 이동로봇 1대만 사용':'';
  if(order?.pause_requested&&status==='running')$('command-note').textContent='실행 중인 모든 작업의 완료 Result를 기다립니다. 새 작업은 시작하지 않습니다.';
  if(order?.fault){$('command-note').textContent=order.fault;alert(order.fault);}
  if(data.manual_move)$('command-note').textContent=data.manual_move.command==='PREPARE_PARKED'
   ?`${data.manual_move.device} 주차 준비 ${data.manual_move.failed?'결과 미확인 · Host 로그 확인':'중 · 완료 전 다른 작업 보류'}`
   :`${data.manual_move.device} 수동 이동 중 · 재시도와 다른 이동은 결과 확인 후 가능`;
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
  if(current?.supports_order_queue){
   const quantities={A:Number($('quantity-A').value),B:Number($('quantity-B').value)};
   if(!quantities.A&&!quantities.B)return alert('제품 수량을 1개 이상 선택하세요.');
   return issue(current.can_start?'start':'enqueue',{quantities,auto_advance:$('auto-advance').checked});
  }
  const policy=quantityPolicy();
  if(!['A','B'].includes(productType))return alert('A제품 또는 B제품을 선택하세요.');
  if(!Number.isInteger(quantity)||quantity<policy.min||quantity>policy.max)return alert('주문 수량은 1~2 사이의 정수로 선택하세요.');
  issue('start',{product_type:productType,quantity,...($('auto-advance').checked?{}:{auto_advance:false})});
 };
 $('next-batch').onclick=()=>{if($('next-batch').disabled)return;batchSelection={order_id:current.order?.id??null,queue_revision:current.queue_revision};$('batch-confirmed').checked=false;paint(current);$('batch-dialog').showModal();};
 $('batch-confirmed').onchange=()=>paint(current);
 $('batch-cancel').onclick=()=>$('batch-dialog').close();
 $('batch-confirm').onclick=()=>{if($('batch-confirm').disabled)return;$('batch-dialog').close();issue('next_batch',{...batchSelection,operator_confirmed:true});};
 $('clear-queue').onclick=()=>{if(!$('clear-queue').disabled&&confirm('진행 중인 묶음은 유지하고 대기 주문만 삭제할까요?'))issue('clear_queue',{order_id:current.order?.id??null,queue_revision:current.queue_revision,operator_confirmed:true});};
 $('next-stage').onclick=()=>{if($('next-stage').disabled)return;if(current?.order?.status==='failed')openRecovery('retry');else issue('next');};
 $('pause-order').onclick=()=>issue(current?.order?.status==='paused'?'resume':'pause');
 $('host-log').onclick=()=>openLog('host');
 $('full-reset').onclick=()=>{if($('full-reset').disabled)return;fullResetSelection={order_id:current.order?.id??null,recovery_revision:current.manual_revision};$('full-reset-confirmed').checked=false;$('full-reset-parked').checked=false;paint(current);$('full-reset-dialog').showModal();};
 $('cancel-full-reset').onclick=()=>$('full-reset-dialog').close();
 $('full-reset-form').onsubmit=event=>{event.preventDefault();if(!$('full-reset-confirmed').checked||$('confirm-full-reset').disabled||$('full-reset-parked').checked&&$('full-reset-parked').disabled)return;const parked=$('full-reset-parked').checked;$('full-reset-dialog').close();issue('full_reset',{...fullResetSelection,operator_confirmed:true,...(parked?{amrs_parked:true}:{})});};
 $('cancel-full-reset-run').onclick=()=>{if(current?.full_reset?.status==='running')issue('cancel_full_reset',{reset_id:current.full_reset.id});};

 function openParked(device){
  if(!current?.can_prepare_parked||busy||current.pending_commands)return;
  parkedSelection={device,order_id:current.order?.id??null,recovery_revision:current.manual_revision||0};
  $('parked-title').textContent=device+' 주차 위치로 옮긴 후 준비';
  $('parked-confirmed').checked=false;paint(current);$('parked-dialog').showModal();
 }
 $('cancel-parked').onclick=()=>$('parked-dialog').close();
 $('parked-form').onsubmit=event=>{
  event.preventDefault();
  if(!$('parked-confirmed').checked||$('confirm-parked').disabled)return;
  $('parked-dialog').close();issue('prepare_parked',{...parkedSelection,operator_confirmed:true});
 };
 function openRecovery(action,extra={}){
  const order=current?.order;
  if(window.hostDeviceErrorResetBusy||!current||!(action==='retry'?order&&current.can_retry:canMove(current,extra.device)))return;
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
  if(window.hostDeviceErrorResetBusy||!$('recovery-confirmed').checked||$('confirm-recovery').disabled)return;
  const {action,...payload}=recovery;$('recovery-dialog').close();issue(action,{...payload,operator_confirmed:true});
 };
 function openReset(robot=null){
  if(!(robot?current?.movement_reset_available?.[robot]:current?.can_reset)||busy)return;
  resetRobot=robot;resetOrderId=current.order?.id??null;
  resetSelection={revision:current.manual_revision};
  $('reset-title').textContent=robot?robot+' 이동 초기화':'실패 주문 초기화';
  $('reset-description').textContent=robot?robot+'의 정지 응답을 확인하고 남은 이동 작업·정지 잠금을 해제합니다. 실패 주문의 단계와 완료 수량은 유지합니다.':'실패 기록을 보관하고 현재 주문과 대기 주문을 비웁니다. 정지 여부가 미확인된 실패 장치는 정지 응답을 받은 뒤 초기화합니다.';
  $('reset-effect').textContent=robot?'위치 좌표와 Nav2는 재설정하지 않습니다. 새 이동은 별도로 실행하세요.':'로봇 이동·모터 활성화·정지 잠금 해제·주차 좌표 재설정은 하지 않습니다.';
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
  issue('reset_movement',{device:resetRobot,order_id:resetOrderId,recovery_revision:resetSelection.revision,operator_confirmed:true});
 };
 refresh();setInterval(refresh,1000);
})();
