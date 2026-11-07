const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Inicialización de Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes('TU-PROYECTO')) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('✅ Cliente Supabase inicializado correctamente.');
  } catch (err) {
    console.error('❌ Error conectando a Supabase:', err.message);
  }
} else {
  console.warn('⚠️ SUPABASE_URL o SUPABASE_KEY no configurados. Operando en modo memoria temporal.');
}

// Almacén en memoria de respaldo si Supabase no está configurado aún
let inMemoryDB = {
  storeInfo: {
    name: 'Bloom Beauty',
    slogan: 'Realza tu belleza natural',
    phone: '3135143012',
    email: 'contacto@bloombeauty.com'
  },
  products: [],
  brands: [],
  customers: [],
  orders: [],
  expenses: [],
  recharges: [],
  reviews: [],
  offers: [],
  bugs: [],
  sessions: [],
  transactions: []
};

// ============================================================================
// RUTAS DE LA API (Compatibles 100% con BloomDB v6)
// ============================================================================

// 1. Health check & Diagnostics
app.get('/api/v6/health', (req, res) => {
  res.json({
    engine: 'BloomServerV6',
    status: 'online',
    version: '6.0.0',
    platform: 'Render + Node.js',
    database: supabase ? 'Supabase (PostgreSQL)' : 'In-Memory Cache (Configura Supabase)',
    timestamp: new Date().toISOString()
  });
});

// 2. Autenticación: Registro
app.post('/api/v6/auth/register', async (req, res) => {
  try {
    const { username, name, phone, email, city, department, address, password, passwordHash } = req.body;
    const finalName = (username || name || '').trim();
    const finalPhone = String(phone || '').replace(/\D/g, '');
    const finalEmail = String(email || '').trim().toLowerCase();

    if (!finalName || !finalPhone || !finalEmail) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_FIELDS',
        message: 'Nombre, teléfono y correo electrónico son obligatorios.'
      });
    }

    const customerId = 'cust_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    const newCustomer = {
      id: customerId,
      name: finalName,
      username: finalName,
      phone: finalPhone,
      email: finalEmail,
      city: city || '',
      department: department || '',
      address: address || '',
      password: password || '',
      password_hash: passwordHash || '',
      balance: 0,
      created_at: new Date().toISOString()
    };

    if (supabase) {
      // Verificar si ya existe correo
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .or(`email.eq.${finalEmail},phone.eq.${finalPhone}`)
        .maybeSingle();

      if (existing) {
        return res.status(409).json({
          success: false,
          code: 'USER_EXISTS',
          message: 'Ya existe una cuenta registrada con este correo o teléfono.'
        });
      }

      const { error } = await supabase.from('customers').insert([newCustomer]);
      if (error) {
        console.error('Error insertando cliente en Supabase:', error);
        return res.status(500).json({ success: false, message: error.message });
      }
    } else {
      const exists = inMemoryDB.customers.find(c => c.email === finalEmail || c.phone === finalPhone);
      if (exists) {
        return res.status(409).json({
          success: false,
          code: 'USER_EXISTS',
          message: 'Ya existe una cuenta con ese correo o teléfono.'
        });
      }
      inMemoryDB.customers.push(newCustomer);
    }

    return res.status(201).json({
      success: true,
      user: {
        id: customerId,
        username: finalName,
        name: finalName,
        phone: finalPhone,
        email: finalEmail,
        city,
        department,
        address,
        balance: 0
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 3. Autenticación: Inicio de Sesión
app.post('/api/v6/auth/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const cleanId = String(identifier || '').trim().toLowerCase();
    const cleanPhone = String(identifier || '').replace(/\D/g, '');

    if (!cleanId || !password) {
      return res.status(400).json({
        success: false,
        message: 'Ingresa correo o teléfono junto con la contraseña.'
      });
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
        return res.status(401).json({
          success: false,
          code: 'INVALID_CREDENTIALS',
          message: 'Usuario o contraseña incorrectos.'
        });
      }
      customer = data;
    } else {
      customer = inMemoryDB.customers.find(c =>
        c.email.toLowerCase() === cleanId || c.phone === cleanPhone
      );
      if (!customer) {
        return res.status(401).json({
          success: false,
          code: 'INVALID_CREDENTIALS',
          message: 'Usuario o contraseña incorrectos.'
        });
      }
    }

    // Comprobar contraseña
    const isValidPass = (customer.password === password) ||
      (customer.password_hash && customer.password_hash.includes(password));

    if (!isValidPass) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Contraseña incorrecta.'
      });
    }

    return res.json({
      success: true,
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
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 4. Billetera: Verificar Saldo
app.post('/api/v6/wallet/verify', async (req, res) => {
  try {
    const { customerId, requiredAmount } = req.body;
    let customer = null;

    if (supabase) {
      const { data } = await supabase.from('customers').select('*').eq('id', customerId).maybeSingle();
      customer = data;
    } else {
      customer = inMemoryDB.customers.find(c => c.id === customerId);
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
      name,
      phone: String(phone || '').replace(/\D/g, ''),
      email: String(email || '').trim().toLowerCase(),
      city,
      department,
      address
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
    } else {
      const cust = inMemoryDB.customers.find(c => c.id === customerId);
      if (!cust) return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
      Object.assign(cust, updateFields);
      return res.json({ success: true, user: cust });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 6. Pedidos: Confirmación unificada de Compra
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
    } else {
      customer = inMemoryDB.customers.find(c => c.id === customerId);
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
      customer_name: customer.name,
      customer_phone: customer.phone,
      items: items,
      subtotal,
      discount,
      coupon_code: couponCode || null,
      total,
      payment_method: paymentMethod || 'saldo_virtual',
      status: 'completada',
      delivery_info: delivery || {},
      created_at: new Date().toISOString()
    };

    const newBalance = Math.max(0, currentBalance - total);

    if (supabase) {
      // Insertar orden y actualizar saldo en Supabase
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
    } else {
      inMemoryDB.orders.unshift(newOrder);
      if (paymentMethod === 'saldo_virtual') {
        customer.balance = newBalance;
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

// 7. Sincronización Global: PUSH (Panel Admin / Cliente envían cambios a la Nube)
app.post('/api/v6/sync/push', async (req, res) => {
  try {
    const payload = req.body;
    const db = payload.database || payload;

    if (supabase) {
      // Guardar el snapshot consolidado en Supabase
      const { error } = await supabase.from('app_snapshots').upsert({
        id: 'latest',
        snapshot_data: db,
        version: payload.version || '6.0',
        updated_at: new Date().toISOString()
      });

      if (error) {
        console.error('Error guardando snapshot en Supabase:', error);
        return res.status(500).json({ success: false, message: error.message });
      }
    } else {
      inMemoryDB = Object.assign({}, inMemoryDB, db);
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

// 8. Sincronización Global: PULL (Panel Admin / Cliente descargan el estado de la Nube)
app.get('/api/v6/sync/pull', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('app_snapshots')
        .select('*')
        .eq('id', 'latest')
        .maybeSingle();

      if (error) {
        return res.status(500).json({ success: false, message: error.message });
      }

      if (data && data.snapshot_data) {
        return res.json({
          success: true,
          version: data.version,
          updatedAt: data.updated_at,
          database: data.snapshot_data
        });
      }
    }

    return res.json({
      success: true,
      database: inMemoryDB
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🌸 Bloom Beauty Cloud Server v6 activo en puerto ${PORT}`);
});
