const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const model=require('../live-map-model.js');
const transform=(x,y)=>`translate(${model.projectPose({x,y,yaw:0},0).position.join(' ')})`;
(async()=>{
 const discoveryTimers=[];
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],sent=[];
  let socket;
  page.on('pageerror',e=>errors.push(e.message));
  await page.routeWebSocket(/.*/,ws=>{
   ws.onMessage(raw=>{
    const msg=JSON.parse(raw);sent.push(msg);
    if(msg.op==='subscribe'&&msg.topic==='/burger1/amcl_pose')socket=ws;
    if(msg.op==='subscribe'&&msg.topic==='/host/device_discovery'){
     const publish=()=>{try{ws.send(JSON.stringify({op:'publish',topic:'/host/device_discovery',msg:{data:JSON.stringify({protocol:1,stamp_ms:Date.now(),publishers:Object.fromEntries(['M1','M2','arm1','arm2','arm3'].map(key=>[key,['/device/action_server']]))})}}));}catch(_){}};
     publish();discoveryTimers.push(setInterval(publish,500));
    }
   });
  });
  const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8082';
  await page.goto(base+'/?live=1&host=1',{waitUntil:'networkidle'});
  assert(await page.locator('#order-form').isHidden());
  assert((await page.locator('#factory-map').boundingBox()).height>400,'Metric map remains large with toolbar');
  assert(await page.locator('#robot1').isHidden(),'No invented initial position');
  assert.equal(await page.locator('#robot1 .robot-label').textContent(),'M1');
  assert.equal(await page.locator('#robot2 .robot-label').textContent(),'M2');
  assert.equal(await page.evaluate(()=>HostBridge.enabled),false,'HTTP demo does not initialize even with host=1');
  const send=(topic,msg)=>socket.send(JSON.stringify({op:'publish',topic,msg}));
  const pose=(x,y,stamp=Date.now())=>({header:{frame_id:'burger1/map',stamp:{sec:Math.floor(stamp/1000),nanosec:(stamp%1000)*1e6}},pose:{pose:{position:{x,y,z:0},orientation:{x:0,y:0,z:0,w:1}}}});
  send('/burger1/amcl_pose',pose(.42062385,.036671807));
  await page.waitForFunction(expected=>document.getElementById('robot1').getAttribute('transform')===expected,transform(.42062385,.036671807));
  assert(await page.locator('#robot1').isVisible());
  assert.equal(await page.locator('#robot1 .robot-body').getAttribute('transform'),'rotate(90)');
  send('/burger1/amcl_pose',pose(.46813,.390648,Date.now()+1));
  await page.waitForFunction(expected=>document.getElementById('robot1').getAttribute('transform')===expected,transform(.46813,.390648));
  send('/burger1/amcl_pose',pose(.45969099,.85449041,Date.now()+2));
  await page.waitForFunction(expected=>document.getElementById('robot1').getAttribute('transform')===expected,transform(.45969099,.85449041));
  assert(await page.locator('#robot1').isVisible(),'Docking beyond waypoint span stays visible');
  assert.equal(await page.locator('#factory-map').getAttribute('viewBox'),model.viewBox.join(' '));
  await page.getByRole('button',{name:'작업 구역 확대',exact:true}).click();
  assert.equal(await page.locator('#factory-map').getAttribute('viewBox'),model.viewBox.join(' '));
  await page.getByRole('button',{name:'전체 지도',exact:true}).click();
  assert.equal(await page.locator('#factory-map').getAttribute('viewBox'),model.fullViewBox.join(' '));
  await page.getByRole('button',{name:'작업 구역 확대',exact:true}).click();
  for(const name of ['warehouse','process','home','waiting'])assert(await page.locator(`[data-photo="${name}"]`).isVisible(),'Original station illustration remains visible');
  assert.equal(await page.locator('#metric-map-layer image').count(),0,'Raw occupancy image does not replace the layout');
  send('/burger1/amcl_pose',pose(1.5,-1.8,Date.now()+3));
  await page.waitForFunction(expected=>document.getElementById('robot1').getAttribute('transform')===expected,transform(1.5,-1.8));
  assert.notEqual(await page.locator('#factory-map').getAttribute('viewBox'),model.viewBox.join(' '),'In-map position outside the drawing expands the viewport');
  send('/burger1/amcl_pose',pose(.45969099,.85449041,Date.now()+4));
  await page.waitForFunction(expected=>document.getElementById('robot1').getAttribute('transform')===expected,transform(.45969099,.85449041));
  assert.equal(await page.locator('#factory-map').getAttribute('viewBox'),model.viewBox.join(' '));
  const goal={uuid:Array.from({length:16},(_,i)=>i)},goal_info={goal_id:goal,stamp:{sec:1,nanosec:0}};
  send('/arm2/data/_action/status',{status_list:[{goal_info,status:2}]});
  send('/arm2/data/_action/feedback',{goal_id:goal,feedback:{message:'RUNNING'}});
  await page.waitForFunction(()=>document.getElementById('arm2-map').classList.contains('active-arm'));
  send('/arm2/data/_action/feedback',{goal_id:goal,feedback:{message:'PAUSED'}});
  await page.waitForFunction(()=>!document.getElementById('arm2-map').classList.contains('active-arm'));
  assert.equal(await page.locator('#device-a2 .device-status').textContent(),'일시정지');
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(()=>plan),null,'Keyboard cannot start a demo in live view');
  // Invalid or already stale samples must not reset the freshness clock or position.
  send('/burger1/amcl_pose',pose(1,1,Date.now()-10000));
  await page.waitForFunction(()=>document.getElementById('robot1').classList.contains('pose-stale'));
  assert.equal(await page.locator('#robot1').getAttribute('transform'),transform(.45969099,.85449041));
  await page.screenshot({path:'/tmp/robot3-live-map.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No mobile overflow');
  await page.screenshot({path:'/tmp/robot3-live-map-mobile.png',fullPage:true});
  assert(sent.some(m=>m.topic==='/burger2/amcl_pose'));
  assert(sent.every(m=>m.op==='subscribe'||m.op==='unsubscribe'),'Monitor never publishes commands or orders');
  socket.close();
  await page.waitForFunction(()=>document.getElementById('stage-status').textContent==='연결 대기');
  assert.equal(await page.locator('#device-a2 .device-status').textContent(),'상태 미확인');
  await page.setViewportSize({width:1440,height:1100});
  await page.goto(base+'/control.html',{waitUntil:'networkidle'});
  const embedded=page.frameLocator('#live-map-frame');
  await embedded.locator('#metric-map-layer').waitFor();
  assert.equal(await embedded.locator('#factory-map').getAttribute('viewBox'),model.viewBox.join(' '));
  assert((await embedded.locator('#factory-map').boundingBox()).height>250,'Embedded map remains readable');
  await embedded.getByRole('button',{name:'작업 구역 확대',exact:true}).click();
  await page.screenshot({path:'/tmp/robot3-control-metric-map.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: live coordinates/heading, labels, paused arm, stale position, disconnect, mobile and read-only mode.');
 }finally{for(const timer of discoveryTimers)clearInterval(timer);await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
