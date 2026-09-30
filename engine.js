/* Deterministic, seekable process simulation. Durations are illustrative seconds. */
(function (root) {
  'use strict';
  const Settings=typeof module!=='undefined'&&module.exports?require('./settings.js'):root.SimulationSettings;
  const POINTS = { home1:[110,700], home2:[110,795], waiting:[340,920], warehouse:[340,300], assembly:[400,750] };
  const DOCK_HEADINGS = {home:270,waiting:180,warehouse:0,assembly:90};
  const NAME = {home:'초기위치',waiting:'대기장소',warehouse:'자재창고',assembly:'제작공정'};
  function makePlan(quantity, config=Settings.defaults) {
    config=Settings.validate(config);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new RangeError('주문 수량은 1~20 사이의 정수로 입력하세요.');
    const tasks=[], events=[], jobs=[], tails=[0,0];
    let serial=0;
    const event=(time,kind,data={})=>events.push({time,kind,...data,serial:serial++});
    function task(actor,type,start,end,data={}) { const x={id:tasks.length,actor,type,start,end,...data}; tasks.push(x); return x; }
    function move(robot,from,to,start,duration,job=null) {
      const route=path(from,to,robot);
      const reverseSegments=[];
      if(['home','warehouse','assembly','waiting'].includes(from))reverseSegments.push(0);
      const motion=makeMotion(route,DOCK_HEADINGS[from],duration,reverseSegments,DOCK_HEADINGS[to],config['burger'+(robot+1)]);
      motion.forEach(phase=>{phase.parking=phase.type==='drive'&&to==='waiting'&&phase.to===route.at(-1);});
      const end=start+motion.at(-1).end;
      task(robot,'move',start,end,{from,to,job,motion});
      event(start,'move_start',{robot,from,to,job,text:`버거 ${robot+1} · ${NAME[to]}로 이동`,photo:to==='warehouse'?'warehouse':to==='home'?'home':'route'});
      for(const phase of motion){
        if(phase.type==='turn')event(start+phase.start,'turn_start',{robot,from,to,job,text:`버거 ${robot+1} · 정지 후 ${Math.abs(phase.delta)===180?'180° 방향 전환':phase.delta>0?'우회전 90°':'좌회전 90°'}`,photo:'route'});
        else event(start+phase.start,phase.reversing?'reverse_start':'drive_start',{robot,from,to,job,text:`버거 ${robot+1} · ${phase.parking?'대기장소 전진 주차':phase.reversing?`${NAME[from]} 10cm 후진 · 로컬 cmd_vel 출차`:'전방 정렬 완료 · 직선 주행'}`,photo:phase.parking?'waiting':'route'});
      }
      event(end,'arrive',{robot,from,to,job,text:`버거 ${robot+1} · ${NAME[to]} ${to==='waiting'?'전진 주차 완료':'도착'} · 후방 감지선 도달·정지`,photo:to==='waiting'?'waiting':to==='home'?'home':to==='assembly'?'process':'warehouse'});
      return end;
    }
    event(0,'order',{quantity,text:`Host 주문 접수 · A제품 ${quantity}개 / 두 카운트 ${quantity}로 설정`,photo:'route'});
    for(let i=0;i<quantity;i++) {
      const robot=i%2, prior=jobs[i-1], prevOwn=jobs[i-2];
      let warehouseStart;
      if(i===0) warehouseStart=0;
      else {
        if(i===1) tails[1]=move(1,'home','waiting',prior.loadStart,3,i);
        warehouseStart=Math.max(tails[robot],prior.assemblyStart);
      }
      const loadStart=move(robot,i===0?'home':'waiting','warehouse',warehouseStart,i===0?4:3,i);
      const loaded=loadStart+3*config.process.loadPartSeconds;
      task('arm1','load',loadStart,loaded,{robot,job:i});
      event(loadStart,'load_start',{robot,job:i,text:`로봇팔 1 · 버거 ${robot+1}에 부품 3개 적재 시작`,photo:'loading'});
      for(let n=1;n<=3;n++)event(loadStart+n*config.process.loadPartSeconds,'part',{robot,job:i,part:n,text:`제품 #${i+1} · 부품 ${n}/3 적재`,photo:'loading'});
      const dispatch=Math.max(loaded,prior?prior.palletEnd:0,prior?prior.waitEnd:0);
      task(robot,'gate',loaded,dispatch,{job:i});
      event(dispatch,'dispatch',{robot,job:i,text:`제품 #${i+1} · 제작공정 운송 시작 / 운송 잔여 −1`,photo:'route'});
      const arrived=move(robot,'warehouse','assembly',dispatch,5,i);
      const jigStart=prior?prior.palletEnd:0, jigReady=jigStart+config.process.linearPrepareSeconds;
      task('linear','prepare',jigStart,jigReady,{job:i});
      event(jigStart,'jig_start',{job:i,text:`리니어 모터 · A지그 위치로 이동`,photo:'process'});
      event(jigReady,'jig_ready',{job:i,text:`리니어 모터 · A지그 위치 도달`,photo:'process'});
      const assemblyStart=Math.max(arrived,jigReady), assemblyEnd=assemblyStart+config.process.assemblySeconds;
      task('arm2','assemble',assemblyStart,assemblyEnd,{robot,job:i});
      event(assemblyStart,'assembly_start',{robot,job:i,text:`로봇팔 2 · 제품 #${i+1} 티칭 조립 시작`,photo:'assembly'});
      event(assemblyEnd,'assembly_end',{robot,job:i,text:`제품 #${i+1} 조립 완료`,photo:'assembly'});
      task('linear','reset',assemblyEnd,assemblyEnd+config.process.linearHomeSeconds,{job:i});
      event(assemblyEnd,'jig_reset',{job:i,text:'리니어 모터 · 초기위치 복귀 시작',photo:'process'});
      event(assemblyEnd+config.process.linearHomeSeconds,'jig_home',{job:i,text:'리니어 모터 · 초기위치 복귀 완료',photo:'pallet'});
      const palletStart=assemblyEnd+config.process.linearHomeSeconds,palletEnd=palletStart+config.process.palletSeconds;
      task('arm3','pallet',palletStart,palletEnd,{job:i});
      event(palletStart,'pallet_start',{job:i,text:`로봇팔 3 · 제품 #${i+1} 파렛트 이송`,photo:'pallet'});
      event(palletEnd,'pallet_end',{job:i,text:`제품 #${i+1} 파렛트 적재 성공 / 완제품 잔여 −1`,photo:'pallet'});
      const last=i===quantity-1;
      let returnStart=assemblyEnd;
      if(last&&quantity>1){
        const other=1-robot;
        tails[other]=move(other,'waiting','home',Math.max(arrived,tails[other]),3);
        returnStart=Math.max(returnStart,tails[other]);
      }
      const waitEnd=move(robot,'assembly',last?'home':'waiting',returnStart,last?6:4,i);
      tails[robot]=waitEnd;
      jobs.push({id:i,robot,warehouseStart,loadStart,loaded,dispatch,arrived,assemblyStart,assemblyEnd,palletStart,palletEnd,waitEnd});
    }
    const last=jobs[quantity-1];
    const duration=Math.max(...tails,last.palletEnd);
    event(duration,'complete',{text:`주문 완료 · A제품 ${quantity}개 적재 / 버거 1·2 초기위치 확인`,photo:'pallet'});
    events.sort((a,b)=>a.time-b.time||a.serial-b.serial);
    return {quantity,tasks,events,jobs,duration,config};
  }
  function point(place,robot) {return POINTS[place==='home'?'home'+(robot+1):place];}
  function path(from,to,robot) {
    if(from==='home'&&(to==='warehouse'||to==='waiting')){
      const p=point(from,robot);
      // 40 drawing units illustrate the 10 cm local undock; this map has no metric scale.
      return [p,[p[0]+40,p[1]],[340,p[1]],point(to,robot)];
    }
    if(from==='waiting'&&to==='home'){
      const p=point(to,robot);
      return [point(from,robot),[340,880],[340,p[1]],p];
    }
    // Each bay joins the central vertical aisle; never cut across a workboard.
    const branch=place=>{
      const p=point(place,robot);
      if(place==='home')return [p,[340,p[1]],[340,750]];
      return [p,[340,750]];
    };
    const points=[...branch(from),...branch(to).reverse()];
    const route=points.filter((p,i)=>!i||p[0]!==points[i-1][0]||p[1]!==points[i-1][1]);
    // Split the first straight segment to clear the dock before a 180-degree turn.
    if(from==='warehouse')route.splice(1,0,[340,340]);
    if(from==='assembly')route.splice(1,0,[360,750]);
    if(from==='waiting')route.splice(1,0,[340,880]);
    return route;
  }
  function pose(points,progress,reverseLast=false) {
    const lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1]));
    let distance=lengths.reduce((a,b)=>a+b,0)*Math.max(0,Math.min(1,progress));
    for(let i=0;i<lengths.length;i++) {
      if(distance<=lengths[i]||i===lengths.length-1) {
        const f=lengths[i]?distance/lengths[i]:0;
        const dx=points[i+1][0]-points[i][0],dy=points[i+1][1]-points[i][1];
        const reversing=reverseLast&&i===lengths.length-1;
        return {position:[points[i][0]+dx*f,points[i][1]+dy*f],heading:(Math.atan2(dy,dx)*180/Math.PI+450+(reversing?180:0))%360,reversing};
      }
      distance-=lengths[i];
    }
    return {position:points.at(-1),heading:0};
  }
  function position(points,progress) {return pose(points,progress).position;}
  function makeMotion(points,initialHeading,driveDuration,reverseSegments=[],finalHeading=null,speeds={forwardSpeed:1,reverseSpeed:1,turnSpeed:90}){
    const lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1]));
    const total=lengths.reduce((a,b)=>a+b,0),motion=[];
    let cursor=0,heading=initialHeading;
    for(let i=0;i<lengths.length;i++){
      if(!lengths[i])continue;
      const a=points[i],b=points[i+1],reversing=reverseSegments.includes(i);
      const next=(Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI+450+(reversing?180:0))%360;
      const delta=(next-heading+540)%360-180;
      if(Math.abs(delta)>1e-8){
        const end=cursor+Math.abs(delta)/speeds.turnSpeed; // Configured illustrative angular speed.
        motion.push({type:'turn',start:cursor,end,position:a,heading,delta,targetHeading:next});
        cursor=end;
      }
      const end=cursor+driveDuration*lengths[i]/total/(reversing?speeds.reverseSpeed:speeds.forwardSpeed);
      motion.push({type:'drive',start:cursor,end,from:a,to:b,heading:next,reversing});
      cursor=end;heading=next;
    }
    if(finalHeading!==null){
      const delta=(finalHeading-heading+540)%360-180;
      if(Math.abs(delta)>1e-8)motion.push({type:'turn',start:cursor,end:cursor+Math.abs(delta)/speeds.turnSpeed,position:points.at(-1),heading,delta,targetHeading:finalHeading});
    }
    return motion;
  }
  function motionPose(task,time){
    const elapsed=Math.max(0,Math.min(task.end-task.start,time-task.start));
    const phase=task.motion.find(p=>elapsed<p.end)||task.motion.at(-1);
    const f=Math.max(0,Math.min(1,(elapsed-phase.start)/(phase.end-phase.start)));
    if(phase.type==='turn'){
      const eased=f*f*(3-2*f);
      return {position:[...phase.position],heading:(phase.heading+phase.delta*eased+360)%360,reversing:false,turning:true};
    }
    return {position:phase.from.map((v,i)=>v+(phase.to[i]-v)*f),heading:phase.heading,reversing:phase.reversing,parking:!!phase.parking,turning:false};
  }
  function snapshot(plan,time) {
    time=Math.max(0,Math.min(plan.duration,time));
    const robots=[0,1].map(i=>({id:i,place:'home',status:'초기위치 대기',parts:0,job:null,heading:DOCK_HEADINGS.home,position:point('home',i)}));
    const state={time,quantity:plan.quantity,transport:plan.quantity,remaining:plan.quantity,completed:0,robots,linear:0,arms:['대기','대기','대기'],events:[],done:false};
    for(const e of plan.events) {
      if(e.time>time+1e-7)break;
      state.events.push(e);const r=robots[e.robot];
      switch(e.kind) {
        case 'move_start': r.place=e.to;r.status=NAME[e.to]+' 이동';r.job=e.job;break;
        case 'arrive':r.status=e.to==='home'?'초기위치 복귀 완료':NAME[e.to]+' 대기';r.position=point(e.to,e.robot);r.heading=DOCK_HEADINGS[e.to];break;
        case 'load_start':r.status='부품 적재 중';state.arms[0]='부품 적재 중';break;
        case 'part':r.parts=e.part;if(e.part===3){r.status='부품 적재 완료 · 진입 대기';state.arms[0]='대기';}break;
        case 'dispatch':state.transport--;break;
        case 'assembly_start':r.status='티칭 조립 중';state.arms[1]='티칭 조립 중';break;
        case 'assembly_end':r.parts=0;state.arms[1]='대기';break;
        case 'jig_ready':state.linear=1;break;
        case 'jig_home':state.linear=0;break;
        case 'pallet_start':state.arms[2]='완제품 이송 중';break;
        case 'pallet_end':state.completed++;state.remaining--;state.arms[2]='대기';break;
        case 'complete':state.done=true;break;
      }
    }
    state.active=plan.tasks.filter(x=>x.start<=time&&time<x.end);
    for(const t of state.active) {
      const f=(time-t.start)/(t.end-t.start);
      if(t.type==='move'){
        const r=robots[t.actor];
        Object.assign(r,motionPose(t,time));
        if(r.turning)r.status='정지 · 제자리 회전 중';
        else if(r.reversing)r.status=NAME[t.from]+' 10cm 후진 중';
        else if(r.parking)r.status='대기장소 전진 주차 중';
      }
      if(t.type==='prepare')state.linear=f;
      if(t.type==='reset')state.linear=1-f;
    }
    state.focus=[...state.active].sort((a,b)=>({pallet:5,assemble:4,load:3,move:2,prepare:1,reset:1,gate:0}[b.type]||0)-({pallet:5,assemble:4,load:3,move:2,prepare:1,reset:1,gate:0}[a.type]||0))[0];
    return state;
  }
function stagesFor(quantity,config=Settings.defaults){
 const p=makePlan(quantity,config);
 const completed=e=>['arrive','assembly_end','jig_ready','jig_home','pallet_end','complete'].includes(e.kind)||(e.kind==='part'&&e.part===3);
 // A global ACK barrier must never freeze another robot halfway through its trip.
 // Keep turns/drives inside each move; pause only when every moving robot has
 // reached a destination (a new trip at this exact boundary has not moved yet).
 const times=[...new Set(p.events.filter(completed).map(e=>e.time))]
  .filter(time=>!p.tasks.some(t=>t.type==='move'&&t.start<time-1e-7&&time<t.end-1e-7))
  .sort((a,b)=>a-b);
 return times.map((time,index)=>{
  const previous=index?times[index-1]:-1;
  const s=snapshot(p,time);
  return {seq:index+1,time,events:p.events.filter(e=>e.time>previous&&e.time<=time),
   transport:s.transport,remaining:s.remaining,completed:s.completed,done:s.done};
 });
}

  function stageConditions(plan, stage, time){
    if(!stage)return [];
    const completed=e=>['arrive','assembly_end','jig_ready','jig_home','pallet_end','complete'].includes(e.kind)||(e.kind==='part'&&e.part===3);
    const conditions=stage.events.filter(completed).map(e=>({label:e.text,signal:e.kind==='part'?'part × 3':e.kind,done:time+1e-7>=e.time}));
    for(const e of stage.events.filter(e=>e.kind==='dispatch')){
      const job=plan.jobs[e.job],prev=plan.jobs[e.job-1];
      const gates=[['부품 3개 적재',job.loaded,'part × 3'],...(prev?[
        ['앞 제품 파렛트 적재',prev.palletEnd,'pallet_end'],['앞 버거 대기장소 도착',prev.waitEnd,'arrive · waiting']]:[])];
      for(const [label,at,signal] of gates)conditions.push({label:`제품 #${job.id+1} 출발 조건 · ${label}`,signal,done:time+1e-7>=at});
    }
    return conditions;
  }
  const api={stagesFor,stageConditions,makePlan,snapshot,path,position,pose,makeMotion,motionPose,POINTS,DOCK_HEADINGS};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RobotSimulation=api;
})(typeof window!=='undefined'?window:globalThis);
