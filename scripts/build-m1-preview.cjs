#!/usr/bin/env node
// Offline M1 preview: package the CURRENT PR branch's own docs/ sources into
// one standalone HTML file. Never deploy to Pages or write docs/index.html.
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const originalHtml=read('docs/index.html');
const originalGame=read('docs/game.js');
const level=JSON.parse(read('docs/level_train_v1.json'));
const loader="  const res = await fetch('./level_train_v1.json');\n  level = await res.json();";
const moduleTag='<script type="module" src="./game.js"></script>';
const assertOnce=(value,needle,label)=>{
  if(value.split(needle).length!==2)throw Error(label+' source anchor changed; refused to build an unverified preview');
};
assertOnce(originalGame,loader,'level loader');
assertOnce(originalHtml,moduleTag,'game module');
const updatedGame=originalGame.replace(loader,'  level = window.__M1_PREVIEW_LEVEL__;');
const revision=process.env.M1_PREVIEW_REVISION||process.env.GITHUB_SHA||'local';
if(!/^(?:[0-9a-f]{7,40}|local)$/.test(revision))throw Error('unsafe preview revision');
const serializeScript=text=>text.replace(/<\/script/gi,'<\\/script');
const inlineLevel=serializeScript(JSON.stringify(level).replace(/</g,'\\u003c'));
const inlineGame=serializeScript(updatedGame);
let html=originalHtml.replace(
 '<canvas id="game"',
 '<div id="m1-preview-banner" role="status" style="padding:10px 16px;background:#293546;border-bottom:2px solid #94d8ff;color:#fff;font:14px/1.5 system-ui,sans-serif;">'
 +'DO-GAME M1 独立离线实验版 · PR 分支 <code>'+revision+'</code> · 未合并/未发布正式版本。'
 +' 下载后双击本 HTML，无需服务器或联网。关闭浏览器不会保存进度。'
 +'</div><canvas id="game"'
);
const prep='<script>if(!location.hash)location.hash="#m1-geometry";</script>\n';
assertOnce(html,'  <script>\n    // Keep guide keyboard navigation','preview profile initialization');
html=html.replace('  <script>\n    // Keep guide keyboard navigation',prep+'  <script>\n    // Keep guide keyboard navigation');
const inspect="\nwindow.__M1_PREVIEW_INFO__=()=>({ready:!!state,profile:location.hash,geometry:m1GeometryEnabled(),run:state?.game_state,player:state?{x:state.player.x,y:state.player.y,vx:state.player.vx,vy:state.player.vy}:null});\n";
html=html.replace(moduleTag,
  '<script>window.__M1_PREVIEW_LEVEL__='+inlineLevel+';</script>\n'
 +'<script>'+inlineGame+inspect+'</script>');
if(html.includes(moduleTag)||html.includes("fetch('./level_train_v1.json')"))throw Error('preview still requires a local server');
const folder=path.join(root,'test-artifacts');
fs.mkdirSync(folder,{recursive:true});
const file=path.join(folder,'DO-GAME-M1-offline-preview.html');
fs.writeFileSync(file,html,'utf8');
console.log('M1_PREVIEW_BUILT '+JSON.stringify({file:path.relative(root,file).replaceAll('\\','/'),bytes:Buffer.byteLength(html),revision,hash:'#m1-geometry',levelRects:level.rects.length}));
