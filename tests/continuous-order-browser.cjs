const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/opt/google/chrome/chrome',args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),posts=[],errors=[];
 await page.routeWebSocket(/.*/,s=>s.close());page.on('pageerror',e=>errors.push(e.message));
 let state={bridge_connected:true,bridge_configured:true,runtime_mode:'hardware',pending_commands:0,
 supports_order_queue:true,supports_continuous_orders:true,remaining_capacity:{A:2,B:2},
 can_start:true,can_enqueue:false,can_next_batch:false,queue_revision:1,pending_batches:[],order:null,
 devices:Object.fromEntries(['M1','M2','warehouse','production'].map(k=>[k,{state:'idle',log:[]}]))};
 await page.route('**/api/live/**',async r=>{if(r.request().method()==='POST')posts.push({action:new URL(r.request().url()).pathname.split('/').at(-1),...r.request().postDataJSON()});await r.fulfill({json:state});});
 await page.goto('http://127.0.0.1:8087/control.html');
 await page.locator('#quantity-A').selectOption('1');await page.locator('#quantity-B').selectOption('0');
 await page.locator('#start-order').click();
 assert.deepEqual(posts[0],{action:'start',quantities:{A:1,B:0},auto_advance:true});
 state={...state,can_start:false,can_enqueue:true,remaining_capacity:{A:1,B:2},order:{id:'active',status:'running',quantity:1,products:['A'],stage:1,stage_count:7,plan_mode:'continuous-v1'}};
 await page.waitForFunction(()=>document.querySelector('#quantity-A').options[2].disabled);
 assert(await page.locator('#next-batch').isHidden());assert(await page.locator('#clear-queue').isHidden());
 assert(!/묶음/.test(await page.locator('#order-queue-panel').innerText()));
 await page.locator('#quantity-A').selectOption('1');await page.locator('#quantity-B').selectOption('2');await page.locator('#start-order').click();
 assert.deepEqual(posts[1],{action:'enqueue',quantities:{A:1,B:2},auto_advance:true});
 state={...state,can_enqueue:false,remaining_capacity:{A:0,B:0},order:{...state.order,quantity:4,products:['A','A','B','B']}};
 await page.waitForFunction(()=>document.querySelector('#quantity-A').disabled&&document.querySelector('#quantity-B').disabled);
 assert(await page.locator('#start-order').isDisabled());
 state={...state,can_start:true,remaining_capacity:{A:2,B:2},order:{...state.order,status:'done'}};
 await page.waitForFunction(()=>!document.querySelector('#quantity-A').options[2].disabled);
 await page.locator('#quantity-A').selectOption('2');await page.locator('#quantity-B').selectOption('2');
 await page.waitForFunction(()=>!document.querySelector('#start-order').disabled);await page.locator('#start-order').click();
 assert.deepEqual(posts[2],{action:'start',quantities:{A:2,B:2},auto_advance:true});
 await page.screenshot({path:'/tmp/continuous-order-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/continuous-order-mobile.png',fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 console.log('PASS continuous order, mid-run cumulative caps, no batch controls, reset capacity after completion, desktop/mobile');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
