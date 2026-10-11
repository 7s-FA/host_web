const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../robot-stop-client.js'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const goals=socket=>socket.sent.filter(message=>message.op==='send_action_goal');
function fixture(browser=false){
 let clock=100000,timerId=0,uuid=0,failConnect=false;
 const timers=new Map(),sockets=[],changes=[];
 class Socket{
  static OPEN=1;
  constructor(url){if(failConnect)throw Error('connect failed');this.url=url;this.readyState=0;this.sent=[];sockets.push(this);}
  send(raw){if(this.failSend)throw Error('send failed');assert.equal(this.readyState,1);this.sent.push(JSON.parse(raw));}
  open(){this.readyState=1;this.onopen();}
  message(message){this.onmessage({data:JSON.stringify(message)});}
  close(){this.readyState=3;this.onclose?.();}
 }
 function timer(fn,ms,period){const id=++timerId;timers.set(id,{fn,at:clock+ms,period});return id;}
 const context={WebSocket:Socket,crypto:{randomUUID:()=>String(++uuid)},setTimeout:(fn,ms)=>timer(fn,ms),clearTimeout:id=>timers.delete(id),setInterval:(fn,ms)=>timer(fn,ms,ms),clearInterval:id=>timers.delete(id)};
 if(browser)context.window=context;else context.module={exports:{}};
 vm.runInNewContext(source,context);
 const api=browser?context.RobotStopClient:context.module.exports;
 const options={url:'ws://localhost:9090',WebSocket:Socket,now:()=>clock};
 const client=api.create({...options,onChange:s=>changes.push(s)});
 function advance(ms){
  const end=clock+ms;
  while(true){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;
   const [id,t]=next;clock=Math.max(clock,t.at);if(t.period)t.at=clock+t.period;else timers.delete(id);t.fn();}
  clock=end;
 }
 return {api,options,client,sockets,timers,changes,advance,failConnect:value=>failConnect=value,jump:ms=>clock+=ms,timeouts:()=>[...timers.values()].filter(t=>!t.period).length};
}
function result(socket,goal,overrides={}){socket.message({op:'action_result',id:goal.id,action:goal.action,result:true,status:4,values:{success:true,message:'IDLE'},...overrides});}
function owner(socket,robot,mode='idle'){socket.message({op:'publish',topic:'/burger'+robot.at(-1)+'/motion_owner/communication_status',msg:{data:JSON.stringify({mode})}});}
function mission(socket,robot,status){socket.message({op:'publish',topic:'/burger'+robot.at(-1)+'/mission/status',msg:{data:JSON.stringify({status})}});}
function checkSubscriptions(socket){
 assert.deepEqual(socket.sent.map(m=>m.topic),['/burger1/motion_owner/communication_status','/burger1/mission/status','/burger2/motion_owner/communication_status','/burger2/mission/status']);
 for(const m of socket.sent){assert.equal(m.op,'subscribe');assert.equal(m.id,'robot-stop:'+m.topic.slice(1));assert.equal(m.type,'std_msgs/msg/String');assert.equal(m.throttle_rate,1000);assert.equal(m.queue_length,1);}
}
function checkGoal(goal,robot,command){assert.deepEqual(goal,{op:'send_action_goal',id:goal.id,action:'/'+robot+'/data',action_type:'host_pkg/action/Burger',args:{command,cmd_val:0},feedback:true});}

const f=fixture(),c=f.client;
assert.equal(f.sockets.length,0);assert.deepEqual(plain(c.snapshot()),{connected:false,robots:{M1:{phase:'idle',message:'정지 요청 대기',canRestart:false},M2:{phase:'idle',message:'정지 요청 대기',canRestart:false}}});
for(const name of ['M3','burger1','__proto__',null]){assert.equal(c.requestStop(name),false);assert.equal(c.requestRestart(name),false);}
assert.equal(c.requestRestart('M1'),false);assert.equal(c.requestStop('M1'),false);assert.equal(c.snapshot().robots.M1.phase,'error');assert.equal(f.sockets.length,0);
c.start();c.start();assert.equal(f.sockets.length,1);const socket=f.sockets[0];socket.open();assert.equal(c.snapshot().connected,true);checkSubscriptions(socket);assert.equal(goals(socket).length,0,'Opening only subscribes');assert.equal(c.requestRestart('M1'),false,'Release requires fresh robot state');
assert(c.requestStop('M1'));const first=goals(socket).at(-1);checkGoal(first,'M1','EMER_STOP');
assert.equal(c.snapshot().robots.M1.phase,'pending');assert.equal(c.requestStop('M1'),false);owner(socket,'M1');assert.equal(c.requestRestart('M1'),false,'Pending stop blocks release');assert.equal(goals(socket).length,1,'Same-robot pending blocks duplicate clicks');
assert(c.requestStop('M2'));const second=goals(socket).at(-1);assert.equal(second.action,'/M2/data');assert.notEqual(first.id,second.id);
result(socket,first,{id:'unrelated'});result(socket,first,{action:'/M2/data'});socket.message({op:'status',id:'unrelated',level:'error',msg:'unrelated error'});
socket.message({op:'action_feedback',id:first.id,action:first.action,values:{success:true,message:'IDLE'}});socket.message({op:'status',id:first.id,level:'info',msg:'accepted'});socket.onmessage({data:'not json'});socket.message(null);
assert.equal(c.snapshot().robots.M1.phase,'pending','Only a matching terminal response may complete the request');
result(socket,second);assert.equal(c.snapshot().robots.M2.phase,'success');assert.equal(c.snapshot().robots.M1.phase,'pending');result(socket,first);assert.equal(c.snapshot().robots.M1.phase,'success');assert.equal(f.timeouts(),0);
const copy=c.snapshot();copy.robots.M1.phase='error';assert.equal(c.snapshot().robots.M1.phase,'success','Snapshots do not expose mutable state');

for(const command of ['EMER_STOP','RESTART']){
 const issue=robot=>command==='RESTART'?c.requestRestart(robot):c.requestStop(robot);
 for(const overrides of [{result:false},{status:6},{values:{success:false,message:'IDLE'}},{values:{success:true,message:'ERROR'}},{values:{success:true}},{values:null}]){
  owner(socket,'M1');assert(issue('M1'));checkGoal(goals(socket).at(-1),'M1',command);result(socket,goals(socket).at(-1),overrides);assert.equal(c.snapshot().robots.M1.phase,'error');assert.equal(f.timeouts(),0);
 }
 owner(socket,'M1');assert(issue('M1'));let goal=goals(socket).at(-1);socket.message({op:'status',id:goal.id,action:goal.action,level:'error',msg:'Goal rejected'});assert.equal(c.snapshot().robots.M1.phase,'error');assert.match(c.snapshot().robots.M1.message,/Goal rejected/);
 owner(socket,'M1');assert(issue('M1'));goal=goals(socket).at(-1);f.advance(9999);assert.equal(c.snapshot().robots.M1.phase,'pending');f.advance(1);assert.equal(c.snapshot().robots.M1.phase,'error');assert.match(c.snapshot().robots.M1.message,/응답 시간 초과.*미확인/);result(socket,goal);assert.equal(c.snapshot().robots.M1.phase,'error','Late result cannot rewrite timeout');
 owner(socket,'M1');assert(issue('M1'));const retry=goals(socket).at(-1);assert.notEqual(retry.id,goal.id);result(socket,goal);assert.equal(c.snapshot().robots.M1.phase,'pending');result(socket,retry);assert.equal(c.snapshot().robots.M1.phase,'success');
 owner(socket,'M1');assert(issue('M1'));goal=goals(socket).at(-1);f.jump(10000);result(socket,goal);assert.equal(c.snapshot().robots.M1.phase,'error','Expired response is rejected before its timer runs');assert.equal(f.timeouts(),0);
}
// Freshness and mission gating are robot-specific, and never issue automatic commands.
const beforeTelemetry=goals(socket).length;
for(const mode of ['idle','nav','direct']){owner(socket,'M1',mode);assert(c.snapshot().robots.M1.canRestart);}
mission(socket,'M1','running');assert.equal(c.requestRestart('M1'),false);owner(socket,'M2');assert(c.snapshot().robots.M2.canRestart);mission(socket,'M1','cancelled');assert(c.snapshot().robots.M1.canRestart);
owner(socket,'M1','unknown');assert.equal(c.snapshot().robots.M1.canRestart,false,'Invalid latest owner mode revokes release eligibility');
owner(socket,'M1');socket.message({op:'publish',topic:'/burger1/motion_owner/communication_status',msg:{data:'not json'}});assert.equal(c.snapshot().robots.M1.canRestart,false,'Malformed owner telemetry revokes release eligibility');
owner(socket,'M1');mission(socket,'M1','unknown');assert.equal(c.requestRestart('M1'),false,'Unknown mission state blocks release');mission(socket,'M1','failed');assert(c.snapshot().robots.M1.canRestart);
owner(socket,'M1');f.advance(3500);assert(c.snapshot().robots.M1.canRestart);f.advance(1);assert.equal(c.requestRestart('M1'),false);f.advance(499);assert.equal(f.changes.at(-1).robots.M1.canRestart,false,'Periodic render revokes stale release');
owner(socket,'M1');f.jump(-1);assert.equal(c.snapshot().robots.M1.canRestart,false,'Future receipt times cannot be fresh');f.jump(1);
assert.equal(goals(socket).length,beforeTelemetry,'Telemetry does not release or start motion');
for(const robot of ['M1','M2']){
 owner(socket,robot);mission(socket,robot,'idle');assert(c.requestRestart(robot));const release=goals(socket).at(-1);checkGoal(release,robot,'RESTART');assert.equal(c.requestRestart(robot),false);
 socket.message({op:'action_feedback',id:release.id,values:{message:'IDLE'}});assert.equal(c.snapshot().robots[robot].phase,'pending');
 assert(c.requestStop(robot),'Explicit stop is allowed while release is pending');const stop=goals(socket).at(-1);checkGoal(stop,robot,'EMER_STOP');assert.equal(c.requestStop(robot),false);assert.equal(c.requestRestart(robot),false);
 result(socket,release);assert.equal(c.snapshot().robots[robot].phase,'pending','Late release cannot acknowledge newer stop');assert.equal(c.snapshot().robots[robot].command,'EMER_STOP');result(socket,stop);assert.equal(c.snapshot().robots[robot].phase,'success');assert.match(c.snapshot().robots[robot].message,/^정지 확인/);result(socket,release);assert.match(c.snapshot().robots[robot].message,/^정지 확인/);
}
owner(socket,'M1');assert(c.requestRestart('M1'));const interrupted=goals(socket).at(-1);socket.close();assert.equal(c.snapshot().connected,false);assert.equal(c.snapshot().robots.M1.phase,'error');assert.match(c.snapshot().robots.M1.message,/연결 끊김.*미확인/);assert.equal(c.snapshot().robots.M2.phase,'idle');assert.equal(f.timers.size,1);
const sentBefore=socket.sent.length;f.advance(2999);assert.equal(f.sockets.length,1);f.advance(1);const next=f.sockets.at(-1);next.open();checkSubscriptions(next);assert.equal(goals(next).length,0,'Reconnect never replays interrupted commands');assert.equal(c.requestRestart('M1'),false,'Reconnection requires fresh owner state');assert.equal(socket.sent.length,sentBefore);
result(socket,interrupted);socket.onopen();socket.onclose();owner(socket,'M1');assert.equal(c.snapshot().connected,true);assert.equal(c.snapshot().robots.M1.phase,'error');assert.equal(c.snapshot().robots.M1.canRestart,false);assert.equal(f.timeouts(),0,'Old callbacks cannot alter new connection');
owner(next,'M2');assert(c.requestRestart('M2'));const newGoal=goals(next).at(-1);result(socket,newGoal);assert.equal(c.snapshot().robots.M2.phase,'pending');result(next,newGoal);assert.equal(c.snapshot().robots.M2.phase,'success');assert.match(c.snapshot().robots.M2.message,/정지 해제 확인/);
assert(c.requestStop('M1'));const beforeClose=next.sent.length;c.close();assert.equal(next.sent.length,beforeClose);assert.equal(c.snapshot().connected,false);assert.equal(c.snapshot().robots.M1.phase,'error');assert.equal(f.timers.size,0);f.advance(30000);assert.equal(f.sockets.length,2);
c.start();const restarted=f.sockets.at(-1);restarted.open();checkSubscriptions(restarted);assert.equal(c.requestRestart('M2'),false);c.close();

const broken=fixture();broken.failConnect(true);broken.client.start();assert.equal(broken.client.snapshot().connected,false);assert.equal(broken.timers.size,1);broken.failConnect(false);broken.advance(3000);const recovered=broken.sockets[0];recovered.open();owner(recovered,'M1');recovered.failSend=true;assert.equal(broken.client.requestRestart('M1'),false);assert.equal(broken.client.snapshot().robots.M1.phase,'error');assert.equal(broken.client.snapshot().connected,false);broken.client.close();assert.equal(broken.timers.size,0);
const subscribeFailure=fixture();subscribeFailure.client.start();subscribeFailure.sockets[0].failSend=true;assert.doesNotThrow(()=>subscribeFailure.sockets[0].open());assert.equal(subscribeFailure.client.snapshot().connected,false);subscribeFailure.client.close();assert.equal(subscribeFailure.timers.size,0);
const browser=fixture(true),withoutCallback=browser.api.create(browser.options);withoutCallback.start();browser.sockets[0].open();assert(withoutCallback.requestStop('M1'));withoutCallback.close();assert.equal(browser.timers.size,0);
assert.equal(new Set(goals(socket).map(m=>m.id)).size,goals(socket).length,'Every explicit request has a unique ID');
for(const s of [...f.sockets,...broken.sockets,...browser.sockets])for(const m of goals(s)){assert(['EMER_STOP','RESTART'].includes(m.args.command));assert.equal(m.args.cmd_val,0);}
assert.equal(typeof require('../robot-stop-client.js').create,'function');
console.log('PASS robot stop/release client: exact API, fresh-state gating, stop priority, strict responses, timeout, reconnect, no replay and timer cleanup.');
