const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--no-sandbox']});
 try{
  const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8082';
  for(const path of ['/','/?live=1','/control.html','/assets/robot-panel/index.html']){
   const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],messages=[],batteryMessages=[],sockets=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{const original=Date.now;window.testClockOffset=0;Date.now=()=>original()+window.testClockOffset;});
   await page.routeWebSocket(/.*/,socket=>socket.onMessage(raw=>{
    const msg=JSON.parse(raw);messages.push(msg);
    if(msg.topic==='/burger1/battery_state')sockets.push(socket);
    if(sockets.includes(socket))batteryMessages.push(msg);
   }));
   await page.goto(base+path,{waitUntil:'networkidle'});
   const m1=page.locator('[data-battery-robot="M1"]'),m2=page.locator('[data-battery-robot="M2"]');
   assert.equal(await m1.textContent(),'배터리 수신 대기');assert.equal(await m2.textContent(),'배터리 수신 대기');
   assert.equal(sockets.length,1);const socket=sockets[0];
   function publish(robot,voltage,extra={}){socket.send(JSON.stringify({op:'publish',topic:'/burger'+robot+'/battery_state',msg:{voltage,present:true,percentage:1,...extra}}));}
   publish(1,12);publish(2,10.68);
   await page.waitForFunction(()=>document.querySelector('[data-battery-robot="M1"]').textContent.includes('83%'));
   assert.equal(await m1.textContent(),'추정 83% · 12.00 V');
   assert.equal(await m2.textContent(),'추정 10% · 10.68 V');assert.equal(await m2.getAttribute('data-low'),'true');
   publish(1,'12.0');await page.waitForFunction(()=>document.querySelector('[data-battery-robot="M1"]').dataset.state==='unknown');
   assert.match(await m1.textContent(),/미확인/);assert.doesNotMatch(await m1.textContent(),/0%|NaN/);
   publish(1,12,{present:false});await page.waitForFunction(()=>document.querySelector('[data-battery-robot="M1"]').dataset.state==='absent');
   assert.match(await m1.textContent(),/감지 안 됨/);publish(1,12);
   await page.waitForFunction(()=>document.querySelector('[data-battery-robot="M1"]').dataset.state==='fresh');
   const old=Date.now()-20000;publish(1,11,{header:{stamp:{sec:Math.floor(old/1000),nanosec:0}}});
   await page.waitForTimeout(100);assert.match(await m1.textContent(),/83%/,'Old header cannot replace a fresh reading');
   await page.evaluate(()=>window.testClockOffset=6000);
   await page.waitForFunction(()=>document.querySelector('[data-battery-robot="M1"]').dataset.state==='stale');
   assert.match(await m1.textContent(),/수신 지연 · 마지막 추정 83%/);assert.equal(await m2.getAttribute('data-low'),'false');
   await page.evaluate(()=>window.testClockOffset=0);publish(1,12);publish(2,11.4);
   await page.waitForFunction(()=>document.querySelector('[data-battery-robot="M1"]').dataset.state==='fresh');
   await page.screenshot({path:'/tmp/battery-'+(path.includes('robot-panel')?'panel':path.includes('control')?'control':path.includes('live')?'live':'demo')+'.png',fullPage:true});
   for(const viewport of [{width:1100,height:700},{width:390,height:844}]){
    await page.setViewportSize(viewport);assert(await m1.isVisible());assert(await m2.isVisible());
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
   }
   socket.close();await page.waitForFunction(()=>document.querySelector('[data-battery-robot="M1"]').dataset.state==='offline');
   assert.match(await m1.textContent(),/통신 끊김 · 마지막/);
   await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
   await page.waitForFunction(()=>document.querySelector('[data-battery-robot="M1"]').dataset.state==='stale');
   assert.equal(sockets.length,2,'Page restoration resubscribes but cannot revive old readings');
   sockets[1].send(JSON.stringify({op:'publish',topic:'/burger2/battery_state',msg:{voltage:12.3,present:true}}));
   await page.waitForFunction(()=>document.querySelector('[data-battery-robot="M2"]').dataset.state==='fresh');
   assert.match(await m2.textContent(),/100%/);assert.equal(await m1.getAttribute('data-state'),'stale');
   assert(batteryMessages.every(msg=>msg.op==='subscribe'),'Battery connection is subscription-only');
   assert(messages.every(msg=>msg.op!=='send_action_goal'),'Opening/restoring displays never sends a robot Action');
   assert.deepEqual(errors,[]);await page.close();
  }
  const page=await browser.newPage();let connections=0;
  await page.route('https://battery.test/**',async route=>{
   const url=new URL(route.request().url());const response=await route.fetch({url:base+url.pathname+url.search});await route.fulfill({response});
  });
  await page.routeWebSocket(/.*/,socket=>{connections++;socket.close();});
  await page.goto('https://battery.test/control.html',{waitUntil:'networkidle'});
  assert.match(await page.locator('[data-battery-robot="M1"]').textContent(),/Host PC/);assert.equal(connections,0);
  await page.close();
  console.log('PASS battery: four pages, voltage estimate, independent robots, invalid data, stale/disconnect, restoration, public gating and responsive layout.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
