
function notifyRechargeWhatsApp(reqId) {
  const requests = (typeof BloomDB !== 'undefined' && BloomDB.getRechargeRequests) ? BloomDB.getRechargeRequests() : [];
  const req = requests.find(r => String(r.id) === String(reqId));
  if (!req) return;
  const rawPhone = String(req.customerPhone || req.userPhone || req.phone || '').replace(/\D/g, '');
  const cleanPhone = rawPhone.length === 10 ? '57' + rawPhone : rawPhone;
  const name = req.customerName || req.userName || 'Hermosa Clienta';
  const amountStr = typeof formatCOP === 'function' ? formatCOP(req.amount) : ('$' + (req.amount || 0));

  const text = '¡Hola ' + name + '! ✨🌸\n\nTe confirmamos que tu recarga de *' + amountStr + '* ha sido *aprobada y acreditada* con éxito en tu Cartera Bloom Beauty 💎.\n\nYa puedes ingresar a la tienda y realizar tus compras con saldo disponible:\n👉 https://bloombeauty-oficial.netlify.app\n\n¡Muchas gracias por tu confianza en Bloom Beauty! 💖✨';
  const url = 'https://wa.me/' + cleanPhone + '?text=' + encodeURIComponent(text);
  window.open(url, '_blank');
  if (typeof showAdminToast === 'function') showAdminToast('💬 Abriendo chat de WhatsApp para notificar a ' + name + '...', 'info');
}

// ============================================================================
// BLOOM BEAUTY - PANEL DE ADMINISTRACIÓN VIP (ADMIN.JS)
// Conexión y control total 100% en tiempo real con la tienda Bloom Beauty.
// Sin datos simulados ni ficticios: todo sincronizado mediante BloomDB y Telemetría.
// ============================================================================

let currentMasterData = null;
let currentOrders = [];
let currentReviews = [];
let currentOffers = [];
let currentBugReports = [];
let currentCustomers = [];
let currentRechargeRequests = [];
let currentSessions = [];
let currentTransactions = [];
let currentNotifications = { globalEnabled: true, autoRules: [], directNotifications: [], deliveryLog: [] };
let currentFilterBrand = 'all';
let currentSearchQuery = '';
let currentCustomerSearchQuery = '';
let balanceModalBaseBalance = 0;

function toggleAdminPassVisibility(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPass = input.type === 'password';
  input.type = isPass ? 'text' : 'password';
  if (btnEl) {
    btnEl.textContent = isPass ? '🙈' : '👁️';
  }
}

// ============================================================================
// 1. AUTENTICACIÓN Y SEGURIDAD
// ============================================================================
function initAdmin() {
  const isAuth = sessionStorage.getItem('bloom_admin_logged');
  if (isAuth === 'true') {
    showAdminDashboard();
  } else {
    document.getElementById('admin-login-screen').style.display = 'flex';
    document.getElementById('admin-app-wrapper').style.display = 'none';
  }

  // Cargar datos maestros desde BloomDB
  refreshDataFromDB();

  const handleAdminRealTimeSync = () => {
    refreshDataFromDB();
    // No interrumpir si el administrador está editando cualquier campo en línea (input, textarea o select)
    const activeEl = document.activeElement;
    const isEditingInline = activeEl &&
      (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT') &&
      (
        activeEl.dataset.inlineInput === '1' ||
        activeEl.classList.contains('inline-edit-input') ||
        activeEl.classList.contains('inline-price-input') ||
        (activeEl.closest && activeEl.closest('#form-store-settings, #form-cloud-config, #form-direct-notification'))
      );
    if (!isEditingInline) {
      renderCurrentView();
    }
  };

  // Suscribirse al bus en tiempo real de BloomDB
  if (typeof BloomDB !== 'undefined') {
    BloomDB.subscribe(() => {
      handleAdminRealTimeSync();
    });
  }

  // Sincronizar de inmediato al volver a la pestaña del Panel Admin (compatible con file:/// y localhost)
  window.addEventListener('focus', handleAdminRealTimeSync);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) handleAdminRealTimeSync();
  });

  // Monitoreo en vivo de telemetría cada 6 segundos (estrictamente aislado en #view-telemetry)
  setInterval(() => {
    if (document.hidden) return;
    refreshSessionsFromStorage();
    updateLiveRadarCounters();
    const activeView = document.querySelector('.admin-view.active');
    const activeInput = document.activeElement;
    const isTypingFilter = activeInput && (activeInput.tagName === 'INPUT' || activeInput.tagName === 'SELECT' || activeInput.tagName === 'TEXTAREA');
    if (activeView && activeView.id === 'view-telemetry' && !isTypingFilter) {
      renderTelemetryView();
    }
  }, 6000);
}

function handleAdminLogin(e) {
  e.preventDefault();
  const user = document.getElementById('admin-user-input').value.trim();
  const pass = document.getElementById('admin-pass-input').value.trim();
  const errorBox = document.getElementById('login-error-msg');

  const storeInfo = (currentMasterData && currentMasterData.storeInfo) || (typeof DEFAULT_SITE_DATA !== 'undefined' ? DEFAULT_SITE_DATA.storeInfo : {});
  const expectedUser = storeInfo.adminEmail || 'de2355258@gmail.com';
  const expectedPass = storeInfo.adminPassword || 'kira1622*';

  if ((user === expectedUser || user === 'admin' || user === 'de2355258@gmail.com') && (pass === expectedPass || pass === 'kira1622*')) {
    sessionStorage.setItem('bloom_admin_logged', 'true');
    errorBox.style.display = 'none';
    showAdminDashboard();
  } else {
    errorBox.innerText = 'Contraseña o usuario incorrectos. Intente nuevamente.';
    errorBox.style.display = 'block';
  }
}

function showAdminDashboard() {
  document.getElementById('admin-login-screen').style.display = 'none';
  document.getElementById('admin-app-wrapper').style.display = 'flex';
  refreshDataFromDB();
  populateBrandSelects();
  renderCurrentView();
}

function adminLogout() {
  sessionStorage.removeItem('bloom_admin_logged');
  window.location.reload();
}

// ============================================================================
// 2. OBTENCIÓN Y SINCRONIZACIÓN DE DATOS (100% REALES)
// ============================================================================
function refreshDataFromDB() {
  if (typeof BloomDB !== 'undefined') {
    currentMasterData = BloomDB.getData();
    currentOrders = BloomDB.getOrders();
    currentReviews = BloomDB.getReviews();
    currentOffers = BloomDB.getOffers();
    currentBugReports = (typeof BloomDB.getBugReports === 'function') ? BloomDB.getBugReports() : [];
    currentCustomers = (typeof BloomDB.getCustomers === 'function') ? BloomDB.getCustomers() : [];
    currentRechargeRequests = (typeof BloomDB.getRechargeRequests === 'function') ? BloomDB.getRechargeRequests() : [];
    currentTransactions = (typeof BloomDB.getTransactions === 'function') ? BloomDB.getTransactions() : [];
    currentNotifications = (typeof BloomDB.getNotificationsData === 'function')
      ? BloomDB.getNotificationsData()
      : { globalEnabled: true, autoRules: [], directNotifications: [], deliveryLog: [] };
  } else {
    currentMasterData = { storeInfo: {}, brands: [], products: [] };
    currentOrders = [];
    currentReviews = [];
    currentOffers = [];
    currentBugReports = [];
    currentCustomers = [];
    currentRechargeRequests = [];
    currentTransactions = [];
    currentNotifications = { globalEnabled: true, autoRules: [], directNotifications: [], deliveryLog: [] };
  }
  refreshSessionsFromStorage();
  updateNavCounters();
}

async function refreshSessionsFromStorage() {
  // 1. Sincronizar desde la base de datos descargada de la nube
  if (typeof BloomDB !== 'undefined' && typeof BloomDB.getData === 'function') {
    const liveDB = BloomDB.getData();
    if (liveDB && Array.isArray(liveDB.visitors) && liveDB.visitors.length > 0) {
      currentSessions = liveDB.visitors;
    }
  }

  // 2. Consulta directa y en vivo a la API en la nube (Render + Supabase)
  try {
    const cloudEndpoint = (typeof BloomDB !== 'undefined' && BloomDB.getCloudConfig)
      ? BloomDB.getCloudConfig().endpointUrl
      : 'https://bloom-backend-v6.onrender.com';
    const res = await fetch(`${cloudEndpoint}/api/v6/visitors/live`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && Array.isArray(data.visitors)) {
        currentSessions = data.visitors;
        const navBadge = document.getElementById('nav-count-live-sessions');
        if (navBadge && data.stats) {
          navBadge.innerText = `${data.stats.live || 0} En Vivo`;
        }
      }
    }
  } catch (e) {}

  // 3. Fallback a almacenamiento local si no hay conexión
  if (!currentSessions || currentSessions.length === 0) {
    try {
      const key = (typeof BloomDB !== 'undefined' && BloomDB.KEYS && BloomDB.KEYS.SESSIONS_KEY)
        ? BloomDB.KEYS.SESSIONS_KEY
        : 'bloom_beauty_real_sessions_v1';
      currentSessions = JSON.parse(localStorage.getItem(key) || '[]');
    } catch (e) {
      currentSessions = [];
    }
  }
}

function updateNavCounters() {
  const prodsCount = (currentMasterData.products || []).length;
  const brandsCount = (currentMasterData.brands || []).length;
  const ordersCount = (currentOrders || []).length;
  const pendingDispatchCount = (currentOrders || []).filter(o => !o.status || o.status === 'Por Despachar').length;
  const reviewsCount = (currentReviews || []).length;
  const offersCount = (currentOffers || []).length;

  const prodBadge = document.getElementById('nav-count-products');
  if (prodBadge) prodBadge.innerText = prodsCount;
  const brandBadge = document.getElementById('nav-count-brands');
  if (brandBadge) brandBadge.innerText = brandsCount;
  const ordersBadge = document.getElementById('nav-count-orders');
  if (ordersBadge) {
    if (pendingDispatchCount > 0) {
      ordersBadge.innerText = `${ordersCount} • ⏳${pendingDispatchCount}`;
      ordersBadge.style.background = 'rgba(245, 158, 11, 0.22)';
      ordersBadge.style.color = '#FBBF24';
    } else {
      ordersBadge.innerText = ordersCount;
      ordersBadge.style.background = '';
      ordersBadge.style.color = '';
    }
  }
  const revBadge = document.getElementById('nav-count-reviews');
  if (revBadge) revBadge.innerText = reviewsCount;
  const offBadge = document.getElementById('nav-count-offers');
  if (offBadge) offBadge.innerText = offersCount;

  const txBadge = document.getElementById('nav-count-transactions');
  if (txBadge) txBadge.innerText = (currentTransactions || []).length;

  const notifBadge = document.getElementById('nav-count-notifications');
  if (notifBadge) {
    const activeRules = ((currentNotifications && currentNotifications.autoRules) || []).filter(r => r.active !== false).length;
    notifBadge.innerText = currentNotifications && currentNotifications.globalEnabled === false ? 'Pausa' : `${activeRules} Auto`;
  }

  const cloudStatusText = document.getElementById('topbar-cloud-status-text');
  if (cloudStatusText && typeof BloomDB !== 'undefined' && typeof BloomDB.getCloudConfig === 'function') {
    const cfg = BloomDB.getCloudConfig();
    cloudStatusText.innerText = (cfg && cfg.enabled && cfg.endpointUrl)
      ? 'Servidor Cloud Activo'
      : 'Cloud-Ready Sincronizado';
  }

  const resolveStoreHref = () => {
    const sInfo = (currentMasterData && currentMasterData.storeInfo) || {};
    if (sInfo.storePublicUrl && String(sInfo.storePublicUrl).trim().startsWith('http')) {
      return String(sInfo.storePublicUrl).trim();
    }
    if (window.location.protocol !== 'file:' && window.location.pathname.indexOf('/admin') !== -1) {
      return '/tienda/index.html';
    }
    return '../bloom%20bauty%20v6/index.html';
  };

  const storeHref = resolveStoreHref();
  const openStoreLink = document.getElementById('topbar-open-store-link');
  if (openStoreLink) openStoreLink.href = storeHref;
  const settingsStoreBtn = document.getElementById('settings-open-store-btn');
  if (settingsStoreBtn) settingsStoreBtn.href = storeHref;

  const bugsNav = document.getElementById('nav-count-bugs');
  if (bugsNav) bugsNav.innerText = (currentBugReports || []).length;
  const customersNav = document.getElementById('nav-count-customers');
  if (customersNav) {
    const pendingRecharges = (currentRechargeRequests || []).filter(r => r.status === 'Pendiente').length;
    if (pendingRecharges > 0) {
      customersNav.innerText = `${(currentCustomers || []).length} • 🔔${pendingRecharges}`;
      customersNav.style.background = 'rgba(245, 158, 11, 0.25)';
      customersNav.style.color = '#FBBF24';
    } else {
      customersNav.innerText = (currentCustomers || []).length;
      customersNav.style.background = 'rgba(16, 185, 129, 0.2)';
      customersNav.style.color = '#34D399';
    }
  }

  const sidebarSyncCounter = document.getElementById('sidebar-sync-counter');
  if (sidebarSyncCounter) {
    sidebarSyncCounter.innerText = `${prodsCount} Prod • En Vivo`;
  }

  // Contador exclusivo para el apartado único de Huella & Rastro Digital
  const now = Date.now();
  const activeSessions = currentSessions.filter(s => (now - (s.lastActiveTimestamp || s.entryTimestamp)) < 120000);
  const liveCount = activeSessions.length;

  const liveBadge = document.getElementById('nav-count-live-sessions');
  if (liveBadge) liveBadge.innerText = `${liveCount} En Vivo`;
}

function updateLiveRadarCounters() {
  updateNavCounters();
}

// ============================================================================
// 3. CAMBIO DE VISTAS EN EL PANEL
// ============================================================================
function toggleAdminSidebar(forceState) {
  const sidebar = document.getElementById('admin-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;

  const shouldOpen = typeof forceState === 'boolean' 
    ? forceState 
    : !sidebar.classList.contains('mobile-open');

  if (shouldOpen) {
    sidebar.classList.add('mobile-open');
    if (backdrop) backdrop.classList.add('active');
  } else {
    sidebar.classList.remove('mobile-open');
    if (backdrop) backdrop.classList.remove('active');
  }
}

function switchAdminView(viewName, navEl) {
  // En pantallas táctiles o móviles, auto-cerrar el menú lateral al cambiar de sección
  toggleAdminSidebar(false);

  document.querySelectorAll('.admin-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.admin-sidebar .nav-item').forEach(n => n.classList.remove('active'));

  const targetView = document.getElementById('view-' + viewName);
  if (targetView) targetView.classList.add('active');

  if (navEl) {
    navEl.classList.add('active');
  } else {
    const links = document.querySelectorAll('.admin-sidebar .nav-item');
    links.forEach(l => {
      if (l.getAttribute('onclick') && l.getAttribute('onclick').includes(viewName)) {
        l.classList.add('active');
      }
    });
  }

  const titles = {
    'dashboard': 'Inicio & Resumen Ejecutivo',
    'telemetry': 'Huella y Rastro Digital en Tiempo Real',
    'transactions': 'Control Maestro de Transacciones',
    'reports': 'Informes Diarios & Analítica Descargable',
    'notifications': 'Alertas & Notificaciones Inteligentes (1-Clic)',
    'products': 'Catálogo de Productos & Precios (Edición en 1 Clic)',
    'brands': 'Marcas Oficiales & Laboratorios (Edición en 1 Clic)',
    'offers': 'Ofertas, Banners & Cupones (Edición en 1 Clic)',
    'customers': 'Usuarios Registrados & Control de Tu Saldo',
    'reviews': 'Calificación de la Tienda & Reseñas (1-Clic)',
    'bugs': 'Soporte Técnico & Reportes de Bugs',
    'orders': 'Gestión de Pedidos & Despacho en 1 Clic',
    'store-settings': 'Portada & Página Principal (Edición en 1 Clic)'
  };
  document.getElementById('topbar-current-title').innerText = titles[viewName] || 'Panel de Administración';

  renderCurrentView();
}

function renderCurrentView() {
  const activeView = document.querySelector('.admin-view.active');
  if (!activeView) return;

  switch (activeView.id) {
    case 'view-dashboard':
      renderDashboardView();
      break;
    case 'view-telemetry':
      renderTelemetryView();
      break;
    case 'view-transactions':
      renderTransactionsView();
      break;
    case 'view-reports':
      renderDailyReportsView();
      break;
    case 'view-notifications':
      renderNotificationsAdminView();
      break;
    case 'view-products':
      renderProductsTable();
      break;
    case 'view-brands':
      renderBrandsTable();
      break;
    case 'view-offers':
      renderOffersTable();
      break;
    case 'view-customers':
      renderCustomersTable();
      break;
    case 'view-reviews':
      renderReviewsTable();
      break;
    case 'view-bugs':
      renderBugsTable();
      break;
    case 'view-orders':
      renderOrdersTable();
      break;
    case 'view-store-settings':
      loadStoreSettingsIntoForm();
      break;
  }
}

// ============================================================================
// 4. VISTA: DASHBOARD GENERAL
// ============================================================================
function renderDashboardView() {
  const totalSales = (currentOrders || []).reduce((acc, ord) => acc + (ord.total || 0), 0);
  document.getElementById('kpi-total-sales').innerText = formatCOP(totalSales);
  document.getElementById('kpi-orders-count-label').innerText = `${currentOrders.length} pedidos registrados`;

  const prods = currentMasterData.products || [];
  const brands = currentMasterData.brands || [];
  document.getElementById('kpi-products-count').innerText = prods.length;
  document.getElementById('kpi-brands-count-label').innerText = `${brands.length} marcas oficiales`;

  const ratingAvgEl = document.getElementById('kpi-rating-avg');
  const reviewsCountEl = document.getElementById('kpi-reviews-count-label');
  if (ratingAvgEl) {
    if (currentReviews.length > 0) {
      const avg = (currentReviews.reduce((acc, r) => acc + (Number(r.rating) || 5), 0) / currentReviews.length).toFixed(1);
      ratingAvgEl.innerText = `${avg} / 5.0`;
      if (reviewsCountEl) reviewsCountEl.innerText = `${currentReviews.length} reseñas reales`;
    } else {
      ratingAvgEl.innerText = '5.0 / 5.0';
      if (reviewsCountEl) reviewsCountEl.innerText = 'Excelente satisfacción';
    }
  }

  const activeOffers = (currentOffers || []).filter(o => o.active !== false);
  document.getElementById('kpi-offers-count').innerText = activeOffers.length;
  document.getElementById('kpi-offers-active-label').innerText = `${activeOffers.length} de ${currentOffers.length} activas`;

  const custKpiEl = document.getElementById('kpi-customers-count');
  const custBalLabelEl = document.getElementById('kpi-customers-balance-label');
  const custRechBadgeEl = document.getElementById('kpi-recharges-badge');
  if (custKpiEl) {
    const custList = currentCustomers || [];
    const totalBalances = custList.reduce((acc, c) => acc + Math.max(0, Number(c.balance) || 0), 0);
    const pendingRecharges = (currentRechargeRequests || []).filter(r => r.status === 'Pendiente').length;
    custKpiEl.innerText = custList.length;
    if (custBalLabelEl) custBalLabelEl.innerText = `${formatCOP(totalBalances)} en cuentas`;
    if (custRechBadgeEl) {
      if (pendingRecharges > 0) {
        custRechBadgeEl.innerText = `🔔 ${pendingRecharges} recarga${pendingRecharges === 1 ? '' : 's'}`;
        custRechBadgeEl.style.background = 'rgba(245, 158, 11, 0.22)';
        custRechBadgeEl.style.color = '#FBBF24';
      } else {
        custRechBadgeEl.innerText = 'Tu Saldo';
        custRechBadgeEl.style.background = '';
        custRechBadgeEl.style.color = '';
      }
    }
  }

  renderDashboardRecentOrders();
}

// ============================================================================
// MOTOR UNIVERSAL DE EDICIÓN DIRECTA EN 1 CLIC (SIN MODALES NI MENÚS COMPLEJOS)
// ============================================================================
function openInlineFieldEditor(el, opts = {}) {
  if (!el || el.dataset.inlineEditing === '1') return;
  if (el.querySelector && el.querySelector('input, textarea, select')) return;

  el.dataset.inlineEditing = '1';
  const prevOnclick = el.onclick;
  el.onclick = null;

  const type = opts.type || 'text';
  const initialValue = opts.value !== undefined && opts.value !== null ? String(opts.value) : '';
  const placeholder = opts.placeholder || '';
  let inputEl;

  if (type === 'textarea') {
    inputEl = document.createElement('textarea');
    inputEl.rows = opts.rows || 2;
    inputEl.value = initialValue;
    inputEl.placeholder = placeholder;
  } else if (type === 'select') {
    inputEl = document.createElement('select');
    (opts.options || []).forEach((opt) => {
      const o = document.createElement('option');
      o.value = String(opt.value);
      o.textContent = opt.label;
      if (String(opt.value) === initialValue) o.selected = true;
      inputEl.appendChild(o);
    });
  } else {
    inputEl = document.createElement('input');
    inputEl.type = type;
    inputEl.value = initialValue;
    inputEl.placeholder = placeholder;
    if (opts.min !== undefined) inputEl.min = String(opts.min);
    if (opts.max !== undefined) inputEl.max = String(opts.max);
    if (opts.step !== undefined) inputEl.step = String(opts.step);
  }

  inputEl.className = 'inline-edit-input ' + (opts.className || '');
  inputEl.dataset.inlineInput = '1';
  if (opts.style) inputEl.style.cssText += ';' + opts.style;

  el.innerHTML = '';
  el.appendChild(inputEl);
  inputEl.focus();
  if (inputEl.select && type !== 'select') {
    try { inputEl.select(); } catch (e) {}
  }

  let finished = false;
  const finish = (shouldSave) => {
    if (finished) return;
    finished = true;
    delete el.dataset.inlineEditing;
    if (!shouldSave) {
      el.onclick = prevOnclick;
      if (typeof opts.onCancel === 'function') opts.onCancel();
      else renderCurrentView();
      return;
    }
    const nextVal = inputEl.value;
    if (typeof opts.onSave === 'function') {
      opts.onSave(nextVal);
    } else {
      renderCurrentView();
    }
  };

  if (type === 'select') {
    inputEl.addEventListener('change', () => finish(true));
  }

  inputEl.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape') {
      ev.preventDefault();
      finish(false);
    } else if (ev.key === 'Enter' && (type !== 'textarea' || ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      finish(true);
    }
  });

  inputEl.addEventListener('click', (ev) => ev.stopPropagation());
  inputEl.addEventListener('blur', () => {
    setTimeout(() => finish(true), 120);
  });
}

function renderDispatchStatusBadge(status, orderId = '') {
  const st = status || 'Por Despachar';
  const clickAttr = orderId
    ? `onclick="event.stopPropagation(); cycleOrderDispatchStatus('${escapeAttr(orderId)}')" title="Toca para cambiar estado de despacho en 1 clic" style="cursor:pointer;"`
    : '';
  const interactiveCls = orderId ? 'status-clickable' : '';

  if (st === 'Despachado') {
    return `<span class="badge-status active ${interactiveCls}" ${clickAttr}>🚚 Despachado ↻</span>`;
  }
  if (st === 'Confirmado') {
    return `<span class="badge-status ${interactiveCls}" ${clickAttr} style="${orderId ? 'cursor:pointer;' : ''}background: rgba(59,130,246,0.18); color: #60A5FA; border: 1px solid rgba(59,130,246,0.4);">✓ Confirmado ↻</span>`;
  }
  if (st === 'Cancelado') {
    return `<span class="badge-status inactive ${interactiveCls}" ${clickAttr}>✕ Cancelado ↻</span>`;
  }
  return `<span class="badge-status ${interactiveCls}" ${clickAttr} style="${orderId ? 'cursor:pointer;' : ''}background: rgba(245,158,11,0.18); color: #FBBF24; border: 1px solid rgba(245,158,11,0.4);">⏳ ${escapeAdminHtml(st)} ↻</span>`;
}

function cycleOrderDispatchStatus(orderId) {
  const ord = (currentOrders || []).find(o => String(o.id) === String(orderId));
  if (!ord) return;
  const cur = ord.status || 'Por Despachar';
  const next = cur === 'Por Despachar' ? 'Confirmado' : (cur === 'Confirmado' ? 'Despachado' : 'Por Despachar');
  updateOrderDispatchStatus(orderId, next);
}

function renderDashboardRecentOrders() {
  const tbody = document.getElementById('dashboard-recent-orders-body');
  if (!tbody) return;

  const recent = currentOrders.slice(0, 6);
  if (recent.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No hay pedidos registrados aún. Los pedidos confirmados en tienda o registrados manualmente aparecerán aquí al instante.</td></tr>`;
    return;
  }

  tbody.innerHTML = recent.map(o => `
    <tr>
      <td data-label="ID Pedido">
        <strong style="color: var(--gold-light); font-family: monospace;">${escapeAdminHtml(o.id)}</strong>
        ${o.source === 'manual_admin' ? '<br><small style="color:#60A5FA;">⚡ Manual</small>' : ''}
      </td>
      <td data-label="Hora Exacta">
        <strong style="color:#FFF; font-family: monospace;">🕒 ${escapeAdminHtml(o.exactTime || '--:--:--')}</strong><br>
        <small style="color: var(--text-dim);">${escapeAdminHtml(o.dateFormatted || '')}</small>
      </td>
      <td data-label="Cliente"><strong>${escapeAdminHtml(o.customerName || 'Cliente')}</strong></td>
      <td data-label="WhatsApp">${escapeAdminHtml(o.customerPhone || '-')}</td>
      <td data-label="Ciudad & Depto.">${escapeAdminHtml(o.customerCity || 'Colombia')}${o.customerDepartment ? ', ' + escapeAdminHtml(o.customerDepartment) : ''}</td>
      <td data-label="Total">
        <strong style="color: #34D399;">${formatCOP(o.total)}</strong>
        ${o.couponCode ? `<br><small style="color: var(--gold-light); font-weight:700;">🎟️ ${escapeAdminHtml(o.couponCode)}</small>` : ''}
      </td>
      <td data-label="Estado">${renderDispatchStatusBadge(o.status, o.id)}</td>
    </tr>
  `).join('');
}

// ============================================================================
// 5. VISTA: PRODUCTOS (CAMBIAR PRECIO, CREAR, QUITAR, ACTIVAR)
// ============================================================================
function populateBrandSelects() {
  const brands = currentMasterData.brands || [];
  const filterSelect = document.getElementById('admin-filter-product-brand');
  const formBrandSelect = document.getElementById('prod-form-brand');
  const offerBrandSelect = document.getElementById('offer-form-brand');

  if (filterSelect) {
    const prev = currentFilterBrand || filterSelect.value;
    filterSelect.innerHTML = `<option value="all">Todas las Marcas (${brands.length})</option>` +
      brands.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    filterSelect.value = prev || 'all';
    currentFilterBrand = filterSelect.value;
  }

  if (formBrandSelect) {
    formBrandSelect.innerHTML = brands.map(b => `<option value="${b.id}" data-name="${b.name}">${b.name}</option>`).join('') +
      `<option value="__NEW_BRAND__" style="color: var(--gold-light); font-weight: bold;">➕ Escribir nueva marca...</option>`;
  }

  if (offerBrandSelect) {
    offerBrandSelect.innerHTML = `<option value="Todas">Todas las Marcas</option>` +
      brands.map(b => `<option value="${b.name}">${b.name}</option>`).join('');
  }
}

function filterAdminProducts() {
  const searchInput = document.getElementById('admin-search-products');
  const brandSelect = document.getElementById('admin-filter-product-brand');
  currentSearchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';
  currentFilterBrand = brandSelect ? brandSelect.value : 'all';
  renderProductsTable();
}

function renderProductsTable() {
  const tbody = document.getElementById('admin-products-table-body');
  if (!tbody) return;

  let list = currentMasterData.products || [];

  if (currentFilterBrand !== 'all') {
    list = list.filter(p => p.brandId === currentFilterBrand || (p.brandName && p.brandName.toLowerCase() === currentFilterBrand.toLowerCase()));
  }

  if (currentSearchQuery) {
    list = list.filter(p =>
      p.name.toLowerCase().includes(currentSearchQuery) ||
      (p.brandName && p.brandName.toLowerCase().includes(currentSearchQuery)) ||
      (p.category && p.category.toLowerCase().includes(currentSearchQuery))
    );
  }

  document.getElementById('products-total-tag').innerText = `${list.length} de ${(currentMasterData.products || []).length} productos`;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">No se encontraron productos con el filtro aplicado.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(p => {
    const isActive = p.active !== false;
    const hasDiscount = Boolean(p.oldPrice && p.oldPrice > p.price);
    const shortDesc = p.description ? String(p.description).trim() : '';

    return `
      <tr>
        <td data-label="Foto">
          <div class="clickable-image-container" onclick="openQuickImageModal('product', '${escapeAttr(p.id)}')" title="Toca para cambiar la foto de este producto">
            <img src="${escapeAttr(p.image)}" alt="${escapeAttr(p.name)}" class="table-thumb" onerror="this.src='imagenes/logo-bloom-beauty.jpg'">
            <div class="img-change-overlay">📷 Cambiar</div>
          </div>
        </td>
        <td data-label="Nombre & Detalles">
          <div id="name-cell-${p.id}" class="editable-text-cell" onclick="enableInlineNameEdit('${escapeAttr(p.id)}', '${escapeAttr(p.name)}')" title="Toca para cambiar el nombre">
            <strong style="color: #FFF; font-size: 0.95rem;">${escapeAdminHtml(p.name)}</strong>
          </div>
          <div class="editable-text-cell" style="margin-top: 2px;" onclick="enableInlineProdDescEdit(this, '${escapeAttr(p.id)}')" title="Toca para escribir o editar la descripción del producto">
            <small style="color: ${shortDesc ? 'var(--text-muted)' : 'var(--text-dim)'}; display: block; max-width: 280px; line-height: 1.3;">
              ${shortDesc ? escapeAdminHtml(shortDesc.length > 72 ? shortDesc.slice(0, 72) + '…' : shortDesc) : '+ Toca para escribir descripción…'}
            </small>
          </div>
          <div id="badge-cell-${p.id}" class="editable-badge-wrap" onclick="enableInlineBadgeEdit('${escapeAttr(p.id)}', '${escapeAttr(p.badge || '')}')" title="Toca para cambiar o poner distintivo (Top Ventas, Kit Exclusivo, etc.)">
            ${p.badge ? `<span class="badge-chip">🏷️ ${escapeAdminHtml(p.badge)}</span>` : `<span class="badge-chip-empty">+ Añadir distintivo</span>`}
          </div>
        </td>
        <td data-label="Marca">
          <div id="brand-cell-${p.id}" class="editable-text-cell" onclick="enableInlineBrandEdit('${escapeAttr(p.id)}', '${escapeAttr(p.brandName || p.brandId)}')" title="Toca para elegir o escribir la marca">
            <span class="tag">👑 ${escapeAdminHtml(p.brandName || p.brandId)}</span>
          </div>
        </td>
        <td data-label="Categoría">
          <div id="category-cell-${p.id}" class="editable-text-cell" onclick="enableInlineCategoryEdit('${escapeAttr(p.id)}', '${escapeAttr(p.category || 'Capilar')}')" title="Toca para escribir la categoría">
            <span class="tag" style="background: rgba(255,255,255,0.05); color:#E5DEC9;">📂 ${escapeAdminHtml(p.category || 'Capilar')}</span>
          </div>
        </td>
        <td data-label="Precio Real">
          <div id="price-cell-${p.id}" class="clickable-price-badge" onclick="enableInlinePriceEdit('${escapeAttr(p.id)}', ${Number(p.price) || 0})" title="Toca para cambiar el precio de venta real">
            <span>${formatCOP(p.price)}</span>
            <span class="edit-hint-icon">✏️</span>
          </div>
        </td>
        <td data-label="Oferta / Regular">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <button class="btn-toggle-discount ${hasDiscount ? 'active' : ''}" 
                    onclick="toggleProductDiscount('${escapeAttr(p.id)}')" 
                    title="${hasDiscount ? 'Quitar oferta en 1 clic' : 'Activar precio de oferta (-20%) en 1 clic'}">
              ${hasDiscount ? '🔥 OFERTA' : '+ OFERTA'}
            </button>
            <span class="click-edit-chip" onclick="enableInlineOldPriceEdit(this, '${escapeAttr(p.id)}', ${Number(p.oldPrice) || 0})" title="Toca para escribir el precio anterior tachado exacto">
              ${hasDiscount ? `<span style="text-decoration: line-through; color: var(--gold-light);">${formatCOP(p.oldPrice)}</span>` : `<span style="color: var(--text-dim); font-size: 0.76rem;">+ Tachado</span>`}
            </span>
          </div>
        </td>
        <td data-label="Estado">
          <span class="badge-status status-clickable ${isActive ? 'active' : 'inactive'}" onclick="toggleProductStatus('${escapeAttr(p.id)}')" title="Toca para mostrar u ocultar en la tienda en 1 clic">
            ${isActive ? '✓ En Tienda' : '✕ Oculto'}
          </span>
        </td>
        <td data-label="Acciones" style="text-align: right; white-space: nowrap;">
          <button class="btn-table-action neutral" title="Duplicar producto en 1 clic" onclick="duplicateProductQuick('${escapeAttr(p.id)}')">
            <span>📋 Duplicar</span>
          </button>
          <button class="btn-table-action danger" title="Eliminar de la tienda" onclick="deleteProductConfirm('${escapeAttr(p.id)}')">
            <span>🗑️</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// ============================================================================
// FUNCIONES DE EDICIÓN EN LÍNEA AL TOCAR (NOMBRE, MARCA, CATEGORIA, PRECIO)
// ============================================================================

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 1. EDICIÓN DEL NOMBRE AL TOCARLO
function enableInlineNameEdit(prodId, currentName) {
  const container = document.getElementById(`name-cell-${prodId}`);
  if (!container || container.querySelector('input')) return;

  container.onclick = null;
  container.innerHTML = `
    <input type="text" 
           id="inline-name-input-${prodId}" 
           class="inline-edit-input" 
           value="${escapeAttr(currentName)}" 
           title="Presiona Enter para guardar el nuevo nombre">
  `;

  const input = document.getElementById(`inline-name-input-${prodId}`);
  if (input) {
    input.focus();
    input.select();

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveInlineName(prodId);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        renderProductsTable();
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        saveInlineName(prodId);
      }, 150);
    });
  }
}

function saveInlineName(prodId) {
  const input = document.getElementById(`inline-name-input-${prodId}`);
  if (!input) return;

  const newName = input.value.trim();
  if (!newName) {
    showAdminToast('El nombre no puede estar vacío', 'warning');
    renderProductsTable();
    return;
  }

  BloomDB.updateProduct(prodId, { name: newName });
  refreshDataFromDB();
  renderProductsTable();
  showAdminToast(`✨ Nombre actualizado: "${newName}"`, 'success');
}

// 1.1 EDICIÓN DEL DISTINTIVO / BADGE AL TOCARLO
function enableInlineBadgeEdit(prodId, currentBadge) {
  const container = document.getElementById(`badge-cell-${prodId}`);
  if (!container || container.querySelector('input')) return;

  container.onclick = null;
  container.innerHTML = `
    <input type="text" 
           id="inline-badge-input-${prodId}" 
           class="inline-edit-input" 
           style="min-width: 140px; font-size: 0.82rem; padding: 0.25rem 0.5rem;"
           value="${escapeAttr(currentBadge)}" 
           placeholder="Ej: Top Ventas, Kit Exclusivo..."
           title="Escribe el distintivo o déjalo vacío para quitarlo">
  `;

  const input = document.getElementById(`inline-badge-input-${prodId}`);
  if (input) {
    input.focus();
    input.select();

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveInlineBadge(prodId);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        renderProductsTable();
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        saveInlineBadge(prodId);
      }, 150);
    });
  }
}

function saveInlineBadge(prodId) {
  const input = document.getElementById(`inline-badge-input-${prodId}`);
  if (!input) return;

  const newBadge = input.value.trim();
  BloomDB.updateProduct(prodId, { badge: newBadge });
  refreshDataFromDB();
  renderProductsTable();
  showAdminToast(newBadge ? `🏷️ Distintivo guardado: "${newBadge}"` : '🏷️ Distintivo removido', 'success');
}

// 2. EDICIÓN DE LA MARCA AL TOCARLA (PERMITE ELEGIR EXISTENTE O ESCRIBIR UNA NUEVA)
function enableInlineBrandEdit(prodId, currentBrandName) {
  const container = document.getElementById(`brand-cell-${prodId}`);
  if (!container || container.querySelector('select') || container.querySelector('input')) return;

  container.onclick = null;
  const brands = currentMasterData.brands || [];
  
  // Construir opciones con todas las marcas existentes más la opción de nueva marca
  const optionsHtml = brands.map(b => {
    const isSelected = b.name.toLowerCase() === (currentBrandName || '').toLowerCase() ? 'selected' : '';
    return `<option value="${escapeAttr(b.name)}" ${isSelected}>${b.name}</option>`;
  }).join('');

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 4px; min-width: 170px;">
      <select id="inline-brand-select-${prodId}" class="inline-edit-input" style="font-size: 0.85rem; padding: 4px 6px;">
        ${optionsHtml}
        <option value="__NEW_BRAND__" style="color: var(--gold-light); font-weight: bold;">➕ Escribir nueva marca...</option>
      </select>
      <input type="text" 
             id="inline-brand-custom-input-${prodId}" 
             class="inline-edit-input" 
             style="display: none; font-size: 0.85rem; padding: 4px 6px;" 
             placeholder="Nombre de la nueva marca..." 
             title="Escribe la nueva marca y presiona Enter">
    </div>
  `;

  const sel = document.getElementById(`inline-brand-select-${prodId}`);
  const customInput = document.getElementById(`inline-brand-custom-input-${prodId}`);

  if (sel && customInput) {
    sel.focus();

    sel.addEventListener('change', () => {
      if (sel.value === '__NEW_BRAND__') {
        customInput.style.display = 'block';
        customInput.value = '';
        customInput.focus();
      } else {
        customInput.style.display = 'none';
        applyBrandSelection(prodId, sel.value);
      }
    });

    sel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        renderProductsTable();
      }
    });

    customInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const typed = customInput.value.trim();
        if (typed) {
          applyBrandSelection(prodId, typed);
        } else {
          renderProductsTable();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        renderProductsTable();
      }
    });

    customInput.addEventListener('blur', () => {
      setTimeout(() => {
        const typed = customInput.value.trim();
        if (typed && customInput.style.display !== 'none') {
          applyBrandSelection(prodId, typed);
        }
      }, 150);
    });
  }
}

function applyBrandSelection(prodId, chosenBrandName) {
  const brandNameClean = (chosenBrandName || '').trim();
  if (!brandNameClean || brandNameClean === '__NEW_BRAND__') {
    renderProductsTable();
    return;
  }

  const data = BloomDB.getData();
  let existingBrand = (data.brands || []).find(b => b.name.toLowerCase() === brandNameClean.toLowerCase());
  let brandId = '';

  if (existingBrand) {
    brandId = existingBrand.id;
  } else {
    brandId = brandNameClean.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    const autoBrand = {
      id: brandId,
      name: brandNameClean,
      category: 'Cuidado Capilar & Facial',
      tagline: `Tratamientos oficiales ${brandNameClean}`,
      description: `Marca agregada automáticamente desde el panel de control.`,
      badge: 'Oficial',
      logo: 'imagenes/logo-bloom-beauty.jpg',
      banner: 'imagenes/marcas/milagros-banner.jpg',
      active: true
    };
    data.brands.push(autoBrand);
    BloomDB.saveData(data);
  }

  BloomDB.updateProduct(prodId, {
    brandId: brandId,
    brandName: brandNameClean
  });

  refreshDataFromDB();
  populateBrandSelects();
  renderProductsTable();
  showAdminToast(`👑 Marca actualizada: "${brandNameClean}"`, 'success');
}

// 3. EDICIÓN DE LA CATEGORÍA ESCRITA MANUALMENTE AL TOCARLA
function enableInlineCategoryEdit(prodId, currentCategory) {
  const container = document.getElementById(`category-cell-${prodId}`);
  if (!container || container.querySelector('input')) return;

  container.onclick = null;
  container.innerHTML = `
    <input type="text" 
           id="inline-cat-input-${prodId}" 
           class="inline-edit-input" 
           style="min-width: 130px; font-size: 0.85rem;"
           value="${escapeAttr(currentCategory)}" 
           placeholder="Ej: Capilar, Facial..."
           title="Escribe la categoría y presiona Enter">
  `;

  const input = document.getElementById(`inline-cat-input-${prodId}`);
  if (input) {
    input.focus();
    input.select();

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveInlineCategory(prodId);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        renderProductsTable();
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        saveInlineCategory(prodId);
      }, 150);
    });
  }
}

function saveInlineCategory(prodId) {
  const input = document.getElementById(`inline-cat-input-${prodId}`);
  if (!input) return;

  const newCat = input.value.trim() || 'Capilar';
  BloomDB.updateProduct(prodId, { category: newCat });

  refreshDataFromDB();
  renderProductsTable();
  showAdminToast(`📂 Categoría actualizada a "${newCat}"`, 'success');
}

// 3.1 INTERRUPTOR PARA ACTIVAR O QUITAR DESCUENTO COMERCIAL LIMPIO (20% REDONDEADO) + PRECIO TACHADO Y DESCRIPCIÓN EN 1 CLIC
function toggleProductDiscount(prodId) {
  const prod = (currentMasterData.products || []).find(p => String(p.id) === String(prodId));
  if (!prod) return;

  const hasDiscount = Boolean(prod.oldPrice && prod.oldPrice > prod.price);

  if (hasDiscount) {
    BloomDB.updateProduct(prodId, { oldPrice: null });
    showAdminToast(`Descuento desactivado para "${prod.name}"`, 'info');
  } else {
    const rawOld = prod.price / 0.80;
    let calculatedOldPrice = Math.round(rawOld / 500) * 500;
    if (calculatedOldPrice <= prod.price) {
      calculatedOldPrice = Math.round((prod.price * 1.20) / 100) * 100;
    }
    const appliedSaving = Math.round(((calculatedOldPrice - prod.price) / calculatedOldPrice) * 100);
    BloomDB.updateProduct(prodId, { oldPrice: calculatedOldPrice });
    showAdminToast(`🔥 Oferta del ${appliedSaving}% activada (Antes: ${formatCOP(calculatedOldPrice)})`, 'success');
  }

  refreshDataFromDB();
  renderProductsTable();
}

function enableInlineOldPriceEdit(el, prodId, currentOldPrice) {
  const prod = (currentMasterData.products || []).find(p => String(p.id) === String(prodId));
  if (!prod) return;
  const suggested = currentOldPrice && currentOldPrice > prod.price
    ? currentOldPrice
    : Math.round((prod.price * 1.2) / 500) * 500;

  openInlineFieldEditor(el, {
    type: 'number',
    value: suggested,
    min: 0,
    step: 500,
    style: 'width: 115px; font-size: 0.84rem;',
    placeholder: 'Precio antes',
    onSave: (val) => {
      const num = Math.round(Number(String(val || '').replace(/[^0-9]/g, '')) || 0);
      if (num <= 0 || num <= prod.price) {
        BloomDB.updateProduct(prodId, { oldPrice: null });
        showAdminToast('Precio tachado quitado (debe ser mayor al precio real)', 'info');
      } else {
        BloomDB.updateProduct(prodId, { oldPrice: num });
        showAdminToast(`🔥 Precio anterior fijado en ${formatCOP(num)}`, 'success');
      }
      refreshDataFromDB();
      renderProductsTable();
    },
    onCancel: renderProductsTable
  });
}

function enableInlineProdDescEdit(el, prodId) {
  const prod = (currentMasterData.products || []).find(p => String(p.id) === String(prodId));
  if (!prod) return;
  openInlineFieldEditor(el, {
    type: 'textarea',
    rows: 2,
    value: prod.description || '',
    style: 'min-width: 240px; font-size: 0.82rem;',
    placeholder: 'Beneficios, ingredientes o presentación...',
    onSave: (val) => {
      BloomDB.updateProduct(prodId, { description: String(val || '').trim() });
      refreshDataFromDB();
      renderProductsTable();
      showAdminToast('✨ Descripción del producto actualizada', 'success');
    },
    onCancel: renderProductsTable
  });
}

function duplicateProductQuick(prodId) {
  const prod = (currentMasterData.products || []).find(p => String(p.id) === String(prodId));
  if (!prod) return;
  const cloned = BloomDB.addProduct({
    name: `${prod.name} (Copia)`,
    brandId: prod.brandId,
    brandName: prod.brandName,
    category: prod.category || 'Capilar',
    price: prod.price,
    oldPrice: prod.oldPrice || null,
    badge: prod.badge || '',
    image: prod.image,
    description: prod.description || '',
    active: true
  });
  refreshDataFromDB();
  renderProductsTable();
  showAdminToast('📋 Producto duplicado — toca su nombre para editarlo', 'success');
  setTimeout(() => {
    const nameEl = document.getElementById(`name-cell-${cloned.id}`);
    if (nameEl) {
      nameEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      enableInlineNameEdit(cloned.id, cloned.name);
    }
  }, 150);
}

// 4. EDICIÓN DEL PRECIO REAL AL TOCARLO (RECALCULA DESCUENTO REGULAR AUTOMÁTICAMENTE)
function enableInlinePriceEdit(prodId, currentPrice) {
  const container = document.getElementById(`price-cell-${prodId}`);
  if (!container || container.querySelector('input')) return;

  const currentVal = currentPrice || 0;
  container.onclick = null; // Evitar disparos repetidos
  container.innerHTML = `
    <input type="number" 
           id="inline-input-${prodId}" 
           class="inline-price-input" 
           value="${currentVal}" 
           step="500" 
           min="0"
           title="Presiona Enter o haz clic afuera para guardar">
    <button type="button" class="btn-table-action primary" style="padding: 0.2rem 0.5rem;" onclick="event.stopPropagation(); saveInlinePrice('${prodId}')">✓ Guardar</button>
  `;

  const input = document.getElementById(`inline-input-${prodId}`);
  if (input) {
    input.focus();
    input.select();

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveInlinePrice(prodId);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        renderProductsTable();
      }
    });

    input.addEventListener('blur', (e) => {
      // Guardar automáticamente si el usuario hace clic afuera
      setTimeout(() => {
        saveInlinePrice(prodId);
      }, 150);
    });
  }
}

function saveInlinePrice(prodId) {
  const input = document.getElementById(`inline-input-${prodId}`);
  if (!input) return;

  const rawVal = String(input.value || '').replace(/[^0-9]/g, '');
  const newVal = parseInt(rawVal, 10);
  if (isNaN(newVal) || newVal <= 0) {
    showAdminToast('Por favor introduce un precio numérico válido mayor a 0', 'warning');
    renderProductsTable();
    return;
  }

  BloomDB.updatePrice(prodId, newVal);
  refreshDataFromDB();
  renderProductsTable();
  showAdminToast(`💰 Precio actualizado a ${formatCOP(newVal)}`, 'success');
}

function promptQuickPriceChange(prodId, currentPrice) {
  enableInlinePriceEdit(prodId, currentPrice);
}

function toggleProductStatus(prodId) {
  BloomDB.toggleProduct(prodId);
  refreshDataFromDB();
  renderProductsTable();
}

function deleteProductConfirm(prodId) {
  BloomDB.deleteProduct(prodId);
  refreshDataFromDB();
  renderProductsTable();
}

function addNewGenericProduct() {
  // 1. Obtener la marca actualmente seleccionada en el menú desplegable de filtro
  const brandFilterSelect = document.getElementById('admin-filter-product-brand');
  const activeFilterValue = brandFilterSelect ? brandFilterSelect.value : (currentFilterBrand || 'all');

  let defaultBrandId = 'bloom-beauty';
  let defaultBrandName = 'Bloom Beauty';

  if (activeFilterValue && activeFilterValue !== 'all') {
    const brandObj = (currentMasterData.brands || []).find(b => 
      String(b.id) === String(activeFilterValue) || 
      b.name.toLowerCase() === String(activeFilterValue).toLowerCase()
    );

    if (brandObj) {
      defaultBrandId = brandObj.id;
      defaultBrandName = brandObj.name;
    } else {
      defaultBrandName = activeFilterValue;
      defaultBrandId = activeFilterValue.toLowerCase().replace(/[^a-z0-9]/g, '-');
    }
  }

  // 2. Si había una búsqueda por texto activa, limpiarla para no esconder el nuevo producto
  const searchInput = document.getElementById('admin-search-products');
  if (searchInput && searchInput.value.trim() !== '') {
    searchInput.value = '';
    currentSearchQuery = '';
  }

  // 3. Crear el producto nuevo asignándole exactamente esa marca
  const newProd = BloomDB.addProduct({
    name: 'Nuevo Producto (Toca para cambiar)',
    brandId: defaultBrandId,
    brandName: defaultBrandName,
    category: 'Capilar',
    price: 35000,
    oldPrice: null,
    badge: 'Nuevo',
    image: 'imagenes/logo-bloom-beauty.jpg',
    description: 'Descripción del nuevo producto. Toca para editar sus detalles.',
    active: true
  });

  // 4. Actualizar datos y mantener el filtro activo en esa marca
  refreshDataFromDB();
  currentFilterBrand = activeFilterValue;
  populateBrandSelects();
  if (brandFilterSelect) {
    brandFilterSelect.value = activeFilterValue;
  }
  renderProductsTable();

  // 5. Scroll suave y habilitar edición de nombre al instante
  setTimeout(() => {
    const nameEl = document.getElementById(`name-cell-${newProd.id}`);
    if (nameEl) {
      nameEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      enableInlineNameEdit(newProd.id, newProd.name);
    }
  }, 200);
}

function openProductModal(prod = null) {
  populateBrandSelects();
  const form = document.getElementById('form-product');
  form.reset();

  const customBrandInput = document.getElementById('prod-form-new-brand');
  if (customBrandInput) {
    customBrandInput.style.display = 'none';
    customBrandInput.value = '';
  }

  if (prod) {
    document.getElementById('modal-product-title').innerText = 'Editar Producto & Precio';
    document.getElementById('prod-form-id').value = prod.id;
    document.getElementById('prod-form-name').value = prod.name;
    document.getElementById('prod-form-brand').value = prod.brandId;
    document.getElementById('prod-form-category').value = prod.category || 'Capilar';
    document.getElementById('prod-form-price').value = prod.price;
    document.getElementById('prod-form-old-price').value = prod.oldPrice || '';
    document.getElementById('prod-form-badge').value = prod.badge || '';
    document.getElementById('prod-form-image').value = prod.image;
    document.getElementById('prod-form-desc').value = prod.description || '';
    document.getElementById('prod-form-active').checked = prod.active !== false;
  } else {
    document.getElementById('modal-product-title').innerText = 'Añadir Nuevo Producto al Catálogo';
    document.getElementById('prod-form-id').value = '';
    document.getElementById('prod-form-active').checked = true;
    document.getElementById('prod-form-image').value = 'imagenes/productos/milagros.webp';
  }

  document.getElementById('modal-product').classList.add('open');
}

function handleModalBrandChange(selectEl) {
  const customBrandInput = document.getElementById('prod-form-new-brand');
  if (!customBrandInput) return;
  if (selectEl.value === '__NEW_BRAND__') {
    customBrandInput.style.display = 'block';
    customBrandInput.focus();
  } else {
    customBrandInput.style.display = 'none';
  }
}

function editProductModal(prodId) {
  const prod = (currentMasterData.products || []).find(p => String(p.id) === String(prodId));
  if (prod) openProductModal(prod);
}

function saveProductSubmit(e) {
  e.preventDefault();
  const prodId = document.getElementById('prod-form-id').value;
  const brandSelect = document.getElementById('prod-form-brand');
  const customBrandInput = document.getElementById('prod-form-new-brand');

  let chosenBrandName = '';
  let chosenBrandId = '';

  if (brandSelect.value === '__NEW_BRAND__') {
    chosenBrandName = (customBrandInput ? customBrandInput.value.trim() : '') || 'Nueva Marca';
  } else {
    const selectedBrandOption = brandSelect.options[brandSelect.selectedIndex];
    chosenBrandName = selectedBrandOption ? (selectedBrandOption.getAttribute('data-name') || selectedBrandOption.text) : brandSelect.value;
    chosenBrandId = brandSelect.value;
  }

  // Auto-crear la marca en BloomDB si no existe
  const data = BloomDB.getData();
  let existingBrand = (data.brands || []).find(b => b.name.toLowerCase() === chosenBrandName.toLowerCase() || b.id === chosenBrandId);
  if (existingBrand) {
    chosenBrandId = existingBrand.id;
    chosenBrandName = existingBrand.name;
  } else {
    chosenBrandId = chosenBrandName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    const autoBrand = {
      id: chosenBrandId,
      name: chosenBrandName,
      category: 'Cuidado Capilar & Facial',
      tagline: `Tratamientos oficiales ${chosenBrandName}`,
      description: `Marca agregada automáticamente desde el catálogo de productos.`,
      badge: 'Oficial',
      logo: 'imagenes/logo-bloom-beauty.jpg',
      banner: 'imagenes/marcas/milagros-banner.jpg',
      active: true
    };
    data.brands.push(autoBrand);
    BloomDB.saveData(data);
  }

  const payload = {
    name: document.getElementById('prod-form-name').value.trim(),
    brandId: chosenBrandId,
    brandName: chosenBrandName,
    category: document.getElementById('prod-form-category').value,
    price: Number(document.getElementById('prod-form-price').value),
    oldPrice: document.getElementById('prod-form-old-price').value ? Number(document.getElementById('prod-form-old-price').value) : null,
    badge: document.getElementById('prod-form-badge').value.trim(),
    image: document.getElementById('prod-form-image').value.trim(),
    description: document.getElementById('prod-form-desc').value.trim(),
    active: document.getElementById('prod-form-active').checked
  };

  if (prodId) {
    BloomDB.updateProduct(prodId, payload);
  } else {
    BloomDB.addProduct(payload);
  }

  closeAdminModal('modal-product');
  refreshDataFromDB();
  populateBrandSelects();
  renderProductsTable();
}

function syncBrandNameFromSelect() {}

// ============================================================================
// 6. VISTA: MARCAS (AÑADIR, QUITAR, ACTIVAR)
// ============================================================================
function renderBrandsTable() {
  const tbody = document.getElementById('admin-brands-table-body');
  if (!tbody) return;

  const brands = currentMasterData.brands || [];
  const prods = currentMasterData.products || [];
  document.getElementById('brands-total-tag').innerText = `${brands.length} marcas oficiales`;

  tbody.innerHTML = brands.map(b => {
    const assignedCount = prods.filter(p => p.brandId === b.id || (p.brandName && p.brandName.toLowerCase() === b.name.toLowerCase())).length;
    const isActive = b.active !== false;
    const shortDesc = b.description ? String(b.description).trim() : '';

    return `
      <tr>
        <td data-label="Logo & Banner">
          <div style="display: inline-flex; align-items: center; gap: 8px;">
            <div class="clickable-image-container" onclick="openQuickImageModal('brand', '${escapeAttr(b.id)}')" title="Toca para cambiar el Logo de esta marca">
              <img src="${escapeAttr(b.logo)}" alt="${escapeAttr(b.name)}" class="table-thumb" onerror="this.src='imagenes/logo-bloom-beauty.jpg'">
              <div class="img-change-overlay">📷 Logo</div>
            </div>
            <div class="clickable-image-container" style="width: 68px;" onclick="openQuickImageModal('brand-banner', '${escapeAttr(b.id)}')" title="Toca para cambiar el Banner horizontal de esta marca">
              <img src="${escapeAttr(b.banner || b.logo)}" alt="Banner" class="table-thumb" style="width: 68px; object-fit: cover;" onerror="this.src='imagenes/logo-bloom-beauty.jpg'">
              <div class="img-change-overlay">🖼️ Banner</div>
            </div>
          </div>
        </td>
        <td data-label="Marca">
          <div id="brand-name-cell-${b.id}" class="editable-text-cell" onclick="enableInlineBrandTableNameEdit('${escapeAttr(b.id)}', '${escapeAttr(b.name)}')" title="Toca para cambiar el nombre de la marca">
            <strong style="font-size: 1rem; color: #FFF;">${escapeAdminHtml(b.name)}</strong>
          </div>
          <div id="brand-badge-cell-${b.id}" class="editable-badge-wrap" onclick="enableInlineBrandTableBadgeEdit('${escapeAttr(b.id)}', '${escapeAttr(b.badge || '')}')" title="Toca para cambiar o poner distintivo">
            ${b.badge ? `<span class="badge-chip">🏷️ ${escapeAdminHtml(b.badge)}</span>` : `<span class="badge-chip-empty">+ Añadir distintivo</span>`}
          </div>
        </td>
        <td data-label="Categoría">
          <div id="brand-cat-cell-${b.id}" class="editable-text-cell" onclick="enableInlineBrandTableCatEdit('${escapeAttr(b.id)}', '${escapeAttr(b.category || '')}')" title="Toca para escribir la categoría/especialidad">
            <span>${escapeAdminHtml(b.category || 'Cosmética')}</span>
          </div>
        </td>
        <td data-label="Eslogan & Bio">
          <div id="brand-tagline-cell-${b.id}" class="editable-text-cell" onclick="enableInlineBrandTableTaglineEdit('${escapeAttr(b.id)}', '${escapeAttr(b.tagline || '')}')" title="Toca para escribir el eslogan o frase">
            <span style="color: var(--gold-light); font-size: 0.85rem; max-width: 260px;">${escapeAdminHtml(b.tagline || '+ Toca para agregar eslogan...')}</span>
          </div>
          <div class="editable-text-cell" style="margin-top: 3px;" onclick="enableInlineBrandDescEdit(this, '${escapeAttr(b.id)}')" title="Toca para editar la descripción de la marca">
            <small style="color: var(--text-muted); display: block; max-width: 260px; line-height: 1.3;">
              ${shortDesc ? escapeAdminHtml(shortDesc.length > 65 ? shortDesc.slice(0, 65) + '…' : shortDesc) : '+ Toca para agregar descripción...'}
            </small>
          </div>
        </td>
        <td data-label="Catálogo">
          <span class="click-edit-chip" onclick="jumpToBrandProducts('${escapeAttr(b.id)}')" title="Ver los productos de esta marca en 1 clic">
            <strong style="color: var(--gold-light);">🛍️ ${assignedCount} prod. &rarr;</strong>
          </span>
        </td>
        <td data-label="Estado">
          <span class="badge-status status-clickable ${isActive ? 'active' : 'inactive'}" onclick="toggleBrandStatus('${escapeAttr(b.id)}')" title="Toca para activar o desactivar esta marca en la tienda">
            ${isActive ? '✓ Visible' : '✕ Oculta'}
          </span>
        </td>
        <td data-label="Acciones" style="text-align: right; white-space: nowrap;">
          <button class="btn-table-action danger" title="Eliminar Marca de la Tienda" onclick="deleteBrandConfirm('${escapeAttr(b.id)}')">
            <span>🗑️ Borrar</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function jumpToBrandProducts(brandId) {
  currentFilterBrand = brandId;
  switchAdminView('products');
  const sel = document.getElementById('admin-filter-product-brand');
  if (sel) sel.value = brandId;
  renderProductsTable();
}

function enableInlineBrandDescEdit(el, brandId) {
  const brand = (currentMasterData.brands || []).find(b => String(b.id) === String(brandId));
  if (!brand) return;
  openInlineFieldEditor(el, {
    type: 'textarea',
    rows: 2,
    value: brand.description || '',
    style: 'min-width: 230px; font-size: 0.82rem;',
    placeholder: 'Descripción oficial de la marca...',
    onSave: (val) => {
      const data = BloomDB.getData();
      const target = (data.brands || []).find(item => String(item.id) === String(brandId));
      if (target) {
        target.description = String(val || '').trim();
        BloomDB.saveData(data);
      }
      refreshDataFromDB();
      renderBrandsTable();
      showAdminToast('✨ Descripción de marca actualizada', 'success');
    },
    onCancel: renderBrandsTable
  });
}

function toggleBrandStatus(brandId) {
  BloomDB.toggleBrand(brandId);
  refreshDataFromDB();
  renderBrandsTable();
}

function deleteBrandConfirm(brandId) {
  BloomDB.deleteBrand(brandId);
  refreshDataFromDB();
  renderBrandsTable();
}

// ----------------------------------------------------------------------------
// EDICIÓN EN LÍNEA DIRECTA EN LA TABLA DE MARCAS (AL TOCAR)
// ----------------------------------------------------------------------------
function enableInlineBrandTableNameEdit(brandId, currentName) {
  const container = document.getElementById(`brand-name-cell-${brandId}`);
  if (!container || container.querySelector('input')) return;

  container.onclick = null;
  container.innerHTML = `
    <input type="text" 
           id="inline-tbl-brand-name-${brandId}" 
           class="inline-edit-input" 
           style="font-size: 0.95rem; font-weight: 700;"
           value="${escapeAttr(currentName)}" 
           title="Presiona Enter para guardar el nombre de la marca">
  `;

  const input = document.getElementById(`inline-tbl-brand-name-${brandId}`);
  if (input) {
    input.focus();
    input.select();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveInlineBrandTableName(brandId);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        renderBrandsTable();
      }
    });
    input.addEventListener('blur', () => {
      setTimeout(() => { saveInlineBrandTableName(brandId); }, 150);
    });
  }
}

function saveInlineBrandTableName(brandId) {
  const input = document.getElementById(`inline-tbl-brand-name-${brandId}`);
  if (!input) return;

  const newName = input.value.trim();
  if (!newName) {
    showAdminToast('El nombre de la marca no puede estar vacío', 'warning');
    renderBrandsTable();
    return;
  }

  const data = BloomDB.getData();
  const b = data.brands.find(item => String(item.id) === String(brandId));
  if (b) {
    const oldName = b.name;
    b.name = newName;
    // Sincronizar también el nombre de la marca en todos sus productos de la tienda
    (data.products || []).forEach(prod => {
      if (String(prod.brandId) === String(brandId) || (oldName && prod.brandName && prod.brandName.toLowerCase() === oldName.toLowerCase())) {
        prod.brandName = newName;
      }
    });
    BloomDB.saveData(data);
  }

  refreshDataFromDB();
  populateBrandSelects();
  renderBrandsTable();
  showAdminToast(`👑 Marca actualizada: "${newName}"`, 'success');
}

function enableInlineBrandTableBadgeEdit(brandId, currentBadge) {
  const container = document.getElementById(`brand-badge-cell-${brandId}`);
  if (!container || container.querySelector('input')) return;

  container.onclick = null;
  container.innerHTML = `
    <input type="text" 
           id="inline-tbl-brand-badge-${brandId}" 
           class="inline-edit-input" 
           style="min-width: 140px; font-size: 0.8rem; padding: 0.2rem 0.5rem;"
           value="${escapeAttr(currentBadge)}" 
           placeholder="Ej: Top Ventas, Oficial..."
           title="Escribe el distintivo o déjalo vacío">
  `;

  const input = document.getElementById(`inline-tbl-brand-badge-${brandId}`);
  if (input) {
    input.focus();
    input.select();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveInlineBrandTableBadge(brandId);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        renderBrandsTable();
      }
    });
    input.addEventListener('blur', () => {
      setTimeout(() => { saveInlineBrandTableBadge(brandId); }, 150);
    });
  }
}

function saveInlineBrandTableBadge(brandId) {
  const input = document.getElementById(`inline-tbl-brand-badge-${brandId}`);
  if (!input) return;

  const newBadge = input.value.trim();
  const data = BloomDB.getData();
  const b = data.brands.find(item => String(item.id) === String(brandId));
  if (b) {
    b.badge = newBadge;
    BloomDB.saveData(data);
  }

  refreshDataFromDB();
  renderBrandsTable();
  showAdminToast(newBadge ? `🏷️ Distintivo de marca guardado: "${newBadge}"` : '🏷️ Distintivo de marca removido', 'success');
}

function enableInlineBrandTableCatEdit(brandId, currentCat) {
  const container = document.getElementById(`brand-cat-cell-${brandId}`);
  if (!container || container.querySelector('input')) return;

  container.onclick = null;
  container.innerHTML = `
    <input type="text" 
           id="inline-tbl-brand-cat-${brandId}" 
           class="inline-edit-input" 
           style="min-width: 150px; font-size: 0.85rem;"
           value="${escapeAttr(currentCat)}" 
           placeholder="Ej: Cuidado Capilar..."
           title="Escribe la categoría/especialidad">
  `;

  const input = document.getElementById(`inline-tbl-brand-cat-${brandId}`);
  if (input) {
    input.focus();
    input.select();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveInlineBrandTableCat(brandId);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        renderBrandsTable();
      }
    });
    input.addEventListener('blur', () => {
      setTimeout(() => { saveInlineBrandTableCat(brandId); }, 150);
    });
  }
}

function saveInlineBrandTableCat(brandId) {
  const input = document.getElementById(`inline-tbl-brand-cat-${brandId}`);
  if (!input) return;

  const newCat = input.value.trim();
  const data = BloomDB.getData();
  const b = data.brands.find(item => String(item.id) === String(brandId));
  if (b) {
    b.category = newCat;
    BloomDB.saveData(data);
  }

  refreshDataFromDB();
  renderBrandsTable();
  showAdminToast(`📂 Categoría de marca actualizada a "${newCat}"`, 'success');
}

function enableInlineBrandTableTaglineEdit(brandId, currentTagline) {
  const container = document.getElementById(`brand-tagline-cell-${brandId}`);
  if (!container || container.querySelector('input')) return;

  container.onclick = null;
  container.innerHTML = `
    <input type="text" 
           id="inline-tbl-brand-tagline-${brandId}" 
           class="inline-edit-input" 
           style="min-width: 200px; font-size: 0.85rem;"
           value="${escapeAttr(currentTagline)}" 
           placeholder="Ej: Fórmulas botánicas y nutrición..."
           title="Escribe la frase o eslogan">
  `;

  const input = document.getElementById(`inline-tbl-brand-tagline-${brandId}`);
  if (input) {
    input.focus();
    input.select();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveInlineBrandTableTagline(brandId);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        renderBrandsTable();
      }
    });
    input.addEventListener('blur', () => {
      setTimeout(() => { saveInlineBrandTableTagline(brandId); }, 150);
    });
  }
}

function saveInlineBrandTableTagline(brandId) {
  const input = document.getElementById(`inline-tbl-brand-tagline-${brandId}`);
  if (!input) return;

  const newTagline = input.value.trim();
  const data = BloomDB.getData();
  const b = data.brands.find(item => String(item.id) === String(brandId));
  if (b) {
    b.tagline = newTagline;
    BloomDB.saveData(data);
  }

  refreshDataFromDB();
  renderBrandsTable();
  showAdminToast('✨ Eslogan de marca actualizado con éxito', 'success');
}

function addNewGenericBrand() {
  const autoId = 'brand-' + Date.now().toString().slice(-5);
  const newBrand = BloomDB.addBrand({
    id: autoId,
    name: 'Nueva Marca (Toca para cambiar)',
    category: 'Cuidado Capilar & Facial',
    tagline: 'Eslogan oficial de la marca. Toca para cambiarlo.',
    description: 'Tratamientos y productos originales.',
    badge: 'Top Ventas',
    logo: 'imagenes/logo-bloom-beauty.jpg',
    banner: 'imagenes/marcas/milagros-banner.jpg',
    active: true
  });

  refreshDataFromDB();
  populateBrandSelects();
  renderBrandsTable();

  // Scroll automático y enfocar la nueva marca
  setTimeout(() => {
    const el = document.getElementById(`brand-name-cell-${newBrand.id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      enableInlineBrandTableNameEdit(newBrand.id, newBrand.name);
    }
  }, 200);
}

function openBrandModal(brand = null) {
  const form = document.getElementById('form-brand');
  form.reset();

  if (brand) {
    document.getElementById('modal-brand-title').innerText = 'Editar Marca Oficial';
    document.getElementById('brand-form-id').value = brand.id;
    document.getElementById('brand-form-name').value = brand.name;
    document.getElementById('brand-form-category').value = brand.category || '';
    document.getElementById('brand-form-badge').value = brand.badge || '';
    document.getElementById('brand-form-tagline').value = brand.tagline || '';
    document.getElementById('brand-form-desc').value = brand.description || '';
    document.getElementById('brand-form-logo').value = brand.logo || '';
    document.getElementById('brand-form-banner').value = brand.banner || '';
    document.getElementById('brand-form-active').checked = brand.active !== false;
  } else {
    document.getElementById('modal-brand-title').innerText = 'Añadir Nueva Marca Oficial';
    document.getElementById('brand-form-id').value = '';
    document.getElementById('brand-form-active').checked = true;
    document.getElementById('brand-form-logo').value = 'imagenes/logo-bloom-beauty.jpg';
    document.getElementById('brand-form-banner').value = 'imagenes/marcas/milagros-banner.jpg';
  }

  document.getElementById('modal-brand').classList.add('open');
}

function editBrandModal(brandId) {
  const b = (currentMasterData.brands || []).find(brand => String(brand.id) === String(brandId));
  if (b) openBrandModal(b);
}

function saveBrandSubmit(e) {
  e.preventDefault();
  const brandId = document.getElementById('brand-form-id').value;
  const payload = {
    name: document.getElementById('brand-form-name').value.trim(),
    category: document.getElementById('brand-form-category').value.trim(),
    badge: document.getElementById('brand-form-badge').value.trim(),
    tagline: document.getElementById('brand-form-tagline').value.trim(),
    description: document.getElementById('brand-form-desc').value.trim(),
    logo: document.getElementById('brand-form-logo').value.trim(),
    banner: document.getElementById('brand-form-banner').value.trim(),
    active: document.getElementById('brand-form-active').checked
  };

  if (brandId) {
    const data = BloomDB.getData();
    const target = data.brands.find(b => String(b.id) === String(brandId));
    if (target) Object.assign(target, payload);
    BloomDB.saveData(data);
  } else {
    BloomDB.addBrand(payload);
  }

  closeAdminModal('modal-brand');
  refreshDataFromDB();
  renderBrandsTable();
}

// ============================================================================
// 7. VISTA: OFERTAS, BANNERS & CUPONES (EDICIÓN 100% EN 1 CLIC)
// ============================================================================
function renderOffersTable() {
  const tbody = document.getElementById('admin-offers-table-body');
  if (!tbody) return;

  const offers = currentOffers || [];
  document.getElementById('offers-total-tag').innerText = `${offers.length} ofertas`;

  if (offers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">No hay ofertas creadas aún. Pulsa <strong>"⚡ ➕ Nueva Oferta en 1 Clic"</strong> para lanzar promociones al instante.</td></tr>`;
    return;
  }

  tbody.innerHTML = offers.map(o => {
    const isActive = o.active !== false;
    return `
      <tr>
        <td data-label="Título">
          <div id="offer-title-cell-${o.id}" class="editable-text-cell" onclick="editOfferFieldInline(this, '${escapeAttr(o.id)}', 'title')" title="Toca para editar el título de la oferta">
            <strong style="color: #FFF; font-size: 0.95rem;">${escapeAdminHtml(o.title || 'Oferta Especial')}</strong>
          </div>
        </td>
        <td data-label="% OFF">
          <span class="click-edit-chip" style="background: rgba(239, 68, 68, 0.15); color: #F87171; border-color: rgba(239, 68, 68, 0.35); font-weight: 800;" onclick="editOfferFieldInline(this, '${escapeAttr(o.id)}', 'discountPercent')" title="Toca para cambiar el porcentaje de descuento">
            -${Number(o.discountPercent) || 0}% OFF ✏️
          </span>
        </td>
        <td data-label="Barra Superior">
          <div class="editable-text-cell" onclick="editOfferFieldInline(this, '${escapeAttr(o.id)}', 'bannerText')" title="Toca para editar el anuncio que sale arriba en la tienda">
            <span style="color: var(--gold-light); font-size: 0.86rem;">"${escapeAdminHtml(o.bannerText || o.title || 'Toca para escribir anuncio...')}"</span>
          </div>
        </td>
        <td data-label="Marca">
          <span class="click-edit-chip" onclick="editOfferBrandInline(this, '${escapeAttr(o.id)}')" title="Toca para elegir la marca donde aplica">
            👑 ${escapeAdminHtml(o.targetBrand || 'Todas')}
          </span>
        </td>
        <td data-label="Cupón">
          <span class="click-edit-chip" onclick="editOfferFieldInline(this, '${escapeAttr(o.id)}', 'couponCode')" title="Toca para escribir o cambiar el código de cupón">
            <code>${escapeAdminHtml(o.couponCode || '+ Cupón')}</code>
          </span>
        </td>
        <td data-label="Vencimiento">
          <div class="editable-text-cell" onclick="editOfferFieldInline(this, '${escapeAttr(o.id)}', 'expiresAt')" title="Toca para cambiar fecha o vigencia">
            <span>${escapeAdminHtml(o.expiresAt || 'Vigente hoy')}</span>
          </div>
        </td>
        <td data-label="Estado">
          <span class="badge-status status-clickable ${isActive ? 'active' : 'inactive'}" onclick="toggleOfferStatus('${escapeAttr(o.id)}')" title="Toca para activar o pausar en 1 clic">
            ${isActive ? '✓ Activa' : '✕ Pausada'}
          </span>
        </td>
        <td data-label="Acciones" style="text-align: right; white-space: nowrap;">
          <button class="btn-table-action danger" title="Eliminar Oferta" onclick="deleteOfferConfirm('${escapeAttr(o.id)}')">
            <span>🗑️ Quitar</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function addQuickOffer() {
  const created = BloomDB.addOffer({
    title: 'Promoción Especial VIP',
    discountPercent: 15,
    couponCode: 'BLOOM15',
    bannerText: '🔥 15% OFF HOY CON EL CUPÓN BLOOM15 • ENVÍOS A TODA COLOMBIA',
    targetBrand: 'Todas',
    expiresAt: 'Tiempo limitado',
    description: 'Promoción activa en tienda oficial',
    active: true
  });
  // Mostrar en la barra superior de la tienda el anuncio de oferta activa
  const data = BloomDB.getData();
  if (data && data.storeInfo) {
    data.storeInfo.useCustomPromoText = false;
    data.storeInfo.promoActive = true;
    BloomDB.saveData(data);
  }
  refreshDataFromDB();
  renderOffersTable();
  showAdminToast('🔥 Oferta creada en vivo — toca cualquier dato para ajustarlo', 'success');
  setTimeout(() => {
    const el = created && document.getElementById(`offer-title-cell-${created.id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      editOfferFieldInline(el, created.id, 'title');
    }
  }, 150);
}

function editOfferFieldInline(el, offerId, field) {
  const offers = BloomDB.getOffers() || [];
  const target = offers.find(o => String(o.id) === String(offerId));
  if (!target) return;

  const isPct = field === 'discountPercent';
  openInlineFieldEditor(el, {
    type: isPct ? 'number' : 'text',
    value: isPct ? (Number(target.discountPercent) || 0) : (target[field] || ''),
    min: isPct ? 0 : undefined,
    max: isPct ? 100 : undefined,
    style: isPct ? 'width: 82px;' : 'min-width: 150px;',
    placeholder: field === 'couponCode' ? 'Ej: BLOOM20' : '',
    onSave: (val) => {
      const list = BloomDB.getOffers() || [];
      const item = list.find(o => String(o.id) === String(offerId));
      if (item) {
        if (isPct) {
          item.discountPercent = Math.min(100, Math.max(0, Math.round(Number(val) || 0)));
        } else if (field === 'couponCode') {
          item.couponCode = String(val || '').trim().toUpperCase().replace(/\s+/g, '');
        } else {
          const clean = String(val || '').trim();
          if (field === 'title' && !clean) {
            renderOffersTable();
            return;
          }
          item[field] = clean;
        }
        BloomDB.saveOffers(list);
        if (field === 'bannerText') {
          const data = BloomDB.getData();
          if (data && data.storeInfo) {
            data.storeInfo.useCustomPromoText = false;
            BloomDB.saveData(data);
          }
        }
      }
      refreshDataFromDB();
      renderOffersTable();
      showAdminToast('🔥 Oferta actualizada y sincronizada con la tienda', 'success');
    },
    onCancel: renderOffersTable
  });
}

function editOfferBrandInline(el, offerId) {
  const offers = BloomDB.getOffers() || [];
  const target = offers.find(o => String(o.id) === String(offerId));
  if (!target) return;
  const brands = (currentMasterData && currentMasterData.brands) || [];
  const opts = [{ value: 'Todas', label: 'Todas las Marcas' }]
    .concat(brands.map(b => ({ value: b.name, label: b.name })));

  openInlineFieldEditor(el, {
    type: 'select',
    value: target.targetBrand || 'Todas',
    options: opts,
    onSave: (val) => {
      const list = BloomDB.getOffers() || [];
      const item = list.find(o => String(o.id) === String(offerId));
      if (item) {
        item.targetBrand = val || 'Todas';
        BloomDB.saveOffers(list);
      }
      refreshDataFromDB();
      renderOffersTable();
      showAdminToast(`👑 Oferta aplicada a: ${val || 'Todas'}`, 'success');
    },
    onCancel: renderOffersTable
  });
}

function toggleOfferStatus(offerId) {
  BloomDB.toggleOffer(offerId);
  refreshDataFromDB();
  renderOffersTable();
}

function deleteOfferConfirm(offerId) {
  BloomDB.deleteOffer(offerId);
  refreshDataFromDB();
  renderOffersTable();
}

function openOfferModal() {
  addQuickOffer();
}

function saveOfferSubmit(e) {
  e.preventDefault();
  const payload = {
    title: document.getElementById('offer-form-title').value.trim(),
    discountPercent: Number(document.getElementById('offer-form-discount').value) || 0,
    couponCode: document.getElementById('offer-form-coupon').value.trim(),
    bannerText: document.getElementById('offer-form-banner').value.trim(),
    targetBrand: document.getElementById('offer-form-brand').value,
    expiresAt: document.getElementById('offer-form-expires').value.trim(),
    description: document.getElementById('offer-form-desc').value.trim(),
    active: document.getElementById('offer-form-active').checked
  };

  BloomDB.addOffer(payload);
  closeAdminModal('modal-offer');
  refreshDataFromDB();
  renderOffersTable();
}

// ============================================================================
// 8. VISTA: RESEÑAS & CALIFICACIÓN REAL DE LA PÁGINA (1-CLIC)
// ============================================================================
function renderReviewsTable() {
  const tbody = document.getElementById('admin-reviews-table-body');
  if (!tbody) return;

  const reviews = currentReviews || [];

  if (reviews.length > 0) {
    const avg = (reviews.reduce((acc, r) => acc + (Number(r.rating) || 5), 0) / reviews.length).toFixed(1);
    document.getElementById('reviews-avg-pill').innerText = `⭐ ${avg} / 5.0 (${reviews.length} reseñas)`;
  } else {
    document.getElementById('reviews-avg-pill').innerText = `⭐ 5.0 / 5.0 (0 reseñas)`;
  }

  if (reviews.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">No hay reseñas registradas aún. Pulsa <strong>"⚡ ➕ Nueva Reseña en 1 Clic"</strong> para agregar testimonios reales.</td></tr>`;
    return;
  }

  tbody.innerHTML = reviews.map(r => {
    const curRating = Math.min(5, Math.max(1, Number(r.rating) || 5));
    const starsHtml = [1, 2, 3, 4, 5].map(starNum =>
      `<span class="inline-star-btn ${starNum <= curRating ? 'lit' : ''}" onclick="setReviewRatingDirect('${escapeAttr(r.id)}', ${starNum})" title="Calificar con ${starNum} estrella${starNum > 1 ? 's' : ''}">★</span>`
    ).join('');

    return `
      <tr>
        <td data-label="Cliente">
          <div id="review-author-cell-${r.id}" class="editable-text-cell" onclick="editReviewFieldInline(this, '${escapeAttr(r.id)}', 'author')" title="Toca para editar el nombre">
            <strong style="color:#FFF;">${escapeAdminHtml(r.author || 'Cliente')}</strong>
          </div>
        </td>
        <td data-label="Ubicación">
          <div class="editable-text-cell" onclick="editReviewFieldInline(this, '${escapeAttr(r.id)}', 'city')" title="Toca para editar la ciudad">
            <span>📍 ${escapeAdminHtml(r.city || 'Colombia')}</span>
          </div>
        </td>
        <td data-label="Estrellas">
          <div class="inline-star-picker" title="Toca cualquier estrella para cambiar la calificación en 1 clic">
            ${starsHtml}
            <small style="color:var(--text-muted); margin-left:4px;">(${curRating}/5)</small>
          </div>
        </td>
        <td data-label="Producto / Tema">
          <span class="click-edit-chip" onclick="editReviewFieldInline(this, '${escapeAttr(r.id)}', 'productOrSubject')" title="Toca para cambiar el producto o asunto">
            ${escapeAdminHtml(r.productOrSubject || 'Compra Oficial')}
          </span>
        </td>
        <td data-label="Testimonio" style="max-width: 330px;">
          <div class="editable-text-cell" onclick="editReviewFieldInline(this, '${escapeAttr(r.id)}', 'comment', true)" title="Toca para editar el testimonio">
            <span style="color: #E5DEC9; font-style: italic;">"${escapeAdminHtml(r.comment || 'Excelente servicio y productos originales.')}"</span>
          </div>
        </td>
        <td data-label="Fecha">
          <div class="editable-text-cell" onclick="editReviewFieldInline(this, '${escapeAttr(r.id)}', 'date')" title="Toca para editar la fecha">
            <span>${escapeAdminHtml(r.date || 'Reciente')}</span>
          </div>
        </td>
        <td data-label="Verificado">
          <span class="badge-status status-clickable ${r.verified !== false ? 'active' : 'inactive'}" onclick="toggleReviewVerified('${escapeAttr(r.id)}')" title="Toca para alternar Compra Verificada en 1 clic">
            ${r.verified !== false ? '✓ Verificada' : 'Sin verificar'}
          </span>
        </td>
        <td data-label="Acciones" style="text-align: right;">
          <button class="btn-table-action danger" title="Eliminar Reseña de la tienda" onclick="deleteReviewConfirm('${escapeAttr(r.id)}')">
            <span>🗑️</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function addQuickReview() {
  const created = BloomDB.addReview({
    author: 'Clienta Verificada',
    city: 'Medellín, Antioquia',
    rating: 5,
    productOrSubject: 'Tratamiento Capilar Oficial',
    comment: 'Me encantaron los resultados desde la primera aplicación y el envío llegó súper rápido.',
    verified: true
  });
  refreshDataFromDB();
  renderReviewsTable();
  showAdminToast('⭐ Reseña añadida en vivo — toca cualquier dato para personalizarla', 'success');
  setTimeout(() => {
    const el = created && document.getElementById(`review-author-cell-${created.id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      editReviewFieldInline(el, created.id, 'author');
    }
  }, 150);
}

function editReviewFieldInline(el, revId, field, multiline = false) {
  const list = BloomDB.getReviews() || [];
  const target = list.find(r => String(r.id) === String(revId));
  if (!target) return;

  openInlineFieldEditor(el, {
    type: multiline ? 'textarea' : 'text',
    rows: multiline ? 2 : 1,
    value: target[field] || '',
    style: multiline ? 'min-width: 240px;' : 'min-width: 130px;',
    onSave: (val) => {
      const reviews = BloomDB.getReviews() || [];
      const item = reviews.find(r => String(r.id) === String(revId));
      const clean = String(val || '').trim();
      if (item && clean) {
        item[field] = clean;
        BloomDB.saveReviews(reviews);
      }
      refreshDataFromDB();
      renderReviewsTable();
      showAdminToast('⭐ Reseña actualizada en la tienda', 'success');
    },
    onCancel: renderReviewsTable
  });
}

function setReviewRatingDirect(revId, stars) {
  const reviews = BloomDB.getReviews() || [];
  const item = reviews.find(r => String(r.id) === String(revId));
  if (!item) return;
  item.rating = Math.min(5, Math.max(1, Number(stars) || 5));
  BloomDB.saveReviews(reviews);
  refreshDataFromDB();
  renderReviewsTable();
  showAdminToast(`⭐ Calificación cambiada a ${item.rating}/5 estrellas`, 'success');
}

function toggleReviewVerified(revId) {
  const reviews = BloomDB.getReviews() || [];
  const item = reviews.find(r => String(r.id) === String(revId));
  if (!item) return;
  item.verified = item.verified === false;
  BloomDB.saveReviews(reviews);
  refreshDataFromDB();
  renderReviewsTable();
}

function deleteReviewConfirm(revId) {
  BloomDB.deleteReview(revId);
  refreshDataFromDB();
  renderReviewsTable();
}

function openReviewModal() {
  addQuickReview();
}

function saveReviewSubmit(e) {
  e.preventDefault();
  const payload = {
    author: document.getElementById('review-form-author').value.trim(),
    city: document.getElementById('review-form-city').value.trim(),
    rating: Number(document.getElementById('review-form-rating').value),
    productOrSubject: document.getElementById('review-form-subject').value.trim(),
    comment: document.getElementById('review-form-comment').value.trim(),
    verified: document.getElementById('review-form-verified').checked
  };

  BloomDB.addReview(payload);
  closeAdminModal('modal-review');
  refreshDataFromDB();
  renderReviewsTable();
}

// ============================================================================
// 8.1 VISTA: REPORTES DE BUGS & INCONVENIENTES ENVIADOS POR CLIENTES
// ============================================================================
function renderBugsTable() {
  const tbody = document.getElementById('admin-bugs-table-body');
  if (!tbody) return;

  const bugs = currentBugReports || [];
  const tag = document.getElementById('bugs-total-count-tag');
  if (tag) tag.innerText = `${bugs.length} reportes`;

  if (bugs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem;">No hay reportes de bugs registrados. Cuando los clientes envíen un caso desde el formulario al final de la tienda, aparecerá aquí.</td></tr>`;
    return;
  }

  tbody.innerHTML = bugs.map(b => {
    return `
      <tr>
        <td style="white-space: nowrap;">${escapeAdminHtml(b.date || 'Reciente')}</td>
        <td><strong>${escapeAdminHtml(b.name || 'Cliente')}</strong></td>
        <td>
          <a href="https://wa.me/57${(b.phone || '').replace(/[^0-9]/g, '')}" target="_blank" style="color: #34D399; text-decoration: none; font-weight: 700;">
            💬 ${escapeAdminHtml(b.phone || '-')}
          </a>
        </td>
        <td><span class="tag" style="background: rgba(245,158,11,0.15); color: #FBBF24; border-color: rgba(245,158,11,0.3);">${escapeAdminHtml(b.issueType || 'General')}</span></td>
        <td style="max-width: 320px; color: #FFF;">${escapeAdminHtml(b.description || '')}</td>
        <td style="font-size: 0.78rem; color: var(--text-dim); max-width: 200px;">${escapeAdminHtml((b.deviceInfo || 'N/A').slice(0, 50))}...</td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn-table-action danger" title="Eliminar reporte de caso" onclick="deleteBugConfirm('${b.id}')">
            <span>🗑️ Eliminar</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function deleteBugConfirm(bugId) {
  if (typeof BloomDB !== 'undefined' && typeof BloomDB.deleteBugReport === 'function') {
    BloomDB.deleteBugReport(bugId);
    refreshDataFromDB();
    renderBugsTable();
  }
}

// ============================================================================
// 9. VISTA: HUELLA DIGITAL, GEOLOCALIZACIÓN & RASTRO DIGITAL PERFECTO (V6)
// ============================================================================
function renderTelemetryView() {
  refreshSessionsFromStorage();
  const container = document.getElementById('telemetry-sessions-container');
  if (!container) return;

  const now = Date.now();
  const todayKey = (typeof BloomDB !== 'undefined' && typeof BloomDB.getLocalDayKey === 'function')
    ? BloomDB.getLocalDayKey()
    : new Date().toISOString().slice(0, 10);

  const liveSessions = currentSessions.filter(s => (now - (s.lastActiveTimestamp || s.entryTimestamp)) < 120000);
  const todaySessions = currentSessions.filter(s => s.dayKey === todayKey);
  const authSessions = currentSessions.filter(s => s.user && s.user.authenticated);
  const totalSec = currentSessions.reduce((acc, s) => acc + (Number(s.durationSeconds) || 0), 0);
  const avgSec = currentSessions.length > 0 ? Math.round(totalSec / currentSessions.length) : 0;

  const kpiLive = document.getElementById('tel-kpi-live');
  const kpiTotal = document.getElementById('tel-kpi-total');
  const kpiTodayLabel = document.getElementById('tel-kpi-today-label');
  const kpiAuth = document.getElementById('tel-kpi-auth');
  const kpiAvg = document.getElementById('tel-kpi-avg-time');
  const countTag = document.getElementById('telemetry-count-tag');

  if (kpiLive) kpiLive.innerText = liveSessions.length;
  if (kpiTotal) kpiTotal.innerText = currentSessions.length;
  if (kpiTodayLabel) kpiTodayLabel.innerText = `${todaySessions.length} ingresos hoy`;
  if (kpiAuth) kpiAuth.innerText = authSessions.length;
  if (kpiAvg) kpiAvg.innerText = formatDuration(avgSec);

  const searchQ = ((document.getElementById('telemetry-search-input') || {}).value || '').trim().toLowerCase();
  const filterMode = ((document.getElementById('telemetry-filter-mode') || {}).value || 'all');

  let filtered = currentSessions.slice();
  if (filterMode === 'live') {
    filtered = filtered.filter(s => (now - (s.lastActiveTimestamp || s.entryTimestamp)) < 120000);
  } else if (filterMode === 'authenticated') {
    filtered = filtered.filter(s => s.user && s.user.authenticated);
  } else if (filterMode === 'viewed_products') {
    filtered = filtered.filter(s => Array.isArray(s.productsViewed) && s.productsViewed.length > 0);
  }

  if (searchQ) {
    filtered = filtered.filter(s => {
      const u = s.user || {};
      const loc = s.location || {};
      const perms = s.permissions || {};
      const dev = s.device || {};
      const prodsText = (s.productsViewed || []).map(p => `${p.name || ''} ${p.brand || ''}`).join(' ').toLowerCase();
      return (
        String(u.name || '').toLowerCase().includes(searchQ) ||
        String(u.email || '').toLowerCase().includes(searchQ) ||
        String(u.phone || '').toLowerCase().includes(searchQ) ||
        String(loc.city || perms.city || '').toLowerCase().includes(searchQ) ||
        String(loc.region || perms.department || '').toLowerCase().includes(searchQ) ||
        String(dev.fingerprintId || '').toLowerCase().includes(searchQ) ||
        prodsText.includes(searchQ)
      );
    });
  }

  if (countTag) countTag.innerText = `${filtered.length} de ${currentSessions.length} sesiones`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 3rem 1.5rem; background: var(--admin-bg-card); border-radius: 12px; border: 1px dashed var(--admin-border-subtle);">
        <span style="font-size: 2.5rem; display: block; margin-bottom: 0.5rem;">🛰️</span>
        <h3>${currentSessions.length === 0 ? 'Aún no hay visitas registradas' : 'Sin coincidencias para este filtro'}</h3>
        <p style="max-width: 560px; margin: 0.5rem auto 0;">Cuando un usuario ingrese a la tienda pública Bloom Beauty v6, aquí verás al instante su identidad, ciudad y departamento, permisos concedidos, hora exacta de entrada/salida, tiempo de navegación y productos explorados.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((s) => {
    const isLive = s.isOnline !== undefined
      ? Boolean(s.isOnline)
      : (now - (s.lastSeen || s.lastActiveTimestamp || s.entryTimestamp || 0)) < 180000;
    const dev = s.device || {};
    const loc = s.location || {};
    const userObj = s.user || {};
    const perms = s.permissions || {};
    const prods = s.productsViewed || [];
    const brandsExp = Array.isArray(s.brandsExplored)
      ? s.brandsExplored
      : (s.brandsExplored && typeof s.brandsExplored === 'object'
          ? Object.entries(s.brandsExplored).map(([bName, count]) => `${bName} (${count}x)`)
          : []);
    const actions = s.actions || s.actionsHistory || [];

    const displayCity = userObj.city || perms.city || loc.city || 'Colombia';
    const displayDept = userObj.department || perms.department || loc.department || loc.region || '';
    const wppPhone = userObj.phone ? formatAdminWhatsAppNumber(userObj.phone) : '';
    const targetForAlert = userObj.authenticated
      ? (userObj.email || userObj.name || '')
      : (displayCity !== 'Colombia' ? displayCity : '');
    const targetMode = userObj.authenticated ? 'customer' : (targetForAlert ? 'city' : 'all');

    return `
      <div class="telemetry-card-box" style="border-left: 5px solid ${isLive ? 'var(--success)' : 'rgba(212, 175, 55, 0.45)'};">
        <div class="telemetry-card-top">
          <div>
            <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;">
              <span class="${isLive ? 'session-badge-active' : 'session-badge-closed'}">
                ${isLive ? '● CONECTADO EN VIVO' : 'SESIÓN RECIENTE'}
              </span>
              <span class="fp-pill">ID: ${escapeAdminHtml(String(s.sessionId || s.id || dev.fingerprintId || 'VIS-LIVE').slice(-8).toUpperCase())}</span>
              <span class="tag" style="background: rgba(16,185,129,0.14); color: #34D399;">
                📍 ${escapeAdminHtml(displayCity)}${displayDept ? ', ' + escapeAdminHtml(displayDept) : ''}
              </span>
              <span class="tag" style="background: rgba(255,255,255,0.06); color: var(--text-muted);">
                ${dev.isMobile ? '📱 Celular' : '💻 Computador'} • ${escapeAdminHtml(dev.browser || 'Web')}
              </span>
            </div>

            ${userObj.authenticated ? `
              <div class="telemetry-user-identity-banner">
                <div>
                  <strong style="color:#FFF; font-size:1.05rem;">🔑 ${escapeAdminHtml(userObj.name || userObj.username)}</strong>
                  <span style="color: #34D399; font-size:0.84rem; font-weight:700; margin-left: 8px;">💎 Saldo: ${formatCurrency(userObj.balance || 0)}</span>
                  ${userObj.email ? `<span style="color: var(--text-muted); font-size:0.82rem; margin-left: 8px;">(${escapeAdminHtml(userObj.email)})</span>` : ''}
                </div>
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  ${userObj.phone ? `<a href="https://wa.me/${wppPhone}" target="_blank" class="btn-table-action primary" style="margin:0;">💬 ${escapeAdminHtml(userObj.phone)}</a>` : ''}
                  <button type="button" class="btn-table-action neutral" style="margin:0;" onclick="quickNotifyVisitor('${escapeAttr(targetMode)}', '${escapeAttr(targetForAlert)}', '${escapeAttr((prods[0] && prods[0].name) || '')}')">🔔 Enviar Alerta</button>
                </div>
              </div>
            ` : `
              <div style="margin-bottom: 8px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                <strong style="color: #E5E7EB; font-size: 0.96rem;">🌐 ${escapeAdminHtml(userObj.name || ('Visitante #' + String(s.sessionId || s.id || '').slice(-5).toUpperCase()))}</strong>
                <span style="color: var(--text-muted); font-size: 0.82rem;">(Invitado explorando la tienda)</span>
                <button type="button" class="btn-table-action neutral" style="padding: 0.25rem 0.65rem; font-size: 0.76rem;" onclick="quickNotifyVisitor('${escapeAttr(targetMode)}', '${escapeAttr(targetForAlert)}', '${escapeAttr((prods[0] && prods[0].name) || '')}')">🔔 Enviar Alerta</button>
              </div>
            `}

            <h3 style="color: #FFF; font-size: 1.08rem; display: flex; align-items: center; flex-wrap: wrap; gap: 8px;">
              <span>📍 ${escapeAdminHtml(displayCity)}${displayDept ? ', ' + escapeAdminHtml(displayDept) : ''}</span>
              <span style="font-size: 0.82rem; color: #60A5FA; font-weight: normal;">(IP: ${escapeAdminHtml(loc.ip || 'Local')} • ${escapeAdminHtml(s.dateFormatted || s.entryDate || '')})</span>
            </h3>
          </div>

          <div class="telemetry-time-box">
            <div style="font-size: 0.92rem; color: var(--text-muted);">
              ⏱️ Tiempo Navegando: <strong style="color: var(--gold-light); font-size: 1.18rem;">${formatDuration(s.durationSeconds || 0)}</strong>
            </div>
            <div style="font-size: 0.82rem; color: #E5E7EB; margin-top: 4px; font-family: monospace;">
              🕒 Entró: <strong style="color:#34D399;">${escapeAdminHtml(s.entryTime || '--:--:--')}</strong>
              ${s.exitTime
                ? ` • Salió: <strong style="color:#FBBF24;">${escapeAdminHtml(s.exitTime)}</strong>`
                : ` • Últ. act: <strong>${escapeAdminHtml(s.lastActiveTime || s.entryTime || '--:--:--')}</strong>`}
            </div>
          </div>
        </div>

        <!-- DETALLES DE DISPOSITIVO Y HARDWARE -->
        <div class="telemetry-hw-grid">
          <div><strong style="color: var(--gold-primary);">Dispositivo:</strong> ${escapeAdminHtml(dev.deviceType || 'Web')}</div>
          <div><strong style="color: var(--gold-primary);">Sistema:</strong> ${escapeAdminHtml(dev.os || 'N/A')}</div>
          <div><strong style="color: var(--gold-primary);">Navegador:</strong> ${escapeAdminHtml(dev.browser || 'N/A')}</div>
          <div><strong style="color: var(--gold-primary);">Pantalla:</strong> ${escapeAdminHtml(dev.screenResolution || 'N/A')}</div>
          ${brandsExp.length > 0 ? `<div style="grid-column: 1 / -1;"><strong style="color: var(--gold-primary);">Marcas exploradas:</strong> ${escapeAdminHtml(brandsExp.join(' • '))}</div>` : ''}
        </div>

        <!-- PRODUCTOS MIRADOS CON TIEMPO Y HORA EXACTA -->
        <div style="margin-bottom: 0.95rem;">
          <h4 style="font-size: 0.92rem; color: #FFF; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
            <span>🛍️</span> Productos mirados durante la sesión (${prods.length}):
          </h4>
          ${prods.length === 0 ? '<p style="font-size: 0.84rem; color: var(--text-muted);">Navegó por portada y vitrinas generales sin abrir fichas individuales todavía.</p>' : `
            <div class="viewed-prods-list">
              ${prods.map(p => `
                <div class="viewed-prod-tag">
                  <strong>${escapeAdminHtml(p.name)}</strong>
                  ${p.brand ? `<small style="color:var(--gold-light);">(${escapeAdminHtml(p.brand)})</small>` : ''}
                  <span class="time-spent">⏱️ ${Number(p.secondsSpent) || 1}s • ${Number(p.viewsCount) || 1}x</span>
                  <span style="font-size: 0.74rem; color: var(--text-dim); font-family: monospace;">🕒 ${escapeAdminHtml(p.lastViewedAt || p.firstViewedAt || '')}</span>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <!-- LÍNEA DE TIEMPO EXACTA -->
        <details style="font-size: 0.85rem; cursor: pointer; color: var(--gold-light);">
          <summary><strong>Ver Rastro Cronológico Exacto (${actions.length} eventos con hora exacta)</strong></summary>
          <div style="padding-top: 10px; margin-top: 6px; max-height: 220px; overflow-y: auto;">
            ${actions.map(a => `
              <div class="action-timeline-item">
                <span style="color: #FFF; font-weight: 700; font-family: monospace;">[${escapeAdminHtml(a.timeStr || '')}]</span>
                <span style="color: var(--gold-primary); font-weight: 700;">${escapeAdminHtml(a.action || '')}:</span>
                <span style="color: #E2DDD5;">${escapeAdminHtml(a.label || '')}</span>
              </div>
            `).join('')}
          </div>
        </details>
      </div>
    `;
  }).join('');
}

function quickNotifyVisitor(targetType, targetValue, sampleProduct) {
  switchAdminView('notifications');
  const sel = document.getElementById('direct-notif-target-type');
  const valInput = document.getElementById('direct-notif-target-value');
  const titleInput = document.getElementById('direct-notif-title');
  const bodyInput = document.getElementById('direct-notif-body');

  if (sel) {
    sel.value = targetType || 'all';
    handleDirectNotifTargetChange();
  }
  if (valInput && targetValue) {
    valInput.value = targetValue;
  }
  if (titleInput) {
    titleInput.value = sampleProduct
      ? `✨ ¡${sampleProduct} disponible con despacho prioritario!`
      : '✨ Atención exclusiva Bloom Beauty para ti';
  }
  if (bodyInput) {
    bodyInput.value = sampleProduct
      ? `Hola {usuario}, notamos que estuviste viendo ${sampleProduct}. ¡Confirma tu pedido hoy mismo con envío inmediato a {ciudad}!`
      : 'Hola {usuario}, tenemos disponibilidad inmediata para tu ciudad ({ciudad}). ¡Descubre nuestros rituales originales!';
    bodyInput.focus();
  }
}

function clearRealSessions() {
  if (typeof BloomTracker !== 'undefined') {
    BloomTracker.clearSessions();
  } else {
    localStorage.removeItem('bloom_beauty_real_sessions_v1');
  }
  refreshSessionsFromStorage();
  updateNavCounters();
  renderTelemetryView();
  showAdminToast('✓ Historial de sesiones reiniciado', 'info');
}

// ============================================================================
// 10. VISTA: PEDIDOS & GESTIÓN MANUAL DE DESPACHO
// ============================================================================
function renderOrdersTable() {
  const tbody = document.getElementById('admin-orders-table-body');
  if (!tbody) return;

  const allOrders = currentOrders || [];
  const searchQ = ((document.getElementById('admin-search-orders') || {}).value || '').trim().toLowerCase();
  const statusFilter = ((document.getElementById('admin-filter-order-status') || {}).value || 'all');

  let orders = allOrders.slice();
  if (statusFilter !== 'all') {
    orders = orders.filter(o => (o.status || 'Por Despachar') === statusFilter);
  }
  if (searchQ) {
    orders = orders.filter(o => {
      const itemsTxt = (o.items || []).map(i => `${i.name || ''} ${i.brand || ''}`).join(' ').toLowerCase();
      return (
        String(o.id || '').toLowerCase().includes(searchQ) ||
        String(o.customerName || '').toLowerCase().includes(searchQ) ||
        String(o.customerPhone || '').toLowerCase().includes(searchQ) ||
        String(o.customerCity || '').toLowerCase().includes(searchQ) ||
        String(o.customerDepartment || '').toLowerCase().includes(searchQ) ||
        itemsTxt.includes(searchQ)
      );
    });
  }

  const tag = document.getElementById('orders-full-count-tag');
  if (tag) tag.innerText = `${orders.length} de ${allOrders.length} pedidos`;

  if (orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 2.2rem;">No hay pedidos para el criterio actual. Puedes usar <strong>"➕ Registrar Pedido Manual"</strong> para cargar una venta directa.</td></tr>`;
    return;
  }

  tbody.innerHTML = orders.map(o => {
    const itemsList = (o.items || []).map(i =>
      `<div style="margin-bottom: 3px;">• <strong>${escapeAdminHtml(i.name)}</strong> <span style="color:var(--gold-light);">x${i.quantity || 1}</span> <small style="color:var(--text-dim);">(${formatCOP(i.price || 0)})</small></div>`
    ).join('');
    const wppPhone = formatAdminWhatsAppNumber(o.customerPhone);
    const isManual = o.source === 'manual_admin';
    const curStatus = o.status || 'Por Despachar';

    return `
      <tr>
        <td data-label="ID / Origen">
          <strong style="color: var(--gold-light); font-family: monospace;">${escapeAdminHtml(o.id)}</strong><br>
          <span class="tag" style="font-size: 0.7rem; padding: 0.1rem 0.45rem; ${isManual ? 'color:#60A5FA; border-color:rgba(96,165,250,0.4);' : ''}">
            ${isManual ? '⚡ Manual' : '🌐 Tienda'}
          </span>
        </td>
        <td data-label="Hora Exacta & Fecha" style="white-space: nowrap;">
          <strong style="color: #FFF; font-family: monospace; font-size: 0.96rem;">🕒 ${escapeAdminHtml(o.exactTime || '--:--:--')}</strong><br>
          <small style="color: var(--text-muted);">${escapeAdminHtml(o.dateFormatted || (o.date ? new Date(o.date).toLocaleDateString('es-CO') : ''))}</small>
        </td>
        <td data-label="Cliente & WhatsApp">
          <strong style="color:#FFF;">${escapeAdminHtml(o.customerName || 'Cliente')}</strong><br>
          ${o.customerPhone ? `<a href="https://wa.me/${wppPhone}" target="_blank" style="color: #34D399; text-decoration: none; font-weight: 700; font-size: 0.85rem;">💬 ${escapeAdminHtml(o.customerPhone)}</a>` : '-'}
        </td>
        <td data-label="Destino" style="font-size: 0.85rem; max-width: 240px;">
          <div class="editable-text-cell" onclick="editOrderFieldInline(this, '${escapeAttr(o.id)}', 'customerCity')" title="Toca para corregir ciudad de envío">
            <strong>📍 ${escapeAdminHtml(o.customerCity || 'Ciudad')}${o.customerDepartment ? ', ' + escapeAdminHtml(o.customerDepartment) : ''}</strong>
          </div>
          <div class="editable-text-cell" onclick="editOrderFieldInline(this, '${escapeAttr(o.id)}', 'customerAddress')" title="Toca para editar dirección de entrega">
            <span style="color: var(--text-muted);">${escapeAdminHtml(o.customerAddress || '+ Agregar dirección')}</span>
          </div>
          <div class="editable-text-cell" style="margin-top: 3px;" onclick="editOrderFieldInline(this, '${escapeAttr(o.id)}', 'notes')" title="Toca para añadir número de guía o nota de despacho (visible para el cliente)">
            <small style="color: ${o.notes ? 'var(--gold-light)' : 'var(--text-dim)'}; font-style: italic;">
              📝 ${o.notes ? `"${escapeAdminHtml(o.notes)}"` : '+ Guía / Nota de envío'}
            </small>
          </div>
        </td>
        <td data-label="Productos" style="font-size: 0.84rem; max-width: 280px;">${itemsList || '-'}</td>
        <td data-label="Pago" style="font-size: 0.83rem;">
          ${escapeAdminHtml(o.paymentMethod || '💎 Tu Saldo')}
          ${o.couponCode ? `<br><span class="tag" style="margin-top:4px; font-size:0.7rem;">🎟️ ${escapeAdminHtml(o.couponCode)}${o.discountAmount ? ' (-' + formatCOP(o.discountAmount) + ')' : ''}</span>` : ''}
        </td>
        <td data-label="Total"><strong style="color: #34D399; font-size: 1.05rem;">${formatCOP(o.total)}</strong></td>
        <td data-label="Estado">${renderDispatchStatusBadge(curStatus, o.id)}</td>
        <td data-label="Gestión Manual" style="text-align: right; white-space: nowrap;">
          <div style="display: inline-flex; flex-wrap: wrap; gap: 5px; justify-content: flex-end;">
            ${curStatus === 'Por Despachar' ? `
              <button type="button" class="btn-table-action primary" onclick="updateOrderDispatchStatus('${escapeAttr(o.id)}', 'Confirmado')" title="Confirmar pedido para alistamiento">
                ✓ Confirmar
              </button>
            ` : ''}
            ${curStatus !== 'Despachado' ? `
              <button type="button" class="btn-approve-recharge" style="padding: 0.36rem 0.7rem; font-size: 0.78rem;" onclick="updateOrderDispatchStatus('${escapeAttr(o.id)}', 'Despachado')" title="Marcar como despachado">
                🚚 Despachar
              </button>
            ` : ''}
            <button type="button" class="btn-table-action danger" title="Eliminar Pedido" onclick="deleteOrderConfirm('${escapeAttr(o.id)}')">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function editOrderFieldInline(el, orderId, field) {
  const orders = BloomDB.getOrders() || [];
  const target = orders.find(o => String(o.id) === String(orderId));
  if (!target) return;

  openInlineFieldEditor(el, {
    type: 'text',
    value: target[field] || '',
    style: 'min-width: 170px; font-size: 0.83rem;',
    placeholder: field === 'notes' ? 'Ej: Guía Servientrega #981234' : '',
    onSave: (val) => {
      const list = BloomDB.getOrders() || [];
      const item = list.find(o => String(o.id) === String(orderId));
      if (item) {
        item[field] = String(val || '').trim();
        BloomDB.saveOrders(list);
      }
      refreshDataFromDB();
      renderOrdersTable();
      showAdminToast('📦 Datos del pedido actualizados y sincronizados con el cliente', 'success');
    },
    onCancel: renderOrdersTable
  });
}

function updateOrderDispatchStatus(orderId, newStatus) {
  if (typeof BloomDB !== 'undefined' && typeof BloomDB.updateOrderStatus === 'function') {
    BloomDB.updateOrderStatus(orderId, newStatus);
  }
  refreshDataFromDB();
  renderCurrentView();
  showAdminToast(`📦 Pedido ${orderId} marcado como "${newStatus}"`, 'success');
}

function deleteOrderConfirm(orderId) {
  if (typeof BloomDB !== 'undefined' && typeof BloomDB.deleteOrder === 'function') {
    BloomDB.deleteOrder(orderId);
  } else {
    let list = BloomDB.getOrders();
    list = list.filter(o => String(o.id) !== String(orderId));
    BloomDB.saveOrders(list);
  }
  refreshDataFromDB();
  renderCurrentView();
  showAdminToast('✓ Pedido eliminado del registro', 'success');
}

function exportOrdersJSON() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentOrders, null, 2));
  const dlAnchorElem = document.createElement('a');
  dlAnchorElem.setAttribute("href", dataStr);
  dlAnchorElem.setAttribute("download", `pedidos_bloom_beauty_${new Date().toISOString().slice(0, 10)}.json`);
  dlAnchorElem.click();
}

// ----------------------------------------------------------------------------
// REGISTRO MANUAL DE PEDIDOS DESDE EL PANEL ADMIN
// ----------------------------------------------------------------------------
function openManualOrderModal() {
  refreshDataFromDB();
  const form = document.getElementById('form-manual-order');
  if (form) form.reset();

  const custSelect = document.getElementById('manual-order-customer-select');
  const hint = document.getElementById('manual-order-wallet-hint');
  if (hint) hint.innerText = '';

  if (custSelect) {
    custSelect.innerHTML = `<option value="">-- Cliente externo / escribir datos manualmente --</option>` +
      (currentCustomers || []).map(c =>
        `<option value="${escapeAttr(c.id)}">${escapeAdminHtml(c.name || c.username)} — 📱 ${escapeAdminHtml(c.phone || '')} — Saldo: ${formatCOP(c.balance || 0)}</option>`
      ).join('');
  }

  const itemsContainer = document.getElementById('manual-order-items-container');
  if (itemsContainer) {
    itemsContainer.innerHTML = '';
    addManualOrderProductRow();
  }

  const modal = document.getElementById('modal-manual-order');
  if (modal) modal.classList.add('open');
}

function handleManualOrderCustomerSelect(custId) {
  const hint = document.getElementById('manual-order-wallet-hint');
  if (!custId) {
    if (hint) hint.innerText = '';
    return;
  }
  const cust = (currentCustomers || []).find(c => String(c.id) === String(custId));
  if (!cust) return;

  document.getElementById('manual-order-name').value = cust.name || cust.username || '';
  document.getElementById('manual-order-phone').value = cust.phone || '';
  document.getElementById('manual-order-department').value = cust.department || '';
  document.getElementById('manual-order-city').value = cust.city || '';
  document.getElementById('manual-order-email').value = cust.email || '';
  document.getElementById('manual-order-address').value = cust.address || '';

  if (hint) {
    hint.innerText = `💎 Tu Saldo disponible de ${cust.name}: ${formatCOP(cust.balance || 0)}`;
  }
}

function addManualOrderProductRow() {
  const container = document.getElementById('manual-order-items-container');
  if (!container) return;

  const prods = (currentMasterData.products || []).filter(p => p.active !== false);
  const firstPrice = prods[0] ? Number(prods[0].price) || 0 : 0;
  const rowId = 'man-row-' + Date.now() + '-' + Math.floor(Math.random() * 999);

  const row = document.createElement('div');
  row.className = 'manual-order-item-row';
  row.id = rowId;
  row.innerHTML = `
    <select class="man-item-prod-select" onchange="updateManualOrderRowPrice('${rowId}')">
      ${prods.map(p => `<option value="${escapeAttr(p.id)}" data-name="${escapeAttr(p.name)}" data-brand="${escapeAttr(p.brandName || '')}" data-price="${Number(p.price) || 0}">${escapeAdminHtml(p.name)} (${formatCOP(p.price)})</option>`).join('')}
    </select>
    <input type="number" class="man-item-qty" min="1" value="1" oninput="recalculateManualOrderTotal()" title="Cantidad">
    <input type="number" class="man-item-price" min="0" step="500" value="${firstPrice}" oninput="recalculateManualOrderTotal()" title="Precio unitario COP">
    <button type="button" class="btn-table-action danger" style="margin:0; padding:0.45rem 0.65rem;" onclick="removeManualOrderRow('${rowId}')" title="Quitar línea">✕</button>
  `;
  container.appendChild(row);
  recalculateManualOrderTotal();
}

function updateManualOrderRowPrice(rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;
  const sel = row.querySelector('.man-item-prod-select');
  const priceInput = row.querySelector('.man-item-price');
  if (sel && priceInput && sel.selectedOptions[0]) {
    priceInput.value = sel.selectedOptions[0].getAttribute('data-price') || '0';
  }
  recalculateManualOrderTotal();
}

function removeManualOrderRow(rowId) {
  const container = document.getElementById('manual-order-items-container');
  const row = document.getElementById(rowId);
  if (row && container && container.children.length > 1) {
    row.remove();
    recalculateManualOrderTotal();
  }
}

function recalculateManualOrderTotal() {
  const rows = document.querySelectorAll('#manual-order-items-container .manual-order-item-row');
  let sum = 0;
  rows.forEach(r => {
    const qty = Math.max(1, Number((r.querySelector('.man-item-qty') || {}).value) || 1);
    const price = Math.max(0, Number((r.querySelector('.man-item-price') || {}).value) || 0);
    sum += qty * price;
  });
  const totalEl = document.getElementById('manual-order-total-display');
  if (totalEl) totalEl.innerText = `${formatCOP(sum)} COP`;
  return sum;
}

function submitManualOrder(e) {
  e.preventDefault();
  const custId = (document.getElementById('manual-order-customer-select').value || '').trim();
  const customerName = (document.getElementById('manual-order-name').value || '').trim();
  const customerPhone = (document.getElementById('manual-order-phone').value || '').trim();
  const customerDepartment = (document.getElementById('manual-order-department').value || '').trim();
  const customerCity = (document.getElementById('manual-order-city').value || '').trim();
  const customerEmail = (document.getElementById('manual-order-email').value || '').trim();
  const customerAddress = (document.getElementById('manual-order-address').value || '').trim();
  const paymentMode = document.getElementById('manual-order-payment-mode').value;
  const status = document.getElementById('manual-order-status').value;
  const notes = (document.getElementById('manual-order-notes').value || '').trim();

  const rows = document.querySelectorAll('#manual-order-items-container .manual-order-item-row');
  const items = [];
  rows.forEach(r => {
    const sel = r.querySelector('.man-item-prod-select');
    const opt = sel && sel.selectedOptions[0];
    if (!opt) return;
    const qty = Math.max(1, Number((r.querySelector('.man-item-qty') || {}).value) || 1);
    const price = Math.max(0, Number((r.querySelector('.man-item-price') || {}).value) || 0);
    items.push({
      id: sel.value,
      name: opt.getAttribute('data-name') || opt.textContent,
      brand: opt.getAttribute('data-brand') || '',
      price,
      quantity: qty
    });
  });

  if (items.length === 0) {
    showAdminToast('Agrega al menos un producto válido al pedido manual.', 'error');
    return;
  }

  const deductBalance = paymentMode === '__WALLET__';
  if (deductBalance && !custId) {
    showAdminToast('Para descontar de "Tu Saldo", selecciona primero un usuario registrado.', 'error');
    return;
  }

  const res = BloomDB.createManualOrder({
    customerId: custId,
    customerName,
    customerPhone,
    customerEmail,
    customerCity,
    customerDepartment,
    customerAddress,
    notes: notes || 'Pedido registrado y confirmado manualmente desde Panel Admin',
    paymentMethod: deductBalance ? 'Tu Saldo (Descuento Manual)' : paymentMode,
    deductBalance,
    status,
    items
  });

  if (!res || !res.success) {
    showAdminToast((res && res.message) || 'No se pudo registrar el pedido manual.', 'error');
    return;
  }

  closeAdminModal('modal-manual-order');
  refreshDataFromDB();
  renderCurrentView();
  showAdminToast(`📦 Pedido manual ${res.order.id} registrado (${formatCOP(res.order.total)})`, 'success');
}

// ============================================================================
// 11. VISTA: SERVIDOR CLOUD-READY, BACKUPS Y AJUSTES GENERALES v6.5
// ============================================================================
function updateCloudLiveStatusMetrics(healthRes = null) {
  const banner = document.getElementById('cloud-live-status-banner');
  const headline = document.getElementById('cloud-status-headline');
  const subtext = document.getElementById('cloud-status-subtext');
  const latEl = document.getElementById('cloud-metric-latency');
  const prodEl = document.getElementById('cloud-metric-products');
  const custEl = document.getElementById('cloud-metric-customers');
  const ordEl = document.getElementById('cloud-metric-orders');

  if (prodEl) prodEl.innerText = `${(currentMasterData && currentMasterData.products ? currentMasterData.products.length : 0)} prod.`;
  if (custEl) custEl.innerText = `${(currentCustomers || []).length} cuentas`;
  if (ordEl) ordEl.innerText = `${(currentOrders || []).length} reg.`;

  if (!banner) return;
  const cfg = (typeof BloomDB !== 'undefined' && typeof BloomDB.getCloudConfig === 'function')
    ? BloomDB.getCloudConfig()
    : { enabled: false, endpointUrl: '' };

  if (healthRes) {
    const isOk = Boolean(healthRes.success || healthRes.ok);
    const isRemote = healthRes.mode === 'remote-server' || healthRes.mode === 'remote';
    const engineName = (healthRes.serverInfo && healthRes.serverInfo.engine) || healthRes.engine || 'REST Cloud';
    if (isOk && isRemote) {
      banner.className = 'cloud-status-banner status-online';
      if (headline) headline.innerText = `🟢 Servidor Conectado en Vivo (${engineName})`;
      if (subtext) subtext.innerText = `Sincronización bidireccional activa con ${cfg.endpointUrl || 'servidor activo'}. Todos los cambios de Tienda y Admin se respaldan en tiempo real.`;
      if (latEl) latEl.innerText = `${healthRes.latencyMs || 1} ms`;
    } else if (!isOk) {
      banner.className = 'cloud-status-banner status-offline';
      if (headline) headline.innerText = '🔴 Servidor Remoto Sin Respuesta (Respaldo Local Activo)';
      if (subtext) subtext.innerText = `${healthRes.message || 'Verifica que iniciar_servidor_v6.bat o tu backend HTTPS esté en ejecución.'} Tu tienda sigue operando sin interrupciones en modo local.`;
      if (latEl) latEl.innerText = 'Timeout / Off';
    } else {
      banner.className = 'cloud-status-banner status-local';
      if (headline) headline.innerText = '🟡 Motor Local Instantáneo (BroadcastChannel + Storage)';
      if (subtext) subtext.innerText = 'Sincronización instantánea activa en este navegador. Usa "Autoconectar Servidor Local (:8080)" tras abrir iniciar_servidor_v6.bat para conectar varios equipos.';
      if (latEl) latEl.innerText = `${healthRes.latencyMs || 1} ms (Local)`;
    }
    return;
  }

  if (cfg && cfg.enabled && cfg.endpointUrl) {
    banner.className = 'cloud-status-banner status-online';
    if (headline) headline.innerText = `🟢 Endpoint Configurado: ${cfg.endpointUrl}`;
    if (subtext) subtext.innerText = 'Sincronización remota habilitada. Pulsa "Probar Salud del Servidor" para medir latencia en tiempo real.';
    if (latEl) latEl.innerText = 'Activo';
  } else {
    banner.className = 'cloud-status-banner status-local';
    if (headline) headline.innerText = '🟡 Motor Local Sincronizado (BroadcastChannel + Storage)';
    if (subtext) subtext.innerText = 'Tienda y Panel Admin conectados en tiempo real. Inicia iniciar_servidor_v6.bat o configura una URL HTTPS para sincronizar múltiples dispositivos.';
    if (latEl) latEl.innerText = '< 1 ms (Local)';
  }
}

function loadStoreSettingsIntoForm() {
  const s = (currentMasterData && currentMasterData.storeInfo) || {};
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };
  setVal('setting-store-email', s.adminEmail || s.email || 'de2355258@gmail.com');
  setVal('setting-admin-password', s.adminPassword || 'kira1622*');
  setVal('setting-store-public-url', s.storePublicUrl || '');

  if (typeof BloomDB !== 'undefined' && typeof BloomDB.getCloudConfig === 'function') {
    const cfg = BloomDB.getCloudConfig();
    setVal('cloud-endpoint-url', cfg.endpointUrl || '');
    setVal('cloud-api-key', cfg.apiKey || '');
    const chk = document.getElementById('cloud-remote-enabled');
    if (chk) chk.checked = Boolean(cfg.enabled);
  }

  renderStoreLiveVisualEditor();
  updateCloudLiveStatusMetrics();
}

function updateStoreInfoLive(updates = {}, toastMsg = '✨ Página principal actualizada en vivo') {
  const data = BloomDB.getData();
  data.storeInfo = Object.assign({}, data.storeInfo || {}, updates);
  BloomDB.saveData(data);
  refreshDataFromDB();
  renderStoreLiveVisualEditor();
  if (toastMsg) showAdminToast(toastMsg, 'success');
}

function toggleStorePromoBarLive() {
  const s = (currentMasterData && currentMasterData.storeInfo) || {};
  const nextActive = s.promoActive === false;
  updateStoreInfoLive(
    { promoActive: nextActive },
    nextActive ? '📢 Barra superior activada en la tienda' : '⏸️ Barra superior ocultada en la tienda'
  );
}

function editStoreInfoInline(el, field, opts = {}) {
  const s = (currentMasterData && currentMasterData.storeInfo) || {};
  const isNumber = opts.type === 'number';
  const curVal = s[field] !== undefined && s[field] !== null ? s[field] : (opts.fallback || '');

  openInlineFieldEditor(el, {
    type: opts.type || 'text',
    rows: opts.rows || 2,
    value: curVal,
    min: isNumber ? 0 : undefined,
    step: isNumber ? 5000 : undefined,
    style: opts.style || 'width: 100%;',
    placeholder: opts.placeholder || 'Escribe aquí...',
    onSave: (val) => {
      const patch = {};
      if (isNumber) {
        patch[field] = Math.max(0, Math.round(Number(String(val || '').replace(/[^0-9]/g, '')) || 0));
      } else {
        const clean = String(val || '').trim();
        if (opts.required && !clean) {
          renderStoreLiveVisualEditor();
          return;
        }
        patch[field] = clean;
      }
      if (field === 'phone' && patch.phone) {
        patch.phoneDisplay = `(+57) ${patch.phone}`;
      }
      if (field === 'promoAnnouncement') {
        patch.useCustomPromoText = true;
        patch.promoActive = true;
      }
      updateStoreInfoLive(patch, opts.toast || '✨ Cambio aplicado en la página principal');
    },
    onCancel: renderStoreLiveVisualEditor
  });
}

function editStoreNestedBadgeInline(el, groupKey, index, subField) {
  const data = BloomDB.getData();
  const s = data.storeInfo || {};

  if (groupKey === 'floatingBadge') {
    const fb = Object.assign({ icon: '✨', title: '100% Original', desc: 'Garantía Oficial' }, s.floatingBadge || {});
    openInlineFieldEditor(el, {
      type: 'text',
      value: fb[subField] || '',
      style: 'min-width: 120px;',
      onSave: (val) => {
        fb[subField] = String(val || '').trim();
        updateStoreInfoLive({ floatingBadge: fb }, '✨ Insignia de portada actualizada');
      },
      onCancel: renderStoreLiveVisualEditor
    });
    return;
  }

  const arr = Array.isArray(s[groupKey]) ? s[groupKey].map(x => Object.assign({}, x)) : [];
  if (!arr[index]) return;
  openInlineFieldEditor(el, {
    type: subField === 'desc' ? 'textarea' : 'text',
    rows: 2,
    value: arr[index][subField] || '',
    style: 'width: 100%;',
    onSave: (val) => {
      arr[index][subField] = String(val || '').trim();
      const patch = {};
      patch[groupKey] = arr;
      updateStoreInfoLive(patch, '✨ Tarjeta actualizada en la tienda principal');
    },
    onCancel: renderStoreLiveVisualEditor
  });
}

function renderStoreLiveVisualEditor() {
  const container = document.getElementById('store-live-visual-editor');
  if (!container) return;

  const defaults = (typeof DEFAULT_SITE_DATA !== 'undefined' && DEFAULT_SITE_DATA.storeInfo) ? DEFAULT_SITE_DATA.storeInfo : {};
  const s = Object.assign({}, defaults, (currentMasterData && currentMasterData.storeInfo) || {});
  const promoActive = s.promoActive !== false;
  const logoSrc = s.logo || 'imagenes/logo-bloom-beauty.jpg';
  const heroSrc = s.heroImage || 'imagenes/marcas/milagros-banner.jpg';
  const freeShip = Math.max(1000, Number(s.freeShippingThreshold) || 120000);
  const fb = Object.assign({ icon: '✨', title: '100% Originales', desc: 'Registro INVIMA Oficial' }, s.floatingBadge || {});
  const trustBadges = Array.isArray(s.trustBadges) && s.trustBadges.length > 0 ? s.trustBadges : [
    { title: '🚚 Envíos Seguros', desc: 'Cobertura en toda Colombia' },
    { title: '💎 100% Original', desc: 'Garantía directa oficial' },
    { title: '💬 Asesoría VIP', desc: 'Atención personalizada' }
  ];
  const corpValues = Array.isArray(s.values) && s.values.length > 0 ? s.values : [];

  container.innerHTML = `
    <div class="store-live-editor-grid">
      <!-- 1. BARRA SUPERIOR DE ANUNCIOS & META DE ENVÍO GRATIS -->
      <div class="store-live-block">
        <div class="store-live-block-head">
          <span>📢 1. Barra Superior de Anuncios &amp; Meta de Envío Gratis</span>
          <span class="badge-status status-clickable ${promoActive ? 'active' : 'inactive'}" onclick="toggleStorePromoBarLive()" title="Toca para mostrar u ocultar la barra superior en la tienda">
            ${promoActive ? '✓ Barra Visible en Tienda' : '✕ Barra Oculta'}
          </span>
        </div>
        <div class="store-live-fields-grid">
          <div class="store-click-field span-2" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'promoAnnouncement', { fallback: '✨ ENVÍOS RÁPIDOS A TODA COLOMBIA • PRODUCTOS 100% ORIGINALES' })" title="Toca para editar el texto de la barra superior">
            <span class="field-lbl">Texto Barra Superior VIP ✏️</span>
            <div class="field-val" style="color: var(--gold-light); font-weight: 600;">${escapeAdminHtml(s.promoAnnouncement || 'Toca para escribir anuncio promocional...')}</div>
          </div>
          <div class="store-click-field" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'freeShippingThreshold', { type: 'number', fallback: 120000, toast: '🎁 Meta de Envío Gratis actualizada en carrito y portada' })" title="Toca para cambiar el monto mínimo de Envío Gratis">
            <span class="field-lbl">🎁 Meta Envío Gratis (Carrito &amp; Garantías) ✏️</span>
            <div class="field-val" style="color: #34D399; font-weight: 800; font-size: 1rem;">${formatCOP(freeShip)}</div>
          </div>
        </div>
      </div>

      <!-- 2. IDENTIDAD, LOGO & PORTADA PRINCIPAL HERO -->
      <div class="store-live-block">
        <div class="store-live-block-head">
          <span>🌸 2. Logo Oficial, Nombre &amp; Portada Principal (Hero)</span>
          <small style="color: var(--text-dim);">Toca las fotos o cualquier texto para editar</small>
        </div>

        <div class="store-hero-media-row">
          <div class="store-media-card" onclick="openQuickImageModal('store-logo', 'main')" title="Toca para subir o cambiar el Logo de toda la tienda">
            <img src="${escapeAttr(logoSrc)}" alt="Logo Tienda" onerror="this.src='imagenes/logo-bloom-beauty.jpg'">
            <div>
              <strong>📷 Logo Oficial de la Tienda</strong>
              <small>Toca aquí para cambiar el logo de encabezado, menú y carga</small>
            </div>
          </div>

          <div class="store-media-card hero-wide" onclick="openQuickImageModal('hero-image', 'main')" title="Toca para subir o cambiar la Foto Principal de la Portada Hero">
            <img src="${escapeAttr(heroSrc)}" alt="Foto Portada Hero" onerror="this.src='imagenes/logo-bloom-beauty.jpg'">
            <div>
              <strong>🖼️ Foto Principal de Portada (Hero)</strong>
              <small>Toca aquí para cambiar la imagen grande de bienvenida</small>
            </div>
          </div>
        </div>

        <div class="store-live-fields-grid" style="margin-top: 0.9rem;">
          <div class="store-click-field" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'name', { required: true })">
            <span class="field-lbl">Nombre de la Tienda ✏️</span>
            <div class="field-val"><strong>${escapeAdminHtml(s.name || 'Bloom Beauty')}</strong></div>
          </div>
          <div class="store-click-field" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'tagline')">
            <span class="field-lbl">Eslogan bajo el Nombre ✏️</span>
            <div class="field-val">${escapeAdminHtml(s.tagline || 'Cosmética & Cuidado Capilar')}</div>
          </div>
          <div class="store-click-field" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'heroTag')">
            <span class="field-lbl">Etiqueta Superior Portada ✏️</span>
            <div class="field-val" style="color: var(--gold-light);">${escapeAdminHtml(s.heroTag || 'Boutique Oficial Colombia')}</div>
          </div>
          <div class="store-click-field span-3" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'heroTitle', { required: true })">
            <span class="field-lbl">Título Principal de Portada (Las últimas 3 palabras brillan en dorado) ✏️</span>
            <div class="field-val" style="font-size: 1.05rem; font-weight: 700; color: #FFF;">${escapeAdminHtml(s.heroTitle || 'Tu belleza merece el cuidado más exclusivo')}</div>
          </div>
          <div class="store-click-field span-3" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'heroSubtitle', { type: 'textarea', rows: 2 })">
            <span class="field-lbl">Subtítulo Descriptivo de Portada ✏️</span>
            <div class="field-val">${escapeAdminHtml(s.heroSubtitle || 'Toca para describir tu propuesta de valor...')}</div>
          </div>
          <div class="store-click-field" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'heroBtnPrimary')">
            <span class="field-lbl">Texto Botón Principal 1 ✏️</span>
            <div class="field-val"><strong>${escapeAdminHtml(s.heroBtnPrimary || 'Explorar Catálogo')}</strong></div>
          </div>
          <div class="store-click-field" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'heroBtnSecondary')">
            <span class="field-lbl">Texto Botón Secundario 2 ✏️</span>
            <div class="field-val">${escapeAdminHtml(s.heroBtnSecondary || 'Ver Marcas Oficiales')}</div>
          </div>
          <div class="store-click-field">
            <span class="field-lbl">Insignia Flotante sobre Foto Hero ✏️</span>
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:3px;">
              <span class="click-edit-chip" onclick="editStoreNestedBadgeInline(this, 'floatingBadge', 0, 'icon')" title="Cambiar emoji/ícono">${escapeAdminHtml(fb.icon || '✨')}</span>
              <span class="click-edit-chip" onclick="editStoreNestedBadgeInline(this, 'floatingBadge', 0, 'title')" title="Cambiar título">${escapeAdminHtml(fb.title || 'Original')}</span>
              <span class="click-edit-chip" onclick="editStoreNestedBadgeInline(this, 'floatingBadge', 0, 'desc')" title="Cambiar subtítulo" style="color:var(--text-muted);">${escapeAdminHtml(fb.desc || '')}</span>
            </div>
          </div>
        </div>

        <div style="margin-top: 0.9rem;">
          <span class="field-lbl" style="display:block; margin-bottom: 6px;"> Sellos de Confianza en Portada (Toca cualquiera para editarlo) ✏️</span>
          <div class="store-live-fields-grid">
            ${trustBadges.map((tb, idx) => `
              <div class="store-mini-card">
                <div class="editable-text-cell" onclick="editStoreNestedBadgeInline(this, 'trustBadges', ${idx}, 'title')">
                  <strong style="color: var(--gold-light); font-size: 0.86rem;">${escapeAdminHtml(tb.title || 'Sello')}</strong>
                </div>
                <div class="editable-text-cell" onclick="editStoreNestedBadgeInline(this, 'trustBadges', ${idx}, 'desc')">
                  <small style="color: var(--text-muted);">${escapeAdminHtml(tb.desc || 'Descripción')}</small>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- 3. WHATSAPP, CONTACTO OFICIAL & CUENTAS DE RECARGA TU SALDO -->
      <div class="store-live-block">
        <div class="store-live-block-head">
          <span>💬 3. WhatsApp Oficial, Contacto &amp; Cuentas para Recargar "Tu Saldo"</span>
          <small style="color: #34D399;">Sincroniza botón flotante, pie de página y cajón de recargas</small>
        </div>
        <div class="store-live-fields-grid">
          <div class="store-click-field" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'phone', { type: 'tel', required: true, toast: '📱 Número oficial de WhatsApp actualizado en toda la tienda' })">
            <span class="field-lbl">📱 WhatsApp Oficial (Botón Flotante &amp; Enlaces) ✏️</span>
            <div class="field-val" style="color: #34D399; font-weight: 800;">${escapeAdminHtml(s.phone || '3135143012')}</div>
          </div>
          <div class="store-click-field" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'email', { type: 'email' })">
            <span class="field-lbl">✉️ Correo Visible en Tienda ✏️</span>
            <div class="field-val">${escapeAdminHtml(s.email || 'de2355258@gmail.com')}</div>
          </div>
          <div class="store-click-field" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'address')">
            <span class="field-lbl">📍 Ubicación / Cobertura ✏️</span>
            <div class="field-val">${escapeAdminHtml(s.address || 'Envíos seguros a toda Colombia')}</div>
          </div>
          <div class="store-click-field" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'nequiNumber', { placeholder: 'Ej: 313 514 3012', toast: '💎 Número Nequi/Daviplata actualizado en el cajón de Recargas' })">
            <span class="field-lbl">💎 Cuenta Nequi / Daviplata (Para Recargas) ✏️</span>
            <div class="field-val" style="color: var(--gold-light); font-weight: 700;">${escapeAdminHtml(s.nequiNumber || '+ Toca para mostrar Nequi al recargar')}</div>
          </div>
          <div class="store-click-field" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'bancolombiaAccount', { placeholder: 'Ej: Ahorros 123-456789-00', toast: '🏦 Cuenta Bancolombia actualizada en el cajón de Recargas' })">
            <span class="field-lbl">🏦 Cuenta Bancolombia (Para Recargas) ✏️</span>
            <div class="field-val" style="color: var(--gold-light); font-weight: 700;">${escapeAdminHtml(s.bancolombiaAccount || '+ Toca para mostrar cuenta Bancolombia')}</div>
          </div>
          <div class="store-click-field" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'paymentHolder', { placeholder: 'Ej: Bloom Beauty Oficial' })">
            <span class="field-lbl">👤 Titular de las Cuentas ✏️</span>
            <div class="field-val">${escapeAdminHtml(s.paymentHolder || '+ Toca para indicar titular')}</div>
          </div>
          <div class="store-click-field" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'contactTitle')">
            <span class="field-lbl">Título Sección Contacto ✏️</span>
            <div class="field-val">${escapeAdminHtml(s.contactTitle || 'Atención Personalizada VIP')}</div>
          </div>
          <div class="store-click-field span-2" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'contactSubtitle')">
            <span class="field-lbl">Subtítulo Sección Contacto ✏️</span>
            <div class="field-val">${escapeAdminHtml(s.contactSubtitle || 'Resolvemos tus dudas y te asesoramos en tu rutina ideal.')}</div>
          </div>
        </div>
      </div>

      <!-- 4. NOSOTROS (MISIÓN, VISIÓN, VALORES) & PIE DE PÁGINA -->
      <div class="store-live-block">
        <div class="store-live-block-head">
          <span>💎 4. Sección "Nosotros" (Misión, Visión, Valores) &amp; Pie de Página</span>
        </div>
        <div class="store-live-fields-grid">
          <div class="store-click-field" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'mission', { type: 'textarea', rows: 3 })">
            <span class="field-lbl">Nuestra Misión ✏️</span>
            <div class="field-val">${escapeAdminHtml(s.mission || 'Toca para redactar la misión...')}</div>
          </div>
          <div class="store-click-field span-2" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'vision', { type: 'textarea', rows: 3 })">
            <span class="field-lbl">Nuestra Visión ✏️</span>
            <div class="field-val">${escapeAdminHtml(s.vision || 'Toca para redactar la visión...')}</div>
          </div>
          <div class="store-click-field" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'footerHours')">
            <span class="field-lbl">🕒 Horario en Pie de Página ✏️</span>
            <div class="field-val">${escapeAdminHtml(s.footerHours || 'Lunes a Sábado: 8:00 AM - 7:00 PM')}</div>
          </div>
          <div class="store-click-field" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'footerBio', { type: 'textarea', rows: 2 })">
            <span class="field-lbl">Descripción Corta Footer ✏️</span>
            <div class="field-val">${escapeAdminHtml(s.footerBio || 'Tu boutique multimarca online de confianza.')}</div>
          </div>
          <div class="store-click-field" onclick="editStoreInfoInline(this.querySelector('.field-val'), 'copyrightText')">
            <span class="field-lbl">Texto Copyright Inferior ✏️</span>
            <div class="field-val">${escapeAdminHtml(s.copyrightText || '© 2026 Bloom Beauty Tienda Online Oficial.')}</div>
          </div>
        </div>
        ${corpValues.length > 0 ? `
          <div style="margin-top: 0.9rem;">
            <span class="field-lbl" style="display:block; margin-bottom: 6px;">Valores Corporativos (Toca ícono, título o texto para editarlo) ✏️</span>
            <div class="store-live-fields-grid">
              ${corpValues.map((v, idx) => `
                <div class="store-mini-card">
                  <div style="display:flex; align-items:center; gap:6px; margin-bottom:3px;">
                    <span class="click-edit-chip" onclick="editStoreNestedBadgeInline(this, 'values', ${idx}, 'icon')">${escapeAdminHtml(v.icon || '💎')}</span>
                    <div class="editable-text-cell" onclick="editStoreNestedBadgeInline(this, 'values', ${idx}, 'title')">
                      <strong style="color:#FFF; font-size:0.86rem;">${escapeAdminHtml(v.title || 'Valor')}</strong>
                    </div>
                  </div>
                  <div class="editable-text-cell" onclick="editStoreNestedBadgeInline(this, 'values', ${idx}, 'desc')">
                    <small style="color:var(--text-muted);">${escapeAdminHtml(v.desc || '')}</small>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

async function testCloudServerConnection() {
  if (typeof BloomDB === 'undefined' || !BloomDB.cloud || typeof BloomDB.cloud.testConnection !== 'function') return;
  const urlInput = document.getElementById('cloud-endpoint-url');
  const keyInput = document.getElementById('cloud-api-key');
  const customUrl = urlInput ? urlInput.value.trim() : '';
  const customKey = keyInput ? keyInput.value.trim() : '';

  showAdminToast('🩺 Verificando estado y latencia del servidor...', 'info');
  const res = await BloomDB.cloud.testConnection(customUrl, customKey);
  updateCloudLiveStatusMetrics(res);

  if (res && (res.success || res.ok)) {
    showAdminToast(`✅ ${res.message} (${res.latencyMs || 1} ms)`, 'success');
  } else {
    showAdminToast(`⚠️ ${(res && res.message) || 'Servidor no disponible en esa URL'}`, 'warning');
  }
}

async function quickConnectLocalPythonServer() {
  const defaultLocalUrl = (window.location.protocol.startsWith('http'))
    ? window.location.origin
    : 'http://localhost:8080';

  const urlInput = document.getElementById('cloud-endpoint-url');
  const chk = document.getElementById('cloud-remote-enabled');
  if (urlInput) urlInput.value = defaultLocalUrl;

  if (typeof BloomDB !== 'undefined' && BloomDB.cloud && typeof BloomDB.cloud.testConnection === 'function') {
    const res = await BloomDB.cloud.testConnection(defaultLocalUrl, '');
    if (res && (res.success || res.ok) && (res.mode === 'remote-server' || res.mode === 'remote')) {
      if (chk) chk.checked = true;
      BloomDB.saveCloudConfig({
        endpointUrl: defaultLocalUrl,
        apiKey: (document.getElementById('cloud-api-key') || {}).value || '',
        enabled: true
      });
      await BloomDB.cloud.pushSnapshot(true);
      refreshDataFromDB();
      updateCloudLiveStatusMetrics(res);
      showAdminToast(`🚀 Conectado y sincronizado con ${defaultLocalUrl} (${res.latencyMs} ms)`, 'success');
    } else {
      updateCloudLiveStatusMetrics(res);
      showAdminToast('⚠️ Abre primero "iniciar_servidor_v6.bat" para encender el servidor local en el puerto 8080.', 'warning');
    }
  }
}

async function saveCloudConfigFromAdmin(e) {
  e.preventDefault();
  if (typeof BloomDB === 'undefined' || typeof BloomDB.saveCloudConfig !== 'function') return;
  const endpointUrl = (document.getElementById('cloud-endpoint-url').value || '').trim();
  const apiKey = (document.getElementById('cloud-api-key').value || '').trim();
  const enabled = Boolean(document.getElementById('cloud-remote-enabled').checked);

  if (enabled && !endpointUrl) {
    showAdminToast('Ingresa la URL del servidor backend (ej: http://localhost:8080 o HTTPS) para activar modo servidor.', 'warning');
    return;
  }

  BloomDB.saveCloudConfig({ endpointUrl, apiKey, enabled });
  refreshDataFromDB();

  if (enabled && endpointUrl && BloomDB.cloud && typeof BloomDB.cloud.testConnection === 'function') {
    const res = await BloomDB.cloud.testConnection(endpointUrl, apiKey);
    updateCloudLiveStatusMetrics(res);
    if (res && (res.success || res.ok) && (res.mode === 'remote-server' || res.mode === 'remote')) {
      await BloomDB.cloud.pushSnapshot(true);
      showAdminToast(`☁️ Servidor conectado y base de datos sincronizada (${res.latencyMs} ms)`, 'success');
      return;
    }
    showAdminToast('⚠️ Configuración guardada, pero el servidor aún no responde. Verifica que esté encendido.', 'warning');
    return;
  }

  updateCloudLiveStatusMetrics();
  showAdminToast('☁️ Configuración Cloud-Ready actualizada correctamente', 'success');
}

async function pushDatabaseToCloudServer() {
  if (typeof BloomDB === 'undefined' || !BloomDB.cloud || typeof BloomDB.cloud.pushSnapshot !== 'function') return;
  const res = await BloomDB.cloud.pushSnapshot(false);
  if (res && (res.success || res.ok)) {
    showAdminToast('⬆️ Base de datos completa subida al servidor con éxito', 'success');
    testCloudServerConnection();
  } else {
    showAdminToast(`⚠️ ${(res && res.message) || 'Activa y conecta primero un servidor en el formulario Cloud.'}`, 'warning');
  }
}

async function pullDatabaseFromCloudServer() {
  if (typeof BloomDB === 'undefined' || !BloomDB.cloud || typeof BloomDB.cloud.pullSnapshot !== 'function') return;
  const res = await BloomDB.cloud.pullSnapshot();
  if (res && (res.success || res.ok)) {
    refreshDataFromDB();
    populateBrandSelects();
    renderCurrentView();
    showAdminToast(`⬇️ ${res.message || 'Datos descargados del servidor y aplicados en vivo'}`, 'success');
  } else {
    showAdminToast(`⚠️ ${(res && res.message) || 'No se pudo descargar desde el servidor. Verifica la conexión.'}`, 'warning');
  }
}

function exportFullDatabaseBackup() {
  if (typeof BloomDB !== 'undefined' && typeof BloomDB.downloadBackup === 'function') {
    BloomDB.downloadBackup();
    showAdminToast('💾 Backup maestro descargado exitosamente', 'success');
  }
}

function triggerImportFullDatabaseBackup() {
  const fileInput = document.getElementById('cloud-backup-file-input');
  if (fileInput) {
    fileInput.value = '';
    fileInput.click();
  }
}

function handleImportFullDatabaseBackup(event) {
  const file = event && event.target && event.target.files ? event.target.files[0] : null;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const rawJson = String(ev.target.result || '');
      if (typeof BloomDB !== 'undefined' && typeof BloomDB.importJSON === 'function') {
        const res = BloomDB.importJSON(rawJson);
        if (!res || !res.success) {
          showAdminToast((res && res.message) || 'El archivo JSON no es un backup válido.', 'error');
          return;
        }
        refreshDataFromDB();
        populateBrandSelects();
        renderCurrentView();
        showAdminToast('📂 Backup restaurado y sincronizado en vivo con la Tienda', 'success');
      }
    } catch (err) {
      showAdminToast('Error al leer el archivo JSON de respaldo.', 'error');
    }
  };
  reader.readAsText(file, 'utf-8');
}

function saveStoreSettings(e) {
  e.preventDefault();
  const data = BloomDB.getData();
  data.storeInfo = data.storeInfo || {};

  const emailEl = document.getElementById('setting-store-email');
  if (emailEl && emailEl.value.trim()) {
    data.storeInfo.adminEmail = emailEl.value.trim();
    if (!data.storeInfo.email) data.storeInfo.email = emailEl.value.trim();
  }

  const publicUrlEl = document.getElementById('setting-store-public-url');
  if (publicUrlEl) {
    data.storeInfo.storePublicUrl = publicUrlEl.value.trim();
  }

  const passEl = document.getElementById('setting-admin-password');
  const newPass = passEl ? passEl.value.trim() : '';
  if (newPass) {
    if (newPass.length < 6) {
      showAdminToast('La contraseña de administración debe tener mínimo 6 caracteres.', 'error');
      return;
    }
    data.storeInfo.adminPassword = newPass;
  }

  BloomDB.saveData(data);
  refreshDataFromDB();
  renderStoreLiveVisualEditor();
  showAdminToast('🔒 Credenciales de acceso y URL pública actualizadas', 'success');
}

// ============================================================================
// 11.1 CAMBIO DE IMÁGENES EN 1 CLIC (COMPRESIÓN AUTOMÁTICA + GUARDADO DIRECTO)
// ============================================================================
let currentQuickImageBase64 = '';

function openQuickImageModal(targetType, targetId) {
  document.getElementById('quick-image-target-type').value = targetType;
  document.getElementById('quick-image-target-id').value = targetId;
  document.getElementById('quick-image-file-input').value = '';
  currentQuickImageBase64 = '';

  let name = '';
  let currentImg = 'imagenes/logo-bloom-beauty.jpg';
  const sInfo = (currentMasterData && currentMasterData.storeInfo) || {};

  if (targetType === 'product') {
    const prod = (currentMasterData.products || []).find(p => String(p.id) === String(targetId));
    name = prod ? `Producto: ${prod.name}` : 'Cambiar Imagen de Producto';
    currentImg = (prod && prod.image) || currentImg;
    document.getElementById('modal-image-title').innerText = '📷 Cambiar Foto del Producto';
  } else if (targetType === 'brand') {
    const brand = (currentMasterData.brands || []).find(b => String(b.id) === String(targetId));
    name = brand ? `Logo de Marca: ${brand.name}` : 'Cambiar Logo de Marca';
    currentImg = (brand && brand.logo) || currentImg;
    document.getElementById('modal-image-title').innerText = '📷 Cambiar Logo de la Marca';
  } else if (targetType === 'brand-banner') {
    const brand = (currentMasterData.brands || []).find(b => String(b.id) === String(targetId));
    name = brand ? `Banner de Marca: ${brand.name}` : 'Cambiar Banner de Marca';
    currentImg = (brand && (brand.banner || brand.logo)) || currentImg;
    document.getElementById('modal-image-title').innerText = '🖼️ Cambiar Banner de la Marca';
  } else if (targetType === 'store-logo') {
    name = 'Logo Oficial de la Tienda Principal';
    currentImg = sInfo.logo || currentImg;
    document.getElementById('modal-image-title').innerText = '📷 Cambiar Logo de la Tienda';
  } else if (targetType === 'hero-image') {
    name = 'Imagen Principal de Portada (Hero)';
    currentImg = sInfo.heroImage || 'imagenes/marcas/milagros-banner.jpg';
    document.getElementById('modal-image-title').innerText = '🖼️ Cambiar Foto de Portada Hero';
  }

  document.getElementById('quick-image-item-name').innerText = name;
  document.getElementById('quick-image-url-input').value = currentImg.startsWith('data:') ? '' : currentImg;
  updateQuickImagePreview(currentImg);

  document.getElementById('modal-quick-image').classList.add('open');
}

function updateQuickImagePreview(src) {
  const preview = document.getElementById('quick-image-preview');
  if (preview && src) {
    preview.src = src;
    preview.onerror = () => {
      preview.src = 'imagenes/logo-bloom-beauty.jpg';
    };
  }
}

function compressImageDataUrl(rawDataUrl, maxSide = 880, quality = 0.84) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        let w = img.naturalWidth || img.width || maxSide;
        let h = img.naturalHeight || img.height || maxSide;
        if (w > maxSide || h > maxSide) {
          if (w >= h) {
            h = Math.max(1, Math.round((h * maxSide) / w));
            w = maxSide;
          } else {
            w = Math.max(1, Math.round((w * maxSide) / h));
            h = maxSide;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        let compressed = canvas.toDataURL('image/webp', quality);
        if (!compressed || compressed.length > rawDataUrl.length) {
          compressed = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(compressed || rawDataUrl);
      } catch (err) {
        resolve(rawDataUrl);
      }
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}

function applyQuickImageValue(targetType, targetId, finalImage) {
  if (!finalImage) return;

  if (targetType === 'product') {
    BloomDB.updateProduct(targetId, { image: finalImage });
    refreshDataFromDB();
    renderProductsTable();
  } else if (targetType === 'brand' || targetType === 'brand-banner') {
    const data = BloomDB.getData();
    const targetBrand = (data.brands || []).find(b => String(b.id) === String(targetId));
    if (targetBrand) {
      if (targetType === 'brand-banner') targetBrand.banner = finalImage;
      else targetBrand.logo = finalImage;
      BloomDB.saveData(data);
      refreshDataFromDB();
      renderBrandsTable();
    }
  } else if (targetType === 'store-logo') {
    updateStoreInfoLive({ logo: finalImage }, null);
  } else if (targetType === 'hero-image') {
    updateStoreInfoLive({ heroImage: finalImage }, null);
  }

  closeAdminModal('modal-quick-image');
  showAdminToast('📷 Imagen aplicada y sincronizada al instante con la tienda', 'success');
}

function handleQuickImageFileUpload(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const targetType = document.getElementById('quick-image-target-type').value;
  const targetId = document.getElementById('quick-image-target-id').value;
  const maxDim = (targetType === 'hero-image' || targetType === 'brand-banner') ? 1100 : 780;

  const reader = new FileReader();
  reader.onload = async function(evt) {
    const optimized = await compressImageDataUrl(evt.target.result, maxDim, 0.84);
    currentQuickImageBase64 = optimized;
    updateQuickImagePreview(optimized);
    document.getElementById('quick-image-url-input').value = '';
    // Guardar y aplicar automáticamente en 1 solo clic al elegir el archivo
    applyQuickImageValue(targetType, targetId, optimized);
  };
  reader.readAsDataURL(file);
}

function saveQuickImageSubmit(e) {
  e.preventDefault();
  const targetType = document.getElementById('quick-image-target-type').value;
  const targetId = document.getElementById('quick-image-target-id').value;
  const urlInput = document.getElementById('quick-image-url-input').value.trim();

  const finalImage = currentQuickImageBase64 || urlInput;

  if (!finalImage) {
    showAdminToast('Por favor selecciona una imagen o introduce una ruta válida', 'error');
    return;
  }

  applyQuickImageValue(targetType, targetId, finalImage);
}

// ============================================================================
// 11.2 VISTA: USUARIOS, SOLICITUDES DE RECARGA Y CONTROL DE "TU SALDO"
// ============================================================================
function filterAdminCustomers() {
  const input = document.getElementById('admin-search-customers');
  currentCustomerSearchQuery = input ? input.value.trim().toLowerCase() : '';
  renderCustomersTable();
}

function renderRechargesTable() {
  const tbody = document.getElementById('admin-recharges-table-body');
  const tag = document.getElementById('recharges-pending-tag');
  if (!tbody) return;

  const list = currentRechargeRequests || [];
  const pendingList = list.filter(r => r.status === 'Pendiente');

  if (tag) {
    tag.innerText = `${pendingList.length} ${pendingList.length === 1 ? 'pendiente' : 'pendientes'}`;
    tag.style.color = pendingList.length > 0 ? '#FBBF24' : '#34D399';
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 1.6rem;">No hay solicitudes de recarga registradas. Cuando un usuario solicite recargar <strong>Tu Saldo</strong> desde la tienda, aparecerá aquí en tiempo real.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(r => {
    const isPending = r.status === 'Pendiente';
    const wppPhone = formatAdminWhatsAppNumber(r.customerPhone);
    return `
      <tr style="${isPending ? 'background: rgba(245, 158, 11, 0.05);' : ''}">
        <td data-label="Referencia"><strong style="color: var(--gold-light); font-family: monospace; font-size: 0.82rem;">${escapeAdminHtml(r.id)}</strong></td>
        <td data-label="Fecha" style="white-space: nowrap; font-size: 0.84rem;">${escapeAdminHtml(r.dateFormatted || 'Reciente')}</td>
        <td data-label="Cliente">
          <strong>${escapeAdminHtml(r.customerName || 'Cliente')}</strong><br>
          <small style="color: var(--text-dim);">${escapeAdminHtml(r.customerEmail || '')}</small>
        </td>
        <td data-label="WhatsApp">
          ${r.customerPhone ? `<a href="https://wa.me/${wppPhone}" target="_blank" style="color: #34D399; text-decoration: none; font-weight: 700;">💬 ${escapeAdminHtml(r.customerPhone)}</a>` : '-'}
        </td>
        <td data-label="Medio & Comprobante">
          <span class="tag">${escapeAdminHtml(r.paymentMethod || 'Nequi')}</span>
            ${(r.receipt_url || r.receiptUrl) ? `
              <div style="margin-top: 5px;">
                <button type="button" class="btn-table-action" style="background: rgba(16, 185, 129, 0.2); color: #34D399; border: 1px solid rgba(16, 185, 129, 0.4); font-size: 0.78rem; padding: 4px 8px; border-radius: 6px; cursor: pointer;" onclick="openReceiptModal('${escapeAttr(r.receipt_url || r.receiptUrl)}', '${escapeAttr(r.id)}', '${escapeAttr(r.customerName || r.customer_name || 'Cliente')}', '${r.amount}')">
                  📷 Ver Comprobante
                </button>
              </div>
            ` : ''}
          <div class="editable-text-cell" style="margin-top: 3px;" onclick="editRechargeRefInline(this, '${escapeAttr(r.id)}')" title="Toca para anotar o editar el número de comprobante">
            <small style="color: ${r.reference ? 'var(--gold-light)' : 'var(--text-dim)'}; font-family: monospace;">
              ${r.reference ? `Ref: ${escapeAdminHtml(r.reference)} ✏️` : '+ Anotar comprobante'}
            </small>
          </div>
          ${r.userNote ? `<small style="color: var(--text-dim); font-style: italic; display:block;">"${escapeAdminHtml(r.userNote)}"</small>` : ''}
        </td>
        <td data-label="Monto"><strong style="color: #34D399; font-size: 1.02rem;">+${formatCOP(r.amount)}</strong></td>
        <td data-label="Estado">
          ${isPending
            ? '<span class="badge-status" style="background: rgba(245,158,11,0.18); color: #FBBF24; border: 1px solid rgba(245,158,11,0.35);">⏳ Pendiente</span>'
            : `<span class="badge-status active">✓ Aprobada</span>`}
        </td>
        <td data-label="Acción en 1 Clic" style="text-align: right; white-space: nowrap;">
          ${isPending ? `
            <button type="button" class="btn-approve-recharge" onclick="approveRechargeAction('${escapeAttr(r.id)}')" title="Aprobar en 1 clic sin ventanas emergentes y abonar a Tu Saldo">
              ✓ Aprobar en 1 Clic (+${formatCOP(r.amount)})
            </button>
            <button type="button" class="btn-table-action danger" style="margin-left: 6px;" onclick="deleteRechargeAction('${escapeAttr(r.id)}')" title="Descartar solicitud">
              ✕
            </button>
          ` : `
            <button type="button" class="btn-whatsapp-notify" onclick="notifyRechargeWhatsApp('${escapeAttr(r.id)}')" style="background:#25D366; color:#064E3B; border:1px solid #10B981; font-weight:700; font-size:0.8rem; padding:0.38rem 0.72rem; border-radius:6px; cursor:pointer; margin-right:6px;" title="Avisar a la clienta por WhatsApp">
              💬 Avisar WhatsApp
            </button>
            <button type="button" class="btn-table-action neutral" onclick="deleteRechargeAction('${escapeAttr(r.id)}')" title="Quitar del historial">
              🗑️ Limpiar
            </button>
          `}
        </td>
      </tr>
    `;
  }).join('');
}

function editRechargeRefInline(el, reqId) {
  const requests = BloomDB.getRechargeRequests() || [];
  const req = requests.find(r => String(r.id) === String(reqId));
  if (!req) return;
  openInlineFieldEditor(el, {
    type: 'text',
    value: req.reference || '',
    style: 'min-width: 150px; font-size: 0.8rem;',
    placeholder: 'Comprobante #...',
    onSave: (val) => {
      const list = BloomDB.getRechargeRequests() || [];
      const item = list.find(r => String(r.id) === String(reqId));
      if (item) {
        item.reference = String(val || '').trim();
        BloomDB.saveRechargeRequests(list);
      }
      refreshDataFromDB();
      renderRechargesTable();
      showAdminToast('🧾 Comprobante actualizado', 'success');
    },
    onCancel: renderRechargesTable
  });
}

function approveRechargeAction(reqId) {
  if (typeof BloomDB === 'undefined' || typeof BloomDB.approveRechargeRequest !== 'function') return;
  const requests = BloomDB.getRechargeRequests() || [];
  const req = requests.find(r => String(r.id) === String(reqId));
  if (!req) return;

  // Aprobación directa en 1 solo clic sin popups molestos
  const res = BloomDB.approveRechargeRequest(
    reqId,
    req.adminNotes || 'Aprobado en 1 clic desde Panel Admin',
    req.reference || ''
  );
  refreshDataFromDB();
  renderCustomersTable();
  if (res && res.success) {
    showAdminToast(`💎 ¡Recarga abonada en 1 clic! Nuevo Saldo de ${res.customer.name}: ${formatCOP(res.customer.balance)}`, 'success');
    if (req.customerPhone || req.userPhone || req.phone) {
      setTimeout(() => {
        if (confirm(`¿Deseas abrir WhatsApp para avisar a ${res.customer.name} que su saldo de ${formatCOP(req.amount)} ya está activo?`)) {
          notifyRechargeWhatsApp(reqId);
        }
      }, 400);
    }
  } else {
    showAdminToast((res && res.message) || 'No fue posible aprobar esta solicitud', 'error');
  }
}

function deleteRechargeAction(reqId) {
  if (typeof BloomDB !== 'undefined' && typeof BloomDB.deleteRechargeRequest === 'function') {
    BloomDB.deleteRechargeRequest(reqId);
  }
  refreshDataFromDB();
  renderCustomersTable();
  showAdminToast('✓ Solicitud eliminada', 'success');
}

function renderCustomersTable() {
  renderRechargesTable();

  const tbody = document.getElementById('admin-customers-table-body');
  const countTag = document.getElementById('customers-full-count-tag');
  const kpiUsers = document.getElementById('cust-kpi-total-users');
  const kpiBalance = document.getElementById('cust-kpi-total-balance');
  const kpiPending = document.getElementById('cust-kpi-pending-recharges');
  const kpiPendingAmount = document.getElementById('cust-kpi-pending-amount-label');

  const allCustomers = currentCustomers || [];
  const totalBalanceSum = allCustomers.reduce((acc, c) => acc + Math.max(0, Number(c.balance) || 0), 0);
  const pendingRecharges = (currentRechargeRequests || []).filter(r => r.status === 'Pendiente');
  const pendingAmountSum = pendingRecharges.reduce((acc, r) => acc + Math.max(0, Number(r.amount) || 0), 0);

  if (kpiUsers) kpiUsers.innerText = allCustomers.length;
  if (kpiBalance) kpiBalance.innerText = formatCOP(totalBalanceSum);
  if (kpiPending) kpiPending.innerText = pendingRecharges.length;
  if (kpiPendingAmount) {
    kpiPendingAmount.innerText = pendingRecharges.length > 0
      ? `${formatCOP(pendingAmountSum)} por aprobar`
      : 'Sin solicitudes pendientes';
  }

  if (!tbody) return;

  const q = currentCustomerSearchQuery;
  const list = q
    ? allCustomers.filter(c =>
        String(c.name || c.username || '').toLowerCase().includes(q) ||
        String(c.email || '').toLowerCase().includes(q) ||
        String(c.phone || '').toLowerCase().includes(q) ||
        String(c.city || '').toLowerCase().includes(q) ||
        String(c.department || '').toLowerCase().includes(q)
      )
    : allCustomers;

  if (countTag) {
    countTag.innerText = `${list.length} ${list.length === 1 ? 'usuario' : 'usuarios'}`;
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2.5rem;">${q ? 'No se encontraron usuarios con ese criterio de búsqueda.' : 'No hay usuarios registrados aún. Cuando los clientes creen su cuenta en la tienda aparecerán aquí con Tu Saldo en $0 listos para recargar.'}</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(c => {
    const balance = Math.max(0, Math.round(Number(c.balance) || 0));
    const dateFormatted = c.dateFormatted || (c.createdAt ? new Date(c.createdAt).toLocaleDateString('es-CO') : 'Reciente');
    const wppPhone = formatAdminWhatsAppNumber(c.phone);
    return `
      <tr>
        <td data-label="Cliente">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 34px; height: 34px; border-radius: 50%; background: linear-gradient(135deg, #B24C63, #E29578); color: white; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.88rem; flex-shrink: 0;">
              ${escapeAdminHtml((c.name || c.username || 'U').trim().charAt(0).toUpperCase())}
            </div>
            <div>
              <div class="editable-text-cell" onclick="editCustomerFieldInline(this, '${escapeAttr(c.id)}', 'name')" title="Toca para editar el nombre del usuario">
                <strong style="color: #FFF;">${escapeAdminHtml(c.name || c.username || 'Cliente')}</strong>
              </div>
              <div class="editable-text-cell" onclick="editCustomerFieldInline(this, '${escapeAttr(c.id)}', 'address')" title="Toca para agregar o cambiar su dirección de entrega">
                <small style="color: ${c.address ? 'var(--text-muted)' : 'var(--text-dim)'};">${escapeAdminHtml(c.address || '+ Dirección de envío')}</small>
              </div>
            </div>
          </div>
        </td>
        <td data-label="WhatsApp">
          <div style="display: inline-flex; align-items: center; gap: 6px;">
            <span class="editable-text-cell" onclick="editCustomerFieldInline(this, '${escapeAttr(c.id)}', 'phone')" title="Toca para editar el número de WhatsApp">
              <strong style="color: #34D399;">📱 ${escapeAdminHtml(c.phone || '+ Teléfono')}</strong>
            </span>
            ${c.phone ? `<a href="https://wa.me/${wppPhone}" target="_blank" class="click-edit-chip" style="padding: 2px 6px; text-decoration: none;" title="Abrir chat en WhatsApp">💬</a>` : ''}
          </div>
        </td>
        <td data-label="Correo">
          <div class="editable-text-cell" onclick="editCustomerFieldInline(this, '${escapeAttr(c.id)}', 'email')" title="Toca para editar el correo electrónico">
            <span>${c.email ? escapeAdminHtml(c.email) : '<span style="color: var(--text-dim);">+ Correo</span>'}</span>
          </div>
        </td>
        <td data-label="Ciudad & Depto.">
          <div class="editable-text-cell" onclick="editCustomerFieldInline(this, '${escapeAttr(c.id)}', 'city')" title="Toca para editar la ciudad">
            <strong>${escapeAdminHtml(c.city || '+ Ciudad')}</strong>
          </div>
          <div class="editable-text-cell" onclick="editCustomerFieldInline(this, '${escapeAttr(c.id)}', 'department')" title="Toca para editar el departamento">
            <small style="color: var(--text-muted);">${escapeAdminHtml(c.department || '+ Departamento')}</small>
          </div>
        </td>
        <td data-label="Tu Saldo">
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <div class="clickable-price-badge" style="padding: 0.3rem 0.65rem;" onclick="editCustomerBalanceInline(this, '${escapeAttr(c.id)}', ${balance})" title="Toca el monto para escribir el saldo exacto y presionar Enter">
              <strong style="color: ${balance > 0 ? '#34D399' : 'var(--gold-light)'};">${formatCOP(balance)}</strong>
              <span class="edit-hint-icon">✏️</span>
            </div>
            <button type="button" class="btn-quick-bal-chip" onclick="quickAddCustomerBalance('${escapeAttr(c.id)}', 10000)" title="Sumar $10.000 en 1 clic">+10k</button>
            <button type="button" class="btn-quick-bal-chip" onclick="quickAddCustomerBalance('${escapeAttr(c.id)}', 50000)" title="Sumar $50.000 en 1 clic">+50k</button>
            <button type="button" class="btn-table-action neutral" style="padding: 0.25rem 0.5rem; font-size: 0.74rem;" title="Ver historial y opciones avanzadas de saldo" onclick="promptCustomerBalance('${escapeAttr(c.id)}', 'add')">📋</button>
          </div>
        </td>
        <td data-label="Registro" style="font-size: 0.84rem; color: var(--text-muted);">${escapeAdminHtml(dateFormatted)}</td>
        <td data-label="Acciones" style="text-align: right;">
          <button type="button" class="btn-table-action danger" title="Eliminar usuario directamente" onclick="deleteCustomerAction('${escapeAttr(c.id)}')">
            <span>🗑️</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function editCustomerFieldInline(el, custId, field) {
  const cust = (currentCustomers || []).find(c => String(c.id) === String(custId));
  if (!cust) return;

  openInlineFieldEditor(el, {
    type: field === 'email' ? 'email' : (field === 'phone' ? 'tel' : 'text'),
    value: cust[field] || '',
    style: 'min-width: 135px; font-size: 0.84rem;',
    onSave: (val) => {
      const clean = String(val || '').trim();
      if ((field === 'name' || field === 'email' || field === 'phone') && !clean) {
        renderCustomersTable();
        return;
      }
      if (clean && typeof BloomDB.updateCustomerInfo === 'function') {
        const res = BloomDB.updateCustomerInfo(custId, { [field]: clean });
        if (res && res.error) {
          showAdminToast(res.message || 'Ese correo o WhatsApp ya pertenece a otro usuario', 'error');
          renderCustomersTable();
          return;
        }
      } else {
        const list = BloomDB.getCustomers() || [];
        const target = list.find(u => String(u.id) === String(custId));
        if (target) {
          target[field] = clean;
          BloomDB.saveCustomers(list);
        }
      }
      refreshDataFromDB();
      renderCustomersTable();
      showAdminToast('👤 Datos del cliente actualizados en vivo', 'success');
    },
    onCancel: renderCustomersTable
  });
}

function editCustomerBalanceInline(el, custId, currentBal) {
  openInlineFieldEditor(el, {
    type: 'number',
    value: currentBal,
    min: 0,
    step: 1000,
    style: 'width: 110px; font-weight: 800;',
    onSave: (val) => {
      const nextBal = Math.max(0, Math.round(Number(String(val || '').replace(/[^0-9]/g, '')) || 0));
      if (nextBal !== currentBal && typeof BloomDB.updateCustomerBalance === 'function') {
        BloomDB.updateCustomerBalance(custId, nextBal, 'Saldo editado en 1 clic desde Panel Admin');
        showAdminToast(`💎 Tu Saldo actualizado a ${formatCOP(nextBal)}`, 'success');
      }
      refreshDataFromDB();
      renderCustomersTable();
    },
    onCancel: renderCustomersTable
  });
}

function quickAddCustomerBalance(custId, delta) {
  if (typeof BloomDB === 'undefined' || typeof BloomDB.adjustCustomerBalance !== 'function') return;
  const updated = BloomDB.adjustCustomerBalance(custId, delta, `Abono rápido +${formatCOP(delta)} desde Panel Admin`);
  refreshDataFromDB();
  renderCustomersTable();
  if (updated) {
    showAdminToast(`💎 +${formatCOP(delta)} abonados a ${updated.name} (Saldo: ${formatCOP(updated.balance)})`, 'success');
  }
}

function promptCustomerBalance(custId, initialMode = 'add') {
  const cust = (currentCustomers || []).find(c => String(c.id) === String(custId));
  if (!cust) return;

  balanceModalBaseBalance = Math.max(0, Math.round(Number(cust.balance) || 0));

  document.getElementById('balance-form-cust-id').value = cust.id;
  document.getElementById('balance-form-cust-name').innerText = cust.name || 'Cliente';
  document.getElementById('balance-form-cust-phone').innerText = cust.phone
    ? `📱 ${cust.phone} • ${cust.email || ''} • ${cust.city || 'Colombia'}`
    : (cust.email || 'Sin teléfono');
  document.getElementById('balance-form-current-display').innerText = formatCOP(balanceModalBaseBalance);

  const noteInput = document.getElementById('balance-form-note');
  if (noteInput) noteInput.value = '';

  setBalanceModalMode(initialMode);

  // Renderizar últimos movimientos del cliente
  const txWrap = document.getElementById('balance-modal-tx-wrap');
  const txList = document.getElementById('balance-modal-tx-list');
  const txs = Array.isArray(cust.transactions) ? cust.transactions : [];
  if (txWrap && txList) {
    if (txs.length === 0) {
      txWrap.style.display = 'none';
      txList.innerHTML = '';
    } else {
      txWrap.style.display = 'block';
      txList.innerHTML = txs.slice(0, 8).map(tx => {
        const amt = Number(tx.amount) || 0;
        const isPos = amt >= 0;
        return `
          <div class="balance-tx-item">
            <div>
              <strong style="color: #E5E7EB;">${escapeAdminHtml(tx.note || (isPos ? 'Recarga' : 'Descuento'))}</strong>
              <div style="font-size: 0.7rem; color: var(--text-dim);">${escapeAdminHtml(tx.dateFormatted || '')} → Saldo: ${formatCOP(tx.newBalance || 0)}</div>
            </div>
            <strong style="color: ${isPos ? '#34D399' : '#F87171'}; white-space: nowrap;">
              ${isPos ? '+' : '-'}${formatCOP(Math.abs(amt))}
            </strong>
          </div>
        `;
      }).join('');
    }
  }

  const modal = document.getElementById('modal-customer-balance');
  if (modal) {
    modal.classList.add('open');
    setTimeout(() => {
      const input = document.getElementById('balance-form-new-amount');
      if (input) {
        input.focus();
        input.select();
      }
    }, 120);
  }
}

function setBalanceModalMode(mode = 'add') {
  const modeInput = document.getElementById('balance-form-mode');
  const label = document.getElementById('balance-amount-input-label');
  const amountInput = document.getElementById('balance-form-new-amount');

  if (modeInput) modeInput.value = mode;

  ['add', 'subtract', 'set'].forEach(m => {
    const tab = document.getElementById('bal-tab-' + m);
    if (tab) tab.classList.toggle('active', m === mode);
  });

  if (mode === 'add') {
    if (label) label.innerText = 'Monto a Recargar / Sumar a Tu Saldo (COP) *';
    if (amountInput) amountInput.value = '50000';
  } else if (mode === 'subtract') {
    if (label) label.innerText = 'Monto a Descontar de Tu Saldo (COP) *';
    if (amountInput) amountInput.value = '10000';
  } else {
    if (label) label.innerText = 'Fijar Tu Saldo Exacto en (COP) *';
    if (amountInput) amountInput.value = String(balanceModalBaseBalance);
  }

  updateBalanceModalPreview();
}

function quickSelectBalanceAmount(val) {
  const input = document.getElementById('balance-form-new-amount');
  const mode = (document.getElementById('balance-form-mode') || {}).value || 'add';
  if (!input) return;

  if (mode === 'add' || mode === 'subtract') {
    input.value = String(val);
  } else {
    input.value = String((Number(input.value) || 0) + val);
  }
  updateBalanceModalPreview();
}

function setBalanceZeroQuick() {
  setBalanceModalMode('set');
  const input = document.getElementById('balance-form-new-amount');
  if (input) input.value = '0';
  updateBalanceModalPreview();
}

function updateBalanceModalPreview() {
  const mode = (document.getElementById('balance-form-mode') || {}).value || 'add';
  const rawVal = Math.max(0, Math.round(Number((document.getElementById('balance-form-new-amount') || {}).value) || 0));

  const curEl = document.getElementById('preview-current-val');
  const opLabelEl = document.getElementById('preview-op-label');
  const opValEl = document.getElementById('preview-op-val');
  const finalEl = document.getElementById('preview-final-val');

  if (curEl) curEl.innerText = formatCOP(balanceModalBaseBalance);

  let finalBalance = balanceModalBaseBalance;
  if (mode === 'add') {
    finalBalance = balanceModalBaseBalance + rawVal;
    if (opLabelEl) opLabelEl.innerText = 'Recarga a sumar:';
    if (opValEl) {
      opValEl.innerText = `+${formatCOP(rawVal)}`;
      opValEl.style.color = '#34D399';
    }
  } else if (mode === 'subtract') {
    finalBalance = Math.max(0, balanceModalBaseBalance - rawVal);
    if (opLabelEl) opLabelEl.innerText = 'Valor a descontar:';
    if (opValEl) {
      opValEl.innerText = `-${formatCOP(rawVal)}`;
      opValEl.style.color = '#F87171';
    }
  } else {
    finalBalance = rawVal;
    const diff = finalBalance - balanceModalBaseBalance;
    if (opLabelEl) opLabelEl.innerText = 'Ajuste directo:';
    if (opValEl) {
      opValEl.innerText = `${diff >= 0 ? '+' : '-'}${formatCOP(Math.abs(diff))}`;
      opValEl.style.color = diff >= 0 ? '#FDE68A' : '#F87171';
    }
  }

  if (finalEl) finalEl.innerText = formatCOP(finalBalance);
}

function saveCustomerBalanceModalSubmit(e) {
  e.preventDefault();
  const custId = document.getElementById('balance-form-cust-id').value;
  const mode = (document.getElementById('balance-form-mode') || {}).value || 'add';
  const inputAmount = Math.max(0, Math.round(Number(document.getElementById('balance-form-new-amount').value) || 0));
  const customNote = (document.getElementById('balance-form-note').value || '').trim();

  let updatedCust = null;

  if (typeof BloomDB !== 'undefined') {
    if (mode === 'add' && typeof BloomDB.adjustCustomerBalance === 'function') {
      updatedCust = BloomDB.adjustCustomerBalance(custId, inputAmount, customNote || 'Recarga aplicada desde Panel Admin');
    } else if (mode === 'subtract' && typeof BloomDB.adjustCustomerBalance === 'function') {
      updatedCust = BloomDB.adjustCustomerBalance(custId, -inputAmount, customNote || 'Descuento aplicado desde Panel Admin');
    } else if (typeof BloomDB.updateCustomerBalance === 'function') {
      updatedCust = BloomDB.updateCustomerBalance(custId, inputAmount, customNote || 'Saldo fijado desde Panel Admin');
    }
  }

  closeAdminModal('modal-customer-balance');
  refreshDataFromDB();
  renderCustomersTable();

  const finalBalance = updatedCust ? updatedCust.balance : inputAmount;
  showAdminToast(`💎 ¡Tu Saldo actualizado! Nuevo saldo disponible: ${formatCOP(finalBalance)}`, 'success');
}

function openCreateCustomerModal() {
  const form = document.getElementById('form-create-customer');
  if (form) form.reset();
  const balInput = document.getElementById('admin-cust-balance');
  if (balInput) balInput.value = '0';
  const modal = document.getElementById('modal-create-customer');
  if (modal) modal.classList.add('open');
}

async function saveNewCustomerFromAdmin(e) {
  e.preventDefault();
  const name = (document.getElementById('admin-cust-name').value || '').trim();
  const phone = (document.getElementById('admin-cust-phone').value || '').trim();
  const department = ((document.getElementById('admin-cust-department') || {}).value || '').trim();
  const city = (document.getElementById('admin-cust-city').value || '').trim();
  const email = (document.getElementById('admin-cust-email').value || '').trim().toLowerCase();
  const password = (document.getElementById('admin-cust-password').value || '').trim();
  const balance = Math.max(0, Math.round(Number(document.getElementById('admin-cust-balance').value) || 0));

  if (typeof BloomDB !== 'undefined' && BloomDB.cloud && typeof BloomDB.cloud.registerUser === 'function') {
    const res = await BloomDB.cloud.registerUser({
      username: name,
      phone,
      email,
      city,
      department: department || 'Colombia',
      password,
      confirmPassword: password
    });

    if (!res || !res.success) {
      showAdminToast((res && res.message) || 'No fue posible registrar el usuario.', 'error');
      return;
    }

    if (balance > 0 && res.user && res.user.id && typeof BloomDB.updateCustomerBalance === 'function') {
      BloomDB.updateCustomerBalance(res.user.id, balance, 'Saldo inicial asignado desde Panel Admin');
    }
  } else if (typeof BloomDB !== 'undefined' && typeof BloomDB.addCustomer === 'function') {
    const res = BloomDB.addCustomer({ name, username: name, phone, city, department, email, password, balance });
    if (res && res.error) {
      showAdminToast(res.message || 'Ya existe un usuario registrado con ese correo o WhatsApp', 'error');
      return;
    }
  }

  closeAdminModal('modal-create-customer');
  refreshDataFromDB();
  renderCustomersTable();
  showAdminToast(`✨ Usuario ${name} creado con Tu Saldo de ${formatCOP(balance)}`, 'success');
}

function deleteCustomerAction(custId) {
  if (typeof BloomDB !== 'undefined' && typeof BloomDB.deleteCustomer === 'function') {
    BloomDB.deleteCustomer(custId);
  } else {
    currentCustomers = currentCustomers.filter(c => String(c.id) !== String(custId));
    localStorage.setItem('bloom_customers_registry_v4', JSON.stringify(currentCustomers));
  }
  refreshDataFromDB();
  renderCustomersTable();
  showAdminToast('✓ Usuario eliminado del sistema', 'success');
}

function exportCustomersJSON() {
  const list = currentCustomers || [];
  const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bloom_beauty_usuarios_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================================
// 11.3 VISTA: CONTROL MAESTRO DE TRANSACCIONES (RECARGAS Y COMPRAS)
// ============================================================================
function clearTxFilters() {
  const s = document.getElementById('tx-search-input');
  const c = document.getElementById('tx-filter-category');
  const d = document.getElementById('tx-filter-date');
  if (s) s.value = '';
  if (c) c.value = 'all';
  if (d) d.value = '';
  renderTransactionsView();
}

function renderTransactionsView() {
  if (typeof BloomDB !== 'undefined' && typeof BloomDB.getTransactions === 'function') {
    currentTransactions = BloomDB.getTransactions();
  }

  const allTx = currentTransactions || [];
  const purchases = allTx.filter(t => t.category === 'compra' && t.status !== 'Cancelado');
  const recharges = allTx.filter(t => t.category === 'recarga' && (t.status === 'Aprobada' || t.status === 'Completado'));
  const pendingDispatch = allTx.filter(t => t.category === 'compra' && (!t.status || t.status === 'Por Despachar'));

  const sumPurchases = purchases.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
  const sumRecharges = recharges.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

  const elPurSum = document.getElementById('tx-kpi-purchases-sum');
  const elPurCnt = document.getElementById('tx-kpi-purchases-count');
  const elRecSum = document.getElementById('tx-kpi-recharges-sum');
  const elRecCnt = document.getElementById('tx-kpi-recharges-count');
  const elPendDisp = document.getElementById('tx-kpi-pending-dispatch');
  const elTag = document.getElementById('tx-total-count-tag');
  const tbody = document.getElementById('admin-transactions-table-body');

  if (elPurSum) elPurSum.innerText = formatCOP(sumPurchases);
  if (elPurCnt) elPurCnt.innerText = `${purchases.length} compras registradas`;
  if (elRecSum) elRecSum.innerText = formatCOP(sumRecharges);
  if (elRecCnt) elRecCnt.innerText = `${recharges.length} recargas aprobadas`;
  if (elPendDisp) elPendDisp.innerText = pendingDispatch.length;

  if (!tbody) return;

  const searchQ = ((document.getElementById('tx-search-input') || {}).value || '').trim().toLowerCase();
  const catFilter = ((document.getElementById('tx-filter-category') || {}).value || 'all');
  const dateFilter = ((document.getElementById('tx-filter-date') || {}).value || '').trim();

  let list = allTx.slice();
  if (catFilter === 'compra') {
    list = list.filter(t => t.category === 'compra');
  } else if (catFilter === 'recarga') {
    list = list.filter(t => t.category === 'recarga' || t.category === 'ajuste');
  }

  if (dateFilter) {
    list = list.filter(t => t.dayKey === dateFilter);
  }

  if (searchQ) {
    list = list.filter(t => {
      const itemsStr = (t.items || []).map(i => `${i.name || ''} ${i.brand || ''}`).join(' ').toLowerCase();
      return (
        String(t.customerName || '').toLowerCase().includes(searchQ) ||
        String(t.customerPhone || '').toLowerCase().includes(searchQ) ||
        String(t.customerEmail || '').toLowerCase().includes(searchQ) ||
        String(t.customerCity || '').toLowerCase().includes(searchQ) ||
        String(t.referenceId || t.id || '').toLowerCase().includes(searchQ) ||
        String(t.note || '').toLowerCase().includes(searchQ) ||
        itemsStr.includes(searchQ)
      );
    });
  }

  if (elTag) elTag.innerText = `${list.length} movimientos`;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 2.5rem;">No hay transacciones que coincidan con este filtro. Aquí se consolidan automáticamente todas las recargas de saldo y compras con su hora exacta.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(tx => {
    const isPurchase = tx.category === 'compra';
    const wppPhone = formatAdminWhatsAppNumber(tx.customerPhone);
    const itemsHtml = isPurchase
      ? ((tx.items || []).map(it =>
          `<div style="margin-bottom: 3px;">• <strong>${escapeAdminHtml(it.name)}</strong> <span style="color:var(--gold-light);">x${it.quantity || 1}</span> <small style="color:var(--text-dim);">(${formatCOP(it.price || 0)})</small></div>`
        ).join('') || 'Compra de productos')
      : `<div><span class="tag">${escapeAdminHtml(tx.paymentMethod || 'Recarga de Saldo')}</span>${tx.note ? `<div style="margin-top:4px; color:var(--text-muted); font-size:0.8rem;">${escapeAdminHtml(tx.note)}</div>` : ''}</div>`;

    const statusHtml = isPurchase
      ? renderDispatchStatusBadge(tx.status)
      : (tx.status === 'Pendiente'
          ? `<span class="badge-status" style="background: rgba(245,158,11,0.18); color: #FBBF24; border: 1px solid rgba(245,158,11,0.35);">⏳ Pendiente</span>`
          : `<span class="badge-status active">✓ ${escapeAdminHtml(tx.status || 'Aprobada')}</span>`);

    let quickActionHtml = '<span style="color:var(--text-dim); font-size:0.8rem;">✓ Verificado</span>';
    if (isPurchase && tx.referenceId && tx.status !== 'Despachado') {
      quickActionHtml = `
        <div style="display:inline-flex; gap:5px; flex-wrap:wrap; justify-content:flex-end;">
          ${(!tx.status || tx.status === 'Por Despachar')
            ? `<button type="button" class="btn-table-action primary" onclick="updateOrderDispatchStatus('${escapeAttr(tx.referenceId)}', 'Confirmado')">✓ Confirmar</button>`
            : ''}
          <button type="button" class="btn-approve-recharge" style="padding:0.35rem 0.7rem; font-size:0.78rem;" onclick="updateOrderDispatchStatus('${escapeAttr(tx.referenceId)}', 'Despachado')">🚚 Despachar</button>
        </div>
      `;
    } else if (!isPurchase && tx.status === 'Pendiente' && tx.referenceId) {
      quickActionHtml = `
        <button type="button" class="btn-approve-recharge" style="padding:0.35rem 0.7rem; font-size:0.78rem;" onclick="approveRechargeAction('${escapeAttr(tx.referenceId)}'); renderTransactionsView();">✓ Aprobar Recarga</button>
      `;
    }

    return `
      <tr>
        <td data-label="Hora Exacta" style="white-space: nowrap;">
          <strong style="color: var(--gold-light); font-family: monospace; font-size: 0.98rem;">🕒 ${escapeAdminHtml(tx.exactTime || '--:--:--')}</strong><br>
          <small style="color: var(--text-dim);">${escapeAdminHtml(tx.dayKey || tx.dateFormatted || '')}</small>
        </td>
        <td data-label="Tipo">
          ${isPurchase
            ? `<span class="tag" style="background:rgba(16,185,129,0.15); color:#34D399; border-color:rgba(16,185,129,0.4);">🛍️ Compra</span>`
            : `<span class="tag" style="background:rgba(212,175,55,0.15); color:var(--gold-light);">💎 Recarga</span>`}
        </td>
        <td data-label="Ref / ID">
          <strong style="font-family: monospace; color:#FFF; font-size:0.84rem;">${escapeAdminHtml(tx.referenceId || tx.id)}</strong>
          ${tx.source === 'manual_admin' ? '<br><small style="color:#60A5FA;">⚡ Manual</small>' : ''}
        </td>
        <td data-label="Usuario">
          <strong style="color:#FFF;">${escapeAdminHtml(tx.customerName || 'Cliente')}</strong><br>
          ${tx.customerPhone ? `<a href="https://wa.me/${wppPhone}" target="_blank" style="color:#34D399; text-decoration:none; font-size:0.84rem; font-weight:700;">💬 ${escapeAdminHtml(tx.customerPhone)}</a>` : ''}
        </td>
        <td data-label="Destino / Ciudad" style="font-size:0.84rem; max-width:200px;">
          <strong>${escapeAdminHtml(tx.customerCity || '-')}${tx.customerDepartment ? ', ' + escapeAdminHtml(tx.customerDepartment) : ''}</strong>
          ${tx.customerAddress ? `<br><small style="color:var(--text-muted);">${escapeAdminHtml(tx.customerAddress)}</small>` : ''}
        </td>
        <td data-label="Productos / Detalle" style="font-size:0.84rem; max-width:290px;">${itemsHtml}</td>
        <td data-label="Monto"><strong style="color:${isPurchase ? '#34D399' : 'var(--gold-light)'}; font-size:1.02rem;">${formatCOP(tx.amount || 0)}</strong></td>
        <td data-label="Estado">${statusHtml}</td>
        <td data-label="Acción" style="text-align:right; white-space:nowrap;">${quickActionHtml}</td>
      </tr>
    `;
  }).join('');
}

// ============================================================================
// 11.4 VISTA: INFORMES DIARIOS DESCARGABLES (FLUJO DE PERSONAS Y VENTAS)
// ============================================================================
function getSelectedReportDayKey() {
  const input = document.getElementById('report-date-input');
  const today = (typeof BloomDB !== 'undefined' && typeof BloomDB.getLocalDayKey === 'function')
    ? BloomDB.getLocalDayKey()
    : new Date().toISOString().slice(0, 10);
  if (input && !input.value) {
    input.value = today;
  }
  return (input && input.value) ? input.value : today;
}

function setReportToday() {
  const input = document.getElementById('report-date-input');
  const today = (typeof BloomDB !== 'undefined' && typeof BloomDB.getLocalDayKey === 'function')
    ? BloomDB.getLocalDayKey()
    : new Date().toISOString().slice(0, 10);
  if (input) input.value = today;
  renderDailyReportsView();
}

function renderDailyReportsView() {
  if (typeof BloomDB === 'undefined' || typeof BloomDB.generateDailyReport !== 'function') return;
  const dayKey = getSelectedReportDayKey();
  const report = BloomDB.generateDailyReport(dayKey);

  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
  };

  setTxt('rep-kpi-visitors', report.traffic.totalSessions);
  setTxt('rep-kpi-auth-visitors', `${report.traffic.identifiedSessions} autenticados`);
  setTxt('rep-kpi-avg-duration', `Prom: ${formatDuration(report.traffic.avgDurationSeconds || 0)}`);

  setTxt('rep-kpi-sales', formatCOP(report.sales.totalSalesCOP));
  setTxt('rep-kpi-orders-breakdown', `${report.sales.ordersCount} pedidos (${report.sales.webOrdersCount} web / ${report.sales.manualOrdersCount} manual)`);
  setTxt('rep-kpi-units-sold', `${report.sales.totalUnitsSold} uds. vendidas`);

  setTxt('rep-kpi-recharges', formatCOP(report.recharges.totalRechargedCOP));
  setTxt('rep-kpi-recharges-count', `${report.recharges.approvedCount} recargas`);
  setTxt('rep-kpi-new-users', `${report.traffic.newRegistrations} nuevos registros`);

  const topViewedEl = document.getElementById('rep-top-viewed-list');
  if (topViewedEl) {
    if (report.traffic.topViewedProducts.length === 0) {
      topViewedEl.innerHTML = `<p style="color:var(--text-dim); font-size:0.85rem;">Sin visualizaciones individuales de productos en esta fecha.</p>`;
    } else {
      topViewedEl.innerHTML = report.traffic.topViewedProducts.slice(0, 8).map((p, i) => `
        <div class="report-mini-row">
          <span><strong>#${i + 1}</strong> ${escapeAdminHtml(p.name)} <small style="color:var(--text-dim);">${escapeAdminHtml(p.brand)}</small></span>
          <span class="tag">${p.views} vistas • ${formatDuration(p.totalSeconds)}</span>
        </div>
      `).join('');
    }
  }

  const topSoldEl = document.getElementById('rep-top-sold-list');
  if (topSoldEl) {
    if (report.sales.topSoldProducts.length === 0) {
      topSoldEl.innerHTML = `<p style="color:var(--text-dim); font-size:0.85rem;">Sin unidades vendidas registradas en esta fecha.</p>`;
    } else {
      topSoldEl.innerHTML = report.sales.topSoldProducts.slice(0, 8).map((p, i) => `
        <div class="report-mini-row">
          <span><strong>#${i + 1}</strong> ${escapeAdminHtml(p.name)} <small style="color:var(--text-dim);">${escapeAdminHtml(p.brand)}</small></span>
          <span class="tag" style="color:#34D399;">${p.unitsSold} uds. • ${formatCOP(p.revenue)}</span>
        </div>
      `).join('');
    }
  }

  setTxt('rep-tx-count-tag', `${report.transactions.length} registros`);
  const txBody = document.getElementById('rep-day-transactions-body');
  if (txBody) {
    if (report.transactions.length === 0) {
      txBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Sin ventas ni recargas registradas para el ${escapeAdminHtml(dayKey)}.</td></tr>`;
    } else {
      txBody.innerHTML = report.transactions.map(tx => {
        const isCompra = tx.category === 'compra';
        const detail = isCompra
          ? (tx.items || []).map(i => `${i.name} (x${i.quantity || 1})`).join(', ')
          : `${tx.paymentMethod || 'Recarga'} ${tx.note ? '— ' + tx.note : ''}`;
        return `
          <tr>
            <td data-label="Hora Exacta"><strong style="font-family:monospace; color:var(--gold-light);">${escapeAdminHtml(tx.exactTime || '--:--:--')}</strong></td>
            <td data-label="Categoría">${isCompra ? '🛍️ Compra' : '💎 Recarga'}</td>
            <td data-label="Cliente"><strong>${escapeAdminHtml(tx.customerName || 'Cliente')}</strong><br><small style="color:var(--text-dim);">${escapeAdminHtml(tx.customerPhone || '')}</small></td>
            <td data-label="Ciudad">${escapeAdminHtml(tx.customerCity || '-')}${tx.customerDepartment ? ', ' + escapeAdminHtml(tx.customerDepartment) : ''}</td>
            <td data-label="Detalle" style="font-size:0.84rem;">${escapeAdminHtml(detail)}</td>
            <td data-label="Monto"><strong style="color:#34D399;">${formatCOP(tx.amount || 0)}</strong></td>
            <td data-label="Estado">${escapeAdminHtml(tx.status || 'Completado')}</td>
          </tr>
        `;
      }).join('');
    }
  }

  setTxt('rep-sessions-count-tag', `${report.traffic.sessions.length} visitas`);
  const sessBody = document.getElementById('rep-day-sessions-body');
  if (sessBody) {
    if (report.traffic.sessions.length === 0) {
      sessBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Sin sesiones de visitantes registradas para el ${escapeAdminHtml(dayKey)}.</td></tr>`;
    } else {
      sessBody.innerHTML = report.traffic.sessions.map(s => {
        const u = s.user || {};
        const loc = s.location || {};
        const perms = s.permissions || {};
        const prodsTxt = (s.productsViewed || []).map(p => `${p.name} (${p.secondsSpent || 1}s)`).join(', ') || 'Exploración general';
        return `
          <tr>
            <td data-label="Horario"><strong style="font-family:monospace; color:var(--gold-light);">${escapeAdminHtml(s.entryTime || '--:--:--')}</strong>${s.exitTime ? ` → ${escapeAdminHtml(s.exitTime)}` : ''}</td>
            <td data-label="Usuario">${u.authenticated ? `🔑 <strong>${escapeAdminHtml(u.name)}</strong> (${escapeAdminHtml(u.phone || '')})` : `👤 Visitante (${escapeAdminHtml((s.device && s.device.fingerprintId) || 'FP')})`}</td>
            <td data-label="Ubicación">${escapeAdminHtml(u.city || perms.city || loc.city || 'Colombia')}${(u.department || perms.department || loc.region) ? ', ' + escapeAdminHtml(u.department || perms.department || loc.region) : ''}</td>
            <td data-label="Duración"><strong>${formatDuration(s.durationSeconds || 0)}</strong></td>
            <td data-label="Productos Mirados" style="font-size:0.84rem;">${escapeAdminHtml(prodsTxt)}</td>
          </tr>
        `;
      }).join('');
    }
  }
}

function csvCell(val) {
  const s = String(val == null ? '' : val).replace(/"/g, '""');
  return `"${s}"`;
}

function downloadDailyReportCSV() {
  if (typeof BloomDB === 'undefined' || typeof BloomDB.generateDailyReport !== 'function') return;
  const dayKey = getSelectedReportDayKey();
  const r = BloomDB.generateDailyReport(dayKey);

  const lines = [];
  lines.push([csvCell('INFORME DIARIO EJECUTIVO - BLOOM BEAUTY V6'), csvCell(`Fecha: ${r.dayKey}`), csvCell(`Generado: ${r.generatedAt}`)].join(';'));
  lines.push('');
  lines.push([csvCell('INDICADOR EJECUTIVO'), csvCell('VALOR')].join(';'));
  lines.push([csvCell('Visitantes Totales del Día'), csvCell(r.traffic.totalSessions)].join(';'));
  lines.push([csvCell('Visitantes con Sesión Iniciada'), csvCell(r.traffic.identifiedSessions)].join(';'));
  lines.push([csvCell('Nuevos Usuarios Registrados Hoy'), csvCell(r.traffic.newRegistrations)].join(';'));
  lines.push([csvCell('Tiempo Promedio de Navegación'), csvCell(formatDuration(r.traffic.avgDurationSeconds))].join(';'));
  lines.push([csvCell('Pedidos Confirmados Totales'), csvCell(r.sales.ordersCount)].join(';'));
  lines.push([csvCell('Pedidos Web vs Manuales'), csvCell(`${r.sales.webOrdersCount} Web / ${r.sales.manualOrdersCount} Manuales`)].join(';'));
  lines.push([csvCell('Unidades Totales Vendidas'), csvCell(r.sales.totalUnitsSold)].join(';'));
  lines.push([csvCell('Ventas Totales del Día (COP)'), csvCell(r.sales.totalSalesCOP)].join(';'));
  lines.push([csvCell('Recargas de Saldo Aprobadas (COP)'), csvCell(r.recharges.totalRechargedCOP)].join(';'));
  lines.push('');

  lines.push([csvCell('BITÁCORA DE TRANSACCIONES (VENTAS Y RECARGAS CON HORA EXACTA)')].join(';'));
  lines.push(['Hora Exacta', 'Tipo', 'Referencia', 'Cliente', 'Teléfono', 'Ciudad', 'Departamento', 'Dirección', 'Productos / Concepto', 'Monto COP', 'Estado'].map(csvCell).join(';'));
  r.transactions.forEach(tx => {
    const prodDesc = tx.category === 'compra'
      ? (tx.items || []).map(i => `${i.name} x${i.quantity || 1}`).join(' | ')
      : `${tx.paymentMethod || 'Recarga'} ${tx.note || ''}`;
    lines.push([
      tx.exactTime || '',
      tx.category || '',
      tx.referenceId || tx.id || '',
      tx.customerName || '',
      tx.customerPhone || '',
      tx.customerCity || '',
      tx.customerDepartment || '',
      tx.customerAddress || '',
      prodDesc,
      tx.amount || 0,
      tx.status || ''
    ].map(csvCell).join(';'));
  });
  lines.push('');

  lines.push([csvCell('FLUJO DE PERSONAS Y RASTRO DIGITAL DEL DÍA')].join(';'));
  lines.push(['Hora Entrada', 'Hora Salida', 'Segundos Navegados', 'Autenticado', 'Usuario', 'Teléfono', 'Ciudad', 'Departamento', 'Huella Digital', 'Productos Mirados'].map(csvCell).join(';'));
  r.traffic.sessions.forEach(s => {
    const u = s.user || {};
    const loc = s.location || {};
    const perms = s.permissions || {};
    const viewed = (s.productsViewed || []).map(p => `${p.name} (${p.secondsSpent || 1}s a las ${p.lastViewedAt || ''})`).join(' | ');
    lines.push([
      s.entryTime || '',
      s.exitTime || 'En sesión',
      s.durationSeconds || 0,
      u.authenticated ? 'SI' : 'NO',
      u.name || 'Visitante',
      u.phone || '',
      u.city || perms.city || loc.city || '',
      u.department || perms.department || loc.region || '',
      (s.device && s.device.fingerprintId) || '',
      viewed
    ].map(csvCell).join(';'));
  });

  const csvContent = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Informe_Diario_BloomBeauty_${dayKey}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showAdminToast(`📥 Informe Excel/CSV del ${dayKey} descargado correctamente`, 'success');
}

function downloadDailyReportHTML(openPrintDialog = false) {
  if (typeof BloomDB === 'undefined' || typeof BloomDB.generateDailyReport !== 'function') return;
  const dayKey = getSelectedReportDayKey();
  const r = BloomDB.generateDailyReport(dayKey);

  const txRows = r.transactions.length === 0
    ? `<tr><td colspan="7" style="text-align:center;color:#666;">Sin transacciones en esta fecha</td></tr>`
    : r.transactions.map(tx => {
        const detail = tx.category === 'compra'
          ? (tx.items || []).map(i => `${escapeAdminHtml(i.name)} (x${i.quantity || 1})`).join(', ')
          : escapeAdminHtml(`${tx.paymentMethod || 'Recarga'} ${tx.note || ''}`);
        return `<tr>
          <td><strong>${escapeAdminHtml(tx.exactTime || '')}</strong></td>
          <td>${tx.category === 'compra' ? 'Compra' : 'Recarga'}</td>
          <td>${escapeAdminHtml(tx.customerName || '')}<br><small>${escapeAdminHtml(tx.customerPhone || '')}</small></td>
          <td>${escapeAdminHtml(tx.customerCity || '')}${tx.customerDepartment ? ', ' + escapeAdminHtml(tx.customerDepartment) : ''}</td>
          <td>${detail}</td>
          <td><strong>${formatCOP(tx.amount || 0)}</strong></td>
          <td>${escapeAdminHtml(tx.status || '')}</td>
        </tr>`;
      }).join('');

  const sessionRows = r.traffic.sessions.length === 0
    ? `<tr><td colspan="5" style="text-align:center;color:#666;">Sin visitas registradas en esta fecha</td></tr>`
    : r.traffic.sessions.map(s => {
        const u = s.user || {};
        const loc = s.location || {};
        const perms = s.permissions || {};
        const prods = (s.productsViewed || []).map(p => `${escapeAdminHtml(p.name)} (${p.secondsSpent || 1}s)`).join(', ') || 'Catálogo general';
        return `<tr>
          <td>${escapeAdminHtml(s.entryTime || '')} ${s.exitTime ? '→ ' + escapeAdminHtml(s.exitTime) : ''}</td>
          <td>${u.authenticated ? `<strong>${escapeAdminHtml(u.name)}</strong> (${escapeAdminHtml(u.phone || '')})` : `Visitante (${escapeAdminHtml((s.device && s.device.fingerprintId) || '')})`}</td>
          <td>${escapeAdminHtml(u.city || perms.city || loc.city || '')}</td>
          <td>${formatDuration(s.durationSeconds || 0)}</td>
          <td>${prods}</td>
        </tr>`;
      }).join('');

  const htmlDoc = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Informe Diario Bloom Beauty — ${escapeAdminHtml(dayKey)}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #18181b; margin: 28px; line-height: 1.45; }
  .head { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #b58d28; padding-bottom: 14px; margin-bottom: 20px; }
  h1 { margin: 0; font-size: 22px; color: #111; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .kpi { border: 1px solid #e4e4e7; border-radius: 10px; padding: 12px 14px; background: #fafafa; }
  .kpi small { color: #71717a; text-transform: uppercase; font-size: 11px; font-weight: 700; display: block; }
  .kpi strong { font-size: 20px; color: #111827; }
  h2 { font-size: 16px; margin: 22px 0 10px; color: #7c5c10; text-transform: uppercase; letter-spacing: 0.5px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 18px; }
  th, td { border: 1px solid #e4e4e7; padding: 8px 10px; text-align: left; vertical-align: top; }
  th { background: #18181b; color: #fde68a; font-size: 11px; text-transform: uppercase; }
  @media print { body { margin: 12mm; } }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>🌸 BLOOM BEAUTY — INFORME DIARIO DE FLUJO Y VENTAS</h1>
      <div>Fecha analizada: <strong>${escapeAdminHtml(dayKey)}</strong> • Generado: ${escapeAdminHtml(r.generatedAt)}</div>
    </div>
    <div style="text-align:right;font-size:12px;">Reporte Oficial Administrativo v6</div>
  </div>
  <div class="kpis">
    <div class="kpi"><small>Flujo de Personas</small><strong>${r.traffic.totalSessions} visitas</strong><div>${r.traffic.identifiedSessions} autenticados • Prom ${formatDuration(r.traffic.avgDurationSeconds)}</div></div>
    <div class="kpi"><small>Ventas del Día</small><strong>${formatCOP(r.sales.totalSalesCOP)}</strong><div>${r.sales.ordersCount} pedidos • ${r.sales.totalUnitsSold} uds.</div></div>
    <div class="kpi"><small>Recargas de Saldo</small><strong>${formatCOP(r.recharges.totalRechargedCOP)}</strong><div>${r.recharges.approvedCount} recargas aprobadas</div></div>
    <div class="kpi"><small>Nuevos Registros</small><strong>${r.traffic.newRegistrations} usuarios</strong><div>Web: ${r.sales.webOrdersCount} / Manual: ${r.sales.manualOrdersCount}</div></div>
  </div>
  <h2>1. Control Cronológico de Ventas y Recargas</h2>
  <table>
    <thead><tr><th>Hora Exacta</th><th>Tipo</th><th>Cliente</th><th>Ubicación</th><th>Productos / Concepto</th><th>Monto</th><th>Estado</th></tr></thead>
    <tbody>${txRows}</tbody>
  </table>
  <h2>2. Huella Digital y Flujo de Navegación</h2>
  <table>
    <thead><tr><th>Horario</th><th>Usuario / Huella</th><th>Ciudad</th><th>Navegación</th><th>Productos Mirados</th></tr></thead>
    <tbody>${sessionRows}</tbody>
  </table>
</body>
</html>`;

  if (openPrintDialog) {
    const win = window.open('', '_blank');
    if (win) {
      win.document.open();
      win.document.write(htmlDoc);
      win.document.close();
      setTimeout(() => { win.focus(); win.print(); }, 350);
      return;
    }
  }

  const blob = new Blob([htmlDoc], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Reporte_Ejecutivo_BloomBeauty_${dayKey}.html`;
  a.click();
  URL.revokeObjectURL(url);
  showAdminToast(`📄 Reporte ejecutivo del ${dayKey} descargado`, 'success');
}

// ============================================================================
// 11.5 VISTA: ADMINISTRACIÓN DE NOTIFICACIONES BASADAS EN COMPORTAMIENTO
// ============================================================================
function getTriggerLabel(triggerType) {
  const map = {
    'product_view': '👁️ Al mirar un Producto',
    'brand_interest': '👑 Al explorar una Marca',
    'cart_idle': '🛍️ Carrito con productos pendientes',
    'welcome_optin': '🌸 Bienvenida tras conceder permisos'
  };
  return map[triggerType] || triggerType;
}

function renderNotificationsAdminView() {
  if (typeof BloomDB !== 'undefined' && typeof BloomDB.getNotificationsData === 'function') {
    currentNotifications = BloomDB.getNotificationsData();
  }

  const globalPill = document.getElementById('notif-global-status-pill');
  const toggleBtn = document.getElementById('btn-toggle-global-notifs');
  const isEnabled = currentNotifications.globalEnabled !== false;

  if (globalPill) {
    globalPill.innerText = isEnabled ? '✓ Motor Activo' : '⏸️ Motor en Pausa';
    globalPill.style.color = isEnabled ? '#34D399' : '#FBBF24';
  }
  if (toggleBtn) {
    toggleBtn.innerText = isEnabled ? '⏸️ Pausar Motor Global' : '▶️ Activar Motor Global';
  }

  // Poblar selector de producto en envío directo
  const prodSelect = document.getElementById('direct-notif-product');
  if (prodSelect) {
    const currentVal = prodSelect.value;
    const prods = (currentMasterData.products || []).filter(p => p.active !== false);
    prodSelect.innerHTML = `<option value="">-- Solo abrir catálogo --</option>` +
      prods.map(p => `<option value="${escapeAttr(p.id)}">${escapeAdminHtml(p.name)} (${escapeAdminHtml(p.brandName || '')})</option>`).join('');
    prodSelect.value = currentVal || '';
  }

  const rulesGrid = document.getElementById('admin-auto-rules-grid');
  if (rulesGrid) {
    const rules = currentNotifications.autoRules || [];
    if (rules.length === 0) {
      rulesGrid.innerHTML = `<div style="padding:1.5rem; color:var(--text-muted); text-align:center;">No hay reglas automáticas configuradas. Crea una nueva regla para disparar notificaciones según la navegación del visitante.</div>`;
    } else {
      rulesGrid.innerHTML = rules.map(r => {
        const active = r.active !== false;
        return `
          <div class="notif-rule-card ${active ? '' : 'rule-paused'}">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:8px;">
                <div style="flex:1; min-width:0;">
                  <span class="click-edit-chip" style="font-size:0.72rem; margin-bottom:5px; display:inline-block;" onclick="editNotifRuleFieldInline(this, '${escapeAttr(r.id)}', 'triggerType')" title="Toca para cambiar el disparador">
                    ${getTriggerLabel(r.triggerType)} ✏️
                  </span>
                  <div class="editable-text-cell" onclick="editNotifRuleFieldInline(this, '${escapeAttr(r.id)}', 'name')" title="Toca para renombrar esta regla">
                    <h4 style="color:#FFF; font-size:1rem; margin:0;">${escapeAdminHtml(r.name)}</h4>
                  </div>
                </div>
                <span class="badge-status status-clickable ${active ? 'active' : 'inactive'}" onclick="toggleRuleAdmin('${escapeAttr(r.id)}')" title="Toca para activar o pausar en 1 clic">
                  ${active ? '✓ Activa' : '⏸️ Pausada'}
                </span>
              </div>
              <div style="font-size:0.8rem; color:var(--gold-light); margin-bottom:8px; display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                <span>⚡ Tras</span>
                <span class="click-edit-chip" onclick="editNotifRuleFieldInline(this, '${escapeAttr(r.id)}', 'thresholdCount')" title="Toca para cambiar número de eventos">${r.thresholdCount || 1} evento(s)</span>
                <span>o</span>
                <span class="click-edit-chip" onclick="editNotifRuleFieldInline(this, '${escapeAttr(r.id)}', 'thresholdSeconds')" title="Toca para cambiar segundos">${r.thresholdSeconds || 10}s</span>
                <span>• Espera:</span>
                <span class="click-edit-chip" onclick="editNotifRuleFieldInline(this, '${escapeAttr(r.id)}', 'cooldownMinutes')" title="Toca para cambiar minutos de enfriamiento">${r.cooldownMinutes || 15} min</span>
              </div>
              <div class="notif-rule-preview">
                <div class="editable-text-cell" onclick="editNotifRuleFieldInline(this, '${escapeAttr(r.id)}', 'titleTemplate')" title="Toca para editar el título de la alerta">
                  <strong>${escapeAdminHtml(r.titleTemplate)}</strong>
                </div>
                <div class="editable-text-cell" style="margin-top:3px;" onclick="editNotifRuleFieldInline(this, '${escapeAttr(r.id)}', 'bodyTemplate')" title="Toca para editar el mensaje ({usuario}, {producto}, {marca}, {ciudad})">
                  <p>${escapeAdminHtml(r.bodyTemplate)}</p>
                </div>
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-top:10px;">
              <small style="color:var(--text-dim); font-size:0.72rem;">Variables: {usuario} {producto} {ciudad}</small>
              <button type="button" class="btn-table-action danger" onclick="deleteRuleAdmin('${escapeAttr(r.id)}')" title="Eliminar regla">🗑️</button>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  const logList = document.getElementById('admin-notif-delivery-log');
  const logCount = document.getElementById('notif-delivered-count-tag');
  const logs = currentNotifications.deliveryLog || [];
  if (logCount) logCount.innerText = logs.length;

  if (logList) {
    if (logs.length === 0) {
      logList.innerHTML = `<div style="padding: 2rem 1rem; text-align: center; color: var(--text-dim); font-size: 0.85rem;">Cuando un visitante reciba una alerta automática o directa en su navegador/celular, quedará registrada aquí con su hora exacta.</div>`;
    } else {
      logList.innerHTML = logs.slice(0, 35).map(l => `
        <div class="notif-log-item">
          <div style="display:flex; justify-content:space-between; gap:8px; font-size:0.78rem; margin-bottom:3px;">
            <strong style="color:var(--gold-light); font-family:monospace;">🕒 ${escapeAdminHtml(l.exactTime || '')}</strong>
            <span style="color:#34D399;">👤 ${escapeAdminHtml(l.userName || 'Visitante')} ${l.city ? '• 📍 ' + escapeAdminHtml(l.city) : ''}</span>
          </div>
          <div style="font-weight:700; color:#FFF; font-size:0.86rem;">${escapeAdminHtml(l.title || '')}</div>
          <div style="color:var(--text-muted); font-size:0.8rem;">${escapeAdminHtml(l.body || '')}</div>
        </div>
      `).join('');
    }
  }
}

function addQuickNotificationRule() {
  if (typeof BloomDB === 'undefined' || typeof BloomDB.saveAutoNotificationRule !== 'function') return;
  BloomDB.saveAutoNotificationRule({
    id: '',
    name: 'Nueva Regla Inteligente (Toca para editar)',
    triggerType: 'product_view',
    cooldownMinutes: 15,
    thresholdCount: 2,
    thresholdSeconds: 10,
    titleTemplate: '✨ ¡{producto} sigue disponible para ti!',
    bodyTemplate: 'Hola {usuario}, vimos tu interés en {producto} desde {ciudad}. ¡Pídelo hoy con envío seguro!',
    active: true
  });
  refreshDataFromDB();
  renderNotificationsAdminView();
  showAdminToast('🤖 Regla creada — toca cualquier texto de la tarjeta para editarla', 'success');
}

function editNotifRuleFieldInline(el, ruleId, field) {
  const rules = (currentNotifications && currentNotifications.autoRules) || [];
  const target = rules.find(r => String(r.id) === String(ruleId));
  if (!target) return;

  const isSelect = field === 'triggerType';
  const isNum = field === 'thresholdCount' || field === 'thresholdSeconds' || field === 'cooldownMinutes';
  const isMulti = field === 'bodyTemplate';

  openInlineFieldEditor(el, {
    type: isSelect ? 'select' : (isNum ? 'number' : (isMulti ? 'textarea' : 'text')),
    rows: isMulti ? 2 : 1,
    value: target[field],
    min: isNum ? 1 : undefined,
    style: isNum ? 'width: 72px;' : 'width: 100%;',
    options: isSelect ? [
      { value: 'product_view', label: '👁️ Al mirar un Producto' },
      { value: 'brand_interest', label: '👑 Al explorar una Marca' },
      { value: 'cart_idle', label: '🛍️ Carrito con productos pendientes' },
      { value: 'welcome_optin', label: '🌸 Bienvenida tras permisos' }
    ] : undefined,
    onSave: (val) => {
      const updated = Object.assign({}, target);
      if (isNum) {
        updated[field] = Math.max(1, Math.round(Number(val) || 1));
      } else {
        const clean = String(val || '').trim();
        if (!clean) {
          renderNotificationsAdminView();
          return;
        }
        updated[field] = clean;
      }
      BloomDB.saveAutoNotificationRule(updated);
      refreshDataFromDB();
      renderNotificationsAdminView();
      showAdminToast('🤖 Regla automática actualizada en vivo', 'success');
    },
    onCancel: renderNotificationsAdminView
  });
}

function toggleGlobalNotificationsEngine() {
  if (typeof BloomDB === 'undefined') return;
  const state = BloomDB.getNotificationsData();
  state.globalEnabled = !state.globalEnabled;
  BloomDB.saveNotificationsData(state);
  refreshDataFromDB();
  renderNotificationsAdminView();
  showAdminToast(state.globalEnabled ? '🔔 Motor global de notificaciones activado' : '⏸️ Motor global de notificaciones en pausa', 'info');
}

function openNotificationRuleModal(rule = null) {
  const form = document.getElementById('form-notification-rule');
  if (form) form.reset();

  if (rule) {
    document.getElementById('modal-notif-rule-title').innerText = '✏️ Editar Regla Automática';
    document.getElementById('notif-rule-id').value = rule.id;
    document.getElementById('notif-rule-name').value = rule.name || '';
    document.getElementById('notif-rule-trigger').value = rule.triggerType || 'product_view';
    document.getElementById('notif-rule-cooldown').value = rule.cooldownMinutes || 15;
    document.getElementById('notif-rule-count').value = rule.thresholdCount || 2;
    document.getElementById('notif-rule-seconds').value = rule.thresholdSeconds || 10;
    document.getElementById('notif-rule-title-tpl').value = rule.titleTemplate || '';
    document.getElementById('notif-rule-body-tpl').value = rule.bodyTemplate || '';
    document.getElementById('notif-rule-active').checked = rule.active !== false;
  } else {
    document.getElementById('modal-notif-rule-title').innerText = '➕ Nueva Regla Automática de Navegación';
    document.getElementById('notif-rule-id').value = '';
    document.getElementById('notif-rule-active').checked = true;
  }

  document.getElementById('modal-notification-rule').classList.add('open');
}

function editNotificationRuleModal(ruleId) {
  const rule = ((currentNotifications && currentNotifications.autoRules) || []).find(r => r.id === ruleId);
  if (rule) openNotificationRuleModal(rule);
}

function saveNotificationRuleFromForm(e) {
  e.preventDefault();
  if (typeof BloomDB === 'undefined' || typeof BloomDB.saveAutoNotificationRule !== 'function') return;

  BloomDB.saveAutoNotificationRule({
    id: (document.getElementById('notif-rule-id').value || '').trim(),
    name: document.getElementById('notif-rule-name').value.trim(),
    triggerType: document.getElementById('notif-rule-trigger').value,
    cooldownMinutes: Number(document.getElementById('notif-rule-cooldown').value) || 15,
    thresholdCount: Number(document.getElementById('notif-rule-count').value) || 1,
    thresholdSeconds: Number(document.getElementById('notif-rule-seconds').value) || 10,
    titleTemplate: document.getElementById('notif-rule-title-tpl').value.trim(),
    bodyTemplate: document.getElementById('notif-rule-body-tpl').value.trim(),
    active: document.getElementById('notif-rule-active').checked
  });

  closeAdminModal('modal-notification-rule');
  refreshDataFromDB();
  renderNotificationsAdminView();
  showAdminToast('🤖 Regla automática guardada y sincronizada en vivo', 'success');
}

function toggleRuleAdmin(ruleId) {
  if (typeof BloomDB !== 'undefined' && typeof BloomDB.toggleAutoNotificationRule === 'function') {
    BloomDB.toggleAutoNotificationRule(ruleId);
  }
  refreshDataFromDB();
  renderNotificationsAdminView();
}

function deleteRuleAdmin(ruleId) {
  if (typeof BloomDB !== 'undefined' && typeof BloomDB.deleteAutoNotificationRule === 'function') {
    BloomDB.deleteAutoNotificationRule(ruleId);
  }
  refreshDataFromDB();
  renderNotificationsAdminView();
  showAdminToast('🗑️ Regla automática eliminada', 'info');
}

function handleDirectNotifTargetChange() {
  const sel = document.getElementById('direct-notif-target-type');
  const group = document.getElementById('direct-notif-target-val-group');
  const label = document.getElementById('direct-notif-target-val-label');
  const input = document.getElementById('direct-notif-target-value');
  if (!sel || !group || !label || !input) return;

  const val = sel.value;
  if (val === 'all') {
    group.style.display = 'none';
    input.required = false;
  } else {
    group.style.display = 'block';
    input.required = true;
    if (val === 'brand_interest') {
      label.innerText = 'Marca o Producto que el usuario miró *';
      input.placeholder = 'Ej: Milagros, Kaba, Anyeluz...';
    } else if (val === 'city') {
      label.innerText = 'Ciudad objetivo *';
      input.placeholder = 'Ej: Medellín, Bogotá, Cali...';
    } else {
      label.innerText = 'Correo, Nombre o ID del Usuario *';
      input.placeholder = 'Ej: cliente@gmail.com o Laura';
    }
  }
}

function sendDirectCampaignFromAdmin(e) {
  e.preventDefault();
  if (typeof BloomDB === 'undefined' || typeof BloomDB.sendAdminNotification !== 'function') return;

  const targetType = document.getElementById('direct-notif-target-type').value;
  const targetValue = (document.getElementById('direct-notif-target-value').value || '').trim();
  const title = (document.getElementById('direct-notif-title').value || '').trim();
  const body = (document.getElementById('direct-notif-body').value || '').trim();
  const ctaProductId = (document.getElementById('direct-notif-product').value || '').trim();

  if (!title || !body) {
    showAdminToast('Ingresa el título y mensaje de la notificación.', 'error');
    return;
  }

  BloomDB.sendAdminNotification({
    targetType,
    targetValue: targetType === 'all' ? '' : targetValue,
    title,
    body,
    ctaProductId
  });

  document.getElementById('direct-notif-title').value = '';
  document.getElementById('direct-notif-body').value = '';
  refreshDataFromDB();
  renderNotificationsAdminView();
  showAdminToast('🚀 Notificación enviada en tiempo real a los dispositivos conectados', 'success');
}

function clearNotificationDeliveryLog() {
  if (typeof BloomDB === 'undefined') return;
  const state = BloomDB.getNotificationsData();
  state.deliveryLog = [];
  BloomDB.saveNotificationsData(state);
  refreshDataFromDB();
  renderNotificationsAdminView();
  showAdminToast('✓ Historial de entregas limpiado', 'info');
}

// ============================================================================
// 12. UTILIDADES GENERALES & NOTIFICACIONES TOAST
// ============================================================================
function showAdminToast(message, type = 'success') {
  let container = document.getElementById('admin-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'admin-toast-container';
    container.className = 'admin-toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `admin-toast-item toast-${type}`;
  toast.innerHTML = `<span>${escapeAdminHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    setTimeout(() => toast.remove(), 260);
  }, 3400);
}

function escapeAdminHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatAdminWhatsAppNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '573135143012';
  return (digits.length > 10 && digits.startsWith('57')) ? digits : ('57' + digits);
}

function formatCOP(num) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(num || 0);
}

function formatDuration(sec) {
  if (sec < 60) return `${sec} seg`;
  const mins = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (mins < 60) return `${mins} min ${remSec > 0 ? remSec + 's' : ''}`;
  const hrs = Math.floor(mins / 60);
  const remMin = mins % 60;
  return `${hrs} h ${remMin} m`;
}

function closeAdminModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.remove('open');
}

// Inicialización
document.addEventListener('DOMContentLoaded', initAdmin);

function openReceiptModal(imgUrl, reqId, custName, amount) {
  let modal = document.getElementById('receipt-preview-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'receipt-preview-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:15px;';
    modal.innerHTML = `
      <div style="background:#18181B;border:1px solid #3F3F46;border-radius:12px;max-width:500px;width:100%;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);">
        <div style="padding:14px 16px;border-bottom:1px solid #27272A;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong id="receipt-modal-title" style="color:#FFF;font-size:0.95rem;">Comprobante de Pago</strong>
            <div id="receipt-modal-sub" style="font-size:0.78rem;color:#A1A1AA;"></div>
          </div>
          <button type="button" onclick="closeReceiptModal()" style="background:transparent;border:none;color:#A1A1AA;font-size:1.4rem;cursor:pointer;">✕</button>
        </div>
        <div style="padding:16px;overflow-y:auto;text-align:center;flex:1;background:#09090B;">
          <img id="receipt-modal-img" src="" alt="Comprobante" style="max-width:100%;max-height:60vh;border-radius:8px;object-fit:contain;border:1px solid #27272A;">
        </div>
        <div style="padding:14px 16px;border-top:1px solid #27272A;display:flex;gap:10px;justify-content:flex-end;">
          <button type="button" onclick="closeReceiptModal()" style="padding:8px 14px;border-radius:6px;border:1px solid #3F3F46;background:transparent;color:#FFF;cursor:pointer;font-size:0.85rem;">Cerrar</button>
          <button id="receipt-modal-btn-approve" type="button" style="padding:8px 16px;border-radius:6px;border:none;background:#10B981;color:#FFF;font-weight:700;cursor:pointer;font-size:0.85rem;">✓ Confirmar y Abonar Saldo</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  document.getElementById('receipt-modal-title').innerText = `Comprobante de ${custName}`;
  document.getElementById('receipt-modal-sub').innerText = `Solicitud: ${reqId} • Monto: ${formatCOP(amount)}`;
  document.getElementById('receipt-modal-img').src = imgUrl;

  const btnApprove = document.getElementById('receipt-modal-btn-approve');
  btnApprove.onclick = async () => {
    btnApprove.disabled = true;
    btnApprove.innerText = '⏳ Aprobando...';
    try {
      const cloudEndpoint = (typeof BloomDB !== 'undefined' && BloomDB.getCloudConfig)
        ? BloomDB.getCloudConfig().endpointUrl
        : 'https://bloom-backend-v6.onrender.com';
      const res = await fetch(`${cloudEndpoint}/api/v6/recharges/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rechargeId: reqId })
      });
      approveRechargeAction(reqId);
      if (res.ok) {
        showAdminToast('¡Recarga confirmada y saldo acreditado en la nube!', 'success');
      }
    } catch (e) {
      approveRechargeAction(reqId);
    } finally {
      closeReceiptModal();
      refreshDataFromDB();
      renderCustomersTable();
    }
  };

  modal.style.display = 'flex';
}

function closeReceiptModal() {
  const modal = document.getElementById('receipt-preview-modal');
  if (modal) modal.style.display = 'none';
}


// ============================================================================
// AUTO-SINCRONIZACIÓN EN TIEMPO REAL CON LA NUBE (RENDER + SUPABASE)
// ============================================================================
async function autoSyncCloudDataRealTime() {
  try {
    if (typeof BloomDB !== 'undefined' && BloomDB.cloud && typeof BloomDB.cloud.pullSnapshot === 'function') {
      const res = await BloomDB.cloud.pullSnapshot();
      if (res && res.success) {
        refreshDataFromDB();
        renderCurrentView();
        console.log('[CloudSync] Datos sincronizados en tiempo real desde Supabase.');
      }
    }
  } catch (e) {
    console.warn('[CloudSync] Error en ciclo de auto-sincronización:', e);
  }
}

// Iniciar auto-sincronización al cargar y cada 10 segundos
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(autoSyncCloudDataRealTime, 600);
    setInterval(autoSyncCloudDataRealTime, 10000); // Cada 10 segundos
  });
} else {
  setTimeout(autoSyncCloudDataRealTime, 600);
  setInterval(autoSyncCloudDataRealTime, 10000);
}
