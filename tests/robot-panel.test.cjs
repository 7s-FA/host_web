const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element{constructor(){this.children=[];this.dataset={};this.textContent='';this.classList={add(){},toggle(){}};this.fields={};}append(x){this.children.push(x)}get firstChild(){return{remove:()=>this.children.shift()}}set innerHTML(html){this.buttons=[...html.matchAll(/data-command="([^"]+)"/g)].map(m=>{const b=new Element();b.dataset.command=m[1];b.disabled=true;return b})}querySelectorAll(){return this.buttons}querySelector(sel){if(sel.startsWith('[data-command='))return this.buttons.find(b=>sel.includes('"'+b.dataset.command+'"'));return this.fields[sel]??=new Element()}removeAttribute(){} }
const robots=new Element(),status=new Element(),sockets=[],timers=[],events={},messages=[];let now=100000;
class Socket{static OPEN=1;constructor(url){this.url=url;this.readyState=1;sockets.push(this)}send(raw){messages.push(JSON.parse(raw))}close(){this.readyState=3;this.onclose?.()} }
const context={document:{getElementById:id=>id==='robots'?robots:status,createElement:()=>new Element()},WebSocket:Socket,URL,crypto:{randomUUID:()=>String(messages.length)},location:{hostname:'127.0.0.1',protocol:'http:'},Date:class extends Date{static now(){return now}},setInterval:f=>timers.push(f),setTimeout:f=>0,clearTimeout(){},addEventListener:(name,f)=>events[name]=f};
context.window=context;vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname+'/../ros-config.js','utf8'),context);
const source=fs.readFileSync(__dirname+'/../assets/robot-panel/panel.js','utf8');
vm.runInContext(source,context);assert.equal(sockets[0].url,context.ROS_BRIDGE_CONFIG.url);sockets[0].onopen();assert(messages.every(m=>m.op==='subscribe'),'Opening UI must never send a movement');
function publish(robot,topic,value){sockets[0].onmessage({data:JSON.stringify({op:'publish',topic:'/'+robot+'/'+topic,msg:{data:JSON.stringify(value)}})})}
const [b1,b2]=robots.children,button=(card,command)=>card.buttons.find(b=>b.dataset.command===command);
assert(button(b1,'GO_TO_MAT').disabled);publish('burger1','motion_owner/communication_status',{mode:'idle',error:null});assert(!button(b1,'GO_TO_MAT').disabled);assert(button(b2,'GO_TO_MAT').disabled);
button(b1,'GO_TO_MAT').onclick();const goal=messages.at(-1);assert.equal(goal.op,'send_action_goal');assert.equal(goal.action,'/M1/data');assert.equal(goal.action_type,'host_pkg/action/Burger');assert.equal(goal.args.command,'GO_TO_MAT');assert.equal(goal.args.cmd_val,100);assert(button(b1,'GO_TO_ASM').disabled);
button(b1,'GO_TO_MAT').onclick();assert.equal(messages.at(-1),goal,'Duplicate click does not send twice');
button(b1,'EMER_STOP').onclick();assert.equal(messages.at(-1).args.command,'EMER_STOP');assert.equal(messages.at(-1).args.cmd_val,0);
sockets[0].onmessage({data:JSON.stringify({op:'action_result',id:goal.id,status:6,result:true,values:{success:false,message:'ERROR'}})});assert.match(b1.querySelector('.notice').textContent,/실패/);
publish('burger2','motion_owner/communication_status',{mode:'nav'});publish('burger2','mission/status',{status:'running',stage:'navigation'});assert(button(b2,'GO_TO_REST').disabled);assert(!button(b2,'EMER_STOP').disabled);
now+=5000;timers[0]();assert(button(b1,'GO_TO_MAT').disabled,'Stale telemetry blocks travel');assert(!button(b1,'EMER_STOP').disabled,'Stop remains available when telemetry stale');
sockets[0].close();assert(button(b1,'EMER_STOP').disabled);const before=messages.length;events.pagehide();assert.equal(messages.length,before,'Closing UI never resends commands');
events.pageshow({persisted:true});assert.equal(sockets.length,2,'History restore reconnects after pagehide');sockets[1].onopen();assert(messages.slice(before).every(m=>m.op==='subscribe'),'History restore only resubscribes; never replays a command');
console.log('PASS robot panel: no auto motion, robot isolation, Action contract, duplicate guard, failure result, busy/stale lock, stop, disconnect, history restore.');
// A public/static preview must not contact robots; explicit custom config still works.
for(const options of [
 {hostname:'7s-fa.github.io',protocol:'https:'},
 {protocol:'file:'},
 {config:{enabled:false}},
 {config:{url:'http://localhost:9090'}},
 {protocol:'https:',config:{localOnly:false,url:'ws://localhost:9090'}},
 {hostname:'host.example',protocol:'https:',config:{localOnly:false,url:'wss://bridge.example:9090'},expected:'wss://bridge.example:9090'},
]){
 const elements=new Map(),connections=[];
 const sandbox={...context,location:{hostname:'localhost',protocol:'http:',...options},ROS_BRIDGE_CONFIG:{...context.ROS_BRIDGE_CONFIG,...options.config},
  document:{getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id)},createElement:()=>new Element()},
  WebSocket:class extends Socket{constructor(url){super(url);connections.push(url)}},setInterval(){},addEventListener(){}};
 sandbox.window=sandbox;vm.runInNewContext(source,sandbox);
 assert.deepEqual(connections,options.expected?[options.expected]:[]);
 if(!options.expected){assert(elements.get('connection-help').textContent);assert(elements.get('robots').children.every(card=>card.buttons.every(b=>b.disabled)));}
}
console.log('PASS robot page: shared ROS config, public/offline/disabled gating and explicit WSS endpoint.');
