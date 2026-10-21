const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function game() {
  const root = path.join(__dirname, '..', '..', 'docs');
  const handlers = {};
  const labels = [];
  const context2d = new Proxy({}, {
    get(_, key) {
      if (key === 'fillText') return (value) => labels.push(String(value));
      return () => {};
    },
    set() { return true; },
  });
  const canvas = {
    getContext: () => context2d,
    getBoundingClientRect: () => ({left:0, top:0, width:1280, height:720}),
    addEventListener: (name, fn) => { handlers['canvas:'+name] = fn; },
  };
  const scope = vm.createContext({
    document: {
      getElementById: () => canvas,
      addEventListener: (name, fn) => {handlers['document:'+name] = fn;},
      hidden: false,
    },
    window: {addEventListener:(name, fn) => {handlers[name] = fn;}},
    fetch: async () => ({json: async () => JSON.parse(fs.readFileSync(path.join(root, 'level_train_v1.json'),'utf8'))}),
    performance: {now:()=>0},
    requestAnimationFrame:()=>{},
    console,
    Math,
    Map,
    Set,
  });
  vm.runInContext(fs.readFileSync(path.join(root,'game.js'),'utf8'),scope,{filename:'docs/game.js'});
  await new Promise(resolve => setImmediate(resolve));
  const run = (code) => vm.runInContext(code,scope);
  const tick = (n=1) => {for(let k=0;k<n;k++) run('updateLogic();');};
  const key = (name, down) => handlers[down?'keydown':'keyup']({code:name, preventDefault() {}});
  const mouse = (button,down) => handlers[down?'canvas:mousedown':'canvas:mouseup']({button});
  return {run,tick,key,mouse,labels,handlers};
}

module.exports = {game};
