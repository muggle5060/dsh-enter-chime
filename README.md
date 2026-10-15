# dsh-enter-chime

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web UI 加两个 Codex 式的顺手体验：

- **Enter 直接批准**：审批卡（approval）出现时自动获得焦点，`Enter` = 允许一次、`Esc` = 拒绝；焦点不在卡上时 `Enter` 同样直接批准，不用再用鼠标点。
- **回答完成提示音 + 桌面通知**：主视图里的会话从「运行中」变为「已结束」时响一声（Web Audio 实时合成，不带任何音频文件）；窗口不在前台时再补一条系统通知，**通知正文就是这条回答本身**（去掉 markdown 后纯文本、约 180 字封顶，超长截断加省略号；取不到正文时回退成「回答已完成」）。

纯客户端实现，**零运行时依赖、零网络请求、Host 半边是空壳**（没有文件系统/命令/网络权限）。

> DSH client plugin: press Enter to approve a pending approval, and get a chime plus a desktop notification when the reply finishes. Client-side only, no dependencies, no bundled audio assets.

## 行为细节

- 只认 `Enter`；`Ctrl` / `⌘` / `Alt` / `Shift + Enter` 一律放行给别处（发送、换行等保持原样）。
- 焦点在 `input` / `textarea` / `select` / `contenteditable` 里时不抢键，比如侧栏搜索框、终端输入。
- 中文/日文输入法组合输入（IME）期间不触发；按住 `Enter` 不放（`event.repeat`）也只算一次。
- 审批卡已经提交（`aria-busy="true"`）后不会重复提交。
- 自动聚焦只在「焦点无处可去」时发生：焦点已经在审批卡内、或落在别的输入控件上时不会被抢走。
- 提示音只在**主视图**会话结束时响；侧栏里其它会话完成只标记未读、保持安静（沿用 DSH 自己的 `completionUnread` 语义）。
- 窗口在前台且有焦点时只响提示音、不弹系统通知。
- 通知正文取自该会话最后一条助手消息：优先用组装好的 `content` 文本块，取不到就回退到持久化的 `assistant/message.stream` 里的 `text-chunks`；两者都没有才用固定文案。读取走 `sessions.binding(id)`（借用已保留的绑定、不延长生命周期），不额外持有会话。

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
{ "enter": true, "chime": true, "notify": true, "volume": 0.3 }
```

运行时改（DevTools 控制台，改完立即生效）：

```js
__dshEnterChime.prefs()                       // 当前设置
__dshEnterChime.setPrefs({ chime: false })    // 静音
__dshEnterChime.setPrefs({ enter: false })    // 关掉 Enter 批准
__dshEnterChime.setPrefs({ volume: 0.6 })     // 音量
__dshEnterChime.chime()                       // 试听一声
__dshEnterChime.preview("**长**回答…")         // 看通知正文会被裁成什么样
```

## 自测

`test/harness.html` 是一页式自测：桩掉 `window.__ModuleLoader__`、`AudioContext`、`Notification` 和 `ctx`（含 `uiSession.sessionStatus` 与 `sessions.binding`），覆盖 19 个用例，直接用浏览器打开即可，页面会列出 PASS/FAIL。

覆盖范围：模块注册、审批卡出现即聚焦、Enter 批准（焦点在卡内走 DSH 原生路径 / 焦点在外走本插件路径）、已答不重复提交、输入框与组合键不抢键、偏好开关、主会话完成响铃、通知正文=回答正文（含 markdown 清理）、流式记录回退、无正文回退文案、超长截断、非主会话（未读）静音。

> 注意：窗口最小化或标签页在后台时浏览器会冻结 `requestAnimationFrame`，所以 harness 里把它换成了定时器；真实窗口中的自动聚焦走原生 rAF。

## 实现要点

- 浏览器半边是**无构建**的普通 JS，用 DSH 的客户端模块包装格式发布（`window.__ModuleLoader__.load({ id, factory })`），`require` 一次都没用到。
- Enter 批准有两条路径：审批卡自身只在焦点位于卡内时处理 `Enter`，所以插件一方面在卡出现时把焦点送进去（走官方路径），另一方面在文档级兜底，处理「卡在屏幕上但焦点在别处」的情况；两条路径靠 `defaultPrevented` / `aria-busy` / 禁用按钮三重条件保证只会批准一次。
- 完成信号取自 `ctx.get("uiSession").sessionStatus`：`running` 由 `true` 变 `false`、且该会话**没有**被标记 `completionUnread`，即「你正在看的这个会话干完活了」。
- 提示音用两个正弦音（C6 → G6，带指数衰减包络）合成，不引入音频资源文件；浏览器自动播放策略要求首次交互时预热一次 `AudioContext`。

## 许可

MIT，见 [LICENSE](LICENSE)。
