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

启动后是一个聊天式终端界面，日志区只保留最近若干行，底部固定显示输入框与状态：

```
❯ bili-danmu

· 欢迎使用 bili-danmu
· /connect [房间号] 连接直播间 · /login 登录 · /help 查看全部命令
· 连接直播间 22603245 · 永雏塔菲
· 已连接
[雏草姬|22]彩绫恋音: 晚上好
[雏草姬|31]雏草姬 [辣条] × 10 ￥0.1
[雏草姬|12]某水草: [妙]
[雏草姬|28]阿草 [舰长] × 1 ￥198
[雏草姬|35]小雏草 [￥30 塔菲今天也好可爱]
❯ 输入弹幕，Enter 发送
● 已连接 22603245 永雏塔菲 · 已登录 立青
Enter 发送 · / 命令建议 · /help
Ctrl+O 互动消息[显示/隐藏]
```

1. `/login` 先选登录方式：粘贴 Cookie（输入以 `*` 显示）、输入 Cookie 文件路径，或从本机浏览器读取。选择浏览器后列出已安装的 Chrome/Edge/Brave/Firefox；Firefox 直接读、不用关，Chromium 系运行时会先确认再关闭。新版 Chrome/Edge 的 v20 加密通常读不到，失败后请改用粘贴 Cookie。`/login ./cookie.txt`、`/login chrome` 这类快捷写法仍可用
2. `/connect 22603245` 连接永雏塔菲的直播间；不带房间号时直接列出连接历史
3. 直接输入文字回车即发送弹幕；`/close` 断开；`Ctrl+O` 切换进场、关注等互动消息的显示状态，底部常驻状态行会高亮当前挡位

事件输出参考 [mouse-danmu](https://github.com/ovo-liqing/mouse-danmu) 的样式：粉丝团显示为 `[名称|等级]` 并按等级着色，用户名按大航海等级着色，礼物、醒目留言按金额分档着色。用户名可点击打开 B 站个人空间，表情弹幕可点击打开表情图片（依赖终端支持 OSC 8 超链接，Windows Terminal、iTerm2 等可用；不支持的终端显示为普通文本）。

输入 `/` 会在输入框下方列出命令建议：↑↓ 选择，Tab 或 Enter 填入（命令名、`/connect` 的历史房间号），填入后光标停在末尾，Esc 收起。日志直接输出到终端原生滚动区，用终端自己的方式往上翻；调整窗口大小时只重绘底部输入区，历史不会被挤掉。自己发的弹幕不做本地回显，收到服务端回包后按账号 uid 匹配，整行绿色显示。

## 命令

| 命令 | 说明 |
| --- | --- |
| `/connect [房间号]` | 连接直播间，省略房间号时从历史里选 |
| `/close` | 断开当前直播间 |
| `/status` | 查看连接、登录与历史状态 |
| `/login [来源]` | 登录；省略时选择粘贴 Cookie 或从已安装的浏览器读取，也可给浏览器名、Cookie 文件路径 |
| `/logout` | 清除本地保存的登录状态 |
| `/demo` | 输出各类示例消息，查看粉丝牌、大航海、礼物、留言与互动配色 |
| `/help` | 命令列表 |
| `/quit` | 退出（也可 Ctrl+C） |

`Ctrl+O` 切换进场、关注、分享等互动消息；底部常驻行显示 `互动消息[显示/隐藏]` 并高亮当前挡位（默认隐藏）。`/demo` 可随时输出一组示例消息查看各类配色。

已连接时输入框提示「输入弹幕，Enter 发送」；未登录时发送会提示先登录。发送失败会把内容留在输入框里。

读浏览器 Cookie 的方式：Firefox 直接读 `cookies.sqlite`，运行时也能读。Chromium 系（Chrome/Edge/Brave）关闭后把 Cookie 数据库和 `Local State` 复制到临时配置档，用无头浏览器通过 CDP 解密，支持 `v10`/`v11`。Chrome/Edge 127+ 的 `v20` 应用绑定加密只能在原配置档内解密，而浏览器又禁止在默认配置档上开启远程调试，因此遇到 `v20` 会直接提示读取失败，请改用粘贴 Cookie。读取 Chromium 前必须先退出浏览器：界面会先询问，确认后关闭该浏览器的所有窗口（正常退出失败时会强制结束，未保存的页面可能丢失，重启后可恢复标签页）。

## 本地存储

配置写在系统配置目录：

- Windows：`%APPDATA%\bili-danmu-nodejs\Config\config.json`
- macOS：`~/Library/Preferences/bili-danmu-nodejs/config.json`
- Linux：`~/.config/bili-danmu-nodejs/config.json`

内容包含登录 Cookie（**明文**，Unix 上会尝试设为 0600）、账号昵称和最近 20 个直播间的连接记录。共享电脑上请用 `/logout` 清理。Cookie 不会进命令行参数，避免落入 shell 历史和进程列表。

## 非交互模式

适合脚本和重定向，默认复用已保存的登录：

```bash
bili-danmu watch 22603245                # 输出弹幕等事件
bili-danmu watch 22603245 --json         # JSON Lines
bili-danmu watch 22603245 --raw          # 原始消息 JSON
bili-danmu send 22603245 "晚上好"         # 发弹幕
```

`watch` 支持 `--cookie-file`，`send` 支持 `--cookie-file` 或环境变量 `BILI_COOKIE`，优先级：环境变量 > 文件 > 已保存登录。

## 代码中使用

```ts
import { Auth, DanmuClient, parseEvent, sendDanmu } from 'bili-danmu'

const auth = await Auth.create(22603245)
const client = new DanmuClient({
  onMessage: (message) => {
    const event = parseEvent(message)
    if (event?.type === 'danmu') {
      console.log(`${event.user.name}: ${event.body}`)
    }
  },
})
await client.connect(auth)

await sendDanmu(cookie, 22603245, '晚上好')
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
    completions.ts  Tab 补全（命令、房间号）
    browser-cookies.ts  从本机浏览器读取登录 Cookie
    store.ts        登录与连接历史持久化
    tui/            Ink 界面组件（App、EventLine、format）
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
