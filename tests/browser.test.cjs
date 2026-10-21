// Requires: npm install --no-save playwright; npx playwright install chromium
// Optional: CHROMIUM_EXECUTABLE_PATH=/path/to/chromium
const {test, before, after}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
let browser,server,base;
before(async()=>{
  const root=path.join(__dirname,'../docs');
  server=http.createServer((req,res)=>{
    const name=req.url==='/'?'index.html':req.url.slice(1);
    if(!['index.html','game.js','level_train_v1.json'].includes(name)){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':'text/html');
    let body=fs.readFileSync(path.join(root,name),'utf8');
    // Test-only access appended to the served module; production source, DOM,
    // input listeners, fetch, Canvas and RAF loop all run unchanged in Chromium.
    if(name==='game.js') body+='\nwindow.__test={run:code=>eval(code)};';
    res.end(body);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
});
after(async()=>{await browser?.close();await new Promise(r=>server?server.close(r):r());});
async function game(t){
  const p=await browser.newPage({viewport:{width:1280,height:800}});t.after(()=>p.close());
  const errors=[];p.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
  await p.clock.install({time:new Date('2026-10-21T00:00:00Z')});
  // Pause before loading: only advance() may run RAF ticks, not host delays
  // between separate keyboard/mouse/state inspection calls.
  await p.clock.pauseAt(new Date('2026-10-21T00:00:10Z'));
  await p.goto(base);await p.waitForFunction(()=>window.__test?.run('state!==null'));
  const run=code=>p.evaluate(code=>window.__test.run(code),code);
  await p.clock.runFor(1000);return {p,run,advance:ms=>p.clock.runFor(ms)};
}

test('browser: real A/D key events stop on release, A+D cancel, blur clears input',async t=>{
  const {p,run,advance}=await game(t);const x=await run('state.player.x');
  await p.keyboard.down('d');await advance(500);let moved=await run('state.player.x');assert.ok(moved>x+3.7 && moved<x+4.3);
  await p.keyboard.up('d');await advance(100);const stop=await run('state.player.x');await advance(400);assert.equal(await run('state.player.x'),stop);
  await p.keyboard.down('a');await advance(250);assert.ok(await run('state.player.x')<stop-1.7);
  await p.keyboard.down('d');const both=await run('state.player.x');await advance(200);assert.equal(await run('state.player.x'),both);
  await p.keyboard.up('a');await p.keyboard.up('d');await p.keyboard.down('d');await advance(50);
  await p.evaluate(()=>window.dispatchEvent(new Event('blur')));await advance(50);const blurred=await run('state.player.x');await advance(200);assert.equal(await run('state.player.x'),blurred);
});

test('browser: ordinary jump, hold, second-press air dash and landing',async t=>{
  const {p,run,advance}=await game(t);const y=await run('state.player.y');
  await p.keyboard.down('Space');await advance(200);assert.ok(await run('state.player.y')>y+6);assert.equal(await run('state.player.dash_used'),false);
  await p.keyboard.up('Space');await advance(20);
  await run('state.cam.x=state.player.x;state.cam.y=state.player.y');await p.mouse.move(1100,360);
  const x=await run('state.player.x'),st=await run('state.player.st');await p.keyboard.down('Space');await advance(140);
  assert.ok(Math.abs(await run('state.player.x')-x-6)<0.15);assert.ok(await run('state.player.st')<st-27);assert.equal(await run('state.player.dash'),null);
  await p.keyboard.up('Space');await advance(1600);assert.equal(await run('state.player.grounded'),true);
  assert.equal(await run('state.player.dash_used'),false);
});

test('browser: active Boss takes one 80 damage hit per swing, no knockback',async t=>{
  const {p,run,advance}=await game(t);
  await run("state.enemies=[];Object.assign(state.player,{x:298,y:-23.999,vx:0,vy:0});Object.assign(state.boss,{active:true,x:300,y:-23.699,phase:'idleA',phase_t:100});state.cam={x:298,y:-23.999}");
  await p.mouse.move(1100,360);await p.keyboard.down('f');await advance(100);assert.equal(await run('state.boss.hp'),340);
  await advance(400);assert.equal(await run('state.boss.hp'),340);assert.equal(await run('state.boss.x'),300);
  await p.keyboard.up('f');await advance(600);await p.keyboard.down('f');await advance(50);assert.equal(await run('state.boss.hp'),260);
});

test('browser: OneWay ascent/landing/drop and diagonal dash wall contact',async t=>{
  const {p,run,advance}=await game(t);
  await run('state.enemies=[];Object.assign(state.player,{x:40,y:-16,vy:53.334,jump_ascend:true,jump_t:0})');
  await advance(100);assert.ok(await run('state.player.y')>-15);
  await advance(1000);assert.equal(await run('state.player.standing_oneway_id'),'OneA');
  await p.keyboard.down('s');await p.keyboard.down('Space');await advance(100);assert.equal(await run('state.player.jump_ascend'),false);
  await advance(300);assert.ok(await run('state.player.y')<-14);
  await p.keyboard.up('s');await p.keyboard.up('Space');
  await run("Object.assign(state.player,{x:6,y:-18,grounded:false,dash_used:true,dash:{dir:{x:Math.SQRT1_2,y:Math.SQRT1_2},left:6}});state.rects.push({id:'TEST_WALL',type:'Wall',x:7.2,y:-15,w:1,h:20})");
  await advance(20);assert.equal(await run('state.player.dash'),null);assert.equal(await run('state.player.vx'),0);assert.ok(await run('state.player.vy')<=0 && await run('state.player.vy')>=-3,'dash ended; at most one following gravity tick may have run');
});

test('browser: firing into blocked spawn refunds ammo; releasing outside canvas stops shooting',async t=>{
  const {p,run,advance}=await game(t);await run("state.enemies=[];state.rects.push({id:'blocked',type:'OneWay',x:6,y:state.player.y,w:10,h:10})");
  await p.mouse.move(800,360);await p.mouse.down();await advance(200);assert.equal(await run('state.player.ammo'),60);
  await p.mouse.up();await run("state.rects=state.rects.filter(r=>r.id!=='blocked')");
  await p.mouse.move(800,360);await p.mouse.down();await advance(100);assert.ok(await run('state.player.ammo')<60);
  await p.mouse.move(800,770);await p.mouse.up();await advance(100);const ammo=await run('state.player.ammo');await advance(500);assert.equal(await run('state.player.ammo'),ammo);
});

test('browser: boss trigger keeps the grounded player and Boss visible',async t=>{
  const {p,run,advance}=await game(t);
  await run('state.enemies=[];state.player.x=275;state.player.y=-23.999;state.player.hp=100');
  await p.keyboard.down('d');await advance(300);await p.keyboard.up('d');await advance(300);
  assert.equal(await run('state.boss.active'),true);
  const scene=await run('({cam:state.cam,player:state.player,boss:state.boss})');
  const bottom=scene.cam.y-9;
  t.diagnostic(JSON.stringify({cameraBottom:bottom,playerTop:scene.player.y+scene.player.h/2,bossTop:scene.boss.y+scene.boss.h/2,playerVisible:scene.player.y+scene.player.h/2>=bottom,bossVisible:scene.boss.y+scene.boss.h/2>=bottom}));
  if(process.env.BROWSER_SCREENSHOT) await p.screenshot({path:process.env.BROWSER_SCREENSHOT});
  assert.equal(scene.cam.y,-21,'Boss camera uses the approved lower bound');
  for(const body of [scene.player,scene.boss]) {
    assert.ok(body.y-body.h/2>=bottom && body.y+body.h/2<=scene.cam.y+9,'entire grounded combatant must be vertically visible');
    assert.ok(body.x-body.w/2>=scene.cam.x-16 && body.x+body.w/2<=scene.cam.x+16,'entire combatant must be horizontally visible in this scene');
  }
});

test('browser: right mouse launches and pulls grapple, then release cancels it',async t=>{
  const {p,run,advance}=await game(t);
  await run("state.enemies=[];state.rects.push({id:'GRAPPLE_WALL',type:'Wall',x:14,y:-21,w:1,h:8});state.cam.x=state.player.x;state.cam.y=state.player.y");
  await p.mouse.move(1100,360);const start=await run('state.player.x');
  await p.mouse.down({button:'right'});await advance(900);assert.ok(await run('state.player.x')>start+1);
  await p.mouse.up({button:'right'});await advance(30);assert.equal(await run('state.grapple.mode'),'none');
});
