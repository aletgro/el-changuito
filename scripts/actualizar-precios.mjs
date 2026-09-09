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
import { ultimoDiaMercadoCentral } from "./mercado-central.mjs";

const DIA = "https://diaonline.supermercadosdia.com.ar";
const ESPERA_MS = 800; // pausa entre consultas para no castigar al sitio

/* ---------- Descuentos adicionales por comercio ----------
   EDITAR ACÁ cuando cambien las promos (otros días, otros porcentajes u otros
   comercios). La clave es el id del comercio EN LA APP (dia, coto, farma, puente,
   diet, otros). Cada promo lleva `dia: "martes"` (un día) o `dias: [...]` (varios),
   `pct`, y opcionalmente `tope` = máximo de descuento en $ (la app avisa cuando lo
   pendiente supera lo que el tope devuelve). Viaja en precios.json (campo
   `descuentos`); la app muestra el precio con y sin dto para decidir qué día comprar.
   Vigente hoy (11/08/2026): DIA martes -20% y jueves -15% · El Puente lun a vie -20%
   con tope de $6.000 de descuento · COTO martes -20%, miércoles -15%, jueves -30%
   y viernes -25%. */
const DESCUENTOS = {
  dia: [
    { dia: "martes", pct: 20 },
    { dia: "miércoles", pct: 10 },
    { dia: "jueves", pct: 15 },
  ],
  puente: [
    { dias: ["lunes", "martes", "miércoles", "jueves", "viernes"], pct: 20, tope: 6000 },
  ],
  // COTO: la promo NO aplica a la carnicería ni a las harinas comunes (las "de
  // fuerza" sí). `sin` excluye por nombre de sección de la app y/o de ítem.
  coto: {
    sin: { secciones: ["Carnicería"], items: ["Harina 000", "Harina 0000"] },
    promos: [
      { dia: "martes", pct: 20 },
      { dia: "miércoles", pct: 15 },
      { dia: "jueves", pct: 30 },
      { dia: "viernes", pct: 25 },
    ],
  },
};

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
  // Una botella de la más barata POR LITRO, del tamaño que sea (900 ml o 1,5 L); si la promo es "llevando 2", valen 2
  { name: "Aceite de girasol", q: "aceite de girasol", unit: "un", qty: 1, comparaPor: "l", must: [/aceite/i, /girasol/i], reject: [/fritolim|oleico|spray/i], cat: DIA + "/almacen/aceites-y-aderezos/aceites-de-girasol" },
  // Botellas y bidones compiten por litro; si Glaciar no gana, la nota muestra su diferencia
  { name: "Agua mineral bidón", q: ["agua mineral", "agua bidon", "agua glaciar"], unit: "l", qty: 6, marca: { re: /glaciar/i, nombre: "Glaciar" }, must: [/agua/i], reject: [/con gas|gasificada|saborizada|t[óo]nica|levit[eé]|manzana|naranja|limonada|pomelo/i], cat: DIA + "/bebidas/aguas/aguas-sin-gas" },
  { name: "Arroz integral 1 kg", q: "arroz integral", unit: "kg", qty: 1, must: [/arroz/i, /integral/i], reject: [/tostadita|galleta|preparado/i], cat: DIA + "/almacen/pastas-y-arroces/arroces" },
  // Solo entero al natural (en DIA los enteros son "Lomitos"/"Lomos"); mejor precio POR LATA (packs x3 cuentan)
  { name: "Atún", q: "atun", unit: "un", qty: 1, comparaPor: "un", must: [/at[uú]n/i, /al natural/i], reject: [/desmenuzado|rallado|en aceite|ensalada|pat[eé]|gato|perro|alimento|felix|whiskas/i], cat: DIA + "/almacen/conservas/conservas-de-pescados" },
  { name: "Azúcar 500 g", q: "azucar", unit: "kg", qty: 0.5, must: [/az[uú]car/i], reject: [/mascabo|rubia|light|org[áa]nica|impalpable/i], cat: DIA + "/desayuno/infusiones-y-endulzantes/azucar" },
  // q amplia: en DIA aparece como "Grasa Bovina" o "Grasa Vacuna" según el envase
  { name: "Grasa bovina 1 kg", q: "grasa", unit: "kg", qty: 1, must: [/grasa/i, /bovina|vacuna/i], reject: [/vegetal/i], cat: DIA + "/frescos/pastas-frescas/levaduras-y-grasas" },
  // Confirmado por el usuario (09/08/2026): es la Morixe para arepas (el nombre no dice "maíz")
  { name: "Harina de maíz 1 kg", q: "harina arepas", unit: "kg", qty: 1, must: [/harina/i, /arepas/i], reject: [], cat: DIA + "/almacen/harinas/harinas-de-maiz" },
  { name: "Leche larga vida", q: "leche entera larga vida", unit: "l", qty: 1, must: [/leche/i, /entera/i], reject: [/polvo|chocolatada|descremada|s[ée]mi|deslactosada/i] },
  { name: "Maicena 500 g", q: "almidon de maiz", unit: "kg", qty: 0.5, must: [/almid[óo]n|maizena/i], reject: [/bio|premezcla/i], cat: DIA + "/almacen/harinas/harinas-de-maiz" },
  { name: "Papas fritas", q: "papas fritas tubo", unit: "kg", qty: 0.15, must: [/papas fritas/i, /tubo/i], reject: [/congelad/i], cat: DIA + "/almacen/picadas/papas-fritas" },
  { name: "Polenta 1 kg", q: "polenta", unit: "kg", qty: 1, must: [/polenta/i], reject: [/quesos|espinaca|vegetales|lista/i], cat: DIA + "/almacen/harinas/harinas-de-maiz" },
  { name: "Sal entrefina 500 g", q: "sal entrefina", unit: "kg", qty: 0.5, must: [/sal/i, /entrefina/i], reject: [], cat: DIA + "/almacen/aceites-y-aderezos/sal" },
  // "fina" como palabra entera: "Sal ENTREfina" no es sal fina (08/09/2026). "sal" entera deja afuera Celusal/Salvado/Salame.
  { name: "Sal fina 500 g", q: "sal fina", unit: "kg", qty: 0.5, must: [/\bsal\b/i, /\bfina\b/i], reject: [/entrefina|light|marina|apio|aj[oi]|salero/i], cat: DIA + "/almacen/aceites-y-aderezos/sal" },
  { name: "Sal gruesa 500 g", q: "sal gruesa", unit: "kg", qty: 0.5, must: [/sal/i, /gruesa/i], reject: [/parrillera light/i], cat: DIA + "/almacen/aceites-y-aderezos/sal" },
  { name: "Vinagre de alcohol 1 L", q: "vinagre de alcohol", unit: "l", qty: 1, must: [/vinagre/i, /alcohol/i], reject: [] },
  { name: "Vinagre de manzana 500 ml", q: "vinagre de manzana", unit: "l", qty: 0.5, must: [/vinagre/i, /manzana/i], reject: [] }, // envase real: 500 ml
  { name: "Yerba 1 kg", q: ["yerba mate", "yerba playadito"], unit: "kg", qty: 1, marca: { re: /playadito/i, nombre: "Playadito" }, must: [/yerba/i], reject: [/mate cocido|saquitos|compuesta|c[áa]psula/i], cat: DIA + "/desayuno/infusiones-y-endulzantes/yerba-mate" },
  // --- Limpieza e higiene ---
  { name: "Aerosol de ambiente", q: "desodorante de ambiente aerosol", unit: "un", qty: 1, must: [/ambiente/i], reject: [/repuesto|el[ée]ctrico|autom[áa]tico/i] },
  { name: "Bolsa de basura baño", q: "bolsas de residuos", unit: "un", qty: 1, must: [/residuo|basura/i], reject: [/consorcio/i] },
  { name: "Cif crema", q: "cif crema", unit: "un", qty: 1, must: [/cif/i, /crema/i], reject: [] },
  { name: "Desinfectante de piso", q: "limpiador de pisos", unit: "un", qty: 1, must: [/piso/i], reject: [/madera|autobrillo|cera/i] },
  { name: "Desinfectante de superficies", q: "desinfectante superficies", unit: "un", qty: 1, must: [/desinfectante|lysoform|espadol/i], reject: [/piso|ropa/i] },
  { name: "Detergente líquido", q: "detergente", unit: "un", qty: 1, must: [/detergente/i], reject: [/ropa|matic|lavavajillas autom/i] },
  { name: "Esponja salvauñas", q: "esponja salvaunas", unit: "un", qty: 1, must: [/esponja/i, /salvau[ñn]as/i], reject: [] }, // el usuario compra las salvauñas
  { name: "Guantes grandes", q: "guantes grandes", unit: "un", qty: 1, must: [/guantes?/i, /grandes?/i], reject: [/median|chic[oa]|peque[ñn]/i] }, // talle grande; el más barato por paquete (08/09/2026)
  { name: "Jabón Dove", q: "jabon dove", unit: "un", qty: 1, must: [/dove/i, /jab[óo]n/i], reject: [/l[íi]quido/i] },
  { name: "Jabón líquido manos", q: "jabon liquido manos", unit: "un", qty: 1, must: [/jab[óo]n l[íi]quido/i], reject: [/ropa|matic/i] },
  { name: "Jabón líquido ropa", q: "jabon liquido para ropa", unit: "l", qty: 3, must: [/jab[óo]n l[íi]quido|jab[óo]n para ropa/i], reject: [/manos|tocador|glicerina/i] },
  { name: "Lavandina", q: "lavandina", unit: "l", qty: 1, must: [/lavandina/i], reject: [/ropa color/i] },
  { name: "Limpia vidrios", q: "limpiavidrios", unit: "un", qty: 1, must: [/vidrio/i], reject: [/auto/i] },
  { name: "Papel higiénico", q: "papel higienico", unit: "m", qty: 120, must: [/higi[ée]nico/i], reject: [/h[úu]medo/i] },
  { name: "Pastilla inodoro", q: "pastilla inodoro", unit: "un", qty: 1, must: [/inodoro/i], reject: [] },
  { name: "Rollo de cocina", q: "rollo de cocina", unit: "un", qty: 1, must: [/cocina/i, /rollo|papel/i], reject: [] },
  // UNA botella, la más barata POR LITRO del tamaño que sea (igual que el aceite; pedido 08/09/2026)
  // (las dos búsquedas: con "para ropa" DIA no devuelve el doypack de 3 L, que es el más barato por litro)
  { name: "Suavizante", q: ["suavizante para ropa", "suavizante"], unit: "un", qty: 1, comparaPor: "l", must: [/suavizante/i], reject: [] },
  { name: "Trapo de piso", q: "trapo de piso", unit: "un", qty: 1, must: [/trapo/i, /piso/i], reject: [] },
  // Debe ser un TRAPO: la "Rejilla Pastelera" (de metal, para enfriar tortas) no cuenta
  { name: "Trapo rejilla", q: "trapo rejilla", unit: "un", qty: 1, must: [/trapo/i, /rejilla/i], reject: [/pastelera|parrilla|horno/i] },
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
  // Rollos de cocina: el rollo más barato (el usuario NO quiere comparar por metro)
  { name: "Film transparente", q: "film", unit: "un", qty: 1, must: [/film/i], reject: [] },
  { name: "Papel aluminio", q: "papel aluminio", unit: "un", qty: 1, must: [/aluminio/i], reject: [/molde|bandeja/i] },
  { name: "Papel manteca", q: "papel manteca", unit: "un", qty: 1, must: [/papel/i, /manteca/i], reject: [/untable/i] },
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
  // (el factor de protección "Fps 50 x 50 ml" / "SPF 30 x 190 ml" NO es un pack de 50: se excluye)
  // (y el número tiene que empezar ahí: si no, "fps 15 x 200 ml" matchea desde el "5" como pack de 5)
  const pack = s.match(/(?<!\b(?:fps|spf)\s*)(?<![\d.,])(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(kgm?|grs?|grm|gs|gr\.|g|ml|cc|lts?|lt\.|l|m(?:ts?)?)\b/);
  if (pack) {
    mult = parseInt(pack[1], 10) || 1;
    base = pack[2] + " " + pack[3];
  } else {
    // "x N" es multiplicador solo si N no es un tamaño ("x 3 ud." sí; "x 190 g" no)
    const mx = s.match(/(?:^|\s)x\s*(\d+)\b(?!\s*(?:kgm?|grs?|grm|gs|gr\.|g|ml|cc|lts?|lt\.|l|m(?:ts?)?)\b)/);
    if (mx) mult = parseInt(mx[1], 10) || 1;
    else {
      // "2u" / "3 un" / "6 unidades" sin la x (COTO: "Ajo en malla 2u")
      const mu = s.match(/(?:^|\s)(\d+)\s*(?:u|ud|uds|un|uni|unid|unidades)\.?(?=\s|$)/);
      if (mu) mult = parseInt(mu[1], 10) || 1;
    }
  }
  let m;
  if ((m = base.match(/(\d+(?:\.\d+)?)\s*(?:kgm?|kilos?)\b/))) return { amount: parseFloat(m[1]) * mult, unit: "kg" };
  if ((m = base.match(/(\d+(?:\.\d+)?)\s*(?:grm|grs?|gs|gr\.|g)\b/))) return { amount: (parseFloat(m[1]) / 1000) * mult, unit: "kg" };
  if ((m = base.match(/(\d+(?:\.\d+)?)\s*(?:ml|cc)\b/))) return { amount: (parseFloat(m[1]) / 1000) * mult, unit: "l" };
  if ((m = base.match(/(\d+(?:\.\d+)?)\s*(?:lts?|lt\.|l)\b/))) return { amount: parseFloat(m[1]) * mult, unit: "l" };
  if ((m = base.match(/(\d+(?:\.\d+)?)\s*m(?:ts?)?\b/))) return { amount: parseFloat(m[1]) * mult, unit: "m" };
  if (/\bkilo\b|\bx\s*kg\b/.test(s)) return { amount: mult, unit: "kg" }; // "x kilo" / "x kg" sin dígito (Pesce, DIA)
  return { amount: mult, unit: "un" };
}

/* Página del producto en el sitio de origen: viaja con cada candidato y, si gana, en
   precios.json (`url`), para poder abrirlo desde la app y verlo en el navegador.
   Solo se agrega si existe (El Puente publica un listado sin páginas por producto). */
const conUrl = (obj, url) => (url ? { ...obj, url } : obj);
/* Sección del sitio a la que pertenece el producto (`cat`, texto con la ruta de categorías):
   Verdulería exige que el candidato venga de "Frutas y Verduras" del súper (DIA `categories`,
   COTO `groups`), no alcanza con que el nombre diga "morrón" (fideos, dulces, congelados…). */
const conCat = (obj, cat) => (cat ? { ...obj, cat } : obj);
/* Descuento/promo SOLO ONLINE (pedido 09/09/2026): el candidato lleva `online: true`, la nota
   termina en "· solo online" y en precios.json viaja `online` para que la app lo marque.
   DIA/Farmacity lo dicen en el nombre del teaser o del highlight ("2x1 Solo Web", "-50% Solo
   Web"); COTO en sale_type "Exclusivas" y las imágenes OfertaDigital/ExclusivoDigital. */
const ONLINE_RE = /solo web|s[oó]lo online|exclusiv[oa]s? (?:web|online|digital)|exclusivo digital/i;
const conOnline = (obj, online) => (online ? { ...obj, online: true } : obj);
const SOLO_ONLINE = " · solo online";

/* ---------- Fuente 1: API pública de VTEX (DIA y Farmacity la usan) ---------- */

/* Promos "llevando N" que NO están aplicadas en Price (2x1, 3x2, 2da unidad al X%):
   viajan en los Teasers de la oferta. Devuelve el factor sobre el precio por unidad. */
function promoVtex(offer) {
  const s = JSON.stringify([...(offer.PromotionTeasers || []), ...(offer.Teasers || [])]);
  if (s === "[]") return null;
  if (/2\s*x\s*1/i.test(s)) return { factor: 0.5, txt: "2x1 llevando 2" };
  if (/3\s*x\s*2/i.test(s)) return { factor: 2 / 3, txt: "3x2 llevando 3" };
  const m = s.match(/(\d{1,3})\s*%[^"]*?(?:2°|2d[oa]|segunda)/i) || s.match(/(?:2°|2d[oa]|segunda)[^"]*?(\d{1,3})\s*%/i);
  if (m) {
    const d = Number(m[1]);
    if (d > 0 && d <= 100) return { factor: (2 - d / 100) / 2, txt: `2da unidad -${d}% llevando 2` };
  }
  return null;
}

/* Respuesta del buscador VTEX → pares nombre/precio (+ `link` = página del producto) */
function paresDesdeVtex(data) {
  const out = [];
  for (const p of data) {
    const nombre = p.productName || "";
    for (const it of p.items || []) {
      for (const sel of it.sellers || []) {
        const of = sel.commertialOffer || {};
        if (of.Price > 0 && of.AvailableQuantity > 0) {
          const cat = (p.categories || []).join(" ");
          const textos = (arr) => (arr || []).map((t) => t["<Name>k__BackingField"] || t.Name || t.name || "").join(" | ");
          // el descuento ya aplicado al precio se anuncia en DiscountHighLight/clusterHighlights; la promo "llevando N" en los Teasers
          const onlineBase = of.ListPrice > of.Price && ONLINE_RE.test(textos(of.DiscountHighLight) + " " + Object.values(p.clusterHighlights || {}).join(" "));
          const onlinePromo = ONLINE_RE.test(textos(of.Teasers) + " " + textos(of.PromotionTeasers));
          out.push(conOnline(conCat(conUrl({ nombre, precio: of.Price, lista: of.ListPrice || of.Price }, p.link), cat), onlineBase));
          // La promo compite como candidato aparte, con el precio efectivo por unidad y la condición a la vista
          const promo = promoVtex(of);
          if (promo) out.push(conOnline(conCat(conUrl({ nombre: `${nombre} · ${promo.txt}`, precio: of.Price * promo.factor, lista: of.ListPrice || of.Price }, p.link), cat), onlineBase || onlinePromo));
        }
      }
    }
  }
  return out;
}

/* VTEX devuelve de a 50 como máximo (`_from`/`_to`) y avisa el total en el header
   `resources: 0-49/147`. Se recorren TODAS las páginas (tope `maximo`): en Farmacity
   "pasta dental" tiene 147 resultados y la Oral B de 180 g a $3.351 estaba en la
   página 2 (09/09/2026); "desodorante" tiene 450. */
const VTEX_PAGINA = 50;
async function buscarVtex(base, query, maximo = 500) {
  const out = [];
  for (let desde = 0; desde < maximo; desde += VTEX_PAGINA) {
    const url = `${base}/api/catalog_system/pub/products/search/?ft=${encodeURIComponent(query)}&_from=${desde}&_to=${desde + VTEX_PAGINA - 1}`;
    const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; ElChanguito/1.0)" } });
    if (!r.ok) { if (desde === 0) throw new Error("HTTP " + r.status); break; } // una página tardía caída: nos quedamos con lo leído
    const data = await r.json();
    if (!Array.isArray(data)) { if (desde === 0) throw new Error("respuesta inesperada"); break; }
    out.push(...paresDesdeVtex(data));
    const total = Number((String(r.headers?.get?.("resources") || "").match(/\/(\d+)\s*$/) || [])[1]) || 0;
    if (data.length < VTEX_PAGINA || (total && desde + VTEX_PAGINA >= total)) break;
    await dormir(300);
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

/* Para los picks de queso, el robot también publica el precio de CADA opción
   (campo `op` en precios.json, claves = nombres de las opciones en la app).
   En la app, al comprar, se le puede cargar a cada queso el dto del local
   (las promos de mostrador rotan y no son legibles por el robot). */
function opcionesElPuente(item, candidatos) {
  if (!item.op) return null;
  const out = {};
  for (const [nombre, re] of Object.entries(item.op)) {
    const el = elegir({ ...item, op: undefined, must: [/el puente/i, re, /fracc/i] }, candidatos);
    if (el) out[nombre] = el.p;
  }
  return Object.keys(out).length ? out : null;
}

const ITEMS_ELPUENTE = [
  // Solo marca El Puente (pedido del usuario, 09/08/2026: nada de D70 ni otras marcas).
  // fraccionado: compra al mostrador → solo líneas "fraccionado/fracc." (la horma entera es otro precio)
  { name: "Fundente", qty: 0.8, unit: "kg", fraccionado: true, asumirKg: true, must: [/el puente/i, /cremoso|por salut/i, /fracc/i], reject: [/pizzero|light|untable|sachet/i] }, // ~800 g por vez
  { name: "Pizza", qty: 0.4, unit: "kg", fraccionado: true, asumirKg: true, must: [/el puente/i, /m[uo]zz?arella/i, /fracc/i], reject: [/rallad|light/i] }, // solo mozzarella
  { name: "Provoletta", qty: 0.3, unit: "kg", must: [/el puente/i, /provolet/i], reject: [/rallad/i] }, // se vende en piezas de ~190 g
  { name: "Queso para picada", qty: 0.3, unit: "kg", fraccionado: true, asumirKg: true, must: [/el puente/i, /fontina|gouda|gruyer|mar del plata|pategr[aá]s|holanda/i, /fracc/i], reject: [/rallad/i],
    op: { "Fontina": /fontina/i, "Gouda": /gouda/i, "Gruyere": /gruyer/i, "Mar del Plata": /mar del plata/i } },
  { name: "Queso para rayar", qty: 0.3, unit: "kg", fraccionado: true, asumirKg: true, must: [/el puente/i, /sardo|reggianito|romano|provolone/i, /fracc/i], reject: [/rallad/i],
    op: { "Sardo": /sardo/i, "Reggianito": /reggianito/i, "Romano": /roman/i, "Provolone": /provolone/i } },
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
/* Página del producto en coto.com.ar: /productos/<slug>/_/R-… (el slug es decorativo; el
   sitio lo arma así a partir del nombre). data.url del buscador trae solo "_/R-00000602-00000602-200". */
const COTO_PROD = "https://www.coto.com.ar/productos/";
const slugCoto = (nombre) => String(nombre).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-/, "") + "-";
const urlCoto = (nombre, tail) => (tail ? COTO_PROD + slugCoto(nombre) + "/" + String(tail).replace(/^\/+/, "") : "");

const ITEMS_COTO = [
  // Harinas Chacabuco (identificadas por foto de góndola, 09/08/2026):
  //   "de fuerza" W300 13 g prot = "Harina Para Masa Madre" · Napolitana = "Harina de Trigo 00"
  { name: "Harina 000", q: "harina chacabuco", unit: "kg", qty: 1, must: [/chacabuco/i, /\b000\b/], reject: [/premezcla|leudante|integral|saborizada|masa madre|org[áa]nica/i] },
  { name: "Harina 0000", q: "harina chacabuco", unit: "kg", qty: 1, must: [/chacabuco/i, /\b0000\b/], reject: [/premezcla/i] },
  { name: "Harina 000 de fuerza", q: "harina chacabuco", unit: "kg", qty: 1, must: [/chacabuco/i, /masa madre/i], reject: [/premezcla|blend/i] },
  { name: "Harina 0000 de fuerza", q: "harina chacabuco", unit: "kg", qty: 1, must: [/chacabuco/i, /\b00\b/], reject: [/premezcla/i] },
  { name: "Harina integral", q: "harina chacabuco", unit: "kg", qty: 1, must: [/chacabuco/i, /integral/i], reject: [/semillas|org[áa]nica|premezcla/i] },
  { name: "Semolín", q: "harina chacabuco", unit: "kg", qty: 1, must: [/semol[íi]n/i], reject: [] },
  // Solo Pureza o Bonalma (pedido del usuario, 04/09/2026): la marca COTO no cuenta aunque esté en 2x1
  { name: "Sémola", q: "semola", unit: "kg", qty: 0.5, must: [/s[ée]mola/i, /pureza|bonalma/i], reject: [/\bfid|fideo|spaghetti|tallar|ñoqui|vitina|premezcla/i] },
  // Almacén
  { name: "Extracto de tomate", q: "extracto de tomate", unit: "kg", qty: 0.15, must: [/extracto/i, /tomate/i], reject: [] },
  // Carnicería: pollo entero SOLO refrigerado (no congelado), el más barato POR KILO
  // entre lo que tiene precio publicado (se vende por unidad, ej. "X Uni (4 Kg)")
  { name: "Pollo entero", q: "pollo entero", unit: "un", qty: 1, comparaPor: "kg", must: [/pollo/i, /entero/i, /refrigerado|fresco/i], reject: [/congelad|spiedo|relleno|trozado|arrollado|matambre|milanesa|empanad|brochette|bocadito/i] },
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

/* Ofertas de COTO: NO tocan listPrice, viajan en data.discounts[] como
   { discountText: "15%Dto" | "2x1" | "3x2" | "2do al 50%", discountPrice: "$14956.60",
     takingText: "Llevando 3" | null }. Devuelve el precio efectivo por unidad y la
   condición (null = descuento directo, ya vale llevando 1). */
function promoCoto(dto, precioBase) {
  if (!dto) return null;
  const texto = String(dto.discountText || "");
  let precio = parseFloat(String(dto.discountPrice || "").replace(/[^\d.]/g, ""));
  if (!(precio > 0)) {
    let factor = null, m;
    if (/2\s*x\s*1/i.test(texto)) factor = 0.5;
    else if (/3\s*x\s*2/i.test(texto)) factor = 2 / 3;
    else if ((m = texto.match(/(\d{1,3})\s*%/))) factor = /2°|2d[oa]|segund/i.test(texto) ? (2 - m[1] / 100) / 2 : 1 - m[1] / 100;
    if (factor === null || factor <= 0 || factor >= 1) return null;
    precio = precioBase * factor;
  }
  if (!(precio > 0) || precio >= precioBase) return null;
  const llevando = (String(dto.takingText || "").match(/llevando\s*(\d+)/i) || [])[1];
  const etiqueta = /x\s*\d/i.test(texto) ? texto.replace(/\s+/g, "") : `-${(texto.match(/\d{1,3}/) || [Math.round((1 - precio / precioBase) * 100)])[0]}%`;
  return { precio, txt: llevando ? `${etiqueta} llevando ${llevando}` : null };
}

/* Categorías de COTO: data.groups[] trae grupos con display_name y path_list (la ruta completa,
   "Categorias › Frescos › Frutas y Verduras › Hortalizas"); las juntamos en un texto. */
function catCoto(groups) {
  const nombres = [];
  for (const g of groups || []) {
    for (const p of g.path_list || []) if (p.display_name) nombres.push(p.display_name);
    if (g.display_name) nombres.push(g.display_name);
  }
  return [...new Set(nombres)].join(" / ");
}

/* Respuesta del buscador de Constructor → pares nombre/precio (+ url de la página del producto).
   SKUs FANTASMA: el catálogo trae productos con precio en todas las sucursales pero
   `store_availability` VACÍO (la "Cebolla Premium" a $999, las bolsas a $299, la Sémola COTO
   en 2x1): no se venden en ninguna sucursal y no se encuentran en el sitio → se descartan. */
function paresDesdeCoto(data) {
  const out = [];
  for (const res of data?.response?.results || []) {
    const nombre = String(res.value || "").replace(/\s+/g, " ").trim();
    const sucursales = res.data?.store_availability;
    if (Array.isArray(sucursales) && sucursales.length === 0) continue;
    const valores = (res.data?.price || []).map((p) => p.listPrice ?? p.formatPrice).filter((v) => v > 0);
    const precio = modaPrecios(valores);
    if (!nombre || !precio) continue;
    const url = urlCoto(nombre, res.data?.url);
    const cat = catCoto(res.data?.groups);
    // Pesables (product_weighable = 1, se cobra por KGS): listPrice es POR KILO aunque el nombre
    // diga "Bolsa Entre 1,5 Kg A 2 Kg" (la papa de COTO, 08/09/2026)
    const pesable = Number(res.data?.product_weighable) === 1 || /^KGS?$/i.test(String(res.data?.product_unit_of_measure || ""));
    // oferta solo digital: sale_type "Exclusivas" o imágenes OfertaDigital/ExclusivoDigital en alguna sucursal
    const online = (res.data?.sale_type || []).some((t) => /exclusiv/i.test(String(t))) || (res.data?.price || []).some((p) => /digital/i.test([p.saleImage1, p.saleImage2, p.saleImage3].join(" ")));
    const conPesable = (o) => conOnline(pesable ? { ...o, pesable: true } : o, online);
    const promo = promoCoto((res.data?.discounts || [])[0], precio);
    if (promo && !promo.txt) out.push(conPesable(conCat(conUrl({ nombre, precio: promo.precio, lista: precio }, url), cat))); // oferta directa: ES el precio
    else {
      out.push(conPesable(conCat(conUrl({ nombre, precio, lista: precio }, url), cat)));
      if (promo) out.push(conPesable(conCat(conUrl({ nombre: `${nombre} · ${promo.txt}`, precio: promo.precio, lista: precio }, url), cat))); // "llevando N": candidato aparte
    }
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
const notaPorKg = (c) => conOnline(conUrl({ p: Math.round(c.precio), n: `${limpiarCorte(c.nombre)} · ${pesos(c.precio)}/kg${c.online ? SOLO_ONLINE : ""}` }, c.url), c.online);
const soloOnline = (c) => (c.online ? " (solo online)" : "");

/* Compuestos (Combo, Asado): una página por corte → `urls: [{ n: etiqueta, url }]` */
const urlsDeCortes = (obj, cortes) => {
  const urls = cortes.filter((c) => c.url).map((c) => ({ n: c.et, url: c.url }));
  return urls.length ? { ...obj, urls } : obj;
};

/* Combo de temporada: misma regla que la app (abr–sep = frío) */
function comboCoto(porParte, invernal) {
  const [c1, c2] = invernal ? [porParte.falda, porParte.osobuco] : [porParte.marucha, porParte.aranita];
  if (!c1 || !c2) return null;
  const [et1, et2] = invernal ? ["falda", "osobuco"] : ["marucha", "arañita"];
  return conOnline(urlsDeCortes({
    p: Math.round(c1.precio + c2.precio),
    n: `${et1} ${pesos(c1.precio)}/kg${soloOnline(c1)} + ${et2} ${pesos(c2.precio)}/kg${soloOnline(c2)} · estimo 1 kg de c/u`,
  }, [{ et: et1, url: c1.url }, { et: et2, url: c2.url }]), c1.online || c2.online);
}

/* Asado: vacío o tapa de asado (el más barato) + tira de asado */
function asadoCoto(porParte) {
  const opciones = [porParte.tapa && { et: "tapa de asado", ...porParte.tapa }, porParte.vacio && { et: "vacío", ...porParte.vacio }].filter(Boolean);
  if (!opciones.length || !porParte.tira) return null;
  opciones.sort((a, b) => a.precio - b.precio);
  const base = opciones[0];
  const tira = porParte.tira;
  return conOnline(urlsDeCortes({
    p: Math.round(base.precio + tira.precio),
    n: `${base.et} ${pesos(base.precio)}/kg${soloOnline(base)} + tira ${pesos(tira.precio)}/kg${soloOnline(tira)} · estimo 1 kg de c/u`,
  }, [{ et: base.et, url: base.url }, { et: "tira", url: tira.url }]), base.online || tira.online);
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
  return precio > 0 ? [conUrl({ nombre: nombreFa(p.name), precio, lista: precio }, p.permalink)] : [];
}

/* Producto variable: junta el PESO (en el padre) con el precio (en la variación) */
function paresVariacionesFa(padre, variaciones) {
  const pesoPorId = new Map((padre.variations || []).map((v) => [v.id, (v.attributes || [])[0]?.value || ""]));
  const out = [];
  for (const v of variaciones) {
    const peso = pesoPorId.get(v.id);
    const precio = precioFa(v.prices);
    if (peso && precio > 0) out.push(conUrl({ nombre: `${nombreFa(padre.name)} ${normalizarPeso(peso)}`, precio, lista: precio }, v.permalink || padre.permalink));
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
    const url = it.url_key ? `https://newgarden.com.ar/${it.url_key}${it.url_suffix || ".html"}` : "";
    if (nombre && precio > 0) out.push(conUrl({ nombre, precio, lista }, url));
  }
  return out;
}

async function buscarNewGarden(query) {
  const gq = `{ products(search: ${JSON.stringify(query)}, pageSize: 20) { items { name stock_status url_key url_suffix price_range { minimum_price { final_price { value } regular_price { value } } } } } }`;
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

/* ---------- FARMACITY (farmacity.com, VTEX como DIA) ----------
   Criterio "mejor precio" con normalización por ítem (`comparaPor`): máquinas y
   preservativos por unidad, enjuague por litro, hilo por metro, pasta por kg.
   Pedidos del usuario (09/08/2026): desodorante = Old Spice EN BARRA solamente ·
   máquinas de afeitar = 3 filos · preservativos = Prime Mega (en Farmacity el
   producto se llama "Preservativo de Látex Mega"). ---------- */
const FARMACITY = "https://www.farmacity.com";

const ITEMS_FARMACITY = [
  // Higiene
  // 96° confirmado (09/08/2026): el usuario tiene alcohol en gel para manos; el líquido es para limpieza
  { name: "Alcohol", q: "alcohol etilico", unit: "l", qty: 0.5, must: [/alcohol/i, /96/], reject: [/gel|spray|gatillo|clorhexidina|iodo|isoprop/i] },
  { name: "Alcohol en gel", q: "alcohol en gel", unit: "un", qty: 1, comparaPor: "l", must: [/alcohol/i, /gel/i], reject: [/kids|sand[íi]a|chicle/i] },
  { name: "Algodón", q: "algodon", unit: "kg", qty: 0.1, must: [/algod[óo]n/i], reject: [/discos|zig/i] },
  // Farmacity llama "Cepillo Dental" a su marca propia (la más barata por unidad; pedido 08/09/2026): las dos búsquedas y los dos nombres valen
  { name: "Cepillo de dientes", q: ["cepillo de dientes", "cepillo dental"], unit: "un", qty: 1, comparaPor: "un", must: [/cepillo (de dientes|dental)/i], reject: [/porta|dispensador|el[ée]ctrico|repuesto|ni[ñn][oa]|kids|infantil|baby|beb[eé]|interdental|port[aá]til|ortodon|orthod|\bkit\b|vaso|dedo|smiles|minions|paw patrol|trolls|princess|\bcars\b/i] },
  { name: "Curitas", q: "curitas", unit: "un", qty: 1, comparaPor: "un", must: [/curitas|ap[óo]sito/i], reject: [/kids|ni[ñn][oa]|marvel|frozen|xl|aqua ?protect/i] },
  { name: "Desodorante", q: "desodorante old spice", unit: "un", qty: 1, must: [/old spice/i, /desodorante|antitranspirante/i], reject: [/aerosol|spray|shampoo|gel|jab[óo]n|ml\b/i] }, // solo EN BARRA
  { name: "Enjuague bucal", q: "enjuague bucal", unit: "un", qty: 1, comparaPor: "l", must: [/enjuague/i], reject: [/ni[ñn][oa]|kids|infantil/i] },
  { name: "Hilo dental", q: "hilo dental", unit: "un", qty: 1, comparaPor: "m", must: [/hilo dental/i], reject: [/mango|ortodoncia/i] },
  { name: "Máquina de afeitar", q: "maquina de afeitar 3 filos", unit: "un", qty: 1, comparaPor: "un", must: [/m[áa]quina de afeitar/i, /3 filos|prestobarba ?3/i], reject: [/venus|[íi]ntima|recambio|repuesto/i] },
  { name: "Pasta dental", q: "pasta dental", unit: "un", qty: 1, comparaPor: "kg", must: [/pasta dental|dent[íi]frico/i], reject: [/dispensador|porta|ni[ñn][oa]|kids|viaje/i] },
  { name: "Preservativos", q: "preservativos mega", unit: "un", qty: 1, comparaPor: "un", must: [/preservativo/i, /mega/i], reject: [/skyn|kit/i] }, // Prime Mega
  { name: "Repelente", q: "repelente", unit: "un", qty: 1, must: [/repelente/i], reject: [/ni[ñn][oa]|kids|beb[ée]|crema|pulsera|ambiente|hidratante|natural/i] },
  // Belleza
  { name: "Crema humectante", q: "crema humectante", unit: "un", qty: 1, must: [/crema/i, /humectante|hidratante/i], reject: [/manos|pies|alcohol|limpieza|corporal|beb[ée]|ni[ñn]/i] },
  // Facial (supuesto documentado). Con la paginación aparecieron limpiadores del hogar ("Limpiador Inodoro Gel Pato"): afuera
  { name: "Gel de limpieza", q: "gel de limpieza facial", unit: "un", qty: 1, must: [/gel/i, /limpieza|limpiador/i], reject: [/ni[ñn][oa]|beb[ée]|inodoro|sarro|ba[ñn]o|\bpato\b|cocina|piso|hogar|ropa|desinfect|multiuso|vidrio|horno|antigrasa|\bcif\b|lysoform|ayud[ií]n/i] },
  // Corporal: UN envase, el más barato POR LITRO (09/09/2026: por precio suelto ganaba un tubo de 50 ml, tamaño de cara); sin líneas infantiles
  { name: "Protector solar corporal", q: "protector solar corporal", unit: "un", qty: 1, comparaPor: "l", must: [/protector solar/i, /fps/i], reject: [/facial|rostro|combo|kit|infantil|ni[ñn][oa]|beb[ée]|kids|pediatric|baby|after ?sun|autobronce|capilar|labial/i] },
  { name: "Protector solar facial", q: "protector solar facial", unit: "un", qty: 1, must: [/protector solar/i, /facial/i], reject: [/combo|kit|infantil|ni[ñn][oa]|beb[ée]|after ?sun|autobronce/i] },
];

const NOMBRES_FARMACITY = ITEMS_FARMACITY.map((i) => i.name);

async function preciosFarmacity() {
  const out = [];
  for (const item of ITEMS_FARMACITY) {
    let el = null;
    try {
      const cand = [];
      for (const q of [].concat(item.q)) cand.push(...await buscarVtex(FARMACITY, q)); // q puede ser una búsqueda o varias
      el = elegir(item, cand);
    } catch (e) { /* sin red: queda el precio anterior */ }
    out.push([item.name, el]);
    await dormir(ESPERA_MS);
  }
  return out;
}

/* ---------- OTROS LUGARES (páginas puntuales que indicó el usuario, 09/08/2026) ----------
   Carmín (carmin.com.ar, TiendaNube): búsqueda server-rendered con JSON-LD.
   BonVino y Tienda Nova: página de producto fija; el precio del producto principal
   sale del bloque de analytics ("item_name":"...","price":N), común a ambas. */
const CAB_HTML = { headers: { "user-agent": "Mozilla/5.0 (compatible; ElChanguito/1.0)", accept: "text/html" } };

const ITEMS_OTROS = [
  // "Hongos para cocinar" (ex Champiñones congelados): el mix de hongos suele ser lo más conveniente
  { name: "Hongos para cocinar", base: "https://www.carmin.com.ar", qs: ["hongos", "champignon"], unit: "kg", qty: 0.5, must: [/hongo|champi[gñ]n[oó]n/i], reject: [/medall[óo]n|quinoa|chop suey|salsa|empanad|tarta|rebozad/i] },
  { name: "Aceto balsámico Millán", url: "https://www.bonvino.com.ar/productos/252002/", must: [/aceto/i] },
  { name: "Salsa de soja Lee Kum Kee premium", url: "https://www.tiendanova.com/productos/lee-kum-kee-salsa-de-soja-premium-500ml/", must: [/lee kum kee/i] },
];

const NOMBRES_OTROS = ITEMS_OTROS.map((i) => i.name);

/* Listados de TiendaNube (búsquedas/categorías): productos de los JSON-LD */
function paresDesdeTiendaNube(html, incluirAgotados = false) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let d;
    try { d = JSON.parse(m[1].trim()); } catch (e) { continue; }
    const objs = Array.isArray(d) ? [...d] : [d];
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      if (!o || typeof o !== "object") continue;
      if (o["@type"] === "ItemList") objs.push(...(o.itemListElement || []).map((e) => e.item || e));
      if (o["@type"] === "Product") {
        let of = o.offers || {};
        if (Array.isArray(of)) of = of[0] || {};
        const precio = Number(of.price ?? of.lowPrice);
        const nombre = String(o.name || "").replace(/\s+/g, " ").trim();
        const agotado = /outofstock/i.test(String(of.availability || ""));
        if (nombre && precio > 0 && (incluirAgotados || !agotado)) out.push(conUrl({ nombre, precio, lista: precio }, o.url || of.url));
      }
    }
  }
  return out;
}

/* Página de producto fija: el producto principal desde el bloque de analytics */
function productoDePagina(html) {
  const m = html.match(/"item_name":"([^"]+)","price":(\d+(?:\.\d+)?)/);
  if (m) {
    try { return { nombre: JSON.parse('"' + m[1] + '"').replace(/\s+/g, " ").trim(), precio: Number(m[2]), lista: Number(m[2]) }; } catch (e) { /* seguimos */ }
  }
  return paresDesdeTiendaNube(html)[0] || null;
}

async function preciosOtros() {
  const out = [];
  for (const item of ITEMS_OTROS) {
    let el = null;
    try {
      if (item.url) {
        const p = productoDePagina(await (await fetch(item.url, CAB_HTML)).text());
        if (p && item.must.every((re) => re.test(p.nombre))) el = { p: Math.round(p.precio), n: p.nombre, url: item.url };
      } else {
        const cand = [];
        for (const q of item.qs) {
          try { cand.push(...paresDesdeTiendaNube(await (await fetch(`${item.base}/search/?q=${encodeURIComponent(q)}`, CAB_HTML)).text())); } catch (e) { /* seguimos */ }
          await dormir(300);
        }
        el = elegir(item, cand);
      }
    } catch (e) { /* sin red: queda el precio anterior */ }
    out.push([item.name, el]);
    await dormir(300);
  }
  return out;
}

/* ---------- FRIGORÍFICO PESCE (tiendapesce.com.ar, TiendaNube) ----------
   Búsqueda server-rendered con JSON-LD, como Carmín; lo agotado se filtra
   por availability (los congelados rotan stock seguido). Todo se vende por
   kilo ("x kilo" = 1 kg); compra asumida ~1 kg por producto. ---------- */
const PESCE = "https://www.tiendapesce.com.ar";

// Criterio confirmado (19/08/2026): el más barato POR KILO sin importar el tamaño
// del paquete (si conviene la caja de 4 kg, se compra de a 4 kg) · Mejillones SOLO
// pelados (mejor relación cáscara/mejillón, aunque el entero esté más barato).
const ITEMS_PESCE = [
  { name: "Salmón", q: "salmon", unit: "un", qty: 1, comparaPor: "kg", must: [/salm[óo]n/i], reject: [/pasta|ahumado|blanco|rebanado|at[uú]n|kani|abadejo|cornalito|mejill[óo]n|berberecho|callo/i] },
  { name: "Langostinos", q: "langostinos", unit: "un", qty: 1, comparaPor: "kg", must: [/langostino/i], reject: [/empanad|rebozad|wok|raba|camar[óo]n|sepia|combo/i] },
  { name: "Mejillones", q: "mejillones", unit: "un", qty: 1, comparaPor: "kg", must: [/mejill[óo]n/i, /pelado/i], reject: [] },
];

const NOMBRES_PESCE = ITEMS_PESCE.map((i) => i.name);

async function preciosPesce() {
  const out = [];
  for (const item of ITEMS_PESCE) {
    let el = null;
    try {
      const html = await (await fetch(`${PESCE}/search/?q=${encodeURIComponent(item.q)}`, CAB_HTML)).text();
      el = elegir(item, paresDesdeTiendaNube(html));
      if (!el) {
        // Todo agotado: dejamos la referencia igual, avisando que hoy no hay
        const ref = elegir(item, paresDesdeTiendaNube(html, true));
        if (ref) el = { ...ref, n: ref.n + " · SIN STOCK hoy" };
      }
    } catch (e) { /* sin red: queda el precio anterior */ }
    out.push([item.name, el]);
    await dormir(400);
  }
  return out;
}

/* ---------- VERDULERÍA: referencia DIA vs COTO ----------
   El usuario compra en la verdulería de barrio (sin página); la referencia es el
   más barato entre DIA y COTO para cada verdura/fruta, POR KILO cuando se vende
   por kilo (si en ningún lado hay por kilo, por unidad). Cada precio recuerda su
   comercio (`s`) para que la app le aplique los descuentos por día de ESE
   comercio. Los picks (Fruta, Estructurales…) publican el precio de cada opción. */
const VERDU_SIMPLES = ["Ajo", "Cebolla", "Cúrcuma", "Jengibre", "Limón", "Morrón", "Papa", "Palta", "Tomate", "Zanahoria"];
const VERDU_PICKS = {
  "Fruta": ["Ananá", "Arándanos", "Banana", "Caqui", "Cereza", "Ciruela", "Durazno", "Frambuesa", "Frutilla", "Granada", "Higo", "Kiwi", "Mandarina", "Mango", "Manzana", "Maracuya (fruta de la pasión)", "Melón", "Membrillo", "Mora", "Naranja", "Papaya", "Pera", "Pitahaya (fruta del dragón)", "Pomelo", "Sandía", "Uva"],
  "Solo ensalada": ["Apio", "Berro", "Lechuga", "Rabanitos", "Radicheta", "Rúcula"],
  "Estructurales": ["Alcaucil", "Berenjena", "Brócoli", "Espárragos", "Hakusay", "Hinojo", "Repollo", "Zapallito", "Zucchini"],
  "Apoyo": ["Acelga", "Chaucha", "Espinaca", "Kale"],
  "Contundentes": ["Batata", "Calabaza", "Choclo", "Coliflor", "Mandioca", "Remolacha", "Zapallo anco"],
  "Hierbas de terminación": ["Albahaca", "Cilantro", "Perejil"],
  "Aromáticos de cocción": ["Puerro (frío)", "Verdeo (calor)"],
};
const NOMBRES_VERDU = [...VERDU_SIMPLES, ...Object.keys(VERDU_PICKS)];

/* Productos elaborados/no frescos que NO son la verdura (conservas, congelados, jugos, especias, limpieza…) */
const RECHAZO_VERDU = /\bmixto\b|papines|cocid[oa]s?\b|al vac[ií]o|almohadita|chis buby|nikitos|\bpaq\b|marquesa|vigente|hummus|cubetead|\balco\b|pelados?\b|jardinera|dicomere|\blat\b|\bgranos?\b|crem\b|crem\/|dueto|raviol|lucchetti|granja del sol|mccain|rallado|\bpan\b|aderezo|mayonesa|confitura|\bfid\b|fid\.|spaghetti|tallar[ií]n|hair|pouch|mascarilla|acondicionador|shock|ba[ñn]ad|\bgio\b|fra-nui|quillen|papilla|\bsabor\b|oblea|galleta|postre|gelatina|flan\b|\bleche\b|en cubos?|\bcubos?\b|en granos?|\bgranos\b|inalpa|nestl[eé]|marolio|arcor|knorr|maggi|congelad|\blatas?\b|conserva|jugo|mermelada|\bdulce\b|pur[eé]|deshidratad|\bsec[oa]s?\b|polvo|molid|pasta|snack|chips|frit[oa]s|yogur|helado|alm[ií]bar|salsa|triturad|extracto|f[eé]cula|almid[oó]n|harina|ravioles|tarta|empanada|barrita|galletita|semillas?\b|\bt[eé]\b|aceite|vinagre|jab[oó]n|shampoo|crema|esencia|aroma|detergente|limpia|lavandina|desodorante|caramelo|gomita|gaseosa|\bagua\b|cerveza|vino|licor|bebida|cereal|granola|\bmix\b|ensalada|sopa|caldo|condimento|\bespecias?\b|saborizad|pulpa|compota|pasas|pickles|encurtid|escabeche|al natural|relleno|pizza|milanesa|hamburguesa|medall[oó]n|nugget|torta|bud[ií]n|bizcocho|alfajor|chocolate|bomb[oó]n|pa[ñn]al|toallita|\bperro|\bgato|alimento|planta|maceta|vela|sahumerio|perfume|jarabe|c[aá]psula|comprimido|infusi[oó]n|saquito|hebras|\bmate\b|yerba|az[uú]car|edulcorante|licuado|smoothie|baby\b|premezcla|rebozad|nuggets|fideo|arroz|sal\b|cebollita|ajo en (aceite|polvo|escama|pasta|conserva)|en aceite/i;

/* Nombre de la app → regex tolerante a tildes/plurales, sobre la palabra base */
function regexVerdu(nombre) {
  // Calabaza: en el súper es "Zapallo x Kg" (el Mercado Central también la llama ZAPALLO); el anco es la otra opción
  const especiales = { "Calabaza": /calabaza|zapallo(?!\s*anco)(?![a-z])/i, "Zapallo anco": /zapallo\s*anco|\banco\b/i, "Hakusay": /hakusa[yi]/i, "Verdeo (calor)": /\bverdeo\b|cebolla de verdeo/i, "Puerro (frío)": /\bpuerro/i, "Maracuya (fruta de la pasión)": /maracuy[aá]/i, "Pitahaya (fruta del dragón)": /pitahaya|pitaya/i, "Zapallito": /zapallito/i, "Rabanitos": /rabanito/i, "Arándanos": /ar[aá]ndano/i, "Espárragos": /esp[aá]rrago/i, "Morrón": /(?:morr[oó]n(?:es)?|pim(?:ie|e)nt[oó]n?e?s?)\s+rojos?\b/i }; // Morrón: SOLO rojo (el usuario nunca compra verde, 08/09/2026)
  if (especiales[nombre]) return especiales[nombre];
  const base = nombre.replace(/\s*\(.*\)$/, "").toLowerCase();
  const pat = base.replace(/[aá]/g, "[aá]").replace(/[eé]/g, "[eé]").replace(/[ií]/g, "[ií]").replace(/[oó]/g, "[oó]").replace(/[uú]/g, "[uú]").replace(/[ñn]/g, "[ñn]");
  // Límites de palabra a mano: \b no funciona junto a tildes ("Ananá x Kg" no matcheaba con \b después de la á)
  return new RegExp("(?<![a-záéíóúñ])" + pat + "s?(?![a-záéíóúñ])", "i");
}

/* Solo lo que el súper vende en su sección de verdulería (DIA "/Frescos/Frutas y Verduras/…",
   COTO "Frescos / Frutas y Verduras / Hortalizas|Frutas"). Sin categoría, afuera: antes el
   nombre solo dejaba pasar "Fetuccini Morrón", "Papines con ajo", "Chupetín cereza"… */
const CAT_VERDU = /frutas y verduras/i;
const esDeVerduleria = (c) => CAT_VERDU.test(c.cat || "");
/* Lo que en el minorista se compra POR UNIDAD (cabeza), no por peso (pedido 08/09/2026: Ajo):
   solo cuentan los candidatos por unidad; la bandeja de dientes pelados "120 g" no es referencia. */
const VERDU_POR_UNIDAD = new Set(["Ajo"]);

/* Mejor referencia de UN comercio: $/kg si se vende por kg; si no, por unidad.
   Umbral de sanidad: en COTO hay listados con precios basura ($250-450 el kg). */
function elegirVerdura(nombre, candidatos) {
  const must = regexVerdu(nombre);
  const validos = (candidatos || []).filter((c) => c.precio >= 250 && esDeVerduleria(c) && must.test(c.nombre) && !RECHAZO_VERDU.test(c.nombre));
  let porKg = [];
  const porUn = [];
  const soloUnidad = VERDU_POR_UNIDAD.has(nombre);
  for (const c of validos) {
    const q = c.pesable ? { amount: 1, unit: "kg" } : parseQty(c.nombre); // pesable de COTO: el precio es por kilo, diga lo que diga el nombre
    // Fresco por kilo: paquetes de 80 g o más (menos = sobrecito de especia), entre $500 y $30.000 el kg
    if (q.unit === "kg" && q.amount >= 0.08 && !soloUnidad) { const v = c.precio / q.amount; if (v >= 500 && v <= 30000) porKg.push({ c, v }); }
    else if (q.unit === "un") porUn.push({ c, v: c.precio / (q.amount || 1) });
  }
  const limpio = (n) => n.replace(/\s+/g, " ").replace(/\s+x\s*kg\.?$/i, "").trim().slice(0, 60);
  // `v` = valor comparable ($/kg o $/unidad), para elegir entre comercios. `p` = lo que se paga:
  // por kilo, el $/kg (se compra al peso); por unidad, el PRODUCTO entero (la malla de 3 ajos
  // vale la malla, no un ajo; pedido 08/09/2026) y la nota muestra el $/unidad.
  if (porKg.length) {
    porKg.sort((a, b) => a.v - b.v);
    return conOnline(conUrl({ p: Math.round(porKg[0].v), n: `${limpio(porKg[0].c.nombre)} · $${Math.round(porKg[0].v).toLocaleString("es-AR")}/kg${porKg[0].c.online ? SOLO_ONLINE : ""}`, u: "kg", v: porKg[0].v }, porKg[0].c.url), porKg[0].c.online);
  }
  if (porUn.length) {
    porUn.sort((a, b) => a.v - b.v);
    return conOnline(conUrl({ p: Math.round(porUn[0].c.precio), n: `${limpio(porUn[0].c.nombre)} · $${Math.round(porUn[0].v).toLocaleString("es-AR")}/un${porUn[0].c.online ? SOLO_ONLINE : ""}`, u: "un", v: porUn[0].v }, porUn[0].c.url), porUn[0].c.online);
  }
  return null;
}

/* DIA vs COTO: gana el más barato; una referencia por kg le gana a una por unidad (no son comparables) */
function mejorVerdura(nombre, candDia, candCoto) {
  const opciones = [];
  const d = elegirVerdura(nombre, candDia); if (d) opciones.push({ ...d, s: "dia", etiqueta: "DIA" });
  const c = elegirVerdura(nombre, candCoto);
  // COTO trae SKUs con precio placeholder ($299 la bolsa de cebolla): si está por debajo del
  // 40 % de lo que cobra DIA por lo mismo, no es un precio real
  const cotoBasura = c && d && c.u === "kg" && d.u === "kg" && c.v < d.v * 0.4;
  if (c && !cotoBasura) opciones.push({ ...c, s: "coto", etiqueta: "COTO" });
  if (!opciones.length) return null;
  opciones.sort((a, b) => ((b.u === "kg") - (a.u === "kg")) || (a.v - b.v)); // entre comercios compara el $/kg o $/unidad, no el paquete
  const g = opciones[0];
  return conOnline(conUrl({ p: g.p, n: `${g.n} · ${g.etiqueta}`, s: g.s, u: g.u }, g.url), g.online);
}

/* Verdulería sin referencia REAL: si DIA y COTO respondieron (listas, no null) y ninguno la
   vende fresca, se publica `p: 0` para que la app BORRE el precio que tuviera (p. ej. un SKU
   fantasma de COTO que ya no pasa el filtro, como "Cúrcuma X Kg" a $1.799). Si alguna
   búsqueda falló (null), null: queda el precio anterior como siempre. */
const SIN_REFERENCIA = { p: 0, n: "hoy ni DIA ni COTO la venden fresca" };
function referenciaVerdu(nombre, candDia, candCoto) {
  return mejorVerdura(nombre, candDia, candCoto) || (Array.isArray(candDia) && Array.isArray(candCoto) ? { ...SIN_REFERENCIA } : null);
}

async function preciosVerdu() {
  const cacheDia = new Map(), cacheCoto = new Map();
  const buscarAmbos = async (nombre) => {
    const q = nombre.replace(/\s*\(.*\)$/, "");
    if (!cacheDia.has(q)) { try { cacheDia.set(q, await buscarVtex(DIA, q)); } catch (e) { cacheDia.set(q, null); } await dormir(500); }
    if (!cacheCoto.has(q)) { try { cacheCoto.set(q, await buscarCoto(q)); } catch (e) { cacheCoto.set(q, null); } await dormir(300); }
    return [cacheDia.get(q), cacheCoto.get(q)];
  };
  const out = [];
  for (const nombre of VERDU_SIMPLES) {
    const [cd, cc] = await buscarAmbos(nombre);
    out.push([nombre, referenciaVerdu(nombre, cd, cc)]);
  }
  for (const [pick, opciones] of Object.entries(VERDU_PICKS)) {
    const op = {};
    for (const o of opciones) {
      const [cd, cc] = await buscarAmbos(o);
      const m = mejorVerdura(o, cd, cc);
      if (m) op[o] = conOnline(conUrl({ p: m.p, s: m.s, u: m.u }, m.url), m.online);
    }
    const nombres = Object.keys(op);
    if (!nombres.length) { out.push([pick, null]); continue; }
    const porKilo = nombres.filter((n) => op[n].u === "kg");
    const masBarata = (porKilo.length ? porKilo : nombres).sort((a, b) => op[a].p - op[b].p)[0];
    out.push([pick, conOnline(conUrl({ p: op[masBarata].p, n: `la más barata hoy: ${masBarata} ($${op[masBarata].p.toLocaleString("es-AR")}/${op[masBarata].u}, ${op[masBarata].s === "dia" ? "DIA" : "COTO"}${op[masBarata].online ? ", solo online" : ""}) · ${nombres.length}/${opciones.length} con precio`, s: op[masBarata].s, u: op[masBarata].u, op }, op[masBarata].url), op[masBarata].online)]);
  }
  return out;
}

/* ---------- MERCADO CENTRAL: referencia MAYORISTA para Verdulería ----------
   Además del más barato entre DIA y COTO (minorista: donde el usuario puede ir a
   comprar), cada verdura/fruta lleva en `mc` el $/kg del ÚLTIMO día publicado por
   el Mercado Central de Buenos Aires (mayorista, solo para tener de referencia).
   Mapeo nombre de la app → especie del Mercado (mayúsculas sin tilde, truncadas a
   10 letras; se aceptan varias grafías). Con `var`, promedio de las líneas de esa
   variedad (Tomate = REDONDO, no cherry; Morrón = PIMIENTO MORRON; Zapallito =
   REDONDO y Zucchini = LARGO; Zapallo anco = ZAPALLO ANC…); sin `var`, el
   promedio de la especie (fila Prom.Esp.). Lo que no cotiza ese día queda sin
   referencia (fuera de temporada en el mayorista). */
const MC_VERDU = {
  "Ajo": "AJO", "Cebolla": "CEBOLLA", "Cúrcuma": "CURCUMA", "Jengibre": "JENGIBRE", "Limón": "LIMON",
  "Morrón": { esp: "PIMIENTO", var: /MORRON/, grado: /^R/, n: "Pimiento morron rojo" }, "Papa": "PAPA", "Palta": "PALTA", "Tomate": { esp: "TOMATE", var: /REDONDO/ }, "Zanahoria": "ZANAHORIA",
  // Fruta
  "Ananá": "ANANA", "Arándanos": "ARANDANO", "Banana": "BANANA", "Caqui": "CAQUI", "Cereza": "CEREZA", "Ciruela": "CIRUELA",
  "Durazno": "DURAZNO", "Frambuesa": "FRAMBUESA", "Frutilla": "FRUTILLA", "Granada": "GRANADA", "Higo": "HIGO", "Kiwi": "KIWI",
  "Mandarina": "MANDARINA", "Mango": "MANGO", "Manzana": "MANZANA", "Maracuya (fruta de la pasión)": "MARACUYA", "Melón": "MELON",
  "Membrillo": "MEMBRILLO", "Mora": "MORA", "Naranja": "NARANJA", "Papaya": ["MAMON", "PAPAYA"], "Pera": "PERA",
  "Pitahaya (fruta del dragón)": "PITAHAYA", "Pomelo": "POMELO", "Sandía": "SANDIA", "Uva": "UVA",
  // Solo ensalada
  "Apio": "APIO", "Berro": "BERRO", "Lechuga": "LECHUGA", "Rabanitos": "RABANITO", "Radicheta": "RADICHETA", "Rúcula": "RUCULA",
  // Estructurales
  "Alcaucil": "ALCAUCIL", "Berenjena": "BERENJENA", "Brócoli": "BROCOLI", "Espárragos": "ESPARRAGO", "Hakusay": ["ACUSAY", "HAKUSAY"],
  "Hinojo": "HINOJO", "Repollo": "REPOLLO", "Zapallito": { esp: "ZAPALLITO", var: /REDONDO/ }, "Zucchini": { esp: "ZAPALLITO", var: /LARGO/ },
  // Apoyo
  "Acelga": "ACELGA", "Chaucha": "CHAUCHA", "Espinaca": "ESPINACA", "Kale": "KALE",
  // Contundentes
  "Batata": "BATATA", "Calabaza": "ZAPALLO", "Choclo": "CHOCLO", "Coliflor": "COLIFLOR", "Mandioca": "MANDIOCA", "Remolacha": "REMOLACHA",
  "Zapallo anco": { esp: "ZAPALLO", var: /ANC/ },
  // Hierbas y aromáticos
  "Albahaca": "ALBAHACA", "Cilantro": ["CILANTRO", "CILANDRO"], "Perejil": "PEREJIL", "Puerro (frío)": "PUERRO", "Verdeo (calor)": ["CEB.VERDEO", "VERDEO"],
};

const sinTilde = (t) => String(t).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const fechaDdMmAaaa = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso || "");

/* Salida de ultimoDiaMercadoCentral() → { nombreApp: { p: $/kg, f: "dd/mm/aaaa", n?: etiqueta del Mercado } }.
   `n` solo cuando la especie del Mercado no se llama como el ítem (Mamon, Pimiento morron…). */
function mcParaVerdu(ultimo) {
  const out = {};
  const rubros = ["frutas", "hortalizas"].filter((r) => ultimo && ultimo[r] && ultimo[r].especies);
  const raiz = (t) => sinTilde(t).replace(/\s*\(.*\)$/, "").replace(/[^A-ZÑ]/g, "").replace(/S$/, "");
  for (const [nombre, cfg] of Object.entries(MC_VERDU)) {
    const esps = [].concat(cfg && cfg.esp ? cfg.esp : cfg).map((e) => sinTilde(e).slice(0, 10));
    const re = cfg && cfg.var;
    const grado = cfg && cfg.grado; // el color viaja en el grado ("R/I" rojo, "V/I" verde): Morrón = solo rojo
    for (const r of rubros) {
      const { fecha, especies } = ultimo[r];
      const clave = Object.keys(especies).find((k) => esps.includes(sinTilde(k)));
      if (!clave) continue;
      const e = especies[clave];
      let p = e.kilo, etiqueta = clave;
      if (re) {
        const lineas = (e.lineas || []).filter((l) => re.test(sinTilde(l.variedad)) && (!grado || grado.test(String(l.grado || ""))) && l.kilo && l.kilo.moda > 0);
        if (!lineas.length) continue;
        p = lineas.reduce((a, l) => a + l.kilo.moda, 0) / lineas.length;
        etiqueta = cfg.n || `${clave} ${lineas[0].variedad}`;
      }
      if (!(p > 0)) continue;
      const mc = { p: Math.round(p), f: fechaDdMmAaaa(fecha) };
      if (raiz(etiqueta) !== raiz(nombre)) mc.n = etiqueta.charAt(0) + etiqueta.slice(1).toLowerCase();
      out[nombre] = mc;
      break;
    }
  }
  return out;
}

/* Pone `mc` en cada ítem simple de Verdulería y en cada opción de los picks
   (aunque la opción no tenga precio minorista). Si el Mercado se leyó, manda lo
   de HOY: lo que no cotizó queda sin `mc`. Si falló la lectura (mapa null), se
   conservan los `mc` previos. Devuelve cuántas referencias quedaron. */
function aplicarMC(precios, mapa, previo = {}) {
  let n = 0;
  const mcDe = (nombre, prevMc) => (mapa ? mapa[nombre] || null : prevMc || null);
  const sinMc = (o) => { const { mc, ...resto } = o; return resto; };
  for (const nombre of VERDU_SIMPLES) {
    if (!precios[nombre]) continue;
    const mc = mcDe(nombre, (previo[nombre] || {}).mc);
    precios[nombre] = mc ? { ...precios[nombre], mc } : sinMc(precios[nombre]);
    if (mc) n++;
  }
  for (const [pick, opciones] of Object.entries(VERDU_PICKS)) {
    if (!precios[pick]) continue;
    const op = { ...(precios[pick].op || {}) };
    const prevOp = (previo[pick] || {}).op || {};
    for (const o of opciones) {
      const mc = mcDe(o, (prevOp[o] || {}).mc);
      if (mc) { op[o] = { ...(op[o] || {}), mc }; n++; }
      else if (op[o]) { const resto = sinMc(op[o]); if (Object.keys(resto).length) op[o] = resto; else delete op[o]; }
    }
    precios[pick] = { ...precios[pick], op };
  }
  return n;
}

/* ---------- Selección según el criterio ---------- */
function elegir(item, candidatos) {
  const validos = [];
  for (const c of candidatos) {
    if (!item.must.every((re) => re.test(c.nombre))) continue;
    if (item.reject.some((re) => re.test(c.nombre))) continue;
    let q = c.pesable ? { amount: 1, unit: "kg" } : parseQty(c.nombre); // pesable de COTO: precio por kilo
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
  const limpio = g.nombre.replace(/\s+/g, " ").replace(/\s+x\s*kg\.?$/i, "").trim().slice(0, 70);
  let nota;
  if (g.paquetes === 0) {
    const cant = g.gramos >= 1 ? (Math.round(g.gramos * 100) / 100).toLocaleString("es-AR") + " kg" : Math.round(g.gramos * 1000) + " g";
    nota = cant + " de " + limpio + " · $" + Math.round(g.porUnidad).toLocaleString("es-AR") + "/kg";
  } else {
    nota = (g.paquetes > 1 ? g.paquetes + "× " : "") + limpio + (desc >= 5 ? ` · oferta -${desc}%` : "");
    if (item.comparaPor) nota += " · $" + Math.round(g.porUnidad).toLocaleString("es-AR") + "/" + (item.comparaPor === "l" ? "L" : item.comparaPor);
  }
  // Marca preferida del usuario: si no ganó por precio, la nota muestra su diferencia para decidir
  if (item.marca && !item.marca.re.test(g.nombre)) {
    const m = validos.filter((v) => item.marca.re.test(v.nombre)).sort((a, b) => a.estimado - b.estimado)[0];
    if (m) {
      const dif = Math.round((m.estimado / g.estimado - 1) * 100);
      nota += ` · ${item.marca.nombre} $${Math.round(m.estimado).toLocaleString("es-AR")}${dif !== 0 ? ` (${dif > 0 ? "+" : ""}${dif}%)` : ""}`;
    }
  }
  if (g.online) nota += SOLO_ONLINE;
  return conOnline(conUrl({ p: Math.round(g.estimado), n: nota }, g.url), g.online);
}

/* Variación de precio: d = diferencia en $ y dv = fecha en que cambió. Si el precio
   no cambió hoy, se CONSERVA la última variación (la app decide cuánto tiempo
   mostrarla — hoy 4 días). Correr el robot dos veces el mismo día ya no las pisa. */
function conDelta(el, prev, hoy) {
  if (!el) return el;
  const { d, dv, ...limpio } = el;
  if (prev && prev.p > 0 && prev.p !== limpio.p) return { ...limpio, d: limpio.p - prev.p, dv: hoy };
  if (prev && prev.p === limpio.p && prev.d) return { ...limpio, d: prev.d, dv: prev.dv || hoy };
  return limpio;
}

/* En el log, la flecha solo para lo que cambió HOY (lo conservado no es novedad) */
const flecha = (el, hoy) => (!el || !el.d || el.dv !== hoy ? "" : el.d > 0 ? `  ▲ +$${Math.round(el.d).toLocaleString("es-AR")}` : `  ▼ -$${Math.round(-el.d).toLocaleString("es-AR")}`);

/* ---------- Principal ---------- */
async function main() {
  const archivo = "precios.json";
  const previo = fs.existsSync(archivo) ? JSON.parse(fs.readFileSync(archivo, "utf8")) : { prices: {} };
  const previoPrices = previo.prices || {};
  const precios = { ...previoPrices };
  const hoy = fechaHoyAR();
  let ok = 0, fallos = [];

  for (const item of ITEMS) {
    let elegido = null;
    try {
      // q puede ser una búsqueda o varias (ej. agua: mineral + bidón + glaciar)
      const candidatos = [];
      for (const q of [].concat(item.q)) candidatos.push(...await buscarVtex(DIA, q));
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
      const elD = conDelta(elegido, previoPrices[item.name], hoy);
      precios[item.name] = elD;
      ok++;
      console.log(`✔ ${item.name} → $${elD.p}  (${elD.n})${flecha(elD, hoy)}`);
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
        const elD = conDelta(el, previoPrices[item.name], hoy);
        const ops = opcionesElPuente(item, candEP);
        if (ops) elD.op = ops;
        precios[item.name] = elD;
        ok++;
        console.log(`✔ ${item.name} → $${elD.p}  (${elD.n})${flecha(elD, hoy)}`);
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
      const elD = conDelta(el, previoPrices[name], hoy);
      precios[name] = elD;
      ok++;
      console.log(`✔ ${name} → $${elD.p}  (${elD.n})${flecha(elD, hoy)}`);
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
      const elD = conDelta(el, previoPrices[name], hoy);
      precios[name] = elD;
      ok++;
      console.log(`✔ ${name} → $${elD.p}  (${elD.n})${flecha(elD, hoy)}`);
    } else {
      fallos.push(name);
      console.log(`✘ ${name} → sin match (queda el precio anterior si había)`);
    }
  }

  // --- Farmacity ---
  console.log("\n— Farmacity —");
  let resFarma = [];
  try { resFarma = await preciosFarmacity(); } catch (e) { console.log("FARMACITY: error → " + e.message); }
  if (resFarma.length === 0) resFarma = NOMBRES_FARMACITY.map((n) => [n, null]);
  for (const [name, el] of resFarma) {
    if (el) {
      const elD = conDelta(el, previoPrices[name], hoy);
      precios[name] = elD;
      ok++;
      console.log(`✔ ${name} → $${elD.p}  (${elD.n})${flecha(elD, hoy)}`);
    } else {
      fallos.push(name);
      console.log(`✘ ${name} → sin match (queda el precio anterior si había)`);
    }
  }

  // --- Otros lugares (Carmín, BonVino, Tienda Nova) ---
  console.log("\n— Otros lugares —");
  let resOtros = [];
  try { resOtros = await preciosOtros(); } catch (e) { console.log("OTROS: error → " + e.message); }
  if (resOtros.length === 0) resOtros = NOMBRES_OTROS.map((n) => [n, null]);
  for (const [name, el] of resOtros) {
    if (el) {
      const elD = conDelta(el, previoPrices[name], hoy);
      precios[name] = elD;
      ok++;
      console.log(`✔ ${name} → $${elD.p}  (${elD.n})${flecha(elD, hoy)}`);
    } else {
      fallos.push(name);
      console.log(`✘ ${name} → sin match (queda el precio anterior si había)`);
    }
  }

  // --- Frigorífico Pesce ---
  console.log("\n— Frigorífico Pesce —");
  let resPesce = [];
  try { resPesce = await preciosPesce(); } catch (e) { console.log("PESCE: error → " + e.message); }
  if (resPesce.length === 0) resPesce = NOMBRES_PESCE.map((n) => [n, null]);
  for (const [name, el] of resPesce) {
    if (el) {
      const elD = conDelta(el, previoPrices[name], hoy);
      precios[name] = elD;
      ok++;
      console.log(`✔ ${name} → $${elD.p}  (${elD.n})${flecha(elD, hoy)}`);
    } else {
      fallos.push(name);
      console.log(`✘ ${name} → sin match o sin stock (queda el precio anterior si había)`);
    }
  }

  // --- Verdulería (referencia DIA vs COTO) ---
  console.log("\n— Verdulería (referencia DIA/COTO) —");
  let resVerdu = [];
  try { resVerdu = await preciosVerdu(); } catch (e) { console.log("VERDU: error → " + e.message); }
  if (resVerdu.length === 0) resVerdu = NOMBRES_VERDU.map((n) => [n, null]);
  for (const [name, el] of resVerdu) {
    if (el && el.p === 0) {
      precios[name] = { ...el }; // sin referencia real: la app borra el precio viejo (sin flecha: no es un movimiento)
      ok++;
      console.log(`· ${name} → ${el.n} (se borra el precio anterior${previoPrices[name] && previoPrices[name].p > 0 ? ` $${previoPrices[name].p}` : ""})`);
    } else if (el) {
      const elD = conDelta(el, previoPrices[name], hoy);
      precios[name] = elD;
      ok++;
      console.log(`✔ ${name} → $${elD.p}  (${elD.n})${flecha(elD, hoy)}`);
    } else {
      fallos.push(name);
      console.log(`✘ ${name} → sin match en DIA ni COTO (queda el precio anterior si había)`);
    }
  }

  // --- Mercado Central (referencia mayorista para Verdulería) ---
  console.log("\n— Mercado Central (mayorista, último día publicado) —");
  let mapaMC = null;
  try {
    const ultimo = await ultimoDiaMercadoCentral({ log: () => {} });
    mapaMC = mcParaVerdu(ultimo);
    console.log("(" + ["frutas", "hortalizas"].map((r) => (ultimo[r] ? `${r}: ${fechaDdMmAaaa(ultimo[r].fecha)}` : `${r}: sin datos`)).join(" · ") + ")");
    for (const nombre of [...VERDU_SIMPLES, ...Object.values(VERDU_PICKS).flat()]) {
      const mc = mapaMC[nombre];
      console.log(mc ? `✔ ${nombre} → $${mc.p}/kg${mc.n ? ` (${mc.n})` : ""} · ${mc.f}` : `· ${nombre} → sin cotización ese día en el Central`);
    }
  } catch (e) { console.log("MERCADO CENTRAL: error → " + e.message + " (quedan las referencias anteriores)"); }
  console.log(`(${aplicarMC(precios, mapaMC, previoPrices)} referencias mayoristas en precios.json)`);

  if (ok === 0) {
    console.error("\nNingún ítem se pudo actualizar: no escribo el archivo para no romper nada.");
    process.exit(1);
  }

  fs.writeFileSync(archivo, JSON.stringify({ version: fechaHoyAR(), descuentos: DESCUENTOS, prices: precios }, null, 2) + "\n");
  console.log(`\nListo: ${ok}/${ITEMS.length + ITEMS_ELPUENTE.length + NOMBRES_COTO.length + NOMBRES_DIETETICA.length + NOMBRES_FARMACITY.length + NOMBRES_OTROS.length + NOMBRES_PESCE.length + NOMBRES_VERDU.length} ítems actualizados en ${archivo} (versión ${fechaHoyAR()}).`);
  if (fallos.length) console.log("Sin match (revisar consultas): " + fallos.join(", "));
}

export {
  parseQty, elegir, buscarVtex, paresDesdeVtex, promoVtex, conDelta, DESCUENTOS, opcionesElPuente,
  ITEMS, ITEMS_ELPUENTE, parsearListadoElPuente, candidatosElPuente,
  ITEMS_COTO, PARTES_CARNE, NOMBRES_COTO, modaPrecios, promoCoto, paresDesdeCoto, porKgCoto, notaPorKg, comboCoto, asadoCoto, buscarCoto, preciosCoto,
  ITEMS_DIETETICA, NOMBRES_DIETETICA, RECHAZO_DIET, normalizarPeso, paresProductoFa, paresVariacionesFa, buscarFrutosAre,
  paresDesdeNewGarden, buscarNewGarden, preciosDietetica,
  ITEMS_OTROS, NOMBRES_OTROS, paresDesdeTiendaNube, productoDePagina, preciosOtros,
  ITEMS_PESCE, NOMBRES_PESCE, preciosPesce,
  VERDU_SIMPLES, VERDU_PICKS, NOMBRES_VERDU, regexVerdu, elegirVerdura, mejorVerdura, referenciaVerdu, preciosVerdu, catCoto, esDeVerduleria,
  MC_VERDU, mcParaVerdu, aplicarMC,
  ITEMS_FARMACITY, NOMBRES_FARMACITY, preciosFarmacity,
};

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  main();
}
