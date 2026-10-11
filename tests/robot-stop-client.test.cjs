const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../robot-stop-client.js'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
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
 const context={WebSocket:Socket,crypto:{randomUUID:()=>String(++uuid)},
  setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout:id=>timers.delete(id)};
 if(browser)context.window=context;else context.module={exports:{}};
 vm.runInNewContext(source,context);
 const api=browser?context.RobotStopClient:context.module.exports;
 const options={url:'ws://localhost:9090',WebSocket:Socket,now:()=>clock};
 const client=api.create({...options,onChange:s=>changes.push(s)});
 function advance(ms){
  const end=clock+ms;
  while(true){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;
   const [id,t]=next;clock=t.at;timers.delete(id);t.fn();}
  clock=end;
 }
 return {api,options,client,sockets,timers,changes,advance,failConnect:value=>failConnect=value,jump:ms=>clock+=ms};
}
function result(socket,goal,overrides={}){socket.message({op:'action_result',id:goal.id,action:goal.action,result:true,status:4,values:{success:true,message:'IDLE'},...overrides});}

const f=fixture(),c=f.client;
assert.equal(f.sockets.length,0);assert.deepEqual(plain(c.snapshot()),{connected:false,robots:{M1:{phase:'idle',message:'정지 요청 대기'},M2:{phase:'idle',message:'정지 요청 대기'}}});
for(const name of ['M3','burger1','__proto__',null])assert.equal(c.requestStop(name),false);
assert.equal(c.requestStop('M1'),false);assert.equal(c.snapshot().robots.M1.phase,'error');assert.equal(f.sockets.length,0);
c.start();c.start();assert.equal(f.sockets.length,1);const socket=f.sockets[0];socket.open();assert.equal(c.snapshot().connected,true);assert.equal(socket.sent.length,0,'Opening sends no commands');
assert(c.requestStop('M1'));const first=socket.sent.at(-1);
assert.deepEqual(first,{op:'send_action_goal',id:first.id,action:'/M1/data',action_type:'host_pkg/action/Burger',args:{command:'EMER_STOP',cmd_val:0},feedback:true});
assert.equal(c.snapshot().robots.M1.phase,'pending');assert.equal(c.requestStop('M1'),false);assert.equal(socket.sent.length,1,'Same-robot pending blocks duplicate clicks');
assert(c.requestStop('M2'));const second=socket.sent.at(-1);assert.equal(second.action,'/M2/data');assert.notEqual(first.id,second.id);
result(socket,first,{id:'unrelated'});result(socket,first,{action:'/M2/data'});socket.message({op:'status',id:'unrelated',level:'error',msg:'unrelated error'});
socket.message({op:'action_feedback',id:first.id,action:first.action,values:{success:true,message:'IDLE'}});
socket.message({op:'status',id:first.id,level:'info',msg:'accepted'});
socket.onmessage({data:'not json'});socket.message(null);
assert.equal(c.snapshot().robots.M1.phase,'pending','Only a matching terminal response may complete the request');
result(socket,second);assert.equal(c.snapshot().robots.M2.phase,'success');assert.equal(c.snapshot().robots.M1.phase,'pending');
result(socket,first);assert.equal(c.snapshot().robots.M1.phase,'success');assert.equal(f.timers.size,0);
const copy=c.snapshot();copy.robots.M1.phase='error';assert.equal(c.snapshot().robots.M1.phase,'success','Snapshots do not expose mutable state');

for(const overrides of [{result:false},{status:6},{values:{success:false,message:'IDLE'}},{values:{success:true,message:'ERROR'}},{values:{success:true}},{values:null}]){
 assert(c.requestStop('M1'));result(socket,socket.sent.at(-1),overrides);assert.equal(c.snapshot().robots.M1.phase,'error');assert.equal(f.timers.size,0);
}
assert(c.requestStop('M1'));let goal=socket.sent.at(-1);
socket.message({op:'status',id:goal.id,action:goal.action,level:'error',msg:'Goal rejected'});
assert.equal(c.snapshot().robots.M1.phase,'error');assert.match(c.snapshot().robots.M1.message,/Goal rejected/);
assert(c.requestStop('M1'));goal=socket.sent.at(-1);f.advance(9999);assert.equal(c.snapshot().robots.M1.phase,'pending');
f.advance(1);assert.equal(c.snapshot().robots.M1.phase,'error');assert.match(c.snapshot().robots.M1.message,/응답 시간 초과.*미확인/);result(socket,goal);assert.equal(c.snapshot().robots.M1.phase,'error','Late result cannot rewrite timeout');
assert(c.requestStop('M1'));const retry=socket.sent.at(-1);assert.notEqual(retry.id,goal.id);result(socket,goal);assert.equal(c.snapshot().robots.M1.phase,'pending');result(socket,retry);
assert(c.requestStop('M1'));goal=socket.sent.at(-1);f.jump(10000);result(socket,goal);assert.equal(c.snapshot().robots.M1.phase,'error','Expired response is rejected even before its timer runs');assert.equal(f.timers.size,0);

assert(c.requestStop('M1'));const interrupted=socket.sent.at(-1);socket.close();
assert.equal(c.snapshot().connected,false);assert.equal(c.snapshot().robots.M1.phase,'error');assert.match(c.snapshot().robots.M1.message,/연결 끊김.*미확인/);
assert.equal(c.snapshot().robots.M2.phase,'idle','Success is no longer current after disconnection');assert.equal(f.timers.size,1);
const sentBefore=socket.sent.length;f.advance(2999);assert.equal(f.sockets.length,1);f.advance(1);const next=f.sockets.at(-1);assert.notEqual(next,socket);next.open();
assert.equal(next.sent.length,0,'Reconnect never resends an interrupted stop');assert.equal(socket.sent.length,sentBefore);
result(socket,interrupted);socket.onopen();socket.onclose();assert.equal(c.snapshot().connected,true);assert.equal(c.snapshot().robots.M1.phase,'error');assert.equal(f.timers.size,0,'Old callbacks cannot alter the new connection');
assert(c.requestStop('M2'));const newGoal=next.sent.at(-1);result(socket,newGoal);assert.equal(c.snapshot().robots.M2.phase,'pending','Even matching IDs on old sockets are ignored');result(next,newGoal);
assert(c.requestStop('M1'));const beforeClose=next.sent.length;c.close();assert.equal(next.sent.length,beforeClose);assert.equal(c.snapshot().connected,false);assert.equal(c.snapshot().robots.M1.phase,'error');assert.equal(f.timers.size,0);f.advance(30000);assert.equal(f.sockets.length,2,'Close disables reconnect');
c.start();const restarted=f.sockets.at(-1);restarted.open();assert.equal(restarted.sent.length,0);c.close();

const broken=fixture();broken.failConnect(true);broken.client.start();assert.equal(broken.client.snapshot().connected,false);assert.equal(broken.timers.size,1);
broken.failConnect(false);broken.advance(3000);const recovered=broken.sockets[0];recovered.open();recovered.failSend=true;
assert.equal(broken.client.requestStop('M1'),false);assert.equal(broken.client.snapshot().robots.M1.phase,'error');assert.equal(broken.client.snapshot().connected,false);broken.client.close();assert.equal(broken.timers.size,0);
const browser=fixture(true),withoutCallback=browser.api.create(browser.options);withoutCallback.start();browser.sockets[0].open();assert(withoutCallback.requestStop('M1'));withoutCallback.close();assert.equal(browser.timers.size,0,'Default callback and browser global work');
assert.equal(new Set(socket.sent.map(m=>m.id)).size,socket.sent.length,'Every explicit request has a unique ID');
for(const s of [...f.sockets,...broken.sockets,...browser.sockets])for(const m of s.sent){assert.equal(m.op,'send_action_goal');assert.equal(m.args.command,'EMER_STOP');assert.equal(m.args.cmd_val,0);}
assert.equal(typeof require('../robot-stop-client.js').create,'function');
console.log('PASS robot stop client: exact Action contract, isolated requests, strict success, failures, timeout, disconnect, reconnect, no replay and timer cleanup.');
