const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {resolve}=require('node:path');

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--no-sandbox']});
 try{
  const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8082';
  const deviceKeys=['M1','M2','arm1','arm2','arm3'];
  const topics=Object.fromEntries(deviceKeys.map(key=>[key,`/${key}/data/_action/status`]));
  const hostPayload={burger1_x_axis:0,burger1_y_axis:0,burger2_x_axis:0,burger2_y_axis:0,message:'ROS 2 test 공정 입니다.'};
  const reportedState={bridge_configured:true,bridge_connected:true,pending_commands:0,order:null,
   order_policy:{quantity_min:1,quantity_max:2,quantity_default:2},conditions:[],can_advance:false,log:[],
   devices:Object.fromEntries(['M1','M2','warehouse','production'].map(key=>[key,{state:'idle',detail:'장치 준비 보고',log:[]}]))};
  for(const path of ['/','/?live=1','/control.html']){
   const name=path.includes('control')?'control':path.includes('live')?'live':'demo';
   const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],messages=[],connections=[],answers=new Map();
   page.setDefaultTimeout(10000);
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{const original=Date.now;window.testClockOffset=0;Date.now=()=>original()+window.testClockOffset;});
   await page.route('**/api/live/**',route=>route.fulfill({json:reportedState}));
   await page.routeWebSocket(/.*/,socket=>{
    const traffic=[];
    socket.onMessage(raw=>{
     const msg=JSON.parse(raw);messages.push(msg);traffic.push(msg);
     if(!String(msg.id||'').startsWith('device-connection-'))return;
     if(!connections.some(item=>item.socket===socket))connections.push({socket,traffic});
     if(msg.op==='call_service'&&msg.service==='/rosapi/publishers'&&answers.has(msg.args.topic)){
      socket.send(JSON.stringify({op:'service_response',id:msg.id,service:msg.service,result:true,
       values:{publishers:answers.get(msg.args.topic)?['/test_device_server']:[]}}));
     }
    });
   });
   await page.goto(base+path,{waitUntil:'networkidle'});
   await page.waitForFunction(()=>document.querySelectorAll('[data-device-connection]').length>=5);
   assert.equal(connections.length,1,'One dedicated read-only connection monitor');
   const connection=connections[0],socket=connection.socket;
   const keys=path.includes('control')?['host','M1','M2','warehouse','production']:['host',...deviceKeys,'warehouse','production'];
   async function states(key){return page.locator(`[data-device-connection="${key}"]`).evaluateAll(nodes=>nodes.map(node=>node.dataset.state));}
   async function state(key,expected){
    await page.waitForFunction(({key,expected})=>{
     const nodes=[...document.querySelectorAll(`[data-device-connection="${key}"]`)];
     return nodes.length>0&&nodes.every(node=>node.dataset.state===expected);
    },{key,expected});
   }
   for(const key of keys){assert((await states(key)).length>0);assert((await states(key)).every(value=>value!=='online'),'Open rosbridge and adapter work reports do not prove a device connection');}
   answers.set(topics.M1,true);await state('M1','online');
   assert((await states('M2')).every(value=>value!=='online'),'M1 evidence cannot connect M2');
   assert((await states('host')).every(value=>value!=='online'),'Graph discovery cannot replace Host telemetry');
   answers.set(topics.arm2,true);answers.set(topics.arm3,false);await state('production','partial');
   answers.set(topics.arm3,true);await state('production','online');
   answers.set(topics.arm3,false);await state('production','partial');
   answers.set(topics.arm2,false);await state('production','offline');
   answers.set(topics.arm1,true);await state('warehouse','online');
   for(const topic of Object.values(topics))answers.set(topic,true);
   const heartbeat=()=>socket.send(JSON.stringify({op:'publish',topic:'/ros_to_web',msg:{data:JSON.stringify(hostPayload)}}));
   heartbeat();const heartbeatTimer=setInterval(heartbeat,500);
   try{
    for(const key of keys)await state(key,'online');
    assert(await page.locator('[data-device-connection="host"] .connection-text').first().textContent()==='연결됨');
    for(const viewport of [{width:1440,height:900},{width:1100,height:700},{width:390,height:844}]){
     await page.setViewportSize(viewport);
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal page overflow');
     for(const key of ['host','M1','M2','warehouse','production'])assert(await page.locator(`[data-device-connection="${key}"]`).first().isVisible());
     await page.screenshot({path:`/tmp/connection-${name}-${viewport.width}.png`,fullPage:true});
    }
   }finally{clearInterval(heartbeatTimer);}
   answers.clear();await page.evaluate(()=>window.testClockOffset+=4000);
   await state('host','offline');
   await state('M1','unknown');await state('M2','unknown');await state('production','unknown');
   socket.close();for(const key of keys)await state(key,'offline');
   await page.waitForFunction(()=>document.querySelector('[data-device-connection="M1"]').dataset.state!=='offline');
   assert.equal(connections.length,2,'Closed connection reconnects');
   for(const key of keys)assert((await states(key)).every(value=>value!=='online'),'Reconnection cannot revive old green lights');
   for(const item of connections){
    assert(item.traffic.every(msg=>msg.op==='subscribe'||msg.op==='call_service'),'Connection monitor never publishes commands');
    assert(item.traffic.filter(msg=>msg.op==='call_service').every(msg=>msg.service==='/rosapi/publishers'&&Object.values(topics).includes(msg.args.topic)));
   }
   assert(messages.every(msg=>msg.op!=='send_action_goal'),'Viewing connection lights never sends robot Actions');
   assert.deepEqual(errors,[]);await page.close();
  }
  for(const location of ['https://connections.test/control.html',pathToFileURL(resolve('control.html')).href]){
   const page=await browser.newPage();let connections=0;
   if(location.startsWith('https:'))await page.route('https://connections.test/**',async route=>{
    const url=new URL(route.request().url());const response=await route.fetch({url:base+url.pathname+url.search});await route.fulfill({response});
   });
   await page.routeWebSocket(/.*/,socket=>{connections++;socket.close();});
   await page.goto(location,{waitUntil:'networkidle'});
   assert.match(await page.locator('[data-device-connection="host"]').textContent(),/Host PC에서 확인/);
   assert.equal(await page.locator('[data-device-connection="host"]').getAttribute('data-state'),'waiting');
   assert.equal(connections,0,'Public and file pages must not open ROS sockets');await page.close();
  }
  console.log('PASS connection lights: three pages, independent server discovery, production aggregation, fresh Host data, stale/blocked/disconnected/reconnected states, command-free monitoring, public/file gating and responsive layout.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
