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
scripts/mercado-central.mjs     ← precios MAYORISTAS del Mercado Central (Node 20, sin deps); el robot lo importa
precios-mayoristas/ultimo.json  ← salida de ese script: último día publicado, todas las especies (+ .csv)
.github/workflows/precios.yml   ← corre el robot todos los días 6:00 AR + botón Run workflow
```

- **Persistencia**: `localStorage`, clave `el-changuito-v1`, forma `{ stores: [...] }`.
- **Modelo**: `stores[] → sections[] → items[]`. Ítem: `{ id, name, note, have, spec, price,
  priceNote, priceD, priceV }` (`priceD` = variación en $ contra la foto anterior; la
  pinta `DeltaBadge` como ▲/▼ con porcentaje, y se limpia al editar a mano), `priceMC`
  (solo Verdulería: `{ p: $/kg mayorista del Mercado Central, f: "dd/mm/aaaa", n?: etiqueta }`,
  lo pinta `MCLine` como línea aparte del precio minorista; en los picks va por opción en
  `priceOp[nombre].mc`), `priceLinks` (`[{ url, n? }]`: página del producto en el sitio de
  origen, desde `url`/`urls` de `precios.json`; la pinta `LinkChips` como píldora
  "ver en COTO ↗" bajo la nota de precio en Listas y Comprar, una por corte en Combo/Asado
  ("falda ↗ · osobuco ↗") y solo "↗" en cada opción con precio de un pick; abre en otra
  pestaña y frena el click de la fila), `priceOnline` (desde `online` de `precios.json`:
  el descuento o la promo solo vale comprando por internet; chip "solo online" junto al
  precio en Listas, Comprar y el resumen de precios, y "· solo online" en la opción de un
  pick) + opcionales
  `type:"pick"` (con `options[]`, `picked[]`),
  `askSpec`, `askPrice` (pide el precio pagado al marcarlo comprado y acumula
  `priceHist:[{p,t}]`, últimos 12 pagos — hoy solo Huevo), `dyn` ("combo"/"roast":
  notas estacionales de carnicería). Sección puede tener
  `banner:"carne"`. `have:false` = "por comprar" (aparece en la pestaña Comprar).
- **Estilos**: solo clases definidas en `styles.css` + estilos inline. Si usás una clase
  utilitaria nueva, agregala a `styles.css` (no hay compilador de Tailwind).
- **Táctil (la app se usa en celular)**: todo lo tocable con blanco de toque de 32–44 px
  (chips y links chicos llevan `padding`/`minHeight`, el círculo de comprado es de 40 px,
  las filas de Listas se tocan enteras); inputs con `fontSize: 16` (iOS hace zoom con
  menos) y 40 px de alto; nav inferior y `main` con `env(safe-area-inset-bottom)`;
  feedback al presionar con la clase `presionable`; grises de texto interactivo
  `#8A8170` (el `#A39B89` es solo decorativo).
- **Buscador de Listas** (12/09/2026): `Buscador` (input `type=search`, 44 px, sticky arriba
  de las tarjetas, cruz propia) + `buscarItems()`: desde 2 letras, sin tildes ni
  mayúsculas, por nombre o por opción de un pick. Mientras se busca, las tarjetas se
  esconden y los resultados van agrupados por comercio con la misma `DisplayRow` (prop
  `contexto` = "sección · opción X"): tocar la fila cambia `have` igual que en las listas.
- **Picks largos en Comprar** (12/09/2026): con más de 10 opciones, `PickPending` arranca
  compacto con las primeras 8 (el orden es plena temporada → temporada → sin dato → fuera,
  así que son las de estación) y la píldora "ver las N ▾" / "ver menos ▴" despliega la lista
  completa a pedido, con o sin precios por opción; lo ya elegido queda a la vista al
  compactar. Hoy solo Fruta (26) lo usa.

## Comandos

```bash
npm install        # una vez
npm run build      # src/app.jsx → app.js (obligatorio tras tocar la fuente)
npm run check      # sintaxis de la app y del robot
npm run precios    # corre el robot localmente (escribe precios.json)
npm run mayoristas # último día publicado por el Mercado Central → precios-mayoristas/ultimo.json y .csv
                   #   (`-- --mes 2026-09` o `-- --todos` para un mes entero, día por día)
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
   manual previo (fecha tomada del propio `priceV`) · v10 renombra en DIA
   "Vinagre de manzana 1 L" → "Vinagre de manzana 500 ml" (envase real) y
   "Esponja" → "Esponja salvauñas" · v11 suma el comercio Frigorífico Pesce
   (Salmón, Langostinos, Mejillones), antes de Gustitos · v12 suma Pollo entero
   (refrigerado) a COTO/Carnicería · v13 suma la sección Papelera a Otros lugares
   (bolsas y contenedores, sin precios: papelera de barrio sin página) · v14 suma
   Film transparente, Papel aluminio y Papel manteca a DIA/Otros (el rollo más
   barato: el usuario NO quiere comparar por metro) · v15 COTO: la sección
   "Almacén · harinas Chacabuco" pasa a "Harinas Chacabuco" y nace "Almacén"
   (primera) con Extracto de tomate. · v16 renombra "Aceite de girasol 1 L" → "Aceite de girasol"
   (UNA botella de la más barata POR LITRO, del tamaño que sea — no la más barata en $;
   `comparaPor:"l"`; la promo "llevando 2" cuenta) · v17 suma Comida para gatos y Piedras
   sanitarias para gatos a Otros lugares/Tercero (sin precio: Tercero no tiene página;
   crea la sección primera si el celular no la tiene) · v18 suma Guantes grandes a
   DIA/Limpieza e higiene, antes de Jabón Dove (talle grande solamente; el paquete más
   barato; crea la sección después de Almacén si falta) · v19 suma la opción Nabo al pick
   Verdulería/Contundentes, en orden alfabético (ni DIA ni COTO lo venden: solo lleva la
   referencia del Mercado Central, especie NABO).
2. **Service worker**: tras cualquier cambio en archivos cacheados (app.js, styles,
   index, íconos), subir la versión `changuito-vN` en `sw.js` o los celulares siguen
   viendo la versión vieja. Hoy va por **v22**. `precios.json` es red-primero: no requiere bump.
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
   La pestaña Temporada arranca en el mes actual y tiene una tira de 12 letras (E F M A
   M J J A S O N D) para consultar cualquier otro mes, con "volver a hoy"; el mes de
   hoy queda marcado con borde aunque se esté mirando otro.
6. **`askSpec`** (campo "qué buscar" al activar) es solo para: Café, Crema rosácea,
   Proteína, Queso premium, Fiambre, Té a elección. No generalizarlo. Ídem `askPrice`
   (precio pagado al comprar, con historial): solo Huevo.
7. **Ediciones manuales de precio** llevan `priceV: "manual@" + versión` y se respetan
   hasta que llegue una foto de precios más nueva (que pisa todo). Desde 20/08/2026 la
   app NO tiene modo Editar (el usuario lo pidió: sin renombrar/agregar/borrar ítems ni
   tocar precios a mano); la única entrada manual que queda es `askPrice` (Huevo).
8. **Tests**: no hay framework; el patrón usado es smoke-tests con `jsdom` (mock de
   `localStorage` y `fetch`, eval de `app.js`, asserts sobre `textContent`) y tests de
   `elegir()`/`parseQty()` importando el robot con listados simulados
   (`scripts/test-precios.mjs`, se corren con `npm test`); el lector del Mercado
   Central tiene los suyos con ZIP y planillas BIFF2 sintéticas
   (`scripts/test-mercado-central.mjs`). Ante cambios de lógica, escribir uno de
   esos antes de dar por cerrado.

## Sistema de precios

- La app aplica al abrir: `PRICES` embebida (fallback) → `precios.json` del sitio
  (versión más nueva gana). Función central: `applyPrices(stores, prices, version)`.
- El robot: DIA vía API pública de VTEX (`/api/catalog_system/pub/products/search/?ft=...`)
  con fallback a páginas de categoría HTML (`cat` en la config). `buscarVtex()` PAGINA de
  a 50 leyendo el total del header `resources` (tope 500): hasta el 09/09/2026 solo leía
  la primera página y en Farmacity "pasta dental" (147 resultados) la Oral B 4 en 1 de
  180 g a $3.351 quedaba en la segunda; "desodorante" tiene 450. Conserva el precio
  anterior si un ítem no matchea; nunca escribe si TODO falló.
- Página del producto ("ver en el navegador", pedido 07/09/2026): cada candidato lleva
  `url` (VTEX `link` · COTO `https://www.coto.com.ar/productos/<slug>/` + `data.url` (`urlCoto()`; la ruta en singular NO renderiza el producto, verificado 07/09/2026) · Frutos del
  Are `permalink` (la variación trae el peso preseleccionado) · New Garden `url_key` +
  `url_suffix` · TiendaNube `offers.url` · páginas fijas: la propia `url` del ítem) vía
  `conUrl()` (solo agrega la clave si existe: los `deepEqual` de los tests no cambian);
  `elegir()`, `elegirVerdura()`/`mejorVerdura()` y `notaPorKg()` la conservan en el
  ganador y viaja en `precios.json` como `url` (ítems simples y `op[nombre].url` en los
  picks; el pick lleva la de su opción más barata) o `urls: [{ n, url }]` en Combo/Asado
  (una por corte). El Puente publica un listado sin páginas por producto: sin `url`.
- Variaciones de precio: cada entrada de `precios.json` puede llevar `d` (diferencia
  en $) y `dv` (fecha del cambio, `conDelta()`). La variación se CONSERVA mientras el
  precio no vuelva a cambiar (correr el robot dos veces ya no la pisa); la app la
  considera "reciente" por 4 días (`DIAS_AVISO`): muestra el badge ▲/▼ con "hace Nd"
  y arma la tarjeta "Oportunidades" en Comprar — pendientes que bajaron (¡es el
  momento!), en stock que bajaron (botón "+ a Comprar") y pendientes que subieron
  (⚠ sobreprecio). Compacta (08/09/2026, las listas empujaban la compra fuera de
  pantalla): el título lleva las cuentas ("· 2 que necesitás · 9 que ya tenés"), cada
  lista de pendientes muestra hasta 3 filas y el resto va detrás de la píldora "ver las
  N ▾", y lo que ya tenés queda plegado entero en "Ya los tenés y bajaron · N ▾". Cambios de CRITERIO (otro producto elegido) van sin `d`: no son
  movimientos de mercado. El log del robot solo flecha lo que cambió HOY.
- Descuentos por día de semana (vigente 08/2026: DIA martes -20%, miércoles -10%
  y jueves -15% ·
  El Puente lun a vie -20% con TOPE de $6.000 de descuento · COTO mar -20%, mié -15%,
  jue -30% y vie -25% SIN carnicería ni harinas comunes): se EDITAN en `DESCUENTOS`
  al tope del robot (pueden cambiar días, porcentajes, topes o comercios; clave = id
  del comercio en la app; `dia:"martes"` para un día o `dias:[...]` para un rango,
  `tope` opcional en $; si la promo excluye partes del comercio, la config es
  `{ sin: { secciones: [...], items: [...] }, promos: [...] }` con nombres exactos
  de la app) y viajan en `precios.json` (campo `descuentos`). La app aclara en la
  tarjeta cuánto de lo pendiente queda afuera ("no aplica a $…"). La app
  muestra en Comprar el precio por día en cada ítem ("mar $…" / "lun-vie $…"), el
  subtotal por día en la tarjeta (recortado al tope si corresponde), resalta si el
  descuento es HOY, y AVISA con ⚠ cuando lo pendiente supera lo que el tope devuelve
  (compra óptima = tope ÷ pct). El "Total estimado" muestra además el total CON los
  dtos de hoy (la mejor promo vigente hoy por comercio, tope incluido) y el ahorro.
  `DESCUENTOS_SNAPSHOT` en `src/app.jsx` es solo el respaldo sin red: mantener a
  mano con el robot cuando cambie la promo.
- **Solo online** (pedido 09/09/2026): DIA/Farmacity lo anuncian en el NOMBRE del teaser o
  del highlight ("2x1 Solo Web#…", "-50% Solo Web#…"; `ONLINE_RE` en el robot, mirando
  `DiscountHighLight`+`clusterHighlights` para el descuento ya aplicado y
  `Teasers`+`PromotionTeasers` para la promo "llevando N"); COTO en `sale_type`
  "Exclusivas" y las imágenes `saleImageN` OfertaDigital/ExclusivoDigital. El candidato
  lleva `online: true` (`conOnline()`), `elegir()`/`notaPorKg()`/`elegirVerdura()` lo
  conservan, la nota termina en "· solo online" (en Combo/Asado "(solo online)" por corte)
  y viaja en `precios.json` como `online` (también en `op[nombre].online`).
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
  moda entre sucursales (hay outliers de data mala). **SKUs fantasma** (desde 07/09/2026):
  el catálogo trae productos con precio en todas las sucursales pero `store_availability`
  VACÍO (la "Cebolla Premium Xkg" a $999, las bolsas a $299, la Sémola COTO en 2x1, el
  tomate cherry a $7.499): no se venden en ninguna y no aparecen en el sitio →
  `paresDesdeCoto()` los descarta (si el campo falta, no filtra). **Pesables**
  (`product_weighable: 1`, se cobran por KGS): el candidato lleva `pesable: true` y
  `elegir()`/`elegirVerdura()` toman `listPrice` como precio POR KILO aunque el nombre
  diga "Bolsa Entre 1,5 Kg A 2 Kg" (la papa, 08/09/2026: antes se dividía por 1,5). Las OFERTAS no tocan `listPrice`:
  viajan en `data.discounts[]` (`discountText` "15%Dto"/"2x1", `discountPrice`,
  `takingText` "Llevando N" o null) — `promoCoto()` las lee: la directa REEMPLAZA el
  precio (nota "oferta -X%"), la de "llevando N" suma un candidato aparte con el
  precio efectivo, igual que las promos VTEX. Ítems compuestos: "Combo de
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
- Frigorífico Pesce (`ITEMS_PESCE`, tiendapesce.com.ar, TiendaNube): búsqueda con
  JSON-LD como Carmín; TODO se vende por kilo ("x kilo" = 1 kg en `parseQty`) y lo
  AGOTADO se filtra por `availability` — pero si no queda nada en stock, la
  referencia se publica igual con "· SIN STOCK hoy" en la nota. Criterio CONFIRMADO
  (19/08/2026): el más barato POR KILO sin importar el tamaño del paquete (si
  conviene el combo de 4 kg, compra 4 kg; `comparaPor:"kg"`) · Salmón =
  rosado/porcionado (ni ahumado, ni pasta, ni blanco) · Langostinos sin preparados
  (wok, empanados, rabas) · Mejillones = SOLO pelados (mejor relación
  cáscara/mejillón, aunque el entero esté más barato).
- Otros lugares (`ITEMS_OTROS`): Carmín (carmin.com.ar, TiendaNube → búsqueda
  server-rendered con JSON-LD, `paresDesdeTiendaNube`) para Hongos para cocinar;
  BonVino y Tienda Nova con página de producto FIJA (`url`) → `productoDePagina()`
  lee el bloque de analytics (`"item_name":"...","price":N`); el `must` verifica que
  la página siga siendo el producto correcto, si no queda el precio anterior.

- **Mercado Central (mayorista, desde 07/09/2026)**: referencia EXTRA en Verdulería, junto
  al minorista más barato (DIA/COTO), que es donde el usuario puede ir a comprar. NUNCA
  reemplaza el precio del ítem ni entra en totales/descuentos: viaja en `precios.json`
  como `mc: { p, f, n? }` en cada ítem simple de Verdulería y en cada opción de los
  picks (`op[nombre].mc`, incluso si la opción no tiene precio minorista). Se toma SOLO
  el último día publicado (decisión del usuario, 07/09/2026), por rubro. Fuente:
  https://mercadocentral.gob.ar/informaci%C3%B3n/precios-mayoristas, que publica UN ZIP
  por mes y rubro (frutas / hortalizas) con nombres irregulares y con errores de tipeo
  ("FRUTRAS_AGOSTO-26_0", "HORTALIZA_SEPTIENBRE_26_0", "FRUTAS  ENERO-26"):
  `mesDeNombre()` los tolera (mes por patrón laxo, año 20AA o AA) y el rubro sale de
  FRUT*/HORT*. Adentro hay un Excel 2.x (BIFF2, binario viejo) por día hábil,
  `RFddmmaa.XLS` / `RHddmmaa.XLS`; puede venir otro ZIP anidado con un día repetido (se
  deduplica por rubro+fecha). Lectores propios sin deps en `scripts/mercado-central.mjs`:
  `leerZip()` (directorio central + `inflateRawSync`) y `leerBiff2()` (celdas
  LABEL/NUMBER/INTEGER; la Ñ viene como 0xA5 de CP437 y a veces 0xF1 de Latin-1).
  Columnas: ESP VAR PROC ENV KG CAL TAM GRADO · MA/MO/MI+fecha = máximo/moda/mínimo POR
  BULTO · MAPK/MOPK/MIPK = lo mismo POR KILO; la fila "Prom.Esp." es el promedio de la
  especie. `ultimoDiaMercadoCentral()` recorre los meses de más nuevo a más viejo hasta
  tener los dos rubros y devuelve `{ frutas: { fecha, especies }, hortalizas }`. En el
  robot, `MC_VERDU` mapea nombre de la app → especie del Mercado (mayúsculas sin tilde,
  truncadas a 10 letras, grafías alternativas en array) y `mcParaVerdu()` arma el `mc`:
  sin `var` = $/kg de Prom.Esp.; con `var` = promedio de las líneas de esa variedad.
  Mapeos decididos (07/09/2026, supuestos a validar con el usuario): Tomate = REDONDO
  (no cherry) · Morrón = PIMIENTO MORRON, solo grado rojo (`grado: /^R/`, 08/09/2026) · Zapallito = ZAPALLITO REDONDO · Zucchini =
  ZAPALLITO LARGO · Calabaza = ZAPALLO (todas las variedades) · Zapallo anco = ZAPALLO
  ANC… · Papaya = MAMON · Hakusay = ACUSAY · Cilantro = CILANDRO (así lo escribe el
  Mercado) · Verdeo = CEB.VERDEO. La etiqueta `n` ("Pimiento morron", "Mamon") solo va
  cuando la especie no se llama como el ítem. `aplicarMC()`: si el Mercado se leyó,
  manda lo de hoy y lo que no cotizó pierde el `mc` (fuera de temporada); si falló, se
  conservan los `mc` previos. El log lista ✔ por ítem y "·" para lo sin cotización (no
  es un fallo). El robot corre a las 6:00 AR y el Mercado sube la planilla del día
  cerca de las 13:00: la referencia es siempre la del día hábil anterior. Si
  `leerBiff2()` tira "Excel moderno", el Mercado cambió de formato y hay que reescribir
  el lector.

## Estado actual y pendientes

- **El Puente (ANDANDO desde 09/08/2026)**: el listado "consumo familiar" se lee de
  `GET /productos/get/{rubro_id}` (fragmentos HTML; los rubro_id se descubren en los
  botones `data-rubro-id` del home, con lista fija de respaldo). Claves del criterio:
  los quesos se publican "Valor por kg …" → es precio POR KG aunque el nombre traiga
  el peso de la horma (lo maneja `elegir()`); para compra al mostrador solo valen las
  líneas "fraccionado/fracc." (la horma entera tiene otro precio); Provoletta se vende
  en piezas de ~190 g (2 piezas ≈ 300 g). Si el sitio cambia y no se lee nada, se
  imprime diagnóstico; atajo: pedir al usuario la URL XHR de la pestaña Red (F12).
  Promos "Clientes Felices" (imágenes del carrusel del home, ilegibles para el robot):
  DECISIÓN del usuario (19/08/2026): NO cargarlas a mano en el robot. En cambio, los
  picks de queso publican el precio de CADA opción (`op` en precios.json, vía
  `opcionesElPuente()`, claves = nombres de las opciones en la app) y en la app, al
  comprar, TODO ítem pendiente de El Puente lleva un chip "dto" que cicla
  10/15/20/25 % (`DTOS_LOCAL`, nunca otros valores; `dtoLocal` en `PendingRow`,
  por opción en los picks) para cargar la promo de mostrador del momento y ver el
  precio efectivo (no se persiste, es para decidir ahí parado). El efectivo COMBINA
  además el dto del día del comercio si hoy rige (mostrador × día, con la aclaración
  "incluye -X% de hoy"; los precios de las opciones del pick también lo incluyen).
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
  muestran el $/kg de cada corte y suman "1 kg de c/u". "Pollo entero" = SOLO
  refrigerado (no congelado), el más barato por kg con precio publicado — se vende
  por unidad ("X Uni (4 Kg)", `comparaPor:"kg"`). "Achura" SIN precio por
  decisión del usuario ("por ahora"): es un pick de 6 opciones de valor muy dispar.
  Sémola = SOLO Pureza o Bonalma (confirmado 04/09/2026), 500 g · precio = moda
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
- **Verdulería (referencia DIA/COTO desde 09/2026)**: el usuario compra en la verdulería
  de barrio; la referencia es el más barato entre DIA y COTO para cada verdura/fruta
  (`preciosVerdu()`: 10 ítems fijos + las 57 opciones de los picks, `VERDU_SIMPLES` /
  `VERDU_PICKS` = nombres exactos de la app). Criterio: $/kg del fresco más barato (por
  unidad solo si nadie lo vende por kg). **Sección obligatoria** (pedido 08/09/2026, tras
  ver "Fetuccini Morrón" como referencia de Morrón): el candidato tiene que venir de la
  sección "Frutas y Verduras" del súper — cada candidato lleva `cat` (DIA: `categories`
  unidas, "/Frescos/Frutas y Verduras/Verduras/"; COTO: `catCoto()` une `groups[]` con su
  `path_list`, "Categorias / Frescos / Frutas y Verduras / Hortalizas") y `esDeVerduleria()`
  exige `CAT_VERDU` (/frutas y verduras/); sin `cat`, afuera. `RECHAZO_VERDU` sigue como
  segunda red (conservas, congelados, jugos, especias, elaborados, limpieza, "mixto").
  **Ajo se mide POR UNIDAD** (cabeza, como se compra en el minorista; pedido 08/09/2026):
  `VERDU_POR_UNIDAD` ignora los candidatos por kilo (la bandeja "Dientes de Ajo 120 g");
  `parseQty` entiende "2u"/"3 un" sin la x. En lo vendido por unidad, `p` es el PRODUCTO
  entero (la malla de 3 ajos: $1.249, lo que se paga y entra al total) y la nota muestra
  el $/unidad ("· $416/un"); entre comercios `mejorVerdura()` compara `v` ($/kg o $/un),
  nunca el paquete. **Morrón = SOLO rojo** (08/09/2026, nunca
  compra verde): `regexVerdu` exige "rojo" ("Morrón Rojo" en DIA, "Pimiento Rojo" en COTO) y
  en el Mercado Central `MC_VERDU` filtra por `grado` /^R/ (el color viaja ahí: "R/I" rojo,
  "V/I" verde; etiqueta fija `n`); sanidad: paquetes ≥ 80 g, $500–30.000 el kg, y
  un COTO por debajo del 40 % de DIA se descarta (COTO tiene SKUs con precio placeholder,
  ej. "Cebolla Roja Bolsa $299"). Cada entrada lleva `s` (comercio de origen) y `u`
  (kg/un); las opciones de los picks van como `{ p, s, u }`. En la app `priceSrc` hace
  que el ítem use los DESCUENTOS POR DÍA DE SU COMERCIO DE ORIGEN (líneas "mar $…",
  total con dtos de hoy, opción por opción en los picks) aunque viva en Verdulería.
  Desde 07/09/2026 cada ítem/opción lleva además la referencia MAYORISTA del Mercado
  Central (`mc`, ver Sistema de precios): la app la muestra como "Mercado Central
  (mayorista): $…/kg · dd/mm" en Listas y Comprar, y "Central $…/kg" bajo el precio de
  cada opción de los picks. Sin referencia REAL (`referenciaVerdu()`: DIA y COTO
  respondieron y ninguno la vende fresca; hoy Cúrcuma, cuyo "Cúrcuma X Kg" a $1.799 era
  un SKU fantasma): el robot escribe `p: 0` y `applyPrices` BORRA el precio que el
  celular tuviera (sin flecha; el `mc` se conserva). Si una búsqueda falló, null y se
  conserva el anterior como siempre.
- **DIA, casos confirmados (09-12/08/2026)**: "Harina de maíz 1 kg" ES la Morixe para
  arepas (el nombre del producto no dice "maíz"; el must exige "arepas") · "Arvejas en
  lata" acepta cualquiera menos congeladas — en DIA las latas se llaman "Arvejas Secas
  Remojadas", por eso el reject viejo (/secas/) las mataba todas · "Atún" es SOLO
  entero al natural (en DIA los enteros se llaman "Lomitos"/"Lomos"; ni desmenuzado
  ni en aceite), al mejor precio POR LATA (`comparaPor:"un"`, los packs x3 cuentan) ·
  "Grasa bovina 1 kg" también viene rotulada "Grasa Vacuna" (q amplia "grasa", el
  must filtra) · "Agua mineral bidón": botellas y bidones compiten por litro cubierto ·
  "Sal fina 500 g" (08/09/2026): "Sal ENTREfina" pasaba el must `/fina/` y ganaba por
  barata; ahora `must` exige `\bsal\b` y `\bfina\b` (palabras enteras) y `reject`
  suma entrefina y salero. Entrefina y gruesa son ítems aparte, no equivalentes.
- **Suavizante** (08/09/2026): igual que el aceite, UNA botella de la más barata POR LITRO
  del tamaño que sea (`unit:"un", qty:1, comparaPor:"l"`); antes `unit:"l", qty:1` hacía
  comprar 2× 900 ml para "cubrir" el litro. `q` son dos búsquedas: con "para ropa" DIA no
  devuelve el doypack de 3 L, que es el más barato por litro.
- **Marcas preferidas** (campo `marca: { re, nombre }` en la config del ítem): el
  criterio sigue siendo el más barato, pero si la marca preferida no gana, la nota
  muestra su precio y diferencia para que el usuario decida. Hoy: Agua = Glaciar ·
  Yerba = Playadito. `q` puede ser una búsqueda o un array (para que la marca
  aparezca entre los candidatos).
- **Farmacity (ANDANDO desde 09/08/2026)**: 16/16 ítems (incluye Alcohol en gel,
  migración v8, mejor precio por litro). Preferencias CONFIRMADAS del
  usuario: Desodorante = Old Spice EN BARRA solamente (rechazo aerosol/spray/ml) ·
  Máquina de afeitar = 3 filos, mejor precio POR UNIDAD (hoy gana un pack "Enjoy Mujer
  x 5"; el usuario no pidió filtrar por género — validar si molesta) · Cepillo de dientes
  = mejor precio POR UNIDAD, packs cuentan, y la marca propia "Cepillo Dental Farmacity"
  vale (08/09/2026: el must exigía "de dientes" y la dejaba afuera; `q` son dos
  búsquedas); sin infantiles, interdentales, portátiles, ortodoncia, kits ni eléctricos · Preservativos =
  Prime Mega (en Farmacity: "Preservativo de Látex Mega") · Alcohol = 96° (decidido
  09/08/2026: tiene alcohol en gel para manos, el líquido es para limpieza; el 70 %
  ya diluido queda excluido por must /96/) · Pasta dental = mejor precio por kg
  (09/09/2026: la Oral B 4 en 1 de 180 g a $3.351 estaba en la página 2 del buscador, ver
  paginación) · Protector solar corporal = UN envase, el más barato POR LITRO
  (`comparaPor:"l"`, 09/09/2026: por precio suelto ganaba un tubo de 50 ml; sin kids/
  pediátrico). OJO `parseQty`: "Fps 50 x 50 ml" no es un pack de 50 (lookbehind fps/spf).
  Supuestos a validar: Crema humectante = facial (Pond's) · Gel de limpieza = facial (con
  la paginación aparecen limpiadores del hogar — inodoro, sarro, Pato…: rechazados). No quedan comercios pendientes.
- **Fase 2 posible**: botón "Actualizar precios" en la app vía Cloudflare Worker (proxy CORS).
- **Versión artefacto de Claude.ai**: existe una variante del fuente que usa
  `window.storage` (API de artefactos) en vez de `localStorage`. Ya no es la fuente de
  verdad; si hiciera falta regenerarla, son solo los dos bloques de carga/guardado en `App()`.

## El usuario

Responde bien a: cambios con migración incluida (nunca perderle datos), notas visibles
que expliquen cada precio ("→ 2× Molinos Ala 500 g · oferta -35%"), honestidad sobre lo
que no se pudo hacer y por qué, y tests que demuestren el criterio. Revisa los logs del
robot y reporta los ✘. Prefiere repo privado (deploy vía Netlify conectado).
