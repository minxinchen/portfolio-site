import test from 'node:test';
import assert from 'node:assert/strict';
import { auditPage, analyzeSite, triageGscUrls } from '../tools/wp-search-lab/src/core.js';
import { discoverSitemapUrls } from '../functions/api/discover-sitemap.js';
import { fetchPageSpeed } from '../functions/api/pagespeed.js';
import { checkRateLimit, resetRateLimits, validateSameOriginPost } from '../functions/_lib/net.js';

const dns = () => new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }));
const mocked = handler => async (url, options) => String(url).startsWith('https://cloudflare-dns.com/') ? dns() : handler(url, options);

test('analyzeSite ranks pages, detects duplicate titles/descriptions, and suggests internal links', () => {
  const a1 = auditPage({
    url: 'https://shop.example.org/seo-guide',
    html: '<!doctype html><html lang="zh-Hant"><head><title>WordPress SEO 完整教學</title><meta name="description" content="共用摘要"></head><body><main><h1>WordPress SEO 完整教學</h1><p>本文介紹如何優化網站結構，如果你使用工業泵浦型錄，也可以搭配規格表格提升轉換率。</p></main></body></html>',
    sourceKind: 'sitemap',
  });
  const a2 = auditPage({
    url: 'https://shop.example.org/pump-catalog',
    html: '<!doctype html><html lang="zh-Hant"><head><title>WordPress SEO 完整教學</title><meta name="description" content="共用摘要"></head><body><main><h1>工業泵浦規格選型</h1><p>介紹工業泵浦參數。</p><a href="https://shop.example.org/seo-guide">看教學</a></main></body></html>',
    sourceKind: 'sitemap',
  });
  const site = analyzeSite([a1, a2]);
  assert.equal(site.pageRanking.length, 2);
  assert.equal(site.duplicateTitles.length, 1);
  assert.equal(site.duplicateDescriptions.length, 1);
  // a1 mentions 工業泵浦 without linking to a2 -> should suggest a1 -> a2
  assert.ok(site.linkSuggestions.some(s => s.fromUrl === a1.page.url && s.toUrl === a2.page.url));
  // a2 already links to a1 -> must NOT suggest a2 -> a1
  assert.ok(!site.linkSuggestions.some(s => s.fromUrl === a2.page.url && s.toUrl === a1.page.url));
});

test('discoverSitemapUrls follows robots.txt sitemapindex and filters off-origin/asset URLs', async () => {
  const fetcher = mocked(url => {
    const s = String(url);
    if (s.endsWith('/robots.txt')) return new Response('User-agent: *\nSitemap: https://example.com/sitemap_index.xml', { headers: { 'Content-Type': 'text/plain' } });
    if (s.endsWith('/sitemap_index.xml')) return new Response('<sitemapindex><sitemap><loc>https://example.com/post-sitemap.xml</loc></sitemap></sitemapindex>', { headers: { 'Content-Type': 'application/xml' } });
    if (s.endsWith('/post-sitemap.xml')) return new Response('<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url><url><loc>https://example.com/pic.jpg</loc></url><url><loc>https://other.org/evil</loc></url></urlset>', { headers: { 'Content-Type': 'application/xml' } });
    return new Response('', { status: 404 });
  });
  const res = await discoverSitemapUrls('https://example.com/', fetcher, 10);
  assert.equal(res.sitemapUrl, 'https://example.com/sitemap_index.xml');
  assert.deepEqual(res.urls, ['https://example.com/a', 'https://example.com/b']);
});

test('fetchPageSpeed parses mobile metrics and handles 429 quota cleanly', async () => {
  const okFetcher = mocked(() => new Response(JSON.stringify({
    lighthouseResult: {
      categories: { performance: { score: 0.86 }, seo: { score: 0.92 } },
      audits: {
        'largest-contentful-paint': { numericValue: 2100, displayValue: '2.1 s' },
        'cumulative-layout-shift': { numericValue: 0.04, displayValue: '0.04' },
        'total-blocking-time': { numericValue: 180, displayValue: '180 ms' },
        'first-contentful-paint': { numericValue: 1200, displayValue: '1.2 s' },
      },
    },
  }), { headers: { 'Content-Type': 'application/json' } }));
  const psi = await fetchPageSpeed('https://example.com/', { fetcher: okFetcher });
  assert.equal(psi.score, 86);
  assert.equal(psi.seoScore, 92);
  assert.equal(psi.metrics.lcp.status, '良好');
  assert.equal(psi.metrics.cls.status, '良好');

  const quotaFetcher = mocked(() => new Response('{}', { status: 429 }));
  await assert.rejects(fetchPageSpeed('https://example.com/', { fetcher: quotaFetcher }), /免費額度/);
});

test('rate limiter and Sec-Fetch-Site guard block abuse', () => {
  resetRateLimits();
  const makeReq = (ip, secFetch = 'same-origin') => new Request('https://portfolio-site-1b8.pages.dev/api/inspect-page', {
    method: 'POST',
    headers: { Origin: 'https://portfolio-site-1b8.pages.dev', 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, 'Sec-Fetch-Site': secFetch },
  });
  assert.equal(validateSameOriginPost(makeReq('1.1.1.1', 'cross-site')).status, 403);
  assert.equal(validateSameOriginPost(makeReq('1.1.1.1', 'same-origin')), null);
  assert.equal(checkRateLimit(makeReq('2.2.2.2'), { key: 't', max: 2, windowMs: 60000, now: 1000 }).ok, true);
  assert.equal(checkRateLimit(makeReq('2.2.2.2'), { key: 't', max: 2, windowMs: 60000, now: 2000 }).ok, true);
  const blocked = checkRateLimit(makeReq('2.2.2.2'), { key: 't', max: 2, windowMs: 60000, now: 3000 });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSec >= 57);
});

test('triageGscUrls classifies WordPress feeds, assets, search/pagination, legacy redirects, and real content cleanly', () => {
  const raw = [
    'URL\tLast crawled',
    'https://demo.example/post-a/feed/',
    'https://demo.example/post-a/feed/',
    'https://demo.example/wp-content/themes/x/style.css?ver=1',
    'https://demo.example/wp-json/',
    'https://demo.example/?s=query',
    'https://demo.example/blog/page/2/',
    'http://demo.example/',
    'https://www.demo.example/',
    'https://demo.example/index.php/contact/',
    'https://demo.example/real-article-guide/',
  ].join('\n');
  const res = triageGscUrls(raw);
  assert.equal(res.total, 9);
  const byId = Object.fromEntries(res.buckets.map(b => [b.id, b.count]));
  assert.equal(byId.feed, 1);
  assert.equal(byId.asset, 2);
  assert.equal(byId.search, 2);
  assert.equal(byId.legacy, 3);
  assert.equal(byId.content, 1);
});
