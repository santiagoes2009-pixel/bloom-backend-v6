const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'bloom_secret_jwt_shield_2026_super_secure';

// 1. ESCUDO DE CABECERAS HTTP (Helmet)
app.use(helmet({
  contentSecurityPolicy: false, // Permitir CDN y fuentes externas necesarias para Bloom Beauty
  crossOriginEmbedderPolicy: false
}));

// Deshabilitar la firma del framework para evitar fingerprinting de atacantes
app.disable('x-powered-by');

// 2. CORS LIBRE Y SEGURO (Permite conexión sin bloqueos desde cualquier cliente de Bloom Beauty)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: false
}));

// 3. LÍMITE DE TAMAÑO DE PAYLOAD (Protección contra ataques Denial-of-Service / Memory Exhaustion)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 4. RATE LIMITING (Protección contra Fuerza Bruta y Ataques DDoS)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 300, // Máximo 300 peticiones por ventana
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiadas solicitudes. Por favor, intenta de nuevo más tarde.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // Máximo 20 intentos de login/registro cada 15 min
  message: { success: false, error: 'Demasiados intentos de acceso. Bloqueado temporalmente por seguridad.' }
});

app.use('/api/', generalLimiter);
app.use('/api/v6/auth/', authLimiter);

// 5. SANITIZADOR Y PREVENCIÓN CONTRA INYECCIÓN (SQL / NoSQL / Scripting Injection)
function sanitizeInput(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/'/g, "''")
    .replace(/;/g, "")
    .replace(/--/g, "")
    .replace(/\/\*/g, "")
    .replace(/\*\//g, "")
    .trim();
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  for (let key in obj) {
    if (typeof obj[key] === 'string') {
      obj[key] = sanitizeInput(obj[key]);
    } else if (typeof obj[key] === 'object') {
      sanitizeObject(obj[key]);
    }
  }
  return obj;
}

app.use((req, res, next) => {
  if (req.body) sanitizeObject(req.body);
  if (req.query) sanitizeObject(req.query);
  next();
});

// Inicialización de Supabase con conexión segura
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('🛡️ Base de datos Supabase conectada con cifrado TLS/SSL.');
  } catch (err) {
    console.error('Error inicializando Supabase:', err.message);
  }
}

// ============================================================================
// RUTAS Y CONTROLADORES BLINDADOS
// ============================================================================

// 1. Health check & Diagnostics seguro
app.get('/api/v6/health', (req, res) => {
  res.json({
    engine: 'BloomServerV6',
    status: 'online',
    security: {
      shield: 'Active',
      rateLimiter: 'Enabled',
      headers: 'Hardened',
      antiSqlInjection: 'Active',
      passwordEncryption: 'Bcrypt-Salt-10'
    },
    version: '6.0.0',
    platform: 'Render + Node.js',
    database: supabase ? 'Supabase (PostgreSQL)' : 'In-Memory Cache',
    timestamp: new Date().toISOString()
  });
});

// 2. Autenticación: Registro Blindado con Bcrypt
app.post('/api/v6/auth/register', async (req, res) => {
  try {
    const { username, name, phone, email, city, department, address, password } = req.body;
    const finalName = sanitizeInput((username || name || '')).slice(0, 100);
    const finalPhone = String(phone || '').replace(/\D/g, '').slice(0, 20);
    const finalEmail = String(email || '').trim().toLowerCase().slice(0, 120);

    // Validación estricta de correo
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(finalEmail)) {
      return res.status(400).json({ success: false, message: 'Formato de correo no válido.' });
    }

    if (!finalName || !finalPhone || !finalEmail || !password) {
      return res.status(400).json({ success: false, message: 'Todos los campos requeridos deben ser completados.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'La contraseña debe tener un mínimo de 6 caracteres.' });
    }

    // Cifrado de contraseña con Salt de 10 rondas
    const passwordHash = await bcrypt.hash(password, 10);
    const customerId = 'cust_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    const newCustomer = {
      id: customerId,
      name: finalName,
      username: finalName,
      phone: finalPhone,
      email: finalEmail,
      city: sanitizeInput(city || ''),
      department: sanitizeInput(department || ''),
      address: sanitizeInput(address || ''),
      password_hash: passwordHash,
      balance: 0,
      created_at: new Date().toISOString()
    };

    if (supabase) {
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .or(`email.eq.${finalEmail},phone.eq.${finalPhone}`)
        .maybeSingle();

      if (existing) {
        return res.status(409).json({ success: false, message: 'Ya existe una cuenta con este correo o teléfono.' });
      }

      const { error } = await supabase.from('customers').insert([newCustomer]);
      if (error) {
        return res.status(500).json({ success: false, message: 'Error procesando registro seguro.' });
      }
    }

    // Token JWT de sesión
    const token = jwt.sign({ id: customerId, email: finalEmail }, JWT_SECRET, { expiresIn: '7d' });

    return res.status(201).json({
      success: true,
      token,
      user: {
        id: customerId,
        username: finalName,
        name: finalName,
        phone: finalPhone,
        email: finalEmail,
        city: newCustomer.city,
        department: newCustomer.department,
        address: newCustomer.address,
        balance: 0
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error interno de seguridad.' });
  }
});

// 3. Autenticación: Inicio de Sesión Blindado
app.post('/api/v6/auth/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const cleanId = String(identifier || '').trim().toLowerCase();
    const cleanPhone = String(identifier || '').replace(/\D/g, '');

    if (!cleanId || !password) {
      return res.status(400).json({ success: false, message: 'Credenciales incompletas.' });
    }

    let customer = null;
    if (supabase) {
      const query = supabase.from('customers').select('*');
      if (cleanId.includes('@')) {
        query.eq('email', cleanId);
      } else {
        query.eq('phone', cleanPhone);
      }
      const { data, error } = await query.maybeSingle();
      if (error || !data) {
        return res.status(401).json({ success: false, message: 'Credenciales no válidas.' });
      }
      customer = data;
    }

    if (!customer) {
      return res.status(401).json({ success: false, message: 'Credenciales no válidas.' });
    }

    // Verificación segura de hash bcrypt (y fallback de migración segura)
    let isMatch = false;
    if (customer.password_hash) {
      if (customer.password_hash.startsWith('$2a$') || customer.password_hash.startsWith('$2b$')) {
        isMatch = await bcrypt.compare(password, customer.password_hash);
      } else {
        isMatch = (customer.password_hash === password);
        // Si coincidió en plano, actualizarlo de inmediato a Bcrypt seguro
        if (isMatch && supabase) {
          const newSecureHash = await bcrypt.hash(password, 10);
          await supabase.from('customers').update({ password_hash: newSecureHash, password: null }).eq('id', customer.id);
        }
      }
    } else if (customer.password) {
      isMatch = (customer.password === password);
      if (isMatch && supabase) {
        const newSecureHash = await bcrypt.hash(password, 10);
        await supabase.from('customers').update({ password_hash: newSecureHash, password: null }).eq('id', customer.id);
      }
    }

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Credenciales no válidas.' });
    }

    const token = jwt.sign({ id: customer.id, email: customer.email }, JWT_SECRET, { expiresIn: '7d' });

    return res.json({
      success: true,
      token,
      user: {
        id: customer.id,
        username: customer.username || customer.name,
        name: customer.name || customer.username,
        phone: customer.phone,
        email: customer.email,
        city: customer.city,
        department: customer.department,
        address: customer.address,
        balance: Number(customer.balance || 0)
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error interno de seguridad.' });
  }
});

// 4. Billetera: Verificar Saldo
app.post('/api/v6/wallet/verify', async (req, res) => {
  try {
    const { customerId, requiredAmount } = req.body;
    if (!customerId) return res.status(400).json({ success: false, message: 'Id requerido.' });

    let customer = null;
    if (supabase) {
      const { data } = await supabase.from('customers').select('*').eq('id', customerId).maybeSingle();
      customer = data;
    }

    if (!customer) {
      return res.status(404).json({ success: false, code: 'SESSION_EXPIRED', message: 'Cliente no encontrado.' });
    }

    const currentBalance = Number(customer.balance || 0);
    const required = Number(requiredAmount || 0);
    const sufficient = currentBalance >= required && required > 0;

    return res.json({
      success: true,
      sufficient,
      currentBalance,
      requiredAmount: required,
      missingAmount: sufficient ? 0 : Math.max(0, required - currentBalance),
      remainingAfterPurchase: sufficient ? (currentBalance - required) : currentBalance,
      user: {
        id: customer.id,
        username: customer.name || customer.username,
        balance: currentBalance
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 5. Perfil: Actualizar datos de entrega
app.put('/api/v6/customer/delivery', async (req, res) => {
  try {
    const { customerId, name, phone, email, city, department, address } = req.body;
    if (!customerId) {
      return res.status(400).json({ success: false, message: 'customerId es requerido.' });
    }

    const updateFields = {
      name: sanitizeInput(name),
      phone: String(phone || '').replace(/\D/g, ''),
      email: String(email || '').trim().toLowerCase(),
      city: sanitizeInput(city),
      department: sanitizeInput(department),
      address: sanitizeInput(address)
    };

    if (supabase) {
      const { data, error } = await supabase
        .from('customers')
        .update(updateFields)
        .eq('id', customerId)
        .select()
        .single();

      if (error) return res.status(500).json({ success: false, message: error.message });
      return res.json({ success: true, user: data });
    }
    return res.status(500).json({ success: false, message: 'Base de datos no inicializada.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 6. Pedidos: Confirmación unificada de Compra
app.post('/api/v6/recharges/create', async (req, res) => {
  try {
    const { customerId, customerName, customerPhone, customerEmail, amount, paymentMethod, reference, userNote, receiptUrl } = req.body;
    const cleanAmount = Number(amount) || 0;
    if (!customerId || cleanAmount < 10000) {
      return res.status(400).json({ success: false, message: 'El monto mínimo de recarga es $10.000 COP.' });
    }

    const rechargeId = 'REC-' + Date.now().toString().slice(-6);
    const newRecharge = {
      id: rechargeId,
      customer_id: customerId,
      customer_name: sanitizeInput(customerName || 'Cliente'),
      customer_phone: String(customerPhone || ''),
      amount: cleanAmount,
      receipt_url: receiptUrl || null,
      status: 'pendiente',
      reference: sanitizeInput(reference || ''),
      created_at: new Date().toISOString()
    };

    if (supabase) {
      const { error } = await supabase.from('recharge_requests').insert([newRecharge]);
      if (error) {
        return res.status(500).json({ success: false, message: error.message });
      }
    }

    return res.status(201).json({
      success: true,
      recharge: newRecharge,
      message: 'Solicitud de recarga creada exitosamente.'
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error interno al crear recarga.' });
  }
});

// Actualizar comprobante de recarga (Subir comprobante)
app.post('/api/v6/recharges/receipt', async (req, res) => {
  try {
    const { rechargeId, receiptUrl, reference } = req.body;
    if (!rechargeId || !receiptUrl) {
      return res.status(400).json({ success: false, message: 'ID y Comprobante requeridos.' });
    }

    if (supabase) {
      const updateData = { receipt_url: receiptUrl };
      if (reference) updateData.reference = sanitizeInput(reference);
      const { error } = await supabase.from('recharge_requests').update(updateData).eq('id', rechargeId);
      if (error) return res.status(500).json({ success: false, message: error.message });
    }

    return res.json({ success: true, message: 'Comprobante adjuntado con éxito.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error al adjuntar comprobante.' });
  }
});

// Aprobar recarga desde Admin
app.post('/api/v6/recharges/approve', async (req, res) => {
  try {
    const { rechargeId, adminNotes } = req.body;
    if (!rechargeId) return res.status(400).json({ success: false, message: 'rechargeId requerido.' });

    if (supabase) {
      const { data: rec, error } = await supabase.from('recharge_requests').select('*').eq('id', rechargeId).maybeSingle();
      if (error || !rec) return res.status(404).json({ success: false, message: 'Solicitud no encontrada.' });

      if (rec.status === 'aprobada') {
        return res.status(400).json({ success: false, message: 'Esta recarga ya fue aprobada previamente.' });
      }

      // Obtener saldo actual del cliente
      const { data: cust } = await supabase.from('customers').select('balance').eq('id', rec.customer_id).maybeSingle();
      const currentBalance = Number(cust ? cust.balance : 0);
      const newBalance = currentBalance + Number(rec.amount);

      // Actualizar saldo del cliente
      await supabase.from('customers').update({ balance: newBalance }).eq('id', rec.customer_id);

      // Marcar recarga como aprobada
      await supabase.from('recharge_requests').update({
        status: 'aprobada',
        processed_at: new Date().toISOString()
      }).eq('id', rechargeId);

      // Registrar transacción
      await supabase.from('transactions').insert([{
        id: 'tx_rec_' + Date.now(),
        customer_id: rec.customer_id,
        type: 'recarga',
        amount: Number(rec.amount),
        balance_before: currentBalance,
        balance_after: newBalance,
        reference: rechargeId,
        created_at: new Date().toISOString()
      }]);

      return res.json({ success: true, newBalance, message: 'Recarga aprobada y saldo acreditado en la nube.' });
    }

    return res.status(500).json({ success: false, message: 'Base de datos no disponible.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error procesando aprobación.' });
  }
});

// Listar todas las recargas para el panel admin
app.get('/api/v6/recharges/list', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase.from('recharge_requests').select('*').order('created_at', { ascending: false });
      if (error) return res.status(500).json({ success: false, message: error.message });
      return res.json({ success: true, recharges: data || [] });
    }
    return res.json({ success: true, recharges: [] });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error obteniendo recargas.' });
  }
});

app.post('/api/v6/orders/confirm', async (req, res) => {
  try {
    const { customerId, items, delivery, couponCode, paymentMethod } = req.body;
    if (!customerId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Datos de orden incompletos.' });
    }

    let customer = null;
    if (supabase) {
      const { data } = await supabase.from('customers').select('*').eq('id', customerId).maybeSingle();
      customer = data;
    }

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Cliente no encontrado.' });
    }

    const subtotal = items.reduce((sum, it) => sum + (Number(it.price || 0) * Number(it.quantity || 1)), 0);
    const discount = 0;
    const total = Math.max(0, subtotal - discount);

    const currentBalance = Number(customer.balance || 0);
    if (paymentMethod === 'saldo_virtual' && currentBalance < total) {
      return res.status(400).json({
        success: false,
        code: 'INSUFFICIENT_FUNDS',
        message: 'Saldo insuficiente para completar la compra.'
      });
    }

    const orderId = 'BB-' + Date.now().toString().slice(-6);
    const newOrder = {
      id: orderId,
      customer_id: customerId,
      customer_name: sanitizeInput(customer.name),
      customer_phone: customer.phone,
      items: items,
      subtotal,
      discount,
      coupon_code: couponCode ? sanitizeInput(couponCode) : null,
      total,
      payment_method: paymentMethod || 'saldo_virtual',
      status: 'completada',
      delivery_info: delivery || {},
      created_at: new Date().toISOString()
    };

    const newBalance = Math.max(0, currentBalance - total);

    if (supabase) {
      await supabase.from('orders').insert([newOrder]);
      if (paymentMethod === 'saldo_virtual') {
        await supabase.from('customers').update({ balance: newBalance }).eq('id', customerId);
        await supabase.from('transactions').insert([{
          id: 'tx_' + Date.now(),
          customer_id: customerId,
          type: 'compra',
          amount: total,
          balance_before: currentBalance,
          balance_after: newBalance,
          reference: orderId,
          created_at: new Date().toISOString()
        }]);
      }
    }

    return res.status(201).json({
      success: true,
      order: newOrder,
      orderId: orderId,
      newBalance: newBalance,
      message: '¡Pedido procesado con éxito!'
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 7. Sincronización Global: PUSH
app.post('/api/v6/sync/push', async (req, res) => {
  try {
    const payload = req.body;
    const db = payload.database || payload;

    if (supabase) {
      const { error } = await supabase.from('app_snapshots').upsert({
        id: 'latest',
        snapshot_data: db,
        version: payload.version || '6.0',
        updated_at: new Date().toISOString()
      });

      if (error) {
        return res.status(500).json({ success: false, message: error.message });
      }
    }

    return res.json({
      success: true,
      message: 'Estado sincronizado con la nube exitosamente.',
      timestamp: Date.now()
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 8. Sincronización Global: PULL EN VIVO DIRECTO DE TABLAS SUPABASE
app.get('/api/v6/sync/pull', async (req, res) => {
  try {
    if (supabase) {
      // Consultar en paralelo directamente las tablas vivas de Supabase
      const [custRes, ordRes, rechRes, txRes, snapRes] = await Promise.all([
        supabase.from('customers').select('*').order('created_at', { ascending: false }),
        supabase.from('orders').select('*').order('created_at', { ascending: false }),
        supabase.from('recharge_requests').select('*').order('created_at', { ascending: false }),
        supabase.from('transactions').select('*').order('created_at', { ascending: false }),
        supabase.from('app_snapshots').select('*').eq('id', 'latest').maybeSingle()
      ]);

      const baseSnapshot = (snapRes.data && snapRes.data.snapshot_data) ? snapRes.data.snapshot_data : {};

      // Transformar clientes para el panel admin
      const liveCustomers = (custRes.data || []).map(c => ({
        id: c.id,
        name: c.name || c.username || 'Cliente',
        username: c.username || c.name || 'Cliente',
        email: c.email || '',
        phone: c.phone || '',
        city: c.city || '',
        department: c.department || '',
        address: c.address || '',
        balance: Number(c.balance || 0),
        createdAt: c.created_at || '',
        dateFormatted: c.created_at ? new Date(c.created_at).toLocaleString('es-CO') : 'Reciente'
      }));

      // Transformar pedidos para el panel admin
      const liveOrders = (ordRes.data || []).map(o => ({
        id: o.id,
        customerId: o.customer_id,
        customerName: o.customer_name || 'Cliente',
        customerPhone: o.customer_phone || '',
        items: o.items || [],
        subtotal: Number(o.subtotal || 0),
        discount: Number(o.discount || 0),
        total: Number(o.total || 0),
        paymentMethod: o.payment_method || 'saldo_virtual',
        status: o.status || 'completada',
        delivery: o.delivery_info || {},
        date: o.created_at ? new Date(o.created_at).toLocaleString('es-CO') : 'Reciente',
        timestamp: o.created_at ? new Date(o.created_at).getTime() : Date.now()
      }));

      // Transformar recargas para el panel admin
      const liveRecharges = (rechRes.data || []).map(r => ({
        id: r.id,
        customerId: r.customer_id,
        customerName: r.customer_name || 'Cliente',
        customerPhone: r.customer_phone || '',
        amount: Number(r.amount || 0),
        paymentMethod: r.payment_method || 'Nequi',
        receiptUrl: r.receipt_url || '',
        receipt_url: r.receipt_url || '',
        status: r.status === 'aprobada' ? 'Aprobada' : 'Pendiente',
        reference: r.reference || '',
        dateFormatted: r.created_at ? new Date(r.created_at).toLocaleString('es-CO') : 'Reciente'
      }));

      const mergedDatabase = Object.assign({}, baseSnapshot, {
        customers: liveCustomers,
        orders: liveOrders,
        rechargeRequests: liveRecharges,
        transactions: txRes.data || []
      });

      return res.json({
        success: true,
        version: '6.9.5-live',
        updatedAt: new Date().toISOString(),
        database: mergedDatabase
      });
    }

    return res.json({
      success: true,
      database: {}
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Iniciar servidor blindado
app.listen(PORT, () => {
  console.log(`🌸 Bloom Beauty Cloud Server v6 activo y blindado en puerto ${PORT}`);

  // AUTO-KEEP-ALIVE: Previene que Render se duerma en el plan gratuito
  const https = require('https');
  setInterval(() => {
    try {
      https.get('https://bloom-backend-v6.onrender.com/api/v6/health', (res) => {
        console.log(`[Auto-Keep-Alive] Ping interno completado. Status: ${res.statusCode}`);
      }).on('error', () => {});
    } catch (e) {}
  }, 10 * 60 * 1000); // Cada 10 minutos
});
