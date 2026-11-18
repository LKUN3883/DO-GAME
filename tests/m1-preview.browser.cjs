// Validate the actual generated standalone file in Chromium's file:// context.
// No local HTTP server, no modification to public GitHub Pages.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const artifact=path.resolve(__dirname,'../test-artifacts/DO-GAME-M1-offline-preview.html');

test('M1 offline HTML includes branch game + level, no remote dependencies',()=>{
  const html=fs.readFileSync(artifact,'utf8');
  assert.match(html,/__M1_PREVIEW_LEVEL__/);
  assert.match(html,/__M1_PREVIEW_INFO__/);
  assert.match(html,/id="m1-preview-banner"/);
  assert.match(html,/level_id/);
  assert.doesNotMatch(html,/src="\.\/game\.js"/);
  assert.doesNotMatch(html,/fetch\('\.\/level_train_v1\.json'\)/);
  assert.match(html,/#m1-geometry/);
  assert.ok(Buffer.byteLength(html)>45000,'the full original game source was embedded');
});

test('M1 offline HTML actually plays from file:// in Chromium with no network',async()=>{
  const b=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const p=await b.newPage({viewport:{width:1280,height:900}});
  const errors=[],remote=[];
  p.on('pageerror',e=>errors.push(e.message));
  p.on('request',r=>{if(/^https?:/i.test(r.url()))remote.push(r.url());});
  try{
    await p.goto(pathToFileURL(artifact).href,{waitUntil:'load'});
    await p.waitForFunction(()=>window.__M1_PREVIEW_INFO__?.()?.ready===true);
    const init=await p.evaluate(()=>window.__M1_PREVIEW_INFO__());
    assert.equal(init.profile,'#m1-geometry');
    assert.equal(init.geometry,true);
    assert.equal(init.run,'RUN');
    assert.ok(Number.isFinite(init.player.x));
    assert.ok(await p.locator('#m1-preview-banner').isVisible());
    assert.ok(await p.locator('#m1-controls-list').isVisible());
    const x0=init.player.x;
    await p.keyboard.down('d');
    await p.waitForFunction(x=>window.__M1_PREVIEW_INFO__().player.x>x+0.2,x0,{timeout:5000});
    await p.keyboard.up('d');
    const moved=await p.evaluate(()=>window.__M1_PREVIEW_INFO__());
    assert.ok(moved.player.x>x0+0.2,'actual keyboard movement runs in the offline preview');
    fs.mkdirSync(path.dirname(artifact),{recursive:true});
    await p.locator('#game').screenshot({path:path.join(path.dirname(artifact),'m1-offline-preview.png')});
    assert.deepEqual(remote,[],'no external HTTP(S) traffic is required for offline play');
    assert.deepEqual(errors,[],'the offline page has no JavaScript errors');
    console.log('M1_PREVIEW_FILE_OK '+JSON.stringify({initialX:x0,movedX:moved.player.x,mode:moved.profile,networkRequests:remote.length}));
  }finally{
    await p.close();await b.close();
  }
});
