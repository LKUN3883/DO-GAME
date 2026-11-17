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
