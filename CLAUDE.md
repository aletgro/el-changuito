# CLAUDE.md — El Changuito 🧺

Organizador de compras personal de Tomaguchi (La Plata, Argentina). PWA en React que
reemplaza un flujo previo en Trello: listas por comercio, modo compra, sugerencias de
estación y estimación de gasto con precios reales scrapeados. **Todo el proyecto (UI,
código, commits, respuestas) es en español rioplatense, con voseo.**

## Arquitectura

```
src/app.jsx                     ← FUENTE ÚNICA de la app (React, sin dependencias externas)
app.js                          ← bundle generado (npm run build) · NO editar a mano
index.html / styles.css         ← shell + utilidades CSS (subset tipo Tailwind escrito a mano)
sw.js                           ← service worker · CACHE = "changuito-vN" (ver Reglas de oro)
manifest.webmanifest / icon-*.png
precios.json                    ← foto de precios que la app descarga al abrir (red-primero en el SW)
scripts/actualizar-precios.mjs  ← robot de precios (Node 20, sin deps)
.github/workflows/precios.yml   ← corre el robot todos los días 6:00 AR + botón Run workflow
```

- **Persistencia**: `localStorage`, clave `el-changuito-v1`, forma `{ stores: [...] }`.
- **Modelo**: `stores[] → sections[] → items[]`. Ítem: `{ id, name, note, have, spec, price,
  priceNote, priceV }` + opcionales `type:"pick"` (con `options[]`, `picked[]`),
  `askSpec`, `dyn` ("combo"/"roast": notas estacionales de carnicería). Sección puede tener
  `banner:"carne"`. `have:false` = "por comprar" (aparece en la pestaña Comprar).
- **Estilos**: solo clases definidas en `styles.css` + estilos inline. Si usás una clase
  utilitaria nueva, agregala a `styles.css` (no hay compilador de Tailwind).

## Comandos

```bash
npm install        # una vez
npm run build      # src/app.jsx → app.js (obligatorio tras tocar la fuente)
npm run check      # sintaxis de la app y del robot
npm run precios    # corre el robot localmente (escribe precios.json)
npm test           # tests del robot (parseQty, lector de El Puente, criterio de elegir)
npm run servir     # servidor local para probar la PWA
```

Deploy: push a `main` republica el sitio (GitHub Pages o Netlify conectado al repo).

## Reglas de oro

1. **Migraciones**: los usuarios ya tienen datos guardados. Cualquier cambio en listas,
   ítems o estructura DEBE agregarse a `migrate()` en `src/app.jsx` (idempotente,
   preservando `have`, `picked`, `spec` y precios). Historial: v2 mueve Huevo a Dietética
   y suma ítems de Farmacity · v3 opciones de Estructurales · v4 unifica el combo de
   carnicería · v5 campos de precio + foto embebida.
2. **Service worker**: tras cualquier cambio en archivos cacheados (app.js, styles,
   index, íconos), subir la versión `changuito-vN` en `sw.js` o los celulares siguen
   viendo la versión vieja. Hoy va por **v9**. `precios.json` es red-primero: no requiere bump.
3. **Los nombres de ítems son claves**: `precios.json` y el robot matchean por el `name`
   exacto del ítem (tildes incluidas). Renombrar un ítem rompe su precio → actualizar
   también `ITEMS`/`ITEMS_ELPUENTE` en el robot, la `PRICES` embebida y agregar migración.
4. **Criterio de precios** (definido por el usuario): el más barato normalizado por kg/L
   entre tamaños similares (ventana 0.2×–3.5×), redondeando paquetes hacia arriba para
   cubrir la cantidad (ej. 2× 500 g para 1 kg). Quesos de mostrador: `fraccionado:true`
   estima la fracción (`qty` en kg). Preferencias fijas: papas fritas **solo tubo**.
5. **Temporada**: calendario del hemisferio sur (zona pampeana), datos en `SEASON`.
   Fuera de temporada NO se muestra etiqueta (silencio, nunca "fuera de temporada").
   La carnicería de COTO cambia sola: frío (abr–sep) = falda+osobuco / calor = marucha+arañita.
6. **`askSpec`** (campo "qué buscar" al activar) es solo para: Café, Crema rosácea,
   Proteína, Queso premium, Fiambre, Té a elección. No generalizarlo.
7. **Ediciones manuales de precio** en la app llevan `priceV: "manual@" + versión` y se
   respetan hasta que llegue una foto de precios más nueva (que pisa todo).
8. **Tests**: no hay framework; el patrón usado es smoke-tests con `jsdom` (mock de
   `localStorage` y `fetch`, eval de `app.js`, asserts sobre `textContent`) y tests de
   `elegir()`/`parseQty()` importando el robot con listados simulados
   (`scripts/test-precios.mjs`, se corren con `npm test`). Ante cambios de
   lógica, escribir uno de esos antes de dar por cerrado.

## Sistema de precios

- La app aplica al abrir: `PRICES` embebida (fallback) → `precios.json` del sitio
  (versión más nueva gana). Función central: `applyPrices(stores, prices, version)`.
- El robot: DIA vía API pública de VTEX (`/api/catalog_system/pub/products/search/?ft=...`)
  con fallback a páginas de categoría HTML (`cat` en la config). Conserva el precio
  anterior si un ítem no matchea; nunca escribe si TODO falló.
- Farmacity también es VTEX → para sumarla, reusar `buscarVtex("https://www.farmacity.com", q)`.
- COTO (cotodigital) es HTML propio → pendiente, requiere lector dedicado.

## Estado actual y pendientes

- **El Puente (ANDANDO desde 09/08/2026)**: el listado "consumo familiar" se lee de
  `GET /productos/get/{rubro_id}` (fragmentos HTML; los rubro_id se descubren en los
  botones `data-rubro-id` del home, con lista fija de respaldo). Claves del criterio:
  los quesos se publican "Valor por kg …" → es precio POR KG aunque el nombre traiga
  el peso de la horma (lo maneja `elegir()`); para compra al mostrador solo valen las
  líneas "fraccionado/fracc." (la horma entera tiene otro precio); Provoletta se vende
  en piezas de ~190 g (2 piezas ≈ 300 g). Si el sitio cambia y no se lee nada, se
  imprime diagnóstico; atajo: pedir al usuario la URL XHR de la pestaña Red (F12).
  Criterios confirmados por el usuario (09/08/2026): SOLO marca El Puente (sin D70 ni
  otras marcas del listado) · Fundente ~800 g por vez · Pizza solo mozzarella (400 g) ·
  Crema 2 potes del tamaño más barato POR LITRO (220 o 330 cc, campo `comparaPor`) ·
  Leche solo entera, 2 sachets de 1 L. Siguen asumidos: picada 300 g, rayar 300 g,
  provoleta 2× 190 g.
- **Verdulería**: sin precios por decisión del usuario ("por ahora exceptuá verdulería").
- **Harina de maíz**: matcheada a Morixe p/arepas con nota "¿es esta la que usás?" — confirmar.
- **Próximos comercios**: COTO (carnicería + harinas Chacabuco, la compra más pesada) y
  Farmacity. Después de El Puente.
- **Fase 2 posible**: botón "Actualizar precios" en la app vía Cloudflare Worker (proxy CORS).
- **Versión artefacto de Claude.ai**: existe una variante del fuente que usa
  `window.storage` (API de artefactos) en vez de `localStorage`. Ya no es la fuente de
  verdad; si hiciera falta regenerarla, son solo los dos bloques de carga/guardado en `App()`.

## El usuario

Responde bien a: cambios con migración incluida (nunca perderle datos), notas visibles
que expliquen cada precio ("→ 2× Molinos Ala 500 g · oferta -35%"), honestidad sobre lo
que no se pudo hacer y por qué, y tests que demuestren el criterio. Revisa los logs del
robot y reporta los ✘. Prefiere repo privado (deploy vía Netlify conectado).
