// 双色球核对器 — 网页版后端（零依赖，Node.js 18+）
// 复刻 lottery.py 的功能：拉取官方开奖、保存自选号码、核对中奖
//
// 运行: node server.js   然后浏览器打开 http://<服务器IP>:8888
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8888;
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
// 数据源有两个，按顺序尝试，任一成功即返回：
//   1) 官方 cwl.gov.cn —— 有反爬：首次请求 302 并通过 Set-Cookie 下发反爬
//      Cookie(HMF_CI)，跳转地址是同一个 URL。Python 的 requests 自动跟随重定向
//      时会带上该 Cookie，第二跳就成功；Node 的 fetch 跟随重定向不携带 Set-Cookie，
//      所以必须手动「拿 Cookie → 带 Cookie 重试」。另外不要加 Referer/Accept，否则 403。
//      但该 WAF 会按 IP 风控——云服务器/IDC、境外 IP 常被直接 403，此时走备用源。
//   2) 备用源 500.com 历史页 —— 纯 HTML 表格，无 WAF、无 Cookie，按 IP 封锁概率低。
async function getRecentDraws(issueCount = 20) {
  const errors = [];
  try {
    return await fetchFromCwl(issueCount);
  } catch (e) {
    errors.push(`官方接口: ${e.message}`);
  }
  try {
    const draws = await fetchFrom500(issueCount);
    if (draws.length) return draws;
    errors.push('备用源 500.com: 未解析到数据');
  } catch (e) {
    errors.push(`备用源 500.com: ${e.message}`);
  }
  throw new Error(errors.join('；'));
}

// 主源：官方 cwl.gov.cn（cookie 重试 + 重试 2 次）
async function fetchFromCwl(issueCount) {
  const url = `${CWL_URL}?name=ssq&issueCount=${issueCount}&pageNo=1&pageSize=${issueCount}`;
  const baseHeaders = { 'User-Agent': 'Mozilla/5.0' };

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // 第 1 步：手动捕获 302 下发的 Cookie（不自动跟随）
      const first = await fetch(url, {
        headers: baseHeaders,
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });

      let resp = first;
      // getSetCookie() 更稳（兼容多 Set-Cookie）；回退到 get()
      const cookies =
        (first.headers.getSetCookie && first.headers.getSetCookie()) ||
        (first.headers.get('set-cookie') ? [first.headers.get('set-cookie')] : []);
      if (cookies.length) {
        const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
        // 第 2 步：带上 Cookie 重试
        resp = await fetch(url, {
          headers: { ...baseHeaders, Cookie: cookie },
          redirect: 'manual',
          signal: AbortSignal.timeout(10000),
        });
      }

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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
          source: '官方',
        };
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('未知错误');
}

// 备用源：500.com 历史页（HTML 表格解析）
async function fetchFrom500(issueCount) {
  const url = `https://datachart.500.com/ssq/history/newinc/history.php?limit=${issueCount}&sort=0`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();

  const draws = [];
  // 每一行：<tr class="t_tr1">...<td>期号</td><td>红*6</td><td>蓝</td>...<td>日期</td></tr>
  const rowRe = /<tr class="t_tr1">([\s\S]*?)<\/tr>/g;
  let row;
  while ((row = rowRe.exec(html)) !== null && draws.length < issueCount) {
    const cells = [];
    // 先去掉 HTML 注释（行首有 <!--<td>2</td>-->，会干扰列解析）
    const rowHtml = row[1].replace(/<!--[\s\S]*?-->/g, '');
    const tdRe = /<td[^>]*>(.*?)<\/td>/g; // 每行独立，避免共享 lastIndex
    let td;
    while ((td = tdRe.exec(rowHtml)) !== null) {
      cells.push(td[1].replace(/&nbsp;/g, '').replace(/<[^>]*>/g, '').trim());
    }
    if (cells.length < 9) continue;
    // 期号：500.com 用 26068 这种 5 位（YY+NNN），补全为 2026068
    let code = cells[0];
    if (/^\d{5}$/.test(code)) code = `20${code}`;
    const red = cells.slice(1, 7);
    const blue = cells[7];
    // 日期：取该行最后一个形如 YYYY-MM-DD 的单元格
    const date = [...cells].reverse().find((c) => /^\d{4}-\d{2}-\d{2}$/.test(c)) || '';
    if (red.some((r) => !/^\d{1,2}$/.test(r)) || !/^\d{1,2}$/.test(blue)) continue;
    draws.push({
      label: `${code}期 ${date}（备用源）`,
      code,
      date,
      red: red.join(' '),
      blue,
      source: '500.com',
    });
  }
  return draws;
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
