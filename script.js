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
    <span class="hero-image-progress-label">Loading...</span>
    <progress class="hero-image-progress-bar" max="100" value="0"></progress>
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

function showHeroOverlayProgress(overlay) {
  const state = getHeroOverlayProgressState(overlay);
  if (!state) return;

  if (state.timer) clearInterval(state.timer);
  if (state.hideTimer) clearTimeout(state.hideTimer);

  state.value = 14;
  state.progress.value = state.value;
  state.wrap.hidden = false;

  state.timer = setInterval(() => {
    state.value = Math.min(92, state.value + (state.value < 50 ? 7 : state.value < 75 ? 4 : 2));
    state.progress.value = state.value;
    if (state.value >= 92) {
      clearInterval(state.timer);
      state.timer = null;
    }
  }, 130);
}

function finishHeroOverlayProgress(overlay) {
  const state = getHeroOverlayProgressState(overlay);
  if (!state) return;

  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  if (state.hideTimer) clearTimeout(state.hideTimer);

  state.value = 100;
  state.progress.value = 100;

  state.hideTimer = setTimeout(() => {
    state.wrap.hidden = true;
  }, 320);
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

    showHeroOverlayProgress(overlay);

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
      finishHeroOverlayProgress(overlay);
    };

    heroImage.onerror = () => {
      overlay.classList.add('website-hero-ready');
      finishHeroOverlayProgress(overlay);
    };

    heroImage.src = heroFastUrl;
  }
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
