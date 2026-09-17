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
