/* The map and device dashboard share the same real-robot stop controls. */
(()=>{
 'use strict';
 document.addEventListener('DOMContentLoaded',()=>{
  const buttons=[...document.querySelectorAll('[data-stop-robot]')];
  if(!buttons.length)return;
  const statuses=[...document.querySelectorAll('[data-stop-status]')];
  const local=location.protocol==='http:'&&['localhost','127.0.0.1'].includes(location.hostname);
  if(!local){
   for(const button of buttons)button.disabled=true;
   for(const status of statuses)status.textContent='Host PC의 로컬 화면에서 사용';
   return;
  }
  function paint(state){
   for(const button of buttons){
    const robot=state.robots[button.dataset.stopRobot];
    button.disabled=!state.connected||robot.phase==='pending';
    button.textContent=button.dataset.stopRobot+(robot.phase==='pending'?' 정지 요청 중':' 정지');
   }
   for(const status of statuses){
    const robot=state.robots[status.dataset.stopStatus];
    status.dataset.phase=robot.phase;
    status.textContent=robot.phase==='idle'?(state.connected?'실제 로봇 정지 요청 가능':'ROS 연결 대기 · 정지 요청 불가'):
     (robot.phase==='pending'?'':'최근 요청: ')+robot.message;
   }
  }
  const client=RobotStopClient.create({url:'ws://'+location.hostname+':9090',onChange:paint});
  for(const button of buttons)button.addEventListener('click',()=>client.requestStop(button.dataset.stopRobot));
  paint(client.snapshot());client.start();
  window.addEventListener('pagehide',()=>client.close());
  window.addEventListener('pageshow',event=>{if(event.persisted)client.start();});
 });
})();
