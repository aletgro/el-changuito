#!/usr/bin/env node
/* Smoke test de la app (node scripts/test-app.mjs, corre tras `npm run build`).
   Patrón del proyecto: jsdom + localStorage sembrado con datos viejos +
   eval de app.js + asserts sobre el DOM. Verifica la migración v6 (Piñones)
   sin pisar los datos guardados del usuario. */

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
            { id: "i2", name: "Huevo", note: "", spec: "", have: true, price: 4200, priceNote: "cargado a mano", priceV: "manual@01/08/2026" },
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

test("el precio manual de Huevo se conserva", () => {
  const data = JSON.parse(dom.window.localStorage.getItem("el-changuito-v1"));
  const huevo = data.stores.find((s) => s.id === "diet").sections[0].items.find((it) => it.name === "Huevo");
  assert.equal(huevo.price, 4200);
  assert.equal(huevo.priceV, "manual@01/08/2026");
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

console.log(`\n${pasan} tests de app OK`);
