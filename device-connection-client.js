/* Read-only connectivity: Host heartbeat and device Action status publishers. */
(function(root){
 'use strict';
 function create({url,onChange=()=>{},WebSocket:Socket=root.WebSocket,now=Date.now}){
  const topics={M1:'/M1/data/_action/status',M2:'/M2/data/_action/status',arm1:'/arm1/data/_action/status',arm2:'/arm2/data/_action/status',arm3:'/arm3/data/_action/status'};
  const names={M1:'M1',M2:'M2',arm1:'로봇팔 1',arm2:'로봇팔 2',arm3:'로봇팔 3'};
  const requests=new Map();
  let started=false,connected=false,phase='waiting',socket=null,poll=null,reconnect=null,serial=0,openedAt=null,hostAt=null,graphs={};
  function clear(){
   requests.clear();hostAt=openedAt=null;
   graphs=Object.fromEntries(Object.keys(topics).map(key=>[key,{at:null,order:0,present:null}]));
  }
  const fresh=at=>at!==null&&now()-at>=0&&now()-at<=3000;
  function graphState(key){
   const graph=graphs[key];
   if(!fresh(graph.at))return {state:graph.at===null&&fresh(openedAt)?'waiting':'unknown',detail:names[key]+' 제어 서버 확인 응답 대기'};
   if(graph.present===null)return {state:'unknown',detail:names[key]+' 제어 서버를 확인할 수 없습니다.'};
   return {state:graph.present?'online':'offline',detail:names[key]+(graph.present?' 제어 서버 감지됨':' 제어 서버 감지 안 됨')};
  }
  function snapshot(){
   const devices={};
   if(!connected){
    for(const key of ['host',...Object.keys(topics),'warehouse','production'])devices[key]={state:phase,detail:phase==='waiting'?'ROS 연결 확인 중':'ROS 연결 끊김 · 장치 연결 확인 불가'};
   }else{
    devices.host={state:fresh(hostAt)?'online':hostAt===null&&fresh(openedAt)?'waiting':'offline',detail:fresh(hostAt)?'Host 상태 메시지 수신 중':'Host 상태 메시지 수신 없음 · Host 프로그램 실행 확인'};
    for(const key of Object.keys(topics))devices[key]=graphState(key);
    devices.warehouse={...devices.arm1};
    const arms=[devices.arm2.state,devices.arm3.state];
    const state=arms.every(s=>s==='online')?'online':arms.includes('online')?'partial':arms.every(s=>s==='offline')?'offline':arms.includes('unknown')?'unknown':'waiting';
    devices.production={state,detail:devices.arm2.detail+' · '+devices.arm3.detail+' (리니어·카메라 개별 상태는 확인하지 않음)'};
   }
   return {connected,devices};
  }
  function changed(){onChange(snapshot());}
  function send(message){socket.send(JSON.stringify(message));}
  function disconnected(){
   const previous=socket;socket=null;connected=false;phase='offline';clear();
   root.clearInterval(poll);poll=null;previous?.close();changed();
   if(started)reconnect=root.setTimeout(connect,3000);
  }
  function checkPublishers(){
   for(const [id,request] of requests)if(!fresh(request.at))requests.delete(id);
   try{
    for(const [key,topic] of Object.entries(topics)){
     const order=++serial,id='device-connection-'+order;
     requests.set(id,{key,at:now(),order});
     send({op:'call_service',id,service:'/rosapi/publishers',type:'rosapi_msgs/srv/Publishers',args:{topic}});
    }
   }catch(_){disconnected();return;}
   changed();
  }
  function receive(message){
   if(message.op==='service_response'&&message.service==='/rosapi/publishers'){
    const request=requests.get(message.id);
    if(!request)return;
    requests.delete(message.id);
    const graph=graphs[request.key];
    if(!fresh(request.at)||request.order<graph.order)return;
    const publishers=message.values?.publishers;
    graph.at=request.at;graph.order=request.order;
    graph.present=message.result===true&&Array.isArray(publishers)&&publishers.every(name=>typeof name==='string'&&name.trim())?publishers.length>0:null;
    changed();return;
   }
   if(message.op==='publish'&&message.topic==='/ros_to_web'){
    let data;try{data=JSON.parse(message.msg?.data);}catch{return;}
    if(!data||Array.isArray(data)||typeof data!=='object'||typeof data.message!=='string')return;
    if(!['burger1_x_axis','burger1_y_axis','burger2_x_axis','burger2_y_axis'].every(key=>typeof data[key]==='number'&&Number.isFinite(data[key])))return;
    hostAt=now();changed();
   }
  }
  function connect(){
   reconnect=null;if(!started)return;
   clear();connected=false;phase='waiting';
   let current;
   try{current=new Socket(url);socket=current;}
   catch(_){disconnected();return;}
   current.onopen=()=>{
    if(socket!==current||!started)return;
    connected=true;openedAt=now();
    try{send({op:'subscribe',id:'device-connection-host',topic:'/ros_to_web',type:'std_msgs/msg/String',queue_length:1,throttle_rate:500,qos:{history:'keep_last',depth:1,reliability:'reliable',durability:'volatile'}});}
    catch(_){disconnected();return;}
    checkPublishers();if(socket===current)poll=root.setInterval(checkPublishers,1000);
   };
   current.onmessage=event=>{
    if(socket!==current||!connected)return;
    let message;try{message=JSON.parse(event.data);}catch{return;}
    if(message&&typeof message==='object')receive(message);
   };
   current.onclose=()=>{if(socket===current)disconnected();};
   current.onerror=()=>{if(socket===current)disconnected();};
   changed();
  }
  function start(){if(started)return;started=true;connect();}
  function stop(){
   started=false;root.clearTimeout(reconnect);root.clearInterval(poll);reconnect=poll=null;
   const previous=socket;socket=null;connected=false;phase='waiting';clear();previous?.close();changed();
  }
  clear();return {start,stop,snapshot};
 }
 const api={create};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DeviceConnectionClient=api;
})(typeof window!=='undefined'?window:globalThis);
