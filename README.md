# DO-GAME

游戏入口：`docs/index.html`。请通过 HTTP 服务运行，以便加载关卡 JSON。

```sh
npm ci
npm test
npx playwright install --with-deps chromium
npm run test:browser
```

PR #2 仍为草稿。浏览器已复现 Boss 镜头将玩家和 Boss 移出画面的阻断问题，相关测试会失败；请参阅 [运行回归与未验证项](docs/reviews/PR2-regression.md)。
