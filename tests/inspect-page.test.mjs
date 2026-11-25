import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicUrl,isPublicAddress,retrievePage,onRequest} from '../functions/api/inspect-page.js';
const dns = (ip='93.184.216.34') => new Response(JSON.stringify({Status:0,Answer:[{type:1,data:ip}]}));
const html = (body='<html><title>測試</title><h1>內容</h1></html>') => new Response(body,{headers:{'Content-Type':'text/html; charset=utf-8'}});
const mocked = handler => async (url,options) => String(url).startsWith('https://cloudflare-dns.com/') ? dns() : handler(url,options);
test('reject private URLs, credentials, disguised IPs and ports',()=>{
 for(const value of ['file:///etc/passwd','http://localhost/','http://127.1/','https://0x7f000001/','http://2130706433/','https://[::1]/','https://site.local/','https://user:pass@example.com/','https://example.com:8080/','https://example.com./'])assert.throws(()=>publicUrl(value),value);
 assert.equal(publicUrl('https://example.com/path#frag').href,'https://example.com/path');
});
test('reject nonpublic DNS answers',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','172.31.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','198.18.0.1','224.0.0.1','::1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::'])assert.equal(isPublicAddress(ip),false,ip);
 assert.equal(isPublicAddress('2606:4700:4700::1111'),true);
 await assert.rejects(retrievePage('https://example.com',async()=>dns('10.0.0.1')),/公開網路/);
});
test('fetch full raw HTML without forwarding credentials',async()=>{
 const page=await retrievePage('https://example.com',mocked((url,options)=>{assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');assert.equal(options.headers.Cookie,undefined);return html();}));
 assert.match(page.html,/<title>測試/);assert.equal(page.url,'https://example.com/');assert.equal(page.status,200);assert.ok(page.capturedAt);
});
test('validate each redirect and final URL',async()=>{
 let n=0;const page=await retrievePage('https://example.com',mocked(()=>++n===1?new Response('',{status:302,headers:{Location:'/new'}}):html()));assert.equal(page.url,'https://example.com/new');
 await assert.rejects(retrievePage('https://example.com',mocked(()=>new Response('',{status:302,headers:{Location:'http://169.254.169.254/latest/meta-data'}}))),/公開網域/);
 await assert.rejects(retrievePage('https://example.com',mocked(()=>new Response('',{status:302,headers:{Location:'http://example.com'}}))),/未加密/);
 await assert.rejects(retrievePage('https://example.com',mocked(()=>new Response('',{status:302,headers:{Location:'/again'}}))),/轉址過多/);
});
test('reject non-HTML, HTTP failure, empty and challenge pages',async()=>{
 for(const response of [new Response('pdf',{headers:{'Content-Type':'application/pdf'}}),new Response('blocked',{status:403}),html(''),html('<title>Just a moment...</title>')])await assert.rejects(retrievePage('https://example.com',mocked(()=>response)));
});
test('enforce streaming size limit even without content-length',async()=>{
 await assert.rejects(retrievePage('https://example.com',mocked(()=>html('x'.repeat(2*1024*1024+1)))),/2 MB/);
});
test('timeout aborts slow fetch',async()=>{
 await assert.rejects(retrievePage('https://example.com',mocked((u,o)=>new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))),15),/15 秒/);
});
test('route rejects other origins, methods and invalid JSON',async()=>{
 const url='https://portfolio-site-1b8.pages.dev/api/inspect-page';
 assert.equal((await onRequest({request:new Request(url)})).status,405);
 assert.equal((await onRequest({request:new Request(url,{method:'POST',headers:{Origin:'https://other.test'}})})).status,403);
 const result=await onRequest({request:new Request(url,{method:'POST',headers:{Origin:new URL(url).origin,'Content-Type':'application/json'},body:'bad'})});assert.equal(result.status,400);assert.equal(result.headers.get('cache-control'),'no-store');
});
