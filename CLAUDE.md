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
  priceNote, priceD, priceV }` (`priceD` = variación en $ contra la foto anterior; la
  pinta `DeltaBadge` como ▲/▼ con porcentaje, y se limpia al editar a mano) + opcionales
  `type:"pick"` (con `options[]`, `picked[]`),
  `askSpec`, `askPrice` (pide el precio pagado al marcarlo comprado y acumula
  `priceHist:[{p,t}]`, últimos 12 pagos — hoy solo Huevo), `dyn` ("combo"/"roast":
  notas estacionales de carnicería). Sección puede tener
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
   y renombra Champiñones congelados → Hongos para cocinar · v8 suma Alcohol en gel a
   Farmacity/Higiene · v9 `askPrice` en Huevo y siembra `priceHist` desde el precio
   manual previo (fecha tomada del propio `priceV`).
2. **Service worker**: tras cualquier cambio en archivos cacheados (app.js, styles,
   index, íconos), subir la versión `changuito-vN` en `sw.js` o los celulares siguen
   viendo la versión vieja. Hoy va por **v12**. `precios.json` es red-primero: no requiere bump.
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
   Proteína, Queso premium, Fiambre, Té a elección. No generalizarlo. Ídem `askPrice`
   (precio pagado al comprar, con historial): solo Huevo.
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
- Variación diaria: cada entrada de `precios.json` puede llevar `d` (diferencia en $
  contra la foto anterior, `conDelta()`); ausente = precio sin cambios. OJO: correr el
  robot DOS veces el mismo día pisa las flechas (la segunda compara contra la primera).
  Los ✔ del log muestran la flecha (`▲ +$…` / `▼ -$…`) para revisar de un vistazo.
- Promos VTEX "llevando N" (2x1, 3x2, 2da unidad al X%): NO vienen aplicadas en `Price`,
  viajan en `Teasers`/`PromotionTeasers`; `promoVtex()` las detecta y suma un candidato
  extra con el precio EFECTIVO por unidad y la condición a la vista en la nota
  ("· 2x1 llevando 2"). Los `DiscountHighLight` ya están aplicados al precio: ignorarlos.
  Vale para DIA y Farmacity (comparten `buscarVtex`).
- Farmacity es VTEX como DIA (`ITEMS_FARMACITY` reusa `buscarVtex`). El campo
  `comparaPor` normaliza el "mejor precio" por lo que corresponde: máquinas y
  preservativos por unidad, enjuague por litro, hilo por metro, pasta por kg.
  OJO con rejects tipo /ni[ñn]/: "Whitening" contiene "nin" — usar /ni[ñn][oa]/.
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
  a propósito: al marcarlo comprado la app pregunta cuánto pagó (`askPrice`, desde
  11/08/2026) y guarda historial para comparar; el robot nunca escribe ese nombre,
  así que el precio pagado no se pisa. "Té a elección" excluido (askSpec
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
- **Farmacity (ANDANDO desde 09/08/2026)**: 16/16 ítems (incluye Alcohol en gel,
  migración v8, mejor precio por litro). Preferencias CONFIRMADAS del
  usuario: Desodorante = Old Spice EN BARRA solamente (rechazo aerosol/spray/ml) ·
  Máquina de afeitar = 3 filos, mejor precio POR UNIDAD (hoy gana un pack "Enjoy Mujer
  x 5"; el usuario no pidió filtrar por género — validar si molesta) · Preservativos =
  Prime Mega (en Farmacity: "Preservativo de Látex Mega") · Alcohol = 96° (decidido
  09/08/2026: tiene alcohol en gel para manos, el líquido es para limpieza; el 70 %
  ya diluido queda excluido por must /96/). Supuestos a validar: Crema humectante =
  facial (Pond's) · Gel de limpieza = facial. No quedan comercios pendientes.
- **Fase 2 posible**: botón "Actualizar precios" en la app vía Cloudflare Worker (proxy CORS).
- **Versión artefacto de Claude.ai**: existe una variante del fuente que usa
  `window.storage` (API de artefactos) en vez de `localStorage`. Ya no es la fuente de
  verdad; si hiciera falta regenerarla, son solo los dos bloques de carga/guardado en `App()`.

## El usuario

Responde bien a: cambios con migración incluida (nunca perderle datos), notas visibles
que expliquen cada precio ("→ 2× Molinos Ala 500 g · oferta -35%"), honestidad sobre lo
que no se pudo hacer y por qué, y tests que demuestren el criterio. Revisa los logs del
robot y reporta los ✘. Prefiere repo privado (deploy vía Netlify conectado).
