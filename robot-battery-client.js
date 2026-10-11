/* Read-only BatteryState telemetry with an OpenCR voltage-based charge estimate.
 * Firmware: https://github.com/ROBOTIS-GIT/OpenCR/blob/master/arduino/opencr_arduino/opencr/libraries/turtlebot3_ros2/src/turtlebot3/turtlebot3.cpp
 * BatteryState.percentage is not used because firmware/driver scaling can differ.
 */
(function(root){
 'use strict';
 function create({url,onChange=()=>{},WebSocket:Socket=root.WebSocket,now=Date.now}){
  const topics={'/burger1/battery_state':'M1','/burger2/battery_state':'M2'};
  const robots={},currentData={},lastStamp={};
  for(const robot of ['M1','M2'])robots[robot]={percentage:null,voltage:null,state:'waiting',receivedAt:null,sourceStamp:null};
  let started=false,connected=false,socket=null,reconnect=null,tick=null;
  function refresh(){
   if(!connected)return;
   for(const robot of ['M1','M2']){
    const item=robots[robot];
    if(item.receivedAt===null)item.state='waiting';
    else if(!currentData[robot]||now()<item.receivedAt||now()-item.receivedAt>5000||item.sourceStamp!==null&&now()-item.sourceStamp>5000)item.state='stale';
   }
  }
  function snapshot(){refresh();return {connected,robots:{M1:{...robots.M1},M2:{...robots.M2}}};}
  function changed(){onChange(snapshot());}
  function offline(){connected=false;for(const robot of ['M1','M2']){currentData[robot]=false;robots[robot].state='offline';}}
  function schedule(){if(started&&reconnect===null)reconnect=root.setTimeout(connect,3000);}
  function freshness(){if(!started)return;changed();tick=root.setTimeout(freshness,1000);}
  function receive(message){
   if(message.op!=='publish'||!Object.hasOwn(topics,message.topic))return;
   const robot=topics[message.topic],data=message.msg;
   if(!data||typeof data!=='object'||Array.isArray(data))return;
   if(!Object.hasOwn(data,'voltage')&&!Object.hasOwn(data,'percentage')&&typeof data.present!=='boolean')return;
   const validVoltage=typeof data.voltage==='number'&&Number.isFinite(data.voltage)&&data.voltage>=0;
   const voltage=validVoltage&&data.voltage>0?data.voltage:null;
   const absent=data.present===false||validVoltage&&data.voltage<=7;
   const percentage=absent||!validVoltage?null:Math.round(Math.max(0,Math.min(100,(voltage-10.5)/1.8*100)));
   let sourceStamp=null;
   const stamp=data.header?.stamp;
   if(stamp&&typeof stamp.sec==='number'&&typeof stamp.nanosec==='number'&&Number.isFinite(stamp.sec)&&Number.isFinite(stamp.nanosec)&&stamp.sec>=0&&stamp.nanosec>=0&&stamp.nanosec<1e9){
    const value=stamp.sec*1000+stamp.nanosec/1e6;
    if(value>0)sourceStamp=value;
   }
   if(sourceStamp!==null&&(Math.abs(now()-sourceStamp)>5000||lastStamp[robot]!==undefined&&sourceStamp<=lastStamp[robot]))return;
   if(sourceStamp!==null)lastStamp[robot]=sourceStamp;
   robots[robot]={percentage,voltage,state:absent?'absent':percentage===null?'unknown':'fresh',receivedAt:now(),sourceStamp};
   currentData[robot]=true;changed();
  }
  function connect(){
   reconnect=null;if(!started)return;
   let current;
   try{current=new Socket(url);socket=current;}
   catch(_){offline();changed();schedule();return;}
   current.onopen=()=>{
    if(socket!==current||!started)return;
    connected=true;
    try{for(const topic of Object.keys(topics))current.send(JSON.stringify({op:'subscribe',id:'robot-battery:'+topic,topic,type:'sensor_msgs/msg/BatteryState',queue_length:1,throttle_rate:1000,qos:{history:'keep_last',depth:1,reliability:'best_effort',durability:'volatile'}}));}
    catch(_){current.close();return;}
    changed();
   };
   current.onmessage=event=>{
    if(socket!==current||!connected)return;
    let message;try{message=JSON.parse(event.data);}catch{return;}
    if(message&&typeof message==='object')receive(message);
   };
   current.onclose=()=>{if(socket!==current)return;socket=null;offline();changed();schedule();};
   current.onerror=()=>{if(socket===current)current.close();};
  }
  function start(){if(started)return;started=true;connect();tick=root.setTimeout(freshness,1000);}
  function close(){
   started=false;root.clearTimeout(reconnect);root.clearTimeout(tick);reconnect=null;tick=null;
   const previous=socket;socket=null;offline();previous?.close();changed();
  }
  return {start,close,snapshot};
 }
 const api={create};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RobotBatteryClient=api;
})(typeof window!=='undefined'?window:globalThis);
