(() => {
  'use strict';

  const MAIN_API_URL = (window.SiteFast && window.SiteFast.API_URL) || (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '';
  const EXEC_CACHE_KEY = 'LP360:TAMBOL:SITE_FAST:readbook-exec-d26-v1';
  const EXEC_CACHE_AGE = 10 * 60 * 1000;
  const CATALOG_CACHE_KEY = 'LP360:TAMBOL:SITE_FAST:readbook-catalog-v1';
  const CATALOG_STALE_AGE = 24 * 60 * 60 * 1000;
  const JSONP_TIMEOUT = 30000;
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAYS = [700, 1500, 2800];

  const track = document.getElementById('readBookTrack');
  if (!track) return;

  const prev = document.getElementById('readBookPrev');
  const next = document.getElementById('readBookNext');
  const dots = document.getElementById('readBookDots');
  let books = [];
  let page = 0;
  let perPage = 4;
  let loaded = false;
  let loading = false;
  let activeExecUrl = '';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[char]));
  const cardsPerPage = () => window.innerWidth <= 620 ? 1 : window.innerWidth <= 900 ? 2 : window.innerWidth <= 1050 ? 3 : 4;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function storageGet(key, maxAge) {
    for (const storage of [window.sessionStorage, window.localStorage]) {
      try {
        const saved = JSON.parse(storage.getItem(key) || 'null');
        if (saved && saved.savedAt && Date.now() - saved.savedAt <= maxAge) return saved;
      } catch (_) {}
    }
    return null;
  }

  function storageSet(key, value) {
    const raw = JSON.stringify(value);
    try { sessionStorage.setItem(key, raw); } catch (_) {}
    try { localStorage.setItem(key, raw); } catch (_) {}
  }

  function storageRemove(key) {
    try { sessionStorage.removeItem(key); } catch (_) {}
    try { localStorage.removeItem(key); } catch (_) {}
  }

  function jsonpRequest(baseUrl, params) {
    return new Promise((resolve, reject) => {
      const callbackName = '__readBookJsonp_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      let settled = false;
      let timeoutId = null;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      };
      const finish = (ok, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        ok ? resolve(value) : reject(value);
      };
      window[callbackName] = payload => finish(true, payload);
      try {
        const url = new URL(baseUrl);
        Object.entries(params || {}).forEach(([key, value]) => {
          if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
        });
        url.searchParams.set('callback', callbackName);
        url.searchParams.set('_t', String(Date.now()));
        script.src = url.toString();
        script.async = true;
        script.onerror = () => finish(false, new Error('เชื่อมต่อ Apps Script ไม่สำเร็จ'));
        timeoutId = setTimeout(() => finish(false, new Error('Apps Script ใช้เวลาตอบกลับนานเกินไป')), JSONP_TIMEOUT);
        document.head.appendChild(script);
      } catch (error) {
        finish(false, error);
      }
    });
  }

  function validExec(url) {
    return /^https:\/\/script\.google\.com\/macros\/s\/[^/?#]+\/exec(?:[?#].*)?$/i.test(String(url || '').trim());
  }

  async function resolveExec(forceFresh) {
    if (!forceFresh) {
      const saved = storageGet(EXEC_CACHE_KEY, EXEC_CACHE_AGE);
      if (validExec(saved?.url)) return saved.url;
    }
    if (!MAIN_API_URL) throw new Error('ไม่พบ URL Apps Script หลักของเว็บไซต์ตำบล');
    const result = await jsonpRequest(MAIN_API_URL, { mode: 'readbookexec' });
    if (!result || result.success !== true) throw new Error((result && result.message) || 'อ่าน URL ระบบอ่านสะสมเวลาจาก Sheet!D26 ไม่สำเร็จ');
    const url = String(result.url || '').trim();
    if (!validExec(url)) throw new Error('URL ระบบอ่านสะสมเวลาที่ Sheet!D26 ไม่ถูกต้อง');
    storageSet(EXEC_CACHE_KEY, { savedAt: Date.now(), url });
    return url;
  }

  function normalizeBooks(list) {
    return (Array.isArray(list) ? list : []).map(item => ({
      id: String(item?.id || ''),
      title: String(item?.title || 'หนังสือ'),
      author: String(item?.author || ''),
      category: String(item?.category || ''),
      coverUrl: String(item?.coverUrl || '')
    })).filter(item => item.id || item.title);
  }

  function renderCard(book) {
    const image = book.coverUrl
      ? `<img src="${esc(book.coverUrl)}" alt="ปก ${esc(book.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
      : '';
    return `<article class="readbook-card" tabindex="0" role="link" aria-label="เปิดกิจกรรม ${esc(book.title)}" data-readbook-open>
      <div class="readbook-cover">
        <div class="readbook-cover-placeholder"><div><i class="fa-solid fa-book-open" aria-hidden="true"></i><span>${esc(book.title)}</span></div></div>
        ${image}
      </div>
      <div class="readbook-body"><h3>${esc(book.title)}</h3></div>
    </article>`;
  }

  function render() {
    perPage = cardsPerPage();
    const totalPages = Math.max(1, Math.ceil(books.length / perPage));
    page = Math.max(0, Math.min(page, totalPages - 1));
    track.innerHTML = books.map(renderCard).join('');
    track.querySelectorAll('[data-readbook-open]').forEach(card => {
      const open = () => window.open('readbook.html', '_blank', 'noopener');
      card.addEventListener('click', open);
      card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      });
    });
    renderDots(totalPages);
    updateSlider(false);
  }

  function renderDots(totalPages) {
    if (!dots) return;
    dots.innerHTML = totalPages <= 1 ? '' : Array.from({ length: totalPages }, (_, i) =>
      `<button class="readbook-dot${i === page ? ' active' : ''}" type="button" aria-label="หน้าที่ ${i + 1}" data-page="${i}"></button>`
    ).join('');
    dots.querySelectorAll('[data-page]').forEach(button => {
      button.addEventListener('click', () => { page = Number(button.dataset.page) || 0; updateSlider(true); });
    });
  }

  function updateSlider(animate) {
    if (!books.length) return;
    const newPerPage = cardsPerPage();
    if (newPerPage !== perPage) {
      perPage = newPerPage;
      page = 0;
      render();
      return;
    }
    const totalPages = Math.max(1, Math.ceil(books.length / perPage));
    page = Math.max(0, Math.min(page, totalPages - 1));
    track.style.transition = animate === false ? 'none' : '';
    const card = track.querySelector('.readbook-card');
    if (card) track.style.transform = `translateX(-${page * perPage * (card.getBoundingClientRect().width + 18)}px)`;
    if (animate === false) requestAnimationFrame(() => { track.style.transition = ''; });
    if (prev) prev.disabled = totalPages <= 1 || page <= 0;
    if (next) next.disabled = totalPages <= 1 || page >= totalPages - 1;
    if (dots) dots.querySelectorAll('.readbook-dot').forEach((dot, i) => dot.classList.toggle('active', i === page));
  }

  function move(delta) {
    const totalPages = Math.max(1, Math.ceil(books.length / perPage));
    page = (page + delta + totalPages) % totalPages;
    updateSlider(true);
  }

  function receive(payload, execUrl, writeCache) {
    if (!payload || payload.success !== true || !Array.isArray(payload.books)) return false;
    books = normalizeBooks(payload.books);
    if (writeCache) storageSet(CATALOG_CACHE_KEY, { savedAt: Date.now(), execUrl, payload });
    if (!books.length) {
      track.innerHTML = '<div class="readbook-loading">ยังไม่มีหนังสือที่เปิดใช้งาน</div>';
      if (dots) dots.innerHTML = '';
      if (prev) prev.disabled = true;
      if (next) next.disabled = true;
      return true;
    }
    render();
    return true;
  }

  function showError(error) {
    const message = esc(error?.message || error || 'โหลดรายการหนังสือไม่สำเร็จ');
    track.innerHTML = `<div class="readbook-loading readbook-error"><strong>โหลดรายการหนังสือไม่สำเร็จ</strong><span>${message}</span><button class="readbook-retry" type="button">ลองใหม่</button></div>`;
    const retry = track.querySelector('.readbook-retry');
    if (retry) retry.onclick = () => { loaded = false; loading = false; loadCatalog(true); };
    if (dots) dots.innerHTML = '';
    if (prev) prev.disabled = true;
    if (next) next.disabled = true;
  }

  async function loadCatalog(forceFresh = false) {
    if (loading || (loaded && !forceFresh)) return;
    loading = true;
    let lastError = null;
    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          activeExecUrl = await resolveExec(forceFresh || attempt > 0);

          if (attempt === 0 && !forceFresh) {
            const cached = storageGet(CATALOG_CACHE_KEY, CATALOG_STALE_AGE);
            if (cached && cached.execUrl === activeExecUrl && cached.payload) receive(cached.payload, activeExecUrl, false);
          }

          const payload = await jsonpRequest(activeExecUrl, { mode: 'publicbooks' });
          if (!receive(payload, activeExecUrl, true)) {
            throw new Error((payload && payload.message) || 'ระบบอ่านสะสมเวลายังไม่รองรับรายการหนังสือสาธารณะ กรุณา Deploy Code.gs เวอร์ชันที่เพิ่ม mode=publicbooks');
          }
          loaded = true;
          return;
        } catch (error) {
          lastError = error;
          storageRemove(EXEC_CACHE_KEY);
          if (attempt < MAX_ATTEMPTS - 1) {
            track.innerHTML = `<div class="readbook-loading"><span class="readbook-spinner" aria-hidden="true"></span><span>กำลังโหลดหนังสือ... ลองใหม่ครั้งที่ ${attempt + 2}</span></div>`;
            await sleep(RETRY_DELAYS[attempt] || 2000);
          }
        }
      }
      if (!books.length) showError(lastError);
    } finally {
      loading = false;
    }
  }

  if (prev) prev.addEventListener('click', event => { event.stopPropagation(); move(-1); });
  if (next) next.addEventListener('click', event => { event.stopPropagation(); move(1); });
  window.addEventListener('resize', () => { if (books.length) updateSlider(false); });

  if (window.SiteFast && typeof window.SiteFast.whenNear === 'function') {
    window.SiteFast.whenNear('readBookTimeBox', () => loadCatalog(false), '900px 0px');
  } else {
    loadCatalog(false);
  }
})();
