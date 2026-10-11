/* Connection lights show ROS evidence, independently of simulated work and adapter orders. */
(()=>{
 'use strict';
 document.addEventListener('DOMContentLoaded',()=>{
  const nodes=[...document.querySelectorAll('[data-device-connection]')];
  if(!nodes.length)return;
  const labels={waiting:'확인 중',online:'연결됨',partial:'일부 연결',offline:'연결 끊김',unknown:'확인 불가'};
  const names={host:'Host',M1:'M1',M2:'M2',arm1:'로봇팔 1',arm2:'로봇팔 2',arm3:'로봇팔 3',warehouse:'자재창고',production:'제작공정'};
  const local=location.protocol==='http:'&&['localhost','127.0.0.1'].includes(location.hostname);
  function paint(snapshot){
   for(const node of nodes){
    const key=node.dataset.deviceConnection,device=snapshot.devices[key];
    if(node.dataset.state===device.state&&node.title===device.detail)continue;
    node.dataset.state=device.state;
    node.querySelector('.connection-text').textContent=labels[device.state];
    node.title=device.detail;
    node.setAttribute('aria-label',names[key]+' '+labels[device.state]+'. '+device.detail);
   }
  }
  if(!local){
   for(const node of nodes){node.dataset.state='waiting';node.querySelector('.connection-text').textContent='Host PC에서 확인';node.title='Host PC에서 로컬 웹페이지를 열면 실제 ROS 연결을 확인합니다.';}
   return;
  }
  const client=DeviceConnectionClient.create({url:'ws://'+location.hostname+':9090',onChange:paint});
  paint(client.snapshot());client.start();
  window.addEventListener('pagehide',()=>client.stop());
  window.addEventListener('pageshow',event=>{if(event.persisted)client.start();});
 });
})();
