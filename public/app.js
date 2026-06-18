'use strict';

// -------------------------- 中奖规则（与 lottery.py 完全一致，含福运奖）--------------------------
function checkWin(ownRed, ownBlue, winRed, winBlue) {
  const winRedSet = new Set(winRed);
  const redHit = ownRed.filter((n) => winRedSet.has(n)).length;
  const blueHit = ownBlue === winBlue ? 1 : 0;

  if (redHit === 6 && blueHit === 1) return ['一等奖', 10000000];
  if (redHit === 6 && blueHit === 0) return ['二等奖', 5000000];
  if (redHit === 5 && blueHit === 1) return ['三等奖', 3000];
  if ((redHit === 5 && blueHit === 0) || (redHit === 4 && blueHit === 1)) return ['四等奖', 200];
  if ((redHit === 4 && blueHit === 0) || (redHit === 3 && blueHit === 1)) return ['五等奖', 10];
  if (redHit <= 2 && blueHit === 1) return ['六等奖', 5];
  if (redHit === 3 && blueHit === 0) return ['福运奖', 5];
  return ['未中奖', 0];
}

// -------------------------- 号码解析（与 lottery.py 一致）--------------------------
function parseNumInput(text) {
  text = (text || '').replace(/，/g, ' ').replace(/、/g, ' ').replace(/\n/g, ' ');
  return text
    .split(/\s+/)
    .map((p) => p.trim())
    .filter((p) => /^\d+$/.test(p))
    .map((p) => parseInt(p, 10));
}

// -------------------------- DOM 引用 --------------------------
const $ = (id) => document.getElementById(id);
const useCustom = $('useCustom');
const comboDraws = $('comboDraws');
const winRed = $('winRed');
const winBlue = $('winBlue');
const userRows = $('userRows');
const resultBox = $('result');

let drawList = [];
const entriesRed = [];
const entriesBlue = [];

// -------------------------- 构建 5 组输入行 --------------------------
for (let i = 0; i < 5; i++) {
  const row = document.createElement('div');
  row.className = 'user-row';

  const label = document.createElement('span');
  label.className = 'group-label';
  label.textContent = `第${i + 1}组`;

  const red = document.createElement('input');
  red.type = 'text';
  red.placeholder = '红球 6 个，如 1 2 3 4 5 6';
  red.style.width = '260px';

  const blueLabel = document.createElement('span');
  blueLabel.textContent = '蓝：';

  const blue = document.createElement('input');
  blue.type = 'text';
  blue.placeholder = '蓝球';
  blue.style.width = '70px';

  row.append(label, red, blueLabel, blue);
  userRows.appendChild(row);
  entriesRed.push(red);
  entriesBlue.push(blue);

  // 失焦自动保存
  red.addEventListener('blur', saveUserNumbers);
  blue.addEventListener('blur', saveUserNumbers);
}

// -------------------------- 下拉选择自动填充开奖号 --------------------------
function onDrawSelect() {
  if (useCustom.checked) return;
  const idx = comboDraws.selectedIndex;
  if (idx < 0 || idx >= drawList.length) return;
  const item = drawList[idx];
  winRed.value = item.red;
  winBlue.value = item.blue;
}

comboDraws.addEventListener('change', onDrawSelect);

// -------------------------- 切换自定义号码开关 --------------------------
function toggleCustom() {
  if (useCustom.checked) {
    winRed.readOnly = false;
    winBlue.readOnly = false;
    winRed.focus();
  } else {
    winRed.readOnly = true;
    winBlue.readOnly = true;
    onDrawSelect();
  }
}
useCustom.addEventListener('change', toggleCustom);

// -------------------------- 加载官方开奖 --------------------------
async function loadDraws() {
  comboDraws.innerHTML = '<option>加载中…</option>';
  try {
    const resp = await fetch('/api/draws');
    const data = await resp.json();
    drawList = data.draws || [];
    if (drawList.length === 0) {
      comboDraws.innerHTML = '<option>拉取失败，请启用自定义号码手动输入</option>';
      alert('拉取官方开奖失败：' + (data.error || '未知错误') + '\n请勾选「启用自定义开奖号码」手动输入。');
      return;
    }
    comboDraws.innerHTML = '';
    drawList.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = d.label;
      comboDraws.appendChild(opt);
    });
    comboDraws.selectedIndex = 0;
    onDrawSelect();
  } catch (e) {
    comboDraws.innerHTML = '<option>网络错误</option>';
    alert('请求开奖接口出错：' + e.message);
  }
}

$('btnRefresh').addEventListener('click', loadDraws);

// -------------------------- 配置读/写 --------------------------
async function loadUserNumbers() {
  try {
    const resp = await fetch('/api/config');
    const data = await resp.json();
    const groups = data.groups || [];
    for (let i = 0; i < 5; i++) {
      entriesRed[i].value = (groups[i] && groups[i].red) || '';
      entriesBlue[i].value = (groups[i] && groups[i].blue) || '';
    }
  } catch (e) {
    /* 忽略 */
  }
}

async function saveUserNumbers() {
  const groups = [];
  for (let i = 0; i < 5; i++) {
    groups.push({ red: entriesRed[i].value.trim(), blue: entriesBlue[i].value.trim() });
  }
  try {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups }),
    });
  } catch (e) {
    /* 忽略 */
  }
}

// -------------------------- 核对 --------------------------
function checkAll() {
  saveUserNumbers();

  const wr = parseNumInput(winRed.value);
  const wb = parseNumInput(winBlue.value);

  if (wr.length !== 6) return alert('开奖红球必须 6 个！');
  if (wb.length !== 1) return alert('开奖蓝球必须 1 个！');
  const winBlueNum = wb[0];

  const userNumbers = [];
  for (let i = 0; i < 5; i++) {
    const r = parseNumInput(entriesRed[i].value);
    const b = parseNumInput(entriesBlue[i].value);
    if (r.length !== 6) return alert(`第${i + 1}组红球必须 6 个！`);
    if (b.length !== 1) return alert(`第${i + 1}组蓝球必须 1 个！`);
    userNumbers.push([r, b[0]]);
  }

  let html = `🔔 开奖号码：红球 [${wr.join(', ')}] ｜ 蓝球 ${winBlueNum}\n\n`;
  let total = 0;
  userNumbers.forEach(([r, b], idx) => {
    const [prize, money] = checkWin(r, b, wr, winBlueNum);
    total += money;
    const cls = money > 0 ? 'win' : 'lose';
    html += `第${idx + 1}组：红[${r.join(', ')}] 蓝${b} → <span class="${cls}">${prize}（+${money}元）</span>\n`;
  });
  html += `\n<span class="total">💰 总奖金：${total} 元</span>`;

  resultBox.innerHTML = html;
}

$('btnCheck').addEventListener('click', checkAll);

// -------------------------- 初始化 --------------------------
toggleCustom();
loadUserNumbers();
loadDraws();
