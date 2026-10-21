const test = require('node:test');
const assert = require('node:assert/strict');
const {game} = require('./helpers/game.cjs');

async function arena() {
  const g=await game();
  g.run(`state.rects=[];state.enemies=[];state.boss.alive=false;
    Object.assign(state.player,{x:10,y:0,vx:0,vy:0,grounded:false});
    state.cam={x:10,y:0};mx=1000;my=360;`);
  return g;
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const json=(g,code)=>JSON.parse(g.run(`JSON.stringify(${code})`));
function anchor(g,mode='pull',x=20,y=0) {
  g.run(`state.grapple={...emptyGrapple(),mode:'${mode}',
    head:{x:${x},y:${y},w:0.3,h:0.3},anchor:{x:${x},y:${y}}};`);
}

test('14.1–4: one 0.30 head, Facing fallback, same-tick 28 cm/s flight; no repeat while held',async()=>{
  const g=await arena();
  g.run('mx=640;my=360;state.player.facing=-1');
  g.mouse(2,true);g.tick();
  near(g.run('state.grapple.head.x'),10-0.9-28/60);
  assert.equal(g.run('state.grapple.head.w'),0.3);
  assert.equal(g.run('state.grapple.head.h'),0.3);
  g.run('state.grapple.head.marker=true');g.tick();
  assert.equal(g.run('state.grapple.head.marker'),true);
  assert.equal(g.run('state.player.ammo'),60);
  assert.equal(g.run('state.player.st'),100);
});

for (const type of ['Solid','Wall','Door','OneWay']) {
  test(`14.5: ${type} spawn backtracks in 0.05 steps and origin is final center`,async()=>{
    const g=await arena();
    g.run(`state.rects=[{id:'T',type:'${type}',locked:true,x:11.5,y:0,w:1,h:1}];spawnGrapple({x:1,y:0});`);
    near(g.run('state.grapple.head.origin.x'),10.8);
    g.run('updateGrapple()');
    assert.equal(g.run('state.grapple.mode'),'pull');
    near(g.run('state.grapple.anchor.x'),10.8+28/60);
  });
}

test('14.5: full 0.90 backtrack succeeds at last step; enclosed spawn fails without cost or cooldown',async()=>{
  const g=await arena();
  g.run("state.rects=[{id:'T',type:'Wall',x:11.152,y:0,w:2,h:2}];spawnGrapple({x:1,y:0});");
  near(g.run('state.grapple.head.origin.x'),10);
  g.run("state.grapple=emptyGrapple();state.rects[0].w=4");
  assert.equal(g.run('spawnGrapple({x:1,y:0})'),false);
  assert.equal(g.run('state.grapple.mode'),'none');
  near(g.run('state.player.ammo'),60);near(g.run('state.player.st'),100);
  g.run('state.rects=[]');assert.equal(g.run('spawnGrapple({x:1,y:0})'),true);
});

test('14.6: range is straight-line distance from final spawn, exactly 40 is allowed',async()=>{
  const g=await arena();
  g.run('spawnGrapple({x:1,y:0});state.grapple.head.x=state.grapple.head.origin.x+40-28*DT;updateGrapple()');
  assert.equal(g.run('state.grapple.end'),false);
  g.run('updateGrapple()');assert.equal(g.run('state.grapple.end'),true);
  g.run('cleanup()');assert.equal(g.run('state.grapple.mode'),'none');
});

test('14.6–8: a hit wins over range expiry in the same tick',async()=>{
  const g=await arena();
  g.run(`spawnGrapple({x:1,y:0});state.grapple.head.x=51;
    state.rects=[{id:'far',type:'Wall',x:51.5,y:0,w:1,h:2}];updateGrapple();`);
  assert.equal(g.run('state.grapple.mode'),'pull');
});

test('14.7–8: character > OneWay > blocking terrain; unlocked doors/triggers ignored',async()=>{
  const g=await arena();
  g.run(`state.rects=[{id:'W',type:'Wall',x:11.4,y:0,w:1,h:2},
    {id:'O',type:'OneWay',x:11.5,y:0,w:1,h:1}];
    state.enemies=[{id:'E',alive:true,hp:100,x:11.6,y:0,w:1,h:1}];
    spawnGrapple({x:1,y:0});`);
  // Spawn separately to isolate hit priorities from spawn backtracking.
  g.run('state.grapple.head.x=11;updateGrapple()');
  assert.equal(g.run('state.grapple.target.id'),'E');
  g.run('state.enemies=[];state.grapple=emptyGrapple();spawnGrapple({x:1,y:0});state.grapple.head.x=11;updateGrapple()');
  assert.equal(g.run('state.grapple.target.id'),'O');
  g.run(`state.grapple=emptyGrapple();state.rects=[
    {id:'D',type:'Door',locked:false,x:11.4,y:0,w:1,h:2},
    {id:'T',type:'Trigger',x:11.4,y:0,w:1,h:2}];spawnGrapple({x:1,y:0});updateGrapple();`);
  assert.equal(g.run('state.grapple.mode'),'fly');
});

test('14.8: nearest center, then Unicode id (not locale ordering)',async()=>{
  const g=await arena();
  g.run(`spawnGrapple({x:1,y:0});state.enemies=[
    {id:'a',alive:true,x:11.4,y:0,w:1,h:1},
    {id:'Z',alive:true,x:11.4,y:0,w:1,h:1},
    {id:'A',alive:true,x:11.6,y:0,w:1,h:1}];updateGrapple();`);
  assert.equal(g.run('state.grapple.target.id'),'Z');
});

for (const target of ['Enemy','Boss']) {
  test(`14.9: ${target} anchor clamps to AABB, keeps local offset through motion`,async()=>{
    const g=await arena();
    g.run(`spawnGrapple({x:1,y:0});
      const target={id:'BOSS',active:true,alive:true,dead:false,hp:100,x:11.6,y:0,w:0.2,h:1};
      ${target==='Boss'?'state.boss=target':'state.enemies=[target]'};
      updateGrapple();`);
    near(g.run('state.grapple.anchor.x'),11.5);
    near(g.run('state.grapple.local.x'),-0.1);
    g.run('state.grapple.target.x+=2;state.grapple.target.y+=1;updateGrapple()');
    near(g.run('state.grapple.anchor.x'),13.5);
    near(g.run('state.grapple.anchor.y'),1);
  });
}

test('21.1: flight hits after player movement, pull starts next tick with exact 10+3 velocity',async()=>{
  const g=await arena();
  g.run('spawnGrapple({x:1,y:0});state.rects=[{id:"W",type:"Wall",x:11.8,y:0,w:1,h:2}]');
  g.tick();near(g.run('state.player.x'),10);
  assert.equal(g.run('state.grapple.mode'),'pull');
  g.key('KeyD',true);const before=json(g,'state.player');
  const a=json(g,'state.grapple.anchor');
  const dx=a.x-before.x,dy=a.y-before.y,d=Math.hypot(dx,dy);
  g.tick();near(g.run('state.player.x'),before.x+(dx/d*10+3)/60);
  near(g.run('state.player.y'),before.y+dy/d*10/60);
});

for (const mode of ['pull','stuck']) {
  test(`14.10–11: ${mode} forbids grounded jump, air Dash and down-through; attacks remain active`,async()=>{
    const g=await arena();anchor(g,mode);
    g.run('state.player.grounded=true;state.player.standing_oneway_id="O"');
    g.key('KeyS',true);g.key('Space',true);g.key('KeyF',true);g.mouse(0,true);g.tick();
    assert.equal(g.run('state.player.jump_ascend'),false);
    assert.equal(g.run('state.player.ignore_oneway_id'),'');
    assert.equal(g.run('state.player.dash'),null);
    assert.ok(g.run('state.player.melee'));
    assert.ok(g.run('state.player.ammo')<60);
    g.key('Space',false);g.tick();g.key('Space',true);g.tick();
    assert.equal(g.run('state.player.dash'),null);
    if (mode==='stuck') {near(g.run('state.player.x'),10);near(g.run('state.player.y'),0);}
  });
}

test('14.10: no gravity/ascent or Dash displacement leaks into pull',async()=>{
  const g=await arena();
  g.run('spawnGrapple({x:1,y:0});state.rects=[{id:"W",type:"Wall",x:11.8,y:0,w:1,h:2}];state.player.dash={dir:{x:0,y:1},left:5};state.player.jump_ascend=true;updateGrapple()');
  assert.equal(g.run('state.player.dash'),null);assert.equal(g.run('state.player.jump_ascend'),false);
  g.run('state.rects=[];state.grapple.anchor={x:20,y:0};moveGrapplePlayer(-1)');
  near(g.run('state.player.vx'),7);near(g.run('state.player.vy'),0);
});

test('14.11: three consecutive blocked advances enter STUCK; progress resets the counter',async()=>{
  const g=await arena();anchor(g);
  g.run('state.rects=[{id:"W",type:"Wall",x:11,y:0,w:1,h:5}];state.player.x=9.999;');
  g.run('moveGrapplePlayer(0);moveGrapplePlayer(0)');
  assert.equal(g.run('state.grapple.stuck_frames'),2);
  g.run('state.rects=[];moveGrapplePlayer(0)');
  assert.equal(g.run('state.grapple.stuck_frames'),0);
  g.run('state.rects=[{id:"W",type:"Wall",x:state.player.x+1.001,y:0,w:1,h:5}];moveGrapplePlayer(0);moveGrapplePlayer(0);moveGrapplePlayer(0)');
  assert.equal(g.run('state.grapple.mode'),'stuck');
  const before=json(g,'state.player');
  g.run('state.rects=[];state.grapple.anchor={x:state.player.x,y:state.player.y}');
  g.key('KeyA',true);g.tick(4);
  near(g.run('state.player.x'),before.x);near(g.run('state.player.y'),before.y);
  assert.equal(g.run('state.player.facing'),-1);
  assert.equal(g.run('state.grapple.mode'),'stuck');
});

test('14.10: pull collides with Solid/locked Door and lands on OneWay, but crosses upward',async()=>{
  for (const type of ['Solid','Door','OneWay']) {
    const g=await arena();anchor(g,'pull',10,-10);
    g.run(`state.rects=[{id:'T',type:'${type}',locked:true,x:10,y:-1.5,w:8,h:1}];state.player.y=0.001;moveGrapplePlayer(0)`);
    near(g.run('state.player.y'),0.001);assert.equal(g.run('state.player.grounded'),true);
    if (type==='OneWay') {
      g.run('state.player.y=-3.1;state.grapple.anchor.y=10;moveGrapplePlayer(0)');
      assert.ok(g.run('state.player.y')>-3.1);assert.equal(g.run('state.player.grounded'),false);
    }
  }
});

test('14.12: inclusive 0.8+eps proximity ends pull and cleanup clears all fields, velocity zero',async()=>{
  const g=await arena();anchor(g,'pull',0.801,0);g.run('state.player.x=0');
  g.run('moveGrapplePlayer(0);cleanup()');
  assert.deepEqual(json(g,'state.grapple'),{mode:'none',head:null,anchor:null,target:null,local:null,stuck_frames:0,end:false});
  near(g.run('state.player.vx'),0);near(g.run('state.player.vy'),0);
});

test('14.12: newly established nearby anchor ends in the hit tick',async()=>{
  const g=await arena();
  g.run(`spawnGrapple({x:1,y:0});state.grapple.head.x=10.1;
    state.rects=[{id:'W',type:'Wall',x:10.6,y:0,w:1,h:1}];updateGrapple();`);
  assert.equal(g.run('state.grapple.end'),true);
  g.run('cleanup()');assert.equal(g.run('state.grapple.mode'),'none');
});

test('release restores normal jump and single-use Dash; baseline jump never triggers same-tick Dash',async()=>{
  const g=await arena();g.mouse(2,true);g.tick();anchor(g,'stuck');
  g.run('state.player.grounded=true');g.mouse(2,false);g.key('Space',true);g.tick();
  assert.equal(g.run('state.player.jump_ascend'),true);
  assert.equal(g.run('state.player.dash'),null);near(g.run('state.player.st'),100);
  g.key('Space',false);g.tick();g.key('Space',true);g.tick();
  assert.ok(g.run('state.player.dash'));assert.equal(g.run('state.player.dash_used'),true);
});

test('a flying head does not suppress ordinary gravity or air Dash before it hits',async()=>{
  const g=await arena();g.mouse(2,true);g.tick();
  near(g.run('state.player.vy'),-3);
  g.key('Space',true);g.tick();assert.ok(g.run('state.player.dash'));
});

for (const mode of ['fly','pull','stuck']) {
  test(`14.3: release ${mode} (including outside canvas) ends; held button cannot auto-refire`,async()=>{
    const g=await arena();g.mouse(2,true);g.tick();
    if (mode!=='fly') anchor(g,mode);
    g.handlers.mouseup({button:2});g.tick();
    assert.equal(g.run('state.grapple.mode'),'none');
    g.mouse(2,true);g.tick();assert.equal(g.run('state.grapple.mode'),'fly');
    g.run('endGrapple();cleanup()');g.tick();assert.equal(g.run('state.grapple.mode'),'none');
  });
}

for (const target of ['Enemy','Boss']) for (const mode of ['pull','stuck']) {
  test(`14.12: ${mode} anchored ${target} killed by same-tick shooting ends during cleanup`,async()=>{
    const g=await arena();
    g.run(`const victim={id:'${target==='Boss'?'BOSS':'E'}',active:true,alive:true,dead:false,hp:9,x:12,y:0,w:1,h:1};
      ${target==='Boss'?'state.boss=victim':'state.enemies=[victim]'};
      spawnGrapple({x:1,y:0});state.grapple.head.x=11.4;updateGrapple();state.grapple.mode='${mode}';
      spawnProjectile({x:11.5,y:0,vx:30,vy:0,w:0.25,h:0.1,damage:9,owner:'player'});
      updateProjectiles();resolveDamage();`);
    assert.equal(g.run('state.grapple.target.hp'),0);
    assert.equal(g.run('state.grapple.mode'),mode);
    g.run('cleanup()');assert.equal(g.run('state.grapple.mode'),'none');
  });
}

test('23.5: respawn clears head, anchor, pull and stuck; blur releases RMB',async()=>{
  const g=await arena();anchor(g,'stuck');g.run('respawn()');
  assert.equal(g.run('state.grapple.mode'),'none');
  g.mouse(2,true);g.tick(2);g.handlers.blur();g.tick();
  assert.equal(g.run('state.grapple.mode'),'none');
});

test('determinism: identical inputs produce identical full state',async()=>{
  async function replay() {
    const g=await game();g.tick(60);
    g.run('state.enemies=[];state.rects.push({id:"G",type:"Wall",x:14,y:-21,w:1,h:8});mx=1279;my=360;');
    g.mouse(2,true);g.tick(20);g.key('KeyD',true);g.mouse(0,true);g.tick(40);
    g.mouse(2,false);g.tick(10);return json(g,'state');
  }
  assert.deepEqual(await replay(),await replay());
});

// Preserve the latest PR #2 inactive-Boss protection for grapple targets too.
test('inactive Boss is not a grapple target',async()=>{
  const g=await arena();
  g.run("state.boss={id:'BOSS',active:false,alive:true,dead:false,x:11.4,y:0,w:2.6,h:2.6,hp:420};spawnGrapple({x:1,y:0});updateGrapple()");
  assert.equal(g.run('state.grapple.mode'),'fly');
});
