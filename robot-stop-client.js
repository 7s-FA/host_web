/* Explicit M1/M2 stop/release requests. Reconnecting only subscribes to state. */
(function(root){
 'use strict';
 function create({url,onChange=()=>{},WebSocket:Socket=root.WebSocket,now=Date.now}){
  const prefix='robot-stop-'+(root.crypto?.randomUUID?.()||now().toString(36)+'-'+Math.random().toString(36).slice(2));
  const robots={M1:{phase:'idle',message:'정지 요청 대기'},M2:{phase:'idle',message:'정지 요청 대기'}},requests=new Map();
  const telemetry={M1:{ownerAt:null,running:false,missionAt:null,mission:null},M2:{ownerAt:null,running:false,missionAt:null,mission:null}};
  let started=false,socket=null,connected=false,reconnect=null,poll=null,serial=0;
  function releaseReady(robot){const t=telemetry[robot];return connected&&t.ownerAt!==null&&now()-t.ownerAt>=0&&now()-t.ownerAt<=3500&&!t.running&&robots[robot].phase!=='pending';}
  function errorResetReady(robot){
   const t=telemetry[robot];
   return releaseReady(robot)&&t.missionAt!==null&&now()-t.missionAt>=0&&now()-t.missionAt<=3500
    &&t.mission?.status==='failed'&&['mat','asm','rest','park'].includes(t.mission?.destination);
  }
  function snapshot(){return {connected,robots:Object.fromEntries(['M1','M2'].map(robot=>[robot,{...robots[robot],canRestart:releaseReady(robot),canResetError:errorResetReady(robot)}]))};}
  function changed(){onChange(snapshot());}
  function finish(id,phase,message){
   const request=requests.get(id);if(!request)return;
   root.clearTimeout(request.timer);requests.delete(id);robots[request.robot]={phase,message};request.complete?.({success:phase==='success',message});
  }
  function invalidate(message){
   for(const id of requests.keys())finish(id,'error',message);
   for(const robot of ['M1','M2'])if(robots[robot].phase==='success')robots[robot]={phase:'idle',message:'이전 정지 응답 · 현재 상태는 다시 확인하세요.'};
   for(const t of Object.values(telemetry)){t.ownerAt=null;t.running=false;t.missionAt=null;t.mission=null;}
  }
  function schedule(){if(started&&reconnect===null)reconnect=root.setTimeout(connect,3000);}
  function receive(message){
   if(message.op==='publish'){
    for(const robot of ['M1','M2']){
     const base='/burger'+robot.at(-1)+'/',t=telemetry[robot];
     if(message.topic!==base+'motion_owner/communication_status'&&message.topic!==base+'mission/status')continue;
     let value;try{value=JSON.parse(message.msg?.data);}catch{value=null;}
     if(message.topic.endsWith('/communication_status'))t.ownerAt=['idle','nav','direct'].includes(value?.mode)?now():null;
     if(message.topic.endsWith('/mission/status')){t.running=!['success','failed','cancelled','idle'].includes(value?.status);t.mission=value;t.missionAt=now();}
     changed();return;
    }
    return;
   }
   const request=requests.get(message.id);
   if(!request||message.action!==undefined&&message.action!==request.action)return;
   const label=request.label;
   if(now()>=request.deadline){finish(message.id,'error',label+' 응답 시간 초과 · 실제 상태 미확인');changed();return;}
   if(message.op==='action_result'){
    const success=message.result===true&&message.status===4&&message.values?.success===true&&message.values?.message==='IDLE';
    const detail=typeof message.values?.message==='string'?message.values.message:'';
    finish(message.id,success?'success':'error',success?label+' 확인 완료'+(request.errorReset?' · 주문 유지 · 재시도는 별도 실행':''):label+' 요청 실패 / 거부 · 실제 상태 미확인'+(detail?' · '+detail:''));changed();
   }else if(message.op==='status'&&message.level==='error'){
    finish(message.id,'error',label+' 요청 오류 · 실제 상태 미확인'+(typeof message.msg==='string'?' · '+message.msg:''));changed();
   }
  }
  function connect(){
   reconnect=null;if(!started)return;
   let current;
   try{current=new Socket(url);socket=current;}
   catch(_){connected=false;changed();schedule();return;}
   current.onopen=()=>{
    if(socket!==current||!started)return;connected=true;
    try{for(let i=1;i<=2;i++)for(const topic of ['motion_owner/communication_status','mission/status'])current.send(JSON.stringify({op:'subscribe',id:'robot-stop:burger'+i+'/'+topic,topic:'/burger'+i+'/'+topic,type:'std_msgs/msg/String',throttle_rate:1000,queue_length:1}));}
    catch(_){current.close();return;}
    poll=root.setInterval(changed,1000);changed();
   };
   current.onmessage=event=>{
    if(socket!==current||!connected)return;
    let message;try{message=JSON.parse(event.data);}catch{return;}
    if(message&&typeof message==='object')receive(message);
   };
   current.onclose=()=>{
    if(socket!==current)return;
    socket=null;connected=false;root.clearInterval(poll);poll=null;invalidate('ROS 연결 끊김 · 실제 정지·해제 상태 미확인');changed();schedule();
   };
   current.onerror=()=>{if(socket===current)current.close();};
  }
  function request(robot,command,errorReset=false,complete=null){
   if(robot!=='M1'&&robot!=='M2')return false;
   if(command==='RESTART'&&!releaseReady(robot))return false;
   if(errorReset&&!errorResetReady(robot))return false;
   if(robots[robot].phase==='pending'){
    if(command!=='EMER_STOP'||robots[robot].command!=='RESTART')return false;
    // An explicit stop remains available while release is awaiting a result.
    for(const [id,pending] of requests)if(pending.robot===robot)finish(id,'error','정지 요청 우선 · 해제 상태 미확인');
   }
   if(!connected||socket?.readyState!==(Socket.OPEN??1)){
    robots[robot]={phase:'error',message:'ROS 연결 안 됨 · 정지 요청을 전송하지 못했습니다.'};changed();return false;
   }
   const id=prefix+'-'+robot+'-'+(++serial),action='/'+robot+'/data';
   const label=errorReset?'이동 오류 초기화':command==='RESTART'?'정지 해제':'정지',request={robot,action,command,label,errorReset,complete,deadline:now()+10000,timer:null};
   requests.set(id,request);robots[robot]={phase:'pending',command,errorReset,message:label+' 요청 전송 · 응답 대기'};
   request.timer=root.setTimeout(()=>{finish(id,'error',label+' 응답 시간 초과 · 실제 상태 미확인');changed();},10000);
   try{socket.send(JSON.stringify({op:'send_action_goal',id,action,action_type:'host_pkg/action/Burger',args:{command,cmd_val:0},feedback:true}));}
   catch(_){finish(id,'error',label+' 요청 전송 실패 · 실제 상태 미확인');changed();socket.close();return false;}
   changed();return true;
  }
  function start(){if(started)return;started=true;connect();}
  function close(){
   started=false;root.clearTimeout(reconnect);root.clearInterval(poll);reconnect=poll=null;
   const previous=socket;socket=null;connected=false;invalidate('연결 종료 · 실제 정지·해제 상태 미확인');previous?.close();changed();
  }
  return {start,requestStop:robot=>request(robot,'EMER_STOP'),requestRestart:robot=>request(robot,'RESTART'),requestErrorReset:robot=>request(robot,'RESTART',true),requestRestartResult:robot=>new Promise(resolve=>{if(!request(robot,'RESTART',false,resolve))resolve({success:false,message:'최신 정지 상태 또는 연결 확인 필요'});}),snapshot,close};
 }
 const api={create};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RobotStopClient=api;
})(typeof window!=='undefined'?window:globalThis);
