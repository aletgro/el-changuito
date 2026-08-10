#!/usr/bin/env node
/* Tests del robot de precios (sin framework: node scripts/test-precios.mjs).
   Cubren parseQty, el lector de El Puente y el criterio de elegir()
   con listados simulados que copian el formato real de cada fuente. */

import assert from "node:assert/strict";
import {
  parseQty, elegir, ITEMS_ELPUENTE, parsearListadoElPuente,
  ITEMS_COTO, PARTES_CARNE, modaPrecios, paresDesdeCoto, porKgCoto, notaPorKg, comboCoto, asadoCoto,
  ITEMS_DIETETICA, normalizarPeso, paresProductoFa, paresVariacionesFa, paresDesdeNewGarden,
  ITEMS_OTROS, paresDesdeTiendaNube, productoDePagina, ITEMS_FARMACITY, promoVtex,
} from "./actualizar-precios.mjs";

const item = (name) => ITEMS_ELPUENTE.find((i) => i.name === name);
const itemCoto = (name) => ITEMS_COTO.find((i) => i.name === name);
const itemDiet = (name) => ITEMS_DIETETICA.find((i) => i.name === name);
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

/* ---------- DIA: los dos casos que estaban siempre sin match ---------- */
import { ITEMS } from "./actualizar-precios.mjs";
const itemDia = (name) => ITEMS.find((i) => i.name === name);

test("Harina de maíz: matchea la Morixe para arepas (el nombre no dice maíz)", () => {
  const el = elegir(itemDia("Harina de maíz 1 kg"), [{ nombre: "Harina Morixe para Arepas 1 Kg.", precio: 3650, lista: 3650 }]);
  assert.equal(el.p, 3650);
  assert.match(el.n, /Arepas/);
});

test("Arvejas en lata: las 'Secas Remojadas' valen; las congeladas no", () => {
  const el = elegir(itemDia("Arvejas en lata"), [
    { nombre: "Arvejas Congeladas Dia 300 Gr.", precio: 500, lista: 500 },
    { nombre: "Arvejas Secas Remojadas Dia 300 Gr.", precio: 729, lista: 729 },
    { nombre: "Arvejas Secas Remojadas Dia 340 Gr.", precio: 820, lista: 820 },
  ]);
  assert.equal(el.p, 729);
  assert.match(el.n, /Secas Remojadas/);
});

/* ---------- Dietética (Frutos del Are) ---------- */
test("normalizarPeso: formatos de PESO de WooCommerce", () => {
  assert.equal(normalizarPeso("500GS"), "500 g");
  assert.equal(normalizarPeso("250 GR"), "250 g");
  assert.equal(normalizarPeso("1KG"), "1 kg");
  assert.equal(normalizarPeso("1k"), "1 kg");
});

test("paresVariacionesFa: junta el PESO del padre con el precio de la variación", () => {
  const padre = { name: "Comino Molido", variations: [
    { id: 45807, attributes: [{ name: "PESO", value: "500GS" }] },
    { id: 45806, attributes: [{ name: "PESO", value: "250GS" }] },
  ] };
  const variaciones = [
    { id: 45806, prices: { price: "3468", currency_minor_unit: 0 } },
    { id: 45807, prices: { price: "6426", currency_minor_unit: 0 } },
  ];
  assert.deepEqual(paresVariacionesFa(padre, variaciones), [
    { nombre: "Comino Molido 250 g", precio: 3468, lista: 3468 },
    { nombre: "Comino Molido 500 g", precio: 6426, lista: 6426 },
  ]);
});

test("paresProductoFa: producto simple con entidades HTML y sin precio", () => {
  assert.deepEqual(paresProductoFa({ name: "Or&#233;gano x 20 gr", prices: { price: "907", currency_minor_unit: 0 } }),
    [{ nombre: "Orégano x 20 gr", precio: 907, lista: 907 }]);
  assert.deepEqual(paresProductoFa({ name: "Sin precio", prices: { price: "0" } }), []);
});

test("cercano: gana el paquete de tamaño más parecido, no el kilo más barato por kg", () => {
  const el = elegir(itemDiet("Comino 100 g"), [
    { nombre: "Comino en grano 100 Gr", precio: 3300, lista: 3300 },   // $33.000/kg, tamaño exacto
    { nombre: "Comino en Grano x 1 kg", precio: 28050, lista: 28050 }, // $28.050/kg, más barato por kg
  ]);
  assert.equal(el.p, 3300);
  assert.match(el.n, /100 Gr/);
});

test("Comino y canela: en grano/en rama, nunca molidos", () => {
  assert.equal(elegir(itemDiet("Comino 100 g"), [{ nombre: "Comino Molido 100 g", precio: 2500, lista: 2500 }]), null);
  const canela = elegir(itemDiet("Canela 15 g"), [
    { nombre: "Canela molida 250 g", precio: 2973, lista: 2973 },
    { nombre: "Canela en Rama Partida 100 g", precio: 4700, lista: 4700 },
  ]);
  assert.equal(canela.p, Math.round(0.015 * 47000));
  assert.match(canela.n, /Rama/);
});

test("cercano: en la misma banda de tamaño sí gana el más barato por kg (bicarbonato)", () => {
  const el = elegir(itemDiet("Bicarbonato de sodio 200 g"), [
    { nombre: "Bicarbonato de Sodio x 50 gs", precio: 865, lista: 865 },      // ratio 4 → banda 2
    { nombre: "Bicarbonato De Sodio x 1KG", precio: 2648, lista: 2648 },      // ratio 5 → banda 2, $2.648/kg
  ]);
  assert.equal(el.p, Math.round(0.2 * 2648));
  assert.match(el.n, /1KG/);
});

test("cercano: si el tamaño coincide, la referencia es el precio exacto del paquete", () => {
  const el = elegir(itemDiet("Almendras 500 g"), [{ nombre: "Almendras Carmel Grande 500 g", precio: 14112, lista: 14112 }]);
  assert.equal(el.p, 14112);
});

test("mantener cantidades: Maní 2 kg = 2× la bolsa de 1 kg", () => {
  const el = elegir(itemDiet("Maní 2 kg"), [{ nombre: "Mani Repelado Crudo 1 kg", precio: 3698, lista: 3698 }]);
  assert.equal(el.p, 2 * 3698);
});

test("RECHAZO_DIET: frascos de especiero y marcas caras no cuentan como referencia", () => {
  const el = elegir(itemDiet("Canela 15 g"), [
    { nombre: "Canela En Rama En Especiero X 20Gr ( Castillo )", precio: 5241, lista: 5241 },
    { nombre: "Canela en Rama x 100 g", precio: 8600, lista: 8600 },
  ]);
  assert.match(el.n, /Canela en Rama x 100 g/);
  assert.equal(el.p, Math.round(0.015 * 86000));
});

test("Avena: ni bocaditos ni salvado; la referencia es la avena tradicional", () => {
  const el = elegir(itemDiet("Avena 500 g"), [
    { nombre: "Bocaditos De Avena (Granix) 500 g", precio: 5231, lista: 5231 },
    { nombre: "Salvado De Avena x 1KG", precio: 2637, lista: 2637 },
    { nombre: "Avena Tradicional x 1KG", precio: 2677, lista: 2677 },
  ]);
  assert.equal(el.p, Math.round(0.5 * 2677));
  assert.match(el.n, /Avena Tradicional/);
});

test("Té: ítem por unidad → precio del paquete tal cual", () => {
  const el = elegir(itemDiet("Té negro"), [{ nombre: "Té Negro Orgánico en Hebras x 80gr (Inti Zen)", precio: 4731, lista: 4731 }]);
  assert.equal(el.p, 4731);
});

/* ---------- New Garden (respaldo de la dietética) ---------- */
test("paresDesdeNewGarden: filtra sin stock y toma final/regular price", () => {
  const pares = paresDesdeNewGarden({ data: { products: { items: [
    { name: "Comino en grano 100 Gr", stock_status: "IN_STOCK", price_range: { minimum_price: { final_price: { value: 3300 }, regular_price: { value: 3500 } } } },
    { name: "Agotado", stock_status: "OUT_OF_STOCK", price_range: { minimum_price: { final_price: { value: 100 } } } },
  ] } } });
  assert.deepEqual(pares, [{ nombre: "Comino en grano 100 Gr", precio: 3300, lista: 3500 }]);
});

test("Pimienta negra: solo en grano, 50 g, aunque la molida esté más barata", () => {
  const el = elegir(itemDiet("Pimienta negra 50 g + 50 g"), [
    { nombre: "Pimienta Negra Molida 250 g", precio: 4437, lista: 4437 },
    { nombre: "Pimienta Negra En Grano 250 g", precio: 8060, lista: 8060 },
  ]);
  assert.equal(el.p, Math.round(0.05 * (8060 / 0.25)));
  assert.match(el.n, /Grano/);
});

test("Vainilla: la chaucha, nunca la esencia", () => {
  const el = elegir(itemDiet("Vainilla"), [
    { nombre: "Esencia De Vainilla x 1L", precio: 5030, lista: 5030 },
    { nombre: "Chaucha de Vainilla x 1 unidad", precio: 11500, lista: 11500 },
  ]);
  assert.equal(el.p, 11500);
  assert.match(el.n, /Chaucha/);
});

test("Piñones: referencia del paquete de 50 g, no el kilo", () => {
  const el = elegir(itemDiet("Piñones"), [
    { nombre: "Piñones x 1 kg", precio: 117000, lista: 117000 },
    { nombre: "Piñones 50g", precio: 6500, lista: 6500 },
  ]);
  assert.equal(el.p, 6500);
});

test("Salsa de pescado: se busca solo en New Garden y vale el precio de la botella", () => {
  const item = itemDiet("Salsa de pescado");
  assert.equal(item.fuente, "ng");
  const el = elegir(item, [
    { nombre: "Salsa de Pescado He Shun Yuan 150 ml", precio: 5600, lista: 5600 },
    { nombre: "Aceite De Pescado Con Omega 3 Natufarma x 60 Capsulas", precio: 26700, lista: 26700 },
  ]);
  assert.equal(el.p, 5600);
  assert.match(el.n, /He Shun Yuan/);
});

test("Laurel: 25 g de referencia desde el paquete de 100 g", () => {
  const el = elegir(itemDiet("Laurel 15 hojas"), [{ nombre: "Laurel en Hojas 100 gr", precio: 2800, lista: 2800 }]);
  assert.equal(el.p, 700);
});

/* ---------- Farmacity ---------- */
const itemFarma = (name) => ITEMS_FARMACITY.find((i) => i.name === name);

test("promoVtex: detecta 2x1, 3x2 y '2da unidad al X%' en los Teasers", () => {
  const teaser = (n) => ({ PromotionTeasers: [{ Name: n, Conditions: { MinimumQuantity: 2 } }] });
  assert.deepEqual(promoVtex(teaser("2x1 Tu Farmacity#01/08 - 24/08")), { factor: 0.5, txt: "2x1 llevando 2" });
  assert.deepEqual(promoVtex(teaser("3x2 Solo Web")), { factor: 2 / 3, txt: "3x2 llevando 3" });
  assert.deepEqual(promoVtex(teaser("70% en la 2da unidad")), { factor: 0.65, txt: "2da unidad -70% llevando 2" });
  // El formato viejo de VTEX ("<Name>k__BackingField") también cuenta
  assert.deepEqual(promoVtex({ Teasers: [{ "<Name>k__BackingField": "2x1#01/08 - 24/08" }] }), { factor: 0.5, txt: "2x1 llevando 2" });
});

test("promoVtex: los descuentos ya aplicados al precio (DiscountHighLight) no se duplican", () => {
  assert.equal(promoVtex({ DiscountHighLight: [{ "<Name>k__BackingField": "-50% Solo Web" }] }), null);
  assert.equal(promoVtex({}), null);
});

test("mejor precio con 2x1: el candidato promo gana si el efectivo por unidad es menor", () => {
  const el = elegir(itemFarma("Enjuague bucal"), [
    { nombre: "Enjuague Bucal Colgate Plax Menta Fresca x 500 ml", precio: 4566, lista: 7610 },              // $9.132/L
    { nombre: "Enjuague Bucal Farmacity Menthol x 250 ml · 2x1 llevando 2", precio: 2575, lista: 5150 },     // $10.300/L
    { nombre: "Enjuague Bucal Colgate Total Antisarro x 500 ml · 2x1 llevando 2", precio: 2342.5, lista: 9370 }, // $4.685/L ← gana
  ]);
  assert.equal(el.p, 2343);
  assert.match(el.n, /2x1 llevando 2/);
});

test("Alcohol: 96° para limpieza; el 70% ya diluido no cuenta aunque sea más barato", () => {
  const el = elegir(itemFarma("Alcohol"), [
    { nombre: "Alcohol Etílico Bialcohol Desinfectante 70% x 500 ml", precio: 3438, lista: 4912 },
    { nombre: "Alcohol Etílico Bialcohol 96% Uso Medicinal x 500ml", precio: 3684, lista: 4912 },
  ]);
  assert.equal(el.p, 3684);
  assert.match(el.n, /96%/);
});

test("Alcohol en gel: gana el más barato POR LITRO, ni el de bolsillo ni el kids", () => {
  const el = elegir(itemFarma("Alcohol en gel"), [
    { nombre: "Alcohol en Gel Farmacity Neutro x 65 ml", precio: 2160, lista: 2700 },                    // $33.230/L
    { nombre: "Alcohol en Gel Farmacity Kids Sandía x 25 g", precio: 3192, lista: 3990 },
    { nombre: "Alcohol en Gel Neutro Bialcohol con Válvula Dosificadora x 500ml", precio: 3819, lista: 5876 }, // $7.638/L ← gana
    { nombre: "Alcohol en Gel Farmacity Neutro Dosificador x 980 ml", precio: 8200, lista: 8200 },       // $8.367/L
  ]);
  assert.equal(el.p, 3819);
  assert.match(el.n, /Bialcohol/);
});

test("Desodorante: solo Old Spice en barra; aerosoles y shampoo afuera", () => {
  const el = elegir(itemFarma("Desodorante"), [
    { nombre: "Desodorante para Hombre AXE Gold Vainilla en Aerosol x 150 ml", precio: 4785, lista: 4785 },
    { nombre: "Shampoo Head & Shoulders Old Spice Para Hombres x 180 ml", precio: 5434, lista: 7763 },
    { nombre: "Desodorante Old Spice Fresh x 50 g", precio: 7238, lista: 10340 },
    { nombre: "Desodorante en Barra Old Spice Leña x 50 g", precio: 10340, lista: 10340 },
  ]);
  assert.equal(el.p, 7238);
  assert.match(el.n, /Old Spice Fresh/);
  assert.match(el.n, /oferta -30%/);
});

test("Máquina de afeitar: 3 filos al mejor precio POR UNIDAD (no el pack más chico)", () => {
  const el = elegir(itemFarma("Máquina de afeitar"), [
    { nombre: "Máquina de Afeitar Enjoy Mujer 3 Filos x 2 un", precio: 2625, lista: 5250 },       // $1.313/un
    { nombre: "Máquina de Afeitar Descartable Enjoy 3 Filos Mujer x 5 un", precio: 4025, lista: 8050 }, // $805/un ← gana
    { nombre: "Máquina de Afeitar para Mujer Gillette Venus Original con 3 Hojas", precio: 12075, lista: 17250 },
    { nombre: "Máquina de Afeitar Gillette del Cuerpo x 4 un", precio: 17288, lista: 17288 },     // sin "3 filos"
  ]);
  assert.equal(el.p, 4025);
  assert.match(el.n, /\$805\/un/);
});

test("Preservativos: Prime Mega ('Preservativo de Látex Mega'); los Skyn no", () => {
  const el = elegir(itemFarma("Preservativos"), [
    { nombre: "Preservativos Prime Skyn Extra Large x 3 un", precio: 6300, lista: 7875 },
    { nombre: "Preservativo de Látex Mega x 3 un", precio: 5874, lista: 5874 },
  ]);
  assert.equal(el.p, 5874);
  assert.match(el.n, /Mega/);
});

test("Enjuague bucal: gana el más barato POR LITRO aunque el total sea mayor", () => {
  const el = elegir(itemFarma("Enjuague bucal"), [
    { nombre: "Enjuague Bucal Listerine Whitening x 236 ml", precio: 6692, lista: 6692 },  // $28.356/L
    { nombre: "Enjuague Bucal Listerine Whitening x 473 ml", precio: 9739, lista: 9739 },  // $20.590/L ← gana
  ]);
  assert.equal(el.p, 9739);
  assert.match(el.n, /473 ml/);
});

test("parseQty: 'x 2 un x 50 m' del hilo dental = 100 m", () => {
  assert.deepEqual(parseQty("Hilo Dental Farmacity Sabor Menta x 2 un x 50 m"), { amount: 100, unit: "m" });
});

test("Pasta dental: normaliza por kg", () => {
  const el = elegir(itemFarma("Pasta dental"), [
    { nombre: "Pasta Dental Meraki x 50 g", precio: 4760, lista: 4760 },              // $95.200/kg
    { nombre: "Pasta Dental Colgate Ultra Blanco x 90 g", precio: 3315, lista: 3315 }, // $36.833/kg ← gana
  ]);
  assert.equal(el.p, 3315);
  assert.match(el.n, /\$36\.833\/kg/);
});

/* ---------- Otros lugares (Carmín / BonVino / Tienda Nova) ---------- */
test("paresDesdeTiendaNube: productos desde JSON-LD (ItemList y Product sueltos)", () => {
  const html = `<script type="application/ld+json">{"@type":"ItemList","itemListElement":[
    {"@type":"ListItem","item":{"@type":"Product","name":"MIX DE HONGOS IQF (500G) - BIOMAC","offers":{"price":7702.39}}},
    {"@type":"ListItem","item":{"@type":"Product","name":"Sin precio","offers":{}}}
  ]}</script>`;
  assert.deepEqual(paresDesdeTiendaNube(html), [{ nombre: "MIX DE HONGOS IQF (500G) - BIOMAC", precio: 7702.39, lista: 7702.39 }]);
});

test("productoDePagina: el producto principal sale del bloque de analytics", () => {
  const p = productoDePagina('x{"item_id":"1","item_name":"Aceto Balsamico Millan","price":6240,"item_category2":"x"}');
  assert.deepEqual(p, { nombre: "Aceto Balsamico Millan", precio: 6240, lista: 6240 });
});

test("Hongos para cocinar: el mix de 500 g le gana al champignon de 1 kg; medallones afuera", () => {
  const item = ITEMS_OTROS.find((i) => i.name === "Hongos para cocinar");
  const el = elegir(item, [
    { nombre: "MIX DE HONGOS IQF (500G) - BIOMAC", precio: 7702.39, lista: 7702.39 },
    { nombre: "CHAMPIGNON FILETEADO IQF (1kg) - CONOSUD", precio: 18562, lista: 18562 },
    { nombre: "MEDALLON DE QUINOA Y MIX DE HONGOS - NUTREE", precio: 5923, lista: 5923 },
  ]);
  assert.equal(el.p, 7702);
  assert.match(el.n, /MIX DE HONGOS/);
});

console.log(`\n${pasan} tests OK`);
