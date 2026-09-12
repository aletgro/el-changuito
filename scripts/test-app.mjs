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
            { id: "i9", name: "Fruta", type: "pick", options: ["Kiwi", "Banana"], picked: [], note: "", spec: "", have: true },
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
    { // para la migración v12: Carnicería sin el pollo (todo en stock, no afecta Comprar)
      id: "coto", name: "COTO", emoji: "🥩", color: "#E4572E", note: "",
      sections: [{
        id: "co1", name: "Carnicería",
        items: [
          { id: "ca1", name: "Asado", note: "", spec: "", have: true },
          { id: "ca2", name: "Roast beef", note: "", spec: "", have: true },
        ],
      }],
    },
    { // para la migración v10 (renombres de DIA); queda colapsada en Listas, no afecta los toggles
      id: "dia", name: "DIA", emoji: "🛒", color: "#D7263D", note: "",
      sections: [{
        id: "d1", name: "Almacén",
        items: [
          { id: "v1", name: "Vinagre de manzana 1 L", note: "", spec: "", have: false },
          { id: "e1", name: "Esponja", note: "", spec: "", have: true },
          { id: "a1", name: "Aceite de girasol 1 L", note: "", spec: "", have: false },
        ],
      }],
    },
  ],
}));

// Sin red: el fetch de precios.json falla en silencio (la app tiene catch)
dom.window.fetch = () => Promise.reject(new Error("sin red en el test"));

/* Espera a que React pinte las listas: el render es asincrónico (recién después del eval el
   body está vacío, luego "Cargando tus listas…"); tope 5 s. Una espera fija no alcanza en
   máquinas lentas. */
const esperarPintado = async (win) => {
  const t0 = Date.now();
  const cargando = () => { const t = win.document.body.textContent.trim(); return !t || /Cargando tus listas/.test(t); };
  while (cargando() && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 80));
};

dom.window.eval(fs.readFileSync("app.js", "utf8"));
await esperarPintado(dom.window);

let pasan = 0;
const test = (nombre, fn) => { fn(); pasan++; console.log("✔ " + nombre); };

test("Comprar: con pendientes en varios comercios, las tarjetas arrancan compactadas", () => {
  const texto = dom.window.document.body.textContent;
  assert.match(texto, /▾ Expandir todo/);
  assert.doesNotMatch(texto, /Nueces 500 g/); // el contenido queda plegado
});

// Expandimos todo para el resto de los asserts
[...dom.window.document.querySelectorAll("button")].find((b) => /Expandir todo/.test(b.textContent)).click();
await new Promise((r) => setTimeout(r, 100));

test("la app renderiza y muestra lo pendiente del usuario", () => {
  const texto = dom.window.document.body.textContent;
  assert.ok(texto.length > 100, "el DOM quedó vacío");
  assert.match(texto, /Nueces 500 g/);
  assert.match(texto, /nota del usuario/);
});

test("Comprar: ya no existe el botón 'todo comprado' (se apretaba sin querer)", () => {
  assert.doesNotMatch(dom.window.document.body.textContent, /todo comprado/);
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

test("Listas: las secciones del comercio abierto arrancan compactadas", () => {
  assert.doesNotMatch(dom.window.document.body.textContent, /Piñones/);
});

test("Listas: ya no hay modo Editar (ni botón, ni agregar/borrar ítems)", () => {
  const botones = [...dom.window.document.querySelectorAll("button")].map((b) => b.textContent);
  assert.ok(!botones.some((t) => /^(Editar|Listo)$/.test(t)), "sobrevive el botón Editar");
  assert.ok(!botones.some((t) => /Agregar ítem/.test(t)));
});

await click(/^Perecederos/); // abrir la sección para seguir

test("migración v6: Piñones aparece en las listas aunque el guardado no lo tenía", () => {
  assert.match(dom.window.document.body.textContent, /Piñones/);
});

test("Listas: un pick muestra '2 opciones ▾' plegado, sin listar las opciones", () => {
  const texto = dom.window.document.body.textContent;
  assert.match(texto, /2 opciones ▾/);
  assert.doesNotMatch(texto, /Banana/);
});

[...dom.window.document.querySelectorAll("button")].find((b) => /2 opciones/.test(b.textContent)).click();
await new Promise((r) => setTimeout(r, 80));

test("Listas: desplegar las opciones no cambia el estado del ítem", () => {
  const texto = dom.window.document.body.textContent;
  assert.match(texto, /Banana/);
  assert.match(texto, /Kiwi/);
  assert.doesNotMatch(texto, /Fruta · por comprar/); // sigue en stock
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

test("v10/v16: renombres de DIA conservando estado (vinagre, esponja, aceite)", () => {
  const data = JSON.parse(dom.window.localStorage.getItem("el-changuito-v1"));
  const almacen = data.stores.find((s) => s.id === "dia").sections[0];
  const nombres = almacen.items.map((it) => it.name);
  assert.deepEqual(nombres, ["Vinagre de manzana 500 ml", "Esponja salvauñas", "Aceite de girasol"]);
  assert.equal(almacen.items[2].have, false, "el aceite seguía por comprar");
  assert.equal(almacen.items[0].have, false, "el vinagre seguía por comprar");
  assert.equal(almacen.items[1].have, true, "la esponja estaba en stock");
});

test("v14: film, aluminio y manteca entran a DIA/Otros (creando la sección si falta)", () => {
  const data = JSON.parse(dom.window.localStorage.getItem("el-changuito-v1"));
  const otros = data.stores.find((s) => s.id === "dia").sections.find((sec) => sec.name === "Otros");
  assert.ok(otros, "falta la sección Otros de DIA");
  assert.deepEqual(otros.items.map((i) => i.name), ["Film transparente", "Papel aluminio", "Papel manteca"]);
});

test("v15: COTO queda con Almacén (Extracto de tomate) separado de Harinas Chacabuco", () => {
  const data = JSON.parse(dom.window.localStorage.getItem("el-changuito-v1"));
  const coto = data.stores.find((s) => s.id === "coto");
  assert.equal(coto.sections[0].name, "Almacén");
  assert.deepEqual(coto.sections[0].items.map((i) => i.name), ["Extracto de tomate"]);
  assert.ok(!coto.sections.some((sec) => sec.name === "Almacén · harinas Chacabuco"), "la sección mixta ya no existe");
});

test("v12: Pollo entero entra a COTO/Carnicería antes de Roast beef, una sola vez", () => {
  const data = JSON.parse(dom.window.localStorage.getItem("el-changuito-v1"));
  const carne = data.stores.find((s) => s.id === "coto").sections.find((sec) => sec.name === "Carnicería");
  const pollos = carne.items.filter((it) => it.name === "Pollo entero");
  assert.equal(pollos.length, 1);
  assert.equal(pollos[0].note, "Refrigerado (no congelado)");
  const iRoast = carne.items.findIndex((it) => it.name === "Roast beef");
  assert.equal(carne.items[iRoast - 1].name, "Pollo entero");
});

test("v17: comida y piedras sanitarias para gatos entran a Otros lugares/Tercero (creando la sección si falta), en stock", () => {
  const data = JSON.parse(dom.window.localStorage.getItem("el-changuito-v1"));
  const otros = data.stores.find((s) => s.id === "otros");
  const terceros = otros.sections.filter((sec) => sec.name === "Tercero");
  assert.equal(terceros.length, 1);
  assert.equal(otros.sections[0].name, "Tercero", "la sección nueva va primera, como en el seed");
  assert.deepEqual(terceros[0].items.map((i) => i.name), ["Comida para gatos", "Piedras sanitarias para gatos"]);
  assert.ok(terceros[0].items.every((i) => i.have && !i.price), "arrancan en stock y sin precio");
});

test("v18: Guantes grandes entra a DIA/Limpieza e higiene (creando la sección después de Almacén si falta)", () => {
  const data = JSON.parse(dom.window.localStorage.getItem("el-changuito-v1"));
  const dia = data.stores.find((s) => s.id === "dia");
  const limp = dia.sections.filter((sec) => sec.name === "Limpieza e higiene");
  assert.equal(limp.length, 1);
  assert.equal(dia.sections[dia.sections.findIndex((sec) => sec.name === "Almacén") + 1].name, "Limpieza e higiene");
  assert.deepEqual(limp[0].items.map((i) => i.name), ["Guantes grandes"]);
  assert.ok(limp[0].items[0].have, "arranca en stock");
});

test("v13: la sección Papelera entra a Otros lugares con sus 5 ítems, una sola vez", () => {
  const data = JSON.parse(dom.window.localStorage.getItem("el-changuito-v1"));
  const otros = data.stores.find((s) => s.id === "otros");
  const papeleras = otros.sections.filter((sec) => sec.name === "Papelera");
  assert.equal(papeleras.length, 1);
  assert.deepEqual(papeleras[0].items.map((i) => i.name),
    ["Bolsas arranque 10x15", "Bolsas basura 34x38", "16 contenedores n°1", "15 contenedores n°2", "4 contenedores n°3"]);
  assert.ok(papeleras[0].items.every((i) => i.have), "arrancan en stock");
});

test("v11: Frigorífico Pesce aparece con sus 3 productos, como ya tenidos", () => {
  const data = JSON.parse(dom.window.localStorage.getItem("el-changuito-v1"));
  const pesce = data.stores.find((s) => s.id === "pesce");
  assert.ok(pesce, "falta la tienda pesce");
  assert.deepEqual(pesce.sections[0].items.map((i) => i.name), ["Salmón", "Langostinos", "Mejillones"]);
  assert.ok(pesce.sections[0].items.every((i) => i.have), "arrancan en stock (nada pendiente)");
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

/* ---------- Listas: buscador ---------- */
await click(/^📋Listas$/);
const escribir = async (valor) => {
  const input = dom.window.document.querySelector('input[aria-label="Buscar producto"]');
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, valor);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
};
await escribir("p");
test("Buscador: con una sola letra no busca (siguen las tarjetas)", () => {
  assert.match(dom.window.document.body.textContent, /Restaurar listas originales/);
});
await escribir("pinon");
test("Buscador: encuentra por nombre sin tildes y muestra comercio y sección; las tarjetas se esconden", () => {
  const texto = dom.window.document.body.textContent;
  assert.match(texto, /1 resultado · tocá la fila para cambiar su estado/);
  assert.match(texto, /Dietética.*Piñones/s);
  assert.match(texto, /Perecederos/);
  assert.doesNotMatch(texto, /Restaurar listas originales/);
});
await escribir("kiwi");
test("Buscador: también encuentra por opción de un pick", () => {
  assert.match(dom.window.document.body.textContent, /Fruta.*opción Kiwi/s);
});
await escribir("xyzxyz");
test("Buscador: sin coincidencias lo dice", () => {
  assert.match(dom.window.document.body.textContent, /Nada que se llame «xyzxyz»/);
});
await escribir("alcohol");
const filaAlcohol = [...dom.window.document.querySelectorAll(".fila-toque")].find((d) => /^[^A-Za-z]*Alcohol[^e]/.test(d.textContent.trim()));
filaAlcohol.click();
await new Promise((r) => setTimeout(r, 500));
test("Buscador: tocar la fila cambia el estado (en stock → por comprar) sin salir de la búsqueda, y persiste", () => {
  const texto = dom.window.document.body.textContent;
  assert.match(texto, /resultados · tocá la fila/);         // Alcohol y Alcohol en gel
  assert.match(texto, /Alcohol· por comprar/); // los spans se pegan en textContent
  const data = JSON.parse(dom.window.localStorage.getItem("el-changuito-v1"));
  const alcohol = data.stores.find((s) => s.id === "farma").sections.flatMap((sec) => sec.items).find((it) => it.name === "Alcohol");
  assert.equal(alcohol.have, false);
});
dom.window.document.querySelector('button[aria-label="Borrar búsqueda"]').click();
await new Promise((r) => setTimeout(r, 120));
test("Buscador: la cruz borra la búsqueda y vuelven las tarjetas", () => {
  const texto = dom.window.document.body.textContent;
  assert.match(texto, /Restaurar listas originales/);
  assert.match(texto, /Farmacity.*1 por comprar/s);
});

/* ---------- Temporada: hoy por default + tira de meses ---------- */
await click(/^❄️Temporada$|Temporada$/);

test("Temporada: arranca en el mes actual y ofrece la tira de 12 meses", () => {
  const texto = dom.window.document.body.textContent;
  const mesActual = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][new Date().getMonth()];
  assert.match(texto, new RegExp(mesActual.charAt(0).toUpperCase() + mesActual.slice(1) + " · "));
  assert.equal(dom.window.document.querySelectorAll('button[title="enero"]').length, 1);
  assert.doesNotMatch(texto, /volver a hoy/);
});

dom.window.document.querySelector('button[title="enero"]').click();
await new Promise((r) => setTimeout(r, 80));

test("Temporada: tocar un mes muestra su quinta y un atajo para volver a hoy", () => {
  const texto = dom.window.document.body.textContent;
  assert.match(texto, /Enero · verano/);
  assert.match(texto, /volver a hoy/);
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
    { // Verdulería: referencia con comercio de origen (DIA/COTO) → dtos por día del comercio de origen
      id: "verdu", name: "Verdulería", emoji: "🥬", color: "#3E8914", note: "",
      sections: [{ // migración v19: Contundentes sin Nabo (en stock, no afecta Comprar)
        id: "vd2", name: "Algo de cada categoría",
        items: [{ id: "vco", name: "Contundentes", type: "pick", options: ["Batata", "Calabaza", "Mandioca", "Remolacha"], picked: ["Batata"], note: "", spec: "", have: true }],
      }, {
        id: "vd1", name: "Siempre en stock",
        items: [
          { id: "vp", name: "Papa", note: "", spec: "", have: false },
          // precio viejo de un SKU fantasma de COTO: la foto nueva trae p: 0 y lo tiene que borrar
          { id: "vc", name: "Cúrcuma", note: "", spec: "", have: true, price: 1799, priceNote: "Cúrcuma · $1.799/kg · COTO", priceSrc: "coto", priceV: "04/09/2026" },
          { id: "vf", name: "Fruta", type: "pick", options: ["Banana", "Pomelo", "Papaya"], picked: [], note: "", spec: "", have: false },
        ],
      }],
    },
    { // El Puente: pick con precios por opción + dto de mostrador en cualquier ítem
      id: "puente", name: "El Puente", emoji: "🧀", color: "#2E6FA3", note: "",
      sections: [
        {
          id: "q1", name: "Quesos",
          // priceV YA en la versión de la foto: reproduce el bug de "esta versión ya la tengo"
          // (el op debe entrar igual — la aplicación es idempotente)
          items: [{ id: "qp", name: "Queso para rayar", type: "pick", options: ["Sardo", "Reggianito", "Romano", "Provolone"], picked: [], note: "", spec: "", have: false, price: 8730, priceNote: "300 g de Sardo", priceV: "11/08/2026" }],
        },
        { id: "q2", name: "Lácteos", items: [{ id: "qc", name: "Crema", note: "", spec: "", have: false }] },
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
      puente: [{ dia: "lunes", pct: 20 }], // para combinar con el dto de mostrador
      dia: [{ dia: "lunes", pct: 20 }],    // los de verdulería vía DIA/COTO usan el dto de SU comercio
      coto: [{ dia: "lunes", pct: 30 }],
    },
    prices: {
      "Nueces 500 g": { p: 9000, n: "precio de prueba", d: -1000 },
      "Chía 500 g": { p: 5806, n: "precio de prueba · solo online", d: 277, online: true }, // dto que solo vale por internet
      "Girasol 250 g": { p: 3000, n: "precio de prueba", d: -300, dv: "09/08/2026" },       // bajó hace 1 día
      "Porotos negros 1 kg": { p: 2000, n: "precio de prueba", d: -500, dv: "01/08/2026" }, // baja VIEJA (9 días)
      "Corte X": { p: 1000, n: "precio de prueba", urls: [{ n: "falda", url: "https://www.coto.com.ar/productos/_/R-00000011-00000011-200" }, { n: "osobuco", url: "https://www.coto.com.ar/productos/_/R-00000012-00000012-200" }] },
      "Harina T": { p: 2000, n: "precio de prueba" },
      "Queso para rayar": { p: 8730, n: "300 g de Sardo", op: { "Sardo": 8730, "Reggianito": 8820, "Romano": 8790, "Provolone": 8877 } },
      "Crema": { p: 7520, n: "2× Pote x 330 cc · $11.394/L" },
      // mc = referencia MAYORISTA del Mercado Central (último día publicado); Papaya solo tiene mc (sin DIA/COTO)
      // url = página del producto en el sitio de origen (píldora "ver en DIA ↗" en la app)
      "Papa": { p: 2990, n: "Papa Negra · $2.990/kg · DIA", s: "dia", u: "kg", url: "https://diaonline.supermercadosdia.com.ar/papa-negra-x-kg-90170/p", mc: { p: 1134, f: "04/09/2026" } },
      "Cúrcuma": { p: 0, n: "hoy ni DIA ni COTO la venden fresca", mc: { p: 4500, f: "04/09/2026" } },
      "Fruta": { p: 799, n: "la más barata hoy: Pomelo ($799/kg, COTO) · 2/3 con precio", s: "coto", u: "kg", url: "https://www.coto.com.ar/productos/_/R-00000700-00000700-200",
        op: { "Banana": { p: 3990, s: "dia", u: "kg", url: "https://diaonline.supermercadosdia.com.ar/banana-x-kg-1/p", mc: { p: 1458, f: "04/09/2026" } }, "Pomelo": { p: 799, s: "coto", u: "kg", url: "https://www.coto.com.ar/productos/_/R-00000700-00000700-200", online: true }, "Papaya": { mc: { p: 3300, f: "04/09/2026", n: "Mamon" } } } },
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
await esperarPintado(dom2.window);

// También acá arranca compactado (3 comercios con pendientes): expandimos para inspeccionar
[...dom2.window.document.querySelectorAll("button")].find((b) => /Expandir todo/.test(b.textContent)).click();
await new Promise((r) => setTimeout(r, 100));

test("DeltaBadge: baja en verde y suba con su porcentaje contra el día anterior", () => {
  const texto = dom2.window.document.body.textContent;
  assert.match(texto, /▼ -10%/);  // Nueces: $10.000 → $9.000
  assert.match(texto, /▲ \+5%/); // Chía: $5.529 → $5.806
});

test("DeltaBadge: flechas solo para variaciones recientes", () => {
  // Nueces (fila + resumen) + Chía (fila + resumen) + título "▼ Bajaron" = 5.
  // Girasol (ya lo tenés) está plegado en la píldora, sin flecha a la vista.
  // Porotos negros NO suma: su baja tiene 9 días (ventana de aviso = 4).
  const flechas = (dom2.window.document.body.textContent.match(/[▲▼]/g) || []).length;
  assert.equal(flechas, 5);
});

test("Oportunidades: destaca lo pendiente que bajó y avisa sobreprecios; lo que ya tenés queda plegado con la cuenta", () => {
  const texto = dom2.window.document.body.textContent;
  assert.match(texto, /▼ Bajaron de precio · 1 que necesitás · 1 que ya tenés/);
  assert.match(texto, /¡Es el momento! Los necesitás y están más baratos:/); // Nueces
  assert.match(texto, /Ya los tenés y bajaron · 1 ▾/);                       // Girasol, plegado
  assert.doesNotMatch(texto, /\+ a Comprar/);                                // …sin filas ni botón hasta abrirlo
  assert.doesNotMatch(texto, /Girasol 250 g · 🌿/);
  assert.match(texto, /⚠ Con sobreprecio · 1/);                              // Chía subió y está pendiente
  assert.doesNotMatch(texto, /Porotos negros 1 kg · 🌿/);                    // baja vieja: fuera del resumen
});

[...dom2.window.document.querySelectorAll("button")].find((b) => /Ya los tenés y bajaron/.test(b.textContent)).click();
await new Promise((r) => setTimeout(r, 100));

test("Oportunidades: al abrir 'ya los tenés' aparecen las filas con su fecha y el botón '+ a Comprar'", () => {
  const texto = dom2.window.document.body.textContent;
  assert.match(texto, /Ya los tenés y bajaron · 1 ▴.*Por si querés aprovechar:/s);
  assert.match(texto, /Girasol 250 g · 🌿/);
  assert.match(texto, /hace 1d/);                                            // la baja de Girasol tiene fecha
  assert.match(texto, /\+ a Comprar/);
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
  // Lunes (fecha fija): dietética -30% ($4.442) + extra -10% sobre lo no excluido ($200) + puente -20% ($3.250)
  // + verdulería: Papa vía DIA -20% ($598) y Fruta vía COTO -30% ($240) → $8.730
  assert.match(texto, /Con los dtos de hoy · ahorrás \$ 8\.730/);
  assert.match(texto, /lunes -30% \(hoy\)/);                    // la promo de hoy queda resaltada
});

test("Exclusiones de promo: la carnicería no lleva dto y la tarjeta lo aclara", () => {
  const texto = dom2.window.document.body.textContent;
  assert.match(texto, /lunes -10% \(hoy\) ≈ \$ 2\.800/);        // 3.000 − 10% de los $2.000 con promo
  assert.match(texto, /no aplica a \$ 1\.000 de lo pendiente/); // el Corte X queda afuera
  assert.match(texto, /lun \$ 1\.800/);                          // Harina T sí muestra su precio del lunes
  assert.doesNotMatch(texto, /lun \$ 900/);                      // Corte X no muestra línea de dto
});

test("Pick con precios por opción: cada queso muestra su precio con el dto de hoy incluido", () => {
  const texto = dom2.window.document.body.textContent;
  assert.match(texto, /Si alguno tiene promo en el local, tocá "dto"/);
  assert.match(texto, /Precios con el -20% de hoy incluido\./);
  assert.match(texto, /Sardo.*\$ 6\.984/s);      // 8.730 × 0,8 (lunes -20%)
  assert.match(texto, /Provolone.*\$ 7\.102/s);  // 8.877 × 0,8
});

// Cargarle -10% al Reggianito: mostrador -10% SOBRE el -20% de hoy
const chipsDto = [...dom2.window.document.querySelectorAll("button")].filter((b) => b.textContent === "dto");
chipsDto[1].click(); // el orden sigue las opciones (alfabético): Provolone, Reggianito, ...
await new Promise((r) => setTimeout(r, 100));

test("dto de mostrador: cicla 10/15/20/25 y combina con el dto del día", () => {
  const texto = dom2.window.document.body.textContent;
  assert.match(texto, /-10%/);
  assert.match(texto, /\$ 6\.350/);   // 8.820 × 0,9 × 0,8 — Reggianito pasa a ganarle al Sardo
  assert.doesNotMatch(texto, /\$ 8\.820(?!\d)/);
});

// El dto de mostrador vale para CUALQUIER ítem de El Puente: la Crema con -10%
const chipCrema = [...dom2.window.document.querySelectorAll("button")].filter((b) => b.textContent === "dto").pop();
chipCrema.click();
await new Promise((r) => setTimeout(r, 100));

test("dto de mostrador en ítems comunes de El Puente: combina con el dto del día y lo aclara", () => {
  const texto = dom2.window.document.body.textContent;
  assert.match(texto, /Crema/);
  assert.match(texto, /\$ 5\.414/);            // 7.520 × 0,9 (mostrador) × 0,8 (lunes)
  assert.match(texto, /incluye -20% de hoy/);  // la aclaración bajo el precio efectivo
});

test("Verdulería: cada referencia usa el dto por día de SU comercio de origen", () => {
  const texto = dom2.window.document.body.textContent;
  assert.match(texto, /Papa Negra · \$2\.990\/kg · DIA/);
  assert.match(texto, /lun \$ 2\.392/);                                       // Papa: DIA lunes -20%
  assert.match(texto, /Referencia del más barato entre DIA y COTO/);            // pick sin chips de mostrador
  assert.match(texto, /Precios con el dto de hoy de cada comercio incluido/);  // mezcla DIA/COTO
  assert.match(texto, /Banana.*DIA.*\$ 3\.192\/kg/s);                          // 3.990 × 0,8
  assert.match(texto, /Pomelo.*COTO.*\$ 559\/kg/s);                            // 799 × 0,7
});

test("Mercado Central: la referencia mayorista acompaña al precio minorista sin reemplazarlo", () => {
  const texto = dom2.window.document.body.textContent;
  assert.match(texto, /Papa Negra · \$2\.990\/kg · DIA.*Mercado Central \(mayorista\): \$ 1\.134\/kg · 04\/09/s); // simple: línea aparte, con fecha
  const fila = (n) => [...dom2.window.document.querySelectorAll(".fila-toque")].find((d) => new RegExp("^[^A-Za-z]*" + n).test(d.textContent.trim()));
  assert.match(fila("Banana").textContent, /\$ 3\.192\/kg.*Central \$ 1\.458\/kg/s);  // opción: minorista con dto de hoy + mayorista
  assert.doesNotMatch(fila("Pomelo").textContent, /Central/);                       // sin cotización mayorista: nada
  assert.match(fila("Papaya").textContent, /Central \$ 3\.300\/kg/);               // solo mayorista (sin DIA/COTO) también se ve
  assert.doesNotMatch(fila("Papaya").textContent, /\$ 3\.300\/kg\s*\$/);           // ...y no inventa un precio minorista
});

test("Link al producto: píldora 'ver en DIA ↗' que abre la página en otra pestaña; una por corte en los compuestos", () => {
  const links = [...dom2.window.document.querySelectorAll("a")];
  const papa = links.find((a) => a.textContent === "ver en DIA ↗");
  assert.ok(papa, "falta la píldora de Papa");
  assert.equal(papa.href, "https://diaonline.supermercadosdia.com.ar/papa-negra-x-kg-90170/p");
  assert.equal(papa.target, "_blank");
  assert.match(papa.rel, /noopener/);
  const cortes = links.filter((a) => /^(falda|osobuco) ↗$/.test(a.textContent));
  assert.deepEqual(cortes.map((a) => a.href), ["https://www.coto.com.ar/productos/_/R-00000011-00000011-200", "https://www.coto.com.ar/productos/_/R-00000012-00000012-200"]);
  assert.equal(cortes[0].getAttribute("aria-label"), "ver falda en COTO");
  // sin página (Nueces, Crema, quesos de El Puente): sin píldora
  assert.equal(links.filter((a) => /ver en/.test(a.textContent)).length, 1);
});

test("Solo online: chip junto al precio del ítem (fila y resumen) y aviso en la opción del pick; nada en los demás", () => {
  const chips = [...dom2.window.document.querySelectorAll("span")].filter((s) => s.textContent === "solo online");
  assert.equal(chips.length, 2, "Chía: uno en su fila y otro en '⚠ Con sobreprecio'"); // Nueces y el resto, sin chip
  const fila = (n) => [...dom2.window.document.querySelectorAll(".fila-toque")].find((d) => new RegExp("^[^A-Za-z]*" + n).test(d.textContent.trim()));
  assert.match(fila("Pomelo").textContent, /Pomelo · COTO · solo online/);
  assert.doesNotMatch(fila("Banana").textContent, /solo online/);
});

test("Link al producto en las opciones de un pick: '↗' por opción con precio, nada en las que no tienen página", () => {
  const fila = (n) => [...dom2.window.document.querySelectorAll(".fila-toque")].find((d) => new RegExp("^[^A-Za-z]*" + n).test(d.textContent.trim()));
  const banana = fila("Banana").querySelector("a");
  assert.equal(banana.textContent, "↗");
  assert.equal(banana.getAttribute("aria-label"), "ver en DIA");
  assert.equal(banana.href, "https://diaonline.supermercadosdia.com.ar/banana-x-kg-1/p");
  assert.equal(fila("Pomelo").querySelector("a").getAttribute("aria-label"), "ver en COTO");
  assert.equal(fila("Papaya").querySelector("a"), null); // solo mayorista: no hay página
  assert.equal(fila("Sardo").querySelector("a"), null);  // El Puente publica un listado sin páginas por producto
});

// "+ a Comprar" desde la oportunidad: Girasol pasa a pendiente (al final, para no mover los totales de arriba)
[...dom2.window.document.querySelectorAll("button")].find((b) => b.textContent === "+ a Comprar").click();
await new Promise((r) => setTimeout(r, 600));

test("migración v19: Contundentes suma Nabo en orden alfabético, conservando lo elegido y el estado", () => {
  const data = JSON.parse(dom2.window.localStorage.getItem("el-changuito-v1"));
  const cont = data.stores.find((s) => s.id === "verdu").sections.flatMap((sec) => sec.items).find((it) => it.name === "Contundentes");
  assert.deepEqual(cont.options, ["Batata", "Calabaza", "Mandioca", "Nabo", "Remolacha"]);
  assert.deepEqual(cont.picked, ["Batata"]);
  assert.equal(cont.have, true);
});

test("'+ a Comprar' pasa el ítem rebajado a la lista de pendientes", () => {
  const data = JSON.parse(dom2.window.localStorage.getItem("el-changuito-v1"));
  const girasol = data.stores.find((s) => s.id === "diet").sections[0].items.find((it) => it.name === "Girasol 250 g");
  assert.equal(girasol.have, false);
});

// En Listas (DisplayRow) la píldora también está, y no hace falta que el ítem esté pendiente
const click2 = async (re) => {
  [...dom2.window.document.querySelectorAll("button")].find((b) => re.test(b.textContent)).click();
  await new Promise((r) => setTimeout(r, 80));
};
await click2(/^📋Listas$/);
await click2(/Verdulería/);
await click2(/^Siempre en stock/);

test("p: 0 en la foto = sin referencia real: se borra el precio viejo (SKU fantasma) y queda solo el mayorista", () => {
  const fila = [...dom2.window.document.querySelectorAll(".fila-toque")].find((d) => /Cúrcuma/.test(d.textContent));
  assert.ok(fila, "no se ve Cúrcuma en Listas");
  assert.doesNotMatch(fila.textContent, /1\.799|COTO/);
  assert.match(fila.textContent, /Mercado Central \(mayorista\): \$ 4\.500\/kg/);
  const data = JSON.parse(dom2.window.localStorage.getItem("el-changuito-v1"));
  const curcuma = data.stores.find((s) => s.id === "verdu").sections.flatMap((sec) => sec.items).find((it) => it.name === "Cúrcuma");
  assert.equal(curcuma.price, 0);
  assert.equal(curcuma.priceV, "11/08/2026");
});

test("Listas: la píldora 'ver en DIA ↗' acompaña la nota de precio también en las listas", () => {
  const papa = [...dom2.window.document.querySelectorAll("a")].find((a) => a.textContent === "ver en DIA ↗");
  assert.ok(papa, "falta la píldora en Listas");
  assert.equal(papa.href, "https://diaonline.supermercadosdia.com.ar/papa-negra-x-kg-90170/p");
  assert.ok([...dom2.window.document.querySelectorAll("a")].find((a) => a.textContent === "ver en COTO ↗"), "el pick Fruta lleva la página de la opción más barata");
});

/* ---------- dom3: tope de filas en las tarjetas de precios (5 pendientes que bajaron, 4 que subieron) ---------- */
const dom3 = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "https://el-changuito.test/", pretendToBeVisual: true, runScripts: "outside-only" });
const nombres3 = ["A1", "A2", "A3", "A4", "A5", "S1", "S2", "S3", "S4"];
dom3.window.localStorage.setItem("el-changuito-v1", JSON.stringify({ stores: [{ id: "diet", name: "Dietética", emoji: "🌿", color: "#9A6A1F", note: "",
  sections: [{ id: "s", name: "Perecederos", items: nombres3.map((n) => ({ id: n, name: n, note: "", spec: "", have: false })) }] }] }));
dom3.window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ version: "11/08/2026", prices: Object.fromEntries(nombres3.map((n) => [n, { p: 1000, n: "x", d: n[0] === "A" ? -100 : 100 }])) }) });
const RealDate3 = dom3.window.Date;
dom3.window.Date = class extends RealDate3 { constructor(...a) { if (a.length) { super(...a); } else { super(2026, 7, 11, 12, 0, 0); } } static now() { return new RealDate3(2026, 7, 11, 12, 0, 0).getTime(); } };
dom3.window.eval(fs.readFileSync("app.js", "utf8"));
await esperarPintado(dom3.window);

test("Oportunidades: a la vista hasta 3 filas por lista y una píldora 'ver las N' para el resto", () => {
  const texto = dom3.window.document.body.textContent;
  assert.match(texto, /▼ Bajaron de precio · 5 que necesitás/);
  assert.match(texto, /⚠ Con sobreprecio · 4/);
  assert.match(texto, /ver las 5 ▾/);
  assert.match(texto, /ver las 4 ▾/);
  const enResumen = (n) => (texto.match(new RegExp(n + " · 🌿", "g")) || []).length;
  assert.equal(["A1", "A2", "A3"].every((n) => enResumen(n) === 1) && enResumen("A4") === 0 && enResumen("A5") === 0, true);
  assert.equal(enResumen("S4"), 0);
});

[...dom3.window.document.querySelectorAll("button")].find((b) => b.textContent === "ver las 5 ▾").click();
await new Promise((r) => setTimeout(r, 100));

test("Oportunidades: 'ver las N' despliega todas las filas y pasa a 'ver menos'", () => {
  const texto = dom3.window.document.body.textContent;
  assert.match(texto, /A5 · 🌿/);
  assert.match(texto, /ver menos ▴/);
  assert.match(texto, /ver las 4 ▾/); // la otra lista sigue plegada
});

/* ---------- dom4: pick con muchas opciones con precio (Fruta): compacto y desplegable a pedido ---------- */
const dom4 = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "https://el-changuito.test/", pretendToBeVisual: true, runScripts: "outside-only" });
const frutas4 = ["Ananá", "Banana", "Cereza", "Durazno", "Frutilla", "Kiwi", "Mandarina", "Manzana", "Naranja", "Pera", "Pomelo", "Uva"];
dom4.window.localStorage.setItem("el-changuito-v1", JSON.stringify({ stores: [{ id: "verdu", name: "Verdulería", emoji: "🥬", color: "#3E8914", note: "",
  sections: [{ id: "vd", name: "Algo de cada categoría", items: [{ id: "vf4", name: "Fruta", type: "pick", options: frutas4, picked: [], note: "", spec: "", have: false }] }] }] }));
dom4.window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ version: "11/08/2026",
  prices: { "Fruta": { p: 999, n: "la más barata hoy", s: "coto", u: "kg", op: Object.fromEntries(frutas4.map((f, i) => [f, { p: 1000 + i * 100, s: "coto", u: "kg" }])) } } }) });
dom4.window.eval(fs.readFileSync("app.js", "utf8"));
await esperarPintado(dom4.window);
const filas4 = () => dom4.window.document.querySelectorAll(".fila-toque").length;
const boton4 = (re) => [...dom4.window.document.querySelectorAll("button")].find((b) => re.test(b.textContent));

test("Pick con más de 10 opciones con precio: arranca compacto (8) con la píldora 'ver las 12'", () => {
  assert.equal(filas4(), 8);
  assert.ok(boton4(/^ver las 12 ▾$/), "falta la píldora para desplegar");
});
boton4(/^ver las 12 ▾$/).click();
await new Promise((r) => setTimeout(r, 100));
test("Pick: 'ver las 12' despliega todas las opciones y pasa a 'ver menos'", () => {
  assert.equal(filas4(), 12);
  assert.ok(boton4(/^ver menos ▴$/));
});
[...dom4.window.document.querySelectorAll(".fila-toque")].pop().click(); // elige una de las que estaban ocultas
await new Promise((r) => setTimeout(r, 80));
boton4(/^ver menos ▴$/).click();
await new Promise((r) => setTimeout(r, 100));
test("Pick: al compactar de nuevo, lo que elegiste sigue a la vista aunque esté fuera de las 8", () => {
  assert.equal(filas4(), 9);
  assert.ok(boton4(/^ver las 12 ▾$/));
  assert.match(boton4(/^Comprado/).textContent, /\(1\)/);
});

console.log(`\n${pasan} tests de app OK`);
