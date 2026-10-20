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
 function buildMetricMap(){
  const svg=el('factory-map'),model=LiveMapModel,scale=LIVE_MAP_CONFIG.metric.pixelsPerMeter;
  const ns='http://www.w3.org/2000/svg';
  const node=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;};
  // Keep the original station illustrations and their live arm status IDs.
  // Replace only the schematic roads/waypoints with a uniform metric projection.
  for(const child of [...svg.children]){
   const tag=child.tagName.toLowerCase();
   if(!['defs','title','desc'].includes(tag)&&!child.matches('.station,#robot1,#robot2'))child.style.display='none';
  }
  const layer=node('g',{id:'metric-map-layer'});
  svg.insertBefore(layer,svg.querySelector('.station'));
  layer.append(node('rect',{x:-60,y:-130,width:1030,height:1940,rx:10,fill:'#f1f3f2'}));
  layer.append(node('rect',{x:20,y:20,width:680,height:1080,rx:8,fill:'url(#grid)',stroke:'#d6dddf'}));
  const robots=LIVE_MAP_CONFIG.calibration.robots;
  const points=robots[0].knots.map(k=>model.projectPoint(k.x,k.y));
  const homes=robots.map(r=>model.projectPoint(r.home.x,r.home.y));
  const mat=model.projectPoint(.45969099,.85449041);
  const wp1=points[2],wp2=points[3],wp3=points[1],wp4=points[0];
  const road=`M${mat} L${wp2} L${wp1} L${wp3} L${wp4} V990 M${homes[0]} L${wp1} M${homes[1]} L${wp4} M${wp3} H440`;
  layer.append(node('path',{d:road,fill:'none',stroke:'#fff','stroke-width':62,'stroke-linejoin':'round','stroke-linecap':'round'}));
  layer.append(node('path',{d:road,fill:'none',stroke:'#b4c5cc','stroke-width':2,'stroke-dasharray':'8 8'}));
  layer.append(node('text',{x:wp2[0]+55,y:415,'text-anchor':'start',fill:'#748893','font-size':18},'운반 통로'));
  // Artwork anchors describe the station side of the route, not surveyed footprints.
  const warehouse=svg.querySelector('[data-photo="warehouse"]');
  warehouse.setAttribute('transform',`translate(${mat[0]-340} 0)`);
  const home=svg.querySelector('[data-photo="home"]');
  const box=home.querySelector('rect');box.setAttribute('height',homes[1][1]-656+50);
  home.querySelector('path').setAttribute('d',homes.map(([x,y])=>`M${x+33} ${y-32} H${x-33} V${y+32} H${x+33}`).join(' '));
  const processShift=wp3[1]-750;
  for(const name of ['process','pallet'])svg.querySelector(`[data-photo="${name}"]`).setAttribute('transform',`translate(0 ${processShift})`);
  const waiting=svg.querySelector('[data-photo="waiting"]');waiting.setAttribute('transform',`translate(${wp4[0]-340} 70)`);
  // The original last line sits below the drawing; keep it inside the canvas.
  waiting.querySelector('.zone-sub').setAttribute('y','1020');
  waiting.querySelector('.zone-sub').setAttribute('font-size','14');
  const markers=node('g',{id:'live-layout-markers'});svg.append(markers);
  for(let i=0;i<2;i++){
   const color=i===0?'#2078aa':'#b86b20';
   markers.append(node('circle',{cx:homes[i][0],cy:homes[i][1],r:5,fill:color}));
   markers.append(node('text',{x:homes[i][0],y:homes[i][1]+52,'text-anchor':'middle',fill:color,'font-size':18},`M${i+1} 주차`));
   for(let j=0;j<robots[i].knots.length;j++){
    const k=robots[i].knots[j],[x,y]=model.projectPoint(k.x,k.y),name=[4,3,1,2][j];
    markers.append(node('circle',{cx:x,cy:y,r:5,fill:'#fff',stroke:color,'stroke-width':2}));
    // Label the common waypoint once; colored dots retain each robot's actual point.
    if(i===0)markers.append(node('text',{x:x-15,y:y-10,'text-anchor':'end',fill:'#345c70','font-size':18,'font-weight':700},`WP${name}`));
   }
  }
  markers.append(node('path',{d:`M430 1070 h${scale*.5} m-${scale*.5} -5v10 m${scale*.5} -10v10`,stroke:'#536e7b','stroke-width':2}));
  markers.append(node('text',{x:550,y:1055,'text-anchor':'middle','font-size':17,fill:'#536e7b'},'0.5 m · 로봇 위치 축척'));
  for(let i=1;i<=2;i++)svg.append(el('robot'+i));
  svg.setAttribute('viewBox',model.viewBox.join(' '));
  svg.setAttribute('preserveAspectRatio','xMidYMid meet');
  const toolbar=document.createElement('div');toolbar.className='metric-map-toolbar';
  const full=document.createElement('button'),work=document.createElement('button'),note=document.createElement('span');
  full.type=work.type='button';full.textContent='전체 지도';work.textContent='작업 구역 확대';note.textContent='실제 좌표 · 가로·세로 동일 축척';
  full.onclick=()=>{svg.dataset.fullMap='true';svg.setAttribute('viewBox',model.fullViewBox.join(' '));};
  work.onclick=()=>{svg.dataset.fullMap='false';svg.setAttribute('viewBox',model.viewBox.join(' '));};
  toolbar.append(work,full,note);document.querySelector('.map-stage-layout').before(toolbar);
 }

 function init(){
  document.body.classList.add('live-map-mode');
  if(new URLSearchParams(location.search).get('embedded')==='1'){
   document.body.classList.add('live-map-embedded');
   const summary=document.createElement('div');summary.className='live-map-summary';
   summary.setAttribute('aria-label','실제 수신 상태');
   for(const key of ['M1','M2','arm1','arm2','arm3']){
    const item=document.createElement('p');item.id='live-state-'+key;summary.append(item);
   }
   document.querySelector('.map-panel').prepend(summary);
  }
  buildMetricMap();
  document.title='Robot3 · 실물 상태';
  document.querySelector('.demo-badge').textContent='실물 상태';
  document.querySelector('.map-panel h2').textContent='실물 상태 · 공정 배치도';
  document.querySelector('[data-tab="simulation"]').textContent='실물 상태';
  document.querySelector('.map-scale').textContent='가로·세로 동일 축척';
  document.querySelector('.dashboard-context').textContent='M1 · M2 · 로봇팔 3대';
  document.querySelector('.navigation-heading span').textContent='실제 수신 상태';
  document.querySelector('.console-mode').textContent='상태 보기';
  document.querySelector('.console-footer').textContent='LIVE MONITOR · 상태 수신';
  document.querySelector('footer p').textContent='로봇 위치와 경유점은 실제 좌표를 동일 축척으로 표시합니다. 설비 그림의 크기와 외곽선은 배치 안내용입니다.';
  const mode=el('map-mode');mode.href='./';mode.textContent='시뮬레이션 보기';
  el('live-map-help').hidden=false;
  set('map-title','M1·M2 실제 위치와 로봇팔 작업 상태');
  set('map-desc','기존 공정 배치도에 M1·M2 실제 좌표와 경유점을 동일 축척으로 표시합니다. 설비 그림은 배치 안내용이며 회색 로봇은 마지막 수신 위치입니다.');
  set('stage-number','실제 좌표 · 작업 상태');set('stage-title','M1 · M2 위치 동기화');
  set('stage-detail','로봇에서 받은 위치와 방향을 표시합니다. 회색 아이콘은 마지막 수신 위치입니다.');
  set('stage-work-label','수신된 장비 상태');set('conditions-title','위치 수신 상태');
  set('conditions-note','로봇팔 동작은 작업 중 표시입니다. 화면을 새로 열면 해당 작업의 상태 피드백 수신 전까지 상태 미확인으로 표시합니다.');
  set('scene-kicker','ON-SITE REFERENCE');set('scene-title','현장 배치 참고 사진');
  set('scene-detail','현재 화면의 지도는 실제 수신 상태를 표시하고, 사진은 배치 참고용입니다.');
  set('pallet-count','적재 상태 미연결');
  for(const id of ['start','step-order','play','reset','next','previous','timeline','quantity','product','host-connect','host-next','host-pause','host-reset','host-auto','ros-connect','follow','export'])el(id).disabled=true;
  for(const button of document.querySelectorAll('#order-form button'))button.disabled=true;
  el('order-selection').hidden=true;
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
  set('order-id','실제 주문·진행은 실물 관제에서 확인하세요.');
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
    if(fresh){t.current=fraction>=1?[...t.to]:t.from.map((v,j)=>v+(t.to[j]-v)*fraction);t.heading=t.headingFrom+((t.headingTo-t.headingFrom+540)%360-180)*fraction;}
    g.setAttribute('transform',`translate(${t.current.join(' ')})`);
    g.querySelector('.robot-body').setAttribute('transform',`rotate(${t.heading})`);
   }
   const outside=pose?.withinMap===false;
   g.style.visibility=t&&!outside?'visible':'hidden';g.classList.toggle('pose-stale',!fresh);
   const age=pose?Math.max(0,Math.floor((now-pose.stamp)/1000)):null;
   const received=age===null?'':age<1?'방금 수신':`${age}초 전 좌표`;
   const coordinates=pose?.world?`x ${pose.world.x.toFixed(2)}, y ${pose.world.y.toFixed(2)} m`:'';
   const status=!t?'위치 수신 대기':outside?`원본 지도 범위 밖 · 아이콘 미표시 · ${coordinates} · ${received}`:
    !fresh?`위치 수신 지연 · ${coordinates} · ${received}`:`위치 수신 중 · ${coordinates}`;
   el('device-b'+(i+1)).querySelector('.device-status').textContent=status;
   statuses.push(`M${i+1} · ${status}`);
   const summary=el('live-state-M'+(i+1));
   if(summary){summary.textContent=statuses.at(-1);summary.dataset.fresh=String(!!fresh&&!outside);}
   el('navigation-b'+(i+1)).setAttribute('aria-pressed',String(selected===i));
   if(selected===i){
    set('navigation-summary',`M${i+1} · ${status}`);
    list('navigation-steps',fresh&&robot.mission?[`작업 상태: ${robot.mission.status||'—'}`,`주행 단계: ${robot.mission.stage||'—'}`]:['현재 주행 단계 확인 대기']);
   }
  }
  // Expand the display if a received in-map position leaves the working drawing.
  // This affects the viewport only, never the coordinate projection or robot commands.
  const map=el('factory-map');
  if(map.dataset.fullMap!=='true'){
   const base=LiveMapModel.viewBox;
   let left=base[0],top=base[1],right=left+base[2],bottom=top+base[3];
   for(let i=0;i<2;i++)if(tracks[i]&&state?.robots[i]?.pose?.withinMap){
    const [x,y]=tracks[i].current;left=Math.min(left,x-55);top=Math.min(top,y-55);
    right=Math.max(right,x+55);bottom=Math.max(bottom,y+55);
   }
   map.setAttribute('viewBox',[left,top,right-left,bottom-top].join(' '));
  }
  for(const i of [0,1,2]){
   const arm=state?.arms[i],active=connected&&!!arm?.active;
   const status=connected&&arm?.available?labels[arm.state]||labels.unknown:labels.unknown;
   const card=el('device-a'+(i+1));card.querySelector('.device-status').textContent=status;card.classList.toggle('working',active);
   const g=el('arm'+(i+1)+'-map');g.classList.toggle('active-arm',active);
   // Feedback gives task state, not joint angles: do not invent arm movement.
   g.querySelector('use').setAttribute('transform','rotate(0)');
   statuses.push(`로봇팔 ${i+1} · ${status}`);
   const summary=el('live-state-arm'+(i+1));
   if(summary){summary.textContent=statuses.at(-1);summary.dataset.fresh=String(connected&&!!arm?.available&&arm.state!=='unknown');}
  }
  list('conditions-list',statuses.slice(0,2));list('stage-work-list',statuses);
 }
 return {enabled,init,render};
})();
