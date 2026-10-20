/* Read-only ROS state: subscriptions and publisher discovery, never robot commands. */
(function(root){
 'use strict';
 const Model=typeof module!=='undefined'&&module.exports?require('./live-map-model.js'):root.LiveMapModel;
 function create({url,onChange=()=>{},WebSocket:Socket=root.WebSocket,now=Date.now}){
  let started=false,socket=null,reconnect=null,opening=null,poll=null,connected=false,error=null,serial=0;
  let robots,arms,missionTimes;
  function clear(){
   robots=Array.from({length:2},()=>({pose:null,mission:null}));
   missionTimes=[0,0];
   arms=Array.from({length:3},()=>({goals:new Map(),seen:false,publishers:false,graphAt:null,}));
  }
  function expireGraphs(){
   for(const arm of arms)if(arm.graphAt!==null&&now()-arm.graphAt>3000){
    arm.goals.clear();arm.seen=false;arm.publishers=false;arm.graphAt=null;
   }
  }
  function armState(arm){
   const age=now()-arm.graphAt;
   const available=connected&&arm.publishers&&arm.graphAt!==null&&age>=0&&age<=3000;
   if(!available)return {active:false,state:'unknown',available:false};
   if(!arm.seen)return {active:false,state:'unknown',available:true};
   // Short-lived control goals must not override the older paused work goal.
   const active=[...arm.goals.values()].filter(goal=>goal.status===2||goal.status===3)
    .sort((a,b)=>a.stamp[0]-b.stamp[0]||a.stamp[1]-b.stamp[1]||a.order-b.order);
   const feedback=active[0]?.feedback;
   const state=active.length?(feedback==='PAUSED'?'paused':feedback==='ERROR'?'error':feedback==='IDLE'?'idle':feedback==='RUNNING'?'running':'unknown'):
    [...arm.goals.values()].some(goal=>goal.status===6)?'error':'idle';
   return {active:state==='running',state,available:true};
  }
  function snapshot(){
   expireGraphs();
   robots.forEach((robot,index)=>{if(now()-missionTimes[index]>3000)robot.mission=null;});
   return JSON.parse(JSON.stringify({connected,error,robots,arms:arms.map(armState)}));
  }
  function changed(){onChange(snapshot());}
  function uuid(value){
   const bytes=value?.uuid;
   return Array.isArray(bytes)&&bytes.length===16&&bytes.every(n=>Number.isInteger(n)&&n>=0&&n<=255)?bytes.join('-'):null;
  }
  function send(message){socket.send(JSON.stringify(message));}
  function receive(message){
   expireGraphs();
   if(message.op==='publish'&&message.topic==='/host/device_discovery'){
    let data;try{data=JSON.parse(message.msg?.data);}catch{return;}
    const age=now()-data?.stamp_ms;
    if(!data||data.protocol!==1||!Number.isFinite(data.stamp_ms)||age<0||age>3000||!data.publishers||typeof data.publishers!=='object'||Array.isArray(data.publishers))return;
    arms.forEach((arm,index)=>{
     if(arm.graphAt!==null&&data.stamp_ms<=arm.graphAt)return;
     const publishers=data.publishers['arm'+(index+1)];
     arm.graphAt=data.stamp_ms;
     arm.publishers=Array.isArray(publishers)&&publishers.length>0&&publishers.every(name=>typeof name==='string'&&name.trim());
     if(!arm.publishers){arm.goals.clear();arm.seen=false;}
    });
    changed();return;
   }
   if(message.op!=='publish')return;
   for(let index=0;index<2;index++){
    if(message.topic===`/burger${index+1}/amcl_pose`){
     // AMCL may retain an older position while parked. Keep its original timestamp
     // so the view can show a gray last-known position without claiming freshness.
     const pose=Model.parsePose(message.msg,index,now(),{allowStale:true});
     if(pose&&(!robots[index].pose||pose.stamp>=robots[index].pose.stamp)){robots[index].pose=pose;changed();}
     return;
    }
    if(message.topic===`/burger${index+1}/mission/status`){
     let mission;
     try{mission=JSON.parse(message.msg?.data);}catch{return;}
     if(mission&&typeof mission==='object'&&!Array.isArray(mission)){robots[index].mission=mission;missionTimes[index]=now();changed();}
     return;
    }
   }
   for(let index=0;index<3;index++){
    const arm=arms[index];
    if(message.topic===`/arm${index+1}/data/_action/status`){
     if(!Array.isArray(message.msg?.status_list))return;
     const next=new Map();
     for(const entry of message.msg.status_list){
      const id=uuid(entry?.goal_info?.goal_id);
      if(!id||!Number.isInteger(entry.status)||entry.status<0||entry.status>6)continue;
      const previous=arm.goals.get(id),stamp=entry.goal_info.stamp;
      next.set(id,{status:entry.status,feedback:previous?.feedback,order:previous?.order??++serial,
       stamp:Number.isInteger(stamp?.sec)&&Number.isInteger(stamp?.nanosec)?[stamp.sec,stamp.nanosec]:previous?.stamp||[Infinity,0]});
     }
     arm.goals=next;arm.seen=true;changed();return;
    }
    if(message.topic===`/arm${index+1}/data/_action/feedback`){
     const id=uuid(message.msg?.goal_id),feedback=message.msg?.feedback?.message;
     if(!id||!['RUNNING','PAUSED','IDLE','ERROR'].includes(feedback))return;
     const goal=arm.goals.get(id)||{status:null,stamp:[Infinity,0],order:++serial};
     goal.feedback=feedback;arm.goals.set(id,goal);changed();return;
    }
   }
  }
  function schedule(){if(started)reconnect=root.setTimeout(connect,3000);}
  function connect(){
   reconnect=null;if(!started)return;
   clear();connected=false;error=null;
   let current;
   try{current=new Socket(url);socket=current;}
   catch(_){error='ROS 연결 실패';changed();schedule();return;}
   opening=root.setTimeout(()=>{if(socket===current&&!connected){error='ROS 연결 시간 초과';current.close();}},5000);
   current.onopen=()=>{
    if(socket!==current||!started)return;
    root.clearTimeout(opening);opening=null;connected=true;error=null;
    const retained={history:'keep_last',depth:1,reliability:'reliable',durability:'transient_local'};
    function subscribe(topic,type,qos){send({op:'subscribe',id:'live-map:'+topic,topic,type,queue_length:1,...(qos?{qos}:{})});}
    try{
    subscribe('/host/device_discovery','std_msgs/msg/String',{...retained,durability:'volatile'});
    for(let i=1;i<=2;i++){
     subscribe(`/burger${i}/amcl_pose`,'geometry_msgs/msg/PoseWithCovarianceStamped',retained);
     subscribe(`/burger${i}/mission/status`,'std_msgs/msg/String');
    }
    for(let i=1;i<=3;i++){
     subscribe(`/arm${i}/data/_action/status`,'action_msgs/msg/GoalStatusArray',retained);
     subscribe(`/arm${i}/data/_action/feedback`,'host_pkg/action/Arm_FeedbackMessage',{...retained,durability:'volatile'});
    }
    }catch(_){error='ROS 구독 실패';current.close();return;}
    changed();poll=root.setInterval(changed,500);
   };
   current.onmessage=event=>{
    if(socket!==current||!connected)return;
    let message;try{message=JSON.parse(event.data);}catch{return;}
    if(message&&typeof message==='object')receive(message);
   };
   current.onclose=()=>{
    if(socket!==current)return;
    socket=null;connected=false;error=error||'ROS 연결 끊김';root.clearInterval(poll);root.clearTimeout(opening);opening=poll=null;clear();changed();schedule();
   };
   current.onerror=()=>{if(socket===current){error='ROS 연결 오류';current.close();}};
   changed();
  }
  function start(){if(started)return;started=true;connect();}
  function stop(){
   started=false;root.clearTimeout(reconnect);root.clearTimeout(opening);root.clearInterval(poll);reconnect=opening=poll=null;
   const previous=socket;socket=null;connected=false;error=null;clear();previous?.close();changed();
  }
  clear();return {start,stop,snapshot};
 }
 const api={create};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LiveMapClient=api;
})(typeof window!=='undefined'?window:globalThis);
