#!/usr/bin/env node
/* Tests del robot de precios (sin framework: node scripts/test-precios.mjs).
   Cubren parseQty, el lector de El Puente y el criterio de elegir()
   con listados simulados que copian el formato real de cada fuente. */

import assert from "node:assert/strict";
import { parseQty, elegir, ITEMS_ELPUENTE, parsearListadoElPuente } from "./actualizar-precios.mjs";

const item = (name) => ITEMS_ELPUENTE.find((i) => i.name === name);
let pasan = 0;
const test = (nombre, fn) => { fn(); pasan++; console.log("✔ " + nombre); };

/* ---------- parseQty ---------- */
test("parseQty: 'x 190 g' es tamaño, no multiplicador", () => {
  assert.deepEqual(parseQty("Queso Provoleta El Puente x 190 g"), { amount: 0.19, unit: "kg" });
});
test("parseQty: 'x 220 cc' es tamaño en litros", () => {
  assert.deepEqual(parseQty("Crema de leche El Puente. Pote x 220 cc"), { amount: 0.22, unit: "l" });
});
test("parseQty: pack 'N x tamaño' multiplica", () => {
  assert.deepEqual(parseQty("Papel Higiénico 4 x 30 Mts"), { amount: 120, unit: "m" });
});
test("parseQty: 'x 3' sin unidad sigue siendo multiplicador", () => {
  assert.deepEqual(parseQty("Esponja multiuso x 3"), { amount: 3, unit: "un" });
});

/* ---------- Lector de El Puente (formato real del endpoint /productos/get/N) ---------- */
const FRAGMENTO = `
<div class="col-sm-6 col-md-6">		<div class="block ">
			<span class="float-left" style="font-weight:400;"><span>Cremoso D70. Valor por kg por horma (aprox. 4 kg)</span></span>
			<span class="float-right" style="font-weight:400;">$9.990,00            </span>
		</div>		<div class="block border-bottom">
			<span class="float-left" style="font-weight:400;"><span>Cremoso D70. Valor por kg fraccionado</span></span>
			<span class="float-right" style="font-weight:400;">$9.990,00            </span>
		</div>		<div class="block ">
			<span class="float-left" style="font-weight:400;"><span>Queso Provoleta El Puente x 190 g</span></span>
			<span class="float-right" style="font-weight:400;">$6.000,00            </span>
		</div></div>`;

test("parsearListadoElPuente: extrae pares nombre/precio del fragmento AJAX", () => {
  const pares = parsearListadoElPuente(FRAGMENTO);
  assert.equal(pares.length, 3);
  assert.deepEqual(pares[0], { nombre: "Cremoso D70. Valor por kg por horma (aprox. 4 kg)", precio: 9990, lista: 9990 });
  assert.equal(pares[2].precio, 6000);
});

/* ---------- Criterio de elegir() sobre el listado de El Puente ---------- */
const C = (nombre, precio) => ({ nombre, precio, lista: precio });

test("Fundente: 'por kg por horma (aprox. 4 kg)' NO se divide por 4 (es precio por kg)", () => {
  // Si se parseara "4 kg" como tamaño, la horma daría $2.497/kg y ganaría a $8.000/kg
  const el = elegir(item("Fundente"), [
    C("Cremoso El Puente. Valor por kg por horma (aprox. 4 kg)", 9990),
    C("Cremoso barato ficticio por kg fraccionado", 8000),
  ]);
  assert.equal(el.p, Math.round(8000 * 0.6));
});

test("Fundente: solo líneas fraccionado; horma más barata queda afuera", () => {
  const el = elegir(item("Fundente"), [
    C("Cremoso D70. Valor por kg por horma (aprox. 4 kg)", 9000),
    C("Cremoso D70. Valor por kg fraccionado", 9990),
  ]);
  assert.equal(el.p, Math.round(9990 * 0.6));
  assert.match(el.n, /fraccionado/);
});

test("Queso para rayar: acepta la abreviatura 'fracc.'", () => {
  const el = elegir(item("Queso para rayar"), [
    C("Sardo D70 por kg fracc.", 22400),
    C("Sardo El Puente por kg por horma (aprox. 3 kg)", 21900),
  ]);
  assert.equal(el.p, Math.round(22400 * 0.3));
});

test("Provoletta: piezas de 190 g → redondea a 2 para cubrir 300 g", () => {
  const el = elegir(item("Provoletta"), [C("Queso Provoleta El Puente x 190 g", 6000)]);
  assert.equal(el.p, 12000);
  assert.match(el.n, /^2× /);
});

test("Crema: 2 potes de 220 cc le ganan al pote grande y al balde", () => {
  const el = elegir(item("Crema"), [
    C("Crema de leche El Puente. Pote x 220 cc", 2560),
    C("Crema de leche El Puente. Pote x 330 cc", 3760),
    C("Crema de leche El Puente. Balde por 4,5 kg", 43700),
    C("Queso Crema El Punte x 400 grs", 4300),
  ]);
  assert.equal(el.p, 2 * 2560);
  assert.match(el.n, /220 cc/);
});

test("Leche: sachet de 1 L; el brick de 200 cc queda fuera de la ventana de tamaño", () => {
  const el = elegir(item("Leche"), [
    C("Leche entera La Serenisima UAT 3% x 200 cc", 1500),
    C("Leche entera El Puente. Sachet por 1 l", 1600),
    C("Leche descremada El Puente. Sachet por 1 l", 1200),
  ]);
  assert.equal(el.p, 2 * 1600);
  assert.match(el.n, /entera/);
});

console.log(`\n${pasan} tests OK`);
