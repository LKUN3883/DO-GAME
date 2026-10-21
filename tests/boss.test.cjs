const test=require('node:test');
const assert=require('node:assert/strict');
const {game}=require('./game-harness.cjs');
async function arena(){const g=await game();g.run("state.enemies=[];Object.assign(state.player,{x:290,y:-23.999,grounded:true});Object.assign(state.boss,{active:true,x:300,y:-23.699,grounded:true,phase:'idleA',phase_t:100});state.boss_mode=true;state.cam={x:300,y:-21};state.rects.find(r=>r.id==='DoorBoss').locked=true");return g;}

test('Boss shotgun starts immediately when the preceding pause ends and fires four five-pellet volleys',async()=>{
 const g=await arena();g.run("state.boss.phase_t=DT/2;state.boss.shoot_cd=-99;updateBoss()");
 assert.equal(g.run('state.boss.phase'),'shotgun');assert.equal(g.run('state.projectiles.length'),5);
 g.run('for(let n=0;n<170;n++)updateBoss()');
 assert.equal(g.run('state.projectiles.filter(p=>p.w===0.18).length'),20);
 assert.equal(g.run('state.boss.phase'),'idleB');
});

test('charge inserted into idleA resumes shotgun; idleB resumes rifle',async()=>{
 for(const [pause,next] of [['idleA','shotgun'],['idleB','rifle']]){
  const g=await arena();g.run(`Object.assign(state.boss,{hp:210,phase:'${pause}',phase_t:1,charge_pending:true});updateBoss()`);
  assert.equal(g.run('state.boss.phase'),'warn');
  g.run("for(let i=0;i<50 && (state.boss.phase==='warn'||state.boss.phase==='charge');i++)updateBoss()");
  assert.equal(g.run('state.boss.phase'),next);
 }
});

test('Boss charge uses remaining displacement, ends on wall and causes 18 damage once during iFrame',async()=>{
 const g=await arena();g.run("Object.assign(state.boss,{phase:'charge',charge:{dir:1,left:0.1}});updateBoss()");
 assert.ok(Math.abs(g.run('state.boss.x')-300.1)<1e-8);assert.equal(g.run('state.boss.vx'),0);assert.equal(g.run('state.boss.vy'),0);
 g.run("Object.assign(state.boss,{x:300,phase:'charge',charge:{dir:1,left:6}});state.rects.push({id:'CHARGE_STOP',type:'Wall',x:301.9,y:-22,w:1,h:8});updateBoss()");
 assert.notEqual(g.run('state.boss.phase'),'charge');
 g.run("state.rects=state.rects.filter(r=>r.id!=='CHARGE_STOP');state.player.x=302;state.player.iframe=0;state.player.hp=100;Object.assign(state.boss,{x:300,phase:'charge',charge:{dir:1,left:6}});state.hits=[];updateBoss();resolveDamage()");
 assert.equal(g.run('state.player.hp'),82);g.run('state.hits=[];updateBoss();resolveDamage()');assert.equal(g.run('state.player.hp'),82);
});

test('lethal hit marks Boss in damage stage, exits mode in cleanup and delays camera/doors for 48 subsequent ticks',async()=>{
 const g=await arena();g.run("state.boss.hp=9;state.hits=[{src:'p_proj',id:'BOSS',damage:9}];resolveDamage()");
 assert.equal(g.run('state.boss.dead'),true);assert.equal(g.run('state.boss_mode'),true,'mode transition must wait for cleanup');
 g.run('cleanup()');assert.equal(g.run('state.boss_mode'),false);assert.equal(g.run('state.boss.death_t'),0.8);
 const bossX=g.run('state.boss.x');g.run("state.player.x=280;state.cam.x=286");
 g.tick(47);assert.equal(g.run('state.boss.alive'),true);assert.equal(g.run("state.rects.find(r=>r.id==='DoorBoss').locked"),true);
 assert.equal(g.run('state.cam.x'),286);assert.equal(g.run('state.boss.x'),bossX);
 g.tick();assert.equal(g.run('state.boss.alive'),false);assert.equal(g.run("state.rects.find(r=>r.id==='DoorBoss').locked"),false);assert.equal(g.run("state.rects.find(r=>r.id==='DoorExit').locked"),false);
 g.tick();assert.ok(g.run('state.cam.x')<286);g.run('render()');assert.ok(!g.labels.some(x=>x.startsWith('BOSS HP')));
 g.run('state.player.x=358;state.player.y=-23;postChecks()');assert.equal(g.run('state.game_state'),'WIN');
});
