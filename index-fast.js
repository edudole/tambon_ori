/* INDEX FAST JS BUNDLE - generated 2026-09-02 */

/* ===== site-fast-data.js ===== */
(() => {
  'use strict';

  const API_URL = window.APP_CONFIG.API_URL;

  // PERFORMANCE/RESILIENCE V10
  // - cache-first + stale-while-revalidate
  // - deduplicate requests
  // - limit parallel Apps Script reads to avoid cold-start congestion
  // - retry transient read failures until the connection succeeds
  const HOMEFAST_CACHE_KEY = 'homefast-v13-first-image-20260917';
  const HOMEFAST_TTL = 5 * 60 * 1000;
  const HOMEFAST_STALE_TTL = 24 * 60 * 60 * 1000;
  const NETWORK_TIMEOUT = 45 * 1000;
  const MAX_CONCURRENT_READS = 2;
  const RETRY_DELAYS = [900, 1600, 3000, 5500, 9000, 15000, 30000];

  const inflight = new Map();
  const backgroundInflight = new Map();
  const readQueue = [];
  let activeReads = 0;
  let homeFastPromise = null;

  function isAdminMode() {
    try { return Boolean(sessionStorage.getItem('LP360:TAMBOL:mysiteAdminToken')); }
    catch (_) { return false; }
  }

  function storageRead(storage, key, maxAgeMs) {
    if (!storage || !key || !maxAgeMs || isAdminMode()) return null;
    try {
      const saved = JSON.parse(storage.getItem('LP360:TAMBOL:SITE_FAST:' + key) || 'null');
      if (!saved || !saved.savedAt || Date.now() - saved.savedAt > maxAgeMs) return null;
      return saved;
    } catch (_) { return null; }
  }

  function readCache(key, maxAgeMs) {
    return storageRead(window.sessionStorage, key, maxAgeMs) ||
      storageRead(window.localStorage, key, maxAgeMs);
  }

  function writeCache(key, data) {
    if (!key || isAdminMode()) return;
    const payload = JSON.stringify({ savedAt: Date.now(), data });
    try { sessionStorage.setItem('LP360:TAMBOL:SITE_FAST:' + key, payload); } catch (_) {}
    try { localStorage.setItem('LP360:TAMBOL:SITE_FAST:' + key, payload); } catch (_) {}
  }

  // FIRST-LOAD IMAGE OPTIMIZER
  // Google Drive/lh3 รูปต้นฉบับอาจมีหลาย MB: ขอขนาดที่เหมาะกับตำแหน่งแสดงผล
  function fastImageUrl(value, width = 1200) {
    const url = String(value || '').trim();
    if (!url) return '';
    const size = Math.max(96, Math.min(2400, Number(width) || 1200));
    let match = url.match(/lh3\.googleusercontent\.com\/d\/([-\w]{25,})/i);
    if (!match && /drive\.google\.com/i.test(url)) match = url.match(/[-\w]{25,}/);
    if (!match) return url;
    return `https://lh3.googleusercontent.com/d/${match[1]}=w${Math.round(size)}`;
  }

  function optimizeHomeFastPayload(payload) {
    const root = payload && payload.data && typeof payload.data === 'object' ? payload.data : payload;
    if (!root || typeof root !== 'object') return payload;

    if (root.images) {
      root.images.brandIcon = fastImageUrl(root.images.brandIcon, 320);
      root.images.heroImage = fastImageUrl(root.images.heroImage, 1800);
      if (Array.isArray(root.images.settingMenus)) {
        root.images.settingMenus.forEach(item => { if (item) item.icon = fastImageUrl(item.icon, 320); });
      }
    }
    const slides = root.news && Array.isArray(root.news.slides) ? root.news.slides : [];
    slides.forEach(item => { if (item) item.image = fastImageUrl(item.image, 1200); });
    if (Array.isArray(root.activity)) {
      root.activity.forEach(item => { if (item) item.image = fastImageUrl(item.image, 900); });
    }
    if (root.boss) {
      root.boss.image = fastImageUrl(root.boss.image, 640);
      root.boss.popupImage = fastImageUrl(root.boss.popupImage, 1400);
    }
    if (root.studentLogin) {
      root.studentLogin.logo = fastImageUrl(root.studentLogin.logo, 360);
      root.studentLogin.banner = fastImageUrl(root.studentLogin.banner, 1200);
    }
    return payload;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function retryDelay(attempt) {
    const base = RETRY_DELAYS[Math.min(Math.max(0, attempt - 1), RETRY_DELAYS.length - 1)];
    return Math.round(base * (0.88 + Math.random() * 0.24));
  }

  async function waitForRetry(ms) {
    if (navigator.onLine === false) {
      await Promise.race([
        new Promise(resolve => window.addEventListener('online', resolve, { once: true })),
        sleep(Math.max(ms, 15000))
      ]);
      return;
    }
    if (document.visibilityState === 'hidden') {
      await Promise.race([
        new Promise(resolve => {
          const onVisible = () => {
            if (document.visibilityState !== 'visible') return;
            document.removeEventListener('visibilitychange', onVisible);
            resolve();
          };
          document.addEventListener('visibilitychange', onVisible);
        }),
        sleep(Math.max(ms, 10000))
      ]);
      return;
    }
    await sleep(ms);
  }

  function acquireReadSlot() {
    if (activeReads < MAX_CONCURRENT_READS) {
      activeReads += 1;
      return Promise.resolve();
    }
    return new Promise(resolve => readQueue.push(resolve)).then(() => { activeReads += 1; });
  }

  function releaseReadSlot() {
    activeReads = Math.max(0, activeReads - 1);
    const next = readQueue.shift();
    if (next) next();
  }

  function isTransientAppError(message) {
    const text = String(message || '').toLowerCase();
    return /timeout|timed out|temporar|try again|service invoked too many|quota|rate limit|too many|internal error|server error|ใช้เวลาตอบกลับ|ลองใหม่|ชั่วคราว/.test(text);
  }

  async function networkJsonOnce(url) {
    await acquireReadSlot();
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), NETWORK_TIMEOUT) : null;

    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'default',
        credentials: 'omit',
        signal: controller ? controller.signal : undefined
      });

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        if (response.status >= 400 && response.status < 500 && ![408, 425, 429].includes(response.status)) {
          error.siteFastPermanent = true;
        }
        throw error;
      }

      const text = await response.text();
      let result;
      try { result = JSON.parse(text); }
      catch (_) { throw new Error('Apps Script ตอบกลับไม่ใช่ JSON'); }

      if (result && result.success === false) {
        const error = new Error(result.message || 'โหลดข้อมูลไม่สำเร็จ');
        if (!isTransientAppError(error.message)) error.siteFastPermanent = true;
        throw error;
      }
      return result;
    } finally {
      if (timer) clearTimeout(timer);
      releaseReadSlot();
    }
  }

  async function networkJson(url, options = {}) {
    const forever = options.forever !== false;
    let attempt = 0;
    while (true) {
      try {
        return await networkJsonOnce(url);
      } catch (error) {
        if (!forever || error?.siteFastPermanent) throw error;
        attempt += 1;
        const delay = retryDelay(attempt);
        console.warn(`SiteFast retry #${attempt} in ${delay}ms:`, url, error?.message || error);
        try {
          window.dispatchEvent(new CustomEvent('sitefast:retry', {
            detail: { url: String(url), attempt, delay, message: String(error?.message || error || '') }
          }));
        } catch (_) {}
        await waitForRetry(delay);
      }
    }
  }

  function refreshKeyInBackground(url, key, ttl) {
    if (!key || isAdminMode() || backgroundInflight.has(key)) return;
    const job = networkJson(url)
      .then(result => { if (ttl > 0) writeCache(key, result); return result; })
      .catch(error => console.warn('SiteFast background refresh:', key, error))
      .finally(() => backgroundInflight.delete(key));
    backgroundInflight.set(key, job);
  }

  function fetchJson(url, options = {}) {
    const key = String(options.key || '').trim();
    const ttl = Number(options.ttl || 0);
    const staleTtl = Number(options.staleTtl || (ttl > 0 ? Math.max(24 * 60 * 60 * 1000, ttl * 12) : 0));

    const fresh = ttl > 0 && key ? readCache(key, ttl) : null;
    if (fresh) return Promise.resolve(fresh.data);

    const stale = staleTtl > 0 && key ? readCache(key, staleTtl) : null;
    if (stale) {
      refreshKeyInBackground(url, key, ttl);
      return Promise.resolve(stale.data);
    }

    const inflightKey = key || String(url);
    if (inflight.has(inflightKey)) return inflight.get(inflightKey);

    const request = networkJson(url)
      .then(result => {
        if (ttl > 0 && key) writeCache(key, result);
        return result;
      })
      .finally(() => inflight.delete(inflightKey));

    inflight.set(inflightKey, request);
    return request;
  }

  function refreshHomeFastInBackground() {
    refreshKeyInBackground(API_URL + '?mode=homefast', HOMEFAST_CACHE_KEY, HOMEFAST_TTL);
  }

  function getHomeFast() {
    if (homeFastPromise) return homeFastPromise;

    const fresh = readCache(HOMEFAST_CACHE_KEY, HOMEFAST_TTL);
    if (fresh) {
      homeFastPromise = Promise.resolve(optimizeHomeFastPayload(fresh.data));
      return homeFastPromise;
    }

    const stale = readCache(HOMEFAST_CACHE_KEY, HOMEFAST_STALE_TTL);
    if (stale) {
      homeFastPromise = Promise.resolve(optimizeHomeFastPayload(stale.data));
      refreshHomeFastInBackground();
      return homeFastPromise;
    }

    const prefetched = window.__SITE_HOMEFAST_PREFETCH;
    const request = prefetched
      ? Promise.race([
          Promise.resolve(prefetched),
          sleep(30000).then(() => { throw new Error('homefast prefetch timeout'); })
        ])
          .then(result => {
            if (!result || result.success === false) throw new Error(result?.message || 'homefast ไม่สำเร็จ');
            return result;
          })
          .catch(() => networkJson(API_URL + '?mode=homefast'))
      : networkJson(API_URL + '?mode=homefast');

    homeFastPromise = request
      .then(result => {
        const optimized = optimizeHomeFastPayload(result);
        writeCache(HOMEFAST_CACHE_KEY, optimized);
        return optimized;
      })
      .catch(error => {
        homeFastPromise = null;
        throw error;
      });

    return homeFastPromise;
  }

  async function homePart(name) {
    try {
      const result = await getHomeFast();
      const data = result?.data || result || {};
      if (Object.prototype.hasOwnProperty.call(data, name)) return data[name];
    } catch (error) {
      console.warn('homefast fallback:', error);
    }

    const fallbackModes = {
      images: 'images',
      about: 'aboutPages',
      news: 'news',
      activity: 'activity',
      boss: 'boss',
      setting: 'setting'
    };
    const mode = fallbackModes[name];
    if (!mode) return undefined;

    const result = await fetchMode(mode, {}, {
      key: `home-part-${name}`,
      ttl: 5 * 60 * 1000,
      staleTtl: 24 * 60 * 60 * 1000
    });
    if (name === 'activity') return result.activities || result.data || [];
    if (name === 'boss') return result.boss || result.data || result || {};
    if (name === 'setting') return result.data || result || {};
    return result.data || result || {};
  }

  function fetchMode(mode, params = {}, options = {}) {
    const url = new URL(API_URL);
    url.searchParams.set('mode', mode);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    });
    const cacheKey = Object.prototype.hasOwnProperty.call(options, 'key')
      ? String(options.key || '')
      : `${mode}:${JSON.stringify(params || {})}`;
    return fetchJson(url.toString(), {
      key: cacheKey,
      ttl: Number(options.ttl || 0),
      staleTtl: Number(options.staleTtl || 0)
    });
  }

  function whenNear(elementOrId, callback, rootMargin = '700px 0px') {
    const start = () => {
      const element = typeof elementOrId === 'string'
        ? document.getElementById(elementOrId)
        : elementOrId;
      if (!element) return;

      let started = false;
      const runOnce = () => {
        if (started) return;
        started = true;
        Promise.resolve().then(callback).catch(error => console.warn('lazy section:', error));
      };

      if (!('IntersectionObserver' in window)) {
        runOnce();
        return;
      }

      const rect = element.getBoundingClientRect();
      if (rect.top < window.innerHeight + 700) {
        runOnce();
        return;
      }

      const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        runOnce();
      }, { rootMargin });

      observer.observe(element);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }

  function clear(prefix = '') {
    [window.sessionStorage, window.localStorage].forEach(storage => {
      try {
        Object.keys(storage).forEach(key => {
          if (!key.startsWith('LP360:TAMBOL:SITE_FAST:')) return;
          if (!prefix || key.includes(prefix)) storage.removeItem(key);
        });
      } catch (_) {}
    });
    homeFastPromise = null;
  }

  window.SiteFast = {
    API_URL,
    fetchJson,
    fetchMode,
    getHomeFast,
    homePart,
    whenNear,
    clear,
    networkJson,
    imageUrl: fastImageUrl
  };

  getHomeFast().catch(error => console.warn('homefast initial:', error));
})();

/* ===== script.js ===== */
(() => {
  'use strict';

  const WEB_APP_URL =
    window.APP_CONFIG.API_URL;
  const IMAGE_API_URL = WEB_APP_URL + '?mode=images';

  const NEWS_API_URL = WEB_APP_URL + '?mode=news';

  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.main-nav');

  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(isOpen));
      toggle.textContent = isOpen ? '✕' : '☰';
    });

    document.querySelectorAll('.main-nav a').forEach(link => {
      link.addEventListener('click', () => {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.textContent = '☰';
      });
    });
  }

  function closeMainNavDropdowns(except) {
    document.querySelectorAll('.main-nav-dropdown.is-open').forEach(dropdown => {
      if (dropdown === except) return;
      dropdown.classList.remove('is-open');
      dropdown.querySelector('.main-nav-dropdown-toggle')
        ?.setAttribute('aria-expanded', 'false');
    });
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('.main-nav-dropdown-toggle');

    if (button) {
      const dropdown = button.closest('.main-nav-dropdown');
      const willOpen = !dropdown.classList.contains('is-open');
      closeMainNavDropdowns(dropdown);
      dropdown.classList.toggle('is-open', willOpen);
      button.setAttribute('aria-expanded', String(willOpen));
      return;
    }

    if (!event.target.closest('.main-nav-dropdown')) {
      closeMainNavDropdowns();
    }

    if (event.target.closest('.main-nav-dropdown-menu a')) {
      closeMainNavDropdowns();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMainNavDropdowns();
  });

function getHeroOverlayProgressState(overlay) {
  if (!overlay) return null;
  if (overlay.__heroOverlayProgressState) {
    return overlay.__heroOverlayProgressState;
  }

  const wrap = document.createElement('div');
  wrap.className = 'hero-image-progress-wrap';
  wrap.setAttribute('aria-live', 'polite');
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="hero-image-progress-row">
      <span class="hero-image-progress-label">Loading...</span>
      <strong class="hero-image-progress-percent">0%</strong>
    </div>
    <progress class="hero-image-progress-bar" max="100" value="0">0%</progress>
  `;

  overlay.appendChild(wrap);

  overlay.__heroOverlayProgressState = {
    wrap,
    progress: wrap.querySelector('progress'),
    timer: null,
    value: 0,
    hideTimer: null
  };

  return overlay.__heroOverlayProgressState;
}

function showHeroOverlayProgress(overlay, imageUrl) {
  if (window.LP360HeroProgress) {
    window.LP360HeroProgress.imageLoading(imageUrl);
    return;
  }
  const state = getHeroOverlayProgressState(overlay);
  if (!state) return;
  state.wrap.hidden = false;
}

function finishHeroOverlayProgress(overlay, imageUrl) {
  if (window.LP360HeroProgress) {
    window.LP360HeroProgress.imageReady(imageUrl);
    return;
  }
  const state = getHeroOverlayProgressState(overlay);
  if (!state) return;
  state.progress.value = 100;
  const percent = state.wrap.querySelector('.hero-image-progress-percent');
  if (percent) percent.textContent = '100%';
  setTimeout(() => { state.wrap.hidden = true; }, 420);
}

async function loadWebsiteImages() {
  try {
    let result;

    if (window.SiteFast) {
      result = Object.assign({ success: true }, await window.SiteFast.homePart('images'));
    } else {
      const response = await fetch(IMAGE_API_URL, { method: 'GET', cache: 'default' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      result = await response.json();
    }

    if (result.success === false) {
      throw new Error(
        result.message || 'โหลดรูปภาพไม่สำเร็จ'
      );
    }

    const images = result.data || result;

    // setting!D2:F = ชื่อเมนู, ชื่อขยาย, URL ไอคอน
    const settingMenus = Array.isArray(images.settingMenus)
      ? images.settingMenus
      : (Array.isArray(images.menus) ? images.menus : []);

    renderSettingMenus(settingMenus);
    renderMainNavMenus(images.mainNavMenus || images.navMenus || {});

    // B2 = URL โลโก้
    // B3 = ชื่อเว็บไซต์
    // B4 = URL รูปหัวเว็บ
    // B5 = หัวข้อบรรทัดที่ 1
    // B6 = หัวข้อบรรทัดที่ 2
    const brandIconUrl =
      String(images.brandIcon || '').trim();

    const brandName =
      String(images.siteTitle || '').trim();

    const heroOverlayUrl =
      String(images.heroImage || '').trim();

    const heroTitleLine1 =
      String(images.heroTitle1 || '').trim();

    const heroTitleLine2 =
      String(images.heroTitle2 || '').trim();

    if (brandIconUrl) {
      document
        .querySelectorAll('[data-website-brand-icon]')
        .forEach(icon => {
          icon.textContent = '';
          icon.style.backgroundImage =
            `url("${window.SiteFast?.imageUrl ? window.SiteFast.imageUrl(brandIconUrl, 320) : brandIconUrl}")`;

          icon.style.backgroundSize = 'cover';
          icon.style.backgroundPosition = 'center';
          icon.style.backgroundRepeat = 'no-repeat';
        });
    }

    if (brandName) {
      document
        .querySelectorAll('[data-website-brand-name]')
        .forEach(name => {
          name.textContent = brandName;
        });

      document.title = brandName;
    }

if (heroOverlayUrl) {
  const overlay = document.getElementById('websiteHeroOverlay');

  if (overlay) {
    const heroFastUrl = window.SiteFast?.imageUrl
      ? window.SiteFast.imageUrl(heroOverlayUrl, 1800)
      : heroOverlayUrl;
    const heroImage = new Image();
    heroImage.fetchPriority = 'high';
    heroImage.decoding = 'async';

    showHeroOverlayProgress(overlay, heroFastUrl);

    heroImage.onload = () => {
      overlay.style.backgroundImage =
        `linear-gradient(
          90deg,
          rgba(5,28,44,.96) 0%,
          rgba(5,28,44,.79) 40%,
          rgba(5,28,44,.1) 78%
        ),
        url("${heroFastUrl}")`;

      overlay.style.backgroundSize = 'cover';
      overlay.style.backgroundPosition = 'center';
      overlay.style.backgroundRepeat = 'no-repeat';

      overlay.classList.add('website-hero-ready');
      finishHeroOverlayProgress(overlay, heroFastUrl);
    };

    heroImage.onerror = () => {
      overlay.classList.add('website-hero-ready');
      finishHeroOverlayProgress(overlay, heroFastUrl);
    };

    heroImage.src = heroFastUrl;
  }
}

if (!heroOverlayUrl && window.LP360HeroProgress) {
  // ไม่มีรูปที่กำหนดก็ถือว่างานส่วนรูปจบแล้ว เพื่อไม่ให้ progress ค้าง
  window.LP360HeroProgress.imageReady('');
}

function renderMainNavMenus(data) {
  const districtBox = document.getElementById('districtMenuList');
  const libraryBox = document.getElementById('libraryMenuList');

  function setToggleTitle(box, title) {
    if (!box) return;
    const button = box.closest('.main-nav-dropdown')?.querySelector('.main-nav-dropdown-toggle');
    const label = String(title || '').trim();
    if (!button || !label) return;
    button.innerHTML = `${escapeHtml(label)} <span aria-hidden="true">▾</span>`;
  }

  setToggleTitle(districtBox, data.districtTitle || data.subdistrictTitle || 'สกร.ระดับตำบล');
  setToggleTitle(libraryBox, data.libraryTitle || 'ห้องสมุด');

  function normalize(items) {
    return (Array.isArray(items) ? items : [])
      .map(item => Array.isArray(item)
        ? { name: item[0], url: item[1] }
        : { name: item?.name || item?.title, url: item?.url || item?.href })
      .map(item => ({
        name: String(item.name || '').trim(),
        url: String(item.url || '').trim()
      }))
      .filter(item => item.name && /^https?:\/\//i.test(item.url));
  }

  function render(box, items) {
    if (!box) return;
    const rows = normalize(items);

    if (!rows.length) {
      box.innerHTML = '<span class="main-nav-dropdown-status">ยังไม่มีข้อมูล</span>';
      return;
    }

    box.innerHTML = rows.map(item =>
      `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" role="menuitem">${escapeHtml(item.name)}</a>`
    ).join('');
  }

  render(districtBox, data.districts || data.subdistricts || []);
  render(libraryBox, data.libraries || []);
}

function renderSettingMenus(items) {
  const grid = document.getElementById('settingMenuGrid');
  if (!grid) return;

  const rows = (Array.isArray(items) ? items : [])
    .map(item => Array.isArray(item)
      ? { title: item[0], subtitle: item[1], icon: item[2] }
      : {
          title: item?.title || item?.menuName || item?.name,
          subtitle: item?.subtitle || item?.description || item?.expandedName,
          icon: item?.icon || item?.iconUrl || item?.image
        })
    .map(item => ({
      title: String(item.title || '').trim(),
      subtitle: String(item.subtitle || '').trim(),
      icon: String(item.icon || '').trim()
    }))
    .filter(item => item.title || item.subtitle || item.icon)
    .filter(item => {
      const title = String(item.title || '').trim().toLowerCase();
      const isBestPractice = title.includes('best practice') || title.includes('แนวปฏิบัติที่เป็นเลิศ');
      const isTeam = title.includes('บุคลากร') || title.includes('ทีมของเรา') || title === 'team';
      return !(isBestPractice || isTeam);
    })
    ;

  if (!rows.length) {
    grid.innerHTML = '<div class="setting-menu-empty">ยังไม่มีข้อมูลเมนูใน setting!D2:F</div>';
    return;
  }

  grid.innerHTML = rows.map((item, index) => {
    const normalizedTitle = item.title.toLowerCase();
    const isMedia = normalizedTitle.includes('คลังสื่อการสอน') ||
      normalizedTitle.includes('สื่อการสอน') ||
      normalizedTitle.includes('teaching materials');
    const isReward = normalizedTitle.includes('รางวัล') ||
      normalizedTitle.includes('เกียรติบัตร') ||
      normalizedTitle.includes('awards and certificates');
    const isCourse = normalizedTitle.includes('คลังหลักสูตร') ||
      normalizedTitle.includes('คลังหลังสูตร') ||
      normalizedTitle.includes('our course') ||
      normalizedTitle === 'หลักสูตร';
    const isInnovation = normalizedTitle.includes('นวัตกรรม') ||
      normalizedTitle.includes('สื่อ/');
    const isReport = normalizedTitle.includes('รายงานผลการปฏิบัติการ') ||
      normalizedTitle.includes('ผลการปฏิบัติการ') ||
      normalizedTitle === 'report';
    const href = isReport
      ? 'report.html'
      : (isCourse
          ? 'course.html'
          : (isReward
              ? 'reward.html'
              : (isMedia
                  ? 'media.html'
                  : (isInnovation ? 'innovation.html' : ''))));
    const tag = href ? 'a' : 'div';
    const linkAttrs = href
      ? ` href="${href}" aria-label="เปิดหน้า ${escapeHtml(item.title)}"`
      : '';
    const icon = item.icon
      ? `<img src="${escapeHtml(item.icon)}" alt="" loading="lazy">`
      : '<i class="fa-solid fa-table-cells-large" aria-hidden="true"></i>';

    return `<${tag} class="setting-menu-item"${linkAttrs}>
      <span class="team-link-image">${icon}</span>
      <strong class="setting-menu-title">${escapeHtml(item.title || `เมนู ${index + 1}`)}</strong>
      <span class="setting-menu-subtitle">${escapeHtml(item.subtitle)}</span>
    </${tag}>`;
  }).join('');
}

    if (heroTitleLine1) {
      const line1 =
        document.getElementById('heroTitleLine1');

      if (line1) {
        line1.textContent = heroTitleLine1;
      }
    }

    if (heroTitleLine2) {
      const line2 =
        document.getElementById('heroTitleLine2');

      if (line2) {
        line2.textContent = heroTitleLine2;
      }
    }

  } catch (error) {
    console.error(
      'โหลด URL รูปภาพเว็บไซต์ไม่สำเร็จ:',
      error
    );
    // request รูปจบด้วย error ก็ถือว่างานส่วนรูปจบ เพื่อไม่ให้ Hero progress ค้าง
    window.LP360HeroProgress?.imageReady('');
  }
}


  const escapeHtml = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  let newsSlides = [];
  let newsIndex = 0;
  let newsTimer = null;
  let newsAutoEnabled = false;
  let newsAutoStoppedByUser = false;
  let newsPopupOpen = false;

  function stopNewsAutoSlide() {
    if (newsTimer) {
      clearInterval(newsTimer);
      newsTimer = null;
    }
  }

  function startNewsAutoSlide() {
    stopNewsAutoSlide();

    if (
      !newsAutoEnabled ||
      newsAutoStoppedByUser ||
      newsPopupOpen ||
      newsSlides.length <= 1
    ) {
      return;
    }

    newsTimer = setInterval(() => {
      newsIndex = (newsIndex + 1) % newsSlides.length;
      renderNews();
    }, 3000);
  }

  function stopNewsAutoByUser() {
    newsAutoStoppedByUser = true;
    stopNewsAutoSlide();
  }

  function normalizeNewsItem(item, index) {
    if (typeof item === 'string') {
      return {
        newsNo: index + 1,
        title: `ข่าวสาร ${index + 1}`,
        image: String(item).trim(),
        detail: '',
        detailUrl: '',
        date: ''
      };
    }

    const source = item && typeof item === 'object' ? item : {};

    return {
      newsNo: source.newsNo || source.no || source.id || index + 1,
      title: String(
        source.title || source.heading || source.mainTitle || `ข่าวสาร ${index + 1}`
      ).trim(),
      image: String(
        source.image || source.url || source.imageUrl || source.poster || ''
      ).trim(),
      detail: String(
        source.detail || source.description || source.summary || ''
      ).trim(),
      detailUrl: String(
        source.detailUrl || source.link || source.moreUrl || source.urlDetail || ''
      ).trim(),
      date: String(
        source.date || source.newsDate || source.publishedAt || ''
      ).trim()
    };
  }

  async function loadNews() {
    const slider = document.getElementById('newsSlider');
    const slidesBox = document.getElementById('newsSlides');
    if (!slider || !slidesBox) return;

    try {
      let result;

      if (window.SiteFast) {
        result = Object.assign({ success: true }, await window.SiteFast.homePart('news'));
      } else {
        const response = await fetch(NEWS_API_URL, { cache: 'default' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        result = await response.json();
      }
      if (result.success === false) {
        throw new Error(result.message || 'โหลดข่าวสารไม่สำเร็จ');
      }

      const raw = result.slides || result.data?.slides || result.data || [];

      newsSlides = (Array.isArray(raw) ? raw : [])
        .map(normalizeNewsItem)
        .filter(item => item.image);

      const mode = String(
        result.mode || result.data?.mode || ''
      ).toLowerCase();

      if (!newsSlides.length) {
        slider.classList.add('is-empty');
        return;
      }

      slider.classList.remove('is-empty');
      slider.classList.toggle(
        'single-slide',
        mode !== 'block' || newsSlides.length <= 1
      );

      newsIndex = 0;
      newsAutoEnabled = mode === 'block' && newsSlides.length > 1;
      newsAutoStoppedByUser = false;
      newsPopupOpen = false;

      renderNews();
      startNewsAutoSlide();

    } catch (error) {
      slidesBox.innerHTML =
        `<div class="news-loading">โหลดข่าวสารไม่สำเร็จ: ${escapeHtml(error.message)}</div>`;
    }
  }

  function renderNews() {
    const slidesBox = document.getElementById('newsSlides');
    const dots = document.getElementById('newsDots');
    if (!slidesBox || !dots || !newsSlides.length) return;

    slidesBox.innerHTML = newsSlides.map((item, index) => `
      <div
        class="news-slide ${index === newsIndex ? 'active' : ''}"
        data-news-slide="${index}"
        role="button"
        tabindex="${index === newsIndex ? '0' : '-1'}"
        aria-label="เปิดรายละเอียด ${escapeHtml(item.title)}">
        <img
          src="${escapeHtml(item.image)}"
          alt="${escapeHtml(item.title)}"
          loading="lazy">
      </div>`).join('');

    slidesBox.querySelectorAll('[data-news-slide]').forEach(slide => {
      const openCurrentNews = () => {
        const index = Number(slide.dataset.newsSlide);
        if (!Number.isInteger(index) || !newsSlides[index]) return;
        openNewsPopup(newsSlides[index]);
      };

      slide.addEventListener('click', openCurrentNews);
      slide.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openCurrentNews();
        }
      });
    });

    dots.innerHTML = newsSlides.map((_, index) => `
      <button
        class="news-dot ${index === newsIndex ? 'active' : ''}"
        type="button"
        data-news-dot="${index}"
        aria-label="ข่าวลำดับที่ ${index + 1}">
      </button>`).join('');

    dots.querySelectorAll('[data-news-dot]').forEach(btn => {
      btn.addEventListener('click', () => {
        stopNewsAutoByUser();
        newsIndex = Number(btn.dataset.newsDot);
        renderNews();
      });
    });
  }

async function openNewsPopup(item) {
  if (!item) return;

  newsPopupOpen = true;
  stopNewsAutoSlide();

  const hasDetailUrl = Boolean(
    String(item.detailUrl || '').trim()
  );

  const safeTitle = escapeHtml(
    item.title || 'ข่าวสาร'
  );

  const safeImage = escapeHtml(
    item.image || ''
  );

  const safeDetail = escapeHtml(
    item.detail || 'ไม่มีรายละเอียดเพิ่มเติม'
  ).replace(/\n/g, '<br>');

  const safeDate = escapeHtml(
    item.date || ''
  );

  const popupHtml = `
    <div class="news-popup-content">

      ${safeDate ? `
        <div class="news-popup-date">
          <i class="fa fa-calendar" aria-hidden="true"></i>
          ${safeDate}
        </div>
      ` : ''}

      ${safeImage ? `
        <img
          class="news-popup-image"
          src="${safeImage}"
          alt="${safeTitle}">
      ` : ''}

      <div class="news-popup-detail">
        ${safeDetail}
      </div>

    </div>
  `;

  try {
    const result = await Swal.fire({
      title: safeTitle,
      html: popupHtml,

      showCloseButton: true,
      showCancelButton: false,

      showConfirmButton: hasDetailUrl,
      confirmButtonText: 'รายละเอียด',

      allowOutsideClick: true,
      allowEscapeKey: true,

      width: 760,

      customClass: {
        popup: 'news-popup-box',
        title: 'news-popup-title',
        closeButton: 'news-close-btn',
        confirmButton: 'news-detail-btn'
      },

      buttonsStyling: false
    });

    if (result.isConfirmed && hasDetailUrl) {
      window.open(
        item.detailUrl,
        '_blank',
        'noopener,noreferrer'
      );
    }

  } catch (error) {
    console.error('เปิด Popup ข่าวไม่สำเร็จ:', error);

  } finally {
    newsPopupOpen = false;

    /*
     * เมื่อปิด Popup ให้ Slider กลับมาทำงาน
     * เฉพาะกรณีที่ผู้ใช้ไม่ได้กด Prev, Next หรือ Dot
     */
    startNewsAutoSlide();
  }
}
  function bindNewsControls() {
    const slider = document.getElementById('newsSlider');
    const prev = document.getElementById('newsPrev');
    const next = document.getElementById('newsNext');

    slider?.addEventListener('mouseenter', () => {
      stopNewsAutoSlide();
    });

    slider?.addEventListener('mouseleave', () => {
      startNewsAutoSlide();
    });

    prev?.addEventListener('click', () => {
      if (!newsSlides.length) return;
      stopNewsAutoByUser();
      newsIndex = (newsIndex - 1 + newsSlides.length) % newsSlides.length;
      renderNews();
    });

    next?.addEventListener('click', () => {
      if (!newsSlides.length) return;
      stopNewsAutoByUser();
      newsIndex = (newsIndex + 1) % newsSlides.length;
      renderNews();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindNewsControls();

    loadWebsiteImages();
    loadNews();

  });
  document.addEventListener('news-admin-updated', () => {
    window.SiteFast?.clear('homefast');
    loadNews();
  });
})();

;

/* ===== announcement.js ===== */
(() => {
  'use strict';

  const API_URL =
    window.APP_CONFIG.API_URL;

  function safeUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      return /^https?:$/i.test(url.protocol) ? url.toString() : '';
    } catch (_) {
      return '';
    }
  }

  function setSocial(id, value) {
    const element = document.getElementById(id);
    if (!element) return false;

    const url = safeUrl(value);
    element.hidden = !url;

    if (url) element.href = url;
    else element.removeAttribute('href');

    return Boolean(url);
  }

  function enableAnnouncementLink(element, value) {
    if (!element) return;

    const url = safeUrl(value);
    if (!url) {
      delete element.dataset.announcementUrl;
      element.removeAttribute('role');
      element.removeAttribute('tabindex');
      element.removeAttribute('aria-label');
      element.style.cursor = '';
      return;
    }

    element.dataset.announcementUrl = url;
    element.setAttribute('role', 'link');
    element.setAttribute('tabindex', '0');
    element.setAttribute('aria-label', 'เปิดเว็บไซต์ที่กำหนด');
    element.style.cursor = 'pointer';

    if (element.dataset.announcementLinkReady === '1') return;
    element.dataset.announcementLinkReady = '1';

    const openInSameTab = function () {
      const target = safeUrl(element.dataset.announcementUrl);
      if (target) window.location.assign(target);
    };

    element.addEventListener('click', openInSameTab);
    element.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openInSameTab();
      }
    });
  }



  async function fetchCentralAnnouncement() {
    const url = new URL(API_URL);
    url.searchParams.set('mode', 'announcement');
    url.searchParams.set('_ts', String(Date.now()));
    const response = await fetch(url.toString(), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (!result || result.success === false) {
      throw new Error(result?.message || 'โหลด announcement กลางไม่สำเร็จ');
    }
    const data = result.data || result;
    return {
      text: String(data.text || data.announcementText || '').trim(),
      url: String(data.url || data.announcementUrl || '').trim()
    };
  }

  async function loadAnnouncement() {
    const announcement = document.getElementById('announcementText');
    const socials = document.getElementById('announcementSocials');

    try {
      let result;

      if (window.SiteFast) {
        result = Object.assign({ success: true }, await window.SiteFast.homePart('about'));
      } else {
        const url = new URL(API_URL);
        url.searchParams.set('mode', 'aboutPages');
        const response = await fetch(url.toString(), { cache: 'default' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        result = await response.json();
      }
      if (result.success === false) {
        throw new Error(result.message || 'โหลดข้อมูล announcement ไม่สำเร็จ');
      }

      const contact = result.contact || {};
      let announcementMessage = String(contact.announcementText || '').trim();
      let announcementUrl = String(contact.announcementUrl || '').trim();

      // ถ้า homefast/about cache เป็นข้อมูลรุ่นเก่า ให้ fallback ไปอ่าน B24/D24 สดจากฐานกลาง
      if (!announcementMessage || !announcementUrl) {
        try {
          const central = await fetchCentralAnnouncement();
          if (!announcementMessage) announcementMessage = central.text;
          if (!announcementUrl) announcementUrl = central.url;
        } catch (fallbackError) {
          console.warn('announcement central fallback:', fallbackError);
        }
      }

      if (announcement) {
        announcement.textContent = announcementMessage;
        announcement.hidden = !announcementMessage;
      }

      enableAnnouncementLink(announcement, announcementUrl);

      const hasLine = setSocial('announcementLine', contact.line);
      const hasFacebook = setSocial('announcementFacebook', contact.facebook);
      const hasYoutube = setSocial('announcementYoutube', contact.youtube);
      if (socials) socials.hidden = !(hasLine || hasFacebook || hasYoutube);
    } catch (error) {
      console.error('loadAnnouncement error:', error);
      if (announcement) {
        announcement.hidden = true;
        enableAnnouncementLink(announcement, '');
      }
      if (socials) socials.hidden = true;
    }
  }

  document.addEventListener('DOMContentLoaded', loadAnnouncement);
})();

;

/* ===== site-content.js ===== */
(() => {
  'use strict';

  const API_URL =
    window.APP_CONFIG.API_URL;
  const SEARCH_PAGES = [
    'activity.html', 'best_practice.html', 'classroom.html', 'cliproom.html',
    'contact.html', 'course.html', 'ex.html', 'innovation.html', 'learning.html',
    'media.html', 'profile.html', 'quiz.html', 'reward.html', 'shopactivity.html',
    'vision.html'
  ];

  function formatSlash(value) {
    return String(value || '')
      .trim()
      .replace(/\s*\/\s*/g, '\n');
  }

  function setOptionalText(id, value, prefix) {
    const element = document.getElementById(id);
    const content = formatSlash(value);
    if (!element) return;

    element.textContent = content ? String(prefix || '') + content : '';
    element.hidden = !content;
  }

  async function loadSiteContent() {
    try {
      let result;

      if (window.SiteFast) {
        result = Object.assign({ success: true }, await window.SiteFast.homePart('about'));
      } else {
        const url = new URL(API_URL);
        url.searchParams.set('mode', 'aboutPages');
        const response = await fetch(url.toString(), { cache: 'default' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        result = await response.json();
      }
      if (result.success === false) {
        throw new Error(result.message || 'โหลดข้อความเว็บไซต์ไม่สำเร็จ');
      }

      const hero = result.hero || {};
      const footer = result.footer || {};
      const vision = result.vision || {};

      // เมนูหน้าแรกใช้หัวข้อใหญ่เดียวกับ vision.html (setting!Q3)
      const visionMenu = document.querySelector('a[href="vision.html"][role="menuitem"]');
      if (visionMenu && String(vision.title || '').trim()) {
        visionMenu.textContent = String(vision.title).trim();
      }

      setOptionalText('heroKickerText', hero.kicker);
      setOptionalText('heroTitleText', hero.title);
      window.LP360HeroProgress?.titleReady();
      setOptionalText('heroDescriptionText', hero.description);
      setOptionalText('footerDescription', footer.description);
      setOptionalText('footerOrganization', footer.organization);
      setOptionalText('footerAddress', footer.address);
      setOptionalText('footerPhone', footer.phone, 'โทร. ');
    } catch (error) {
      console.error('loadSiteContent error:', error);
      window.LP360HeroProgress?.titleReady();
    }
  }

  function clearSearchHit() {
    document.querySelectorAll('.site-search-hit').forEach(element => {
      element.classList.remove('site-search-hit');
    });
  }

  function searchableElements() {
    const selector = [
      'main h1', 'main h2', 'main h3', 'main h4', 'main p',
      'main a', 'main button', 'main [aria-label]',
      '.announcement p', '.main-nav a', '.footer p', '.footer h4', '.footer a'
    ].join(',');

    return Array.from(document.querySelectorAll(selector)).filter(element => {
      if (element.closest('#siteSearchForm')) return false;
      if (element.hidden) return false;
      return element.offsetParent !== null && element.textContent.trim();
    });
  }

  async function notifySearch(title, text, icon) {
    if (window.Swal) {
      return Swal.fire({ icon, title, text, confirmButtonText: 'ตกลง' });
    }
    window.alert(`${title}\n${text}`);
  }

  async function searchWebsite(event) {
    event.preventDefault();
    clearSearchHit();

    const input = document.getElementById('siteSearchInput');
    const query = String(input?.value || '').trim().toLocaleLowerCase('th-TH');
    if (!query) return;

    const matches = searchableElements().filter(element =>
      element.textContent.toLocaleLowerCase('th-TH').includes(query)
    );

    if (matches.length) {
      const firstMatch = matches[0];
      firstMatch.classList.add('site-search-hit');
      firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });

      if (matches.length > 1) {
        await notifySearch('พบข้อมูล', `พบในหน้านี้ ${matches.length} ตำแหน่ง และแสดงตำแหน่งแรก`, 'success');
      }
      return;
    }

    const pageMatches = await findMatchingPages(query);
    if (!pageMatches.length) {
      await notifySearch('ไม่พบข้อมูล', `ไม่พบข้อความ “${input.value.trim()}” ในเว็บไซต์`, 'info');
      input?.focus();
      return;
    }

    await notifySearch('พบข้อมูล', `พบใน ${pageMatches[0]} กำลังเปิดหน้าที่พบ`, 'success');
    window.location.href = pageMatches[0];
  }

  async function findMatchingPages(query) {
    const results = await Promise.all(SEARCH_PAGES.map(async page => {
      try {
        const response = await fetch(page, { cache: 'no-store' });
        if (!response.ok) return '';

        const html = await response.text();
        const documentCopy = new DOMParser().parseFromString(html, 'text/html');
        documentCopy.querySelectorAll('script, style, noscript').forEach(node => node.remove());
        const text = documentCopy.body?.textContent || '';
        return text.toLocaleLowerCase('th-TH').includes(query) ? page : '';
      } catch (error) {
        console.warn(`search page ${page} error:`, error);
        return '';
      }
    }));

    return results.filter(Boolean);
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadSiteContent();
    document.getElementById('siteSearchForm')?.addEventListener('submit', searchWebsite);
  });
})();

;

/* ===== admin-mode.js ===== */
(() => {
  'use strict';
  const API_URL=window.APP_CONFIG.API_URL;
  const CSS_FILES=['edit-website.css?v=20260827-2','news-manager.css?v=20260902-newsurl-optional-2','newsletter-manager.css?v=20260826-1','newsletter-overlay.css?v=20260826-3','facebook-manager.css?v=20260826-1','admin-subpage.css?v=20260901-index-team-1','team-manager.css?v=20260901-index-team-1'];
  const JS_FILES=['edit-website.js?v=20260827-2','news-manager.js?v=20260902-newsurl-optional-2','newsletter-manager.js?v=20260826-4','facebook-manager.js?v=20260826-2','team-manager.js?v=20260901-index-team-1'];
  let toolsPromise=null;
  let storagePromise=null;
  const STORAGE_CACHE_KEY='LP360:TAMBOL:mysiteAdminStorageV2D15';
  const STORAGE_CACHE_MS=5*60*1000;
  const $=id=>document.getElementById(id);
  async function api(payload){const response=await fetch(API_URL,{method:'POST',cache:'no-store',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});if(!response.ok)throw new Error(`HTTP ${response.status}`);const result=await response.json();if(!result.success)throw new Error(result.message||'ดำเนินการไม่สำเร็จ');return result}
  function formatStorageGb(bytes){
    const gb=Math.max(0,Number(bytes)||0)/(1024*1024*1024);
    if(gb===0)return '0 GB';
    if(gb<0.01)return '<0.01 GB';
    if(gb<10)return gb.toFixed(2).replace(/\.00$/,'').replace(/(\.\d)0$/,'$1')+' GB';
    return gb.toFixed(1).replace(/\.0$/,'')+' GB';
  }
  function renderAdminStorage(data,state){
    const meter=$('adminStorageMeter'),used=$('adminStorageUsed'),limit=$('adminStorageLimit'),fill=$('adminStorageFill'),track=$('adminStorageTrack');
    if(!meter||!used||!limit||!fill||!track)return;
    meter.classList.toggle('is-loading',state==='loading');
    meter.classList.toggle('is-error',state==='error');
    if(state==='loading'){used.textContent='กำลังตรวจสอบพื้นที่...';return}
    if(state==='error'){used.textContent='ตรวจสอบพื้นที่ไม่สำเร็จ';fill.style.width='0%';track.setAttribute('aria-valuenow','0');return}
    const bytes=Math.max(0,Number(data&&data.usedBytes)||0);
    const maxBytes=Math.max(1,Number(data&&data.limitBytes)||100*1024*1024*1024);
    const percent=Math.min(100,Math.max(0,(bytes/maxBytes)*100));
    used.textContent='ใช้พื้นที่แล้ว '+formatStorageGb(bytes);
    limit.textContent=(data&&data.limitLabel)||'—';
    fill.style.width=percent.toFixed(2)+'%';
    track.setAttribute('aria-valuenow',String(Math.round(percent)));
    track.setAttribute('aria-valuetext',used.textContent+' จาก '+limit.textContent);
    meter.title='ไฟล์ '+Number(data&&data.fileCount||0).toLocaleString('th-TH')+' ไฟล์ • '+Number(data&&data.folderCount||0).toLocaleString('th-TH')+' โฟลเดอร์';
  }
  function readStorageCache(){
    try{const cached=JSON.parse(sessionStorage.getItem(STORAGE_CACHE_KEY)||'null');return cached&&cached.savedAt&&Date.now()-cached.savedAt<STORAGE_CACHE_MS?cached.data:null}catch(_){return null}
  }
  function writeStorageCache(data){try{sessionStorage.setItem(STORAGE_CACHE_KEY,JSON.stringify({savedAt:Date.now(),data}))}catch(_){}}
  function loadAdminStorage(force=false){
    const token=sessionStorage.getItem('LP360:TAMBOL:mysiteAdminToken');
    if(!token)return Promise.resolve();
    const cached=!force&&readStorageCache();
    if(cached)renderAdminStorage(cached,'ready');else renderAdminStorage(null,'loading');
    if(storagePromise)return storagePromise;
    storagePromise=api({mode:'adminstorage',token,fresh:force?'1':'0'})
      .then(result=>{const data=result.data||{};writeStorageCache(data);renderAdminStorage(data,'ready');return data})
      .catch(error=>{if(!cached)renderAdminStorage(null,'error');console.warn('admin storage:',error);return null})
      .finally(()=>{storagePromise=null});
    return storagePromise;
  }
  function loadStyle(href){return new Promise((resolve,reject)=>{if(document.querySelector(`link[data-admin-tool="${href}"]`))return resolve();const link=document.createElement('link');link.rel='stylesheet';link.href=href;link.dataset.adminTool=href;link.onload=resolve;link.onerror=()=>reject(new Error('โหลด '+href+' ไม่สำเร็จ'));document.head.appendChild(link)})}
  function loadScript(src){return new Promise((resolve,reject)=>{if(document.querySelector(`script[data-admin-tool="${src}"]`))return resolve();const script=document.createElement('script');script.src=src;script.dataset.adminTool=src;script.onload=resolve;script.onerror=()=>reject(new Error('โหลด '+src+' ไม่สำเร็จ'));document.body.appendChild(script)})}
  function loadAdminTools(){if(toolsPromise)return toolsPromise;toolsPromise=(async()=>{await Promise.all(CSS_FILES.map(loadStyle));for(const src of JS_FILES)await loadScript(src)})();return toolsPromise}
  function setAdminUi(enabled){document.body.classList.toggle('admin-edit-mode',enabled);$('adminLoginButton').hidden=enabled;$('adminLogoutButton').hidden=!enabled}
  async function activateAdmin(){await loadAdminTools();setAdminUi(true);$('adminLoginModal').hidden=true;loadAdminStorage(false)}
  function openLogin(){ $('adminLoginStatus').textContent='';$('adminLoginModal').hidden=false;setTimeout(()=>$('adminUsername').focus(),30) }
  function closeLogin(){ $('adminLoginModal').hidden=true }
  $('adminLoginButton').addEventListener('click',openLogin);$('adminLoginClose').addEventListener('click',closeLogin);$('adminLoginModal').addEventListener('click',e=>{if(e.target===$('adminLoginModal'))closeLogin()});
  $('adminLoginForm').addEventListener('submit',async event=>{event.preventDefault();const status=$('adminLoginStatus'),submit=$('adminLoginSubmit');status.textContent='';submit.disabled=true;submit.textContent='กำลังตรวจสอบ...';try{const result=await api({mode:'adminlogin',username:$('adminUsername').value.trim(),password:$('adminPassword').value});sessionStorage.setItem('LP360:TAMBOL:mysiteAdminToken',result.token);sessionStorage.setItem('LP360:TAMBOL:mysiteAdminName',result.username||'Admin');submit.textContent='กำลังโหลดเครื่องมือ...';await activateAdmin()}catch(error){sessionStorage.removeItem('LP360:TAMBOL:mysiteAdminToken');status.textContent=error.message}finally{submit.disabled=false;submit.textContent='เข้าสู่ระบบ'}});
  $('adminForgotButton').addEventListener('click',async()=>{const modal=await Swal.fire({title:'ลืมรหัสผ่าน',input:'email',inputLabel:'กรอก Email ที่ลงทะเบียนไว้',showCancelButton:true,confirmButtonText:'ส่งข้อมูลเข้าสู่ Email',cancelButtonText:'ยกเลิก',confirmButtonColor:'#dc2626',inputValidator:value=>!value?'กรุณากรอก Email':undefined});if(!modal.isConfirmed)return;Swal.fire({title:'กำลังส่ง Email...',allowOutsideClick:false,didOpen:()=>Swal.showLoading()});try{await api({mode:'adminforgot',email:modal.value.trim()});Swal.fire({icon:'success',title:'ส่ง Email แล้ว',text:'กรุณาตรวจสอบกล่องจดหมายและจดหมายขยะ'})}catch(error){Swal.fire({icon:'error',title:'ส่งไม่สำเร็จ',text:error.message})}});
  $('adminTogglePassword').addEventListener('click',event=>{const input=$('adminPassword');input.type=input.type==='password'?'text':'password';event.currentTarget.querySelector('i').className=input.type==='password'?'fa-solid fa-eye':'fa-solid fa-eye-slash'});
  $('adminLogoutButton').addEventListener('click',()=>{sessionStorage.removeItem('LP360:TAMBOL:mysiteAdminToken');sessionStorage.removeItem('LP360:TAMBOL:mysiteAdminName');setAdminUi(false);if(window.Swal)Swal.close()});
  const existingToken=sessionStorage.getItem('LP360:TAMBOL:mysiteAdminToken');
  if(existingToken){
    api({mode:'editwebsite',editor:'text',token:existingToken})
      .then(()=>loadAdminTools())
      .then(()=>{setAdminUi(true);loadAdminStorage(false)})
      .catch(()=>{sessionStorage.removeItem('LP360:TAMBOL:mysiteAdminToken');sessionStorage.removeItem('LP360:TAMBOL:mysiteAdminName');setAdminUi(false)});
  }else setAdminUi(false);
})();

;

/* ===== admin-section-guide.js ===== */
(()=>{'use strict';
const API=window.APP_CONFIG.API_URL;
const builtins=[
  {id:'studentServicesBox',kind:'builtin',title:'บริการนักศึกษา',visible:true},
  {id:'learningSourceBox',kind:'builtin',title:'แหล่งเรียนรู้',visible:true},
  {id:'bestPracticeBox',kind:'builtin',title:'Best Practice',visible:true},
  {id:'FBpostBox',kind:'builtin',title:'Facebook',visible:true},
  {id:'cliproomBox',kind:'builtin',title:'หลักสูตรออนไลน์',visible:true},
  {id:'learningBaseModule',kind:'builtin',title:'ช้อปกิจกรรม',visible:true}
];
const builtinIds=new Set(builtins.map(x=>x.id));
let layout=builtins.map(x=>({...x})),saving=false,pendingSave=false;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const clamp=(n,min,max)=>Math.min(max,Math.max(min,Number(n)||min));
function customId(){return 'custom-section-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8)}
function normalizeItem(raw){
  const id=String(raw?.id||'').trim();
  const builtin=builtinIds.has(id);
  if(!id||(!builtin&&!/^custom-section-[a-z0-9-]+$/i.test(id)))return null;
  const base=builtin?builtins.find(x=>x.id===id):null;
  const rawType=String(raw?.sourceType||'url').toLowerCase();
  return {
    id,
    kind:builtin?'builtin':'custom',
    title:String(raw?.title||base?.title||'SECTION ใหม่').trim().slice(0,120)||'SECTION ใหม่',
    visible:raw?.visible!==false,
    sourceType:builtin?'':(rawType==='embed'?'embed':(rawType==='image'?'image':'url')),
    source:builtin?'':String(raw?.source||''),
    height:builtin?0:clamp(raw?.height||620,260,1600),
    detailUrl:builtin?'':String(raw?.detailUrl||'').trim(),
    buttonLabel:builtin?'':String(raw?.buttonLabel||'').trim().slice(0,60)
  };
}
function normalize(items){
  const incoming=Array.isArray(items)?items:[];
  const out=[],seen=new Set();
  incoming.forEach(raw=>{const item=normalizeItem(raw);if(item&&!seen.has(item.id)){seen.add(item.id);out.push(item)}});
  builtins.forEach(base=>{if(!seen.has(base.id))out.push({...base})});
  return out;
}
async function getLayout(){
  if(window.SiteFast?.getHomeFast){
    try{
      const home=await window.SiteFast.getHomeFast();
      const homeData=home?.data||home||{};
      if(Array.isArray(homeData.sectionLayout))return normalize(homeData.sectionLayout);
    }catch(e){console.warn('sectionLayout homefast fallback:',e)}
  }
  if(window.SiteFast?.fetchMode){
    const j=await window.SiteFast.fetchMode('sectionlayout',{}, {key:'section-layout-v3',ttl:5*60*1000,staleTtl:24*60*60*1000});
    if(j?.success===false)throw new Error(j.message||'โหลดการจัดเรียง Section ไม่สำเร็จ');
    return normalize(j?.items||[]);
  }
  const r=await fetch(API+'?mode=sectionlayout&_t='+Date.now(),{cache:'no-store'}),j=await r.json();
  if(!r.ok||j.success===false)throw new Error(j.message||'โหลดการจัดเรียง Section ไม่สำเร็จ');
  return normalize(j.items);
}
async function apiAdmin(action,data){
  const token=sessionStorage.getItem('LP360:TAMBOL:mysiteAdminToken')||'';
  const r=await fetch(API,{method:'POST',cache:'no-store',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({mode:'sectionlayoutadmin',action,token,data:data||{}})}),j=await r.json();
  if(!r.ok||!j.success)throw new Error(j.message||'ดำเนินการไม่สำเร็จ');
  return j.data||{};
}
async function saveLayout(){
  if(saving){pendingSave=true;return}
  saving=true;
  const snapshot=layout.map(x=>({...x}));
  status('กำลังบันทึก...');
  try{
    const data=await apiAdmin('save',{items:snapshot});
    if(!pendingSave){layout=normalize(data?.items);renderCustomSections();apply();status('บันทึกแล้ว',900)}
  }catch(e){status('บันทึกไม่สำเร็จ: '+e.message,3200)}
  finally{saving=false;if(pendingSave){pendingSave=false;saveLayout()}}
}
function status(text,delay=0){
  let el=document.querySelector('.admin-section-save-status');
  if(!el){el=document.createElement('div');el.className='admin-section-save-status';document.body.appendChild(el)}
  el.textContent=text;el.hidden=false;clearTimeout(el._timer);if(delay)el._timer=setTimeout(()=>el.hidden=true,delay);
}
function looksLikeImageUrl(value){
  const v=String(value||'').trim();
  return /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i.test(v)||/^https:\/\/(?:lh\d+\.)?googleusercontent\.com\//i.test(v)||/^https:\/\/drive\.google\.com\/uc\?/i.test(v);
}
function renderCustomContent(section,item){
  section.innerHTML='';
  section.className='dynamic-section';
  section.dataset.dynamicSection='true';
  const wrap=document.createElement('div');wrap.className='dynamic-section-wrap';
  const heading=document.createElement('div');heading.className='dynamic-section-heading';
  const title=document.createElement('h2');title.textContent=item.title;heading.appendChild(title);
  if(item.detailUrl){
    const detail=document.createElement('a');
    detail.className='dynamic-section-detail-button shopactivity-open-all';
    detail.href=item.detailUrl;detail.target='_blank';detail.rel='noopener noreferrer';
    detail.textContent=item.buttonLabel||'ดูรายละเอียด';
    heading.appendChild(detail);
  }
  wrap.appendChild(heading);
  const frameWrap=document.createElement('div');frameWrap.className='dynamic-section-frame-wrap';
  const isImage=item.sourceType==='image'||(item.sourceType!=='embed'&&looksLikeImageUrl(item.source));
  if(isImage){
    const image=document.createElement('img');
    image.className='dynamic-section-image';image.loading='lazy';image.decoding='async';image.src=item.source||'';image.alt=item.title;
    image.style.maxHeight=item.height+'px';
    frameWrap.appendChild(image);
  }else{
    const frame=document.createElement('iframe');
    frame.className='dynamic-section-frame';frame.loading='lazy';frame.referrerPolicy='strict-origin-when-cross-origin';
    frame.style.height=item.height+'px';frame.title=item.title;
    frame.setAttribute('allow','accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; geolocation; gyroscope; picture-in-picture; web-share');
    if(item.sourceType==='embed'){
      frame.setAttribute('sandbox','allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads');
      frame.srcdoc=item.source||'<p style="font-family:sans-serif;padding:24px">ยังไม่มีโค้ดฝัง</p>';
    }else{
      frame.src=item.source||'about:blank';
    }
    frameWrap.appendChild(frame);
    if(item.sourceType==='url'&&item.source){
      const fallback=document.createElement('a');fallback.className='dynamic-section-open-page';fallback.href=item.source;fallback.target='_blank';fallback.rel='noopener noreferrer';fallback.textContent='เปิดหน้าเพจในแท็บใหม่';frameWrap.appendChild(fallback);
    }
  }
  wrap.appendChild(frameWrap);section.appendChild(wrap);
}
function renderCustomSections(){
  const main=document.querySelector('main');if(!main)return;
  const wanted=new Set(layout.filter(x=>x.kind==='custom').map(x=>x.id));
  main.querySelectorAll('section[data-dynamic-section="true"]').forEach(el=>{if(!wanted.has(el.id))el.remove()});
  layout.filter(x=>x.kind==='custom').forEach(item=>{
    let section=document.getElementById(item.id);
    if(!section){section=document.createElement('section');section.id=item.id;main.appendChild(section)}
    renderCustomContent(section,item);
  });
}
function syncLinkedMenus(){
  layout.forEach(item=>{
    document.querySelectorAll(`a[href="#${CSS.escape(item.id)}"]`).forEach(link=>{link.hidden=item.visible===false;link.dataset.sectionVisibilityLinked='1'});
  });
  // learningBaseModule controls nav-profile-actions: ปิด SECTION แล้วซ่อนชุดข้อมูลสมาชิกด้วย
  const learningBaseItem = layout.find(item => item.id === 'learningBaseModule');
  const profileVisible = !learningBaseItem || learningBaseItem.visible !== false;
  document.querySelectorAll('.nav-profile-actions').forEach(actions => {
    actions.hidden = !profileVisible;
    actions.setAttribute('aria-hidden', profileVisible ? 'false' : 'true');
    if (profileVisible) actions.style.removeProperty('display');
    else actions.style.setProperty('display', 'none', 'important');
  });
  try{window.MobileBottomNav?.syncVisibility?.()}catch(_){ }
}
function marker(item,index){
  const section=document.getElementById(item.id);if(!section)return;
  let box=section.querySelector(':scope > .admin-section-marker');
  if(!box){box=document.createElement('div');box.className='admin-section-marker';section.prepend(box)}
  const custom=item.kind==='custom';
  box.innerHTML=`<button class="admin-section-control admin-section-eye" type="button" title="${item.visible?'ปิดการมองเห็น':'เปิดการมองเห็น'}" aria-label="${item.visible?'ปิด':'เปิด'}การมองเห็น SECTION ${index+1}"><i class="fa-solid ${item.visible?'fa-eye':'fa-eye-slash'}"></i></button><span class="admin-section-marker-title">SECTION</span><strong class="admin-section-marker-number">${index+1}</strong><button class="admin-section-control admin-section-up" type="button" aria-label="เลื่อน SECTION ${index+1} ขึ้น" ${index===0?'disabled':''}><i class="fa-solid fa-arrow-up"></i></button><button class="admin-section-control admin-section-down" type="button" aria-label="เลื่อน SECTION ${index+1} ลง" ${index===layout.length-1?'disabled':''}><i class="fa-solid fa-arrow-down"></i></button>${custom?'<button class="admin-section-extra admin-section-edit" type="button"><i class="fa-solid fa-pen"></i> แก้ไข</button><button class="admin-section-extra admin-section-delete" type="button"><i class="fa-solid fa-trash"></i> ลบ</button>':''}`;
  box.querySelector('.admin-section-eye').onclick=e=>{e.stopPropagation();layout[index].visible=!layout[index].visible;apply();saveLayout()};
  box.querySelector('.admin-section-up').onclick=e=>{e.stopPropagation();if(index<1)return;[layout[index-1],layout[index]]=[layout[index],layout[index-1]];apply();saveLayout()};
  box.querySelector('.admin-section-down').onclick=e=>{e.stopPropagation();if(index>=layout.length-1)return;[layout[index],layout[index+1]]=[layout[index+1],layout[index]];apply();saveLayout()};
  box.querySelector('.admin-section-edit')?.addEventListener('click',e=>{e.stopPropagation();openSectionEditor(item,index)});
  box.querySelector('.admin-section-delete')?.addEventListener('click',e=>{e.stopPropagation();deleteCustomSection(item,index)});
  let msg=section.querySelector(':scope > .admin-section-hidden-message');
  if(!msg){msg=document.createElement('div');msg.className='admin-section-hidden-message';msg.textContent='section นี้ถูกปิดการมองเห็น';section.appendChild(msg)}
}
function apply(){
  const main=document.querySelector('main');if(!main)return;
  renderCustomSections();
  layout.forEach((item,index)=>{
    const section=document.getElementById(item.id);if(!section)return;
    main.appendChild(section);section.dataset.adminSection=String(index+1);section.dataset.sectionVisible=String(item.visible);marker(item,index);
  });
  syncLinkedMenus();
  document.dispatchEvent(new CustomEvent('site:section-layout-changed',{detail:{items:layout.map(x=>({...x}))}}));
}
function validPageUrl(value){
  const v=String(value||'').trim();
  if(!v||/^(?:javascript|data|vbscript):/i.test(v))return false;
  return /^(?:https?:\/\/|\/|\.\/|\.\.\/|[\w.-]+\.html(?:[?#].*)?$)/i.test(v);
}
function fileToDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(new Error('อ่านไฟล์รูปภาพไม่สำเร็จ'));reader.readAsDataURL(file)})}
async function uploadSectionImage(file){
  if(!file)return '';
  if(!/^image\//i.test(file.type||''))throw new Error('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
  if(file.size>15*1024*1024)throw new Error('รูปภาพมีขนาดใหญ่เกิน 15 MB');
  const imageData=await fileToDataUrl(file);
  const result=await apiAdmin('uploadimage',{imageData,imageName:file.name||'section-image'});
  if(!result.url)throw new Error('อัปโหลดรูปภาพไม่สำเร็จ');
  return result.url;
}
function editorHtml(item){
  const type=item?.sourceType==='embed'?'embed':'url';
  return `<div class="dynamic-section-editor"><label>ชื่อ SECTION</label><input id="dynamicSectionTitle" class="swal2-input" value="${esc(item?.title||'')}" maxlength="120" placeholder="เช่น ห้องเรียนออนไลน์"><label>รูปแบบเนื้อหา</label><select id="dynamicSectionType" class="swal2-select"><option value="url" ${type==='url'?'selected':''}>URL หน้าเพจ/รูปภาพ</option><option value="embed" ${type==='embed'?'selected':''}>ฝังโค้ด HTML / iframe / embed</option></select><div id="dynamicSectionUrlWrap"><label>URL หน้าเพจ/รูปภาพ</label><input id="dynamicSectionUrl" class="swal2-input" value="${esc(type==='url'?(item?.source||''):'')}" placeholder="https://... / page.html / URL รูปภาพ"><label>หรืออัปโหลดรูปภาพ</label><input id="dynamicSectionImageFile" class="dynamic-section-file-input" type="file" accept="image/*"><small>หากเลือกรูปภาพ ระบบจะอัปโหลดเข้า Google Drive และใช้รูปที่อัปโหลดแทน URL ในช่องด้านบน</small></div><div id="dynamicSectionEmbedWrap"><label>โค้ดที่ต้องการฝัง</label><textarea id="dynamicSectionEmbed" class="swal2-textarea" placeholder="วาง iframe / HTML / embed code">${esc(type==='embed'?(item?.source||''):'')}</textarea><small>โค้ดฝังทำงานภายใน iframe แบบ sandbox เพื่อไม่ให้ชนกับระบบหลักของเว็บไซต์</small></div><label>ระบุ URL รายละเอียด</label><input id="dynamicSectionDetailUrl" class="swal2-input" value="${esc(item?.detailUrl||'')}" placeholder="https://... หรือ page.html"><label>ชื่อปุ่ม</label><input id="dynamicSectionButtonLabel" class="swal2-input" value="${esc(item?.buttonLabel||'')}" maxlength="60" placeholder="เช่น ดูทั้งหมด / เข้าชม / รายละเอียดเพิ่มเติม"><small>เมื่อระบุ URL รายละเอียด ระบบจะแสดงปุ่มมุมบนขวาของ SECTION และเปิดหน้าใหม่เมื่อคลิก</small><label>ความสูง SECTION (px)</label><input id="dynamicSectionHeight" class="swal2-input" type="number" min="260" max="1600" step="10" value="${Number(item?.height||620)}"></div>`;
}
async function openSectionEditor(item,index){
  if(!window.Swal){status('ยังโหลดเครื่องมือแก้ไขไม่เสร็จ กรุณากดอีกครั้ง',1800);return}
  const editing=!!item;
  const result=await Swal.fire({title:editing?'แก้ไข SECTION':'เพิ่ม SECTION ใหม่',html:editorHtml(item),width:'min(820px,96vw)',showCancelButton:true,confirmButtonText:editing?'บันทึกการแก้ไข':'เพิ่ม SECTION',cancelButtonText:'ยกเลิก',confirmButtonColor:'#dc2626',showLoaderOnConfirm:true,didOpen:()=>{
    const type=document.getElementById('dynamicSectionType'),urlWrap=document.getElementById('dynamicSectionUrlWrap'),embedWrap=document.getElementById('dynamicSectionEmbedWrap');
    const sync=()=>{const isEmbed=type.value==='embed';urlWrap.hidden=isEmbed;embedWrap.hidden=!isEmbed};type.addEventListener('change',sync);sync();
  },preConfirm:async()=>{
    const title=document.getElementById('dynamicSectionTitle').value.trim();
    const selectedType=document.getElementById('dynamicSectionType').value;
    const imageFile=document.getElementById('dynamicSectionImageFile')?.files?.[0]||null;
    let source=(selectedType==='embed'?document.getElementById('dynamicSectionEmbed').value:document.getElementById('dynamicSectionUrl').value).trim();
    const detailUrl=document.getElementById('dynamicSectionDetailUrl').value.trim();
    const buttonLabel=document.getElementById('dynamicSectionButtonLabel').value.trim();
    const height=clamp(document.getElementById('dynamicSectionHeight').value,260,1600);
    if(!title)return Swal.showValidationMessage('กรุณาระบุชื่อ SECTION');
    if(selectedType==='url'&&!source&&!imageFile)return Swal.showValidationMessage('กรุณาระบุ URL หน้าเพจ/รูปภาพ หรืออัปโหลดรูปภาพ');
    if(selectedType==='embed'&&!source)return Swal.showValidationMessage('กรุณาวางโค้ดที่ต้องการฝัง');
    if(source.length>45000)return Swal.showValidationMessage('โค้ด/URL ยาวเกิน 45,000 ตัวอักษร');
    if(selectedType==='url'&&source&&!validPageUrl(source))return Swal.showValidationMessage('URL ไม่ถูกต้อง กรุณาใช้ https://... หรือชื่อไฟล์ เช่น page.html');
    if(detailUrl&&!validPageUrl(detailUrl))return Swal.showValidationMessage('URL รายละเอียดไม่ถูกต้อง');
    if(detailUrl&&!buttonLabel)return Swal.showValidationMessage('กรุณากำหนดชื่อปุ่มสำหรับ URL รายละเอียด');
    if(buttonLabel&&!detailUrl)return Swal.showValidationMessage('กรุณาระบุ URL รายละเอียด หรือเว้นชื่อปุ่มให้ว่าง');
    let sourceType=selectedType;
    try{
      if(imageFile){
        source=await uploadSectionImage(imageFile);
        sourceType='image';
      }else if(selectedType==='url'&&looksLikeImageUrl(source)){
        sourceType='image';
      }
    }catch(e){return Swal.showValidationMessage(e.message||'อัปโหลดรูปภาพไม่สำเร็จ')}
    return {title,sourceType,source,height,detailUrl,buttonLabel};
  }});
  if(!result.isConfirmed)return;
  if(editing){layout[index]={...layout[index],...result.value}}
  else{layout.push({id:customId(),kind:'custom',visible:true,...result.value})}
  apply();await saveLayout();
}
async function deleteCustomSection(item,index){
  if(item.kind!=='custom')return;
  const result=await Swal.fire({icon:'warning',title:'ลบ SECTION นี้?',text:`${item.title} จะถูกนำออกจากหน้าเว็บไซต์`,showCancelButton:true,confirmButtonText:'ลบ SECTION',cancelButtonText:'ยกเลิก',confirmButtonColor:'#dc2626'});
  if(!result.isConfirmed)return;
  const section=document.getElementById(item.id);if(section)section.remove();layout.splice(index,1);apply();await saveLayout();
}
function addCreateButton(){
  if(document.getElementById('adminAddSectionButton'))return;
  const button=document.createElement('button');button.id='adminAddSectionButton';button.type='button';button.className='admin-add-section-button admin-only';button.innerHTML='<i class="fa-solid fa-plus"></i><span>เพิ่ม SECTION</span>';button.addEventListener('click',()=>openSectionEditor(null,-1));document.body.appendChild(button);
}
async function init(){addCreateButton();try{layout=await getLayout()}catch(e){console.warn(e);layout=normalize([])}renderCustomSections();apply()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

/* ===== home-summary.js ===== */
(() => {
  'use strict';

  const API_URL =
    window.APP_CONFIG.API_URL;

  const fields = {
    userTotal: 'userTotalBox',
    userPrimary: 'userPrimaryBox',
    userMiddle: 'userMiddleBox',
    userHigh: 'userHighBox',
    adminTotal: 'adminTotalBox',
    adminPrimary: 'adminPrimaryBox',
    adminMiddle: 'adminMiddleBox',
    adminHigh: 'adminHighBox',
    registrationCount: 'registrationCountBox',
    loginCount: 'loginCountBox',
    adminLoginCount: 'adminLoginCountBox',
    userLoginCount: 'userLoginCountBox',
    websiteVisitCount: 'websiteVisitCountBox'
  };

  function setValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = Number(value || 0).toLocaleString('th-TH');
  }

  async function loadHomeSummary() {
    const section = document.getElementById('homeSection');
    if (!section) return;

    section.classList.add('home-summary-loading');

    try {
      const url = new URL(API_URL);
      url.searchParams.set('mode', 'homeSummary');
      const response = window.SiteFast
        ? await window.SiteFast.fetchMode('homeSummary', {}, { key: 'home-summary-v4', ttl: 5 * 60 * 1000, staleTtl: 24 * 60 * 60 * 1000 }).then(data => ({ ok: true, json: async () => data }))
        : await fetch(url.toString(), { cache: 'default' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();
      if (result.success === false) {
        throw new Error(result.message || 'โหลดข้อมูลสรุปไม่สำเร็จ');
      }

      const data = result.data || result;
      Object.entries(fields).forEach(([key, id]) => setValue(id, data[key]));
    } catch (error) {
      console.error('loadHomeSummary error:', error);
    } finally {
      section.classList.remove('home-summary-loading');
    }
  }

  function scheduleHomeSummary() {
    const run = () => loadHomeSummary();
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 1800 });
    else setTimeout(run, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleHomeSummary, { once: true });
  } else {
    scheduleHomeSummary();
  }
})();

;

/* ===== profile-config.js ===== */
window.STUDENT_PROFILE_WEB_APP_URL =
  '';

;

/* ===== student-profile-login.js ===== */
(() => {
  'use strict';

  let isSearching = false;
  let autoSearchTimer = 0;
  let lastAutoRollno = '';
  let activeResultMessageHandler = null;

  function showMessage(options) {
    if (window.Swal) return Swal.fire(options);
    window.alert(options.text || options.title || 'เกิดข้อผิดพลาด');
    return Promise.resolve();
  }

  function showSearching(rollno) {
    if (!window.Swal) return;
    Swal.fire({
      title: 'กำลังค้นหาข้อมูลนักศึกษา',
      html: `รหัสนักศึกษา <strong>${escapeHtml(rollno)}</strong><br><small>กรุณารอสักครู่...</small>`,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading()
    });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function setTextColor(element, value) {
    const color = String(value || '').trim();
    if (!element || !color) return;
    try {
      if (window.CSS && CSS.supports && !CSS.supports('color', color)) return;
    } catch (_) {}
    element.style.color = color;
  }

  function applyLoginCardConfig(config) {
    const data = config || {};
    const title = document.getElementById('studentServicesLoginTitle');
    const subtitle = document.getElementById('studentServicesLoginSubtitle');
    const photo = document.getElementById('studentServicesLoginPhoto');
    const logo = document.getElementById('studentServicesLoginLogo');

    if (title && data.title) title.textContent = String(data.title);
    if (subtitle) subtitle.textContent = String(data.subtitle || '');
    setTextColor(title, data.titleColor);
    setTextColor(subtitle, data.subtitleColor);

    if (photo && data.photo) photo.src = String(data.photo);
    if (logo && data.logo) {
      logo.src = String(data.logo);
      logo.hidden = false;
    }
  }

  async function loadLoginCardConfig() {
    try {
      if (!window.SiteFast || typeof window.SiteFast.getHomeFast !== 'function') return;
      const result = await window.SiteFast.getHomeFast();
      const data = result?.data || result || {};
      if (data.studentLogin) applyLoginCardConfig(data.studentLogin);
    } catch (error) {
      console.warn('student login card config:', error);
    }
  }

  function getStudentWebAppUrl() {
    return String(window.STUDENT_PROFILE_WEB_APP_URL || '').trim();
  }

  function removeStudentResultFrame() {
    if (activeResultMessageHandler) {
      window.removeEventListener('message', activeResultMessageHandler);
      activeResultMessageHandler = null;
    }

    const overlay = document.getElementById('studentServicesResultFrame');
    if (overlay) overlay.remove();

    document.documentElement.classList.remove('student-result-open');
    document.body.classList.remove('student-result-open');
  }

  function returnToStudentSearch() {
    removeStudentResultFrame();

    const input = document.getElementById('studentServicesId');
    if (input) {
      input.value = '';
      input.focus();
    }

    lastAutoRollno = '';

    const section = document.getElementById('studentServicesBox');
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function prepareStudentResultFrame(rollno) {
    const webAppUrl = getStudentWebAppUrl();
    if (!webAppUrl) {
      return Promise.reject(new Error('ยังไม่ได้กำหนด URL ของ Student Service Web App'));
    }

    removeStudentResultFrame();

    // สร้าง iframe แบบซ่อนก่อน เพื่อให้ผู้ใช้ยังเห็น popup "กำลังค้นหา"
    // จนกว่า Web App จะยืนยันว่า showResult() สร้างหน้าผลลัพธ์เสร็จแล้ว
    const overlay = document.createElement('div');
    overlay.id = 'studentServicesResultFrame';
    overlay.setAttribute('aria-label', 'ผลข้อมูลนักศึกษา');
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483000',
      'width:100vw',
      'height:100vh',
      'background:#fff',
      'overflow:hidden',
      'visibility:hidden',
      'opacity:0',
      'pointer-events:none',
      'transition:opacity .12s ease'
    ].join(';');

    const frame = document.createElement('iframe');
    frame.id = 'studentServicesWebAppFrame';
    frame.title = 'ข้อมูลนักศึกษา';
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:#fff;';
    frame.setAttribute('allow', 'fullscreen');
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');

    const url = new URL(webAppUrl);
    url.searchParams.set('rollno', rollno);
    url.searchParams.set('autologin', '1');
    url.searchParams.set('_github', Date.now().toString());
    frame.src = url.toString();

    // ปุ่ม Home ของฝั่ง GitHub แสดงทับด้านบนของหน้าผลลัพธ์
    // กดแล้วกลับ index.html ในแท็บเดิม โดยไม่ย้อนเข้า login_box ของ Web App
    const homeButton = document.createElement('button');
    homeButton.id = 'studentServicesHomeButton';
    homeButton.type = 'button';
    homeButton.textContent = 'Home';
    homeButton.setAttribute('aria-label', 'กลับหน้าหลัก');
    homeButton.style.cssText = [
      'position:absolute',
      'top:max(10px, env(safe-area-inset-top))',
      'left:50%',
      'transform:translateX(-50%)',
      'z-index:10',
      'min-width:104px',
      'height:42px',
      'padding:0 22px',
      'border:1px solid rgba(0,0,0,.10)',
      'border-radius:999px',
      'background:rgba(255,255,255,.96)',
      'color:#24324a',
      'font:700 15px/1 system-ui,-apple-system,"Segoe UI",sans-serif',
      'box-shadow:0 5px 18px rgba(0,0,0,.16)',
      'cursor:pointer',
      '-webkit-tap-highlight-color:transparent'
    ].join(';');
    homeButton.addEventListener('click', () => {
      removeStudentResultFrame();
      window.location.assign('index.html');
    });

    overlay.appendChild(frame);
    overlay.appendChild(homeButton);
    document.body.appendChild(overlay);

    return new Promise((resolve, reject) => {
      let settled = false;

      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        removeStudentResultFrame();
        reject(new Error('ระบบ Student Service ใช้เวลาตอบกลับนานเกินไป กรุณาลองใหม่'));
      }, 60000);

      const cleanupSearchOnly = () => {
        window.clearTimeout(timeout);
      };

      const settleError = message => {
        if (settled) return;
        settled = true;
        cleanupSearchOnly();
        removeStudentResultFrame();
        reject(new Error(message || `ไม่พบข้อมูลนักศึกษา ${rollno}`));
      };

      const onMessage = event => {
        const data = event && event.data;
        if (!data || typeof data !== 'object') return;

        if (data.type === 'SSS_STUDENT_LOGOUT') {
          returnToStudentSearch();
          return;
        }

        if (data.type !== 'SSS_STUDENT_RESULT') return;

        const resultRollno = String(data.rollno || '')
          .replace(/\D/g, '')
          .slice(0, 10);

        if (resultRollno && resultRollno !== rollno) return;

        if (!data.found) {
          settleError(data.error || `ไม่พบข้อมูลนักศึกษา ${rollno}`);
          return;
        }

        if (settled) return;
        settled = true;
        cleanupSearchOnly();

        // Web App ส่งข้อความนี้หลัง showResult() สร้างหน้าผลลัพธ์แล้ว
        // ค่อยเปิด iframe ตอนนี้ จึงไม่เห็นจอขาวระหว่างค้นหา
        overlay.style.visibility = 'visible';
        overlay.style.opacity = '1';
        overlay.style.pointerEvents = 'auto';
        document.documentElement.classList.add('student-result-open');
        document.body.classList.add('student-result-open');

        resolve(data);
      };

      activeResultMessageHandler = onMessage;
      window.addEventListener('message', onMessage);

      frame.addEventListener('error', () => {
        settleError('ไม่สามารถโหลดหน้า Student Service ได้');
      }, { once: true });
    });
  }

  async function searchAndOpenProfile(rollno) {
    if (isSearching) return;
    isSearching = true;

    const input = document.getElementById('studentServicesId');
    const button = document.getElementById('studentServicesLoginBtn');

    if (input) input.value = rollno;
    if (button) {
      button.disabled = true;
      button.textContent = 'กำลังค้นหา...';
    }

    showSearching(rollno);

    try {
      await prepareStudentResultFrame(rollno);
      if (window.Swal) Swal.close();
      try { sessionStorage.setItem('LP360:TAMBOL:SSS_PROFILE_ROLLNO', rollno); } catch (_) {}
    } catch (error) {
      console.error('student result frame error:', error);
      removeStudentResultFrame();
      await showMessage({
        icon: 'error',
        title: 'ค้นหาข้อมูลไม่สำเร็จ',
        text: error?.message || 'ไม่สามารถเชื่อมต่อระบบค้นหานักศึกษาได้',
        confirmButtonText: 'ตกลง'
      });
      input?.focus();
    } finally {
      isSearching = false;
      if (button) {
        button.disabled = false;
        button.textContent = 'LOGIN';
      }
    }
  }

  async function login(event) {
    event?.preventDefault();

    const input = document.getElementById('studentServicesId');
    const rollno = String(input?.value || '')
      .replace(/\D/g, '')
      .trim()
      .slice(0, 10);

    if (!rollno) {
      await showMessage({
        icon: 'warning',
        title: 'กรุณากรอกรหัสนักศึกษา',
        text: 'ระบุรหัสนักศึกษาก่อนเข้าสู่ระบบ',
        confirmButtonText: 'ตกลง'
      });
      input?.focus();
      return;
    }

    if (rollno.length !== 10) {
      await showMessage({
        icon: 'warning',
        title: 'รหัสนักศึกษาไม่ครบ',
        text: 'กรุณากรอกรหัสนักศึกษา 10 หลัก',
        confirmButtonText: 'ตกลง'
      });
      input?.focus();
      return;
    }

    await searchAndOpenProfile(rollno);
  }

  function init() {
    const form = document.getElementById('studentServicesLoginForm');
    const input = document.getElementById('studentServicesId');

    input?.addEventListener('input', () => {
      const rollno = String(input.value || '')
        .replace(/\D/g, '')
        .slice(0, 10);
      input.value = rollno;

      if (autoSearchTimer) window.clearTimeout(autoSearchTimer);

      if (rollno.length < 10) {
        lastAutoRollno = '';
        return;
      }

      if (rollno === lastAutoRollno || isSearching) return;
      lastAutoRollno = rollno;

      autoSearchTimer = window.setTimeout(() => {
        searchAndOpenProfile(rollno);
      }, 250);
    });

    form?.addEventListener('submit', login);
    loadLoginCardConfig();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
;

/* ===== student-service-ranking.js ===== */
(() => {
  'use strict';

  // Web App เดิมของระบบหลัก (ไม่ต้องสร้าง Apps Script แยก)
  const STUDENT_SERVICE_API_URL =
    window.APP_CONFIG.API_URL;

  const LEVELS = ['ประถม', 'ม.ต้น', 'ม.ปลาย'];
  const MEDALS = ['🥇1', '🥈2', '🥉3'];
  const CACHE_KEY = 'LP360:TAMBOL:studentServiceTop3:v1';
  const CACHE_AGE = 5 * 60 * 1000;
  const AUTO_ROTATE_DELAY = 4000;
  let rankingData = null;
  let autoRotateTimer = null;
  let activeLevelIndex = 0;
  let autoRotateStoppedByUser = false;

  const escapeHtml = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  function readCache() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      return cached && Date.now() - cached.savedAt < CACHE_AGE
        ? cached.data
        : null;
    } catch (_) {
      return null;
    }
  }

  function writeCache(data) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
    } catch (_) {}
  }

  function renderCard(card, level) {
    const type = card.dataset.rankingType;
    const ranking = card.querySelector('.student-service-ranking');
    const rows = rankingData && rankingData[type] && Array.isArray(rankingData[type][level])
      ? rankingData[type][level].slice(0, 3)
      : [];

    card.querySelectorAll('.student-service-tabs button').forEach(button => {
      const active = button.dataset.level === level;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });

    if (!rows.length) {
      ranking.innerHTML = '<span class="student-service-ranking-status">ยังไม่มีข้อมูล</span>';
      return;
    }

    ranking.innerHTML = rows.map((row, index) => `
      <span title="${escapeHtml(row.teacher)}">
        ${MEDALS[index]} &nbsp;${escapeHtml(row.teacher)}
      </span>
      <b title="${Number(row.percent || 0).toFixed(2)}%">
        ${Number(row.percent || 0).toFixed(2)}%
      </b>
    `).join('');
  }

  function renderAll(level) {
    document.querySelectorAll('[data-ranking-type]').forEach(card => {
      const active = card.querySelector('.student-service-tabs .is-active');
      renderCard(card, level || (active ? active.dataset.level : LEVELS[0]));
    });
  }

  function stopAutoRotate() {
    if (autoRotateTimer) {
      window.clearInterval(autoRotateTimer);
      autoRotateTimer = null;
    }
  }

  function startAutoRotate() {
    stopAutoRotate();
    if (autoRotateStoppedByUser || !rankingData) return;

    autoRotateTimer = window.setInterval(() => {
      activeLevelIndex = (activeLevelIndex + 1) % LEVELS.length;
      renderAll(LEVELS[activeLevelIndex]);
    }, AUTO_ROTATE_DELAY);
  }

  function showError(message) {
    document.querySelectorAll('[data-ranking-type] .student-service-ranking').forEach(box => {
      box.innerHTML = `<span class="student-service-ranking-status">${escapeHtml(message)}</span>`;
    });
  }

  async function loadRankings() {
    rankingData = readCache();
    if (rankingData) {
      activeLevelIndex = 0;
      renderAll(LEVELS[activeLevelIndex]);
      startAutoRotate();
      return;
    }

    if (!/^https:\/\/script\.google\.com\/macros\/s\//.test(STUDENT_SERVICE_API_URL)) {
      showError('กรุณาตั้งค่า URL Apps Script');
      return;
    }

    try {
      let result;
      if (window.SiteFast) {
        result = await window.SiteFast.fetchMode(
          'studentServiceTop3',
          {},
          { key: 'studentServiceTop3:v2', ttl: CACHE_AGE }
        );
      } else {
        const separator = STUDENT_SERVICE_API_URL.includes('?') ? '&' : '?';
        const response = await fetch(
          `${STUDENT_SERVICE_API_URL}${separator}mode=studentServiceTop3`,
          { method: 'GET', cache: 'default' }
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        result = await response.json();
      }
      if (!result || (!result.worksheet && !result.quiz)) {
        throw new Error('รูปแบบข้อมูลไม่ถูกต้อง');
      }

      rankingData = result;
      writeCache(result);
      activeLevelIndex = 0;
      renderAll(LEVELS[activeLevelIndex]);
      startAutoRotate();
    } catch (error) {
      console.error('Student service ranking:', error);
      showError('โหลดอันดับไม่สำเร็จ');
    }
  }

  document.addEventListener('click', event => {
    const tab = event.target.closest('.student-service-tabs button');
    if (!tab) return;

    autoRotateStoppedByUser = true;
    stopAutoRotate();

    activeLevelIndex = Math.max(0, LEVELS.indexOf(tab.dataset.level));
    if (rankingData) renderAll(LEVELS[activeLevelIndex]);
  });

  function scheduleRankings() {
    if (window.SiteFast) window.SiteFast.whenNear('studentServicesBox', loadRankings, '700px 0px');
    else if ('requestIdleCallback' in window) requestIdleCallback(loadRankings, { timeout: 2200 });
    else setTimeout(loadRankings, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleRankings, { once: true });
  } else {
    scheduleRankings();
  }
})();

;

/* ===== learning-source-box.js ===== */
(() => {
  'use strict';

  const WEB_APP_URL =
    window.APP_CONFIG.API_URL;

  const $ = id => document.getElementById(id);
  let currentArea = null;

  const esc = value =>
    String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');

  const escAttr = esc;

  const num = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const clampPercent = value => Math.max(0, Math.min(100, num(value)));

  const formatNumber = value => num(value).toLocaleString('th-TH');

  const sourceImage = source =>
    source?.image_url || source?.image2_url || source?.image3_url || '';

  function sourceUrl(source) {
    const url = new URL('learning.html', window.location.href);
    if (source?.id) url.searchParams.set('id', source.id);
    if (currentArea?.name) url.searchParams.set('area', currentArea.name);
    url.searchParams.set('source', 'index-map');
    return url.href;
  }

  function markerHtml(source, index) {
    const image = sourceImage(source);
    const x = clampPercent(source.map_x ?? 50);
    const y = clampPercent(source.map_y ?? 50);
    const color = /^#[0-9a-f]{6}$/i.test(String(source.marker_color || ''))
      ? source.marker_color
      : '#ef4444';

    return `
      <button
        class="lsb-source-marker"
        type="button"
        data-source-id="${escAttr(source.id)}"
        data-source-index="${index}"
        style="left:${x}%;top:${y}%;--lsb-source-color:${escAttr(color)}"
        aria-label="${escAttr(source.name || 'แหล่งเรียนรู้')}"
      >
        <span class="lsb-source-pin" aria-hidden="true">
          <i class="fa-solid fa-location-dot"></i>
        </span>
        <span class="lsb-source-marker-name">${esc(source.name || 'แหล่งเรียนรู้')}</span>

        <span class="lsb-source-popup" role="tooltip">
          ${image ? `
            <img src="${escAttr(image)}" alt="${escAttr(source.name || '')}" loading="lazy">
          ` : `
            <span class="lsb-source-popup-noimage">ไม่มีรูปภาพ</span>
          `}
          <span class="lsb-source-popup-body">
            <strong>${esc(source.name || 'แหล่งเรียนรู้')}</strong>
            ${source.category ? `<small><i class="fa-solid fa-tag"></i>${esc(source.category)}</small>` : ''}
            ${source.address ? `<small><i class="fa-solid fa-location-dot"></i>${esc(source.address)}</small>` : ''}
            <span class="lsb-source-popup-stats">
              <span><i class="fa-solid fa-star"></i>${formatNumber(source.averageRating || 0)}</span>
              <span><i class="fa-regular fa-eye"></i>${formatNumber(source.views || 0)}</span>
            </span>
            <em>คลิกเพื่อดูรายละเอียด</em>
          </span>
        </span>
      </button>
    `;
  }

  function slideCardHtml(source, index) {
    const image = sourceImage(source);
    return `
      <article
        class="lsb-source-slide-card"
        data-source-card="${escAttr(source.id)}"
        data-source-index="${index}"
        tabindex="0"
        role="button"
        aria-label="ดูรายละเอียด ${escAttr(source.name || 'แหล่งเรียนรู้')}"
      >
        <div class="lsb-source-slide-image">
          ${image ? `
            <img src="${escAttr(image)}" alt="${escAttr(source.name || '')}" loading="lazy">
          ` : `
            <div class="lsb-source-slide-noimage"><i class="fa-regular fa-image"></i></div>
          `}
          ${source.category ? `<span class="lsb-source-slide-category">${esc(source.category)}</span>` : ''}
        </div>
        <div class="lsb-source-slide-info">
          <strong>${esc(source.name || 'แหล่งเรียนรู้')}</strong>
          <span>
            <i class="fa-solid fa-star" aria-hidden="true"></i>
            ${formatNumber(source.averageRating || 0)}
            <b>•</b>
            <i class="fa-regular fa-eye" aria-hidden="true"></i>
            ${formatNumber(source.views || 0)}
          </span>
        </div>
      </article>
    `;
  }

  function renderExplorer(area) {
    const grid = $('lsbAreaGrid');
    const showAllWrap = $('lsbShowAllWrap');
    if (!grid) return;

    currentArea = area || {};
    const sources = Array.isArray(currentArea.sources) ? currentArea.sources : [];
    const mapImage = currentArea.mapImage || sourceImage(sources[0]) || '';

    if (showAllWrap) showAllWrap.hidden = true;

    grid.innerHTML = `
      <div class="lsb-map-explorer">
        <div class="lsb-main-map-wrap">
          <div class="lsb-main-map" aria-label="${escAttr(currentArea.mapTitle || 'แผนที่แหล่งเรียนรู้')}">
            ${mapImage ? `
              <img class="lsb-main-map-image" src="${escAttr(mapImage)}" alt="${escAttr(currentArea.mapTitle || currentArea.name || 'แผนที่แหล่งเรียนรู้')}">
            ` : `
              <div class="lsb-main-map-empty">
                <i class="fa-regular fa-map"></i>
                <span>ยังไม่ได้กำหนดภาพแผนที่</span>
              </div>
            `}

            <div class="lsb-source-markers">
              ${sources.map(markerHtml).join('')}
            </div>

            <div class="lsb-map-summary">
              <strong>${esc(currentArea.mapTitle || currentArea.name || 'แผนที่แหล่งเรียนรู้')}</strong>
              <span>${formatNumber(sources.length)} แหล่งเรียนรู้</span>
            </div>
          </div>
        </div>

        <div class="lsb-source-carousel" ${sources.length ? '' : 'hidden'}>
          <div class="lsb-source-carousel-heading">
            <div>
              <span>รายการแหล่งเรียนรู้</span>
              <strong>${formatNumber(sources.length)} แห่ง</strong>
            </div>
            <small>เลื่อนดูรายการ หรือวางเมาส์ที่หมุดบนภาพ</small>
          </div>

          <div class="lsb-source-carousel-shell">
            <button class="lsb-source-carousel-arrow lsb-source-carousel-prev" type="button" aria-label="รายการก่อนหน้า">
              <i class="fa-solid fa-chevron-left"></i>
            </button>

            <div class="lsb-source-carousel-viewport" tabindex="0">
              <div class="lsb-source-carousel-track">
                ${sources.map(slideCardHtml).join('')}
              </div>
            </div>

            <button class="lsb-source-carousel-arrow lsb-source-carousel-next" type="button" aria-label="รายการถัดไป">
              <i class="fa-solid fa-chevron-right"></i>
            </button>
          </div>
        </div>

        ${sources.length ? '' : `
          <div class="lsb-empty">ยังไม่มีรายการแหล่งเรียนรู้ในชีต learning_sources</div>
        `}
      </div>
    `;

    bindExplorerEvents(grid);
  }

  function openSource(sourceId) {
    if (!currentArea || !Array.isArray(currentArea.sources)) return;
    const source = currentArea.sources.find(item => String(item.id) === String(sourceId));
    if (!source) return;
    window.open(sourceUrl(source), '_blank', 'noopener,noreferrer');
  }

  function setActiveSource(sourceId, scrollCard) {
    const grid = $('lsbAreaGrid');
    if (!grid) return;

    grid.querySelectorAll('.lsb-source-marker.is-active, .lsb-source-slide-card.is-active')
      .forEach(el => el.classList.remove('is-active'));

    const marker = [...grid.querySelectorAll('.lsb-source-marker')]
      .find(el => el.dataset.sourceId === String(sourceId));
    const card = [...grid.querySelectorAll('.lsb-source-slide-card')]
      .find(el => el.dataset.sourceCard === String(sourceId));

    marker?.classList.add('is-active');
    card?.classList.add('is-active');

    if (scrollCard && card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  function clearActiveSource(sourceId) {
    const grid = $('lsbAreaGrid');
    if (!grid) return;
    const marker = [...grid.querySelectorAll('.lsb-source-marker')]
      .find(el => el.dataset.sourceId === String(sourceId));
    const card = [...grid.querySelectorAll('.lsb-source-slide-card')]
      .find(el => el.dataset.sourceCard === String(sourceId));
    marker?.classList.remove('is-active');
    card?.classList.remove('is-active');
  }

  function bindExplorerEvents(grid) {
    grid.querySelectorAll('.lsb-source-marker').forEach(marker => {
      const sourceId = marker.dataset.sourceId;
      marker.addEventListener('mouseenter', () => setActiveSource(sourceId, false));
      marker.addEventListener('mouseleave', () => clearActiveSource(sourceId));
      marker.addEventListener('focus', () => setActiveSource(sourceId, true));
      marker.addEventListener('blur', () => clearActiveSource(sourceId));
      marker.addEventListener('click', () => openSource(sourceId));
    });

    grid.querySelectorAll('.lsb-source-slide-card').forEach(card => {
      const sourceId = card.dataset.sourceCard;
      card.addEventListener('mouseenter', () => setActiveSource(sourceId, false));
      card.addEventListener('mouseleave', () => clearActiveSource(sourceId));
      card.addEventListener('focus', () => setActiveSource(sourceId, false));
      card.addEventListener('blur', () => clearActiveSource(sourceId));
      card.addEventListener('click', () => openSource(sourceId));
      card.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openSource(sourceId);
      });
    });

    const viewport = grid.querySelector('.lsb-source-carousel-viewport');
    const prev = grid.querySelector('.lsb-source-carousel-prev');
    const next = grid.querySelector('.lsb-source-carousel-next');

    const scrollCarousel = direction => {
      if (!viewport) return;
      viewport.scrollBy({
        left: direction * Math.max(260, viewport.clientWidth * 0.82),
        behavior: 'smooth'
      });
    };

    prev?.addEventListener('click', () => scrollCarousel(-1));
    next?.addEventListener('click', () => scrollCarousel(1));
  }

  window.receiveLearningAreas = function(result) {
    clearTimeout(window.lsbLoadTimer);
    const grid = $('lsbAreaGrid');
    if (!grid) return;

    if (!result || result.success !== true) {
      console.error('Learning areas:', result);
      grid.innerHTML = '<div class="lsb-loading">ไม่สามารถโหลดข้อมูลได้</div>';
      return;
    }

    const areas = Array.isArray(result.areas) ? result.areas : [];
    if (!areas.length) {
      grid.innerHTML = '<div class="lsb-loading">ยังไม่มีข้อมูลแหล่งเรียนรู้</div>';
      return;
    }

    renderExplorer(areas[0]);
  };

  function loadLearningAreas() {
    const grid = $('lsbAreaGrid');
    if (!grid) {
      console.error('ไม่พบ element #lsbAreaGrid');
      return;
    }

    grid.innerHTML = '<div class="lsb-loading section-loading-with-spinner"><span class="section-loading-spinner" aria-hidden="true"></span>กำลังโหลดแหล่งเรียนรู้...</div>';

    if (window.SiteFast) {
      window.SiteFast.fetchMode('learningAreas', { v: '6' }, {
        key: 'learning-areas-map-v6',
        ttl: 60000
      })
        .then(window.receiveLearningAreas)
        .catch(error => {
          console.error('Learning Areas API:', error);
          grid.innerHTML = '<div class="lsb-loading">ไม่สามารถเชื่อมต่อข้อมูลได้</div>';
        });
      return;
    }

    document.getElementById('lsbAreaJsonp')?.remove();
    clearTimeout(window.lsbLoadTimer);

    window.lsbLoadTimer = setTimeout(() => {
      grid.innerHTML = '<div class="lsb-loading">หมดเวลารอข้อมูล</div>';
    }, 30000);

    const script = document.createElement('script');
    script.id = 'lsbAreaJsonp';
    script.async = true;
    script.src =
      WEB_APP_URL +
      '?mode=learningAreas' +
      '&v=6' +
      '&callback=window.receiveLearningAreas' +
      '&_=' +
      Date.now();

    script.onerror = () => {
      clearTimeout(window.lsbLoadTimer);
      grid.innerHTML = '<div class="lsb-loading">ไม่สามารถเชื่อมต่อข้อมูลได้</div>';
      script.remove();
    };

    document.body.appendChild(script);
  }

  if (window.SiteFast) {
    window.SiteFast.whenNear('learningSourceBox', loadLearningAreas);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadLearningAreas);
  } else {
    loadLearningAreas();
  }
})();

;

/* ===== best-practice-box.js ===== */
(() => {
  'use strict';

  const API_URL =
    window.APP_CONFIG.API_URL;

  let loadPromise = null;

  const esc = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const safeUrl = value => {
    const url = String(value || '').trim();
    return /^https?:\/\//i.test(url) ? url.replace(/^http:\/\//i, 'https://') : '';
  };

  function dateValue(value) {
    const text = String(value || '').trim();
    if (!text) return 0;
    const match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
    if (match) {
      let year = Number(match[3]);
      if (year < 100) year += 2500;
      if (year >= 2400) year -= 543;
      return new Date(year, Number(match[2]) - 1, Number(match[1])).getTime() || 0;
    }
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  function normalize(item, index) {
    return {
      order: String(item?.order ?? item?.no ?? (index + 1)).trim(),
      poster: safeUrl(item?.poster || item?.image || ''),
      fileUrl: safeUrl(item?.fileUrl || item?.url || ''),
      date: String(item?.date || '').trim()
    };
  }

  function render(items) {
    const status = document.getElementById('bestPracticeBoxStatus');
    const slider = document.getElementById('bestPracticeBoxSlider');
    const track = document.getElementById('bestPracticeBoxTrack');
    if (!status || !slider || !track) return;

    const rows = (Array.isArray(items) ? items : [])
      .map(normalize)
      .filter(item => item.poster || item.fileUrl)
      .sort((a, b) => dateValue(b.date) - dateValue(a.date) || Number(b.order || 0) - Number(a.order || 0));

    if (!rows.length) {
      status.classList.remove('section-loading-with-spinner');
      status.hidden = false;
      status.textContent = 'ยังไม่มีรายการ Best Practice ในชีต best_practice';
      slider.hidden = true;
      track.innerHTML = '';
      return;
    }

    status.classList.remove('section-loading-with-spinner');
    status.hidden = true;
    slider.hidden = false;

    track.innerHTML = rows.map((item, index) => {
      const poster = item.poster || 'https://placehold.co/900x1200?text=Best+Practice';
      const href = item.fileUrl || 'best_practice.html';
      const order = esc(item.order || String(index + 1));
      return `
        <article class="best-practice-box-card">
          <a class="best-practice-box-card-link" href="${esc(href)}" ${item.fileUrl ? 'target="_blank" rel="noopener noreferrer"' : ''} aria-label="เปิด Best Practice ลำดับ ${order}">
            <div class="best-practice-box-poster-wrap">
              <img class="best-practice-box-poster" src="${esc(poster)}" alt="Best Practice ลำดับ ${order}" loading="lazy" onerror="this.onerror=null;this.src='https://placehold.co/900x1200?text=Best+Practice';">
              <span class="best-practice-box-badge">BEST PRACTICE</span>
            </div>
            <div class="best-practice-box-card-body">
              <strong>Best Practice ${order}</strong>
              ${item.date ? `<span><i class="fa-regular fa-calendar" aria-hidden="true"></i>${esc(item.date)}</span>` : ''}
            </div>
          </a>
        </article>`;
    }).join('');

    requestAnimationFrame(updateArrows);
  }

  function getViewport() {
    return document.getElementById('bestPracticeBoxViewport');
  }

  function updateArrows() {
    const viewport = getViewport();
    const prev = document.getElementById('bestPracticeBoxPrev');
    const next = document.getElementById('bestPracticeBoxNext');
    if (!viewport || !prev || !next) return;
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth - 2);
    prev.disabled = viewport.scrollLeft <= 2;
    next.disabled = viewport.scrollLeft >= max;
  }

  function slide(direction) {
    const viewport = getViewport();
    if (!viewport) return;
    const card = viewport.querySelector('.best-practice-box-card');
    const gap = 18;
    const step = card ? (card.getBoundingClientRect().width + gap) : viewport.clientWidth * 0.9;
    const visible = card ? Math.max(1, Math.floor((viewport.clientWidth + gap) / step)) : 1;
    viewport.scrollBy({ left: direction * step * visible, behavior: 'smooth' });
  }

  async function directFetch() {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 18000) : null;
    try {
      const url = API_URL + '?mode=bestpractice&_t=' + Date.now();
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        signal: controller?.signal
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function fetchBestPractice() {
    // ใช้ SiteFast ก่อน แต่ถ้าเกิดปัญหาให้ fallback ยิง Apps Script โดยตรง
    if (window.SiteFast?.fetchMode) {
      try {
        return await window.SiteFast.fetchMode('bestpractice', { v: '2' }, {
          key: 'best-practice-home-v2',
          ttl: 120000
        });
      } catch (siteFastError) {
        console.warn('Best Practice SiteFast fallback:', siteFastError);
      }
    }
    return directFetch();
  }

  async function load(force = false) {
    if (loadPromise && !force) return loadPromise;

    const status = document.getElementById('bestPracticeBoxStatus');
    const slider = document.getElementById('bestPracticeBoxSlider');
    if (!status) return;

    status.hidden = false;
    status.classList.add('section-loading-with-spinner');
    status.innerHTML = '<span class="section-loading-spinner" aria-hidden="true"></span>กำลังโหลด Best Practice...';
    if (slider) slider.hidden = true;

    loadPromise = (async () => {
      try {
        const result = await fetchBestPractice();
        if (result?.success === false) throw new Error(result.message || 'โหลดข้อมูลไม่สำเร็จ');
        const items = Array.isArray(result?.items)
          ? result.items
          : (Array.isArray(result?.data) ? result.data : []);
        render(items);
      } catch (error) {
        console.error('Best Practice Box:', error);
        status.classList.remove('section-loading-with-spinner');
        status.hidden = false;
        status.textContent = 'โหลด Best Practice ไม่สำเร็จ: ' + (error?.message || 'ไม่ทราบสาเหตุ');
        if (slider) slider.hidden = true;
      } finally {
        loadPromise = null;
      }
    })();

    return loadPromise;
  }

  function init() {
    document.getElementById('bestPracticeBoxPrev')?.addEventListener('click', () => slide(-1));
    document.getElementById('bestPracticeBoxNext')?.addEventListener('click', () => slide(1));
    getViewport()?.addEventListener('scroll', updateArrows, { passive: true });

    // ลด request ตอนเปิดหน้าแรก: โหลดเมื่อใกล้ SECTION แต่ยังเริ่มก่อนผู้ใช้เลื่อนถึงจริง
    if (window.SiteFast?.whenNear) window.SiteFast.whenNear('bestPracticeBox', load, '1000px 0px');
    else load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.addEventListener('resize', updateArrows);
  window.addEventListener('pageshow', event => {
    if (event.persisted && document.getElementById('bestPracticeBoxStatus')?.textContent.includes('กำลังโหลด')) {
      load(true);
    }
  });

  document.addEventListener('best-practice-admin-updated', () => {
    window.SiteFast?.clear('best-practice-home');
    load(true);
  });
})();

;

/* ===== fbpost-box.js ===== */
(() => {
  'use strict';

  const API_URL = window.APP_CONFIG.API_URL + '?mode=facebook';
  const MAX_HOME_ITEMS = 8;

  const esc = value => String(value ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');

  const safeHttps = value => {
    const url = String(value || '').trim();
    return /^https:\/\//i.test(url) ? url : '';
  };

  function dateValue(dateText) {
    const text = String(dateText || '').trim();
    if (!text) return 0;

    const match = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (!match) {
      const parsed = Date.parse(text);
      return Number.isNaN(parsed) ? 0 : parsed;
    }

    let day = Number(match[1]);
    let month = Number(match[2]) - 1;
    let year = Number(match[3]);

    if (year < 100) year += 2500;
    if (year >= 2400) year -= 543;

    return new Date(year, month, day).getTime();
  }

  function sortLatest(items) {
    return [...items].sort((a, b) => {
      const byExactTime = Number(b.sortTime || 0) - Number(a.sortTime || 0);
      if (byExactTime !== 0) return byExactTime;
      const byDate = dateValue(b.date) - dateValue(a.date);
      if (byDate !== 0) return byDate;
      return String(a.area || '').localeCompare(String(b.area || ''), 'th');
    });
  }

  function uniqueLatest(items) {
    const seen = new Set();
    return sortLatest(items).filter(item => {
      const key = String(item.facebookUrl || item.embedUrl || '').trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function scaleFacebookFrames(root) {
    root.querySelectorAll('.fbpost-box-preview').forEach(box => {
      const iframe = box.querySelector('iframe');
      if (!iframe) return;
      const scale = Math.min(1, box.clientWidth / 500);
      iframe.style.transform = `scale(${scale})`;
    });
  }

  function render(items) {
    const status = document.getElementById('fbpostBoxStatus');
    const grid = document.getElementById('fbpostBoxGrid');
    if (!status || !grid) return;

    const rows = uniqueLatest(items).slice(0, MAX_HOME_ITEMS);

    if (!rows.length) {
      status.hidden = false;
      status.textContent = 'ยังไม่มีโพสต์ Facebook';
      grid.innerHTML = '';
      return;
    }

    status.hidden = true;
    grid.innerHTML = rows.map(item => {
      const embedUrl = safeHttps(item.embedUrl);
      const facebookUrl = safeHttps(item.facebookUrl);
      if (!embedUrl || !facebookUrl) return '';

      return `
        <article class="fbpost-box-card" data-url="${esc(facebookUrl)}" tabindex="0" role="link">
          <div class="fbpost-box-preview">
            <iframe
              src="${esc(embedUrl)}"
              title="โพสต์ Facebook ${esc(item.area || '')}"
              loading="lazy"
              scrolling="no"
              frameborder="0"
              allowfullscreen
              allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share">
            </iframe>
          </div>
          <div class="fbpost-box-card-body">
            <h3 class="fbpost-box-area">${esc(item.area || 'ไม่ระบุพื้นที่')}</h3>
            ${item.date ? `<div class="fbpost-box-date"><i class="fa-regular fa-calendar"></i>${esc(item.date)}</div>` : ''}
          </div>
        </article>`;
    }).join('');

    grid.querySelectorAll('.fbpost-box-card').forEach(card => {
      const open = () => {
        const url = card.dataset.url;
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
      };
      card.addEventListener('click', open);
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });

    requestAnimationFrame(() => scaleFacebookFrames(grid));
  }

  async function load() {
    const status = document.getElementById('fbpostBoxStatus');
    const grid = document.getElementById('fbpostBoxGrid');
    if (!status || !grid) return;

    try {
      let result;
      if (window.SiteFast) {
        result = await window.SiteFast.fetchMode('facebook', {}, { key: 'facebook-home-v2', ttl: 180000 });
      } else {
        const response = await fetch(API_URL, { method:'GET', cache:'default' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        result = await response.json();
      }
      if (result.success === false) {
        throw new Error(result.message || 'โหลดข้อมูลไม่สำเร็จ');
      }

      render(Array.isArray(result.items) ? result.items : []);
    } catch (error) {
      console.error('FBpostBox:', error);
      status.hidden = false;
      status.textContent = 'โหลดโพสต์ Facebook ไม่สำเร็จ';
      grid.innerHTML = '';
    }
  }

  window.addEventListener('resize', () => {
    const grid = document.getElementById('fbpostBoxGrid');
    if (grid) scaleFacebookFrames(grid);
  });

  document.addEventListener('DOMContentLoaded', () => {
    if (window.SiteFast) window.SiteFast.whenNear('FBpostBox', load);
    else load();
  });
  document.addEventListener('facebook-admin-updated', load);
})();

;

/* ===== boss-box.js ===== */
(() => {
  'use strict';

  const BOSS_WEB_APP_URL =
    window.APP_CONFIG.API_URL;
  const TEAM_API_URL = BOSS_WEB_APP_URL + '?mode=team';
  const BOSS_API_URL = BOSS_WEB_APP_URL + '?mode=boss';

  const text = value => String(value ?? '').trim();
  const esc = value => text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  let resizeTimer = 0;

  function normalizeTeam(result) {
    const source = result?.team || result?.data?.team || result?.data || result || [];
    if (!Array.isArray(source)) return [];

    return source
      .map((item, index) => Array.isArray(item)
        ? {
            order: text(item[0]) || String(index + 1),
            name: text(item[1]),
            position: text(item[2]),
            image: text(item[3])
          }
        : {
            order: text(item?.order || item?.no || item?.index) || String(index + 1),
            name: text(item?.name || item?.fullName || item?.['ชื่อ'] || item?.['ชื่อ-นามสกุล']),
            position: text(item?.position || item?.title || item?.['ตำแหน่ง']),
            image: text(item?.image || item?.photo || item?.imageUrl || item?.['รูปภาพบุคลากร'])
          })
      .filter(item => item.name || item.position || item.image)
      .sort((a, b) => (Number(a.order) || 999999) - (Number(b.order) || 999999));
  }

  function normalizeBoss(result) {
    const source = result?.boss || result?.data?.boss || result?.data || result || {};
    return {
      image: text(source.image || source.photo || source.url || source['รูป'] || source['รูปภาพ']),
      name: text(source.name || source.fullName || source['ชื่อ']),
      position: text(source.position || source.title || source['ตำแหน่ง']),
      popupImage: text(source.popupImage || source.popup_image || source['รูปป๊อปอัป'] || source['รูป Pop-up']),
      popupUrl: text(source.popupUrl || source.popup_url || source.detailUrl || source['ลิงก์อ่านเพิ่มเติม']),
      popupMode: text(source.popupMode || source.popup_mode || source.mode || source['เปิด/ปิด']).toLowerCase()
    };
  }

  function showBossStatus(message, isError = false) {
    const box = document.getElementById('bossBox');
    const track = document.getElementById('bossTrack');
    if (!box || !track) return;
    box.removeAttribute('hidden');
    const isLoading = String(message || '').startsWith('กำลังโหลด');
    track.innerHTML = `<div class="boss-carousel-status${isError ? ' is-error' : ''}${isLoading ? ' section-loading-with-spinner' : ''}">${isLoading ? '<span class="section-loading-spinner" aria-hidden="true"></span>' : ''}${esc(message || '')}</div>`;
    const prev = document.getElementById('bossPrev');
    const next = document.getElementById('bossNext');
    if (prev) prev.hidden = true;
    if (next) next.hidden = true;
  }

  function hideBossBox() {
    // index.html ต้องคงแถวบุคลากรไว้เสมอ เพื่อไม่ให้แถวบนหายไปเมื่อ API มีปัญหา
    if (document.getElementById('bossTrack')) {
      showBossStatus('ยังไม่มีข้อมูลบุคลากรในชีต boss');
      return;
    }
    document.getElementById('bossBox')?.setAttribute('hidden', '');
  }

  function renderLegacyBoss(boss) {
    const box = document.getElementById('bossBox');
    const photo = document.getElementById('bossPhoto');
    const name = document.getElementById('bossName');
    const position = document.getElementById('bossPosition');
    if (!box || !photo || !name || !position) return;

    if (!boss.image && !boss.name && !boss.position) {
      box.setAttribute('hidden', '');
      return;
    }

    if (boss.image) {
      photo.src = boss.image;
      photo.hidden = false;
    } else {
      photo.removeAttribute('src');
      photo.hidden = true;
    }
    name.textContent = boss.name;
    name.hidden = !boss.name;
    position.textContent = boss.position;
    position.hidden = !boss.position;
    box.removeAttribute('hidden');
  }

  function updateArrows() {
    const viewport = document.getElementById('bossViewport');
    const prev = document.getElementById('bossPrev');
    const next = document.getElementById('bossNext');
    if (!viewport || !prev || !next) return;

    const overflow = viewport.scrollWidth > viewport.clientWidth + 4;
    prev.hidden = !overflow;
    next.hidden = !overflow;
    if (!overflow) return;

    const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    prev.disabled = viewport.scrollLeft <= 4;
    next.disabled = viewport.scrollLeft >= maxScroll - 4;
  }

  function renderTeam(items) {
    const box = document.getElementById('bossBox');
    const track = document.getElementById('bossTrack');
    if (!box || !track) return;

    if (!items.length) {
      hideBossBox();
      return;
    }

    track.innerHTML = items.map((item, index) => {
      const image = item.image
        ? `<img class="boss-card-photo" src="${esc(item.image)}" alt="${esc(item.name || 'บุคลากร')}" loading="lazy">`
        : '<span class="boss-card-photo boss-card-photo-placeholder"><i class="fa-solid fa-user" aria-hidden="true"></i></span>';

      return `<article class="boss-card" data-boss-index="${index}">
        <div class="boss-card-photo-wrap">${image}</div>
        <div class="boss-card-text">
          <div class="boss-card-name">${esc(item.name || '-')}</div>
          <div class="boss-card-position">${esc(item.position || '')}</div>
        </div>
      </article>`;
    }).join('');

    box.removeAttribute('hidden');
    requestAnimationFrame(() => {
      const viewport = document.getElementById('bossViewport');
      if (viewport) viewport.scrollLeft = 0;
      updateArrows();
    });
  }

  async function fetchTeam() {
    let firstError = null;

    // 1) homefast ใหม่มี team จาก boss!A:D อยู่แล้ว ลดจำนวน request และแสดงเร็วขึ้น
    try {
      if (window.SiteFast?.getHomeFast) {
        const home = await window.SiteFast.getHomeFast();
        const team = normalizeTeam(home?.data?.team || home?.team || []);
        if (team.length) return team;
      }
    } catch (error) {
      firstError = error;
    }

    // 2) อ่าน mode=team โดยตรง
    try {
      if (window.SiteFast?.fetchMode) {
        const result = await window.SiteFast.fetchMode('team', { _t: Date.now() }, { key: '', ttl: 0 });
        const team = normalizeTeam(result);
        if (team.length || result?.success === true) return team;
      }
    } catch (error) {
      firstError = firstError || error;
    }

    // 3) fallback fetch ตรง ไม่ใช้ cache
    const url = TEAM_API_URL + '&_t=' + Date.now();
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (result.success === false) {
      throw new Error(result.message || firstError?.message || 'โหลดข้อมูลบุคลากรไม่สำเร็จ');
    }
    return normalizeTeam(result);
  }

  async function loadTeam() {
    try {
      showBossStatus('กำลังโหลดข้อมูลบุคลากร...');
      const items = await fetchTeam();
      if (!items.length) {
        showBossStatus('ยังไม่มีข้อมูลบุคลากรในชีต boss');
        return;
      }
      renderTeam(items);
    } catch (error) {
      console.error('โหลดข้อมูลบุคลากรไม่สำเร็จ:', error);
      showBossStatus(`โหลดข้อมูลบุคลากรไม่สำเร็จ: ${error?.message || error}`, true);
    }
  }

  function bindCarousel() {
    const viewport = document.getElementById('bossViewport');
    const prev = document.getElementById('bossPrev');
    const next = document.getElementById('bossNext');
    if (!viewport || !prev || !next) return;

    const move = direction => {
      const card = viewport.querySelector('.boss-card');
      const gap = 24;
      const step = card ? card.getBoundingClientRect().width + gap : viewport.clientWidth * 0.8;
      viewport.scrollBy({ left: direction * step, behavior: 'smooth' });
    };

    prev.addEventListener('click', () => move(-1));
    next.addEventListener('click', () => move(1));
    viewport.addEventListener('scroll', () => requestAnimationFrame(updateArrows), { passive: true });
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(updateArrows, 120);
    }, { passive: true });
  }

  function closeBossPopup() {
    const popup = document.getElementById('bossPopup');
    if (!popup) return;
    popup.setAttribute('hidden', '');
    popup.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('boss-popup-open');
  }

  function renderBossPopup(boss) {
    const popup = document.getElementById('bossPopup');
    const image = document.getElementById('bossPopupImage');
    const actions = document.getElementById('bossPopupActions');
    const detail = document.getElementById('bossPopupDetail');
    if (!popup || !image || !actions || !detail) return;

    if (boss.popupMode !== 'block' || !boss.popupImage) {
      closeBossPopup();
      return;
    }

    image.src = boss.popupImage;
    if (boss.popupUrl) {
      detail.href = boss.popupUrl;
      actions.removeAttribute('hidden');
    } else {
      detail.removeAttribute('href');
      actions.setAttribute('hidden', '');
    }

    popup.removeAttribute('hidden');
    popup.setAttribute('aria-hidden', 'false');
    document.body.classList.add('boss-popup-open');
  }

  function bindBossPopupEvents() {
    document.getElementById('bossPopupClose')?.addEventListener('click', closeBossPopup);
    document.getElementById('bossPopup')?.addEventListener('click', event => {
      if (event.target.id === 'bossPopup') closeBossPopup();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeBossPopup();
    });
  }

  async function loadBossPopup() {
    try {
      let result;
      if (window.SiteFast) {
        result = { success: true, boss: await window.SiteFast.homePart('boss') };
      } else {
        const response = await fetch(BOSS_API_URL, { method: 'GET', cache: 'default', credentials: 'omit' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        result = await response.json();
      }
      if (result.success === false) throw new Error(result.message || 'โหลดข้อมูล popup ไม่สำเร็จ');
      const boss = normalizeBoss(result);
      if (!document.getElementById('bossTrack')) renderLegacyBoss(boss);
      renderBossPopup(boss);
    } catch (error) {
      console.warn('โหลด popup ผู้บริหารไม่สำเร็จ:', error);
      closeBossPopup();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindBossPopupEvents();
    if (document.getElementById('bossTrack')) {
      bindCarousel();
      loadTeam();
    }
    loadBossPopup();
  });

  document.addEventListener('team-admin-updated', () => {
    if (window.SiteFast?.clear) window.SiteFast.clear('team');
    loadTeam();
  });
})();

;

/* ===== cliproom-box.js ===== */
(() => {
  'use strict';

  const MAIN_API_URL = (window.SiteFast && window.SiteFast.API_URL) || (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '';
  const EXEC_CACHE_KEY = 'LP360:TAMBOL:SITE_FAST:cliproom-exec-v3';
  const EXEC_CACHE_AGE = 10 * 60 * 1000;
  const CATALOG_CACHE_KEY = 'LP360:TAMBOL:SITE_FAST:cliproom-catalog-v3-dynamic-exec';
  const CATALOG_STALE_AGE = 24 * 60 * 60 * 1000;
  const JSONP_TIMEOUT = 45 * 1000;
  const RETRY_DELAYS = [1000, 1800, 3200, 6000, 10000, 16000, 30000];

  const track = document.getElementById('cliproomTrack');
  if (!track) return;

  let courses = [];
  let page = 0;
  let perPage = 3;
  let timer = null;
  let loadingStarted = false;
  let activeCliproomExecUrl = '';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[char]));

  const cardsPerPage = () => window.innerWidth <= 620 ? 1 : window.innerWidth <= 900 ? 2 : 3;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const retryDelay = attempt => RETRY_DELAYS[Math.min(Math.max(0, attempt - 1), RETRY_DELAYS.length - 1)];

  async function waitRetry(ms) {
    if (navigator.onLine === false) {
      await Promise.race([
        new Promise(resolve => window.addEventListener('online', resolve, { once: true })),
        sleep(Math.max(ms, 15000))
      ]);
      return;
    }
    await sleep(ms);
  }

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
      const callbackName = '__cliproomJsonp_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      let timeoutId = null;
      let settled = false;

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
          if (value !== undefined && value !== null) url.searchParams.set(key, value);
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

  function readExecCache() {
    const saved = storageGet(EXEC_CACHE_KEY, EXEC_CACHE_AGE);
    const url = String(saved?.url || '').trim();
    return /^https:\/\/script\.google\.com\/macros\/s\/[^/?#]+\/exec(?:[?#].*)?$/i.test(url) ? url : '';
  }

  function writeExecCache(url) {
    storageSet(EXEC_CACHE_KEY, { savedAt: Date.now(), url });
  }

  function clearExecCache() {
    storageRemove(EXEC_CACHE_KEY);
  }

  async function resolveCliproomExecUrl(forceFresh = false) {
    const mainApi = String(MAIN_API_URL || '').trim();
    if (!mainApi) throw new Error('ไม่พบ URL ของ Apps Script หลัก');

    if (!forceFresh) {
      const cached = readExecCache();
      if (cached) return cached;
    }

    let attempt = 0;
    while (true) {
      try {
        const result = await jsonpRequest(mainApi, { mode: 'cliproomexec' });
        if (!result || result.success === false) {
          throw new Error((result && result.message) || 'อ่าน URL Cliproom จากชีตไม่สำเร็จ');
        }
        const execUrl = String(result.url || '').trim();
        if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/?#]+\/exec(?:[?#].*)?$/i.test(execUrl)) {
          throw new Error('URL Cliproom จากชีตไม่ถูกต้อง');
        }
        writeExecCache(execUrl);
        return execUrl;
      } catch (error) {
        attempt += 1;
        const delay = retryDelay(attempt);
        console.warn(`Cliproom resolver retry #${attempt}:`, error);
        if (!courses.length) {
          track.innerHTML = `<div class="cliproom-loading"><span class="cliproom-spinner"></span><span>กำลังเชื่อมต่อระบบหลักสูตร...<br><small>ลองใหม่อัตโนมัติ ครั้งที่ ${attempt}</small></span></div>`;
        }
        await waitRetry(delay);
      }
    }
  }

  function render() {
    if (!courses.length) {
      track.innerHTML = '<div class="cliproom-loading">กำลังรอข้อมูลหลักสูตร...</div>';
      const dots = document.getElementById('cliproomDots');
      if (dots) dots.innerHTML = '';
      return;
    }

    track.innerHTML = courses.map(course => `
      <article class="cliproom-card" tabindex="0" role="link" aria-label="เปิดหลักสูตร ${esc(course.title)}">
        <span class="cliproom-cover">
          ${course.coverUrl ? `<img src="${esc(course.coverUrl)}" alt="${esc(course.title)}" loading="lazy" decoding="async">` : ''}
          <span class="cliproom-play" aria-hidden="true">▶</span>
        </span>
        <div class="cliproom-body">
          <h3>${esc(course.title)}</h3>
          <p>${esc(course.description || 'เลือกหลักสูตรเพื่อเริ่มการอบรมออนไลน์')}</p>
        </div>
      </article>
    `).join('');

    track.querySelectorAll('.cliproom-card').forEach(card => {
      card.addEventListener('click', openCliproom);
      card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openCliproom();
        }
      });
    });

    update(true);
  }

  function update(reset) {
    const old = perPage;
    perPage = cardsPerPage();
    if (reset || old !== perPage) page = 0;
    const count = Math.max(1, Math.ceil(courses.length / perPage));
    page = Math.max(0, Math.min(page, count - 1));
    const card = track.querySelector('.cliproom-card');
    if (card) track.style.transform = `translateX(-${page * perPage * (card.getBoundingClientRect().width + 18)}px)`;
    const dots = document.getElementById('cliproomDots');
    if (dots) {
      dots.innerHTML = Array.from({ length: count }, (_, i) =>
        `<button class="cliproom-dot ${i === page ? 'active' : ''}" type="button" data-page="${i}" aria-label="หน้าที่ ${i + 1}"></button>`
      ).join('');
      dots.querySelectorAll('[data-page]').forEach(dot => {
        dot.onclick = event => {
          event.stopPropagation();
          page = Number(dot.dataset.page);
          update(false);
          restart();
        };
      });
    }
    const prev = document.getElementById('cliproomPrev');
    const next = document.getElementById('cliproomNext');
    if (prev) prev.disabled = page === 0;
    if (next) next.disabled = page === count - 1;
  }

  const openCliproom = () => window.open('cliproom.html', '_blank', 'noopener');

  function move(step) {
    const count = Math.max(1, Math.ceil(courses.length / perPage));
    page = (page + step + count) % count;
    update(false);
    restart();
  }

  function restart() {
    clearInterval(timer);
    if (courses.length > perPage) timer = setInterval(() => move(1), 6000);
  }

  function readCatalogCache(execUrl) {
    const saved = storageGet(CATALOG_CACHE_KEY, CATALOG_STALE_AGE);
    if (!saved || saved.execUrl !== execUrl || !saved.payload) return null;
    return saved.payload;
  }

  function writeCatalogCache(payload) {
    storageSet(CATALOG_CACHE_KEY, {
      savedAt: Date.now(),
      execUrl: activeCliproomExecUrl,
      payload
    });
  }

  function receive(payload) {
    if (!payload || payload.success !== true || !Array.isArray(payload.courses)) return false;
    writeCatalogCache(payload);
    courses = payload.courses;
    if (!courses.length) {
      track.innerHTML = '<div class="cliproom-loading">ยังไม่มีหลักสูตรที่เปิดใช้งาน</div>';
      const dots = document.getElementById('cliproomDots');
      if (dots) dots.innerHTML = '';
      return true;
    }
    render();
    restart();
    return true;
  }

  async function fetchCatalog(execUrl) {
    const payload = await jsonpRequest(execUrl, { mode: 'cliproomBox' });
    if (!payload || payload.success !== true || !Array.isArray(payload.courses)) {
      throw new Error((payload && payload.message) || 'ข้อมูลหลักสูตรไม่สมบูรณ์');
    }
    return payload;
  }

  async function loadCatalog() {
    if (loadingStarted) return;
    loadingStarted = true;
    let attempt = 0;
    let cacheShown = false;

    while (true) {
      try {
        activeCliproomExecUrl = await resolveCliproomExecUrl(attempt > 0);

        if (!cacheShown) {
          const cached = readCatalogCache(activeCliproomExecUrl);
          if (cached && receive(cached)) cacheShown = true;
        }

        const payload = await fetchCatalog(activeCliproomExecUrl);
        receive(payload);
        return;
      } catch (error) {
        attempt += 1;
        clearExecCache();
        const delay = retryDelay(attempt);
        console.warn(`Cliproom catalog retry #${attempt}:`, error);
        if (!courses.length) {
          track.innerHTML = `<div class="cliproom-loading"><span class="cliproom-spinner"></span><span>กำลังโหลดรายการหลักสูตร...<br><small>เชื่อมต่อไม่สำเร็จ ระบบจะลองใหม่อัตโนมัติ ครั้งที่ ${attempt}</small></span></div>`;
        }
        await waitRetry(delay);
      }
    }
  }

  window.cliproomCatalogCallback = payload => receive(payload);
  const prev = document.getElementById('cliproomPrev');
  const next = document.getElementById('cliproomNext');
  if (prev) prev.onclick = event => { event.stopPropagation(); move(-1); };
  if (next) next.onclick = event => { event.stopPropagation(); move(1); };
  window.addEventListener('resize', () => update(false));

  if (window.SiteFast) window.SiteFast.whenNear('cliproomBox', loadCatalog, '900px 0px');
  else loadCatalog();
})();

/* ===== shopactivity-box.js ===== */
(() => {
  'use strict';
  const API_URL=window.APP_CONFIG.API_URL;
  const track=document.getElementById('shopActivityTrack');if(!track)return;
  let items=[],page=0,perPage=3,timer=null;
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const openShop=()=>window.open('shopactivity.html','_blank','noopener');
  const cardsPerPage=()=>window.innerWidth<=620?1:window.innerWidth<=900?2:3;
  async function load(){try{let json;if(window.SiteFast){json=await window.SiteFast.fetchMode('learning',{action:'getActivities'},{key:'learning-activities-v1',ttl:120000})}else{const url=new URL(API_URL);url.searchParams.set('mode','learning');url.searchParams.set('action','getActivities');const response=await fetch(url.toString(),{cache:'default'});json=await response.json();if(!response.ok)throw new Error(`HTTP ${response.status}`)}if(json?.success===false)throw new Error(json?.message||'โหลดข้อมูลไม่สำเร็จ');items=Array.isArray(json?.data)?json.data:Array.isArray(json)?json:[];render();restart()}catch(error){track.innerHTML=`<div class="shopactivity-loading">โหลดกิจกรรมไม่สำเร็จ: ${esc(error.message)}</div>`}}
  function render(){if(!items.length){track.innerHTML='<div class="shopactivity-loading">ยังไม่มีกิจกรรม</div>';return}track.innerHTML=items.map(item=>`<article class="shopactivity-card" tabindex="0" role="link" aria-label="เปิดกิจกรรม ${esc(item.title)}"><img class="shopactivity-image" src="${esc(item.image1||'')}" alt="${esc(item.title)}" loading="lazy"><div class="shopactivity-body"><h3>${esc(item.title)}</h3><div class="shopactivity-meta">Point: ${esc(item.hours||'0')} Point</div><div class="shopactivity-meta">รูปแบบ: ${esc(item.learningType||'-')}</div><div class="shopactivity-meta">วันที่: ${esc(item.activityDate||'-')}</div></div></article>`).join('');track.querySelectorAll('.shopactivity-card').forEach(card=>{card.onclick=openShop;card.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openShop()}}});update(true)}
  function update(reset){const old=perPage;perPage=cardsPerPage();if(reset||old!==perPage)page=0;const count=Math.max(1,Math.ceil(items.length/perPage));page=Math.max(0,Math.min(page,count-1));const card=track.querySelector('.shopactivity-card');if(card)track.style.transform=`translateX(-${page*perPage*(card.getBoundingClientRect().width+22)}px)`;const dots=document.getElementById('shopActivityDots');dots.innerHTML=Array.from({length:count},(_,i)=>`<button class="shopactivity-dot ${i===page?'active':''}" type="button" data-page="${i}" aria-label="หน้าที่ ${i+1}"></button>`).join('');dots.querySelectorAll('[data-page]').forEach(dot=>dot.onclick=()=>{page=Number(dot.dataset.page);update(false);restart()});document.getElementById('shopActivityPrev').disabled=page===0;document.getElementById('shopActivityNext').disabled=page===count-1}
  function move(step){const count=Math.max(1,Math.ceil(items.length/perPage));page=(page+step+count)%count;update(false);restart()}function restart(){clearInterval(timer);if(items.length>perPage)timer=setInterval(()=>move(1),6000)}
  document.getElementById('shopActivityPrev').onclick=()=>move(-1);document.getElementById('shopActivityNext').onclick=()=>move(1);window.addEventListener('resize',()=>update(false));if(window.SiteFast)window.SiteFast.whenNear('learningBaseModule',load);else load();
})();

;

/* ===== learning-base.js ===== */

(() => {
  'use strict';

  const API_URL = window.APP_CONFIG.API_URL;
  const TEACHER_URL = API_URL + '?page=teacher';
  let student = JSON.parse(localStorage.getItem('LP360:TAMBOL:LEARN_STUDENT') || 'null');
  let editProfileRemovePhoto = false;
  let activities = [];
  let currentActivityTarget = 'all';
  let hourText = "ชั่วโมง";
  let detailSlideIndex = 0;
  let detailSlideTimer = null;

  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#039;');

  async function callApi(action, data = {}, method = 'POST') {
    let response;
    if (method === 'GET') {
      const url = new URL(API_URL);
      url.searchParams.set('mode', 'learning');
      url.searchParams.set('action', action);
      Object.entries(data).forEach(([key, value]) => url.searchParams.set(key, value ?? ''));
      response = await fetch(url.toString(), { cache: 'no-store' });
    } else {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ mode: 'learning', action, data })
      });
    }
    const text = await response.text();
    let result;
    try { result = JSON.parse(text); }
    catch { throw new Error('API ส่งข้อมูลกลับมาไม่ใช่ JSON'); }
    if (!response.ok || result?.success === false) throw new Error(result?.message || `HTTP ${response.status}`);
    return Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result;
  }

  function showPage(id, btn) {
    const root = $('learningBaseModule');
    if (!root) return;
    root.querySelectorAll(':scope > .learning-container > section').forEach(s => s.classList.add('learning-hidden'));
    $(id)?.classList.remove('learning-hidden');
    root.querySelectorAll('.learning-tabs button').forEach(b => b.classList.remove('active'));
    btn?.classList.add('active');

    // เมื่อกดแท็บ "กิจกรรมทั้งหมด" ให้ยกเลิกตัวกรองกลุ่มเป้าหมาย
    // และแสดงกิจกรรมทุกประเภทใน activityGrid ทันที
    if (id === 'activitiesPage') {
      currentActivityTarget = 'all';
      root.querySelectorAll('.shopactivity-target-btn').forEach(button => {
        const isActive = button.dataset.targetFilter === 'all';
        button.classList.toggle('target-active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      renderActivities(activities);
    }

    if (id === 'historyPage') loadHistory();
  }

  function openStudentModal() {
    const modal = $('studentModal');
    const loginSection = $('loginSection');
    const registerBox = $('registerBox');
    const newBtn = $('newRegisterBtn');
    const logoutBox = $('logoutBox');

    modal.style.display = 'flex';
    registerBox.style.display = 'none';
    loginSection.style.display = 'block';
    clearStudentPhoto();

    if (student) {
      $('loginPhone').value = student.phone || '';
      logoutBox.style.display = 'block';
      if (newBtn) newBtn.style.display = 'none';
    } else {
      $('loginPhone').value = '';
      logoutBox.style.display = 'none';
      if (newBtn) newBtn.style.display = 'inline-block';
    }
  }

  function closeModal(id) {
    const modal = $(id);
    if (modal) modal.style.display = 'none';
    if (id === 'detailModal') clearInterval(detailSlideTimer);
  }

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(String(reader.result || ''));
    };

    reader.onerror = () => {
      reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้'));
    };

    reader.readAsDataURL(file);
  });
}

  function clearStudentPhoto() {
    const input = $('stuPhoto');
    const wrap = $('stuPhotoPreviewWrap');
    const preview = $('stuPhotoPreview');
    if (input) input.value = '';
    if (preview) preview.removeAttribute('src');
    if (wrap) wrap.hidden = true;
  }
function openEditProfile() {
  if (!student) {
    openStudentModal();
    return;
  }

  const modal = $('editProfileModal');
  if (!modal) return;

  editProfileRemovePhoto = false;

  $('editFullname').value = student.fullname || '';
  $('editPhone').value = student.phone || '';
  $('editAddress').value = student.address || '';

  const photoInput = $('editPhoto');
  const previewWrap = $('editPhotoPreviewWrap');
  const preview = $('editPhotoPreview');

  if (photoInput) {
    photoInput.value = '';
  }

  if (student.photo) {
    preview.src = student.photo;
    previewWrap.hidden = false;
  } else {
    preview.removeAttribute('src');
    previewWrap.hidden = true;
  }

  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');

  document.body.style.overflow = 'hidden';

  setTimeout(() => {
    $('editFullname')?.focus();
  }, 0);
}
function closeEditProfile() {
  const modal = $('editProfileModal');

  if (modal) {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }

  document.body.style.overflow = '';

  const photoInput = $('editPhoto');

  if (photoInput) {
    photoInput.value = '';
  }

  editProfileRemovePhoto = false;

  // คืนค่า Profile Popup ให้เป็นสถานะปิด
  window.ProfileBox?.resetProfileBox();
}
  function removeEditProfilePhoto() {
  const input = $('editPhoto');
  const preview = $('editPhotoPreview');
  const wrap = $('editPhotoPreviewWrap');

  editProfileRemovePhoto = true;

  if (input) {
    input.value = '';
  }

  if (preview) {
    preview.removeAttribute('src');
  }

  if (wrap) {
    wrap.hidden = true;
  }
}
  async function saveEditProfile() {
  if (!student?.studentId) {
    closeEditProfile();

    return Swal.fire(
      'แจ้งเตือน',
      'กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
      'warning'
    );
  }

const fullname = $('editFullname')?.value.trim() || '';
const phone = $('editPhone')?.value.trim() || '';
const address = $('editAddress')?.value.trim() || '';

// บังคับเฉพาะชื่อและเบอร์โทร
if (!fullname || !phone) {
  return Swal.fire(
    'แจ้งเตือน',
    'กรุณากรอกชื่อ-นามสกุล และเบอร์โทรให้ครบ',
    'warning'
  );
}

  if (!/^0\d{9}$/.test(phone)) {
    return Swal.fire(
      'แจ้งเตือน',
      'เบอร์โทรต้องขึ้นต้นด้วย 0 และมี 10 หลัก',
      'warning'
    );
  }

  const photoInput = $('editPhoto');
  const photoFile = photoInput?.files?.[0] || null;

  const data = {
    studentId: student.studentId,
    fullname,
    phone,
    address,

    // หากไม่เลือกรูปใหม่ Backend จะเก็บรูปเดิมไว้
    photoBase64: '',
    photoName: '',

    // true เมื่อต้องการลบรูปเดิม
    removePhoto: editProfileRemovePhoto
  };

  if (photoFile) {
    if (!photoFile.type.startsWith('image/')) {
      return Swal.fire(
        'แจ้งเตือน',
        'กรุณาเลือกไฟล์รูปภาพเท่านั้น',
        'warning'
      );
    }

    if (photoFile.size > 5 * 1024 * 1024) {
      return Swal.fire(
        'แจ้งเตือน',
        'รูปภาพต้องมีขนาดไม่เกิน 5 MB',
        'warning'
      );
    }

    try {
      data.photoBase64 = await fileToDataUrl(photoFile);
      data.photoName =
        photoFile.name || `student-${Date.now()}.jpg`;

      // เมื่อเลือกรูปใหม่ ไม่ต้องลบรูป
      data.removePhoto = false;

    } catch (error) {
      return Swal.fire(
        'ผิดพลาด',
        error.message,
        'error'
      );
    }
  }

  const saveButton = $('saveEditProfileBtn');

  try {
    if (saveButton) {
      saveButton.disabled = true;
    }

    Swal.fire({
      title: 'กำลังบันทึกข้อมูล',
      text: photoFile
        ? 'กำลังอัปโหลดรูปภาพใหม่'
        : 'กรุณารอสักครู่...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    const res = await callApi(
      'updateStudentProfile',
      data
    );

    Swal.close();

    if (!res.ok) {
      return Swal.fire(
        'แจ้งเตือน',
        res.message || 'ไม่สามารถบันทึกข้อมูลได้',
        'warning'
      );
    }

    student = res.student;

    localStorage.setItem(
      'LP360:TAMBOL:LEARN_STUDENT',
      JSON.stringify(student)
    );

    closeEditProfile();

    // อัปเดตชื่อ รูป ชั่วโมง และข้อมูลบน Profile Box
    updateTop();

    await Swal.fire(
      'สำเร็จ',
      res.message || 'บันทึกข้อมูลเรียบร้อยแล้ว',
      'success'
    );

  } catch (error) {
    Swal.close();

    Swal.fire(
      'ผิดพลาด',
      error.message,
      'error'
    );

  } finally {
    if (saveButton) {
      saveButton.disabled = false;
    }
  }
}
  function triggerMobileProfilePhotoEffect() {
    const photo = $('mobileProfilePhoto');
    if (!photo) return;

    // ลบคลาสก่อนเพื่อให้เรียก effect ซ้ำได้ทุกครั้ง
    photo.classList.remove('profile-login-success-effect');
    void photo.offsetWidth;
    photo.classList.add('profile-login-success-effect');

    const cleanup = () => {
      photo.classList.remove('profile-login-success-effect');
      photo.removeEventListener('animationend', cleanup);
    };

    photo.addEventListener('animationend', cleanup);
    setTimeout(cleanup, 1800);
  }

  async function registerStudent() {
    const photoInput = $('stuPhoto');
    const photoFile = photoInput?.files?.[0] || null;

    const data = {
      fullname: $('stuFullname').value.trim(),
      phone: $('stuPhone').value.trim(),
      address: $('stuAddress').value.trim(),
      photoBase64: '',
      photoName: ''
    };

    if (!data.fullname || !data.phone || !data.address)
      return Swal.fire('แจ้งเตือน','กรุณากรอก ชื่อ-นามสกุล เบอร์โทร และที่อยู่ ให้ครบ','warning');
    if (!/^0\d{9}$/.test(data.phone))
      return Swal.fire('แจ้งเตือน','เบอร์โทรต้องขึ้นต้นด้วย 0 และมี 10 หลัก','warning');

    if (photoFile) {
      if (!photoFile.type.startsWith('image/')) {
        return Swal.fire('แจ้งเตือน','กรุณาเลือกไฟล์รูปภาพเท่านั้น','warning');
      }
      if (photoFile.size > 5 * 1024 * 1024) {
        return Swal.fire('แจ้งเตือน','รูปภาพต้องมีขนาดไม่เกิน 5 MB','warning');
      }
      data.photoBase64 = await fileToDataUrl(photoFile);
      data.photoName = photoFile.name || `student-${Date.now()}.jpg`;
    }

    try {
      Swal.fire({
        title: 'กำลังลงทะเบียน',
        text: photoFile ? 'กำลังอัปโหลดรูปภาพ' : 'กรุณารอสักครู่...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
      });
      const res = await callApi('registerStudent', data);
      Swal.close();

      if (!res.ok || !res.student) {
        return Swal.fire('แจ้งเตือน', res.message || 'ลงทะเบียนไม่สำเร็จ', 'warning');
      }

      // แจ้งลงทะเบียนสำเร็จ 2 วินาที และปิดอัตโนมัติ ไม่ต้องกด OK
      await Swal.fire({
        icon: 'success',
        title: 'สำเร็จ',
        text: res.message || 'ลงทะเบียนสำเร็จ',
        timer: 2000,
        timerProgressBar: true,
        showConfirmButton: false,
        allowOutsideClick: false,
        allowEscapeKey: false
      });

      // ถือว่าลงทะเบียนสำเร็จ = เข้าสู่ระบบทันที
      student = res.student;
      localStorage.setItem('LP360:TAMBOL:LEARN_STUDENT', JSON.stringify(student));
      closeModal('studentModal');
      clearStudentPhoto();
      updateTop();

      // แจ้งสถานะเข้าสู่ระบบ 1 วินาที แล้วปิดอัตโนมัติ
      await Swal.fire({
        icon: 'success',
        title: 'เข้าสู่ระบบแล้ว',
        timer: 1000,
        showConfirmButton: false,
        allowOutsideClick: false,
        allowEscapeKey: false
      });

      // เน้นรูปโปรไฟล์หลัง Popup ปิด เพื่อให้ผู้ใช้เห็นตำแหน่งบัญชีของตนชัดเจน
      triggerMobileProfilePhotoEffect();
    } catch(err) { Swal.close(); Swal.fire('ผิดพลาด',err.message,'error'); }
  }

  async function studentLogin() {
    try {
      Swal.showLoading();
      const res = await callApi('studentLogin', { phone: $('loginPhone').value.trim() });
      Swal.close();
      if (!res.ok) return Swal.fire('แจ้งเตือน',res.message,'warning');
      student = res.student;
      localStorage.setItem('LP360:TAMBOL:LEARN_STUDENT',JSON.stringify(student));
      closeModal('studentModal'); updateTop();
      Swal.fire('สำเร็จ',res.message,'success');
    } catch(err) { Swal.close(); Swal.fire('ผิดพลาด',err.message,'error'); }
  }

  async function loadActivities() {
    const grid = $('activityGrid');
    if (!grid) return;
    grid.innerHTML='กำลังโหลด...';
    try {
      activities = await callApi('getActivities', {}, 'GET') || [];
      renderActivities(getFilteredActivitiesByTarget());
    } catch(err) { grid.innerHTML=`<div class="learning-list-item">โหลดกิจกรรมไม่สำเร็จ: ${escapeHtml(err.message)}</div>`; }
  }

function renderActivities(list) {
  const grid = $('activityGrid');

  if (!list.length) {
    grid.innerHTML = '<div class="learning-list-item">ยังไม่มีกิจกรรม</div>';
    return;
  }

  grid.innerHTML = list.map(a => `
    <article class="learning-card shopactivity-card">

      <div class="learning-card-image-wrap">
        <img
          src="${escapeHtml(a.image1 || 'https://placehold.co/600x400?text=Activity')}"
          alt="${escapeHtml(a.title || 'กิจกรรม')}"
          class="learning-card-image"
          role="button"
          tabindex="0"
          title="คลิกเพื่อดูรายละเอียด"
          onclick="LearningBase.openActivityDetail('${escapeHtml(a.activityId)}')"
          onkeydown="if(event.key==='Enter'){LearningBase.openActivityDetail('${escapeHtml(a.activityId)}')}"
          onerror="this.onerror=null;this.src='https://placehold.co/600x400?text=Activity';"
        >
        <div class="learning-point-badge">${escapeHtml(a.hours || '0')} Point</div>
      </div>

      <div class="learning-card-body">

        <h3 class="learning-card-title">
          ${escapeHtml(a.title || '-')}
        </h3>

        <div class="learning-card-meta-line">
          สำหรับ - ${escapeHtml(a.learningType || '-')}
        </div>

        <div class="learning-card-meta-line">
          วันที่จัดกิจกรรม : ${formatThaiDate(a.activityDate)}
        </div>

        <div class="learning-card-meta-line">
          สถานที่ : ${escapeHtml(a.location || '-')}
        </div>

      </div>

      <button
        type="button"
        class="learning-card-cart-btn"
        onclick="LearningBase.addToCart('${escapeHtml(a.activityId)}')"
      >
        <i class="fa fa-shopping-bag"></i>
        ใส่ตะกร้า
      </button>

    </article>
  `).join('');
}
  function requireStudent() {
    if (student) return true;
    Swal.fire('กรุณายืนยันตัวตน','กดปุ่ม Login ก่อนเลือกกิจกรรม','warning');
    openStudentModal(); return false;
  }

  async function addToCart(activityId) {
    if (!requireStudent()) return;
    try {
      Swal.showLoading();
      const res=await callApi('addToCart',{studentId:student.studentId,activityId});
      Swal.close(); Swal.fire(res.ok?'สำเร็จ':'แจ้งเตือน',res.message,res.ok?'success':'warning');
      loadCartCount();
    } catch(err) { Swal.close(); Swal.fire('ผิดพลาด',err.message,'error'); }
  }

  async function openCart() {
    if (!requireStudent()) return;
    $('cartModal').style.display='flex'; $('cartList').innerHTML='กำลังโหลด...';
    try {
      const list=await callApi('getMyCart',{studentId:student.studentId},'GET') || [];
      if (!list.length) return $('cartList').innerHTML='<div class="learning-list-item">ยังไม่มีกิจกรรมในตะกร้า</div>';
      const total=list.reduce((s,c)=>s+getActivityHours(c.activity),0);
      $('cartList').innerHTML=`<div class="learning-cart-summary"><b>รวมทั้งหมด ${total} ${escapeHtml(hourText)}</b></div>`+
      list.map(c=>`<div class="learning-cart-item">

    <img
        class="learning-cart-image"
        src="${escapeHtml(c.activity?.image1 || 'https://placehold.co/300x200?text=Activity')}"
        alt="${escapeHtml(c.activity?.title || 'กิจกรรม')}"
        loading="lazy"
        onerror="this.onerror=null;this.src='https://placehold.co/300x200?text=Activity';">

    <div class="learning-cart-info">
        <div class="learning-cart-title">
            ${escapeHtml(c.activity?.title||'-')}
        </div>

        <span class="learning-muted">
            ${escapeHtml(hourText)}: ${getActivityHours(c.activity)} ${escapeHtml(hourText)}
        </span><br>

        <span class="learning-muted">
            วันที่ ${formatThaiDate(c.activity?.activityDate)}
        </span>

        <div class="learning-cart-actions">
            <button class="btn-green learning-confirm-btn"
                onclick="LearningBase.confirmJoin('${escapeHtml(c.activityId)}')">
                ยืนยันเข้าร่วม
            </button>

            <button class="btn-red learning-delete-btn"
                onclick="LearningBase.cancelCartItem('${escapeHtml(c.cartId)}')">
                ลบ
            </button>
        </div>
    </div>

</div>`).join('');
    } catch(err) { $('cartList').innerHTML=`<div class="learning-list-item">${escapeHtml(err.message)}</div>`; }
  }

async function loadCartCount() {

  const profileCartBtn = $('profileCartBtn');

  if (!student) {
    if (profileCartBtn) {
      profileCartBtn.innerHTML =
        '<i class="fa fa-shopping-cart"></i> 0 ตะกร้า';
    }
    return;
  }

  try {

    const list = await callApi(
      'getMyCart',
      {
        studentId: student.studentId
      },
      'GET'
    );

    const count = (list || []).length;

    if (profileCartBtn) {
      profileCartBtn.innerHTML =
        `<i class="fa fa-shopping-cart"></i> ${count} ตะกร้า`;
    }

  } catch (error) {

    if (profileCartBtn) {
      profileCartBtn.innerHTML =
        '<i class="fa fa-shopping-cart"></i> 0 ตะกร้า';
    }

  }

}

  async function confirmJoin(activityId) {
    if (!requireStudent()) return;
    try {
      Swal.showLoading(); const res=await callApi('confirmJoin',{studentId:student.studentId,activityId});
      Swal.close(); await Swal.fire(res.ok?'สำเร็จ':'แจ้งเตือน',res.message,res.ok?'success':'warning');
      loadCartCount(); if ($('cartModal').style.display==='flex') openCart();
    } catch(err) { Swal.close(); Swal.fire('ผิดพลาด',err.message,'error'); }
  }

  async function loadHistory() {
    if (!requireStudent()) return;
    $('historyList').innerHTML='กำลังโหลด...';
    try {
      const list=await callApi('getMyHistory',{studentId:student.studentId},'GET')||[];
      $('historyList').innerHTML=list.length?list.map(h=>`<div class="learning-list-item"><b>${escapeHtml(h.activity?.title||'-')}</b><br><span class="learning-muted">ฐาน ${escapeHtml(h.activity?.baseNo||'-')} | วันที่ ${formatThaiDate(h.activity?.activityDate)}</span><br><span class="learning-tag">ยืนยันแล้ว</span></div>`).join(''):'<div class="learning-list-item">ยังไม่มีประวัติการยืนยันกิจกรรม</div>';
    } catch(err) { $('historyList').innerHTML=`<div class="learning-list-item">${escapeHtml(err.message)}</div>`; }
  }

  async function cancelCartItem(cartId) {
    const result=await Swal.fire({title:'ยืนยันการยกเลิก?',text:'ต้องการลบกิจกรรมนี้ออกจากตะกร้าหรือไม่',icon:'warning',showCancelButton:true,confirmButtonText:'ใช่, ยกเลิก',cancelButtonText:'ไม่'});
    if (!result.isConfirmed) return;
    try { Swal.showLoading(); const res=await callApi('cancelCart',{cartId}); Swal.close(); await Swal.fire(res.ok?'สำเร็จ':'แจ้งเตือน',res.message,res.ok?'success':'warning'); openCart(); loadCartCount(); }
    catch(err) { Swal.close(); Swal.fire('ผิดพลาด',err.message,'error'); }
  }

  function showRegisterBox() {
    $('studentModal').style.display = 'flex';
    $('loginSection').style.display = 'none';
    $('logoutBox').style.display = 'none';
    $('registerBox').style.display = 'block';
    clearStudentPhoto();
    setTimeout(() => $('stuFullname')?.focus(), 0);
  }

  function openActivityDetail(activityId) {
    const a=activities.find(x=>x.activityId===activityId);
    if(!a) return Swal.fire('แจ้งเตือน','ไม่พบข้อมูลกิจกรรม','warning');
    const images=[a.image1,a.image2,a.image3].filter(Boolean);
    const slider=images.length?`<div class="detail-slider">${images.map((img,i)=>`<div class="detail-slide ${i===0?'active':''}"><img src="${escapeHtml(img)}" alt=""></div>`).join('')}</div><div class="detail-dots">${images.map((_,i)=>`<span class="detail-dot ${i===0?'active':''}"></span>`).join('')}</div>`:'';
    
    
$('detailContent').innerHTML = `
  ${slider}

  <div class="detail-info">

    <h2>${escapeHtml(a.title || '-')}</h2>

    <div class="line">
      <b>Point :</b>
      ${escapeHtml(a.hours || '0')}
    </div>

    <div class="line">
      <b>กิจกรรมสำหรับ :</b>
      ${escapeHtml(a.learningType || '-')}
    </div>

    <div class="line">
      <b>รายละเอียดกิจกรรม :</b>
      ${escapeHtml(a.detail || '-')}
    </div>

    <div class="line">
      <b>คุณสมบัติ :</b>
      ${escapeHtml(a.qualification || '-')}
    </div>

    <div class="line">
      <b>วันที่จัดกิจกรรม :</b>
      ${formatThaiDate(a.activityDate)}
    </div>

  </div>
`;
    $('detailAddCartBtn').onclick=()=>addToCart(activityId); $('detailModal').style.display='flex'; startDetailSlider();
  }
function updateTop() {
  const accountBtn = $('accountBtn');
  const scoreBadge = $('studentScoreBadge');

  if (accountBtn) {
    accountBtn.textContent = student
      ? `👤 ${student.fullname}`
      : 'Login';
  }

  if (!student && scoreBadge) {
    scoreBadge.hidden = true;
    scoreBadge.textContent = 'คะแนนรวม 0/0';
  }
document.addEventListener('change', event => {
  if (event.target?.id !== 'editPhoto') return;

  const file = event.target.files?.[0];
  const wrap = $('editPhotoPreviewWrap');
  const preview = $('editPhotoPreview');

  if (!file) return;

  if (!file.type.startsWith('image/')) {
    event.target.value = '';

    Swal.fire(
      'แจ้งเตือน',
      'กรุณาเลือกไฟล์รูปภาพเท่านั้น',
      'warning'
    );

    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    event.target.value = '';

    Swal.fire(
      'แจ้งเตือน',
      'รูปภาพต้องมีขนาดไม่เกิน 5 MB',
      'warning'
    );

    return;
  }

  editProfileRemovePhoto = false;

  const objectUrl = URL.createObjectURL(file);

  preview.src = objectUrl;

  preview.onload = () => {
    URL.revokeObjectURL(objectUrl);
  };

  wrap.hidden = false;
});
  window.dispatchEvent(
    new CustomEvent('LEARN_AUTH_CHANGED', {
      detail: {
        student: student || null
      }
    })
  );

  loadMyTotalHours();
  loadCartCount();
}
  function startDetailSlider() {
    clearInterval(detailSlideTimer); detailSlideIndex=0;
    const slides=document.querySelectorAll('#detailModal .detail-slide'),dots=document.querySelectorAll('#detailModal .detail-dot');
    if(slides.length<=1)return;
    detailSlideTimer=setInterval(()=>{slides[detailSlideIndex].classList.remove('active');dots[detailSlideIndex]?.classList.remove('active');detailSlideIndex=(detailSlideIndex+1)%slides.length;slides[detailSlideIndex].classList.add('active');dots[detailSlideIndex]?.classList.add('active');},2500);
  }

  function getFilteredActivitiesByTarget() {
    if (currentActivityTarget === 'all') return activities;

    return activities.filter(a => {
      const type = String(a?.learningType || '').trim();
      if (currentActivityTarget === 'public') return type.includes('ประชาชน');
      return type.includes('นักศึกษา');
    });
  }

  function filterActivitiesByTarget(target, btn) {
    currentActivityTarget = ['all', 'student', 'public'].includes(target) ? target : 'all';

    document.querySelectorAll('.shopactivity-target-btn').forEach(button => {
      const isActive = button.dataset.targetFilter === currentActivityTarget;
      button.classList.toggle('target-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    renderActivities(getFilteredActivitiesByTarget());
  }
  function getActivityHours(a) { return Number(a?.hours||a?.['ชั่วโมง']||a?.hour||0); }
  function formatThaiDate(value) { if(!value)return'-';const d=new Date(value);if(isNaN(d))return escapeHtml(value);return d.toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'}); }

async function loadMyTotalHours() {
  const scoreBtn = $('scoreBtn');

  if (!scoreBtn) return;

  if (!student) {
    scoreBtn.textContent = `รวม 0 ${hourText}`;
    return;
  }

  try {
    const total = await callApi(
      'getStudentTotalHours',
      {
        studentId: student.studentId
      },
      'GET'
    );

    scoreBtn.textContent =
      `รวม ${total || 0} ${hourText}`;

  } catch (error) {
    scoreBtn.textContent = `รวม 0 ${hourText}`;
  }
}
  async function openScoreModal() {
    if(!requireStudent())return;
    try{Swal.showLoading();const res=await callApi('getMyScoreDetail',{studentId:student.studentId},'GET');Swal.close();const list=res.list||[],total=res.total||0;if(!list.length)return Swal.fire(`${hourText}สะสม`,`ยังไม่มีรายการ${hourText}ที่ได้รับ`,'info');const html=`<div style="text-align:left"><h3>รวมทั้งหมด ${total} ${escapeHtml(hourText)}</h3><table style="width:100%;border-collapse:collapse"><tbody>${list.map(x=>`<tr><td style="padding:8px;border:1px solid #ddd">${escapeHtml(x.title)}</td><td style="padding:8px;border:1px solid #ddd">${escapeHtml(x.baseNo)}</td><td style="padding:8px;border:1px solid #ddd">${escapeHtml(x.actualHours)}</td></tr>`).join('')}</tbody></table></div>`;Swal.fire({title:`รายการ${hourText}ที่ได้รับ`,html,width:800,confirmButtonText:'ปิด'});}catch(err){Swal.close();Swal.fire('ผิดพลาด',err.message,'error');}
  }

  function logoutFromEditProfile() {
    Swal.fire({
      title:'ออกจากระบบ?',
      text:'คุณต้องการออกจากระบบใช่หรือไม่',
      icon:'warning',
      showCancelButton:true,
      confirmButtonText:'ออกจากระบบ',
      cancelButtonText:'ยกเลิก',
      confirmButtonColor:'#ef4444',
      reverseButtons:true
    }).then(r=>{
      if(!r.isConfirmed)return;
      student=null;
      localStorage.removeItem('LP360:TAMBOL:LEARN_STUDENT');
      closeEditProfile();
      closeModal('studentModal');
      updateTop();
      const root=$('learningBaseModule');
      if(root)showPage('activitiesPage',root.querySelector('.learning-tabs button'));
    });
  }

  function closeStudentModal() {
    Swal.fire({title:'ออกจากระบบ?',icon:'warning',showCancelButton:true,confirmButtonText:'ออกจากระบบ',cancelButtonText:'ยกเลิก'}).then(r=>{if(!r.isConfirmed)return;student=null;localStorage.removeItem('LP360:TAMBOL:LEARN_STUDENT');closeModal('studentModal');updateTop();showPage('activitiesPage',$('learningBaseModule').querySelector('.learning-tabs button'));});
  }


  document.addEventListener('change', event => {
    if (event.target?.id !== 'stuPhoto') return;
    const file = event.target.files?.[0];
    const wrap = $('stuPhotoPreviewWrap');
    const preview = $('stuPhotoPreview');

    if (!file) {
      clearStudentPhoto();
      return;
    }
    if (!file.type.startsWith('image/')) {
      clearStudentPhoto();
      Swal.fire('แจ้งเตือน','กรุณาเลือกไฟล์รูปภาพเท่านั้น','warning');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      clearStudentPhoto();
      Swal.fire('แจ้งเตือน','รูปภาพต้องมีขนาดไม่เกิน 5 MB','warning');
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    preview.src = objectUrl;
    preview.onload = () => URL.revokeObjectURL(objectUrl);
    wrap.hidden = false;
  });

  function updateHourText() {
    const label = $('profileHoursLabel');
    if (label) label.textContent = `${hourText}`;
  }

  async function loadSetting() {
    try {
      let json;
      if (window.SiteFast) {
        json = { success: true, data: await window.SiteFast.homePart('setting') };
      } else {
        const url = new URL(API_URL);
        url.searchParams.set('mode', 'setting');
        const response = await fetch(url.toString(), { cache: 'default' });
        json = await response.json();
      }
      if (json?.success !== false) {
        const setting = json?.data || json || {};
        hourText = String(setting?.hourText || 'ชั่วโมง').trim() || 'ชั่วโมง';

        const headerImageUrl = String(
          setting?.headerImage ||
          setting?.headerImageUrl ||
          setting?.shopActivityHeaderImage ||
          setting?.shopHeaderImage ||
          setting?.settingB3 ||
          setting?.b3 ||
          ''
        ).trim();
        const headerImage = $('shopActivityHeaderImage');

        if (headerImage && headerImageUrl) {
          headerImage.onload = () => { headerImage.hidden = false; };
          headerImage.onerror = () => {
            headerImage.hidden = true;
            headerImage.removeAttribute('src');
          };
          headerImage.src = headerImageUrl;
        } else if (headerImage) {
          headerImage.hidden = true;
          headerImage.removeAttribute('src');
        }
      }
    } catch (error) {
      console.error('loadSetting error:', error);
    }
    updateHourText();
  }

 window.LearningBase = {
  showPage,
  openStudentModal,
  closeModal,
  registerStudent,
  studentLogin,
  loadActivities,
  addToCart,
  openCart,
  confirmJoin,
  loadHistory,
  cancelCartItem,
  showRegisterBox,
  openActivityDetail,
  filterActivitiesByTarget,
  openScoreModal,
  closeStudentModal,
  clearStudentPhoto,
  getHourText: () => hourText,

  // ระบบแก้ไขโปรไฟล์ใหม่
  openEditProfile,
  closeEditProfile,
  removeEditProfilePhoto,
  saveEditProfile,
  logoutFromEditProfile
};
document.addEventListener('DOMContentLoaded', async () => {
  const teacherLink = $('teacherPageLink');

  if (teacherLink) {
    teacherLink.href = TEACHER_URL;
  }

  await loadSetting();

  try {
    updateTop();
  } catch (error) {
    console.error('updateTop error:', error);
  }

  loadActivities();
});
})();

;

/* ===== profile-box.js ===== */
(() => {
  'use strict';

  const API_URL =
    window.APP_CONFIG.API_URL;

  const FALLBACK_PHOTO =
    'https://static.wixstatic.com/media/a503e5_9064df4bf13044dab24382c889fa7d87~mv2.png';

  const $ = id => document.getElementById(id);

  function getStudent() {
    try {
      return JSON.parse(
        localStorage.getItem('LP360:TAMBOL:LEARN_STUDENT') || 'null'
      );
    } catch (_) {
      return null;
    }
  }

  function safePhoto(url) {
    const value = String(url || '').trim();
    return value || FALLBACK_PHOTO;
  }

  async function getTotalHours(studentId) {
    if (!studentId) return 0;

    const url = new URL(API_URL);
    url.searchParams.set('mode', 'learning');
    url.searchParams.set('action', 'getStudentTotalHours');
    url.searchParams.set('studentId', studentId);
    url.searchParams.set('_t', Date.now());

    const response = await fetch(url.toString(), {
      cache: 'no-store'
    });
    const result = await response.json();

    if (!response.ok || result?.success === false) {
      throw new Error(
        result?.message || 'โหลดข้อมูลกิจกรรมไม่สำเร็จ'
      );
    }

    const value = Object.prototype.hasOwnProperty.call(
      result,
      'data'
    )
      ? result.data
      : result;

    return Number(value) || 0;
  }

  async function renderProfile(studentOverride) {
    const student =
      studentOverride === undefined
        ? getStudent()
        : studentOverride;

    const photo = $('mobileProfilePhoto');
    const hours = $('mobileProfileHours');
    const hoursLabel = $('mobileProfileHoursLabel');

    if (!photo || !hours) return;

    photo.onerror = () => {
      photo.onerror = null;
      photo.src = FALLBACK_PHOTO;
    };

    if (hoursLabel) {
      hoursLabel.textContent = 'Point';
    }

    if (!student) {
      photo.src = FALLBACK_PHOTO;
      photo.alt = 'เข้าสู่ระบบ';
      photo.title = 'เข้าสู่ระบบ';
      hours.textContent = '0';
      return;
    }

    const studentPhoto =
      student.photo ||
      student.photoUrl ||
      student.image ||
      student.imageUrl ||
      '';

    const studentName =
      student.fullname ||
      student.fullName ||
      student.name ||
      'สมาชิก';

    const studentId =
      student.studentId ||
      student.studentID ||
      student.id ||
      '';

    photo.src = safePhoto(studentPhoto);
    photo.alt = studentName;
    photo.title = studentName;
    hours.textContent = '...';

    if (!studentId) {
      hours.textContent = '0';
      return;
    }

    try {
      const totalHours = await getTotalHours(studentId);
      hours.textContent = String(totalHours || 0);
    } catch (error) {
      console.error('โหลด Point ไม่สำเร็จ:', error);
      hours.textContent = '0';
    }
  }

  function openAccount() {
    const currentStudent = getStudent();

    if (!currentStudent) {
      window.LearningBase?.openStudentModal?.();
      return;
    }

    window.LearningBase?.openEditProfile?.();
  }

  function openCart() {
    window.LearningBase?.openCart?.();
  }

  function openScore() {
    window.LearningBase?.openScoreModal?.();
  }

  function activateWithKeyboard(event, callback) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      callback();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const photo = $('mobileProfilePhoto');
    const point = $('mobileProfilePoint');

    $('profileCartBtn')?.addEventListener('click', openCart);

    photo?.addEventListener('click', openAccount);
    photo?.addEventListener('keydown', event => {
      activateWithKeyboard(event, openAccount);
    });

    point?.addEventListener('click', openScore);
    point?.addEventListener('keydown', event => {
      activateWithKeyboard(event, openScore);
    });

    renderProfile();
  });

  window.addEventListener('LEARN_AUTH_CHANGED', event => {
    const newStudent = event.detail?.student || getStudent();
    renderProfile(newStudent);
  });

  window.addEventListener('storage', event => {
    if (event.key === 'LP360:TAMBOL:LEARN_STUDENT') {
      renderProfile();
    }
  });

  window.ProfileBox = {
    renderProfile,
    resetProfileBox() {},
    hideProfileBox() {}
  };
})();

;
