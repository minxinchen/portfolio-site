// Public HTML retrieval only. No credentials, browser execution or arbitrary headers.
const LIMIT = 2 * 1024 * 1024;
const TIMEOUT = 15000;
const redirects = new Set([301, 302, 303, 307, 308]);
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'",
} });

export function publicUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) throw new Error('請輸入有效的公開網頁網址。');
  let url;
  try { url = new URL(value); } catch { throw new Error('請輸入包含 https:// 的完整網址。'); }
  const host = url.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
      !host.includes('.') || !/^[a-z0-9.-]+$/.test(host) || /^[\d.]+$/.test(host) ||
      /(?:^|\.)(localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(host) || host.endsWith('.')) {
    throw new Error('僅接受一般 HTTP／HTTPS 公開網域，不支援內網、IP、登入資訊或自訂連接埠。');
  }
  url.hash = '';
  return url;
}

export function isPublicAddress(ip) {
  if (ip.includes(':')) {
    // Only global IPv6 unicast; reject documentation/transition ranges as well.
    return /^[23][0-9a-f]{3}:/i.test(ip) && !/^(2001:(?:0:|db8:|2:|10:|20:)|2002:|3fff:)/i.test(ip);
  }
  const a = ip.split('.').map(Number);
  if (a.length !== 4 || a.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return !(a[0] === 0 || a[0] === 10 || a[0] === 127 || a[0] >= 224 ||
    (a[0] === 100 && a[1] >= 64 && a[1] <= 127) || (a[0] === 169 && a[1] === 254) ||
    (a[0] === 172 && a[1] >= 16 && a[1] <= 31) || (a[0] === 192 && (a[1] === 168 || a[1] === 0 || a[1] === 2)) ||
    (a[0] === 198 && (a[1] === 18 || a[1] === 19 || a[1] === 51)) || (a[0] === 203 && a[1] === 0 && a[2] === 113));
}

async function checkDns(host, fetcher, signal) {
  const answers = await Promise.all(['A', 'AAAA'].map(async type => {
    const response = await fetcher(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { Accept: 'application/dns-json' }, signal,
    });
    if (!response.ok) throw new Error('暫時無法確認網域，請稍後重試。');
    const data = await response.json();
    if (data.Status !== 0) throw new Error('找不到這個公開網域，請檢查網址。');
    return (data.Answer || []).filter(a => a.type === 1 || a.type === 28).map(a => a.data);
  }));
  const addresses = answers.flat();
  if (!addresses.length || addresses.some(ip => !isPublicAddress(ip))) throw new Error('此網址未解析至可接受的公開網路位址。');
}

async function limitedBytes(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel(); throw new Error('頁面超過 2 MB 上限，尚未執行檢測。');
  }
  if (!response.body) throw new Error('網站沒有回傳頁面內容。');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error('頁面超過 2 MB 上限，尚未執行檢測。'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let at = 0;
  for (const part of chunks) { bytes.set(part, at); at += part.length; }
  return bytes;
}

export async function retrievePage(value, fetcher = fetch, timeoutMs = TIMEOUT) {
  let url = publicUrl(value); const requestedUrl = url.href;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= 5; hop++) {
      await checkDns(url.hostname, fetcher, controller.signal);
      const response = await fetcher(url.href, {
        method: 'GET', redirect: 'manual', signal: controller.signal, credentials: 'omit', cache: 'no-store',
        headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'WP-Search-Lab/0.2 (+https://portfolio-site-1b8.pages.dev/projects/wp-search-lab.html)' },
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
      return { requestedUrl, url: url.href, html, bytes: bytes.length, status: response.status, capturedAt: new Date().toISOString(), sourceKind: '線上網頁讀取' };
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('網站讀取超過 15 秒，請稍後重試。');
    if (error instanceof TypeError) throw new Error('目前無法連線至這個網站，請確認網址或稍後重試。');
    throw error;
  } finally { clearTimeout(timer); }
}

export async function onRequest({ request }) {
  if (request.method !== 'POST') return json({ error: '請從 WP Search Lab 輸入網址。' }, 405);
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: '請從本站工作台發起檢測。' }, 403);
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) return json({ error: '請使用 JSON 請求。' }, 415);
  try {
    // Bound the input stream before parsing, including requests without Content-Length.
    const bytes = await limitedBytes(request, 4096);
    let data; try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ error: '網址資料格式不正確。' }, 400); }
    const page = await retrievePage(data.url);
    return json(page);
  } catch (error) { return json({ error: error.message || '暫時無法取得網頁。' }, 422); }
}
