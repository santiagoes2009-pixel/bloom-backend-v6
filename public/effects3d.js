// ============================================================================
// BLOOM BEAUTY v6 - MOTOR ULTRA-FLUIDO DE PRECARGA, ANIMACIONES BIDIRECCIONALES
// AL HACER SCROLL (BAJAR Y SUBIR), TIPOGRAFÍA CINÉTICA 60FPS & EFECTOS 3D
// ============================================================================

(function () {
  'use strict';

  let ioInstance = null;
  let mutationDebounceTimer = null;

  // Inicializar barra de progreso y preloader lo antes posible
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootBloomFX);
  } else {
    bootBloomFX();
  }

  function bootBloomFX() {
    initBloomPreloader();
    initOrbsBackground();
    initScrollProgressAndTopBtn();
    initHeroTilt3D();
    initBidirectionalScrollEngine();
    initCardsInteractive3D();
    initUrgencyCountdown();
    // initLiveSocialProofEngine(); // Desactivado por solicitud: notificaciones falsas de compra eliminadas
    patchImageFallbacks();
  }

  // --------------------------------------------------------------------------
  // 1. PANTALLA DE CARGA DE LUJO CON PRECARGA INTELIGENTE DE ACTIVOS CRÍTICOS
  // --------------------------------------------------------------------------
  function initBloomPreloader() {
    const preloader = document.getElementById('bloom-preloader');
    const bar = document.getElementById('preloader-progress-bar');
    const statusLabel = document.getElementById('preloader-status-label');

    if (!preloader) {
      document.body.classList.add('bloom-loaded');
      return;
    }

    if (bar) bar.style.width = '100%';
    if (statusLabel) statusLabel.textContent = '¡Bienvenida!';

    // Ocultar preloader inmediatamente para entrada instantánea sin demoras
    preloader.classList.add('preloader-hidden');
    preloader.style.opacity = '0';
    preloader.style.pointerEvents = 'none';
    document.body.classList.add('bloom-loaded');
    refreshScrollAnimations();

    setTimeout(() => {
      if (preloader && preloader.parentNode) {
        preloader.style.display = 'none';
      }
    }, 120);
  }

  // --------------------------------------------------------------------------
  // 2. ESFERAS DIFUSAS DECORATIVAS DE LUZ DORADA Y MOKA
  // --------------------------------------------------------------------------
  function initOrbsBackground() {
    if (document.querySelector('.bloom-floating-orb')) return;
    const orb1 = document.createElement('div');
    orb1.className = 'bloom-floating-orb orb-1';
    const orb2 = document.createElement('div');
    orb2.className = 'bloom-floating-orb orb-2';
    const orb3 = document.createElement('div');
    orb3.className = 'bloom-floating-orb orb-3';
    document.body.prepend(orb1, orb2, orb3);
  }

  // --------------------------------------------------------------------------
  // 3. PROGRESO DE SCROLL 60FPS + DIRECCIÓN (BAJAR / SUBIR) + VOLVER ARRIBA
  // --------------------------------------------------------------------------
  function initScrollProgressAndTopBtn() {
    let progressEl = document.getElementById('bloom-scroll-progress');
    if (!progressEl) {
      progressEl = document.createElement('div');
      progressEl.id = 'bloom-scroll-progress';
      progressEl.className = 'bloom-scroll-progress';
      document.body.appendChild(progressEl);
    }

    let topBtn = document.getElementById('bloom-back-to-top');
    if (!topBtn) {
      topBtn = document.createElement('button');
      topBtn.id = 'bloom-back-to-top';
      topBtn.type = 'button';
      topBtn.className = 'bloom-back-to-top';
      topBtn.setAttribute('aria-label', 'Volver al inicio');
      topBtn.title = 'Subir suavemente al inicio';
      topBtn.innerHTML = '↑';
      topBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      document.body.appendChild(topBtn);
    }

    let lastY = window.scrollY || 0;
    let ticking = false;

    const updateOnFrame = () => {
      const y = window.scrollY || window.pageYOffset || 0;
      const docHeight = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const ratio = Math.min(1, Math.max(0, y / docHeight));

      progressEl.style.transform = `scaleX(${ratio.toFixed(4)})`;

      if (Math.abs(y - lastY) > 3) {
        document.documentElement.dataset.scrollDir = y > lastY ? 'down' : 'up';
        lastY = y;
      }

      if (y > 460) {
        topBtn.classList.add('visible');
      } else {
        topBtn.classList.remove('visible');
      }

      ticking = false;
    };

    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(updateOnFrame);
        ticking = true;
      }
    }, { passive: true });

    updateOnFrame();
  }

  // --------------------------------------------------------------------------
  // 4. MOTOR DE ANIMACIÓN BIDIRECCIONAL (IZQUIERDA / DERECHA AL BAJAR Y SUBIR)
  // --------------------------------------------------------------------------
  function applyKineticWords(headingEl) {
    if (!headingEl) return;
    // Evitar tocar elementos con hijos complejos (botones, gradientes clip-text, iconos anidados)
    if (headingEl.children.length > 0 && !headingEl.dataset.bbKineticApplied) {
      return;
    }

    const currentPlain = (headingEl.dataset.bbKineticRaw || headingEl.textContent || '').trim();
    if (!currentPlain) return;

    // Si el texto cambió dinámicamente (ej. desde Panel Admin), actualizar base
    const visiblePlain = (headingEl.textContent || '').replace(/\s+/g, ' ').trim();
    const rawToUse = (headingEl.dataset.bbKineticApplied && visiblePlain && visiblePlain !== headingEl.dataset.bbKineticRaw)
      ? visiblePlain
      : currentPlain;

    if (headingEl.dataset.bbKineticApplied && headingEl.dataset.bbKineticRaw === rawToUse && headingEl.querySelector('.bb-kinetic-word')) {
      return;
    }

    headingEl.dataset.bbKineticRaw = rawToUse;
    headingEl.dataset.bbKineticApplied = '1';
    headingEl.classList.add('bb-kinetic-heading');

    const words = rawToUse.split(/\s+/);
    headingEl.innerHTML = words.map((word, idx) => {
      const dirClass = idx % 2 === 0 ? 'from-left' : 'from-right';
      const safeWord = word
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<span class="bb-kinetic-word ${dirClass}" style="--word-i:${Math.min(idx, 12)}">${safeWord}</span>`;
    }).join(' ');
  }

  function tagDirectionalElements() {
    // 4.1 Títulos con palabras cinéticas alternadas izquierda / derecha
    const kineticSelectors = [
      '.section-main-title',
      '.about-feature-box h3',
      '.about-card h3',
      '.contact-left-info h3',
      '.contact-info-side h2',
      '.brand-catalog-info h2',
      '.goal-card-3d h3'
    ];
    kineticSelectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach(applyKineticWords);
    });

    // 4.2 Bloques de texto y etiquetas con entrada lateral alternada
    const directionalRules = [
      { sel: '.hero-tag', dir: 'left', delay: 40 },
      { sel: '.hero-title', dir: 'left', delay: 110 },
      { sel: '.hero-subtitle, .hero-description', dir: 'right', delay: 185 },
      { sel: '.hero-conversion-perks li', dir: 'alternate', stagger: 60 },
      { sel: '.hero-btn-row, .hero-cta-group', dir: 'left', delay: 250 },
      { sel: '.hero-trust-list, .hero-trust-row', dir: 'right', delay: 310 },
      { sel: '.hero-visual-wrap', dir: 'right', delay: 140 },
      { sel: '.guarantee-item', dir: 'alternate', stagger: 55 },
      { sel: '.section-subtitle-tag, .section-tag', dir: 'left', delay: 0 },
      { sel: '.section-lead, .section-lead-text', dir: 'right', delay: 85 },
      { sel: '.goal-card-3d', dir: 'alternate', stagger: 55 },
      { sel: '.offer-vip-pill-card', dir: 'alternate', stagger: 60 },
      { sel: '.brand-card-item', dir: 'alternate', stagger: 55 },
      { sel: '.product-item-card', dir: 'alternate', stagger: 45 },
      { sel: '.brand-showcase-header, .brand-catalog-banner', dir: 'zoom', delay: 0 },
      { sel: '.review-luxury-card', dir: 'alternate', stagger: 65 },
      { sel: '.about-feature-box, .about-card', dir: 'alternate', stagger: 90 },
      { sel: '.value-single-card, .value-box-item', dir: 'alternate', stagger: 65 },
      { sel: '.contact-left-info p, .contact-info-side p', dir: 'left', delay: 80 },
      { sel: '.contact-channels-list', dir: 'left', delay: 145 },
      { sel: '.contact-form-card, .contact-form-side', dir: 'right', delay: 130 },
      { sel: '.bug-report-card', dir: 'up', delay: 60 },
      { sel: '.footer-col-item, .footer-col, .footer-brand-info', dir: 'alternate', stagger: 65 }
    ];

    directionalRules.forEach((rule) => {
      const nodes = document.querySelectorAll(rule.sel);
      nodes.forEach((el, idx) => {
        el.classList.add('bb-anim');
        if (!el.dataset.bbDir) {
          if (rule.dir === 'alternate') {
            el.dataset.bbDir = (idx % 2 === 0) ? 'left' : 'right';
          } else {
            el.dataset.bbDir = rule.dir;
          }
        }
        const computedDelay = rule.stagger
          ? Math.min((idx % 4) * rule.stagger, 220)
          : (rule.delay || 0);
        el.style.setProperty('--bb-delay', `${computedDelay}ms`);
      });
    });
  }

  function initBidirectionalScrollEngine() {
    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll('.bb-anim, .bb-kinetic-heading').forEach((el) => {
        el.classList.add('bb-in-view');
      });
      return;
    }

    ioInstance = new IntersectionObserver((entries) => {
      const vh = window.innerHeight || document.documentElement.clientHeight || 800;

      entries.forEach((entry) => {
        const el = entry.target;
        if (entry.isIntersecting) {
          el.classList.remove('bb-above-viewport');
          el.classList.add('bb-in-view');
        } else {
          const rect = entry.boundingClientRect;
          // Histeresis para evitar parpadeos en el borde exacto de la pantalla:
          // Si salió completamente por arriba (usuario bajó), preparar re-entrada al subir.
          if (rect.bottom <= -12) {
            el.classList.remove('bb-in-view');
            el.classList.add('bb-above-viewport');
          } else if (rect.top >= vh + 12) {
            // Si salió completamente por abajo (usuario subió), preparar re-entrada al bajar.
            el.classList.remove('bb-in-view');
            el.classList.remove('bb-above-viewport');
          }
        }
      });
    }, {
      threshold: [0, 0.08],
      rootMargin: '15px 0px -25px 0px'
    });

    refreshScrollAnimations();

    const domObserver = new MutationObserver(() => {
      if (mutationDebounceTimer) clearTimeout(mutationDebounceTimer);
      mutationDebounceTimer = setTimeout(refreshScrollAnimations, 90);
    });

    domObserver.observe(document.body, { childList: true, subtree: true });
  }

  function refreshScrollAnimations() {
    tagDirectionalElements();
    if (!ioInstance) return;

    const vh = window.innerHeight || document.documentElement.clientHeight || 800;
    document.querySelectorAll('.bb-anim, .bb-kinetic-heading').forEach((el) => {
      if (!el.dataset.bbObserved) {
        el.dataset.bbObserved = '1';
        ioInstance.observe(el);
      }
      // Si el elemento ya está visible en pantalla actualmente, revelarlo sin espera
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.bottom > 10 && rect.top < vh - 10) {
        el.classList.remove('bb-above-viewport');
        el.classList.add('bb-in-view');
      }
    });
  }

  // Exponer API global para refrescar animaciones tras renders dinámicos de app.js
  window.BloomFX = {
    refresh: refreshScrollAnimations
  };

  // --------------------------------------------------------------------------
  // 5. EFECTO 3D INTERACTIVO EN LA PORTADA HERO Y TARJETAS (SOLO PUNTERO FINO)
  // --------------------------------------------------------------------------
  function initHeroTilt3D() {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
    const heroWrap = document.querySelector('.hero-visual-wrap');
    const heroFrame = document.querySelector('.hero-image-frame');
    if (!heroWrap || !heroFrame) return;

    heroWrap.addEventListener('mousemove', (e) => {
      const rect = heroWrap.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const rotateX = ((y - centerY) / centerY) * -8;
      const rotateY = ((x - centerX) / centerX) * 8;

      heroFrame.style.animation = 'none';
      heroFrame.style.transform = `perspective(1100px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale3d(1.02, 1.02, 1.02)`;
    });

    heroWrap.addEventListener('mouseleave', () => {
      heroFrame.style.transform = '';
      heroFrame.style.animation = 'hero3dFloat 7s ease-in-out infinite alternate';
    });
  }

  function initCardsInteractive3D() {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;

    const selector = '.product-item-card, .brand-card-item, .review-luxury-card';

    const attachTilt = (el) => {
      if (el.dataset.tiltAttached) return;
      el.dataset.tiltAttached = 'true';

      el.addEventListener('mousemove', (e) => {
        if (!el.classList.contains('bb-in-view')) return;
        const rect = el.getBoundingClientRect();
        const deltaX = ((e.clientX - rect.left) - rect.width / 2) / (rect.width / 2);
        const deltaY = ((e.clientY - rect.top) - rect.height / 2) / (rect.height / 2);
        const rotX = (-deltaY * 4.5).toFixed(2);
        const rotY = (deltaX * 4.5).toFixed(2);

        el.style.transition = 'transform 0.12s ease-out';
        el.style.transform = `perspective(950px) rotateX(${rotX}deg) rotateY(${rotY}deg) translate3d(0, -6px, 0) scale(1.012)`;
      });

      el.addEventListener('mouseleave', () => {
        el.style.transition = '';
        el.style.transform = '';
      });
    };

    document.querySelectorAll(selector).forEach(attachTilt);
    const observer = new MutationObserver(() => {
      document.querySelectorAll(selector).forEach(attachTilt);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // --------------------------------------------------------------------------
  // 6. CONTADOR DE URGENCIA EN TIEMPO REAL EN LA BARRA SUPERIOR
  // --------------------------------------------------------------------------
  function initUrgencyCountdown() {
    const timerElem = document.getElementById('promo-countdown-timer');
    if (!timerElem) return;

    let remainingSeconds = 4 * 3600 + 38 * 60 + 45;
    const renderTick = () => {
      remainingSeconds = remainingSeconds > 0 ? remainingSeconds - 1 : 4 * 3600 + 59 * 60;
      const hrs = String(Math.floor(remainingSeconds / 3600)).padStart(2, '0');
      const mins = String(Math.floor((remainingSeconds % 3600) / 60)).padStart(2, '0');
      const secs = String(remainingSeconds % 60).padStart(2, '0');
      timerElem.innerHTML = `⏳ Termina en: <strong>${hrs}h : ${mins}m : ${secs}s</strong>`;
    };
    renderTick();
    setInterval(renderTick, 1000);
  }

  // --------------------------------------------------------------------------
  // 7. NOTIFICACIONES DE PRUEBA SOCIAL EN VIVO (DESACTIVADAS)
  // --------------------------------------------------------------------------
  function initLiveSocialProofEngine() {
    // Desactivado: Notificaciones falsas de compra eliminadas permanentemente
    const popup = document.getElementById('live-sales-popup');
    if (popup) {
      popup.style.display = 'none';
      popup.classList.remove('visible');
    }
    return;
  }

  // --------------------------------------------------------------------------
  // 8. RESPALDO SEGURO DE IMÁGENES SIN BUCLES INFINITOS
  // --------------------------------------------------------------------------
  function patchImageFallbacks() {
    document.addEventListener('error', (e) => {
      const img = e.target;
      if (!img || img.tagName !== 'IMG') return;
      const step = Number(img.dataset.fallbackStep || '0');
      const currentSrc = img.getAttribute('src') || '';

      if (step === 0 && currentSrc && !currentSrc.startsWith('http') && !currentSrc.startsWith('data:')) {
        img.dataset.fallbackStep = '1';
        img.src = 'https://bloombeauty2.netlify.app/' + currentSrc.replace(/^\/+/, '');
      } else if (step < 2) {
        img.dataset.fallbackStep = '2';
        img.src = 'imagenes/logo-bloom-beauty.jpg';
      }
    }, true);
  }
})();
