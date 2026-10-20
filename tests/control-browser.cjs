const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],orders=[];
  page.setDefaultTimeout(10000);
  await page.routeWebSocket(/.*/,socket=>socket.close());
  page.on('pageerror',error=>errors.push(error.message));
  const deviceNames={M1:'M1',M2:'M2',warehouse:'자재창고',production:'제작공정'};
  let state={bridge_configured:true,bridge_connected:false,pending_commands:0,order:null,
   order_policy:{quantity_min:1,quantity_max:2,quantity_default:2},conditions:[],can_advance:false,log:[],
   devices:Object.fromEntries(Object.keys(deviceNames).map(key=>[key,{state:'idle',detail:key+' 보고',log:[]}]))};
  let unavailable=false;
  await page.route('**/api/live/**',async route=>{
   if(unavailable)return route.abort('connectionrefused');
   const request=route.request();
   if(request.method()==='POST'){
    assert.equal(new URL(request.url()).pathname,'/api/live/start');
    orders.push(request.postDataJSON());
   }
   await route.fulfill({json:state});
  });
  const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8082';
  await page.goto(base.replace(/\/$/,'')+'/control.html',{waitUntil:'networkidle'});
  const products=page.locator('[data-product-type]'),quantities=page.locator('[data-quantity]');
  const dialog=page.locator('#log-dialog'),entries=page.locator('#log-entries li');
  async function selected(product,quantity){
   assert.equal(await page.locator(`[data-product-type="${product}"]`).getAttribute('aria-pressed'),'true');
   assert.equal(await page.locator('[data-product-type][aria-pressed="true"]').count(),1);
   assert.equal(await page.locator(`[data-quantity="${quantity}"]`).getAttribute('aria-pressed'),'true');
   assert.equal(await page.locator('[data-quantity][aria-pressed="true"]').count(),1);
  }
  async function openLog(target){
   const label=target==='host'?'Host':deviceNames[target];
   await page.getByRole('button',{name:label+' 로그 보기',exact:true}).click();
   assert(await dialog.isVisible());
   assert.equal(await page.locator('#log-dialog-title').textContent(),label+' 로그');
  }
  async function closeLog(escape=false){
   if(escape)await page.keyboard.press('Escape');else await page.getByRole('button',{name:'로그 닫기',exact:true}).click();
   await dialog.waitFor({state:'hidden'});
  }
  async function noOverflow(){
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal page overflow');
   if(await dialog.isVisible())assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),'No horizontal dialog overflow');
  }
  assert.equal(await products.count(),2);assert.equal(await quantities.count(),2);
  assert.equal(await page.locator('input[type="number"]').count(),0);
  await selected('A',2);assert(await page.locator('#start-order').isDisabled());
  assert(await page.locator('#auto-advance').isChecked());
  assert.deepEqual(await page.locator('.device-item header strong').allTextContents(),Object.values(deviceNames));
  assert.match(await page.locator('#device-warehouse .device-components').textContent(),/로봇팔 1/);
  for(const name of ['로봇팔 2·3','리니어','카메라'])assert((await page.locator('#device-production .device-components').textContent()).includes(name));
  await openLog('host');assert(await page.locator('#log-empty').isVisible());
  assert.match(await page.locator('#log-empty').textContent(),/수신한 로그가 없습니다/);assert.equal(await entries.count(),0);
  await closeLog(true);assert.deepEqual(orders,[]);

  const markup='<img src=x onerror="window.logMarkupExecuted=true"> <script>bad()</script>';
  state={...state,bridge_connected:true,log:Array.from({length:100},(_,i)=>i===0?markup:`Host 기록 ${i}`),
   devices:{...state.devices,M1:{state:'idle',detail:'M1 준비',log:Array.from({length:50},(_,i)=>i===0?markup:`M1 기록 ${i}`)},
    warehouse:{state:'idle',detail:'공급 준비',log:['자재창고 전용 기록']},production:{state:'idle',detail:'공정 준비',log:['제작공정 전용 기록']}}};
  await page.waitForFunction(()=>!document.getElementById('start-order').disabled);
  for(const product_type of ['A','B'])for(const quantity of [1,2]){
   await page.locator(`[data-product-type="${product_type}"]`).click();
   await page.locator(`[data-quantity="${quantity}"]`).click();
   const poll=await page.waitForResponse(response=>response.url().endsWith('/api/live/state')&&response.request().method()==='GET');
   await poll.finished();await page.evaluate(()=>new Promise(requestAnimationFrame));
   await selected(product_type,quantity);
   const sent=page.waitForResponse(response=>response.url().endsWith('/api/live/start'));
   await page.locator('#start-order').click();await sent;
   await page.waitForFunction(()=>!document.getElementById('start-order').disabled);
  }
  assert.deepEqual(orders,[{product_type:'A',quantity:1},{product_type:'A',quantity:2},{product_type:'B',quantity:1},{product_type:'B',quantity:2}]);
  state={...state,order:{id:'active-order',product_type:'A',quantity:1,status:'running',auto_advance:false,stage:1,stage_count:8,transport_remaining:1,product_remaining:1,completed:0}};
  await page.waitForFunction(()=>document.getElementById('order-status').textContent==='작업 중');
  await selected('A',1);
  assert.equal(await page.locator('#auto-advance').isChecked(),false,'Running manual order keeps its actual setting');
  for(const button of await products.all())assert(await button.isDisabled());
  for(const button of await quantities.all())assert(await button.isDisabled());
  assert(await page.locator('#start-order').isDisabled());assert.equal(orders.length,4);
  state={...state,order:{...state.order,status:'done',completed:1,transport_remaining:0,product_remaining:0}};
  await page.waitForFunction(()=>!document.getElementById('start-order').disabled);
  assert(await page.locator('#auto-advance').isChecked(),'New order after completion defaults to automatic');
  await page.locator('#auto-advance').uncheck();
  await page.waitForResponse(r=>r.url().endsWith('/api/live/state'));await page.evaluate(()=>new Promise(requestAnimationFrame));
  assert.equal(await page.locator('#auto-advance').isChecked(),false,'Polling preserves operator choice');
  await page.locator('[data-product-type="B"]').click();await page.locator('[data-quantity="2"]').click();
  await selected('B',2);assert.match(await page.locator('#order-selection').textContent(),/B제품.*2개/);
  assert.match(await page.locator('#order-id').textContent(),/A제품.*1개/);
  state={...state,order:null,pending_commands:1};
  await page.waitForFunction(()=>document.getElementById('start-order').disabled);
  for(const button of await products.all())assert(await button.isDisabled());
  for(const button of await quantities.all())assert(await button.isDisabled());
  assert(await page.locator('#auto-advance').isChecked(),'Clearing an order restores automatic default');
  state={...state,pending_commands:0};
  await page.waitForFunction(()=>!document.getElementById('start-order').disabled);
  await selected('B',2);await noOverflow();await page.screenshot({path:'/tmp/control-desktop.png',fullPage:true});

  for(const target of ['host',...Object.keys(deviceNames)]){
   await openLog(target);
   const expected=target==='host'?state.log:state.devices[target].log;
   assert.deepEqual(await entries.allTextContents(),expected,`${target} logs must stay separate and complete`);
   assert.equal(await page.locator('#log-empty').isVisible(),expected.length===0);
   assert.equal(await page.locator('#log-entries img, #log-entries script').count(),0);
   assert.equal(await page.evaluate(()=>window.logMarkupExecuted),undefined);
   await closeLog(target==='M1');
  }
  await openLog('M1');
  state={...state,devices:{...state.devices,M1:{...state.devices.M1,log:[...state.devices.M1.log.slice(1),'M1 새 기록']}}};
  await page.waitForFunction(()=>document.querySelector('#log-entries li:last-child')?.textContent==='M1 새 기록');
  assert.deepEqual(await entries.allTextContents(),state.devices.M1.log);await closeLog();
  await openLog('host');
  state={...state,log:[...state.log.slice(1),'Host 열린 창 갱신']};
  await page.waitForFunction(()=>document.querySelector('#log-entries li:last-child')?.textContent==='Host 열린 창 갱신');
  assert.deepEqual(await entries.allTextContents(),state.log);assert.equal(await entries.count(),100);
  await noOverflow();await page.screenshot({path:'/tmp/control-log.png'});
  state={...state,bridge_connected:false};
  await page.waitForFunction(()=>document.getElementById('log-dialog-status').textContent.includes('연결 안 됨'));
  assert.deepEqual(await entries.allTextContents(),state.log);assert(await page.locator('#start-order').isDisabled());
  state={...state,bridge_connected:true};
  await page.waitForFunction(()=>document.getElementById('log-dialog-status').textContent.includes('보고 수신 중'));
  unavailable=true;
  await page.waitForFunction(()=>document.getElementById('control-alert').textContent.includes('127.0.0.1:8082/control.html'));
  assert.deepEqual(await entries.allTextContents(),state.log);assert(await page.locator('#start-order').isDisabled());
  await closeLog();await openLog('M1');assert.deepEqual(await entries.allTextContents(),state.devices.M1.log);await closeLog(true);
  await page.setViewportSize({width:390,height:844});await noOverflow();
  await page.screenshot({path:'/tmp/control-mobile.png',fullPage:true});
  await openLog('host');await noOverflow();assert.equal(await entries.count(),100);await closeLog();
  assert.deepEqual(errors,[]);
  console.log('PASS: control A/B and 1/2 orders, polling and selection locks, four devices, isolated complete logs, safe text, dialog updates, disconnect retention and responsive layout.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
