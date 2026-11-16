# bili-danmu

哔哩哔哩直播弹幕的 TypeScript 实现，带一个交互式命令行界面：连接直播间、看弹幕、发弹幕，登录状态和连接历史都保存在本地。

## 安装

尚未发布到 npm，从仓库克隆后本地构建：

```bash
git clone https://github.com/ovo-eihei/bili-danmu.git
cd bili-danmu
pnpm install
pnpm build
npm link             # 之后可直接用 bili-danmu
```

不全局链接就在仓库里执行 `node dist/cli.mjs`。

需要 Node.js 22+ 和真终端（交互模式不支持管道输入）。

## 快速开始

```bash
bili-danmu
```

启动后是一个聊天式终端界面：

```
╭──────────────────────────────────────────────╮
│ bili-danmu                     ● 已连接 · 545068 │
│ v0.1.0 · 已登录 立青                          │
╰──────────────────────────────────────────────╯
12:21:04 [弹幕] 彩绫恋音 [德云色 2]: 晚上好
12:21:05 [礼物] 某用户 送出 小花花 ×2 ¥0.2
/connect /history /close /status /login /interact /help /quit
❯ 输入弹幕，Enter 发送
```

1. `/login` 回车后粘贴浏览器里的 Cookie（输入内容以 `*` 显示）；也可以 `/login ./cookie.txt` 读文件，或 `/login chrome|edge|brave|firefox` 直接读本机浏览器
2. `/connect 545068` 连接直播间，不带房间号时从连接历史里选
3. 直接输入文字回车即发送弹幕；`/close` 断开

## 命令

| 命令 | 说明 |
| --- | --- |
| `/connect [房间号]` | 连接直播间，省略房间号时弹出历史选择 |
| `/history` | 最近连接过的直播间，按访问次数与时间排序 |
| `/close` | 断开当前直播间 |
| `/status` | 查看连接、登录与历史状态 |
| `/login [来源]` | 登录；来源可省略（粘贴 Cookie）、写浏览器名（chrome/edge/brave/firefox）或 Cookie 文件路径 |
| `/logout` | 清除本地保存的登录状态 |
| `/interact` | 显示/隐藏进场、关注、分享等互动消息（默认隐藏） |
| `/help` | 命令列表 |
| `/quit` | 退出（也可 Ctrl+C） |

已连接时输入框提示「输入弹幕，Enter 发送」；未登录时发送会提示先登录。发送失败会把内容留在输入框里。

读浏览器 Cookie 的边界：Firefox 可直接读取；Chromium 系（Chrome/Edge/Brave）需要先关掉浏览器（运行时会独占 Cookie 数据库），且 Chrome/Edge 127+ 的应用绑定加密（`v20`）无法从外部解密，遇到时会提示改用手动粘贴。

## 本地存储

配置写在系统配置目录：

- Windows：`%APPDATA%\bili-danmu-nodejs\Config\config.json`
- macOS：`~/Library/Preferences/bili-danmu-nodejs/config.json`
- Linux：`~/.config/bili-danmu-nodejs/config.json`

内容包含登录 Cookie（**明文**，Unix 上会尝试设为 0600）、账号昵称和最近 20 个直播间的连接记录。共享电脑上请用 `/logout` 清理。Cookie 不会进命令行参数，避免落入 shell 历史和进程列表。

## 非交互模式

适合脚本和重定向，默认复用已保存的登录：

```bash
bili-danmu watch 545068                 # 输出弹幕等事件
bili-danmu watch 545068 --json          # JSON Lines
bili-danmu watch 545068 --raw           # 原始消息 JSON
bili-danmu send 545068 "晚上好"          # 发弹幕
```

`watch` 支持 `--cookie-file`，`send` 支持 `--cookie-file` 或环境变量 `BILI_COOKIE`，优先级：环境变量 > 文件 > 已保存登录。

## 代码中使用

```ts
import { Auth, DanmuClient, parseEvent, sendDanmu } from 'bili-danmu'

const auth = await Auth.create(545068)
const client = new DanmuClient({
  onMessage: (message) => {
    const event = parseEvent(message)
    if (event?.type === 'danmu') {
      console.log(`${event.user.name}: ${event.body}`)
    }
  },
})
await client.connect(auth)

await sendDanmu(cookie, 545068, '晚上好')
```

## 已支持的事件

- `DANMU_MSG`：普通弹幕、表情弹幕（`emoji`），`cmd` 带后缀也兼容
- `SEND_GIFT`：礼物（金瓜子按 1000:1 换算成元）
- `USER_TOAST_MSG`：舰长购买
- `SUPER_CHAT_MESSAGE`：醒目留言
- `INTERACT_WORD` / `INTERACT_WORD_V2`：进场、关注、分享等互动（V2 从 protobuf 字段取用户信息）

## 协议说明

- WebSocket 地址与 token 来自 `getDanmuInfo`，接口需要 wbi 签名
- 16 字节包头：总长度、头长度、协议版本、operation、sequence
- `protover: 2`（zlib），同时兼容 `3`（brotli）
- 弹幕服务器列表、断线重连（1s 起指数退避、最长 30s）和重连前刷新 token 默认开启

## 项目结构

单个 npm 包，双入口：库（`src/index.ts`）与 CLI（`src/cli/main.ts`，构建为 `dist/cli.mjs`）。

```
src/
  index.ts          库入口，导出协议、连接、事件、发送等能力
  core/             与终端无关的核心实现
    protocol.ts     封包/解包（zlib、brotli、多包）
    wbi.ts          wbi 签名
    auth.ts         token 与弹幕服务器列表
    client.ts       WebSocket 客户端与重连
    events.ts       消息解析
    send.ts         发送弹幕
    room.ts         房间号解析与房间信息
    login.ts        Cookie 校验
  cli/
    main.ts         bin 入口与子命令
    commands.ts     交互命令解析
    store.ts        登录与连接历史持久化
    tui/            Ink 界面组件
```

## 开发

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

## License

MIT
