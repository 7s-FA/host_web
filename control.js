/* Host reports drive the dashboard; robot-stop.js handles direct M1/M2 stop requests. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const names={M1:'M1',M2:'M2',warehouse:'자재창고',production:'제작공정'};
 const components={M1:'이동 로봇',M2:'이동 로봇',warehouse:'자재 공급 · 로봇팔 1',production:'로봇팔 2·3 · 리니어 · 카메라'};
 const labels={unknown:'확인 불가',offline:'연결 끊김',idle:'대기',running:'작업 중',done:'완료',failed:'오류'};
 const orderLabels={idle:'주문 대기',running:'작업 중',waiting:'다음 지시 대기',paused:'일시정지',done:'주문 완료',failed:'오류'};
 const productButtons=[...document.querySelectorAll('[data-product-type]')],quantityButtons=[...document.querySelectorAll('[data-quantity]')];
 let current=null,busy=false,polling=false,productType='A',quantity=2,selectionInitialized=false,logTarget='host',logSignature='';
 const list=$('device-list');
 for(const [key,name] of Object.entries(names)){
  const item=document.createElement('article');item.className='device-item';item.id='device-'+key;
  const header=document.createElement('header'),dot=document.createElement('i'),title=document.createElement('strong'),state=document.createElement('span'),caption=document.createElement('p'),detail=document.createElement('p'),button=document.createElement('button');
  title.textContent=name;state.textContent='확인 불가';caption.className='device-components';caption.textContent=components[key];detail.className='device-detail';detail.textContent='Host 보고 대기';
  button.type='button';button.className='log-button';button.textContent='로그 보기 ↗';button.setAttribute('aria-label',name+' 로그 보기');button.onclick=()=>openLog(key);
  header.append(dot,title,state);item.append(header,caption,detail,button);
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
   controls.append(label,buttons,status);item.append(controls);
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
  const signature=JSON.stringify(entries);
  if(signature===logSignature)return;
  logSignature=signature;
  const log=$('log-entries');log.replaceChildren();$('log-empty').hidden=entries.length>0;
  for(const entry of entries){const li=document.createElement('li');li.textContent=entry;log.append(li);}
 }
 function openLog(target){logTarget=target;logSignature='';$('log-dialog').showModal();renderLog();}
 function paint(data){
  current=data;
  const connected=!!data.bridge_connected,order=data.order;
  $('bridge-pill').textContent=connected?'ROS Host 보고 수신 중':data.bridge_configured?'ROS Host 보고 끊김':'ROS Host 어댑터 미설정';
  $('bridge-pill').classList.toggle('connected',connected);
  alert(connected?'Host가 장치 상태를 보고하고 있습니다.':data.bridge_configured?'Host 보고가 끊겼습니다. 다음 지시를 보류합니다.':'로컬 서버의 ROS 2 Host 어댑터가 연결되지 않았습니다. 화면에는 실장치 결과만 표시됩니다.',connected);
  const policy=quantityPolicy();
  if(!selectionInitialized){quantity=policy.default;selectionInitialized=true;}
  quantity=Math.max(policy.min,Math.min(policy.max,quantity));
  const status=order?.status||'idle',locked=busy||data.pending_commands>0||!!order&&!['idle','done'].includes(status);
  if(order&&!['idle','done'].includes(status)){productType=order.product_type||'A';quantity=order.quantity;}
  paintSelection(locked);
  $('order-status').textContent=orderLabels[status]||'주문 없음';$('order-status').className='status-tag '+status;
  $('order-id').textContent=order?`주문 ID ${order.id} · ${order.product_type||'A'}제품 ${order.quantity}개`:'주문 ID —';
  $('stage-number').textContent=order?`${order.stage} / ${order.stage_count}`:'—';
  $('transport-count').textContent=order?.transport_remaining??'—';$('product-count').textContent=order?.product_remaining??'—';$('completed-count').textContent=order?.completed??'—';
  $('start-order').disabled=!connected||locked;
  $('next-stage').disabled=!connected||busy||!data.can_advance;
  $('pause-order').disabled=!connected||busy||data.pending_commands>0||!['running','paused'].includes(status);
  $('pause-order').textContent=status==='paused'?'재개':'일시정지';
  $('command-note').textContent=data.pending_commands?`Host 어댑터 지시 수락 대기 · ${data.pending_commands}건`:'장치 완료와 선행 조건은 Host가 판정합니다.';
  for(const key of Object.keys(names)){
   const item=$('device-'+key),value=connected&&data.devices?.[key]||{state:'unknown',detail:'Host 보고 대기'};
   item.dataset.state=value.state;item.querySelector('span').textContent=labels[value.state]||'확인 불가';item.querySelector('.device-detail').textContent=value.detail||'—';
  }
  const conditions=$('condition-list');conditions.replaceChildren();
  if(!data.conditions?.length){const li=document.createElement('li');li.textContent='Host의 완료 조건 보고를 기다립니다.';conditions.append(li);}
  else for(const condition of data.conditions){const li=document.createElement('li'),dot=document.createElement('i'),label=document.createElement('span');li.className=condition.done?'done':'';label.textContent=condition.label;li.append(dot,label);conditions.append(li);}
  $('advance-tag').textContent=data.can_advance?'다음 단계 가능':'조건 확인 대기';$('advance-tag').className=data.can_advance?'ready':'';
  $('host-log-summary').textContent=data.log?.at(-1)||'수신한 Host 로그가 없습니다.';
  renderLog();
 }
 async function refresh(){
  if(polling)return;polling=true;
  try{const response=await fetch('/api/live/state',{cache:'no-store'});if(!response.ok)throw Error('로컬 Host API를 사용할 수 없습니다.');paint(await response.json());}
  catch(error){paint({...current,bridge_connected:false,order:null,conditions:[],can_advance:false});alert('관제 화면은 Host PC에서 서버를 실행한 뒤 127.0.0.1:8082/control.html로 접속하세요.');}
  finally{polling=false;}
 }
 async function issue(action,data={}){
  if(busy)return;busy=true;if(current)paint(current);let errorText='';
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
  issue('start',{product_type:productType,quantity});
 };
 $('next-stage').onclick=()=>issue('next');
 $('pause-order').onclick=()=>issue(current?.order?.status==='paused'?'resume':'pause');
 $('host-log').onclick=()=>openLog('host');
 refresh();setInterval(refresh,1000);
})();
