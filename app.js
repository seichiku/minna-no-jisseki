// ============================================================
// みんなの実績 — メインアプリケーション
// v2.0：1日3患者構造対応 / サンクス修正 / 深掘り症例タブ追加
// ============================================================

let accessToken = null;
let caseRecords = [];   // 患者単位（1日報3患者を展開）
let dailyRecords = [];  // 日報単位（喜びの声・症状カテゴリ集計用）
let thanksData = [];
let deepDiveData = [];
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
  const ddPeriod = document.getElementById('deepDivePeriod');
  if (ddPeriod) ddPeriod.addEventListener('change', renderDeepDive);
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

  try {
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    const user = await userRes.json();

    if (CONFIG.ALLOWED_DOMAINS.length > 0) {
      const domain = user.email.split('@')[1];
      if (!CONFIG.ALLOWED_DOMAINS.includes(domain)) {
        showLoginError(`${domain} ドメインではログインできません。@seichiku.org アカウントを使用してください。`);
        accessToken = null;
        return;
      }
    }

    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    document.getElementById('userInfo').innerHTML = `
      <img src="${user.picture || ''}" alt="" class="user-avatar">
      <span class="user-name">${user.name}</span>
      <button class="logout-btn" onclick="logout()">ログアウト</button>
    `;

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
    await Promise.all([loadCaseData(), loadThanksData(), loadDeepDiveData(), loadKpiData()]);
    renderKpi();
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

// ── 日報データ読み込み（1日3患者を展開） ──
async function loadCaseData() {
  const cfg = CONFIG.SHEETS.DAILY_REPORT;
  const rows = await fetchSheet(CONFIG.SPREADSHEET_ID, cfg.name, cfg.range);

  if (rows.length <= 1) {
    caseRecords = [];
    dailyRecords = [];
    initCases();
    return;
  }

  const dataRows = rows.slice(1);
  const c = cfg.columns;

  caseRecords = [];
  dailyRecords = [];

  dataRows.forEach(row => {
    const base = {
      timestamp: row[c.timestamp] || '',
      date: row[c.date] || '',
      staff: row[c.staffName] || '',
      clinic: row[c.clinic] || '',
      role: row[c.role] || '',
      category: row[c.symptomCategory] || '未分類',
      joyVoice: row[c.joyVoice] || '',
      closingCount: row[c.closingCount] || '',
    };

    // 1日報1レコード
    if (base.staff) {
      dailyRecords.push(base);
    }

    // 深掘り対象マーカーをパース（チェックボックスの選択値が「患者①, 患者③」のように来る）
    const mark = String(row[c.deepDiveMark] || '');
    const isP1Deep = mark.includes('患者①');
    const isP2Deep = mark.includes('患者②');
    const isP3Deep = mark.includes('患者③');

    // 3患者を展開
    const patients = [
      { idx: 1, name: row[c.p1Name], treatment: row[c.p1Treatment], reaction: row[c.p1Reaction], hypothesis: row[c.p1Hypothesis], nextNote: row[c.p1NextNote], isDeepDive: isP1Deep },
      { idx: 2, name: row[c.p2Name], treatment: row[c.p2Treatment], reaction: row[c.p2Reaction], hypothesis: row[c.p2Hypothesis], nextNote: row[c.p2NextNote], isDeepDive: isP2Deep },
      { idx: 3, name: row[c.p3Name], treatment: row[c.p3Treatment], reaction: row[c.p3Reaction], hypothesis: row[c.p3Hypothesis], nextNote: row[c.p3NextNote], isDeepDive: isP3Deep },
    ];

    patients.forEach(p => {
      if (p.name && p.name.trim() !== '') {
        caseRecords.push({
          ...base,
          patientIdx: p.idx,
          patientName: p.name,
          treatment: p.treatment || '',
          reaction: p.reaction || '',
          hypothesis: p.hypothesis || '',
          nextNote: p.nextNote || '',
          isDeepDive: p.isDeepDive,
        });
      }
    });
  });

  // 日付降順
  caseRecords.sort((a, b) => (b.timestamp || b.date || '').localeCompare(a.timestamp || a.date || ''));
  dailyRecords.sort((a, b) => (b.timestamp || b.date || '').localeCompare(a.timestamp || a.date || ''));

  initCases();
  initRankings();
}

// ── サンクスデータ読み込み（pt対応） ──
async function loadThanksData() {
  const cfg = CONFIG.SHEETS.THANKS;
  try {
    const rows = await fetchSheet(CONFIG.SPREADSHEET_ID, cfg.name, cfg.range);
    if (rows.length <= 1) {
      thanksData = [];
      initThanks();
      return;
    }

    const dataRows = rows.slice(1);
    const c = cfg.columns;

    thanksData = dataRows
      .filter(row => row[c.from] && row[c.to])
      .map(row => ({
        date: row[c.timestamp] || '',
        from: row[c.from] || '',
        to: row[c.to] || '',
        points: parsePoints(row[c.points]),
        message: row[c.message] || '',
      }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    initThanks();
  } catch (err) {
    console.warn('サンクスデータの読み込みをスキップ:', err.message);
    thanksData = [];
    initThanks();
  }
}

function parsePoints(raw) {
  if (!raw) return 0;
  const m = String(raw).match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

// ── 深掘り3名データ読み込み ──
async function loadDeepDiveData() {
  const cfg = CONFIG.SHEETS.DEEP_DIVE;
  try {
    const rows = await fetchSheet(CONFIG.SPREADSHEET_ID, cfg.name, cfg.range);
    if (rows.length <= 1) {
      deepDiveData = [];
      initDeepDive();
      return;
    }

    const dataRows = rows.slice(1);
    const c = cfg.columns;

    // スタッフ × 月 で最新の宣言を取得
    const latestByStaffMonth = {};
    dataRows.forEach(row => {
      const ts = row[c.timestamp] || '';
      const staff = row[c.staffName] || '';
      const clinic = row[c.clinic] || '';
      const month = (row[c.date] || ts).substring(0, 7); // YYYY-MM or YYYY/MM
      const dd1 = (row[c.deepDive1] || '').trim();
      const dd2 = (row[c.deepDive2] || '').trim();
      const dd3 = (row[c.deepDive3] || '').trim();

      // 3名のいずれかが入力されていれば「宣言レコード」とみなす
      if (!staff || !month || (!dd1 && !dd2 && !dd3)) return;

      const key = `${staff}__${month}`;
      const cur = latestByStaffMonth[key];
      if (!cur || ts > cur.timestamp) {
        latestByStaffMonth[key] = { timestamp: ts, staff, clinic, month, patients: [dd1, dd2, dd3].filter(Boolean) };
      }
    });

    deepDiveData = Object.values(latestByStaffMonth);
    initDeepDive();
  } catch (err) {
    console.warn('深掘りデータの読み込みをスキップ:', err.message);
    deepDiveData = [];
    initDeepDive();
  }
}

// ── 症例実績 ──
function initCases() {
  const categories = [...new Set(caseRecords.map(c => c.category))].filter(Boolean).sort();
  const chipsEl = document.getElementById('categoryChips');

  chipsEl.innerHTML = `<button class="chip active" data-cat="all">すべて</button>` +
    categories.map(c => `<button class="chip" data-cat="${escAttr(c)}">${escHtml(c)}</button>`).join('');

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
  const filtered = caseRecords.filter(c => {
    const matchCat = activeCategory === 'all' || c.category === activeCategory;
    const matchQ = !query ||
      (c.patientName || '').toLowerCase().includes(query) ||
      (c.staff || '').toLowerCase().includes(query) ||
      (c.clinic || '').toLowerCase().includes(query) ||
      (c.treatment || '').toLowerCase().includes(query) ||
      (c.reaction || '').toLowerCase().includes(query) ||
      (c.hypothesis || '').toLowerCase().includes(query) ||
      (c.joyVoice || '').toLowerCase().includes(query) ||
      (c.category || '').toLowerCase().includes(query);
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

  grid.innerHTML = filtered.map(c => caseCardHtml(c)).join('');
}

function caseCardHtml(c) {
  const joyHtml = c.joyVoice ? `
    <div class="joy-voice">
      <div class="joy-label">💝 患者さまの喜びの声</div>
      <p>${escHtml(c.joyVoice)}</p>
    </div>` : '';

  return `
    <div class="case-card">
      <div class="case-head">
        <span class="category-badge">${escHtml(c.category)}</span>
        <span class="case-meta">${escHtml(c.date)} ｜ ${escHtml(c.staff)}（${escHtml(c.clinic)}）</span>
      </div>
      <h3 class="case-patient">👤 ${escHtml(c.patientName)}</h3>
      <div class="story">
        ${storyStep('🩹 施術内容', c.treatment)}
        ${storyStep('✨ 反応・結果', c.reaction)}
        ${storyStep('💭 仮説の考察', c.hypothesis)}
        ${storyStep('📝 次回への申し送り', c.nextNote)}
      </div>
      ${joyHtml}
    </div>
  `;
}

function storyStep(label, text) {
  if (!text || !text.trim()) return '';
  return `<div class="story-step"><div class="step-label">${label}</div><div class="step-text">${escHtml(text)}</div></div>`;
}

// ── ランキング ──
function initRankings() {
  // スタッフ別：喜びの声件数（joyVoiceが書かれた日報数）
  const staffCounts = {};
  dailyRecords.forEach(d => {
    if (!d.joyVoice || !d.joyVoice.trim()) return;
    if (!staffCounts[d.staff]) staffCounts[d.staff] = { count: 0, clinic: d.clinic };
    staffCounts[d.staff].count++;
  });
  const staffRank = Object.entries(staffCounts)
    .map(([name, d]) => ({ name, count: d.count, clinic: d.clinic }))
    .sort((a, b) => b.count - a.count);

  document.getElementById('staffRanking').innerHTML = staffRank.length === 0
    ? '<div class="empty-state"><p>データがありません</p></div>'
    : staffRank.map((s, i) => rankItem(i, s.name, s.clinic, s.count, '件')).join('');

  // 院別
  const clinicCounts = {};
  dailyRecords.forEach(d => {
    if (!d.joyVoice || !d.joyVoice.trim()) return;
    clinicCounts[d.clinic] = (clinicCounts[d.clinic] || 0) + 1;
  });
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

// ── サンクス ──
function initThanks() {
  const periods = [...new Set(thanksData.map(t => {
    const d = (t.date || '').substring(0, 7);
    return d.match(/^\d{4}[-/]\d{2}$/) ? d.replace('/', '-') : null;
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
    const tDate = (t.date || '').replace(/\//g, '-');
    const matchP = period === 'all' || tDate.startsWith(period);
    const matchQ = !query ||
      (t.from || '').toLowerCase().includes(query) ||
      (t.to || '').toLowerCase().includes(query) ||
      (t.message || '').toLowerCase().includes(query);
    return matchP && matchQ;
  });

  renderThanksSummary(filtered);
  renderThanksRankings(filtered);

  document.getElementById('thanksGrid').innerHTML = filtered.length === 0
    ? '<div class="empty-state" style="grid-column:1/-1;"><div class="icon">💛</div><p>サンクスデータがありません</p></div>'
    : filtered.map(t => `
    <div class="thanks-card">
      <div class="thanks-header">
        <div class="from-to">${escHtml(t.from)}<span class="arrow">→</span>${escHtml(t.to)}</div>
        <div class="date">${escHtml(t.date)}${t.points ? ` <span class="thanks-pt">${t.points}pt</span>` : ''}</div>
      </div>
      <div class="message">${escHtml(t.message)}</div>
    </div>
  `).join('');
}

function renderThanksSummary(data) {
  const receivePts = {};
  data.forEach(t => { receivePts[t.to] = (receivePts[t.to] || 0) + (t.points || 1); });
  const topReceiver = Object.entries(receivePts).sort((a, b) => b[1] - a[1])[0];
  const totalPts = data.reduce((s, t) => s + (t.points || 0), 0);

  document.getElementById('thanksSummary').innerHTML = `
    <div class="summary-card"><div class="number">${data.length}</div><div class="label">サンクス総数</div></div>
    <div class="summary-card"><div class="number">${totalPts}</div><div class="label">合計pt</div></div>
    <div class="summary-card"><div class="number">${topReceiver ? escHtml(topReceiver[0]) : '-'}</div><div class="label">pt最多受賞者</div></div>
    <div class="summary-card"><div class="number">${topReceiver ? topReceiver[1] : 0}</div><div class="label">最多獲得pt</div></div>
  `;
}

function renderThanksRankings(data) {
  const recvBox = document.getElementById('thanksReceiveRanking');
  const sendBox = document.getElementById('thanksSendRanking');
  if (!recvBox || !sendBox) return;

  const recv = {};
  const send = {};
  data.forEach(t => {
    recv[t.to] = (recv[t.to] || 0) + (t.points || 1);
    send[t.from] = (send[t.from] || 0) + (t.points || 1);
  });

  const recvRank = Object.entries(recv).map(([name, pt]) => ({ name, pt })).sort((a, b) => b.pt - a.pt);
  const sendRank = Object.entries(send).map(([name, pt]) => ({ name, pt })).sort((a, b) => b.pt - a.pt);

  recvBox.innerHTML = recvRank.length === 0
    ? '<div class="empty-state"><p>データがありません</p></div>'
    : recvRank.map((r, i) => rankItem(i, r.name, '', r.pt, 'pt')).join('');

  sendBox.innerHTML = sendRank.length === 0
    ? '<div class="empty-state"><p>データがありません</p></div>'
    : sendRank.map((r, i) => rankItem(i, r.name, '', r.pt, 'pt')).join('');
}

// ── 深掘り症例 ──
function initDeepDive() {
  const ddBox = document.getElementById('deepDive');
  if (!ddBox) return;

  const periods = [...new Set(deepDiveData.map(d => d.month).filter(Boolean))].sort().reverse();
  const sel = document.getElementById('deepDivePeriod');
  if (sel) {
    const cur = periods[0] || '';
    sel.innerHTML = periods.length === 0
      ? '<option value="">月のデータなし</option>'
      : periods.map(p => {
          const [y, m] = p.split(/[-/]/);
          return `<option value="${p}">${y}年${parseInt(m)}月</option>`;
        }).join('');
    if (cur) sel.value = cur;
  }

  renderDeepDive();
}

function renderDeepDive() {
  const sel = document.getElementById('deepDivePeriod');
  const period = sel ? sel.value : '';
  const grid = document.getElementById('deepDiveGrid');
  if (!grid) return;

  if (!period || deepDiveData.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <div class="icon">🎯</div>
        <p>深掘り3名の宣言データがまだありません。<br>
        プライムタスクフォームの「今月の深掘り3名（初回・変更時のみ）」を入力してください。</p>
      </div>`;
    return;
  }

  const monthDecl = deepDiveData.filter(d => d.month === period);

  grid.innerHTML = monthDecl.map(d => {
    // このスタッフの「深掘り対象マーク済み」だけど名前マッチしない記録を別枠で表示
    const markedOrphans = caseRecords.filter(rec => {
      if (rec.staff !== d.staff || !rec.isDeepDive || !rec.patientName) return false;
      const m = rec.patientName;
      return !d.patients.some(p => m.includes(p) || p.includes(m));
    });

    const threads = d.patients.map(pName => {
      // 患者名マッチ OR 深掘り対象マーク済みでマッチするレコード
      const records = caseRecords.filter(rec => {
        if (rec.staff !== d.staff || !rec.patientName) return false;
        const nameMatch = rec.patientName.includes(pName) || pName.includes(rec.patientName);
        return nameMatch;
      });
      const target = 4;
      const achieved = records.length >= target;
      return `
        <div class="deep-patient">
          <div class="deep-patient-head">
            <h4>👤 ${escHtml(pName)}</h4>
            <span class="deep-progress ${achieved ? 'achieved' : ''}">${records.length} / ${target} 回</span>
          </div>
          ${records.length === 0
            ? '<div class="deep-empty">この患者の経過記録がまだありません</div>'
            : `<div class="deep-thread">${records.map(r => `
                <div class="deep-step">
                  <div class="deep-step-date">${escHtml(r.date)}${r.isDeepDive ? ' <span class="deep-mark">✓深掘り対象マーク</span>' : ''}</div>
                  <div class="deep-step-body">
                    ${r.treatment ? `<p><b>施術：</b>${escHtml(r.treatment)}</p>` : ''}
                    ${r.reaction ? `<p><b>反応：</b>${escHtml(r.reaction)}</p>` : ''}
                    ${r.hypothesis ? `<p><b>仮説：</b>${escHtml(r.hypothesis)}</p>` : ''}
                  </div>
                </div>`).join('')}</div>`
          }
        </div>`;
    }).join('');

    const orphanWarn = markedOrphans.length === 0 ? '' : `
      <div class="deep-orphan">
        <b>⚠️ 注意：</b>${markedOrphans.length} 件の「深掘り対象マーク済み」記録が、宣言した3名の名前と一致していません。
        記録された患者名：${markedOrphans.map(r => escHtml(r.patientName)).join('、')}。
        宣言時の表記と日報の表記を統一すると、自動でこのスレッドに合流します。
      </div>`;

    return `
      <div class="deep-staff-card">
        <div class="deep-staff-head">
          <div>
            <h3>🧑‍⚕️ ${escHtml(d.staff)}</h3>
            <div class="meta">${escHtml(d.clinic)}</div>
          </div>
          <div class="deep-month">${escHtml(d.month)}</div>
        </div>
        ${threads}
        ${orphanWarn}
      </div>
    `;
  }).join('');
}

// ── Utility ──
function escHtml(str) {
  if (str === null || str === undefined) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}
function escAttr(str) {
  return escHtml(str).replace(/"/g, '&quot;');
}

// ============================================================
// チーム実績ダッシュボード（サブスク導線・チームファースト）
// ストック=会員名簿/回数券台帳サマリーからライブ取得
// 院予算/個人余剰=7月日計表稼働後に充填（現状は器）
// ============================================================
let kpiMember = null;   // 会員名簿サマリー grid
let kpiKaisu = null;    // 回数券台帳サマリー grid
let kpiAnalysis = null; // 分析シート「分析」タブ grid（院予算ブロック）
let kpiFlow = null;     // 分析シート「フロー（3院）」タブ grid（予約率）
let kpiAccessError = false;   // ストック(会員/回数券)共有エラー
let kpiFlowError = false;     // 分析シート共有エラー

async function loadKpiData() {
  // ストック（会員名簿・回数券台帳）
  try {
    const [m, k] = await Promise.all([
      fetchSheet(CONFIG.KPI.MEMBER_ID, CONFIG.KPI.MEMBER_SHEET, 'A1:F40'),
      fetchSheet(CONFIG.KPI.KAISU_ID, CONFIG.KPI.KAISU_SHEET, 'A1:D20'),
    ]);
    kpiMember = m;
    kpiKaisu = k;
    kpiAccessError = false;
  } catch (err) {
    console.warn('KPIストックデータ読込失敗（共有未設定の可能性）:', err);
    kpiAccessError = true;
  }
  // フロー（分析シート：院予算・予約率）
  try {
    const [an, fl] = await Promise.all([
      fetchSheet(CONFIG.KPI.ANALYSIS_ID, CONFIG.KPI.ANALYSIS_TAB, 'A1:K140'),
      fetchSheet(CONFIG.KPI.ANALYSIS_ID, CONFIG.KPI.FLOW_TAB, 'A1:E45'),
    ]);
    kpiAnalysis = an;
    kpiFlow = fl;
    kpiFlowError = false;
  } catch (err) {
    console.warn('分析シート読込失敗（共有未設定の可能性）:', err);
    kpiFlowError = true;
  }
}

function kpiFindRow(grid, val) {
  if (!grid) return null;
  for (const r of grid) { if (r && String(r[0] || '').trim() === val) return r; }
  return null;
}
function kpiNum(s) { return parseInt(String(s == null ? '' : s).replace(/[^0-9\-]/g, ''), 10) || 0; }
function kpiDisp(s) { return (s == null || s === '') ? '—' : String(s); }

function renderKpi() {
  renderKpiBudget();
  renderKpiStock();
  renderKpiOrder();
  renderKpiLeading();
  // 個人ブロックはスタッフ画面では非表示（院＋先行指標まで）
}

// 分析シートのグリッドから「院予算」テーブルを探す（[院,月予算,当月実績,達成度,残り,信号]）
function kpiFindBudget(grid) {
  if (!grid) return null;
  for (let i = 0; i < grid.length; i++) {
    const row = grid[i] || [];
    if (String(row[0]).trim() === '院' && String(row[1]).indexOf('予算') >= 0) {
      const out = [];
      for (let j = i + 1; j < grid.length; j++) {
        const r = grid[j] || [];
        const nm = String(r[0] || '').trim();
        if (!nm) break;
        out.push({ name: nm, budget: r[1], actual: r[2], rate: r[3], remain: r[4], sig: r[5] });
        if (nm === '全社') break;
      }
      return out;
    }
  }
  return null;
}

// ① 院予算（分析シートからライブ）
function renderKpiBudget() {
  const el = document.getElementById('kpiBudget');
  if (!el) return;
  if (kpiFlowError || !kpiAnalysis) {
    el.innerHTML = `<div class="kpi-note">院予算を表示するには、分析シートを @seichiku.org に閲覧共有してください。</div>`;
    return;
  }
  const budget = kpiFindBudget(kpiAnalysis);
  if (!budget || !budget.length) {
    el.innerHTML = `<div class="kpi-note">分析シートの院予算データを読み込めませんでした。</div>`;
    return;
  }
  el.innerHTML = budget.map(b => {
    const pct = Math.min(100, Math.max(0, Math.round((parseFloat(String(b.rate).replace(/[^0-9.\-]/g, '')) || 0))));
    const cls = pct >= 100 ? 'green' : (pct >= 80 ? 'live' : 'wait');
    return `
    <div class="kpi-card ${b.name === '全社' ? 'total' : ''}">
      <div class="kpi-card-label">${b.name}</div>
      <div class="kpi-card-big">${kpiDisp(b.rate)} <span class="kpi-card-unit">${b.sig || ''}</span></div>
      <div class="kpi-bar"><div class="kpi-bar-fill ${cls}" style="width:${pct}%"></div></div>
      <div class="kpi-card-sub">実績 ${kpiDisp(b.actual)} / 予算 ${kpiDisp(b.budget)}</div>
    </div>`;
  }).join('');
}

// ② ストック：サブスク（ライブ）
function renderKpiStock() {
  const meter = document.getElementById('kpiSubMeter');
  const clinicEl = document.getElementById('kpiSubClinic');
  if (!meter || !clinicEl) return;

  if (kpiAccessError || !kpiMember) {
    meter.innerHTML = `<div class="kpi-note">会員名簿サマリーを表示するには、@seichiku.org でこのアカウントに会員名簿スプレッドシートの閲覧共有が必要です。</div>`;
    clinicEl.innerHTML = '';
    return;
  }

  const goal = CONFIG.KPI.SUB_GOAL;
  const totalRow = kpiFindRow(kpiMember, '全社');
  const enrolled = totalRow ? kpiNum(totalRow[1]) : 0;
  const mrr = totalRow ? kpiDisp(totalRow[2]) : '—';
  const remain = Math.max(0, goal - enrolled);
  const pct = Math.min(100, Math.round(enrolled / goal * 100));

  meter.innerHTML = `
    <div class="kpi-meter-head">
      <span class="kpi-meter-now">${enrolled}</span>
      <span class="kpi-meter-goal">/ ${goal} 名（12月ゴール）</span>
      <span class="kpi-meter-mrr">MRR ${mrr}</span>
    </div>
    <div class="kpi-bar big"><div class="kpi-bar-fill live" style="width:${pct}%"></div></div>
    <div class="kpi-meter-foot">あと <b>${remain}</b> 名　｜　9月目標 南砂30 / 塩浜20 / 東砂9 ＝計59</div>`;

  // 院別 在籍 + MRR（9月目標つき）
  const targets = { '南砂': 30, '塩浜': 20, '東砂': 9 };
  clinicEl.innerHTML = CONFIG.KPI.CLINICS.map(c => {
    const row = kpiFindRow(kpiMember, c);
    const n = row ? kpiNum(row[1]) : 0;
    const cmrr = row ? kpiDisp(row[2]) : '—';
    const tgt = targets[c] || 0;
    const cp = tgt ? Math.min(100, Math.round(n / tgt * 100)) : 0;
    return `
      <div class="kpi-card">
        <div class="kpi-card-label">${c}院</div>
        <div class="kpi-card-big">${n}<span class="kpi-card-unit">名</span></div>
        <div class="kpi-bar"><div class="kpi-bar-fill live" style="width:${cp}%"></div></div>
        <div class="kpi-card-sub">9月目標 ${tgt}名 ｜ MRR ${cmrr}</div>
      </div>`;
  }).join('');
}

// ② ストック：オーダー回数券（施術者6名/人ゲージ・ライブ）
function renderKpiOrder() {
  const el = document.getElementById('kpiOrderGauges');
  if (!el) return;
  if (kpiAccessError || !kpiKaisu) {
    el.innerHTML = `<div class="kpi-note">回数券残高台帳サマリーの閲覧共有が必要です。</div>`;
    return;
  }
  const goal = CONFIG.KPI.ORDER_GOAL;
  el.innerHTML = CONFIG.KPI.STAFF.map(name => {
    const row = kpiFindRow(kpiKaisu, name);
    const have = row ? kpiNum(row[1]) : 0;
    const remain = Math.max(0, goal - have);
    const pct = Math.min(100, Math.round(have / goal * 100));
    const done = remain === 0;
    return `
      <div class="kpi-gauge ${done ? 'done' : ''}">
        <div class="kpi-gauge-name">${name}</div>
        <div class="kpi-gauge-num">${have}<span class="kpi-card-unit">/${goal}</span></div>
        <div class="kpi-bar"><div class="kpi-bar-fill ${done ? 'green' : 'live'}" style="width:${pct}%"></div></div>
        <div class="kpi-card-sub">${done ? '🟢 達成' : 'あと ' + remain + '名'}</div>
      </div>`;
  }).join('');
}

// ③ 先行指標（次予約クロージングはライブ、他は器）
function renderKpiLeading() {
  const el = document.getElementById('kpiLeading');
  if (!el) return;
  const now = new Date();
  function inThisMonth(d) {
    const m = String(d).match(/(\d{4})[\/\-.](\d{1,2})/);
    return m && parseInt(m[1], 10) === now.getFullYear() && parseInt(m[2], 10) === now.getMonth() + 1;
  }
  let closing = 0;
  (dailyRecords || []).forEach(r => { if (inThisMonth(r.date)) closing += kpiNum(r.closingCount); });

  // 予約率（分析シート フロー（3院）タブ：「既存/新患/再診 予約率」行・B=南砂/C=塩浜/D=東砂）
  function flowRate(kind) {
    if (!kpiFlow) return null;
    for (const row of kpiFlow) {
      if (row && String(row[0] || '').indexOf(kind + ' 予約率') >= 0) {
        return { 南砂: row[1], 塩浜: row[2], 東砂: row[3] };
      }
    }
    return null;
  }
  const yoyaku = ['既存', '新患', '再診'].map(k => ({ k, v: flowRate(k) }));

  let html = `
    <div class="kpi-card">
      <div class="kpi-card-label">次予約クロージング（今月）</div>
      <div class="kpi-card-big">${closing}<span class="kpi-card-unit">件</span></div>
      <div class="kpi-card-sub"><span class="kpi-tag live">LIVE</span></div>
    </div>`;
  yoyaku.forEach(o => {
    const v = o.v;
    const live = v && !kpiFlowError;
    const detail = live
      ? `南砂 ${kpiDisp(v.南砂)} ｜ 塩浜 ${kpiDisp(v.塩浜)} ｜ 東砂 ${kpiDisp(v.東砂)}`
      : (kpiFlowError ? '分析シート共有で表示' : '—');
    html += `
      <div class="kpi-card">
        <div class="kpi-card-label">${o.k} 予約率</div>
        <div class="kpi-card-big ${live ? '' : 'muted'}" style="font-size:18px;">${detail}</div>
        <div class="kpi-card-sub">${live ? '<span class="kpi-tag live">LIVE</span>' : '<span class="kpi-tag wait">分析シート</span>'}</div>
      </div>`;
  });
  // まだソースの無い先行指標（日報項目追加で充填）
  ['サブ提案件数', 'LINE・対面接点（目標50人）', 'ロープレ実施'].forEach(label => {
    html += `
      <div class="kpi-card">
        <div class="kpi-card-label">${label}</div>
        <div class="kpi-card-big muted">—</div>
        <div class="kpi-card-sub"><span class="kpi-tag wait">日報項目追加で充填</span></div>
      </div>`;
  });
  el.innerHTML = html;
}
