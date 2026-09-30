const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function fixture({library=true,config={},hostname='localhost',protocol='http:'}={}){
 const elements=new Map(),timers=[],instances=[],messages=[];
 const sandbox={URL,location:{hostname,protocol},HostBridge:{enabled:false},document:{getElementById(id){if(!elements.has(id))elements.set(id,{});return elements.get(id);}},setInterval(fn,ms){timers.push({fn,ms});},console};
 sandbox.window=sandbox;
 if(library)sandbox.ROSLIB={Ros:class{
  constructor(){this.events={};this.isConnected=false;instances.push(this);}
  on(name,fn){this.events[name]=fn;}
  emit(name){this.isConnected=name==='connection';this.events[name]?.();}
  connect(url){this.url=url;}
  close(){this.emit('close');}
 },Topic:class{constructor(options){this.options=options;}publish(msg){messages.push(JSON.parse(msg.data));}unadvertise(){}},Message:class{constructor(value){Object.assign(this,value);}}};
 vm.createContext(sandbox);
 vm.runInContext(fs.readFileSync('ros-config.js','utf8'),sandbox);
 Object.assign(sandbox.ROS_BRIDGE_CONFIG,config);
 vm.runInContext(fs.readFileSync('ros-client.js','utf8'),sandbox);
 let state={quantity:'2',playing:false,product:'A제품 · 부품 3개 / 세트'};
 sandbox.RosTelemetry.init(()=>state);
 return {sandbox,elements,timers,instances,messages,setState:s=>state=s};
}
const missing=fixture({library:false});
assert.ok(missing.sandbox.HostBridge);assert.equal(missing.sandbox.HostBridge.sendToROS({}),false);
assert.match(missing.elements.get('ros-status').textContent,/라이브러리 없음/);
for(const options of [{hostname:'7s-fa.github.io',protocol:'https:'},{protocol:'file:'},{config:{enabled:false}},{config:{publishIntervalMs:0}},{config:{url:'http://localhost'}}]){
 const f=fixture(options);assert.equal(f.instances.length,0);assert.equal(f.timers.length,0);
}
const f=fixture();const api=f.sandbox.RosTelemetry;
assert.equal(f.instances[0].url,'ws://localhost:9090');assert.equal(f.timers[0].ms,200);
f.timers[0].fn();assert.equal(f.messages.length,0);
f.instances[0].emit('connection');f.timers[0].fn();
assert.deepEqual(f.messages[0],{quantity:'2',playing:false,product:'A제품 · 부품 3개 / 세트'});
assert.equal(f.sandbox.HostBridge.enabled,false); // HTTP mode is independent.
f.instances[0].emit('close');f.setState({quantity:'3',playing:true,product:'A'});
f.timers[0].fn();assert.equal(f.messages.length,1);
f.elements.get('ros-connect').onclick();f.instances[1].emit('connection');
f.instances[0].emit('close');assert.equal(api.online,true); // stale connection cannot stop the new one.
f.timers[0].fn();assert.equal(f.messages.length,2);assert.equal(f.messages[1].quantity,'3');
f.elements.get('ros-connect').onclick();assert.equal(api.online,false);
f.timers[0].fn();assert.equal(f.messages.length,2);
api.connect();f.instances[2].emit('error');assert.equal(api.online,false);
assert.match(f.elements.get('ros-status').textContent,/실패/);
api.init(()=>({}));assert.equal(f.timers.length,1);
const custom=fixture({config:{localOnly:false,url:'wss://host.example:9090',topic:'/custom',publishIntervalMs:1000},hostname:'example.com',protocol:'https:'});
assert.equal(custom.instances[0].url,'wss://host.example:9090');assert.equal(custom.timers[0].ms,1000);
console.log('PASS: ROS telemetry payload, interval, local gating, missing library, disconnect, reconnect and HTTP isolation.');
// Exercise the actual bundled library too: its advertise path differs from the mock.
{
 const frames=[],sockets=[],timers=[];
 class Socket{
  constructor(url){this.url=url;sockets.push(this);}
  send(data){frames.push(JSON.parse(data));}
  close(){this.onclose?.({});}
 }
 const ctx={console,URL,WebSocket:Socket,setTimeout,clearTimeout,setInterval:fn=>timers.push(fn),location:{hostname:'localhost',protocol:'http:'},document:{getElementById:()=>null},HostBridge:{}};
 ctx.window=ctx;ctx.self=ctx;vm.createContext(ctx);
 for(const file of ['assets/vendor/roslib-1.4.1.min.js','ros-config.js','ros-client.js'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx);
 ctx.RosTelemetry.init(()=>({quantity:'2',playing:true,product:'A'}));
 sockets[0].onopen({});timers[0]();
 assert.ok(frames.some(f=>f.op==='advertise'&&f.topic==='/web_to_ros'&&f.type==='std_msgs/msg/String'));
 const pub=frames.find(f=>f.op==='publish');assert.equal(JSON.parse(pub.msg.data).quantity,'2');
 sockets[0].onclose({});timers[0]();
 const count=frames.filter(f=>f.op==='publish').length;
 ctx.RosTelemetry.connect();sockets[1].onopen({});timers[0]();
 assert.equal(frames.filter(f=>f.op==='publish').length,count+1);
 ctx.RosTelemetry.disconnect();
 assert.ok(frames.some(f=>f.op==='unadvertise'));
 console.log('PASS: bundled ROSLIB actual advertise/publish/unadvertise frames and reconnect via mocked WebSocket.');
}
