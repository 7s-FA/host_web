const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../device-connection-client.js'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const topics={M1:'/M1/data/_action/status',M2:'/M2/data/_action/status',arm1:'/arm1/data/_action/status',arm2:'/arm2/data/_action/status',arm3:'/arm3/data/_action/status'};
const fixtures=[];
function fixture(browser=false){
 let clock=100000,timerId=0,failConnect=false;
 const timers=new Map(),sockets=[],changes=[];
 class Socket{
  constructor(url){if(failConnect)throw Error('connect failed');this.url=url;this.readyState=0;this.sent=[];this.attempts=0;sockets.push(this);}
  send(raw){this.attempts++;if(this.failSend||this.attempts===this.failSendAt)throw Error('send failed');assert.equal(this.readyState,1);this.sent.push(JSON.parse(raw));}
  open(){this.readyState=1;this.onopen();}
  message(message){this.onmessage({data:JSON.stringify(message)});}
  close(){this.readyState=3;this.onclose?.();}
 }
 function timer(fn,ms,repeat=false){const id=++timerId;timers.set(id,{fn,at:clock+ms,repeat:repeat?ms:0});return id;}
 const context={WebSocket:Socket,setTimeout:(fn,ms)=>timer(fn,ms),setInterval:(fn,ms)=>timer(fn,ms,true),clearTimeout:id=>timers.delete(id),clearInterval:id=>timers.delete(id)};
 if(browser)context.window=context;else context.module={exports:{}};
 vm.runInNewContext(source,context);
 const api=browser?context.DeviceConnectionClient:context.module.exports,options={url:'ws://localhost:9090',WebSocket:Socket,now:()=>clock};
 const client=api.create({...options,onChange:s=>changes.push(s)});
 function advance(ms){
  const end=clock+ms;
  while(true){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;
   const [id,t]=next;clock=t.at;if(t.repeat)t.at+=t.repeat;else timers.delete(id);t.fn();}
  clock=end;
 }
 const f={api,options,client,sockets,timers,changes,advance,now:()=>clock,jump:ms=>clock+=ms,failConnect:value=>failConnect=value};fixtures.push(f);return f;
}
function open(f){f.client.start();const socket=f.sockets.at(-1);socket.open();return socket;}
function request(socket,key){return socket.sent.filter(m=>m.args?.topic===topics[key]).at(-1);}
function reply(socket,req,publishers,result=true){socket.message({op:'service_response',id:req.id,service:'/rosapi/publishers',result,values:{publishers}});}
function graph(socket,key,publishers){reply(socket,request(socket,key),publishers);}
function host(socket,data={message:'ROS 2 test 공정 입니다.',burger1_x_axis:0,burger1_y_axis:0,burger2_x_axis:0,burger2_y_axis:0}){socket.message({op:'publish',topic:'/ros_to_web',msg:{data:JSON.stringify(data)}});}
function state(f,key){return f.client.snapshot().devices[key].state;}

const f=fixture(),c=f.client;
assert.equal(f.sockets.length,0);assert.equal(c.snapshot().connected,false);
for(const device of Object.values(c.snapshot().devices))assert.equal(device.state,'waiting');
c.start();c.start();assert.equal(f.sockets.length,1,'Start is idempotent');const socket=f.sockets[0];socket.open();
assert.equal(c.snapshot().connected,true);assert.equal(socket.sent.length,6);
assert.deepEqual(socket.sent[0],{op:'subscribe',id:'device-connection-host',topic:'/ros_to_web',type:'std_msgs/msg/String',queue_length:1,throttle_rate:500,qos:{history:'keep_last',depth:1,reliability:'reliable',durability:'volatile'}});
for(const [key,topic] of Object.entries(topics))assert.deepEqual({...request(socket,key),id:'ID'},{op:'call_service',id:'ID',service:'/rosapi/publishers',type:'rosapi_msgs/srv/Publishers',args:{topic}});
for(const device of Object.values(c.snapshot().devices))assert.equal(device.state,'waiting','WebSocket connection alone never turns on a device light');
graph(socket,'M1',['/M1/amr_mission_server']);assert.equal(state(f,'M1'),'online');assert.equal(state(f,'M2'),'waiting','M1 discovery never updates M2');assert.equal(state(f,'host'),'waiting');
graph(socket,'M2',[]);assert.equal(state(f,'M2'),'offline','Successful empty discovery is a confirmed absent server');
graph(socket,'arm1',['/warehouse_server']);assert.equal(state(f,'arm1'),'online');assert.equal(state(f,'warehouse'),'online');
graph(socket,'arm2',['/assembly_server']);assert.equal(state(f,'production'),'partial','Only one assembly arm is a partial connection');
graph(socket,'arm3',['/inspection_server']);assert.equal(state(f,'production'),'online');
assert.match(c.snapshot().devices.production.detail,/리니어·카메라 개별 상태는 확인하지 않음/);
const copy=c.snapshot();copy.devices.M1.state='offline';assert.equal(state(f,'M1'),'online','Snapshots cannot mutate internal connection evidence');
const beforeMalformed=plain(c.snapshot()),changeCount=f.changes.length;
socket.onmessage({data:'not json'});socket.message(null);socket.message([]);socket.message({op:'service_response',id:'unrequested',service:'/rosapi/publishers',result:true,values:{publishers:['/fake']}});
socket.message({op:'publish',topic:'/M2/data/_action/status',msg:{status_list:[]}});
socket.message({op:'publish',topic:'/ros_to_web',msg:{data:'not json'}});
assert.deepEqual(plain(c.snapshot()),beforeMalformed);assert.equal(f.changes.length,changeCount,'Unrelated traffic is not connectivity evidence');
f.advance(1000);graph(socket,'arm3',[]);assert.equal(state(f,'production'),'partial');graph(socket,'arm2',[]);assert.equal(state(f,'production'),'offline');
f.advance(1000);graph(socket,'arm2',null);assert.equal(state(f,'production'),'unknown');graph(socket,'arm3',['/inspection_server']);assert.equal(state(f,'production'),'partial');
f.advance(1000);assert.equal(state(f,'M1'),'online','Discovery remains fresh at exactly three seconds');
f.advance(1);assert.equal(state(f,'M1'),'unknown');assert.equal(state(f,'M2'),'unknown','An old absent result also expires');
assert(f.changes.length>changeCount,'Polling notifies the UI when freshness changes');

const malformed=fixture(),malformedSocket=open(malformed);
for(const publishers of [undefined,null,{},'server',[null],[12],[''],[' '],['/server',false]]){
 graph(malformedSocket,'M1',publishers);assert.equal(state(malformed,'M1'),'unknown');malformed.advance(1000);
}
reply(malformedSocket,request(malformedSocket,'M1'),['/server'],false);assert.equal(state(malformed,'M1'),'unknown','A failed ROSAPI call cannot establish connectivity');
malformed.advance(1000);reply(malformedSocket,request(malformedSocket,'M1'),['/server'],'true');assert.equal(state(malformed,'M1'),'unknown');
malformed.advance(1000);const badService=request(malformedSocket,'M2');
malformedSocket.message({op:'service_response',id:badService.id,service:'/rosapi/nodes',result:true,values:{publishers:['/server']}});
assert.equal(state(malformed,'M2'),'unknown','A wrong service response cannot establish connectivity');
const unanswered=fixture();open(unanswered);unanswered.advance(3001);
for(const key of Object.keys(topics))assert.equal(state(unanswered,key),'unknown','Unavailable or silent ROSAPI cannot establish connectivity');
assert.equal(state(unanswered,'production'),'unknown');assert.equal(state(unanswered,'host'),'offline');

const delayed=fixture(),delayedSocket=open(delayed),original=request(delayedSocket,'M1');
delayed.advance(2900);reply(delayedSocket,original,['/server']);assert.equal(state(delayed,'M1'),'online');
delayed.advance(100);assert.equal(state(delayed,'M1'),'online');delayed.advance(1);assert.equal(state(delayed,'M1'),'unknown','Freshness starts at query time, not at a delayed response');
const late=request(delayedSocket,'M2');delayed.advance(3001);reply(delayedSocket,late,['/server']);assert.equal(state(delayed,'M2'),'unknown','Late replies do not revive a device');
const ordered=fixture(),orderedSocket=open(ordered),old=request(orderedSocket,'M1');ordered.advance(1000);const newer=request(orderedSocket,'M1');
reply(orderedSocket,newer,[]);reply(orderedSocket,old,['/server']);assert.equal(state(ordered,'M1'),'offline','Older replies cannot replace a newer offline result');
reply(orderedSocket,newer,['/server']);assert.equal(state(ordered,'M1'),'offline','A consumed response cannot be replayed');
ordered.advance(1000);graph(orderedSocket,'M1',['/server']);ordered.jump(-1);assert.equal(state(ordered,'M1'),'unknown','Backward clock changes do not extend discovery freshness');

const heartbeat=fixture(),hostSocket=open(heartbeat);host(hostSocket);assert.equal(state(heartbeat,'host'),'online');
for(const key of Object.keys(topics))assert.equal(state(heartbeat,key),'waiting','Host heartbeat does not prove individual devices are connected');
heartbeat.advance(2500);const valid={message:'status',burger1_x_axis:1,burger1_y_axis:2,burger2_x_axis:3,burger2_y_axis:4};
const badPayloads=[null,[],{},'status',12,{...valid,message:12},{...valid,burger1_x_axis:'1'},{...valid,burger1_y_axis:null},{...valid,burger2_x_axis:Infinity},{...valid,burger2_y_axis:NaN}];
for(const key of ['burger1_x_axis','burger1_y_axis','burger2_x_axis','burger2_y_axis']){const partial={...valid};delete partial[key];badPayloads.push(partial);}
const count=heartbeat.changes.length;for(const data of badPayloads)host(hostSocket,data);
hostSocket.message({op:'publish',topic:'/other',msg:{data:JSON.stringify(valid)}});assert.equal(heartbeat.changes.length,count,'Invalid Host data does not refresh the light');
heartbeat.advance(500);assert.equal(state(heartbeat,'host'),'online');heartbeat.advance(1);assert.equal(state(heartbeat,'host'),'offline');
host(hostSocket,valid);assert.equal(state(heartbeat,'host'),'online');heartbeat.jump(-1);assert.equal(state(heartbeat,'host'),'offline');

const reconnecting=fixture(),oldSocket=open(reconnecting);graph(oldSocket,'M1',['/server']);host(oldSocket);const oldRequest=request(oldSocket,'M2');
oldSocket.close();assert.equal(reconnecting.client.snapshot().connected,false);
for(const device of Object.values(reconnecting.client.snapshot().devices))assert.equal(device.state,'offline');
assert.equal(reconnecting.timers.size,1,'Disconnection replaces polling with one retry');reconnecting.advance(2999);assert.equal(reconnecting.sockets.length,1);
reconnecting.advance(1);const next=reconnecting.sockets.at(-1);next.open();
for(const device of Object.values(reconnecting.client.snapshot().devices))assert.equal(device.state,'waiting','Reconnect requires fresh evidence for every device');
oldSocket.onopen();oldSocket.onclose();oldSocket.onerror();reply(oldSocket,oldRequest,['/old']);host(oldSocket);
assert.equal(reconnecting.client.snapshot().connected,true);assert.equal(state(reconnecting,'host'),'waiting');assert.equal(state(reconnecting,'M2'),'waiting','Old socket traffic is ignored');
graph(next,'M2',['/new']);assert.equal(state(reconnecting,'M2'),'online');assert.equal(state(reconnecting,'M1'),'waiting');
const outgoing=next.sent.length;reconnecting.client.stop();assert.equal(next.sent.length,outgoing);assert.equal(reconnecting.timers.size,0);
reconnecting.advance(30000);assert.equal(reconnecting.sockets.length,2,'Stop disables reconnect and polling');
reconnecting.client.start();const restarted=reconnecting.sockets.at(-1);restarted.open();assert.equal(state(reconnecting,'M2'),'waiting');graph(restarted,'M2',[]);assert.equal(state(reconnecting,'M2'),'offline');

const broken=fixture();broken.failConnect(true);broken.client.start();assert.equal(broken.client.snapshot().connected,false);assert.equal(state(broken,'M1'),'offline');assert.equal(broken.timers.size,1);
broken.failConnect(false);broken.advance(3000);const failedSubscribe=broken.sockets.at(-1);failedSubscribe.failSendAt=1;failedSubscribe.open();assert.equal(broken.client.snapshot().connected,false);assert.equal(broken.timers.size,1);
broken.advance(3000);const failedDiscovery=broken.sockets.at(-1);failedDiscovery.failSendAt=3;failedDiscovery.open();assert.equal(broken.client.snapshot().connected,false);assert.equal(broken.timers.size,1,'Partial discovery failure does not leave a polling timer');
broken.advance(3000);const failedPoll=broken.sockets.at(-1);failedPoll.open();graph(failedPoll,'M1',['/server']);failedPoll.failSend=true;broken.advance(1000);assert.equal(state(broken,'M1'),'offline');assert.equal(broken.timers.size,1);
broken.advance(3000);const recovered=broken.sockets.at(-1);recovered.open();recovered.onerror();recovered.onclose();assert.equal(broken.timers.size,1,'Duplicate socket failures schedule only one retry');
const browser=fixture(true),withoutCallback=browser.api.create(browser.options);withoutCallback.start();browser.sockets[0].open();host(browser.sockets[0]);assert.equal(withoutCallback.snapshot().devices.host.state,'online');withoutCallback.stop();assert.equal(browser.timers.size,0);

for(const item of fixtures){
 item.client.stop();item.client.stop();assert.equal(item.timers.size,0,'Stop cleans all polling and retry timers');
 for(const s of item.sockets)for(const message of s.sent){
  assert(['subscribe','call_service'].includes(message.op),'Connection indicators never send actions, commands or publishes');
  if(message.op==='call_service')assert.equal(message.service,'/rosapi/publishers','Only read-only publisher discovery is allowed');
 }
}
assert.equal(typeof require('../device-connection-client.js').create,'function');
console.log('PASS device connections: read-only discovery, isolated device lights, production aggregation, Host heartbeat, malformed responses, freshness, reconnect and timer cleanup.');
