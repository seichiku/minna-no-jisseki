// ============================================================
// みんなの実績 — メインアプリケーション
// v2.0：1日3患者構造対応 / サンクス修正 / 深掘り症例タブ追加
// ============================================================

let accessToken = null;
let caseRecords = [];   // 患者単位（1日報3患者を展開）
let dailyRecords = [];  // 日報単位（喜びの声・症状カテゴリ集計用）
let thanksData = [];
let deepDiveData = [];
let handanRecords = [];   // 植田の公開判断
let growthRanking = [];   // 成長ランキング
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
  const handanSearchEl = document.getElementById('handanSearch');
  if (handanSearchEl) handanSearchEl.addEventListener('input', filterHandan);
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
    await Promise.all([loadCaseData(), loadThanksData(), loadDeepDiveData(), loadHandanData()]);
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

// ── 判断データベース ──
async function loadHandanData() {
  try {
    // 公開判断（植田）
    const jCfg = CONFIG.HANDAN_SHEETS.PUBLIC_JUDGMENT;
    const jRows = await fetchSheet(CONFIG.HANDAN_SPREADSHEET_ID, jCfg.name, jCfg.range);
    const jc = jCfg.columns;
    handanRecords = (jRows.length <= 1 ? [] : jRows.slice(1))
      .filter(row => (row[jc.staff] || '').trim() !== '')   // ヘッダ/プレースホルダ除外
      .map(row => ({
        date: row[jc.date] || '',
        staff: row[jc.staff] || '',
        clinic: row[jc.clinic] || '',
        problemNo: row[jc.problemNo] || '',
        type: row[jc.type] || '',
        hypothesis: row[jc.hypothesis] || '',
        evidence: row[jc.evidence] || '',
        reason: row[jc.reason] || '',
        risk: row[jc.risk] || '',
        alt: row[jc.alt] || '',
        checkPrev: row[jc.checkPrev] || '',
        checkGap: row[jc.checkGap] || '',
        newHypothesis: row[jc.newHypothesis] || '',
        newEvidence: row[jc.newEvidence] || '',
        newReason: row[jc.newReason] || '',
        newRisk: row[jc.newRisk] || '',
        newAlt: row[jc.newAlt] || '',
        churnWhy: row[jc.churnWhy] || '',
        churnPivot: row[jc.churnPivot] || '',
        churnNext: row[jc.churnNext] || '',
        uedaComment: row[jc.uedaComment] || '',
        gapImprove: row[jc.gapImprove] || '',
        commentReflect: row[jc.commentReflect] || '',
      }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // 成長ランキング（先頭のタイトル/注記行を除き、データ行のみ抽出）
    const rCfg = CONFIG.HANDAN_SHEETS.GROWTH_RANKING;
    const rRows = await fetchSheet(CONFIG.HANDAN_SPREADSHEET_ID, rCfg.name, rCfg.range);
    const rc = rCfg.columns;
    growthRanking = rRows
      .filter(row => {
        const name = (row[rc.staff] || '').trim();
        if (!name || name.indexOf('担当者') >= 0 || name.indexOf('成長ランキング') >= 0 || name.indexOf('※') === 0) return false;
        return !isNaN(parseFloat(row[rc.rank])) || !isNaN(parseFloat(row[rc.scoreNow]));
      })
      .map(row => ({
        staff: row[rc.staff] || '',
        scoreNow: parseFloat(row[rc.scoreNow]) || 0,
        scorePrev: parseFloat(row[rc.scorePrev]) || 0,
        delta: parseFloat(row[rc.delta]) || 0,
        rank: parseInt(row[rc.rank], 10) || 0,
      }))
      .sort((a, b) => (b.delta - a.delta) || (b.scoreNow - a.scoreNow));
  } catch (err) {
    console.warn('判断データの読み込みをスキップ:', err.message);
    handanRecords = [];
    growthRanking = [];
  }
  initHandan();
}

function initHandan() {
  renderGrowthRanking();
  filterHandan();
}

function renderGrowthRanking() {
  const box = document.getElementById('growthRanking');
  if (!box) return;
  if (growthRanking.length === 0) {
    box.innerHTML = '<div class="empty-state"><p>ランキングデータがまだありません</p></div>';
    return;
  }
  box.innerHTML = growthRanking.map((g, i) => {
    const sign = g.delta > 0 ? '+' : '';
    const detail = `今月スコア ${g.scoreNow}（前月 ${g.scorePrev}）`;
    return `
      <div class="ranking-item">
        <div class="rank">${i + 1}</div>
        <div class="info">
          <div class="name">${escHtml(g.staff)}</div>
          <div class="detail">${escHtml(detail)}</div>
        </div>
        <div style="text-align:right">
          <div class="count">${sign}${g.delta}</div>
          <div class="count-label">伸び</div>
        </div>
      </div>`;
  }).join('');
}

function filterHandan() {
  const el = document.getElementById('handanGrid');
  if (!el) return;
  const query = (document.getElementById('handanSearch')?.value || '').toLowerCase();
  const filtered = handanRecords.filter(r => {
    if (!query) return true;
    return [r.staff, r.clinic, r.type, r.hypothesis, r.evidence, r.reason, r.risk, r.alt,
            r.checkGap, r.newHypothesis, r.churnWhy, r.uedaComment]
      .some(v => (v || '').toLowerCase().includes(query));
  });

  const countEl = document.getElementById('handanCount');
  if (countEl) countEl.textContent = `${filtered.length} 件の判断`;

  const empty = document.getElementById('handanEmpty');
  if (filtered.length === 0) {
    el.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';
  el.innerHTML = filtered.map(handanCardHtml).join('');
}

function handanCardHtml(r) {
  const typeBadge = r.type ? `<span class="category-badge">${escHtml(r.type)}</span>` : '';
  const meta = `${escHtml(r.date)} ｜ ${escHtml(r.staff)}（${escHtml(r.clinic)}）${r.problemNo ? ' ｜ ' + escHtml(r.problemNo) + 'つ目の悩み' : ''}`;

  const story = [
    storyStep('💭 仮説（原因を何と読んだか）', r.hypothesis),
    storyStep('🔎 根拠（何を見て/聞いて/触れて）', r.evidence),
    storyStep('🩹 施術を選んだ理由', r.reason),
    storyStep('⚠️ リスク／失敗条件', r.risk),
    storyStep('🔀 別案', r.alt),
    storyStep('↩️ 答え合わせ：前回の仮説どうだった', r.checkPrev),
    storyStep('📐 予想とのズレ', r.checkGap),
    storyStep('🆕 次の悩みの仮説', r.newHypothesis),
    storyStep('🔎 その根拠', r.newEvidence),
    storyStep('🩹 施術を選んだ理由', r.newReason),
    storyStep('🚪 なぜ離反したと思うか', r.churnWhy),
    storyStep('🧭 分岐点だった判断', r.churnPivot),
    storyStep('🔁 次に同じ状況ならどう変えるか', r.churnNext),
  ].join('');

  const scoreChips = [];
  if (String(r.gapImprove).trim() !== '') scoreChips.push(`<span class="thanks-pt">ギャップ改善 ${escHtml(r.gapImprove)}</span>`);
  if (String(r.commentReflect).trim() !== '') scoreChips.push(`<span class="thanks-pt">添削反映 ${escHtml(r.commentReflect)}</span>`);
  const scoreHtml = scoreChips.length ? `<div style="margin-top:10px;">${scoreChips.join(' ')}</div>` : '';

  const commentHtml = r.uedaComment ? `
    <div class="joy-voice">
      <div class="joy-label">✏️ 植田添削</div>
      <p>${escHtml(r.uedaComment)}</p>
    </div>` : '';

  return `
    <div class="case-card">
      <div class="case-head">
        ${typeBadge}
        <span class="case-meta">${meta}</span>
      </div>
      <div class="story">${story}</div>
      ${commentHtml}
      ${scoreHtml}
    </div>
  `;
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
