(() => {
  // Mobile menu
  const menu = document.querySelector('[data-menu]');
  const nav = document.querySelector('.site-nav');
  if (menu && nav) {
    menu.addEventListener('click', () => {
      const opened = nav.classList.toggle('open');
      menu.setAttribute('aria-expanded', String(opened));
      menu.textContent = opened ? '關閉' : '選單';
    });
    nav.querySelectorAll('a').forEach((a) =>
      a.addEventListener('click', () => {
        nav.classList.remove('open');
        menu.setAttribute('aria-expanded', 'false');
        menu.textContent = '選單';
      })
    );
  }

  // Two-state color-scheme toggle (modern-web-guidance: dark-mode-toggle)
  const meta = document.querySelector('meta[name="color-scheme"]');
  const toggleBtn = document.querySelector('[data-theme-toggle]');
  const mql = window.matchMedia('(prefers-color-scheme: dark)');

  const getStored = () => {
    try {
      const v = localStorage.getItem('color-scheme');
      return v === 'light' || v === 'dark' ? v : null;
    } catch {
      return null;
    }
  };

  const applyMeta = (val) => {
    if (meta) meta.content = val ?? 'light dark';
  };

  if (toggleBtn && meta) {
    toggleBtn.addEventListener('click', () => {
      const systemScheme = mql.matches ? 'dark' : 'light';
      const currentRendered = getStored() ?? systemScheme;
      const target = currentRendered === 'dark' ? 'light' : 'dark';
      try {
        if (target === systemScheme) {
          localStorage.removeItem('color-scheme');
          applyMeta(null);
        } else {
          localStorage.setItem('color-scheme', target);
          applyMeta(target);
        }
      } catch {
        applyMeta(target);
      }
    });

    window.addEventListener('storage', (e) => {
      if (e.key === 'color-scheme') {
        const v = e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : null;
        applyMeta(v);
      }
    });
  }

  // Journal filter + search
  const filters = [...document.querySelectorAll('[data-filter]')];
  const items = [...document.querySelectorAll('[data-post]')];
  const search = document.querySelector('[data-search]');
  const empty = document.querySelector('[data-empty]');
  let cat = '全部';

  const update = () => {
    const term = (search?.value || '').trim().toLocaleLowerCase();
    let count = 0;
    for (const el of items) {
      const ok =
        (cat === '全部' || el.dataset.category === cat) &&
        (el.textContent || '').toLocaleLowerCase().includes(term);
      el.classList.toggle('hide', !ok);
      if (ok) count++;
    }
    if (empty) empty.hidden = count > 0;
  };

  filters.forEach((el) =>
    el.addEventListener('click', () => {
      cat = el.dataset.filter;
      filters.forEach((b) => {
        b.classList.toggle('active', b === el);
        b.setAttribute('aria-pressed', String(b === el));
      });
      update();
    })
  );
  search?.addEventListener('input', update);
})();
