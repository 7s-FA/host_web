/* Real battery telemetry is independent of simulated motion and Host order state. */
(()=>{
 'use strict';
 document.addEventListener('DOMContentLoaded',()=>{
  const nodes=[...document.querySelectorAll('[data-battery-robot]')];
  if(!nodes.length)return;
  const local=location.protocol==='http:'&&['localhost','127.0.0.1'].includes(location.hostname);
  if(!local){for(const node of nodes){node.dataset.state='waiting';node.textContent='Host PC에서 배터리 확인';}return;}
  function paint(state){
   for(const node of nodes){
    const battery=state.robots[node.dataset.batteryRobot];
    node.dataset.state=battery.state;
    node.dataset.low=String(battery.state==='fresh'&&battery.percentage!==null&&battery.percentage<=20);
    const value=battery.percentage===null?'':`추정 ${battery.percentage}% · ${battery.voltage.toFixed(2)} V`;
    node.title='TurtleBot3 전압 기준 추정 잔량 (10.5~12.3 V). 배터리 부하와 상태에 따라 달라집니다.';
    if(battery.state==='fresh')node.textContent=value;
    else if(battery.state==='stale'||battery.state==='offline')node.textContent=(battery.state==='offline'?'통신 끊김':'수신 지연')+(value?' · 마지막 '+value:' · 잔량 미확인');
    else if(battery.state==='absent')node.textContent='배터리 감지 안 됨 · 잔량 미확인';
    else if(battery.state==='unknown')node.textContent='전압 미확인 · 잔량 미확인';
    else node.textContent='배터리 수신 대기';
   }
  }
  const client=RobotBatteryClient.create({url:'ws://'+location.hostname+':9090',onChange:paint});
  paint(client.snapshot());client.start();
  window.addEventListener('pagehide',()=>client.close());
  window.addEventListener('pageshow',event=>{if(event.persisted)client.start();});
 });
})();
