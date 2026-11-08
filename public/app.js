// ============================================================================
// BLOOM BEAUTY - SISTEMA PRINCIPAL DE LA TIENDA VIRTUAL
// ============================================================================

const STORAGE_KEY = 'bloom_beauty_master_data_v11';

// Estado global de la aplicación
let appState = {
  storeInfo: {},
  brands: [],
  products: [],
  cart: [],
  currentUser: null,
  selectedBrandId: null,
  catalogMode: 'brand',
  catalogCustomList: null,
  catalogCustomTitle: '',
  appliedCouponCode: '',
  activeCategory: 'Todos',
  catalogBrandFilter: 'all',
  searchQuery: '',
  page: 1,
  pageSize: 24,
  pendingOrder: null
};

// Formateador de moneda para Pesos Colombianos (COP)
function formatCurrency(amount) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(amount);
}

// Inicialización de la aplicación
function initApp() {
  loadDataFromStorage();
  bindEventListeners();
  initEntryPermissionsFlow();
  initPersonalizedAlertsListener();
  renderApp();
  renderReviewsDynamic();
  updateAuthCircleState();
  checkUrlHash();
  window.addEventListener('hashchange', checkUrlHash);

  const handleRealTimeSync = () => {
    syncCurrentUserFromDB();
    loadDataFromStorage();
    renderApp();
    renderReviewsDynamic();
    updateAuthCircleState();
    refreshOpenModalsRealTime();
  };

  // Suscripción en tiempo real al motor de datos BloomDB
  if (typeof BloomDB !== 'undefined') {
    BloomDB.subscribe(() => {
      handleRealTimeSync();
    });
  }

  // Sincronización inmediata al volver a la pestaña
  window.addEventListener('focus', handleRealTimeSync);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) handleRealTimeSync();
  });
}

// Sincronizar sesión activa del cliente contra el motor de datos en tiempo real
// y validar la integridad matemática de "Tu Saldo"
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 HORAS EXACTAS

function saveCustomerSession(user) {
  if (!user || !user.id) return;
  const sessionData = {
    user: user,
    savedAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS
  };
  localStorage.setItem('bloom_customer_current_user', JSON.stringify(sessionData));
  appState.currentUser = user;
}

function syncCurrentUserFromDB() {
  try {
    const savedRaw = localStorage.getItem('bloom_customer_current_user');
    if (!savedRaw) {
      appState.currentUser = null;
      return null;
    }

    let parsed = JSON.parse(savedRaw);
    if (!parsed) {
      appState.currentUser = null;
      localStorage.removeItem('bloom_customer_current_user');
      return null;
    }

    // Compatibilidad retroactiva o nueva estructura con expiresAt
    let user = parsed.user || parsed;
    let expiresAt = parsed.expiresAt || (parsed.savedAt ? (parsed.savedAt + SESSION_TTL_MS) : (Date.now() + SESSION_TTL_MS));

    // VERIFICAR REGLA DE 24 HORAS
    if (Date.now() > expiresAt) {
      console.warn('[Session] La sesión ha expirado tras cumplirse 24 horas.');
      appState.currentUser = null;
      localStorage.removeItem('bloom_customer_current_user');
      return null;
    }

    if (!user || !user.id) {
      appState.currentUser = null;
      localStorage.removeItem('bloom_customer_current_user');
      return null;
    }

    // Si hay datos locales actualizados, mantener el saldo al día
    const customers = getStoredCustomers();
    const freshUser = customers.find(u => String(u.id) === String(user.id));
    if (freshUser) {
      user.balance = Math.max(0, Math.round(Number(freshUser.balance) || 0));
    }

    appState.currentUser = user;
    saveCustomerSession(user);
    return user;
  } catch (e) {
    console.warn('[Store] Error sincronizando usuario actual:', e);
    return appState.currentUser;
  }
}

function refreshOpenModalsRealTime() {
  const authModal = document.getElementById('auth-customer-modal');
  if (authModal && authModal.classList.contains('active')) {
    if (appState.currentUser) {
      const anonView = document.getElementById('auth-anonymous-view');
      const loggedView = document.getElementById('auth-logged-view');
      if (anonView) anonView.style.display = 'none';
      if (loggedView) loggedView.style.display = 'block';
      renderAuthLoggedProfile();
    } else {
      const anonView = document.getElementById('auth-anonymous-view');
      const loggedView = document.getElementById('auth-logged-view');
      if (anonView) anonView.style.display = 'block';
      if (loggedView) loggedView.style.display = 'none';
    }
  }

  const checkoutModal = document.getElementById('checkout-order-modal');
  if (checkoutModal && checkoutModal.classList.contains('active') && appState.pendingOrder && currentCheckoutWizardStep !== 5) {
    if (appState.pendingOrder.orderSource === 'cart' && appState.cart.length > 0) {
      const updatedItems = appState.cart.map(item => Object.assign({}, item, { quantity: Math.max(1, Number(item.quantity) || 1) }));
      const pricing = getCartPricingBreakdown(updatedItems);
      appState.pendingOrder.items = updatedItems;
      appState.pendingOrder.subtotal = pricing.subtotal;
      appState.pendingOrder.discountAmount = pricing.discountAmount;
      appState.pendingOrder.couponCode = pricing.discountAmount > 0 ? appState.appliedCouponCode : '';
      appState.pendingOrder.total = pricing.finalTotal;
    } else if (Array.isArray(appState.pendingOrder.items) && appState.pendingOrder.items.length > 0) {
      const pricing = getCartPricingBreakdown(appState.pendingOrder.items);
      appState.pendingOrder.subtotal = pricing.subtotal;
      appState.pendingOrder.discountAmount = pricing.discountAmount;
      appState.pendingOrder.couponCode = pricing.discountAmount > 0 ? appState.appliedCouponCode : '';
      appState.pendingOrder.total = pricing.finalTotal;
    }
    renderCheckoutBalanceCheck();
  }
}

// Navegación por hash en la URL (ej: #brand-milagros, #brand-kaba)
function checkUrlHash() {
  const hash = window.location.hash;
  if (hash && hash.startsWith('#brand-')) {
    const brandId = hash.replace('#brand-', '');
    if (appState.brands.some(b => b.id === brandId)) {
      openBrandCatalog(brandId);
    }
  }
}

// Cargar datos desde almacenamiento local o valores por defecto
function loadDataFromStorage() {
  try {
    if (typeof BloomDB !== 'undefined') {
      const data = BloomDB.getData();
      appState.storeInfo = data.storeInfo || {};
      appState.brands = data.brands || [];
      appState.products = data.products || [];
    } else {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        appState.storeInfo = Object.assign({}, DEFAULT_SITE_DATA.storeInfo, parsed.storeInfo || {});
        appState.brands = (Array.isArray(parsed.brands) && parsed.brands.length > 0) ? parsed.brands : DEFAULT_SITE_DATA.brands;
        appState.products = (Array.isArray(parsed.products) && parsed.products.length > 0) ? parsed.products : DEFAULT_SITE_DATA.products;
      } else {
        appState.storeInfo = JSON.parse(JSON.stringify(DEFAULT_SITE_DATA.storeInfo));
        appState.brands = JSON.parse(JSON.stringify(DEFAULT_SITE_DATA.brands));
        appState.products = JSON.parse(JSON.stringify(DEFAULT_SITE_DATA.products));
      }
    }

    const savedCart = localStorage.getItem('bloom_beauty_cart');
    if (savedCart) {
      const rawCart = JSON.parse(savedCart);
      if (Array.isArray(rawCart)) {
        let cartModified = false;
        const syncedCart = [];
        rawCart.forEach((cartItem) => {
          if (!cartItem || !cartItem.id) {
            cartModified = true;
            return;
          }
          const liveProd = (appState.products || []).find(p => String(p.id) === String(cartItem.id));
          if (!liveProd || liveProd.active === false) {
            cartModified = true;
            return;
          }
          const cleanQty = Math.max(1, parseInt(cartItem.quantity, 10) || 1);
          const cleanPrice = Math.max(0, Number(liveProd.price) || 0);
          if (cleanPrice !== cartItem.price || liveProd.name !== cartItem.name || liveProd.image !== cartItem.image || cleanQty !== cartItem.quantity) {
            cartModified = true;
          }
          syncedCart.push(Object.assign({}, cartItem, {
            name: liveProd.name,
            price: cleanPrice,
            image: liveProd.image,
            quantity: cleanQty
          }));
        });
        appState.cart = syncedCart;
        if (cartModified) {
          saveCartToStorage();
        }
      } else {
        appState.cart = [];
      }
    }

    // Sincronizar usuario autenticado actual y Tu Saldo en vivo contra BloomDB
    syncCurrentUserFromDB();
  } catch (e) {
    console.error('[Store] Error al cargar datos desde BloomDB:', e);
    appState.storeInfo = JSON.parse(JSON.stringify(DEFAULT_SITE_DATA.storeInfo));
    appState.brands = JSON.parse(JSON.stringify(DEFAULT_SITE_DATA.brands));
    appState.products = JSON.parse(JSON.stringify(DEFAULT_SITE_DATA.products));
  }
}

// Guardar datos en LocalStorage
function saveDataToStorage() {
  try {
    if (typeof BloomDB !== 'undefined') {
      BloomDB.saveData({
        storeInfo: appState.storeInfo,
        brands: appState.brands,
        products: appState.products
      });
    } else {
      const dataToSave = {
        storeInfo: appState.storeInfo,
        brands: appState.brands,
        products: appState.products
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
    }
  } catch (e) {
    console.error('[Store] Error al guardar datos en BloomDB:', e);
  }
}

function saveCartToStorage() {
  try {
    localStorage.setItem('bloom_beauty_cart', JSON.stringify(appState.cart));
  } catch (e) {
    console.error('Error al guardar carrito:', e);
  }
}

// Notificaciones flotantes Toast
function showToast(message, type = 'normal') {
  const container = document.getElementById('toast-stack');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-msg';
  if (type === 'error') toast.style.borderLeftColor = 'var(--color-danger)';
  if (type === 'success') toast.style.borderLeftColor = 'var(--color-whatsapp)';

  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Renderizado integral de la tienda
function renderApp() {
  renderStoreInfo();
  renderActiveOffersAndPromo();
  renderBrandSelectDropdowns();
  renderBrandsGrid();
  renderProductsGrid();
  if (appState.selectedBrandId === '__ALL__') {
    openAllProductsCatalog(false);
  } else if (appState.selectedBrandId && appState.catalogMode === 'brand') {
    renderBrandQuickSwitcher(appState.selectedBrandId);
    renderBrandProducts(appState.selectedBrandId);
  } else {
    openAllProductsCatalog(false);
  }
  renderCart();
  if (window.BloomFX && typeof window.BloomFX.refresh === 'function') {
    window.BloomFX.refresh();
  }
}

// Conectar Ofertas & Promos del Panel Admin con la Barra Superior y Vitrina de Promociones
let currentBannerCouponCode = '';

function renderActiveOffersAndPromo() {
  const info = appState.storeInfo || {};
  const topBar = document.getElementById('top-announcement-bar');
  const promoElem = document.getElementById('store-promo-text');
  const badgeLabel = document.getElementById('promo-badge-hot-label');
  const couponBtn = document.getElementById('promo-active-coupon-btn');
  const showcaseSec = document.getElementById('active-offers-showcase');
  const scroller = document.getElementById('active-offers-scroller');

  const activeOffers = (typeof BloomDB !== 'undefined' && typeof BloomDB.getOffers === 'function')
    ? (BloomDB.getOffers() || []).filter(o => o && o.active !== false)
    : [];

  const leadOffer = activeOffers[0] || null;
  currentBannerCouponCode = leadOffer && leadOffer.couponCode ? String(leadOffer.couponCode).trim().toUpperCase() : '';

  if (topBar) {
    const shouldShowBar = info.promoActive !== false;
    topBar.style.display = shouldShowBar ? '' : 'none';
  }

  if (promoElem) {
    if (info.useCustomPromoText && info.promoAnnouncement) {
      promoElem.innerText = info.promoAnnouncement;
      if (badgeLabel) badgeLabel.innerText = '✨ OFICIAL VIP';
    } else if (leadOffer && (leadOffer.bannerText || leadOffer.title)) {
      promoElem.innerText = leadOffer.bannerText || `${leadOffer.title}${leadOffer.discountPercent ? ' • ' + leadOffer.discountPercent + '% OFF' : ''}`;
      if (badgeLabel) {
        badgeLabel.innerText = leadOffer.discountPercent ? `🔥 -${leadOffer.discountPercent}% HOY` : '🔥 PROMO ACTIVA';
      }
    } else if (info.promoAnnouncement) {
      promoElem.innerText = info.promoAnnouncement;
      if (badgeLabel) badgeLabel.innerText = '✨ OFICIAL VIP';
    }
  }

  if (couponBtn) {
    if (currentBannerCouponCode) {
      couponBtn.style.display = 'inline-flex';
      couponBtn.innerText = `🎟️ Usar Cupón: ${currentBannerCouponCode}`;
    } else {
      couponBtn.style.display = 'none';
    }
  }

  if (showcaseSec && scroller) {
    if (activeOffers.length === 0) {
      showcaseSec.style.display = 'none';
      scroller.innerHTML = '';
    } else {
      showcaseSec.style.display = 'block';
      scroller.innerHTML = activeOffers.map((off) => {
        const code = String(off.couponCode || '').trim().toUpperCase();
        const brandTxt = off.targetBrand && off.targetBrand !== 'Todas' ? `Marca: ${off.targetBrand}` : 'Todas las marcas';
        const pctBadge = off.discountPercent ? `-${off.discountPercent}% OFF` : 'Especial';
        return `
          <div class="offer-vip-pill-card">
            <div class="offer-vip-meta">
              <strong>🔥 ${escapeStoreHtml(off.title || 'Oferta Especial')} (${escapeStoreHtml(pctBadge)})</strong>
              <small>${escapeStoreHtml(off.description || off.bannerText || brandTxt)} • ${escapeStoreHtml(brandTxt)}</small>
            </div>
            ${code ? `
              <button type="button" class="promo-coupon-copy-btn" onclick="applyCouponCodeDirect('${escapeStoreHtml(code)}')">
                🎟️ ${escapeStoreHtml(code)}
              </button>
            ` : (off.targetBrand && off.targetBrand !== 'Todas' ? `
              <button type="button" class="promo-coupon-copy-btn" onclick="openBrandCatalog('${escapeStoreHtml(off.targetBrand)}')">
                Ver Marca &rarr;
              </button>
            ` : '')}
          </div>
        `;
      }).join('');
    }
  }
}

function applyActiveBannerCoupon() {
  if (currentBannerCouponCode) {
    applyCouponCodeDirect(currentBannerCouponCode);
  }
}

function applyCouponCodeDirect(code) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return;
  appState.appliedCouponCode = clean;
  const input = document.getElementById('cart-coupon-input');
  if (input) input.value = clean;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(clean).catch(() => {});
    }
  } catch (e) {}
  renderCart();
  showToast(`🎟️ Cupón ${clean} activado en tu bolsa de compras`, 'success');
}

// Mostrar información general de la tienda vinculada al CMS
function renderStoreInfo() {
  const info = appState.storeInfo;
  if (!info) return;

  // 1. Barra de Anuncios Superior
  const topBar = document.getElementById('top-announcement-bar');
  if (topBar) {
    topBar.style.display = (info.promoActive === false) ? 'none' : '';
  }
  const promoElem = document.getElementById('store-promo-text');
  if (promoElem && info.promoAnnouncement) {
    promoElem.innerText = info.promoAnnouncement;
  }

  // 2. Identidad & Header
  if (info.logo) {
    document.querySelectorAll('.brand-logo-media, .preloader-logo-img').forEach((imgEl) => {
      imgEl.src = info.logo;
    });
  }

  if (info.name) {
    document.title = `${info.name} | Tienda Online Oficial - Cosmética & Cuidado Profesional`;
    const hBrandName = document.getElementById('header-brand-name');
    if (hBrandName) hBrandName.innerText = info.name;
    const mBrandName = document.getElementById('mobile-drawer-brand-name');
    if (mBrandName) mBrandName.innerText = info.name;
    const fBrandName = document.getElementById('footer-brand-name');
    if (fBrandName) fBrandName.innerText = info.name;
    const preloaderTitle = document.querySelector('.preloader-title');
    if (preloaderTitle) preloaderTitle.innerText = info.name;
  }

  const hBrandTagline = document.getElementById('header-brand-tagline');
  if (hBrandTagline && info.tagline) {
    hBrandTagline.innerText = info.tagline;
  }
  const mBrandTagline = document.getElementById('mobile-drawer-brand-tagline');
  if (mBrandTagline && info.tagline) {
    mBrandTagline.innerText = info.tagline;
  }
  const fBrandTagline = document.getElementById('footer-brand-tagline');
  if (fBrandTagline && info.tagline) {
    fBrandTagline.innerText = info.tagline;
  }

  // Enlaces de WhatsApp
  const phone = String(info.phone || '3135143012').replace(/\D/g, '') || '3135143012';
  const cleanIntlPhone = phone.startsWith('57') && phone.length > 10 ? phone : `57${phone}`;
  const defaultWppHref = `https://wa.me/${cleanIntlPhone}?text=${encodeURIComponent('Hola Bloom Beauty 🌸 Quisiera recibir atención personalizada.')}`;
  const headerWpp = document.getElementById('header-wpp-btn');
  if (headerWpp) {
    headerWpp.href = `https://wa.me/${cleanIntlPhone}`;
  }
  const floatingWpp = document.getElementById('floating-whatsapp-btn');
  if (floatingWpp) {
    floatingWpp.href = defaultWppHref;
  }
  const drawerWpp = document.getElementById('mobile-drawer-wpp-link');
  if (drawerWpp) {
    drawerWpp.href = defaultWppHref;
  }
  const mobileWpp = document.querySelector('.mobile-nav-wpp');
  if (mobileWpp) {
    mobileWpp.href = `https://wa.me/${cleanIntlPhone}`;
  }

  // 3. Portada Hero
  const heroTag = document.getElementById('hero-tag-text');
  if (heroTag && info.heroTag) {
    heroTag.innerText = info.heroTag;
  }

  const heroTitle = document.getElementById('hero-title-text');
  if (heroTitle && info.heroTitle) {
    const words = String(info.heroTitle).trim().split(/\s+/);
    if (words.length > 4) {
      const mainPart = escapeStoreHtml(words.slice(0, -3).join(' '));
      const accentPart = escapeStoreHtml(words.slice(-3).join(' '));
      heroTitle.innerHTML = `${mainPart} <span>${accentPart}</span>`;
    } else {
      heroTitle.innerText = info.heroTitle;
    }
  }

  const heroSubtitle = document.getElementById('hero-subtitle-text');
  if (heroSubtitle && info.heroSubtitle) {
    heroSubtitle.innerText = info.heroSubtitle;
  }

  const heroBtn1 = document.getElementById('hero-btn-primary');
  if (heroBtn1 && info.heroBtnPrimary) {
    heroBtn1.innerText = info.heroBtnPrimary;
  }

  const heroBtn2 = document.getElementById('hero-btn-secondary');
  if (heroBtn2 && info.heroBtnSecondary) {
    heroBtn2.innerText = info.heroBtnSecondary;
  }

  const heroImg = document.getElementById('hero-main-img');
  if (heroImg && info.heroImage) {
    heroImg.src = info.heroImage;
  }

  // Tarjetas de confianza Hero
  const trustContainer = document.getElementById('hero-trust-container');
  if (trustContainer) {
    if (Array.isArray(info.trustBadges) && info.trustBadges.length > 0) {
      trustContainer.innerHTML = info.trustBadges.map(t => {
        if (!t || typeof t !== 'object') return '';
        return `
          <div class="trust-item">
            <h4>${t.title || ''}</h4>
            <p>${t.desc || ''}</p>
          </div>
        `;
      }).join('');
    }
  }

  // Insignia flotante Hero
  if (info.floatingBadge) {
    const flIcon = document.getElementById('floating-glass-icon');
    if (flIcon && info.floatingBadge.icon) flIcon.innerText = info.floatingBadge.icon;
    const flTitle = document.getElementById('floating-glass-title');
    if (flTitle && info.floatingBadge.title) flTitle.innerText = info.floatingBadge.title;
    const flDesc = document.getElementById('floating-glass-desc');
    if (flDesc && info.floatingBadge.desc) flDesc.innerText = info.floatingBadge.desc;
  }

  // 4. Misión y Visión
  const missionElem = document.getElementById('mission-text');
  if (missionElem && info.mission) {
    missionElem.innerText = info.mission;
  }

  const visionElem = document.getElementById('vision-text');
  if (visionElem && info.vision) {
    visionElem.innerText = info.vision;
  }

  // Valores Corporativos
  const valuesCont = document.getElementById('store-values-container');
  if (valuesCont) {
    if (Array.isArray(info.values) && info.values.length > 0) {
      valuesCont.innerHTML = info.values.map(v => {
        if (!v || typeof v !== 'object') return '';
        return `
          <div class="value-single-card">
            <div class="value-icon-circle">${v.icon || '💎'}</div>
            <h4>${v.title || ''}</h4>
            <p>${v.desc || ''}</p>
          </div>
        `;
      }).join('');
    }
  }

  // 5. Contacto & Canales
  const contactTitle = document.getElementById('contact-title-text');
  if (contactTitle && info.contactTitle) {
    contactTitle.innerText = info.contactTitle;
  }

  const contactSubtitle = document.getElementById('contact-subtitle-text');
  if (contactSubtitle && info.contactSubtitle) {
    contactSubtitle.innerText = info.contactSubtitle;
  }

  const contactPhone = document.getElementById('contact-phone-display');
  if (contactPhone) {
    contactPhone.innerText = info.phoneDisplay || info.phone || '(+57) 313 514 3012';
  }

  const contactEmail = document.getElementById('contact-email-display');
  if (contactEmail && info.email) {
    contactEmail.innerText = info.email;
  }

  const contactAddr = document.getElementById('contact-address-display');
  if (contactAddr && info.address) {
    contactAddr.innerText = info.address;
  }

  // 6. Pie de Página (Footer)
  const footerPhone = document.getElementById('footer-phone-display');
  if (footerPhone) {
    footerPhone.innerText = info.phoneDisplay || info.phone || '313 514 3012';
  }

  const footerEmail = document.getElementById('footer-email-display');
  if (footerEmail && info.email) {
    footerEmail.innerText = info.email;
  }

  const footerBio = document.getElementById('footer-brand-bio');
  if (footerBio && info.footerBio) {
    footerBio.innerText = info.footerBio;
  }

  const footerHours = document.getElementById('footer-hours-display');
  if (footerHours && info.footerHours) {
    footerHours.innerText = `🕒 Horario de atención: ${info.footerHours}`;
  }

  const footerCopy = document.getElementById('footer-copyright-text');
  if (footerCopy && info.copyrightText) {
    footerCopy.innerText = info.copyrightText;
  }

  // 7. Meta de Envío Gratis, Marcas Dinámicas en Footer y Cuentas Oficiales de Recarga
  const freeShipGoal = Math.max(1000, Number(info.freeShippingThreshold) || 120000);
  const guaranteeShipCopy = document.getElementById('guarantee-free-shipping-copy');
  if (guaranteeShipCopy) {
    guaranteeShipCopy.innerText = `En compras superiores a ${formatCurrency(freeShipGoal)}`;
  }

  const footerBrandsList = document.getElementById('footer-brands-dynamic-list');
  if (footerBrandsList && Array.isArray(appState.brands)) {
    const activeFooterBrands = appState.brands.filter(b => b && b.active !== false).slice(0, 7);
    if (activeFooterBrands.length > 0) {
      footerBrandsList.innerHTML = activeFooterBrands.map(b =>
        `<li><a href="javascript:void(0)" onclick="openBrandCatalog('${escapeStoreHtml(b.id)}')">${escapeStoreHtml(b.name)}</a></li>`
      ).join('');
    }
  }

  const rechargeHintEl = document.getElementById('recharge-accounts-live-hint');
  if (rechargeHintEl) {
    const lines = [];
    if (info.nequiNumber) lines.push(`📱 <strong>Nequi / Daviplata:</strong> ${escapeStoreHtml(info.nequiNumber)}`);
    if (info.bancolombiaAccount) lines.push(`🏦 <strong>Bancolombia:</strong> ${escapeStoreHtml(info.bancolombiaAccount)}`);
    if (info.paymentHolder) lines.push(`👤 <strong>Titular:</strong> ${escapeStoreHtml(info.paymentHolder)}`);
    if (lines.length > 0) {
      rechargeHintEl.style.display = 'block';
      rechargeHintEl.innerHTML = `<div style="font-weight:700; color:#FDE68A; margin-bottom:3px;">💎 Cuentas Oficiales para Recargar:</div>` + lines.join('<br>');
    } else {
      rechargeHintEl.style.display = 'none';
      rechargeHintEl.innerHTML = '';
    }
  }
}

// ============================================================================
// PORTAL DE MARCAS Y CATÁLOGOS EXCLUSIVOS
// ============================================================================

// Localizador flexible y seguro de marcas por ID, slug o nombre
function findBrandById(brandId) {
  if (!brandId) return null;
  const clean = String(brandId).trim().toLowerCase();
  const slug = clean.replace(/[^a-z0-9]/g, '');
  return (appState.brands || []).find(b => {
    if (!b) return false;
    const bId = String(b.id || '').trim().toLowerCase();
    const bName = String(b.name || '').trim().toLowerCase();
    return bId === clean || bName === clean || bId.replace(/[^a-z0-9]/g, '') === slug || bName.replace(/[^a-z0-9]/g, '') === slug;
  }) || null;
}

function renderBrandsGrid() {
  const container = document.getElementById('brands-grid');
  if (!container) return;

  container.innerHTML = '';
  const activeBrands = (appState.brands || []).filter(b => b && b.active !== false);

  if (activeBrands.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem 1rem; color: #8C827A;">
        <span style="font-size: 2.5rem; display: block; margin-bottom: 0.5rem;">🌸</span>
        <h3 style="font-size: 1.25rem; font-weight: 700; color: #14100D;">Catálogo en actualización</h3>
        <p>Pronto estarán disponibles nuestras colecciones oficiales.</p>
      </div>
    `;
    return;
  }

  activeBrands.forEach(brand => {
    const brandId = String(brand.id || '').trim();
    const brandName = brand.name || 'Marca Oficial';
    const brandNameLower = brandName.toLowerCase();

    const count = (appState.products || []).filter(p => {
      if (!p || p.active === false) return false;
      const pBId = String(p.brandId || '').trim().toLowerCase();
      const pBName = p.brandName ? String(p.brandName).trim().toLowerCase() : '';
      return pBId === brandId.toLowerCase() || (brandNameLower && pBName === brandNameLower);
    }).length;

    const card = document.createElement('div');
    card.className = 'brand-card-item';
    card.setAttribute('data-brand-id', brandId);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Ver catálogo oficial de ${brandName}`);
    card.style.cursor = 'pointer';

    const safeBanner = brand.banner || brand.logo || 'imagenes/marcas/milagros-banner.jpg';
    const safeLogo = brand.logo || 'imagenes/marcas/milagros-logo.jpg';
    const safeCategory = brand.category || 'Cosmética Profesional';
    const safeTagline = brand.tagline || brand.description || 'Tratamientos y fórmulas oficiales certificadas';

    card.innerHTML = `
      <div class="brand-cover-wrap">
        <img src="${safeBanner}" alt="${brandName}" class="brand-banner-img" loading="lazy" onerror="this.src='${safeLogo}'">
        <div class="brand-cover-gradient"></div>
        ${brand.badge ? `<span class="brand-ribbon-badge">${brand.badge}</span>` : ''}
        <div class="brand-avatar-circle">
          <img src="${safeLogo}" alt="Logo ${brandName}" class="brand-logo-img" loading="lazy">
        </div>
      </div>
      <div class="brand-info-wrap">
        <span class="brand-cat-name">${safeCategory}</span>
        <h3 class="brand-title-head">${brandName}</h3>
        <p class="brand-summary-text">${safeTagline}</p>
        <div class="brand-bottom-actions">
          <span class="brand-count-indicator">${count} ${count === 1 ? 'Producto' : 'Productos'}</span>
          <button type="button" class="btn-enter-brand" aria-label="Ver catálogo de ${brandName}">
            Ver Catálogo &rarr;
          </button>
        </div>
      </div>
    `;

    // Click directo en la tarjeta
    card.addEventListener('click', () => {
      openBrandCatalog(brandId);
    });

    // Accesibilidad por teclado (Enter / Espacio)
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openBrandCatalog(brandId);
      }
    });

    container.appendChild(card);
  });

  // Delegación de eventos infalible sobre el contenedor padre (captura clics y toques táctiles)
  if (!container.dataset.tapBound) {
    container.dataset.tapBound = 'true';
    container.addEventListener('click', (e) => {
      const card = e.target.closest('.brand-card-item');
      if (card) {
        const bId = card.getAttribute('data-brand-id');
        if (bId) {
          openBrandCatalog(bId);
        }
      }
    });
  }
}

function renderBrandQuickSwitcher(activeKey = '') {
  const bar = document.getElementById('brand-quick-switcher');
  if (!bar) return;

  const activeBrands = (appState.brands || []).filter(b => b && b.active !== false);
  const totalActiveProducts = (appState.products || []).filter(p => p && p.active !== false).length;

  const pillsHtml = [
    `<button type="button" class="brand-switch-pill ${activeKey === '__ALL__' ? 'active' : ''}" onclick="openAllProductsCatalog(true)">
      ✨ Todos (${totalActiveProducts})
    </button>`,
    ...activeBrands.map((b) => {
      const bId = String(b.id || '').trim();
      const isAct = String(activeKey || '').toLowerCase() === bId.toLowerCase();
      return `<button type="button" class="brand-switch-pill ${isAct ? 'active' : ''}" onclick="openBrandCatalog('${escapeStoreHtml(bId)}')">
        ${escapeStoreHtml(b.name || 'Marca')}
      </button>`;
    })
  ];

  bar.innerHTML = pillsHtml.join('');
}

function openAllProductsCatalog(scrollSmooth = true) {
  appState.selectedBrandId = '__ALL__';
  appState.catalogMode = 'all';
  const allActive = (appState.products || []).filter(p => p && p.active !== false);
  appState.catalogCustomList = allActive;
  appState.catalogCustomTitle = 'Catálogo General Multimarca';

  renderBrandQuickSwitcher('__ALL__');

  const headerElem = document.getElementById('brand-showcase-container');
  if (headerElem) {
    headerElem.innerHTML = `
      <button type="button" class="btn-back-to-brands" onclick="closeBrandCatalog()">
        ← Volver a Todas las Marcas
      </button>
      <div class="brand-showcase-content">
        <div class="brand-showcase-logo">
          <img src="imagenes/logo-bloom-beauty.jpg" alt="Bloom Beauty">
        </div>
        <div class="brand-showcase-details">
          <span class="section-subtitle-tag" style="color: #FDE68A;">Colección Completa Certificada</span>
          <h2>Catálogo General Bloom Beauty</h2>
          <p>Explora y filtra todas nuestras referencias 100% originales en cuidado capilar, facial y corporal.</p>
        </div>
      </div>
    `;
  }

  const localSearch = document.getElementById('brand-local-search-input');
  if (localSearch) localSearch.value = '';

  const mainBrandsSec = document.getElementById('main-brands-section');
  const brandViewSec = document.getElementById('brand-catalog-viewport');
  if (mainBrandsSec) mainBrandsSec.style.display = 'block';
  if (brandViewSec) {
    brandViewSec.style.display = 'block';
    brandViewSec.classList.add('active');
    if (scrollSmooth) {
      requestAnimationFrame(() => {
        const offsetTop = brandViewSec.getBoundingClientRect().top + window.pageYOffset - 80;
        window.scrollTo({ top: Math.max(0, offsetTop), behavior: 'smooth' });
      });
    }
  }

  filterCurrentCatalogView();
}

function openCustomFilteredCatalog({ title, subtitle, tag, productsList, pillKey = '' }) {
  appState.selectedBrandId = pillKey || '__CUSTOM__';
  appState.catalogMode = 'custom';
  appState.catalogCustomList = Array.isArray(productsList) ? productsList : [];
  appState.catalogCustomTitle = title || 'Selección Especializada';

  renderBrandQuickSwitcher(pillKey);

  const headerElem = document.getElementById('brand-showcase-container');
  if (headerElem) {
    headerElem.innerHTML = `
      <button type="button" class="btn-back-to-brands" onclick="closeBrandCatalog()">
        ← Volver a Todas las Marcas
      </button>
      <div class="brand-showcase-content">
        <div class="brand-showcase-logo">
          <img src="imagenes/logo-bloom-beauty.jpg" alt="Selección Bloom Beauty">
        </div>
        <div class="brand-showcase-details">
          <span class="section-subtitle-tag" style="color: #FDE68A;">${escapeStoreHtml(tag || 'Selección Curada')}</span>
          <h2>${escapeStoreHtml(title || 'Resultados')}</h2>
          <p>${escapeStoreHtml(subtitle || 'Tratamientos recomendados entre todas nuestras marcas oficiales.')}</p>
        </div>
      </div>
    `;
  }

  const localSearch = document.getElementById('brand-local-search-input');
  if (localSearch) localSearch.value = '';

  const mainBrandsSec = document.getElementById('main-brands-section');
  const brandViewSec = document.getElementById('brand-catalog-viewport');
  if (mainBrandsSec) mainBrandsSec.style.display = 'block';
  if (brandViewSec) {
    brandViewSec.style.display = 'block';
    brandViewSec.classList.add('active');
    requestAnimationFrame(() => {
      const offsetTop = brandViewSec.getBoundingClientRect().top + window.pageYOffset - 80;
      window.scrollTo({ top: Math.max(0, offsetTop), behavior: 'smooth' });
    });
  }

  filterCurrentCatalogView();
}

function openBrandCatalog(brandId) {
  if (!brandId) return;

  const brand = findBrandById(brandId);
  if (!brand) {
    console.warn('[BrandCatalog] Marca no encontrada:', brandId);
    return;
  }

  const effectiveBrandId = String(brand.id || brandId).trim();
  const brandName = brand.name || 'Marca Oficial';
  const brandNameLower = brandName.toLowerCase();
  appState.selectedBrandId = effectiveBrandId;
  appState.catalogMode = 'brand';

  // Filtrado defensivo de productos de la marca
  const brandProducts = (appState.products || []).filter(p => {
    if (!p || p.active === false) return false;
    const pBId = String(p.brandId || '').trim().toLowerCase();
    const pBName = p.brandName ? String(p.brandName).trim().toLowerCase() : '';
    return pBId === effectiveBrandId.toLowerCase() || (brandNameLower && pBName === brandNameLower);
  });

  appState.catalogCustomList = brandProducts;
  appState.catalogCustomTitle = `Catálogo Oficial ${brandName}`;

  renderBrandQuickSwitcher(effectiveBrandId);

  const localSearch = document.getElementById('brand-local-search-input');
  if (localSearch) localSearch.value = '';

  // 1. Inyectar encabezado estilizado de la marca
  const headerElem = document.getElementById('brand-showcase-container');
  if (headerElem) {
    const safeLogo = brand.logo || 'imagenes/marcas/milagros-logo.jpg';
    const safeDesc = brand.description || brand.tagline || 'Línea de cosmética y tratamientos oficiales garantizados.';
    headerElem.innerHTML = `
      <button type="button" class="btn-back-to-brands" onclick="closeBrandCatalog()" aria-label="Volver al catálogo general de marcas">
        ← Volver a Todas las Marcas
      </button>
      <div class="brand-showcase-content">
        <div class="brand-showcase-logo">
          <img src="${safeLogo}" alt="${brandName}">
        </div>
        <div class="brand-showcase-details">
          <span class="section-subtitle-tag" style="color: #FDE68A;">${brand.category || 'Línea Exclusiva'}</span>
          <h2>${brandName}</h2>
          <p>${safeDesc}</p>
        </div>
      </div>
    `;
  }

  // 2. Conmutar visibilidad y desplazar pantalla suavemente
  const mainBrandsSec = document.getElementById('main-brands-section');
  const brandViewSec = document.getElementById('brand-catalog-viewport');

  if (mainBrandsSec) {
    mainBrandsSec.style.display = 'block';
  }

  if (brandViewSec) {
    brandViewSec.style.display = 'block';
    brandViewSec.classList.add('active');

    requestAnimationFrame(() => {
      const offsetTop = brandViewSec.getBoundingClientRect().top + window.pageYOffset - 80;
      window.scrollTo({
        top: Math.max(0, offsetTop),
        behavior: 'smooth'
      });
    });
  }

  // 3. Renderizar productos de la marca y registrar interés de navegación
  filterCurrentCatalogView();
  if (typeof BloomTracker !== 'undefined' && typeof BloomTracker.trackBrandExplore === 'function') {
    BloomTracker.trackBrandExplore(brandName);
  }

  // 4. Actualizar historial de URL de forma limpia
  try {
    if (window.location.hash !== `#brand-${effectiveBrandId}`) {
      history.pushState({ brandId: effectiveBrandId }, '', `#brand-${effectiveBrandId}`);
    }
  } catch (err) {}
}

function navigateToBrands(e) {
  if (e && e.preventDefault) {
    e.preventDefault();
  }
  const mainBrandsSec = document.getElementById('main-brands-section');
  if (mainBrandsSec) {
    mainBrandsSec.style.display = 'block';
    requestAnimationFrame(() => {
      const offsetTop = mainBrandsSec.getBoundingClientRect().top + window.pageYOffset - 80;
      window.scrollTo({
        top: Math.max(0, offsetTop),
        behavior: 'smooth'
      });
    });
  }
}

function navigateToProducts(e) {
  if (e && e.preventDefault) {
    e.preventDefault();
  }
  openAllProductsCatalog(true);
}

function closeBrandCatalog() {
  openAllProductsCatalog(false);
  const mainBrandsSec = document.getElementById('main-brands-section');
  if (mainBrandsSec) {
    mainBrandsSec.style.display = 'block';
    requestAnimationFrame(() => {
      const offsetTop = mainBrandsSec.getBoundingClientRect().top + window.pageYOffset - 80;
      window.scrollTo({
        top: Math.max(0, offsetTop),
        behavior: 'smooth'
      });
    });
  }
  try {
    if (window.location.hash && window.location.hash.startsWith('#brand-')) {
      history.pushState('', document.title, window.location.pathname + window.location.search);
    }
  } catch (err) {}
}

function filterCurrentCatalogView() {
  const container = document.getElementById('brand-products-grid');
  if (!container) return;

  let baseList = [];
  if (appState.catalogMode === 'brand' && appState.selectedBrandId) {
    const brand = findBrandById(appState.selectedBrandId);
    const brandNameLower = brand && brand.name ? String(brand.name).trim().toLowerCase() : '';
    const cleanBrandId = String(appState.selectedBrandId || '').trim().toLowerCase();
    baseList = (appState.products || []).filter(p => {
      if (!p || p.active === false) return false;
      const pBId = String(p.brandId || '').trim().toLowerCase();
      const pBName = p.brandName ? String(p.brandName).trim().toLowerCase() : '';
      return pBId === cleanBrandId || (brandNameLower && pBName === brandNameLower);
    });
  } else if (Array.isArray(appState.catalogCustomList)) {
    baseList = appState.catalogCustomList.filter(p => p && p.active !== false);
  }

  const localQuery = ((document.getElementById('brand-local-search-input') || {}).value || '').trim().toLowerCase();
  const sortMode = ((document.getElementById('brand-local-sort-select') || {}).value || 'featured');

  let list = baseList.slice();
  if (localQuery) {
    list = list.filter((p) => {
      const haystack = `${p.name || ''} ${p.brandName || ''} ${p.category || ''} ${p.description || ''}`.toLowerCase();
      return haystack.includes(localQuery);
    });
  }

  if (sortMode === 'price-asc') {
    list.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
  } else if (sortMode === 'price-desc') {
    list.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
  } else if (sortMode === 'name-asc') {
    list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
  }

  const titleEl = document.getElementById('brand-catalog-toolbar-title');
  const countEl = document.getElementById('brand-products-count-label');
  if (titleEl) {
    titleEl.innerText = appState.catalogCustomTitle || 'Productos Disponibles';
  }
  if (countEl) {
    countEl.innerText = `${list.length} ${list.length === 1 ? 'referencia' : 'referencias'}`;
  }

  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-catalog-msg" style="grid-column: 1 / -1;">
        <span class="icon">🌸</span>
        <h3>No encontramos productos con ese filtro</h3>
        <p>Prueba limpiando el texto de búsqueda o explora todas nuestras marcas oficiales.</p>
        <button type="button" class="btn-back-to-brands" onclick="openAllProductsCatalog(true)" style="margin-top: 1rem;">
          ✨ Ver Todos los Productos
        </button>
      </div>
    `;
    return;
  }

  list.forEach((product) => {
    try {
      container.appendChild(createProductCardElement(product));
    } catch (err) {
      console.error('[BrandCatalog] Error renderizando tarjeta de producto:', err, product);
    }
  });

  if (window.BloomFX && typeof window.BloomFX.refresh === 'function') {
    window.BloomFX.refresh();
  }
}

function renderBrandProducts(brandId) {
  appState.selectedBrandId = brandId;
  appState.catalogMode = 'brand';
  filterCurrentCatalogView();
}

// Exposición en el objeto global window para permitir llamadas desde atributos inline HTML
window.findBrandById = findBrandById;
window.renderBrandsGrid = renderBrandsGrid;
window.openBrandCatalog = openBrandCatalog;
window.openAllProductsCatalog = openAllProductsCatalog;
window.filterCurrentCatalogView = filterCurrentCatalogView;
window.closeBrandCatalog = closeBrandCatalog;
window.navigateToBrands = navigateToBrands;
window.navigateToProducts = navigateToProducts;
window.renderBrandProducts = renderBrandProducts;

// ============================================================================
// FACTORÍA DE TARJETAS DE PRODUCTO & CATÁLOGO GENERAL
// ============================================================================

function createProductCardElement(product) {
  const card = document.createElement('div');
  card.className = 'product-item-card';
  card.setAttribute('data-product-id', product.id);

  const isAuthenticated = Boolean(appState.currentUser && appState.currentUser.id);
  const realPrice = Math.max(0, Number(product.price) || 0);
  const rawOldPrice = Number(product.oldPrice) || 0;
  const hasDiscount = rawOldPrice > realPrice && realPrice > 0;
  const savingsAmount = hasDiscount ? (rawOldPrice - realPrice) : 0;
  const discountPct = hasDiscount ? Math.round((1 - realPrice / rawOldPrice) * 100) : 0;

  const badgeText = isAuthenticated
    ? (product.badge ? `🔥 ${product.badge}` : (hasDiscount ? `🔥 -${discountPct}% OFF` : '✨ Oficial'))
    : (product.badge ? `🔥 ${product.badge}` : '✨ Fórmula Oficial');

  const commercialZoneHtml = isAuthenticated
    ? `
      <div class="product-price-block symmetrical-price-block">
        <div class="price-main-line">
          <span class="product-price-val">${formatCurrency(realPrice)} <small class="product-price-currency">COP</small></span>
          ${hasDiscount ? `<span class="product-price-old">${formatCurrency(rawOldPrice)}</span>` : ''}
        </div>
        ${hasDiscount
          ? `<span class="product-savings-pill">Ahorras ${formatCurrency(savingsAmount)} (-${discountPct}%)</span>`
          : `<span class="product-savings-pill" style="background:#F3EFE8; color:#57504A; border-color:#E5DDD0;">✓ Precio Oficial Verificado</span>`}
      </div>
      <div class="product-card-actions dual-cta-row">
        <button type="button" class="btn-card-add-cart" onclick="addToCart('${product.id}')">
          🛒 Añadir
        </button>
        <button type="button" class="btn-card-buy-now" onclick="buySingleViaWhatsApp('${product.id}')" title="Comprar producto directamente">
          ⚡ Comprar Ahora
        </button>
      </div>
    `
    : `
      <div class="product-auth-locked-zone">
        <button type="button" class="btn-product-login-unlock" onclick="openAuthModal()">
          <span>🔑 Iniciar sesión</span>
        </button>
      </div>
    `;

  card.innerHTML = `
    <div class="product-thumb-box">
      <img src="${product.image}" alt="${product.name}" class="product-thumb-img" loading="lazy">
      <span class="product-chip-badge">${badgeText}</span>
      <button type="button" class="btn-quick-preview" onclick="openQuickPreviewModal('${product.id}')">👁️ Vista Rápida</button>
    </div>
    <div class="product-card-body">
      <div class="product-meta-top-row">
        <span class="product-brand-tagline">${product.brandName || 'Oficial'}</span>
        <span class="product-stars-mini" title="Calificación verificada 4.9/5">★★★★★ <small>(4.9)</small></span>
      </div>
      <h4 class="product-item-name">${product.name}</h4>
      <p class="product-item-desc">${product.description || ''}</p>
      <div class="product-stock-urgency">
        <span class="stock-dot"></span> Disponible para envío inmediato
      </div>
      ${commercialZoneHtml}
    </div>
  `;

  const thumbBox = card.querySelector('.product-thumb-box');
  if (thumbBox) {
    thumbBox.style.cursor = 'pointer';
    thumbBox.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') {
        openQuickPreviewModal(product.id);
      }
    });
  }
  const titleElem = card.querySelector('.product-item-name');
  if (titleElem) {
    titleElem.style.cursor = 'pointer';
    titleElem.addEventListener('click', () => {
      openQuickPreviewModal(product.id);
    });
  }

  return card;
}

function renderProductsGrid() {
  const container = document.getElementById('all-products-grid');
  const paginationContainer = document.getElementById('catalog-pagination-container');
  if (!container) return;

  let filtered = appState.products.filter(p => p.active !== false);

  // Filtro por marca en el catálogo general
  if (appState.catalogBrandFilter && appState.catalogBrandFilter !== 'all') {
    filtered = filtered.filter(p => p.brandId === appState.catalogBrandFilter || (p.brandName && p.brandName.toLowerCase() === appState.catalogBrandFilter.toLowerCase()));
  }

  // Filtro por categoría inteligente
  if (appState.activeCategory && appState.activeCategory !== 'Todos') {
    const activeCat = appState.activeCategory.toLowerCase();
    filtered = filtered.filter(p => {
      const pCat = (p.category || '').toLowerCase();
      if (activeCat === 'capilar') {
        return pCat.includes('capilar') || pCat.includes('kits') || pCat.includes('alisado') || pCat.includes('rizos');
      }
      if (activeCat === 'facial') return pCat.includes('facial');
      if (activeCat === 'corporal') return pCat.includes('corporal');
      if (activeCat === 'maquillaje') return pCat.includes('maquillaje');
      if (activeCat === 'alisado') return pCat.includes('alisado');
      if (activeCat === 'rizos') return pCat.includes('rizos');
      if (activeCat === 'kits & combos' || activeCat === 'kits') {
        return pCat.includes('kits') || pCat.includes('combo') || p.name.toLowerCase().includes('kit ') || p.name.toLowerCase().includes('dúo');
      }
      return pCat.includes(activeCat);
    });
  }

  // Búsqueda inteligente con soporte de alias (ej. 'caba' busca también 'kaba')
  if (appState.searchQuery) {
    const rawQ = appState.searchQuery.toLowerCase();
    const isCaba = rawQ.includes('caba');
    filtered = filtered.filter(p => {
      const nameMatch = p.name.toLowerCase().includes(rawQ) || (isCaba && p.name.toLowerCase().includes('kaba'));
      const brandMatch = (p.brandName && p.brandName.toLowerCase().includes(rawQ)) || (isCaba && p.brandName && p.brandName.toLowerCase().includes('kaba'));
      const descMatch = (p.description && p.description.toLowerCase().includes(rawQ)) || (isCaba && p.description && p.description.toLowerCase().includes('kaba'));
      const catMatch = (p.category && p.category.toLowerCase().includes(rawQ));
      return nameMatch || brandMatch || descMatch || catMatch;
    });
  }

  container.innerHTML = '';

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-catalog-msg">
        <span class="icon">🔍</span>
        <h3>No se encontraron productos coincidentes</h3>
        <p>Intenta con otra palabra clave o selecciona otra categoría o marca.</p>
      </div>
    `;
    if (paginationContainer) paginationContainer.innerHTML = '';
    return;
  }

  // Paginación diferida (24 productos por tanda para velocidad máxima)
  const totalFiltered = filtered.length;
  const visibleCount = Math.min(appState.page * appState.pageSize, totalFiltered);
  const visibleProducts = filtered.slice(0, visibleCount);

  visibleProducts.forEach(product => {
    container.appendChild(createProductCardElement(product));
  });

  // Renderizar controles de paginación
  if (paginationContainer) {
    if (visibleCount < totalFiltered) {
      const remaining = totalFiltered - visibleCount;
      const nextBatch = Math.min(appState.pageSize, remaining);
      paginationContainer.innerHTML = `
        <p class="pagination-info">Mostrando <strong>${visibleCount}</strong> de <strong>${totalFiltered}</strong> productos principales</p>
        <button class="btn-load-more-products" onclick="loadMoreCatalogProducts()">
          <span>📦 Cargar Más Productos (${nextBatch} más)</span>
        </button>
      `;
    } else if (totalFiltered > appState.pageSize) {
      paginationContainer.innerHTML = `
        <p class="pagination-info" style="color: var(--color-text-muted);">
          ✨ Has visto todos los <strong>${totalFiltered}</strong> productos principales
        </p>
      `;
    } else {
      paginationContainer.innerHTML = '';
    }
  }
}

// Cargar siguiente tanda de productos del catálogo
function loadMoreCatalogProducts() {
  appState.page += 1;
  renderProductsGrid();
}

function renderBrandSelectDropdowns() {
  const filterSelect = document.getElementById('filter-brand-select');
  if (filterSelect) {
    const currentVal = filterSelect.value || 'all';
    const activeProducts = appState.products.filter(p => p.active !== false);
    filterSelect.innerHTML = `<option value="all">🌸 Todas las Marcas (${activeProducts.length})</option>`;
    appState.brands.filter(b => b.active !== false).forEach(b => {
      const count = activeProducts.filter(p => p.brandId === b.id || (p.brandName && p.brandName.toLowerCase() === b.name.toLowerCase())).length;
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.innerText = `${b.name} (${count})`;
      filterSelect.appendChild(opt);
    });
    if (currentVal && Array.from(filterSelect.options).some(o => o.value === currentVal)) {
      filterSelect.value = currentVal;
    }
  }
}

// Modal de vista previa rápida optimizado y sincronizado con estado de autenticación
function openQuickPreviewModal(productId) {
  const product = appState.products.find(p => String(p.id) === String(productId));
  if (!product) return;

  if (typeof BloomTracker !== 'undefined' && typeof BloomTracker.trackProductView === 'function') {
    BloomTracker.trackProductView(product);
  }

  const modal = document.getElementById('quick-preview-modal');
  const modalBody = document.getElementById('quick-preview-body');
  const isAuthenticated = Boolean(appState.currentUser && appState.currentUser.id);

  const realPrice = Math.max(0, Number(product.price) || 0);
  const rawOldPrice = Number(product.oldPrice) || 0;
  const hasDiscount = rawOldPrice > realPrice && realPrice > 0;
  const discountPct = hasDiscount ? Math.round((1 - realPrice / rawOldPrice) * 100) : 0;
  const badgeLabel = isAuthenticated
    ? (product.badge ? '🔥 ' + product.badge : (hasDiscount ? '🔥 -' + discountPct + '% OFF' : '✨ Oficial'))
    : (product.badge ? '🔥 ' + product.badge : '✨ Fórmula Oficial');

  const previewCommercialBlock = isAuthenticated
    ? `
      <div class="quick-preview-symmetrical-price">
        <span>${formatCurrency(realPrice)} <small style="font-size: 0.8rem; color: #8C753A;">COP</small></span>
        ${hasDiscount ? `<span style="font-size: 1.05rem; color: #9CA3AF; text-decoration: line-through; font-weight: 500;">${formatCurrency(rawOldPrice)}</span>` : ''}
        ${hasDiscount ? `<span class="product-savings-pill">Ahorras ${discountPct}%</span>` : '<span class="product-savings-pill" style="background:#F3EFE8; color:#57504A; border-color:#E5DDD0;">✓ Precio Oficial</span>'}
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
        <button type="button" class="btn-card-add-cart" style="padding: 0.85rem 1rem; font-size: 0.95rem;" onclick="addToCart('${product.id}'); closeModal('quick-preview-modal');">
          🛒 Añadir a la Bolsa
        </button>
        <button type="button" class="btn-card-buy-now" style="padding: 0.85rem 1rem; font-size: 0.95rem;" onclick="closeModal('quick-preview-modal'); buySingleViaWhatsApp('${product.id}');">
          ⚡ Comprar Ahora
        </button>
      </div>
    `
    : `
      <div class="quick-preview-login-gate">
        <p>Inicia sesión con tu cuenta para desbloquear los precios exclusivos y realizar tu pedido.</p>
        <button type="button" class="btn-product-login-unlock" onclick="closeModal('quick-preview-modal'); openAuthModal();">
          <span>🔑 Iniciar sesión</span>
        </button>
      </div>
    `;

  if (modal && modalBody) {
    modalBody.innerHTML = `
      <div class="quick-preview-grid">
        <div class="quick-preview-img-box">
          <img src="${product.image}" alt="${product.name}">
          <span class="product-chip-badge">${badgeLabel}</span>
        </div>
        <div class="quick-preview-details">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem;">
            <span class="product-brand-tagline">${product.brandName || 'Oficial'}</span>
            <span style="color: #D4AF37; font-size: 0.85rem; font-weight: 700;">★★★★★ 4.9/5 (Verificado)</span>
          </div>
          <h3 style="font-size: 1.55rem; color: #12100E; margin: 0.25rem 0 0.6rem;">${product.name}</h3>
          <p style="font-size: 0.92rem; color: #4A443E; margin-bottom: 1rem; line-height: 1.6;">${product.description}</p>
          
          <ul class="quick-preview-perks">
            <li>✓ Producto <strong>100% Original</strong> de laboratorio autorizado</li>
            <li>✓ Disponible para <strong>despacho inmediato</strong> a todo el país</li>
            <li>✓ Compra protegida y respaldada en toda Colombia</li>
          </ul>

          ${previewCommercialBlock}
        </div>
      </div>
    `;

    modal.classList.add('active');
    const previewCard = modal.querySelector('.modal-card-box');
    if (previewCard) previewCard.scrollTop = 0;
    modalBody.scrollTop = 0;
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
  if (modalId === 'quick-preview-modal' && typeof BloomTracker !== 'undefined' && typeof BloomTracker.stopCurrentProductTimer === 'function') {
    BloomTracker.stopCurrentProductTimer();
  }
}

// ============================================================================
// CARRITO DE COMPRAS PERSISTENTE & FLUJO DE COMPRA UNIFICADO EN 5 PASOS
// ============================================================================

function addToCart(productId) {
  if (!appState.currentUser || !appState.currentUser.id) {
    openAuthModal();
    showToast('Inicia sesión para consultar precios y agregar productos al carrito');
    return;
  }

  const product = appState.products.find(p => String(p.id) === String(productId));
  if (!product) return;

  const existing = appState.cart.find(item => String(item.id) === String(productId));
  if (existing) {
    existing.quantity += 1;
  } else {
    appState.cart.push({
      id: product.id,
      name: product.name,
      brandName: product.brandName,
      price: product.price,
      image: product.image,
      quantity: 1
    });
  }

  saveCartToStorage();
  renderCart();
  showToast(`🛒 "${product.name}" agregado al carrito`);
}

function removeFromCart(productId) {
  appState.cart = appState.cart.filter(item => String(item.id) !== String(productId));
  saveCartToStorage();
  renderCart();
}

function changeCartQty(productId, delta) {
  const item = appState.cart.find(i => String(i.id) === String(productId));
  if (!item) return;

  item.quantity += delta;
  if (item.quantity <= 0) {
    removeFromCart(productId);
  } else {
    saveCartToStorage();
    renderCart();
  }
}

function getCartPricingBreakdown(items = []) {
  const safeItems = Array.isArray(items) ? items : [];
  const subtotal = safeItems.reduce((acc, curr) => {
    const qty = Math.max(1, Number(curr.quantity) || 1);
    const price = Math.max(0, Number(curr.price) || 0);
    return acc + (price * qty);
  }, 0);

  let discountAmount = 0;
  let couponResult = null;
  if (appState.appliedCouponCode && safeItems.length > 0 && typeof BloomDB !== 'undefined' && typeof BloomDB.validateCoupon === 'function') {
    couponResult = BloomDB.validateCoupon(appState.appliedCouponCode, safeItems);
    if (couponResult && couponResult.valid) {
      discountAmount = Math.min(subtotal, Math.max(0, Math.round(Number(couponResult.discountAmount) || 0)));
    }
  }

  return {
    subtotal,
    discountAmount,
    finalTotal: Math.max(0, subtotal - discountAmount),
    couponResult
  };
}

function applyCartCouponFromUI() {
  const input = document.getElementById('cart-coupon-input');
  const feedback = document.getElementById('cart-coupon-feedback');
  const rawCode = input ? String(input.value || '').trim().toUpperCase() : '';

  if (!rawCode) {
    removeCartCoupon();
    return;
  }

  if (!appState.currentUser || !appState.currentUser.id) {
    appState.appliedCouponCode = rawCode;
    if (feedback) {
      feedback.style.display = 'block';
      feedback.className = 'cart-coupon-feedback ok';
      feedback.innerText = `🎟️ Cupón ${rawCode} guardado. Inicia sesión para aplicarlo a tu bolsa.`;
    }
    showToast(`🎟️ Inicia sesión para redimir el cupón ${rawCode}`);
    return;
  }

  if (appState.cart.length === 0) {
    appState.appliedCouponCode = rawCode;
    if (feedback) {
      feedback.style.display = 'block';
      feedback.className = 'cart-coupon-feedback ok';
      feedback.innerText = `🎟️ Cupón ${rawCode} pre-activado. Agrega productos para calcular tu ahorro.`;
    }
    showToast(`🎟️ Cupón ${rawCode} listo. Agrega productos a tu bolsa`, 'success');
    return;
  }

  if (typeof BloomDB !== 'undefined' && typeof BloomDB.validateCoupon === 'function') {
    const res = BloomDB.validateCoupon(rawCode, appState.cart);
    if (!res || !res.valid) {
      appState.appliedCouponCode = '';
      renderCart();
      if (feedback) {
        feedback.style.display = 'block';
        feedback.className = 'cart-coupon-feedback err';
        feedback.innerText = `⚠️ ${(res && res.message) || 'Cupón no válido o inactivo.'}`;
      }
      showToast((res && res.message) || 'Cupón no válido', 'error');
      return;
    }

    appState.appliedCouponCode = res.code;
    renderCart();
    showToast(`🎉 ${res.message} (-${formatCurrency(res.discountAmount)})`, 'success');
  }
}

function dismissCartUpsell() {
  appState.cartUpsellDismissed = true;
  try { sessionStorage.setItem('bloom_hide_cart_upsell', '1'); } catch (e) {}
  const upsellContainer = document.getElementById('cart-upsell-container');
  if (upsellContainer) upsellContainer.innerHTML = '';
}
window.dismissCartUpsell = dismissCartUpsell;
window.removeFromCart = removeFromCart;
window.changeCartQty = changeCartQty;

function removeCartCoupon() {
  appState.appliedCouponCode = '';
  const input = document.getElementById('cart-coupon-input');
  const feedback = document.getElementById('cart-coupon-feedback');
  if (input) input.value = '';
  if (feedback) {
    feedback.style.display = 'none';
    feedback.innerText = '';
  }
  renderCart();
}

function renderCart() {
  const headerCountEl = document.getElementById('header-cart-count');
  const drawerCountEl = document.getElementById('mobile-drawer-cart-count');
  const floatingCountEl = document.getElementById('floating-cart-count');
  const floatingTotalLabelEl = document.getElementById('floating-cart-total-label');
  const floatingBtnEl = document.getElementById('persistent-floating-cart-btn');
  const itemsContainer = document.getElementById('cart-items-container');
  const totalPriceElem = document.getElementById('cart-total-price');
  const shippingMsgElem = document.getElementById('cart-shipping-msg');
  const shippingFillElem = document.getElementById('cart-shipping-bar-fill');
  const upsellContainer = document.getElementById('cart-upsell-container');
  const couponInput = document.getElementById('cart-coupon-input');
  const couponFeedback = document.getElementById('cart-coupon-feedback');
  const discountRow = document.getElementById('cart-discount-summary-row');
  const discountLabel = document.getElementById('cart-discount-label');
  const discountAmtEl = document.getElementById('cart-discount-amount');

  const isAuthenticated = Boolean(appState.currentUser && appState.currentUser.id);
  const totalItems = isAuthenticated
    ? appState.cart.reduce((acc, curr) => acc + curr.quantity, 0)
    : 0;
  const pricing = isAuthenticated
    ? getCartPricingBreakdown(appState.cart)
    : { subtotal: 0, discountAmount: 0, finalTotal: 0, couponResult: null };
  const totalPrice = pricing.finalTotal;

  if (headerCountEl) headerCountEl.innerText = totalItems;
  if (drawerCountEl) drawerCountEl.innerText = totalItems;
  if (floatingCountEl) floatingCountEl.innerText = totalItems;
  if (floatingTotalLabelEl) {
    if (!isAuthenticated) {
      floatingTotalLabelEl.innerText = 'Iniciar sesión';
    } else {
      floatingTotalLabelEl.innerText = formatCurrency(totalPrice);
    }
  }
  if (floatingBtnEl) {
    floatingBtnEl.classList.toggle('has-items', totalItems > 0);
  }

  if (couponInput && appState.appliedCouponCode && !couponInput.value) {
    couponInput.value = appState.appliedCouponCode;
  }

  if (discountRow) {
    if (isAuthenticated && pricing.discountAmount > 0 && pricing.couponResult) {
      discountRow.style.display = 'flex';
      if (discountLabel) {
        discountLabel.innerHTML = `🎟️ Cupón <strong>${escapeStoreHtml(pricing.couponResult.code)}</strong> (-${pricing.couponResult.discountPercent}%)`;
      }
      if (discountAmtEl) {
        discountAmtEl.innerText = `-${formatCurrency(pricing.discountAmount)}`;
      }
      if (couponFeedback) {
        couponFeedback.style.display = 'block';
        couponFeedback.className = 'cart-coupon-feedback ok';
        couponFeedback.innerHTML = `✓ ${escapeStoreHtml(pricing.couponResult.message)} <button type="button" onclick="removeCartCoupon()" style="background:none;border:none;color:#B91C1C;font-weight:700;cursor:pointer;margin-left:6px;text-decoration:underline;">Quitar</button>`;
      }
    } else {
      discountRow.style.display = 'none';
      if (couponFeedback) {
        if (isAuthenticated && appState.appliedCouponCode && appState.cart.length > 0 && pricing.couponResult && !pricing.couponResult.valid) {
          couponFeedback.style.display = 'block';
          couponFeedback.className = 'cart-coupon-feedback err';
          couponFeedback.innerHTML = `⚠️ ${escapeStoreHtml(pricing.couponResult.message)} <button type="button" onclick="removeCartCoupon()" style="background:none;border:none;color:#6B7280;font-weight:700;cursor:pointer;margin-left:6px;text-decoration:underline;">Limpiar</button>`;
        } else if (!appState.appliedCouponCode) {
          couponFeedback.style.display = 'none';
          couponFeedback.innerText = '';
        }
      }
    }
  }

  if (totalPriceElem) {
    totalPriceElem.innerText = isAuthenticated ? formatCurrency(totalPrice) : 'Inicia sesión';
  }

  // Mini barra de estado en vivo de "Tu Saldo" dentro del carrito
  const miniBar = document.getElementById('cart-balance-mini-bar');
  if (miniBar) {
    if (!isAuthenticated) {
      miniBar.className = 'cart-balance-mini-bar mini-anon';
      miniBar.innerHTML = `
        <span>🔑 Inicia sesión para habilitar precios y compras</span>
        <button type="button" class="btn-cart-mini-action" onclick="toggleCartDrawer(false); openAuthModal();">Iniciar sesión</button>
      `;
    } else {
      const bal = Math.max(0, Number(appState.currentUser.balance) || 0);
      if (totalPrice === 0 || bal >= totalPrice) {
        miniBar.className = 'cart-balance-mini-bar mini-ok';
        miniBar.innerHTML = `
          <span>💎 <strong>Tu Saldo:</strong> ${formatCurrency(bal)}</span>
          <span style="font-weight: 700;">✓ Saldo disponible</span>
        `;
      } else {
        const diff = totalPrice - bal;
        miniBar.className = 'cart-balance-mini-bar mini-low';
        miniBar.innerHTML = `
          <span>💎 <strong>Tu Saldo:</strong> ${formatCurrency(bal)} <small>(Faltan ${formatCurrency(diff)})</small></span>
          <button type="button" class="btn-cart-mini-action" onclick="toggleCartDrawer(false); openRechargeFromCheckout(${diff});">+ Recargar</button>
        `;
      }
    }
  }

  // Barra de progreso para Envío Gratis
  const FREE_SHIPPING_THRESHOLD = Math.max(1000, Number((appState.storeInfo || {}).freeShippingThreshold) || 120000);
  if (shippingMsgElem && shippingFillElem) {
    if (!isAuthenticated) {
      shippingFillElem.style.width = '0%';
      shippingMsgElem.innerHTML = `✨ Inicia sesión para activar tu bolsa de compras y beneficios exclusivos de envío.`;
    } else {
      const pct = Math.min(100, Math.round((totalPrice / FREE_SHIPPING_THRESHOLD) * 100));
      shippingFillElem.style.width = `${pct}%`;
      if (totalPrice === 0) {
        shippingMsgElem.innerHTML = `✨ ¡Agrega tus productos favoritos y desbloquea <strong>ENVÍO GRATIS + Regalo VIP</strong>!`;
      } else if (totalPrice < FREE_SHIPPING_THRESHOLD) {
        const remaining = FREE_SHIPPING_THRESHOLD - totalPrice;
        shippingMsgElem.innerHTML = `🔥 ¡Te faltan solo <strong>${formatCurrency(remaining)}</strong> para tener <strong>ENVÍO GRATIS + Obsequio VIP</strong>!`;
      } else {
        shippingMsgElem.innerHTML = `🎉 ¡Felicidades! Has desbloqueado <strong>ENVÍO PRIORITARIO GRATIS + Obsequio Sorpresa</strong>`;
      }
    }
  }

  // Recomendación inteligente dentro del carrito (opcional y cerrable)
  if (upsellContainer) {
    let hideUpsell = Boolean(appState.cartUpsellDismissed);
    if (!hideUpsell) {
      try { hideUpsell = sessionStorage.getItem('bloom_hide_cart_upsell') === '1'; } catch (e) {}
    }
    if (isAuthenticated && appState.cart.length > 0 && !hideUpsell) {
      const cartIds = new Set(appState.cart.map(i => String(i.id)));
      const upsellCandidate = appState.products.find(p => p.active !== false && !cartIds.has(String(p.id)) && p.price <= 65000);
      if (upsellCandidate) {
        upsellContainer.innerHTML = `
          <div class="cart-upsell-card">
            <div class="upsell-header-row">
              <div class="upsell-header-tag">💡 COMPLEMENTA TU RUTINA</div>
              <button type="button" class="btn-dismiss-upsell" onclick="dismissCartUpsell()" title="Ocultar sugerencia" aria-label="Ocultar sugerencia">✕</button>
            </div>
            <div class="upsell-row">
              <img src="${upsellCandidate.image}" alt="${escapeStoreHtml(upsellCandidate.name)}">
              <div class="upsell-info">
                <h6>${escapeStoreHtml(upsellCandidate.name)}</h6>
                <span>${formatCurrency(upsellCandidate.price)} COP</span>
              </div>
              <button type="button" class="btn-upsell-add" onclick="addToCart('${escapeStoreHtml(String(upsellCandidate.id))}')">+ Sumar</button>
            </div>
          </div>
        `;
      } else {
        upsellContainer.innerHTML = '';
      }
    } else {
      upsellContainer.innerHTML = '';
    }
  }

  if (itemsContainer) {
    if (!isAuthenticated) {
      itemsContainer.innerHTML = `
        <div style="text-align: center; padding: 2.2rem 1.2rem; color: var(--color-text-muted);">
          <span style="font-size: 2.6rem; display: block; margin-bottom: 0.5rem;">🔒</span>
          <p style="font-weight: 700; color: #171412; margin-bottom: 0.4rem;">Inicia sesión para ver precios y armar tu carrito</p>
          <small style="display: block; margin-bottom: 1rem;">Accede a tu cuenta o regístrate en segundos para disfrutar de todos los productos.</small>
          <button type="button" class="btn-product-login-unlock" style="max-width: 240px; margin: 0 auto;" onclick="toggleCartDrawer(false); openAuthModal();">
            <span>🔑 Iniciar sesión</span>
          </button>
        </div>
      `;
    } else if (appState.cart.length === 0) {
      itemsContainer.innerHTML = `
        <div style="text-align: center; padding: 2.2rem 1rem; color: var(--color-text-muted);">
          <span style="font-size: 2.8rem; display: block; margin-bottom: 0.5rem;">🛍️</span>
          <p style="font-weight: 600; color: #171412;">Tu bolsa de compras está vacía</p>
          <small>Explora nuestras marcas oficiales para agregar tus favoritos.</small>
        </div>
      `;
    } else {
      itemsContainer.innerHTML = '';
      appState.cart.forEach(item => {
        const safeId = String(item.id).replace(/'/g, "\\'");
        const qty = Math.max(1, Number(item.quantity) || 1);
        const lineSubtotal = (Number(item.price) || 0) * qty;
        const itemRow = document.createElement('div');
        itemRow.className = 'cart-line-item';
        itemRow.innerHTML = `
          <img src="${item.image}" alt="${escapeStoreHtml(item.name)}" class="cart-thumb-img">
          <div class="cart-item-details">
            <h5 class="cart-item-heading">${escapeStoreHtml(item.name)}</h5>
            <div class="cart-item-meta-row">
              <div class="cart-item-cost">${formatCurrency(lineSubtotal)}</div>
              <div class="cart-quantity-selector">
                <button type="button" class="btn-qty-mod" onclick="changeCartQty('${safeId}', -1)" aria-label="Disminuir cantidad">−</button>
                <span class="qty-val-display">${qty}</span>
                <button type="button" class="btn-qty-mod" onclick="changeCartQty('${safeId}', 1)" aria-label="Aumentar cantidad">+</button>
              </div>
            </div>
          </div>
          <button type="button" class="btn-remove-from-cart" onclick="removeFromCart('${safeId}')" title="Eliminar producto" aria-label="Eliminar producto">✕</button>
        `;
        itemsContainer.appendChild(itemRow);
      });
    }
  }
}

// Desplazamiento suave automático hacia arriba al abrir modales, bolsa de compras o flujo de compra
function autoScrollToModalTop(internalSelectors = []) {
  try {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    window.scrollTo(0, 0);
  }

  const list = Array.isArray(internalSelectors) ? internalSelectors : [internalSelectors];
  list.forEach((item) => {
    if (!item) return;
    const el = typeof item === 'string' ? document.querySelector(item) : item;
    if (el) {
      el.scrollTop = 0;
    }
  });
}

// Control fluido del menú hamburguesa y panel lateral móvil
function toggleMobileMenu(forceOpen = null) {
  const drawer = document.getElementById('mobile-nav-drawer');
  const backdrop = document.getElementById('mobile-nav-backdrop');
  const toggleBtn = document.getElementById('btn-mobile-hamburger');
  const iconEl = document.getElementById('mobile-hamburger-icon');
  if (!drawer || !backdrop) return;

  const isOpen = drawer.classList.contains('active');
  const shouldOpen = forceOpen !== null ? Boolean(forceOpen) : !isOpen;

  drawer.classList.toggle('active', shouldOpen);
  backdrop.classList.toggle('active', shouldOpen);
  drawer.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
  backdrop.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
  document.body.classList.toggle('mobile-menu-open', shouldOpen);

  if (toggleBtn) {
    toggleBtn.classList.toggle('is-active', shouldOpen);
    toggleBtn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    toggleBtn.setAttribute('aria-label', shouldOpen ? 'Cerrar menú de navegación' : 'Abrir menú de navegación');
  }

  if (iconEl) {
    iconEl.classList.toggle('fa-bars', !shouldOpen);
    iconEl.classList.toggle('fa-times', shouldOpen);
  }

  if (shouldOpen) {
    drawer.scrollTop = 0;
  }
}

function navigateFromMobileMenu(event, targetSelector) {
  if (event && event.preventDefault) {
    event.preventDefault();
  }
  toggleMobileMenu(false);

  if (!targetSelector || targetSelector === '#' || targetSelector === '#top') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  const targetEl = document.querySelector(targetSelector);
  if (targetEl) {
    requestAnimationFrame(() => {
      const offsetTop = targetEl.getBoundingClientRect().top + window.pageYOffset - 78;
      window.scrollTo({ top: Math.max(0, offsetTop), behavior: 'smooth' });
    });
  }
}

window.toggleMobileMenu = toggleMobileMenu;
window.navigateFromMobileMenu = navigateFromMobileMenu;
window.autoScrollToModalTop = autoScrollToModalTop;

function toggleCartDrawer(forceOpen = null) {
  toggleMobileMenu(false);

  if ((forceOpen === true || forceOpen === null) && (!appState.currentUser || !appState.currentUser.id)) {
    const panelCheck = document.getElementById('cart-slide-panel');
    if (!panelCheck || !panelCheck.classList.contains('active')) {
      openAuthModal();
      return;
    }
  }

  const panel = document.getElementById('cart-slide-panel');
  const backdrop = document.getElementById('cart-backdrop');
  if (!panel || !backdrop) return;
  
  const isOpen = panel.classList.contains('active');
  const shouldOpen = forceOpen !== null ? forceOpen : !isOpen;

  if (shouldOpen) {
    panel.classList.add('active');
    backdrop.classList.add('active');
    renderCart();
    autoScrollToModalTop([panel, '#cart-body-scroll', '#cart-items-container']);
  } else {
    panel.classList.remove('active');
    backdrop.classList.remove('active');
  }
}

function activateMobileNav(elem) {
  document.querySelectorAll('.mobile-bottom-nav .mobile-nav-item').forEach(el => {
    el.classList.remove('active');
    el.classList.remove('pulse-tap');
  });
  if (elem) {
    elem.classList.add('active');
    elem.classList.add('pulse-tap');
    setTimeout(() => elem.classList.remove('pulse-tap'), 500);
  }
}

let isSubmittingCheckout = false;
let resumeCheckoutAfterAuth = false;
let currentCheckoutWizardStep = 1;

function closeCheckoutWizard() {
  closeModal('checkout-order-modal');
  if (currentCheckoutWizardStep === 5) {
    appState.pendingOrder = null;
    currentCheckoutWizardStep = 1;
  }
}

function updateCheckoutStepperUI(stepNum) {
  currentCheckoutWizardStep = stepNum;
  document.querySelectorAll('#checkout-stepper-bar .checkout-step-pill').forEach((pill) => {
    const pStep = Number(pill.getAttribute('data-step') || 0);
    pill.classList.toggle('active', pStep === stepNum);
    pill.classList.toggle('completed', pStep < stepNum);
  });
  for (let i = 1; i <= 5; i++) {
    const panel = document.getElementById(`checkout-step-panel-${i}`);
    if (panel) {
      panel.classList.toggle('active', i === stepNum);
    }
  }
  const checkoutCard = document.querySelector('#checkout-order-modal .checkout-modal-card');
  const checkoutBody = document.querySelector('#checkout-order-modal .checkout-modal-body');
  if (checkoutCard) checkoutCard.scrollTop = 0;
  if (checkoutBody) checkoutBody.scrollTop = 0;
}

// Renderizar Paso 1 (Verificación de Saldo) y datos base del resumen
async function renderCheckoutBalanceCheck() {
  if (!appState.pendingOrder || !Array.isArray(appState.pendingOrder.items)) return;

  const items = appState.pendingOrder.items;
  const rawSubtotal = items.reduce((acc, i) => acc + (Math.max(0, Number(i.price) || 0) * Math.max(1, Number(i.quantity) || 1)), 0);
  
  // BONIFICACIÓN: 10% DE DESCUENTO ADICIONAL AL PAGAR CON SALDO VIRTUAL
  const walletDiscountPercent = 10;
  const walletDiscountAmount = Math.round(rawSubtotal * (walletDiscountPercent / 100));
  const walletTotal = Math.max(0, rawSubtotal - walletDiscountAmount);
  
  const standardTotal = Math.max(0, Math.round(Number(appState.pendingOrder.total) || rawSubtotal));
  const total = standardTotal;

  const countBadge = document.getElementById('checkout-summary-item-count');
  const itemsContainer = document.getElementById('checkout-summary-items-list');
  const totalElem = document.getElementById('checkout-summary-total');
  const balanceCheckCard = document.getElementById('checkout-balance-check-card');
  const step1NextBtn = document.getElementById('btn-step1-next');

  const totalQty = items.reduce((acc, i) => acc + Math.max(1, Number(i.quantity) || 1), 0);

  if (countBadge) countBadge.innerText = `${totalQty} ${totalQty === 1 ? 'producto' : 'productos'}`;
  if (totalElem) totalElem.innerText = formatCurrency(total);

  if (itemsContainer) {
    itemsContainer.innerHTML = '';
    items.forEach(item => {
      const qty = Math.max(1, Number(item.quantity) || 1);
      const price = Math.max(0, Number(item.price) || 0);
      const row = document.createElement('div');
      row.className = 'summary-item-line';
      row.innerHTML = `
        <span>• ${escapeStoreHtml(item.name)} <strong>(x${qty})</strong> <small style="color:#8C847E;">(${formatCurrency(price)} c/u)</small></span>
        <strong>${formatCurrency(price * qty)}</strong>
      `;
      itemsContainer.appendChild(row);
    });

    const discAmt = Math.max(0, Math.round(Number(appState.pendingOrder.discountAmount) || 0));
    if (discAmt > 0) {
      const discRow = document.createElement('div');
      discRow.className = 'summary-item-line';
      discRow.style.color = '#047857';
      discRow.innerHTML = `
        <span>🎟️ Cupón aplicado <strong>${escapeStoreHtml(appState.pendingOrder.couponCode || appState.appliedCouponCode || '')}</strong></span>
        <strong style="color:#047857;">-${formatCurrency(discAmt)}</strong>
      `;
      itemsContainer.appendChild(discRow);
    }
  }

  syncCurrentUserFromDB();

  if (!appState.currentUser || !appState.currentUser.id) {
    if (balanceCheckCard) {
      // Banner de Beneficio Exclusivo con Saldo Virtual
      const promoBanner = `
      <div style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(212, 175, 55, 0.15) 100%); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 10px; padding: 12px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
        <div>
          <strong style="color: #34D399; font-size: 0.88rem; display: block;">💎 Beneficio VIP: 10% OFF pagando con Tu Saldo</strong>
          <small style="color: #E5E7EB; font-size: 0.78rem;">Pagas solo <strong>${formatCurrency(walletTotal)}</strong> (Ahorras ${formatCurrency(walletDiscountAmount)})</small>
        </div>
        <button type="button" onclick="triggerQuickRechargeModal()" style="background: #10B981; color: #FFF; font-weight: 700; border: none; padding: 6px 12px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; white-space: nowrap;">
          ➕ Recargar
        </button>
      </div>
    `;
      balanceCheckCard.className = 'checkout-balance-check-card balance-warning';
      balanceCheckCard.innerHTML = promoBanner + `
        <div class="balance-check-header">
          <span>🔒 <strong>Sesión requerida para verificar saldo</strong></span>
          <button type="button" class="btn-balance-action-link" onclick="openAuthFromCheckout()">
            🔑 Iniciar sesión
          </button>
        </div>
        <p class="balance-check-desc">Inicia sesión con tu cuenta para verificar Tu Saldo y continuar con tu pedido.</p>
      `;
    }
    if (step1NextBtn) {
      step1NextBtn.disabled = true;
      step1NextBtn.classList.add('disabled');
    }
    return;
  }

  // Verificación Cloud-Ready de Saldo del Usuario
  let verifyResult = null;
  if (typeof BloomDB !== 'undefined' && BloomDB.cloud && typeof BloomDB.cloud.verifyUserBalance === 'function') {
    verifyResult = await BloomDB.cloud.verifyUserBalance({
      customerId: appState.currentUser.id || appState.currentUser.phone || appState.currentUser.email || ('user_' + Date.now()),
      requiredAmount: total
    });
  }

  const currentBalance = verifyResult && verifyResult.success
    ? verifyResult.currentBalance
    : Math.max(0, Math.round(Number(appState.currentUser.balance) || 0));
  const hasEnoughBalance = verifyResult && verifyResult.success
    ? Boolean(verifyResult.sufficient)
    : (currentBalance >= total && items.length > 0);

  if (balanceCheckCard) {
    if (hasEnoughBalance) {
      const remainingBalance = currentBalance - total;
      balanceCheckCard.className = 'checkout-balance-check-card balance-success';
      balanceCheckCard.innerHTML = `
        <div class="wizard-balance-metrics-grid">
          <div class="wizard-bal-metric">
            <small>Tu Saldo Disponible</small>
            <strong style="color: #047857;">${formatCurrency(currentBalance)}</strong>
          </div>
          <div class="wizard-bal-metric">
            <small>Valor de la Compra</small>
            <strong>${formatCurrency(total)}</strong>
          </div>
          <div class="wizard-bal-metric">
            <small>Saldo Restante</small>
            <strong style="color: #996515;">${formatCurrency(remainingBalance)}</strong>
          </div>
        </div>
        <p class="balance-check-desc" style="color: #047857; margin-top: 10px; font-weight: 600;">
          ✓ Saldo verificado exitosamente. Puedes avanzar para confirmar tus datos de entrega.
        </p>
      `;
      if (step1NextBtn) {
        step1NextBtn.disabled = false;
        step1NextBtn.classList.remove('disabled');
      }
    } else {
      const needed = Math.max(0, total - currentBalance);
      balanceCheckCard.className = 'checkout-balance-check-card balance-danger';
      balanceCheckCard.innerHTML = `
        <div class="wizard-balance-metrics-grid">
          <div class="wizard-bal-metric">
            <small>Tu Saldo Disponible</small>
            <strong style="color: #B91C1C;">${formatCurrency(currentBalance)}</strong>
          </div>
          <div class="wizard-bal-metric">
            <small>Total del Pedido</small>
            <strong>${formatCurrency(total)}</strong>
          </div>
          <div class="wizard-bal-metric">
            <small>Saldo Faltante</small>
            <strong style="color: #B91C1C;">${formatCurrency(needed)}</strong>
          </div>
        </div>
        <p class="balance-check-desc" style="color: #991B1B; margin-top: 10px;">
          Tu saldo actual no alcanza para cubrir este pedido. Recarga tu cuenta para continuar.
        </p>
        <div style="margin-top: 10px;">
          <button type="button" class="btn-balance-recharge-trigger" onclick="openRechargeFromCheckout(${needed})">
            ➕ Recargar Saldo (${formatCurrency(Math.max(10000, needed))})
          </button>
        </div>
      `;
      if (step1NextBtn) {
        step1NextBtn.disabled = true;
        step1NextBtn.classList.add('disabled');
      }
    }
  }
}

function populateCheckoutDeliveryFields() {
  if (!appState.currentUser) return;
  const savedPerms = getSavedEntryPermissions();
  const nameInput = document.getElementById('checkout-customer-name');
  const phoneInput = document.getElementById('checkout-customer-phone');
  const emailInput = document.getElementById('checkout-customer-email');
  const deptInput = document.getElementById('checkout-customer-department');
  const cityInput = document.getElementById('checkout-customer-city');
  const addressInput = document.getElementById('checkout-customer-address');

  if (nameInput && !nameInput.value.trim()) nameInput.value = appState.currentUser.username || appState.currentUser.name || '';
  if (phoneInput && !phoneInput.value.trim()) phoneInput.value = appState.currentUser.phone || '';
  if (emailInput && !emailInput.value.trim()) emailInput.value = appState.currentUser.email || '';
  if (deptInput && !deptInput.value.trim()) deptInput.value = appState.currentUser.department || savedPerms.department || '';
  if (cityInput && !cityInput.value.trim()) cityInput.value = appState.currentUser.city || savedPerms.city || '';
  if (addressInput && !addressInput.value.trim() && appState.currentUser.address) {
    addressInput.value = appState.currentUser.address;
  }
}

function goToCheckoutStep(stepNum) {
  if (!appState.pendingOrder) return;

  if (stepNum === 1) {
    renderCheckoutBalanceCheck();
    updateCheckoutStepperUI(1);
    return;
  }

  if (stepNum === 2) {
    syncCurrentUserFromDB();
    const total = Math.max(0, Math.round(Number(appState.pendingOrder.total) || 0));
    const bal = appState.currentUser ? Math.max(0, Math.round(Number(appState.currentUser.balance) || 0)) : 0;
    if (!appState.currentUser || bal < total) {
      showToast('Verifica que cuentas con saldo suficiente antes de continuar', 'error');
      renderCheckoutBalanceCheck();
      return;
    }
    populateCheckoutDeliveryFields();
    updateCheckoutStepperUI(2);
    return;
  }

  if (stepNum === 3) {
    renderCheckoutStep3Summary();
    updateCheckoutStepperUI(3);
    return;
  }

  if (stepNum === 4) {
    renderCheckoutStep4Confirmation();
    updateCheckoutStepperUI(4);
    return;
  }

  if (stepNum === 5) {
    updateCheckoutStepperUI(5);
  }
}

async function validateDeliveryAndGoStep3() {
  const name = (document.getElementById('checkout-customer-name').value || '').trim();
  const phone = (document.getElementById('checkout-customer-phone').value || '').trim();
  const email = (document.getElementById('checkout-customer-email').value || '').trim();
  const department = (document.getElementById('checkout-customer-department').value || '').trim();
  const city = (document.getElementById('checkout-customer-city').value || '').trim();
  const address = (document.getElementById('checkout-customer-address').value || '').trim();
  const notes = (document.getElementById('checkout-customer-notes').value || '').trim();

  if (!name || !phone || !email || !department || !city || !address) {
    showToast('Por favor completa y confirma todos los datos obligatorios de entrega (incluyendo Ciudad, Departamento y Dirección).', 'error');
    return;
  }

  appState.pendingOrder.delivery = {
    name,
    phone,
    email,
    department,
    city,
    address,
    notes
  };

  if (appState.currentUser && typeof BloomDB !== 'undefined' && BloomDB.cloud && typeof BloomDB.cloud.updateDeliveryProfile === 'function') {
    const upd = await BloomDB.cloud.updateDeliveryProfile({
      customerId: appState.currentUser.id,
      name,
      phone,
      email,
      department,
      city,
      address
    });
    if (upd && upd.success && upd.user) {
      appState.currentUser = Object.assign({}, appState.currentUser, upd.user);
      saveCustomerSession(appState.currentUser);
    }
  }

  goToCheckoutStep(3);
}

function renderCheckoutStep3Summary() {
  renderCheckoutBalanceCheck();
  const deliveryBox = document.getElementById('checkout-delivery-review-box');
  if (!deliveryBox || !appState.pendingOrder) return;
  const d = appState.pendingOrder.delivery || {};

  deliveryBox.innerHTML = `
    <div class="delivery-confirmed-summary">
      <h5>📦 Destino de Entrega Confirmado</h5>
      <div class="delivery-summary-grid">
        <div><span>Recibe:</span> <strong>${escapeStoreHtml(d.name || '')}</strong></div>
        <div><span>WhatsApp:</span> <strong>${escapeStoreHtml(d.phone || '')}</strong></div>
        <div><span>Ubicación:</span> <strong>${escapeStoreHtml(d.city || '')}, ${escapeStoreHtml(d.department || '')}</strong></div>
        <div><span>Dirección:</span> <strong>${escapeStoreHtml(d.address || '')}</strong></div>
        ${d.notes ? `<div style="grid-column: 1 / -1;"><span>Notas:</span> <strong>${escapeStoreHtml(d.notes)}</strong></div>` : ''}
      </div>
    </div>
  `;
}

function renderCheckoutStep4Confirmation() {
  const box = document.getElementById('checkout-final-confirmation-box');
  if (!box || !appState.pendingOrder) return;

  syncCurrentUserFromDB();
  const total = Math.max(0, Math.round(Number(appState.pendingOrder.total) || 0));
  const currentBal = appState.currentUser ? Math.max(0, Math.round(Number(appState.currentUser.balance) || 0)) : 0;
  const remaining = Math.max(0, currentBal - total);
  const d = appState.pendingOrder.delivery || {};
  const totalUnits = (appState.pendingOrder.items || []).reduce((acc, i) => acc + Math.max(1, Number(i.quantity) || 1), 0);

  box.innerHTML = `
    <div class="final-confirm-vault-card">
      <div class="final-confirm-row">
        <span>Productos a despachar:</span>
        <strong>${totalUnits} ${totalUnits === 1 ? 'unidad' : 'unidades'}</strong>
      </div>
      <div class="final-confirm-row">
        <span>Entrega en:</span>
        <strong>${escapeStoreHtml(d.address || '')} (${escapeStoreHtml(d.city || '')}, ${escapeStoreHtml(d.department || '')})</strong>
      </div>
      <div class="final-confirm-row">
        <span>Tu Saldo actual:</span>
        <strong>${formatCurrency(currentBal)}</strong>
      </div>
      <div class="final-confirm-row highlight-deduct">
        <span>Total a descontar hoy:</span>
        <strong>-${formatCurrency(total)}</strong>
      </div>
      <div class="final-confirm-row">
        <span>Nuevo saldo tras la compra:</span>
        <strong style="color: #047857;">${formatCurrency(remaining)}</strong>
      </div>
    </div>
  `;
}

function openAuthFromCheckout() {
  resumeCheckoutAfterAuth = true;
  closeModal('checkout-order-modal');
  openAuthModal();
}

function openRechargeFromCheckout(neededAmount = 50000) {
  closeModal('checkout-order-modal');
  if (!appState.currentUser) {
    resumeCheckoutAfterAuth = true;
    openAuthModal();
    return;
  }
  openAuthModal();
  const suggested = Math.max(10000, Math.ceil((Number(neededAmount) || 50000) / 1000) * 1000);
  toggleRechargeDrawer(true, suggested);
}

// Iniciar flujo unificado de compra (desde producto individual o carrito general)
function openCheckoutModal(items, total, orderSource = 'cart') {
  if (!appState.currentUser || !appState.currentUser.id) {
    const normalizedForResume = (Array.isArray(items) ? items : []).map(i => Object.assign({}, i, {
      quantity: Math.max(1, parseInt(i.quantity, 10) || 1),
      price: Math.max(0, Number(i.price) || 0)
    }));
    const pricingResume = getCartPricingBreakdown(normalizedForResume);
    appState.pendingOrder = {
      items: normalizedForResume,
      subtotal: pricingResume.subtotal,
      discountAmount: pricingResume.discountAmount,
      couponCode: pricingResume.discountAmount > 0 ? appState.appliedCouponCode : '',
      total: pricingResume.subtotal > 0 ? pricingResume.finalTotal : Math.max(0, Number(total) || 0),
      orderSource
    };
    resumeCheckoutAfterAuth = true;
    openAuthModal();
    return;
  }

  const normalizedItems = (Array.isArray(items) ? items : []).map(i => Object.assign({}, i, {
    quantity: Math.max(1, parseInt(i.quantity, 10) || 1),
    price: Math.max(0, Number(i.price) || 0)
  }));
  const pricing = getCartPricingBreakdown(normalizedItems);

  appState.pendingOrder = {
    items: normalizedItems,
    subtotal: pricing.subtotal,
    discountAmount: pricing.discountAmount,
    couponCode: pricing.discountAmount > 0 ? appState.appliedCouponCode : '',
    total: pricing.subtotal > 0 ? pricing.finalTotal : Math.max(0, Number(total) || 0),
    orderSource,
    delivery: null
  };

  // Pre-cargar datos registrados del usuario para el Paso 2
  const nameInput = document.getElementById('checkout-customer-name');
  const phoneInput = document.getElementById('checkout-customer-phone');
  const emailInput = document.getElementById('checkout-customer-email');
  const deptInput = document.getElementById('checkout-customer-department');
  const cityInput = document.getElementById('checkout-customer-city');
  const addressInput = document.getElementById('checkout-customer-address');
  const savedPerms = getSavedEntryPermissions();

  if (nameInput) nameInput.value = appState.currentUser.username || appState.currentUser.name || '';
  if (phoneInput) phoneInput.value = appState.currentUser.phone || '';
  if (emailInput) emailInput.value = appState.currentUser.email || '';
  if (deptInput) deptInput.value = appState.currentUser.department || savedPerms.department || '';
  if (cityInput) cityInput.value = appState.currentUser.city || savedPerms.city || '';
  if (addressInput) addressInput.value = appState.currentUser.address || '';

  updateCheckoutStepperUI(1);
  renderCheckoutBalanceCheck();
  toggleMobileMenu(false);

  const modal = document.getElementById('checkout-order-modal');
  if (modal) {
    modal.classList.add('active');
    autoScrollToModalTop([
      modal.querySelector('.checkout-modal-card'),
      modal.querySelector('.checkout-modal-body')
    ]);
  }
}

function buySingleViaWhatsApp(productId) {
  toggleMobileMenu(false);
  if (!appState.currentUser || !appState.currentUser.id) {
    openAuthModal();
    return;
  }
  const product = appState.products.find(p => String(p.id) === String(productId));
  if (!product) return;
  const singleItem = Object.assign({}, product, {
    quantity: 1,
    price: Math.max(0, Number(product.price) || 0)
  });
  openCheckoutModal([singleItem], singleItem.price, 'single');
}

function checkoutViaWhatsApp() {
  toggleMobileMenu(false);
  if (!appState.currentUser || !appState.currentUser.id) {
    toggleCartDrawer(false);
    openAuthModal();
    return;
  }
  if (appState.cart.length === 0) {
    showToast('Tu carrito está vacío. Agrega productos primero.', 'error');
    return;
  }

  const totalPrice = appState.cart.reduce((acc, curr) => acc + ((Number(curr.price) || 0) * (Number(curr.quantity) || 1)), 0);
  toggleCartDrawer(false);
  openCheckoutModal([...appState.cart], totalPrice, 'cart');
}

// Paso 4 -> Paso 5: Confirmación de compra a través del motor Cloud-Ready
async function submitCheckoutOrder(event) {
  if (event) event.preventDefault();
  
  if (window.isSubmittingCheckoutLock) return;
  window.isSubmittingCheckoutLock = true;

  const confirmBtn = document.getElementById('btn-final-confirm-order');
  const originalBtnHtml = confirmBtn ? confirmBtn.innerHTML : '';
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.classList.add('disabled');
    confirmBtn.innerHTML = '<span>⏳ Confirmando tu pedido...</span>';
  }

  const unlockAndRestoreBtn = () => {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.classList.remove('disabled');
      confirmBtn.innerHTML = originalBtnHtml || '<span>✓ Confirmar Compra Ahora</span>';
    }
  };

  try {
    if (!appState.pendingOrder || !appState.pendingOrder.items || appState.pendingOrder.items.length === 0) {
      showToast('No hay productos seleccionados en el pedido', 'error');
      unlockAndRestoreBtn();
      return;
    }

    syncCurrentUserFromDB();
    if (!appState.currentUser || !appState.currentUser.id) {
      openAuthFromCheckout();
      unlockAndRestoreBtn();
      return;
    }

    const delivery = appState.pendingOrder.delivery || {
      name: (document.getElementById('checkout-customer-name').value || '').trim(),
      phone: (document.getElementById('checkout-customer-phone').value || '').trim(),
      email: (document.getElementById('checkout-customer-email').value || '').trim(),
      department: (document.getElementById('checkout-customer-department').value || '').trim(),
      city: (document.getElementById('checkout-customer-city').value || '').trim(),
      address: (document.getElementById('checkout-customer-address').value || '').trim(),
      notes: (document.getElementById('checkout-customer-notes').value || '').trim()
    };

    if (!delivery.name || !delivery.phone || !delivery.email || !delivery.department || !delivery.city || !delivery.address) {
      showToast('Confirma tus datos de entrega antes de finalizar', 'error');
      goToCheckoutStep(2);
      unlockAndRestoreBtn();
      return;
    }

    const purchaseRes = await BloomDB.cloud.confirmUnifiedPurchase({
      customerId: appState.currentUser.id,
      items: appState.pendingOrder.items,
      delivery,
      couponCode: appState.pendingOrder.couponCode || appState.appliedCouponCode || '',
      purchaseOrigin: appState.pendingOrder.orderSource === 'single' ? 'producto_individual' : 'carrito_tienda'
    });

    if (!purchaseRes || !purchaseRes.success) {
      syncCurrentUserFromDB();
      updateAuthCircleState();
      renderCheckoutBalanceCheck();
      goToCheckoutStep(1);
      unlockAndRestoreBtn();
      showToast((purchaseRes && purchaseRes.message) || 'No fue posible confirmar la compra. Verifica tu saldo disponible.', 'error');
      return;
    }

    const confirmedOrder = purchaseRes.order;
    syncCurrentUserFromDB();
    updateAuthCircleState();

    if (typeof BloomTracker !== 'undefined' && typeof BloomTracker.markOrderCompleted === 'function') {
      BloomTracker.markOrderCompleted(confirmedOrder.id);
    }

    if (appState.pendingOrder.orderSource === 'cart') {
      appState.cart = [];
      appState.appliedCouponCode = '';
      const couponInput = document.getElementById('cart-coupon-input');
      if (couponInput) couponInput.value = '';
      saveCartToStorage();
    }
    renderCart();

    const receiptBox = document.getElementById('checkout-success-receipt-box');
    if (receiptBox) {
      receiptBox.innerHTML = `
        <div class="success-receipt-grid">
          <div><span>Referencia:</span> <strong>${escapeStoreHtml(confirmedOrder.id)}</strong></div>
          <div><span>Hora exacta:</span> <strong>${escapeStoreHtml(confirmedOrder.exactTime || '')}</strong></div>
          ${confirmedOrder.discountAmount > 0 ? `<div><span>Ahorro Cupón (${escapeStoreHtml(confirmedOrder.couponCode || '')}):</span> <strong style="color:#047857;">-${formatCurrency(confirmedOrder.discountAmount)}</strong></div>` : ''}
          <div><span>Total pagado:</span> <strong>${formatCurrency(confirmedOrder.total)}</strong></div>
          <div><span>Saldo disponible:</span> <strong style="color:#047857;">${formatCurrency(purchaseRes.newBalance)}</strong></div>
          <div style="grid-column: 1 / -1;"><span>Destino:</span> <strong>${escapeStoreHtml(delivery.address)} — ${escapeStoreHtml(delivery.city)}, ${escapeStoreHtml(delivery.department)}</strong></div>
        </div>
      `;
    }

    unlockAndRestoreBtn();
    goToCheckoutStep(5);
    showToast('✅ Tu pedido será despachado en breve', 'success');
  } finally {
    window.isSubmittingCheckoutLock = false;
  }
}

// ============================================================================
// SISTEMA DE PRESENCIA Y MONITOREO DE USUARIOS EN LÍNEA EN TIEMPO REAL
// ============================================================================
let visitorSessionId = sessionStorage.getItem('bb_visitor_sid');
if (!visitorSessionId) {
  visitorSessionId = 'v_' + Math.random().toString(36).substring(2, 9);
  sessionStorage.setItem('bb_visitor_sid', visitorSessionId);
}

function sendPresencePing() {
  if (typeof document !== 'undefined' && document.hidden) return; // Ahorro estricto de batería cuando la pestaña está en segundo plano
  try {
    const payload = {
      id: visitorSessionId,
      timestamp: Date.now(),
      page: appState.selectedBrandId ? 'Catálogo: ' + appState.selectedBrandId : (appState.activeCategory !== 'Todos' ? 'Categoría: ' + appState.activeCategory : 'Página Principal'),
      cartCount: (appState.cart || []).reduce((acc, i) => acc + i.quantity, 0)
    };
    localStorage.setItem('bb_presence_' + visitorSessionId, JSON.stringify(payload));
  } catch (e) {}
}

window.addEventListener('beforeunload', () => {
  try {
    localStorage.removeItem('bb_presence_' + visitorSessionId);
  } catch (e) {}
});

// Sincronización instantánea entre pestañas (catálogo, usuarios, saldos, recargas, ofertas y reseñas)
window.addEventListener('storage', (e) => {
  if (!e.key) return;
  if (
    e.key === STORAGE_KEY ||
    e.key === 'bloom_customers_registry_v4' ||
    e.key === 'bloom_recharge_requests_v4' ||
    e.key === 'bloom_beauty_orders' ||
    e.key === 'bloom_beauty_offers' ||
    e.key === 'bloom_beauty_reviews' ||
    e.key === 'bloom_beauty_db_ping' ||
    e.key === 'bloom_customer_current_user'
  ) {
    loadDataFromStorage();
    renderApp();
    renderReviewsDynamic();
    updateAuthCircleState();
    refreshOpenModalsRealTime();
  }
});

// ============================================================================
// ESCUCHADORES DE EVENTOS
// ============================================================================

function closeLiveSearchDropdown() {
  const dropdown = document.getElementById('live-search-dropdown');
  if (dropdown) {
    dropdown.classList.remove('active');
    dropdown.innerHTML = '';
  }
}

function selectLiveSearchBrand(brandId) {
  closeLiveSearchDropdown();
  openBrandCatalog(brandId);
}

function selectLiveSearchProduct(productId) {
  closeLiveSearchDropdown();
  openQuickPreviewModal(productId);
}

function viewAllLiveSearchResults() {
  const searchInput = document.getElementById('global-search-input');
  const qRaw = searchInput ? searchInput.value.trim() : '';
  const q = qRaw.toLowerCase();
  closeLiveSearchDropdown();
  if (!q) {
    openAllProductsCatalog();
    return;
  }
  const matches = appState.products.filter(p =>
    p.active !== false && (
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.brandName && p.brandName.toLowerCase().includes(q)) ||
      (p.category && p.category.toLowerCase().includes(q)) ||
      (p.description && p.description.toLowerCase().includes(q))
    )
  );
  openCustomFilteredCatalog({
    title: `Resultados para "${qRaw}"`,
    subtitle: `${matches.length} ${matches.length === 1 ? 'producto encontrado' : 'productos encontrados'} en nuestro catálogo oficial.`,
    tag: '🔍 Búsqueda Inteligente',
    productsList: matches
  });
}

function bindEventListeners() {
  const searchInput = document.getElementById('global-search-input');
  const searchDropdown = document.getElementById('live-search-dropdown');

  if (searchInput) {
    let searchDebounceTimer = null;

    const renderLiveSearch = (queryVal) => {
      const qRaw = String(queryVal || '').trim();
      const q = qRaw.toLowerCase();
      if (!searchDropdown) return;

      if (!q) {
        closeLiveSearchDropdown();
        return;
      }

      const brandMatches = appState.brands.filter(b =>
        b.active !== false && (
          b.name.toLowerCase().includes(q) ||
          (b.category && b.category.toLowerCase().includes(q)) ||
          (b.tagline && b.tagline.toLowerCase().includes(q))
        )
      ).slice(0, 3);

      const productMatches = appState.products.filter(p =>
        p.active !== false && (
          p.name.toLowerCase().includes(q) ||
          (p.brandName && p.brandName.toLowerCase().includes(q)) ||
          (p.category && p.category.toLowerCase().includes(q)) ||
          (p.description && p.description.toLowerCase().includes(q))
        )
      );

      const isLoggedIn = Boolean(appState.currentUser && appState.currentUser.id);
      let html = '';

      if (brandMatches.length > 0) {
        html += `<div class="live-search-header"><span>👑 Marcas Oficiales</span><span>${brandMatches.length}</span></div>`;
        brandMatches.forEach(b => {
          html += `
            <div class="search-result-item" onclick="selectLiveSearchBrand('${escapeStoreHtml(b.id)}')">
              <img src="${escapeStoreHtml(b.logo || 'imagenes/logo-bloom-hd.png')}" alt="${escapeStoreHtml(b.name)}">
              <div class="search-result-meta">
                <strong>${escapeStoreHtml(b.name)}</strong>
                <small>${escapeStoreHtml(b.tagline || b.category || 'Ver línea completa')}</small>
              </div>
              <span class="search-result-price">Ver marca &rarr;</span>
            </div>
          `;
        });
      }

      if (productMatches.length > 0) {
        html += `<div class="live-search-header"><span>🛍️ Productos</span><span>${productMatches.length} hallados</span></div>`;
        productMatches.slice(0, 6).forEach(p => {
          const priceLabel = isLoggedIn ? formatCurrency(p.price) : '🔒 VIP';
          html += `
            <div class="search-result-item" onclick="selectLiveSearchProduct('${escapeStoreHtml(String(p.id))}')">
              <img src="${escapeStoreHtml(p.image || 'imagenes/logo-bloom-hd.png')}" alt="${escapeStoreHtml(p.name)}">
              <div class="search-result-meta">
                <strong>${escapeStoreHtml(p.name)}</strong>
                <small>${escapeStoreHtml(p.brandName || 'Bloom Beauty')} • ${escapeStoreHtml(p.category || 'Cuidado')}</small>
              </div>
              <span class="search-result-price">${priceLabel}</span>
            </div>
          `;
        });
        html += `
          <div style="padding: 8px 12px; background: #FAF7F2; text-align: center; border-top: 1px solid rgba(212,175,55,0.16);">
            <button type="button" onclick="viewAllLiveSearchResults()" style="background:none; border:none; color:#996515; font-weight:800; font-size:0.8rem; cursor:pointer; width:100%; padding:4px 0;">
              🔍 Ver los ${productMatches.length} resultados en pantalla completa &rarr;
            </button>
          </div>
        `;
      }

      if (!html) {
        html = `
          <div class="search-empty-msg">
            No encontramos coincidencias exactas para <strong>"${escapeStoreHtml(qRaw)}"</strong>.<br>
            <button type="button" onclick="closeLiveSearchDropdown(); openAllProductsCatalog();" style="margin-top:8px; background:none; border:none; color:#996515; font-weight:700; cursor:pointer; text-decoration:underline;">
              Explorar todo el catálogo multimarca &rarr;
            </button>
          </div>
        `;
      }

      searchDropdown.innerHTML = html;
      searchDropdown.classList.add('active');
    };

    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchDebounceTimer);
      const val = e.target.value;
      searchDebounceTimer = setTimeout(() => renderLiveSearch(val), 110);
    });

    searchInput.addEventListener('focus', () => {
      if (searchInput.value.trim().length > 0) {
        renderLiveSearch(searchInput.value);
      }
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        viewAllLiveSearchResults();
      } else if (e.key === 'Escape') {
        closeLiveSearchDropdown();
      }
    });

    document.addEventListener('click', (ev) => {
      if (!ev.target.closest('.header-search')) {
        closeLiveSearchDropdown();
      }
    });
  }

  const catPills = document.querySelectorAll('.category-pill');
  catPills.forEach(pill => {
    pill.addEventListener('click', () => {
      catPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      appState.activeCategory = pill.getAttribute('data-cat') || 'Todos';
      appState.page = 1;
      renderProductsGrid();
      sendPresencePing();
    });
  });

  const filterBrandSelect = document.getElementById('filter-brand-select');
  if (filterBrandSelect) {
    filterBrandSelect.addEventListener('change', (e) => {
      appState.catalogBrandFilter = e.target.value;
      appState.page = 1;
      renderProductsGrid();
    });
  }

  const sortSelect = document.getElementById('sort-products-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'price-asc') {
        appState.products.sort((a, b) => a.price - b.price);
      } else if (val === 'price-desc') {
        appState.products.sort((a, b) => b.price - a.price);
      } else if (val === 'name-asc') {
        appState.products.sort((a, b) => a.name.localeCompare(b.name));
      }
      renderProductsGrid();
    });
  }

  const contactForm = document.getElementById('contact-lead-form');
  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('lead-name').value.trim();
      const phone = document.getElementById('lead-phone').value.trim();
      const message = document.getElementById('lead-message').value.trim();

      const msg = `¡Hola *Bloom Beauty*! 🌸\n\nMi nombre es *${name}*.\n📱 Mi teléfono de contacto es: ${phone}\n\n💬 Mensaje: ${message}`;
      const url = `https://wa.me/57${appState.storeInfo.phone || '3135143012'}?text=${encodeURIComponent(msg)}`;
      window.open(url, '_blank');
      contactForm.reset();
      showToast('📩 Abriendo WhatsApp para enviar tu mensaje...', 'success');
    });
  }

  document.querySelectorAll('.modal-overlay-bg').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('active');
      }
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      toggleMobileMenu(false);
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 960) {
      toggleMobileMenu(false);
    }
  });

  // Iniciar monitoreo de presencia
  sendPresencePing();
  setInterval(sendPresencePing, 2500);
}

// ============================================================================
// MOTOR DE CONVERSIÓN AVANZADO: MÁS VENDIDOS, COMPRA POR OBJETIVO & QUIZ CAPILAR
// ============================================================================

function renderBestsellers(tabFilter = 'top') {
  const container = document.getElementById('bestsellers-grid');
  if (!container) return;

  const activeProducts = appState.products.filter(p => p.active !== false);
  let selected = [];

  if (tabFilter === 'shampoo') {
    selected = activeProducts.filter(p => {
      const text = (p.name + ' ' + (p.description || '')).toLowerCase();
      return text.includes('shampoo') || text.includes('tónico') || text.includes('tonico') || text.includes('cebolla') || text.includes('biotina');
    });
  } else if (tabFilter === 'kits') {
    selected = activeProducts.filter(p => {
      const text = (p.name + ' ' + (p.category || '')).toLowerCase();
      return text.includes('kit') || text.includes('dúo') || text.includes('duo') || text.includes('protocolo') || text.includes('combo');
    });
  } else if (tabFilter === 'tratamientos') {
    selected = activeProducts.filter(p => {
      const text = (p.name + ' ' + (p.description || '')).toLowerCase();
      return text.includes('tratamiento') || text.includes('mascarilla') || text.includes('termoprotector') || text.includes('skala') || text.includes('repolariza') || text.includes('poción');
    });
  } else {
    // Top 8 absolutos: priorizar productos con badge o de marcas diversas líderes
    const withBadge = activeProducts.filter(p => p.badge);
    selected = withBadge.length >= 8 ? withBadge : activeProducts;
  }

  container.innerHTML = '';
  selected.slice(0, 8).forEach(product => {
    container.appendChild(createProductCardElement(product));
  });
}

function filterBestsellers(tabFilter, btnElem) {
  document.querySelectorAll('.bestseller-tab').forEach(b => b.classList.remove('active'));
  if (btnElem) btnElem.classList.add('active');
  renderBestsellers(tabFilter);
}

function quickSearchTerm(term) {
  const searchInput = document.getElementById('global-search-input');
  if (searchInput) {
    searchInput.value = term;
  }
  const q = term.trim().toLowerCase();
  const bMatch = appState.brands.find(b => 
    b.active !== false && (
      b.name.toLowerCase().includes(q) ||
      (b.category && b.category.toLowerCase().includes(q))
    )
  );
  if (bMatch) {
    openBrandCatalog(bMatch.id);
  } else {
    const pMatch = appState.products.find(p => 
      p.active !== false && (
        p.name.toLowerCase().includes(q) ||
        (p.brandName && p.brandName.toLowerCase().includes(q))
      )
    );
    if (pMatch) {
      openBrandCatalog(pMatch.brandId);
    } else {
      navigateToBrands();
    }
  }
  showToast(`🔍 Explorando productos de "${term}"`);
}

function filterBySmartGoal(goalKey) {
  const goalConfigs = {
    crecimiento: {
      title: '🌱 Crecimiento & Anticaída Multimarca',
      subtitle: 'Tónicos aceleradores, biotina, terapia de cebolla y shampoos estimulantes de raíz de nuestras mejores marcas.',
      tag: '🌱 Objetivo Capilar',
      keywords: ['crecimiento', 'caída', 'caida', 'tónico', 'tonico', 'cebolla', 'biotina', 'acelerador', 'antifrizz y crecimiento', 'romero', 'jengibre'],
      fallbackBrand: 'milagros'
    },
    repolarizacion: {
      title: '✨ Repolarización & Rescate Extremo',
      subtitle: 'Tratamientos SOS intensivos para hebras procesadas, decoloradas, con puntas abiertas o daño térmico.',
      tag: '✨ Reparación Profunda',
      keywords: ['repolariza', 'emergencia', 'rescate', 'repara', 'reconstruc', 'queratina', 'aminoácido', 'aminoacido', 'nutrición', 'poción', 'posion', 'mascarilla'],
      fallbackBrand: 'la-posion'
    },
    alisado: {
      title: '🌿 Alisado Orgánico & Efecto Espejo',
      subtitle: 'Keratinas orgánicas libres de formol, termoprotectores profesionales y selladores anti-humedad.',
      tag: '🌿 Control Frizz & Liso',
      keywords: ['alisad', 'keratina', 'orgánic', 'organic', 'termoprotector', 'frizz', 'liso', 'leche pal pelo', 'ritual', 'seda', 'brillo'],
      fallbackBrand: 'ritual-botanico'
    },
    rizos: {
      title: '🌀 Ondas, Rizos & Afro (Método Curly)',
      subtitle: 'Cremas veganas 2 en 1, definidores de rizos, geles sin alcohol y nutrición profunda para ondas y afro.',
      tag: '🌀 Definición & Curly',
      keywords: ['rizos', 'ondas', 'afro', 'cachos', 'skala', 'etniker', 'definidor', 'crema para peinar', 'vegano', 'coco'],
      fallbackBrand: 'skala'
    },
    facial: {
      title: '🧖‍♀️ Skincare, Corporal & Maquillaje Pro',
      subtitle: 'Protectores solares ligeros, sueros despigmentantes, maquillaje de alta fijación y rituales corporales.',
      tag: '🧖‍♀️ Piel & Maquillaje',
      keywords: ['facial', 'solar', 'corporal', 'piel', 'rostro', 'maquillaje', 'despigmentante', 'engol', 'hada', 'serum', 'jabón', 'exfoliante', 'labial', 'rubor', 'fijador'],
      fallbackBrand: 'kaba'
    },
    kits: {
      title: '🎁 Kits Completos & Rutinas de Ahorro',
      subtitle: 'Protocolos completos listos para transformar tu rutina o regalar con precio preferencial.',
      tag: '🎁 Kits & Dúos VIP',
      keywords: ['kit', 'dúo', 'duo', 'combo', 'rutina', 'protocolo', 'pack', 'trío', 'trio'],
      fallbackBrand: 'magic-hair'
    }
  };

  const cfg = goalConfigs[goalKey];
  if (!cfg) {
    openBrandCatalog('milagros');
    return;
  }

  const activeProducts = appState.products.filter(p => p.active !== false);
  const matches = activeProducts.filter(p => {
    const text = `${p.name || ''} ${p.category || ''} ${p.description || ''} ${p.brandName || ''}`.toLowerCase();
    if (goalKey === 'facial' && (p.category === 'Maquillaje' || p.category === 'Cuidado Corporal' || p.category === 'Cuidado Facial')) {
      return true;
    }
    if (goalKey === 'kits' && p.category === 'Kits y Rutinas') {
      return true;
    }
    return cfg.keywords.some(kw => text.includes(kw));
  });

  if (matches.length > 0) {
    openCustomFilteredCatalog({
      title: cfg.title,
      subtitle: cfg.subtitle,
      tag: cfg.tag,
      productsList: matches
    });
  } else {
    openBrandCatalog(cfg.fallbackBrand);
  }
}

// ============================================================================
// TEST DE DIAGNÓSTICO CAPILAR & FACIAL INTERACTIVO (2 PASOS)
// ============================================================================
let currentQuizGoal = 'crecimiento';

function selectQuizStep1(goal) {
  currentQuizGoal = goal;
  const step1 = document.getElementById('quiz-step-1');
  const step2 = document.getElementById('quiz-step-2');
  const step2Options = document.getElementById('quiz-step2-options');

  if (!step1 || !step2 || !step2Options) return;

  const subOptionsMap = {
    crecimiento: [
      { id: 'kit', icon: '🎁', title: 'Kit Completo Acelerador', desc: 'Shampoo + Tratamiento + Tónico para máxima velocidad' },
      { id: 'shampoo', icon: '🧴', title: 'Shampoo o Tónico Individual', desc: 'Para fortalecer la raíz en cada lavada' },
      { id: 'botanico', icon: '🌿', title: 'Terapia de Cebolla / Biotina', desc: 'Estimulación natural sin olor y brillo extremo' },
      { id: 'todo', icon: '✨', title: 'Ver Los Mejores de Crecimiento', desc: 'Muéstrame los favoritos número #1 en ventas' }
    ],
    reparacion: [
      { id: 'decolorado', icon: '🧪', title: 'Cabello Tinturado o Decolorado', desc: 'Rescate intensivo de hebras procesadas' },
      { id: 'puntas', icon: '✂️', title: 'Puntas Abiertas y Resequedad', desc: 'Repolarización 360 y sellado de cutícula' },
      { id: 'calor', icon: '🔥', title: 'Uso Frecuente de Plancha/Secador', desc: 'Termoprotección avanzada y proteína' },
      { id: 'todo', icon: '💎', title: 'Protocolos Completos SOS', desc: 'Recuperación total desde la primera aplicación' }
    ],
    hidratacion: [
      { id: 'rizos', icon: '🌀', title: 'Ondas y Rizos (Método Curly)', desc: 'Definición suave, cremas 1Kg y cero peso' },
      { id: 'liso', icon: '✨', title: 'Cabello Liso con Frizz', desc: 'Efecto espejo, nutrición y control humedad' },
      { id: 'mascarilla', icon: '🥥', title: 'Mascarillas & Mantecas Veganas', desc: 'Hidratación profunda de larga duración' },
      { id: 'todo', icon: '👑', title: 'Ver Top Hidratación & Frizz', desc: 'Selección multimarca recomendada' }
    ],
    piel: [
      { id: 'solar', icon: '☀️', title: 'Protección Solar & Antiedad', desc: 'Textura ligera sin grasa y control de brillo' },
      { id: 'manchas', icon: '✨', title: 'Despigmentantes & Tónicos', desc: 'Unifica el tono de la piel y aporta luminosidad' },
      { id: 'maquillaje', icon: '💄', title: 'Maquillaje Profesional & Glow', desc: 'Alta pigmentación, fijadores y acabado de lujo' },
      { id: 'corporal', icon: '🌸', title: 'Cuidado Corporal & Fragancias', desc: 'Piel suave, luminosa y perfumada todo el día' }
    ]
  };

  const options = subOptionsMap[goal] || subOptionsMap.crecimiento;
  step2Options.innerHTML = options.map(opt => `
    <button type="button" class="quiz-option-btn" onclick="selectQuizStep2('${opt.id}')">
      <span class="quiz-opt-icon">${opt.icon}</span>
      <strong>${opt.title}</strong>
      <small>${opt.desc}</small>
    </button>
  `).join('');

  step1.style.display = 'none';
  step2.style.display = 'block';
}

function selectQuizStep2(subChoice) {
  const step2 = document.getElementById('quiz-step-2');
  const resultsView = document.getElementById('quiz-results-view');
  const grid = document.getElementById('quiz-recommended-grid');
  const headline = document.getElementById('quiz-result-headline');

  if (!step2 || !resultsView || !grid) return;

  const activeProducts = appState.products.filter(p => p.active !== false);
  let matches = [];

  if (currentQuizGoal === 'crecimiento') {
    if (headline) headline.innerText = '🌱 Tu Rutina Ideal de Crecimiento & Anticaída';
    matches = activeProducts.filter(p => {
      const t = (p.name + ' ' + (p.description || '') + ' ' + (p.brandName || '')).toLowerCase();
      if (subChoice === 'kit') return (t.includes('kit') || t.includes('dúo') || t.includes('protocolo')) && (t.includes('crecimiento') || t.includes('milagros') || t.includes('magic') || t.includes('anyeluz'));
      if (subChoice === 'botanico') return t.includes('cebolla') || t.includes('anyeluz') || t.includes('biotina');
      return t.includes('crecimiento') || t.includes('caída') || t.includes('caida') || t.includes('tónico') || t.includes('milagros') || t.includes('kaba');
    });
  } else if (currentQuizGoal === 'reparacion') {
    if (headline) headline.innerText = '✨ Tu Tratamiento SOS de Repolarización & Rescate';
    matches = activeProducts.filter(p => {
      const t = (p.name + ' ' + (p.description || '') + ' ' + (p.brandName || '')).toLowerCase();
      if (subChoice === 'calor') return t.includes('leche pal pelo') || t.includes('termoprotector') || t.includes('alisado');
      return t.includes('repolariza') || t.includes('poción') || t.includes('posion') || t.includes('emergencia') || t.includes('repara') || t.includes('milagros');
    });
  } else if (currentQuizGoal === 'hidratacion') {
    if (headline) headline.innerText = '🌀 Tu Selección para Control Frizz, Nutrición & Rizos';
    matches = activeProducts.filter(p => {
      const t = (p.name + ' ' + (p.description || '') + ' ' + (p.category || '')).toLowerCase();
      if (subChoice === 'rizos') return t.includes('skala') || t.includes('etniker') || t.includes('rizos') || t.includes('cachos');
      if (subChoice === 'liso') return t.includes('ritual') || t.includes('leche pal pelo') || t.includes('alisado') || t.includes('keratina');
      return t.includes('skala') || t.includes('hidrat') || t.includes('mascarilla') || t.includes('etniker');
    });
  } else {
    if (headline) headline.innerText = '🧖‍♀️ Tu Rutina de Cuidado Facial, Corporal & Maquillaje';
    matches = activeProducts.filter(p => {
      const t = (p.name + ' ' + (p.description || '') + ' ' + (p.category || '')).toLowerCase();
      if (subChoice === 'maquillaje') return t.includes('engol') || t.includes('maquillaje');
      if (subChoice === 'corporal') return t.includes('corporal') || t.includes('hada');
      return t.includes('facial') || t.includes('solar') || t.includes('kaba') || t.includes('piel');
    });
  }

  if (matches.length < 4) {
    const extras = activeProducts.filter(p => !matches.includes(p));
    matches = matches.concat(extras);
  }

  grid.innerHTML = '';
  matches.slice(0, 4).forEach(prod => {
    grid.appendChild(createProductCardElement(prod));
  });

  step2.style.display = 'none';
  resultsView.style.display = 'block';
  showToast('✨ ¡Hemos encontrado los 4 productos ideales para ti!', 'success');
}

function resetQuiz() {
  const step1 = document.getElementById('quiz-step-1');
  const step2 = document.getElementById('quiz-step-2');
  const resultsView = document.getElementById('quiz-results-view');
  if (step1) step1.style.display = 'block';
  if (step2) step2.style.display = 'none';
  if (resultsView) resultsView.style.display = 'none';
}

function dismissLiveSalesPopup() {
  const popup = document.getElementById('live-sales-popup');
  if (popup) {
    popup.classList.remove('visible');
    sessionStorage.setItem('bb_hide_live_sales', '1');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}




// ============================================================================
// VINCULACIÓN DINÁMICA DE RESEÑAS CON BLOOMDB & FORMULARIO DIRECTO
// ============================================================================
function selectInlineRating(stars) {
  const input = document.getElementById('inline-selected-rating');
  const badge = document.getElementById('inline-star-feedback');
  if (input) input.value = stars;

  const starElements = document.querySelectorAll('#inline-star-row .interactive-star');
  starElements.forEach((s, idx) => {
    if (idx < stars) {
      s.classList.add('active');
    } else {
      s.classList.remove('active');
    }
  });

  const texts = {
    1: '1.0 / 5.0 (Malo)',
    2: '2.0 / 5.0 (Regular)',
    3: '3.0 / 5.0 (Bueno)',
    4: '4.0 / 5.0 (Muy Bueno)',
    5: '5.0 / 5.0 (¡Excelente!)'
  };
  if (badge) badge.innerText = texts[stars] || `${stars}.0 / 5.0`;
}

function submitInlineReview(e) {
  e.preventDefault();
  const author = (document.getElementById('inline-review-name').value || '').trim();
  const city = (document.getElementById('inline-review-city').value || '').trim();
  const productOrSubject = (document.getElementById('inline-review-product').value || '').trim() || 'Experiencia General';
  const comment = (document.getElementById('inline-review-comment').value || '').trim();
  const rating = Number(document.getElementById('inline-selected-rating').value) || 5;

  if (!author || !city || !comment) {
    showToast('Por favor completa todos los campos requeridos', 'error');
    return;
  }

  if (typeof BloomDB !== 'undefined') {
    BloomDB.addReview({
      author: author,
      city: city,
      productOrSubject: productOrSubject,
      comment: comment,
      rating: rating,
      verified: true
    });
  }

  document.getElementById('inline-review-form').reset();
  selectInlineRating(5);
  renderReviewsDynamic();
  showToast('🎉 ¡Gracias por tu calificación! Tu opinión se ha publicado y guardado en el sistema.', 'success');
}

function ensureInitialReviewsSeed() {
  if (typeof BloomDB === 'undefined') return;
  try {
    if (localStorage.getItem('bloom_beauty_reviews') === null) {
      const seedReviews = [
        {
          id: 'rev_seed_1',
          author: 'Valentina Gómez',
          city: 'Medellín',
          productOrSubject: 'Emergencia Capilar • Milagros',
          comment: '¡Mi cabello volvió a la vida desde la primera aplicación! El pedido llegó súper rápido y todo 100% original con sello intacto.',
          rating: 5,
          verified: true,
          date: new Date().toLocaleDateString('es-CO')
        },
        {
          id: 'rev_seed_2',
          author: 'Camila Restrepo',
          city: 'Bogotá D.C.',
          productOrSubject: 'Bio-Mascarilla • Kaba',
          comment: 'Me encantó la asesoría personalizada y la facilidad de recargar Tu Saldo por Nequi. Mi cabello quedó brillante y sin frizz.',
          rating: 5,
          verified: true,
          date: new Date().toLocaleDateString('es-CO')
        },
        {
          id: 'rev_seed_3',
          author: 'Daniela Morales',
          city: 'Cali',
          productOrSubject: 'Kit Crecimiento • Magic Hair',
          comment: 'Llevo 3 semanas usando la rutina completa y ya veo pelitos nuevos en la raíz. Excelente atención de Bloom Beauty.',
          rating: 5,
          verified: true,
          date: new Date().toLocaleDateString('es-CO')
        }
      ];
      localStorage.setItem('bloom_beauty_reviews', JSON.stringify(seedReviews));
    }
  } catch (e) {}
}

function renderReviewsDynamic() {
  ensureInitialReviewsSeed();

  // Auto-completar datos si el usuario tiene sesión iniciada
  if (appState.currentUser) {
    const nameInput = document.getElementById('inline-review-name');
    const cityInput = document.getElementById('inline-review-city');
    if (nameInput && !nameInput.value) nameInput.value = appState.currentUser.username || appState.currentUser.name || '';
    if (cityInput && !cityInput.value) cityInput.value = appState.currentUser.city || '';
  }

  const container = document.getElementById('reviews-feed-container');
  const countBadge = document.getElementById('reviews-feed-counter');
  const avgScoreEl = document.getElementById('reviews-avg-score');
  if (!container || typeof BloomDB === 'undefined') return;

  const reviews = BloomDB.getReviews() || [];
  if (countBadge) {
    countBadge.innerText = `${reviews.length} ${reviews.length === 1 ? 'opinión verificada' : 'opiniones verificadas'}`;
  }
  if (avgScoreEl) {
    if (reviews.length > 0) {
      const sum = reviews.reduce((acc, r) => acc + Math.max(1, Math.min(5, Number(r.rating) || 5)), 0);
      avgScoreEl.innerText = `${(sum / reviews.length).toFixed(1)} ★`;
    } else {
      avgScoreEl.innerText = '5.0 ★';
    }
  }

  if (reviews.length === 0) {
    container.innerHTML = `
      <div class="reviews-empty-state">
        <span style="font-size: 2.2rem; display: block; margin-bottom: 0.5rem;">🌸</span>
        <h4>Sé la primera en compartir tu experiencia</h4>
        <p>Califica con 5 estrellas y publica tu reseña verificada en un clic.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  reviews.forEach(r => {
    const card = document.createElement('div');
    card.className = 'review-luxury-card';
    const ratingNum = Math.max(1, Math.min(5, Number(r.rating) || 5));
    const stars = '★'.repeat(ratingNum) + '☆'.repeat(5 - ratingNum);
    const initials = (r.author || 'CB').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

    card.innerHTML = `
      <div class="review-top-meta">
        <span class="review-stars">${stars}</span>
        ${r.verified ? '<span class="verified-buyer-pill">✓ Compra Verificada</span>' : ''}
      </div>
      <p class="review-quote">"${escapeStoreHtml(r.comment || '')}"</p>
      <div class="review-author-row">
        <div class="review-avatar">${escapeStoreHtml(initials)}</div>
        <div>
          <strong>${escapeStoreHtml(r.author || 'Cliente')}</strong>
          <small>${escapeStoreHtml(r.city || 'Colombia')} • ${escapeStoreHtml(r.productOrSubject || 'Compra Verificada')}</small>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  if (window.BloomFX && typeof window.BloomFX.refresh === 'function') {
    window.BloomFX.refresh();
  }
}

// Escuchar cambios de BloomDB para recargar reseñas en vivo
if (typeof BloomDB !== 'undefined') {
  BloomDB.subscribe((msg) => {
    if (msg.type === 'REVIEWS_UPDATED') {
      renderReviewsDynamic();
    }
  });
}

// ============================================================================
// SISTEMA DE RESEÑAS INTERACTIVAS CLIENTE & REPORTE DE BUGS
// ============================================================================

function openStoreReviewModal() {
  toggleMobileMenu(false);
  const modal = document.getElementById('store-review-modal');
  if (modal) {
    document.getElementById('store-review-user-form').reset();
    setPickerRating(5);
    modal.classList.add('active');
    autoScrollToModalTop([modal.querySelector('.modal-card-box')]);
  }
}

function setPickerRating(stars) {
  const ratingInput = document.getElementById('user-selected-rating');
  const label = document.getElementById('star-rating-text-feedback');
  if (ratingInput) ratingInput.value = stars;

  const starElements = document.querySelectorAll('#star-rating-selector .star-pick');
  starElements.forEach((s, idx) => {
    if (idx < stars) {
      s.classList.add('active');
    } else {
      s.classList.remove('active');
    }
  });

  const texts = {
    1: '1.0 de 5 estrellas (Malo - No me gustó)',
    2: '2.0 de 5 estrellas (Regular)',
    3: '3.0 de 5 estrellas (Bueno)',
    4: '4.0 de 5 estrellas (Muy Bueno)',
    5: '5.0 de 5 estrellas (¡Excelente experiencia!)'
  };
  if (label) label.innerText = texts[stars] || `${stars}.0 de 5 estrellas`;
}

function submitStoreReviewFromModal(e) {
  e.preventDefault();
  const author = document.getElementById('review-author-input').value.trim();
  const city = document.getElementById('review-city-input').value.trim();
  const productOrSubject = document.getElementById('review-product-input').value.trim() || 'Experiencia General';
  const comment = document.getElementById('review-comment-input').value.trim();
  const rating = Number(document.getElementById('user-selected-rating').value) || 5;

  if (typeof BloomDB !== 'undefined') {
    BloomDB.addReview({
      author: author,
      city: city,
      productOrSubject: productOrSubject,
      comment: comment,
      rating: rating,
      verified: true
    });
  }

  closeModal('store-review-modal');
  renderReviewsDynamic();
  showToast('🎉 ¡Muchas gracias por tu reseña! Ha sido publicada con éxito.', 'success');

  // Registrar en telemetría
  if (typeof BloomTracker !== 'undefined') {
    BloomTracker.logAction('Publicó Reseña', `${author} calificó con ${rating} estrellas`);
  }
}

// ----------------------------------------------------------------------------
// REPORTE DE BUGS & SOPORTE TÉCNICO
// ----------------------------------------------------------------------------
function submitStoreBugReport(e) {
  e.preventDefault();
  const description = document.getElementById('bug-user-desc').value.trim();

  if (typeof BloomDB !== 'undefined' && typeof BloomDB.addBugReport === 'function') {
    BloomDB.addBugReport({
      name: appState.currentUser ? appState.currentUser.name : 'Visitante Web',
      phone: appState.currentUser ? appState.currentUser.phone : 'Enviado directo desde la web',
      issueType: 'Reporte de Bug / Fallo',
      description: description,
      deviceInfo: `${navigator.userAgent} (${window.innerWidth}x${window.innerHeight})`,
      pageUrl: window.location.href
    });
  }

  if (typeof BloomTracker !== 'undefined') {
    BloomTracker.logAction('Reporte de Bug', description.slice(0, 60));
  }

  const storePhone = formatStoreWhatsAppNumber(appState.storeInfo && appState.storeInfo.phone);
  let msg = `🛠️ *REPORTE DE SOPORTE TÉCNICO — BLOOM BEAUTY* 🛠️\n`;
  msg += `----------------------------------------\n`;
  msg += `📝 *Detalle del Inconveniente:* ${description}\n`;
  msg += `📱 *Dispositivo:* ${navigator.userAgent.slice(0, 85)}\n`;
  msg += `----------------------------------------\n`;
  msg += `Hola soporte Bloom Beauty, comparto este detalle en la página web para revisión. ¡Muchas gracias!`;

  const url = `https://wa.me/${storePhone}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');

  document.getElementById('store-bug-report-form').reset();
  showToast('✅ ¡Reporte enviado a soporte técnico! Lo revisaremos de inmediato.', 'success');
}

// ============================================================================
// FLUJO DE ENTRADA (PASO 1 UBICACIÓN -> PASO 2 NOTIFICACIONES) & ALERTAS VIP
// ============================================================================
const ENTRY_PERMISSIONS_KEY = 'bloom_entry_permissions_v6';
let pendingEntryLocation = {
  city: '',
  department: '',
  lat: null,
  lon: null,
  locationGranted: false
};

function getSavedEntryPermissions() {
  try {
    const raw = localStorage.getItem(ENTRY_PERMISSIONS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {
    completed: false,
    city: '',
    department: '',
    locationGranted: false,
    notificationsGranted: false
  };
}

function matchDepartmentOption(regionName) {
  if (!regionName) return '';
  const select = document.getElementById('entry-department-input');
  if (!select) return regionName;
  const clean = String(regionName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  for (const opt of Array.from(select.options)) {
    if (!opt.value) continue;
    const optClean = opt.value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (clean.includes(optClean) || optClean.includes(clean)) {
      return opt.value;
    }
  }
  if (clean.includes('bogota') || clean.includes('distrito')) return 'Bogotá D.C.';
  return 'Otro / Nacional';
}


function saveEntryPermissions(perms) {
  try {
    localStorage.setItem(ENTRY_PERMISSIONS_KEY, JSON.stringify(perms));
  } catch (e) {}
  if (typeof BloomTracker !== 'undefined' && typeof BloomTracker.updatePermissions === 'function') {
    BloomTracker.updatePermissions(perms);
  }
}

function initEntryPermissionsFlow() {
  document.body.classList.remove('entry-gate-locked');

  // Ocultar cualquier modal de selección de ubicación y permisos de entrada
  const entryModal = document.getElementById('entry-permissions-modal');
  if (entryModal) {
    entryModal.style.display = 'none';
    entryModal.remove();
  }

  // Establecer permisos completados por defecto sin pedirle nada al usuario
  saveEntryPermissions({
    completed: true,
    city: 'Colombia',
    department: 'Nacional',
    lat: null,
    lon: null,
    locationGranted: true,
    notificationsGranted: false
  });
}


async function requestBrowserLocationStep() {
  const btn = document.getElementById('btn-detect-gps-location');
  const statusEl = document.getElementById('entry-gps-status-msg');
  const deptSelect = document.getElementById('entry-department-input');
  const cityInput = document.getElementById('entry-city-input');

  const showStatus = (txt, isOk = true) => {
    if (!statusEl) return;
    statusEl.style.display = 'block';
    statusEl.className = `entry-gps-status-msg ${isOk ? 'status-ok' : 'status-info'}`;
    statusEl.innerText = txt;
  };

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Solicitando permiso de ubicación...</span>';
  }

  const restoreBtn = (label) => {
    if (!btn) return;
    btn.disabled = false;
    btn.innerHTML = `<span>${label}</span>`;
  };

  const applyDetectedGeo = (cityVal, regionVal, latVal = null, lonVal = null, viaGps = true) => {
    const matchedDept = matchDepartmentOption(regionVal);
    if (deptSelect && matchedDept) deptSelect.value = matchedDept;
    if (cityInput && cityVal) cityInput.value = cityVal;
    pendingEntryLocation.city = cityVal || (cityInput ? cityInput.value : '');
    pendingEntryLocation.department = matchedDept || regionVal || '';
    pendingEntryLocation.lat = latVal;
    pendingEntryLocation.lon = lonVal;
    pendingEntryLocation.locationGranted = Boolean(viaGps);
    showStatus(`✓ Ubicación detectada: ${cityVal || 'Tu zona'}${matchedDept ? ', ' + matchedDept : ''}. Confirma abajo para continuar.`, true);
    restoreBtn('✓ Ubicación detectada correctamente');
  };

  const fallbackIpDetection = async () => {
    try {
      const resp = await fetch('https://ipapi.co/json/');
      if (resp.ok) {
        const data = await resp.json();
        if (data && (data.city || data.region)) {
          applyDetectedGeo(data.city || '', data.region || '', data.latitude || null, data.longitude || null, false);
          return true;
        }
      }
    } catch (e) {}
    return false;
  };

  if (!navigator.geolocation) {
    const okIp = await fallbackIpDetection();
    if (!okIp) {
      showStatus('Selecciona tu Departamento y escribe tu Ciudad abajo para continuar.', false);
      restoreBtn('🧭 Seleccionar ubicación manualmente');
    }
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      pendingEntryLocation.lat = latitude;
      pendingEntryLocation.lon = longitude;
      pendingEntryLocation.locationGranted = true;

      try {
        const revResp = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=es`);
        if (revResp.ok) {
          const rev = await revResp.json();
          const detectedCity = rev.city || rev.locality || '';
          const detectedDept = rev.principalSubdivision || '';
          applyDetectedGeo(detectedCity, detectedDept, latitude, longitude, true);
          return;
        }
      } catch (e) {}

      const okIp = await fallbackIpDetection();
      if (!okIp) {
        showStatus('✓ Permiso concedido. Confirma tu Ciudad y Departamento para continuar.', true);
        restoreBtn('✓ Permiso de ubicación activo');
      }
    },
    async () => {
      const okIp = await fallbackIpDetection();
      if (!okIp) {
        showStatus('Indícanos tu Departamento y Ciudad abajo para brindarte cobertura exacta.', false);
        restoreBtn('🧭 Reintentar permiso de ubicación');
      }
    },
    { enableHighAccuracy: false, timeout: 7000, maximumAge: 60000 }
  );
}

function completeEntryStep1Location() {
  const deptSelect = document.getElementById('entry-department-input');
  const cityInput = document.getElementById('entry-city-input');
  const department = (deptSelect ? deptSelect.value : '').trim();
  const city = (cityInput ? cityInput.value : '').trim();

  if (!department || !city) {
    showToast('Por favor indícanos tu Ciudad y Departamento para continuar al Paso 2.', 'error');
    if (!department && deptSelect) deptSelect.focus();
    else if (!city && cityInput) cityInput.focus();
    return;
  }

  pendingEntryLocation.city = city;
  pendingEntryLocation.department = department;

  // Pasar inmediatamente al Paso 2 (Notificaciones)
  const step1 = document.getElementById('entry-step-1-location');
  const step2 = document.getElementById('entry-step-2-notifications');
  const dot1 = document.getElementById('entry-step-dot-1');
  const dot2 = document.getElementById('entry-step-dot-2');

  if (step1) step1.style.display = 'none';
  if (step2) step2.style.display = 'block';
  if (dot1) {
    dot1.classList.remove('active');
    dot1.classList.add('done');
  }
  if (dot2) dot2.classList.add('active');

  if (typeof BloomTracker !== 'undefined' && typeof BloomTracker.logAction === 'function') {
    BloomTracker.logAction('Permiso Paso 1 (Ubicación)', `Confirmó ubicación: ${city}, ${department}`);
  }
}

async function completeEntryStep2Notifications(wantsNotifications = true) {
  let granted = false;

  if (wantsNotifications) {
    if (typeof Notification !== 'undefined' && typeof Notification.requestPermission === 'function') {
      try {
        const perm = await Notification.requestPermission();
        granted = (perm === 'granted' || perm === 'default');
        if (perm === 'denied') {
          // Aún mantenemos alertas personalizadas dentro de la tienda si el usuario aceptó en nuestro flujo
          granted = true;
        }
      } catch (e) {
        granted = true;
      }
    } else {
      granted = true;
    }
  }

  const finalPerms = {
    completed: true,
    city: pendingEntryLocation.city || 'Colombia',
    department: pendingEntryLocation.department || 'Nacional',
    lat: pendingEntryLocation.lat,
    lon: pendingEntryLocation.lon,
    locationGranted: Boolean(pendingEntryLocation.locationGranted || pendingEntryLocation.city),
    notificationsGranted: Boolean(wantsNotifications && granted),
    completedAt: new Date().toISOString()
  };

  try {
    localStorage.setItem(ENTRY_PERMISSIONS_KEY, JSON.stringify(finalPerms));
  } catch (e) {}

  // Pre-rellenar ciudad y departamento en registro
  const regCity = document.getElementById('reg-city');
  const regDept = document.getElementById('reg-department');
  if (regCity && !regCity.value) regCity.value = finalPerms.city;
  if (regDept && !regDept.value) regDept.value = finalPerms.department;

  const modal = document.getElementById('entry-permissions-modal');
  if (modal) modal.style.display = 'none';
  document.body.classList.remove('entry-gate-locked');

  if (typeof BloomTracker !== 'undefined' && typeof BloomTracker.updatePermissions === 'function') {
    BloomTracker.updatePermissions(Object.assign({}, finalPerms, {
      triggerWelcomeAlert: finalPerms.notificationsGranted
    }));
    BloomTracker.logAction(
      'Permiso Paso 2 (Notificaciones)',
      finalPerms.notificationsGranted ? 'Activó alertas personalizadas' : 'Continuó sin alertas automáticas'
    );
  }

  showToast(`✨ ¡Bienvenida desde ${finalPerms.city}! Explora nuestro catálogo oficial.`, 'success');
}

function initPersonalizedAlertsListener() {
  window.addEventListener('bloom:personalized-alert', (ev) => {
    const detail = ev && ev.detail;
    if (!detail || !detail.title) return;

    const container = document.getElementById('personalized-alert-container');
    if (!container) return;

    const card = document.createElement('div');
    card.className = 'personalized-alert-card';
    card.innerHTML = `
      <div class="personalized-alert-icon">🔔</div>
      <div class="personalized-alert-content">
        <strong>${escapeStoreHtml(detail.title)}</strong>
        <p>${escapeStoreHtml(detail.body || '')}</p>
      </div>
      <button type="button" class="personalized-alert-close" aria-label="Cerrar alerta">✕</button>
    `;

    card.querySelector('.personalized-alert-close').addEventListener('click', (e) => {
      e.stopPropagation();
      card.remove();
    });

    card.addEventListener('click', () => {
      if (detail.productId) {
        openQuickPreviewModal(detail.productId);
      } else if (!appState.currentUser) {
        openAuthModal();
      }
      card.remove();
    });

    container.prepend(card);
    while (container.children.length > 2) {
      container.lastElementChild.remove();
    }

    setTimeout(() => {
      if (card.parentNode) {
        card.style.opacity = '0';
        card.style.transform = 'translateY(-10px)';
        setTimeout(() => card.remove(), 300);
      }
    }, 9000);
  });
}

// ============================================================================
// SISTEMA DE AUTENTICACIÓN CLOUD-READY, SEGURIDAD Y "TU SALDO" (v6)
// ============================================================================
const CUSTOMERS_DB_KEY = 'bloom_customers_registry_v4';

function escapeStoreHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeStorePhone(phone) {
  if (typeof BloomDB !== 'undefined' && typeof BloomDB.normalizePhone === 'function') {
    return BloomDB.normalizePhone(phone);
  }
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('57')) return digits.slice(2);
  return digits;
}

function formatStoreWhatsAppNumber(phone) {
  const digits = String(phone || '3135143012').replace(/\D/g, '');
  if (!digits) return '573135143012';
  return (digits.length > 10 && digits.startsWith('57')) ? digits : ('57' + digits);
}

function getStoredCustomers() {
  if (typeof BloomDB !== 'undefined' && typeof BloomDB.getCustomers === 'function') {
    return BloomDB.getCustomers();
  }
  try {
    const raw = localStorage.getItem(CUSTOMERS_DB_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveStoredCustomers(list) {
  if (typeof BloomDB !== 'undefined' && typeof BloomDB.saveCustomers === 'function') {
    return BloomDB.saveCustomers(list);
  }
  try {
    localStorage.setItem(CUSTOMERS_DB_KEY, JSON.stringify(list));
  } catch (e) {}
}

function showAuthInlineAlert(message, type = 'error') {
  const box = document.getElementById('auth-inline-alert');
  if (!box) return;
  box.className = `auth-inline-alert alert-${type}`;
  box.innerText = message;
  box.style.display = 'block';
}

function clearAuthInlineAlert() {
  const box = document.getElementById('auth-inline-alert');
  if (box) {
    box.style.display = 'none';
    box.innerText = '';
  }
}

function togglePasswordVisibility(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (btnEl) btnEl.innerText = '🙈';
  } else {
    input.type = 'password';
    if (btnEl) btnEl.innerText = '👁️';
  }
}

function updateAuthCircleState() {
  const btn = document.getElementById('btn-auth-circle');
  const avatar = document.getElementById('auth-circle-avatar');
  const pill = document.getElementById('header-balance-pill');
  const pillAmount = document.getElementById('header-balance-amount');
  const drawerAccTitle = document.getElementById('mobile-drawer-account-title');
  const drawerAccSub = document.getElementById('mobile-drawer-account-sub');

  if (appState.currentUser) {
    const bal = Math.max(0, Math.round(Number(appState.currentUser.balance) || 0));
    const displayName = (appState.currentUser.username || appState.currentUser.name || 'Cliente VIP').trim();
    if (btn && avatar) {
      btn.classList.add('is-logged');
      const firstLetter = (displayName || 'U').charAt(0).toUpperCase();
      avatar.textContent = firstLetter;
      btn.title = `Hola, ${displayName} • Tu Saldo: ${formatCurrency(bal)}`;
    }
    if (pill && pillAmount) {
      pillAmount.innerText = formatCurrency(bal);
      pill.style.display = 'inline-flex';
    }
    if (drawerAccTitle) drawerAccTitle.innerText = `Hola, ${displayName}`;
    if (drawerAccSub) drawerAccSub.innerText = `💎 Tu Saldo: ${formatCurrency(bal)}`;
  } else {
    if (btn && avatar) {
      btn.classList.remove('is-logged');
      avatar.innerHTML = '<i class="fas fa-user" aria-hidden="true"></i>';
      btn.title = 'Mi Cuenta / Iniciar Sesión';
    }
    if (pill) {
      pill.style.display = 'none';
    }
    if (drawerAccTitle) drawerAccTitle.innerText = 'Iniciar Sesión / Mi Cuenta';
    if (drawerAccSub) drawerAccSub.innerText = 'Desbloquea precios exclusivos y Tu Saldo';
  }
}

function renderAuthLoggedProfile() {
  if (!appState.currentUser) return;

  const displayName = appState.currentUser.username || appState.currentUser.name || 'Cliente VIP';
  const firstLetter = displayName.trim().charAt(0).toUpperCase();
  const avatarBig = document.getElementById('auth-profile-avatar-big');
  if (avatarBig) avatarBig.innerText = firstLetter;

  const nameEl = document.getElementById('auth-profile-name');
  if (nameEl) nameEl.innerText = displayName;

  const emailEl = document.getElementById('auth-profile-email');
  if (emailEl) emailEl.innerText = appState.currentUser.email || '';

  const phoneEl = document.getElementById('auth-profile-phone');
  if (phoneEl) phoneEl.innerText = appState.currentUser.phone || 'No registrado';

  const cityEl = document.getElementById('auth-profile-city');
  if (cityEl) {
    const locParts = [appState.currentUser.city, appState.currentUser.department].filter(Boolean);
    cityEl.innerText = locParts.length > 0 ? locParts.join(', ') : 'No registrada';
  }

  const bal = Math.max(0, Math.round(Number(appState.currentUser.balance) || 0));
  const balanceEl = document.getElementById('auth-profile-balance');
  if (balanceEl) {
    balanceEl.innerText = formatCurrency(bal);
  }

  const topTitle = document.getElementById('auth-topbar-title-text');
  if (topTitle) {
    topTitle.innerText = `Cuenta VIP • ${formatCurrency(bal)}`;
  }

  // Solicitudes de recarga en revisión
  const pendingBox = document.getElementById('auth-pending-recharges-box');
  if (pendingBox && typeof BloomDB !== 'undefined' && typeof BloomDB.getRechargeRequests === 'function') {
    const myPending = BloomDB.getRechargeRequests().filter(r =>
      r.status === 'Pendiente' && String(r.customerId) === String(appState.currentUser.id)
    );
    if (myPending.length > 0) {
      const totalPending = myPending.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
      pendingBox.style.display = 'block';
      pendingBox.innerHTML = `⏳ <strong>Solicitud de recarga en verificación:</strong> ${formatCurrency(totalPending)} (${myPending.length} ${myPending.length === 1 ? 'solicitud' : 'solicitudes'}). Se abonará a <strong>Tu Saldo</strong> automáticamente tras su validación.`;
    } else {
      pendingBox.style.display = 'none';
      pendingBox.innerHTML = '';
    }
  }

  // Seguimiento en tiempo real de Pedidos & Despachos del Cliente
  const ordersBox = document.getElementById('auth-orders-history-box');
  const ordersList = document.getElementById('auth-orders-history-list');
  if (ordersBox && ordersList && typeof BloomDB !== 'undefined' && typeof BloomDB.getCustomerOrders === 'function') {
    const myOrders = BloomDB.getCustomerOrders(appState.currentUser) || [];
    if (myOrders.length === 0) {
      ordersBox.style.display = 'none';
      ordersList.innerHTML = '';
    } else {
      ordersBox.style.display = 'block';
      ordersList.innerHTML = myOrders.slice(0, 6).map(ord => {
        const stRaw = String(ord.status || 'Por Despachar').toLowerCase();
        let pillClass = 'pending';
        let statusIcon = '⏳';
        if (stRaw.includes('despachado') && !stRaw.includes('por')) {
          pillClass = 'shipped';
          statusIcon = '🚚';
        } else if (stRaw.includes('confirmado')) {
          pillClass = 'confirmed';
          statusIcon = '✅';
        }
        const itemsArr = Array.isArray(ord.items) ? ord.items : [];
        const unitsCount = itemsArr.reduce((acc, it) => acc + Math.max(1, Number(it.quantity) || 1), 0);
        const firstItemName = itemsArr[0] ? itemsArr[0].name : 'Productos Bloom';
        const summaryTxt = itemsArr.length > 1
          ? `${firstItemName} +${itemsArr.length - 1} más (${unitsCount} uds)`
          : `${firstItemName} (${unitsCount} ${unitsCount === 1 ? 'ud' : 'uds'})`;

        return `
          <div class="vip-order-track-card">
            <div class="vip-order-top">
              <strong>${escapeStoreHtml(ord.id || 'ORD')}</strong>
              <span class="vip-order-status-pill ${pillClass}">${statusIcon} ${escapeStoreHtml(ord.status || 'Por Despachar')}</span>
            </div>
            <div style="font-size:0.77rem; color:#4A443F; font-weight:600; margin-bottom:3px;">
              ${escapeStoreHtml(summaryTxt)}
            </div>
            <div class="vip-order-meta">
              <span>${escapeStoreHtml(ord.exactTime || ord.date || '')}</span>
              <strong style="color:#996515;">${formatCurrency(ord.total || 0)}</strong>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // Últimos movimientos de Tu Saldo
  const txBox = document.getElementById('auth-transactions-box');
  const txList = document.getElementById('auth-transactions-list');
  const txs = Array.isArray(appState.currentUser.transactions) ? appState.currentUser.transactions : [];
  if (txBox && txList) {
    if (txs.length === 0) {
      txBox.style.display = 'none';
      txList.innerHTML = '';
    } else {
      txBox.style.display = 'block';
      txList.innerHTML = txs.slice(0, 6).map(tx => {
        const amt = Number(tx.amount) || 0;
        const isPos = amt >= 0;
        const sign = isPos ? '+' : '-';
        return `
          <div class="auth-tx-row">
            <div class="auth-tx-meta">
              <span>${escapeStoreHtml(tx.note || (isPos ? 'Recarga de saldo' : 'Compra en tienda'))}</span>
              <small>${escapeStoreHtml(tx.dateFormatted || '')} • Saldo: ${formatCurrency(tx.newBalance || 0)}</small>
            </div>
            <div class="${isPos ? 'auth-tx-pos' : 'auth-tx-neg'}">${sign}${formatCurrency(Math.abs(amt))}</div>
          </div>
        `;
      }).join('');
    }
  }
}

let isAuthMinimized = false;

function triggerQuickRechargeModal() {
  syncCurrentUserFromDB();
  if (!appState.currentUser) {
    openAuthModal();
    showAuthInlineAlert('Inicia sesión o regístrate para recargar Tu Saldo.', 'info');
    showToast('Inicia sesión para recargar Tu Saldo', 'info');
    return;
  }
  openAuthModal();
  setTimeout(() => {
    toggleRechargeDrawer(true);
    const box = document.getElementById('auth-recharge-form-box');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 120);
}

function openAuthModal() {
  toggleMobileMenu(false);
  const modal = document.getElementById('auth-customer-modal');
  const body = document.getElementById('auth-modal-body-content');
  const minIcon = document.getElementById('auth-minimize-icon');
  if (!modal) return;

  clearAuthInlineAlert();
  syncCurrentUserFromDB();
  updateAuthCircleState();

  isAuthMinimized = false;
  modal.classList.remove('is-minimized');
  if (body) body.classList.remove('minimized');
  if (minIcon) minIcon.innerText = '🗕';

  const anonView = document.getElementById('auth-anonymous-view');
  const loggedView = document.getElementById('auth-logged-view');
  const topTitle = document.getElementById('auth-topbar-title-text');

  if (appState.currentUser) {
    if (anonView) anonView.style.display = 'none';
    if (loggedView) loggedView.style.display = 'block';
    const rechargeBox = document.getElementById('auth-recharge-form-box');
    if (rechargeBox) rechargeBox.style.display = 'none';
    renderAuthLoggedProfile();
  } else {
    if (topTitle) topTitle.innerText = 'Acceso Exclusivo Bloom';
    if (anonView) anonView.style.display = 'block';
    if (loggedView) loggedView.style.display = 'none';
    switchAuthTab('login');
  }

  modal.classList.add('active');
  autoScrollToModalTop(['#auth-modal-card-box', body]);
}

function closeAuthModal() {
  const modal = document.getElementById('auth-customer-modal');
  if (modal) modal.classList.remove('active', 'is-minimized');
  isAuthMinimized = false;
  clearAuthInlineAlert();
}

function toggleAuthMinimize() {
  const modal = document.getElementById('auth-customer-modal');
  const body = document.getElementById('auth-modal-body-content');
  const minIcon = document.getElementById('auth-minimize-icon');
  if (!modal || !body) return;

  isAuthMinimized = !isAuthMinimized;
  if (isAuthMinimized) {
    modal.classList.add('is-minimized');
    body.classList.add('minimized');
    if (minIcon) minIcon.innerText = '🗖';
  } else {
    modal.classList.remove('is-minimized');
    body.classList.remove('minimized');
    if (minIcon) minIcon.innerText = '🗕';
  }
}

function handleAuthOverlayClick(e) {
  if (e.target && e.target.id === 'auth-customer-modal' && !isAuthMinimized) {
    closeAuthModal();
  }
}

function switchAuthTab(tab) {
  clearAuthInlineAlert();
  const loginBtn = document.getElementById('tab-btn-login');
  const regBtn = document.getElementById('tab-btn-register');
  const loginForm = document.getElementById('customer-login-form');
  const regForm = document.getElementById('customer-register-form');

  if (tab === 'login') {
    if (loginBtn) loginBtn.classList.add('active');
    if (regBtn) regBtn.classList.remove('active');
    if (loginForm) loginForm.classList.add('active');
    if (regForm) regForm.classList.remove('active');
  } else {
    if (loginBtn) loginBtn.classList.remove('active');
    if (regBtn) regBtn.classList.add('active');
    if (loginForm) loginForm.classList.remove('active');
    if (regForm) regForm.classList.add('active');

    // Autocompletar Ciudad y Departamento si ya se confirmaron en el Paso 1
    const perms = getSavedEntryPermissions();
    const regCity = document.getElementById('reg-city');
    const regDept = document.getElementById('reg-department');
    if (regCity && !regCity.value && perms.city) regCity.value = perms.city;
    if (regDept && !regDept.value && perms.department) regDept.value = perms.department;
  }
}

// Inicio de sesión Cloud-Ready (Correo electrónico o Teléfono + Contraseña)
async function handleCustomerLogin(e) {
  e.preventDefault();
  clearAuthInlineAlert();

  const identifier = (document.getElementById('login-email').value || '').trim();
  const password = document.getElementById('login-password').value || '';
  const submitBtn = document.getElementById('btn-auth-login-submit');

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳ Validando credenciales...</span>';
  }

  try {
    const authRes = await BloomDB.cloud.loginUser({
      identifier,
      password
    });

    if (!authRes || !authRes.success || !authRes.user) {
      showAuthInlineAlert((authRes && authRes.message) || 'No fue posible iniciar sesión. Verifica tus datos.', 'error');
      return;
    }

    saveCustomerSession(authRes.user);
    syncCurrentUserFromDB();
    updateAuthCircleState();

    if (typeof BloomTracker !== 'undefined' && typeof BloomTracker.identifyUser === 'function') {
      BloomTracker.identifyUser(appState.currentUser);
    }

    renderApp();

    const loginForm = document.getElementById('customer-login-form');
    if (loginForm) loginForm.reset();

    closeAuthModal();
    const displayName = appState.currentUser.username || appState.currentUser.name || 'Cliente';
    showToast(`✨ ¡Bienvenida, ${displayName}! Precios exclusivos y compras desbloqueados.`, 'success');

    if (resumeCheckoutAfterAuth && appState.pendingOrder) {
      resumeCheckoutAfterAuth = false;
      openCheckoutModal(appState.pendingOrder.items, appState.pendingOrder.total, appState.pendingOrder.orderSource);
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>🔑 Iniciar Sesión</span>';
    }
  }
}

// Registro de usuarios Cloud-Ready (validación 100% en capa de servidor / DB)
async function handleCustomerRegister(e) {
  e.preventDefault();
  clearAuthInlineAlert();

  const username = (document.getElementById('reg-name').value || '').trim();
  const phone = (document.getElementById('reg-phone').value || '').trim();
  const email = (document.getElementById('reg-email').value || '').trim();
  const department = (document.getElementById('reg-department').value || '').trim();
  const city = (document.getElementById('reg-city').value || '').trim();
  const password = document.getElementById('reg-password').value || '';
  const confirmPassword = document.getElementById('reg-password-confirm').value || '';
  const submitBtn = document.getElementById('btn-auth-register-submit');

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳ Verificando en base de datos...</span>';
  }

  try {
    const regRes = await BloomDB.cloud.registerUser({
      username,
      phone,
      email,
      department,
      city,
      password,
      confirmPassword
    });

    if (!regRes || !regRes.success || !regRes.user) {
      const errMsg = (regRes && regRes.message) || 'No fue posible completar el registro.';
      showAuthInlineAlert(errMsg, 'error');
      showToast(errMsg, 'error');
      return;
    }

    saveCustomerSession(regRes.user);
    syncCurrentUserFromDB();
    updateAuthCircleState();

    if (typeof BloomTracker !== 'undefined' && typeof BloomTracker.identifyUser === 'function') {
      BloomTracker.identifyUser(appState.currentUser);
    }

    renderApp();

    const regForm = document.getElementById('customer-register-form');
    if (regForm) regForm.reset();

    showToast(`🎉 ¡Cuenta creada con éxito, ${regRes.user.username}! Ya puedes ver todos los precios.`, 'success');

    if (resumeCheckoutAfterAuth && appState.pendingOrder) {
      resumeCheckoutAfterAuth = false;
      closeAuthModal();
      openCheckoutModal(appState.pendingOrder.items, appState.pendingOrder.total, appState.pendingOrder.orderSource);
    } else {
      openAuthModal();
      showAuthInlineAlert(`¡Bienvenida a Bloom Beauty, ${regRes.user.username}! Tu cuenta está activa y lista para explorar.`, 'success');
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>✨ Crear mi Cuenta</span>';
    }
  }
}

function handleCustomerLogout() {
  if (typeof BloomTracker !== 'undefined' && typeof BloomTracker.clearUser === 'function') {
    BloomTracker.clearUser();
  }
  appState.currentUser = null;
  resumeCheckoutAfterAuth = false;
  localStorage.removeItem('bloom_customer_current_user');
  updateAuthCircleState();
  renderApp();
  closeAuthModal();
  showToast('👋 Has cerrado tu sesión correctamente.', 'normal');
}

// Control de recarga de "Tu Saldo"
let currentActiveRecharge = null;
let currentReceiptBase64 = '';

function toggleRechargeDrawer(forceOpen = null, suggestedAmount = 50000) {
  const box = document.getElementById('auth-recharge-form-box');
  if (!box) return;
  const currentlyOpen = box.style.display === 'block';
  const nextOpen = forceOpen !== null ? Boolean(forceOpen) : !currentlyOpen;
  box.style.display = nextOpen ? 'block' : 'none';

  if (nextOpen) {
    cancelCurrentRechargeFlow();
    const input = document.getElementById('recharge-amount-input');
    if (input) {
      input.value = String(Math.max(10000, Math.round(Number(suggestedAmount) || 50000)));
      input.focus();
    }
  }
}

function cancelCurrentRechargeFlow() {
  currentActiveRecharge = null;
  currentReceiptBase64 = '';
  const s1 = document.getElementById('recharge-step-1');
  const s2 = document.getElementById('recharge-step-2');
  if (s1) s1.style.display = 'block';
  if (s2) s2.style.display = 'none';
  const fileInput = document.getElementById('recharge-file-input');
  if (fileInput) fileInput.value = '';
  const prevBox = document.getElementById('recharge-file-preview-box');
  if (prevBox) prevBox.style.display = 'none';
}

// Definiciones auxiliares seguras para recargas
function formatCOP(num) {
  return typeof formatCurrency === 'function' ? formatCurrency(num) : ('$' + Math.round(Number(num) || 0).toLocaleString('es-CO') + ' COP');
}
function renderAuthUserPanel() {
  if (typeof renderAuthLoggedProfile === 'function') renderAuthLoggedProfile();
}

async function handleStartRecharge(e) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  syncCurrentUserFromDB();
  if (!appState.currentUser) {
    showToast('Debes iniciar sesión para recargar Tu Saldo', 'error');
    return;
  }

  const rawAmount = Number(document.getElementById('recharge-amount-input').value) || 0;
  const amount = Math.round(rawAmount);
  if (amount < 10000) {
    showToast('El monto mínimo es de $10.000 COP', 'error');
    return;
  }

  const btn = document.getElementById('btn-create-recharge-req');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Creando solicitud en la nube...</span>';
  }

  let rechargeData = null;
  const payload = {
    customerId: appState.currentUser.id,
    customerName: appState.currentUser.username || appState.currentUser.name || 'Cliente',
    customerPhone: appState.currentUser.phone || '',
    customerEmail: appState.currentUser.email || '',
    amount: amount
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('https://bloom-backend-v6.onrender.com/api/v6/recharges/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      rechargeData = data.recharge;
    }
  } catch (netErr) {
    console.warn('Backend cloud ping timeout/failed, continuing with local fallback:', netErr);
  }

  // Fallback local si la nube tardó o falló
  if (!rechargeData) {
    if (typeof BloomDB !== 'undefined' && typeof BloomDB.addRechargeRequest === 'function') {
      rechargeData = BloomDB.addRechargeRequest(payload);
    }
  }

  currentActiveRecharge = rechargeData || { id: 'REC-' + Date.now().toString().slice(-6), amount: amount };

  // Mostrar Paso 2
  const s1 = document.getElementById('recharge-step-1');
  const s2 = document.getElementById('recharge-step-2');
  if (s1) s1.style.display = 'none';
  if (s2) s2.style.display = 'block';

  const viewId = document.getElementById('view-recharge-id');
  if (viewId) viewId.innerText = currentActiveRecharge.id;
  const viewAmt = document.getElementById('view-recharge-amount');
  if (viewAmt) viewAmt.innerText = formatCOP(amount);
  showToast('¡Solicitud creada! Realiza la transferencia y sube tu comprobante abajo.', 'info');

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<span>⚡ Crear Solicitud & Ver Cuentas de Pago</span>';
  }
}

function handleReceiptFileSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Por favor selecciona un archivo de imagen (PNG, JPG, JPEG).', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(evt) {
    currentReceiptBase64 = evt.target.result;
    const prevBox = document.getElementById('recharge-file-preview-box');
    const prevImg = document.getElementById('recharge-file-preview-img');
    if (prevBox && prevImg) {
      prevImg.src = currentReceiptBase64;
      prevBox.style.display = 'block';
    }
  };
  reader.readAsDataURL(file);
}

async function handleUploadReceiptAndConfirm() {
  if (!currentActiveRecharge) {
    showToast('No hay una solicitud de recarga activa.', 'error');
    return;
  }

  if (!currentReceiptBase64) {
    showToast('Por favor adjunta la foto del comprobante de pago.', 'error');
    return;
  }

  const refText = (document.getElementById('recharge-ref-text-input')?.value || '').trim();
  const btn = document.getElementById('btn-submit-receipt');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Enviando comprobante a la nube...</span>';
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const res = await fetch('https://bloom-backend-v6.onrender.com/api/v6/recharges/receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rechargeId: currentActiveRecharge.id,
        receiptUrl: currentReceiptBase64,
        reference: refText
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
  } catch (err) {
    console.warn('Error uploading receipt to cloud, continuing with local sync:', err);
  }

  // Guardar comprobante localmente en BloomDB
  try {
    if (typeof BloomDB !== 'undefined') {
      const data = BloomDB.getData();
      const rec = (data.rechargeRequests || []).find(r => r.id === currentActiveRecharge.id);
      if (rec) {
        rec.receiptUrl = currentReceiptBase64;
        rec.reference = refText || rec.reference;
        BloomDB.saveData(data);
      }
    }
  } catch(e) {}

  showToast('¡Comprobante recibido con éxito! En minutos el administrador lo verificará y acreditará tu saldo.', 'success');
  toggleRechargeDrawer(false);
  if (typeof renderAuthLoggedProfile === 'function') renderAuthLoggedProfile();

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<span>✅ ¡Ya Pagué! Enviar Comprobante</span>';
  }
}

function setRechargeChip(amount) {
  const input = document.getElementById('recharge-amount-input');
  if (input) input.value = amount;
}

function submitCustomerRechargeRequest(e) {
  e.preventDefault();
  syncCurrentUserFromDB();

  if (!appState.currentUser) {
    showToast('Debes iniciar sesión para recargar Tu Saldo', 'error');
    return;
  }

  const rawAmount = Number(document.getElementById('recharge-amount-input').value) || 0;
  const amount = Math.round(rawAmount);
  const methodEl = document.getElementById('recharge-method-select');
  const paymentMethod = methodEl ? methodEl.value : 'Nequi';

  const refInput = document.getElementById('recharge-reference-input');
  const noteInput = document.getElementById('recharge-note-input');
  const paymentRef = refInput ? refInput.value.trim() : '';
  const userNote = noteInput ? noteInput.value.trim() : '';

  if (amount < 10000) {
    showAuthInlineAlert('El monto mínimo de recarga es de $10.000 COP.', 'error');
    showToast('El monto mínimo de recarga es de $10.000 COP', 'error');
    return;
  }

  let createdReq = null;
  if (typeof BloomDB !== 'undefined' && typeof BloomDB.addRechargeRequest === 'function') {
    createdReq = BloomDB.addRechargeRequest({
      customerId: appState.currentUser.id,
      customerName: appState.currentUser.username || appState.currentUser.name,
      customerPhone: appState.currentUser.phone,
      customerEmail: appState.currentUser.email,
      amount: amount,
      paymentMethod: paymentMethod,
      reference: paymentRef,
      userNote: userNote
    });
  }

  const storePhoneFormatted = formatStoreWhatsAppNumber(appState.storeInfo && appState.storeInfo.phone);
  let msg = `💎 *SOLICITUD DE RECARGA EN TU SALDO — BLOOM BEAUTY* 💎\n`;
  if (createdReq && createdReq.id) {
    msg += `🧾 *Referencia:* ${createdReq.id}\n`;
  }
  msg += `----------------------------------------\n`;
  msg += `👤 *Cliente:* ${appState.currentUser.username || appState.currentUser.name}\n`;
  msg += `📱 *WhatsApp:* ${appState.currentUser.phone}\n`;
  msg += `✉️ *Correo:* ${appState.currentUser.email}\n`;
  msg += `💳 *Medio de Pago:* ${paymentMethod}\n`;
  msg += `💰 *Monto a Recargar:* ${formatCurrency(amount)}\n`;
  if (paymentRef) {
    msg += `🔖 *Comprobante / Ref:* ${paymentRef}\n`;
  }
  if (userNote) {
    msg += `📝 *Nota del Cliente:* ${userNote}\n`;
  }
  msg += `----------------------------------------\n`;
  msg += `¡Hola Bloom Beauty! Deseo recargar ${formatCurrency(amount)} en Tu Saldo de mi cuenta para realizar compras en la tienda. ¿Me confirman la validación de mi saldo? ¡Gracias! ✨`;

  const url = `https://wa.me/${storePhoneFormatted}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');

  toggleRechargeDrawer(false);
  renderAuthLoggedProfile();
  showAuthInlineAlert(`✓ Solicitud por ${formatCurrency(amount)} registrada. Apenas se verifique tu comprobante, Tu Saldo se actualizará aquí automáticamente.`, 'success');
  showToast(`📲 ¡Solicitud de recarga por ${formatCurrency(amount)} enviada!`, 'success');
}






// ============================================================================
// LÓGICA DE PROMOCIONES, OFERTAS FLASH 24H Y RULETA VIP INTERACTIVA
// ============================================================================

let currentWonCoupon = '';

function startFlashCountdown() {
  function updateTimer() {
    const now = new Date();
    const midnight = new Date();
    midnight.setHours(23, 59, 59, 999);
    const diff = Math.max(0, midnight - now);

    const h = String(Math.floor((diff / (1000 * 60 * 60)) % 24)).padStart(2, '0');
    const m = String(Math.floor((diff / (1000 * 60)) % 60)).padStart(2, '0');
    const s = String(Math.floor((diff / 1000) % 60)).padStart(2, '0');

    const elH = document.getElementById('flash-hours');
    const elM = document.getElementById('flash-minutes');
    const elS = document.getElementById('flash-seconds');
    if (elH) elH.innerText = h;
    if (elM) elM.innerText = m;
    if (elS) elS.innerText = s;
  }
  updateTimer();
  setInterval(updateTimer, 1000);
}

function openPromoWheelModal() {
  const modal = document.getElementById('promo-wheel-modal');
  if (modal) modal.style.display = 'flex';
}

function closePromoWheelModal() {
  const modal = document.getElementById('promo-wheel-modal');
  if (modal) modal.style.display = 'none';
}

let isSpinning = false;
function spinLuckyWheel() {
  if (isSpinning) return;
  const wheel = document.getElementById('lucky-wheel-canvas');
  const btn = document.getElementById('btn-spin-now');
  if (!wheel || !btn) return;

  isSpinning = true;
  btn.disabled = true;
  btn.innerText = 'GIRANDO...';

  // Premios posibles
  const prizes = [
    { label: '15% de Descuento Especial', code: 'RULETA15', type: 'discount' },
    { label: '10% de Descuento Exclusivo', code: 'VIP10', type: 'discount' },
    { label: 'Envío Gratis Nacional', code: 'ENVIOGRATIS', type: 'shipping' },
    { label: '$15.000 en Tu Saldo Virtual', code: 'BONO15K', type: 'balance' }
  ];

  const picked = prizes[Math.floor(Math.random() * prizes.length)];
  currentWonCoupon = picked.code;

  // Animación de rotación (5 a 8 vueltas completas)
  const randomDeg = 1800 + Math.floor(Math.random() * 360);
  wheel.style.transform = `rotate(${randomDeg}deg)`;

  setTimeout(() => {
    isSpinning = false;
    btn.style.display = 'none';

    const resBox = document.getElementById('wheel-win-result-box');
    const title = document.getElementById('wheel-win-title');
    const desc = document.getElementById('wheel-win-desc');
    const codePill = document.getElementById('wheel-coupon-code');

    if (resBox && title && desc && codePill) {
      title.innerText = '🎉 ¡GANASTE ' + picked.label.toUpperCase() + '!';
      desc.innerText = 'Tu código promocional está listo para aplicarse a tu carrito de compras:';
      codePill.innerText = picked.code;
      resBox.style.display = 'block';
    }
  }, 4200);
}

function applyWonPromoCoupon() {
  if (currentWonCoupon) {
    appState.appliedCouponCode = currentWonCoupon;
    showToast('✨ Cupón ' + currentWonCoupon + ' aplicado a tu carrito!', 'success');
    closePromoWheelModal();
    toggleCartDrawer(true);
  }
}

// Iniciar contador cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startFlashCountdown);
} else {
  startFlashCountdown();
}
