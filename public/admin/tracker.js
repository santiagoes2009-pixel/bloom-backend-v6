// ============================================================================
// BLOOM BEAUTY v6 - TELEMETRÍA, RASTRO DIGITAL Y ALERTAS DE COMPORTAMIENTO
// Registro exacto de sesiones, identidad autenticada, ubicación, tiempos de
// navegación, productos explorados y motor de alertas personalizadas.
// ============================================================================

(function () {
  'use strict';

  const STORAGE_KEY_SESSIONS = 'bloom_beauty_real_sessions_v1';
  const CURRENT_SID_KEY = 'bloom_current_session_id';
  const PERMISSIONS_STORAGE_KEY = 'bloom_entry_permissions_v6';
  const RULE_COOLDOWN_KEY = 'bloom_notif_rule_cooldowns_v6';
  const SEEN_DIRECT_NOTIF_KEY = 'bloom_seen_direct_notifs_v6';

  function getLocalDayKey(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatExactHour(d = new Date()) {
    return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function isExternalManagementContext() {
    if (typeof window === 'undefined') return false;
    if (window.__BLOOM_PASSIVE_TELEMETRY__ === true) return true;
    return false;
  }

  // Modo lectura pasiva si se carga fuera del catálogo público
  if (isExternalManagementContext()) {
    window.BloomTracker = {
      trackProductView: () => {},
      trackBrandExplore: () => {},
      identifyUser: () => {},
      clearUser: () => {},
      updatePermissions: () => {},
      logAction: () => {},
      getCurrentSession: () => null,
      getAllSessions: () => {
        try {
          return JSON.parse(localStorage.getItem(STORAGE_KEY_SESSIONS) || '[]');
        } catch (e) {
          return [];
        }
      },
      clearSessions: () => {
        localStorage.removeItem(STORAGE_KEY_SESSIONS);
      }
    };
    return;
  }

  // 1. Identificador persistente de visitante
  let visitorId = '';
  try {
    visitorId = localStorage.getItem('bloom_visitor_persistent_id') || '';
  } catch (e) {}
  if (!visitorId) {
    visitorId = 'bb_vis_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
    try { localStorage.setItem('bloom_visitor_persistent_id', visitorId); } catch (e) {}
  }

  // 2. Identificador de sesión activa
  let sessionId = '';
  let isNewSession = false;
  try {
    sessionId = sessionStorage.getItem(CURRENT_SID_KEY) || '';
  } catch (e) {}
  if (!sessionId) {
    sessionId = 'bb_sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    try { sessionStorage.setItem(CURRENT_SID_KEY, sessionId); } catch (e) {}
    isNewSession = true;
  }

  // 3. Huella digital de dispositivo y hardware
  function generateDeviceFingerprint() {
    const nav = window.navigator || {};
    const scr = window.screen || {};

    let gpuRenderer = 'Estándar';
    let gpuVendor = 'Genérico';
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          gpuVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'Standard';
          gpuRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'Generic GPU';
        }
      }
    } catch (e) {}

    const ua = nav.userAgent || '';
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    const isTablet = /(iPad|tablet|(android(?!.*mobile))|(windows(?!.*phone)(.*touch))|kindle|playbook|silk)/i.test(ua);
    const deviceType = isTablet ? 'Tablet' : (isMobile ? 'Móvil / Smartphone' : 'Computador / Laptop');

    let browserName = 'Navegador Web';
    if (ua.indexOf('Edg') !== -1) browserName = 'Microsoft Edge';
    else if (ua.indexOf('Chrome') !== -1) browserName = 'Google Chrome';
    else if (ua.indexOf('Firefox') !== -1) browserName = 'Mozilla Firefox';
    else if (ua.indexOf('Safari') !== -1 && ua.indexOf('Chrome') === -1) browserName = 'Apple Safari';
    else if (ua.indexOf('Opera') !== -1 || ua.indexOf('OPR') !== -1) browserName = 'Opera';

    let osName = 'Sistema Operativo';
    if (ua.indexOf('Windows NT 10.0') !== -1) osName = 'Windows 10 / 11';
    else if (ua.indexOf('Windows') !== -1) osName = 'Windows';
    else if (ua.indexOf('Android') !== -1) osName = 'Android';
    else if (ua.indexOf('iPhone') !== -1 || ua.indexOf('iPad') !== -1) osName = 'iOS (Apple)';
    else if (ua.indexOf('Mac') !== -1) osName = 'macOS';
    else if (ua.indexOf('Linux') !== -1) osName = 'Linux';

    const rawFpString = [
      ua,
      nav.language,
      scr.width + 'x' + scr.height + 'x' + scr.colorDepth,
      new Date().getTimezoneOffset(),
      nav.hardwareConcurrency || 4,
      nav.deviceMemory || 'N/A',
      gpuRenderer
    ].join('###');

    let fpHash = 0;
    for (let i = 0; i < rawFpString.length; i++) {
      const char = rawFpString.charCodeAt(i);
      fpHash = ((fpHash << 5) - fpHash) + char;
      fpHash |= 0;
    }
    const shortFpId = 'FP-' + Math.abs(fpHash).toString(16).toUpperCase();

    return {
      fingerprintId: shortFpId,
      visitorId: visitorId,
      deviceType: deviceType,
      browser: browserName,
      os: osName,
      screenResolution: `${scr.width} x ${scr.height} (${scr.colorDepth} bits)`,
      windowViewport: `${window.innerWidth} x ${window.innerHeight}`,
      language: nav.language || 'es-CO',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota',
      cpuCores: nav.hardwareConcurrency ? `${nav.hardwareConcurrency} núcleos` : 'No disponible',
      deviceMemory: nav.deviceMemory ? `${nav.deviceMemory} GB RAM aprox` : 'No disponible',
      gpu: `${gpuVendor} - ${gpuRenderer}`,
      touchSupport: ('ontouchstart' in window || nav.maxTouchPoints > 0) ? 'Sí (Pantalla táctil)' : 'No (Mouse / Teclado)',
      connectionType: (nav.connection && nav.connection.effectiveType) ? nav.connection.effectiveType.toUpperCase() : 'Banda ancha / WiFi'
    };
  }

  function readStoredUserSnapshot() {
    try {
      const raw = localStorage.getItem('bloom_customer_current_user');
      if (raw) {
        const u = JSON.parse(raw);
        if (u && (u.id || u.email || u.phone)) {
          return {
            authenticated: true,
            id: u.id || '',
            name: u.username || u.name || 'Cliente',
            phone: u.phone || '',
            email: u.email || '',
            city: u.city || '',
            department: u.department || ''
          };
        }
      }
    } catch (e) {}
    return {
      authenticated: false,
      id: '',
      name: 'Visitante sin sesión',
      phone: '',
      email: '',
      city: '',
      department: ''
    };
  }

  function readStoredPermissionsSnapshot() {
    try {
      const raw = localStorage.getItem(PERMISSIONS_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {
      completed: false,
      locationGranted: false,
      notificationsGranted: false,
      city: '',
      department: ''
    };
  }

  // 4. Estructura de la sesión activa
  const entryDateObj = new Date();
  const entryTimestamp = entryDateObj.getTime();
  const initialPerms = readStoredPermissionsSnapshot();
  const initialUser = readStoredUserSnapshot();

  let currentSession = {
    sessionId: sessionId,
    visitorId: visitorId,
    dayKey: getLocalDayKey(entryDateObj),
    entryTime: formatExactHour(entryDateObj),
    entryDate: entryDateObj.toLocaleDateString('es-CO'),
    dateFormatted: entryDateObj.toLocaleDateString('es-CO'),
    entryTimestamp: entryTimestamp,
    lastActiveTimestamp: entryTimestamp,
    lastActiveTime: formatExactHour(entryDateObj),
    exitTime: null,
    exitTimestamp: null,
    durationSeconds: 0,
    isActiveNow: true,
    user: initialUser,
    permissions: initialPerms,
    location: {
      ip: 'Detectando IP...',
      city: initialPerms.city || initialUser.city || 'Detectando...',
      region: initialPerms.department || initialUser.department || '',
      country: 'Colombia',
      countryCode: 'CO',
      isp: 'Red Nacional',
      lat: null,
      lon: null,
      timezone: 'America/Bogota'
    },
    device: generateDeviceFingerprint(),
    productsViewed: [],
    brandsExplored: {},
    actionsHistory: [],
    pageSectionsVisited: [],
    cartInteractions: 0,
    ordersPlaced: 0
  };

  const MAX_STORED_SESSIONS = 150;
  const MAX_SESSION_AGE_MS = 14 * 24 * 60 * 60 * 1000;

  function sanitizeAndPurgeSessions(sessionsList) {
    if (!Array.isArray(sessionsList)) return [];
    const now = Date.now();
    let valid = sessionsList.filter(s => {
      const entryTime = Number(s.entryTimestamp) || 0;
      return (now - entryTime) < MAX_SESSION_AGE_MS;
    });
    if (valid.length > MAX_STORED_SESSIONS) {
      valid = valid.slice(0, MAX_STORED_SESSIONS);
    }
    return valid;
  }

  function loadOrCreateSession() {
    try {
      let allSessions = JSON.parse(localStorage.getItem(STORAGE_KEY_SESSIONS) || '[]');
      const found = allSessions.find(s => s.sessionId === sessionId);
      if (found) {
        currentSession = Object.assign(currentSession, found);
        currentSession.isActiveNow = true;
        currentSession.lastActiveTimestamp = Date.now();
        currentSession.lastActiveTime = formatExactHour(new Date());
        // Sincronizar usuario y permisos recientes
        const freshUser = readStoredUserSnapshot();
        if (freshUser.authenticated) currentSession.user = freshUser;
        const freshPerms = readStoredPermissionsSnapshot();
        if (freshPerms.completed) {
          currentSession.permissions = freshPerms;
          if (freshPerms.city) currentSession.location.city = freshPerms.city;
          if (freshPerms.department) currentSession.location.region = freshPerms.department;
        }
      } else {
        allSessions.unshift(currentSession);
      }
      allSessions = sanitizeAndPurgeSessions(allSessions);
      localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(allSessions));
    } catch (e) {}
  }

  function persistSession(notifyBus = false) {
    try {
      const now = new Date();
      currentSession.lastActiveTimestamp = now.getTime();
      currentSession.lastActiveTime = formatExactHour(now);
      currentSession.durationSeconds = Math.max(0, Math.round((now.getTime() - currentSession.entryTimestamp) / 1000));

      let allSessions = JSON.parse(localStorage.getItem(STORAGE_KEY_SESSIONS) || '[]');
      const idx = allSessions.findIndex(s => s.sessionId === sessionId);
      if (idx !== -1) {
        allSessions[idx] = currentSession;
      } else {
        allSessions.unshift(currentSession);
      }
      allSessions = sanitizeAndPurgeSessions(allSessions);
      localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(allSessions));

      if (notifyBus && typeof BloomDB !== 'undefined' && typeof BloomDB.touchPing === 'function') {
        BloomDB.touchPing();
      }
    } catch (e) {}

    // Transmisión en tiempo real a la nube (Backend Render + Supabase)
    syncSessionToCloud(false);
  }

  function getCloudPingUrl() {
    try {
      if (typeof BloomDB !== 'undefined' && BloomDB.getCloudConfig) {
        const endpoint = BloomDB.getCloudConfig().endpointUrl;
        if (endpoint) return `${endpoint}/api/v6/visitors/ping`;
      }
    } catch (e) {}
    return 'https://bloom-backend-v6.onrender.com/api/v6/visitors/ping';
  }
  let lastCloudPingTimestamp = 0;

  function syncSessionToCloud(force = false, actionOverride = '', productObj = null, isCart = false) {
    if (typeof fetch === 'undefined') return;
    const now = Date.now();
    if (!force && (now - lastCloudPingTimestamp) < 4000) return;
    lastCloudPingTimestamp = now;

    try {
      const u = currentSession.user || {};
      const loc = currentSession.location || {};
      const perms = currentSession.permissions || {};
      const dev = currentSession.device || {};

      const payload = {
        sessionId: sessionId,
        user: (u && u.authenticated) ? {
          id: u.id,
          name: u.name,
          phone: u.phone,
          email: u.email,
          balance: Number(u.balance || 0),
          authenticated: true
        } : null,
        location: {
          city: loc.city || perms.city || 'Colombia',
          department: loc.region || perms.department || 'Nacional',
          lat: loc.lat || perms.lat || null,
          lon: loc.lon || perms.lon || null
        },
        device: {
          isMobile: Boolean(dev.isMobile),
          os: dev.os || 'Web',
          browser: dev.browser || 'Navegador Web',
          screen: dev.screenResolution || ''
        },
        action: actionOverride || (currentSession.actionsHistory && currentSession.actionsHistory[0]?.action) || 'Navegando en la tienda',
        productViewed: productObj || null,
        isCartAction: Boolean(isCart),
        url: window.location.hash || window.location.pathname || '/'
      };

      fetch(getCloudPingUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => {});
    } catch (e) {}
  }

  // 5. Detección de Geolocalización IP de respaldo
  async function fetchRealGeoLocation() {
    if (currentSession.location && currentSession.location.ip && !currentSession.location.ip.includes('Detectando')) {
      return;
    }

    try {
      const resp = await fetch('https://ipapi.co/json/');
      if (resp.ok) {
        const geo = await resp.json();
        const declaredCity = currentSession.permissions && currentSession.permissions.city;
        const declaredDept = currentSession.permissions && currentSession.permissions.department;
        currentSession.location = {
          ip: geo.ip || 'Red activa',
          city: declaredCity || geo.city || 'Colombia',
          region: declaredDept || geo.region || '',
          country: geo.country_name || 'Colombia',
          countryCode: geo.country_code || 'CO',
          isp: geo.org || 'Proveedor Nacional',
          lat: currentSession.location.lat || geo.latitude,
          lon: currentSession.location.lon || geo.longitude,
          timezone: geo.timezone || 'America/Bogota'
        };
        persistSession(true);
        return;
      }
    } catch (err) {
      try {
        const fallback = await fetch('https://api.ipify.org?format=json');
        if (fallback.ok) {
          const ipData = await fallback.json();
          currentSession.location.ip = ipData.ip;
          if (!currentSession.location.city || currentSession.location.city.includes('Detectando')) {
            currentSession.location.city = 'Ubicación Nacional';
          }
          persistSession(true);
        }
      } catch (e) {
        currentSession.location.ip = 'Conexión Directa';
        if (!currentSession.location.city || currentSession.location.city.includes('Detectando')) {
          currentSession.location.city = 'Colombia';
        }
        persistSession(false);
      }
    }
  }

  // 6. Motor de Evaluación de Notificaciones Personalizadas por Comportamiento
  function canUserReceiveAlerts() {
    const perms = currentSession.permissions || readStoredPermissionsSnapshot();
    const browserGranted = (typeof Notification !== 'undefined' && Notification.permission === 'granted');
    return Boolean(perms.notificationsGranted || browserGranted);
  }

  function isRuleOnCooldown(ruleId, cooldownMinutes) {
    try {
      const map = JSON.parse(sessionStorage.getItem(RULE_COOLDOWN_KEY) || '{}');
      const lastFired = Number(map[ruleId]) || 0;
      const cooldownMs = Math.max(1, Number(cooldownMinutes) || 15) * 60 * 1000;
      return (Date.now() - lastFired) < cooldownMs;
    } catch (e) {
      return false;
    }
  }

  function markRuleFired(ruleId) {
    try {
      const map = JSON.parse(sessionStorage.getItem(RULE_COOLDOWN_KEY) || '{}');
      map[ruleId] = Date.now();
      sessionStorage.setItem(RULE_COOLDOWN_KEY, JSON.stringify(map));
    } catch (e) {}
  }

  function interpolateTemplate(tpl, ctx = {}) {
    const userName = (currentSession.user && currentSession.user.authenticated && currentSession.user.name)
      ? currentSession.user.name.split(' ')[0]
      : 'Amante de la belleza';
    const city = (currentSession.permissions && currentSession.permissions.city)
      || (currentSession.location && currentSession.location.city)
      || 'tu ciudad';

    return String(tpl || '')
      .replace(/\{usuario\}/gi, ctx.usuario || userName)
      .replace(/\{producto\}/gi, ctx.producto || 'nuestro catálogo')
      .replace(/\{marca\}/gi, ctx.marca || 'Bloom Beauty')
      .replace(/\{ciudad\}/gi, ctx.ciudad || city)
      .replace(/\{departamento\}/gi, ctx.departamento || (currentSession.location && currentSession.location.region) || '');
  }

  function dispatchPersonalizedAlert({ ruleId, title, body, productId, triggerContext }) {
    if (!canUserReceiveAlerts()) return;

    // 1. Notificación nativa del navegador si está permitida
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body: body,
          icon: 'imagenes/logo-bloom-beauty.jpg',
          tag: ruleId || ('bb-alert-' + Date.now())
        });
      } catch (e) {}
    }

    // 2. Evento visual dentro de la tienda
    window.dispatchEvent(new CustomEvent('bloom:personalized-alert', {
      detail: {
        id: 'alrt-' + Date.now(),
        ruleId: ruleId || 'auto',
        title,
        body,
        productId: productId || '',
        exactTime: formatExactHour(new Date())
      }
    }));

    // 3. Registrar entrega en BloomDB
    if (typeof BloomDB !== 'undefined' && typeof BloomDB.logNotificationDelivered === 'function') {
      BloomDB.logNotificationDelivered({
        ruleId: ruleId || 'auto',
        title,
        body,
        visitorId: currentSession.visitorId,
        userName: (currentSession.user && currentSession.user.authenticated) ? currentSession.user.name : `Visitante (${currentSession.device.fingerprintId})`,
        city: currentSession.location ? currentSession.location.city : '',
        triggerContext: triggerContext || ''
      });
    }
  }

  function evaluateBehavioralRules(eventType, context = {}) {
    if (typeof BloomDB === 'undefined' || typeof BloomDB.getNotificationsData !== 'function') return;
    if (!canUserReceiveAlerts()) return;

    const notifConfig = BloomDB.getNotificationsData();
    if (!notifConfig || notifConfig.globalEnabled === false) return;

    const rules = (notifConfig.autoRules || []).filter(r => r.active && r.triggerType === eventType);
    rules.forEach((rule) => {
      if (isRuleOnCooldown(rule.id, rule.cooldownMinutes)) return;

      let shouldFire = false;
      if (eventType === 'product_view' && context.productEntry) {
        const p = context.productEntry;
        if ((p.viewsCount || 1) >= (rule.thresholdCount || 2) || (p.secondsSpent || 0) >= (rule.thresholdSeconds || 12)) {
          shouldFire = true;
        }
      } else if (eventType === 'brand_interest' && context.brandName) {
        const count = Number(currentSession.brandsExplored[context.brandName] || 0);
        if (count >= (rule.thresholdCount || 2)) {
          shouldFire = true;
        }
      } else if (eventType === 'cart_idle') {
        if ((context.idleSeconds || 0) >= (rule.thresholdSeconds || 45)) {
          shouldFire = true;
        }
      } else if (eventType === 'welcome_optin') {
        shouldFire = true;
      }

      if (shouldFire) {
        markRuleFired(rule.id);
        const title = interpolateTemplate(rule.titleTemplate, context);
        const body = interpolateTemplate(rule.bodyTemplate, context);
        dispatchPersonalizedAlert({
          ruleId: rule.id,
          title,
          body,
          productId: context.productId || '',
          triggerContext: `${eventType}: ${context.producto || context.marca || 'activo'}`
        });
      }
    });
  }

  function checkIncomingDirectNotifications() {
    if (typeof BloomDB === 'undefined' || typeof BloomDB.getNotificationsData !== 'function') return;
    if (!canUserReceiveAlerts()) return;

    const notifConfig = BloomDB.getNotificationsData();
    const list = notifConfig.directNotifications || [];
    if (list.length === 0) return;

    let seenIds = [];
    try {
      seenIds = JSON.parse(localStorage.getItem(SEEN_DIRECT_NOTIF_KEY) || '[]');
    } catch (e) {}

    const recentWindowMs = 24 * 60 * 60 * 1000;
    const now = Date.now();

    list.forEach((item) => {
      if (!item || !item.id || seenIds.includes(item.id)) return;
      if ((now - (Number(item.timestamp) || 0)) > recentWindowMs) return;

      let matchesTarget = false;
      const targetVal = String(item.targetValue || '').trim().toLowerCase();

      if (!item.targetType || item.targetType === 'all') {
        matchesTarget = true;
      } else if (item.targetType === 'city' && targetVal) {
        const myCity = String((currentSession.location && currentSession.location.city) || '').toLowerCase();
        matchesTarget = myCity.includes(targetVal);
      } else if (item.targetType === 'brand_interest' && targetVal) {
        const viewedBrands = (currentSession.productsViewed || []).map(p => String(p.brand || '').toLowerCase());
        const exploredBrands = Object.keys(currentSession.brandsExplored || {}).map(b => b.toLowerCase());
        matchesTarget = viewedBrands.some(b => b.includes(targetVal)) || exploredBrands.some(b => b.includes(targetVal));
      } else if (item.targetType === 'customer' && targetVal) {
        const uid = String((currentSession.user && currentSession.user.id) || '').toLowerCase();
        const uemail = String((currentSession.user && currentSession.user.email) || '').toLowerCase();
        const vid = String(currentSession.visitorId || '').toLowerCase();
        matchesTarget = (uid === targetVal || uemail === targetVal || vid === targetVal);
      }

      if (matchesTarget) {
        seenIds.unshift(item.id);
        seenIds = seenIds.slice(0, 100);
        try { localStorage.setItem(SEEN_DIRECT_NOTIF_KEY, JSON.stringify(seenIds)); } catch (e) {}

        const title = interpolateTemplate(item.title, {});
        const body = interpolateTemplate(item.body, {});
        dispatchPersonalizedAlert({
          ruleId: item.id,
          title,
          body,
          productId: item.ctaProductId || '',
          triggerContext: `Campaña directa (${item.targetType})`
        });
      }
    });
  }

  // 7. Registro de Acciones, Identidad y Permisos
  function logAction(action, label) {
    const now = new Date();
    const act = {
      action: action,
      label: label,
      timestamp: now.getTime(),
      timeStr: formatExactHour(now)
    };
    currentSession.actionsHistory = Array.isArray(currentSession.actionsHistory) ? currentSession.actionsHistory : [];
    currentSession.actionsHistory.unshift(act);
    if (currentSession.actionsHistory.length > 60) currentSession.actionsHistory.pop();
    persistSession(true);
  }

  function identifyUser(userObj) {
    if (!userObj) return;
    currentSession.user = {
      authenticated: true,
      id: userObj.id || '',
      name: userObj.username || userObj.name || 'Cliente',
      phone: userObj.phone || '',
      email: userObj.email || '',
      city: userObj.city || '',
      department: userObj.department || ''
    };
    if (userObj.city) currentSession.location.city = userObj.city;
    if (userObj.department) currentSession.location.region = userObj.department;
    logAction('Sesión Autenticada', `${currentSession.user.name} (${currentSession.user.email || currentSession.user.phone})`);
  }

  function clearUser() {
    const prevName = (currentSession.user && currentSession.user.name) || 'Usuario';
    currentSession.user = {
      authenticated: false,
      id: '',
      name: 'Visitante sin sesión',
      phone: '',
      email: '',
      city: '',
      department: ''
    };
    logAction('Cierre de Sesión', `${prevName} cerró sesión`);
  }

  function updatePermissions(permData = {}) {
    currentSession.permissions = Object.assign({}, currentSession.permissions || {}, permData);
    if (permData.city) currentSession.location.city = permData.city;
    if (permData.department) currentSession.location.region = permData.department;
    if (permData.lat) currentSession.location.lat = permData.lat;
    if (permData.lon) currentSession.location.lon = permData.lon;
    persistSession(true);

    if (permData.triggerWelcomeAlert && permData.notificationsGranted) {
      setTimeout(() => {
        evaluateBehavioralRules('welcome_optin', {
          ciudad: permData.city || currentSession.location.city || 'Colombia',
          departamento: permData.department || currentSession.location.region || ''
        });
      }, 1500);
    }
  }

  // 8. Registro de Productos y Marcas Vistos con Tiempo Exacto
  let currentViewingProduct = null;
  let productViewStartTime = 0;
  let lastCartAddTimestamp = 0;

  function trackBrandExplore(brandName) {
    if (!brandName) return;
    const clean = String(brandName).trim();
    currentSession.brandsExplored = currentSession.brandsExplored || {};
    currentSession.brandsExplored[clean] = (Number(currentSession.brandsExplored[clean]) || 0) + 1;
    logAction('Explorar Marca', `Visitó marca: ${clean}`);
    evaluateBehavioralRules('brand_interest', {
      brandName: clean,
      marca: clean
    });
  }

  function trackProductView(prod) {
    if (!prod || !prod.id) return;
    const now = new Date();
    const exactNow = formatExactHour(now);

    if (currentViewingProduct && productViewStartTime > 0 && currentViewingProduct.id !== prod.id) {
      const secondsSpent = Math.max(1, Math.round((now.getTime() - productViewStartTime) / 1000));
      const prevEntry = currentSession.productsViewed.find(p => String(p.id) === String(currentViewingProduct.id));
      if (prevEntry) {
        prevEntry.secondsSpent = (prevEntry.secondsSpent || 0) + secondsSpent;
      }
    }

    currentViewingProduct = prod;
    productViewStartTime = now.getTime();

    const brandLabel = prod.brandName || prod.brandId || 'Bloom Beauty';
    currentSession.brandsExplored = currentSession.brandsExplored || {};
    currentSession.brandsExplored[brandLabel] = (Number(currentSession.brandsExplored[brandLabel]) || 0) + 1;

    let targetEntry = null;
    const existingIdx = currentSession.productsViewed.findIndex(p => String(p.id) === String(prod.id));
    if (existingIdx !== -1) {
      currentSession.productsViewed[existingIdx].viewsCount = (currentSession.productsViewed[existingIdx].viewsCount || 1) + 1;
      currentSession.productsViewed[existingIdx].lastViewedAt = exactNow;
      targetEntry = currentSession.productsViewed.splice(existingIdx, 1)[0];
      currentSession.productsViewed.unshift(targetEntry);
    } else {
      targetEntry = {
        id: prod.id,
        name: prod.name,
        brand: brandLabel,
        price: prod.price,
        image: prod.image,
        firstViewedAt: exactNow,
        lastViewedAt: exactNow,
        viewsCount: 1,
        secondsSpent: 2
      };
      currentSession.productsViewed.unshift(targetEntry);
    }

    logAction('Ver Producto', `${prod.name} (${brandLabel}) a las ${exactNow}`);

    evaluateBehavioralRules('product_view', {
      productEntry: targetEntry,
      productId: prod.id,
      producto: prod.name,
      marca: brandLabel
    });
  }

  // 9. Inicialización de escuchadores automáticos
  function initAutoTracking() {
    loadOrCreateSession();
    fetchRealGeoLocation();

    if (isNewSession || currentSession.actionsHistory.length === 0) {
      logAction('Ingreso a la Tienda', `Inició sesión de exploración a las ${currentSession.entryTime}`);
    }

    if (typeof BloomDB !== 'undefined' && typeof BloomDB.subscribe === 'function') {
      BloomDB.subscribe((msg) => {
        if (msg && (msg.type === 'DIRECT_NOTIFICATION_PUSH' || msg.type === 'NOTIFICATIONS_UPDATED' || msg.type === 'STORAGE_CHANGE')) {
          checkIncomingDirectNotifications();
        }
      });
    }

    const TRACKER_TICK_SECONDS = 5;
    setInterval(() => {
      if (document.hidden) return;
      currentSession.isActiveNow = true;

      if (currentViewingProduct && productViewStartTime > 0) {
        const prodEntry = currentSession.productsViewed.find(p => String(p.id) === String(currentViewingProduct.id));
        if (prodEntry) {
          prodEntry.secondsSpent = (prodEntry.secondsSpent || 0) + TRACKER_TICK_SECONDS;
          evaluateBehavioralRules('product_view', {
            productEntry: prodEntry,
            productId: prodEntry.id,
            producto: prodEntry.name,
            marca: prodEntry.brand
          });
        }
      }

      // Evaluar carrito activo sin finalizar
      try {
        const rawCart = localStorage.getItem('bloom_beauty_cart');
        const cartItems = rawCart ? JSON.parse(rawCart) : [];
        if (Array.isArray(cartItems) && cartItems.length > 0 && lastCartAddTimestamp > 0) {
          const idleSec = Math.round((Date.now() - lastCartAddTimestamp) / 1000);
          evaluateBehavioralRules('cart_idle', {
            idleSeconds: idleSec,
            producto: cartItems[0].name || 'tus productos'
          });
        }
      } catch (e) {}

      persistSession(true);
    }, TRACKER_TICK_SECONDS * 1000);

    window.addEventListener('beforeunload', () => {
      const exitNow = new Date();
      currentSession.isActiveNow = false;
      currentSession.exitTimestamp = exitNow.getTime();
      currentSession.exitTime = formatExactHour(exitNow);
      currentSession.durationSeconds = Math.max(0, Math.round((exitNow.getTime() - currentSession.entryTimestamp) / 1000));
      logAction('Salida de la Tienda', `Finalizó navegación a las ${currentSession.exitTime} (${currentSession.durationSeconds}s)`);
      persistSession(true);
    });

    document.addEventListener('click', (e) => {
      const target = e.target.closest('button, a, .category-pill, .brand-card-item, .product-item-card');
      if (!target) return;

      const text = (target.innerText || target.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 55);

      if (target.classList.contains('category-pill')) {
        logAction('Filtro de Categoría', `Exploró categoría: ${text}`);
      } else if (target.classList.contains('btn-add-cart') || target.classList.contains('btn-card-add-cart')) {
        currentSession.cartInteractions = (currentSession.cartInteractions || 0) + 1;
        lastCartAddTimestamp = Date.now();
        logAction('Agregar al Carrito', `Agregó al carrito a las ${formatExactHour(new Date())}`);
      } else if (target.id === 'floating-whatsapp-btn' || target.classList.contains('btn-whatsapp-direct')) {
        logAction('Contacto WhatsApp', `Abrió chat de atención a las ${formatExactHour(new Date())}`);
      }
    }, { passive: true });

    const searchInput = document.getElementById('global-search-input');
    if (searchInput) {
      let searchTimeout = null;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          const val = e.target.value.trim();
          if (val.length >= 3) {
            logAction('Búsqueda en Catálogo', `Buscó: "${val}"`);
          }
        }, 800);
      });
    }
  }

  window.BloomTracker = {
    trackProductView,
    trackBrandExplore,
    identifyUser,
    clearUser,
    updatePermissions,
    logAction,
    markOrderCompleted: (orderId) => {
      currentSession.ordersPlaced = (currentSession.ordersPlaced || 0) + 1;
      lastCartAddTimestamp = 0;
      logAction('Compra Confirmada', `Pedido ${orderId} confirmado a las ${formatExactHour(new Date())}`);
    },
    stopCurrentProductTimer: () => {
      currentViewingProduct = null;
      productViewStartTime = 0;
    },
    getCurrentSession: () => currentSession,
    getAllSessions: () => {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY_SESSIONS) || '[]');
      } catch (e) {
        return [];
      }
    },
    clearSessions: () => {
      localStorage.removeItem(STORAGE_KEY_SESSIONS);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAutoTracking);
  } else {
    initAutoTracking();
  }
})();
