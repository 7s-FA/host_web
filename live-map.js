'use strict';
window.LiveMap=(()=>{
 const enabled=new URLSearchParams(location.search).get('live')==='1';
 const el=id=>document.getElementById(id);
 const set=(id,text)=>{if(el(id).textContent!==text)el(id).textContent=text;};
 let client=null,selected=0;
 const tracks=[null,null];
 const labels={running:'동작 중',paused:'일시정지',idle:'대기',error:'오류',unknown:'상태 미확인'};
 function list(id,items){
  const node=el(id),key=JSON.stringify(items);
  if(node.dataset.liveItems===key)return;
  node.dataset.liveItems=key;
  node.replaceChildren(...items.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
 }
 function init(){
  document.body.classList.add('live-map-mode');
  document.title='Robot3 · 실물 상태';
  document.querySelector('.demo-badge').textContent='실물 상태';
  document.querySelector('.map-panel h2').textContent='실물 상태 · 기존 배치도';
  document.querySelector('[data-tab="simulation"]').textContent='실물 상태';
  document.querySelector('.map-scale').textContent='기준점 보정 · 개념도';
  document.querySelector('.dashboard-context').textContent='M1 · M2 · 로봇팔 3대';
  document.querySelector('.navigation-heading span').textContent='실제 수신 상태';
  document.querySelector('.console-mode').textContent='상태 보기';
  document.querySelector('.console-footer').textContent='LIVE MONITOR · 상태 수신';
  document.querySelector('footer p').textContent='실제 좌표를 기존 배치도에 보정해 표시합니다. 로봇팔은 작업 상태에 따라 움직입니다.';
  const mode=el('map-mode');mode.href='./';mode.textContent='시뮬레이션 보기';
  el('live-map-help').hidden=false;
  set('map-title','M1·M2 실제 위치와 로봇팔 작업 상태');
  set('map-desc','실제 map 좌표를 M1·M2별 WP1~4 기준으로 기존 배치도에 맞춥니다. 정밀 축척 지도는 아닙니다. 오래된 위치는 흐리게 표시합니다.');
  set('stage-number','실제 좌표 · 작업 상태');set('stage-title','M1 · M2 위치 동기화');
  set('stage-detail','로봇에서 받은 위치와 방향을 표시합니다. 회색 아이콘은 마지막 수신 위치입니다.');
  set('stage-work-label','수신된 장비 상태');set('conditions-title','위치 수신 상태');
  set('conditions-note','로봇팔 동작은 작업 중 표시입니다. 화면을 새로 열면 해당 작업의 상태 피드백 수신 전까지 상태 미확인으로 표시합니다.');
  set('scene-kicker','ON-SITE REFERENCE');set('scene-title','현장 배치 참고 사진');
  set('scene-detail','현재 화면의 지도는 실제 수신 상태를 표시하고, 사진은 배치 참고용입니다.');
  set('pallet-count','적재 상태 미연결');
  for(const id of ['start','step-order','play','reset','next','previous','timeline','quantity','plus','minus','product','host-connect','host-next','host-pause','host-reset','host-auto','ros-connect','follow','export'])el(id).disabled=true;
  for(const i of [0,1])el('navigation-b'+(i+1)).onclick=()=>{selected=i;};
  const local=location.protocol==='http:'&&['localhost','127.0.0.1'].includes(location.hostname);
  if(local){client=LiveMapClient.create({url:LIVE_MAP_CONFIG.url});client.start();window.addEventListener('pagehide',()=>client.stop());}
  else set('host-status','Host PC의 http://localhost:8082/?live=1 에서 열어 주세요.');
  render();
 }
 function render(){
  const now=Date.now(),state=client?.snapshot(),connected=!!state?.connected;
  set('stage-status',connected?'ROS 연결됨':'연결 대기');
  set('run-status',connected?'실물 상태 수신 중':'실물 연결 대기');
  set('order-id','실제 주문·진행은 Host 프로그램에서 확인하세요.');
  if(client)set('host-status',connected?'Host rosbridge 연결됨':'Host rosbridge 연결 대기 · 자동 재연결');
  set('ros-status',state?.error||'M1·M2 위치 / 로봇팔 작업 상태 수신');
  const statuses=[];
  for(const i of [0,1]){
   const robot=state?.robots[i],pose=robot?.pose,g=el('robot'+(i+1));
   const fresh=connected&&pose&&now-pose.stamp<=LIVE_MAP_CONFIG.poseMaxAgeMs;
   const track=tracks[i];
   if(pose&&(!track||pose.stamp>track.stamp)){
    tracks[i]={stamp:pose.stamp,from:track?.current||pose.position,headingFrom:track?.heading??pose.heading,to:pose.position,headingTo:pose.heading,current:pose.position,heading:pose.heading,at:now};
   }
   const t=tracks[i];
   // Only interpolate between received positions; never predict travel from a mission.
   if(t){
    const fraction=fresh?Math.min(1,(now-t.at)/LIVE_MAP_CONFIG.interpolationMs):0;
    if(fresh){t.current=t.from.map((v,j)=>v+(t.to[j]-v)*fraction);t.heading=t.headingFrom+((t.headingTo-t.headingFrom+540)%360-180)*fraction;}
    g.setAttribute('transform',`translate(${t.current.join(' ')})`);
    g.querySelector('.robot-body').setAttribute('transform',`rotate(${t.heading})`);
   }
   g.style.visibility=t?'visible':'hidden';g.classList.toggle('pose-stale',!fresh);
   const status=!t?'위치 수신 대기':!fresh?'위치 수신 지연 · 마지막 위치':'위치 수신 중';
   el('device-b'+(i+1)).querySelector('.device-status').textContent=status;
   statuses.push(`M${i+1} · ${status}`);
   el('navigation-b'+(i+1)).setAttribute('aria-pressed',String(selected===i));
   if(selected===i){
    set('navigation-summary',`M${i+1} · ${status}`);
    list('navigation-steps',fresh&&robot.mission?[`작업 상태: ${robot.mission.status||'—'}`,`주행 단계: ${robot.mission.stage||'—'}`]:['현재 주행 단계 확인 대기']);
   }
  }
  for(const i of [0,1,2]){
   const arm=state?.arms[i],active=connected&&!!arm?.active;
   const status=connected&&arm?.available?labels[arm.state]||labels.unknown:labels.unknown;
   const card=el('device-a'+(i+1));card.querySelector('.device-status').textContent=status;card.classList.toggle('working',active);
   const g=el('arm'+(i+1)+'-map');g.classList.toggle('active-arm',active);
   g.querySelector('use').setAttribute('transform',active?`rotate(${Math.sin(now/1000*2.6)*12})`:'rotate(0)');
   statuses.push(`로봇팔 ${i+1} · ${status}`);
  }
  list('conditions-list',statuses.slice(0,2));list('stage-work-list',statuses);
 }
 return {enabled,init,render};
})();
