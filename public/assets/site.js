(()=>{
  const menu=document.querySelector('[data-menu]'); const nav=document.querySelector('.site-nav');
  if(menu&&nav){menu.addEventListener('click',()=>{const opened=nav.classList.toggle('open');menu.setAttribute('aria-expanded',String(opened));menu.textContent=opened?'關閉':'選單';});nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{nav.classList.remove('open');menu.setAttribute('aria-expanded','false');menu.textContent='選單';}));}
  const filters=[...document.querySelectorAll('[data-filter]')],items=[...document.querySelectorAll('[data-post]')],search=document.querySelector('[data-search]'),empty=document.querySelector('[data-empty]');let cat='全部';
  const update=()=>{const term=(search?.value||'').trim().toLocaleLowerCase();let count=0;for(const el of items){const ok=(cat==='全部'||el.dataset.category===cat)&&((el.textContent||'').toLocaleLowerCase().includes(term));el.classList.toggle('hide',!ok);if(ok)count++;}if(empty)empty.hidden=count>0;};
  filters.forEach(el=>el.addEventListener('click',()=>{cat=el.dataset.filter;filters.forEach(b=>{b.classList.toggle('active',b===el);b.setAttribute('aria-pressed',String(b===el));});update();}));search?.addEventListener('input',update);
})();
