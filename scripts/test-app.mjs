#!/usr/bin/env node
/* Smoke test de la app (node scripts/test-app.mjs, corre tras `npm run build`).
   Patrón del proyecto: jsdom + localStorage sembrado con datos viejos +
   eval de app.js + asserts sobre el DOM. Verifica las migraciones (v6 Piñones,
   v9 historial de Huevo) sin pisar los datos guardados del usuario, y el flujo
   de compra con precio (askPrice). */

import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "https://el-changuito.test/",
  pretendToBeVisual: true,
  runScripts: "outside-only",
});

// Datos guardados con forma vieja (pre-v6/v7): sin Piñones, con Champiñones y la salsa en "Otros lugares"
dom.window.localStorage.setItem("el-changuito-v1", JSON.stringify({
  stores: [
    {
      id: "diet", name: "Dietética", emoji: "🌿", color: "#9A6A1F", note: "",
      sections: [
        {
          id: "sec1", name: "Perecederos",
          items: [
            { id: "i1", name: "Nueces 500 g", note: "nota del usuario", spec: "", have: false },
            { id: "i2", name: "Huevo", note: "", spec: "", have: false, price: 4200, priceNote: "cargado a mano", priceV: "manual@01/08/2026" },
          ],
        },
        { id: "sec2", name: "Muy duraderos", items: [{ id: "i3", name: "Chía 500 g", note: "", spec: "", have: false }] },
      ],
    },
    {
      id: "otros", name: "Otros lugares", emoji: "📍", color: "#6C5CE7", note: "",
      sections: [
        { id: "o1", name: "Carmín (congelados)", items: [{ id: "c1", name: "Champiñones congelados", note: "vieja nota", spec: "", have: false }] },
        { id: "o2", name: "New Garden", items: [{ id: "n1", name: "Salsa de pescado", note: "", spec: "", have: true }] },
      ],
    },
    {
      id: "farma", name: "Farmacity", emoji: "💊", color: "#0E8C8C", note: "",
      sections: [{ id: "f1", name: "Higiene", items: [{ id: "h1", name: "Alcohol", note: "", spec: "", have: true }] }],
    },
    { // para la migración v10 (renombres de DIA); queda colapsada en Listas, no afecta los toggles
      id: "dia", name: "DIA", emoji: "🛒", color: "#D7263D", note: "",
      sections: [{
        id: "d1", name: "Almacén",
        items: [
          { id: "v1", name: "Vinagre de manzana 1 L", note: "", spec: "", have: false },
          { id: "e1", name: "Esponja", note: "", spec: "", have: true },
        ],
      }],
    },
  ],
}));

// Sin red: el fetch de precios.json falla en silencio (la app tiene catch)
dom.window.fetch = () => Promise.reject(new Error("sin red en el test"));

dom.window.eval(fs.readFileSync("app.js", "utf8"));
await new Promise((r) => setTimeout(r, 120)); // deja que React pinte

let pasan = 0;
const test = (nombre, fn) => { fn(); pasan++; console.log("✔ " + nombre); };

test("la app renderiza y muestra lo pendiente del usuario", () => {
  const texto = dom.window.document.body.textContent;
  assert.ok(texto.length > 100, "el DOM quedó vacío");
  assert.match(texto, /Nueces 500 g/);
  assert.match(texto, /nota del usuario/);
});

test("migración v7: Champiñones pasa a llamarse Hongos para cocinar (misma nota y estado)", () => {
  const texto = dom.window.document.body.textContent;
  assert.match(texto, /Hongos para cocinar/); // seguía por comprar → aparece en Comprar
  assert.doesNotMatch(texto, /Champiñones/);
  assert.match(texto, /vieja nota/);
});

/* ---------- Compra con precio (askPrice, migración v9) ---------- */

test("v9: el Huevo pendiente muestra el historial sembrado desde su precio manual", () => {
  assert.match(dom.window.document.body.textContent, /Pagado antes: \$ 4\.200 \(01\/08\)/);
});

// Tocar el círculo de comprado abre el editor de precio en vez de comprar directo
const circuloHuevo = [...dom.window.document.querySelectorAll('button[aria-label="Marcar como comprado"]')]
  .find((b) => b.parentElement.textContent.includes("Huevo"));
circuloHuevo.click();
await new Promise((r) => setTimeout(r, 80));

test("askPrice: aparece el editor con la última vez como referencia", () => {
  assert.ok(dom.window.document.querySelector('input[placeholder="¿Cuánto pagaste?"]'), "falta el input de precio");
  assert.match(dom.window.document.body.textContent, /Última vez \$ 4\.200 \(01\/08\)/);
});

// Cargar 4600 y confirmar (setter nativo + evento input para que React se entere)
const inputPrecio = dom.window.document.querySelector('input[placeholder="¿Cuánto pagaste?"]');
Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(inputPrecio, "4600");
inputPrecio.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
await new Promise((r) => setTimeout(r, 80));
[...dom.window.document.querySelectorAll("button")].find((b) => b.textContent === "OK").click();
await new Promise((r) => setTimeout(r, 500)); // debounce del guardado

const p2 = (n) => String(n).padStart(2, "0");
const d = new Date();
const HOY = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;

test("compra con precio: guarda el pago, la nota comparativa y el historial", () => {
  assert.doesNotMatch(dom.window.document.body.textContent, /Huevo/, "Huevo debería salir de pendientes");
  const data = JSON.parse(dom.window.localStorage.getItem("el-changuito-v1"));
  const huevo = data.stores.find((s) => s.id === "diet").sections[0].items.find((it) => it.name === "Huevo");
  assert.equal(huevo.have, true);
  assert.equal(huevo.price, 4600);
  assert.equal(huevo.priceV, "manual@08/08/2026"); // versión de la foto embebida (sin red)
  assert.equal(huevo.priceNote, `Pagado el ${HOY} · antes $ 4.200 (+10%)`);
  assert.deepEqual(huevo.priceHist, [{ p: 4200, t: "01/08/2026" }, { p: 4600, t: HOY }]);
});

// Piñones entra como "ya tenido" → se ve en la pestaña Listas (expandiendo la tienda)
const click = async (re) => {
  [...dom.window.document.querySelectorAll("button")].find((b) => re.test(b.textContent)).click();
  await new Promise((r) => setTimeout(r, 80));
};
await click(/^📋Listas$/);
await click(/Dietética.*por comprar/);

test("migración v6: Piñones aparece en las listas aunque el guardado no lo tenía", () => {
  assert.match(dom.window.document.body.textContent, /Piñones/);
});

// La app persiste recién en el próximo cambio de estado (con debounce): tocamos el ✓ de
// Piñones (primer "Marcar como faltante" en el orden Nueces → Piñones → Huevo) y esperamos.
[...dom.window.document.querySelectorAll('button[aria-label="Marcar como faltante"]')][0].click();
await new Promise((r) => setTimeout(r, 500));

test("v6 es idempotente sobre el guardado", () => {
  const data = JSON.parse(dom.window.localStorage.getItem("el-changuito-v1"));
  const perecederos = data.stores.find((s) => s.id === "diet").sections.find((x) => x.name === "Perecederos");
  const pinones = perecederos.items.filter((it) => it.name === "Piñones");
  assert.equal(pinones.length, 1, "Piñones debería estar exactamente una vez");
  const iNueces = perecederos.items.findIndex((it) => it.name === "Nueces 500 g");
  assert.equal(perecederos.items[iNueces + 1].name, "Piñones", "Piñones va después de Nueces");
});

test("v9 es idempotente: el historial de Huevo no se re-siembra tras nuevos guardados", () => {
  const data = JSON.parse(dom.window.localStorage.getItem("el-changuito-v1"));
  const huevo = data.stores.find((s) => s.id === "diet").sections[0].items.find((it) => it.name === "Huevo");
  assert.equal(huevo.priceHist.length, 2);
  assert.equal(huevo.price, 4600, "el precio pagado se conserva");
});

test("v10: renombres de DIA conservando estado (vinagre 500 ml, esponja salvauñas)", () => {
  const data = JSON.parse(dom.window.localStorage.getItem("el-changuito-v1"));
  const almacen = data.stores.find((s) => s.id === "dia").sections[0];
  const nombres = almacen.items.map((it) => it.name);
  assert.deepEqual(nombres, ["Vinagre de manzana 500 ml", "Esponja salvauñas"]);
  assert.equal(almacen.items[0].have, false, "el vinagre seguía por comprar");
  assert.equal(almacen.items[1].have, true, "la esponja estaba en stock");
});

test("v8: Alcohol en gel entra a Farmacity/Higiene después de Alcohol, una sola vez", () => {
  const data = JSON.parse(dom.window.localStorage.getItem("el-changuito-v1"));
  const higiene = data.stores.find((s) => s.id === "farma").sections.find((sec) => sec.name === "Higiene");
  const geles = higiene.items.filter((it) => it.name === "Alcohol en gel");
  assert.equal(geles.length, 1);
  const iAlcohol = higiene.items.findIndex((it) => it.name === "Alcohol");
  assert.equal(higiene.items[iAlcohol + 1].name, "Alcohol en gel");
});

test("v7: la salsa de pescado se mudó a Dietética/Muy duraderos y la sección New Garden desapareció", () => {
  const data = JSON.parse(dom.window.localStorage.getItem("el-changuito-v1"));
  const diet = data.stores.find((s) => s.id === "diet");
  const md = diet.sections.find((sec) => sec.name === "Muy duraderos");
  const salsas = md.items.filter((it) => it.name === "Salsa de pescado");
  assert.equal(salsas.length, 1, "la salsa debería estar una sola vez en Muy duraderos");
  assert.equal(salsas[0].have, true, "conserva su estado");
  const otros = data.stores.find((s) => s.id === "otros");
  assert.ok(!otros.sections.some((sec) => sec.name === "New Garden"), "la sección New Garden vacía se elimina");
  assert.ok(!otros.sections.some((sec) => sec.items.some((it) => it.name === "Salsa de pescado")), "no queda duplicada en Otros lugares");
});

/* ---------- Variación diaria (DeltaBadge, campo d de precios.json) ----------
   Instancia aparte: acá el fetch de precios.json SÍ responde, con una baja para
   Nueces y una suba para Chía, y la etiqueta ▼/▲ debe aparecer junto al precio. */
const dom2 = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "https://el-changuito.test/",
  pretendToBeVisual: true,
  runScripts: "outside-only",
});
dom2.window.localStorage.setItem("el-changuito-v1", JSON.stringify({
  stores: [
    {
      id: "diet", name: "Dietética", emoji: "🌿", color: "#9A6A1F", note: "",
      sections: [{
        id: "sec1", name: "Perecederos",
        items: [
          { id: "i1", name: "Nueces 500 g", note: "", spec: "", have: false },
          { id: "i2", name: "Chía 500 g", note: "", spec: "", have: false },
          { id: "i3", name: "Girasol 250 g", note: "", spec: "", have: true },
          { id: "i4", name: "Porotos negros 1 kg", note: "", spec: "", have: true },
        ],
      }],
    },
    { // tienda sintética para probar exclusiones de promo (tipo COTO sin carnicería)
      id: "extra", name: "Extra", emoji: "🧪", color: "#888888", note: "",
      sections: [
        { id: "x1", name: "Carnicería", items: [{ id: "xc", name: "Corte X", note: "", spec: "", have: false }] },
        { id: "x2", name: "Harinas", items: [{ id: "xh", name: "Harina T", note: "", spec: "", have: false }] },
      ],
    },
  ],
}));
dom2.window.fetch = () => Promise.resolve({
  ok: true,
  json: () => Promise.resolve({
    version: "11/08/2026",
    // Config de descuentos DISTINTA a la embebida: prueba que el JSON manda (días/COMERCIOS
    // pueden cambiar) en los dos esquemas: día suelto y rango con tope
    descuentos: {
      diet: [
        { dia: "lunes", pct: 30 },
        { dias: ["lunes", "martes", "miércoles", "jueves", "viernes"], pct: 20, tope: 1000 },
      ],
      extra: { sin: { secciones: ["Carnicería"] }, promos: [{ dia: "lunes", pct: 10 }] },
    },
    prices: {
      "Nueces 500 g": { p: 9000, n: "precio de prueba", d: -1000 },
      "Chía 500 g": { p: 5806, n: "precio de prueba", d: 277 },
      "Girasol 250 g": { p: 3000, n: "precio de prueba", d: -300, dv: "09/08/2026" },       // bajó hace 1 día
      "Porotos negros 1 kg": { p: 2000, n: "precio de prueba", d: -500, dv: "01/08/2026" }, // baja VIEJA (9 días)
      "Corte X": { p: 1000, n: "precio de prueba" },
      "Harina T": { p: 2000, n: "precio de prueba" },
    },
  }),
});
// Fecha fija: lunes 10/08/2026, así "hoy" es determinístico para los dtos del día
const RealDate = dom2.window.Date;
dom2.window.Date = class extends RealDate {
  constructor(...args) { if (args.length) { super(...args); } else { super(2026, 7, 10, 12, 0, 0); } }
  static now() { return new RealDate(2026, 7, 10, 12, 0, 0).getTime(); }
};

dom2.window.eval(fs.readFileSync("app.js", "utf8"));
await new Promise((r) => setTimeout(r, 150));

test("DeltaBadge: baja en verde y suba con su porcentaje contra el día anterior", () => {
  const texto = dom2.window.document.body.textContent;
  assert.match(texto, /▼ -10%/);  // Nueces: $10.000 → $9.000
  assert.match(texto, /▲ \+5%/); // Chía: $5.529 → $5.806
});

test("DeltaBadge: flechas solo para variaciones recientes", () => {
  // Nueces (fila + resumen) + Chía (fila + resumen) + Girasol (resumen) + título "▼ Bajaron" = 6.
  // Porotos negros NO suma: su baja tiene 9 días (ventana de aviso = 4).
  const flechas = (dom2.window.document.body.textContent.match(/[▲▼]/g) || []).length;
  assert.equal(flechas, 6);
});

test("Oportunidades: destaca lo pendiente que bajó, ofrece sumar lo que ya tenés y avisa sobreprecios", () => {
  const texto = dom2.window.document.body.textContent;
  assert.match(texto, /¡Es el momento! Los necesitás y están más baratos:/); // Nueces
  assert.match(texto, /Ya los tenés, pero por si querés aprovechar:/);       // Girasol
  assert.match(texto, /\+ a Comprar/);
  assert.match(texto, /hace 1d/);                                            // la baja de Girasol tiene fecha
  assert.match(texto, /⚠ Con sobreprecio/);                                  // Chía subió y está pendiente
  assert.doesNotMatch(texto, /Porotos negros 1 kg · 🌿/);                    // baja vieja: fuera del resumen
});

test("Descuentos por día: la config del JSON pisa la embebida y calcula ambos precios", () => {
  const texto = dom2.window.document.body.textContent;
  assert.match(texto, /Dto\. adicional: lunes -30%/);          // línea del comercio…
  assert.match(texto, /≈ \$ 10\.364/);                          // …con el subtotal con dto (14.806 × 0,7)
  assert.match(texto, /lun \$ 6\.300/);                         // Nueces $9.000 → $6.300 el lunes
  assert.match(texto, /lun \$ 4\.064/);                         // Chía $5.806 → $4.064 el lunes
});

test("Descuento con tope: subtotal recortado al máximo de devolución y aviso de compra óptima", () => {
  const texto = dom2.window.document.body.textContent;
  assert.match(texto, /lun a vie -20% \(tope \$ 1\.000\)/);     // la promo con rango y tope
  assert.match(texto, /≈ \$ 13\.806/);                          // 14.806 − min(2.961, 1.000)
  assert.match(texto, /⚠ Lo pendiente \(\$ 14\.806\) supera el tope/);
  assert.match(texto, /conviene comprar hasta \$ 5\.000/);      // 1.000 ÷ 20%
  assert.match(texto, /lun-vie \$ 7\.200/);                     // por ítem sigue el % pleno (el tope es por compra)
});

test("Total estimado con los dtos de HOY: aplica la mejor promo vigente de cada comercio", () => {
  const texto = dom2.window.document.body.textContent;
  // Es lunes (fecha fija): dietética -30% ($4.442) + extra -10% solo sobre lo no excluido ($200)
  assert.match(texto, /Con los dtos de hoy · ahorrás \$ 4\.642/);
  assert.match(texto, /lunes -30% \(hoy\)/);                    // la promo de hoy queda resaltada
});

test("Exclusiones de promo: la carnicería no lleva dto y la tarjeta lo aclara", () => {
  const texto = dom2.window.document.body.textContent;
  assert.match(texto, /lunes -10% \(hoy\) ≈ \$ 2\.800/);        // 3.000 − 10% de los $2.000 con promo
  assert.match(texto, /no aplica a \$ 1\.000 de lo pendiente/); // el Corte X queda afuera
  assert.match(texto, /lun \$ 1\.800/);                          // Harina T sí muestra su precio del lunes
  assert.doesNotMatch(texto, /lun \$ 900/);                      // Corte X no muestra línea de dto
});

// "+ a Comprar" desde la oportunidad: Girasol pasa a pendiente (al final, para no mover los totales de arriba)
[...dom2.window.document.querySelectorAll("button")].find((b) => b.textContent === "+ a Comprar").click();
await new Promise((r) => setTimeout(r, 600));

test("'+ a Comprar' pasa el ítem rebajado a la lista de pendientes", () => {
  const data = JSON.parse(dom2.window.localStorage.getItem("el-changuito-v1"));
  const girasol = data.stores.find((s) => s.id === "diet").sections[0].items.find((it) => it.name === "Girasol 250 g");
  assert.equal(girasol.have, false);
});

console.log(`\n${pasan} tests de app OK`);
