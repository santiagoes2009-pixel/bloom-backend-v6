/**
 * BLOOM BEAUTY v6 - SERVICIO AUTOMÁTICO KEEP-ALIVE 24/7
 * 
 * Este script envía una solicitud GET cada 10 minutos al servidor backend en Render:
 * https://bloom-backend-v6.onrender.com/api/v6/health
 * 
 * Evita que el servidor gratuito de Render se suspenda ("duerma") por inactividad.
 */

const https = require('https');

const TARGET_URL = 'https://bloom-backend-v6.onrender.com/api/v6/health';
const INTERVAL_MS = 10 * 60 * 1000; // 10 minutos exactos

function getTimestamp() {
  return new Date().toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

function pingServer() {
  const start = Date.now();
  const timeStr = getTimestamp();

  console.log(`[${timeStr}] 📡 Enviando ping automático a Render...`);

  const req = https.get(TARGET_URL, { timeout: 60000 }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      const latency = Date.now() - start;
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log(`[${timeStr}] 🌸 ÉXITO: Servidor 100% ACTIVO | HTTP ${res.statusCode} | Latencia: ${latency}ms`);
      } else {
        console.warn(`[${timeStr}] ⚠️ AVISO: El servidor respondió con estado ${res.statusCode} | Latencia: ${latency}ms`);
      }
    });
  });

  req.on('timeout', () => {
    console.warn(`[${timeStr}] ⏳ Tiempo de espera agotado (servidor despertando). Cancelando intento...`);
    req.destroy();
  });

  req.on('error', (err) => {
    console.error(`[${timeStr}] ❌ Error conectando con Render: ${err.message}`);
  });
}

console.log('================================================================');
console.log('🌸 BLOOM BEAUTY - GUARDIÁN DE ACTIVIDAD CLOUD (KEEP-ALIVE 24/7)');
console.log('Objetivo: ' + TARGET_URL);
console.log('Frecuencia: Cada 10 minutos de forma continua');
console.log('================================================================\n');

// 1. Ejecutar primer ping de inmediato
pingServer();

// 2. Programar repetición automática cada 10 minutos
setInterval(pingServer, INTERVAL_MS);
