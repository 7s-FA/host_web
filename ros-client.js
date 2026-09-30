/* Optional ROS telemetry. Independent of the HTTP Host command/ACK bridge. */
(function(root){
 'use strict';
 let ros=null,publisher=null,readState=null,initialized=false,allowed=false;
 const cfg=root.ROS_BRIDGE_CONFIG;
 const api={online:false,connect,disconnect,send};
 root.RosTelemetry=api;
 const el=id=>document.getElementById(id);
 function status(message){
  if(el('ros-status'))el('ros-status').textContent=message;
  if(el('ros-connect')){
   el('ros-connect').disabled=!allowed;
   el('ros-connect').textContent=ros?'ROS 연결 해제':'ROS 연결 / 재연결';
  }
 }
 function disconnect(){
  const old=ros,topic=publisher;
  ros=null;publisher=null;api.online=false;
  if(old){try{if(old.isConnected)topic?.unadvertise();old.close();}catch(_){}}
  status('ROS 상태 송신 · 연결 해제');
 }
 function connect(){
  if(!allowed)return;
  disconnect();
  if(!root.ROSLIB){status('ROS 라이브러리 없음 · 시뮬레이션은 계속 사용할 수 있습니다.');return;}
  try{
   const current=new root.ROSLIB.Ros();
   ros=current;
   publisher=new root.ROSLIB.Topic({ros:current,name:cfg.topic,messageType:cfg.messageType,reconnect_on_close:false,latch:false,queue_size:1});
   // ROSLIB 1.4.1 leaves this method unbound when reconnect_on_close is false.
   publisher.callForSubscribeAndAdvertise=message=>current.callOnConnection(message);
   current.on('connection',()=>{
    if(ros!==current)return;
    api.online=true;status(`ROS 연결됨 · ${cfg.topic} · ${cfg.publishIntervalMs}ms 간격 상태 송신`);
   });
   current.on('error',()=>{
    if(ros!==current)return;
    disconnect();status('ROS 연결 실패 · 서버 실행 후 재연결하세요.');
   });
   current.on('close',()=>{
    if(ros!==current)return;
    ros=null;publisher=null;api.online=false;
    status('ROS 연결 끊김 · 서버 실행 후 재연결하세요.');
   });
   status('ROS 연결 중…');
   current.connect(cfg.url);
  }catch(_){disconnect();status('ROS 연결 실패 · 주소와 서버를 확인하세요.');}
 }
 function send(payload){
  if(!api.online||!ros?.isConnected||!publisher)return false;
  try{
   publisher.publish(new root.ROSLIB.Message({data:typeof payload==='string'?payload:JSON.stringify(payload)}));
   return true; // publish 호출 결과이며 수신/작업 완료 ACK가 아닙니다.
  }catch(_){disconnect();status('ROS 송신 실패 · 재연결하세요.');return false;}
 }
 api.init=getState=>{
  if(initialized)return;
  initialized=true;readState=getState;
  if(root.HostBridge)root.HostBridge.sendToROS=send;
  if(el('ros-connect'))el('ros-connect').onclick=()=>ros?disconnect():connect();
  if(!cfg?.enabled){status('ROS 상태 송신 · 꺼짐');return;}
  const local=location.protocol==='http:'&&['localhost','127.0.0.1'].includes(location.hostname);
  if(cfg.localOnly&&!local){status('ROS 상태 송신 · 다운로드한 로컬 웹에서 사용');return;}
  try{
   const url=new URL(cfg.url);
   if(!['ws:','wss:'].includes(url.protocol)||!cfg.topic?.startsWith('/')||!cfg.messageType||!Number.isInteger(cfg.publishIntervalMs)||cfg.publishIntervalMs<100||cfg.publishIntervalMs>60000)throw Error();
  }catch(_){status('ROS 설정 오류 · ros-config.js를 확인하세요.');return;}
  allowed=true;
  setInterval(()=>{
   if(!api.online)return;
   try{send(readState());}catch(_){status('ROS 상태 읽기 실패');}
  },cfg.publishIntervalMs);
  connect();
 };
})(window);
