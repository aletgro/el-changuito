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
  { name: "Harina de maíz 1 kg", q: "harina de maiz", unit: "kg", qty: 1, must: [/harina/i, /ma[ií]z/i], reject: [/presto|quesos|espinaca|vegetales/i], cat: DIA + "/almacen/harinas/harinas-de-maiz" },
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
  { name: "Arvejas en lata", q: "arvejas", unit: "un", qty: 1, must: [/arvejas/i], reject: [/secas|partidas|congelad/i] },
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
  const pack = s.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|grs?|gr\.|g|ml|cc|lts?|lt\.|l|m(?:ts?)?)\b/);
  if (pack) {
    mult = parseInt(pack[1], 10) || 1;
    base = pack[2] + " " + pack[3];
  } else {
    // "x N" es multiplicador solo si N no es un tamaño ("x 3 ud." sí; "x 190 g" no)
    const mx = s.match(/(?:^|\s)x\s*(\d+)\b(?!\s*(?:kg|grs?|gr\.|g|ml|cc|lts?|lt\.|l|m(?:ts?)?)\b)/);
    if (mx) mult = parseInt(mx[1], 10) || 1;
  }
  let m;
  if ((m = base.match(/(\d+(?:\.\d+)?)\s*kg\b/))) return { amount: parseFloat(m[1]) * mult, unit: "kg" };
  if ((m = base.match(/(\d+(?:\.\d+)?)\s*(?:grs?|gr\.|g)\b/))) return { amount: (parseFloat(m[1]) / 1000) * mult, unit: "kg" };
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
  validos.sort(item.comparaPor
    ? (a, b) => a.porUnidad - b.porUnidad || a.estimado - b.estimado
    : (a, b) => a.estimado - b.estimado || a.porUnidad - b.porUnidad);
  const g = validos[0];
  const desc = g.lista > g.precio ? Math.round((1 - g.precio / g.lista) * 100) : 0;
  const limpio = g.nombre.replace(/\s+/g, " ").trim().slice(0, 60);
  let nota;
  if (g.paquetes === 0) {
    nota = Math.round(g.gramos * 1000) + " g de " + limpio + " · $" + Math.round(g.porUnidad).toLocaleString("es-AR") + "/kg";
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

  if (ok === 0) {
    console.error("\nNingún ítem se pudo actualizar: no escribo el archivo para no romper nada.");
    process.exit(1);
  }

  fs.writeFileSync(archivo, JSON.stringify({ version: fechaHoyAR(), prices: precios }, null, 2) + "\n");
  console.log(`\nListo: ${ok}/${ITEMS.length + ITEMS_ELPUENTE.length} ítems actualizados en ${archivo} (versión ${fechaHoyAR()}).`);
  if (fallos.length) console.log("Sin match (revisar consultas): " + fallos.join(", "));
}

export { parseQty, elegir, ITEMS, ITEMS_ELPUENTE, parsearListadoElPuente, candidatosElPuente };

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  main();
}
