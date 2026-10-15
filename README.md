# dsh-enter-chime

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web UI 加三个 Codex 式的顺手体验：

- **Enter 直接批准**：审批卡（approval）出现时自动获得焦点，`Enter` = 允许一次、`Esc` = 拒绝；焦点不在卡上时 `Enter` 同样直接批准，不用再用鼠标点。
- **回答完成提示音 + 桌面通知**：主视图里的会话从「运行中」变为「已结束」时响一声（Web Audio 实时合成，不带任何音频文件）；窗口不在前台时再补一条系统通知，**通知正文就是这条回答本身**（去掉 markdown 后纯文本、约 180 字封顶，超长截断加省略号；取不到正文时回退成「回答已完成」）。
- **审批待办提醒**：审批卡出现时窗口不在前台（或你带着一张没答的审批卡切走了），响一段三音提示并弹系统通知，正文直接引用审批卡自己的标题（例如「工具 pwsh 请求越权执行」），并附一句「切回 DSH 窗口后按 Enter 允许」——因为后台窗口收不到按键，提醒的作用就是把你叫回能按 Enter 的地方。

纯客户端实现，**零运行时依赖、零网络请求、Host 半边是空壳**（没有文件系统/命令/网络权限）。

> DSH client plugin: press Enter to approve a pending approval, get a chime plus a desktop notification — carrying the reply text — when the reply finishes, and a reminder when an approval is waiting while the window is in the background. Client-side only, no dependencies, no bundled audio assets.

## 行为细节

- 只认 `Enter`；`Ctrl` / `⌘` / `Alt` / `Shift + Enter` 一律放行给别处（发送、换行等保持原样）。
- 焦点在 `input` / `textarea` / `select` / `contenteditable` 里时不抢键，比如侧栏搜索框、终端输入。
- 中文/日文输入法组合输入（IME）期间不触发；按住 `Enter` 不放（`event.repeat`）也只算一次。
- 审批卡已经提交（`aria-busy="true"`）后不会重复提交。
- 自动聚焦只在「焦点无处可去」时发生：焦点已经在审批卡内、或落在别的输入控件上时不会被抢走。
- 提示音只在**主视图**会话结束时响；侧栏里其它会话完成只标记未读、保持安静（沿用 DSH 自己的 `completionUnread` 语义）。
- 窗口在前台且有焦点时只响提示音、不弹系统通知。
- 通知正文取自该会话最后一条助手消息：优先用组装好的 `content` 文本块，取不到就回退到持久化的 `assistant/message.stream` 里的 `text-chunks`；两者都没有才用固定文案。读取走 `sessions.binding(id)`（借用已保留的绑定、不延长生命周期），不额外持有会话。
- 审批提醒只在**窗口不在前台**时发：前台时审批卡就在你眼前，不打扰。同一张未作答的审批卡只提醒一次；如果你是在 DSH 里看着它出现、然后切走，那一下 `blur` 会补上提醒。
- 审批提醒用一段上扬的三音（A5 → D6 → G6），和完成提示音（C6 → G6）区分得开。

## 已知限制：后台窗口收不到按键

窗口失去焦点时，操作系统不会把键盘事件送给它——这是浏览器/Electron 渲染进程的硬限制，不是插件偷懒。这个应用也没有可用的绕道：

- `lib/main.js`（Electron 主进程）的 import 里没有 `globalShortcut`，整个 app.asar 里 `globalShortcut` 出现 0 次 → 桌面端从未注册系统级快捷键，插件无从挂接。
- 暴露给页面的桥 `dshDesktop` 只有 `browser / deviceInfo / keyboard / shortcuts / updates`，没有聚焦窗口、置顶、闪烁任务栏的入口。
- DSH 的 Host 跑在独立 Node 进程里，够不到 `BrowserWindow`。

所以「窗口在后台时按 Enter 批准」需要改 Electron 主进程（`lib/main.js`，在 app.asar 里），那会被应用自动更新覆盖，而且全局劫持裸 `Enter` 会污染所有其它软件。本插件的取舍是：**后台时把你叫回来**（审批待办提醒），**回到窗口后一次 `Enter` 就能过**。

## 安装

需要 DSH `0.2.0-rc.2` 或同代的客户端模块加载器（`dsh.client` + `exports["./client"]`）。

```powershell
# 1) 取到源码
git clone https://github.com/<your-name>/dsh-enter-chime.git
cd dsh-enter-chime

# 2) 装进你的 profile（把 desktop 换成你自己的 profile 名）
dsh plugin --profile desktop add link:<上面 clone 下来的绝对路径>
```

也可以直接在 DSH 的「设置 → 插件」里安装本地目录。安装后**刷新页面**（`Ctrl+R`）客户端半边才会进图；插件是宿主 + 浏览器双半边的包，通常只需刷新，实在没生效就重启一次 DSH。

## 偏好设置

存在 `localStorage["dsh.enter-chime.v1"]`，没有设置界面（有意为之：不往设置面板塞 React 组件）：

```json
{ "enter": true, "chime": true, "notify": true, "approvalAlert": true, "volume": 0.3 }
```

- `enter`：Enter 批准开关；`chime`：完成提示音；`notify`：是否弹系统通知（完成通知与审批通知共用）。
- `approvalAlert`：审批待办提醒的总开关（提示音 + 通知）。
- `volume`：合成音量。

运行时改（DevTools 控制台，改完立即生效）：

```js
__dshEnterChime.prefs()                       // 当前设置
__dshEnterChime.setPrefs({ chime: false })    // 静音（完成提示音）
__dshEnterChime.setPrefs({ approvalAlert: false })  // 关掉审批待办提醒
__dshEnterChime.setPrefs({ enter: false })    // 关掉 Enter 批准
__dshEnterChime.setPrefs({ volume: 0.6 })     // 音量
__dshEnterChime.chime()                       // 试听完成提示音
__dshEnterChime.preview("**长**回答…")         // 看通知正文会被裁成什么样
```

## 自测

`test/harness.html` 是一页式自测：桩掉 `window.__ModuleLoader__`、`AudioContext`、`Notification` 和 `ctx`（含 `uiSession.sessionStatus` 与 `sessions.binding`），覆盖 28 个用例，直接用浏览器打开即可，页面会列出 PASS/FAIL。

覆盖范围：模块注册、审批卡出现即聚焦、Enter 批准（焦点在卡内走 DSH 原生路径 / 焦点在外走本插件路径）、已答不重复提交、输入框与组合键不抢键、偏好开关、主会话完成响铃、通知正文=回答正文（含 markdown 清理）、流式记录回退、无正文回退文案、超长截断、非主会话（未读）静音、失焦审批提醒（提示音+通知正文+标题）、同一张卡只提醒一次、前台不打扰、切走窗口补提醒、`approvalAlert:false` 全静音、`notify:false` 只留提示音。

> 注意：窗口最小化或标签页在后台时浏览器会冻结 `requestAnimationFrame`，所以 harness 里把它换成了定时器；真实窗口中的自动聚焦走原生 rAF。

## 实现要点

- 浏览器半边是**无构建**的普通 JS，用 DSH 的客户端模块包装格式发布（`window.__ModuleLoader__.load({ id, factory })`），`require` 一次都没用到。
- Enter 批准有两条路径：审批卡自身只在焦点位于卡内时处理 `Enter`，所以插件一方面在卡出现时把焦点送进去（走官方路径），另一方面在文档级兜底，处理「卡在屏幕上但焦点在别处」的情况；两条路径靠 `defaultPrevented` / `aria-busy` / 禁用按钮三重条件保证只会批准一次。
- 完成信号取自 `ctx.get("uiSession").sessionStatus`：`running` 由 `true` 变 `false`、且该会话**没有**被标记 `completionUnread`，即「你正在看的这个会话干完活了」。
- 提示音用两个正弦音（C6 → G6，带指数衰减包络）合成，不引入音频资源文件；浏览器自动播放策略要求首次交互时预热一次 `AudioContext`。

## 许可

MIT，见 [LICENSE](LICENSE)。
