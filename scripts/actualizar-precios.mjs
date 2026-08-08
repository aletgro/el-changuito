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
    const mx = s.match(/(?:^|\s)x\s*(\d+)\b/);
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

/* ---------- Selección según el criterio ---------- */
function elegir(item, candidatos) {
  const validos = [];
  for (const c of candidatos) {
    if (!item.must.every((re) => re.test(c.nombre))) continue;
    if (item.reject.some((re) => re.test(c.nombre))) continue;
    const q = parseQty(c.nombre);
    if (item.unit !== "un") {
      if (q.unit !== item.unit) continue;
      if (q.amount < item.qty * 0.2 || q.amount > item.qty * 3.5) continue; // tamaño similar
      const paquetes = Math.max(1, Math.ceil(item.qty / q.amount - 1e-9));
      validos.push({ ...c, paquetes, estimado: paquetes * c.precio, porUnidad: c.precio / q.amount });
    } else {
      validos.push({ ...c, paquetes: 1, estimado: c.precio, porUnidad: c.precio });
    }
  }
  if (!validos.length) return null;
  validos.sort((a, b) => a.estimado - b.estimado || a.porUnidad - b.porUnidad);
  const g = validos[0];
  const desc = g.lista > g.precio ? Math.round((1 - g.precio / g.lista) * 100) : 0;
  const nota = (g.paquetes > 1 ? g.paquetes + "× " : "") + g.nombre.replace(/\s+/g, " ").trim().slice(0, 60) + (desc >= 5 ? ` · oferta -${desc}%` : "");
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

  if (ok === 0) {
    console.error("\nNingún ítem se pudo actualizar: no escribo el archivo para no romper nada.");
    process.exit(1);
  }

  fs.writeFileSync(archivo, JSON.stringify({ version: fechaHoyAR(), prices: precios }, null, 2) + "\n");
  console.log(`\nListo: ${ok}/${ITEMS.length} ítems actualizados en ${archivo} (versión ${fechaHoyAR()}).`);
  if (fallos.length) console.log("Sin match (revisar consultas): " + fallos.join(", "));
}

export { parseQty, elegir, ITEMS };

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  main();
}
