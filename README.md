# DSH QQ Reply Plugin

一个供 DSH 桌面端与 Android 端使用的 DSH 插件：通过同一台主机上运行的 NapCat OneBot v11 接口收取 QQ 消息，由 DSH 中选择的模型生成回复。插件同时提供侧栏、单群试用、全群与好友私聊路由、消息去重、图片/合并转发/文件工具和人工登录状态检查。

> 本插件不会安装 QQ、DSH 或 NapCat，也不会绕过 QQ 登录验证。聊天回复会真实发送到 QQ。安装后默认不绑定任何 QQ 群，不会自动接管已有聊天；全 QQ 模式必须在手机或电脑的 DSH 侧栏中明确启用。

## 平台和前置条件

- DSH 引擎和 Web 客户端（桌面浏览器或 Android DSH 客户端）。
- 同一台设备或主机上可访问的 NapCat OneBot v11 HTTP 服务。建议只监听 `127.0.0.1`。
- DSH 的 Node.js 运行时需提供 Node 22+，以及 DSH 自带的 `@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-llm` 等依赖。
- 桌面端可在 Windows、Linux 或 macOS 运行；Android 端由 DSH 的 Android/Termux 运行环境执行服务端代码。
- 若 DSH 与 NapCat 分属不同 Android 应用沙盒，需按该系统支持的方式，让 DSH 读取 OneBot 配置文件；不要把认证文件或 token 发到公开位置。跨设备远程 NapCat 不在本插件的支持范围内。

同一份源码适用于 DSH 支持的桌面和 Android Web 客户端。服务端安装目录由 DSH 管理，不需要在手机上安装 Jarvis。

## 安装

### ZIP 安装

下载 GitHub Releases 中的 `dsh-qq-reply-plugin-0.4.0.zip`，在 DSH 的插件管理器导入 ZIP。若当前 DSH 版本不支持 ZIP 导入，可按下方源码安装。

### 源码安装

将解压后的 `dsh-qq-reply-plugin` 插件目录放进 DSH 当前 Web profile 的 `plugins` 目录，保留其中的 `.js`、`.mjs`、`package.json` 文件。不要把整个源码目录放进 `node_modules`。

在 DSH 的 Cordis 插件配置中添加：

```yaml
- insert:
    - id: dsh-chat-phone
      name: 'file:///绝对路径/dsh-qq-reply-plugin/index.js'
      config:
        onebotConfig: '/绝对路径/onebot11.json'
        onebotUrl: 'http://127.0.0.1:3000'
        webuiConfig: '/绝对路径/webui.json'
        webuiUrl: 'http://127.0.0.1:6099'
        allowedGroups: []
```

编辑完后重启 DSH 引擎并刷新客户端。也可以设置 `napcatConfigDir` 让插件从该目录中自动选择启用的 OneBot HTTP 配置；`onebotConfig` 优先级更高。所有路径必须是 DSH 服务进程实际可读的绝对路径。

Windows YAML 示例：

```yaml
        onebotConfig: 'C:/Users/you/AppData/NapCat/config/onebot11_123456789.json'
        webuiConfig: 'C:/Users/you/AppData/NapCat/config/webui.json'
```

Android 示例应使用设备上实际路径，例如可访问的 DSH 私有目录或经过授权的共享目录；不要照抄 Termux 私有路径，也不要在本仓库保存配置文件。

## 配置

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `onebotConfig` | 是，或设置 `napcatConfigDir` | NapCat OneBot JSON。插件从中读取当前端口对应的 token，不写入 GitHub 或日志。 |
| `napcatConfigDir` | 否 | 自动寻找启用的 OneBot HTTP 配置文件的目录。 |
| `onebotUrl` | 否 | OneBot HTTP 地址，默认 `http://127.0.0.1:3000`。仅允许 loopback HTTP。 |
| `webuiConfig` | 否 | NapCat WebUI JSON。提供后可查看 QQ 登录状态、二维码和人工恢复；不配置时仍可使用 OneBot 消息功能。 |
| `webuiUrl` | 否 | NapCat WebUI 地址，默认 `http://127.0.0.1:6099`。仅允许 loopback HTTP。 |
| `eventServerName` | 否 | 认证 OneBot WebSocket 服务名称，默认 `dsh-chat-phone-events`。 |
| `eventUrl` | 否 | 认证 WebSocket loopback 地址；端口须与 OneBot 配置一致。留空时从配置读取。 |
| `allowedGroups` | 否 | 首次单群绑定允许的群号列表，默认 `[]`，表示不允许绑定任何群；只有机主明确启用全 QQ 后才会扩展范围。 |
| `mediaContainer` | 否 | NapCat 容器映射根目录；未配置时只禁用依赖本机映射的文件上传/本地路径读取，普通聊天和可公开读取的 QQ 图片仍可用。 |
| `loginLogPath` | 否 | 可选 NapCat 登录日志路径，仅用于显示登录服务故障提示。 |
| `restartCommand`, `restartArgs` | 否 | 可选人工触发的重启命令和参数。不配置时插件不会尝试重启 NapCat。 |
| `mediaPathPrefix` | 有媒体目录时建议设置 | NapCat 可见的绝对路径前缀，对应 `mediaContainer` 镜像目录。Android PRoot 常用 `/`；桌面端填写 NapCat 文件目录，例如 `C:/NapCat`。Windows 使用本机共享路径前必须设置。 |
| `mediaUploadDir` | 否 | NapCat 可见的绝对文件发送目录，默认是 `mediaPathPrefix/root/dsh-chat-phone-transfer`；它必须位于前缀映射目录下，并能被 NapCat 读取。 |

`mediaContainer` 是主机上的本地镜像根目录；该目录内相对路径需与 `mediaPathPrefix` 下 NapCat 可见路径一致。比如桌面端可令 `mediaContainer` 和 `mediaPathPrefix` 都指向 NapCat 数据目录；Android PRoot 可把容器根目录映射到 `/`。发送文件时使用 `mediaUploadDir` 指定 NapCat 可读取的路径。

`onebotConfig`、WebUI 配置和 NapCat 状态均只在本机读取。不要提交它们，也不要将 OneBot 或 WebUI 监听到公网。运行插件的 DSH 主机需要能访问这些本机端口。

## 使用

1. 在 DSH 中选择要关联的原会话并打开侧栏“聊天手机”。
2. 单群试用时先把目标群号加到 `allowedGroups`，重启 DSH 后在原会话调用 `chat_phone_bind`。插件不会默认包含个人群号。
3. 观察消息；普通群聊可能保持安静，@ 消息和好友私聊会优先处理。模型必须调用 `chat_phone_reply` 才会发送自动回复，普通 DSH 回答不会发送到 QQ。
4. 使用全 QQ 模式前，在侧栏填写机主 QQ 号并选择原会话，再明确点击“启用所有群和好友私聊”。插件按登录 QQ 账号、群或好友隔离会话；其他联系人不能借 QQ 消息调用机主工具。
5. 可在侧栏人工暂停全部回复或某个聊天。意外退出后，发送结果不确定的消息需要核对，不会自动重发。

发送、回复和上传文件会产生真实 QQ 消息。先使用自己的测试群验证模型、账号、范围和措辞。请遵守 QQ 平台规则，并尊重聊天参与者的隐私与同意。

## 安全与平台限制

- 首次安装没有默认群和机主 QQ；机器人不会自动接受好友、入群或回复陌生人的临时会话。
- 群聊和文件内容按外部输入处理；权限按 DSH 会话和认证 QQ 身份判断，昵称、转发、截图不能赋予机主权限。
- OneBot HTTP、WebUI 和 WebSocket URL 仅允许本机 loopback。token 不写入地址分享、日志或分发包。
- 附件下载有限制域名、大小、重定向、公共 IP 和路径穿越检查；下载文件不执行。二进制文件不会被当作文本解析。
- 发送超时按“结果未知”处理，要求人工核对，避免自动重复发送。
- 不配置 NapCat WebUI 时，可用功能会降级为 OneBot 收发；二维码和账号恢复不可用。未配置 `mediaContainer` 时不支持通过 NapCat 本地路径上载附件。
- Android 设备的应用沙盒、root、SELinux、电池管理和 DSH/NapCat 进程状态会影响可用性。后台回复要求 DSH、NapCat、网络与模型 API 持续运行；本插件不承诺永久在线。

## 开发和测试

```sh
node --test phone.test.mjs media.test.mjs group-replies.test.mjs
```

测试使用模拟 QQ、DSH 会话和附件，不会向真实 QQ 发送消息。发布前运行：

```sh
npm pack --dry-run
```

## 来源与许可证

此仓库发布自本机 DSH 聊天手机插件 0.3.1 的跨平台整理版本。二维码模块 `qrcode.mjs` 保留 Kazuhiko Arase 的原始 MIT 版权声明，完整第三方许可证见 `THIRD_PARTY_NOTICES.md`。其余插件源码按仓库根目录 `LICENSE` 许可。DSH、NapCat、QQ 和任何运行时依赖各自遵循其原有许可证及平台条款。
