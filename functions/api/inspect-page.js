// Public HTML retrieval only. No credentials, browser execution or arbitrary headers.
import { LIMIT, TIMEOUT, redirects, json, publicUrl, isPublicAddress, checkDns, limitedBytes, validateSameOriginPost, checkRateLimit } from '../_lib/net.js';

export { publicUrl, isPublicAddress };

export async function retrievePage(value, fetcher = fetch, timeoutMs = TIMEOUT) {
  let url = publicUrl(value); const requestedUrl = url.href;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= 5; hop++) {
      await checkDns(url.hostname, fetcher, controller.signal);
      const response = await fetcher(url.href, {
        method: 'GET', redirect: 'manual', signal: controller.signal, credentials: 'omit', cache: 'no-store',
        headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'WP-Search-Lab/0.4 (+https://portfolio-site-1b8.pages.dev/projects/wp-search-lab.html)' },
      });
      if (redirects.has(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location || hop === 5) throw new Error('網站轉址過多或缺少目標，請使用最終頁面網址。');
        const next = publicUrl(new URL(location, url).href);
        if (url.protocol === 'https:' && next.protocol === 'http:') throw new Error('網站轉向未加密 HTTP，請確認網址。');
        url = next; continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`網站回應 HTTP ${response.status}，可能限制自動讀取；本次沒有產生檢測結果。`); }
      const mime = response.headers.get('content-type') || '';
      if (!/^(text\/html|application\/xhtml\+xml)\b/i.test(mime)) { await response.body?.cancel(); throw new Error('這個網址沒有回傳 HTML 網頁。'); }
      const bytes = await limitedBytes(response, LIMIT);
      const prefix = new TextDecoder().decode(bytes.subarray(0, 2048));
      const charset = mime.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1] || prefix.match(/<meta[^>]+charset\s*=\s*["']?([^\s"'/>;]+)/i)?.[1] || 'utf-8';
      let html;
      try { html = new TextDecoder(charset).decode(bytes); } catch { throw new Error('這個網頁的文字編碼目前不支援。'); }
      if (!html.trim()) throw new Error('網站回傳空白頁面。');
      if (/cf-chl-|challenge-platform|<title>\s*(Just a moment|Attention Required)/i.test(html)) throw new Error('網站要求瀏覽器驗證，無法取得實際頁面；本次沒有產生檢測結果。');
      const xRobotsTag = response.headers.get('x-robots-tag') || '';
      const robotsUrl = new URL('/robots.txt', url.origin).href;
      let robotsTxt = null;
      try {
        const robotsRes = await fetcher(robotsUrl, {
          method: 'GET', redirect: 'manual', signal: controller.signal, credentials: 'omit', cache: 'no-store',
          headers: { Accept: 'text/plain,*/*;q=0.1', 'User-Agent': 'WP-Search-Lab/0.4 (+https://portfolio-site-1b8.pages.dev/projects/wp-search-lab.html)' },
        });
        const rMime = robotsRes.headers.get('content-type') || '';
        if (robotsRes.ok && !/text\/html/i.test(rMime)) {
          const rBytes = await limitedBytes(robotsRes, 64 * 1024);
          robotsTxt = new TextDecoder('utf-8').decode(rBytes);
        } else {
          await robotsRes.body?.cancel();
        }
      } catch {
        robotsTxt = null;
      }
      return { requestedUrl, url: url.href, html, bytes: bytes.length, status: response.status, xRobotsTag, robotsTxt, robotsUrl, capturedAt: new Date().toISOString(), sourceKind: '線上網頁讀取' };
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('網站讀取超過 15 秒，請稍後重試。');
    if (error instanceof TypeError) throw new Error('目前無法連線至這個網站，請確認網址或稍後重試。');
    throw error;
  } finally { clearTimeout(timer); }
}

export async function onRequest({ request }) {
  const rejected = validateSameOriginPost(request);
  if (rejected) return rejected;
  const limit = checkRateLimit(request, { key: 'inspect-page', max: 30, windowMs: 60_000 });
  if (!limit.ok) return json({ error: `請求過於頻繁，請在 ${limit.retryAfterSec} 秒後再試。` }, 429, { 'Retry-After': String(limit.retryAfterSec) });
  try {
    const bytes = await limitedBytes(request, 4096);
    let data; try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ error: '網址資料格式不正確。' }, 400); }
    const page = await retrievePage(data.url);
    return json(page);
  } catch (error) { return json({ error: error.message || '暫時無法取得網頁。' }, 422); }
}
