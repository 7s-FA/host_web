const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/opt/google/chrome/chrome',args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),posts=[],errors=[];
 await page.routeWebSocket(/.*/,s=>s.close());page.on('pageerror',e=>errors.push(e.message));
 let state={bridge_connected:true,bridge_configured:true,runtime_mode:'hardware',pending_commands:0,
 supports_order_queue:true,can_start:true,can_enqueue:true,can_next_batch:false,queue_revision:1,pending_batches:[],order:null,
 movement_reset_available:{M1:false,M2:true},manual_revision:5,devices:Object.fromEntries(['M1','M2','warehouse','production'].map(k=>[k,{state:'idle',log:[]}]))};
 await page.route('**/api/live/**',async r=>{if(r.request().method()==='POST')posts.push({action:new URL(r.request().url()).pathname.split('/').at(-1),...r.request().postDataJSON()});await r.fulfill({json:state});});
 await page.goto('http://127.0.0.1:8087/control.html');
 await page.locator('#quantity-A').selectOption('2');await page.locator('#quantity-B').selectOption('2');
 await page.locator('#start-order').click();await page.waitForFunction(()=>!document.querySelector('#start-order').disabled);
 assert.deepEqual(posts[0],{action:'start',quantities:{A:2,B:2},auto_advance:true});
 state={...state,can_start:false,order:{id:'active',status:'running',quantity:2,products:['A','A'],stage:1,stage_count:15},pending_batches:[{products:['B','B']}],queue_revision:2};
 await page.waitForFunction(()=>document.querySelector('#start-order').textContent==='주문 추가');
 await page.locator('#quantity-A').selectOption('1');await page.locator('#quantity-B').selectOption('1');await page.locator('#start-order').click();
 await page.waitForFunction(()=>!document.querySelector('#start-order').disabled);
 assert.equal(posts[1].action,'enqueue');assert.deepEqual(posts[1].quantities,{A:1,B:1});assert(await page.locator('#next-batch').isDisabled());
 state={...state,can_next_batch:true,order:{...state.order,status:'done'}};
 await page.waitForFunction(()=>!document.querySelector('#next-batch').disabled);await page.locator('#next-batch').click();
 assert(await page.locator('#batch-confirm').isDisabled());await page.locator('#batch-confirmed').check();
 state={...state,queue_revision:3};await page.waitForFunction(()=>document.querySelector('#batch-confirm').disabled);await page.locator('#batch-cancel').click();
 await page.locator('#next-batch').click();await page.locator('#batch-confirmed').check();await page.locator('#batch-confirm').click();
 await page.waitForFunction(()=>!document.querySelector('#next-batch').disabled);assert.deepEqual(posts[2],{action:'next_batch',order_id:'active',queue_revision:3,operator_confirmed:true});
 state={...state,order:null,can_next_batch:false,manual_move:{device:'M2',command:'GO_TO_PARK',failed:true}};
 await page.locator('#device-M2 .device-recovery summary').click();
 await page.waitForTimeout(1200);await page.locator('[data-error-reset-robot="M2"]').click();
 assert.match(await page.locator('#reset-title').textContent(),/M2 이동 초기화/);await page.locator('#confirm-reset').click();assert.equal(posts.length,3);
 await page.locator('#reset-confirmed').check();await page.locator('#confirm-reset').click();
 await page.waitForTimeout(100);assert.deepEqual(posts[3],{action:'reset_movement',device:'M2',order_id:null,recovery_revision:5,operator_confirmed:true});
 assert.deepEqual(errors,[]);
 await page.screenshot({path:'/tmp/order-queue-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/order-queue-mobile.png',fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 console.log('PASS mixed quantities, mid-run enqueue, pallet confirmation, stale revision, no-order movement reset, desktop/mobile');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
