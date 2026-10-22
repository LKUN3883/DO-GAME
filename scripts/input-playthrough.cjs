// Tool-assisted progression: reads a snapshot; writes only browser key/mouse events.
// No teleport, resource refill, enemy removal or invulnerability fixture.
const {chromium}=require('playwright');const fs=require('fs');const http=require('http');const path=require('path');const assert=require('node:assert/strict');
(async()=>{
const root=path.join(__dirname,'../docs');
const server=http.createServer((req,res)=>{const n=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','game.js','level_train_v1.json'].includes(n)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',n.endsWith('.js')?'text/javascript':n.endsWith('.json')?'application/json':'text/html');let s=fs.readFileSync(root+'/'+n,'utf8');if(n==='game.js')s+='\nwindow.readGame=()=>structuredClone(state);';res.end(s)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const b=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
const page=await b.newPage({viewport:{width:1280,height:800}});await page.clock.install({time:new Date('2026-10-21T00:00:00Z')});await page.clock.pauseAt(new Date('2026-10-21T00:00:10Z'));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.readGame?.());await page.clock.runFor(1000);
const keys=new Set();let mouseL=false,mouseR=false;
async function key(k,d){if(keys.has(k)===d)return;if(d){keys.add(k);await page.keyboard.down(k)}else{keys.delete(k);await page.keyboard.up(k)}}
async function mouse(button,down){const old=button==='left'?mouseL:mouseR;if(old===down)return;if(button==='left')mouseL=down;else mouseR=down;await page.mouse[down?'down':'up']({button})}
let prev='',lastChange=0,deaths=0,oldHP=100;
for(let i=0;i<1800;i++){
 const s=await page.evaluate(()=>window.readGame());const p=s.player,alive=s.enemies.filter(e=>e.alive);
 if(p.hp>oldHP+20)deaths++;oldHP=p.hp;
 const status=alive.length+'|'+s.boss.active+'|'+s.boss.dead+'|'+s.game_state;
 if(status!==prev){console.log(JSON.stringify({seconds:i/10,status,x:p.x,y:p.y,hp:p.hp,ammo:p.ammo,bossHP:s.boss.hp,deaths}));prev=status;lastChange=i;}
 if(s.game_state==='WIN'){assert.equal(alive.length,0);assert.equal(s.boss.alive,false);assert.equal(s.rects.find(r=>r.id==='DoorExit').locked,false);console.log('INPUT_ONLY_WIN');if(process.env.PLAYTHROUGH_SCREENSHOT)await page.screenshot({path:process.env.PLAYTHROUGH_SCREENSHOT});return;}
 if(i-lastChange>800){console.log('NO_PROGRESS');break;}
 const target=alive.sort((a,c)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(c.x-p.x,c.y-p.y))[0] || (s.boss.active&&!s.boss.dead?s.boss:null);
 let tx=target?target.x:s.boss.alive?280:358,ty=target?target.y:p.y;
 const dx=tx-p.x,dy=ty-p.y,dist=Math.hypot(dx,dy);
 await page.mouse.move(Math.max(0,Math.min(1279,(tx-s.cam.x+16)*40)),Math.max(0,Math.min(719,(s.cam.y+9-ty)*40)));
 const close=target&&dist<2.65;
 await key('a',!close&&dx<-.5);await key('d',!close&&dx>.5);
 const grapple=!!target&&Math.abs(dy)>2&&dist>3&&dist<35;
 await mouse('right',grapple&&s.grapple.mode!=='stuck');
 await key('Space',!!target&&dy>1.7&&p.grounded&&!keys.has('Space'));
 await key('f',!!target&&dist<3.1&&p.st>=18&&!p.melee&&!keys.has('f'));
 await mouse('left',!!target&&dist>3.1&&dist<22&&p.ammo>0&&Math.abs(dy)<2);
 await page.clock.runFor(100);
 if(i===1799)console.log('TIMEOUT');
}
const s=await page.evaluate(()=>window.readGame());console.log(JSON.stringify({last:s.player,alive:s.enemies.filter(e=>e.alive),boss:s.boss,grapple:s.grapple}));if(process.env.PLAYTHROUGH_SCREENSHOT)await page.screenshot({path:process.env.PLAYTHROUGH_SCREENSHOT});throw new Error('Input-only controller did not reach WIN within its progression budget');
}finally{await b.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
