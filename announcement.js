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
