# Bloom Beauty v6 - Servidor Cloud Backend

Servidor Node.js (Express) optimizado para despliegue en **Render** con base de datos en **Supabase (PostgreSQL)** y clientes en **Netlify**.

## Despliegue en Render (Paso a Paso)

1. Sube esta carpeta (`bloom-backend-v6`) a un repositorio en tu **GitHub**.
2. Entra a [dashboard.render.com](https://dashboard.render.com/) y haz clic en **New +** -> **Web Service**.
3. Selecciona tu repositorio de GitHub.
4. Render detectará automáticamente el archivo `render.yaml` o configúralo como:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. En la sección **Environment Variables**, añade:
   - `SUPABASE_URL`: Tu URL del proyecto Supabase (ejemplo: `https://xyzproject.supabase.co`).
   - `SUPABASE_KEY`: Tu clave `service_role` o `anon key` de Supabase.
6. Haz clic en **Deploy Web Service**.
7. Render te dará tu URL pública, por ejemplo: `https://bloom-backend-v6.onrender.com`.

## Configuración en Supabase

1. Entra a [supabase.com](https://supabase.com) y crea tu proyecto.
2. Abre la pestaña **SQL Editor**.
3. Pega y ejecuta el contenido del archivo `supabase_schema.sql`.
4. Ve a **Project Settings** -> **API** para copiar tu URL y tu clave API.
