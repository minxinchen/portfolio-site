import { RULE_VERSION, RULES, LIMITS, STATUS_LABELS, escapeHtml, normalizeUrl, createSnapshot, auditPages, initialPlan, compilePrompt, compareAudits, reportHtml } from './core.js';
import sampleBefore from '../tests/fixtures/product-before.html';
import sampleAfter from '../tests/fixtures/product-after.html';
import parse5License from '../licenses/parse5.txt';
import entitiesLicense from '../licenses/entities.txt';

const e = escapeHtml;
const main = document.querySelector('#main');
const emptyState = () => ({ view: 'start', target: 'before', drafts: { before: [], after: [] }, before: [], after: [], plan: [], history: [], filter: 'issues', tool: 'ChatGPT', scope: '只產出修改建議與草稿；未經我確認，不發佈正式網站。', notes: '', busy: false });
let state = emptyState();
const sampleUrl = 'https://example.test/products/p-100';
const label = status => `<span class="status ${status}">${e(status)} · ${e(STATUS_LABELS[status])}</span>`;
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
  return `<section class="panel" id="import-panel"><h2>${after ? '重新檢查線上的同一個頁面' : '輸入網址，直接檢查線上頁面'}</h2><p class="panel-subtitle">不必下載 HTML。取得公開頁面後，立即分析並顯示證據。</p>
  <div class="url-check"><label class="field" for="fetch-url">要檢查的網頁網址<input id="fetch-url" type="url" placeholder="https://你的網站.com/頁面/" value="${after && state.before[0] ? e(state.before[0].page.url) : ''}" autocomplete="url"></label><div class="check-row"><label><input id="fetch-product" type="checkbox" ${after && state.before[0]?.page.context.product ? 'checked' : ''}>這是產品頁</label><label><input id="fetch-multilingual" type="checkbox" ${after && state.before[0]?.page.context.multilingual ? 'checked' : ''}>多語系頁面</label></div><button id="fetch-page" data-target="${target}" class="primary" ${!after && state.before.length ? 'disabled' : ''}>${after ? '重新讀取並比較' : '檢查這個網頁 →'}</button><p class="fetch-note">讀取公開內容，不需網站帳密。網址會交由本站服務擷取；不會修改網站。僅分析伺服器回傳的 HTML，不執行頁面 JavaScript。</p></div>
  <details class="advanced-import"><summary>進階：匯入已儲存的 HTML 檔案</summary><div class="upload-zone"><p>可在離線時使用，或比較手動保存的版本。每頁 2 MB，每批最多 20 頁、合計 20 MB。</p><label class="field" for="files">選取網頁（可多選）<input id="files" type="file" accept=".html,.htm,text/html" multiple data-target="${target}"></label></div></details>
  <details><summary>進階：貼上 HTML 原始碼</summary><div><label class="field" for="page-url">這份原始碼的完整頁面網址<input id="page-url" type="url" placeholder="https://your-site.com/product/" autocomplete="off"></label><label class="field" for="source-html">HTML 原始碼<textarea id="source-html" rows="6" placeholder="貼上你取得的 HTML；其中的 Script 不會執行。" spellcheck="false"></textarea></label><button id="add-source" data-target="${target}" class="quiet">加入待檢測頁面</button></div></details>
  ${after ? '<div class="soft">請使用與改善前相同的網址、來源方式及頁面類型。未提供的頁面、UNKNOWN 或不同設定，都不會被當成已修正。</div>' : ''}
  <div id="draft-list">${drafts.map((d, i) => `<div class="draft-row"><div><small>${e(d.name || d.sourceKind)} · ${(new TextEncoder().encode(d.html).byteLength / 1024).toFixed(1)} KB · ${e(d.sourceKind)}</small><label class="field" for="draft-url-${i}">確認這份網頁的原始網址<input id="draft-url-${i}" data-draft-url="${i}" data-target="${target}" type="url" value="${e(d.url)}" placeholder="https://your-site.com/product/" required></label><div class="check-row"><label><input type="checkbox" data-draft-context="product" data-index="${i}" data-target="${target}" ${d.context.product ? 'checked' : ''}>產品頁</label><label><input type="checkbox" data-draft-context="multilingual" data-index="${i}" data-target="${target}" ${d.context.multilingual ? 'checked' : ''}>多語系頁面</label></div></div><button class="quiet" data-remove-draft="${i}" data-target="${target}" aria-label="移除 ${e(d.name || '頁面')} ">移除</button></div>`).join('')}</div>
  <div class="actions" ${drafts.length ? '' : 'hidden'}><button class="primary" id="${after ? 'run-after' : 'run-audit'}" ${!drafts.length || (!after && state.before.length) ? 'disabled' : ''}>${after ? '重新檢測並比較' : '開始檢測'}${drafts.length ? `（${drafts.length} 頁）` : ''}</button><span class="muted">${!after && state.before.length ? '改善前已保留；要換網站請先匯出，再按「開始新檢測」。' : '請先確認每一頁的原始網址。'}</span></div></section>`;
}
function renderStart() {
  return intro('01 / 開始檢測', '輸入網址，找出網站的下一步。', '直接檢查已上線網頁的 SEO／AIO 結構，查看問題證據、安排改善，再重新讀取網站驗證結果。') +
  `<div class="steps"><div class="step"><span class="step-num">STEP 1</span><b>輸入公開網址</b><small>不用登入 WordPress</small></div><div class="step"><span class="step-num">STEP 2</span><b>決定怎麼改善</b><small>看證據，再安排優先順序</small></div><div class="step"><span class="step-num">STEP 3</span><b>重新驗證</b><small>同樣條件，比較前後差異</small></div></div><div class="two-col"><div>${importPanel('before')}</div><div><section class="panel sample-panel"><span class="sample-tag">可操作範例 · 虛構測試資料</span><h2>先用一頁產品，走完整個流程。</h2><p>示範工業泵浦頁面缺少標題、摘要和詢價入口。檢測結果由實際 HTML 計算，不是預填分數。</p><button id="sample-before" class="primary" ${state.before.length ? 'disabled' : ''}>體驗範例檢測</button><div class="soft">範例網址 example.test 與產品均為虛構。修正後範例只示範技術差異，不是正式網站成效。</div></section><section class="panel"><h2>這裡會幫你做到什麼？</h2><ul class="help-list"><li>找到靜態 HTML 中可確認的問題與原始行號。</li><li>了解在 WordPress 哪裡處理、注意什麼。</li><li>選擇與調整任務，產出可複製的 AI 指令。</li><li>保留改善前的證據，再比較新版網頁。</li></ul><p class="panel-subtitle">不提供全站爬蟲、排名分數或 AI 引用率預測。動態內容、HTTP 標頭與工程規格真實性會明確標記為未知。</p><button class="text-button" data-nav="help">查看能力與使用說明</button></section></div></div>`;
}
function renderStats(audits) {
  const findings = audits.flatMap(a => a.results);
  return `<div class="stats">${Object.entries(STATUS_LABELS).map(([status, title]) => `<div class="stat"><span class="status-word">${status === 'NOT_APPLICABLE' ? 'N/A' : status}</span><strong>${findings.filter(r => r.status === status).length}</strong><span>${title}</span></div>`).join('')}</div>`;
}
function guidance(r) {
  return `<dl class="guide"><dt>為什麼值得處理</dt><dd>${e(r.advice.why)}</dd><dt>適用條件</dt><dd>${e(r.advice.conditions)}</dd><dt>到 WordPress 哪裡處理</dt><dd>${e(r.advice.where)}</dd><dt>自行改善</dt><dd><ol>${r.advice.steps.map(s => `<li>${e(s)}</li>`).join('')}</ol></dd><dt>注意事項</dt><dd>${e(r.advice.caution)}</dd><dt>備份與回滾</dt><dd>${e(r.advice.rollback)}</dd><dt>如何驗收</dt><dd>${e(r.advice.acceptance)}</dd><dt>依據</dt><dd>${e(r.standard)} · <a href="${e(r.source)}" target="_blank" rel="noopener noreferrer">開啟參考來源 ↗</a></dd></dl>`;
}
function findingCard(r) {
  const task = state.plan.find(t => t.findingKey === r.key);
  return `<article class="finding"><div class="finding-header"><div><h3>${e(r.name)}<span class="severity">優先程度 ${e(r.severity)}</span></h3><div class="page-url">${e(r.pageUrl)}</div></div>${label(r.status)}</div><p class="detail">${e(r.detail)}</p><details><summary>查看原始證據${r.evidence.line ? ' · 第 ' + r.evidence.line + ' 行' : ' · 全文檢查'}</summary><div><pre class="evidence">${e(r.evidence.excerpt)}</pre><p class="method">${e(r.evidence.method)} · 符合節點 ${r.evidence.matchedCount}</p></div></details><details><summary>如何處理與驗收</summary><div>${guidance(r)}</div></details>${task ? `<div class="finding-actions"><button data-toggle-task="${e(r.key)}" class="quiet">${task.included ? '已加入計畫 · 改為暫緩' : '加入改善計畫'}</button><button data-ai-task="${e(r.key)}" class="text-button">請 AI 協助這個問題</button></div>` : ''}</article>`;
}
function renderResults() {
  if (!state.before.length) return empty('先帶入一份網頁', '完成檢測後，你會在這裡看到問題、證據與可執行的指引。');
  const results = state.before.flatMap(a => a.results), priority = { '高': 0, '中': 1, '資訊': 2 };
  const filtered = results.filter(r => state.filter === 'all' || (state.filter === 'issues' ? ['FAIL', 'WARNING'].includes(r.status) : r.status === state.filter)).sort((a, b) => priority[a.severity] - priority[b.severity]);
  return intro('02 / 理解問題', '先看有證據的問題，再決定怎麼做。', `已分析 ${state.before.length} 頁提供的靜態 HTML。這是單頁證據檢查，不是全站健康分數；未知項目不算通過。`) + renderStats(state.before) +
  `<div class="filterbar"><label class="field" for="result-filter">顯示結果<select id="result-filter">${[['issues', '需要處理的問題'], ['all', '全部檢查'], ...Object.entries(STATUS_LABELS).map(([a,b]) => [a,b])].map(([value, text]) => `<option value="${value}" ${state.filter === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label><div class="actions"><button class="quiet" id="export-report">匯出完整報告</button><button class="primary" data-nav="plan">安排改善計畫 →</button></div></div><div class="findings" id="results">${filtered.length ? filtered.map(findingCard).join('') : '<div class="empty"><h2>這個分類沒有結果</h2><p>也請查看 UNKNOWN 的能力限制，未發現問題不等於全站通過。</p></div>'}</div>`;
}
function renderPlan() {
  if (!state.before.length) return empty('改善計畫從檢測證據開始', '先完成一次檢測，我們會依問題與優先程度整理可調整的任務。');
  if (!state.plan.length) return empty('目前沒有 FAIL 或 WARNING 任務', '仍可回到檢測結果，查看 UNKNOWN 項目需要哪些外部驗證。', 'results');
  return intro('03 / 安排改善', '把這次要做的事，排成一份計畫。', '預設依優先程度排列。你可以暫緩任務、調整順序，並補充適用條件。這些選擇會帶入 AI 指令與匯出報告。') +
  `<section class="panel" id="plan"><div class="filterbar"><h2>本次處理 ${state.plan.filter(t => t.included).length} / ${state.plan.length} 項</h2><button class="primary" data-nav="prompt">產生 AI 改善指令 →</button></div>${state.plan.map((task, i) => `<article class="task ${task.included ? '' : 'excluded'}"><div class="task-head"><span class="task-order">${String(i + 1).padStart(2,'0')}</span><input type="checkbox" data-plan-check="${i}" ${task.included ? 'checked' : ''} aria-label="處理 ${e(task.finding.name)}"><h3>${e(task.finding.name)}</h3><div class="task-controls"><button data-move="${i}" data-direction="-1" ${i === 0 ? 'disabled' : ''} aria-label="上移 ${e(task.finding.name)}">↑</button><button data-move="${i}" data-direction="1" ${i === state.plan.length - 1 ? 'disabled' : ''} aria-label="下移 ${e(task.finding.name)}">↓</button></div></div><p class="page-url">${e(task.finding.pageUrl)} · 優先程度 ${e(task.finding.severity)} · ${task.included ? '本次處理' : '暫緩處理'}</p><p>${e(task.finding.advice.why)}</p><label class="field" for="task-note-${i}">修改這項任務的要求<textarea id="task-note-${i}" data-task-note="${i}" rows="2" placeholder="例如：保留現有品牌名稱；先提供草稿，不直接發佈。">${e(task.note)}</textarea></label><details><summary>操作位置、適用條件與驗收</summary><div>${guidance(task.finding)}</div></details></article>`).join('')}<div class="actions"><button class="quiet" data-nav="results">回到證據</button><button class="primary" data-nav="prompt">請 AI 協助 →</button></div></section>`;
}
function currentPrompt() { return compilePrompt(state.before, state.plan, { tool: state.tool, scope: state.scope, notes: state.notes }); }
function renderPrompt() {
  if (!state.before.length) return empty('AI 指令需要實際檢測資料', '先帶入網頁並選擇改善項目；不必申請 LLM API Key。');
  const selected = state.plan.filter(t => t.included);
  return intro('04 / 請 AI 協助', '把完整背景，一次交給你的 AI。', '指令包含你選擇的問題、證據、修改範圍、備份與驗收要求。複製到既有 AI 對話即可；本工具不會替你傳送內容或登入網站。') +
  `<div class="prompt-grid"><section class="panel"><h2>這次要交付的任務</h2><p class="panel-subtitle">已選擇 ${selected.length} 項。<button class="text-button" data-nav="plan">回去調整順序與內容</button></p><ol class="help-list">${selected.map(t => `<li>${e(t.finding.name)}</li>`).join('')}</ol><label class="field" for="ai-tool">交給哪個 AI 工具<select id="ai-tool">${['ChatGPT','Gemini','Claude','Codex','Claude Code','通用 AI 助手'].map(t => `<option ${state.tool === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label class="field" for="scope">允許修改的範圍<textarea id="scope" rows="4">${e(state.scope)}</textarea></label><label class="field" for="prompt-notes">其他要求<textarea id="prompt-notes" rows="3" placeholder="例如：產品規格必須由工程人員確認。">${e(state.notes)}</textarea></label><div class="soft">一般對話型 AI 未必能讀取或操作網站。若沒有工具權限，請它提供草稿與操作指引，不要接受「已修改」的無證據宣稱。</div><button class="quiet" data-nav="verify">完成修改後，重新驗證 →</button></section><section class="panel"><h2>指令預覽</h2><label class="field" for="prompt-output">可複製的完整 Prompt<textarea id="prompt-output" class="prompt-text" readonly>${e(currentPrompt())}</textarea></label><div class="actions"><button id="copy-prompt" class="primary" ${selected.length ? '' : 'disabled'}>複製完整指令</button><button id="export-prompt" class="quiet" ${selected.length ? '' : 'disabled'}>下載文字檔</button></div><p class="panel-subtitle" style="margin-top:14px">貼上之前，請檢查是否含有不適合交給外部 AI 的網站資料。送出後請保留 AI 的修改紀錄，回到「重新驗證」再次讀取線上頁面。</p></section></div>`;
}
function renderVerify() {
  if (!state.before.length) return empty('先保留改善前的檢測', '同一套規則與來源方式，才能比較修正前後的差異。');
  const comparison = state.after.length ? compareAudits(state.before, state.after, state.history[1]?.audits || []) : [];
  const counts = ['已修正','尚未修正','新增問題','回歸問題','待確認'].map(k => `<span class="compare-pill">${k} <b>${comparison.filter(r => r.change === k).length}</b></span>`).join('');
  return intro('05 / 重新驗證', '修正了什麼，讓證據說明。', '改善前的檢測會保留。重新讀取同一個線上網址，以相同設定比較最新版本；也可以多次驗證，檢查是否出現回歸問題。') +
  (state.before.every(a => a.page.sourceKind === '虛構練習範例') ? `<section class="panel sample-panel"><span class="sample-tag">虛構範例 · 可重現的前後差異</span><h2>試試修正後的同一頁</h2><p class="panel-subtitle">載入另一份實際 HTML，再執行相同規則。這不代表任何正式網站已被修改。</p><button class="primary" id="sample-after">載入修正後範例並比較</button></section>` : '') +
  (comparison.length ? `<section class="panel" id="comparison"><div class="filterbar"><h2>改善前 / 最近一次改善後</h2><div class="actions"><button class="quiet" id="export-report">匯出完整報告</button><button class="quiet" id="export-data">下載原始檢測資料</button></div></div><div class="compare-summary">${counts}</div><p class="panel-subtitle">「已修正」限原 FAIL／WARNING 變為 PASS；回歸包含前次已通過、這次又出現的問題。移除資料、未知、不同設定或缺頁，都不算修正。</p><div class="table-wrap"><table class="comparison-table"><thead><tr><th>頁面與檢查</th><th>改善前</th><th>改善後</th><th>比較結果</th></tr></thead><tbody>${comparison.map(r => `<tr><td><b>${e(r.name)}</b><br><small>${e(r.pageUrl)}</small></td><td>${label(r.before?.status || 'UNKNOWN')}<details><summary>原始證據</summary><pre class="evidence">${e(r.before?.evidence.excerpt || '未提供')}</pre></details></td><td>${label(r.after?.status || 'UNKNOWN')}<details><summary>本次證據</summary><pre class="evidence">${e(r.after?.evidence.excerpt || '未提供')}</pre></details></td><td><b>${e(r.change)}</b><br><small>${e(r.reason)}</small></td></tr>`).join('')}</tbody></table></div><div class="soft">下一步：優先檢查回歸與尚未修正的項目；待確認項目需要補足資料或外部驗證。技術通過不代表業務成效。</div></section>` : '') +
  importPanel('after') +
  `<section class="panel"><h2>驗證紀錄</h2>${state.history.length ? state.history.map(h => `<div class="history-item">${e(new Date(h.at).toLocaleString('zh-TW'))} · ${h.pages} 頁 · 已修正 ${h.fixed} · 回歸 ${h.regressed} · 待確認 ${h.unknown}</div>`).join('') : '<p class="panel-subtitle">尚未執行改善後檢測。每次重新驗證都會留下本次摘要。</p>'}<p class="panel-subtitle">關閉分頁會清除本次資料。報告含改善前與最近一次的完整證據，以及每次驗證摘要；原始資料下載含所有驗證快照。</p></section>`;
}
function renderHelp() {
  return intro('使用說明', '知道能確認什麼，也知道下一步在哪裡。', '這是一個靜態 HTML 檢測與改善工作台。公開網址經本站服務擷取，核心分析在瀏覽器內執行；不依賴 LLM，也不會自動修改 WordPress。') +
  `<section class="panel"><h2>第一次使用</h2><ol class="help-list"><li>在「開始檢測」輸入公開網頁網址，選擇是否為產品頁與多語系頁。</li><li>按「檢查這個網頁」，由本站服務讀取線上 HTML，立即在瀏覽器分析並顯示結果。</li><li>檢測後查看「原始證據」及「如何處理與驗收」。依外掛、主題及產品資料確認建議是否適用。</li><li>到「安排改善」選擇任務、調整順序與要求。可自行修改，也可將「請 AI 協助」的指令貼到既有 AI。</li><li>實際修改後，在「重新驗證」按「重新讀取並比較」，以相同網址與設定檢查最新線上版本。</li><li>關閉前匯出報告或原始資料。資料不會自動保存到瀏覽器或雲端；本版不提供報告重新匯入。</li></ol></section>
  <div class="two-col"><section class="panel"><h2>結果怎麼讀？</h2><ul class="help-list">${Object.entries(STATUS_LABELS).map(([s,t]) => `<li>${label(s)}<br>${e(t)}${s === 'PASS' ? '，只代表該項已說明的局部條件符合。' : s === 'UNKNOWN' ? '，需要其他資料，不能當作通過。' : '。'}</li>`).join('')}</ul></section><section class="panel"><h2>能力邊界</h2><ul class="help-list"><li>網址由本站 Cloudflare 服務讀取，不受瀏覽器 CORS 限制。不傳送 Cookie 或登入資料；需要登入、驗證碼、阻擋機器人或逾時的頁面仍可能無法讀取。</li><li>不執行匯入 HTML 的 Script、不載入其中圖片、iframe 或外部資源。動態渲染後內容可能不在檔案內。</li><li>不檢查 HTTP 標頭、robots.txt、Sitemap、全站失效連結或跨頁 hreflang 回連。</li><li>JSON-LD 只驗證 JSON 語法；請另用 Google Rich Results Test 或 Schema.org validator 驗證規格。</li><li>表格與詢價連結只是結構提示；工程數值、翻譯、規格表語意及表單送出需要人工核對。</li><li>每批 20 頁，每頁 2 MB，合計 20 MB。大型或複雜頁面可能需要較久，超出範圍請分批。</li></ul></section></div>
  <section class="panel"><h2>與既有工具搭配</h2><p class="panel-subtitle">在此整理證據、改善計畫與前後比較；需要更廣的網站資料時，使用既有工具補足。這些外部服務有各自的使用條件及資料政策。</p><div class="actions"><a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer">Google Search Console ↗</a><a href="https://search.google.com/test/rich-results" target="_blank" rel="noopener noreferrer">Rich Results Test ↗</a><a href="https://validator.schema.org/" target="_blank" rel="noopener noreferrer">Schema.org Validator ↗</a><a href="https://pagespeed.web.dev/" target="_blank" rel="noopener noreferrer">PageSpeed Insights ↗</a></div></section>
  <section class="panel"><h2>規則與來源</h2><p class="panel-subtitle">規則版本 ${RULE_VERSION}。官方規範、官方建議與本工具啟發式分開標示；不使用自創 SEO / AIO 總分。</p><ul class="help-list">${RULES.map(r => `<li><a href="${e(r.source)}" target="_blank" rel="noopener noreferrer">${e(r.name)}</a> · ${e(r.standard)}</li>`).join('')}</ul></section>
  <section class="panel"><h2>開源與授權</h2><p class="panel-subtitle">WP Search Lab 由 Nio 指定開發，原創部分採 MIT。HTML 解析正式引用 parse5 8.1.1（MIT）與 entities（BSD-2-Clause），已隨此檔案完整包含授權。原創貢獻是繁中改善流程、證據映射、WordPress 指引、Prompt 組合與比較介面。</p><details><summary>parse5 授權全文</summary><pre class="legal">${e(parse5License)}</pre></details><details><summary>entities 授權全文</summary><pre class="legal">${e(entitiesLicense)}</pre></details><p class="panel-subtitle">完整來源、版本及開發測試入口見 Repository 的 THIRD_PARTY_NOTICES.md、README.md 與 PRD.md。</p></section>`;
}
function addDrafts(target, incoming) {
  const current = state.drafts[target];
  if (current.length + incoming.length > LIMITS.pages) throw new Error('每批最多 20 頁，請先移除部分頁面。');
  const total = [...current, ...incoming].reduce((sum,d) => sum + new TextEncoder().encode(d.html).byteLength, 0);
  if (total > LIMITS.totalBytes) throw new Error('這批資料超過 20 MB，請減少頁數。');
  for (const d of incoming) if (!d.html.trim() || new TextEncoder().encode(d.html).byteLength > LIMITS.pageBytes) throw new Error('檔案不可空白，每頁上限為 2 MB。');
  state.drafts[target].push(...incoming); render();
}
async function readFiles(input) {
  const target = input.dataset.target, files = Array.from(input.files);
  if (!files.length) return;
  if (files.some(f => !/\.html?$/i.test(f.name))) throw new Error('請選取 .html 或 .htm 網頁檔案。');
  if (files.some(f => f.size > LIMITS.pageBytes)) throw new Error('有檔案超過每頁 2 MB 上限，請改用較小的網頁檔案。');
  if (files.reduce((sum, f) => sum + f.size, 0) > LIMITS.totalBytes) throw new Error('檔案總計超過 20 MB，請減少頁數。');
  const drafts = await Promise.all(files.map(async f => ({ name: f.name, html: await f.text(), url: '', sourceKind: '匯入網頁', capturedAt: new Date().toISOString(), context: { product: true, multilingual: false } })));
  addDrafts(target, drafts); notify('網頁已加入。請逐頁填入並確認原始網址，再開始檢測；不會根據檔名或 Canonical 猜測網址。');
}
async function fetchPage(target) {
  if (location.protocol === 'file:') throw new Error('線上網址檢測請使用作品集網站；此下載版本仍可在進階選項匯入 HTML。');
  const input = document.querySelector('#fetch-url').value.trim();
  const url = normalizeUrl(/^https?:\/\//i.test(input) ? input : 'https://' + input);
  const context = { product: document.querySelector('#fetch-product').checked, multilingual: document.querySelector('#fetch-multilingual').checked };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  notify('正在讀取線上頁面並檢查結構，請稍候…');
  const button = document.querySelector('#fetch-page'); button.disabled = true; button.textContent = '讀取與檢測中…';
  try {
    const response = await fetch('/api/inspect-page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), credentials: 'omit', signal: controller.signal });
    if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('線上讀取服務暫時不可用，請稍後再試。');
    const page = await response.json();
    if (!response.ok || page.error) throw new Error(page.error || '無法取得這個網頁。');
    const snapshot = createSnapshot({ url: page.url, html: page.html, sourceKind: '線上網頁讀取', capturedAt: page.capturedAt, context });
    state.drafts[target] = [snapshot];
    runAudit(target);
    notify(`已直接檢查線上頁面：${page.url} · HTTP ${page.status} · ${(page.bytes / 1024).toFixed(1)} KB · ${new Date(page.capturedAt).toLocaleString('zh-TW')}${page.requestedUrl !== page.url ? '（已跟隨網站轉址）' : ''}`);
  } catch (error) {
    if (error.name === 'TypeError' || error.name === 'AbortError') throw new Error('讀取服務連線失敗或逾時，請稍後重試。本次沒有產生新的檢測結果。');
    throw error;
  } finally {
    clearTimeout(timer);
    if (button.isConnected) { button.disabled = false; button.textContent = target === 'after' ? '重新讀取並比較' : '檢查這個網頁 →'; }
  }
}

function runAudit(target) {
  if (target === 'before' && state.before.length) throw new Error('改善前證據已保留。要換網站，請先匯出後開始新檢測。');
  const audits = auditPages(state.drafts[target]);
  if (target === 'before') {
    state.before = audits; state.plan = initialPlan(audits); state.view = 'results';
  } else {
    if (!state.before.length) throw new Error('請先完成改善前檢測。');
    const comparison = compareAudits(state.before, audits, state.after);
    state.after = audits; state.history.unshift({ at: new Date().toISOString(), pages: audits.length, fixed: comparison.filter(r => r.change === '已修正').length, regressed: comparison.filter(r => r.change === '回歸問題').length, unknown: comparison.filter(r => r.change === '待確認').length, audits });
    state.view = 'verify';
  }
  render(); window.scrollTo({ top: 0 }); notify(target === 'before' ? `完成 ${audits.length} 頁靜態 HTML 檢測。請查看每項證據及能力限制。` : '已重新檢測並比較。改善前證據保持不變，請留意待確認與回歸項目。');
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
    if (button.id === 'reset-session') { document.querySelector('#reset-dialog').showModal(); return; }
    if (button.id === 'cancel-reset') { document.querySelector('#reset-dialog').close(); return; }
    if (button.id === 'confirm-reset') { state = emptyState(); document.querySelector('#reset-dialog').close(); document.querySelector('#notice').hidden = true; render(); return; }
    if (button.id === 'sample-before') {
      state.drafts.before = [{ url: sampleUrl, html: sampleBefore, name: 'product-before.html', sourceKind: '虛構練習範例', capturedAt: new Date().toISOString(), context: { product: true, multilingual: false } }]; runAudit('before'); return;
    }
    if (button.id === 'sample-after') {
      state.drafts.after = [{ url: sampleUrl, html: sampleAfter, name: 'product-after.html', sourceKind: '虛構練習範例', capturedAt: new Date().toISOString(), context: { product: true, multilingual: false } }]; runAudit('after'); return;
    }
    if (button.id === 'add-source') {
      const draft = createSnapshot({ url: document.querySelector('#page-url').value, html: document.querySelector('#source-html').value, sourceKind: '貼上原始碼', context: { product: true, multilingual: false } });
      addDrafts(button.dataset.target, [draft]); notify('已加入原始碼。確認頁面類型後即可檢測。'); return;
    }
    if (button.id === 'fetch-page') { setBusy(true); await fetchPage(button.dataset.target); return; }
    if (button.dataset.removeDraft !== undefined) { state.drafts[button.dataset.target].splice(Number(button.dataset.removeDraft), 1); render(); return; }
    if (button.id === 'run-audit' || button.id === 'run-after') { setBusy(true); await new Promise(resolve => setTimeout(resolve, 0)); runAudit(button.id === 'run-audit' ? 'before' : 'after'); return; }
    if (button.dataset.toggleTask) { const task = state.plan.find(t => t.findingKey === button.dataset.toggleTask); task.included = !task.included; render(); return; }
    if (button.dataset.aiTask) { const task = state.plan.find(t => t.findingKey === button.dataset.aiTask); task.included = true; go('prompt'); notify('此問題已加入計畫。指令也包含計畫中其他已選項目；可回「安排改善」調整。'); return; }
    if (button.dataset.move !== undefined) { const i = Number(button.dataset.move), j = i + Number(button.dataset.direction); if (j >= 0 && j < state.plan.length) [state.plan[i], state.plan[j]] = [state.plan[j], state.plan[i]]; render(); return; }
    if (button.id === 'copy-prompt') {
      const value = currentPrompt();
      try { await navigator.clipboard.writeText(value); notify('完整指令已複製。貼到你的 AI 對話後，先確認修改範圍與授權。'); }
      catch { const area = document.querySelector('#prompt-output'); area.focus(); area.select(); notify('瀏覽器未允許自動複製，已選取指令。請按 ⌘C（Mac）或 Ctrl+C，或下載文字檔。'); }
      return;
    }
    if (button.id === 'export-prompt') { download(currentPrompt(), 'wp-search-lab-prompt.txt', 'text/plain;charset=utf-8'); return; }
    if (button.id === 'export-report') { download(reportHtml(reportData()), 'wp-search-lab-report.html', 'text/html;charset=utf-8'); notify('報告已產生。下載檔含網站證據與任務要求，分享前請確認內容。'); return; }
    if (button.id === 'export-data') { download(JSON.stringify(reportData(), null, 2), 'wp-search-lab-evidence.json', 'application/json'); notify('原始檢測資料已產生，包含輸入 HTML 與各次驗證快照，請妥善保存。本版不提供重新匯入。'); return; }
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
