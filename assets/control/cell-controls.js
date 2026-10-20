/* Arm Action controls. Opening/reconnecting only subscribes; release is explicit. */
(()=>{
 'use strict';
 const local=location.protocol==='http:'&&['localhost','127.0.0.1'].includes(location.hostname);
 const cells=[{key:'warehouse',arm:'arm1',title:'팔1',note:'해제 시 중단 동작 재개 · 주문 상태는 별도 확인'},
  {key:'production',arm:'arm2',title:'팔2·3',note:'팔2·3 공동 제어 · 리니어는 이 정지에 포함되지 않음'}];
 let socket=null,connected=false,reconnect=null,closed=false,serial=0,arm1=null,arm1At=0,hostState=null,resetBusy=false,hostPolling=false;
 const requests=new Map(),prefix='cell-'+(crypto.randomUUID?.()||Date.now());
 for(const c of cells){
  const card=document.getElementById('device-'+c.key);if(!card)continue;
  const box=document.createElement('div');box.className='cell-control';
  box.innerHTML='<div class="cell-controls"><button type="button" class="cell-stop" disabled>'+c.title+' 정지</button><button type="button" class="cell-release" disabled>정지 해제·재개</button></div><p>'+c.note+'</p><p class="cell-status" role="status"></p>';
  card.append(box);c.stop=box.querySelector('.cell-stop');c.release=box.querySelector('.cell-release');c.status=box.querySelector('.cell-status');
  c.stop.dataset.cellStop=c.key;c.release.dataset.cellRelease=c.key;c.status.dataset.cellStatus=c.key;
  c.graphAt=0;c.available=false;c.paused=false;c.pending=null;c.phase='idle';c.message='ROS 연결 대기';
  c.stop.onclick=()=>issue(c,'EMER_STOP');
  c.release.onclick=()=>{if(!c.release.disabled&&confirm(c.title+' 정지를 해제하면 중단된 동작이 즉시 이어질 수 있습니다. 주변과 자재 상태를 확인했습니까?'))issue(c,'RESTART');};
  {
   c.clear=document.createElement('button');c.clear.type='button';c.clear.className='robot-error-reset-button';
   c.label=c.key==='warehouse'?'자재창고':'조립대';
   c.clear.dataset.cellErrorReset=c.key;c.clear.textContent=c.label+' 오류 초기화';c.clear.disabled=true;
   c.clear.title='멈춘 '+c.title+' 작업과 실패 주문 정리 · 원점 복귀·자동 재개 없음';box.append(c.clear);
   c.clear.onclick=async()=>{
    if(c.clear.disabled||!confirm('모든 로봇·팔·리니어가 멈추고 초기 배치와 자재 상태를 확인했습니까? '+c.label+'의 남은 작업과 실패 주문을 정리합니다. 팔 원점 복귀·공정 재개·M1/M2 잠금 해제는 하지 않습니다.'))return;
    resetBusy=true;paint();
    try{c.message=await CellErrorReset.run({label:c.label,read:readHost,clear:()=>issue(c,'CLEAR_ERROR'),
     reset:async payload=>{const r=await fetch('/api/live/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const b=await r.json();if(!r.ok)throw Error(b.error||'주문 초기화 거절');},
     progress:message=>{c.phase='pending';c.message=message;paint();}});c.phase='success';}
    catch(e){c.phase='error';c.message=e.message;}
    finally{resetBusy=false;paint();}
   };
  }
 }
 async function readHost(){const r=await fetch('/api/live/state',{cache:'no-store'});if(!r.ok)throw Error('Host 상태 조회 실패');hostState=await r.json();return hostState;}
 async function pollHost(){if(hostPolling||closed||!local)return;hostPolling=true;try{await readHost();}catch{hostState=null;}finally{hostPolling=false;paint();}}
 const fresh=c=>connected&&c.available&&Date.now()-c.graphAt>=0&&Date.now()-c.graphAt<3500;
 function paint(){for(const c of cells){
  if(!c.stop)continue;
  c.stop.disabled=!fresh(c)||c.pending?.command==='EMER_STOP';
  const paused=c.key==='warehouse'?arm1?.state==='PAUSED'&&Date.now()-arm1At<3500:c.paused;
  c.release.disabled=!fresh(c)||!!c.pending||!paused||resetBusy;
  if(c.clear)c.clear.disabled=!fresh(c)||!!c.pending||resetBusy||!hostState?.bridge_connected||hostState.pending_commands>0||!!hostState.manual_move||!!hostState.order&&hostState.order.status!=='failed'||c.key==='warehouse'&&(!arm1?.supports_error_reset||Date.now()-arm1At>=3500||!['IDLE','PAUSED','ERROR'].includes(arm1.state));
  c.stop.textContent=c.title+(c.pending?.command==='EMER_STOP'?' 정지 확인 중':' 정지');
  c.release.textContent=c.pending?.command==='RESTART'?'해제 응답 대기':'정지 해제·재개';
  c.status.dataset.phase=c.phase;
  c.status.textContent=!local?'Host PC 로컬 화면에서 사용':c.phase!=='idle'?c.message:
   c.key==='warehouse'&&arm1?.state==='ERROR'?(arm1.supports_error_reset?'팔1 ERROR · 정지 상태 확인 후 오류 초기화':'팔1 ERROR · 오류 초기화 서버 업데이트 필요'):fresh(c)?'정지 확인 후 해제 가능': '장치 연결 확인 대기';
 }}
 function finish(id,success,message){const r=requests.get(id);if(!r)return;clearTimeout(r.timer);requests.delete(id);const c=r.cell;
  if(c.pending?.id!==id)return;c.pending=null;c.phase=success?'success':'error';c.message=message;
  c.paused=success&&r.command==='EMER_STOP';paint();r.resolve?.({success,message});
 }
 function issue(c,command){
  paint();if(command==='CLEAR_ERROR'){if(!fresh(c)||c.pending)return Promise.resolve({success:false,message:'연결 또는 다른 요청 확인 필요'});}
  else if((command==='EMER_STOP'?c.stop:c.release).disabled)return;
  if(c.pending)finish(c.pending.id,false,'정지 요청 우선 · 이전 해제 결과 미확인');
  const id=prefix+'-'+(++serial),action='/'+c.arm+'/data',label=command==='EMER_STOP'?'정지':command==='CLEAR_ERROR'?'오류 초기화':'정지 해제';
  const request={cell:c,command,id,action,deadline:Date.now()+45000,timer:null};
  const result=new Promise(resolve=>{request.resolve=resolve;});
  request.timer=setTimeout(()=>finish(id,false,label+' 응답 시간 초과 · 실제 상태 미확인'),45000);
  requests.set(id,request);c.pending=request;c.phase='pending';c.message=label+' 요청 전송 · 실제 응답 대기';
  try{socket.send(JSON.stringify({op:'send_action_goal',id,action,action_type:'host_pkg/action/Arm',args:{command},feedback:true}));}
  catch{finish(id,false,label+' 전송 실패 · 실제 상태 미확인');}paint();return result;
 }
 function receive(m){
  if(m.op==='publish'&&m.topic==='/host/device_discovery'){
   let data;try{data=JSON.parse(m.msg?.data);}catch{return;}
   if(!Number.isFinite(data.stamp_ms)||Math.abs(Date.now()-data.stamp_ms)>3500)return;
   for(const c of cells){c.graphAt=data.stamp_ms;c.available=Array.isArray(data.publishers?.[c.arm])&&data.publishers[c.arm].length>0;}paint();return;
  }
  if(m.op==='publish'&&m.topic==='/arm1/status'){
   try{arm1=JSON.parse(m.msg?.data);arm1At=Date.now();}catch{arm1=null;}paint();return;
  }
  const r=requests.get(m.id);if(!r||(m.action!==undefined&&m.action!==r.action))return;
  if(Date.now()>=r.deadline){finish(m.id,false,'응답 시간 초과 · 실제 상태 미확인');return;}
  if(m.op==='action_result'){
   const ok=m.result===true&&m.status===4&&m.values?.success===true&&m.values.message==='IDLE';
   finish(m.id,ok,ok?(r.command==='CLEAR_ERROR'?'남은 작업 종료 확인':r.command==='EMER_STOP'?'정지 응답 확인 · 해제 시 중단 동작 재개':'해제 응답 확인 · 중단 동작 재개 가능'):'요청 실패 / 거부 · 실제 상태 미확인');
  }else if(m.op==='status'&&m.level==='error')finish(m.id,false,'요청 오류 · '+(m.msg||'실제 상태 미확인'));
 }
 function invalidate(){for(const id of [...requests.keys()])finish(id,false,'연결 끊김 · 실제 상태 미확인');for(const c of cells){c.available=false;c.graphAt=0;c.paused=false;}arm1=null;paint();}
 function connect(){if(closed||!local)return;const current=new WebSocket('ws://'+location.hostname+':9090');socket=current;
  current.onopen=()=>{if(socket!==current)return;connected=true;for(const [topic,type]of [['/host/device_discovery','std_msgs/msg/String'],['/arm1/status','std_msgs/msg/String']])current.send(JSON.stringify({op:'subscribe',id:'cell-controls:'+topic,topic,type,queue_length:1}));paint();};
  current.onmessage=event=>{if(socket!==current||!connected)return;try{receive(JSON.parse(event.data));}catch{}};
  current.onclose=()=>{if(socket!==current)return;connected=false;invalidate();if(!closed)reconnect=setTimeout(connect,3000);};
  current.onerror=()=>current.close();
 }
 const poll=setInterval(paint,500),hostPoll=setInterval(pollHost,1000);paint();connect();pollHost();
 addEventListener('pagehide',()=>{closed=true;clearInterval(poll);clearInterval(hostPoll);clearTimeout(reconnect);connected=false;invalidate();socket?.close();});
})();
