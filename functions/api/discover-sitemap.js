// Same-origin Sitemap discovery for site-wide sampling audits (up to 15 public URLs).
import { json, publicUrl, checkDns, limitedBytes, validateSameOriginPost, checkRateLimit } from '../_lib/net.js';

const SITEMAP_LIMIT = 512 * 1024;
const USER_AGENT = 'WP-Search-Lab/0.4 (+https://portfolio-site-1b8.pages.dev/projects/wp-search-lab.html)';

function extractLocs(xml) {
  const locs = [];
  const regex = /<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    const raw = m[1].replace(/&amp;/g, '&').trim();
    if (raw) locs.push(raw);
  }
  return locs;
}

async function fetchTextSafe(targetUrl, fetcher, signal, maxBytes = SITEMAP_LIMIT) {
  const url = publicUrl(targetUrl);
  await checkDns(url.hostname, fetcher, signal);
  const res = await fetcher(url.href, {
    method: 'GET', redirect: 'manual', signal, credentials: 'omit', cache: 'no-store',
    headers: { Accept: 'application/xml,text/xml,text/plain,*/*;q=0.1', 'User-Agent': USER_AGENT },
  });
  if (!res.ok) { await res.body?.cancel(); return null; }
  const mime = res.headers.get('content-type') || '';
  if (/text\/html/i.test(mime)) { await res.body?.cancel(); return null; }
  const bytes = await limitedBytes(res, maxBytes);
  return new TextDecoder('utf-8').decode(bytes);
}

export async function discoverSitemapUrls(siteValue, fetcher = fetch, maxUrls = 10, timeoutMs = 15000) {
  const base = publicUrl(siteValue);
  const cap = Math.max(1, Math.min(15, Number(maxUrls) || 10));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const candidates = [];
    try {
      const robots = await fetchTextSafe(new URL('/robots.txt', base.origin).href, fetcher, controller.signal, 64 * 1024);
      if (robots) {
        for (const line of robots.split(/\r?\n/)) {
          const m = line.match(/^\s*sitemap\s*:\s*(\S+)/i);
          if (m) {
            try {
              const sm = publicUrl(m[1]);
              if (sm.origin === base.origin) candidates.push(sm.href);
            } catch {}
          }
        }
      }
    } catch {}
    for (const path of ['/sitemap_index.xml', '/wp-sitemap.xml', '/sitemap.xml']) {
      const href = new URL(path, base.origin).href;
      if (!candidates.includes(href)) candidates.push(href);
    }

    let usedSitemap = null;
    let xml = null;
    for (const candidate of candidates) {
      try {
        const text = await fetchTextSafe(candidate, fetcher, controller.signal);
        if (text && /<(?:urlset|sitemapindex)\b/i.test(text)) {
          usedSitemap = candidate;
          xml = text;
          break;
        }
      } catch {}
    }
    if (!xml) throw new Error('找不到這個網站公開可讀取的 Sitemap（已嘗試 robots.txt、sitemap_index.xml、wp-sitemap.xml 與 sitemap.xml）。');

    const collected = [];
    const seen = new Set();
    const pushPage = raw => {
      try {
        const u = publicUrl(raw);
        if (u.origin !== base.origin || /\.(?:xml|jpg|jpeg|png|webp|gif|pdf|zip)$/i.test(u.pathname)) return;
        if (!seen.has(u.href)) { seen.add(u.href); collected.push(u.href); }
      } catch {}
    };

    if (/<sitemapindex\b/i.test(xml)) {
      const subs = extractLocs(xml).filter(u => { try { return publicUrl(u).origin === base.origin; } catch { return false; } });
      // Prefer WordPress post/page/product sitemaps first.
      subs.sort((a, b) => (/post|page|product/i.test(b) ? 1 : 0) - (/post|page|product/i.test(a) ? 1 : 0));
      for (const sub of subs.slice(0, 3)) {
        try {
          const subXml = await fetchTextSafe(sub, fetcher, controller.signal);
          if (subXml) extractLocs(subXml).forEach(pushPage);
          if (collected.length >= cap * 2) break;
        } catch {}
      }
    } else {
      extractLocs(xml).forEach(pushPage);
    }

    if (!collected.length) throw new Error('Sitemap 中沒有找到可檢測的同網域網頁網址。');
    // Ensure homepage/requested page is included when present, then evenly sample up to cap.
    const urls = collected.length <= cap ? collected : Array.from({ length: cap }, (_, i) => collected[Math.floor((i * collected.length) / cap)]);
    return { origin: base.origin, sitemapUrl: usedSitemap, totalFound: collected.length, urls };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('讀取 Sitemap 超過 15 秒，請稍後重試。');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequest({ request }) {
  const rejected = validateSameOriginPost(request);
  if (rejected) return rejected;
  const limit = checkRateLimit(request, { key: 'discover-sitemap', max: 10, windowMs: 60_000 });
  if (!limit.ok) return json({ error: `請求過於頻繁，請在 ${limit.retryAfterSec} 秒後再試。` }, 429, { 'Retry-After': String(limit.retryAfterSec) });
  try {
    const bytes = await limitedBytes(request, 4096);
    let data; try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ error: '網址資料格式不正確。' }, 400); }
    const result = await discoverSitemapUrls(data.url, fetch, data.limit || 10);
    return json(result);
  } catch (error) { return json({ error: error.message || '暫時無法讀取 Sitemap。' }, 422); }
}
