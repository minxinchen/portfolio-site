// Mobile PageSpeed Insights proxy (Google PageSpeed Insights v5 REST API).
import { json, publicUrl, checkDns, validateSameOriginPost, checkRateLimit, limitedBytes } from '../_lib/net.js';

function grade(value, good, poor) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '未知';
  return value <= good ? '良好' : value <= poor ? '需改善' : '偏慢';
}

export async function fetchPageSpeed(value, { fetcher = fetch, apiKey = '', timeoutMs = 25000 } = {}) {
  const url = publicUrl(value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await checkDns(url.hostname, fetcher, controller.signal);
    const endpoint = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    endpoint.searchParams.set('url', url.href);
    endpoint.searchParams.set('strategy', 'mobile');
    endpoint.searchParams.set('category', 'performance');
    if (apiKey) endpoint.searchParams.set('key', apiKey);
    const res = await fetcher(endpoint.href, { method: 'GET', signal: controller.signal, headers: { Accept: 'application/json' } });
    if (res.status === 429) throw new Error('Google PageSpeed 免費額度暫時達上限，請稍後再試，或直接點右側官方連結檢測。');
    if (!res.ok) throw new Error(`PageSpeed 服務回應 HTTP ${res.status}，請稍後再試。`);
    const data = await res.json();
    const lh = data.lighthouseResult || {};
    const score = typeof lh.categories?.performance?.score === 'number' ? Math.round(lh.categories.performance.score * 100) : null;
    const audits = lh.audits || {};
    const lcpMs = audits['largest-contentful-paint']?.numericValue ?? null;
    const cls = audits['cumulative-layout-shift']?.numericValue ?? null;
    const tbtMs = audits['total-blocking-time']?.numericValue ?? null;
    const fcpMs = audits['first-contentful-paint']?.numericValue ?? null;
    return {
      url: url.href,
      strategy: 'mobile',
      score,
      metrics: {
        lcp: { ms: lcpMs, display: audits['largest-contentful-paint']?.displayValue || '', status: grade(lcpMs, 2500, 4000) },
        cls: { value: cls, display: audits['cumulative-layout-shift']?.displayValue || '', status: grade(cls, 0.1, 0.25) },
        tbt: { ms: tbtMs, display: audits['total-blocking-time']?.displayValue || '', status: grade(tbtMs, 200, 600) },
        fcp: { ms: fcpMs, display: audits['first-contentful-paint']?.displayValue || '', status: grade(fcpMs, 1800, 3000) },
      },
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('PageSpeed 檢測超過 25 秒逾時，請稍後重試。');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequest({ request, env }) {
  const rejected = validateSameOriginPost(request);
  if (rejected) return rejected;
  const limit = checkRateLimit(request, { key: 'pagespeed', max: 10, windowMs: 60_000 });
  if (!limit.ok) return json({ error: `請求過於頻繁，請在 ${limit.retryAfterSec} 秒後再試。` }, 429, { 'Retry-After': String(limit.retryAfterSec) });
  try {
    const bytes = await limitedBytes(request, 4096);
    let data; try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ error: '網址資料格式不正確。' }, 400); }
    const result = await fetchPageSpeed(data.url, { apiKey: env?.PSI_API_KEY || '' });
    return json(result);
  } catch (error) { return json({ error: error.message || '暫時無法取得 PageSpeed 數據。' }, 422); }
}
