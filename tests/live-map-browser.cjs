const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],sent=[];
  let socket;
  page.on('pageerror',e=>errors.push(e.message));
  await page.routeWebSocket(/.*/,ws=>{
   socket=ws;
   ws.onMessage(raw=>{
    const msg=JSON.parse(raw);sent.push(msg);
    if(msg.op==='call_service')ws.send(JSON.stringify({op:'service_response',id:msg.id,service:msg.service,result:true,values:{publishers:['/device/action_server']}}));
   });
  });
  const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8082';
  await page.goto(base+'/?live=1&host=1',{waitUntil:'networkidle'});
  assert(await page.locator('#order-form').isHidden());
  assert(await page.locator('#robot1').isHidden(),'No invented initial position');
  assert.equal(await page.locator('#robot1 .robot-label').textContent(),'M1');
  assert.equal(await page.locator('#robot2 .robot-label').textContent(),'M2');
  assert.equal(await page.evaluate(()=>HostBridge.enabled),false,'HTTP demo does not initialize even with host=1');
  const send=(topic,msg)=>socket.send(JSON.stringify({op:'publish',topic,msg}));
  const pose=(x,y,stamp=Date.now())=>({header:{frame_id:'burger1/map',stamp:{sec:Math.floor(stamp/1000),nanosec:(stamp%1000)*1e6}},pose:{pose:{position:{x,y,z:0},orientation:{x:0,y:0,z:0,w:1}}}});
  send('/burger1/amcl_pose',pose(.42062385,.036671807));
  await page.waitForFunction(()=>document.getElementById('robot1').getAttribute('transform')==='translate(340 700)');
  assert(await page.locator('#robot1').isVisible());
  assert.equal(await page.locator('#robot1 .robot-body').getAttribute('transform'),'rotate(90)');
  send('/burger1/amcl_pose',pose(.46906513,.320654172,Date.now()+1));
  await page.waitForFunction(()=>document.getElementById('robot1').getAttribute('transform')==='translate(340 500)');
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
  assert.equal(await page.locator('#robot1').getAttribute('transform'),'translate(340 500)');
  await page.screenshot({path:'/tmp/robot3-live-map.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No mobile overflow');
  await page.screenshot({path:'/tmp/robot3-live-map-mobile.png',fullPage:true});
  assert(sent.some(m=>m.topic==='/burger2/amcl_pose'));
  assert(sent.every(m=>m.op==='subscribe'||m.op==='unsubscribe'||m.op==='call_service'&&m.service==='/rosapi/publishers'),'Monitor never publishes commands or orders');
  socket.close();
  await page.waitForFunction(()=>document.getElementById('stage-status').textContent==='연결 대기');
  assert.equal(await page.locator('#device-a2 .device-status').textContent(),'상태 미확인');
  assert.deepEqual(errors,[]);
  console.log('PASS: live coordinates/heading, labels, paused arm, stale position, disconnect, mobile and read-only mode.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
