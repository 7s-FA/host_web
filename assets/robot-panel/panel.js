(()=>{'use strict';
const configs=[{robot:'burger1',action:'/M1/data',ip:'192.0.2.104',id:'M1'},{robot:'burger2',action:'/M2/data',ip:'192.0.2.102',id:'M2'}];
const routes=[['GO_TO_MAT','재료창고'],['GO_TO_ASM','조립대'],['GO_TO_REST','REST'],['GO_TO_PARK','지정 주차장']];
const states=new Map();let ws,reconnect,closed=false,host=null,hostAt=0;
const hostControl=new URLSearchParams(location.search).get('host_control')==='1';
const fullResetBusy=()=>host?.full_reset?.status==='running'||host?.full_reset?.uncertain;
const hostAllowsMove=()=>!hostControl||(host?.bridge_connected&&Date.now()-hostAt<3500&&!fullResetBusy()&&!host.pending_commands&&!host.reset_pending&&!host.manual_move&&(!host.order||['idle','done'].includes(host.order.status)||host.can_manual_move));
async function refreshHost(){if(!hostControl)return;try{const r=await fetch('/api/live/state',{cache:'no-store'});if(!r.ok)throw Error();host=await r.json();hostAt=Date.now();}catch{host=null;}for(const s of states.values())render(s);}
const el=(p,s)=>p.querySelector(s),connected=()=>ws?.readyState===WebSocket.OPEN;
function note(s,text){const row=document.createElement('li');row.textContent=new Date().toLocaleTimeString('ko-KR')+' · '+text;s.log.append(row);while(s.log.children.length>50)s.log.firstChild.remove();s.log.scrollTop=s.log.scrollHeight;}
function render(s){const fresh=connected()&&Date.now()-s.ownerAt<3500,running=s.mission?.status==='running',pending=!!s.pending;
 el(s.card,'.pill').textContent=!fresh?'상태 수신 대기':running?'작업 중':pending?'명령 응답 대기':'연결됨';
 s.card.querySelectorAll('[data-command]').forEach(b=>{b.disabled=b.dataset.command==='EMER_STOP'?!connected():b.dataset.command==='RESTART'?!fresh||running||pending||hostControl&&fullResetBusy():!fresh||!!s.owner.error||running||pending||!hostAllowsMove();});
 if(hostControl&&!hostAllowsMove())el(s.card,'.notice').textContent='주문 진행 중이거나 Host 상태 확인 필요 · 목적지 변경 잠김';
 const values={mission:s.mission?`${s.mission.destination||'—'} / ${s.mission.stage||s.mission.status}${s.mission.status==='running'?'':' (최근 기록)'}`:'대기',owner:fresh?s.owner.mode:'수신 끊김',dock:Date.now()-s.dockAt<3500?s.dock.state:'도킹 비활성',ir:Date.now()-s.irAt<2000?(s.ir?'감지':'미감지'):'도킹·REST 중 수신',velocity:Date.now()-s.odomAt<2000&&s.odom?`${s.odom.twist.twist.linear.x.toFixed(3)} m/s · ${s.odom.twist.twist.angular.z.toFixed(3)} rad/s`:'—',error:s.mission?.error||s.owner.error||s.dock?.reason||'—'};
 for(const [key,value]of Object.entries(values))el(s.card,'[data-value="'+key+'"]').textContent=value;
 el(s.card,'pre').textContent=JSON.stringify({robot:s.robot,telemetry_age_s:s.ownerAt?(Date.now()-s.ownerAt)/1000:null,mission:s.mission,communication:s.owner,docking:s.dock,action:s.result},null,2);
}
async function issue(s,command){if(!connected())return;const b=el(s.card,'[data-command="'+command+'"]');if(b.disabled)return;
 if(hostControl&&command.startsWith('GO_TO_')){
  await refreshHost();if(!hostAllowsMove())return;
  if(host?.order?.status==='failed'){
   if(!confirm(s.id+' 수동 이동: 로봇과 리니어가 멈췄고 이동 경로·적재 상태를 확인했습니까? 실패 주문 단계는 유지됩니다.'))return;
   const order=host.order;s.pending='host-manual';render(s);
   try{const response=await fetch('/api/live/manual_move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device:s.id,destination:command,order_id:order.id,stage:order.stage,recovery_revision:order.recovery_revision||0,operator_confirmed:true})});const body=await response.json();if(!response.ok)throw Error(body.error||'Host 지시 거절');note(s,'Host 수동 이동 요청 · 작업 결과는 관제에서 확인');}
   catch(error){note(s,error.message);el(s.card,'.notice').textContent=error.message;}
   finally{s.pending=null;await refreshHost();render(s);}return;
  }
 }
 const id=s.robot+'-'+crypto.randomUUID(),control=command==='EMER_STOP';if(!control)s.pending=id;
 s.actions.set(id,command);if(!control)s.issuedUnix=Date.now()/1000;el(s.card,'.notice').textContent='명령 전달: '+(routes.find(x=>x[0]===command)?.[1]||command)+' · 로봇 응답 대기';note(s,command+' 요청');render(s);
 ws.send(JSON.stringify({op:'send_action_goal',id,action:s.action,action_type:'host_pkg/action/Burger',args:{command,cmd_val:command.startsWith('GO_TO_')?100.:0.},feedback:true}));
}
for(const cfg of configs){const card=document.createElement('article');card.className='robot';card.innerHTML='<div class="head"><h2>M'+cfg.robot.at(-1)+'</h2><span class="pill">상태 수신 대기</span></div><div class="body"><div class="robot-battery-control"><span>실제 배터리</span><p class="robot-battery" data-battery-robot="'+cfg.id+'" role="status">배터리 수신 대기</p></div><div class="commands">'+routes.map(([c,t])=>'<button data-command="'+c+'" disabled>'+t+'</button>').join('')+'</div><div class="controls"><button class="stop" data-command="EMER_STOP" disabled>정지</button><button class="restart" data-command="RESTART" disabled>정지 해제</button></div><p class="notice" role="status">실제 로봇 상태를 기다립니다.</p><div class="status">'+[['mission','주행 단계'],['owner','제어 상태'],['dock','도킹 상태'],['ir','IR 센서'],['velocity','현재 속도'],['error','최근 사유']].map(([k,t])=>'<div><span>'+t+'</span><strong data-value="'+k+'">—</strong></div>').join('')+'</div><details><summary>상태 데이터 · 디버깅</summary><pre></pre></details><ol class="event-log"></ol></div>';
 document.getElementById('robots').append(card);const s={...cfg,card,owner:{},mission:null,dock:{},ownerAt:0,dockAt:0,irAt:0,odomAt:0,pending:null,actions:new Map(),log:el(card,'.event-log')};states.set(cfg.robot,s);
 card.querySelectorAll('[data-command]').forEach(b=>b.onclick=()=>issue(s,b.dataset.command));render(s);
}
function subscribe(){for(const s of states.values()){for(const [topic,type]of [['motion_owner/communication_status','std_msgs/msg/String'],['mission/status','std_msgs/msg/String'],['docking/status','std_msgs/msg/String'],['ir/high','std_msgs/msg/Bool'],['odom','nav_msgs/msg/Odometry']])ws.send(JSON.stringify({op:'subscribe',id:s.robot+'/'+topic,topic:'/'+s.robot+'/'+topic,type,throttle_rate:topic==='odom'?500:1000,queue_length:1,...(topic==='odom'?{qos:{history:'keep_last',depth:1,reliability:'best_effort',durability:'volatile'}}:{})}));ws.send(JSON.stringify({op:'subscribe',id:s.id+'/diagnostics',topic:'/'+s.id+'/mission/diagnostics',type:'std_msgs/msg/String',queue_length:10}));}}
function receive(m){if(m.op==='publish'){const s=[...states.values()].find(x=>m.topic.startsWith('/'+x.robot+'/')||m.topic==='/'+x.id+'/mission/diagnostics');if(!s)return;let value=m.msg;
 try{if(typeof value.data==='string')value=JSON.parse(value.data)}catch{return}
 if(m.topic.endsWith('/communication_status')){s.owner=value;s.ownerAt=Date.now();if(!s.actions.size)el(s.card,'.notice').textContent=value.error?'통신 확인 필요: '+value.error:'로봇 상태 수신 중 · 목적지를 선택하세요.'}
 else if(m.topic.endsWith('/mission/status')){const changed=s.mission?.stage!==value.stage||s.mission?.command_id!==value.command_id||s.mission?.status!==value.status;s.mission=value;if(s.pending&&value.started_unix>=s.issuedUnix-1){s.pendingMission=value.command_id;if(['success','failed','cancelled'].includes(value.status))s.pending=null}if(changed)note(s,`${value.destination||''} ${value.stage||''} ${value.status||''} ${value.error||''}`)}
 else if(m.topic.endsWith('/docking/status')){s.dock=value;s.dockAt=Date.now()}
 else if(m.topic.endsWith('/ir/high')){s.ir=!!value.data;s.irAt=Date.now()}
 else if(m.topic.endsWith('/odom')){s.odom=value;s.odomAt=Date.now()}
 else note(s,`${value.stage||''}: ${value.reason||''}`);render(s);
 }else if(['action_result','action_feedback','status'].includes(m.op)){const s=[...states.values()].find(s=>s.actions.has(m.id));if(!s)return;
 if(m.op==='action_feedback'){el(s.card,'.notice').textContent='로봇 실행 중 · '+s.actions.get(m.id);return}
 if(m.op==='action_result'||m.level==='error'){const cmd=s.actions.get(m.id);s.actions.delete(m.id);if(s.pending===m.id)s.pending=null;s.result=m.values||m.msg;const ok=m.op==='action_result'&&m.result===true&&m.status===4&&m.values?.success===true;const text=cmd+' · '+(ok?'완료':'실패 / 거부')+' · '+(m.values?.message||m.values||m.msg||'');el(s.card,'.notice').textContent=text;note(s,text);render(s);}
 }}
function connect(){if(closed)return;ws=new WebSocket('ws://'+location.hostname+':9090');ws.onopen=()=>{document.getElementById('connection').textContent='ROS 통신 연결됨';subscribe()};ws.onmessage=e=>{try{receive(JSON.parse(e.data))}catch{}};ws.onclose=()=>{document.getElementById('connection').textContent='통신 끊김 · 재연결 중';for(const s of states.values())render(s);if(!closed)reconnect=setTimeout(connect,3000)};ws.onerror=()=>ws.close();}
setInterval(()=>{for(const s of states.values())render(s)},1000);
const hostPoll=setInterval(refreshHost,1000);refreshHost();
addEventListener('pagehide',()=>{closed=true;clearInterval(hostPoll);clearTimeout(reconnect);ws?.close()});if(location.protocol==='http:'&&['localhost','127.0.0.1'].includes(location.hostname))connect();else document.getElementById('connection').textContent='Host PC 로컬 화면에서 사용하세요';
})();
