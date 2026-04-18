// ============================================================
// みんなの実績 — メインアプリケーション
// ============================================================

let accessToken = null;
let caseData = [];
let thanksData = [];
let activeCategory = 'all';

// ── Google Sign-In ──
window.onload = function () {
  if (CONFIG.GOOGLE_CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com') {
    document.getElementById('loginError').textContent =
      'config.js の GOOGLE_CLIENT_ID を設定してください';
    document.getElementById('loginError').style.display = 'block';
    return;
  }

  google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    callback: handleTokenResponse,
    error_callback: (err) => {
      showLoginError('ログインに失敗しました: ' + (err.message || err.type));
    }
  });

  document.getElementById('googleSignInBtn').innerHTML = `
    <button class="google-btn" onclick="requestLogin()">
      <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
      Googleアカウントでログイン
    </button>
  `;

  // Tab switching
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.getElementById(tab.dataset.tab).classList.add('active');
      tab.classList.add('active');
    });
  });

  // Search listeners
  document.getElementById('caseSearch').addEventListener('input', filterCases);
  document.getElementById('thanksSearch').addEventListener('input', filterThanks);
  document.getElementById('thanksPeriod').addEventListener('change', filterThanks);
};

let tokenClient;

function requestLogin() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
    callback: handleTokenResponse,
  });
  tokenClient.requestAccessToken();
}

async function handleTokenResponse(response) {
  if (response.error) {
    showLoginError('認証エラー: ' + response.error);
    return;
  }

  accessToken = response.access_token;

  // Get user info
  try {
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    const user = await userRes.json();

    // Domain check
    if (CONFIG.ALLOWED_DOMAINS.length > 0) {
      const domain = user.email.split('@')[1];
      if (!CONFIG.ALLOWED_DOMAINS.includes(domain)) {
        showLoginError(`${domain} ドメインではログインできません。@seichiku.org アカウントを使用してください。`);
        accessToken = null;
        return;
      }
    }

    // Show main app
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    document.getElementById('userInfo').innerHTML = `
      <img src="${user.picture || ''}" alt="" class="user-avatar">
      <span class="user-name">${user.name}</span>
      <button class="logout-btn" onclick="logout()">ログアウト</button>
    `;

    // Load data
    await loadAllData();

  } catch (err) {
    showLoginError('ユーザー情報の取得に失敗しました');
  }
}

function logout() {
  accessToken = null;
  google.accounts.oauth2.revoke(accessToken);
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('mainApp').style.display = 'none';
}

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = msg;
  el.style.display = 'block';
}

// ── Data Loading ──
async function loadAllData() {
  const loading = document.getElementById('loadingIndicator');
  loading.style.display = 'flex';

  try {
    await Promise.all([loadCaseData(), loadThanksData()]);
  } catch (err) {
    console.error('Data loading error:', err);
  } finally {
    loading.style.display = 'none';
  }
}

async function fetchSheet(spreadsheetId, sheetName, range) {
  const fullRange = `${sheetName}!${range}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(fullRange)}`;
  const res = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + accessToken }
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'シートの読み込みに失敗');
  }
  const data = await res.json();
  return data.values || [];
}

async function loadCaseData() {
  const cfg = CONFIG.SHEETS.DAILY_REPORT;
  const rows = await fetchSheet(CONFIG.SPREADSHEET_ID, cfg.name, cfg.range);

  if (rows.length <= 1) {
    caseData = [];
    initCases();
    return;
  }

  // Skip header row
  const dataRows = rows.slice(1);
  const cols = cfg.columns;

  caseData = dataRows
    .filter(row => row[cols.joyVoice] && row[cols.joyVoice].trim() !== '')
    .map(row => ({
      date: row[cols.date] || '',
      staff: row[cols.staffName] || '',
      clinic: row[cols.clinic] || '',
      category: row[cols.symptomCategory] || '未分類',
      title: row[cols.caseTitle] || row[cols.symptomCategory] || '症例',
      voice: row[cols.joyVoice] || '',
    }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  initCases();
  initRankings();
}

async function loadThanksData() {
  const cfg = CONFIG.SHEETS.THANKS;
  const ssId = CONFIG.THANKS_SPREADSHEET_ID || CONFIG.SPREADSHEET_ID;

  try {
    const rows = await fetchSheet(ssId, cfg.name, cfg.range);
    if (rows.length <= 1) {
      thanksData = [];
      initThanks();
      return;
    }

    const dataRows = rows.slice(1);
    const cols = cfg.columns;

    thanksData = dataRows
      .filter(row => row[cols.from] && row[cols.to])
      .map(row => ({
        date: row[cols.timestamp] || '',
        from: row[cols.from] || '',
        to: row[cols.to] || '',
        message: row[cols.message] || '',
      }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    initThanks();
  } catch (err) {
    console.warn('サンクスデータの読み込みをスキップ:', err.message);
    thanksData = [];
    initThanks();
  }
}

// ── Cases ──
function initCases() {
  const categories = [...new Set(caseData.map(c => c.category))].sort();
  const chipsEl = document.getElementById('categoryChips');

  chipsEl.innerHTML = `<button class="chip active" data-cat="all">すべて</button>` +
    categories.map(c => `<button class="chip" data-cat="${c}">${c}</button>`).join('');

  chipsEl.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      activeCategory = chip.dataset.cat;
      chipsEl.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      filterCases();
    });
  });

  filterCases();
}

function filterCases() {
  const query = document.getElementById('caseSearch').value.toLowerCase();
  const filtered = caseData.filter(c => {
    const matchCat = activeCategory === 'all' || c.category === activeCategory;
    const matchQ = !query ||
      c.title.toLowerCase().includes(query) ||
      c.staff.toLowerCase().includes(query) ||
      c.clinic.toLowerCase().includes(query) ||
      c.voice.toLowerCase().includes(query) ||
      c.category.toLowerCase().includes(query);
    return matchCat && matchQ;
  });

  document.getElementById('resultCount').textContent = `${filtered.length} 件の症例`;
  const grid = document.getElementById('caseGrid');
  const empty = document.getElementById('caseEmpty');

  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  grid.innerHTML = filtered.map(c => `
    <div class="case-card">
      <span class="category-badge">${escHtml(c.category)}</span>
      <h3>${escHtml(c.title)}</h3>
      <div class="meta">${escHtml(c.date)} ｜ ${escHtml(c.staff)}（${escHtml(c.clinic)}）</div>
      <div class="voice"><p>${escHtml(c.voice)}</p></div>
    </div>
  `).join('');
}

// ── Rankings ──
function initRankings() {
  // Staff ranking
  const staffCounts = {};
  caseData.forEach(c => {
    if (!staffCounts[c.staff]) staffCounts[c.staff] = { count: 0, clinic: c.clinic };
    staffCounts[c.staff].count++;
  });
  const staffRank = Object.entries(staffCounts)
    .map(([name, d]) => ({ name, count: d.count, clinic: d.clinic }))
    .sort((a, b) => b.count - a.count);

  document.getElementById('staffRanking').innerHTML = staffRank.length === 0
    ? '<div class="empty-state"><p>データがありません</p></div>'
    : staffRank.map((s, i) => rankItem(i, s.name, s.clinic, s.count, '件')).join('');

  // Clinic ranking
  const clinicCounts = {};
  caseData.forEach(c => { clinicCounts[c.clinic] = (clinicCounts[c.clinic] || 0) + 1; });
  const clinicRank = Object.entries(clinicCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  document.getElementById('clinicRanking').innerHTML = clinicRank.length === 0
    ? '<div class="empty-state"><p>データがありません</p></div>'
    : clinicRank.map((c, i) => rankItem(i, c.name, '', c.count, '件')).join('');
}

function rankItem(i, name, detail, count, unit) {
  return `
    <div class="ranking-item">
      <div class="rank">${i + 1}</div>
      <div class="info">
        <div class="name">${escHtml(name)}</div>
        ${detail ? `<div class="detail">${escHtml(detail)}</div>` : ''}
      </div>
      <div style="text-align:right">
        <div class="count">${count}</div>
        <div class="count-label">${unit}</div>
      </div>
    </div>`;
}

// ── Thanks ──
function initThanks() {
  // Build period options
  const periods = [...new Set(thanksData.map(t => {
    const d = t.date.substring(0, 7); // YYYY-MM
    return d.match(/^\d{4}-\d{2}$/) ? d : null;
  }).filter(Boolean))].sort().reverse();

  const sel = document.getElementById('thanksPeriod');
  sel.innerHTML = '<option value="all">全期間</option>' +
    periods.map(p => {
      const [y, m] = p.split('-');
      return `<option value="${p}">${y}年${parseInt(m)}月</option>`;
    }).join('');

  filterThanks();
}

function filterThanks() {
  const query = document.getElementById('thanksSearch').value.toLowerCase();
  const period = document.getElementById('thanksPeriod').value;

  const filtered = thanksData.filter(t => {
    const matchP = period === 'all' || t.date.startsWith(period);
    const matchQ = !query ||
      t.from.toLowerCase().includes(query) ||
      t.to.toLowerCase().includes(query) ||
      t.message.toLowerCase().includes(query);
    return matchP && matchQ;
  });

  renderThanksSummary(filtered);

  document.getElementById('thanksGrid').innerHTML = filtered.length === 0
    ? '<div class="empty-state" style="grid-column:1/-1;"><div class="icon">💛</div><p>サンクスデータがありません</p></div>'
    : filtered.map(t => `
    <div class="thanks-card">
      <div class="thanks-header">
        <div class="from-to">${escHtml(t.from)}<span class="arrow">→</span>${escHtml(t.to)}</div>
        <div class="date">${escHtml(t.date)}</div>
      </div>
      <div class="message">${escHtml(t.message)}</div>
    </div>
  `).join('');
}

function renderThanksSummary(data) {
  const receiveCounts = {};
  data.forEach(t => { receiveCounts[t.to] = (receiveCounts[t.to] || 0) + 1; });
  const topReceiver = Object.entries(receiveCounts).sort((a, b) => b[1] - a[1])[0];

  document.getElementById('thanksSummary').innerHTML = `
    <div class="summary-card"><div class="number">${data.length}</div><div class="label">サンクス総数</div></div>
    <div class="summary-card"><div class="number">${new Set(data.map(t => t.from)).size}</div><div class="label">送った人数</div></div>
    <div class="summary-card"><div class="number">${topReceiver ? escHtml(topReceiver[0]) : '-'}</div><div class="label">最多受賞者</div></div>
    <div class="summary-card"><div class="number">${topReceiver ? topReceiver[1] : 0}</div><div class="label">最多受賞数</div></div>
  `;
}

// ── Utility ──
function escHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
