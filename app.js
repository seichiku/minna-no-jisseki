// ============================================================
// みんなの実績 — メインアプリケーション
// v2.0：1日3患者構造対応 / サンクス修正 / 深掘り症例タブ追加
// ============================================================

let __bundle = null;    // 中継APIから取得したシート束 { "<id>|<name>": [[...]] }
let caseRecords = [];   // 患者単位（1日報3患者を展開）
let dailyRecords = [];  // 日報単位（喜びの声・症状カテゴリ集計用）
let thanksData = [];
let deepDiveData = [];
let activeCategory = 'all';

// ── Google Sign-In（ID token 方式：機密スコープ不要＝未確認アプリ警告なし）──
// 認証は「Googleでログイン」の ID 確認のみ。スプレッドシートの読み取りは
// Apps Script ウェブアプリ経由で行い、ブラウザには spreadsheets 権限を要求しない。
window.onload = function () {
  if (!CONFIG.GOOGLE_CLIENT_ID || CONFIG.GOOGLE_CLIENT_ID.indexOf('YOUR_') === 0) {
    showLoginError('config.js の GOOGLE_CLIENT_ID を設定してください');
    return;
  }
  if (!CONFIG.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL.indexOf('YOUR_') === 0) {
    showLoginError('config.js の APPS_SCRIPT_URL を設定してください');
    return;
  }

  google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: handleCredential,
    auto_select: false,
  });
  google.accounts.id.renderButton(
    document.getElementById('googleSignInBtn'),
    { theme: 'outline', size: 'large', type: 'standard', text: 'signin_with', shape: 'pill', locale: 'ja' }
  );

  // Tab switching
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.getElementById(tab.dataset.tab).classList.add('active');
      tab.classList.add('active');
      logView(tab.textContent.trim());   // アクセス解析（2026-08-26）
    });
  });

  // Search listeners（該当タブが無い場合はスキップ）
  const csEl = document.getElementById('caseSearch');
  if (csEl) csEl.addEventListener('input', filterCases);
  const tsEl = document.getElementById('thanksSearch');
  if (tsEl) tsEl.addEventListener('input', filterThanks);
  const tpEl = document.getElementById('thanksPeriod');
  if (tpEl) tpEl.addEventListener('change', filterThanks);
  const ddPeriod = document.getElementById('deepDivePeriod');
  if (ddPeriod) ddPeriod.addEventListener('change', renderDeepDive);
};

// JWT（ID token）のペイロードをデコード（署名検証はサーバー側で実施）
function decodeJwt(token) {
  try {
    const part = token.split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(b64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

async function handleCredential(response) {
  const credential = response && response.credential;
  if (!credential) {
    showLoginError('ログインに失敗しました。もう一度お試しください。');
    return;
  }

  // クライアント側の早期チェック（正式な検証は Apps Script 側で実施）
  // 2026-08-27: seichiku.org ドメインに加えて個人Gmailホワイトリスト（ALLOWED_EMAILS）を許可
  const claims = decodeJwt(credential);
  if (claims && CONFIG.ALLOWED_DOMAINS.length > 0) {
    const email = (claims.email || '').toLowerCase();
    const domain = email.split('@')[1];
    const whitelisted = (CONFIG.ALLOWED_EMAILS || []).map(e => e.toLowerCase()).includes(email);
    if (!CONFIG.ALLOWED_DOMAINS.includes(domain) && !whitelisted) {
      showLoginError(`このアカウント（${claims.email || ''}）ではログインできません。@seichiku.org アカウントか、登録済みの個人Gmailを使用してください。`);
      google.accounts.id.disableAutoSelect();
      return;
    }
  }

  window.__me = { email: (claims && claims.email) || '', name: (claims && claims.name) || '' };   // アクセス解析用（2026-08-26）

  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('mainApp').style.display = 'block';
  document.getElementById('userInfo').innerHTML = `
    <img src="${(claims && claims.picture) || ''}" alt="" class="user-avatar">
    <span class="user-name">${escHtml((claims && claims.name) || '')}</span>
    <button class="logout-btn" onclick="logout()">ログアウト</button>
  `;

  await loadAllData(credential);
}

function logout() {
  google.accounts.id.disableAutoSelect();
  __bundle = null;
  caseRecords = []; dailyRecords = []; thanksData = []; deepDiveData = [];
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('mainApp').style.display = 'none';
}

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = msg;
  el.style.display = 'block';
}

// ── Data Loading ──
// Apps Script ウェブアプリに ID token を渡し、必要な全シートを一括取得する。
// Content-Type を text/plain にすることで CORS プリフライト（OPTIONS）を回避する。
async function loadAllData(credential) {
  const loading = document.getElementById('loadingIndicator');
  loading.style.display = 'flex';
  hideGlobalError();

  try {
    const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: credential,
    });
    if (!res.ok) throw new Error('サーバーへの接続に失敗しました');
    const data = await res.json();

    if (!data || !data.ok) {
      const code = data && data.error;
      if (code === 'domain_forbidden' || code === 'aud_mismatch' ||
          code === 'invalid_token' || code === 'email_unverified') {
        // 認証系エラー：ログイン画面へ戻す
        document.getElementById('mainApp').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'flex';
        showLoginError('ログインが確認できませんでした。@seichiku.org アカウントか登録済みGmailで再度お試しください。');
        google.accounts.id.disableAutoSelect();
        return;
      }
      throw new Error(code || 'データの取得に失敗しました');
    }

    __bundle = data.sheets || {};

    // loadCaseData は先行指標「次予約クロージング」用に保持（症例タブは非表示）
    await Promise.all([loadCaseData(), loadKpiData(), loadPersonalRanking()]);
    renderKpi();
    renderPersonalRanking();
    logView('チーム実績');   // 初期表示タブもアクセスログに記録（2026-08-26）
  } catch (err) {
    console.error('Data loading error:', err);
    // 2026-08-19: コンソールだけでなく画面にも失敗を出す（無言の真っ白画面を防ぐ）
    showGlobalError('データの読み込みに失敗しました：' + ((err && err.message) || err));
  } finally {
    loading.style.display = 'none';
  }
}

// ── アクセス解析: タブ閲覧を中継APIへ送信（fire-and-forget・失敗しても無害 2026-08-26）──
function logView(tabName) {
  try {
    if (!window.__me || !window.__me.email) return;
    navigator.sendBeacon(CONFIG.APPS_SCRIPT_URL,
      JSON.stringify({ v: 1, tab: tabName, email: __me.email, name: __me.name }));
  } catch (e) { /* 解析はベストエフォート */ }
}

// ── 読み込み失敗の画面表示（再読み込みボタン付き） ──
function showGlobalError(msg) {
  const el = document.getElementById('globalError');
  if (!el) return;
  el.style.display = 'block';
  el.innerHTML = `
    <div style="border:1px solid #e07070;background:#fdf1f1;color:#8a2f2f;padding:14px 16px;border-radius:10px;font-size:14px;line-height:1.7;">
      ⚠️ ${escHtml(msg)}<br>
      通信状況を確認して再試行してください。直らない場合は竹中さんへ「みんなの実績が読み込みエラー」と一報を。
      <button onclick="location.reload()" style="display:block;margin-top:10px;padding:8px 18px;border-radius:8px;border:1px solid #8a2f2f;background:#fff;color:#8a2f2f;font-weight:600;cursor:pointer;">再読み込み</button>
    </div>`;
}
function hideGlobalError() {
  const el = document.getElementById('globalError');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
}

// 中継APIから取得済みの束（__bundle）からシートを返す（旧: Sheets API 直接読み）。
// 読み取り失敗（アクセス不可）は null で返るので、その場合は例外にして
// 呼び出し側の try/catch（「共有してください」表示）に委ねる。range は互換のため受けるが未使用。
async function fetchSheet(spreadsheetId, sheetName, range) {
  const key = spreadsheetId + '|' + sheetName;
  const v = __bundle ? __bundle[key] : undefined;
  if (v == null) throw new Error('シートを取得できませんでした: ' + sheetName);
  return v;
}

// ── 日報データ読み込み（1日3患者を展開） ──
async function loadCaseData() {
  const cfg = CONFIG.SHEETS.DAILY_REPORT;
  const rows = await fetchSheet(CONFIG.SPREADSHEET_ID, cfg.name, cfg.range);

  if (rows.length <= 1) {
    caseRecords = [];
    dailyRecords = [];
    if (document.getElementById('caseGrid')) initCases();
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

  // 症例/喜びの声タブは非表示のため、要素がある時だけ描画
  if (document.getElementById('caseGrid')) initCases();
  if (document.getElementById('staffRanking')) initRankings();
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
let kpiDaily = null;    // 分析シート「日次達成」タブ grid（院別・毎日の予算達成）
let kpiTactics = null;  // 分析シート「戦術（先行指標）」タブ grid（転換提案/LINE発信/ロープレ）
let kpiAccessError = false;   // ストック(会員/回数券)共有エラー
let kpiFlowError = false;     // 分析シート共有エラー
let kpiMaster = null;         // 顧客マスタ「顧客マスタ」grid（離客フォローリスト用）
let kpiMasterError = false;   // 顧客マスタ共有エラー
let kpiKuchikomi = null;      // 週次効果測定「GBP(3店舗)」grid（口コミ回収の現状 2026-08-22）
let kpiActLog = null;         // 戦術ダッシュボード「行動ログ」grid（提案/LINE/ロープレの実行 2026-08-27）
let kpiAsa = null;            // 朝の仕込みDB grid（今日の宣言 2026-08-27）

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
  // フロー（分析シート：院予算・予約率・日次達成）
  try {
    const [an, fl, dl] = await Promise.all([
      fetchSheet(CONFIG.KPI.ANALYSIS_ID, CONFIG.KPI.ANALYSIS_TAB, 'A1:K140'),
      fetchSheet(CONFIG.KPI.ANALYSIS_ID, CONFIG.KPI.FLOW_TAB, 'A1:E45'),
      fetchSheet(CONFIG.KPI.ANALYSIS_ID, CONFIG.KPI.DAILY_TAB, 'A1:AI8'),
    ]);
    kpiAnalysis = an;
    kpiFlow = fl;
    kpiDaily = dl;
    kpiFlowError = false;
  } catch (err) {
    console.warn('分析シート読込失敗（共有未設定の可能性）:', err);
    kpiFlowError = true;
  }
  // 戦術（先行指標）：転換提案/LINE発信/ロープレ（取得できなくても他は出す）
  try {
    kpiTactics = await fetchSheet(CONFIG.KPI.ANALYSIS_ID, CONFIG.KPI.TACTICS_TAB, 'A1:F8');
  } catch (err) {
    console.warn('戦術(先行指標)読込失敗:', err);
    kpiTactics = null;
  }
  // 顧客マスタ（離客フォローリスト：氏名×院×最終来院日）
  try {
    kpiMaster = await fetchSheet(CONFIG.RIHAN.MASTER_ID, CONFIG.RIHAN.MASTER_SHEET, 'A:N');
    kpiMasterError = false;
  } catch (err) {
    console.warn('顧客マスタ読込失敗（共有未設定の可能性）:', err);
    kpiMaster = null;
    kpiMasterError = true;
  }
  // 口コミ回収（週次効果測定ダッシュボードGBPタブ：取得できなくても他は出す 2026-08-22）
  try {
    kpiKuchikomi = await fetchSheet(CONFIG.KUCHIKOMI.ID, CONFIG.KUCHIKOMI.SHEET, 'A:I');
  } catch (err) {
    console.warn('口コミ(週次GBP)読込失敗:', err);
    kpiKuchikomi = null;
  }
  // 行動ログ×朝の宣言（取得できなくても他は出す 2026-08-27）
  try {
    kpiActLog = await fetchSheet(CONFIG.ACTIONS.TAC_ID, CONFIG.ACTIONS.LOG_SHEET);
  } catch (err) {
    console.warn('行動ログ読込失敗:', err);
    kpiActLog = null;
  }
  try {
    kpiAsa = await fetchSheet(CONFIG.ACTIONS.ASA_ID, CONFIG.ACTIONS.ASA_SHEET);
  } catch (err) {
    console.warn('朝の仕込み(宣言)読込失敗:', err);
    kpiAsa = null;
  }
}

function kpiFindRow(grid, val) {
  if (!grid) return null;
  for (const r of grid) { if (r && String(r[0] || '').trim() === val) return r; }
  return null;
}
function kpiNum(s) { return parseInt(String(s == null ? '' : s).replace(/[^0-9\-]/g, ''), 10) || 0; }
function kpiDisp(s) { return (s == null || s === '') ? '—' : String(s); }

// ============================================================
// ペース計算・過去比較ヘルパー
// 「月予算に対して何%か」ではなく「今日までの予定額に乗れているか」を
// 毎日の信号にする。月の途中でも予定通りなら🟢になる。
// ============================================================
function yenFmt(n) { return '¥' + Number(Math.round(n)).toLocaleString('ja-JP'); }
function paceBand(p) { return p >= 100 ? 'green' : (p >= 90 ? 'yellow' : 'red'); }
function paceSig(p) { return p >= 100 ? '🟢' : (p >= 90 ? '🟡' : '🔴'); }

// 院の当月ペース情報（実績・今日までの予定額・着地予測・必要日額）
function clinicPace(name) {
  const fBudget = flowMetric('予算');
  const fActual = flowMetric('現在着地');
  const prog = clinicDayProgress(name);
  if (!fBudget || !fActual || !prog || !prog.total) return null;
  const budget = kpiNum(fBudget[name]);
  const actual = kpiNum(fActual[name]);
  if (!budget) return null;
  const perDay = budget / prog.total;
  const paceTarget = Math.round(perDay * prog.elapsed);   // 今日までに積んでいるはずの額
  const pacePct = paceTarget > 0 ? Math.round(actual / paceTarget * 100) : 0;
  const forecast = prog.elapsed > 0 ? Math.round(actual / prog.elapsed * prog.total) : 0;
  const fcPct = Math.round(forecast / budget * 100);
  const remainDays = Math.max(0, prog.total - prog.elapsed);
  const needPerDay = remainDays > 0 ? Math.max(0, Math.ceil((budget - actual) / remainDays)) : 0;
  const gap = actual - paceTarget;                        // ＋なら貯金、−なら巻き返し分
  return { budget, actual, perDay, paceTarget, pacePct, forecast, fcPct, remainDays, needPerDay, gap, elapsed: prog.elapsed, total: prog.total };
}

// 全社（3院合算）のペース情報
function companyPace() {
  const parts = CONFIG.KPI.CLINICS.map(clinicPace).filter(Boolean);
  if (!parts.length) return null;
  const sum = k => parts.reduce((s, p) => s + p[k], 0);
  const budget = sum('budget'), actual = sum('actual'), paceTarget = sum('paceTarget');
  const forecast = sum('forecast'), needPerDay = sum('needPerDay');
  const remainDays = Math.max.apply(null, parts.map(p => p.remainDays));
  return {
    budget, actual, paceTarget, forecast, needPerDay, remainDays,
    gap: actual - paceTarget,
    pacePct: paceTarget > 0 ? Math.round(actual / paceTarget * 100) : 0,
    fcPct: budget > 0 ? Math.round(forecast / budget * 100) : 0,
  };
}

// 'YYYY-MM' キー（offsetMonths ヶ月ずらし）
function ymKey(offsetMonths) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + (offsetMonths || 0));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
// 昨年同月の院実績（history.js の静的アーカイブから）
function clinicLastYear(name) {
  if (typeof HISTORY === 'undefined') return null;
  const m = HISTORY.clinics[ymKey(-12)];
  return (m && m[name] && m[name].total) || null;
}
// 昨年同月の個人実績（院またぎ合算）
function personLastYear(name) {
  if (typeof HISTORY === 'undefined') return null;
  const m = HISTORY.persons[ymKey(-12)];
  return (m && m[name]) || null;
}
// 個人の過去自己ベスト（アーカイブ25ヶ月中の最高月）
function personBest(name) {
  if (typeof HISTORY === 'undefined') return null;
  let best = null;
  Object.keys(HISTORY.persons).forEach(ym => {
    const v = HISTORY.persons[ym][name];
    if (v && (!best || v > best.v)) best = { v: v, ym: ym };
  });
  return best;
}
// 院の当月客単価（現在着地÷のべ来院件数）→「1日あと◯人」換算に使う
// 2026-08-20: フロータブの行名変更（患者数(今月)→総患者=のべ）。旧名はスナップショット互換のフォールバック。
function clinicUnitPrice(name) {
  const fActual = flowMetric('現在着地');
  const fPat = flowMetric('総患者') || flowMetric('患者数(今月)');
  if (!fActual || !fPat) return 0;
  const a = kpiNum(fActual[name]), p = kpiNum(fPat[name]);
  return p > 0 ? Math.round(a / p) : 0;
}
// 必要日額の「あと◯人」換算テキスト
function needAsPatients(name, needPerDay) {
  const unit = clinicUnitPrice(name);
  if (!unit || !needPerDay) return '';
  const n = Math.ceil(needPerDay / unit);
  return `（客単価換算 約${n}人）`;
}

// 院の日次累積系列（日次達成タブの % × 日割予算 → 診療日ごとの累積）
// → { points:[{x:経過%, y:予算進捗%}], last:{x,y} } / データ不足なら null
function clinicCumSeries(name) {
  if (!kpiDaily) return null;
  const pace = clinicPace(name);
  if (!pace || !pace.total) return null;
  let hi = -1;
  for (let i = 0; i < kpiDaily.length; i++) {
    if (String((kpiDaily[i] || [])[0]).trim() === '院') { hi = i; break; }
  }
  if (hi < 0) return null;
  for (let i = hi + 1; i < kpiDaily.length; i++) {
    const r = kpiDaily[i] || [];
    if (String(r[0] || '').trim() !== name) continue;
    const points = [{ x: 0, y: 0 }];
    let cum = 0, idx = 0;
    for (let d = 1; d <= 31; d++) {
      const v = r[3 + d];
      const s = (v === undefined || v === null) ? '' : String(v).trim();
      if (s === '') continue;
      const p = parseFloat(s.replace(/[^0-9.\-]/g, '')) || 0;
      cum += p / 100 * pace.perDay;
      idx++;
      points.push({ x: idx / pace.total * 100, y: cum / pace.budget * 100 });
    }
    if (points.length < 2) return null;
    return { points, last: points[points.length - 1] };
  }
  return null;
}

// 全社（3院合算）の累積系列。院ごとに休診日が違うため、
// X軸=「予算消化予定率」（その日までに積む予定だった予算÷全社予算）で合成する。
// これなら予算ペース＝ちょうど対角線になる。
function companyCumSeries() {
  if (!kpiDaily) return null;
  const clinics = CONFIG.KPI.CLINICS.map(name => {
    const pace = clinicPace(name);
    if (!pace || !pace.total) return null;
    let hi = -1;
    for (let i = 0; i < kpiDaily.length; i++) {
      if (String((kpiDaily[i] || [])[0]).trim() === '院') { hi = i; break; }
    }
    if (hi < 0) return null;
    for (let i = hi + 1; i < kpiDaily.length; i++) {
      const r = kpiDaily[i] || [];
      if (String(r[0] || '').trim() !== name) continue;
      return { row: r, perDay: pace.perDay };
    }
    return null;
  }).filter(Boolean);
  if (!clinics.length) return null;
  const totalBudget = CONFIG.KPI.CLINICS.reduce((s, n) => {
    const p = clinicPace(n); return s + (p ? p.budget : 0);
  }, 0);
  if (!totalBudget) return null;
  const points = [{ x: 0, y: 0 }];
  let cumActual = 0, cumTarget = 0;
  for (let d = 1; d <= 31; d++) {
    let any = false;
    clinics.forEach(c => {
      const v = c.row[3 + d];
      const s = (v === undefined || v === null) ? '' : String(v).trim();
      if (s === '') return;
      const p = parseFloat(s.replace(/[^0-9.\-]/g, '')) || 0;
      cumActual += p / 100 * c.perDay;
      cumTarget += c.perDay;
      any = true;
    });
    if (any) points.push({ x: cumTarget / totalBudget * 100, y: cumActual / totalBudget * 100 });
  }
  if (points.length < 2) return null;
  return { points, last: points[points.length - 1] };
}

// SVGペースチャート（依存ライブラリなし）
// seriesList: [{name, color, points:[{x,y}], proj:{x,y}|null, endLabel}]
// opts: {refLines:[{y,label}], height}
function paceChartSvg(seriesList, opts) {
  opts = opts || {};
  const W = 640, H = opts.height || 330, L = 44, R = 14, T = 14, B = 28;
  const iw = W - L - R, ih = H - T - B;
  let maxY = 108;
  seriesList.forEach(s => {
    s.points.forEach(p => { if (p.y + 6 > maxY) maxY = p.y + 6; });
    if (s.proj && s.proj.y + 6 > maxY) maxY = s.proj.y + 6;
  });
  (opts.refLines || []).forEach(rl => { if (rl.y + 6 > maxY) maxY = rl.y + 6; });
  const px = x => L + x / 100 * iw;
  const py = y => T + ih - (y / maxY) * ih;
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="pace-chart" role="img">`;
  // グリッド（縦軸25%刻み）
  for (let g = 25; g <= Math.floor(maxY / 25) * 25; g += 25) {
    svg += `<line x1="${L}" y1="${py(g)}" x2="${W - R}" y2="${py(g)}" class="pc-grid"/>`;
    svg += `<text x="${L - 6}" y="${py(g) + 4}" class="pc-ylabel">${g}%</text>`;
  }
  // 横軸ラベル
  svg += `<text x="${px(0)}" y="${H - 8}" class="pc-xlabel">月初</text>`;
  svg += `<text x="${px(50)}" y="${H - 8}" class="pc-xlabel" text-anchor="middle">月半ば</text>`;
  svg += `<text x="${px(100)}" y="${H - 8}" class="pc-xlabel" text-anchor="end">月末</text>`;
  // 予算ペースの対角線
  svg += `<line x1="${px(0)}" y1="${py(0)}" x2="${px(100)}" y2="${py(100)}" class="pc-diagonal"/>`;
  svg += `<text x="${px(72)}" y="${py(72) - 8}" class="pc-diagonal-label" text-anchor="middle">予算ペース</text>`;
  // 参照線（昨年着地など）
  (opts.refLines || []).forEach(rl => {
    svg += `<line x1="${L}" y1="${py(rl.y)}" x2="${W - R}" y2="${py(rl.y)}" class="pc-refline"/>`;
    svg += `<text x="${W - R}" y="${py(rl.y) - 5}" class="pc-reflabel" text-anchor="end">${rl.label}</text>`;
  });
  // 系列
  const endLabels = [];
  seriesList.forEach(s => {
    const pts = s.points.map(p => `${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ');
    if (s.proj) {
      const lp = s.points[s.points.length - 1];
      svg += `<line x1="${px(lp.x)}" y1="${py(lp.y)}" x2="${px(s.proj.x)}" y2="${py(s.proj.y)}" class="pc-proj" style="stroke:${s.color}"/>`;
      svg += `<circle cx="${px(s.proj.x)}" cy="${py(s.proj.y)}" r="3.5" fill="none" style="stroke:${s.color}" stroke-width="1.5" stroke-dasharray="2 2"/>`;
    }
    svg += `<polyline points="${pts}" class="pc-line" style="stroke:${s.color}"/>`;
    const lp = s.points[s.points.length - 1];
    svg += `<circle cx="${px(lp.x)}" cy="${py(lp.y)}" r="4.5" style="fill:${s.color}"/>`;
    if (s.endLabel) endLabels.push({ x: lp.x, y: py(lp.y) - 8, label: s.endLabel, color: s.color });
  });
  // 終端ラベルの重なり回避（近いものを上下にずらす）
  endLabels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < endLabels.length; i++) {
    if (endLabels[i].y - endLabels[i - 1].y < 16) endLabels[i].y = endLabels[i - 1].y + 16;
  }
  endLabels.forEach(el2 => {
    const anchor = el2.x > 78 ? 'end' : 'start';
    const dx = el2.x > 78 ? -10 : 10;
    svg += `<text x="${px(el2.x) + dx}" y="${el2.y}" class="pc-endlabel" text-anchor="${anchor}" style="fill:${el2.color}">${el2.label}</text>`;
  });
  svg += '</svg>';
  return svg;
}

const CLINIC_COLORS = { '南砂': '#2f6fed', '塩浜': '#00a58e', '東砂': '#e07a00' };

function renderKpi() {
  renderKpiHero();       // 全社着地予測ヒーロー
  renderKpiPaceChart();  // 3院ペースチャート
  renderKpiBudget();     // 院別ペースカード
  renderKpiFlowTable();  // 当月フロー指標表
  renderKpiLeading();    // 先行指標
  renderKpiStock();      // ストックタブ：サブスク
  renderKpiSubStaff();   // ストックタブ：サブスク施術者別（当月サブ消化の担当会員数 2026-08-26）
  renderKpiOrder();      // ストックタブ：オーダー回数券
  renderKpiChurn();      // ストックタブ：離脱（サブスク解約・回数券未更新 2026-08-26）
  renderKpiOpt();        // ストックタブ：オプションチケット（施術者別保有 2026-08-21）
  renderClinicPages();   // 各院ページ（ペースチャート・日次達成・個人マイルストーン等）
}

// ① 全社ヒーロー：着地予測を主役に（「行けるかも」の起点）
function renderKpiHero() {
  const el = document.getElementById('kpiHero');
  if (!el) return;
  if (kpiFlowError || !kpiFlow) {
    el.innerHTML = `<div class="kpi-note">チーム実績を表示するには、分析シートを @seichiku.org に閲覧共有してください。</div>`;
    return;
  }
  const cp = companyPace();
  if (!cp) { el.innerHTML = `<div class="kpi-note">データが溜まると表示されます。</div>`; return; }
  const band = paceBand(cp.pacePct);
  const gapChip = cp.gap >= 0
    ? `<span class="pace-chip plus">貯金 +${yenFmt(cp.gap)}</span>`
    : `<span class="pace-chip minus">巻き返し ${yenFmt(cp.gap)}</span>`;
  // 昨年同月（3院合算）
  const lySum = CONFIG.KPI.CLINICS.reduce((s, c) => s + (clinicLastYear(c) || 0), 0);
  const lyChip = lySum > 0
    ? `<div class="team-hero-item"><span>昨年同月</span><b>${yenFmt(lySum)} → 昨対 ${Math.round(cp.forecast / lySum * 100)}%</b></div>`
    : '';
  const needLine = cp.remainDays === 0
    ? '今月の診療日は終了しました'
    : (cp.actual >= cp.budget
      ? '全社予算 達成済み！このまま上積みを 💪'
      : `予算100%まで 3院合計 <b>1日 ${yenFmt(cp.needPerDay)}</b> ／ 残り${cp.remainDays}診療日`);
  el.innerHTML = `
    <div class="team-hero band-${band}">
      <div class="team-hero-main">
        <div class="team-hero-label">このペースだと全社着地</div>
        <div class="team-hero-value">${yenFmt(cp.forecast)}</div>
        <div class="team-hero-rate">予算比 ${cp.fcPct}%　／　ペース比 ${cp.pacePct}% ${paceSig(cp.pacePct)} ${gapChip}</div>
      </div>
      <div class="team-hero-sub">
        <div class="team-hero-item"><span>当月実績</span><b>${yenFmt(cp.actual)}</b></div>
        <div class="team-hero-item"><span>全社予算</span><b>${yenFmt(cp.budget)}</b></div>
        ${lyChip}
      </div>
      <div class="team-hero-need">${needLine}</div>
    </div>`;
}

// ② 全社ペースチャート（3店舗合計を1本で。院別は各院ページに表示）
function renderKpiPaceChart() {
  const el = document.getElementById('kpiPaceChart');
  if (!el) return;
  if (kpiFlowError || !kpiDaily) { el.innerHTML = `<div class="kpi-note">日次データが溜まると表示されます。</div>`; return; }
  const s = companyCumSeries();
  const cp = companyPace();
  if (!s || !cp) { el.innerHTML = `<div class="kpi-note">日次データが溜まると表示されます。</div>`; return; }
  const COMPANY_COLOR = '#1f3864';
  const refLines = [];
  const lySum = CONFIG.KPI.CLINICS.reduce((sum, c) => sum + (clinicLastYear(c) || 0), 0);
  if (lySum > 0 && cp.budget) refLines.push({ y: lySum / cp.budget * 100, label: `昨年着地 ${yenFmt(lySum)}` });
  const svg = paceChartSvg([{
    name: '全社', color: COMPANY_COLOR,
    points: s.points,
    proj: { x: 100, y: cp.fcPct },
    endLabel: `いま ${Math.round(s.last.y)}%`,
  }], { refLines });
  const legend =
    `<span class="pc-legend-item"><i style="background:${COMPANY_COLOR}"></i>全社（3店舗合計）</span>` +
    `<span class="pc-legend-item"><i class="pc-legend-proj"></i>点線＝現ペースの着地予測</span>` +
    `<span class="pc-legend-item">院別チャートは各院ページへ</span>`;
  el.innerHTML = svg + `<div class="pc-legend">${legend}</div>`;
}

// ④ 当月フロー指標表（フロー（3院）タブから主要行を抜粋）
function renderKpiFlowTable() {
  const el = document.getElementById('kpiFlowTable');
  if (!el) return;
  if (kpiFlowError || !kpiFlow) { el.innerHTML = `<div class="kpi-note">分析シートの共有が必要です。</div>`; return; }
  // 2026-08-14: 鍼灸受診率はチーム実績では非表示（各院ページで施術ベースを表示）→代わりにLTV
  // 2026-08-20: 全患者数=実人数／総患者=のべ（旧・患者数(今月)）。既存数は実人数ベースに変更
  // 2026-08-26: フロータブの表示範囲（全患者数〜LTV）を全て表示（竹中要望）
  const ROWS = ['全患者数', '総患者', '新患数', '再診数', '既存数', '事前予約(翌日計)',
    '一人生産性', '客単価', '通院頻度(全患者)', '初再診 通院頻度',
    '鍼灸受診率', '鍼灸受診率(施術ベース)', 'ベッド稼働率', '人員稼働数',
    '新患リピ率', '再診リピ率', '既存リピ率', 'LTV'];
  const found = [];
  ROWS.forEach(label => {
    for (const r of kpiFlow) {
      if (r && String(r[0] || '').trim() === label) { found.push(r); return; }
    }
  });
  if (!found.length) { el.innerHTML = `<div class="kpi-note">フロー指標を読み込めませんでした。</div>`; return; }
  let html = `<div class="flow-table-wrap"><table class="flow-table">
    <thead><tr><th>指標</th><th>南砂</th><th>塩浜</th><th>東砂</th><th>全社</th></tr></thead><tbody>`;
  found.forEach(r => {
    html += `<tr><td class="ft-label">${escHtml(String(r[0]))}</td>
      <td>${kpiDisp(r[1])}</td><td>${kpiDisp(r[2])}</td><td>${kpiDisp(r[3])}</td><td class="ft-total">${kpiDisp(r[4])}</td></tr>`;
  });
  html += '</tbody></table></div>';
  el.innerHTML = html;
}

// フロー（3院）タブから指標を院別に取得 → {南砂,塩浜,東砂}
function flowMetric(label) {
  if (!kpiFlow) return null;
  for (const r of kpiFlow) {
    if (r && String(r[0] || '').trim() === label) {
      return { '南砂': r[1], '塩浜': r[2], '東砂': r[3] };
    }
  }
  return null;
}

// ── 離客フォローリスト（顧客マスタの最終来院日から院別に算出） ──
// 顧客マスタの最終来院日（表示文字列）を Date に。パースできなければ null
function parseVisitDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (!str) return null;
  const m = str.match(/^(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

// 院ごとの離客リスト（区間）を顧客マスタから算出 → {m1:[{name,days}], m2:[...]}
function rihanBuckets(clinicName) {
  const out = { m1: [], m2: [] };
  if (!kpiMaster || kpiMaster.length < 2) return out;
  const C = CONFIG.RIHAN.COL, R = CONFIG.RIHAN;
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (let i = 1; i < kpiMaster.length; i++) {
    const row = kpiMaster[i] || [];
    const clinic = String(row[C.clinic] || '').trim();
    if (!clinic || !(clinic === clinicName || clinic.includes(clinicName) || clinicName.includes(clinic))) continue;
    const name = String(row[C.name] || '').trim();
    if (!name) continue;
    const d = parseVisitDate(row[C.lastVisit]);
    if (!d) continue;
    const days = Math.floor((t0 - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (days >= R.M1_MIN && days <= R.M1_MAX) out.m1.push({ name, days });
    else if (days >= R.M2_MIN && days <= R.M2_MAX) out.m2.push({ name, days });
  }
  out.m1.sort((a, b) => a.days - b.days);
  out.m2.sort((a, b) => a.days - b.days);
  return out;
}

// 離客フォローリストのHTML（1院分）
function rihanListHtml(clinicName) {
  if (kpiMasterError) {
    return `
      <div class="kpi-block">
        <h3 class="kpi-h">離客フォローリスト</h3>
        <div class="kpi-note">顧客マスタを @seichiku.org（中継API実行アカウント）に閲覧共有すると表示されます。</div>
      </div>`;
  }
  const b = rihanBuckets(clinicName);
  const chips = arr => arr.length
    ? `<div class="rihan-names">${arr.map(x => `<span class="rihan-chip">${escHtml(x.name)}<i>${x.days}日</i></span>`).join('')}</div>`
    : `<div class="rihan-empty">現在該当なし</div>`;
  return `
    <div class="kpi-block">
      <h3 class="kpi-h">離客フォローリスト<span class="kpi-tag live">LIVE</span></h3>
      <p class="section-desc" style="margin:0 0 10px;">顧客マスタの最終来院日から算出（カッコ内は最終来院からの経過日数）。声かけ・フォローの対象です。<br>※最終来院日は2026年7月の日計表稼働後に蓄積されるため、リストが揃うのは8〜9月以降になります。</p>
      <div class="rihan-lists">
        <div class="rihan-col">
          <div class="rihan-col-head">1ヶ月離客 <span class="rihan-range">最終来院30〜59日</span><b>${b.m1.length}名</b></div>
          ${chips(b.m1)}
        </div>
        <div class="rihan-col">
          <div class="rihan-col-head">2ヶ月離客 <span class="rihan-range">最終来院60〜89日</span><b>${b.m2.length}名</b></div>
          ${chips(b.m2)}
        </div>
      </div>
    </div>`;
}

// 日次達成タブから1院分の日次ストリップHTMLを返す
function dailyStripHtml(clinicName) {
  if (!kpiDaily) return '';
  function band(p) { return p >= 100 ? 'green' : (p >= 80 ? 'yellow' : 'red'); }
  let hi = -1;
  for (let i = 0; i < kpiDaily.length; i++) {
    if (String((kpiDaily[i] || [])[0]).trim() === '院') { hi = i; break; }
  }
  if (hi < 0) return '';
  for (let i = hi + 1; i < kpiDaily.length; i++) {
    const r = kpiDaily[i] || [];
    if (String(r[0] || '').trim() !== clinicName) continue;
    const daily = kpiDisp(r[1]);
    const recent = String(r[3] || '').trim();
    const recentPct = parseInt(recent.replace(/[^0-9\-]/g, ''), 10) || 0;
    const rband = band(recentPct);
    let cells = '';
    let elapsedDays = 0, achievedDays = 0;
    for (let d = 1; d <= 31; d++) {
      const v = r[3 + d];
      const s = (v === undefined || v === null || String(v).trim() === '') ? '' : String(v).trim();
      if (s === '') cells += `<span class="day-cell day-off" title="${d}日 休診/未到来"></span>`;
      else {
        const p = parseInt(s.replace(/[^0-9\-]/g, ''), 10) || 0;
        elapsedDays++; if (p >= 100) achievedDays++;
        cells += `<span class="day-cell day-${band(p)}" title="${d}日 ${p}%">${d}</span>`;
      }
    }
    const sig = rband === 'green' ? '🟢' : (rband === 'yellow' ? '🟡' : '🔴');
    return `<div class="daily-hero band-${rband}">
        <div class="daily-hero-main">
          <div class="daily-hero-label">直近の日次達成</div>
          <div class="daily-hero-value">${recent || '—'} <span>${sig}</span></div>
        </div>
        <div class="daily-hero-sub">
          <div class="daily-hero-item"><span>日割予算</span><b>${daily}</b></div>
          <div class="daily-hero-item"><span>今月の達成日</span><b>${achievedDays}/${elapsedDays}日 🟢</b></div>
        </div>
      </div>
      <div class="day-strip big">${cells}</div>`;
  }
  return '';
}

// 日次達成タブから1院分の「経過診療日数・総診療日数」を数える
// （値が入っている日セル＝営業済みの診療日。空欄＝休診/未到来）
function clinicDayProgress(clinicName) {
  if (!kpiDaily) return null;
  let hi = -1;
  for (let i = 0; i < kpiDaily.length; i++) {
    if (String((kpiDaily[i] || [])[0]).trim() === '院') { hi = i; break; }
  }
  if (hi < 0) return null;
  for (let i = hi + 1; i < kpiDaily.length; i++) {
    const r = kpiDaily[i] || [];
    if (String(r[0] || '').trim() !== clinicName) continue;
    const total = kpiNum(r[2]) || 0;   // 診療日数
    let elapsed = 0;
    for (let d = 1; d <= 31; d++) {
      const v = r[3 + d];
      if (v !== undefined && v !== null && String(v).trim() !== '') elapsed++;
    }
    return { elapsed, total };
  }
  return null;
}

// 月末着地予測：現ペース（実績÷経過診療日数）×総診療日数 ＋ 昨対比
function forecastHtml(name) {
  const p = clinicPace(name);
  if (!p || !p.elapsed || !p.actual) {
    return `
      <div class="kpi-block">
        <h3 class="kpi-h">月末着地予測</h3>
        <div class="kpi-note">データが溜まると表示されます（実績と診療日数から現ペースで予測します）。</div>
      </div>`;
  }
  const band = paceBand(p.pacePct);
  const needLine = p.remainDays === 0
    ? '今月の診療日は終了しました'
    : (p.actual >= p.budget
      ? '予算達成済み！このまま上積みを 💪'
      : `予算まであと ${yenFmt(p.budget - p.actual)} ／ 残り${p.remainDays}診療日 → <b>1日あたり ${yenFmt(p.needPerDay)}</b> ${needAsPatients(name, p.needPerDay)}で達成`);
  const ly = clinicLastYear(name);
  const lyLine = ly
    ? `<div class="kpi-card-sub">昨年同月 ${yenFmt(ly)} → 着地予測は昨対 <b>${Math.round(p.forecast / ly * 100)}%</b>${p.forecast >= ly ? ' 🎉 昨年超えペース' : ''}</div>`
    : '';
  return `
    <div class="kpi-block">
      <h3 class="kpi-h">月末着地予測<span class="kpi-tag live">LIVE</span></h3>
      <div class="kpi-card budget-${band}">
        <div class="kpi-card-label">このペースだと月末着地</div>
        <div class="kpi-card-big">${yenFmt(p.forecast)} <span class="kpi-card-unit">予算比 ${p.fcPct}%・ペース比 ${p.pacePct}% ${paceSig(p.pacePct)}</span></div>
        <div class="kpi-bar"><div class="kpi-bar-fill ${band}" style="width:${Math.min(100, Math.max(0, p.fcPct))}%"></div></div>
        <div class="kpi-card-sub">${needLine}</div>
        ${lyLine}
        <div class="kpi-card-sub" style="opacity:.7">経過 ${p.elapsed}/${p.total} 診療日・毎日13/21時更新</div>
      </div>
    </div>`;
}

// 今月の院テーマ（2026-08-27 竹中指示で刷新）
// 南砂・東砂＝客単価を¥5,000超へ／塩浜＝新再診（初再診）の通院頻度を月4回へ。
// 数字はフロー（3院）タブ（毎日13/21時更新）から。
function focusKpiHtml(name) {
  const num = v => parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')) || 0;
  const sig = b => b === 'green' ? '🟢' : (b === 'yellow' ? '🟡' : '🔴');
  const cardHtml = (band, label, val, sub) => `
    <div class="kpi-card budget-${band}">
      <div class="kpi-card-label">${label}</div>
      <div class="kpi-card-big">${val} <span class="kpi-card-unit">${sig(band)}</span></div>
      <div class="kpi-card-sub">${sub}</div>
    </div>`;
  const cards = [];
  if (name === '南砂' || name === '東砂') {
    const goal = (CONFIG.FOCUS && CONFIG.FOCUS.TANKA_GOAL) || 5000;
    const t = flowMetric('客単価');
    if (t && String(t[name] || '').trim() !== '' && t[name] !== '—') {
      const v = num(t[name]);
      const band = v >= goal ? 'green' : (v >= goal * 0.8 ? 'yellow' : 'red');
      cards.push(cardHtml(band, `客単価（目標 ¥${goal.toLocaleString('ja-JP')}超）`, kpiDisp(t[name]),
        `売上÷延べ来院。あと ¥${Math.max(0, goal - v).toLocaleString('ja-JP')}。上げ方＝オプション・回数券・サブスクの「一言提案」（宣言→実行の答え合わせは下の表）`));
    }
  }
  if (name === '塩浜') {
    const goal = (CONFIG.FOCUS && CONFIG.FOCUS.FREQ_GOAL) || 4;
    const f1 = flowMetric('初再診 通院頻度');
    if (f1 && String(f1[name] || '').trim() !== '' && f1[name] !== '—') {
      const v1 = num(f1[name]);
      const b1 = v1 >= goal ? 'green' : (v1 >= goal * 0.75 ? 'yellow' : 'red');
      cards.push(cardHtml(b1, `新再診の通院頻度（目標 月${goal}回）`, kpiDisp(f1[name]),
        '当月に初診・再診で来た方の平均来院回数。初回の壁を越える＝次回予約クロージングと通院計画の提示が打ち手'));
    }
    const f2 = flowMetric('通院頻度(全患者)');
    if (f2 && String(f2[name] || '').trim() !== '' && f2[name] !== '—') {
      const v2 = num(f2[name]);
      const b2 = v2 >= 4.6 ? 'green' : (v2 >= 4.0 ? 'yellow' : 'red');
      cards.push(cardHtml(b2, '通院頻度（全患者）', kpiDisp(f2[name]),
        '参考 4.6回/人（南砂水準）。南砂との売上差の約8割はこの差'));
    }
  }
  if (!cards.length) return '';
  return `
    <div class="kpi-block">
      <h3 class="kpi-h">今月の院テーマ<span class="kpi-tag live">LIVE</span></h3>
      <div class="kpi-cards" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));">${cards.join('')}</div>
    </div>`;
}

// 院別ペースチャート（1院分＋昨年着地の参照線）
function clinicChartHtml(name) {
  const s = clinicCumSeries(name);
  const p = clinicPace(name);
  if (!s || !p) return '';
  const refLines = [];
  const ly = clinicLastYear(name);
  if (ly && p.budget) refLines.push({ y: ly / p.budget * 100, label: `昨年着地 ${yenFmt(ly)}` });
  const svg = paceChartSvg([{
    name, color: CLINIC_COLORS[name],
    points: s.points,
    proj: { x: 100, y: p.fcPct },
    endLabel: `いま ${Math.round(s.last.y)}%`,
  }], { refLines });
  return `
    <div class="kpi-block">
      <h3 class="kpi-h">ペースチャート<span class="kpi-tag live">LIVE</span></h3>
      <p class="section-desc" style="margin:0 0 10px;">縦軸100%＝月予算 ${yenFmt(p.budget)}。点線の対角線＝予算ペース、色の点線＝現ペースの着地予測。</p>
      <div class="pace-chart-wrap">${svg}</div>
    </div>`;
}

// ── 個人マイルストーン（30万刻み→120万損益分岐→150万ストレッチ） ──
// 個人の当月ペース情報（院の経過診療日を暫定利用）
function personMilestone(sales, prog) {
  const MS = CONFIG.KPI.MILESTONES;
  const maxV = MS[MS.length - 1].v;
  const next = MS.find(m => sales < m.v) || null;
  let reached = null;
  for (const m of MS) { if (sales >= m.v) reached = m; }
  let fc = 0;
  if (prog && prog.elapsed > 0 && prog.total > 0) fc = Math.round(sales / prog.elapsed * prog.total);
  // 色分け＝現ペースの着地で「次のマイルストーン」に届くか
  let band = 'red';
  if (!next) band = 'green';
  else if (fc >= next.v) band = 'green';
  else if (fc >= next.v * 0.9) band = 'yellow';
  return { MS, maxV, next, reached, fc, band };
}

// マイルストーンバー（目盛り付きプログレスバー）
function milestoneBarHtml(sales, ms) {
  const w = Math.min(100, sales / ms.maxV * 100);
  const ticks = ms.MS.map(m => {
    const left = m.v / ms.maxV * 100;
    const on = sales >= m.v;
    return `<span class="ms-tick ${on ? 'on' : ''}" style="left:${left}%" title="${m.l}${m.note ? '（' + m.note + '）' : ''}"><i></i><em>${m.l}</em></span>`;
  }).join('');
  return `<div class="ms-bar"><div class="ms-bar-fill band-${ms.band}" style="width:${w}%"></div>${ticks}</div>`;
}

// 各院ページの「個人のマイルストーン」ブロック（個人ランキングタブを所属院で絞り込み）
function clinicPersonalHtml(name) {
  if (kpiPersonalError || !kpiPersonalGrid) return '';
  let hi = -1;
  for (let i = 0; i < kpiPersonalGrid.length; i++) {
    if (String((kpiPersonalGrid[i] || [])[0]).trim() === '順位') { hi = i; break; }
  }
  if (hi < 0) return '';
  const prog = clinicDayProgress(name);
  const cards = [];
  for (let i = hi + 1; i < kpiPersonalGrid.length; i++) {
    const r = kpiPersonalGrid[i] || [];
    if (!String(r[1] || '').trim()) break;
    const staff = String(r[1]).trim();
    if ((CONFIG.KPI.HIDE_STAFF || []).includes(staff)) continue;   // 2026-08-21: 竹中さんは表示対象外
    const clinic = String(r[2] || '').trim();
    if (!(clinic.includes(name) || name.includes(clinic))) continue;
    const sales = kpiNum(r[3]);
    const ms = personMilestone(sales, prog);
    const sig = ms.band === 'green' ? '🟢' : (ms.band === 'yellow' ? '🟡' : '🔴');
    const reachedLine = ms.reached
      ? `<span class="ms-badge on">✅ ${ms.reached.l}${ms.reached.note ? '（' + ms.reached.note + '）' : ''} 到達</span>`
      : `<span class="ms-badge">最初のマイルストーン ${ms.MS[0].l} へ</span>`;
    let nextLine = '';
    if (!ms.next) {
      nextLine = `<div class="kpi-need">全マイルストーン制覇 🏆 このまま上積みを</div>`;
    } else {
      const remainDays = prog ? Math.max(0, prog.total - prog.elapsed) : 0;
      const gap = ms.next.v - sales;
      const perDay = remainDays > 0 ? Math.ceil(gap / remainDays) : 0;
      nextLine = `<div class="kpi-need">次は <b>${ms.next.l}</b>${ms.next.note ? '（' + ms.next.note + '）' : ''}：あと ${yenFmt(gap)}${remainDays > 0 ? ` → <b>1日 ${yenFmt(perDay)}</b>` : ''}</div>`;
    }
    let fcLine = '';
    if (ms.fc > 0) {
      const fcMs = personMilestone(ms.fc, null);
      const landing = fcMs.reached ? `＝ <b>${fcMs.reached.l}</b> 到達見込み` : '';
      fcLine = `<div class="kpi-card-sub">着地予測 <b>${yenFmt(ms.fc)}</b> ${landing}</div>`;
    }
    // 過去の自分との比較（昨年同月・自己ベスト）
    const ly = personLastYear(staff);
    const best = personBest(staff);
    let histLine = '';
    if (ly && ms.fc > 0) histLine += `<div class="kpi-card-sub">昨年同月の自分 ${yenFmt(ly)} → 昨対 <b>${Math.round(ms.fc / ly * 100)}%</b>${ms.fc >= ly ? ' 🎉' : ''}</div>`;
    if (best) histLine += `<div class="kpi-card-sub">自己ベスト ${yenFmt(best.v)}（${best.ym}）${ms.fc >= best.v ? ' → <b>更新ペース 🔥</b>' : ''}</div>`;
    cards.push(`
      <div class="kpi-card budget-${ms.band} ms-card">
        <div class="kpi-card-label">${escHtml(staff)} ${reachedLine}</div>
        <div class="kpi-card-big">${yenFmt(sales)} <span class="kpi-card-unit">${sig}</span></div>
        ${milestoneBarHtml(sales, ms)}
        ${fcLine}
        ${histLine}
        ${nextLine}
      </div>`);
  }
  if (cards.length === 0) return '';
  return `
    <div class="kpi-block">
      <h3 class="kpi-h">個人のマイルストーン（この院）<span class="kpi-tag live">LIVE</span></h3>
      <p class="section-desc" style="margin:0 0 10px;">30万刻みで一段ずつ。色分け＝現ペースの着地で「次のマイルストーン」に届くか（🟢届く / 🟡あと少し / 🔴要ペースアップ）。過去の自分（昨年同月・自己ベスト）とも比べます。</p>
      <div class="kpi-cards ms-cards">${cards.join('')}</div>
    </div>`;
}

// 各院ページ（南砂/塩浜/東砂）
function renderClinicPages() {
  const acu = flowMetric('鍼灸受診率(施術ベース)');   // 2026-08-14: 施術ベース（鍼✔or灸✔）に変更
  const churn = flowMetric('離反率');
  const c1 = flowMetric('1ヶ月離反数');
  const c2 = flowMetric('2ヶ月離反数');
  // 2026-08-21: 新フロータブに「日割予算」行は無いため、月予算÷診療日数（clinicPace.perDay）で表示する
  CONFIG.KPI.CLINICS.forEach((name, idx) => {
    const el = document.getElementById('clinicBody' + idx);
    if (!el) return;
    if (kpiFlowError && !kpiDaily) {
      el.innerHTML = `<div class="kpi-note">${name}院の指標を表示するには、分析シートを @seichiku.org に閲覧共有してください。</div>`;
      return;
    }
    // 鍼灸受診率の色（目標60%）／離反率の色（目標8%以下）。離反数は離反率と同じ健全度バンド。
    // ※kpiNumは「43.8%」を438にしてしまうためパーセント値はfloatでパースする（2026-08-14修正）
    const pctNum = v => parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')) || 0;
    const acuV = acu ? pctNum(acu[name]) : 0;
    const acuBand = acuV >= 60 ? 'green' : (acuV >= 40 ? 'yellow' : 'red');
    const chV = churn ? pctNum(churn[name]) : 0;
    const chBand = chV <= 8 ? 'green' : (chV <= 12 ? 'yellow' : 'red');
    const sig = b => b === 'green' ? '🟢' : (b === 'yellow' ? '🟡' : '🔴');
    const card = (band, label, val, sub) => `
      <div class="kpi-card budget-${band}">
        <div class="kpi-card-label">${label}</div>
        <div class="kpi-card-big">${val} <span class="kpi-card-unit">${sig(band)}</span></div>
        <div class="kpi-card-sub">${sub}</div>
      </div>`;
    // 院ヒーロー：当月実績＋ペース比（今日までの予定額に乗れているか）で色分け
    const p = clinicPace(name);
    const rB = p ? paceBand(p.pacePct) : 'red';
    const gapChip = p
      ? (p.gap >= 0
        ? `<span class="pace-chip plus">貯金 +${yenFmt(p.gap)}</span>`
        : `<span class="pace-chip minus">巻き返し ${yenFmt(p.gap)}</span>`)
      : '';
    const hero = `
      <div class="clinic-hero band-${rB}">
        <div class="clinic-hero-main">
          <div class="clinic-hero-label">当月実績</div>
          <div class="clinic-hero-value">${p ? yenFmt(p.actual) : '—'}</div>
          <div class="clinic-hero-rate">ペース比 ${p ? p.pacePct + '%' : '—'} <span>${sig(rB)}</span> ${gapChip}</div>
        </div>
        <div class="clinic-hero-sub">
          <div class="clinic-hero-item"><span>月次予算</span><b>${p ? yenFmt(p.budget) : '—'}</b></div>
          <div class="clinic-hero-item"><span>日次予算</span><b>${p ? yenFmt(p.perDay) : '—'}</b></div>
          <div class="clinic-hero-item"><span>今日までの予定</span><b>${p ? yenFmt(p.paceTarget) : '—'}</b></div>
        </div>
      </div>`;
    el.innerHTML = hero + focusKpiHtml(name) + declVsActHtml(name) + forecastHtml(name) + clinicChartHtml(name) + `
      <div class="kpi-block">
        <h3 class="kpi-h">日次達成（毎日の予算達成）<span class="kpi-tag live">LIVE</span></h3>
        <p class="section-desc" style="margin:0 0 10px;">当日院売上 ÷ 日割予算。🟢100%以上 / 🟡80-99% / 🔴79%以下。空欄＝休診/未到来。</p>
        <div class="daily-row">${dailyStripHtml(name) || '<div class="kpi-note">日次データなし</div>'}</div>
      </div>` + clinicPersonalHtml(name) + `
      <div class="kpi-block">
        <h3 class="kpi-h">月次指標<span class="kpi-tag live">LIVE</span></h3>
        <div class="kpi-cards">
          ${card(acuBand, '鍼灸受診率（施術ベース）', acu ? kpiDisp(acu[name]) : '—', '鍼✔・灸✔ベース／目標60%以上')}
          ${card(chBand, '離反率', churn ? kpiDisp(churn[name]) : '—', '目標8%以下')}
          ${card(chBand, '1ヶ月離反数', c1 ? kpiDisp(c1[name]) : '—', '離反の健全度に連動')}
          ${card(chBand, '2ヶ月離反数', c2 ? kpiDisp(c2[name]) : '—', '離反の健全度に連動')}
        </div>
      </div>` + rihanListHtml(name);
  });
}

// （旧）①-2 院の日次達成 — チーム実績では非表示。要素があれば描画（後方互換）
// （旧）①-2 院の日次達成 — 各院ページへ移設。kpiDaily要素が残っていれば空にする
function renderKpiDaily() {
  const el = document.getElementById('kpiDaily');
  if (el) el.innerHTML = '';
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

// ③ 院別ペースカード：「今日までの予定額」に対する進捗で色分け＋着地予測＋昨対
function renderKpiBudget() {
  const el = document.getElementById('kpiBudget');
  if (!el) return;
  if (kpiFlowError || !kpiFlow) {
    el.innerHTML = `<div class="kpi-note">院別ペースを表示するには、分析シートを @seichiku.org に閲覧共有してください。</div>`;
    return;
  }
  const cards = [];
  CONFIG.KPI.CLINICS.forEach(name => {
    const p = clinicPace(name);
    if (!p) return;
    const band = paceBand(p.pacePct);
    const w = Math.min(100, Math.max(0, p.pacePct));
    const gapLine = p.gap >= 0
      ? `<span class="pace-chip plus">貯金 +${yenFmt(p.gap)}</span>`
      : `<span class="pace-chip minus">巻き返し ${yenFmt(p.gap)}</span>`;
    const ly = clinicLastYear(name);
    const lyLine = ly
      ? `<div class="kpi-card-sub">昨年同月 ${yenFmt(ly)} → 着地予測は昨対 <b>${Math.round(p.forecast / ly * 100)}%</b></div>`
      : '';
    let needLine;
    if (p.actual >= p.budget) needLine = `<div class="kpi-need">予算達成済み 💪</div>`;
    else if (p.remainDays === 0) needLine = `<div class="kpi-need">今月の診療日は終了</div>`;
    else needLine = `<div class="kpi-need">残り<b>${p.remainDays}</b>診療日 → <b>1日 ${yenFmt(p.needPerDay)}</b>で100%<span class="kpi-need-note">${needAsPatients(name, p.needPerDay)}</span></div>`;
    cards.push(`
    <div class="kpi-card budget-${band}">
      <div class="kpi-card-label">${name}</div>
      <div class="kpi-card-big">ペース ${p.pacePct}% <span class="kpi-card-unit">${paceSig(p.pacePct)}</span></div>
      <div class="kpi-bar"><div class="kpi-bar-fill ${band}" style="width:${w}%"></div></div>
      <div class="kpi-card-sub">実績 ${yenFmt(p.actual)} ／ 今日までの予定 ${yenFmt(p.paceTarget)} ${gapLine}</div>
      <div class="kpi-card-sub">着地予測 <b>${yenFmt(p.forecast)}</b>（予算 ${yenFmt(p.budget)} の ${p.fcPct}%）</div>
      ${lyLine}
      ${needLine}
    </div>`);
  });
  el.innerHTML = cards.length ? cards.join('') : `<div class="kpi-note">データが溜まると表示されます。</div>`;
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
// ストック: サブスク施術者別 新規成約数（台帳サマリーF列＝日計表「サブ販売」の7月〜累計件数。構築GASが集計 2026-08-26）
function renderKpiSubStaff() {
  const el = document.getElementById('kpiSubStaff');
  if (!el) return;
  if (kpiAccessError || !kpiKaisu) { el.innerHTML = ''; return; }
  const st = actStats();   // 2026-08-27: 提案数（行動ログ）を成約数の隣に表示
  let any = false;
  const cards = CONFIG.KPI.STAFF.map(name => {
    const row = kpiFindRow(kpiKaisu, name);
    const n = row ? kpiNum(row[5]) : 0;
    if (row && row[5] !== undefined && String(row[5]).trim() !== '') any = true;
    const prop = st && st.byStaff[name] ? st.byStaff[name].month.sub : 0;
    return `
      <div class="kpi-gauge">
        <div class="kpi-gauge-name">${name}</div>
        <div class="kpi-gauge-num">${n}<span class="kpi-card-unit">件</span></div>
        <div class="kpi-card-sub">提案 ${prop}件（今月）</div>
      </div>`;
  });
  el.innerHTML = any ? cards.join('') : `<div class="kpi-note">当月の集計待ちです（毎日13/21時更新）。</div>`;
}

// ストック: 離脱（サブスク解約・回数券未更新。台帳サマリー下部のラベル行をミラー 2026-08-26）
function renderKpiChurn() {
  const el = document.getElementById('kpiChurnCards');
  if (!el) return;
  if (kpiAccessError || !kpiKaisu) { el.innerHTML = ''; return; }
  const sub = kpiFindRow(kpiKaisu, 'サブスク解約(当月)');
  const od = kpiFindRow(kpiKaisu, 'オーダー未更新');
  const op = kpiFindRow(kpiKaisu, 'オプチケ未更新');
  if (!sub && !od && !op) { el.innerHTML = `<div class="kpi-note">集計待ちです（毎日13/21時更新）。</div>`; return; }
  const n = v => kpiNum(v);
  let html = '';
  if (sub) html += `
    <div class="kpi-card">
      <div class="kpi-card-label">サブスク解約（当月）</div>
      <div class="kpi-card-big">${kpiDisp(sub[1])}<span class="kpi-card-unit">名</span></div>
      <div class="kpi-card-sub">南砂 ${n(sub[2])}・塩浜 ${n(sub[3])}・東砂 ${n(sub[4])}</div>
    </div>`;
  if (od) html += `
    <div class="kpi-card">
      <div class="kpi-card-label">オーダー回数券 未更新</div>
      <div class="kpi-card-big">${n(od[1])}<span class="kpi-card-unit">名</span></div>
      <div class="kpi-card-sub">うち当月使い切り ${n(od[2])}名</div>
    </div>`;
  if (op) html += `
    <div class="kpi-card">
      <div class="kpi-card-label">オプチケ 未更新</div>
      <div class="kpi-card-big">${n(op[1])}<span class="kpi-card-unit">名</span></div>
      <div class="kpi-card-sub">うち当月使い切り ${n(op[2])}名</div>
    </div>`;
  el.innerHTML = html;
}

// ストック: 施術者別オプションチケット保有（台帳サマリーのオプチケ保有列＝E列をミラー。目標なしの現況表示 2026-08-21）
function renderKpiOpt() {
  const el = document.getElementById('kpiOptCards');
  if (!el) return;
  if (kpiAccessError || !kpiKaisu) {
    el.innerHTML = `<div class="kpi-note">回数券残高台帳サマリーの閲覧共有が必要です。</div>`;
    return;
  }
  let any = false;
  const cards = CONFIG.KPI.STAFF.map(name => {
    const row = kpiFindRow(kpiKaisu, name);
    const have = row ? kpiNum(row[4]) : 0;
    if (row && row[4] !== undefined && String(row[4]).trim() !== '') any = true;
    return `
      <div class="kpi-gauge">
        <div class="kpi-gauge-name">${name}</div>
        <div class="kpi-gauge-num">${have}<span class="kpi-card-unit">件</span></div>
      </div>`;
  });
  el.innerHTML = any ? cards.join('') : `<div class="kpi-note">台帳サマリーのオプチケ列が見つかりません。</div>`;
}

function renderKpiLeading() {
  const el = document.getElementById('kpiLeading');
  if (!el) return;

  // 戦術（先行指標）タブから 全社合計＋目標 を取得
  function tRow(label) {
    if (!kpiTactics) return null;
    for (const r of kpiTactics) { if (r && String(r[0] || '').trim() === label) return r; }
    return null;
  }
  function tacticCard(title, label) {
    const r = tRow(label);
    if (r) {
      const val = kpiDisp(r[4]);  // E列=全社
      const g = String(r[5] == null ? '' : r[5]).trim();  // F列=目標(月)
      const goal = (g === '' || g === '—') ? '' : `<span class="kpi-card-unit"> / 目標 ${g}</span>`;
      return `<div class="kpi-card">
          <div class="kpi-card-label">${title}</div>
          <div class="kpi-card-big">${val}${goal}</div>
          <div class="kpi-card-sub"><span class="kpi-tag live">LIVE</span></div>
        </div>`;
    }
    return `<div class="kpi-card">
        <div class="kpi-card-label">${title}</div>
        <div class="kpi-card-big muted">—</div>
        <div class="kpi-card-sub"><span class="kpi-tag wait">戦術ダッシュボード連携待ち</span></div>
      </div>`;
  }

  // 2026-08-27: 行動ログから直接ライブ集計（13/21時のGAS更新を待たない）。
  // ログが読めない時は従来どおり分析シート「戦術（先行指標）」の値にフォールバック。
  const st = actStats();
  let html;
  if (st) {
    // 全社目標＝1人あたり月目標 × 施術者数（2026-08-27 竹中決定: 転換50/LINE50/ロープレ22/鍛錬22 per 人）
    const G = CONFIG.ACTIONS.GOALS_PP || { tenkan: 50, line: 50, rope: 22, tanren: 22 };
    const N = (CONFIG.KPI.STAFF || []).length || 6;
    const tenkan = st.total.opt + st.total.order + st.total.sub;
    const card = (label, val, goal, sub) => `<div class="kpi-card">
        <div class="kpi-card-label">${label}</div>
        <div class="kpi-card-big">${val}<span class="kpi-card-unit"> / 目標 ${goal}</span></div>
        <div class="kpi-card-sub">${sub}<span class="kpi-tag live">LIVE</span></div>
      </div>`;
    html = card('転換 提案数（全社・今月）', tenkan, `${G.tenkan * N}（${G.tenkan}件/人）`,
      `オプション ${st.total.opt}・オーダー ${st.total.order}・サブスク ${st.total.sub} `);
    html += card('LINE 発信数（全社・今月）', st.total.line, `${G.line * N}（${G.line}件/人）`, '');
    html += card('ロープレ 実施数（全社・今月）', st.total.rope, `${G.rope * N}（出勤日は毎日）`, '');
    html += card('鍛錬 実施数（全社・今月）', st.total.tanren, `${G.tanren * N}（出勤日は毎日）`, '');
  } else {
    html = tacticCard('転換 提案数（全社・今月）', '転換 提案数');
    html += tacticCard('LINE 発信数（全社・今月）', 'LINE 発信数');
    html += tacticCard('ロープレ 実施数（全社・今月）', 'ロープレ 実施数');
  }
  // 口コミ回収（毎月3件目標/店舗・週次効果測定のGBPタブから 2026-08-22）
  html += kuchikomiCards();
  el.innerHTML = html;
}

// ── 口コミ回収の現状（当月件数＝当月最新のクチコミ累計 − 前月最後のクチコミ累計） ──
function kuchikomiStats() {
  if (!kpiKuchikomi) return null;
  // ヘッダー行（「クチコミ累計」を含む行）を探す
  let hi = -1, ci = -1, si = -1, ei = -1;
  for (let i = 0; i < kpiKuchikomi.length; i++) {
    const r = kpiKuchikomi[i] || [];
    const j = r.findIndex(x => String(x).trim() === 'クチコミ累計');
    if (j >= 0) { hi = i; ci = j; si = r.findIndex(x => String(x).trim() === '店舗'); ei = r.findIndex(x => String(x).trim() === '評価'); break; }
  }
  if (hi < 0 || si < 0) return null;
  const now = new Date();
  const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const out = {};   // 院名（「院」なし）→ {cur, prev, rating}
  for (let i = hi + 1; i < kpiKuchikomi.length; i++) {
    const r = kpiKuchikomi[i] || [];
    const wk = String(r[0] || '').trim();
    const shop = String(r[si] || '').replace('院', '').trim();
    if (!wk || !shop) continue;
    const cum = parseInt(String(r[ci] == null ? '' : r[ci]).replace(/[^0-9]/g, ''), 10);
    if (isNaN(cum)) continue;   // 累計未記録の週（7月中旬以前）はスキップ
    const o = out[shop] || (out[shop] = { cur: null, prev: null, rating: null });
    if (wk.slice(0, 7) === ym) { o.cur = cum; if (ei >= 0) o.rating = String(r[ei] || '').trim(); }
    else if (wk.slice(0, 7) < ym) { o.prev = cum; }   // 行は週昇順→最後に残るのが前月最終
  }
  return out;
}
function kuchikomiCards() {
  const goal = (CONFIG.KUCHIKOMI && CONFIG.KUCHIKOMI.GOAL) || 3;
  const st = kuchikomiStats();
  return CONFIG.KPI.CLINICS.map(name => {
    const o = st ? st[name] : null;
    const n = (o && o.cur != null && o.prev != null) ? Math.max(0, o.cur - o.prev) : null;
    const band = n == null ? '' : (n >= goal ? 'green' : (n >= 1 ? 'yellow' : 'red'));
    const sig = n == null ? '' : (band === 'green' ? '🟢' : (band === 'yellow' ? '🟡' : '🔴'));
    const sub = o && o.cur != null
      ? `累計 ${o.cur}件${o.rating ? '・評価 ' + o.rating : ''}<span class="kpi-tag live">LIVE</span>`
      : '<span class="kpi-tag wait">週次集計待ち（毎週水曜更新）</span>';
    return `<div class="kpi-card ${band ? 'budget-' + band : ''}">
        <div class="kpi-card-label">口コミ回収（${name}・今月）</div>
        <div class="kpi-card-big">${n == null ? '—' : n + '件'}<span class="kpi-card-unit"> / 目標 ${goal}件</span> ${sig}</div>
        <div class="kpi-card-sub">${sub}</div>
      </div>`;
  }).join('');
}

// ============================================================
// 行動ログ×朝の宣言（2026-08-27 ループ連動）
// 戦術ダッシュボード「行動ログ」＝実行（1行=1アクション）、
// 朝の仕込みフォーム＝宣言（オプション/オーダー/サブスク提案数）。
// 突合して「昨日の宣言 vs 実行」を各院ページに表示する。
// ============================================================
function dateKeyOf(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dayKey(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + (offsetDays || 0));
  return dateKeyOf(d);
}
// カテゴリ（行動ログG列＝種別マスタ由来）→ 集計キー
function actCatKey(cat) {
  const c = String(cat || '');
  if (c.includes('オプション')) return 'opt';
  if (c.includes('オーダー')) return 'order';
  if (c.includes('サブスク') || c.includes('筋トレ')) return 'sub';
  if (c.includes('LINE')) return 'line';
  if (c.includes('ロープレ')) return 'rope';
  if (c.includes('鍛錬')) return 'tanren';
  return null;
}
function actZero() { return { opt: 0, order: 0, sub: 0, line: 0, rope: 0, tanren: 0 }; }

// 行動ログの当月分を集計 → { total, byClinic, byStaff: {姓: {month, byDate}} }（ログ未取得なら null）
let __actStatsCache;
function actStats() {
  if (__actStatsCache !== undefined) return __actStatsCache;
  if (!kpiActLog || kpiActLog.length < 3) return (__actStatsCache = null);
  const C = CONFIG.ACTIONS.LOG_COL;
  const ym = ymKey(0);
  const out = { total: actZero(), byClinic: {}, byStaff: {} };
  CONFIG.KPI.CLINICS.forEach(c => out.byClinic[c] = actZero());
  for (let i = 2; i < kpiActLog.length; i++) {
    const r = kpiActLog[i] || [];
    const d = parseVisitDate(r[C.date]);
    if (!d) continue;
    const dk = dateKeyOf(d);
    if (dk.slice(0, 7) !== ym) continue;
    const catSrc = String(r[C.cat] == null ? '' : r[C.cat]).trim() || r[C.kind];
    const key = actCatKey(catSrc);
    if (!key) continue;
    const raw = String(r[C.count] == null ? '' : r[C.count]).trim();
    const n = raw === '' ? 1 : (kpiNum(raw) || 0);   // 件数 空欄=1件
    if (!n) continue;
    out.total[key] += n;
    const clinic = String(r[C.clinic] || '').replace('院', '').trim();
    if (out.byClinic[clinic]) out.byClinic[clinic][key] += n;
    const staff = String(r[C.staff] || '').trim();
    if (staff) {
      const s = out.byStaff[staff] || (out.byStaff[staff] = { month: actZero(), byDate: {} });
      s.month[key] += n;
      const bd = s.byDate[dk] || (s.byDate[dk] = actZero());
      bd[key] += n;
    }
  }
  return (__actStatsCache = out);
}

// 転換宣言のフリーテキスト（例:「オプション3件・サブスク1件」）を数に分解する。
// 種別キーワードが見つからなければ、文中の数字の合計を宣言数として扱う。
function parseTenkanDecl(s) {
  let t = String(s == null ? '' : s).trim();
  if (t === '') return null;
  t = t.replace(/[０-９]/g, d => '０１２３４５６７８９'.indexOf(d));   // 全角数字→半角
  const num = re => { const m = t.match(re); return m ? parseInt(m[1], 10) || 0 : 0; };
  const opt = num(/オプ[^0-9]{0,6}([0-9]+)/);
  const order = num(/オーダー[^0-9]{0,6}([0-9]+)/) + num(/回数券[^0-9]{0,6}([0-9]+)/);
  const sub = num(/サブ[^0-9]{0,6}([0-9]+)/) + num(/筋トレ[^0-9]{0,6}([0-9]+)/);
  let total = opt + order + sub;
  if (!total) {
    const all = t.match(/[0-9]+/g);
    total = all ? all.reduce((a, b) => a + parseInt(b, 10), 0) : 0;
  }
  return { text: t, total, opt, order, sub };
}

// 朝の仕込みの【宣言】列（ヘッダー文字列で動的検出）→ { '姓|yyyy-mm-dd': {tenkan,rope,tanren} }
// tenkan=転換のフリーテキスト宣言（parseTenkanDecl済み）／rope・tanren=「やる」宣言（true/false/null）。
// フォームの担当者はフルネーム（例: 植田祐司）なので姓に正規化して突合する。
let __asaDeclsCache;
function asaDecls() {
  if (__asaDeclsCache !== undefined) return __asaDeclsCache;
  if (!kpiAsa || kpiAsa.length < 2) return (__asaDeclsCache = null);
  const head = kpiAsa[0] || [];
  const cols = {};
  for (let c = 0; c < head.length; c++) {
    const h = String(head[c] || '');
    if (h.indexOf('【宣言】') !== 0) continue;
    if (h.includes('転換')) cols.tenkan = c;          // 統合宣言（例文にオプション等を含むため最優先で判定）
    else if (h.includes('ロープレ')) cols.rope = c;
    else if (h.includes('鍛錬')) cols.tanren = c;
  }
  if (cols.tenkan == null && cols.rope == null && cols.tanren == null) return (__asaDeclsCache = null);
  const A = CONFIG.ACTIONS.ASA_COL;
  const names = (CONFIG.KPI.STAFF || []).concat(['有山', '竹中', '羽田']);
  const surname = full => {
    const f = String(full || '').trim();
    for (const s of names) { if (f.indexOf(s) === 0) return s; }
    return f;
  };
  const yesNo = v => {
    const t = String(v == null ? '' : v).trim();
    if (t === '') return null;
    return t.includes('やる');
  };
  const byKey = {};
  for (let i = 1; i < kpiAsa.length; i++) {
    const r = kpiAsa[i] || [];
    const d = parseVisitDate(r[A.date]);
    if (!d) continue;
    const key = surname(r[A.staff]) + '|' + dateKeyOf(d);
    const rec = byKey[key] || (byKey[key] = { tenkan: null, rope: null, tanren: null });
    // 同日に複数回答があれば後勝ち
    if (cols.tenkan != null) { const p = parseTenkanDecl(r[cols.tenkan]); if (p) rec.tenkan = p; }
    if (cols.rope != null) { const y = yesNo(r[cols.rope]); if (y != null) rec.rope = y; }
    if (cols.tanren != null) { const y = yesNo(r[cols.tanren]); if (y != null) rec.tanren = y; }
  }
  return (__asaDeclsCache = byKey);
}

// 個人ランキングタブから院所属の施術者リストを取得
function clinicStaffList(name) {
  if (!kpiPersonalGrid) return [];
  let hi = -1;
  for (let i = 0; i < kpiPersonalGrid.length; i++) {
    if (String((kpiPersonalGrid[i] || [])[0]).trim() === '順位') { hi = i; break; }
  }
  if (hi < 0) return [];
  const out = [];
  for (let i = hi + 1; i < kpiPersonalGrid.length; i++) {
    const r = kpiPersonalGrid[i] || [];
    const staff = String(r[1] || '').trim();
    if (!staff) break;
    if ((CONFIG.KPI.HIDE_STAFF || []).includes(staff)) continue;
    const clinic = String(r[2] || '').trim();
    if (clinic.includes(name) || name.includes(clinic)) out.push(staff);
  }
  return out;
}

// 各院ページ「今日のアクション（宣言 vs 実行）」ブロック
// 宣言＝朝の仕込み（転換のフリーテキスト＋ロープレ/鍛錬のやる宣言）、実行＝行動ログ。
function declVsActHtml(name) {
  const staffList = clinicStaffList(name);
  if (!staffList.length) return '';
  const st = actStats();
  const decls = asaDecls();
  const tKey = dayKey(0), yKey = dayKey(-1);
  const A = CONFIG.ACTIONS;
  const G = A.GOALS_PP || { tenkan: 50, line: 50, rope: 22, tanren: 22 };
  const tenkanOf = o => o ? (o.opt || 0) + (o.order || 0) + (o.sub || 0) : 0;
  // ロープレ/鍛錬の「宣言→実行」ミニチップ（宣言していない日は出さない）
  const miniChip = (label, declared, done) => {
    if (declared == null) return '';
    if (!declared) return `<span class="dv-detail">${label}—</span>`;
    return `<span class="dv-detail">${label}${done ? '🟢' : '🔴'}</span>`;
  };
  let rows = '';
  staffList.forEach(s => {
    const d0 = decls ? decls[s + '|' + tKey] : null;
    const d1 = decls ? decls[s + '|' + yKey] : null;
    const staffStat = st ? st.byStaff[s] : null;
    const a1 = staffStat ? staffStat.byDate[yKey] : null;
    const m = staffStat ? staffStat.month : null;
    // 今日の宣言
    let today;
    if (d0 && (d0.tenkan || d0.rope != null || d0.tanren != null)) {
      const parts = [];
      if (d0.tenkan) parts.push(`転換 <b>${d0.tenkan.total}件</b> <span class="dv-detail">${escHtml(d0.tenkan.text)}</span>`);
      if (d0.rope != null) parts.push(`<span class="dv-detail">ロープレ${d0.rope ? '🔥' : '—'}</span>`);
      if (d0.tanren != null) parts.push(`<span class="dv-detail">鍛錬${d0.tanren ? '🔥' : '—'}</span>`);
      today = parts.join(' ');
    } else {
      today = '<span class="dv-none">未宣言</span>';
    }
    // 昨日の宣言 vs 実行（主役は転換。ロープレ/鍛錬はチップで）
    const yDecl = d1 && d1.tenkan ? d1.tenkan.total : null;
    const yAct = tenkanOf(a1);
    let yCell;
    if (yDecl == null && !yAct) {
      yCell = '<span class="dv-muted">—</span>';
    } else if (yDecl == null) {
      yCell = `実行 ${yAct}件（宣言なし）`;
    } else {
      const sig = yAct >= yDecl ? ((yDecl > 0 || yAct > 0) ? '🟢' : '') : (yAct > 0 ? '🟡' : '🔴');
      yCell = `宣言 ${yDecl} → 実行 <b>${yAct}件</b> ${sig}`;
    }
    yCell += ' ' + miniChip('ロ', d1 ? d1.rope : null, !!(a1 && a1.rope))
      + ' ' + miniChip('鍛', d1 ? d1.tanren : null, !!(a1 && a1.tanren));
    // 当月実行（1人あたり目標つき）
    const month = m
      ? `転換 ${m.opt + m.order + m.sub}/${G.tenkan}・LINE ${m.line}/${G.line}<br><span class="dv-detail">ロープレ ${m.rope}/${G.rope}・鍛錬 ${m.tanren}/${G.tanren}</span>`
      : '<span class="dv-muted">0</span>';
    rows += `<tr><td class="ft-label">${escHtml(s)}</td><td>${today}</td><td>${yCell}</td><td>${month}</td></tr>`;
  });
  const note = st ? '' : `<div class="kpi-note" style="margin:0 0 10px;">行動ログの入力が始まると「実行」がここに出ます。</div>`;
  return `
    <div class="kpi-block">
      <h3 class="kpi-h">今日のアクション（宣言 vs 実行）<span class="kpi-tag live">LIVE</span></h3>
      <p class="section-desc" style="margin:0 0 10px;">朝の仕込みで宣言した数と、行動ログに入れた実行数の毎日の答え合わせ。月の目標は1人あたり 転換${G.tenkan}件・LINE${G.line}件・ロープレ${G.rope}日・鍛錬${G.tanren}日（出勤日は毎日）。</p>
      ${note}
      <div class="flow-table-wrap"><table class="flow-table">
        <thead><tr><th>施術者</th><th>今日の宣言</th><th>昨日（宣言 → 実行）</th><th>当月実行 / 目標</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="dv-actions">
        <a class="dv-btn" href="${A.FORM_URL}" target="_blank" rel="noopener">☀️ 朝の仕込み（振り返りと宣言）</a>
        <a class="dv-btn ghost" href="${A.LOG_URL}" target="_blank" rel="noopener">✍️ 行動ログ（実行を入力）</a>
      </div>
    </div>`;
}

// ============================================================
// 個人ランキング（分析シート「個人ランキング」タブをミラー）
// ============================================================
let kpiPersonalGrid = null;
let kpiPersonalError = false;

async function loadPersonalRanking() {
  try {
    kpiPersonalGrid = await fetchSheet(CONFIG.KPI.ANALYSIS_ID, CONFIG.KPI.PERSONAL_TAB, 'A1:I40');
    kpiPersonalError = false;
  } catch (err) {
    console.warn('個人ランキング読込失敗（共有未設定の可能性）:', err);
    kpiPersonalError = true;
  }
}

function renderPersonalRanking() {
  const el = document.getElementById('personalRankingBody');
  if (!el) return;
  if (kpiPersonalError || !kpiPersonalGrid) {
    el.innerHTML = `<div class="kpi-note">個人ランキングを表示するには、分析シートを @seichiku.org に閲覧共有してください。</div>`;
    return;
  }
  // ヘッダ行（A列が「順位」）を探す
  let hi = -1;
  for (let i = 0; i < kpiPersonalGrid.length; i++) {
    if (String((kpiPersonalGrid[i] || [])[0]).trim() === '順位') { hi = i; break; }
  }
  if (hi < 0) {
    el.innerHTML = `<div class="kpi-note">分析シートの個人ランキングデータを読み込めませんでした。</div>`;
    return;
  }
  const rows = [];
  for (let i = hi + 1; i < kpiPersonalGrid.length; i++) {
    const r = kpiPersonalGrid[i] || [];
    if (!String(r[1] || '').trim()) break;   // 施術者名が空＝終端
    rows.push(r);
  }
  // 列: 0順位 1施術者 2所属院 3個人売上 4-120万達成 5余剰 6目的休暇 7稼働率 8人時
  // 各行の経過診療日は所属院（最初に一致した院）のものを使用
  const progOf = clinicStr => {
    for (const c of CONFIG.KPI.CLINICS) {
      if (String(clinicStr || '').includes(c)) return clinicDayProgress(c);
    }
    return null;
  };
  let html = `<div class="rank-table-wrap"><table class="rank-table">
    <thead><tr>
      <th>順位</th><th>施術者</th><th>所属院</th><th>個人売上(月)</th>
      <th>マイルストーン</th><th>着地予測</th><th>単価</th><th>全患者数</th><th>通院頻度</th><th>自己ベスト</th><th>稼働率</th><th>人時(円/h)</th>
    </tr></thead><tbody>`;
  rows.forEach(r => {
    const staff = String(r[1] || '').trim();
    if ((CONFIG.KPI.HIDE_STAFF || []).includes(staff)) return;   // 2026-08-21: 竹中さんは表示対象外
    const sales = kpiNum(r[3]);
    const ms = personMilestone(sales, progOf(r[2]));
    const sig = ms.band === 'green' ? '🟢' : (ms.band === 'yellow' ? '🟡' : '🔴');
    const reachedLabel = ms.reached ? `${ms.reached.l} 到達` : `${ms.MS[0].l} へ`;
    const nextLabel = ms.next ? `次:${ms.next.l} あと${yenFmt(ms.next.v - sales)}` : '制覇 🏆';
    let fcCell = '—';
    if (ms.fc > 0) {
      const fcMs = personMilestone(ms.fc, null);
      fcCell = `${yenFmt(ms.fc)}${fcMs.reached ? '<br><span class="rank-fc-ms">' + fcMs.reached.l + ' 見込み</span>' : ''}`;
    }
    const best = personBest(staff);
    const bestCell = best
      ? `${yenFmt(best.v)}<br><span class="rank-fc-ms">${best.ym}${ms.fc >= best.v ? '・更新ペース🔥' : ''}</span>`
      : '—';
    html += `<tr class="rank-${ms.band}">
      <td class="rank-pos">${kpiDisp(r[0])}</td>
      <td class="rank-name">${kpiDisp(r[1])}</td>
      <td class="rank-clinic">${kpiDisp(r[2])}</td>
      <td class="rank-sales">${kpiDisp(r[3])}</td>
      <td class="rank-rate">
        <span class="rate-badge rate-${ms.band}">${reachedLabel} ${sig}</span>
        ${milestoneBarHtml(sales, ms)}
        <span class="rank-next">${nextLabel}</span>
      </td>
      <td>${fcCell}</td>
      <td>${kpiDisp(r[9])}</td>
      <td>${kpiDisp(r[10])}</td>
      <td>${kpiDisp(r[11])}</td>
      <td>${bestCell}</td>
      <td>${kpiDisp(r[7])}</td>
      <td>${kpiDisp(r[8])}</td>
    </tr>`;
  });
  html += `</tbody></table></div>
    <p class="section-desc" style="margin-top:12px;">※マイルストーン＝30万刻み→120万（損益分岐）→150万（余剰30万）。色分け＝現ペースの着地で次のマイルストーンに届くか（🟢届く / 🟡あと少し / 🔴要ペースアップ）。単価＝個人売上÷のべ担当／全患者数＝主担当ベースの実人数／通院頻度＝のべ担当÷実人数。自己ベスト＝過去アーカイブ（2024-01〜2026-07）の最高月。昇給は個人120万達成＋チーム(院)予算達成が条件。有山さん(管理部)は施術者集計の対象外です。</p>`;
  el.innerHTML = html;
}
