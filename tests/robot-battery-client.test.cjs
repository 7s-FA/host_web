const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../robot-battery-client.js'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(browser=false){
 let clock=100000,timerId=0,failConnect=false;
 const timers=new Map(),sockets=[],changes=[];
 class Socket{
  static OPEN=1;
  constructor(url){if(failConnect)throw Error('connect failed');this.url=url;this.readyState=0;this.sent=[];sockets.push(this);}
  send(raw){if(this.failSend)throw Error('send failed');assert.equal(this.readyState,1);this.sent.push(JSON.parse(raw));}
  open(){this.readyState=1;this.onopen();}
  message(message){this.onmessage({data:JSON.stringify(message)});}
  close(){this.readyState=3;this.onclose?.();}
 }
 const context={WebSocket:Socket,setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout:id=>timers.delete(id)};
 if(browser)context.window=context;else context.module={exports:{}};
 vm.runInNewContext(source,context);
 const api=browser?context.RobotBatteryClient:context.module.exports;
 const options={url:'ws://localhost:9090',WebSocket:Socket,now:()=>clock};
 const client=api.create({...options,onChange:s=>changes.push(s)});
 function advance(ms){
  const end=clock+ms;
  while(true){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;
   const [id,t]=next;clock=t.at;timers.delete(id);t.fn();}
  clock=end;
 }
 return {api,options,client,sockets,timers,changes,advance,now:()=>clock,jump:ms=>clock+=ms,failConnect:value=>failConnect=value};
}
function publish(socket,robot,data){socket.message({op:'publish',topic:'/burger'+robot+'/battery_state',msg:data});}
function stamped(voltage,ms){return {voltage,header:{stamp:{sec:Math.floor(ms/1000),nanosec:ms%1000*1e6}}};}

const f=fixture(),c=f.client;
assert.equal(f.sockets.length,0);assert.equal(c.snapshot().connected,false);
for(const robot of ['M1','M2'])assert.deepEqual(plain(c.snapshot().robots[robot]),{percentage:null,voltage:null,state:'waiting',receivedAt:null,sourceStamp:null});
c.start();c.start();assert.equal(f.sockets.length,1);const socket=f.sockets[0];socket.open();
assert.equal(c.snapshot().connected,true);assert.equal(socket.sent.length,2);
for(let i=1;i<=2;i++)assert.deepEqual(socket.sent[i-1],{op:'subscribe',id:'robot-battery:/burger'+i+'/battery_state',topic:'/burger'+i+'/battery_state',type:'sensor_msgs/msg/BatteryState',queue_length:1,throttle_rate:1000,qos:{history:'keep_last',depth:1,reliability:'best_effort',durability:'volatile'}});

publish(socket,1,{voltage:11.4,percentage:95,present:true});
assert.deepEqual(plain(c.snapshot().robots.M1),{percentage:50,voltage:11.4,state:'fresh',receivedAt:100000,sourceStamp:null});
assert.equal(c.snapshot().robots.M2.state,'waiting','M1 telemetry never updates M2');
publish(socket,2,{voltage:12.3,percentage:.03,present:true});
assert.equal(c.snapshot().robots.M2.percentage,100,'Ignore ambiguous raw percentage units');
assert.equal(c.snapshot().robots.M1.percentage,50);
const copy=c.snapshot();copy.robots.M1.voltage=0;assert.equal(c.snapshot().robots.M1.voltage,11.4,'Snapshots do not expose internal state');
for(const rawPercentage of [null,0,.5,1,90,-1,'90']){
 publish(socket,1,{voltage:11.4,percentage:rawPercentage});assert.equal(c.snapshot().robots.M1.percentage,50);
}
for(const [voltage,percentage] of [[10,0],[10.5,0],[11.4,50],[12.3,100],[13,100]]){
 publish(socket,1,{voltage});assert.equal(c.snapshot().robots.M1.percentage,percentage);assert.equal(c.snapshot().robots.M1.state,'fresh');
}
for(const voltage of [null,'11.4',NaN,Infinity,-1]){
 publish(socket,1,{voltage,percentage:50});assert.equal(c.snapshot().robots.M1.percentage,null);assert.equal(c.snapshot().robots.M1.voltage,null);assert.equal(c.snapshot().robots.M1.state,'unknown');
}
publish(socket,1,{percentage:.5});assert.equal(c.snapshot().robots.M1.state,'unknown','Percentage alone cannot establish battery charge');
for(const voltage of [0,1,7]){
 publish(socket,1,{voltage,present:true});assert.equal(c.snapshot().robots.M1.state,'absent');assert.equal(c.snapshot().robots.M1.percentage,null);
 assert.equal(c.snapshot().robots.M1.voltage,voltage||null);
}
publish(socket,1,{voltage:12.3,present:false});assert.equal(c.snapshot().robots.M1.state,'absent');assert.equal(c.snapshot().robots.M1.percentage,null);
publish(socket,1,{present:false});assert.equal(c.snapshot().robots.M1.state,'absent');assert.equal(c.snapshot().robots.M1.voltage,null);

publish(socket,1,{voltage:11.4});const beforeMalformed=plain(c.snapshot().robots.M1),changeCount=f.changes.length;
for(const data of [null,[],{},'battery',12,{unrelated:11.4}])publish(socket,1,data);
socket.onmessage({data:'not json'});socket.message(null);
socket.message({op:'action_result',topic:'/burger1/battery_state',msg:{voltage:12.3}});
socket.message({op:'publish',topic:'/burger3/battery_state',msg:{voltage:12.3}});
socket.message({op:'publish',topic:'__proto__',msg:{voltage:12.3}});
assert.deepEqual(plain(c.snapshot().robots.M1),beforeMalformed);assert.equal(f.changes.length,changeCount,'Malformed or unrelated messages do not refresh telemetry');
f.advance(5000);assert.equal(c.snapshot().robots.M1.state,'fresh');assert(f.changes.length>=changeCount+5,'Freshness ticks notify the UI once per second');
f.advance(1);assert.equal(c.snapshot().robots.M1.state,'stale');assert.equal(c.snapshot().robots.M1.percentage,50,'Stale readings remain available but are marked stale');
publish(socket,1,{voltage:12.3});assert.equal(c.snapshot().robots.M1.state,'fresh');assert.equal(c.snapshot().robots.M2.state,'stale');

publish(socket,1,stamped(11.4,f.now()));const freshStamped=plain(c.snapshot().robots.M1);
for(const time of [f.now()-5001,f.now()+5001,f.now()-1,f.now()])publish(socket,1,stamped(12.3,time));
assert.deepEqual(plain(c.snapshot().robots.M1),freshStamped,'Old, far-future, out-of-order and duplicate stamped frames cannot refresh data');
f.advance(1000);publish(socket,1,stamped(12.3,f.now()));assert.equal(c.snapshot().robots.M1.percentage,100);assert.equal(c.snapshot().robots.M1.sourceStamp,f.now());
publish(socket,2,{voltage:11.4,header:{stamp:{sec:0,nanosec:0}}});assert.equal(c.snapshot().robots.M2.state,'fresh');assert.equal(c.snapshot().robots.M2.sourceStamp,null,'Zero stamps use reception time');

const aged=fixture();aged.client.start();const agedSocket=aged.sockets[0];agedSocket.open();
publish(agedSocket,1,stamped(11.4,aged.now()-4900));assert.equal(aged.client.snapshot().robots.M1.state,'fresh');
aged.advance(100);assert.equal(aged.client.snapshot().robots.M1.state,'fresh','A source timestamp exactly five seconds old remains fresh');
aged.advance(1);assert.equal(aged.client.snapshot().robots.M1.state,'stale','Source age, rather than only reception age, expires delayed telemetry');
publish(agedSocket,2,{voltage:11.4});aged.jump(-1);assert.equal(aged.client.snapshot().robots.M2.state,'stale','A backward clock jump cannot keep a future reception fresh');aged.client.close();assert.equal(aged.timers.size,0);

socket.close();assert.equal(c.snapshot().connected,false);
for(const robot of ['M1','M2'])assert.equal(c.snapshot().robots[robot].state,'offline');
f.advance(2999);assert.equal(f.sockets.length,1);f.advance(1);const next=f.sockets.at(-1);next.open();
assert.equal(next.sent.length,2);assert.equal(c.snapshot().robots.M1.state,'stale');assert.equal(c.snapshot().robots.M2.state,'stale','Reconnect does not revive old data');
socket.onopen();socket.onclose();publish(socket,1,{voltage:10.5});assert.equal(c.snapshot().connected,true);assert.equal(c.snapshot().robots.M1.percentage,100,'Old socket callbacks and messages are ignored');
publish(next,1,stamped(11.4,f.now()));assert.equal(c.snapshot().robots.M1.state,'fresh');assert.equal(c.snapshot().robots.M2.state,'stale');
const outgoing=next.sent.length;c.close();assert.equal(next.sent.length,outgoing);assert.equal(f.timers.size,0);assert.equal(c.snapshot().connected,false);
f.advance(30000);assert.equal(f.sockets.length,2,'Close disables reconnect and freshness ticks');
c.start();const restarted=f.sockets.at(-1);restarted.open();assert.equal(c.snapshot().robots.M1.state,'stale');publish(restarted,1,{voltage:11.4});assert.equal(c.snapshot().robots.M1.state,'fresh');c.close();assert.equal(f.timers.size,0);

const broken=fixture();broken.failConnect(true);broken.client.start();assert.equal(broken.client.snapshot().connected,false);assert.equal(broken.client.snapshot().robots.M1.state,'offline');
broken.failConnect(false);broken.advance(3000);const recovered=broken.sockets[0];recovered.failSend=true;recovered.open();assert.equal(broken.client.snapshot().connected,false);
broken.advance(3000);const working=broken.sockets.at(-1);working.open();working.onerror();assert.equal(broken.client.snapshot().connected,false);broken.client.close();assert.equal(broken.timers.size,0);
const browser=fixture(true),withoutCallback=browser.api.create(browser.options);withoutCallback.start();browser.sockets[0].open();publish(browser.sockets[0],1,{voltage:11.4});assert.equal(withoutCallback.snapshot().robots.M1.percentage,50);withoutCallback.close();assert.equal(browser.timers.size,0);
for(const s of [...f.sockets,...broken.sockets,...browser.sockets])for(const message of s.sent)assert.equal(message.op,'subscribe','Battery telemetry never sends a command, service or Action request');
assert.equal(typeof require('../robot-battery-client.js').create,'function');
console.log('PASS battery client: isolated subscriptions, voltage estimates, invalid and absent readings, timestamps, freshness, reconnect, read-only transport and cleanup.');
