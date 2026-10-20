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
function graph(f,socket,publishers,stamp=f.now(),protocol=1){socket.message({op:'publish',topic:'/host/device_discovery',msg:{data:JSON.stringify({protocol,stamp_ms:stamp,publishers})}});}
const allOnline=()=>Object.fromEntries(Object.keys(topics).map(k=>[k,['/'+k+'/server']]));
function host(socket,data={message:'ROS 2 test 공정 입니다.',burger1_x_axis:0,burger1_y_axis:0,burger2_x_axis:0,burger2_y_axis:0}){socket.message({op:'publish',topic:'/ros_to_web',msg:{data:JSON.stringify(data)}});}
function state(f,key){return f.client.snapshot().devices[key].state;}

const f=fixture(),c=f.client;
assert.equal(f.sockets.length,0);assert.equal(c.snapshot().connected,false);
for(const device of Object.values(c.snapshot().devices))assert.equal(device.state,'waiting');
const socket=open(f);c.start();assert.equal(f.sockets.length,1);
assert.equal(socket.sent.length,2);assert(socket.sent.every(m=>m.op==='subscribe'));
assert(socket.sent.some(m=>m.topic==='/host/device_discovery'));
for(const device of Object.values(c.snapshot().devices))assert.equal(device.state,'waiting','Socket alone is not connection evidence');
graph(f,socket,{...allOnline(),M2:[],arm3:[]});
assert.equal(state(f,'M1'),'online');assert.equal(state(f,'M2'),'offline');assert.equal(state(f,'host'),'waiting');
assert.equal(state(f,'warehouse'),'online');assert.equal(state(f,'production'),'partial');
f.advance(1);graph(f,socket,allOnline());assert.equal(state(f,'production'),'online');
const copy=c.snapshot();copy.devices.M1.state='offline';assert.equal(state(f,'M1'),'online');
const sent=socket.sent.length;f.advance(3000);assert.equal(state(f,'M1'),'online');f.advance(1);assert.equal(state(f,'M1'),'unknown');
assert.equal(socket.sent.length,sent,'Freshness timer never creates ROS clients or sends service polls');
const before=plain(c.snapshot());socket.onmessage({data:'not json'});socket.message(null);
socket.message({op:'service_response',service:'/host/action_publishers',result:true,values:{publishers:['fake']}});
assert.deepEqual(plain(c.snapshot()),before);

const malformed=fixture(),bad=open(malformed);
for(const value of [undefined,null,{},'server',[null],[12],[''],[' '],['server',false]]){
 malformed.advance(1);graph(malformed,bad,{...allOnline(),M1:value});assert.equal(state(malformed,'M1'),'unknown');
}
for(const [stamp,protocol] of [[malformed.now()-3001,1],[malformed.now()+1,1],[malformed.now(),2],['bad',1]]){
 graph(malformed,bad,allOnline(),stamp,protocol);assert.equal(state(malformed,'M1'),'unknown');
}
const ordered=fixture(),orderedSocket=open(ordered),old=ordered.now();
ordered.advance(1000);graph(ordered,orderedSocket,{...allOnline(),M1:[]});
graph(ordered,orderedSocket,allOnline(),old);graph(ordered,orderedSocket,allOnline());
assert.equal(state(ordered,'M1'),'offline','Old or duplicate snapshots cannot revive an absent server');
ordered.advance(1);graph(ordered,orderedSocket,allOnline());ordered.jump(-1);assert.equal(state(ordered,'M1'),'unknown');
const delayed=fixture(),delayedSocket=open(delayed),at=delayed.now();delayed.advance(2900);
graph(delayed,delayedSocket,allOnline(),at);assert.equal(state(delayed,'M1'),'online');
delayed.advance(101);assert.equal(state(delayed,'M1'),'unknown','Age starts at source timestamp, never receipt time');
const silent=fixture();open(silent);silent.advance(3001);assert.equal(state(silent,'M1'),'unknown');
const heartbeat=fixture(),hostSocket=open(heartbeat);host(hostSocket);assert.equal(state(heartbeat,'host'),'online');
for(const key of Object.keys(topics))assert.equal(state(heartbeat,key),'waiting','Host heartbeat does not prove individual devices are connected');
heartbeat.advance(2500);const valid={message:'status',burger1_x_axis:1,burger1_y_axis:2,burger2_x_axis:3,burger2_y_axis:4};
const badPayloads=[null,[],{},'status',12,{...valid,message:12},{...valid,burger1_x_axis:'1'},{...valid,burger1_y_axis:null},{...valid,burger2_x_axis:Infinity},{...valid,burger2_y_axis:NaN}];
for(const key of ['burger1_x_axis','burger1_y_axis','burger2_x_axis','burger2_y_axis']){const partial={...valid};delete partial[key];badPayloads.push(partial);}
const count=heartbeat.changes.length;for(const data of badPayloads)host(hostSocket,data);
hostSocket.message({op:'publish',topic:'/other',msg:{data:JSON.stringify(valid)}});assert.equal(heartbeat.changes.length,count,'Invalid Host data does not refresh the light');
heartbeat.advance(500);assert.equal(state(heartbeat,'host'),'online');heartbeat.advance(1);assert.equal(state(heartbeat,'host'),'offline');
host(hostSocket,valid);assert.equal(state(heartbeat,'host'),'online');heartbeat.jump(-1);assert.equal(state(heartbeat,'host'),'offline');
const v2=fixture(),v2socket=open(v2);
host(v2socket,{protocol:2,host_mode:'mock',order:null,message:'Host 상태'});assert.equal(state(v2,'host'),'online');
v2.advance(3001);host(v2socket,{protocol:2,host_mode:'invalid',order:null,message:'Host 상태'});assert.equal(state(v2,'host'),'offline');
host(v2socket,{protocol:2,host_mode:'hardware',order:{status:'running'},message:'Host 상태'});assert.equal(state(v2,'host'),'online');

const reconnecting=fixture(),oldSocket=open(reconnecting);graph(reconnecting,oldSocket,allOnline());host(oldSocket);
oldSocket.close();assert.equal(state(reconnecting,'M1'),'offline');assert.equal(reconnecting.timers.size,1);
reconnecting.advance(3000);const next=reconnecting.sockets.at(-1);next.open();
assert.equal(state(reconnecting,'M1'),'waiting');graph(reconnecting,oldSocket,allOnline());host(oldSocket);
assert.equal(state(reconnecting,'M1'),'waiting');assert.equal(state(reconnecting,'host'),'waiting');
graph(reconnecting,next,allOnline());assert.equal(state(reconnecting,'M1'),'online');
const hanging=fixture();hanging.client.start();hanging.advance(5000);assert.equal(state(hanging,'M1'),'offline','A hung handshake must not remain checking forever');
const broken=fixture();broken.failConnect(true);broken.client.start();assert.equal(state(broken,'M1'),'offline');
broken.failConnect(false);broken.advance(3000);const failed=broken.sockets.at(-1);failed.failSendAt=2;failed.open();
assert.equal(state(broken,'M1'),'offline');assert.equal(broken.timers.size,1);
const browser=fixture(true),withoutCallback=browser.api.create(browser.options);withoutCallback.start();browser.sockets[0].open();host(browser.sockets[0]);assert.equal(withoutCallback.snapshot().devices.host.state,'online');withoutCallback.stop();
for(const item of fixtures){
 item.client.stop();item.client.stop();assert.equal(item.timers.size,0);
 for(const s of item.sockets)assert(s.sent.every(m=>m.op==='subscribe'),'No robot commands or service calls');
}
console.log('PASS device discovery stream: source freshness, malformed/replayed snapshots, independent lights, host heartbeat, reconnect and hung handshake.');
