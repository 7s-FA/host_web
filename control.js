/* Host-only dashboard. It does not import the simulation engine or send robot commands. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const names={burger1:'버거 1',burger2:'버거 2',arm1:'로봇팔 1 · 자재창고',arm2:'로봇팔 2 · 제작공정',arm3:'로봇팔 3 · 리니어/파렛트'};
 const labels={unknown:'확인 불가',offline:'연결 끊김',idle:'대기',running:'작업 중',done:'완료',failed:'오류'};
 const orderLabels={idle:'주문 대기',running:'작업 중',waiting:'다음 지시 대기',paused:'일시정지',done:'주문 완료',failed:'오류'};
 const list=$('device-list');
 for(const [key,name] of Object.entries(names)){
  const item=document.createElement('article');item.className='device-item';item.id='device-'+key;
  const header=document.createElement('header'),dot=document.createElement('i'),title=document.createElement('strong'),state=document.createElement('span'),detail=document.createElement('p');
  title.textContent=name;state.textContent='확인 불가';detail.textContent='Host 보고 대기';header.append(dot,title,state);item.append(header,detail);list.append(item);
 }
 let current=null,busy=false,polling=false;
 function alert(text,ok=false){$('control-alert').textContent=text;$('control-alert').classList.toggle('ok',ok);}
 function paint(data){
  current=data;
  const connected=!!data.bridge_connected,order=data.order;
  $('bridge-pill').textContent=connected?'ROS Host 보고 수신 중':data.bridge_configured?'ROS Host 보고 끊김':'ROS Host 어댑터 미설정';
  $('bridge-pill').classList.toggle('connected',connected);
  alert(connected?'Host가 장치 상태를 보고하고 있습니다.':data.bridge_configured?'Host 보고가 끊겼습니다. 다음 지시를 보류합니다.':'로컬 서버의 ROS 2 Host 어댑터가 연결되지 않았습니다. 화면에는 실장치 결과만 표시됩니다.',connected);
  const policy=data.order_policy||{quantity_min:1,quantity_max:20,quantity_default:2};
  $('quantity').min=policy.quantity_min;$('quantity').max=policy.quantity_max;
  if(!$('quantity').dataset.initialized){$('quantity').value=policy.quantity_default;$('quantity').dataset.initialized='1';}
  const status=order?.status||'idle';$('order-status').textContent=orderLabels[status]||'주문 없음';$('order-status').className='status-tag '+status;
  $('order-id').textContent='주문 ID '+(order?.id||'—');
  $('stage-number').textContent=order?`${order.stage} / ${order.stage_count}`:'—';
  $('transport-count').textContent=order?.transport_remaining??'—';$('product-count').textContent=order?.product_remaining??'—';$('completed-count').textContent=order?.completed??'—';
  $('start-order').disabled=!connected||busy||data.pending_commands>0||!!order&&!['idle','done'].includes(status);
  $('next-stage').disabled=!connected||busy||!data.can_advance;
  $('pause-order').disabled=!connected||busy||data.pending_commands>0||!['running','paused'].includes(status);
  $('pause-order').textContent=status==='paused'?'재개':'일시정지';
  $('command-note').textContent=data.pending_commands?`Host 어댑터 지시 수락 대기 · ${data.pending_commands}건`:'장치 완료와 선행 조건은 Host가 판정합니다.';
  for(const key of Object.keys(names)){
   const item=$('device-'+key),value=data.devices?.[key]||{state:'unknown',detail:'Host 보고 대기'};
   item.dataset.state=value.state;item.querySelector('span').textContent=labels[value.state]||'확인 불가';item.querySelector('p').textContent=value.detail||'—';
  }
  const conditions=$('condition-list');conditions.replaceChildren();
  if(!data.conditions?.length){const li=document.createElement('li');li.textContent='Host의 완료 조건 보고를 기다립니다.';conditions.append(li);}
  else for(const condition of data.conditions){const li=document.createElement('li'),dot=document.createElement('i'),label=document.createElement('span');li.className=condition.done?'done':'';label.textContent=condition.label;li.append(dot,label);conditions.append(li);}
  $('advance-tag').textContent=data.can_advance?'다음 단계 가능':'조건 확인 대기';$('advance-tag').className=data.can_advance?'ready':'';
  const log=$('live-log');log.replaceChildren();for(const entry of (data.log?.length?data.log:['Host 보고 대기']).slice(-12)){const li=document.createElement('li');li.textContent=entry;log.append(li);}
 }
 async function refresh(){
  if(polling)return;polling=true;
  try{const response=await fetch('/api/live/state',{cache:'no-store'});if(!response.ok)throw Error('로컬 Host API를 사용할 수 없습니다.');paint(await response.json());}
  catch(error){current=null;paint({bridge_configured:false,bridge_connected:false});alert('관제 화면은 Host PC에서 서버를 실행한 뒤 127.0.0.1:8082/control.html로 접속하세요.');}
  finally{polling=false;}
 }
 async function issue(action,data={}){
  if(busy)return;busy=true;if(current)paint(current);let errorText='';
  try{const response=await fetch('/api/live/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const body=await response.json();if(!response.ok)throw Error(body.error||'지시 실패');paint(body);}
  catch(error){errorText=error.message;}
  finally{busy=false;if(current)paint(current);if(errorText)alert(errorText);}
 }
 $('start-order').onclick=()=>{const quantity=Number($('quantity').value);issue('start',{quantity});};
 $('next-stage').onclick=()=>issue('next');
 $('pause-order').onclick=()=>issue(current?.order?.status==='paused'?'resume':'pause');
 refresh();setInterval(refresh,1000);
})();
