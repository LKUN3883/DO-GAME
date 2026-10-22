const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {game}=require('./game-harness.cjs');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
async function quiet(){const g=await game();g.run('state.enemies=[]');g.tick(60);return g;}

test('respawn happens last, cleans melee/height/hint and keeps one full input-lock frame',async()=>{
 const g=await quiet();g.run("Object.assign(state.player,{hp:0,h:1,crouch:true,melee:{t:1,window:0.45,hit:new Set()}});state.hint={text:'old',t:99}");g.tick();
 assert.equal(g.run('state.player.respawn_lock'),1);assert.equal(g.run('state.player.h'),2);assert.equal(g.run('state.player.melee'),null);assert.equal(g.run('state.hint.text'),'');
 for(const k of ['KeyD','KeyS','Space','KeyF'])g.key(k,true);g.mouse(0,true);g.mouse(2,true);g.run('mx=0;my=0');const x=g.run('state.player.x');
 g.tick();close(g.run('state.player.x'),x);assert.equal(g.run('state.player.ammo'),60);assert.equal(g.run('state.player.melee'),null);assert.equal(g.run('state.grapple.mode'),'none');assert.equal(g.run('state.player.dash'),null);
 assert.equal(g.run('Object.values(input).every(i=>!i.down&&!i.just_pressed&&!i.just_released)'),true);assert.equal(g.run('playerAimDir().x'),1);assert.equal(g.run('playerAimDir().y'),0);
 g.tick();assert.ok(g.run('state.player.ammo')<60);
});

test('death clears projectiles in cleanup before respawn and preserves ordinary enemy state',async()=>{
 const g=await quiet();g.run("state.enemies=[{id:'survivor',type:'ranged_rifle',alive:true,x:100,y:-24.399,w:1.2,h:1.2,hp:42,vx:0,vy:0,shoot_cd:10,exclaim_t:0}];state.projectiles=[{x:100,y:0,vx:0,vy:0,w:0.1,h:0.1,damage:2,owner:'enemy',spawn_seq:0,age:0}];state.player.hp=0;const originalRespawn=respawn;let emptyBeforeRespawn=false;respawn=()=>{emptyBeforeRespawn=state.projectiles.length===0;originalRespawn()}");g.tick();assert.equal(g.run('emptyBeforeRespawn'),true);assert.equal(g.run('state.enemies[0].hp'),42);assert.equal(g.run('state.enemies[0].x'),100);
});

test('respawn resolves solid overlap, resets all Boss attack state and unlocks arena',async()=>{
 const g=await quiet();g.run("state.rects.push({id:'SPAWN_OBSTACLE',type:'Wall',x:6,y:-21,w:1,h:2});state.boss_mode=true;Object.assign(state.boss,{active:true,hp:123,phase:'charge',charge:{dir:1,left:4},shot_count:3,shoot_cd:-10,warning_t:0.1});state.rects.find(r=>r.id==='DoorBoss').locked=true;state.player.hp=0");g.tick();
 assert.equal(g.run('blockers().some(r=>penetrates(aabb(state.player),aabb(r)))'),false);assert.equal(g.run('state.boss.active'),false);assert.equal(g.run('state.boss.hp'),123);assert.equal(g.run('state.boss.charge'),null);assert.equal(g.run('state.boss.shoot_cd'),0);assert.equal(g.run("state.rects.find(r=>r.id==='DoorBoss').locked"),false);
});

test('body separation moves only player, keeps velocities and skips inactive/dead Boss',async()=>{
 const g=await quiet();g.run("const p=state.player;state.enemies=[{id:'E',alive:true,x:p.x+0.4,y:p.y,w:1,h:2,hp:100}];p.vx=8;p.vy=0;separatePlayerBodies()");assert.equal(g.run('penetrates(aabb(state.player),aabb(state.enemies[0]))'),false);assert.equal(g.run('state.player.vx'),8);close(g.run('state.enemies[0].x'),6.4);
 g.run('state.enemies=[];state.boss.x=state.player.x;state.boss.y=state.player.y;state.boss.active=false');const x=g.run('state.player.x');g.run('separatePlayerBodies()');close(g.run('state.player.x'),x);
 g.run('state.boss.active=true;state.boss.dead=true;separatePlayerBodies()');close(g.run('state.player.x'),x);
});

test('crouch preserves feet; low ceiling blocks standing and crawling, clear roof allows stand',async()=>{
 const g=await quiet();const foot=g.run('state.player.y-state.player.h/2');g.key('KeyS',true);g.tick();assert.equal(g.run('state.player.h'),1);close(g.run('state.player.y-state.player.h/2'),foot);
 g.run("state.rects.push({id:'LOW_ROOF',type:'Solid',x:6,y:-23.4,w:4,h:0.2})");g.key('KeyS',false);g.tick();assert.equal(g.run('state.player.h'),1);assert.equal(g.run('state.player.crouch'),true);
 g.key('KeyD',true);g.tick(5);close(g.run('state.player.x'),6);assert.equal(g.run('state.player.vx'),0);assert.equal(g.run('blockers().some(r=>penetrates(aabb(state.player),aabb(r)))'),false);
 g.run("state.rects=state.rects.filter(r=>r.id!=='LOW_ROOF')");g.key('KeyD',false);g.tick();assert.equal(g.run('state.player.h'),2);close(g.run('state.player.y-state.player.h/2'),foot);
});

test('slide starts at 10, retains direction and ends immediately on wall',async()=>{
 const g=await quiet();g.key('KeyD',true);g.key('KeyS',true);g.tick();assert.equal(g.run('state.player.vx'),10);assert.equal(g.run('state.player.h'),1);g.key('KeyD',false);g.key('KeyA',true);g.tick();assert.ok(g.run('state.player.vx')>0);
 g.run("state.rects.push({id:'SLIDE_WALL',type:'Wall',x:state.player.x+1.1,y:-23,w:1,h:6})");g.tick(3);assert.equal(g.run('state.player.slide'),null);assert.equal(g.run('state.player.vx'),0);assert.equal(g.run('state.player.crouch'),true);
});

test('melee enemy waits at edge and does not bank negative cooldown out of range',async()=>{
 const g=await quiet();g.run("state.rects=[{id:'ledge',type:'Solid',x:0,y:-1,w:2,h:1}];state.player.x=3;state.cam.x=0;state.enemies=[{id:'E',type:'melee_basic',alive:true,x:0.51,y:0.301,w:1,h:1.6,hp:110,vx:0,vy:0,grounded:true,melee_cd:0,discovered:false}];updateEnemies()");assert.equal(g.run('state.enemies[0].vx'),0);assert.equal(g.run('state.enemies[0].melee_cd'),0);
 g.run('state.enemies[0].melee_cd=-100;state.cam.x=200;updateEnemies()');assert.equal(g.run('state.enemies[0].melee_cd'),0);
});

test('same-frame player damage takes maximum once; immune projectiles still disappear',async()=>{
 const g=await quiet();g.run("state.hits=[{to:'player',damage:2},{to:'player',damage:18},{to:'player',damage:22}];resolveDamage()");assert.equal(g.run('state.player.hp'),78);
 g.run("state.projectiles=[{x:state.player.x,y:state.player.y,vx:0,vy:0,w:0.1,h:0.1,damage:50,owner:'enemy',spawn_seq:1,age:0}];state.hits=[];updateProjectiles();resolveDamage();cleanup()");assert.equal(g.run('state.player.hp'),78);assert.equal(g.run('state.projectiles.length'),0);
});

test('camera precedes perception, queued attacks spawn in prescribed player/enemy/Boss order',async()=>{
 const g=await quiet();g.run("let events=[];for(const name of ['updateCamera','updateEnemies','updateBoss','generateAttacks','updateProjectiles','resolveDamage','cleanup','postChecks']){const original=eval(name);eval(name+' = (...args)=>{events.push(\"'+name+'\");return original(...args)}')}");g.tick();assert.equal(g.run('events.join(",")'),'updateCamera,updateEnemies,updateBoss,generateAttacks,updateProjectiles,resolveDamage,cleanup,postChecks');
});

test('nearest checkpoint on entry shows timed hint and Boss trigger clamps camera same tick',async()=>{
 const g=await quiet();g.run('state.player.x=8;state.player.y=-21');g.tick();assert.equal(g.run('state.hint.text'),'检查点');g.tick(5);assert.ok(g.run('state.hint.t')<0.8);
 g.run('state.player.x=280;state.player.y=-21;postChecks()');assert.equal(g.run('state.boss_mode'),true);assert.ok(g.run('state.cam.x')>=286);
});

test('spec embeds exact unchanged level JSON and required balance artifact exists',()=>{
 const root=path.join(__dirname,'../docs'),spec=fs.readFileSync(path.join(root,'spec/BLUEPRINT_v1.3.2d-e_FINAL.md'),'utf8');const embedded=spec.match(/22\.5 训练关 JSON[\s\S]*?```json\n([\s\S]*?)```/);assert.ok(embedded,'blueprint must be self contained');assert.equal(embedded[1],fs.readFileSync(path.join(root,'level_train_v1.json'),'utf8'));assert.ok(fs.existsSync(path.join(root,'balance_v1_3_2d.json')));
});

test('fixed-duration melee window, Boss warning and idle cannot gain an extra float-residue tick',async()=>{
 const g=await quiet();g.key('KeyF',true);g.tick(27);assert.equal(g.run('state.player.melee.window'),0);
 g.run("state.enemies=[{id:'LATE',type:'ranged_rifle',alive:true,x:8,y:state.player.y,w:1,h:2,hp:95,vx:0,vy:0,shoot_cd:100,exclaim_t:0}];mx=1279;my=360");g.tick();assert.equal(g.run('state.enemies[0].hp'),95);
 g.run("Object.assign(state.boss,{active:true,hp:420,phase:'warn',phase_t:0.2,warning_t:0,charge_next:'rifle'});for(let i=0;i<11;i++)updateBoss()");assert.equal(g.run('state.boss.phase'),'warn');g.run('updateBoss()');assert.equal(g.run('state.boss.phase'),'charge');
 g.run("Object.assign(state.boss,{phase:'idleA',phase_t:0.5,charge_pending:false});for(let i=0;i<29;i++)updateBoss()");assert.equal(g.run('state.boss.phase'),'idleA');g.run('updateBoss()');assert.equal(g.run('state.boss.phase'),'shotgun');
});

test('projectiles choose actual nearest target even inside eps; Unicode ties use code points',async()=>{
 const g=await quiet();g.run("state.rects=[];state.enemies=[{id:'A_far',alive:true,x:10.0005,y:0,w:1,h:1,hp:95},{id:'Z_near',alive:true,x:10,y:0,w:1,h:1,hp:95}];state.projectiles=[{x:10,y:0,w:0.2,h:0.1,vx:0,vy:0,damage:9,owner:'player',spawn_seq:0,age:0}];state.hits=[];updateProjectiles();resolveDamage()");assert.equal(g.run('state.enemies[1].hp'),86);assert.equal(g.run('state.enemies[0].hp'),95);
 assert.ok(g.run("idCompare('\\uE000','\\u{10000}')")<0);
});

test('new Hint lasts its prescribed duration and is not decremented in its creation tick',async()=>{
 const g=await quiet();g.run('state.player.x=8;state.player.y=-21');g.tick();assert.equal(g.run('state.hint.t'),0.8);g.tick(47);assert.ok(g.run('state.hint.t')>0);g.tick();assert.equal(g.run('state.hint.t'),0);
});

test('actual projectile spawn sequence is player then ordered enemies then Boss',async()=>{
 const g=await quiet();g.run("state.player.x=290;state.player.y=-23.999;state.cam={x:290,y:-21};state.boss_mode=true;Object.assign(state.boss,{active:true,x:300,y:-23.699,phase:'rifle',phase_t:2,shoot_cd:0});state.enemies=[294,296].map((x,i)=>({id:'E'+i,type:'ranged_rifle',alive:true,x,y:-24.399,w:1.2,h:1.2,hp:95,vx:0,vy:0,shoot_cd:0,exclaim_t:0}));mx=1279;my=360");g.mouse(0,true);g.tick();assert.equal(g.run('state.projectiles.map(p=>p.owner).join(",")'),'player,enemy,enemy,boss');assert.equal(g.run('state.projectiles.map(p=>p.spawn_seq).join(",")'),'0,1,2,3');
});

test('four deterministic input stress runs retain finite physics and bounded resources',async()=>{
 for(const seed of [1,17,3883,65537]){
  const g=await game();g.run(`let rng=${seed};function rand(){rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return rng>>>0}`);
  const invalid=g.run(`(()=>{for(let frame=0;frame<1200;frame++){
   if(frame%5===0){for(const code of ['KeyA','KeyD','KeyS','Space','KeyF','Mouse0','Mouse2'])keyRaw.set(code,(rand()%7)<2);mx=rand()%1280;my=rand()%720;}
   updateLogic();const p=state.player;
   if(![p.x,p.y,p.vx,p.vy,p.hp,p.st,p.ammo,state.cam.x,state.cam.y].every(Number.isFinite)||p.hp<=0||p.hp>100||p.st<0||p.st>100||p.ammo<0||p.ammo>60||![1,2].includes(p.h))return frame;
  }return -1})()`);assert.equal(invalid,-1,`seed ${seed}, tick ${invalid}`);
 }
});
