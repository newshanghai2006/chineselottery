// 双色球核对器 — 网页版后端（零依赖，Node.js 18+）
// 复刻 lottery.py 的功能：拉取官方开奖、保存自选号码、核对中奖
//
// 运行: node server.js   然后浏览器打开 http://<服务器IP>:3000
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONFIG_FILE = path.join(__dirname, 'lottery_config.txt');

// 官方开奖接口（与 lottery.py 相同）
const CWL_URL =
  'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice';

// -------------------------- 工具函数 --------------------------
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) {
        // 防止超大请求体
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// -------------------------- 获取最近 20 期开奖 --------------------------
// 注意：cwl.gov.cn 接口有反爬——首次请求返回 302 并通过 Set-Cookie 下发一个
// 反爬 Cookie(HMF_CI)，跳转地址是同一个 URL。Python 的 requests 在自动跟随
// 重定向时会带上该 Cookie，所以第二跳就成功；而 Node 的 fetch 跟随重定向时
// 不会携带 Set-Cookie，因此必须手动完成「拿 Cookie → 带 Cookie 重试」的流程。
// 另外不要加 Referer/Accept 头，否则会被直接 403。
async function getRecentDraws(issueCount = 20) {
  const url = `${CWL_URL}?name=ssq&issueCount=${issueCount}&pageNo=1&pageSize=${issueCount}`;
  const baseHeaders = { 'User-Agent': 'Mozilla/5.0' };

  // 第 1 步：手动捕获 302 下发的 Cookie（不自动跟随）
  const first = await fetch(url, {
    headers: baseHeaders,
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  });

  let resp = first;
  const setCookie = first.headers.get('set-cookie');
  if (setCookie) {
    // 只取 "key=value" 部分（去掉 Path/Expires 等属性）
    const cookie = setCookie.split(';')[0];
    // 第 2 步：带上 Cookie 重试
    resp = await fetch(url, {
      headers: { ...baseHeaders, Cookie: cookie },
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
  }

  if (!resp.ok) throw new Error(`官方接口返回 HTTP ${resp.status}`);
  const data = await resp.json();
  const items = Array.isArray(data.result) ? data.result : [];
  return items.slice(0, issueCount).map((it) => {
    const red = String(it.red || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      label: `${it.code || ''}期 ${it.date || ''}`,
      code: it.code || '',
      date: it.date || '',
      red: red.join(' '),
      blue: String(it.blue || '').trim(),
    };
  });
}

// -------------------------- 配置文件读/写（与 lottery.py 同格式）--------------------------
// 每行: "红球(空格分隔)|蓝球"，共最多 5 行
function loadConfig() {
  const groups = [];
  try {
    const txt = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const lines = txt.split(/\r?\n/);
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const line = (lines[i] || '').trim();
      if (line.includes('|')) {
        const idx = line.indexOf('|');
        groups.push({ red: line.slice(0, idx).trim(), blue: line.slice(idx + 1).trim() });
      }
    }
  } catch (e) {
    // 文件不存在则返回空
  }
  // 补足 5 组
  while (groups.length < 5) groups.push({ red: '', blue: '' });
  return groups.slice(0, 5);
}

function saveConfig(groups) {
  const lines = [];
  for (let i = 0; i < 5; i++) {
    const g = groups[i] || { red: '', blue: '' };
    lines.push(`${(g.red || '').trim()}|${(g.blue || '').trim()}`);
  }
  fs.writeFileSync(CONFIG_FILE, lines.join('\n') + '\n', 'utf-8');
}

// -------------------------- 静态文件服务 --------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  // 防目录穿越
  const safePath = path
    .normalize(urlPath)
    .replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// -------------------------- 路由 --------------------------
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  try {
    // 获取最近开奖
    if (url === '/api/draws' && req.method === 'GET') {
      try {
        const draws = await getRecentDraws(20);
        return sendJSON(res, 200, { ok: true, draws });
      } catch (e) {
        return sendJSON(res, 200, { ok: false, error: e.message, draws: [] });
      }
    }

    // 读取已保存号码
    if (url === '/api/config' && req.method === 'GET') {
      return sendJSON(res, 200, { ok: true, groups: loadConfig() });
    }

    // 保存号码
    if (url === '/api/config' && req.method === 'POST') {
      const body = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        return sendJSON(res, 400, { ok: false, error: 'JSON 解析失败' });
      }
      const groups = Array.isArray(parsed.groups) ? parsed.groups : [];
      saveConfig(groups);
      return sendJSON(res, 200, { ok: true });
    }

    // 静态资源
    if (req.method === 'GET') return serveStatic(req, res);

    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('405 Method Not Allowed');
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`双色球核对器已启动: http://${HOST}:${PORT}  (本机访问 http://localhost:${PORT})`);
});
