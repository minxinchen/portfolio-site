import { Readability } from '@mozilla/readability';
import { RULE_VERSION, RULES, LIMITS, STATUS_LABELS, CATEGORY_LABELS, escapeHtml, normalizeUrl, createSnapshot, auditPages, initialPlan, compilePrompt, compileSinglePrompt, compareAudits, reportHtml } from './core.js';
import sampleBefore from '../tests/fixtures/product-before.html';
import sampleAfter from '../tests/fixtures/product-after.html';
import parse5License from '../licenses/parse5.txt';
import entitiesLicense from '../licenses/entities.txt';
import robotsParserLicense from '../licenses/robots-parser.txt';
import readabilityLicense from '../licenses/readability.txt';

const e = escapeHtml;
const main = document.querySelector('#main');
const emptyState = () => ({ view: 'start', target: 'before', previewTab: 'serp', drafts: { before: [], after: [] }, before: [], after: [], plan: [], history: [], filter: 'issues', tool: 'ChatGPT', scope: '只產出修改建議與草稿；未經我確認，不發佈正式網站。', notes: '', busy: false });
let state = emptyState();
const sampleUrl = 'https://example.test/products/p-100';
const label = status => `<span class="status ${status}">${e(STATUS_LABELS[status] || status)}</span>`;

function extractWithReadability(html) {
  try {
    if (typeof DOMParser === 'undefined') return null;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const parsed = new Readability(doc).parse();
    if (!parsed) return null;
    return { textContent: parsed.textContent || '', byline: parsed.byline || '', publishedTime: parsed.publishedTime || '', title: parsed.title || '' };
  } catch {
    return null;
  }
}

function notify(message, error = false) {
  const box = document.querySelector('#notice'); box.textContent = message; box.classList.toggle('error', error); box.hidden = false;
}
function setBusy(value) { state.busy = value; document.body.classList.toggle('busy', value); }
function intro(kicker, title, description) { return `<div class="page-intro"><p class="kicker">${kicker}</p><h1>${title}</h1><p>${description}</p></div>`; }
function empty(title, description, nav = 'start') { return `<div class="empty"><h2>${title}</h2><p>${description}</p><button class="primary" data-nav="${nav}">從這裡開始</button></div>`; }
function go(view) {
  state.view = view; document.querySelector('#notice').hidden = true;
  render(); main.focus({ preventScroll: true }); window.scrollTo({ top: 0 });
}
function render() {
  document.querySelectorAll('[data-nav].nav-item').forEach(b => { const active = b.dataset.nav === state.view; b.classList.toggle('active', active); if (active) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
  document.querySelector('#session-label').textContent = state.before.length ? `${state.before.length} 頁 · ${state.before[0].page.sourceKind}${state.before.length === 1 ? ' · ' + state.before[0].page.url : ''}` : '尚未載入網站';
  const views = { start: renderStart, results: renderResults, plan: renderPlan, prompt: renderPrompt, verify: renderVerify, help: renderHelp };
  main.innerHTML = (views[state.view] || renderStart)();
}

function importPanel(target) {
  const drafts = state.drafts[target], after = target === 'after';
  return `<section class="panel" id="import-panel"><h2>${after ? '重新檢查線上的同一個頁面' : '貼上網址，馬上檢查'}</h2><p class="panel-subtitle">不需登入 WordPress、不用懂程式碼。抓回網頁與 robots.txt 後會告訴你最該先改的 3 件事。</p>
  <div class="url-check"><label class="field" for="fetch-url">要檢查的網頁網址<input id="fetch-url" type="url" placeholder="https://你的網站.com/文章或頁面/" value="${after && state.before[0] ? e(state.before[0].page.url) : ''}" autocomplete="url"></label><div class="check-row"><label><input id="fetch-product" type="checkbox" ${after && state.before[0]?.page.context.product ? 'checked' : ''}>這是產品／商品頁（加測規格表與詢價入口）</label><label><input id="fetch-multilingual" type="checkbox" ${after && state.before[0]?.page.context.multilingual ? 'checked' : ''}>多語系頁面</label></div><button id="fetch-page" data-target="${target}" class="primary" ${!after && state.before.length ? 'disabled' : ''}>${after ? '重新讀取並比較' : '開始檢查這個網頁 →'}</button><p class="fetch-note">僅讀取公開網頁與 robots.txt，不需帳號密碼、不會修改你的網站。</p></div>
  <details class="advanced-import"><summary>其他方式：上傳已儲存的 HTML 檔案或貼上原始碼</summary><div class="upload-zone"><p>離線使用或一次檢查多頁（最多 20 頁、每頁 2 MB）。</p><label class="field" for="files">選取網頁檔案（.html / .htm）<input id="files" type="file" accept=".html,.htm,text/html" multiple data-target="${target}"></label><hr class="divider"><label class="field" for="page-url">或直接貼上原始碼（請先填入該頁網址）<input id="page-url" type="url" placeholder="https://your-site.com/page/" autocomplete="off"></label><label class="field" for="source-html">HTML 原始碼<textarea id="source-html" rows="5" placeholder="貼上網頁原始碼（其中的 Script 不會執行）。" spellcheck="false"></textarea></label><button id="add-source" data-target="${target}" class="quiet">加入待檢測清單</button></div></details>
  ${after ? '<div class="soft">請使用與改善前相同的網址與頁面類型，才能準確比對前後差異。</div>' : ''}
  <div id="draft-list">${drafts.map((d, i) => `<div class="draft-row"><div><small>${e(d.name || d.sourceKind)} · ${(new TextEncoder().encode(d.html).byteLength / 1024).toFixed(1)} KB</small><label class="field" for="draft-url-${i}">確認這份網頁的原始網址<input id="draft-url-${i}" data-draft-url="${i}" data-target="${target}" type="url" value="${e(d.url)}" placeholder="https://your-site.com/page/" required></label><div class="check-row"><label><input type="checkbox" data-draft-context="product" data-index="${i}" data-target="${target}" ${d.context.product ? 'checked' : ''}>產品頁</label><label><input type="checkbox" data-draft-context="multilingual" data-index="${i}" data-target="${target}" ${d.context.multilingual ? 'checked' : ''}>多語系頁面</label></div></div><button class="quiet" data-remove-draft="${i}" data-target="${target}" aria-label="移除 ${e(d.name || '頁面')}">移除</button></div>`).join('')}</div>
  <div class="actions" ${drafts.length ? '' : 'hidden'}><button class="primary" id="${after ? 'run-after' : 'run-audit'}" ${!drafts.length || (!after && state.before.length) ? 'disabled' : ''}>${after ? '重新檢測並比較' : '開始檢測'}${drafts.length ? `（${drafts.length} 頁）` : ''}</button><span class="muted">${!after && state.before.length ? '要換網站請先按右上角「開始新檢測」。' : '確認網址後即可檢測。'}</span></div></section>`;
}

function renderStart() {
  return intro('01 / 開始檢測', '輸入網址，馬上知道網頁該從哪裡改。', '依 Google 搜尋指南、Lighthouse SEO、AI 摘要（AIO）與可閱讀性檢查 WordPress 頁面，直接告訴你在後台哪裡下手。') +
  `<div class="steps"><div class="step"><span class="step-num">STEP 1</span><b>貼上網址</b><small>不用登入後台或寫程式</small></div><div class="step"><span class="step-num">STEP 2</span><b>先改最重要的 3 件事</b><small>看 Google／LINE 預覽與白話步驟</small></div><div class="step"><span class="step-num">STEP 3</span><b>改完再測一次</b><small>確認修正前後的實際變化</small></div></div><div class="two-col"><div>${importPanel('before')}</div><div><section class="panel sample-panel"><span class="sample-tag">免網址試玩 · 示範資料</span><h2>還沒準備網址？先看示範。</h2><p>用一頁有常見問題的範例頁面，直接體驗「Google／LINE 預覽 → 優先修正清單 → 一鍵給 AI 改寫 → 前後比對」。</p><button id="sample-before" class="primary" ${state.before.length ? 'disabled' : ''}>載入示範頁面</button></section><section class="panel"><h2>會幫你檢查哪些重點？</h2><ul class="help-list"><li><b>Google 搜尋與爬蟲：</b>標題、簡介、robots.txt、X-Robots-Tag、以及有沒有誤裝兩套衝突的 SEO 外掛。</li><li><b>AI 摘要與結構：</b>主標題 H1、H2／H3 大綱層級、Schema 類型、作者與更新日期。</li><li><b>內外鏈與社群分享：</b>抓出「點這裡」空泛連結、無效假連結、以及 LINE／FB 分享卡片。</li><li><b>手機可閱讀性：</b>結合 Mozilla Readability 過濾雜訊，揪出超過 200 字的文字牆與缺 alt 圖片。</li></ul><button class="text-button" data-nav="help">查看完整說明與開源參考資料</button></section></div></div>`;
}

function renderDimensionSummary(audits) {
  const all = audits.flatMap(a => a.results).filter(r => r.category !== 'boundary' && r.status !== 'NOT_APPLICABLE' && r.status !== 'UNKNOWN');
  const groups = [
    { key: 'seo', title: 'Google SEO 與社群', cats: ['seo'] },
    { key: 'aio', title: 'AIO 與內容結構', cats: ['aio', 'product'] },
    { key: 'read', title: '閱讀體驗與內外鏈', cats: ['readability', 'links'] },
  ];
  return `<div class="dim-grid">${groups.map(g => {
    const items = all.filter(r => g.cats.includes(r.category));
    const issues = items.filter(r => r.status === 'FAIL' || r.status === 'WARNING').length;
    const passed = items.filter(r => r.status === 'PASS').length;
    const tone = issues === 0 ? 'good' : items.some(r => r.status === 'FAIL') ? 'bad' : 'warn';
    return `<div class="dim-card ${tone}"><span class="dim-label">${g.title}</span><strong>${issues === 0 ? '狀態良好' : `${issues} 項待改善`}</strong><small>${passed} / ${items.length} 項符合建議</small></div>`;
  }).join('')}</div>`;
}

function renderVisualOverview(audit) {
  if (!audit?.preview) return '';
  const p = audit.preview;
  let host = p.url, hostPath = p.url;
  try { const u = new URL(p.url); host = u.host; hostPath = u.host + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '').split('/').join(' › ')); } catch {}
  const titleWarn = !p.title ? '缺少標題' : p.titleUnits > 66 ? '偏長，可能被截斷' : '';
  const descWarn = !p.description ? '缺少簡介（Google 將自行抓取內文）' : p.descUnits > 170 ? '偏長，後半段可能被截斷' : '';
  const serpBody = `<div class="serp-card"><div class="serp-url">${e(hostPath)}</div><div class="serp-title ${!p.title ? 'is-missing' : ''}">${e(p.title || '（未設定頁面搜尋標題）')}</div><div class="serp-desc ${!p.description ? 'is-missing' : ''}">${e(p.description || '未填寫搜尋簡介，Google 會自動從頁面正文節錄片段顯示。')}</div></div>${(titleWarn || descWarn) ? `<div class="serp-hints">${titleWarn ? `<span class="serp-warn">標題：${titleWarn}</span>` : ''}${descWarn ? `<span class="serp-warn">簡介：${descWarn}</span>` : ''}</div>` : '<p class="panel-subtitle" style="margin:10px 0 0">標題與簡介長度皆在理想顯示範圍內。</p>'}`;

  const og = p.og || {};
  const socialBody = `<div class="social-card"><div class="social-thumb ${og.image ? 'has-img' : ''}">${og.image ? `<span>✓ 已設定分享縮圖（og:image）</span><small>${e(og.image)}</small>` : '<span>⚠ 尚未設定分享縮圖（og:image）</span><small>貼到 LINE 或 Facebook 可能沒有預覽大圖</small>'}</div><div class="social-meta"><div class="social-host">${e(host)}</div><div class="social-title">${e(og.title || '（未設定分享標題）')}</div><div class="social-desc">${e(og.description || '尚未設定 og:description，社群平台可能只顯示網址或雜亂內文。')}</div></div></div><p class="panel-subtitle" style="margin:10px 0 0">為保護隱私與安全，預覽卡片不主動載入外部圖片，僅驗證 og:image 網址格式。</p>`;

  const outlineHtml = p.outline.length
    ? `<ul class="outline-list">${p.outline.slice(0, 12).map(h => `<li class="outline-item h${Math.min(h.level, 4)}"><span>H${h.level}</span>${e(h.text)}</li>`).join('')}${p.outline.length > 12 ? `<li class="outline-more">…還有 ${p.outline.length - 12} 個標題</li>` : ''}</ul>`
    : '<p class="panel-subtitle">這頁目前找不到 H1／H2 標題，建議幫文章加上主標題與段落小標。</p>';
  const s = p.stats;
  const wpTags = [...(p.wpStack?.seoPlugins || []), ...(p.wpStack?.builders || [])];
  return `<div class="two-col visual-overview"><section class="panel"><div class="preview-head"><h2>曝光卡片模擬預覽</h2><div class="preview-tabs" role="tablist"><button class="${state.previewTab === 'serp' ? 'active' : ''}" data-preview-tab="serp" role="tab" aria-selected="${state.previewTab === 'serp'}">Google 搜尋</button><button class="${state.previewTab === 'social' ? 'active' : ''}" data-preview-tab="social" role="tab" aria-selected="${state.previewTab === 'social'}">LINE／FB 分享</button></div></div>${state.previewTab === 'social' ? socialBody : serpBody}</section><section class="panel"><h2>內容結構與文章大綱</h2><div class="mini-metrics"><span>正文約 <b>${s.words}</b> 字</span><span>站內連結 <b>${s.internalLinks}</b></span><span>站外連結 <b>${s.externalLinks}</b></span><span>圖片 <b>${s.images}</b> 張</span>${s.schemaTypes.length ? `<span>Schema：<b>${e(s.schemaTypes.slice(0, 3).join('、'))}</b></span>` : '<span>Schema：<b>未偵測到</b></span>'}${wpTags.map(t => `<span class="wp-badge">${e(t)}</span>`).join('')}</div>${outlineHtml}</section></div>`;
}

function findingCard(r, expanded = false) {
  const task = state.plan.find(t => t.findingKey === r.key);
  const isIssue = r.status === 'FAIL' || r.status === 'WARNING';
  const guideBlock = `<div class="plain-guide"><p><strong>為什麼要改：</strong>${e(r.advice.why)}</p><p><strong>在 WordPress 哪裡做：</strong>${e(r.advice.where)}</p><ol class="step-list">${r.advice.steps.map(s => `<li>${e(s)}</li>`).join('')}</ol></div>`;
  return `<article class="finding ${expanded ? 'priority-card' : ''}"><div class="finding-header"><div><span class="cat-tag">${e(CATEGORY_LABELS[r.category] || '')}</span><h3>${e(r.name)}</h3>${state.before.length > 1 ? `<div class="page-url">${e(r.pageUrl)}</div>` : ''}</div>${label(r.status)}</div><p class="detail">${e(r.detail)}</p>${expanded ? guideBlock : `<details><summary>怎麼改？（WordPress 操作步驟）</summary>${guideBlock}</details>`}<details class="tech-details"><summary>查看原始 HTML 證據${r.evidence.line ? ' · 第 ' + r.evidence.line + ' 行' : ''} · ${e(r.standard)}</summary><div><pre class="evidence">${e(r.evidence.excerpt)}</pre><p class="method"><a href="${e(r.source)}" target="_blank" rel="noopener noreferrer">查看官方參考說明 ↗</a></p></div></details>${isIssue ? `<div class="finding-actions"><button data-copy-single="${e(r.key)}" class="primary-soft">複製這題給 AI 幫我改寫</button>${task ? `<button data-toggle-task="${e(r.key)}" class="quiet">${task.included ? '✓ 已列入計畫（點此暫緩）' : '加入改善計畫'}</button>` : ''}</div>` : ''}</article>`;
}

function renderResults() {
  if (!state.before.length) return empty('先輸入一個網址開始檢測', '完成檢測後，這裡會顯示 Google／LINE 預覽、文章大綱與最優先修改清單。');
  const allResults = state.before.flatMap(a => a.results).filter(r => r.category !== 'boundary');
  const priority = { '高': 0, '中': 1, '資訊': 2 };
  const statusWeight = { FAIL: 0, WARNING: 1, UNKNOWN: 2, PASS: 3, NOT_APPLICABLE: 4 };
  const sortedIssues = allResults.filter(r => ['FAIL', 'WARNING'].includes(r.status)).sort((a, b) => (statusWeight[a.status] - statusWeight[b.status]) || (priority[a.severity] - priority[b.severity]));
  const top3 = sortedIssues.slice(0, 3);
  const topKeys = new Set(top3.map(r => r.key));
  const filtered = allResults.filter(r => {
    if (state.filter === 'issues') return ['FAIL', 'WARNING'].includes(r.status) && !topKeys.has(r.key);
    if (state.filter === 'all') return true;
    return r.status === state.filter;
  }).sort((a, b) => (statusWeight[a.status] - statusWeight[b.status]) || (priority[a.severity] - priority[b.severity]));

  const summaryText = sortedIssues.length
    ? `找到 ${sortedIssues.length} 個可以改善的地方。先從下面「最優先的 ${top3.length} 件事」下手，改完再重新驗證即可。`
    : '這頁的基礎 SEO、結構與閱讀項目都符合建議！可到頁尾用 Google 官方工具做進階確認。';

  return intro('02 / 檢測結果與下手處', sortedIssues.length ? `先改這 ${top3.length} 件事，效果最明顯。` : '這頁的結構與基礎體質很不錯！', summaryText) +
  renderDimensionSummary(state.before) +
  renderVisualOverview(state.before[0]) +
  (top3.length && state.filter === 'issues' ? `<section class="top-section"><div class="section-head"><h2>優先處理（建議先從這裡下手）</h2><div class="actions" style="margin:0"><button class="quiet" id="export-report">匯出報告</button><button class="primary" data-nav="plan">整理成改善清單 →</button></div></div><div class="findings">${top3.map(r => findingCard(r, true)).join('')}</div></section>` : '') +
  `<div class="filterbar"><label class="field" for="result-filter" style="margin:0">查看其他項目<select id="result-filter">${[['issues', `其餘待改善項目（${Math.max(0, sortedIssues.length - top3.length)}）`], ['PASS', `已符合建議（${allResults.filter(r => r.status === 'PASS').length}）`], ['all', `全部項目（${allResults.length}）`], ['FAIL', '僅看需要修正'], ['WARNING', '僅看建議優化']].map(([value, text]) => `<option value="${value}" ${state.filter === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label>${(!top3.length || state.filter !== 'issues') ? `<div class="actions" style="margin:0"><button class="quiet" id="export-report">匯出報告</button><button class="primary" data-nav="plan">整理成改善清單 →</button></div>` : ''}</div>` +
  `<div class="findings" id="results">${filtered.length ? filtered.map(r => findingCard(r, false)).join('') : '<div class="empty"><h2>這個分類沒有其他項目</h2><p>你可以切換上方篩選查看「已符合建議」，或直接前往下一步整理改善計畫。</p></div>'}</div>` +
  `<section class="panel external-box"><h2>修改前提醒 & 進一步外部檢查</h2><p class="panel-subtitle">修改 WordPress 前建議先保留原文字或用「修訂版本」備份。此外，靜態 HTML 無法確認實際 Google 收錄、速度與全站 Sitemap，建議搭配以下免費官方工具：</p><div class="actions"><a class="quiet-link" href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer">Google Search Console ↗</a><a class="quiet-link" href="https://search.google.com/test/rich-results" target="_blank" rel="noopener noreferrer">複合式搜尋結果測試 ↗</a><a class="quiet-link" href="https://pagespeed.web.dev/" target="_blank" rel="noopener noreferrer">PageSpeed 手機速度 ↗</a></div></section>`;
}

function renderPlan() {
  if (!state.before.length) return empty('改善計畫從檢測結果開始', '先貼上網址完成一次檢測，我們會依重要程度幫你排好清單。');
  if (!state.plan.length) return empty('目前沒有待改善任務', '這頁的基礎項目都已符合建議，可以回到結果頁查看詳情。', 'results');
  return intro('03 / 安排改善', '勾選這次要改的項目。', '你可以取消暫時不想改的項目、調整順序，或寫下備註（例如「保留品牌名」），這些都會自動帶入下一步的 AI 指令。') +
  `<section class="panel" id="plan"><div class="filterbar"><h2>本次處理 ${state.plan.filter(t => t.included).length} / ${state.plan.length} 項</h2><button class="primary" data-nav="prompt">產生完整 AI 指令 →</button></div>${state.plan.map((task, i) => `<article class="task ${task.included ? '' : 'excluded'}"><div class="task-head"><span class="task-order">${String(i + 1).padStart(2,'0')}</span><input type="checkbox" data-plan-check="${i}" ${task.included ? 'checked' : ''} aria-label="處理 ${e(task.finding.name)}"><h3>${e(task.finding.name)}</h3><div class="task-controls"><button data-move="${i}" data-direction="-1" ${i === 0 ? 'disabled' : ''} aria-label="上移 ${e(task.finding.name)}">↑</button><button data-move="${i}" data-direction="1" ${i === state.plan.length - 1 ? 'disabled' : ''} aria-label="下移 ${e(task.finding.name)}">↓</button></div></div><p class="page-url">${e(CATEGORY_LABELS[task.finding.category] || '')} · 優先度 ${e(task.finding.severity)} · ${task.included ? '本次處理' : '暫緩'}</p><p>${e(task.finding.detail)}</p><label class="field" for="task-note-${i}">給自己或 AI 的補充備註（選填）<textarea id="task-note-${i}" data-task-note="${i}" rows="2" placeholder="例如：語氣親切一點、保留現有品牌名稱。">${e(task.note)}</textarea></label></article>`).join('')}<div class="actions"><button class="quiet" data-nav="results">回到檢測結果</button><button class="primary" data-nav="prompt">下一步：請 AI 協助 →</button></div></section>`;
}

function currentPrompt() { return compilePrompt(state.before, state.plan, { tool: state.tool, scope: state.scope, notes: state.notes }); }
function renderPrompt() {
  if (!state.before.length) return empty('先完成檢測才能產生 AI 指令', '輸入網址檢測後，會把你勾選的問題打包成可直接貼給 ChatGPT／Gemini 的指令。');
  const selected = state.plan.filter(t => t.included);
  return intro('04 / 請 AI 協助', '一次打包，貼給 ChatGPT 或 Gemini 幫你改稿。', '如果只想改單一項目，也可以在「02 檢測結果」直接按每張卡片的「複製這題給 AI」。這裡適合一次請 AI 處理多項問題。') +
  `<div class="prompt-grid"><section class="panel"><h2>這次交給 AI 的清單</h2><p class="panel-subtitle">已選擇 ${selected.length} 項。<button class="text-button" data-nav="plan">回去調整勾選項目</button></p><ol class="help-list">${selected.map(t => `<li>${e(t.finding.name)}</li>`).join('')}</ol><label class="field" for="ai-tool">你習慣用的 AI 工具<select id="ai-tool">${['ChatGPT','Gemini','Claude','Codex','Claude Code','通用 AI 助手'].map(t => `<option ${state.tool === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label class="field" for="scope">允許 AI 做的範圍<textarea id="scope" rows="3">${e(state.scope)}</textarea></label><label class="field" for="prompt-notes">補充要求（選填）<textarea id="prompt-notes" rows="3" placeholder="例如：目標客群是台灣中小企業主，語氣專業但好懂。">${e(state.notes)}</textarea></label><button class="quiet" data-nav="verify">改完網站後，回來重新驗證 →</button></section><section class="panel"><h2>完整指令預覽</h2><label class="field" for="prompt-output">複製後直接貼到 AI 對話框<textarea id="prompt-output" class="prompt-text" readonly>${e(currentPrompt())}</textarea></label><div class="actions"><button id="copy-prompt" class="primary" ${selected.length ? '' : 'disabled'}>複製完整指令</button><button id="export-prompt" class="quiet" ${selected.length ? '' : 'disabled'}>下載文字檔</button></div></section></div>`;
}

function renderVerify() {
  if (!state.before.length) return empty('先保留修改前的檢測結果', '先檢測一次修改前的網頁，改完網站後就能在這裡看到前後對比。');
  const comparison = state.after.length ? compareAudits(state.before, state.after, state.history[1]?.audits || []).filter(r => r.before?.category !== 'boundary') : [];
  const counts = ['已修正','尚未修正','新增問題','回歸問題','待確認'].map(k => `<span class="compare-pill">${k} <b>${comparison.filter(r => r.change === k).length}</b></span>`).join('');
  return intro('05 / 重新驗證', '改完網站後，再測一次確認成果。', '修改前的結果會保留。重新讀取同一個線上網址，馬上看出哪些問題已修正、有沒有不小心改壞其他項目。') +
  (state.before.every(a => a.page.sourceKind === '虛構練習範例') ? `<section class="panel sample-panel"><span class="sample-tag">示範比對</span><h2>看看修正後的示範頁面</h2><p class="panel-subtitle">載入修好標題、摘要、圖片說明與規格表的範例，體驗前後比對。</p><button class="primary" id="sample-after">載入修正後示範並比較</button></section>` : '') +
  (comparison.length ? `<section class="panel" id="comparison"><div class="filterbar"><h2>修改前 vs 修改後</h2><div class="actions"><button class="quiet" id="export-report">匯出報告</button><button class="quiet" id="export-data">下載原始 JSON</button></div></div><div class="compare-summary">${counts}</div><div class="table-wrap"><table class="comparison-table"><thead><tr><th>檢查項目</th><th>修改前</th><th>修改後</th><th>結果</th></tr></thead><tbody>${comparison.map(r => `<tr><td><b>${e(r.name)}</b>${state.before.length > 1 ? `<br><small>${e(r.pageUrl)}</small>` : ''}</td><td>${label(r.before?.status || 'UNKNOWN')}<details><summary>原本內容</summary><pre class="evidence">${e(r.before?.evidence.excerpt || '未提供')}</pre></details></td><td>${label(r.after?.status || 'UNKNOWN')}<details><summary>最新內容</summary><pre class="evidence">${e(r.after?.evidence.excerpt || '未提供')}</pre></details></td><td><b>${e(r.change)}</b><br><small>${e(r.reason)}</small></td></tr>`).join('')}</tbody></table></div></section>` : '') +
  importPanel('after') +
  `<section class="panel"><h2>驗證紀錄</h2>${state.history.length ? state.history.map(h => `<div class="history-item">${e(new Date(h.at).toLocaleString('zh-TW'))} · ${h.pages} 頁 · 已修正 ${h.fixed} · 回歸 ${h.regressed}</div>`).join('') : '<p class="panel-subtitle">尚未執行修改後檢測。</p>'}</section>`;
}

function renderHelp() {
  return intro('使用說明', '這個工具能幫你做到什麼？', '專為沒有程式背景的 WordPress 經營者設計，依 Google 搜尋與實用內容指南，把網頁結構問題翻譯成具體修改步驟。') +
  `<div class="two-col"><section class="panel"><h2>三步驟上手</h2><ol class="help-list"><li>在「開始檢測」貼上你的公開網頁網址。</li><li>看「Google／LINE 預覽」與「優先處理 Top 3」，照步驟到 WordPress 修改，或一鍵複製給 AI 幫忙改寫。</li><li>發佈更新後，到「重新驗證」再測一次，確認問題已解決。</li></ol></section><section class="panel"><h2>能力邊界（透明說明）</h2><ul class="help-list"><li>只讀取公開網頁的伺服器 HTML 與同網域 robots.txt，不登入後台、不修改網站、也不執行頁面上的 JavaScript。</li><li>需要登入、驗證碼或阻擋機器人的網站可能無法直接讀取，可改用「上傳 HTML 檔案」。</li><li>結構檢查通過有助於搜尋與 AI 理解，但不保證特定排名；實際索引與速度建議搭配 Google Search Console 與 PageSpeed Insights。</li></ul></section></div>
  <section class="panel"><h2>檢查規則與官方參考（規則版本 ${RULE_VERSION}）</h2><ul class="help-list">${RULES.filter(r => r.category !== 'boundary').map(r => `<li><a href="${e(r.source)}" target="_blank" rel="noopener noreferrer">${e(r.name)}</a> · ${e(r.standard)}</li>`).join('')}</ul></section>
  <section class="panel"><h2>開源元件與參考資料</h2><p class="panel-subtitle">WP Search Lab 原創部分採 MIT 授權；以下為本工具正式引用之第三方開源技術與規範參考：</p><ul class="help-list"><li><a href="https://github.com/inikulin/parse5" target="_blank" rel="noopener noreferrer">inikulin/parse5</a>（MIT）與 entities（BSD-2-Clause）：HTML5 AST 解析與原始碼行號定位。</li><li><a href="https://github.com/mozilla/readability" target="_blank" rel="noopener noreferrer">mozilla/readability</a>（Apache-2.0）：Firefox 閱讀模式核心演算法，用於過濾 WordPress 側邊欄雜訊並擷取主要正文。</li><li><a href="https://github.com/samclarke/robots-parser" target="_blank" rel="noopener noreferrer">samclarke/robots-parser</a>（MIT）：零依賴 robots.txt 規則與 Sitemap 解析器。</li><li><a href="https://github.com/GoogleChrome/lighthouse" target="_blank" rel="noopener noreferrer">GoogleChrome/lighthouse</a>（Apache-2.0）與 <a href="https://developers.google.com/search/docs" target="_blank" rel="noopener noreferrer">Google Search Central</a>：SEO 稽核規則與 AI Features 政策參考。</li></ul><details><summary>parse5 授權全文</summary><pre class="legal">${e(parse5License)}</pre></details><details><summary>entities 授權全文</summary><pre class="legal">${e(entitiesLicense)}</pre></details><details><summary>robots-parser 授權全文</summary><pre class="legal">${e(robotsParserLicense)}</pre></details><details><summary>@mozilla/readability 授權全文</summary><pre class="legal">${e(readabilityLicense)}</pre></details></section>`;
}

function addDrafts(target, incoming) {
  const current = state.drafts[target];
  if (current.length + incoming.length > LIMITS.pages) throw new Error('每批最多 20 頁，請先移除部分頁面。');
  const total = [...current, ...incoming].reduce((sum, d) => sum + new TextEncoder().encode(d.html).byteLength, 0);
  if (total > LIMITS.totalBytes) throw new Error('這批資料超過 20 MB，請減少頁數。');
  for (const d of incoming) if (!d.html.trim() || new TextEncoder().encode(d.html).byteLength > LIMITS.pageBytes) throw new Error('檔案不可空白，每頁上限為 2 MB。');
  state.drafts[target].push(...incoming); render();
}

async function readFiles(input) {
  const target = input.dataset.target, files = Array.from(input.files);
  if (!files.length) return;
  if (files.some(f => !/\.html?$/i.test(f.name))) throw new Error('請選取 .html 或 .htm 網頁檔案。');
  if (files.some(f => f.size > LIMITS.pageBytes)) throw new Error('有檔案超過每頁 2 MB 上限。');
  if (files.reduce((sum, f) => sum + f.size, 0) > LIMITS.totalBytes) throw new Error('檔案總計超過 20 MB，請減少頁數。');
  const drafts = await Promise.all(files.map(async f => {
    const html = await f.text();
    return { name: f.name, html, url: '', sourceKind: '匯入網頁', capturedAt: new Date().toISOString(), context: { product: false, multilingual: false }, extracted: extractWithReadability(html) };
  }));
  addDrafts(target, drafts); notify('網頁已加入。請填入原始網址後按「開始檢測」。');
}

async function fetchPage(target) {
  if (location.protocol === 'file:') throw new Error('線上網址檢測請使用作品集網站；此離線版本可在下方上傳 HTML 檔案。');
  const input = document.querySelector('#fetch-url').value.trim();
  const url = normalizeUrl(/^https?:\/\//i.test(input) ? input : 'https://' + input);
  const context = { product: document.querySelector('#fetch-product').checked, multilingual: document.querySelector('#fetch-multilingual').checked };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  notify('正在讀取線上頁面與 robots.txt，請稍候…');
  const button = document.querySelector('#fetch-page'); button.disabled = true; button.textContent = '讀取與分析中…';
  try {
    const response = await fetch('/api/inspect-page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), credentials: 'omit', signal: controller.signal });
    if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('線上讀取服務暫時不可用，請稍後再試。');
    const page = await response.json();
    if (!response.ok || page.error) throw new Error(page.error || '無法取得這個網頁。');
    const snapshot = createSnapshot({
      url: page.url, html: page.html, sourceKind: '線上網頁讀取', capturedAt: page.capturedAt, context,
      httpMeta: { status: page.status, xRobotsTag: page.xRobotsTag || '', robotsTxt: page.robotsTxt ?? null, robotsUrl: page.robotsUrl || '' },
      extracted: extractWithReadability(page.html),
    });
    state.drafts[target] = [snapshot];
    runAudit(target);
    notify(`已完成分析：${page.url}（${(page.bytes / 1024).toFixed(1)} KB）${page.requestedUrl !== page.url ? ' · 已自動跟隨轉址' : ''}`);
  } catch (error) {
    if (error.name === 'TypeError' || error.name === 'AbortError') throw new Error('讀取服務連線失敗或逾時，請稍後重試。');
    throw error;
  } finally {
    clearTimeout(timer);
    if (button.isConnected) { button.disabled = false; button.textContent = target === 'after' ? '重新讀取並比較' : '開始檢查這個網頁 →'; }
  }
}

function runAudit(target) {
  if (target === 'before' && state.before.length) throw new Error('已保留修改前的檢測結果。要檢查新網站請先按右上角「開始新檢測」。');
  const audits = auditPages(state.drafts[target]);
  if (target === 'before') {
    state.before = audits; state.plan = initialPlan(audits); state.filter = 'issues'; state.previewTab = 'serp'; state.view = 'results';
  } else {
    if (!state.before.length) throw new Error('請先完成修改前檢測。');
    const comparison = compareAudits(state.before, audits, state.after);
    state.after = audits;
    state.history.unshift({ at: new Date().toISOString(), pages: audits.length, fixed: comparison.filter(r => r.change === '已修正').length, regressed: comparison.filter(r => r.change === '回歸問題').length, unknown: comparison.filter(r => r.change === '待確認').length, audits });
    state.view = 'verify';
  }
  render(); window.scrollTo({ top: 0 });
  notify(target === 'before' ? `完成 ${audits.length} 頁分析！建議先從上方「優先處理」項目下手。` : '已完成前後比對！');
}

function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function reportData() { return { app: 'WP Search Lab', ruleVersion: RULE_VERSION, exportedAt: new Date().toISOString(), before: state.before, after: state.after, history: state.history, plan: state.plan }; }
function syncPrompt() { const output = document.querySelector('#prompt-output'); if (output) output.value = currentPrompt(); }

document.addEventListener('click', async event => {
  if (event.target.closest('.brand')) { event.preventDefault(); if (!state.busy) go('start'); return; }
  const button = event.target.closest('button'); if (!button || state.busy) return;
  try {
    if (button.dataset.nav) { go(button.dataset.nav); return; }
    if (button.dataset.previewTab) { state.previewTab = button.dataset.previewTab; render(); return; }
    if (button.id === 'reset-session') { document.querySelector('#reset-dialog').showModal(); return; }
    if (button.id === 'cancel-reset') { document.querySelector('#reset-dialog').close(); return; }
    if (button.id === 'confirm-reset') { state = emptyState(); document.querySelector('#reset-dialog').close(); document.querySelector('#notice').hidden = true; render(); return; }
    if (button.id === 'sample-before') {
      state.drafts.before = [{ url: sampleUrl, html: sampleBefore, name: 'product-before.html', sourceKind: '虛構練習範例', capturedAt: new Date().toISOString(), context: { product: true, multilingual: false }, extracted: extractWithReadability(sampleBefore) }]; runAudit('before'); return;
    }
    if (button.id === 'sample-after') {
      state.drafts.after = [{ url: sampleUrl, html: sampleAfter, name: 'product-after.html', sourceKind: '虛構練習範例', capturedAt: new Date().toISOString(), context: { product: true, multilingual: false }, extracted: extractWithReadability(sampleAfter) }]; runAudit('after'); return;
    }
    if (button.id === 'add-source') {
      const html = document.querySelector('#source-html').value;
      const draft = createSnapshot({ url: document.querySelector('#page-url').value, html, sourceKind: '貼上原始碼', context: { product: false, multilingual: false }, extracted: extractWithReadability(html) });
      addDrafts(button.dataset.target, [draft]); notify('已加入原始碼，點「開始檢測」即可分析。'); return;
    }
    if (button.id === 'fetch-page') { setBusy(true); await fetchPage(button.dataset.target); return; }
    if (button.dataset.removeDraft !== undefined) { state.drafts[button.dataset.target].splice(Number(button.dataset.removeDraft), 1); render(); return; }
    if (button.id === 'run-audit' || button.id === 'run-after') { setBusy(true); await new Promise(resolve => setTimeout(resolve, 0)); runAudit(button.id === 'run-audit' ? 'before' : 'after'); return; }
    if (button.dataset.toggleTask) { const task = state.plan.find(t => t.findingKey === button.dataset.toggleTask); task.included = !task.included; render(); return; }
    if (button.dataset.copySingle) {
      const finding = state.before.flatMap(a => a.results).find(r => r.key === button.dataset.copySingle);
      if (!finding) return;
      const text = compileSinglePrompt(finding);
      try { await navigator.clipboard.writeText(text); notify(`已複製「${finding.name}」的 AI 改寫指令！直接貼到 ChatGPT 或 Gemini 即可。`); }
      catch { go('prompt'); notify('瀏覽器未允許自動複製，已帶你到指令區手動複製。'); }
      return;
    }
    if (button.dataset.move !== undefined) { const i = Number(button.dataset.move), j = i + Number(button.dataset.direction); if (j >= 0 && j < state.plan.length) [state.plan[i], state.plan[j]] = [state.plan[j], state.plan[i]]; render(); return; }
    if (button.id === 'copy-prompt') {
      const value = currentPrompt();
      try { await navigator.clipboard.writeText(value); notify('完整指令已複製，直接貼到你的 AI 對話框即可！'); }
      catch { const area = document.querySelector('#prompt-output'); area.focus(); area.select(); notify('已選取指令，請按 ⌘C（Mac）或 Ctrl+C 複製。'); }
      return;
    }
    if (button.id === 'export-prompt') { download(currentPrompt(), 'wp-search-lab-prompt.txt', 'text/plain;charset=utf-8'); return; }
    if (button.id === 'export-report') { download(reportHtml(reportData()), 'wp-search-lab-report.html', 'text/html;charset=utf-8'); notify('檢測報告已下載。'); return; }
    if (button.id === 'export-data') { download(JSON.stringify(reportData(), null, 2), 'wp-search-lab-evidence.json', 'application/json'); notify('原始檢測資料已下載。'); return; }
  } catch (error) { notify(error.message || '操作未完成，請檢查輸入後重試。', true); }
  finally { setBusy(false); }
});

document.addEventListener('change', async event => {
  const input = event.target;
  try {
    if (input.id === 'files') { setBusy(true); await readFiles(input); return; }
    if (input.dataset.draftUrl !== undefined) { state.drafts[input.dataset.target][Number(input.dataset.draftUrl)].url = input.value; return; }
    if (input.dataset.draftContext) { state.drafts[input.dataset.target][Number(input.dataset.index)].context[input.dataset.draftContext] = input.checked; return; }
    if (input.id === 'result-filter') { state.filter = input.value; render(); return; }
    if (input.dataset.planCheck !== undefined) { state.plan[Number(input.dataset.planCheck)].included = input.checked; render(); return; }
    if (input.id === 'ai-tool') { state.tool = input.value; syncPrompt(); }
  } catch (error) { notify(error.message || '檔案讀取失敗。', true); }
  finally { setBusy(false); }
});
document.addEventListener('input', event => {
  const input = event.target;
  if (input.dataset.taskNote !== undefined) state.plan[Number(input.dataset.taskNote)].note = input.value;
  if (input.id === 'scope') { state.scope = input.value; syncPrompt(); }
  if (input.id === 'prompt-notes') { state.notes = input.value; syncPrompt(); }
});
window.addEventListener('beforeunload', event => { if (state.before.length) { event.preventDefault(); event.returnValue = ''; } });
render();
