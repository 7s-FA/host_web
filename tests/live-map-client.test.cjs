const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Model=require('../live-map-model.js');
const source=fs.readFileSync(require.resolve('../live-map-client.js'),'utf8');
function fixture(browser=false){
 let clock=1800000000000,timerId=0;
 const timers=new Map(),sockets=[],changes=[];
 class Socket{
  constructor(url){this.url=url;this.sent=[];this.readyState=0;sockets.push(this);}
  send(raw){assert.equal(this.readyState,1);this.sent.push(JSON.parse(raw));}
  open(){this.readyState=1;this.onopen();}
  message(message){this.onmessage({data:JSON.stringify(message)});}
  close(){this.readyState=3;this.onclose?.();}
 }
 const context={WebSocket:Socket,LiveMapModel:Model,
  setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,at:clock+ms});return id;},
  clearTimeout:id=>timers.delete(id),
  setInterval(fn,ms){const id=++timerId;timers.set(id,{fn,at:clock+ms,ms});return id;},
  clearInterval:id=>timers.delete(id)};
 if(browser)context.window=context;
 else{context.module={exports:{}};context.require=name=>{assert.equal(name,'./live-map-model.js');return Model;};}
 vm.runInNewContext(source,context);
 const api=browser?context.LiveMapClient:context.module.exports;
 const client=api.create({url:'ws://localhost:9090',WebSocket:Socket,now:()=>clock,onChange:s=>changes.push(s)});
 function advance(ms){
  const end=clock+ms;
  while(true){
   const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
   if(!next)break;
   const [id,t]=next;clock=t.at;if(t.ms)t.at+=t.ms;else timers.delete(id);t.fn();
  }
  clock=end;
 }
 function graph(index,publishers=['/arm_server'],request){
  const socket=sockets.at(-1);
  request=request||socket.sent.filter(m=>m.op==='call_service'&&m.args.topic===`/arm${index+1}/data/_action/status`).at(-1);
  socket.message({op:'service_response',id:request.id,service:'/rosapi/publishers',result:true,values:{publishers}});
 }
 return {api,client,sockets,changes,timers,advance,graph,now:()=>clock};
}
const goal=n=>({uuid:Array(16).fill(n)});
const entry=(n,status,sec=n)=>({goal_info:{goal_id:goal(n),stamp:{sec,nanosec:0}},status});
function status(socket,index,list){socket.message({op:'publish',topic:`/arm${index+1}/data/_action/status`,msg:{status_list:list}});}
function feedback(socket,index,n,message){socket.message({op:'publish',topic:`/arm${index+1}/data/_action/feedback`,msg:{goal_id:goal(n),feedback:{message}}});}
function pose(now,index=0){return {header:{frame_id:`burger${index+1}/map`,stamp:{sec:Math.floor(now/1000),nanosec:(now%1000)*1e6}},pose:{pose:{position:{x:.42,y:-.1,z:0},orientation:{x:0,y:0,z:0,w:1}}}};}
const plain=value=>JSON.parse(JSON.stringify(value));

const f=fixture();assert.equal(f.sockets.length,0);assert.equal(f.client.snapshot().connected,false);
f.client.start();f.client.start();assert.equal(f.sockets.length,1);
const socket=f.sockets[0];socket.open();assert.equal(f.client.snapshot().connected,true);
const subscriptions=socket.sent.filter(m=>m.op==='subscribe');assert.equal(subscriptions.length,10);
for(let i=1;i<=2;i++){
 const p=subscriptions.find(m=>m.topic===`/burger${i}/amcl_pose`);
 assert.equal(p.type,'geometry_msgs/msg/PoseWithCovarianceStamped');assert.equal(p.qos.reliability,'reliable');assert.equal(p.qos.durability,'transient_local');
 assert.equal(subscriptions.find(m=>m.topic===`/burger${i}/mission/status`).type,'std_msgs/msg/String');
}
for(let i=1;i<=3;i++){
 const s=subscriptions.find(m=>m.topic===`/arm${i}/data/_action/status`);
 assert.equal(s.type,'action_msgs/msg/GoalStatusArray');assert.equal(s.qos.durability,'transient_local');assert.equal(s.qos.reliability,'reliable');
 const feedbackSubscription=subscriptions.find(m=>m.topic===`/arm${i}/data/_action/feedback`);
 assert.equal(feedbackSubscription.type,'host_pkg/action/Arm_FeedbackMessage');
 assert.equal(feedbackSubscription.qos.reliability,'reliable');assert.equal(feedbackSubscription.qos.durability,'volatile');
}
assert.equal(socket.sent.filter(m=>m.op==='call_service').length,3);
status(socket,0,[entry(1,2)]);assert.equal(f.client.snapshot().arms[0].active,false,'retained status needs graph confirmation');
socket.message({op:'service_response',id:'unrelated',service:'/rosapi/publishers',result:true,values:{publishers:['server']}});
assert.equal(f.client.snapshot().arms[0].available,false);
f.graph(0);assert.deepEqual(plain(f.client.snapshot().arms[0]),{active:false,state:'unknown',available:true},'joining a paused task cannot animate from retained EXECUTING alone');
feedback(socket,0,9,'RUNNING');assert.equal(f.client.snapshot().arms[0].active,false,'an unrelated goal does not confirm work activity');
feedback(socket,0,1,'RUNNING');assert.deepEqual(plain(f.client.snapshot().arms[0]),{active:true,state:'running',available:true});
status(socket,0,[null,{},entry(1,2)]);assert.equal(f.client.snapshot().arms[0].active,true,'malformed status entries are ignored');
feedback(socket,0,1,'PAUSED');assert.equal(f.client.snapshot().arms[0].state,'paused');
// A newer control goal cannot unpause the older executing work, even when listed first.
status(socket,0,[entry(2,2),entry(1,2)]);feedback(socket,0,2,'RUNNING');
assert.equal(f.client.snapshot().arms[0].active,false);assert.equal(f.client.snapshot().arms[0].state,'paused');
feedback(socket,0,2,'IDLE');status(socket,0,[entry(2,4),entry(1,2)]);
assert.equal(f.client.snapshot().arms[0].active,false);
feedback(socket,0,1,'RUNNING');assert.equal(f.client.snapshot().arms[0].active,true);
feedback(socket,0,1,'ERROR');assert.equal(f.client.snapshot().arms[0].state,'error');
status(socket,0,[entry(1,2)]);assert.equal(f.client.snapshot().arms[0].active,false);
feedback(socket,0,1,'IDLE');assert.equal(f.client.snapshot().arms[0].state,'idle');
feedback(socket,0,1,'RUNNING');status(socket,0,[entry(1,3)]);assert.equal(f.client.snapshot().arms[0].active,true);
// Activity remains valid without repeated action feedback while graph replies stay fresh.
for(let i=0;i<8;i++){f.advance(1000);f.graph(0);assert.equal(f.client.snapshot().arms[0].active,true);}
f.advance(3001);assert.deepEqual(plain(f.client.snapshot().arms[0]),{active:false,state:'unknown',available:false});
const stale=socket.sent.filter(m=>m.op==='call_service'&&m.args.topic.includes('/arm1/'))[0];
f.graph(0,['server'],stale);assert.equal(f.client.snapshot().arms[0].available,false);
f.graph(0);assert.deepEqual(plain(f.client.snapshot().arms[0]),{active:false,state:'unknown',available:true},'graph recovery alone cannot revive an old goal');
status(socket,0,[entry(1,2)]);assert.equal(f.client.snapshot().arms[0].active,false,'fresh status still needs feedback after graph recovery');
feedback(socket,0,1,'RUNNING');assert.equal(f.client.snapshot().arms[0].active,true);
f.advance(1000);f.graph(0,[]);assert.equal(f.client.snapshot().arms[0].available,false);
f.advance(1000);f.graph(0);assert.equal(f.client.snapshot().arms[0].state,'unknown','a vanished publisher clears retained goals');
status(socket,0,[]);assert.equal(f.client.snapshot().arms[0].state,'idle');
status(socket,0,[entry(3,6)]);assert.equal(f.client.snapshot().arms[0].state,'error');
// Delayed discovery replies must not overwrite a newer no-publisher result.
f.advance(1000);const older=socket.sent.filter(m=>m.op==='call_service'&&m.args.topic.includes('/arm1/')).at(-1);
f.advance(1000);f.graph(0,[]);f.graph(0,['server'],older);assert.equal(f.client.snapshot().arms[0].available,false);

for(let i=0;i<2;i++){
 const message=pose(f.now(),i);socket.message({op:'publish',topic:`/burger${i+1}/amcl_pose`,msg:message});
 assert.deepEqual(plain(f.client.snapshot().robots[i].pose),Model.parsePose(message,i,f.now()));
 socket.message({op:'publish',topic:`/burger${i+1}/mission/status`,msg:{data:JSON.stringify({status:'running',stage:'NAV2',robot:i})}});
 assert.equal(f.client.snapshot().robots[i].mission.stage,'NAV2');
}
const last=plain(f.client.snapshot().robots[0]);f.advance(1000);
const invalid=pose(f.now());invalid.pose.pose.orientation.w=0;
socket.message({op:'publish',topic:'/burger1/amcl_pose',msg:invalid});
socket.message({op:'publish',topic:'/burger1/mission/status',msg:{data:'not-json'}});
assert.deepEqual(plain(f.client.snapshot().robots[0]),last,'invalid messages never refresh pose or mission');
const reordered=pose(last.pose.stamp-1);socket.message({op:'publish',topic:'/burger1/amcl_pose',msg:reordered});
assert.equal(f.client.snapshot().robots[0].pose.stamp,last.pose.stamp);
const copy=f.client.snapshot();copy.robots[0].pose.position[0]=999;assert.notEqual(f.client.snapshot().robots[0].pose.position[0],999);
f.advance(2001);assert.equal(f.client.snapshot().robots[0].mission,null,'missing mission heartbeat cannot retain a current driving stage');
socket.onmessage({data:'{invalid'});socket.message(null);
socket.close();assert.equal(f.client.snapshot().connected,false);assert(f.client.snapshot().robots.every(r=>r.pose===null&&r.mission===null));
assert(f.client.snapshot().arms.every(a=>!a.active&&!a.available&&a.state==='unknown'));
f.advance(2999);assert.equal(f.sockets.length,1);f.advance(1);assert.equal(f.sockets.length,2);
const second=f.sockets[1];second.open();
socket.message({op:'publish',topic:'/burger1/amcl_pose',msg:pose(f.now())});assert.equal(f.client.snapshot().robots[0].pose,null);
status(second,0,[entry(1,2)]);assert.equal(f.client.snapshot().arms[0].active,false);f.graph(0);
assert.equal(f.client.snapshot().arms[0].state,'unknown','a new connection cannot reuse previous RUNNING feedback');
feedback(second,0,1,'RUNNING');assert.equal(f.client.snapshot().arms[0].active,true);
f.client.stop();assert.equal(f.timers.size,0);f.advance(5000);assert.equal(f.sockets.length,2);assert.equal(f.client.snapshot().connected,false);
f.client.start();assert.equal(f.sockets.length,3);f.client.stop();
for(const s of f.sockets)for(const message of s.sent){
 assert(['subscribe','call_service'].includes(message.op),'Only read-only websocket operations are permitted');
 if(message.op==='call_service'){assert.equal(message.service,'/rosapi/publishers');assert.equal(message.type,'rosapi_msgs/srv/Publishers');}
}
assert(f.changes.length>0);
const browser=fixture(true);const noCallback=browser.api.create({url:'ws://localhost:9090',now:browser.now});
noCallback.start();browser.sockets[0].open();noCallback.stop();
assert.equal(typeof require('../live-map-client.js').create,'function');
console.log('PASS: read-only ROS subscriptions/discovery, oldest goal pause/resume, graph freshness, pose validation, reconnect clearing and browser/CommonJS exports.');
