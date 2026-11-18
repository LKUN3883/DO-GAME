// Real Chromium key/mouse events against production game.js; isolated room fixtures.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
let browser,server,base;
const metrics={build:process.env.GITHUB_SHA||process.env.GAME_FEEL_BUILD||'local',scenarios:[]};
const fixture={player_spawn:{x:50,y:-23.999,facing:1},rects:[{id:'FLOOR',type:'Solid',x:50,y:-26,w:100,h:2}],enemies:[],boss:{id:'BOSS',x:300,y:-20,w:3,h:4}};
before(async()=>{
  server=http.createServer((req,res)=>{
    if(req.url==='/')return res.end('<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#222}canvas{background:#111}</style><canvas id="game" width="1280" height="720"></canvas><script type="module" src="game.js"></script>');
    if(req.url==='/level_train_v1.json'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(fixture));}
    if(req.url==='/game.js'){
      res.setHeader('content-type','application/javascript');
      return res.end(fs.readFileSync(path.join(__dirname,'../docs/game.js'),'utf8')+'\nwindow.__jumpTest={run:code=>eval(code)};const originalJumpTick=updateLogic;updateLogic=()=>{window.__jumpTicks=(window.__jumpTicks||0)+1;originalJumpTick();};');
    }
    res.writeHead(404);res.end();
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
});
after(async()=>{
  fs.mkdirSync('test-artifacts',{recursive:true});fs.writeFileSync('test-artifacts/m1-jumps.json',JSON.stringify(metrics,null,2));
  await browser?.close();await new Promise(r=>server?server.close(r):r());
});
async function tick(p,n=1){for(let k=0;k<n;k++){
  const before=await p.evaluate(()=>window.__jumpTicks||0);let advanced=false;
  for(let i=0;i<100;i++){await p.clock.runFor(1);const now=await p.evaluate(()=>window.__jumpTicks||0);if(now>before){assert.equal(now-before,1);advanced=true;break;}}
  assert.ok(advanced,'one production tick advances');
}}
async function game(t,hash='#m1-jumps'){
  const p=await browser.newPage({viewport:{width:1280,height:720}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
  t.after(async()=>{await p.close();assert.deepEqual(errors,[]);});
  await p.clock.install({time:new Date('2026-11-17T00:00:00Z')});await p.clock.pauseAt(new Date('2026-11-17T00:00:10Z'));
  await p.goto(base+'/'+hash);await p.waitForFunction(()=>window.__jumpTest?.run('state!==null'));
  const run=src=>p.evaluate(src=>window.__jumpTest.run(src),src);
  await tick(p,2);return {p,run};
}
async function shot(p,run,name){await run('render()');fs.mkdirSync('test-artifacts',{recursive:true});await p.locator('#game').screenshot({path:'test-artifacts/'+name+'.png'});}
test('browser M1 jumps: ground -> free second jump -> Shift Dash, no third jump',async t=>{
  const {p,run}=await game(t);await run('state.player.st=0');
  await p.keyboard.down('Space');await tick(p);await p.keyboard.up('Space');await tick(p,5);
  const first=await run('({y:state.player.y,vy:state.player.vy,air:state.player.jump_extension.air_available})');
  await p.keyboard.down('Space');await tick(p);await p.keyboard.up('Space');
  const second=await run('({y:state.player.y,vy:state.player.vy,air:state.player.jump_extension.air_available,dash:state.player.dash})');
  assert.equal(first.air,true);assert.equal(second.air,false);assert.ok(second.vy>first.vy);assert.equal(second.dash,null);
  await shot(p,run,'m1-double-jump');await tick(p);
  const vy=await run('state.player.vy');await p.keyboard.down('Space');await tick(p);await p.keyboard.up('Space');
  assert.ok((await run('state.player.vy'))<vy);await run('state.player.st=100');
  await p.keyboard.down('Shift');await tick(p);await p.keyboard.up('Shift');
  assert.ok(await run('!!state.player.dash'));assert.equal(await run('state.player.jump_extension.carry'),false);assert.equal(await run('state.player.jump_extension.air_available'),false);
  await tick(p,10);assert.equal(await run('state.player.dash'),null);assert.equal(await run('state.player.jump_extension.carry'),false);
  metrics.scenarios.push({case:'double-then-dash',first,second,noThird:true,dashDoesNotRefill:true});
});
for(const dir of [-1,1])test('browser M1 jumps: real movement into wall, then kick away '+dir,async t=>{
  const {p,run}=await game(t);
  await run("state.rects=[{id:'WALL',type:'Wall',x:"+(50+dir*1.6)+",y:-15,w:1,h:30}];Object.assign(state.player,{x:50,y:-12,vx:0,vy:0,grounded:false});");
  const key=dir===1?'d':'a';await p.keyboard.down(key);await tick(p,6);
  const contact=await run('({x:state.player.x,vx:state.player.vx,y:state.player.y})');assert.equal(contact.vx,0);
  await p.keyboard.down('Space');await tick(p);await p.keyboard.up('Space');
  const kicked=await run('({x:state.player.x,vx:state.player.vx,vy:state.player.vy,wall:state.player.jump_extension.walls,air:state.player.jump_extension.air_available,penetrating:blockers().some(r=>penetrates(aabb(state.player),aabb(r)))})');
  assert.equal(kicked.vx,-dir*10);assert.ok(kicked.vy>0);assert.ok(dir*(kicked.x-contact.x)<0);assert.equal(kicked.penetrating,false);assert.equal(kicked.air,true);
  await shot(p,run,'m1-wall-jump-'+(dir===1?'right':'left'));await p.keyboard.up(key);await tick(p,2);
  await p.keyboard.down('Space');await tick(p);await p.keyboard.up('Space');
  assert.equal(await run('state.player.jump_extension.air_available'),false,'wall jump can chain into the free second jump');
  metrics.scenarios.push({case:'wall-kick',direction:dir,contact,kicked});
});
test('browser M1 jumps: combined W/Space hold and blur do not produce phantom air jumps',async t=>{
  const {p,run}=await game(t);await p.keyboard.down('Space');await tick(p);await p.keyboard.down('w');await tick(p);
  assert.equal(await run('state.player.jump_extension.air_available'),true);
  await p.keyboard.up('Space');await tick(p);assert.equal(await run('state.player.jump_extension.air_available'),true);
  await p.keyboard.up('w');await tick(p);await p.keyboard.down('w');await tick(p);
  assert.equal(await run('state.player.jump_extension.air_available'),false);
  await p.evaluate(()=>window.dispatchEvent(new Event('blur')));await tick(p);
  assert.equal(await run('keyRaw.size'),0);assert.equal(await run('input.Jump.down'),false);assert.equal(await run('state.player.jump_extension.air_available'),false);
  metrics.scenarios.push({case:'aliases-and-blur',noPhantomJump:true});
});
test('browser M1 jumps: real U rope attachment takes over jump carry, then detach does not refill jumps',async t=>{
  const {p,run}=await game(t);
  await run("state.rects=[{id:'ANCHOR',type:'Wall',x:55,y:-15,w:1,h:35}];Object.assign(state.player,{x:50,y:-20,vx:0,vy:0,grounded:false});state.cam={x:50,y:-20};mx=1279;my=360");
  await p.keyboard.down('Space');await tick(p);await p.keyboard.up('Space');await tick(p);
  assert.equal(await run('state.player.jump_extension.air_available'),false);
  await run('state.cam={x:state.player.x,y:state.player.y};mx=1279;my=360');
  await p.keyboard.down('u');let n=0;
  while(!(await run("['rope_slack','rope_taut'].includes(state.grapple.mode)"))&&n++<25)await tick(p);
  assert.ok(n<25,'real U hook reaches the wall');assert.equal(await run('state.player.jump_extension.carry'),false);
  await p.keyboard.up('u');await tick(p);assert.equal(await run('state.grapple.mode'),'none');
  assert.equal(await run('state.player.jump_extension.air_available'),false);
  await run('respawn()');assert.equal(await run('state.player.jump_extension'),null);
  metrics.scenarios.push({case:'jump-rope-detach-respawn',hookTicks:n,carryCleared:true,noRefill:true});
});

test('browser M1 buffer: Space before landing triggers ground jump, not an early double jump',async t=>{
  const {p,run}=await game(t,'#m1-buffer');
  await run("Object.assign(state.player,{x:50,y:-23.65,vx:6,vy:-6,grounded:false,dash:null,slide:null,slide_jump:null,jump_ascend:false,grapple_inertia:false,respawn_lock:0})");
  await p.keyboard.down('Space');await tick(p);await p.keyboard.up('Space');
  const early=await run('({buffer:state.player.input_buffer.jump,vy:state.player.vy,air:state.player.jump_extension.air_available})');
  assert.ok(early.buffer>0 && early.vy<0 && early.air,'first keyboard event is stored, not spent as double jump');
  let ticks=0;
  while((await run('state.player.vy'))<=0 && ticks++<9)await tick(p);
  const launched=await run('({vy:state.player.vy,buffer:state.player.input_buffer.jump,air:state.player.jump_extension.air_available,vx:state.player.vx})');
  assert.ok(ticks<9 && launched.vy>0,'buffer fires after landing without another keydown');
  assert.equal(launched.buffer,0);assert.equal(launched.air,true);
  await shot(p,run,'m1-buffered-ground-jump');
  metrics.scenarios.push({case:'buffered-ground-jump',early,launched,ticks});
});
test('browser M1 buffer: Shift while airborne Dash is spent becomes a slide on landing',async t=>{
  const {p,run}=await game(t,'#m1-buffer');
  await run("Object.assign(state.player,{x:50,y:-23.65,vx:5,vy:-6,grounded:false,dash_used:true,dash:null,slide:null,slide_jump:null,jump_ascend:false,respawn_lock:0})");
  await p.keyboard.down('d');await p.keyboard.down('Shift');await tick(p);await p.keyboard.up('Shift');
  const early=await run('({buffer:state.player.input_buffer.slide,dash:state.player.dash})');
  assert.ok(early.buffer>0);assert.equal(early.dash,null);
  let ticks=0;while(!(await run('!!state.player.slide')) && ticks++<9)await tick(p);
  assert.ok(ticks<9,'slide starts from prior Shift key event');
  const slid=await run('({dir:state.player.slide.dir,vx:state.player.vx,buffer:state.player.input_buffer.slide})');
  assert.equal(slid.dir,1);assert.equal(slid.buffer,0);
  await shot(p,run,'m1-buffered-landing-slide');await p.keyboard.up('d');
  metrics.scenarios.push({case:'buffered-slide',early,slid,ticks});
});
test('browser M1 buffer: Alt+Tab blur discards queued actions before touchdown',async t=>{
  const {p,run}=await game(t,'#m1-buffer');
  await run("Object.assign(state.player,{x:50,y:-23.65,vx:0,vy:-6,grounded:false,dash:null,slide:null,jump_ascend:false,respawn_lock:0})");
  await p.keyboard.down('Space');await tick(p);await p.keyboard.up('Space');
  assert.ok((await run('state.player.input_buffer.jump'))>0);
  await p.evaluate(()=>window.dispatchEvent(new Event('blur')));
  assert.equal(await run('state.player.input_buffer.jump'),0);
  await tick(p,10);
  const after=await run('({grounded:state.player.grounded,vy:state.player.vy,air:state.player.jump_extension.air_available,buffer:state.player.input_buffer.jump})');
  assert.equal(after.grounded,true);assert.equal(after.vy,0);assert.equal(after.air,true);assert.equal(after.buffer,0);
  metrics.scenarios.push({case:'blur-queued-jump',after,noPhantomAction:true});
});

test('browser M1 timing: Shift slide lasts 18 ticks with low posture, then glides out',async t=>{
  const {p,run}=await game(t,'#m1-timing');
  await p.keyboard.down('d');await p.keyboard.down('Shift');await tick(p);await p.keyboard.up('Shift');
  const slide=await run('({h:state.player.h,frames:state.player.slide.frames,vx:state.player.vx,iframe:state.player.iframe})');
  assert.equal(slide.h,1.2);assert.equal(slide.frames,1);
  assert.ok(slide.vx>=9.9 && slide.iframe>=0.099);
  await shot(p,run,'m1-timed-slide');
  await tick(p,16);
  assert.equal(await run('state.player.slide.frames'),17);
  await tick(p);
  const exit=await run('({slide:state.player.slide,vx:state.player.vx,h:state.player.h})');
  assert.equal(exit.slide,null);assert.equal(exit.h,2);assert.ok(exit.vx>=7.9);
  await p.keyboard.up('d');
  await tick(p);
  const friction=await run('state.player.vx');
  assert.ok(friction>0 && friction<exit.vx,'slide exit coasts rather than snapping to zero');
  metrics.scenarios.push({case:'short-slide-18-ticks',slide,exit,friction});
});
test('browser M1 timing: independent Shift Dash ends at 9 ticks with velocity carry',async t=>{
  const {p,run}=await game(t,'#m1-timing');
  await run("state.rects=[];state.enemies=[];Object.assign(state.player,{x:50,y:-15,vx:0,vy:0,grounded:false,dash:null,jump_ascend:false,st:100});state.cam={x:50,y:-15};mx=1279;my=360");
  await p.keyboard.down('Shift');await tick(p);await p.keyboard.up('Shift');
  assert.ok(await run('!!state.player.dash'));
  await tick(p,7);assert.ok(await run('!!state.player.dash'));
  await tick(p);
  const exit=await run('({dash:state.player.dash,vx:state.player.vx,carry:state.player.jump_extension.carry})');
  assert.equal(exit.dash,null);assert.ok(exit.vx>=7.5 && exit.vx<=8.01);assert.equal(exit.carry,true);
  await shot(p,run,'m1-timed-dash-exit');
  metrics.scenarios.push({case:'air-dash-nine-ticks',exit});
});
test('browser M1 timing: thin wall stops Dash without penetration; air steering escapes',async t=>{
  const {p,run}=await game(t,'#m1-timing');
  await run("state.rects=[{id:'THIN_WALL',type:'Wall',x:52,y:-15,w:0.05,h:10}];state.enemies=[];Object.assign(state.player,{x:50,y:-15,vx:0,vy:0,grounded:false,dash:null,jump_ascend:false,st:100});state.cam={x:50,y:-15};mx=1279;my=360");
  await p.keyboard.down('Shift');await tick(p);await p.keyboard.up('Shift');
  let n=0;while((await run('!!state.player.dash')) && n++<12)await tick(p);
  const stopped=await run('({x:state.player.x,dash:state.player.dash,penetrates:blockers().some(r=>penetrates(aabb(state.player),aabb(r)))})');
  assert.ok(n<12);assert.equal(stopped.dash,null);assert.ok(stopped.x<51.5);assert.equal(stopped.penetrates,false);
  await p.keyboard.down('a');await tick(p,3);await p.keyboard.up('a');
  const escaped=await run('({x:state.player.x,penetrates:blockers().some(r=>penetrates(aabb(state.player),aabb(r)))})');
  assert.ok(escaped.x<stopped.x);assert.equal(escaped.penetrates,false);
  await shot(p,run,'m1-thin-wall-dash-stop');
  metrics.scenarios.push({case:'thin-wall-dash',stopped,escaped});
});

test('browser M1 geometry: moving between adjoining wall segments cannot refresh wall kick',async t=>{
  const {p,run}=await game(t,'#m1-geometry');
  await run("state.rects=[{id:'UPPER',type:'Wall',x:51.001,y:-12.5,w:1,h:5},{id:'LOWER',type:'Wall',x:51.001,y:-17.5,w:1,h:5}];Object.assign(state.player,{x:50,y:-12,vx:0,vy:-1,grounded:false,jump_ascend:false,respawn_lock:0});state.player.jump_extension.air_available=false");
  await p.keyboard.down('Space');await tick(p);await p.keyboard.up('Space');await tick(p);
  const first=await run("({walls:[...state.player.jump_extension.walls],last:state.player.jump_extension.last})");
  assert.equal(first.last,'wall');assert.equal(first.walls.length,1);
  await run("Object.assign(state.player,{x:50,y:-18,vx:0,vy:-1,grounded:false,jump_ascend:false})");
  await p.keyboard.down('Space');await tick(p);await p.keyboard.up('Space');
  const repeat=await run("({walls:[...state.player.jump_extension.walls],vy:state.player.vy})");
  assert.deepEqual(repeat.walls,first.walls);
  assert.ok(repeat.vy<0,'second segment of the same face cannot grant another kick');
  await shot(p,run,'m1-connected-wall-jump-limit');
  metrics.scenarios.push({case:'connected-wall-single-kick',first,repeat});
});
