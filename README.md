# DO-GAME

游戏入口：`docs/index.html`。请通过 HTTP 服务运行，以便加载关卡 JSON。

```sh
npm ci
npm test
npx playwright install --with-deps chromium
npm run test:browser
```

PR #2 仍为草稿。Boss 镜头下限已按用户确认从 -13 改为 -21，并通过浏览器可见性回归；完整通关和其他未验证项仍待验收。请参阅 [运行回归与未验证项](docs/reviews/PR2-regression.md)。
