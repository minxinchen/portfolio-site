// Shared SSRF protection, DNS preflight, streaming size bounds and per-IP sliding-window rate limiting.
export const LIMIT = 2 * 1024 * 1024;
export const TIMEOUT = 15000;
export const redirects = new Set([301, 302, 303, 307, 308]);

const buckets = new Map();

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      ...extraHeaders,
    },
  });
}

export function resetRateLimits() {
  buckets.clear();
}

export function checkRateLimit(request, { key = 'api', max = 30, windowMs = 60_000, now = Date.now() } = {}) {
  const ip = (request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0] || 'anonymous').trim();
  const bucketKey = `${key}:${ip}`;
  const cutoff = now - windowMs;
  if (buckets.size > 2000) {
    for (const [k, list] of buckets) {
      const fresh = list.filter(t => t > cutoff);
      if (fresh.length) buckets.set(k, fresh);
      else buckets.delete(k);
    }
  }
  const stamps = (buckets.get(bucketKey) || []).filter(t => t > cutoff);
  if (stamps.length >= max) {
    const retryAfterSec = Math.max(1, Math.ceil((stamps[0] + windowMs - now) / 1000));
    buckets.set(bucketKey, stamps);
    return { ok: false, remaining: 0, retryAfterSec };
  }
  stamps.push(now);
  buckets.set(bucketKey, stamps);
  return { ok: true, remaining: max - stamps.length, retryAfterSec: 0 };
}

export function validateSameOriginPost(request) {
  if (request.method !== 'POST') return json({ error: '請從 WP Search Lab 輸入網址。' }, 405);
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: '請從本站工作台發起檢測。' }, 403);
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') return json({ error: '僅接受同源瀏覽器請求。' }, 403);
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) return json({ error: '請使用 JSON 請求。' }, 415);
  return null;
}

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
    return /^[23][0-9a-f]{3}:/i.test(ip) && !/^(2001:(?:0:|db8:|2:|10:|20:)|2002:|3fff:)/i.test(ip);
  }
  const a = ip.split('.').map(Number);
  if (a.length !== 4 || a.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return !(a[0] === 0 || a[0] === 10 || a[0] === 127 || a[0] >= 224 ||
    (a[0] === 100 && a[1] >= 64 && a[1] <= 127) || (a[0] === 169 && a[1] === 254) ||
    (a[0] === 172 && a[1] >= 16 && a[1] <= 31) || (a[0] === 192 && (a[1] === 168 || a[1] === 0 || a[1] === 2)) ||
    (a[0] === 198 && (a[1] === 18 || a[1] === 19 || a[1] === 51)) || (a[0] === 203 && a[1] === 0 && a[2] === 113));
}

export async function checkDns(host, fetcher, signal) {
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

export async function limitedBytes(response, limit) {
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
