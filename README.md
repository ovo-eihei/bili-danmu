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
· Tab 补全命令与历史房间号
· 连接直播间 22603245 · 永雏塔菲
· 已连接
[塔菲|22]彩绫恋音: 晚上好
[塔菲|31]雏草姬 [辣条] × 10 ￥0.1
[塔菲|12]某水草: [妙]
[塔菲|28]阿草 [舰长] × 1 ￥198
[塔菲|35]小雏草 [￥30 塔菲今天也好可爱]
❯ 输入弹幕，Enter 发送
● 已连接 22603245 永雏塔菲 · 已登录 立青
Enter 发送 · Tab 补全 · /help 命令 · /close 断开
```

1. `/login` 选择登录方式：自动列出本机已安装的 Chrome/Edge/Brave/Firefox。Chromium 系通过 CDP 读取，浏览器运行时会先确认再关闭；Firefox 直接读、不用关。也可以选粘贴 Cookie（输入以 `*` 显示）或输入 Cookie 文件路径；`/login ./cookie.txt`、`/login chrome` 这类快捷写法仍可用
2. `/connect 22603245` 连接永雏塔菲的直播间，不带房间号时从连接历史里选
3. 直接输入文字回车即发送弹幕；`/close` 断开

事件输出参考 [mouse-danmu](https://github.com/ovo-liqing/mouse-danmu) 的样式：粉丝团显示为 `[名称|等级]` 并按等级着色，用户名按大航海等级着色，礼物、醒目留言按金额分档着色。用户名可点击打开 B 站个人空间，表情弹幕可点击打开表情图片（依赖终端支持 OSC 8 超链接，Windows Terminal、iTerm2 等可用；不支持的终端显示为普通文本）。

输入 `/` 会在输入框下方列出命令建议：↑↓ 选择，Tab 或 Enter 填入（命令名、`/connect` 的历史房间号、`/login` 的浏览器名），Esc 收起。日志区固定高度，调整窗口大小时按新尺寸重排、不会把终端内容顶上去；PgUp/PgDn 翻看历史弹幕，Esc 回到底部。自己发的弹幕不做本地回显，收到服务端回包后按账号 uid 匹配，整行绿色显示。

## 命令

| 命令 | 说明 |
| --- | --- |
| `/connect [房间号]` | 连接直播间，省略房间号时弹出历史选择 |
| `/history` | 最近连接过的直播间，按访问次数与时间排序 |
| `/close` | 断开当前直播间 |
| `/status` | 查看连接、登录与历史状态 |
| `/login [来源]` | 登录；省略时选择已安装的浏览器或在界面里粘贴 Cookie，也可给浏览器名、Cookie 文件路径 |
| `/logout` | 清除本地保存的登录状态 |
| `/interact` | 显示/隐藏进场、关注、分享等互动消息（默认隐藏） |
| `/help` | 命令列表 |
| `/quit` | 退出（也可 Ctrl+C） |

已连接时输入框提示「输入弹幕，Enter 发送」；未登录时发送会提示先登录。发送失败会把内容留在输入框里。

读浏览器 Cookie 的方式：Chromium 系（Chrome/Edge/Brave）把当前配置的 Cookie 数据库和 `Local State` 复制到临时配置档，用无头浏览器打开后通过 CDP 让浏览器自行解密，因此支持 Chrome/Edge 127+ 的应用绑定加密（`v20`）。读取前必须先退出浏览器：界面会先询问，确认后关闭该浏览器的所有窗口（正常退出失败时会强制结束，未保存的页面可能丢失，重启后可恢复标签页）。临时配置档在读取完成后删除。Firefox 直接读 `cookies.sqlite`，运行时也能读。

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
    completions.ts  Tab 补全（命令、房间号、浏览器名）
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
