#!/usr/bin/env node
/* Tests del robot de precios (sin framework: node scripts/test-precios.mjs).
   Cubren parseQty, el lector de El Puente y el criterio de elegir()
   con listados simulados que copian el formato real de cada fuente. */

import assert from "node:assert/strict";
import {
  parseQty, elegir, ITEMS_ELPUENTE, parsearListadoElPuente,
  ITEMS_COTO, PARTES_CARNE, modaPrecios, paresDesdeCoto, porKgCoto, notaPorKg, comboCoto, asadoCoto,
} from "./actualizar-precios.mjs";

const item = (name) => ITEMS_ELPUENTE.find((i) => i.name === name);
const itemCoto = (name) => ITEMS_COTO.find((i) => i.name === name);
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
			<span class="float-left" style="font-weight:400;"><span>Cremoso El Puente. Valor por kg por horma (aprox. 4 kg)</span></span>
			<span class="float-right" style="font-weight:400;">$10.500,00            </span>
		</div>		<div class="block border-bottom">
			<span class="float-left" style="font-weight:400;"><span>Cremoso El Puente. Valor por kg fraccionado</span></span>
			<span class="float-right" style="font-weight:400;">$10.500,00            </span>
		</div>		<div class="block ">
			<span class="float-left" style="font-weight:400;"><span>Queso Provoleta El Puente x 190 g</span></span>
			<span class="float-right" style="font-weight:400;">$6.000,00            </span>
		</div></div>`;

test("parsearListadoElPuente: extrae pares nombre/precio del fragmento AJAX", () => {
  const pares = parsearListadoElPuente(FRAGMENTO);
  assert.equal(pares.length, 3);
  assert.deepEqual(pares[0], { nombre: "Cremoso El Puente. Valor por kg por horma (aprox. 4 kg)", precio: 10500, lista: 10500 });
  assert.equal(pares[2].precio, 6000);
});

/* ---------- Criterio de elegir() sobre el listado de El Puente ---------- */
const C = (nombre, precio) => ({ nombre, precio, lista: precio });

test("Solo marca El Puente: el D70 más barato queda afuera", () => {
  const el = elegir(item("Fundente"), [
    C("Cremoso D70. Valor por kg fraccionado", 8000),
    C("Cremoso El Puente. Valor por kg fraccionado", 10500),
  ]);
  assert.equal(el.p, Math.round(10500 * 0.8));
  assert.match(el.n, /El Puente/);
});

test("Fundente: 'por kg por horma (aprox. 4 kg)' NO se divide por 4 (es precio por kg)", () => {
  // Si se parseara "4 kg" como tamaño, la horma daría $2.625/kg y ganaría siempre
  const el = elegir(item("Fundente"), [
    C("Cremoso El Puente. Valor por kg por horma (aprox. 4 kg)", 10500),
    C("Cremoso ficticio El Puente por kg fraccionado", 9000),
  ]);
  assert.equal(el.p, Math.round(9000 * 0.8));
});

test("Fundente: compra de ~800 g, solo líneas fraccionado", () => {
  const el = elegir(item("Fundente"), [
    C("Cremoso El Puente. Valor por kg por horma (aprox. 4 kg)", 9000),
    C("Cremoso El Puente. Valor por kg fraccionado", 10500),
  ]);
  assert.equal(el.p, Math.round(10500 * 0.8));
  assert.match(el.n, /^800 g de /);
});

test("Pizza: solo mozzarella, aunque el cremoso hilado esté más barato", () => {
  const el = elegir(item("Pizza"), [
    C("Cremoso pizzero hilado El Puente. Valor por kg fraccionado", 15750),
    C("Mozzarella El Puente en cilindro por kg fraccionado", 15990),
  ]);
  assert.equal(el.p, Math.round(15990 * 0.4));
  assert.match(el.n, /Mozzarella/);
});

test("Queso para rayar: acepta la abreviatura 'fracc.'", () => {
  const el = elegir(item("Queso para rayar"), [
    C("Sardo El Puente por kg fracc.", 29100),
    C("Sardo El Puente por kg por horma (aprox. 3 kg)", 21900),
  ]);
  assert.equal(el.p, Math.round(29100 * 0.3));
});

test("Provoletta: piezas de 190 g → redondea a 2 para cubrir 300 g", () => {
  const el = elegir(item("Provoletta"), [C("Queso Provoleta El Puente x 190 g", 6000)]);
  assert.equal(el.p, 12000);
  assert.match(el.n, /^2× /);
});

test("Crema: gana el pote más barato POR LITRO (hoy el de 330 cc), no el más chico", () => {
  const el = elegir(item("Crema"), [
    C("Crema de leche El Puente. Pote x 220 cc", 2560), // $11.636/L
    C("Crema de leche El Puente. Pote x 330 cc", 3760), // $11.394/L ← gana
    C("Crema de leche El Puente. Balde por 4,5 kg", 43700),
    C("Queso Crema El Punte x 400 grs", 4300),
  ]);
  assert.equal(el.p, 2 * 3760);
  assert.match(el.n, /330 cc/);
  assert.match(el.n, /\/L$/);
});

test("Crema: si el de 220 cc vuelve a estar más barato por litro, gana el de 220", () => {
  const el = elegir(item("Crema"), [
    C("Crema de leche El Puente. Pote x 220 cc", 2400), // $10.909/L ← gana
    C("Crema de leche El Puente. Pote x 330 cc", 3760), // $11.394/L
  ]);
  assert.equal(el.p, 2 * 2400);
  assert.match(el.n, /220 cc/);
});

test("Leche: solo entera El Puente; ni descremada ni bricks de otra marca", () => {
  const el = elegir(item("Leche"), [
    C("Leche entera La Serenisima UAT 3% x 200 cc", 1500),
    C("Leche descremada El Puente. Sachet por 1 l", 1200),
    C("Leche entera El Puente. Sachet por 1 l", 1600),
  ]);
  assert.equal(el.p, 2 * 1600);
  assert.match(el.n, /entera El Puente/);
});

/* ---------- COTO ---------- */
test("parseQty: unidades de COTO 'Paq 1 Kgm' y '750 Grm'", () => {
  assert.deepEqual(parseQty("Harina Para Masa Madre Chacabuco Paq 1 Kgm"), { amount: 1, unit: "kg" });
  assert.deepEqual(parseQty("Harina Integral + Semillas Chacabuco Paq 750 Grm"), { amount: 0.75, unit: "kg" });
});

test("modaPrecios: gana el precio más repetido entre sucursales, no el outlier", () => {
  assert.equal(modaPrecios([1039, 1039, 9.19, 989, 1039]), 1039);
  assert.equal(modaPrecios([989, 1039]), 989); // empate → el más barato
  assert.equal(modaPrecios([]), null);
});

test("paresDesdeCoto: listPrice por sucursal con respaldo formatPrice; sin precio se descarta", () => {
  const pares = paresDesdeCoto({ response: { results: [
    { value: "Falda X KG", data: { price: [{ store: "220", listPrice: 7699 }, { store: "060", listPrice: 5549 }, { store: "065", listPrice: 7699 }] } },
    { value: "Marucha X KG", data: { price: [{ store: "220", listPrice: null, formatPrice: 10999 }] } },
    { value: "Sin precio X KG", data: { price: [] } },
  ] } });
  assert.deepEqual(pares, [
    { nombre: "Falda X KG", precio: 7699, lista: 7699 },
    { nombre: "Marucha X KG", precio: 10999, lista: 10999 },
  ]);
});

const HARINAS = [
  { nombre: "Harina De Trigo CHACABUCO 000 Paquete 1 Kg", precio: 1039, lista: 1039 },
  { nombre: "Harina De Trigo CHACABUCO 0000 Paquete 1 Kg", precio: 1369, lista: 1369 },
  { nombre: "Harina De Trigo CHACABUCO Leudante Paquete 1 Kg", precio: 1579, lista: 1579 },
  { nombre: "Harina Para Masa Madre Chacabuco Paq 1 Kgm", precio: 1999, lista: 1999 },
  { nombre: "Harina Trigo 00 Chacabuco 1kg", precio: 2649, lista: 2649 },
  { nombre: "Harina Integral Fina CHACABUCO Paq 1 Kgm", precio: 1699, lista: 1699 },
  { nombre: "Harina Integral + Semillas Chacabuco Paq 750 Grm", precio: 2129, lista: 2129 },
  { nombre: "Premezcla Blend Masa Madre Chacabuco 400g", precio: 3599, lista: 3599 },
];

test("Harinas: 000, 0000 y 00 no se pisan entre sí", () => {
  assert.match(elegir(itemCoto("Harina 000"), HARINAS).n, /CHACABUCO 000 /);
  assert.equal(elegir(itemCoto("Harina 000"), HARINAS).p, 1039);
  assert.match(elegir(itemCoto("Harina 0000"), HARINAS).n, /CHACABUCO 0000 /);
  assert.equal(elegir(itemCoto("Harina 0000"), HARINAS).p, 1369);
});

test("Harinas de fuerza: W300 = 'Masa Madre' y Napolitana = '00' (identificadas por foto)", () => {
  assert.match(elegir(itemCoto("Harina 000 de fuerza"), HARINAS).n, /Masa Madre/);
  assert.match(elegir(itemCoto("Harina 0000 de fuerza"), HARINAS).n, /Trigo 00 /);
});

test("Harina integral: rechaza la de semillas y elige la integral fina", () => {
  const el = elegir(itemCoto("Harina integral"), HARINAS);
  assert.match(el.n, /Integral Fina/);
});

test("Sémola: los fideos de sémola no cuentan", () => {
  const el = elegir(itemCoto("Sémola"), [
    { nombre: "Fid.Semola De Trig Spaghetti Arcor Paq 500 Grm", precio: 1485, lista: 1485 },
    { nombre: "Sémola De Trigo Pureza 500g", precio: 2030, lista: 2030 },
  ]);
  assert.equal(el.p, 2030);
  assert.match(el.n, /Pureza/);
});

test("Roast beef: el precio del ítem ES el precio por kilo, con nota limpia", () => {
  const corte = porKgCoto([
    { nombre: "Roast Beef Estancias Coto X KG", precio: 13299, lista: 13299 },
    { nombre: "Empanadas De Roast Beef X6 Empanadas Zen 600g", precio: 3875, lista: 3875 },
  ], PARTES_CARNE.roast);
  const el = notaPorKg(corte);
  assert.equal(el.p, 13299);
  assert.equal(el.n, "Roast Beef Estancias Coto · $13.299/kg");
});

test("porKgCoto: elige el corte más barato y filtra cerdo/lomo/envasados", () => {
  const cand = [
    { nombre: "Vacío Del Centro Estancias Coto X KG", precio: 17499, lista: 17499 },
    { nombre: "Vacio (peso Aproximado De La Unidad 440g) X KG", precio: 25599, lista: 25599 },
    { nombre: "Vacio De Cerdo X KG", precio: 8900, lista: 8900 },
    { nombre: "Lomo Al Vacio (peso Aproximado De La Unidad 1,430kg) X KG", precio: 31999, lista: 31999 },
    { nombre: "Vacio Al Spiedo Coto X Kg", precio: 40009, lista: 40009 },
  ];
  assert.equal(porKgCoto(cand, PARTES_CARNE.vacio).precio, 17499);
});

test("Combo de temporada: muestra el $/kg de cada corte y suma 1 kg de c/u", () => {
  const porParte = {
    falda: { nombre: "Falda X KG", precio: 7699 }, osobuco: { nombre: "Osobuco De Garron X KG", precio: 7899 },
    marucha: { nombre: "Marucha X KG", precio: 10999 }, aranita: { nombre: "Arañita X KG", precio: 17899 },
  };
  const inv = comboCoto(porParte, true);
  assert.equal(inv.p, 7699 + 7899);
  assert.equal(inv.n, "falda $7.699/kg + osobuco $7.899/kg · estimo 1 kg de c/u");
  const ver = comboCoto(porParte, false);
  assert.equal(ver.p, 10999 + 17899);
  assert.match(ver.n, /^marucha \$10\.999\/kg \+ arañita \$17\.899\/kg/);
  assert.equal(comboCoto({ falda: porParte.falda }, true), null); // falta un corte → sin precio
});

test("Asado: entre vacío y tapa gana el más barato, más la tira, todo en $/kg", () => {
  const el = asadoCoto({
    vacio: { nombre: "Vacío Del Centro Estancias Coto X KG", precio: 17499 },
    tapa: { nombre: "Tapa De Asado Especial X KG", precio: 13299 },
    tira: { nombre: "Asado Del Medio Estancias Coto X KG", precio: 12499 },
  });
  assert.equal(el.p, 13299 + 12499);
  assert.equal(el.n, "tapa de asado $13.299/kg + tira $12.499/kg · estimo 1 kg de c/u");
});

console.log(`\n${pasan} tests OK`);
