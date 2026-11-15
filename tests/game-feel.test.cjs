// Objective Game Feel baseline; runs only against production game code in Chromium.
// The test server adds a test-only state/tick accessor, matching tests/browser.test.cjs.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');

let browser,server,base;
const results={build:process.env.GAME_FEEL_BUILD||'original-main-baseline',viewport:{width:1280,height:800},metrics:{}};

before(async()=>{
  const root=path.join(__dirname,'../docs');
  server=http.createServer((req,res)=>{
    const name=req.url==='/'?'index.html':req.url.slice(1);
    if(!['index.html','game.js','level_train_v1.json'].includes(name)){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':'text/html');
    let body=fs.readFileSync(path.join(root,name),'utf8');
    if(name==='game.js') body+='\nwindow.__test={run:code=>eval(code)};const tracedTick=updateLogic;updateLogic=(...args)=>{window.__logic_ticks=(window.__logic_ticks||0)+1;return tracedTick(...args)};';
    res.end(body);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
});
after(async()=>{
  if(process.env.GAME_FEEL_RESULTS){
    fs.mkdirSync(path.dirname(process.env.GAME_FEEL_RESULTS),{recursive:true});
    fs.writeFileSync(process.env.GAME_FEEL_RESULTS,JSON.stringify(results,null,2)+'\n');
    console.log('GAME_FEEL_BASELINE '+JSON.stringify(results));
  }
  await browser?.close();
  await new Promise(r=>server?server.close(r):r());
});
async function openGame(t){
  const p=await browser.newPage({viewport:results.viewport});t.after(()=>p.close());
  const errors=[];p.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[],'page has no uncaught browser errors'));
  await p.clock.install({time:new Date('2026-10-21T00:00:00Z')});
  await p.clock.pauseAt(new Date('2026-10-21T00:00:10Z'));
  await p.goto(base);
  await p.waitForFunction(()=>window.__test?.run('state!==null'));
  const run=code=>p.evaluate(code=>window.__test.run(code),code);
  await run('state.enemies=[]');
  await p.clock.runFor(1000);
  return {p,run};
}
async function tick(p){
  const before=await p.evaluate(()=>window.__logic_ticks||0);
  for(let i=0;i<5;i++){
    await p.clock.runFor(17);
    const now=await p.evaluate(()=>window.__logic_ticks||0);
    if(now>before)return now-before;
  }
  throw new Error('No production logic tick observed');
}
async function ticks(p,count){let total=0;for(let i=0;i<count;i++)total+=await tick(p);return total;}

test('feel baseline: A/D response, release drift, and reversal are measured in logic ticks',async t=>{
  const {p,run}=await openGame(t);
  const start=await run('({x:state.player.x,y:state.player.y,grounded:state.player.grounded})');
  assert.equal(start.grounded,true,'baseline begins grounded');
  await p.keyboard.down('d');
  const responseTicks=await tick(p);
  const afterD=await run('({x:state.player.x,vx:state.player.vx})');
  assert.equal(responseTicks,1,'D is sampled on the first production logic tick after the event');
  assert.ok(afterD.x>start.x,'D produces movement on its first sampled logic tick');
  assert.equal(afterD.vx,8,'D sets the baseline grounded movement speed');
  await p.keyboard.up('d');
  const releaseTicks=await tick(p);
  assert.equal(releaseTicks,1,'keyup is sampled on the first production logic tick after the event');
  const atRelease=await run('({x:state.player.x,vx:state.player.vx})');
  await ticks(p,6);
  const afterSettle=await run('state.player.x');
  const releaseDrift=afterSettle-atRelease.x;
  const stopDistanceAfterReleaseEvent=afterSettle-afterD.x;
  assert.equal(atRelease.vx,0,'keyup clears grounded horizontal velocity on the sampling tick');
  assert.ok(Math.abs(releaseDrift)<1e-8,'position does not continue accumulating after keyup is sampled');

  await p.keyboard.down('d');await tick(p);
  await p.keyboard.up('d');await p.keyboard.down('a');
  const reversalStart=await run('state.player.x');
  const reversalTicks=await tick(p);
  assert.equal(reversalTicks,1,'direction reversal is sampled on the first production logic tick');
  const afterA=await run('({x:state.player.x,vx:state.player.vx})');
  assert.ok(afterA.x<reversalStart,'A reverses displacement on its first sampled logic tick');
  assert.equal(afterA.vx,-8,'A sets the baseline leftward movement speed');
  results.metrics.horizontal={responseTicks,responseDisplacement:afterD.x-start.x,responseVelocity:afterD.vx,releaseTicks,postSampleDrift:releaseDrift,stopDistanceAfterReleaseEvent,reversalTicks,reversalDisplacement:afterA.x-reversalStart,reversalVelocity:afterA.vx,worldUnitsPerSecond:8};
});

test('feel baseline: jump, landing, dash, slide and grapple transitions are observable',async t=>{
  const {p,run}=await openGame(t);
  const y0=await run('state.player.y');
  await p.keyboard.down('Space');
  const jumpResponseTicks=await tick(p);
  assert.equal(await run('state.player.grounded'),false,'jump leaves grounded state on sampled press');
  let jumpTicks=1,apexTick=0,lastY=await run('state.player.y'),apexY=lastY;
  for(;jumpTicks<120;jumpTicks++){
    await tick(p);const y=await run('state.player.y');
    if(y>apexY){apexY=y;apexTick=jumpTicks+1;}
    if(jumpTicks>apexTick&&y<lastY)break;
    lastY=y;
  }
  await p.keyboard.up('Space');await tick(p);
  let landingTicks=0;
  while(!(await run('state.player.grounded'))&&landingTicks<180){await tick(p);landingTicks++;}
  assert.equal(await run('state.player.grounded'),true,'jump returns to grounded state');
  assert.ok(apexY>y0,'jump has a measurable ascent');
  await p.keyboard.down('Space');await tick(p); // fresh jump after landing
  await p.keyboard.up('Space');await tick(p);
  const dashOrigin=await run('({x:state.player.x,y:state.player.y})');
  await p.keyboard.down('Space');
  const dashResponseTicks=await tick(p);
  assert.equal(jumpResponseTicks,1,'jump starts on the first sampled press');
  assert.equal(dashResponseTicks,1,'air Dash starts on the first sampled second press');
  const dashStart=await run('({x:state.player.x,y:state.player.y,dash:!!state.player.dash})');
  assert.equal(dashStart.dash,true,'second press in air enters Dash');
  let dashTicks=1;
  while((await run('!!state.player.dash'))&&dashTicks<20){await tick(p);dashTicks++;}
  assert.equal(await run('!!state.player.dash'),false,'Dash exits in a finite number of ticks');
  const dashEnd=await run('({x:state.player.x,y:state.player.y})');

  await p.keyboard.up('Space');await ticks(p,180);
  assert.equal(await run('state.player.grounded'),true,'player lands before slide baseline');
  await p.keyboard.down('d');await p.keyboard.down('s');const slideEntryTicks=await tick(p);
  assert.equal(slideEntryTicks,1,'slide starts on the first sampled S press');
  assert.equal(await run('!!state.player.slide'),true,'moving S press enters slide');
  const slideStart=await run('state.player.x');
  await p.keyboard.up('d');await p.keyboard.down('a');const slideReverseTicks=await tick(p);
  assert.equal(slideReverseTicks,1,'opposite input is sampled during slide');
  assert.equal(await run('state.player.slide.dir'),1,'slide state retains its starting direction');
  assert.ok(await run('state.player.vx')>0,'opposite input does not reverse slide velocity');
  let slideTicks=1;
  while((await run('!!state.player.slide'))&&slideTicks<70){await tick(p);slideTicks++;}
  assert.equal(await run('!!state.player.slide'),false,'slide exits');
  const slideEnd=await run('state.player.x');
  await p.keyboard.up('a');await p.keyboard.up('s');await tick(p);

  await run("state.enemies=[];state.rects.push({id:'FEEL_GRAPPLE_WALL',type:'Wall',x:state.player.x+7,y:state.player.y,w:1,h:8});mx=1279;my=360");
  await p.mouse.down({button:'right'});const grappleEntryTicks=await tick(p);
  assert.equal(grappleEntryTicks,1,'grapple starts on the first sampled right mouse press');
  assert.equal(await run('state.grapple.mode'),'fly','right mouse starts grapple flight');
  let grappleTicks=1;
  while(await run("state.grapple.mode==='fly'")&&grappleTicks<80){await tick(p);grappleTicks++;}
  const grappleModeBeforeRelease=await run('state.grapple.mode');
  assert.ok(['pull','stuck','none'].includes(grappleModeBeforeRelease),'grapple reaches a terminal travel or pull state');
  await p.mouse.up({button:'right'});const grappleReleaseTicks=await tick(p);
  assert.equal(grappleReleaseTicks,1,'right mouse release is sampled on the first logic tick');
  assert.equal(await run('state.grapple.mode'),'none','right mouse release clears grapple');

  results.metrics.actions={jumpResponseTicks,jumpTicks,apexTick,apexDisplacement:apexY-y0,landingTicks,dashResponseTicks,dashTicks,dashDisplacement:{x:dashEnd.x-dashOrigin.x,y:dashEnd.y-dashOrigin.y},slideEntryTicks,slideReverseTicks,slideTicks,slideDisplacement:slideEnd-slideStart,grappleEntryTicks,grappleTicks,grappleModeBeforeRelease,grappleReleaseTicks};
});


test('feel baseline: collision blocks movement without sticking input, and blur clears held input',async t=>{
  const {p,run}=await openGame(t);
  const startX=await run('state.player.x');
  await run("state.rects.push({id:'FEEL_BLOCK_TEST',type:'Wall',x:7,y:state.player.y,w:1,h:4})");
  await p.keyboard.down('d');await ticks(p,6);
  const blocked=await run('({x:state.player.x,vx:state.player.vx,overlap:blockers().some(r=>penetrates(aabb(state.player),aabb(r)))})');
  assert.ok(Math.abs(blocked.x-startX)<0.01,'wall collision prevents crossing the wall');
  assert.equal(blocked.vx,0,'collision clears movement velocity');
  assert.equal(blocked.overlap,false,'collision leaves no terrain penetration');
  await run("state.rects=state.rects.filter(r=>r.id!=='FEEL_BLOCK_TEST')");
  await tick(p);
  const resumedX=await run('state.player.x');
  assert.ok(resumedX>blocked.x,'held direction is accepted after the blocking wall is removed');
  await p.keyboard.up('d');await tick(p);

  await run('resetAll();state.enemies=[]');
  await ticks(p,60);
  await p.keyboard.down('d');await tick(p);
  await p.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await tick(p);
  const blurStop=await run('({x:state.player.x,vx:state.player.vx})');
  await ticks(p,6);
  const blurSettled=await run('state.player.x');
  assert.equal(blurStop.vx,0,'blur clears held horizontal input');
  assert.ok(Math.abs(blurSettled-blurStop.x)<1e-8,'movement stays stopped after blur');
  results.metrics.blocking={wallPreventsCrossing:true,inputResumesAfterWallRemoval:true,blurVelocity:blurStop.vx,postBlurDrift:blurSettled-blurStop.x};
});

test('display baseline: full Canvas renders without overflow and produces a retained screenshot',async t=>{
  const {p,run}=await openGame(t);
  await p.clock.runFor(34);
  const geometry=await p.evaluate(()=>{
    const c=document.querySelector('#game'),r=c.getBoundingClientRect(),ctx=c.getContext('2d');
    const data=ctx.getImageData(0,0,c.width,c.height).data;let visible=0;
    for(let i=0;i<data.length;i+=4)if(data[i+3]>0)visible++;
    return {canvas:{width:c.width,height:c.height,cssWidth:r.width,cssHeight:r.height},scrollWidth:document.documentElement.scrollWidth,innerWidth,visiblePixelRatio:visible/(c.width*c.height)};
  });
  assert.deepEqual(geometry.canvas.width,1280);
  assert.deepEqual(geometry.canvas.height,720);
  assert.ok(geometry.canvas.cssWidth>0&&geometry.canvas.cssHeight>0,'Canvas has visible dimensions');
  assert.ok(geometry.scrollWidth<=geometry.innerWidth,'page has no horizontal overflow');
  assert.ok(geometry.visiblePixelRatio>0.005,'rendered frame contains visible game/UI pixels');
  const shot=process.env.GAME_FEEL_SCREENSHOT||path.join(process.cwd(),'test-artifacts','game-feel-baseline.png');
  fs.mkdirSync(path.dirname(shot),{recursive:true});
  await p.locator('#game').screenshot({path:shot});
  results.display={...geometry,screenshot:shot};
  assert.ok(await run('state.game_state')==='RUN','baseline screenshot is captured from a live run');
});
