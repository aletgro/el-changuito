#!/usr/bin/env node
/* ============================================================
   EL CHANGUITO · actualizador de precios
   Consulta las tiendas y regenera precios.json.
   Criterio: el más barato normalizado por kg/L en tamaño
   similar al de la lista (redondeando paquetes hacia arriba
   para cubrir la cantidad, ej. 2× 500 g para llegar a 1 kg).

   Uso:  node scripts/actualizar-precios.mjs
   Corre solo en GitHub Actions (ver .github/workflows/precios.yml).
   ============================================================ */

import fs from "node:fs";

const DIA = "https://diaonline.supermercadosdia.com.ar";
const ESPERA_MS = 800; // pausa entre consultas para no castigar al sitio

/* ---------- Catálogo: ítem de la app → cómo buscarlo ----------
   name  : EXACTAMENTE el nombre del ítem en la app
   q     : término de búsqueda
   unit  : kg | l | m | un   (unidad para normalizar)
   qty   : cantidad objetivo en esa unidad
   must  : regexes que el nombre del producto debe cumplir
   reject: regexes que lo descartan
   cat   : (opcional) URL de categoría como plan B si la API falla
--------------------------------------------------------------- */
const ITEMS = [
  // --- Almacén ---
  { name: "Aceite de girasol 1 L", q: "aceite de girasol", unit: "l", qty: 1, must: [/aceite/i, /girasol/i], reject: [/fritolim|oleico|spray/i], cat: DIA + "/almacen/aceites-y-aderezos/aceites-de-girasol" },
  { name: "Agua mineral bidón", q: "agua bidon", unit: "l", qty: 6, must: [/agua/i], reject: [/con gas|gasificada|saborizada|t[óo]nica/i], cat: DIA + "/bebidas/aguas/aguas-sin-gas" },
  { name: "Arroz integral 1 kg", q: "arroz integral", unit: "kg", qty: 1, must: [/arroz/i, /integral/i], reject: [/tostadita|galleta|preparado/i], cat: DIA + "/almacen/pastas-y-arroces/arroces" },
  { name: "Atún", q: "atun", unit: "un", qty: 1, must: [/at[uú]n/i], reject: [/ensalada|pat[eé]/i], cat: DIA + "/almacen/conservas/conservas-de-pescados" },
  { name: "Azúcar 500 g", q: "azucar", unit: "kg", qty: 0.5, must: [/az[uú]car/i], reject: [/mascabo|rubia|light|org[áa]nica|impalpable/i], cat: DIA + "/desayuno/infusiones-y-endulzantes/azucar" },
  { name: "Grasa bovina 1 kg", q: "grasa bovina", unit: "kg", qty: 1, must: [/grasa/i, /bovina|vacuna/i], reject: [/vegetal/i], cat: DIA + "/frescos/pastas-frescas/levaduras-y-grasas" },
  // Confirmado por el usuario (09/08/2026): es la Morixe para arepas (el nombre no dice "maíz")
  { name: "Harina de maíz 1 kg", q: "harina arepas", unit: "kg", qty: 1, must: [/harina/i, /arepas/i], reject: [], cat: DIA + "/almacen/harinas/harinas-de-maiz" },
  { name: "Leche larga vida", q: "leche entera larga vida", unit: "l", qty: 1, must: [/leche/i, /entera/i], reject: [/polvo|chocolatada|descremada|s[ée]mi|deslactosada/i] },
  { name: "Maicena 500 g", q: "almidon de maiz", unit: "kg", qty: 0.5, must: [/almid[óo]n|maizena/i], reject: [/bio|premezcla/i], cat: DIA + "/almacen/harinas/harinas-de-maiz" },
  { name: "Papas fritas", q: "papas fritas tubo", unit: "kg", qty: 0.15, must: [/papas fritas/i, /tubo/i], reject: [/congelad/i], cat: DIA + "/almacen/picadas/papas-fritas" },
  { name: "Polenta 1 kg", q: "polenta", unit: "kg", qty: 1, must: [/polenta/i], reject: [/quesos|espinaca|vegetales|lista/i], cat: DIA + "/almacen/harinas/harinas-de-maiz" },
  { name: "Sal entrefina 500 g", q: "sal entrefina", unit: "kg", qty: 0.5, must: [/sal/i, /entrefina/i], reject: [], cat: DIA + "/almacen/aceites-y-aderezos/sal" },
  { name: "Sal fina 500 g", q: "sal fina", unit: "kg", qty: 0.5, must: [/sal/i, /fina/i], reject: [/light|marina|apio|aj[oi]/i], cat: DIA + "/almacen/aceites-y-aderezos/sal" },
  { name: "Sal gruesa 500 g", q: "sal gruesa", unit: "kg", qty: 0.5, must: [/sal/i, /gruesa/i], reject: [/parrillera light/i], cat: DIA + "/almacen/aceites-y-aderezos/sal" },
  { name: "Vinagre de alcohol 1 L", q: "vinagre de alcohol", unit: "l", qty: 1, must: [/vinagre/i, /alcohol/i], reject: [] },
  { name: "Vinagre de manzana 1 L", q: "vinagre de manzana", unit: "l", qty: 1, must: [/vinagre/i, /manzana/i], reject: [] },
  { name: "Yerba 1 kg", q: "yerba mate", unit: "kg", qty: 1, must: [/yerba/i], reject: [/mate cocido|saquitos|compuesta|c[áa]psula/i], cat: DIA + "/desayuno/infusiones-y-endulzantes/yerba-mate" },
  // --- Limpieza e higiene ---
  { name: "Aerosol de ambiente", q: "desodorante de ambiente aerosol", unit: "un", qty: 1, must: [/ambiente/i], reject: [/repuesto|el[ée]ctrico|autom[áa]tico/i] },
  { name: "Bolsa de basura baño", q: "bolsas de residuos", unit: "un", qty: 1, must: [/residuo|basura/i], reject: [/consorcio/i] },
  { name: "Cif crema", q: "cif crema", unit: "un", qty: 1, must: [/cif/i, /crema/i], reject: [] },
  { name: "Desinfectante de piso", q: "limpiador de pisos", unit: "un", qty: 1, must: [/piso/i], reject: [/madera|autobrillo|cera/i] },
  { name: "Desinfectante de superficies", q: "desinfectante superficies", unit: "un", qty: 1, must: [/desinfectante|lysoform|espadol/i], reject: [/piso|ropa/i] },
  { name: "Detergente líquido", q: "detergente", unit: "un", qty: 1, must: [/detergente/i], reject: [/ropa|matic|lavavajillas autom/i] },
  { name: "Esponja", q: "esponja cocina", unit: "un", qty: 1, must: [/esponja/i], reject: [/acero|ba[ñn]o|maquillaje/i] },
  { name: "Jabón Dove", q: "jabon dove", unit: "un", qty: 1, must: [/dove/i, /jab[óo]n/i], reject: [/l[íi]quido/i] },
  { name: "Jabón líquido manos", q: "jabon liquido manos", unit: "un", qty: 1, must: [/jab[óo]n l[íi]quido/i], reject: [/ropa|matic/i] },
  { name: "Jabón líquido ropa", q: "jabon liquido para ropa", unit: "l", qty: 3, must: [/jab[óo]n l[íi]quido|jab[óo]n para ropa/i], reject: [/manos|tocador|glicerina/i] },
  { name: "Lavandina", q: "lavandina", unit: "l", qty: 1, must: [/lavandina/i], reject: [/ropa color/i] },
  { name: "Limpia vidrios", q: "limpiavidrios", unit: "un", qty: 1, must: [/vidrio/i], reject: [/auto/i] },
  { name: "Papel higiénico", q: "papel higienico", unit: "m", qty: 120, must: [/higi[ée]nico/i], reject: [/h[úu]medo/i] },
  { name: "Pastilla inodoro", q: "pastilla inodoro", unit: "un", qty: 1, must: [/inodoro/i], reject: [] },
  { name: "Rollo de cocina", q: "rollo de cocina", unit: "un", qty: 1, must: [/cocina/i, /rollo|papel/i], reject: [] },
  { name: "Suavizante", q: "suavizante para ropa", unit: "l", qty: 1, must: [/suavizante/i], reject: [] },
  { name: "Trapo de piso", q: "trapo de piso", unit: "un", qty: 1, must: [/trapo/i, /piso/i], reject: [] },
  { name: "Trapo rejilla", q: "rejilla", unit: "un", qty: 1, must: [/rejilla/i], reject: [] },
  { name: "Trapo amarillo", q: "paño multiuso", unit: "un", qty: 1, must: [/pa[ñn]o|multiuso|amarillo/i], reject: [/microfibra premium/i] },
  { name: "Virulana", q: "esponja de acero", unit: "un", qty: 1, must: [/acero|virulana/i], reject: [] },
  // --- Almacén (compra secundaria) ---
  // "Cualquiera menos congeladas" (usuario, 09/08/2026): en DIA las latas se llaman "Arvejas Secas Remojadas"
  { name: "Arvejas en lata", q: "arvejas", unit: "un", qty: 1, must: [/arvejas/i], reject: [/congelad/i] },
  { name: "Caldo en cubos", q: "caldo en cubos", unit: "un", qty: 1, must: [/caldo/i], reject: [/deshidratada|sopa/i] },
  { name: "Choclo en lata", q: "choclo en grano", unit: "un", qty: 1, must: [/choclo/i], reject: [/congelad/i] },
  { name: "Jardinera en lata", q: "jardinera", unit: "un", qty: 1, must: [/jardinera/i], reject: [] },
  { name: "Jugo de tomate en sachet", q: "pure de tomate", unit: "un", qty: 1, must: [/tomate/i], reject: [/ketchup|salsa lista|deshidratado|cherry/i] },
  { name: "Levadura", q: "levadura", unit: "un", qty: 1, must: [/levadura/i], reject: [], cat: DIA + "/frescos/pastas-frescas/levaduras-y-grasas" },
  { name: "Pan rallado", q: "pan rallado", unit: "un", qty: 1, must: [/rallado|rebozador/i], reject: [] },
  // --- Electricidad y otros ---
  { name: "4 pilas AAA", q: "pilas aaa", unit: "un", qty: 4, must: [/aaa/i], reject: [/recargable|cargador/i] },
  { name: "Escarbadientes", q: "escarbadientes", unit: "un", qty: 1, must: [/escarbadientes|palillos/i], reject: [] },
];

/* ---------- Utilidades ---------- */
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function fechaHoyAR() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
  return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
}

/* Interpreta la cantidad a partir del nombre del producto ("1,5 Lt.", "500 Gr.", "x 3 Ud.", "4 x 30 Mts") */
function parseQty(nombre) {
  const s = nombre.toLowerCase().replace(/,/g, ".");
  let mult = 1;
  let base = s;
  // Pack "N x tamaño" (ej. "4 x 30 Mts", "3 x 500 Gr"): multiplicador + tamaño individual
  const pack = s.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(kgm?|grs?|grm|gs|gr\.|g|ml|cc|lts?|lt\.|l|m(?:ts?)?)\b/);
  if (pack) {
    mult = parseInt(pack[1], 10) || 1;
    base = pack[2] + " " + pack[3];
  } else {
    // "x N" es multiplicador solo si N no es un tamaño ("x 3 ud." sí; "x 190 g" no)
    const mx = s.match(/(?:^|\s)x\s*(\d+)\b(?!\s*(?:kgm?|grs?|grm|gs|gr\.|g|ml|cc|lts?|lt\.|l|m(?:ts?)?)\b)/);
    if (mx) mult = parseInt(mx[1], 10) || 1;
  }
  let m;
  if ((m = base.match(/(\d+(?:\.\d+)?)\s*kgm?\b/))) return { amount: parseFloat(m[1]) * mult, unit: "kg" };
  if ((m = base.match(/(\d+(?:\.\d+)?)\s*(?:grm|grs?|gs|gr\.|g)\b/))) return { amount: (parseFloat(m[1]) / 1000) * mult, unit: "kg" };
  if ((m = base.match(/(\d+(?:\.\d+)?)\s*(?:ml|cc)\b/))) return { amount: (parseFloat(m[1]) / 1000) * mult, unit: "l" };
  if ((m = base.match(/(\d+(?:\.\d+)?)\s*(?:lts?|lt\.|l)\b/))) return { amount: parseFloat(m[1]) * mult, unit: "l" };
  if ((m = base.match(/(\d+(?:\.\d+)?)\s*m(?:ts?)?\b/))) return { amount: parseFloat(m[1]) * mult, unit: "m" };
  return { amount: mult, unit: "un" };
}

/* ---------- Fuente 1: API pública de VTEX (DIA y Farmacity la usan) ---------- */
async function buscarVtex(base, query) {
  const url = `${base}/api/catalog_system/pub/products/search/?ft=${encodeURIComponent(query)}&_from=0&_to=49`;
  const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; ElChanguito/1.0)" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const data = await r.json();
  if (!Array.isArray(data)) throw new Error("respuesta inesperada");
  const out = [];
  for (const p of data) {
    const nombre = p.productName || "";
    for (const it of p.items || []) {
      for (const sel of it.sellers || []) {
        const of = sel.commertialOffer || {};
        if (of.Price > 0 && of.AvailableQuantity > 0) {
          out.push({ nombre, precio: of.Price, lista: of.ListPrice || of.Price });
        }
      }
    }
  }
  return out;
}

/* ---------- Fuente 2 (plan B): página de categoría en HTML ---------- */
async function buscarCategoriaHtml(url) {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; ElChanguito/1.0)" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const html = await r.text();
  // Los listados server-rendered traen "Nombre ... $ 1.234" repetido; capturamos pares nombre/precio(s)
  const out = [];
  const re = /([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñü.,'()% -]{6,90}?)\$\s?([\d.]+(?:,\d+)?)(?:\d*%\$\s?([\d.]+(?:,\d+)?))?/g;
  let m;
  const plano = html.replace(/<[^>]+>/g, "");
  while ((m = re.exec(plano)) !== null) {
    const nombre = m[1].trim();
    const lista = parseFloat(m[2].replace(/\./g, "").replace(",", "."));
    const oferta = m[3] ? parseFloat(m[3].replace(/\./g, "").replace(",", ".")) : null;
    const precio = oferta && oferta < lista ? oferta : lista;
    if (precio > 0 && nombre.length > 6) out.push({ nombre, precio, lista });
  }
  return out;
}

/* ---------- EL PUENTE (ofertas.lacteoselpuente.com.ar) ----------
   El listado "CONSUMO FAMILIAR" se carga por AJAX: GET /productos/get/{rubro_id}
   devuelve fragmentos HTML con pares nombre/precio. Los rubro_id salen de los
   botones data-rubro-id del home (con lista fija de respaldo).
   OJO: los quesos se publican "Valor por kg ..." → el precio es POR KG aunque
   el nombre mencione la horma ("aprox. 4 kg"); elegir() lo contempla.
   Cantidades por compra según las notas del usuario. ---------- */
const EP = "https://ofertas.lacteoselpuente.com.ar";

const ITEMS_ELPUENTE = [
  // Solo marca El Puente (pedido del usuario, 09/08/2026: nada de D70 ni otras marcas).
  // fraccionado: compra al mostrador → solo líneas "fraccionado/fracc." (la horma entera es otro precio)
  { name: "Fundente", qty: 0.8, unit: "kg", fraccionado: true, asumirKg: true, must: [/el puente/i, /cremoso|por salut/i, /fracc/i], reject: [/pizzero|light|untable|sachet/i] }, // ~800 g por vez
  { name: "Pizza", qty: 0.4, unit: "kg", fraccionado: true, asumirKg: true, must: [/el puente/i, /m[uo]zz?arella/i, /fracc/i], reject: [/rallad|light/i] }, // solo mozzarella
  { name: "Provoletta", qty: 0.3, unit: "kg", must: [/el puente/i, /provolet/i], reject: [/rallad/i] }, // se vende en piezas de ~190 g
  { name: "Queso para picada", qty: 0.3, unit: "kg", fraccionado: true, asumirKg: true, must: [/el puente/i, /fontina|gouda|gruyer|mar del plata|pategr[aá]s|holanda/i, /fracc/i], reject: [/rallad/i] },
  { name: "Queso para rayar", qty: 0.3, unit: "kg", fraccionado: true, asumirKg: true, must: [/el puente/i, /sardo|reggianito|romano|provolone/i, /fracc/i], reject: [/rallad/i] },
  // Crema: 2 potes del tamaño (220 o 330 cc) que esté más barato POR LITRO
  { name: "Crema", qty: 2, unit: "un", comparaPor: "l", must: [/el puente/i, /crema de leche/i], reject: [/helado|queso crema|balde/i] },
  { name: "Leche", qty: 2, unit: "l", must: [/el puente/i, /leche/i, /entera/i], reject: [/polvo|chocolatada|condensada|dulce de leche|yogur|queso/i] }, // solo entera · 2 sachets de 1 L
];

/* Fragmento HTML de /productos/get/{rubro_id} → pares nombre/precio.
   Estructura: <span class="float-left"...><span>NOMBRE</span></span>
               <span class="float-right"...>$10.500,00</span> */
function parsearListadoElPuente(html) {
  const out = [];
  const re = /<span[^>]*class="float-left"[^>]*>\s*<span>([^<]+)<\/span>\s*<\/span>\s*<span[^>]*class="float-right"[^>]*>\s*\$\s*([\d.]+(?:,\d+)?)/g;
  for (const m of html.matchAll(re)) {
    const nombre = m[1].replace(/\s+/g, " ").trim();
    const precio = parseFloat(m[2].replace(/\./g, "").replace(",", "."));
    if (nombre && precio > 0) out.push({ nombre, precio, lista: precio });
  }
  return out;
}

function diagnosticoElPuente(home) {
  console.log("EL PUENTE: diagnóstico para ajustar el lector →");
  const inline = (home.match(/<script(?![^>]*src)/gi) || []).length;
  const menciones = (home.match(/precio/gi) || []).length;
  console.log(`  HTML: ${home.length} caracteres · scripts inline: ${inline} · menciones de "precio": ${menciones}`);
  const rutas = [...new Set(
    [...home.matchAll(/["']([^"'\s<>]{2,120}?\.(?:php|js|json|html|asp|aspx)(?:\?[^"'\s<>]*)?)["']/gi)].map((m) => m[1])
  )].filter((u) => !/googletag|gtag|jquery|bootstrap|slick|facebook|fontawesome/i.test(u));
  console.log("  Rutas detectadas: " + (rutas.length ? rutas.slice(0, 30).join(" | ") : "ninguna"));
  const ctxPhp = [...home.matchAll(/.{0,60}\.php.{0,40}/g)].slice(0, 6).map((m) => m[0].replace(/\s+/g, " ").trim());
  if (ctxPhp.length) console.log("  Contexto de .php: " + ctxPhp.join("  ///  "));
  const ctxAjax = [...home.matchAll(/.{0,30}(?:\$\.(?:get|post|ajax)|fetch\(|XMLHttpRequest|\.load\().{0,90}/g)].slice(0, 6).map((m) => m[0].replace(/\s+/g, " ").trim());
  if (ctxAjax.length) console.log("  Llamadas AJAX vistas: " + ctxAjax.join("  ///  "));
  console.log("  (Atajo: en el navegador, F12 → pestaña Red → recargá la página → filtrá XHR y pasale a Claude la URL que aparece.)");
}

async function candidatosElPuente() {
  const cab = { headers: { "user-agent": "Mozilla/5.0 (compatible; ElChanguito/1.0)", accept: "*/*", "x-requested-with": "XMLHttpRequest" } };

  // Rubros del listado "CONSUMO FAMILIAR", descubiertos en el home (respaldo: lista de ago 2026)
  let home = "";
  let rubros = [];
  try {
    home = await (await fetch(EP + "/", cab)).text();
    rubros = [...new Set([...home.matchAll(/btn-rubros-familiar[^>]*?data-rubro-id="(\d+)"/g)].map((m) => Number(m[1])))];
  } catch (e) { /* sin home igual probamos los rubros conocidos */ }
  if (!rubros.length) rubros = [1, 2, 3, 4, 5, 6, 7, 12, 14, 15, 23, 24, 25, 26, 27, 28, 29];

  const porNombre = new Map(); // dedup por nombre (si se repite entre rubros, queda el más barato)
  for (const id of rubros) {
    try {
      const r = await fetch(EP + "/productos/get/" + id, cab);
      if (!r.ok) continue;
      for (const p of parsearListadoElPuente(await r.text())) {
        const prev = porNombre.get(p.nombre);
        if (!prev || p.precio < prev.precio) porNombre.set(p.nombre, p);
      }
    } catch (e) { /* seguimos con el próximo rubro */ }
    await dormir(300);
  }

  const cand = [...porNombre.values()];
  if (cand.length) {
    console.log(`EL PUENTE: ${cand.length} productos vía /productos/get/{rubro} (rubros: ${rubros.join(" ")})`);
    return cand;
  }
  if (home) diagnosticoElPuente(home);
  return [];
}

/* ---------- COTO (coto.com.ar) ----------
   El sitio nuevo es una SPA de Angular; el catálogo con precios sale del
   buscador Constructor.io (ac.cnstrc.com) con la key pública que está en el
   bundle de COTO. Por producto viene un precio POR SUCURSAL:
     listPrice   = precio del paquete (en cortes "X KG", $/kg)
     formatPrice = referencia por kilo/litro (respaldo si falta listPrice)
   Tomamos la MODA entre sucursales (el precio de góndola más repetido;
   hay outliers de data mala tipo $9,19). Si algún día se consigue el código
   de la sucursal de La Plata del usuario, filtrar price[] por store.
   Carnicería: cantidades asumidas ~1 kg por corte (Combo y Asado), a validar. */
const COTO_KEY = "key_r6xzz4IAoTWcipni";

const ITEMS_COTO = [
  // Harinas Chacabuco (identificadas por foto de góndola, 09/08/2026):
  //   "de fuerza" W300 13 g prot = "Harina Para Masa Madre" · Napolitana = "Harina de Trigo 00"
  { name: "Harina 000", q: "harina chacabuco", unit: "kg", qty: 1, must: [/chacabuco/i, /\b000\b/], reject: [/premezcla|leudante|integral|saborizada|masa madre|org[áa]nica/i] },
  { name: "Harina 0000", q: "harina chacabuco", unit: "kg", qty: 1, must: [/chacabuco/i, /\b0000\b/], reject: [/premezcla/i] },
  { name: "Harina 000 de fuerza", q: "harina chacabuco", unit: "kg", qty: 1, must: [/chacabuco/i, /masa madre/i], reject: [/premezcla|blend/i] },
  { name: "Harina 0000 de fuerza", q: "harina chacabuco", unit: "kg", qty: 1, must: [/chacabuco/i, /\b00\b/], reject: [/premezcla/i] },
  { name: "Harina integral", q: "harina chacabuco", unit: "kg", qty: 1, must: [/chacabuco/i, /integral/i], reject: [/semillas|org[áa]nica|premezcla/i] },
  { name: "Semolín", q: "harina chacabuco", unit: "kg", qty: 1, must: [/semol[íi]n/i], reject: [] },
  { name: "Sémola", q: "semola", unit: "kg", qty: 0.5, must: [/s[ée]mola/i], reject: [/\bfid|fideo|spaghetti|tallar|ñoqui|vitina|premezcla/i] },
];

/* Carnicería: cortes al peso, todos "X KG" → el precio publicado ES por kg.
   Criterio del usuario (09/08/2026): mostrar el precio POR KILO de cada corte;
   los ítems compuestos suman $/kg de cada corte ("estimo 1 kg de c/u"). */
const PARTES_CARNE = {
  roast: { q: "roast beef", must: [/roast beef/i, /x ?kg/i], reject: [/empanada|congelad/i] },
  falda: { q: "falda", must: [/falda/i, /x ?kg/i], reject: [/cerdo/i] },
  osobuco: { q: "osobuco", must: [/osobuco/i, /x ?kg/i], reject: [/cerdo/i] },
  marucha: { q: "marucha", must: [/marucha/i, /x ?kg/i], reject: [/cerdo/i] },
  aranita: { q: "arañita", must: [/ara[ñn]ita/i, /x ?kg/i], reject: [/gomitas/i] },
  vacio: { q: "vacio", must: [/vac[íi]o/i, /x ?kg/i], reject: [/al vac[íi]o|env(?:asado)? ?vac[íi]o|cerdo|lomo|picanha|spiedo|congelad|chorizo|morcilla|leberwurst|matambre/i] },
  tapa: { q: "tapa de asado", must: [/tapa de asado/i, /x ?kg/i], reject: [/braceada|ahumada/i] },
  tira: { q: "asado", must: [/asado del medio|tira de asado|asado de bife/i, /x ?kg/i], reject: [/cerdo|cordero|braceada|ahumada|congelad/i] },
};

const NOMBRES_COTO = [...ITEMS_COTO.map((i) => i.name), "Roast beef", "Combo de temporada", "Asado"];

function modaPrecios(valores) {
  if (!valores.length) return null;
  const cuenta = new Map();
  for (const v of valores) cuenta.set(v, (cuenta.get(v) || 0) + 1);
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/* Respuesta del buscador de Constructor → pares nombre/precio */
function paresDesdeCoto(data) {
  const out = [];
  for (const res of data?.response?.results || []) {
    const nombre = String(res.value || "").replace(/\s+/g, " ").trim();
    const valores = (res.data?.price || []).map((p) => p.listPrice ?? p.formatPrice).filter((v) => v > 0);
    const precio = modaPrecios(valores);
    if (nombre && precio) out.push({ nombre, precio, lista: precio });
  }
  return out;
}

async function buscarCoto(query) {
  const url = `https://ac.cnstrc.com/search/${encodeURIComponent(query)}?key=${COTO_KEY}&c=cioc-2.0&i=el-changuito&s=1&num_results_per_page=100`;
  const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; ElChanguito/1.0)" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return paresDesdeCoto(await r.json());
}

/* El corte más barato por kg que cumpla los filtros de la parte */
function porKgCoto(candidatos, parte) {
  let mejor = null;
  for (const c of candidatos) {
    if (!parte.must.every((re) => re.test(c.nombre))) continue;
    if (parte.reject.some((re) => re.test(c.nombre))) continue;
    if (!mejor || c.precio < mejor.precio) mejor = c;
  }
  return mejor;
}

const limpiarCorte = (s) => s.replace(/\s+/g, " ").replace(/\s+x\s*kg\.?$/i, "").trim();
const pesos = (v) => "$" + Math.round(v).toLocaleString("es-AR");

/* Corte suelto: el precio del ítem ES el precio por kilo */
const notaPorKg = (c) => ({ p: Math.round(c.precio), n: `${limpiarCorte(c.nombre)} · ${pesos(c.precio)}/kg` });

/* Combo de temporada: misma regla que la app (abr–sep = frío) */
function comboCoto(porParte, invernal) {
  const [c1, c2] = invernal ? [porParte.falda, porParte.osobuco] : [porParte.marucha, porParte.aranita];
  if (!c1 || !c2) return null;
  const [et1, et2] = invernal ? ["falda", "osobuco"] : ["marucha", "arañita"];
  return {
    p: Math.round(c1.precio + c2.precio),
    n: `${et1} ${pesos(c1.precio)}/kg + ${et2} ${pesos(c2.precio)}/kg · estimo 1 kg de c/u`,
  };
}

/* Asado: vacío o tapa de asado (el más barato) + tira de asado */
function asadoCoto(porParte) {
  const opciones = [porParte.tapa && { et: "tapa de asado", ...porParte.tapa }, porParte.vacio && { et: "vacío", ...porParte.vacio }].filter(Boolean);
  if (!opciones.length || !porParte.tira) return null;
  opciones.sort((a, b) => a.precio - b.precio);
  const base = opciones[0];
  const tira = porParte.tira;
  return {
    p: Math.round(base.precio + tira.precio),
    n: `${base.et} ${pesos(base.precio)}/kg + tira ${pesos(tira.precio)}/kg · estimo 1 kg de c/u`,
  };
}

function mesAR() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" })).getMonth() + 1;
}

async function preciosCoto() {
  const cache = new Map();
  const buscar = async (q) => {
    if (!cache.has(q)) { cache.set(q, await buscarCoto(q)); await dormir(300); }
    return cache.get(q);
  };
  const out = [];
  for (const item of ITEMS_COTO) {
    let el = null;
    try { el = elegir(item, await buscar(item.q)); } catch (e) { /* sin red: queda sin match */ }
    out.push([item.name, el]);
  }
  const invernal = mesAR() >= 4 && mesAR() <= 9;
  const porParte = {};
  for (const clave of [...(invernal ? ["falda", "osobuco"] : ["marucha", "aranita"]), "vacio", "tapa", "tira", "roast"]) {
    try { porParte[clave] = porKgCoto(await buscar(PARTES_CARNE[clave].q), PARTES_CARNE[clave]); } catch (e) { porParte[clave] = null; }
  }
  out.push(["Roast beef", porParte.roast ? notaPorKg(porParte.roast) : null]);
  out.push(["Combo de temporada", comboCoto(porParte, invernal)]);
  out.push(["Asado", asadoCoto(porParte)]);
  return out;
}

/* ---------- DIETÉTICA (frutosare.com.ar + newgarden.com.ar) ----------
   Precios SOLO DE REFERENCIA: el usuario compra en dietéticas de barrio sin
   página; Frutos del Are (WooCommerce, Store API pública) sirve de vara y
   New Garden (Magento, GraphQL público) es el RESPALDO cuando FA no tiene el
   producto (pedido del usuario, 09/08/2026); `fuente:"ng"` lo busca solo ahí.
   Criterio pedido: MANTENER las cantidades del usuario — comprar más grande es
   más barato por kg pero no puede stockearlo. Por eso los ítems usan `cercano`:
   cantidad del usuario × $/kg del paquete de tamaño más parecido.
   Sin "Huevo" (el usuario carga ese precio a mano al comprarlo) ni
   "Té a elección" (pick variable). */
const FA = "https://frutosare.com.ar/wp-json/wc/store/v1";
const NG = "https://newgarden.com.ar/graphql";

/* Marcas caras de especiero/frascos y productos elaborados: fuera de la referencia */
const RECHAZO_DIET = /castillo|especiero|molinillo|sazonador|frasco|lata|dicomere|sin tacc|sin gluten|natier|c[áa]psula|barrita|galletita|alfajor|cracker|chips|pudding|halva|mezcla|granola|aceite|fideo|pasta de|spray|molinos ala/i;

const ITEMS_DIETETICA = [
  // Especias · stock permanente
  { name: "Ají molido / pimentón picante 100 g", q: "aji molido", qty: 0.1, must: [/aj[íi] molido|piment[óo]n picante/i] },
  { name: "Amapola 25 g", q: "amapola", qty: 0.025, must: [/amapola/i] },
  { name: "Canela 15 g", q: "canela", qty: 0.015, must: [/canela/i, /rama/i] }, // el usuario la compra entera (en rama)
  { name: "Clavos de olor 10 g", q: "clavo de olor", qty: 0.01, must: [/clavo/i, /grano|entero/i] },
  { name: "Comino 100 g", q: "comino", qty: 0.1, must: [/comino/i, /grano/i] }, // en grano, no molido
  { name: "Coriandro 25 g", q: "coriandro", qty: 0.025, must: [/coriandro/i] },
  { name: "Hinojo 50 g", q: "hinojo", qty: 0.05, must: [/hinojo/i, /semilla/i] },
  { name: "Laurel 15 hojas", q: "laurel", qty: 0.025, must: [/laurel/i] }, // compra de a 25 g
  { name: "Mostaza rubia 25 g", q: "mostaza", qty: 0.025, must: [/mostaza/i], reject: [/salsa|dijon|antigua|miel|arytza/i] },
  { name: "Nuez moscada 5 unidades", q: "nuez moscada", qty: 0.025, must: [/nuez moscada/i, /grano|entera/i] },
  { name: "Orégano 50 g", q: "oregano", qty: 0.05, must: [/or[ée]gano/i], reject: [/semillas/i] },
  { name: "Pimentón 100 g", q: "pimenton", qty: 0.1, must: [/piment[óo]n/i], reject: [/picante|espa[ñn]ol/i] },
  { name: "Pimienta blanca 50 g", q: "pimienta blanca", qty: 0.05, must: [/pimienta blanca/i] },
  { name: "Pimienta negra 50 g + 50 g", q: "pimienta negra", qty: 0.05, must: [/pimienta negra/i, /grano/i] }, // pedido del usuario: referencia de 50 g EN GRANO
  { name: "Romero 25 g", q: "romero", qty: 0.025, must: [/romero/i] },
  { name: "Tomillo 50 g", q: "tomillo", qty: 0.05, must: [/tomillo/i] },
  // Perecederos
  { name: "Almendras 500 g", q: "almendras", qty: 0.5, must: [/almendras?/i], reject: [/chocolate|harina/i] }, // partidas OK: son las más baratas y el usuario las prefiere
  { name: "Cacao 500 g", q: "cacao amargo", qty: 0.5, must: [/cacao/i], reject: [/chocolate|nibs|manteca|chips|cascarilla/i] },
  { name: "Castañas de cajú 500 g", q: "castañas", qty: 0.5, must: [/caj[uú]/i], reject: [/chocolate|partida/i] },
  { name: "Girasol 250 g", q: "girasol", qty: 0.25, must: [/girasol/i] },
  { name: "Lino 250 g", q: "semillas de lino", qty: 0.25, must: [/lino/i] },
  { name: "Maní 2 kg", q: "mani repelado", qty: 2, must: [/man[íi]/i], reject: [/chocolate|praline|salado|japon[ée]s/i] },
  { name: "Nueces 500 g", q: "nueces", qty: 0.5, must: [/nuez|nueces/i], reject: [/moscada|chocolate|pec[aá]n|partida/i] },
  { name: "Piñones", q: "piñones", qty: 0.05, must: [/pi[ñn]on/i] },
  { name: "Sésamo integral 500 g", q: "sesamo integral", qty: 0.5, must: [/s[ée]samo/i, /integral/i] },
  // Duraderos
  { name: "Avena 500 g", q: "avena", qty: 0.5, must: [/avena/i], reject: [/harina|yogur|leche|bebida|instant[áa]nea|bocadito|salvado/i] },
  { name: "Bicarbonato de sodio 200 g", q: "bicarbonato", qty: 0.2, must: [/bicarbonato/i] },
  { name: "Copos de maíz 500 g", q: "copos", qty: 0.5, must: [/copos/i, /ma[íi]z/i], reject: [/chocolate|chocoflake|azucarado/i] },
  { name: "Polvo para hornear 100 g", q: "hornear", qty: 0.1, must: [/polvo/i, /hornear/i] },
  // Muy duraderos
  { name: "Arvejas 1 kg", q: "arvejas", qty: 1, must: [/arvejas?/i] },
  { name: "Chía 500 g", q: "chia", qty: 0.5, must: [/ch[íi]a/i] },
  { name: "Garbanzos 1 kg", q: "garbanzos", qty: 1, must: [/garbanzos?/i], reject: [/harina|tostad/i] },
  { name: "Lentejas 1 kg", q: "lentejas", qty: 1, must: [/lentejas?/i], reject: [/chocolate|harina/i] },
  { name: "Porotos negros 1 kg", q: "porotos negros", qty: 1, must: [/porotos?/i, /negros?/i], reject: [/tape|ojito/i] },
  { name: "Porotos de soja 1 kg", q: "soja", qty: 1, must: [/porotos?/i, /soja/i], reject: [/texturizada|milanesa/i] },
  { name: "Quínoa 1 kg", q: "quinoa", qty: 1, must: [/quinoa|qu[íi]noa/i], reject: [/pop|harina|inflad/i] },
  // Té y esencias: por paquete (el más barato que cumpla)
  { name: "Té negro", q: "te negro", qty: 1, unit: "un", must: [/t[ée] negro/i], reject: [/chocolate/i] },
  { name: "Té verde", q: "te verde", qty: 1, unit: "un", must: [/t[ée] verde/i], reject: [/chocolate/i] },
  { name: "Té de boldo", q: "boldo", qty: 1, unit: "un", must: [/boldo/i] },
  { name: "Vainilla", q: "chaucha de vainilla", qty: 1, unit: "un", must: [/vainilla/i, /chaucha|vaina/i], reject: [/esencia|extracto|az[uú]car|yogur/i] }, // la vaina, no esencia
  { name: "Salsa de pescado", q: "salsa de pescado", qty: 1, unit: "un", fuente: "ng", must: [/salsa de pescado/i], reject: [/aceite|c[áa]psula/i] }, // se compra en New Garden ("Otros lugares")
  // Especias · compra puntual
  { name: "Achiote 10 g", q: "achiote", qty: 0.01, must: [/achi?ote/i] },
  { name: "Anís 20 g", q: "anis", qty: 0.02, must: [/\ban[íi]s\b/i], reject: [/estrellado/i] },
  { name: "Cardamomo 20 g", q: "cardamomo", qty: 0.02, must: [/cardamomo/i] },
  { name: "Eneldo 10 g", q: "eneldo", qty: 0.01, must: [/eneldo/i] },
  { name: "Estragón 10 g", q: "estragon", qty: 0.01, must: [/estrag[óo]n/i] },
  { name: "Fenogreco 15 g", q: "fenogreco", qty: 0.015, must: [/fenogreco/i] },
].map((i) => ({ unit: i.unit || "kg", cercano: i.unit !== "un", ...i, reject: [RECHAZO_DIET, ...(i.reject || [])] }));

const NOMBRES_DIETETICA = ITEMS_DIETETICA.map((i) => i.name);

const nombreFa = (s) => String(s).replace(/&#(\d+);/g, (m, d) => String.fromCharCode(d)).replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/* Valores del atributo PESO: "500GS" / "250 GR" / "1KG" / "1k" → "500 g" / "1 kg" */
function normalizarPeso(v) {
  const m = String(v).match(/(\d+(?:[.,]\d+)?)\s*(kg|k|gs|grs?|g)\b/i);
  if (!m) return String(v).toLowerCase();
  const n = m[1].replace(",", ".");
  return /^k/i.test(m[2]) ? `${n} kg` : `${n} g`;
}

const precioFa = (prices) => Number(prices?.price) / 10 ** (Number(prices?.currency_minor_unit) || 0);

/* Producto simple → par nombre/precio (el tamaño viene en el nombre) */
function paresProductoFa(p) {
  const precio = precioFa(p.prices);
  return precio > 0 ? [{ nombre: nombreFa(p.name), precio, lista: precio }] : [];
}

/* Producto variable: junta el PESO (en el padre) con el precio (en la variación) */
function paresVariacionesFa(padre, variaciones) {
  const pesoPorId = new Map((padre.variations || []).map((v) => [v.id, (v.attributes || [])[0]?.value || ""]));
  const out = [];
  for (const v of variaciones) {
    const peso = pesoPorId.get(v.id);
    const precio = precioFa(v.prices);
    if (peso && precio > 0) out.push({ nombre: `${nombreFa(padre.name)} ${normalizarPeso(peso)}`, precio, lista: precio });
  }
  return out;
}

async function faJson(path) {
  const r = await fetch(`${FA}/${path}`, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; ElChanguito/1.0)" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

async function buscarFrutosAre(query) {
  const prods = await faJson(`products?search=${encodeURIComponent(query)}&per_page=25`);
  const out = [];
  for (const p of prods) {
    if (p.type === "variable" && (p.variations || []).length) {
      try {
        out.push(...paresVariacionesFa(p, await faJson(`products?type=variation&parent=${p.id}&per_page=25`)));
      } catch (e) { /* seguimos con el próximo producto */ }
      await dormir(250);
    } else {
      out.push(...paresProductoFa(p));
    }
  }
  return out;
}

/* New Garden (Magento): GraphQL público de catálogo */
function paresDesdeNewGarden(data) {
  const out = [];
  for (const it of data?.data?.products?.items || []) {
    if (it.stock_status && it.stock_status !== "IN_STOCK") continue;
    const min = it.price_range?.minimum_price || {};
    const precio = Number(min.final_price?.value);
    const lista = Number(min.regular_price?.value) || precio;
    const nombre = String(it.name || "").replace(/\s+/g, " ").trim();
    if (nombre && precio > 0) out.push({ nombre, precio, lista });
  }
  return out;
}

async function buscarNewGarden(query) {
  const gq = `{ products(search: ${JSON.stringify(query)}, pageSize: 20) { items { name stock_status price_range { minimum_price { final_price { value } regular_price { value } } } } } }`;
  const r = await fetch(NG, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; ElChanguito/1.0)" },
    body: JSON.stringify({ query: gq }),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return paresDesdeNewGarden(await r.json());
}

async function preciosDietetica() {
  const cacheFa = new Map(), cacheNg = new Map();
  const buscarFa = async (q) => {
    if (!cacheFa.has(q)) { cacheFa.set(q, await buscarFrutosAre(q)); await dormir(300); }
    return cacheFa.get(q);
  };
  const buscarNg = async (q) => {
    if (!cacheNg.has(q)) { cacheNg.set(q, await buscarNewGarden(q)); await dormir(300); }
    return cacheNg.get(q);
  };
  const out = [];
  for (const item of ITEMS_DIETETICA) {
    let el = null;
    if (item.fuente !== "ng") {
      try { el = elegir(item, await buscarFa(item.q)); } catch (e) { /* probamos New Garden */ }
    }
    if (!el) {
      try {
        const elNg = elegir(item, await buscarNg(item.q));
        if (elNg) el = { ...elNg, n: elNg.n + " · New Garden" };
      } catch (e) { /* sin red: queda sin match */ }
    }
    out.push([item.name, el]);
  }
  return out;
}

/* ---------- Selección según el criterio ---------- */
function elegir(item, candidatos) {
  const validos = [];
  for (const c of candidatos) {
    if (!item.must.every((re) => re.test(c.nombre))) continue;
    if (item.reject.some((re) => re.test(c.nombre))) continue;
    let q = parseQty(c.nombre);
    if (item.fraccionado) {
      // Venta por peso (quesos al mostrador): estimamos la fracción que compra el usuario
      // "Valor por kg / x kg" = precio POR KG aunque el nombre traiga el peso de la horma ("aprox. 4 kg")
      if (/(?:valor|\bpor|x)\s*(?:por\s*)?kg\b/i.test(c.nombre)) q = { amount: 1, unit: "kg" };
      else if (q.unit === "un" && item.asumirKg) q = { amount: 1, unit: item.unit };
      if (q.unit !== item.unit) continue;
      const porU = c.precio / q.amount;
      validos.push({ ...c, paquetes: 0, gramos: item.qty, estimado: porU * item.qty, porUnidad: porU });
    } else if (item.cercano) {
      // Dietética: referencia = cantidad del usuario × $/kg del paquete de tamaño MÁS
      // PARECIDO al que compra (no el más barato por kg: el kilo grande no lo puede
      // stockear). Bandas de similitud; dentro de la banda gana el más barato por kg.
      if (q.unit !== item.unit) continue;
      const ratio = Math.max(q.amount / item.qty, item.qty / q.amount);
      if (ratio > 25) continue;
      const porU = c.precio / q.amount;
      const banda = ratio <= 1.5 ? 0 : ratio <= 3 ? 1 : ratio <= 6 ? 2 : ratio <= 12 ? 3 : 4;
      validos.push({ ...c, paquetes: 0, gramos: item.qty, estimado: porU * item.qty, porUnidad: porU, banda });
    } else if (item.unit !== "un") {
      if (q.unit !== item.unit) continue;
      if (q.amount < item.qty * 0.2 || q.amount > item.qty * 3.5) continue; // tamaño similar
      const paquetes = Math.max(1, Math.ceil(item.qty / q.amount - 1e-9));
      validos.push({ ...c, paquetes, estimado: paquetes * c.precio, porUnidad: c.precio / q.amount });
    } else {
      // Por unidad: si el nombre trae "x N", un paquete cubre N unidades
      if (item.comparaPor && q.unit !== item.comparaPor) continue; // ej. crema: solo tamaños en cc/litros
      const unidades = q.unit === "un" ? (q.amount || 1) : 1;
      const paquetes = Math.max(1, Math.ceil((item.qty || 1) / unidades - 1e-9));
      // comparaPor: entre tamaños del mismo producto gana el más barato POR kg/L, no por pote
      const porUnidad = item.comparaPor ? c.precio / q.amount : c.precio / unidades;
      validos.push({ ...c, paquetes, estimado: paquetes * c.precio, porUnidad });
    }
  }
  if (!validos.length) return null;
  validos.sort(item.cercano
    ? (a, b) => a.banda - b.banda || a.porUnidad - b.porUnidad
    : item.comparaPor
      ? (a, b) => a.porUnidad - b.porUnidad || a.estimado - b.estimado
      : (a, b) => a.estimado - b.estimado || a.porUnidad - b.porUnidad);
  const g = validos[0];
  const desc = g.lista > g.precio ? Math.round((1 - g.precio / g.lista) * 100) : 0;
  const limpio = g.nombre.replace(/\s+/g, " ").replace(/\s+x\s*kg\.?$/i, "").trim().slice(0, 60);
  let nota;
  if (g.paquetes === 0) {
    const cant = g.gramos >= 1 ? (Math.round(g.gramos * 100) / 100).toLocaleString("es-AR") + " kg" : Math.round(g.gramos * 1000) + " g";
    nota = cant + " de " + limpio + " · $" + Math.round(g.porUnidad).toLocaleString("es-AR") + "/kg";
  } else {
    nota = (g.paquetes > 1 ? g.paquetes + "× " : "") + limpio + (desc >= 5 ? ` · oferta -${desc}%` : "");
    if (item.comparaPor) nota += " · $" + Math.round(g.porUnidad).toLocaleString("es-AR") + "/" + (item.comparaPor === "l" ? "L" : item.comparaPor);
  }
  return { p: Math.round(g.estimado), n: nota };
}

/* ---------- Principal ---------- */
async function main() {
  const archivo = "precios.json";
  const previo = fs.existsSync(archivo) ? JSON.parse(fs.readFileSync(archivo, "utf8")) : { prices: {} };
  const precios = { ...(previo.prices || {}) };
  let ok = 0, fallos = [];

  for (const item of ITEMS) {
    let elegido = null;
    try {
      const candidatos = await buscarVtex(DIA, item.q);
      elegido = elegir(item, candidatos);
    } catch (e) {
      // API caída o bloqueada: probamos la página de categoría si la tenemos
      if (item.cat) {
        try {
          const candidatos = await buscarCategoriaHtml(item.cat);
          elegido = elegir(item, candidatos);
        } catch (e2) { /* nada */ }
      }
    }
    if (elegido) {
      precios[item.name] = elegido;
      ok++;
      console.log(`✔ ${item.name} → $${elegido.p}  (${elegido.n})`);
    } else {
      fallos.push(item.name);
      console.log(`✘ ${item.name} → sin match (queda el precio anterior si había)`);
    }
    await dormir(ESPERA_MS);
  }

  // --- El Puente ---
  console.log("\n— El Puente —");
  let candEP = [];
  try { candEP = await candidatosElPuente(); } catch (e) { console.log("EL PUENTE: error → " + e.message); }
  if (candEP.length > 0) {
    console.log(`(listado con ${candEP.length} entradas)`);
    for (const item of ITEMS_ELPUENTE) {
      const el = elegir(item, candEP);
      if (el) {
        precios[item.name] = el;
        ok++;
        console.log(`✔ ${item.name} → $${el.p}  (${el.n})`);
      } else {
        fallos.push(item.name);
        console.log(`✘ ${item.name} → sin match en el listado`);
      }
    }
  } else {
    console.log("EL PUENTE: no pude leer el listado (se carga por JavaScript). Pasale este log a Claude para ajustar el lector.");
    ITEMS_ELPUENTE.forEach((i) => fallos.push(i.name));
  }

  // --- COTO ---
  console.log("\n— COTO —");
  let resCoto = [];
  try { resCoto = await preciosCoto(); } catch (e) { console.log("COTO: error → " + e.message); }
  if (resCoto.length === 0) resCoto = NOMBRES_COTO.map((n) => [n, null]);
  for (const [name, el] of resCoto) {
    if (el) {
      precios[name] = el;
      ok++;
      console.log(`✔ ${name} → $${el.p}  (${el.n})`);
    } else {
      fallos.push(name);
      console.log(`✘ ${name} → sin match (queda el precio anterior si había)`);
    }
  }

  // --- Dietética (Frutos del Are, precios de referencia) ---
  console.log("\n— Dietética (Frutos del Are, referencia) —");
  let resDiet = [];
  try { resDiet = await preciosDietetica(); } catch (e) { console.log("DIETÉTICA: error → " + e.message); }
  if (resDiet.length === 0) resDiet = NOMBRES_DIETETICA.map((n) => [n, null]);
  for (const [name, el] of resDiet) {
    if (el) {
      precios[name] = el;
      ok++;
      console.log(`✔ ${name} → $${el.p}  (${el.n})`);
    } else {
      fallos.push(name);
      console.log(`✘ ${name} → sin match (queda el precio anterior si había)`);
    }
  }

  if (ok === 0) {
    console.error("\nNingún ítem se pudo actualizar: no escribo el archivo para no romper nada.");
    process.exit(1);
  }

  fs.writeFileSync(archivo, JSON.stringify({ version: fechaHoyAR(), prices: precios }, null, 2) + "\n");
  console.log(`\nListo: ${ok}/${ITEMS.length + ITEMS_ELPUENTE.length + NOMBRES_COTO.length + NOMBRES_DIETETICA.length} ítems actualizados en ${archivo} (versión ${fechaHoyAR()}).`);
  if (fallos.length) console.log("Sin match (revisar consultas): " + fallos.join(", "));
}

export {
  parseQty, elegir, ITEMS, ITEMS_ELPUENTE, parsearListadoElPuente, candidatosElPuente,
  ITEMS_COTO, PARTES_CARNE, NOMBRES_COTO, modaPrecios, paresDesdeCoto, porKgCoto, notaPorKg, comboCoto, asadoCoto, buscarCoto,
  ITEMS_DIETETICA, NOMBRES_DIETETICA, RECHAZO_DIET, normalizarPeso, paresProductoFa, paresVariacionesFa, buscarFrutosAre,
  paresDesdeNewGarden, buscarNewGarden, preciosDietetica,
};

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  main();
}
