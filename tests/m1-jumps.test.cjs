// Production-game VM tests. Fixtures isolate geometry; no physics functions are replaced.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
async function game(hash='#m1-jumps') {
  const listeners={};
  const on=(type,fn)=>(listeners[type]??=[]).push(fn);
  const level={player_spawn:{x:50,y:-23.999,facing:1},rects:[{id:'FLOOR',type:'Solid',x:50,y:-26,w:100,h:2}],enemies:[],boss:{id:'BOSS',x:300,y:-20,w:3,h:4}};
  const ctx=new Proxy({}, {get:(t,k)=>t[k]??(()=>{}),set:(t,k,v)=>(t[k]=v,true)});
  const canvas={width:1280,height:720,getContext:()=>ctx,addEventListener:on,getBoundingClientRect:()=>({left:0,top:0,width:1280,height:720})};
  const sandbox={console,window:{addEventListener:on},document:{getElementById:()=>canvas,addEventListener:on,hidden:false},location:{hash},performance:{now:()=>0},requestAnimationFrame:()=>{},fetch:async()=>({json:async()=>structuredClone(level)})};
  vm.createContext(sandbox);
  const code=fs.readFileSync(path.join(__dirname,'../docs/game.js'),'utf8');
  vm.runInContext(code,sandbox,{filename:'docs/game.js'});
  await new Promise(r=>setImmediate(r));
  const run=src=>vm.runInContext(src,sandbox);
  const plain=src=>JSON.parse(JSON.stringify(run(src)));
  const event=(type,data={})=>{for(const f of listeners[type]||[])f({preventDefault(){},...data});};
  const down=code=>event('keydown',{code});
  const up=code=>event('keyup',{code});
  const tick=(n=1)=>{for(let i=0;i<n;i++)run('updateLogic()');};
  const tap=code=>{down(code);tick();up(code);};
  tick(2);
  return {run,plain,event,down,up,tick,tap};
}
function air(h,fields='') {
  h.run("state.rects=[];state.enemies=[];state.projectiles=[];Object.assign(state.player,{x:50,y:-15,vx:0,vy:-1,grounded:false,slide:null,slide_jump:null,dash:null,jump_ascend:false,respawn_lock:0"+(fields?','+fields:'')+"});");
}
function wall(h,dir=1,id='WALL',type='Wall',extra='') {
  h.run("state.rects=[{id:"+JSON.stringify(id)+",type:"+JSON.stringify(type)+",x:"+(50+dir*1.001)+",y:-15,w:1,h:20"+(extra?','+extra:'')+"}];Object.assign(state.player,{x:50,y:-15,vx:0,vy:-1,w:1,h:2,grounded:false,dash:null,jump_ascend:false});");
}

test('M1 jumps: one free second jump, no third or auto-repeat jump',async()=>{
  const h=await game(); h.run('state.player.st=0');
  h.tap('Space'); assert.equal(h.run('state.player.jump_extension.air_available'),true);
  h.tick(5); const before=h.run('state.player.vy');h.tap('Space');
  assert.ok(h.run('state.player.vy')>before);assert.equal(h.run('state.player.jump_extension.air_available'),false);
  assert.equal(h.run('state.player.dash'),null);assert.equal(h.run('state.player.dash_used'),false);
  assert.ok(h.run('state.player.st')>=0,'jump is possible at zero stamina');
  h.tick(2);const last=h.run('state.player.vy');h.down('Space');h.tick();
  assert.ok(h.run('state.player.vy')<last,'third press cannot boost vertically');
  for(let i=0;i<4;i++){const vy=h.run('state.player.vy');h.down('Space');h.tick();assert.ok(h.run('state.player.vy')<vy);}
});
test('M1 jumps: walking off a ledge leaves exactly one air jump',async()=>{
  const h=await game();air(h);h.tap('Space');
  assert.equal(h.run('state.player.jump_extension.last'),'double');h.tick();const vy=h.run('state.player.vy');h.tap('Space');
  assert.ok(h.run('state.player.vy')<vy);assert.equal(h.run('state.player.jump_extension.air_available'),false);
});
test('M1 jumps: Dash does not consume jump; jump can take over active Dash without refunding Dash',async()=>{
  const h=await game();air(h);h.tap('ShiftLeft');
  assert.ok(h.run('!!state.player.dash'));assert.equal(h.run('state.player.jump_extension.air_available'),true);
  h.tick();h.tap('Space');
  assert.equal(h.run('state.player.dash'),null);assert.equal(h.run('state.player.dash_used'),true);
  assert.equal(h.run('state.player.jump_extension.air_available'),false);assert.ok(h.run('state.player.vy')>0);
  h.tick();h.tap('ShiftLeft');assert.equal(h.run('state.player.dash'),null,'used Dash is not restored');
});
test('M1 jumps: simultaneous Space and Shift performs only the available jump',async()=>{
  const h=await game();air(h);h.run('state.player.st=100');h.down('Space');h.down('ShiftLeft');h.tick();
  assert.equal(h.run('state.player.dash'),null);assert.equal(h.run('state.player.dash_used'),false);
  assert.equal(h.run('state.player.st'),100);assert.equal(h.run('state.player.jump_extension.last'),'double');
});
test('M1 jumps: Dash takes over jump carry without resurrecting it on exit',async()=>{
  const h=await game();air(h);h.tap('Space');h.tick();assert.equal(h.run('state.player.jump_extension.carry'),true);
  h.tap('ShiftLeft');assert.equal(h.run('state.player.jump_extension.carry'),false);assert.equal(h.run('state.player.jump_ascend'),false);
  h.tick(9);assert.equal(h.run('state.player.dash'),null);assert.equal(h.run('state.player.jump_extension.carry'),false);
  assert.equal(h.run('state.player.jump_extension.air_available'),false);
});
for(const dir of [-1,1])test('M1 jumps: wall kick mirrors away from wall '+dir,async()=>{
  const h=await game();wall(h,dir);h.down(dir===1?'KeyD':'KeyA');h.tap('Space');
  assert.equal(h.run('state.player.vx'),-dir*10,'first kick tick is not overwritten by ordinary movement');
  assert.ok(h.run('state.player.vy')>0);assert.equal(h.run('state.player.jump_extension.last'),'wall');
  assert.equal(h.run('state.player.jump_extension.air_available'),true,'wall jump has its own allowance');
  assert.equal(h.run('state.player.jump_extension.walls.length'),1);assert.equal(h.run('blockers().some(r=>penetrates(aabb(state.player),aabb(r)))'),false);
  const x=h.run('state.player.x');h.tick();assert.ok(dir*(h.run('state.player.x')-x)<0,'next tick still initially moves away');
});
test('M1 jumps: same wall once per flight; different wall permitted; wall does not refill double jump',async()=>{
  const h=await game();air(h);h.tap('Space');h.tick();wall(h,1,'RIGHT');h.tap('Space');
  assert.equal(h.run('state.player.jump_extension.air_available'),false);h.tick();wall(h,1,'RIGHT');h.tap('Space');
  assert.ok(h.run('state.player.vy')<=0,'same wall and spent double jump cannot relaunch');
  h.tick();wall(h,-1,'LEFT');h.tap('Space');assert.equal(h.run('state.player.jump_extension.walls.length'),2);
  assert.ok(h.run('state.player.vy')>0);assert.equal(h.run('state.player.jump_extension.air_available'),false);
});
test('M1 jumps: held wall-jump input cannot trigger again or spend the extra jump',async()=>{
  const h=await game();wall(h);h.down('Space');h.tick();
  for(let i=0;i<3;i++){wall(h);h.down('Space');h.tick();assert.ok(h.run('state.player.vy')<=0);}
  assert.equal(h.run('state.player.jump_extension.air_available'),true);assert.equal(h.run('state.player.jump_extension.walls.length'),1);
});
for(const [kind,props,allowed] of [['Solid','',true],['Door','locked:true',true],['Door','locked:false',false],['OneWay','',false]])test('M1 wall eligibility: '+kind+' '+props,async()=>{
  const h=await game();h.run('state.player.jump_extension.air_available=false');wall(h,1,'CONTACT',kind,props);h.tap('Space');
  assert.equal(h.run('state.player.jump_extension.last')==='wall',allowed);
});
test('M1 jumps: floors, ceilings, far walls and tiny corner overlap cannot create wall kicks',async()=>{
  const h=await game();h.run('state.player.jump_extension.air_available=false');
  for(const rect of [
    {id:'FAR',type:'Wall',x:51.03,y:-15,w:1,h:20},
    {id:'FLOOR',type:'Solid',x:50,y:-17.01,w:20,h:2},
    {id:'CEILING',type:'Solid',x:50,y:-12.99,w:20,h:2},
    {id:'CORNER',type:'Wall',x:51.001,y:-13.3,w:1,h:1.5}
  ]){
    air(h);h.run('state.rects='+JSON.stringify([rect]));h.tick();h.tap('Space');
    assert.notEqual(h.run('state.player.jump_extension.last'),'wall');h.tick();
  }
});
test('M1 jumps: cannot stand under low ceiling, so jump is rejected without consuming allowance',async()=>{
  const h=await game();air(h,"h:1,crouch:true");
  h.run("state.rects=[{id:'LOW',type:'Solid',x:50,y:-13.9,w:10,h:1}]");h.tap('Space');
  assert.equal(h.run('state.player.jump_extension.air_available'),true);assert.ok(h.run('state.player.vy')<=0);
});
test('M1 jumps: second jump inherits current vx, not stored slide launch vx',async()=>{
  const h=await game();air(h,"vx:-3,slide_jump:{vx:10,dir:1,t:0.3},grapple_inertia:true");h.tap('Space');
  assert.equal(h.run('state.player.vx'),-3);assert.equal(h.run('state.player.slide_jump'),null);assert.equal(h.run('state.player.grapple_inertia'),false);
  assert.equal(h.run('state.player.jump_extension.carry'),true);h.tick();assert.ok(h.run('state.player.vx')<0);
});
test('M1 jumps: attached rope owns motion; release then jump uses remaining allowance',async()=>{
  const h=await game();air(h);
  h.run("state.grapple={...emptyGrapple(),mode:'rope_taut',anchor:{x:50,y:-5},head:{x:50,y:-5},rope_length:10};keyRaw.set('KeyU',true)");
  h.tick();h.tap('Space');assert.equal(h.run('state.player.jump_extension.air_available'),true);assert.equal(h.run('state.player.jump_extension.carry'),false);
  h.tick();h.up('KeyU');h.down('Space');h.tick();
  assert.equal(h.run('state.grapple.mode'),'none');assert.equal(h.run('state.player.jump_extension.last'),'double');assert.ok(h.run('state.player.vy')>0);
});
test('M1 jumps: terrain rope hit clears jump carry but not the spent allowance',async()=>{
  const h=await game();air(h);h.tap('Space');
  h.run("state.rects=[{id:'ANCHOR',type:'Wall',x:55,y:-15,w:1,h:15}];state.grapple={...emptyGrapple(),mode:'fly',head:{x:54.4,y:-15,w:0.3,h:0.3,vx:28,vy:0,origin:{x:50,y:-15}}};updateGrapple()");
  assert.equal(h.run('state.grapple.mode'),'rope_taut');assert.equal(h.run('state.player.jump_extension.carry'),false);assert.equal(h.run('state.player.jump_extension.air_available'),false);
});
test('M1 jumps: natural landing refills jump and wall allowance, death clears extension and respects lock',async()=>{
  const h=await game();h.tap('Space');h.tick(4);h.tap('Space');
  h.run("state.player.jump_extension.walls.push('OLD:1')");
  let ticks=0;while(!h.run('state.player.grounded')&&ticks++<160)h.tick();assert.ok(ticks<160);
  assert.equal(h.run('state.player.jump_extension.air_available'),true);assert.equal(h.run('state.player.jump_extension.walls.length'),0);
  assert.equal(h.run('state.player.jump_extension.carry'),false);
  air(h);h.tap('Space');h.run('state.player.hp=0');h.tick();assert.equal(h.run('state.player.jump_extension'),null);
  h.down('Space');h.tick();assert.equal(h.run('input.Jump.just_pressed'),false,'respawn lock masks held jump');
  assert.equal(h.run('state.player.jump_extension.carry'),false);h.run('resetAll()');assert.equal(h.run('state.player.jump_extension'),null);
});
test('M1 jumps: blur releases input without adding an automatic jump or refilling it',async()=>{
  const h=await game();air(h);h.down('Space');h.tick();const vy=h.run('state.player.vy');h.event('blur');h.tick();
  assert.equal(h.run('keyRaw.size'),0);assert.equal(h.run('input.Jump.down'),false);assert.equal(h.run('state.player.jump_extension.air_available'),false);assert.ok(h.run('state.player.vy')<vy);
});
for(const hash of ['', '#m1-controls', '#m1-swing'])test('M1 jumps: older profile unchanged '+hash,async()=>{
  const h=await game(hash);h.tap('Space');h.tick(2);h.tap('Space');
  assert.equal(h.run('!!state.player.dash'),hash!=='#m1-controls');assert.equal(h.run('state.player.jump_extension'),null);
});
test('M1 jumps: identical input ticks produce identical full state',async()=>{
  const a=await game(),b=await game();
  for(let frame=0;frame<60;frame++){
    for(const h of [a,b]){if(frame===0)h.down('Space');if(frame===1)h.up('Space');if(frame===5)h.down('Space');if(frame===6)h.up('Space');if(frame===9)h.down('ShiftLeft');if(frame===10)h.up('ShiftLeft');if(frame===12)h.down('KeyD');if(frame===18)h.event('blur');h.tick();}
    assert.deepEqual(a.plain('state'),b.plain('state'));
  }
});

function m1SetNearLanding(h,vx=0,dashUsed=false) {
  h.run("Object.assign(state.player,{x:50,y:-23.65,vx:"+vx+",vy:-6,grounded:false,dash:null,slide:null,slide_jump:null,jump_ascend:false,grapple_inertia:false,respawn_lock:0,dash_used:"+dashUsed+"});");
}
test('M1 buffer: nine-tick early jump fires after touchdown without consuming double jump',async()=>{
  const h=await game('#m1-buffer');m1SetNearLanding(h,6);h.tap('Space');
  assert.ok(h.run('state.player.input_buffer.jump')>0,'landing jump intent is stored');
  assert.ok(h.run('state.player.vy')<0,'air jump was not consumed prematurely');
  assert.equal(h.run('state.player.jump_extension.air_available'),true);
  let t=0;
  while(h.run('state.player.vy')<=0 && t++<9)h.tick();
  assert.ok(t<9,'touchdown consumes the pending request within the 9-tick window');
  assert.ok(h.run('state.player.vy')>0);
  assert.equal(h.run('state.player.jump_extension.air_available'),true,'fresh air jump remains after buffered ground launch');
  assert.equal(h.run('state.player.input_buffer.jump'),0,'the buffered jump is single-use');
});
test('M1 buffer: away from any imminent ground, Space is still an immediate free double jump',async()=>{
  const h=await game('#m1-buffer');air(h);h.tap('Space');
  assert.equal(h.run('state.player.jump_extension.last'),'double');
  assert.equal(h.run('state.player.input_buffer.jump'),0);
  assert.equal(h.run('state.player.jump_extension.air_available'),false);
});
test('M1 buffer: eligible wall kick takes priority over a predicted floor landing',async()=>{
  const h=await game('#m1-buffer');m1SetNearLanding(h);
  h.run("state.rects.push({id:'BUFFER_WALL',type:'Wall',x:51.001,y:-23,w:1,h:10})");
  h.tap('Space');
  assert.equal(h.run('state.player.jump_extension.last'),'wall');
  assert.equal(h.run('state.player.input_buffer.jump'),0);
  assert.equal(h.run('state.player.vx'),-10);
});
test('M1 buffer: early jump expires if the landing surface disappears',async()=>{
  const h=await game('#m1-buffer');m1SetNearLanding(h);h.tap('Space');
  assert.ok(h.run('state.player.input_buffer.jump')>0);
  h.run('state.rects=[]');h.tick(12);
  assert.equal(h.run('state.player.input_buffer.jump'),0);
  assert.equal(h.run('state.player.jump_extension.air_available'),true);
  assert.ok(h.run('state.player.vy')<0);
});
test('M1 buffer: blur cancels early jump, preventing action on later ground contact',async()=>{
  const h=await game('#m1-buffer');m1SetNearLanding(h);h.tap('Space');
  assert.ok(h.run('state.player.input_buffer.jump')>0);
  h.event('blur');assert.equal(h.run('state.player.input_buffer.jump'),0);
  h.tick(10);
  assert.equal(h.run('state.player.grounded'),true);
  assert.equal(h.run('state.player.jump_extension.air_available'),true);
  assert.equal(h.run('state.player.vy'),0);
});
test('M1 buffer: spent-air-Dash Shift arms ground slide at touchdown',async()=>{
  const h=await game('#m1-buffer');m1SetNearLanding(h,5,true);
  h.down('KeyD');h.tap('ShiftLeft');
  assert.ok(h.run('state.player.input_buffer.slide')>0);
  assert.equal(h.run('state.player.dash'),null,'spent Dash is not reactivated');
  let ticks=0;while(!h.run('state.player.slide') && ticks++<9)h.tick();
  assert.ok(ticks<9,'the early Shift becomes a slide on landing');
  assert.ok(h.run('state.player.slide.dir')>0);
  assert.equal(h.run('state.player.input_buffer.slide'),0);
  h.up('KeyD');
});
test('M1 buffer: unspent airborne Shift stays Dash, not a queued slide',async()=>{
  const h=await game('#m1-buffer');m1SetNearLanding(h,5,false);
  h.run('state.player.st=100');h.down('KeyD');h.tap('ShiftLeft');
  assert.equal(h.run('state.player.input_buffer.slide'),0);
  assert.ok(h.run('state.player.dash'),'regular Shift air Dash still executes');
  h.up('KeyD');
});
test('M1 buffer: land steering decelerates without snapping current vx to zero',async()=>{
  const h=await game('#m1-buffer');
  h.run("Object.assign(state.player,{x:50,y:-23.999,vx:15,vy:0,grounded:true,dash:null,slide:null,slide_jump:null,grapple_inertia:false,jump_ascend:false})");
  h.tick();const v=h.run('state.player.vx');
  assert.ok(v>13 && v<15,'neutral ground friction is acceleration limited');
  h.tick();assert.ok(h.run('state.player.vx')>0 && h.run('state.player.vx')<v);
  h.down('KeyD');h.tick();assert.ok(h.run('state.player.vx')>8,'ground reverse toward running speed is gradual');
  h.up('KeyD');
});
test('M1 buffer: ending slide retains its real horizontal velocity until friction',async()=>{
  const h=await game('#m1-buffer');
  h.run('Object.assign(state.player,{vx:7,grounded:true,slide:{dir:1,frames:10,t:0.16},crouch:false});finishSlide()');
  assert.equal(h.run('state.player.vx'),7);
  assert.equal(h.run('state.player.slide'),null);
  h.tick();assert.ok(h.run('state.player.vx')>0 && h.run('state.player.vx')<7);
});
test('M1 buffer: respawn discards buffered actions and locks held jump',async()=>{
  const h=await game('#m1-buffer');m1SetNearLanding(h);h.tap('Space');
  assert.ok(h.run('state.player.input_buffer.jump')>0);
  h.run('respawn()');assert.equal(h.run('state.player.input_buffer'),null);
  h.down('Space');h.tick();assert.equal(h.run('input.Jump.just_pressed'),false);
  assert.equal(h.run('state.player.input_buffer.jump'),0);
  assert.equal(h.run('state.player.vy'),0);
  h.up('Space');
});
test('M1 buffer: 9-tick timer does not re-fire a ground jump after it is consumed',async()=>{
  const h=await game('#m1-buffer');m1SetNearLanding(h);h.tap('Space');
  for(let i=0;i<18;i++)h.tick();
  assert.equal(h.run('state.player.input_buffer.jump'),0);
  assert.equal(h.run('state.player.jump_extension.air_available'),true);
});
test('M1 buffer: repeat inputs and movement produce deterministic state each simulation frame',async()=>{
  const a=await game('#m1-buffer'),b=await game('#m1-buffer');
  m1SetNearLanding(a,6);m1SetNearLanding(b,6);
  for(let i=0;i<35;i++) {
    for(const h of [a,b]){
      if(i===0)h.down('Space');if(i===1)h.up('Space');
      if(i===4)h.down('KeyD');if(i===10)h.up('KeyD');
      if(i===13)h.down('ShiftLeft');if(i===14)h.up('ShiftLeft');
      if(i===18)h.event('blur');
      h.tick();
    }
    assert.deepEqual(a.plain('state'),b.plain('state'));
  }
});
for(const hash of ['', '#m1-jumps', '#m1-controls', '#m1-swing'])
test('M1 buffer: older hash does not acquire landing-buffer mechanics '+hash,async()=>{
  const h=await game(hash);
  m1SetNearLanding(h);
  h.tap('Space');
  assert.equal(h.run('state.player.input_buffer'),null);
  if(hash==='#m1-jumps')assert.equal(h.run('state.player.jump_extension.last'),'double');
  if(hash==='')assert.ok(h.run('state.player.dash'));
});

test('M1 buffer: later airborne Dash cancels a previously queued landing jump',async()=>{
  const h=await game('#m1-buffer');m1SetNearLanding(h);
  h.tap('Space');assert.ok(h.run('state.player.input_buffer.jump')>0);
  h.run('state.player.st=100');h.tap('ShiftLeft');
  assert.ok(h.run('state.player.dash'),'new Dash takes ownership');
  assert.equal(h.run('state.player.input_buffer.jump'),0,'old buffered jump cannot unexpectedly activate at landing');
});
test('M1 buffer: starting a new grapple cancels pending slide',async()=>{
  const h=await game('#m1-buffer');m1SetNearLanding(h,5,true);
  h.down('KeyD');h.tap('ShiftLeft');assert.ok(h.run('state.player.input_buffer.slide')>0);
  h.run('state.rects=[]');h.tap('KeyU');
  assert.equal(h.run('state.grapple.mode'),'fly');
  assert.equal(h.run('state.player.input_buffer.slide'),0);
  assert.equal(h.run('state.player.input_buffer.jump'),0);
  h.up('KeyD');
});
test('M1 buffer: an available air jump cancels a queued slide',async()=>{
  const h=await game('#m1-buffer');m1SetNearLanding(h,5,true);
  h.down('KeyD');h.tap('ShiftLeft');
  assert.ok(h.run('state.player.input_buffer.slide')>0);
  h.run('state.rects=[]');h.tap('Space');
  assert.equal(h.run('state.player.jump_extension.last'),'double');
  assert.equal(h.run('state.player.input_buffer.slide'),0);
  h.up('KeyD');
});

test('M1 timing: ground slide lasts exactly 18 ticks at 60Hz and remains 40% lower',async()=>{
  const h=await game('#m1-timing');
  h.down('KeyD');h.down('ShiftLeft');h.tick();
  assert.equal(h.run('state.player.slide.frames'),1);
  assert.equal(h.run('state.player.h'),1.2);
  assert.ok(h.run('state.player.vx')>=9.9);
  h.up('ShiftLeft');
  h.tick(16);assert.equal(h.run('state.player.slide.frames'),17);
  const before=h.run('state.player.vx');assert.ok(before>8 && before<10);
  h.tick();
  assert.equal(h.run('state.player.slide'),null,'18th tick ends the short slide');
  assert.equal(h.run('state.player.h'),2,'player stands on clear terrain');
  assert.ok(h.run('state.player.vx')>=7.9,'slide exits with momentum rather than zero VX');
  h.up('KeyD');
});
test('M1 timing: initial slide invulnerability covers six 60Hz ticks, then expires',async()=>{
  const h=await game('#m1-timing');
  h.down('KeyD');h.down('ShiftLeft');h.tick();h.up('ShiftLeft');
  assert.ok(h.run('state.player.iframe')>=0.099);
  h.run("state.hits=[{to:'player',damage:20}];resolveDamage();state.hits=[]");
  assert.equal(h.run('state.player.hp'),100);
  h.tick(5);
  assert.ok(h.run('state.player.iframe')>0);
  h.tick();
  assert.ok(h.run('state.player.iframe')<=0.00001);
  h.run("state.hits=[{to:'player',damage:20}];resolveDamage();state.hits=[]");
  assert.equal(h.run('state.player.hp'),80);
  h.up('KeyD');
});
test('M1 timing: neutral ground speed decelerates from 8 to zero in 5 ticks (~0.08s)',async()=>{
  const h=await game('#m1-timing');
  h.run('Object.assign(state.player,{vx:8,vy:0,grounded:true,dash:null,slide:null,slide_jump:null,grapple_inertia:false,jump_ascend:false})');
  let prev=8;
  for(let i=0;i<4;i++){
    h.tick();
    const v=h.run('state.player.vx');
    assert.ok(v>=0 && v<prev);prev=v;
  }
  h.tick();assert.equal(h.run('state.player.vx'),0);
  h.down('KeyD');h.tick(7);
  assert.ok(h.run('state.player.vx')>=7.99,'0.12s ramp reaches full run speed');
  h.up('KeyD');
});
test('M1 timing: sliding jump inherits the current nonzero slide exit direction',async()=>{
  const h=await game('#m1-timing');
  h.down('KeyD');h.down('ShiftLeft');h.tick(5);h.up('ShiftLeft');
  const v=h.run('state.player.vx');assert.ok(v>8);
  h.tap('Space');
  assert.ok(h.run('state.player.vx')>=8);
  assert.ok(h.run('state.player.vy')>0);
  assert.equal(h.run('state.player.slide'),null);
  assert.ok(h.run('state.player.slide_jump'));
  h.up('KeyD');
});
test('M1 timing: slide ending below a ceiling remains crouched without body overlap',async()=>{
  const h=await game('#m1-timing');
  h.down('KeyD');h.down('ShiftLeft');h.tick();h.up('ShiftLeft');
  h.run("state.rects.push({id:'ROOF',type:'Solid',x:53,y:-22.7,w:20,h:2})");
  h.tick(17);
  assert.equal(h.run('state.player.slide'),null);
  assert.equal(h.run('state.player.h'),1,'too-low roof keeps post-slide crouch');
  assert.equal(h.run('blockers().some(r=>penetrates(aabb(state.player),aabb(r)))'),false);
  h.up('KeyD');
});
test('M1 timing: air Dash lasts 9 ticks (0.15s) and leaves bounded horizontal momentum',async()=>{
  const h=await game('#m1-timing');air(h);
  h.run('state.cam={x:state.player.x,y:state.player.y};mx=1279;my=360;state.player.st=100');
  h.down('ShiftLeft');h.tick();h.up('ShiftLeft');
  assert.ok(h.run('!!state.player.dash'));
  assert.ok(h.run('state.player.dash.left')>6,'9 frames exceeds the previous 6-unit dash');
  const start=h.run('state.player.x');h.tick(7);
  assert.ok(h.run('!!state.player.dash'),'Dash remains active through tick 8');
  h.tick();
  assert.equal(h.run('state.player.dash'),null,'Dash ends on tick 9');
  assert.ok(h.run('state.player.x')-start>5.5);
  assert.ok(h.run('state.player.vx')>=7.5 && h.run('state.player.vx')<=8.001);
  assert.equal(h.run('state.player.jump_extension.carry'),true);
  h.tick();assert.ok(h.run('state.player.vx')>0);
});
test('M1 timing: thin wall cannot be tunneled through by the 50-unit/s Dash',async()=>{
  const h=await game('#m1-timing');air(h);
  h.run("state.cam={x:50,y:-15};mx=1279;my=360;state.rects=[{id:'THIN',type:'Wall',x:52,y:-15,w:0.05,h:10}];state.player.st=100");
  h.down('ShiftLeft');h.tick();h.up('ShiftLeft');
  let ticks=0;while(h.run('!!state.player.dash')&&ticks++<12)h.tick();
  assert.ok(ticks<12);
  assert.ok(h.run('state.player.x')<51.5,'player stops before the wall instead of passing across it');
  assert.equal(h.run('blockers().some(r=>penetrates(aabb(state.player),aabb(r)))'),false);
  const start=h.run('state.player.x');
  h.down('KeyA');h.tick(3);h.up('KeyA');
  assert.ok(h.run('state.player.x')<start,'air steering can move away after collision');
});
test('M1 timing: diagonal Dash checks substeps around a thin corner',async()=>{
  const h=await game('#m1-timing');air(h);
  h.run("state.cam={x:50,y:-15};mx=1279;my=0;state.rects=[{id:'THIN_CORNER',type:'Wall',x:52,y:-12,w:0.08,h:2}];state.player.st=100");
  h.down('ShiftLeft');h.tick();h.up('ShiftLeft');h.tick(12);
  assert.equal(h.run('blockers().some(r=>penetrates(aabb(state.player),aabb(r)))'),false);
});
test('M1 timing: downward Dash terminates on landing, without restoring used carry',async()=>{
  const h=await game('#m1-timing');air(h);
  h.run("state.rects=[{id:'FLOOR',type:'Solid',x:50,y:-26,w:100,h:2}];Object.assign(state.player,{x:50,y:-23.5,vx:0,vy:0,grounded:false,st:100});state.cam={x:50,y:-23.5};mx=640;my=719");
  h.down('ShiftLeft');h.tick();h.up('ShiftLeft');
  assert.equal(h.run('state.player.dash'),null,'collision stops a downward dash immediately');
  assert.equal(h.run('state.player.grounded'),true);
  assert.equal(h.run('state.player.jump_extension.carry'),false);
  assert.equal(h.run('blockers().some(r=>penetrates(aabb(state.player),aabb(r)))'),false);
  h.tick();assert.equal(h.run('state.player.dash_used'),false,'grounded Dash resets availability');
});
test('M1 timing: respawn and blur never restart a timed Dash or sliding action',async()=>{
  const h=await game('#m1-timing');air(h);
  h.run('state.cam={x:state.player.x,y:state.player.y};mx=1279;my=360;state.player.st=100');
  h.down('ShiftLeft');h.tick();
  assert.ok(h.run('!!state.player.dash'));
  h.event('blur');h.tick();
  assert.equal(h.run('input.Dash.down'),false);
  h.run('respawn()');
  assert.equal(h.run('state.player.dash'),null);
  assert.equal(h.run('state.player.slide'),null);
  h.tick();assert.equal(h.run('state.player.dash'),null);
  h.up('ShiftLeft');
});
test('M1 timing: opt-in only; earlier #m1-buffer keeps 54-tick slide / low height 1',async()=>{
  const h=await game('#m1-buffer');h.down('KeyD');h.down('ShiftLeft');h.tick();h.up('ShiftLeft');
  assert.equal(h.run('state.player.h'),1);
  assert.equal(h.run('state.player.iframe'),0);
  h.tick(17);assert.ok(h.run('state.player.slide'),'prior buffer mode does not inherit new short slide');
  h.up('KeyD');
});
for(const hash of ['', '#m1-jumps', '#m1-controls'])test('M1 timing: no change to other profiles '+hash,async()=>{
  const h=await game(hash);
  assert.equal(h.run('m1TimingEnabled()'),false);
  assert.equal(h.run('M1_SLIDE_FRAMES'),18);
  assert.equal(h.run('m1BufferEnabled()'),false);
});

test('M1 geometry: touching coplanar wall rectangles form one stable kick surface',async()=>{
  const h=await game('#m1-geometry');
  h.run("state.rects=[{id:'Z_TOP',type:'Wall',x:51.001,y:-12.5,w:1,h:5},{id:'A_BOTTOM',type:'Wall',x:51.001,y:-17.5,w:1,h:5}];");
  const keys=h.plain("state.rects.map(r=>m1WallSurfaceKey(r,-1))");
  assert.deepEqual(keys,['A_BOTTOM:-1','A_BOTTOM:-1']);
  h.run('state.rects.reverse()');
  assert.deepEqual(h.plain("state.rects.map(r=>m1WallSurfaceKey(r,-1))"),keys);
});
test('M1 geometry: one airborne kick cannot repeat along adjoining wall segments',async()=>{
  const h=await game('#m1-geometry');
  h.run("state.rects=[{id:'TOP',type:'Wall',x:51.001,y:-12.5,w:1,h:5},{id:'BOTTOM',type:'Wall',x:51.001,y:-17.5,w:1,h:5}];state.player.jump_extension.air_available=false;Object.assign(state.player,{x:50,y:-12,vx:0,vy:-1,grounded:false,jump_ascend:false})");
  h.tap('Space');
  assert.equal(h.run('state.player.jump_extension.last'),'wall');
  const first=h.plain('state.player.jump_extension.walls');
  assert.equal(first.length,1);
  h.tick();
  h.run("Object.assign(state.player,{x:50,y:-18,vx:0,vy:-1,grounded:false,jump_ascend:false})");
  h.tap('Space');
  assert.deepEqual(h.plain('state.player.jump_extension.walls'),first);
  assert.ok(h.run('state.player.vy')<0,'second kick along identical surface is denied');
});
test('M1 geometry: distinct same-facing walls and disconnected segments have separate allowances',async()=>{
  const h=await game('#m1-geometry');
  h.run("state.rects=[{id:'A',type:'Wall',x:51.001,y:-11,w:1,h:4},{id:'B',type:'Wall',x:51.001,y:-19,w:1,h:4},{id:'C',type:'Wall',x:52.001,y:-15,w:1,h:4}];");
  assert.notEqual(h.run("m1WallSurfaceKey(state.rects[0],-1)"),h.run("m1WallSurfaceKey(state.rects[1],-1)"));
  assert.notEqual(h.run("m1WallSurfaceKey(state.rects[0],-1)"),h.run("m1WallSurfaceKey(state.rects[2],-1)"));
});
test('M1 geometry: closed door is a wall face, open door and OneWay side are not',async()=>{
  const h=await game('#m1-geometry');
  h.run("state.rects=[{id:'DOOR',type:'Door',locked:true,x:51.001,y:-15,w:1,h:8},{id:'OW',type:'OneWay',x:51.001,y:-25,w:1,h:2}];");
  h.run('Object.assign(state.player,{x:50,y:-15,grounded:false,vy:-1});state.player.jump_extension.air_available=false');
  assert.equal(h.run('m1JumpWall().key'),'DOOR:-1');
  h.run('state.rects[0].locked=false');
  assert.equal(h.run('m1JumpWall()'),null);
});
test('M1 geometry: thin wall blocks high-speed rope displacement',async()=>{
  const h=await game('#m1-geometry');
  h.run("state.rects=[{id:'THIN',type:'Wall',x:50,y:-15,w:0.04,h:20}];Object.assign(state.player,{x:49,y:-15,vx:35,vy:0,grounded:false,respawn_lock:0});state.grapple={...emptyGrapple(),mode:'rope_slack',anchor:{x:49,y:-10},head:{x:49,y:-10},rope_length:12};");
  h.run('moveRopePlayer(0)');
  const p=h.plain('({x:state.player.x,mode:state.grapple.mode,penetrating:blockers().some(r=>penetrates(aabb(state.player),aabb(r)))})');
  assert.ok(p.x<49.49,'horizontal rope motion cannot skip a 0.04-unit wall');
  assert.equal(p.penetrating,false);
  assert.notEqual(p.mode,'stuck');
});
test('M1 geometry: impossible rope projection is safely canceled, never teleports across wall',async()=>{
  const h=await game('#m1-geometry');
  h.run("state.rects=[{id:'THIN',type:'Wall',x:50,y:-15,w:0.04,h:20}];Object.assign(state.player,{x:48,y:-15,vx:0,vy:0,grounded:false,respawn_lock:0});state.grapple={...emptyGrapple(),mode:'rope_taut',anchor:{x:55,y:-15},head:{x:55,y:-15},rope_length:2};");
  h.run('moveRopePlayer(0)');
  const x=h.plain('({x:state.player.x,y:state.player.y,vx:state.player.vx,vy:state.player.vy,end:state.grapple.end,inertia:state.player.grapple_inertia,penetrating:blockers().some(r=>penetrates(aabb(state.player),aabb(r)))})');
  assert.ok(x.x<49.5,'rope cannot project player through wall');
  assert.equal(x.penetrating,false);assert.equal(x.end,true);
  assert.equal(x.inertia,false);assert.equal(x.vx,0);assert.equal(x.vy,0);
  h.run('cleanup()');assert.equal(h.run('state.grapple.mode'),'none');
});
test('M1 geometry: regular taut rope preserves bounded length and never enters STUCK',async()=>{
  const h=await game('#m1-geometry');
  h.run("state.rects=[];Object.assign(state.player,{x:50,y:-20,vx:0,vy:0,grounded:false,respawn_lock:0});state.grapple={...emptyGrapple(),mode:'rope_taut',anchor:{x:54,y:-16},head:{x:54,y:-16},rope_length:Math.hypot(4,4)};");
  let maxError=0;
  for(let i=0;i<45;i++){
    h.run('moveRopePlayer(1)');
    const p=h.plain("({mode:state.grapple.mode,end:state.grapple.end,d:Math.hypot(state.player.x-state.grapple.anchor.x,state.player.y-state.grapple.anchor.y),L:state.grapple.rope_length})");
    assert.equal(p.end,false);assert.notEqual(p.mode,'stuck');
    maxError=Math.max(maxError,p.d-p.L);
  }
  assert.ok(maxError<0.15,'rope stays within correction tolerance');
});
test('M1 geometry: rope corner motion with thin solids never overlaps walls',async()=>{
  const h=await game('#m1-geometry');
  h.run("state.rects=[{id:'SIDE',type:'Wall',x:52,y:-18,w:0.05,h:10},{id:'TOP',type:'Solid',x:55,y:-24,w:6,h:0.1}];Object.assign(state.player,{x:50,y:-20,vx:0,vy:0,grounded:false,respawn_lock:0});state.grapple={...emptyGrapple(),mode:'rope_taut',anchor:{x:50,y:-14},head:{x:50,y:-14},rope_length:6};");
  for(let i=0;i<60;i++){
    if(h.run('state.grapple.end'))break;
    h.run('moveRopePlayer(1)');
    assert.equal(h.run('blockers().some(r=>penetrates(aabb(state.player),aabb(r)))'),false);
    assert.notEqual(h.run('state.grapple.mode'),'stuck');
  }
});
for(const hash of ['', '#m1-timing', '#m1-buffer'])test('M1 geometry: previous profile unaffected '+hash,async()=>{
  const h=await game(hash);
  assert.equal(h.run('m1GeometryEnabled()'),false);
  assert.equal(h.run('m1RopeEnabled()'),hash!=='');
  h.run("state.rects=[{id:'Z',type:'Wall',x:51.001,y:-12.5,w:1,h:5},{id:'A',type:'Wall',x:51.001,y:-17.5,w:1,h:5}]");
  // Earlier modes still use collider IDs directly, never the unified key.\n  h.run("Object.assign(state.player,{x:50,y:-12,vy:-1,grounded:false})");\n  assert.equal(h.run('m1JumpWall().key'),'Z:-1');
});
