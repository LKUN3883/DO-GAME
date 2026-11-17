// Objective Game Feel baseline; runs only against production game code in Chromium.
// The test server adds a test-only state/tick accessor, matching tests/browser.test.cjs.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');

let browser,server,base;
const results={build:process.env.GAME_FEEL_BUILD||'local-working-tree',viewport:{width:1280,height:800},metrics:{},traces:{}};

before(async()=>{
  const root=path.join(__dirname,'../docs');
  server=http.createServer((req,res)=>{
    const name=req.url==='/'?'index.html':req.url.slice(1);
    if(!['index.html','game.js','level_train_v1.json'].includes(name)){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':'text/html');
    let body=fs.readFileSync(path.join(root,name),'utf8');
    if(name==='game.js') body+='\nwindow.__test={run:code=>eval(code)};const tracedTick=updateLogic;updateLogic=(...args)=>{window.__logic_ticks=(window.__logic_ticks||0)+1;const result=tracedTick(...args);if(location.hash==="#slide-jump-momentum"){const p=state.player;(window.__motion_trace||=[]).push({tick:window.__logic_ticks,inputX:(input.D.down?1:0)-(input.A.down?1:0),x:p.x,y:p.y,vx:p.vx,vy:p.vy,grounded:p.grounded,slide:!!p.slide,carry:!!p.slide_jump,dash:!!p.dash,grapple:state.grapple.mode,respawnLock:p.respawn_lock,penetrating:blockers().some(r=>penetrates(aabb(p),aabb(r)))});}return result};';
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
    const columns=['tick','inputX','x','y','vx','vy','grounded','slide','carry','dash','grapple','respawnLock','penetrating'];
    const rows=Object.entries(results.traces).flatMap(([scenario,frames])=>frames.map(frame=>[JSON.stringify(scenario),...columns.map(k=>frame[k])].join(',')));
    fs.writeFileSync(path.join(path.dirname(process.env.GAME_FEEL_RESULTS),'velocity-traces.csv'),['scenario,'+columns.join(','),...rows].join('\n')+'\n');
    const {traces,...summary}=results;
    console.log('GAME_FEEL_BASELINE '+JSON.stringify({...summary,traceFrames:Object.values(traces).reduce((n,frames)=>n+frames.length,0)}));
  }
  await browser?.close();
  await new Promise(r=>server?server.close(r):r());
});
async function openGame(t){
  const p=await browser.newPage({viewport:results.viewport});
  const traceName=t.name+' / page '+(Object.keys(results.traces).length+1);
  results.traces[traceName]=[];
  t.after(async()=>{results.traces[traceName]=await p.evaluate(()=>window.__motion_trace||[]);await p.close();});
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
  for(let i=0;i<100;i++){
    await p.clock.runFor(1);
    const now=await p.evaluate(()=>window.__logic_ticks||0);
    if(now>before){assert.equal(now-before,1,'tick helper advances exactly one production logic tick');return 1;}
  }
  throw new Error('No production logic tick observed');
}
async function ticks(p,count){let total=0;for(let i=0;i<count;i++)total+=await tick(p);return total;}

async function motionScreenshot(p,run,name){
  if(!process.env.GAME_FEEL_RESULTS)return;
  const shot=path.join(path.dirname(process.env.GAME_FEEL_RESULTS),name+'.png');
  fs.mkdirSync(path.dirname(shot),{recursive:true});
  await run('render()');
  await p.locator('#game').screenshot({path:shot});
}

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

test('opt-in slide jump preserves launch speed and integrates current velocity',async t=>{
  const {p,run}=await openGame(t);
  await run("location.hash='#slide-jump-momentum';"+
    "Object.assign(state.player,{x:50,y:0,vx:9.5,vy:0,grounded:true,h:1,crouch:false,"+
    "slide:{dir:1,t:0,frames:0},slide_jump:null,jump_ascend:false,jump_t:0,dash:null,respawn_lock:0});"+
    "state.rects=[];state.enemies=[];state.projectiles=[];keyRaw.clear();");
  await p.keyboard.down('Space');
  await tick(p);
  await p.keyboard.up('Space');
  const launch=await run("({vx:state.player.vx,vy:state.player.vy,grounded:state.player.grounded,slide:state.player.slide,carry:state.player.slide_jump})");
  assert.equal(launch.vx,9.5,'first jump tick preserves the exact slide launch speed');
  assert.ok(launch.vy>0,'slide jump launches upward');
  assert.equal(launch.slide,null,'slide state cleanly transitions into jump');
  assert.ok(launch.carry,'slide jump enters its temporary momentum airborne momentum state');
  await p.keyboard.down('d');await tick(p);
  const switchedD1=await run('state.player.vx');
  assert.ok(Math.abs(switchedD1-launch.vx)<=1.500001,'first D input changes velocity within the acceleration limit');
  await p.keyboard.up('d');await p.keyboard.down('a');await tick(p);
  const switchedA=await run('state.player.vx');
  assert.ok(Math.abs(switchedA-switchedD1)<=1.500001,'D-to-A switch is acceleration-limited');
  await p.keyboard.up('a');await p.keyboard.down('d');await tick(p);
  const switchedD2=await run('state.player.vx');
  assert.ok(Math.abs(switchedD2-switchedA)<=1.500001,'A-to-D switch is acceleration-limited');
  await p.keyboard.up('d');await p.keyboard.down('a');await tick(p);
  const steer=await run('state.player.vx');
  assert.ok(steer<switchedD2 && steer>0,'sustained opposite direction begins with gradual steering');
  await ticks(p,12);
  const turned=await run('({vx:state.player.vx,grounded:state.player.grounded,carry:state.player.slide_jump})');
  assert.ok(turned.vx<0,'sustained opposite input can reverse the airborne direction');
  assert.equal(turned.grounded,false,'the player remains airborne during the handoff');
  assert.ok(turned.carry,'momentum control remains active for the airborne action');
  await p.keyboard.up('a');
  results.metrics.slideJumpMomentum={launchVx:launch.vx,firstOppositeSteerVx:steer,reversedVx:turned.vx,exactInitialSpeed:true};
});


test('opt-in slide jump hands off to air Dash without restoring launch speed and lands cleanly',async t=>{
  const {p,run}=await openGame(t);
  await run("location.hash='#slide-jump-momentum';state.enemies=[];state.projectiles=[];keyRaw.clear();mx=1279;my=360");
  await p.keyboard.down('d');await p.keyboard.down('s');await tick(p);
  const sliding=await run("({slide:state.player.slide,vx:state.player.vx,grounded:state.player.grounded})");
  assert.ok(sliding.slide,'real D+S input enters slide');
  assert.equal(sliding.grounded,true);
  assert.ok(sliding.vx>=9.9,'slide has its forward launch velocity');

  await p.keyboard.down('Space');await tick(p);await p.keyboard.up('Space');
  const launched=await run("({slide:state.player.slide,carry:state.player.slide_jump,vx:state.player.vx,vy:state.player.vy,grounded:state.player.grounded})");
  assert.equal(launched.slide,null,'jump exits slide');
  assert.ok(launched.carry,'jump starts the momentum handoff');
  assert.ok(launched.vy>0&&!launched.grounded,'jump launches into the air');
  await motionScreenshot(p,run,'slide-jump-launch');
  assert.ok(Math.abs(launched.vx-sliding.vx)<1e-8,'jump preserves the measured slide speed');

  await p.keyboard.up('d');await tick(p);await p.keyboard.down('Space');await tick(p);
  const dashStart=await run("({dash:state.player.dash,carry:state.player.slide_jump,vx:state.player.vx})");
  assert.ok(dashStart.dash,'second Space press starts air Dash while momentum control is active');
  await motionScreenshot(p,run,'slide-jump-dash');
  assert.equal(dashStart.carry,null,'Dash takeover clears the old slide-jump handoff');
  await p.keyboard.up('Space');
  let dashTicks=1;
  while(await run('!!state.player.dash')&&dashTicks<20){await tick(p);dashTicks++;}
  assert.equal(await run('!!state.player.dash'),false,'Dash completes');
  const dashEnd=await run("({vx:state.player.vx,carry:state.player.slide_jump,grounded:state.player.grounded})");
  assert.equal(dashEnd.carry,null,'old slide-jump state does not resume after Dash');
  assert.equal(dashEnd.vx,0,'neutral input leaves no resurrected horizontal launch speed');
  let landingTicks=0;
  while(!(await run('state.player.grounded'))&&landingTicks<180){await tick(p);landingTicks++;}
  const landed=await run("({grounded:state.player.grounded,carry:state.player.slide_jump,dashUsed:state.player.dash_used,vx:state.player.vx})");
  assert.equal(landed.grounded,true,'player lands naturally after the action chain');
  assert.equal(landed.carry,null,'landing leaves no slide-jump handoff state');
  assert.equal(landed.dashUsed,false,'ground contact restores Dash availability');
  assert.equal(landed.vx,0,'neutral ground movement resumes without stale momentum');
  results.metrics.slideJumpDash={slideVx:sliding.vx,jumpVx:launched.vx,dashTicks,landingTicks,postDashVx:dashEnd.vx,carryCleared:true};
});

test('opt-in slide-jump handoff is cleared when grapple pull takes over',async t=>{
  const {p,run}=await openGame(t);
  await run("location.hash='#slide-jump-momentum';keyRaw.clear();state.enemies=[];state.projectiles=[];state.rects=[{id:'HANDOFF_ANCHOR',type:'Wall',x:12.5,y:-20,w:1,h:8}];" +
    "Object.assign(state.player,{x:10,y:-20,vx:10,vy:0,w:1,h:2,grounded:false,slide:null,slide_jump:{vx:10,dir:1,t:2*DT},dash:null,dash_used:false,jump_ascend:true,respawn_lock:0});" +
    "state.cam={x:10,y:-20};mx=1279;my=360");
  await p.mouse.down({button:'right'});
  let travelTicks=0;
  while(await run("state.grapple.mode==='none'||state.grapple.mode==='fly'")){
    await tick(p);travelTicks++;
    if(travelTicks>=12)break;
  }
  const pulled=await run("({mode:state.grapple.mode,carry:state.player.slide_jump})");
  assert.equal(pulled.mode,'pull','grapple reaches and takes over at the wall anchor');
  assert.equal(pulled.carry,null,'grapple takeover clears slide-jump handoff');
  await p.mouse.up({button:'right'});await tick(p);
  const released=await run("({mode:state.grapple.mode,carry:state.player.slide_jump,vx:state.player.vx})");
  assert.equal(released.mode,'none','releasing grapple exits pull');
  assert.equal(released.carry,null,'released grapple does not restore old slide-jump state');
  results.metrics.grappleTakeover={travelTicks,modeAtTakeover:pulled.mode,carryCleared:true,modeAfterRelease:released.mode};
});

test('opt-in slide-jump handoff settles after blur and respawn clears it immediately',async t=>{
  const {p,run}=await openGame(t);
  await run("location.hash='#slide-jump-momentum';keyRaw.clear();state.rects=[];state.enemies=[];state.projectiles=[];" +
    "Object.assign(state.player,{x:50,y:0,vx:10,vy:10,w:1,h:2,grounded:false,slide:null,slide_jump:{vx:10,dir:1,t:0},dash:null,dash_used:false,jump_ascend:false,respawn_lock:0});" +
    "keyRaw.set('KeyD',true)");
  await p.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await ticks(p,12);
  const blurred=await run("({carry:state.player.slide_jump,vx:state.player.vx,raw:keyRaw.size})");
  assert.equal(blurred.raw,0,'blur releases held movement input');
  assert.ok(blurred.carry,'airborne momentum state remains valid after blur');
  assert.ok(blurred.vx>8 && blurred.vx<10,'neutral air drag reduces velocity gradually instead of snapping to zero');

  await run("Object.assign(state.player,{x:50,y:0,hp:0,vx:10,vy:0,grounded:false,slide_jump:{vx:10,dir:1,t:0},dash:null})");
  await tick(p);
  const respawned=await run("({hp:state.player.hp,carry:state.player.slide_jump,dash:state.player.dash,slide:state.player.slide,grounded:state.player.grounded,lock:state.player.respawn_lock})");
  assert.equal(respawned.hp,100,'death restores player health');
  assert.equal(respawned.carry,null,'respawn immediately clears slide-jump handoff');
  assert.equal(respawned.dash,null,'respawn clears Dash');
  assert.equal(respawned.slide,null,'respawn clears slide');
  assert.equal(respawned.grounded,false,'respawn leaves physics to reacquire ground');
  assert.ok(respawned.lock>0,'respawn retains the input lock');
  results.metrics.blurRespawn={blurCarryPreserved:!!blurred.carry,blurRawInputCount:blurred.raw,blurVelocity:blurred.vx,respawnCarryCleared:true,respawnLock:respawned.lock};
});

test('opt-in mirrored real slide jumps bound every D-A-D frame, cancel both keys, drag and land',async t=>{
  const summaries=[];
  for(const direction of [1,-1]){
    const {p,run}=await openGame(t);
    // Isolated wide floor, real key events from slide entry through natural landing.
    await run("location.hash='#slide-jump-momentum';state.rects=[{id:'FLOOR',type:'Solid',x:50,y:-26,w:100,h:2}];state.enemies=[];state.projectiles=[];Object.assign(state.player,{x:50,y:-23.999,vx:0,vy:0,grounded:true});");
    const forward=direction===1?'d':'a',reverse=direction===1?'a':'d';
    await p.keyboard.down(forward);await p.keyboard.down('s');await tick(p);
    const slideVx=await run('state.player.vx');
    assert.equal(slideVx,direction*10);
    await p.keyboard.down('Space');await tick(p);await p.keyboard.up('Space');await p.keyboard.up('s');
    let previous=await run('state.player.vx'),maxDelta=0;
    assert.equal(previous,slideVx,'real input launch inherits both signs exactly');
    async function sample(limit){
      await tick(p);
      const frame=await run('({vx:state.player.vx,grounded:state.player.grounded,carry:!!state.player.slide_jump,penetrating:blockers().some(r=>penetrates(aabb(state.player),aabb(r)))})');
      const delta=Math.abs(frame.vx-previous);maxDelta=Math.max(maxDelta,delta);
      assert.ok(delta<=limit+1e-8,`per-frame velocity change ${delta} exceeds ${limit}`);
      assert.ok(Math.abs(frame.vx)<=10,'inherited speed never exceeds slide speed');
      assert.equal(frame.grounded,false);assert.equal(frame.carry,true);assert.equal(frame.penetrating,false);
      previous=frame.vx;
    }
    // Includes rapid switching after the historical 0.18s handoff would have expired.
    for(let i=0;i<14;i++){
      await p.keyboard.up(i%2===0?reverse:forward);
      await p.keyboard.down(i%2===0?forward:reverse);
      await sample(90/60);
    }
    // A+D cancels direction and applies the neutral 5 units/s² drag.
    await p.keyboard.down(forward);await p.keyboard.down(reverse);
    const beforeNeutral=previous;
    await sample(5/60);
    assert.ok(Math.abs(previous)<Math.abs(beforeNeutral));
    await p.keyboard.up(forward);await p.keyboard.up(reverse);
    for(let i=0;i<6;i++)await sample(5/60);
    await p.keyboard.down(reverse);
    for(let i=0;i<12;i++)await sample(90/60);
    assert.ok(previous*direction<0,'sustained opposite input reverses direction');
    assert.ok(Math.abs(previous)<=8,'steering converges without target overshoot');
    await p.keyboard.up(reverse);
    let landingTicks=0;
    while(!(await run('state.player.grounded'))&&landingTicks++<100)await tick(p);
    assert.equal(await run('state.player.grounded'),true);
    assert.equal(await run('state.player.slide_jump'),null,'natural landing clears momentum without Dash');
    assert.equal(await run('state.player.dash_used'),false);
    await tick(p);assert.equal(await run('state.player.vx'),0,'ground control resumes after landing');
    summaries.push({direction,slideVx,maxDelta,landingTicks});
  }
  results.metrics.mirroredReversal=summaries;
});

test('opt-in momentum wall and ceiling contacts do not penetrate or restore launch speed',async t=>{
  for(const direction of [1,-1]){
    const {p,run}=await openGame(t);
    await run(`location.hash='#slide-jump-momentum';state.enemies=[];state.projectiles=[];state.rects=[{id:'WALL',type:'Wall',x:${50+direction*0.65},y:-10,w:0.05,h:20}];Object.assign(state.player,{x:50,y:-10,vx:${10*direction},vy:0,grounded:false,jump_ascend:false,slide_jump:{vx:${10*direction},dir:${direction},t:0}});`);
    await tick(p);
    assert.equal(await run('state.player.vx'),0,'wall stops inherited horizontal speed');
    for(let i=0;i<4;i++){
      await tick(p);
      assert.equal(await run('state.player.vx'),0,'neutral carry cannot resurrect pre-collision speed');
      assert.equal(await run('blockers().some(r=>penetrates(aabb(state.player),aabb(r)))'),false);
      assert.ok(direction*(await run('state.player.x')-50)<0.125,'thin wall is not crossed');
    }
    await run("state.rects=[{id:'ROOF',type:'Solid',x:50,y:-8.8,w:10,h:0.05}];Object.assign(state.player,{x:50,y:-10,vx:0,vy:53.334,jump_ascend:true,jump_t:0});");
    await tick(p);
    assert.equal(await run('state.player.vy'),0,'ceiling stops ascent');
    assert.ok(await run('state.player.y+state.player.h/2')<=-8.825,'head remains below thin ceiling');
    assert.equal(await run('blockers().some(r=>penetrates(aabb(state.player),aabb(r)))'),false);
  }
  results.metrics.momentumCollision={mirroredWalls:true,thinCeiling:true,postContactLaunchRestored:false};
});

test('default hash keeps existing slide-jump behavior and reset removes experimental state',async t=>{
  const {p,run}=await openGame(t);
  await p.keyboard.down('d');await p.keyboard.down('s');await tick(p);
  assert.equal(await run('state.player.vx'),10);
  await p.keyboard.down('Space');await tick(p);
  assert.equal(await run('state.player.vx'),8,'default page retains ordinary horizontal control');
  assert.equal(await run('state.player.slide_jump'),null);
  await run("location.hash='#slide-jump-momentum';state.player.slide_jump={vx:10,dir:1,t:1};resetAll()");
  assert.equal(await run('state.player.slide_jump'),null);
});

test('M1 opt-in: wall anchor becomes a physical rope, permits tangential motion and detaches with velocity',async t=>{
  const {p,run}=await openGame(t);
  await run("location.hash='#m1-swing';state.enemies=[];state.projectiles=[];"+
    "state.rects=[{id:'M1_WALL',type:'Wall',x:55,y:-20,w:1,h:38}];"+
    "Object.assign(state.player,{x:50,y:-20,vx:0,vy:0,grounded:false,slide:null,slide_jump:null,grapple_inertia:false,dash:null,jump_ascend:false,respawn_lock:0});"+
    "state.cam={x:50,y:-20};mx=1279;my=360;keyRaw.clear();");
  await p.mouse.down({button:'right'});
  let travel=0;
  while(await run("!['rope_slack','rope_taut'].includes(state.grapple.mode)")&&travel<30){await tick(p);travel++;}
  const anchor=await run("({mode:state.grapple.mode,L:state.grapple.rope_length,anchor:state.grapple.anchor})");
  assert.ok(['rope_slack','rope_taut'].includes(anchor.mode),'terrain hit chooses the M1 rope owner, not linear pull');
  assert.ok(anchor.L>1.25,'rope has a finite measured length');
  await p.keyboard.down('d');
  const positions=[];
  for(let i=0;i<38;i++){
    await tick(p);
    positions.push(await run("({x:state.player.x,y:state.player.y,vx:state.player.vx,vy:state.player.vy,mode:state.grapple.mode,d:Math.hypot(state.player.x-state.grapple.anchor.x,state.player.y-state.grapple.anchor.y),L:state.grapple.rope_length,penetrating:state.rects.some(r=>penetrates(aabb(state.player),aabb(r)))})"));
  }
  await p.keyboard.up('d');
  assert.ok(positions.every(x=>x.mode!=='stuck'),'wall contacts cannot turn a fixed rope into STUCK');
  assert.ok(positions.every(x=>!x.penetrating),'wall motion never penetrates blocking geometry');
  assert.ok(Math.max(...positions.map(x=>x.d-x.L))<0.15,'rope length stays bounded after collision-aware correction');
  assert.ok(Math.abs(positions.at(-1).y-positions[0].y)>0.2,'character travels along the wall instead of freezing in place');
  await p.mouse.up({button:'right'});await tick(p);
  const released=await run("({mode:state.grapple.mode,carry:state.player.grapple_inertia,vx:state.player.vx,vy:state.player.vy,slideJump:state.player.slide_jump})");
  assert.equal(released.mode,'none','right mouse release detaches the rope');
  assert.equal(released.carry,true,'midair detach passes momentum to airborne motion');
  assert.ok(Math.hypot(released.vx,released.vy)>0.1,'release retains nonzero tangential velocity');
  assert.equal(released.slideJump,null,'rope handoff must not resurrect earlier slide-jump state');
  results.metrics.m1Rope={anchorTicks:travel,ropeLength:anchor.L,maxStretch:Math.max(...positions.map(x=>x.d-x.L)),
    yTravel:positions.at(-1).y-positions[0].y,releaseVelocity:{x:released.vx,y:released.vy},wallPenetration:false};
});

test('M1 priority: slide-jump to air Dash to terrain grapple clears old owners, respawn drops carry',async t=>{
  const {p,run}=await openGame(t);
  await run("location.hash='#m1-swing';state.enemies=[];state.projectiles=[];keyRaw.clear();mx=1279;my=360");
  await p.keyboard.down('d');await p.keyboard.down('s');await tick(p);
  const slid=await run("({slide:!!state.player.slide,vx:state.player.vx})");
  assert.ok(slid.slide,'the combined experiment can start the production slide');
  await p.keyboard.down('Space');await tick(p);await p.keyboard.up('Space');
  const jumped=await run("({carry:!!state.player.slide_jump,vx:state.player.vx})");
  assert.ok(jumped.carry,'slide-jump remains available behind the unified M1 flag');
  assert.ok(jumped.vx>0,'sliding momentum is inherited');
  await p.keyboard.up('d');await tick(p);
  await p.keyboard.down('Space');await tick(p);await p.keyboard.up('Space');
  const dash=await run("({dash:!!state.player.dash,slideJump:state.player.slide_jump})");
  assert.equal(dash.dash,true,'air Dash takes over');
  assert.equal(dash.slideJump,null,'air Dash discards the older slide-jump owner');
  await run("state.rects=[{id:'M1_HOOK_WALL',type:'Wall',x:12,y:-20,w:1,h:40}];"+
    "Object.assign(state.player,{x:10,y:-20,vx:6,vy:-2,grounded:false,respawn_lock:0,dash:{dir:{x:1,y:0},left:6},slide_jump:{vx:10,dir:1,t:0}});"+
    "state.grapple={...emptyGrapple(),mode:'fly',head:{x:11.55,y:-20,w:0.3,h:0.3,vx:28,vy:0,origin:{x:11.55,y:-20}},end:false};"+
    "updateGrapple()");
  const hooked=await run("({mode:state.grapple.mode,dash:state.player.dash,carry:state.player.slide_jump,ropeLength:state.grapple.rope_length})");
  assert.ok(['rope_slack','rope_taut'].includes(hooked.mode),'terrain hook is captured as rope');
  assert.equal(hooked.dash,null,'rope takeover ends Dash');
  assert.equal(hooked.carry,null,'rope takeover ends slide-jump even after Dash');
  assert.ok(hooked.ropeLength>=1.25);
  await run("state.player.vx=4;state.player.vy=3;state.player.grounded=false;endGrapple('release');cleanup();");
  const detached=await run("({carry:state.player.grapple_inertia,mode:state.grapple.mode,vx:state.player.vx,vy:state.player.vy})");
  assert.equal(detached.carry,true,'rope handoff leaves an airborne momentum owner');
  assert.equal(detached.mode,'none');
  assert.equal(detached.vx,4);
  await run("respawn()");
  const reset=await run("({carry:state.player.grapple_inertia,slideJump:state.player.slide_jump,dash:state.player.dash,rope:state.grapple.mode,vx:state.player.vx,vy:state.player.vy})");
  assert.deepEqual(reset,{carry:false,slideJump:null,dash:null,rope:'none',vx:0,vy:0},
    'respawn clears every airborne movement owner');
  await run("location.hash='';Object.assign(state.player,{vx:9,vy:8,grounded:false,respawn_lock:0});state.grapple={...emptyGrapple(),mode:'pull',end:false};endGrapple('release');");
  const baseline=await run("({vx:state.player.vx,vy:state.player.vy,carry:state.player.grapple_inertia})");
  assert.deepEqual(baseline,{vx:0,vy:0,carry:false},'default hash preserves old frozen momentum behavior');
  results.metrics.m1Owners={slideJump:true,airDash:true,ropeTakeover:true,respawnClearsAll:true,defaultUnchanged:true};
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
