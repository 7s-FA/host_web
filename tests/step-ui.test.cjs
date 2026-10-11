// Keep reference assertions stable when a maintainer edits config.js.
Object.assign(require('../settings.js').defaults, structuredClone(require('./baseline-config.cjs')));
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const sim=require('../engine.js');
for(let q=1;q<=2;q++){
 const plan=sim.makePlan(q),stages=sim.stagesFor(q);
 for(const stage of stages){
  const conditions=sim.stageConditions(plan,stage,stage.time);
  assert(conditions.length>0);
  assert(conditions.every(c=>c.done));
  assert(sim.stageConditions(plan,stage,-1).every(c=>!c.done));
 }
}
const els=new Map();
function element(){return {textContent:'',innerHTML:'',value:'2',dataset:{},style:{},children:[],attributes:{},classList:{toggle(){}},setAttribute(key,value){this.attributes[key]=value;},getAttribute(key){return this.attributes[key]??'image';},append(...x){this.children.push(...x);},replaceChildren(...x){this.children=x;},querySelector(){return element();},querySelectorAll(){return [];},addEventListener(){}};}
const el=id=>{if(['speed','plus','minus'].includes(id))return null;if(!els.has(id)){const node=element();if(id==='product')node.value='A';els.set(id,node);}return els.get(id);};
const products=['A','B'].map(productType=>Object.assign(element(),{dataset:{productType}})),quantities=['1','2'].map(quantity=>Object.assign(element(),{dataset:{quantity}}));
const bridge={enabled:false,init(){},complete(){this.acks=(this.acks||0)+1;}};
const ctx={SimulationSettings:require('../settings.js'),RobotSimulation:sim,HostBridge:bridge,window:{},document:{getElementById:el,createElement:element,createElementNS:element,querySelector:element,querySelectorAll(selector){return selector==='#order-form [data-product-type]'?products:selector==='#order-form [data-quantity]'?quantities:[];},addEventListener(){}},requestAnimationFrame(){},setTimeout,console};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('app.js','utf8'),ctx);
const run=s=>vm.runInContext(s,ctx);
run('runStage()');assert.equal(run('manualMode'),true);assert.equal(run('playing'),true);
const target=run('manualTarget');run('runStage()');assert.equal(run('manualTarget'),target);
for(let now=200;now<120000;now+=200)run(`frame(${now})`);
assert.equal(run('time'),target);assert.equal(run('playing'),false);
assert(el('conditions-list').children.every(li=>li.className==='condition-done'));
run('runStage()');assert(run('manualTarget')>target);
run('reset()');assert.equal(run('manualMode'),false);
run('begin()');assert.equal(run('manualMode'),false);assert.equal(run('playing'),true);
bridge.enabled=true;bridge.online=true;
bridge.state={simulation_config:{...require('../settings.js').defaults,burger1:{forwardSpeed:2,reverseSpeed:1,turnSpeed:90}},quantity:2,order_id:'test',status:'running',acked_seq:0,time:0,command:{seq:1,target_time:target}};
run('applyHostState(HostBridge.state);time=HostBridge.state.command.target_time;render()');
assert.equal(run('plan.config.burger1.forwardSpeed'),2);
assert.equal(el('conditions-list').children.at(-1).className,'');
bridge.state={...bridge.state,status:'waiting',acked_seq:1,time:target,command:null};run('applyHostState(HostBridge.state)');
assert.equal(el('conditions-list').children.at(-1).className,'condition-done');
bridge.online=false;run('render()');assert.equal(el('step-order').disabled,true);
assert.equal(el('conditions-list').children.at(-2).className,'');
console.log('PASS: conditions for orders 1–2, animated stage barrier, double click, reset, automatic playback, Host ACK and offline UI.');

bridge.enabled=false;ctx.window.SYSTEM_ORDER_POLICY={quantity_min:1,quantity_max:2,quantity_default:2};
run('reset()');
for(const value of ['0','3','20','1.5']){el('quantity').value=value;assert.throws(()=>run('validateQuantity()'));}
for(const value of ['1','2']){el('quantity').value=value;assert.equal(run('validateQuantity()'),Number(value));}
quantities[1].onclick();assert.equal(Number(el('quantity').value),2);
el('quantity').value='3';run('begin()');assert.equal(run('plan'),null);assert.match(el('form-error').textContent,/1~2/);
run('runStage()');assert.equal(run('plan'),null);
bridge.enabled=true;bridge.online=true;bridge.state={status:'idle',quantity:0,order_policy:{quantity_min:1,quantity_max:2,quantity_default:2}};
run('applyHostState(HostBridge.state)');assert.equal(Number(el('quantity').value),2);
el('quantity').value='1';run('applyHostState(HostBridge.state)');assert.equal(el('quantity').value,'1');
assert.equal(Number(el('quantity').max),2);
bridge.state.order_policy={quantity_min:1,quantity_max:20,quantity_default:3};
run('applyHostState(HostBridge.state)');assert.equal(Number(el('quantity').max),2);assert.equal(Number(el('quantity').value),1);
el('quantity').value='3';assert.throws(()=>run('validateQuantity()'));
bridge.enabled=false;ctx.window.SYSTEM_ORDER_POLICY={quantity_min:1,quantity_max:20,quantity_default:3};
run('applyHostState(null)');assert.equal(Number(el('quantity').max),2);assert.equal(Number(el('quantity').value),2);
delete ctx.window.SYSTEM_ORDER_POLICY;el('quantity').value='3';assert.throws(()=>run('validateQuantity()'));
console.log('PASS: orders limited to 1–2, legacy policies capped, idle heartbeat preserves input, removed speed UI not accessed.');

run('reset()');products[1].onclick();quantities[0].onclick();
assert.equal(el('product').value,'B');assert.equal(el('quantity').value,'1');assert.equal(products[1].getAttribute('aria-pressed'),'true');
assert.equal(JSON.stringify(run('rosOrderState()')),JSON.stringify({quantity:'1',playing:false,product:'B제품 · 부품 3개 / 세트'}));
run('begin(false)');assert.equal(run('plan.productType'),'B');assert.equal(run('stages[0].events[0].text').includes('B제품'),true);
assert.equal(el('jig-product').textContent,'B');assert.match(el('order-id').textContent,/B제품 1개/);
for(const button of [...products,...quantities])assert(button.disabled,'A paused order locks product and quantity');
products[0].onclick();assert.equal(el('product').value,'B');
run('time=plan.duration;render()');for(const button of [...products,...quantities])assert(!button.disabled);
products[0].onclick();assert.match(el('order-selection').textContent,/A제품/);assert.match(el('order-id').textContent,/B제품/,'Finished order retains its product while next order is selected');
assert.equal(run('rosOrderState().product'),'A제품 · 부품 3개 / 세트');
run('togglePlay()');assert.equal(el('product').value,'B','Replaying old order restores its product');assert.equal(run('rosOrderState().product'),'B제품 · 부품 3개 / 세트');
run('reset()');el('product').value='C';assert.throws(()=>run('validateProduct()'));assert.throws(()=>run('rosOrderState()'));
run('begin()');assert.equal(run('plan'),null);run('runStage()');assert.equal(run('plan'),null);assert.match(el('form-error').textContent,/A제품 또는 B제품/);
el('product').value='A';el('quantity').value='1';assert.equal(run('rosOrderState().product'),'A제품 · 부품 3개 / 세트');
console.log('PASS: A/B selection, exact ROS product names, B stage/log/jig identity, locks, completed-order selection and invalid product rejection.');
