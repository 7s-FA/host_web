/* The map and device dashboard share the same real-robot stop controls. */
(()=>{
 'use strict';
 document.addEventListener('DOMContentLoaded',()=>{
  const buttons=[...document.querySelectorAll('[data-stop-robot]')];
  const restarts=[...document.querySelectorAll('[data-restart-robot]')];
  const errorResets=[...document.querySelectorAll('[data-error-reset-robot]')];
  if(!buttons.length)return;
  const statuses=[...document.querySelectorAll('[data-stop-status]')];
  const local=location.protocol==='http:'&&['localhost','127.0.0.1'].includes(location.hostname);
  if(!local){
   for(const button of [...buttons,...restarts,...errorResets])button.disabled=true;
   for(const status of statuses)status.textContent='Host PC의 로컬 화면에서 사용';
   return;
  }
  function paint(state){
   window.dispatchEvent(new CustomEvent('robot-controls-state',{detail:state}));
   for(const button of buttons){
    const robot=state.robots[button.dataset.stopRobot];
    const pending=robot.phase==='pending'&&robot.command==='EMER_STOP';
    button.disabled=!state.connected||pending;
    button.textContent=button.dataset.stopRobot+(pending?' 정지 요청 중':' 정지');
   }
   for(const button of restarts){
    const robot=state.robots[button.dataset.restartRobot];
    button.disabled=!robot.canRestart||!!window.hostInitialPreparationBusy;
    button.textContent=button.dataset.restartRobot+(robot.phase==='pending'&&robot.command==='RESTART'?' 해제 요청 중':' 정지 해제');
    button.title=robot.canRestart?'정지 잠금 해제 · 이전 이동을 재개하지 않습니다.':'최신 로봇 상태 수신 및 진행 중 작업 종료 후 사용할 수 있습니다.';
   }
   for(const status of statuses){
    const robot=state.robots[status.dataset.stopStatus];
    status.dataset.phase=robot.phase;
    status.textContent=robot.phase==='idle'?(state.connected?(robot.canRestart?'실제 로봇 정지·해제 요청 가능':'정지 가능 · 해제 상태 확인 대기'):'ROS 연결 대기 · 정지 요청 불가'):
     (robot.phase==='pending'?'':'최근 요청: ')+robot.message;
   }
  }
  const client=RobotStopClient.create({url:'ws://'+location.hostname+':9090',onChange:paint});
  for(const button of buttons)button.addEventListener('click',()=>client.requestStop(button.dataset.stopRobot));
  for(const button of restarts)button.addEventListener('click',()=>{if(!window.hostInitialPreparationBusy)client.requestRestart(button.dataset.restartRobot);});
  window.RobotStopControls={snapshot:client.snapshot,release:client.requestRestartResult};
  paint(client.snapshot());client.start();
  window.addEventListener('pagehide',()=>client.close());
  window.addEventListener('pageshow',event=>{if(event.persisted)client.start();});
 });
})();
