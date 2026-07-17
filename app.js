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
  const claims = decodeJwt(credential);
  if (claims && CONFIG.ALLOWED_DOMAINS.length > 0) {
    const domain = (claims.email || '').split('@')[1];
    if (!CONFIG.ALLOWED_DOMAINS.includes(domain)) {
      showLoginError(`${domain} ドメインではログインできません。@seichiku.org アカウントを使用してください。`);
      google.accounts.id.disableAutoSelect();
      return;
    }
  }

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
        showLoginError('ログインが確認できませんでした。@seichiku.org アカウントで再度お試しください。');
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
  } catch (err) {
    console.error('Data loading error:', err);
  } finally {
    loading.style.display = 'none';
  }
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
  renderClinicPages();   // 各院ページ（日次達成・鍼灸受診率・離反率・1/2ヶ月離反数）
  // 個人ブロックはスタッフ画面では非表示（院＋先行指標まで）
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

// 月末着地予測：現ペース（実績÷経過診療日数）×総診療日数
function forecastHtml(name, fBudget, fActual) {
  const prog = clinicDayProgress(name);
  const actual = fActual ? kpiNum(fActual[name]) : 0;
  const budget = fBudget ? kpiNum(fBudget[name]) : 0;
  if (!prog || !prog.elapsed || !prog.total || !actual || !budget) {
    return `
      <div class="kpi-block">
        <h3 class="kpi-h">月末着地予測</h3>
        <div class="kpi-note">データが溜まると表示されます（実績と診療日数から現ペースで予測します）。</div>
      </div>`;
  }
  const forecast = Math.round(actual / prog.elapsed * prog.total);
  const pct = Math.round(forecast / budget * 100);
  const band = pct >= 100 ? 'green' : (pct >= 80 ? 'yellow' : 'red');
  const sig = pct >= 100 ? '🟢' : (pct >= 80 ? '🟡' : '🔴');
  const remainDays = Math.max(0, prog.total - prog.elapsed);
  const needPerDay = remainDays > 0 ? Math.max(0, Math.ceil((budget - actual) / remainDays)) : 0;
  const yen = n => '¥' + Number(n).toLocaleString('ja-JP');
  const needLine = remainDays === 0
    ? '今月の診療日は終了しました'
    : (actual >= budget
      ? '予算達成済み！このまま上積みを 💪'
      : `予算まであと ${yen(budget - actual)} ／ 残り${remainDays}診療日 → <b>1日あたり ${yen(needPerDay)}</b> で達成`);
  return `
    <div class="kpi-block">
      <h3 class="kpi-h">月末着地予測<span class="kpi-tag live">LIVE</span></h3>
      <div class="kpi-card budget-${band}">
        <div class="kpi-card-label">このペースだと月末着地</div>
        <div class="kpi-card-big">${yen(forecast)} <span class="kpi-card-unit">予算比 ${pct}% ${sig}</span></div>
        <div class="kpi-bar"><div class="kpi-bar-fill ${band}" style="width:${Math.min(100, Math.max(0, pct))}%"></div></div>
        <div class="kpi-card-sub">${needLine}</div>
        <div class="kpi-card-sub" style="opacity:.7">経過 ${prog.elapsed}/${prog.total} 診療日・毎日13/21時更新</div>
      </div>
    </div>`;
}

// 各院ページの「個人の実績」ブロック（個人ランキングタブを所属院で絞り込み）
function clinicPersonalHtml(name) {
  if (kpiPersonalError || !kpiPersonalGrid) return '';
  let hi = -1;
  for (let i = 0; i < kpiPersonalGrid.length; i++) {
    if (String((kpiPersonalGrid[i] || [])[0]).trim() === '順位') { hi = i; break; }
  }
  if (hi < 0) return '';
  const prog = clinicDayProgress(name);
  const BUDGET = 1200000; // 損益分岐120万（個人ランキングと同じ基準）
  const yen = n => '¥' + Number(n).toLocaleString('ja-JP');
  const cards = [];
  for (let i = hi + 1; i < kpiPersonalGrid.length; i++) {
    const r = kpiPersonalGrid[i] || [];
    if (!String(r[1] || '').trim()) break;
    const clinic = String(r[2] || '').trim();
    if (!(clinic.includes(name) || name.includes(clinic))) continue;
    const sales = kpiNum(r[3]);
    const pct = Math.round(sales / BUDGET * 100);
    const band = pct >= 100 ? 'green' : (pct >= 80 ? 'yellow' : 'red');
    const sig = pct >= 100 ? '🟢' : (pct >= 80 ? '🟡' : '🔴');
    let fcLine = '';
    if (prog && prog.elapsed > 0 && prog.total > 0 && sales > 0) {
      const fc = Math.round(sales / prog.elapsed * prog.total);
      const fcPct = Math.round(fc / BUDGET * 100);
      const fcSig = fcPct >= 100 ? '🟢' : (fcPct >= 80 ? '🟡' : '🔴');
      fcLine = `<div class="kpi-card-sub">着地予測 <b>${yen(fc)}</b>（${fcPct}% ${fcSig}）</div>`;
    }
    let needLine = '';
    if (prog && prog.total > 0) {
      const remainDays = Math.max(0, prog.total - prog.elapsed);
      if (sales >= BUDGET) needLine = `<div class="kpi-need">120万達成 💪</div>`;
      else if (remainDays === 0) needLine = `<div class="kpi-need">今月の診療日は終了</div>`;
      else needLine = `<div class="kpi-need">残り<b>${remainDays}</b>診療日 → <b>1日 ${yen(Math.ceil((BUDGET - sales) / remainDays))}</b>で120万</div>`;
    }
    cards.push(`
      <div class="kpi-card budget-${band}">
        <div class="kpi-card-label">${escHtml(String(r[1]))}</div>
        <div class="kpi-card-big">${kpiDisp(r[3])} <span class="kpi-card-unit">${pct}% ${sig}</span></div>
        <div class="kpi-bar"><div class="kpi-bar-fill ${band}" style="width:${Math.min(100, Math.max(0, pct))}%"></div></div>
        ${fcLine}
        ${needLine}
      </div>`);
  }
  if (cards.length === 0) return '';
  return `
    <div class="kpi-block">
      <h3 class="kpi-h">個人の当月実績（この院）<span class="kpi-tag live">LIVE</span></h3>
      <p class="section-desc" style="margin:0 0 10px;">色分け＝損益分岐120万の達成度（🟢100% / 🟡80-99% / 🔴79%以下）。着地予測＝現ペース×診療日数。</p>
      <div class="kpi-cards">${cards.join('')}</div>
    </div>`;
}

// 各院ページ（南砂/塩浜/東砂）
function renderClinicPages() {
  const acu = flowMetric('鍼灸受診率');
  const churn = flowMetric('離反率');
  const c1 = flowMetric('1ヶ月離反数');
  const c2 = flowMetric('2ヶ月離反数');
  const fBudget = flowMetric('予算');       // 月次予算
  const fActual = flowMetric('現在着地');    // 当月実績
  const fDay = flowMetric('日割予算');       // 日次予算
  const fRate = flowMetric('現予達率');      // 達成度
  CONFIG.KPI.CLINICS.forEach((name, idx) => {
    const el = document.getElementById('clinicBody' + idx);
    if (!el) return;
    if (kpiFlowError && !kpiDaily) {
      el.innerHTML = `<div class="kpi-note">${name}院の指標を表示するには、分析シートを @seichiku.org に閲覧共有してください。</div>`;
      return;
    }
    // 鍼灸受診率の色（目標60%）／離反率の色（目標8%以下）。離反数は離反率と同じ健全度バンド。
    const acuV = acu ? kpiNum(acu[name]) : 0;
    const acuBand = acuV >= 60 ? 'green' : (acuV >= 40 ? 'yellow' : 'red');
    const chV = churn ? kpiNum(churn[name]) : 0;
    const chBand = chV <= 8 ? 'green' : (chV <= 12 ? 'yellow' : 'red');
    const sig = b => b === 'green' ? '🟢' : (b === 'yellow' ? '🟡' : '🔴');
    const card = (band, label, val, sub) => `
      <div class="kpi-card budget-${band}">
        <div class="kpi-card-label">${label}</div>
        <div class="kpi-card-big">${val} <span class="kpi-card-unit">${sig(band)}</span></div>
        <div class="kpi-card-sub">${sub}</div>
      </div>`;
    // 院ヒーロー：当月実績（達成度で色分け）＋月次予算＋日次予算
    const rV = fRate ? (parseFloat(String(fRate[name]).replace(/[^0-9.\-]/g, '')) || 0) : 0;
    const rB = rV >= 100 ? 'green' : (rV >= 80 ? 'yellow' : 'red');
    const hero = `
      <div class="clinic-hero band-${rB}">
        <div class="clinic-hero-main">
          <div class="clinic-hero-label">当月実績</div>
          <div class="clinic-hero-value">${fActual ? kpiDisp(fActual[name]) : '—'}</div>
          <div class="clinic-hero-rate">達成度 ${fRate ? kpiDisp(fRate[name]) : '—'} <span>${sig(rB)}</span></div>
        </div>
        <div class="clinic-hero-sub">
          <div class="clinic-hero-item"><span>月次予算</span><b>${fBudget ? kpiDisp(fBudget[name]) : '—'}</b></div>
          <div class="clinic-hero-item"><span>日次予算</span><b>${fDay ? kpiDisp(fDay[name]) : '—'}</b></div>
        </div>
      </div>`;
    el.innerHTML = hero + forecastHtml(name, fBudget, fActual) + `
      <div class="kpi-block">
        <h3 class="kpi-h">日次達成（毎日の予算達成）<span class="kpi-tag live">LIVE</span></h3>
        <p class="section-desc" style="margin:0 0 10px;">当日院売上 ÷ 日割予算。🟢100%以上 / 🟡80-99% / 🔴79%以下。空欄＝休診/未到来。</p>
        <div class="daily-row">${dailyStripHtml(name) || '<div class="kpi-note">日次データなし</div>'}</div>
      </div>` + clinicPersonalHtml(name) + `
      <div class="kpi-block">
        <h3 class="kpi-h">月次指標<span class="kpi-tag live">LIVE</span></h3>
        <div class="kpi-cards">
          ${card(acuBand, '鍼灸受診率', acu ? kpiDisp(acu[name]) : '—', '目標60%以上')}
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

// ① 院予算（分析シートからライブ）＋「あと何診療日・1日いくらで100%」
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
  const yen = n => '¥' + Number(n).toLocaleString('ja-JP');
  // 院別に「残り診療日・1日必要額」を算出（日次達成タブの診療日数を使用）
  const need = {};
  budget.forEach(b => {
    if (b.name === '全社') return;
    const prog = clinicDayProgress(b.name);
    const bud = kpiNum(b.budget), act = kpiNum(b.actual);
    if (prog && prog.total && bud) {
      const remainDays = Math.max(0, prog.total - prog.elapsed);
      const needPerDay = (remainDays > 0 && act < bud) ? Math.ceil((bud - act) / remainDays) : 0;
      need[b.name] = { remainDays, needPerDay, actual: act, budget: bud };
    }
  });
  const needLineHtml = (name) => {
    if (name === '全社') {
      const parts = Object.values(need);
      if (!parts.length) return '';
      if (parts.every(p => p.actual >= p.budget)) return `<div class="kpi-need">予算達成済み 💪</div>`;
      const sumNeed = parts.reduce((s, p) => s + p.needPerDay, 0);
      return `<div class="kpi-need">3院合計 <b>1日 ${yen(sumNeed)}</b> で予算100%<span class="kpi-need-note">（内訳は各院ページ）</span></div>`;
    }
    const n = need[name];
    if (!n) return '';
    if (n.actual >= n.budget) return `<div class="kpi-need">予算達成済み 💪</div>`;
    if (n.remainDays === 0) return `<div class="kpi-need">今月の診療日は終了</div>`;
    return `<div class="kpi-need">残り<b>${n.remainDays}</b>診療日 → <b>1日 ${yen(n.needPerDay)}</b>で100%</div>`;
  };
  el.innerHTML = budget.map(b => {
    const raw = parseFloat(String(b.rate).replace(/[^0-9.\-]/g, '')) || 0;
    const band = raw >= 100 ? 'green' : (raw >= 80 ? 'yellow' : 'red');
    const w = Math.min(100, Math.max(0, Math.round(raw)));
    return `
    <div class="kpi-card budget-${band}">
      <div class="kpi-card-label">${b.name}</div>
      <div class="kpi-card-big">${kpiDisp(b.rate)} <span class="kpi-card-unit">${b.sig || ''}</span></div>
      <div class="kpi-bar"><div class="kpi-bar-fill ${band}" style="width:${w}%"></div></div>
      <div class="kpi-card-sub">実績 ${kpiDisp(b.actual)} / 予算 ${kpiDisp(b.budget)}</div>
      ${needLineHtml(b.name)}
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

  // 戦術ダッシュボード（先行指標）ライブ：転換提案/LINE発信/ロープレ（全社）
  let html = tacticCard('転換 提案数（全社・今月）', '転換 提案数');
  html += tacticCard('LINE 発信数（全社・今月）', 'LINE 発信数');
  html += tacticCard('ロープレ 実施数（全社・今月）', 'ロープレ 実施数');
  el.innerHTML = html;
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
  const BUDGET = 1200000;  // 個人予算＝損益分岐120万
  let html = `<table class="rank-table">
    <thead><tr>
      <th>順位</th><th>施術者</th><th>所属院</th><th>個人売上(月)</th>
      <th>予算達成度<br>(120万)</th><th>目的休暇<br>(日)</th><th>稼働率</th><th>人時(円/h)</th>
    </tr></thead><tbody>`;
  rows.forEach(r => {
    const sales = kpiNum(r[3]);
    const pct = BUDGET ? Math.round(sales / BUDGET * 100) : 0;
    const band = pct >= 100 ? 'green' : (pct >= 80 ? 'yellow' : 'red');
    const sig = pct >= 100 ? '🟢' : (pct >= 80 ? '🟡' : '🔴');
    const w = Math.min(100, Math.max(0, pct));
    html += `<tr class="rank-${band}">
      <td class="rank-pos">${kpiDisp(r[0])}</td>
      <td class="rank-name">${kpiDisp(r[1])}</td>
      <td class="rank-clinic">${kpiDisp(r[2])}</td>
      <td class="rank-sales">${kpiDisp(r[3])}</td>
      <td class="rank-rate">
        <span class="rate-badge rate-${band}">${pct}% ${sig}</span>
        <span class="rate-bar"><span class="rate-bar-fill ${band}" style="width:${w}%"></span></span>
      </td>
      <td>${kpiDisp(r[6])}</td>
      <td>${kpiDisp(r[7])}</td>
      <td>${kpiDisp(r[8])}</td>
    </tr>`;
  });
  html += `</tbody></table>
    <p class="section-desc" style="margin-top:12px;">※色分け＝個人予算（損益分岐120万）の達成度（🟢100%以上 / 🟡80-99% / 🔴79%以下）。昇給は個人120万達成＋チーム(院)予算達成が条件。目的休暇日数＝(余剰×20%)÷日当。有山さん(管理部)は施術者集計の対象外です。</p>`;
  el.innerHTML = html;
}
