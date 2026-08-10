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
npm test           # tests del robot + smoke test de la app (jsdom sobre app.js compilado)
npm run servir     # servidor local para probar la PWA
```

Deploy: push a `main` republica el sitio (GitHub Pages o Netlify conectado al repo).

## Reglas de oro

1. **Migraciones**: los usuarios ya tienen datos guardados. Cualquier cambio en listas,
   ítems o estructura DEBE agregarse a `migrate()` en `src/app.jsx` (idempotente,
   preservando `have`, `picked`, `spec` y precios). Historial: v2 mueve Huevo a Dietética
   y suma ítems de Farmacity · v3 opciones de Estructurales · v4 unifica el combo de
   carnicería · v5 campos de precio + foto embebida · v6 suma Piñones a Dietética/Perecederos ·
   v7 muda Salsa de pescado a Dietética/Muy duraderos (borra la sección "New Garden" vacía)
   y renombra Champiñones congelados → Hongos para cocinar.
2. **Service worker**: tras cualquier cambio en archivos cacheados (app.js, styles,
   index, íconos), subir la versión `changuito-vN` en `sw.js` o los celulares siguen
   viendo la versión vieja. Hoy va por **v10**. `precios.json` es red-primero: no requiere bump.
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
- COTO: el sitio nuevo (coto.com.ar) es una SPA; el catálogo se lee del buscador
  Constructor.io (`ac.cnstrc.com/search/...?key=` con la key pública del bundle).
  `listPrice` = precio del paquete POR SUCURSAL (en cortes "X KG" es $/kg); se toma la
  moda entre sucursales (hay outliers de data mala). Ítems compuestos: "Combo de
  temporada" (estacional, misma regla abr–sep que la app) y "Asado" (vacío o tapa, el
  más barato, + tira) se arman con `comboCoto()`/`asadoCoto()` sobre `PARTES_CARNE`.
- Dietética: frutosare.com.ar (WooCommerce) vía Store API pública
  (`/wp-json/wc/store/v1/products?search=...`; los productos variables llevan otra
  llamada `?type=variation&parent=ID` y el PESO se junta desde el padre), con
  newgarden.com.ar (Magento, POST GraphQL a `/graphql`) como RESPALDO cuando FA no
  tiene el producto; `fuente:"ng"` busca solo ahí (Salsa de pescado). Las notas de lo
  que sale del respaldo terminan en "· New Garden". Precios SOLO DE REFERENCIA: el
  usuario compra en dietéticas de barrio sin página. Criterio `cercano` en `elegir()`:
  cantidad del usuario × $/kg del paquete de tamaño más parecido (bandas de similitud;
  dentro de la banda gana el $/kg más barato) — NUNCA el paquete grande aunque sea más
  barato por kg (no puede stockearlo). `RECHAZO_DIET` filtra especieros/frascos caros
  (El Castillo, Dicomere, Natier…).
- Otros lugares (`ITEMS_OTROS`): Carmín (carmin.com.ar, TiendaNube → búsqueda
  server-rendered con JSON-LD, `paresDesdeTiendaNube`) para Hongos para cocinar;
  BonVino y Tienda Nova con página de producto FIJA (`url`) → `productoDePagina()`
  lee el bloque de analytics (`"item_name":"...","price":N`); el `must` verifica que
  la página siga siendo el producto correcto, si no queda el precio anterior.

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
- **COTO (ANDANDO desde 09/08/2026)**: harinas Chacabuco + carnicería vía Constructor.io
  (ver Sistema de precios). Mapeo de harinas CONFIRMADO por el usuario: "Harina 000 de
  fuerza" (W300, >13 % prot.) = producto "Harina Para Masa Madre Chacabuco" · "Harina
  0000 de fuerza" (Napolitana) = "Harina Trigo 00 Chacabuco". Carnicería, criterio
  CONFIRMADO: el precio de cada corte es POR KILO; los compuestos (Combo, Asado)
  muestran el $/kg de cada corte y suman "1 kg de c/u". "Achura" SIN precio por
  decisión del usuario ("por ahora"): es un pick de 6 opciones de valor muy dispar.
  Supuestos que quedan: Sémola 500 g (quedó Pureza, no hay Chacabuco) · precio = moda
  entre sucursales (si pasa el código de su sucursal de La Plata, filtrar `price[]`
  por `store`).
- **Dietética (ANDANDO desde 09/08/2026)**: 44/45 ítems con referencia (Frutos del Are
  + respaldo New Garden). Solo Achiote queda sin precio: no existe en ninguna de las
  dos. Formas CONFIRMADAS por el usuario (09/08/2026): comino EN GRANO · canela EN
  RAMA · hinojo EN SEMILLAS · pimienta negra = 50 g EN GRANO (el ítem se llama
  "Pimienta negra 50 g + 50 g" pero la referencia es solo en grano) · laurel de a
  25 g · Vainilla = LA CHAUCHA (no esencia) · almendras partidas OK (las prefiere,
  son más baratas) — nueces y cajú siguen enteros. "Huevo" queda SIN precio del robot
  a propósito: el usuario lo carga a mano al comprarlo (la edición manual se respeta
  porque el robot nunca escribe ese nombre). "Té a elección" excluido (askSpec
  variable). Piñones (ítem nuevo, migración v6) y Salsa de pescado (mudada a
  Dietética/Muy duraderos por migración v7) salen de New Garden.
- **Otros lugares (ANDANDO desde 09/08/2026)**: Hongos para cocinar (ex Champiñones,
  renombrado en v7) desde Carmín — ganó el MIX DE HONGOS IQF 500 g Biomac, supuesto:
  compra de ~500 g · Aceto balsámico Millán desde BonVino · Salsa de soja Lee Kum Kee
  premium desde Tienda Nova (páginas de producto fijas: si cambian la URL, avisar).
- **Verdulería**: sin precios por decisión del usuario ("por ahora exceptuá verdulería").
- **DIA, casos confirmados (09/08/2026)**: "Harina de maíz 1 kg" ES la Morixe para
  arepas (el nombre del producto no dice "maíz"; el must exige "arepas") · "Arvejas en
  lata" acepta cualquiera menos congeladas — en DIA las latas se llaman "Arvejas Secas
  Remojadas", por eso el reject viejo (/secas/) las mataba todas.
- **Próximos comercios**: Farmacity (VTEX, reusar `buscarVtex`).
- **Fase 2 posible**: botón "Actualizar precios" en la app vía Cloudflare Worker (proxy CORS).
- **Versión artefacto de Claude.ai**: existe una variante del fuente que usa
  `window.storage` (API de artefactos) en vez de `localStorage`. Ya no es la fuente de
  verdad; si hiciera falta regenerarla, son solo los dos bloques de carga/guardado en `App()`.

## El usuario

Responde bien a: cambios con migración incluida (nunca perderle datos), notas visibles
que expliquen cada precio ("→ 2× Molinos Ala 500 g · oferta -35%"), honestidad sobre lo
que no se pudo hacer y por qué, y tests que demuestren el criterio. Revisa los logs del
robot y reporta los ✘. Prefiere repo privado (deploy vía Netlify conectado).
