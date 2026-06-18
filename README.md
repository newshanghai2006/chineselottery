# 双色球核对器 · 网页版

网页版的福彩双色球 5 组号码核对器，复刻自 `lottery.py`（Tkinter 桌面版）。
**零第三方依赖**，仅用 Node.js 内置模块，无需 `npm install`，适合直接丢到 Linux VM 上跑。

## 环境要求

- Node.js **18+**（用到全局 `fetch` 和 `AbortSignal.timeout`）。你的 VM 是 v18.19.1，满足要求。
- Linux / macOS / Windows 均可。

## 运行

```bash
cd lottery
node server.js
```

启动后默认监听 `0.0.0.0:3000`：

- 本机访问：<http://localhost:3000>
- 局域网/外部访问：`http://<虚拟机IP>:3000`

自定义端口或监听地址：

```bash
PORT=8080 HOST=0.0.0.0 node server.js
```

### 后台常驻运行（VM 上）

```bash
# 简单后台
nohup node server.js > lottery.log 2>&1 &

# 或用 systemd / pm2 等进程管理器托管
```

## 功能（与 lottery.py 一致）

- **官方最近 20 期开奖**：后端代理请求 `cwl.gov.cn` 接口（前端直连会有跨域问题，故由服务端代理），下拉选择后自动填充开奖号码。
- **自定义开奖号码**：勾选「启用自定义开奖号码」后可手动填写红/蓝球。
- **5 组自选号码**：输入框失焦时自动保存到 `lottery_config.txt`（格式与 Python 版完全兼容：`红球(空格分隔)|蓝球`，每行一组）。
- **中奖核对**：规则与 `lottery.py` 完全一致，含一~六等奖及「福运奖」，并汇总总奖金。

## 接口说明

| 方法 | 路径          | 说明                                   |
| ---- | ------------- | -------------------------------------- |
| GET  | `/api/draws`  | 拉取官方最近 20 期开奖（失败返回 `ok:false`）|
| GET  | `/api/config` | 读取已保存的 5 组号码                   |
| POST | `/api/config` | 保存 5 组号码（body: `{groups:[{red,blue}]}`）|

## 文件结构

```
lottery/
├── server.js              # Node 后端（静态服务 + API 代理 + 配置读写）
├── lottery_config.txt     # 自选号码持久化（与 Python 版共用，格式兼容）
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js             # 前端逻辑（号码解析 + 中奖规则，与 lottery.py 同步）
└── README.md
```

## 备注

官方开奖接口可能基于 IP / 请求头做风控。若 `/api/draws` 返回失败（例如 HTTP 403），
页面会提示并允许你勾选「启用自定义开奖号码」手动输入，核对功能不受影响。
在国内服务器上通常可正常拉取。
