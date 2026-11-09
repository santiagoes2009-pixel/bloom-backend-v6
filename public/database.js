// ============================================================================
// BLOOM BEAUTY v6 - MOTOR DE DATOS CLOUD-READY & PERSISTENCIA UNIFICADA
// Arquitectura asíncrona preparada para servidor Cloud (REST / Cloud DB) con
// motor transaccional de respaldo y sincronización multi-ventana en tiempo real.
// ============================================================================

const BloomDB = (() => {
  'use strict';

  const DB_NAME = 'BloomBeautyLocalDB';
  const DB_VERSION = 1;
  const STORAGE_KEY = 'bloom_beauty_master_data_v11';
  const ORDERS_KEY = 'bloom_beauty_orders';
  const EXPENSES_KEY = 'bloom_beauty_expenses';
  const REVIEWS_KEY = 'bloom_beauty_reviews';
  const OFFERS_KEY = 'bloom_beauty_offers';
  const CUSTOMERS_KEY = 'bloom_customers_registry_v4';
  const RECHARGES_KEY = 'bloom_recharge_requests_v4';
  const BUGS_KEY = 'bloom_beauty_bugs';
  const SESSIONS_KEY = 'bloom_beauty_real_sessions_v1';
  const TRANSACTIONS_KEY = 'bloom_beauty_transactions_v6';
  const NOTIFICATIONS_KEY = 'bloom_beauty_notifications_v6';
  const CLOUD_CONFIG_KEY = 'bloom_beauty_cloud_config_v6';
  const PING_KEY = 'bloom_beauty_db_ping';
  const CHANNEL_NAME = 'bloom_beauty_db_sync_channel';

  let broadcastChannel = null;
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    try {
      broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
    } catch (e) {
      console.warn('BroadcastChannel no disponible en este entorno:', e);
    }
  }

  const syncCallbacks = [];
  let isIndexedDBReady = false;
  let isPullingFromCloud = false;

  // Inicializar lastPingSeen con el valor actual para evitar disparos falsos al arrancar
  let lastPingSeen = 0;
  try {
    if (typeof localStorage !== 'undefined') {
      lastPingSeen = parseInt(localStorage.getItem(PING_KEY) || '0', 10) || 0;
    }
  } catch (e) {}

  function touchPing() {
    const now = Date.now();
    lastPingSeen = now;
    try {
      localStorage.setItem(PING_KEY, String(now));
    } catch (e) {}
    return now;
  }

  function sanitizeBalance(val) {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'string') {
      const cleaned = val.replace(/[^0-9.-]/g, '').trim();
      val = cleaned === '' ? 0 : Number(cleaned);
    }
    const num = Number(val);
    if (!Number.isFinite(num) || isNaN(num) || num < 0) return 0;
    return Math.min(999999999, Math.round(num));
  }

  function normalizePhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('57')) {
      return digits.slice(2);
    }
    return digits;
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function normalizeBrandId(text) {
    if (!text || typeof text !== 'string') return 'marca-' + Date.now();
    const cleaned = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return cleaned || ('marca-' + Date.now());
  }

  function getLocalDayKey(d = new Date()) {
    const dateObj = (d instanceof Date && !isNaN(d.getTime())) ? d : new Date(d || Date.now());
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatExactTime(d = new Date()) {
    const dateObj = (d instanceof Date && !isNaN(d.getTime())) ? d : new Date(d || Date.now());
    return dateObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function formatDateShort(d = new Date()) {
    const dateObj = (d instanceof Date && !isNaN(d.getTime())) ? d : new Date(d || Date.now());
    return dateObj.toLocaleDateString('es-CO') + ' ' + dateObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // Hash criptográfico compatible con HTTPS y protocolo local
  async function hashPasswordSecure(plainPassword) {
    const salted = `bloom_v6_cloud_salt::${String(plainPassword || '')}`;
    try {
      if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle && typeof TextEncoder !== 'undefined') {
        const msgBuffer = new TextEncoder().encode(salted);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return 'sha256$' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) {}

    // Fallback determinístico si WebCrypto no está disponible en contexto local
    let h1 = 0xdeadbeef ^ salted.length;
    let h2 = 0x41c6ce57 ^ salted.length;
    for (let i = 0, ch; i < salted.length; i++) {
      ch = salted.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 'fallback$' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }

  async function verifyCustomerPassword(customerRecord, plainPassword) {
    if (!customerRecord || !plainPassword) return false;
    const candidateHash = await hashPasswordSecure(plainPassword);
    if (customerRecord.passwordHash && customerRecord.passwordHash === candidateHash) {
      return true;
    }
    // Compatibilidad retroactiva con cuentas registradas en versiones previas
    if (typeof customerRecord.password === 'string' && customerRecord.password.length > 0) {
      return customerRecord.password === plainPassword;
    }
    return false;
  }

  function sanitizeCustomerPublicProfile(cust) {
    if (!cust) return null;
    return {
      id: cust.id,
      username: cust.username || cust.name || 'Cliente',
      name: cust.name || cust.username || 'Cliente',
      phone: cust.phone || '',
      email: cust.email || '',
      city: cust.city || '',
      department: cust.department || '',
      address: cust.address || '',
      balance: sanitizeBalance(cust.balance),
      createdAt: cust.createdAt || '',
      dateFormatted: cust.dateFormatted || '',
      lastLoginAt: cust.lastLoginAt || ''
    };
  }

  // --------------------------------------------------------------------------
  // 0. CONFIGURACIÓN Y CAPA DE TRANSPORTE CLOUD-READY (BACKEND API ADAPTER)
  // --------------------------------------------------------------------------
  function getCloudConfig() {
    const defaults = {
      enabled: true,
      endpointUrl: 'https://bloom-backend-v6.onrender.com',
      apiKey: '',
      environment: 'cloud-hybrid-v6',
      timeoutMs: 45000
    };
    try {
      const raw = localStorage.getItem(CLOUD_CONFIG_KEY);
      if (raw) {
        return Object.assign({}, defaults, JSON.parse(raw));
      }
    } catch (e) {}
    return defaults;
  }

  function saveCloudConfig(cfg = {}) {
    const next = Object.assign({}, getCloudConfig(), {
      enabled: Boolean(cfg.enabled && cfg.endpointUrl),
      endpointUrl: String(cfg.endpointUrl || '').trim().replace(/\/+$/, ''),
      apiKey: String(cfg.apiKey || '').trim(),
      updatedAt: new Date().toISOString()
    });
    try {
      localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(next));
      touchPing();
    } catch (e) {}
    broadcast({ type: 'CLOUD_CONFIG_UPDATED', config: next, timestamp: Date.now() });
    return next;
  }

  async function executeCloudOperation(route, method, payload, serverEngineHandler) {
    const cfg = getCloudConfig();
    if (cfg.enabled && cfg.endpointUrl && typeof fetch === 'function') {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), cfg.timeoutMs || 45000) : null;
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
        const res = await fetch(`${cfg.endpointUrl}${route}`, {
          method: method || 'POST',
          headers,
          body: method === 'GET' ? undefined : JSON.stringify(payload || {}),
          signal: controller ? controller.signal : undefined
        });
        if (timer) clearTimeout(timer);
        if (res.ok) {
          const remoteJson = await res.json();
          if (remoteJson && remoteJson.database) {
            isPullingFromCloud = true;
            try {
              importDatabaseJSON(JSON.stringify({ database: remoteJson.database }));
            } finally {
              isPullingFromCloud = false;
            }
          }
          // Sincronizar de inmediato entidades devueltas por la nube en el almacenamiento local
          if (remoteJson && remoteJson.user) {
            try {
              const currentList = getCustomers();
              const idx = currentList.findIndex(c => String(c.id) === String(remoteJson.user.id));
              if (idx !== -1) {
                currentList[idx] = Object.assign({}, currentList[idx], remoteJson.user);
              } else {
                currentList.unshift(remoteJson.user);
              }
              saveCustomers(currentList);
            } catch (uErr) {}
          }
          if (remoteJson && remoteJson.order) {
            try {
              saveOrder(remoteJson.order);
              const targetCustId = remoteJson.order.customer_id || remoteJson.order.customerId;
              if (typeof remoteJson.newBalance === 'number' && targetCustId) {
                const list = getCustomers();
                const cIdx = list.findIndex(c => String(c.id) === String(targetCustId));
                if (cIdx !== -1) {
                  list[cIdx].balance = sanitizeBalance(remoteJson.newBalance);
                  saveCustomers(list);
                }
              }
            } catch (oErr) {}
          }
          if (remoteJson && remoteJson.recharge) {
            try {
              const reqs = getRechargeRequests();
              const rIdx = reqs.findIndex(r => String(r.id) === String(remoteJson.recharge.id));
              if (rIdx !== -1) {
                reqs[rIdx] = Object.assign({}, reqs[rIdx], remoteJson.recharge);
              } else {
                reqs.unshift(remoteJson.recharge);
              }
              saveRechargeRequests(reqs);
            } catch (rErr) {}
          }
          return remoteJson;
        }
        const errBody = await res.json().catch(() => ({}));
        if (errBody && errBody.message) {
          return Object.assign({ success: false }, errBody);
        }
      } catch (cloudErr) {
        if (timer) clearTimeout(timer);
        console.warn(`[BloomCloud] Endpoint remoto no disponible (${route}), operando en motor transaccional integrado:`, cloudErr);
      }
    }
    // Motor de servidor integrado asíncrono (ninguna validación queda en UI/cliente)
    return await serverEngineHandler(payload || {});
  }

  // --------------------------------------------------------------------------
  // 1. GESTIÓN DE INDEXEDDB (ALMACENAMIENTO PERMANENTE DEL NAVEGADOR)
  // --------------------------------------------------------------------------
  function openDatabase() {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !('indexedDB' in window)) {
        return resolve(null);
      }
      try {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('store')) {
            db.createObjectStore('store', { keyPath: 'key' });
          }
        };
        request.onsuccess = (event) => {
          isIndexedDBReady = true;
          resolve(event.target.result);
        };
        request.onerror = () => {
          resolve(null);
        };
      } catch (err) {
        resolve(null);
      }
    });
  }

  async function idbSet(key, val) {
    try {
      const db = await openDatabase();
      if (!db) return false;
      return new Promise((resolve) => {
        const tx = db.transaction('store', 'readwrite');
        const store = tx.objectStore('store');
        store.put({ key, val, updatedAt: Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) {
      return false;
    }
  }

  async function idbGet(key) {
    try {
      const db = await openDatabase();
      if (!db) return null;
      return new Promise((resolve) => {
        const tx = db.transaction('store', 'readonly');
        const store = tx.objectStore('store');
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.val : null);
        req.onerror = () => resolve(null);
      });
    } catch (e) {
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // 2. RECUPERACIÓN Y PERSISTENCIA DE DATOS MAESTROS (TIENDA, MARCAS, PRODUCTOS)
  // --------------------------------------------------------------------------
  function getMasterData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = (JSON.parse(raw)) ?? {};
        const defaultInfo = (typeof DEFAULT_SITE_DATA !== 'undefined' && DEFAULT_SITE_DATA?.storeInfo) ? DEFAULT_SITE_DATA.storeInfo : {};
        const defaultBrands = (typeof DEFAULT_SITE_DATA !== 'undefined' && Array.isArray(DEFAULT_SITE_DATA?.brands)) ? DEFAULT_SITE_DATA.brands : [];
        const defaultProds = (typeof DEFAULT_SITE_DATA !== 'undefined' && Array.isArray(DEFAULT_SITE_DATA?.products)) ? DEFAULT_SITE_DATA.products : [];

        const storeInfo = Object.assign({}, defaultInfo, parsed.storeInfo ?? {});
        const brands = (Array.isArray(parsed.brands) && parsed.brands.length > 0) ? parsed.brands : defaultBrands;
        const products = (Array.isArray(parsed.products) && parsed.products.length > 0) ? parsed.products : defaultProds;

        return {
          storeInfo: storeInfo ?? {},
          brands: Array.isArray(brands) ? brands : [],
          products: Array.isArray(products) ? products : [],
          version: parsed.version ?? 1,
          updatedAt: parsed.updatedAt ?? Date.now()
        };
      }
    } catch (e) {
      console.warn('[BloomDB] Error leyendo almacenamiento maestro, cargando valores predeterminados:', e);
    }

    if (typeof DEFAULT_SITE_DATA !== 'undefined') {
      const now = Date.now();
      const initial = {
        storeInfo: JSON.parse(JSON.stringify(DEFAULT_SITE_DATA.storeInfo ?? {})),
        brands: JSON.parse(JSON.stringify(DEFAULT_SITE_DATA.brands ?? [])),
        products: JSON.parse(JSON.stringify(DEFAULT_SITE_DATA.products ?? [])),
        version: 1,
        updatedAt: now
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
        touchPing();
      } catch (err) {}
      idbSet('masterData', initial);
      return initial;
    }

    return { storeInfo: {}, brands: [], products: [], version: 1, updatedAt: Date.now() };
  }

  function saveMasterData(data, notify = true) {
    if (!data) return;

    const now = touchPing();
    const payload = {
      storeInfo: data.storeInfo || {},
      brands: Array.isArray(data.brands) ? data.brands : [],
      products: Array.isArray(data.products) ? data.products : [],
      version: (data.version || 1) + 1,
      updatedAt: now
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.error('[BloomDB] Error escribiendo datos maestros:', e);
    }

    idbSet('masterData', payload);

    if (notify) {
      broadcast({
        type: 'MASTER_DATA_UPDATED',
        timestamp: payload.updatedAt
      });
    }

    return payload;
  }

  // --------------------------------------------------------------------------
  // 3. BUS DE SINCRONIZACIÓN EN TIEMPO REAL (MULTI-PESTAÑA / MULTI-VENTANA)
  // --------------------------------------------------------------------------
  let cloudPushTimer = null;

  function scheduleCloudAutoPush(reasonType) {
    if (isPullingFromCloud) return;
    if (reasonType === 'CLOUD_CONFIG_UPDATED' || reasonType === 'CLOUD_SNAPSHOT_PULLED') return;
    const cfg = getCloudConfig();
    if (!cfg.enabled || !cfg.endpointUrl || typeof fetch !== 'function') return;
    if (cloudPushTimer) clearTimeout(cloudPushTimer);
    cloudPushTimer = setTimeout(() => {
      if (cloudServices && typeof cloudServices.pushSnapshot === 'function') {
        cloudServices.pushSnapshot(true).catch(() => {});
      }
    }, 450);
  }

  function broadcast(msg) {
    if (broadcastChannel) {
      try {
        broadcastChannel.postMessage(msg);
      } catch (e) {}
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bloom:db-sync', { detail: msg }));
    }
    if (msg && msg.type) {
      scheduleCloudAutoPush(msg.type);
    }
  }

  if (broadcastChannel) {
    broadcastChannel.onmessage = (event) => {
      const msg = event.data;
      if (msg && msg.type) {
        dispatchSync(msg);
      }
    };
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (!e.key) return;
      const watchedKeys = [
        STORAGE_KEY,
        PING_KEY,
        ORDERS_KEY,
        EXPENSES_KEY,
        CUSTOMERS_KEY,
        RECHARGES_KEY,
        OFFERS_KEY,
        REVIEWS_KEY,
        BUGS_KEY,
        SESSIONS_KEY,
        TRANSACTIONS_KEY,
        NOTIFICATIONS_KEY
      ];
      if (watchedKeys.includes(e.key)) {
        if (e.key === PING_KEY && e.newValue) {
          const parsedPing = parseInt(e.newValue, 10);
          if (parsedPing > lastPingSeen) lastPingSeen = parsedPing;
        }
        dispatchSync({
          type: 'STORAGE_CHANGE',
          key: e.key,
          timestamp: Date.now()
        });
      }
    });

    window.addEventListener('bloom:db-sync', (e) => {
      dispatchSync(e.detail);
    });
  }

  let isDispatchingSync = false;
  function dispatchSync(msg) {
    if (isDispatchingSync) return;
    isDispatchingSync = true;
    try {
      syncCallbacks.forEach((fn) => {
        try {
          fn(msg);
        } catch (err) {
          console.error('[BloomDB] Error en callback de sincronización:', err);
        }
      });
    } finally {
      isDispatchingSync = false;
    }
  }

  if (typeof window !== 'undefined') {
    setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const ping = localStorage.getItem(PING_KEY);
        if (ping) {
          const t = parseInt(ping, 10);
          if (t > lastPingSeen) {
            lastPingSeen = t;
            dispatchSync({ type: 'HEARTBEAT_SYNC', timestamp: t });
          }
        }
      } catch (e) {}
    }, 1200);
  }

  // --------------------------------------------------------------------------
  // GESTIÓN DE CUOTA DE ALMACENAMIENTO (PREVENCIÓN DE QUOTAEXCEEDEDERROR)
  // --------------------------------------------------------------------------
  function purgeStorageQuota() {
    try {
      if (typeof localStorage === 'undefined') return;
      const now = Date.now();
      const MAX_TELEMETRY_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 días
      const MAX_TELEMETRY_COUNT = 150;

      [SESSIONS_KEY, 'bloom_telemetry_sessions_v1'].forEach((telKey) => {
        const rawTel = localStorage.getItem(telKey);
        if (rawTel) {
          try {
            const list = JSON.parse(rawTel);
            if (Array.isArray(list)) {
              const purged = list
                .filter(s => (now - (Number(s.entryTimestamp) || 0)) < MAX_TELEMETRY_AGE_MS)
                .slice(0, MAX_TELEMETRY_COUNT);
              localStorage.setItem(telKey, JSON.stringify(purged));
            }
          } catch (e) {}
        }
      });

      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith('bb_presence_')) {
          try {
            const item = JSON.parse(localStorage.getItem(key) || '{}');
            if (now - (Number(item.timestamp) || 0) > 3600000) {
              localStorage.removeItem(key);
            }
          } catch (e) {
            localStorage.removeItem(key);
          }
        }
      }
    } catch (e) {}
  }

  purgeStorageQuota();

  // --------------------------------------------------------------------------
  // 3.5 LIBRO MAYOR GLOBAL DE TRANSACCIONES (RECARGAS Y COMPRAS CON HORA EXACTA)
  // --------------------------------------------------------------------------
  function getRawTransactions() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TRANSACTIONS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveRawTransactions(list) {
    const arr = (Array.isArray(list) ? list : []).slice(0, 500);
    try {
      localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(arr));
      touchPing();
    } catch (e) {}
    idbSet('transactions', arr);
    broadcast({ type: 'TRANSACTIONS_UPDATED', timestamp: Date.now() });
    return arr;
  }

  function recordGlobalTransaction(entry = {}) {
    const now = entry.date ? new Date(entry.date) : new Date();
    const tx = {
      id: entry.id || ('GTX-' + Date.now() + '-' + Math.floor(100 + Math.random() * 900)),
      category: entry.category || 'compra', // 'compra' | 'recarga' | 'ajuste'
      referenceId: entry.referenceId || '', // orderId o rechargeId
      customerId: entry.customerId || '',
      customerName: String(entry.customerName || 'Cliente').trim(),
      customerPhone: String(entry.customerPhone || '').trim(),
      customerEmail: normalizeEmail(entry.customerEmail || ''),
      customerCity: String(entry.customerCity || '').trim(),
      customerDepartment: String(entry.customerDepartment || '').trim(),
      customerAddress: String(entry.customerAddress || '').trim(),
      amount: Math.round(Number(entry.amount) || 0),
      paymentMethod: String(entry.paymentMethod || 'Tu Saldo').trim(),
      items: Array.isArray(entry.items) ? entry.items : [],
      status: String(entry.status || 'Completado').trim(),
      source: String(entry.source || 'tienda').trim(),
      note: String(entry.note || '').trim(),
      exactTime: entry.exactTime || formatExactTime(now),
      dateFormatted: entry.dateFormatted || formatDateShort(now),
      dayKey: entry.dayKey || getLocalDayKey(now),
      timestamp: Number(entry.timestamp) || now.getTime()
    };

    const list = getRawTransactions();
    const existingIdx = tx.referenceId
      ? list.findIndex(item => item.referenceId === tx.referenceId && item.category === tx.category)
      : -1;

    if (existingIdx !== -1) {
      list[existingIdx] = Object.assign({}, list[existingIdx], tx);
    } else {
      list.unshift(tx);
    }
    saveRawTransactions(list);
    return tx;
  }

  function getUnifiedTransactions() {
    const raw = getRawTransactions();
    const mapByRef = new Map();
    const result = [];

    raw.forEach((tx) => {
      if (tx.referenceId) mapByRef.set(`${tx.category}:${tx.referenceId}`, tx);
      result.push(tx);
    });

    // Incorporar órdenes previas si aún no estaban en el libro mayor
    const orders = getOrders();
    orders.forEach((o) => {
      const key = `compra:${o.id}`;
      if (!mapByRef.has(key)) {
        const d = o.date ? new Date(o.date) : new Date();
        result.push({
          id: 'GTX-ORD-' + o.id,
          category: 'compra',
          referenceId: o.id,
          customerId: o.customerId || '',
          customerName: o.customerName || 'Cliente',
          customerPhone: o.customerPhone || '',
          customerEmail: o.customerEmail || '',
          customerCity: o.customerCity || '',
          customerDepartment: o.customerDepartment || '',
          customerAddress: o.customerAddress || '',
          amount: sanitizeBalance(o.total),
          paymentMethod: o.paymentMethod || 'Tu Saldo',
          items: Array.isArray(o.items) ? o.items : [],
          status: o.status || 'Por Despachar',
          source: o.source || 'tienda',
          note: o.notes || '',
          exactTime: o.exactTime || formatExactTime(d),
          dateFormatted: o.dateFormatted || formatDateShort(d),
          dayKey: o.dayKey || getLocalDayKey(d),
          timestamp: d.getTime() || Date.now()
        });
      } else {
        const linked = mapByRef.get(key);
        if (linked && o.status) linked.status = o.status;
      }
    });

    // Incorporar recargas aprobadas o pendientes previas
    const recharges = getRechargeRequests();
    recharges.forEach((r) => {
      const key = `recarga:${r.id}`;
      if (!mapByRef.has(key)) {
        const d = r.createdAt ? new Date(r.createdAt) : new Date();
        result.push({
          id: 'GTX-REC-' + r.id,
          category: 'recarga',
          referenceId: r.id,
          customerId: r.customerId || '',
          customerName: r.customerName || 'Cliente',
          customerPhone: r.customerPhone || '',
          customerEmail: r.customerEmail || '',
          customerCity: '',
          customerDepartment: '',
          customerAddress: '',
          amount: sanitizeBalance(r.amount),
          paymentMethod: r.paymentMethod || 'Transferencia',
          items: [],
          status: r.status || 'Pendiente',
          source: 'recarga_web',
          note: r.reference ? `Ref: ${r.reference}` : (r.userNote || ''),
          exactTime: r.exactTime || formatExactTime(d),
          dateFormatted: r.dateFormatted || formatDateShort(d),
          dayKey: r.dayKey || getLocalDayKey(d),
          timestamp: d.getTime() || Date.now()
        });
      } else {
        const linked = mapByRef.get(key);
        if (linked && r.status) linked.status = r.status;
      }
    });

    return result.sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
  }

  // --------------------------------------------------------------------------
  // 4. GESTIÓN DE VENTAS (ORDERS), GESTIÓN MANUAL Y EGRESOS (EXPENSES)
  // --------------------------------------------------------------------------
  function getOrders() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveOrders(ordersList) {
    const list = Array.isArray(ordersList) ? ordersList : [];
    try {
      localStorage.setItem(ORDERS_KEY, JSON.stringify(list));
      touchPing();
    } catch (e) {}
    idbSet('orders', list);
    broadcast({ type: 'ORDERS_UPDATED', orders: list, timestamp: Date.now() });
    return list;
  }

  function saveOrder(order) {
    if (!order) return null;
    const now = order.date ? new Date(order.date) : new Date();
    const enrichedOrder = Object.assign({
      id: 'BB-' + Date.now().toString().slice(-6),
      date: now.toISOString(),
      exactTime: formatExactTime(now),
      dateFormatted: formatDateShort(now),
      dayKey: getLocalDayKey(now),
      customerDepartment: '',
      customerCity: '',
      customerAddress: '',
      source: 'tienda',
      status: 'Por Despachar'
    }, order);

    if (!enrichedOrder.exactTime) enrichedOrder.exactTime = formatExactTime(now);
    if (!enrichedOrder.dayKey) enrichedOrder.dayKey = getLocalDayKey(now);
    if (!enrichedOrder.dateFormatted) enrichedOrder.dateFormatted = formatDateShort(now);

    const orders = getOrders();
    const existingIdx = enrichedOrder.id ? orders.findIndex(o => String(o.id) === String(enrichedOrder.id)) : -1;
    if (existingIdx !== -1) {
      orders[existingIdx] = Object.assign({}, orders[existingIdx], enrichedOrder);
    } else {
      orders.unshift(enrichedOrder);
    }
    saveOrders(orders);

    recordGlobalTransaction({
      category: 'compra',
      referenceId: enrichedOrder.id,
      customerId: enrichedOrder.customerId || '',
      customerName: enrichedOrder.customerName || 'Cliente',
      customerPhone: enrichedOrder.customerPhone || '',
      customerEmail: enrichedOrder.customerEmail || '',
      customerCity: enrichedOrder.customerCity || '',
      customerDepartment: enrichedOrder.customerDepartment || '',
      customerAddress: enrichedOrder.customerAddress || '',
      amount: sanitizeBalance(enrichedOrder.total),
      paymentMethod: enrichedOrder.paymentMethod || 'Tu Saldo',
      items: enrichedOrder.items || [],
      status: enrichedOrder.status || 'Por Despachar',
      source: enrichedOrder.source || 'tienda',
      note: enrichedOrder.notes || '',
      exactTime: enrichedOrder.exactTime,
      dateFormatted: enrichedOrder.dateFormatted,
      dayKey: enrichedOrder.dayKey,
      timestamp: now.getTime()
    });

    broadcast({ type: 'NEW_ORDER_PLACED', order: enrichedOrder, timestamp: Date.now() });
    return enrichedOrder;
  }

  function updateOrderStatus(orderId, newStatus, adminNote = '') {
    const orders = getOrders();
    const idx = orders.findIndex(o => String(o.id) === String(orderId));
    if (idx === -1) return null;

    const now = new Date();
    orders[idx].status = newStatus;
    orders[idx].updatedAt = now.toISOString();
    orders[idx].statusUpdatedTime = formatExactTime(now);
    if (newStatus === 'Confirmado') orders[idx].confirmedAt = formatDateShort(now);
    if (newStatus === 'Despachado') orders[idx].dispatchedAt = formatDateShort(now);
    if (adminNote) orders[idx].adminNote = adminNote;

    saveOrders(orders);

    const rawTx = getRawTransactions();
    const txIdx = rawTx.findIndex(t => t.referenceId === String(orderId) && t.category === 'compra');
    if (txIdx !== -1) {
      rawTx[txIdx].status = newStatus;
      saveRawTransactions(rawTx);
    }

    return orders[idx];
  }

  function createManualOrder(payload = {}) {
    const items = Array.isArray(payload.items) ? payload.items.filter(i => i && Number(i.quantity) > 0) : [];
    if (items.length === 0) {
      return { success: false, message: 'Selecciona al menos un producto válido para el pedido manual.' };
    }

    const total = items.reduce((acc, it) => acc + (sanitizeBalance(it.price) * Math.max(1, Number(it.quantity) || 1)), 0);
    const orderId = 'BB-MAN-' + Date.now().toString().slice(-6);
    const deductFromWallet = Boolean(payload.deductBalance && payload.customerId);

    if (deductFromWallet) {
      const deductRes = deductCustomerBalance(
        payload.customerId,
        total,
        orderId,
        `Pedido manual registrado (${orderId})`
      );
      if (!deductRes || !deductRes.success) {
        return {
          success: false,
          message: (deductRes && deductRes.message) ? deductRes.message : 'Saldo insuficiente en la cuenta del cliente.'
        };
      }
    }

    const now = new Date();
    const manualOrder = saveOrder({
      id: orderId,
      date: now.toISOString(),
      exactTime: formatExactTime(now),
      dateFormatted: formatDateShort(now),
      dayKey: getLocalDayKey(now),
      customerId: payload.customerId || '',
      customerName: String(payload.customerName || 'Cliente Directo').trim(),
      customerPhone: String(payload.customerPhone || '').trim(),
      customerEmail: normalizeEmail(payload.customerEmail || ''),
      customerCity: String(payload.customerCity || '').trim(),
      customerDepartment: String(payload.customerDepartment || '').trim(),
      customerAddress: String(payload.customerAddress || 'Registro directo').trim(),
      notes: String(payload.notes || 'Pedido registrado manualmente').trim(),
      paymentMethod: deductFromWallet ? 'Tu Saldo (Descuento Manual)' : String(payload.paymentMethod || 'Pago Directo / Transferencia').trim(),
      items: items.map(it => ({
        id: it.id || '',
        name: it.name || 'Producto',
        brand: it.brand || '',
        price: sanitizeBalance(it.price),
        quantity: Math.max(1, Number(it.quantity) || 1)
      })),
      total,
      source: 'manual_admin',
      status: payload.status || 'Confirmado'
    });

    return { success: true, order: manualOrder };
  }

  function deleteOrder(orderId) {
    let orders = getOrders();
    orders = orders.filter(o => String(o.id) !== String(orderId));
    saveOrders(orders);
    return orders;
  }

  function getExpenses() {
    try {
      const parsed = JSON.parse(localStorage.getItem(EXPENSES_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveExpenses(expensesList) {
    const list = Array.isArray(expensesList) ? expensesList : [];
    try {
      localStorage.setItem(EXPENSES_KEY, JSON.stringify(list));
      touchPing();
    } catch (e) {}
    idbSet('expenses', list);
    broadcast({ type: 'EXPENSES_UPDATED', expenses: list, timestamp: Date.now() });
    return list;
  }

  // --------------------------------------------------------------------------
  // 5. OPERACIONES ATÓMICAS DE CATÁLOGO (PRODUCTOS Y MARCAS)
  // --------------------------------------------------------------------------
  function updateProduct(prodId, updates) {
    const data = getMasterData();
    const prod = data.products.find(p => String(p.id) === String(prodId));
    if (!prod) return null;

    Object.assign(prod, updates);
    saveMasterData(data);
    return prod;
  }

  function toggleProduct(prodId) {
    const data = getMasterData();
    const prod = data.products.find(p => String(p.id) === String(prodId));
    if (!prod) return null;

    prod.active = (prod.active === false ? true : false);
    saveMasterData(data);
    return prod;
  }

  function updatePrice(prodId, newPrice, newOldPrice = null) {
    const realPrice = Math.max(0, Number(newPrice) || 0);
    let calculatedOldPrice = newOldPrice ? Number(newOldPrice) : null;

    if (!calculatedOldPrice || calculatedOldPrice <= realPrice) {
      const randomDiscountPct = Math.floor(Math.random() * (25 - 12 + 1)) + 12;
      const rawOld = realPrice / (1 - (randomDiscountPct / 100));
      calculatedOldPrice = Math.round(rawOld / 1000) * 1000;
      if (calculatedOldPrice <= realPrice) {
        calculatedOldPrice = realPrice + 10000;
      }
    }

    return updateProduct(prodId, {
      price: realPrice,
      oldPrice: calculatedOldPrice
    });
  }

  function toggleBrand(brandId) {
    const data = getMasterData();
    const brand = data.brands.find(b => String(b.id) === String(brandId));
    if (!brand) return null;

    brand.active = (brand.active === false ? true : false);
    saveMasterData(data);
    return brand;
  }

  // --------------------------------------------------------------------------
  // 5.1 GESTIÓN DE USUARIOS, "TU SALDO" Y SOLICITUDES DE RECARGA
  // --------------------------------------------------------------------------
  function getCustomers() {
    try {
      const raw = localStorage.getItem(CUSTOMERS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.map(c => Object.assign({}, c, {
            username: c.username || c.name || 'Cliente',
            department: c.department || '',
            city: c.city || '',
            balance: sanitizeBalance(c.balance),
            transactions: Array.isArray(c.transactions) ? c.transactions : []
          }));
        }
      }
    } catch (e) {}
    return [];
  }

  function getCustomerById(custId) {
    if (!custId) return null;
    const list = getCustomers();
    return list.find(c => String(c.id) === String(custId)) || null;
  }

  function saveCustomers(list) {
    const arr = (Array.isArray(list) ? list : []).map(c => Object.assign({}, c, {
      balance: sanitizeBalance(c.balance),
      transactions: Array.isArray(c.transactions) ? c.transactions.slice(0, 40) : []
    }));
    try {
      localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(arr));
      touchPing();
    } catch (e) {}
    idbSet('customers', arr);
    broadcast({ type: 'CUSTOMERS_UPDATED', customers: arr, timestamp: Date.now() });
    return arr;
  }

  function checkCustomerUniqueness(email, phone, excludeCustomerId = null) {
    const list = getCustomers();
    const cleanEmail = normalizeEmail(email);
    const normPhone = normalizePhone(phone);

    for (const u of list) {
      if (excludeCustomerId && String(u.id) === String(excludeCustomerId)) continue;
      if (cleanEmail && normalizeEmail(u.email) === cleanEmail) {
        return {
          unique: false,
          code: 'DUPLICATE_EMAIL',
          field: 'email',
          message: 'Ya existe un usuario registrado con este correo electrónico.'
        };
      }
      if (normPhone && normPhone.length >= 7 && normalizePhone(u.phone) === normPhone) {
        return {
          unique: false,
          code: 'DUPLICATE_PHONE',
          field: 'phone',
          message: 'Ya existe un usuario registrado con este número de WhatsApp / Teléfono.'
        };
      }
    }

    return { unique: true };
  }

  function addCustomer(cust) {
    const list = getCustomers();
    const cleanEmail = normalizeEmail(cust.email);
    const cleanPhone = String(cust.phone || '').trim();

    const uniqueness = checkCustomerUniqueness(cleanEmail, cleanPhone);
    if (!uniqueness.unique) {
      return {
        error: uniqueness.code || 'DUPLICATE_CUSTOMER',
        field: uniqueness.field,
        message: uniqueness.message
      };
    }

    const now = new Date();
    const initialBalance = sanitizeBalance(cust.balance || 0);
    const cleanName = String(cust.username || cust.name || 'Cliente').trim();

    const newCust = {
      id: cust.id || ('CUST-' + Date.now() + '-' + Math.floor(100 + Math.random() * 900)),
      username: cleanName,
      name: cleanName,
      phone: cleanPhone,
      email: cleanEmail,
      city: String(cust.city || '').trim(),
      department: String(cust.department || '').trim(),
      address: String(cust.address || '').trim(),
      passwordHash: cust.passwordHash || '',
      password: cust.passwordHash ? '' : String(cust.password || ''),
      balance: initialBalance,
      transactions: initialBalance > 0 ? [{
        id: 'TX-' + Date.now(),
        type: 'recharge',
        amount: initialBalance,
        previousBalance: 0,
        newBalance: initialBalance,
        note: 'Saldo inicial asignado',
        exactTime: formatExactTime(now),
        dateFormatted: formatDateShort(now)
      }] : [],
      createdAt: cust.createdAt || now.toISOString(),
      exactTime: formatExactTime(now),
      dayKey: getLocalDayKey(now),
      dateFormatted: cust.dateFormatted || formatDateShort(now)
    };
    list.unshift(newCust);
    saveCustomers(list);
    return newCust;
  }

  function updateCustomerInfo(custId, updates = {}) {
    const list = getCustomers();
    const idx = list.findIndex(c => String(c.id) === String(custId));
    if (idx === -1) return null;

    if (updates.email || updates.phone) {
      const check = checkCustomerUniqueness(
        updates.email || list[idx].email,
        updates.phone || list[idx].phone,
        custId
      );
      if (!check.unique) {
        return { error: check.code, message: check.message };
      }
    }

    const allowed = ['name', 'username', 'phone', 'email', 'city', 'department', 'address'];
    allowed.forEach((field) => {
      if (typeof updates[field] === 'string' && updates[field].trim()) {
        list[idx][field] = field === 'email' ? normalizeEmail(updates[field]) : updates[field].trim();
      }
    });
    if (updates.name && !updates.username) list[idx].username = list[idx].name;
    if (updates.username && !updates.name) list[idx].name = list[idx].username;

    saveCustomers(list);
    return list[idx];
  }

  function updateCustomerBalance(custId, newBalance, note = 'Saldo actualizado') {
    const list = getCustomers();
    const idx = list.findIndex(c => String(c.id) === String(custId));
    if (idx === -1) return null;

    const now = new Date();
    const prev = sanitizeBalance(list[idx].balance);
    const next = sanitizeBalance(newBalance);
    const delta = next - prev;

    list[idx].balance = next;
    list[idx].transactions = Array.isArray(list[idx].transactions) ? list[idx].transactions : [];
    const txId = 'TX-' + Date.now() + '-' + Math.floor(10 + Math.random() * 89);

    if (delta !== 0 || list[idx].transactions.length === 0) {
      list[idx].transactions.unshift({
        id: txId,
        type: delta >= 0 ? 'recharge' : 'adjustment',
        amount: delta,
        previousBalance: prev,
        newBalance: next,
        note: note,
        exactTime: formatExactTime(now),
        dateFormatted: formatDateShort(now)
      });

      if (delta !== 0) {
        recordGlobalTransaction({
          id: 'GTX-' + txId,
          category: delta > 0 ? 'recarga' : 'ajuste',
          referenceId: txId,
          customerId: list[idx].id,
          customerName: list[idx].name,
          customerPhone: list[idx].phone,
          customerEmail: list[idx].email,
          customerCity: list[idx].city || '',
          customerDepartment: list[idx].department || '',
          amount: Math.abs(delta),
          paymentMethod: delta > 0 ? 'Abono Directo de Saldo' : 'Ajuste Administrativo',
          status: 'Aprobada',
          source: 'gestion_saldo',
          note: note,
          exactTime: formatExactTime(now),
          dateFormatted: formatDateShort(now),
          dayKey: getLocalDayKey(now),
          timestamp: now.getTime()
        });
      }
    }

    saveCustomers(list);
    return list[idx];
  }

  function adjustCustomerBalance(custId, deltaAmount, note = 'Recarga aplicada a Tu Saldo', skipGlobalTx = false) {
    const list = getCustomers();
    const idx = list.findIndex(c => String(c.id) === String(custId));
    if (idx === -1) return null;

    const now = new Date();
    const prev = sanitizeBalance(list[idx].balance);
    const rawDelta = Math.round(Number(deltaAmount) || 0);
    const next = sanitizeBalance(prev + rawDelta);
    const effectiveDelta = next - prev;
    const txId = 'TX-' + Date.now() + '-' + Math.floor(10 + Math.random() * 89);

    list[idx].balance = next;
    list[idx].transactions = Array.isArray(list[idx].transactions) ? list[idx].transactions : [];
    list[idx].transactions.unshift({
      id: txId,
      type: effectiveDelta >= 0 ? 'recharge' : 'adjustment',
      amount: effectiveDelta,
      previousBalance: prev,
      newBalance: next,
      note: note,
      exactTime: formatExactTime(now),
      dateFormatted: formatDateShort(now)
    });

    if (!skipGlobalTx && effectiveDelta !== 0) {
      recordGlobalTransaction({
        id: 'GTX-' + txId,
        category: effectiveDelta > 0 ? 'recarga' : 'ajuste',
        referenceId: txId,
        customerId: list[idx].id,
        customerName: list[idx].name,
        customerPhone: list[idx].phone,
        customerEmail: list[idx].email,
        customerCity: list[idx].city || '',
        customerDepartment: list[idx].department || '',
        amount: Math.abs(effectiveDelta),
        paymentMethod: effectiveDelta > 0 ? 'Recarga de Saldo' : 'Ajuste de Saldo',
        status: 'Aprobada',
        source: 'gestion_saldo',
        note: note,
        exactTime: formatExactTime(now),
        dateFormatted: formatDateShort(now),
        dayKey: getLocalDayKey(now),
        timestamp: now.getTime()
      });
    }

    saveCustomers(list);
    return list[idx];
  }

  function deductCustomerBalance(custId, amountToDeduct, orderId = '', note = '') {
    const list = getCustomers();
    const idx = list.findIndex(c => String(c.id) === String(custId));
    if (idx === -1) {
      return {
        success: false,
        code: 'USER_NOT_FOUND',
        message: 'Tu sesión expiró o el usuario no existe. Por favor inicia sesión nuevamente.'
      };
    }

    const cost = sanitizeBalance(amountToDeduct);
    if (cost <= 0) {
      return {
        success: false,
        code: 'INVALID_AMOUNT',
        message: 'El monto del pedido debe ser un valor positivo.'
      };
    }

    const prev = sanitizeBalance(list[idx].balance);

    if (prev < cost) {
      return {
        success: false,
        code: 'INSUFFICIENT_BALANCE',
        currentBalance: prev,
        needed: cost - prev,
        message: 'Tu Saldo disponible es insuficiente para completar este pedido.'
      };
    }

    const now = new Date();
    const next = sanitizeBalance(prev - cost);
    list[idx].balance = next;
    list[idx].transactions = Array.isArray(list[idx].transactions) ? list[idx].transactions : [];
    list[idx].transactions.unshift({
      id: 'TX-' + Date.now() + '-' + Math.floor(10 + Math.random() * 89),
      type: 'purchase',
      amount: -cost,
      previousBalance: prev,
      newBalance: next,
      orderId: orderId,
      note: note || (orderId ? `Compra de pedido ${orderId}` : 'Compra en tienda Bloom Beauty'),
      exactTime: formatExactTime(now),
      dateFormatted: formatDateShort(now)
    });

    saveCustomers(list);
    return {
      success: true,
      previousBalance: prev,
      newBalance: next,
      deducted: cost,
      customer: list[idx]
    };
  }

  function deleteCustomer(custId) {
    let list = getCustomers();
    list = list.filter(c => String(c.id) !== String(custId));
    saveCustomers(list);
    return list;
  }

  // SOLICITUDES DE RECARGA DE "TU SALDO"
  function getRechargeRequests() {
    try {
      const raw = localStorage.getItem(RECHARGES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [];
  }

  function saveRechargeRequests(list) {
    const arr = Array.isArray(list) ? list : [];
    try {
      localStorage.setItem(RECHARGES_KEY, JSON.stringify(arr));
      touchPing();
    } catch (e) {}
    idbSet('rechargeRequests', arr);
    broadcast({ type: 'RECHARGES_UPDATED', rechargeRequests: arr, timestamp: Date.now() });
    return arr;
  }

  function addRechargeRequest(req = {}) {
    const list = getRechargeRequests();
    const amount = sanitizeBalance(req.amount);
    if (amount <= 0) return null;

    const now = new Date();
    const newReq = {
      id: 'REC-' + Date.now() + '-' + Math.floor(100 + Math.random() * 900),
      customerId: req.customerId || '',
      customerName: String(req.customerName || 'Cliente').trim(),
      customerPhone: String(req.customerPhone || '').trim(),
      customerEmail: normalizeEmail(req.customerEmail || ''),
      amount: amount,
      paymentMethod: String(req.paymentMethod || 'Nequi / Bancolombia').trim(),
      reference: String(req.reference || req.paymentRef || '').trim(),
      userNote: String(req.userNote || '').trim(),
      adminNotes: String(req.adminNotes || '').trim(),
      status: 'Pendiente',
      createdAt: now.toISOString(),
      exactTime: formatExactTime(now),
      dayKey: getLocalDayKey(now),
      dateFormatted: formatDateShort(now)
    };

    list.unshift(newReq);
    saveRechargeRequests(list);

    recordGlobalTransaction({
      category: 'recarga',
      referenceId: newReq.id,
      customerId: newReq.customerId,
      customerName: newReq.customerName,
      customerPhone: newReq.customerPhone,
      customerEmail: newReq.customerEmail,
      amount: newReq.amount,
      paymentMethod: newReq.paymentMethod,
      status: 'Pendiente',
      source: 'solicitud_web',
      note: newReq.reference ? `Ref: ${newReq.reference}` : newReq.userNote,
      exactTime: newReq.exactTime,
      dateFormatted: newReq.dateFormatted,
      dayKey: newReq.dayKey,
      timestamp: now.getTime()
    });

    return newReq;
  }

  function approveRechargeRequest(reqId, adminNotes = '', verifiedRef = '') {
    const requests = getRechargeRequests();
    const reqIdx = requests.findIndex(r => String(r.id) === String(reqId));
    if (reqIdx === -1) {
      return { success: false, message: 'No se encontró la solicitud de recarga.' };
    }

    const req = requests[reqIdx];
    if (req.status === 'Aprobada') {
      return { success: false, message: 'Esta recarga ya había sido aprobada.' };
    }

    const customers = getCustomers();
    let targetCust = customers.find(c => String(c.id) === String(req.customerId));
    if (!targetCust && req.customerEmail) {
      targetCust = customers.find(c => normalizeEmail(c.email) === normalizeEmail(req.customerEmail));
    }
    if (!targetCust && req.customerPhone) {
      const targetPhone = normalizePhone(req.customerPhone);
      targetCust = customers.find(c => normalizePhone(c.phone) === targetPhone);
    }

    if (!targetCust) {
      return { success: false, message: 'La cuenta de este usuario ya no existe en el registro.' };
    }

    const now = new Date();
    const noteDesc = verifiedRef
      ? `Recarga aprobada (${req.paymentMethod || 'Transferencia'} - Ref: ${verifiedRef})`
      : `Recarga aprobada (${req.paymentMethod || 'Transferencia'})`;

    const updatedCustomer = adjustCustomerBalance(
      targetCust.id,
      req.amount,
      noteDesc,
      true
    );

    requests[reqIdx].status = 'Aprobada';
    requests[reqIdx].approvedAt = formatDateShort(now);
    requests[reqIdx].approvedExactTime = formatExactTime(now);
    if (adminNotes) requests[reqIdx].adminNotes = String(adminNotes).trim();
    if (verifiedRef) requests[reqIdx].reference = String(verifiedRef).trim();
    saveRechargeRequests(requests);

    recordGlobalTransaction({
      category: 'recarga',
      referenceId: req.id,
      customerId: targetCust.id,
      customerName: targetCust.name,
      customerPhone: targetCust.phone,
      customerEmail: targetCust.email,
      customerCity: targetCust.city || '',
      customerDepartment: targetCust.department || '',
      amount: sanitizeBalance(req.amount),
      paymentMethod: req.paymentMethod || 'Transferencia',
      status: 'Aprobada',
      source: 'recarga_aprobada',
      note: noteDesc,
      exactTime: formatExactTime(now),
      dateFormatted: formatDateShort(now),
      dayKey: getLocalDayKey(now),
      timestamp: now.getTime()
    });

    return {
      success: true,
      request: requests[reqIdx],
      customer: updatedCustomer
    };
  }

  function deleteRechargeRequest(reqId) {
    let list = getRechargeRequests();
    list = list.filter(r => String(r.id) !== String(reqId));
    saveRechargeRequests(list);
    return list;
  }

  // --------------------------------------------------------------------------
  // 5.15 SERVICIOS CLOUD-READY DE AUTENTICACIÓN Y COMPRA UNIFICADA (BACKEND)
  // --------------------------------------------------------------------------
  const cloudServices = {
    getConfig: getCloudConfig,
    saveConfig: saveCloudConfig,

    registerUser: async (payload = {}) => {
      return executeCloudOperation('/api/v6/auth/register', 'POST', payload, async (body) => {
        const username = String(body.username || body.name || '').trim();
        const phone = String(body.phone || '').trim();
        const normPhone = normalizePhone(phone);
        const email = normalizeEmail(body.email);
        const city = String(body.city || '').trim();
        const department = String(body.department || '').trim();
        const password = String(body.password || '');
        const confirmPassword = String(body.confirmPassword !== undefined ? body.confirmPassword : body.password || '');

        if (!username || username.length < 2) {
          return { success: false, code: 'INVALID_USERNAME', field: 'username', message: 'Ingresa un nombre de usuario válido (mínimo 2 caracteres).' };
        }
        if (!normPhone || normPhone.length < 7) {
          return { success: false, code: 'INVALID_PHONE', field: 'phone', message: 'Ingresa un número de WhatsApp / Teléfono válido.' };
        }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return { success: false, code: 'INVALID_EMAIL', field: 'email', message: 'Ingresa un correo electrónico válido.' };
        }
        if (!city) {
          return { success: false, code: 'INVALID_CITY', field: 'city', message: 'La ciudad es obligatoria para tu registro.' };
        }
        if (!department) {
          return { success: false, code: 'INVALID_DEPARTMENT', field: 'department', message: 'El departamento es obligatorio para tu registro.' };
        }
        if (!password || password.length < 6) {
          return { success: false, code: 'WEAK_PASSWORD', field: 'password', message: 'La contraseña debe tener al menos 6 caracteres.' };
        }
        if (password !== confirmPassword) {
          return { success: false, code: 'PASSWORD_MISMATCH', field: 'confirmPassword', message: 'Las contraseñas ingresadas no coinciden.' };
        }

        // Validación estricta de unicidad en base de datos (correo y teléfono)
        const uniqueness = checkCustomerUniqueness(email, phone);
        if (!uniqueness.unique) {
          return {
            success: false,
            code: uniqueness.code,
            field: uniqueness.field,
            message: uniqueness.message
          };
        }

        const passwordHash = await hashPasswordSecure(password);
        const created = addCustomer({
          username,
          name: username,
          phone,
          email,
          city,
          department,
          address: String(body.address || '').trim(),
          passwordHash,
          balance: 0
        });

        if (!created || created.error) {
          return {
            success: false,
            code: (created && created.error) || 'REGISTER_ERROR',
            message: (created && created.message) || 'No fue posible registrar la cuenta.'
          };
        }

        return {
          success: true,
          sessionToken: 'bb_tok_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10),
          user: sanitizeCustomerPublicProfile(created)
        };
      });
    },

    loginUser: async (payload = {}) => {
      return executeCloudOperation('/api/v6/auth/login', 'POST', payload, async (body) => {
        const rawIdentifier = String(body.identifier || body.email || body.phone || '').trim();
        const password = String(body.password || '');

        if (!rawIdentifier || !password) {
          return {
            success: false,
            code: 'MISSING_CREDENTIALS',
            message: 'Ingresa tu correo electrónico o teléfono junto con tu contraseña.'
          };
        }

        const list = getCustomers();
        const cleanEmail = normalizeEmail(rawIdentifier);
        const normPhone = normalizePhone(rawIdentifier);

        const foundIdx = list.findIndex((u) => {
          const emailMatch = rawIdentifier.includes('@') && normalizeEmail(u.email) === cleanEmail;
          const phoneMatch = normPhone.length >= 7 && normalizePhone(u.phone) === normPhone;
          return emailMatch || phoneMatch;
        });

        if (foundIdx === -1) {
          return {
            success: false,
            code: 'INVALID_CREDENTIALS',
            message: 'No encontramos una cuenta con ese correo o teléfono, o los datos son incorrectos.'
          };
        }

        const userRecord = list[foundIdx];
        const validPass = await verifyCustomerPassword(userRecord, password);
        if (!validPass) {
          return {
            success: false,
            code: 'INVALID_CREDENTIALS',
            message: 'La contraseña ingresada es incorrecta. Verifícala e intenta nuevamente.'
          };
        }

        // Actualizar hash si venía de formato anterior y registrar hora de acceso
        if (!userRecord.passwordHash) {
          userRecord.passwordHash = await hashPasswordSecure(password);
          userRecord.password = '';
        }
        userRecord.lastLoginAt = formatDateShort(new Date());
        saveCustomers(list);

        return {
          success: true,
          sessionToken: 'bb_tok_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10),
          user: sanitizeCustomerPublicProfile(userRecord)
        };
      });
    },

    verifyUserBalance: async (payload = {}) => {
      return executeCloudOperation('/api/v6/wallet/verify', 'POST', payload, async (body) => {
        const customer = getCustomerById(body.customerId);
        if (!customer) {
          return {
            success: false,
            code: 'SESSION_EXPIRED',
            message: 'Tu sesión no es válida. Inicia sesión nuevamente.'
          };
        }
        const requiredAmount = sanitizeBalance(body.requiredAmount);
        const currentBalance = sanitizeBalance(customer.balance);
        const sufficient = currentBalance >= requiredAmount && requiredAmount > 0;

        return {
          success: true,
          sufficient,
          currentBalance,
          requiredAmount,
          missingAmount: sufficient ? 0 : Math.max(0, requiredAmount - currentBalance),
          remainingAfterPurchase: sufficient ? (currentBalance - requiredAmount) : currentBalance,
          user: sanitizeCustomerPublicProfile(customer)
        };
      });
    },

    updateDeliveryProfile: async (payload = {}) => {
      return executeCloudOperation('/api/v6/customer/delivery', 'PUT', payload, async (body) => {
        if (!body.customerId) {
          return { success: false, message: 'Usuario no autenticado.' };
        }
        const updated = updateCustomerInfo(body.customerId, {
          name: body.name,
          username: body.name,
          phone: body.phone,
          email: body.email,
          city: body.city,
          department: body.department,
          address: body.address
        });
        if (!updated || updated.error) {
          return {
            success: false,
            message: (updated && updated.message) || 'No se pudieron actualizar los datos de entrega.'
          };
        }
        return {
          success: true,
          user: sanitizeCustomerPublicProfile(updated)
        };
      });
    },

    confirmUnifiedPurchase: async (payload = {}) => {
      return executeCloudOperation('/api/v6/orders/confirm', 'POST', payload, async (body) => {
        const customer = getCustomerById(body.customerId);
        if (!customer) {
          return {
            success: false,
            code: 'USER_NOT_FOUND',
            message: 'Tu sesión expiró. Inicia sesión nuevamente para confirmar tu compra.'
          };
        }

        const items = Array.isArray(body.items) ? body.items.filter(i => i && Number(i.quantity) > 0) : [];
        if (items.length === 0) {
          return {
            success: false,
            code: 'EMPTY_ORDER',
            message: 'No hay productos seleccionados en el pedido.'
          };
        }

        // Recalcular precios desde el catálogo maestro del servidor para máxima seguridad
        const master = getMasterData();
        const verifiedItems = items.map((item) => {
          const catalogProd = (master.products || []).find(p => String(p.id) === String(item.id));
          const unitPrice = catalogProd ? sanitizeBalance(catalogProd.price) : sanitizeBalance(item.price);
          const qty = Math.max(1, Math.round(Number(item.quantity) || 1));
          return {
            id: catalogProd ? catalogProd.id : item.id,
            name: catalogProd ? catalogProd.name : item.name,
            brand: catalogProd ? (catalogProd.brandName || '') : (item.brandName || item.brand || ''),
            price: unitPrice,
            quantity: qty
          };
        });

        const rawSubtotal = verifiedItems.reduce((sum, it) => sum + (it.price * it.quantity), 0);
        let couponDiscount = 0;
        let appliedCouponCode = '';
        if (body.couponCode) {
          const couponCheck = validateCoupon(body.couponCode, verifiedItems);
          if (couponCheck && couponCheck.valid && couponCheck.discountAmount > 0) {
            couponDiscount = couponCheck.discountAmount;
            appliedCouponCode = couponCheck.code;
          }
        }
        const orderTotal = Math.max(100, rawSubtotal - couponDiscount);
        const orderId = 'BB-' + Date.now().toString().slice(-6);

        // Actualizar perfil de entrega si cambió
        const delivery = body.delivery || {};
        updateCustomerInfo(customer.id, {
          name: delivery.name || customer.name,
          phone: delivery.phone || customer.phone,
          email: delivery.email || customer.email,
          city: delivery.city || customer.city,
          department: delivery.department || customer.department,
          address: delivery.address || customer.address
        });

        // Descontar atómicamente de Tu Saldo
        const walletResult = deductCustomerBalance(
          customer.id,
          orderTotal,
          orderId,
          appliedCouponCode
            ? `Compra confirmada (${orderId} • Cupón ${appliedCouponCode})`
            : `Compra confirmada (${orderId})`
        );

        if (!walletResult || !walletResult.success) {
          return {
            success: false,
            code: (walletResult && walletResult.code) || 'INSUFFICIENT_BALANCE',
            currentBalance: walletResult ? walletResult.currentBalance : sanitizeBalance(customer.balance),
            needed: walletResult ? walletResult.needed : orderTotal,
            message: (walletResult && walletResult.message) || 'Tu Saldo disponible es insuficiente para esta compra.'
          };
        }

        const now = new Date();
        const orderNotes = [
          String(delivery.notes || '').trim(),
          appliedCouponCode ? `Cupón aplicado: ${appliedCouponCode} (-$${couponDiscount.toLocaleString('es-CO')})` : ''
        ].filter(Boolean).join(' | ');

        const savedOrder = saveOrder({
          id: orderId,
          date: now.toISOString(),
          exactTime: formatExactTime(now),
          dateFormatted: formatDateShort(now),
          dayKey: getLocalDayKey(now),
          customerId: customer.id,
          customerName: String(delivery.name || customer.name || '').trim(),
          customerPhone: String(delivery.phone || customer.phone || '').trim(),
          customerEmail: normalizeEmail(delivery.email || customer.email || ''),
          customerCity: String(delivery.city || customer.city || '').trim(),
          customerDepartment: String(delivery.department || customer.department || '').trim(),
          customerAddress: String(delivery.address || customer.address || '').trim(),
          notes: orderNotes,
          couponCode: appliedCouponCode,
          discountAmount: couponDiscount,
          subtotal: rawSubtotal,
          paymentMethod: 'Tu Saldo (Billetera Bloom)',
          previousBalance: walletResult.previousBalance,
          remainingBalance: walletResult.newBalance,
          items: verifiedItems,
          total: orderTotal,
          source: body.purchaseOrigin || 'tienda',
          status: 'Por Despachar'
        });

        return {
          success: true,
          message: 'Tu pedido será despachado en breve',
          order: savedOrder,
          previousBalance: walletResult.previousBalance,
          newBalance: walletResult.newBalance,
          user: sanitizeCustomerPublicProfile(walletResult.customer)
        };
      });
    },

    testConnection: async (customUrl = null, customKey = null) => {
      const cfg = getCloudConfig();
      const targetUrl = String(customUrl !== null ? customUrl : (cfg.endpointUrl || '')).trim().replace(/\/+$/, '');
      const targetKey = String(customKey !== null ? customKey : (cfg.apiKey || '')).trim();
      const startTs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

      if (!targetUrl) {
        return {
          success: true,
          mode: 'local-hybrid',
          latencyMs: 1,
          message: 'Motor Híbrido Local Activo (IndexedDB + BroadcastChannel en Tiempo Real)',
          health: getHealth()
        };
      }

      if (typeof fetch !== 'function') {
        return { success: false, mode: 'unsupported', message: 'Fetch API no disponible en este navegador.' };
      }

      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 45000) : null;
      try {
        const headers = { 'Accept': 'application/json' };
        if (targetKey) headers['Authorization'] = `Bearer ${targetKey}`;
        const res = await fetch(`${targetUrl}/api/v6/health`, {
          method: 'GET',
          headers,
          signal: controller ? controller.signal : undefined
        });
        if (timer) clearTimeout(timer);
        const endTs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const latencyMs = Math.max(1, Math.round(endTs - startTs));
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          return {
            success: true,
            mode: 'remote-server',
            latencyMs,
            serverInfo: data,
            message: `Conectado al Servidor Bloom v6 (${latencyMs} ms)`
          };
        }
        return {
          success: false,
          mode: 'http-error',
          latencyMs,
          message: `El servidor respondió HTTP ${res.status}. Verifica la URL o API Key.`
        };
      } catch (err) {
        if (timer) clearTimeout(timer);
        return {
          success: false,
          mode: 'unreachable',
          message: 'No se pudo contactar al servidor remoto. Operando con respaldo local instantáneo.'
        };
      }
    },

    pushSnapshot: async (silent = false) => {
      const cfg = getCloudConfig();
      if (!cfg.endpointUrl || typeof fetch !== 'function') {
        return { success: false, message: 'Configura primero la URL del Servidor en Cloud & Ajustes.' };
      }
      try {
        let sessions = [];
        try { sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]'); } catch (e) {}
        const snapshot = JSON.parse(exportDatabaseJSON());
        snapshot.database.sessions = sessions;

        const headers = { 'Content-Type': 'application/json' };
        if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
        const res = await fetch(`${cfg.endpointUrl}/api/v6/sync/push`, {
          method: 'POST',
          headers,
          body: JSON.stringify(snapshot)
        });
        if (res.ok) {
          const out = await res.json().catch(() => ({}));
          return { success: true, timestamp: Date.now(), server: out, silent };
        }
        return { success: false, message: `Error HTTP ${res.status} al sincronizar con el servidor.` };
      } catch (err) {
        return { success: false, message: 'Servidor no disponible en este momento.' };
      }
    },

    pullSnapshot: async () => {
      const cfg = getCloudConfig();
      if (!cfg.endpointUrl || typeof fetch !== 'function') {
        return { success: false, message: 'Configura primero la URL del Servidor en Cloud & Ajustes.' };
      }
      try {
        const headers = { 'Accept': 'application/json' };
        if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
        const res = await fetch(`${cfg.endpointUrl}/api/v6/sync/pull`, { method: 'GET', headers });
        if (!res.ok) {
          return { success: false, message: `Error HTTP ${res.status} al descargar estado del servidor.` };
        }
        const payload = await res.json();
        const db = payload && (payload.database || payload.data);
        if (!db || (!db.products && !db.orders && !db.customers)) {
          return { success: true, empty: true, message: 'Servidor conectado (sin datos previos en la nube).' };
        }

        isPullingFromCloud = true;
        try {
          importDatabaseJSON(JSON.stringify({ database: db }));
          if (Array.isArray(db.sessions)) {
            localStorage.setItem(SESSIONS_KEY, JSON.stringify(db.sessions));
          }
        } finally {
          isPullingFromCloud = false;
        }
        dispatchSync({ type: 'CLOUD_SNAPSHOT_PULLED', timestamp: Date.now() });
        return { success: true, database: db, message: 'Datos sincronizados desde el servidor exitosamente.' };
      } catch (err) {
        return { success: false, message: 'No se pudo descargar el estado desde el servidor.' };
      }
    }
  };

  // --------------------------------------------------------------------------
  // 5.2 GESTIÓN DE NOTIFICACIONES AUTOMÁTICAS Y CAMPAÑAS DE COMPORTAMIENTO
  // --------------------------------------------------------------------------
  function getDefaultNotificationsData() {
    return {
      globalEnabled: true,
      autoRules: [
        {
          id: 'rule-product-interest',
          name: 'Interés en Producto (Navegación)',
          triggerType: 'product_view',
          thresholdCount: 2,
          thresholdSeconds: 12,
          cooldownMinutes: 15,
          titleTemplate: '✨ ¡{producto} te espera!',
          bodyTemplate: 'Hola {usuario}, notamos tu interés en {producto} de {marca}. ¡Disponible hoy con despacho prioritario!',
          active: true
        },
        {
          id: 'rule-brand-affinity',
          name: 'Afinidad por Marca Oficial',
          triggerType: 'brand_interest',
          thresholdCount: 2,
          thresholdSeconds: 10,
          cooldownMinutes: 25,
          titleTemplate: '👑 Selección Oficial {marca}',
          bodyTemplate: 'Explora los rituales originales de {marca} más recomendados para ti en {ciudad}.',
          active: true
        },
        {
          id: 'rule-cart-reminder',
          name: 'Recordatorio de Carrito Pendiente',
          triggerType: 'cart_idle',
          thresholdCount: 1,
          thresholdSeconds: 45,
          cooldownMinutes: 30,
          titleTemplate: '🛍️ Tu bolsa de compras está lista',
          bodyTemplate: '{usuario}, tus productos favoritos siguen reservados en tu carrito. Finaliza tu compra en segundos.',
          active: true
        },
        {
          id: 'rule-welcome-geo',
          name: 'Bienvenida Personalizada por Ciudad',
          triggerType: 'welcome_optin',
          thresholdCount: 1,
          thresholdSeconds: 3,
          cooldownMinutes: 180,
          titleTemplate: '🌸 Bienvenida a Bloom Beauty',
          bodyTemplate: 'Cobertura verificada para {ciudad}. Activa tu sesión para desbloquear precios exclusivos.',
          active: true
        }
      ],
      directNotifications: [],
      deliveryLog: []
    };
  }

  function getNotificationsData() {
    const defaults = getDefaultNotificationsData();
    try {
      const raw = localStorage.getItem(NOTIFICATIONS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          globalEnabled: parsed.globalEnabled !== false,
          autoRules: (Array.isArray(parsed.autoRules) && parsed.autoRules.length > 0) ? parsed.autoRules : defaults.autoRules,
          directNotifications: Array.isArray(parsed.directNotifications) ? parsed.directNotifications : [],
          deliveryLog: Array.isArray(parsed.deliveryLog) ? parsed.deliveryLog : []
        };
      }
    } catch (e) {}
    return defaults;
  }

  function saveNotificationsData(data, eventType = 'NOTIFICATIONS_UPDATED') {
    const payload = {
      globalEnabled: data.globalEnabled !== false,
      autoRules: Array.isArray(data.autoRules) ? data.autoRules : [],
      directNotifications: Array.isArray(data.directNotifications) ? data.directNotifications.slice(0, 80) : [],
      deliveryLog: Array.isArray(data.deliveryLog) ? data.deliveryLog.slice(0, 150) : []
    };
    try {
      localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(payload));
      touchPing();
    } catch (e) {}
    idbSet('notifications', payload);
    broadcast({ type: eventType, notifications: payload, timestamp: Date.now() });
    return payload;
  }

  function saveAutoNotificationRule(rule = {}) {
    const state = getNotificationsData();
    const ruleObj = {
      id: rule.id || ('rule-' + Date.now()),
      name: String(rule.name || 'Regla Automática').trim(),
      triggerType: rule.triggerType || 'product_view',
      thresholdCount: Math.max(1, Number(rule.thresholdCount) || 1),
      thresholdSeconds: Math.max(1, Number(rule.thresholdSeconds) || 10),
      cooldownMinutes: Math.max(1, Number(rule.cooldownMinutes) || 15),
      titleTemplate: String(rule.titleTemplate || '✨ Recomendación Bloom Beauty').trim(),
      bodyTemplate: String(rule.bodyTemplate || 'Descubre los productos ideales para ti.').trim(),
      active: rule.active !== false
    };
    const idx = state.autoRules.findIndex(r => r.id === ruleObj.id);
    if (idx !== -1) {
      state.autoRules[idx] = ruleObj;
    } else {
      state.autoRules.unshift(ruleObj);
    }
    saveNotificationsData(state);
    return ruleObj;
  }

  function toggleAutoNotificationRule(ruleId) {
    const state = getNotificationsData();
    const item = state.autoRules.find(r => r.id === ruleId);
    if (item) {
      item.active = !item.active;
      saveNotificationsData(state);
    }
    return item;
  }

  function deleteAutoNotificationRule(ruleId) {
    const state = getNotificationsData();
    state.autoRules = state.autoRules.filter(r => r.id !== ruleId);
    saveNotificationsData(state);
    return state.autoRules;
  }

  function sendAdminNotification(notif = {}) {
    const state = getNotificationsData();
    const now = new Date();
    const item = {
      id: 'NTF-' + Date.now() + '-' + Math.floor(100 + Math.random() * 899),
      title: String(notif.title || '✨ Alerta Especial Bloom Beauty').trim(),
      body: String(notif.body || '').trim(),
      targetType: notif.targetType || 'all', // 'all' | 'brand_interest' | 'city' | 'customer'
      targetValue: String(notif.targetValue || '').trim(),
      ctaProductId: notif.ctaProductId || '',
      createdAt: now.toISOString(),
      exactTime: formatExactTime(now),
      dateFormatted: formatDateShort(now),
      dayKey: getLocalDayKey(now),
      timestamp: now.getTime()
    };
    state.directNotifications.unshift(item);
    saveNotificationsData(state, 'DIRECT_NOTIFICATION_PUSH');
    return item;
  }

  function logNotificationDelivered(entry = {}) {
    const state = getNotificationsData();
    const now = new Date();
    state.deliveryLog.unshift({
      id: 'DLV-' + Date.now() + '-' + Math.floor(10 + Math.random() * 89),
      ruleId: entry.ruleId || 'direct',
      title: entry.title || '',
      body: entry.body || '',
      visitorId: entry.visitorId || '',
      userName: entry.userName || 'Visitante',
      city: entry.city || '',
      triggerContext: entry.triggerContext || '',
      exactTime: formatExactTime(now),
      dateFormatted: formatDateShort(now),
      dayKey: getLocalDayKey(now),
      timestamp: now.getTime()
    });
    saveNotificationsData(state, 'NOTIFICATION_DELIVERY_LOGGED');
  }

  // --------------------------------------------------------------------------
  // 5.25 GENERADOR DE INFORMES DIARIOS COMPLETOS (TRÁFICO, RECARGAS Y VENTAS)
  // --------------------------------------------------------------------------
  function generateDailyReportData(targetDayKey = null) {
    const dayKey = targetDayKey || getLocalDayKey(new Date());

    // 1. Sesiones de visitantes en la fecha seleccionada
    let allSessions = [];
    try {
      allSessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
    } catch (e) {}

    const daySessions = allSessions.filter((s) => {
      if (s.dayKey) return s.dayKey === dayKey;
      if (s.entryTimestamp) return getLocalDayKey(new Date(s.entryTimestamp)) === dayKey;
      return false;
    });

    const totalVisitors = daySessions.length;
    const identifiedVisitors = daySessions.filter(s => s.user && s.user.authenticated).length;
    const totalDurationSec = daySessions.reduce((acc, s) => acc + (Number(s.durationSeconds) || 0), 0);
    const avgDurationSec = totalVisitors > 0 ? Math.round(totalDurationSec / totalVisitors) : 0;

    // Productos más vistos en el día
    const viewedProductsMap = new Map();
    daySessions.forEach((s) => {
      (s.productsViewed || []).forEach((pv) => {
        const key = pv.id || pv.name;
        const curr = viewedProductsMap.get(key) || {
          id: pv.id || '',
          name: pv.name || 'Producto',
          brand: pv.brand || '',
          views: 0,
          totalSeconds: 0
        };
        curr.views += Number(pv.viewsCount) || 1;
        curr.totalSeconds += Number(pv.secondsSpent) || 0;
        viewedProductsMap.set(key, curr);
      });
    });
    const topViewedProducts = Array.from(viewedProductsMap.values())
      .sort((a, b) => b.views - a.views || b.totalSeconds - a.totalSeconds);

    // 2. Pedidos y ventas del día
    const allOrders = getOrders();
    const dayOrders = allOrders.filter((o) => {
      if (o.dayKey) return o.dayKey === dayKey;
      if (o.date) return getLocalDayKey(new Date(o.date)) === dayKey;
      return false;
    });

    const activeDayOrders = dayOrders.filter(o => o.status !== 'Cancelado');
    const totalSalesCOP = activeDayOrders.reduce((acc, o) => acc + sanitizeBalance(o.total), 0);
    const manualOrdersCount = activeDayOrders.filter(o => o.source === 'manual_admin').length;
    const webOrdersCount = activeDayOrders.length - manualOrdersCount;

    const soldProductsMap = new Map();
    let totalUnitsSold = 0;
    activeDayOrders.forEach((o) => {
      (o.items || []).forEach((it) => {
        const qty = Math.max(1, Number(it.quantity) || 1);
        const subtotal = sanitizeBalance(it.price) * qty;
        totalUnitsSold += qty;
        const key = it.id || it.name;
        const curr = soldProductsMap.get(key) || {
          id: it.id || '',
          name: it.name || 'Producto',
          brand: it.brand || '',
          unitsSold: 0,
          revenue: 0
        };
        curr.unitsSold += qty;
        curr.revenue += subtotal;
        soldProductsMap.set(key, curr);
      });
    });
    const topSoldProducts = Array.from(soldProductsMap.values())
      .sort((a, b) => b.unitsSold - a.unitsSold || b.revenue - a.revenue);

    // 3. Recargas y transacciones del día
    const dayTransactions = getUnifiedTransactions().filter(tx => tx.dayKey === dayKey);
    const dayRecharges = dayTransactions.filter(tx => tx.category === 'recarga');
    const approvedRecharges = dayRecharges.filter(tx => tx.status === 'Aprobada' || tx.status === 'Completado');
    const totalRechargedCOP = approvedRecharges.reduce((acc, tx) => acc + sanitizeBalance(tx.amount), 0);

    // 4. Nuevos clientes registrados en el día
    const dayNewCustomers = getCustomers().filter((c) => {
      if (c.dayKey) return c.dayKey === dayKey;
      if (c.createdAt) return getLocalDayKey(new Date(c.createdAt)) === dayKey;
      return false;
    });

    return {
      dayKey,
      generatedAt: formatDateShort(new Date()),
      traffic: {
        totalSessions: totalVisitors,
        identifiedSessions: identifiedVisitors,
        anonymousSessions: Math.max(0, totalVisitors - identifiedVisitors),
        totalDurationSeconds: totalDurationSec,
        avgDurationSeconds: avgDurationSec,
        newRegistrations: dayNewCustomers.length,
        sessions: daySessions,
        topViewedProducts
      },
      sales: {
        ordersCount: activeDayOrders.length,
        webOrdersCount,
        manualOrdersCount,
        totalUnitsSold,
        totalSalesCOP,
        orders: dayOrders,
        topSoldProducts
      },
      recharges: {
        totalCount: dayRecharges.length,
        approvedCount: approvedRecharges.length,
        totalRechargedCOP,
        items: dayRecharges
      },
      transactions: dayTransactions
    };
  }

  // --------------------------------------------------------------------------
  // 5.3 GESTIÓN DE RESEÑAS, REPORTES DE BUGS Y OFERTAS
  // --------------------------------------------------------------------------
  function getReviews() {
    try {
      const raw = localStorage.getItem(REVIEWS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
  }

  function saveReviews(list) {
    const arr = Array.isArray(list) ? list : [];
    try {
      localStorage.setItem(REVIEWS_KEY, JSON.stringify(arr));
      touchPing();
    } catch (e) {}
    idbSet('reviews', arr);
    broadcast({ type: 'REVIEWS_UPDATED', reviews: arr, timestamp: Date.now() });
    return arr;
  }

  function addReview(rev) {
    const list = getReviews();
    const newRev = {
      id: 'REV-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      author: rev.author || 'Cliente Bloom',
      city: rev.city || 'Colombia',
      rating: Number(rev.rating) || 5,
      comment: rev.comment || '',
      productOrSubject: rev.productOrSubject || 'Atención General',
      verified: rev.verified !== false,
      date: new Date().toLocaleDateString('es-CO'),
      timestamp: Date.now()
    };
    list.unshift(newRev);
    saveReviews(list);
    return newRev;
  }

  function deleteReview(revId) {
    let list = getReviews();
    list = list.filter(r => String(r.id) !== String(revId));
    saveReviews(list);
    return list;
  }

  function getBugReports() {
    try {
      const raw = localStorage.getItem(BUGS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
  }

  function saveBugReports(list) {
    const arr = Array.isArray(list) ? list : [];
    try {
      localStorage.setItem(BUGS_KEY, JSON.stringify(arr));
      touchPing();
    } catch (e) {}
    idbSet('bugs', arr);
    broadcast({ type: 'BUGS_UPDATED', bugs: arr, timestamp: Date.now() });
    return arr;
  }

  function addBugReport(report) {
    const list = getBugReports();
    const newBug = {
      id: 'BUG-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      name: report.name || 'Cliente',
      phone: report.phone || '',
      issueType: report.issueType || 'Inconveniente general',
      description: report.description || '',
      deviceInfo: report.deviceInfo || 'N/A',
      pageUrl: report.pageUrl || '',
      status: 'Pendiente',
      date: formatDateShort(),
      timestamp: Date.now()
    };
    list.unshift(newBug);
    saveBugReports(list);
    return newBug;
  }

  function deleteBugReport(bugId) {
    let list = getBugReports();
    list = list.filter(b => String(b.id) !== String(bugId));
    saveBugReports(list);
    return list;
  }

  const DEFAULT_OFFERS_SEED = [
    {
      id: 'OFR_BLOOM_20',
      title: 'Cupón Bienvenida Bloom 20%',
      description: '20% de descuento especial de bienvenida en toda la tienda',
      discountPercent: 20,
      bannerText: '20% de descuento VIP con el cupón BLOOM20',
      targetCategory: 'Todas',
      targetBrand: 'Todas',
      active: true,
      couponCode: 'BLOOM20',
      createdAt: '2026-11-08'
    },
    {
      id: 'OFR_VIP_10',
      title: 'Descuento VIP Bloom 10%',
      description: '10% de descuento en todo el catálogo oficial',
      discountPercent: 10,
      bannerText: '10% de descuento especial con el cupón VIP10',
      targetCategory: 'Todas',
      targetBrand: 'Todas',
      active: true,
      couponCode: 'VIP10',
      createdAt: '2026-11-08'
    }
  ];

  function getOffers() {
    try {
      const raw = localStorage.getItem(OFFERS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const hasBloom20 = parsed.some(o => String(o.couponCode || '').trim().toUpperCase() === 'BLOOM20');
          if (!hasBloom20) {
            parsed.unshift(DEFAULT_OFFERS_SEED[0]);
            try { localStorage.setItem(OFFERS_KEY, JSON.stringify(parsed)); } catch (e) {}
          }
          return parsed;
        }
      }
    } catch (e) {}
    return DEFAULT_OFFERS_SEED;
  }

  function saveOffers(list) {
    const arr = Array.isArray(list) ? list : [];
    try {
      localStorage.setItem(OFFERS_KEY, JSON.stringify(arr));
      touchPing();
    } catch (e) {}
    idbSet('offers', arr);
    broadcast({ type: 'OFFERS_UPDATED', offers: arr, timestamp: Date.now() });
    return arr;
  }

  function addOffer(offer) {
    const list = getOffers();
    const newOffer = {
      id: 'OFR-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      title: offer.title || 'Oferta Especial',
      description: offer.description || '',
      discountPercent: Number(offer.discountPercent) || 0,
      bannerText: offer.bannerText || offer.title || '',
      targetCategory: offer.targetCategory || 'Todas',
      targetBrand: offer.targetBrand || 'Todas',
      active: offer.active !== false,
      couponCode: offer.couponCode || '',
      createdAt: new Date().toLocaleDateString('es-CO'),
      expiresAt: offer.expiresAt || 'Sin límite',
      timestamp: Date.now()
    };
    list.unshift(newOffer);
    saveOffers(list);
    return newOffer;
  }

  function deleteOffer(offerId) {
    let list = getOffers();
    list = list.filter(o => String(o.id) !== String(offerId));
    saveOffers(list);
    return list;
  }

  function toggleOffer(offerId) {
    const list = getOffers();
    const item = list.find(o => String(o.id) === String(offerId));
    if (item) {
      item.active = !item.active;
      saveOffers(list);
    }
    return item;
  }

  // --------------------------------------------------------------------------
  // 5.4 GESTIÓN DE MARCAS Y PRODUCTOS (CREAR, EDITAR, ELIMINAR)
  // --------------------------------------------------------------------------
  function addBrand(brand) {
    const data = getMasterData();
    const newBrand = {
      id: normalizeBrandId(brand.id || brand.name),
      name: String(brand.name || 'Nueva Marca').trim(),
      category: brand.category || 'Cuidado Capilar',
      tagline: brand.tagline || '',
      description: brand.description || '',
      badge: brand.badge || 'Oficial',
      logo: brand.logo || 'imagenes/logo-bloom-beauty.jpg',
      banner: brand.banner || 'imagenes/marcas/milagros-banner.jpg',
      active: brand.active !== false
    };
    data.brands.push(newBrand);
    saveMasterData(data);
    return newBrand;
  }

  function deleteBrand(brandId) {
    const data = getMasterData();
    data.brands = data.brands.filter(b => String(b.id) !== String(brandId));
    saveMasterData(data);
    return data.brands;
  }

  function addProduct(prod) {
    const data = getMasterData();
    let brandId = prod.brandId ? normalizeBrandId(prod.brandId) : '';
    let brandName = prod.brandName || 'Bloom Beauty';

    if (brandName) {
      const existingBrand = data.brands.find(b => b.name.toLowerCase() === brandName.toLowerCase());
      if (existingBrand) {
        brandId = existingBrand.id;
        brandName = existingBrand.name;
      } else {
        brandId = normalizeBrandId(brandName);
        const autoBrand = {
          id: brandId,
          name: brandName,
          category: prod.category || 'Cuidado Especial',
          tagline: `Productos oficiales ${brandName}`,
          description: `Selección curada y tratamientos de la marca ${brandName}.`,
          badge: 'Oficial',
          logo: 'imagenes/logo-bloom-beauty.jpg',
          banner: 'imagenes/marcas/milagros-banner.jpg',
          active: true
        };
        data.brands.push(autoBrand);
      }
    }

    const newProd = {
      id: prod.id || ('prod-' + (brandId || 'general') + '-' + Date.now().toString().slice(-5)),
      brandId: brandId || 'general',
      brandName: brandName,
      name: prod.name || 'Nuevo Producto',
      category: prod.category || 'Capilar',
      price: Number(prod.price) || 0,
      oldPrice: prod.oldPrice ? Number(prod.oldPrice) : null,
      badge: prod.badge || '',
      image: prod.image || 'imagenes/logo-bloom-beauty.jpg',
      description: prod.description || '',
      active: prod.active !== false
    };
    data.products.unshift(newProd);
    saveMasterData(data);
    return newProd;
  }

  function deleteProduct(prodId) {
    const data = getMasterData();
    data.products = data.products.filter(p => String(p.id) !== String(prodId));
    saveMasterData(data);
    return data.products;
  }

  // --------------------------------------------------------------------------
  // 6. HERRAMIENTAS DE COPIA DE SEGURIDAD, RESTAURACIÓN Y DIAGNÓSTICO
  // --------------------------------------------------------------------------
  function exportDatabaseJSON() {
    const currentData = getMasterData();
    const exportObject = {
      app: 'Bloom Beauty Plataforma Oficial v6',
      exportedAt: new Date().toISOString(),
      timestamp: Date.now(),
      version: '12.0',
      database: {
        storeInfo: currentData.storeInfo,
        brands: currentData.brands,
        products: currentData.products,
        orders: getOrders(),
        expenses: getExpenses(),
        customers: getCustomers(),
        rechargeRequests: getRechargeRequests(),
        transactions: getRawTransactions(),
        notifications: getNotificationsData(),
        offers: getOffers(),
        reviews: getReviews(),
        bugs: getBugReports()
      }
    };
    return JSON.stringify(exportObject, null, 2);
  }

  function downloadBackupFile() {
    const jsonStr = exportDatabaseJSON();
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const nowStr = getLocalDayKey(new Date());
    link.href = url;
    link.download = `bloom_beauty_v6_backup_${nowStr}.json`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 150);
  }

  function importDatabaseJSON(jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      const db = parsed.database || parsed;

      if (db.storeInfo || db.brands || db.products) {
        saveMasterData({
          storeInfo: db.storeInfo || {},
          brands: db.brands || [],
          products: db.products || []
        });
      }
      if (Array.isArray(db.orders)) saveOrders(db.orders);
      if (Array.isArray(db.expenses)) saveExpenses(db.expenses);
      if (Array.isArray(db.customers)) saveCustomers(db.customers);
      if (Array.isArray(db.rechargeRequests)) saveRechargeRequests(db.rechargeRequests);
      if (Array.isArray(db.transactions)) saveRawTransactions(db.transactions);
      if (db.notifications) saveNotificationsData(db.notifications);
      if (Array.isArray(db.offers)) saveOffers(db.offers);
      if (Array.isArray(db.reviews)) saveReviews(db.reviews);
      if (Array.isArray(db.bugs)) saveBugReports(db.bugs);

      broadcast({ type: 'DATABASE_RESTORED', timestamp: Date.now() });
      return { success: true, message: 'Base de datos restaurada exitosamente.' };
    } catch (e) {
      return { success: false, message: 'El archivo JSON no es válido: ' + e.message };
    }
  }

  function generateDataJsCode() {
    const data = getMasterData();
    const code = `// ============================================================================
// BLOOM BEAUTY v6 - CATÁLOGO MAESTRO DE PRODUCTOS PRINCIPALES
// Fecha de sincronización: ${new Date().toLocaleString('es-CO')}
// ============================================================================

const DEFAULT_SITE_DATA = ${JSON.stringify({ storeInfo: data.storeInfo, brands: data.brands, products: data.products }, null, 2)};
`;
    return code;
  }

  function validateCoupon(rawCode, cartItems = []) {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!code) {
      return { valid: false, message: 'Ingresa un código promocional.' };
    }
    const offers = getOffers().filter(o => o && o.active !== false);
    const match = offers.find(o => String(o.couponCode || '').trim().toUpperCase() === code);
    if (!match) {
      return { valid: false, message: 'El cupón ingresado no existe o ya expiró.' };
    }
    const pct = Math.min(95, Math.max(0, Number(match.discountPercent) || 0));
    if (pct <= 0) {
      return { valid: false, message: 'Esta promoción es informativa y no aplica descuento porcentual.' };
    }

    const items = Array.isArray(cartItems) ? cartItems : [];
    const targetBrand = String(match.targetBrand || 'Todas').trim().toLowerCase();
    const eligibleItems = items.filter((it) => {
      if (!targetBrand || targetBrand === 'todas' || targetBrand === 'all') return true;
      const bName = String(it.brand || it.brandName || '').trim().toLowerCase();
      const bId = String(it.brandId || '').trim().toLowerCase();
      return bName === targetBrand || bId === targetBrand || bName.includes(targetBrand);
    });

    const eligibleSubtotal = eligibleItems.reduce((acc, it) => acc + (sanitizeBalance(it.price) * Math.max(1, Number(it.quantity) || 1)), 0);
    if (items.length > 0 && eligibleSubtotal <= 0) {
      return {
        valid: false,
        message: `El cupón ${code} aplica únicamente para productos de la marca ${match.targetBrand}.`
      };
    }

    const discountAmount = Math.round((eligibleSubtotal * pct) / 100);
    return {
      valid: true,
      code,
      discountPercent: pct,
      targetBrand: match.targetBrand || 'Todas',
      title: match.title || `Cupón ${code}`,
      discountAmount,
      offer: match,
      message: `¡Cupón ${code} aplicado! Ahorras ${pct}%${match.targetBrand && match.targetBrand !== 'Todas' ? ' en ' + match.targetBrand : ''}.`
    };
  }

  function getCustomerOrders(customerOrIdentity = {}) {
    if (!customerOrIdentity) return [];
    const custId = String(customerOrIdentity.id || customerOrIdentity.customerId || '').trim();
    const custEmail = normalizeEmail(customerOrIdentity.email || customerOrIdentity.customerEmail || '');
    const custPhone = normalizePhone(customerOrIdentity.phone || customerOrIdentity.customerPhone || '');
    if (!custId && !custEmail && !custPhone) return [];

    return getOrders().filter((o) => {
      if (!o) return false;
      if (custId && o.customerId && String(o.customerId) === custId) return true;
      if (custEmail && o.customerEmail && normalizeEmail(o.customerEmail) === custEmail) return true;
      if (custPhone && custPhone.length >= 7 && o.customerPhone && normalizePhone(o.customerPhone) === custPhone) return true;
      return false;
    });
  }

  // Auto-descubrimiento y sincronización inteligente Cloud-First permanente
  if (typeof window !== 'undefined') {
    setTimeout(async () => {
      try {
        const cfg = getCloudConfig();
        const probeOrigin = cfg.enabled && cfg.endpointUrl ? cfg.endpointUrl : (window.location && /^https?:$/i.test(window.location.protocol) ? window.location.origin : 'https://bloom-backend-v6.onrender.com');
        const res = await fetch(`${probeOrigin}/api/v6/health`, { method: 'GET' }).catch(() => null);
        if (res && res.ok) {
          const info = await res.json().catch(() => ({}));
          if (info && info.engine === 'BloomServerV6') {
            if (!cfg.enabled || !cfg.endpointUrl) {
              saveCloudConfig({ enabled: true, endpointUrl: probeOrigin, apiKey: cfg.apiKey || '' });
            }
            await cloudServices.pullSnapshot();
          }
        }
      } catch (e) {}
    }, 200);
  }

  function getHealth() {
    const data = getMasterData();
    const cloudCfg = getCloudConfig();
    return {
      status: 'connected',
      cloudMode: cloudCfg.enabled ? 'remote-cloud' : 'cloud-hybrid-ready',
      endpointUrl: cloudCfg.endpointUrl || '',
      channelReady: !!broadcastChannel,
      indexedDBReady: isIndexedDBReady,
      productsCount: data.products.length,
      activeProductsCount: data.products.filter(p => p.active !== false).length,
      inactiveProductsCount: data.products.filter(p => p.active === false).length,
      brandsCount: data.brands.length,
      activeBrandsCount: data.brands.filter(b => b.active !== false).length,
      offersActiveCount: getOffers().filter(o => o.active !== false).length,
      reviewsCount: getReviews().length,
      ordersCount: getOrders().length,
      customersCount: getCustomers().length,
      pendingRechargesCount: getRechargeRequests().filter(r => r.status === 'Pendiente').length,
      lastSync: new Date(data.updatedAt).toLocaleTimeString('es-CO')
    };
  }

  return {
    cloud: cloudServices,
    getCloudConfig,
    saveCloudConfig,

    getData: getMasterData,
    getMasterData,
    saveData: saveMasterData,
    saveMasterData,
    saveDataAsync: async (data, notify = true) => saveMasterData(data, notify),
    getDataAsync: async () => {
      const idb = await idbGet('masterData');
      return idb || getMasterData();
    },

    // Pedidos y Despacho
    getOrders,
    saveOrders,
    saveOrdersAsync: async (orders) => saveOrders(orders),
    getOrdersAsync: async () => {
      const idb = await idbGet('orders');
      return idb || getOrders();
    },
    saveOrder,
    updateOrderStatus,
    createManualOrder,
    deleteOrder,
    getExpenses,
    saveExpenses,

    // Transacciones y Reportes Diarios
    getTransactions: getUnifiedTransactions,
    recordTransaction: recordGlobalTransaction,
    generateDailyReport: generateDailyReportData,
    getLocalDayKey,
    formatExactTime,

    // Notificaciones Inteligentes
    getNotificationsData,
    saveNotificationsData,
    saveAutoNotificationRule,
    toggleAutoNotificationRule,
    deleteAutoNotificationRule,
    sendAdminNotification,
    logNotificationDelivered,

    // Catálogo
    updateProduct,
    toggleProduct,
    updatePrice,
    toggleBrand,
    addProduct,
    deleteProduct,
    addBrand,
    deleteBrand,
    normalizeBrandId,

    // Reseñas, Ofertas y Bugs
    getReviews,
    saveReviews,
    addReview,
    deleteReview,
    getOffers,
    saveOffers,
    addOffer,
    deleteOffer,
    toggleOffer,
    validateCoupon,
    getCustomerOrders,
    getBugReports,
    saveBugReports,
    addBugReport,
    deleteBugReport,

    // Usuarios, Tu Saldo y Recargas
    getCustomers,
    getCustomerById,
    checkCustomerUniqueness,
    saveCustomers,
    saveCustomersAsync: async (customers) => saveCustomers(customers),
    getCustomersAsync: async () => {
      const idb = await idbGet('customers');
      return idb || getCustomers();
    },
    addCustomer,
    updateCustomerInfo,
    updateCustomerBalance,
    adjustCustomerBalance,
    deductCustomerBalance,
    deleteCustomer,
    getRechargeRequests,
    saveRechargeRequests,
    addRechargeRequest,
    approveRechargeRequest,
    deleteRechargeRequest,
    sanitizeBalance,
    normalizePhone,
    normalizeEmail,

    // IndexedDB
    idbSet,
    idbGet,

    // Bus de sincronización
    subscribe: (fn) => {
      if (typeof fn === 'function') syncCallbacks.push(fn);
    },
    onSync: (fn) => {
      if (typeof fn === 'function') syncCallbacks.push(fn);
    },
    broadcast,
    touchPing,

    // Llaves centralizadas
    KEYS: {
      STORAGE_KEY,
      CUSTOMERS_KEY,
      ORDERS_KEY,
      EXPENSES_KEY,
      REVIEWS_KEY,
      OFFERS_KEY,
      RECHARGES_KEY,
      BUGS_KEY,
      SESSIONS_KEY,
      TRANSACTIONS_KEY,
      NOTIFICATIONS_KEY,
      CLOUD_CONFIG_KEY
    },
    STORAGE_KEY,
    CUSTOMERS_KEY,
    ORDERS_KEY,

    purgeStorageQuota,
    exportJSON: exportDatabaseJSON,
    downloadBackup: downloadBackupFile,
    importJSON: importDatabaseJSON,
    generateDataJsCode,
    getHealth
  };
})();

if (typeof window !== 'undefined') {
  window.BloomDB = BloomDB;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BloomDB;
}
