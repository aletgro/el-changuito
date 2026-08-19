#!/usr/bin/env node
/* Tests del robot de precios (sin framework: node scripts/test-precios.mjs).
   Cubren parseQty, el lector de El Puente y el criterio de elegir()
   con listados simulados que copian el formato real de cada fuente. */

import assert from "node:assert/strict";
import {
  parseQty, elegir, ITEMS_ELPUENTE, parsearListadoElPuente,
  ITEMS_COTO, PARTES_CARNE, modaPrecios, paresDesdeCoto, porKgCoto, notaPorKg, comboCoto, asadoCoto,
  ITEMS_DIETETICA, normalizarPeso, paresProductoFa, paresVariacionesFa, paresDesdeNewGarden,
  ITEMS_OTROS, paresDesdeTiendaNube, productoDePagina, ITEMS_FARMACITY, ITEMS_PESCE, promoVtex, conDelta, DESCUENTOS, opcionesElPuente,
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

test("Atún: solo entero al natural y al mejor precio POR LATA (el pack x3 cuenta)", () => {
  const el = elegir(itemDia("Atún"), [
    { nombre: "Alimento Humedo Para Gatos Sabor Atun Felix 85 Gr.", precio: 1450, lista: 1450 },
    { nombre: "Atún Desmenuzado Al Natural Dia 170 Gr.", precio: 1490, lista: 1490 },
    { nombre: "Lomitos de Atún en Aceite Dia 170 Gr.", precio: 2260, lista: 2260 },
    { nombre: "Lomitos de Atún al Natural Dia 170 Gr.", precio: 2260, lista: 2260 },
    { nombre: "Lomitos de Atún Al Natural Dia x 3 Ud.", precio: 3990, lista: 3990 }, // $1.330/lata ← gana
  ]);
  assert.equal(el.p, 3990);
  assert.match(el.n, /x 3 Ud\./);
  assert.match(el.n, /\$1\.330\/un/);
});

test("Vinagre de manzana 500 ml: una botella, el envase real", () => {
  const el = elegir(itemDia("Vinagre de manzana 500 ml"), [
    { nombre: "Vinagre de Manzana Dia 500 Ml.", precio: 2030, lista: 2030 },
    { nombre: "Vinagre de Manzana Menoyo 500 Ml.", precio: 2525, lista: 2525 },
  ]);
  assert.equal(el.p, 2030);
  assert.doesNotMatch(el.n, /^2×/);
});

test("Esponja salvauñas: solo las salvauñas", () => {
  const el = elegir(itemDia("Esponja salvauñas"), [
    { nombre: "Esponja Salvauñas Virulana 1 Ud.", precio: 480, lista: 480 },
    { nombre: "Esponja Salvauñas Dia 1 Ud.", precio: 1205, lista: 1205 },
  ]);
  assert.equal(el.p, 480);
});

test("Trapo rejilla: la Rejilla Pastelera de metal no es un trapo", () => {
  const el = elegir(itemDia("Trapo rejilla"), [
    { nombre: "Rejilla Pastelera x Un", precio: 480, lista: 480 },
    { nombre: "Trapo Rejilla Dia Multiuso Ecoamigable 1 Ud.", precio: 1460, lista: 1460 },
  ]);
  assert.equal(el.p, 1460);
  assert.match(el.n, /Trapo Rejilla/);
});

test("Marca preferida: si no gana por precio, la nota muestra la diferencia para decidir", () => {
  const el = elegir(itemDia("Yerba 1 kg"), [
    { nombre: "Yerba Mate Dia Elaborado Con Palo 1 Kg.", precio: 2891, lista: 2891 },
    { nombre: "Yerba Mate Playadito Suave 1 Kg.", precio: 3990, lista: 3990 },
    { nombre: "Yerba Mate Playadito Suave 500 Gr.", precio: 2835, lista: 2835 }, // 2× = $5.670, pierde contra el kilo
  ]);
  assert.equal(el.p, 2891);
  assert.match(el.n, /· Playadito \$3\.990 \(\+38%\)/);
});

test("Marca preferida: si la marca ES la más barata, no hay nota duplicada", () => {
  const el = elegir(itemDia("Agua mineral bidón"), [
    { nombre: "Bidón de Agua Sin Gas Glaciar 6,3 Lt.", precio: 3000, lista: 3000 },
    { nombre: "Agua Mineral Sin Gas Dia 6,25 Lt.", precio: 3600, lista: 3600 },
  ]);
  assert.equal(el.p, 3000);
  assert.doesNotMatch(el.n, /· Glaciar \$/);
});

test("Agua: las botellas compiten contra el bidón por litro cubierto", () => {
  const el = elegir(itemDia("Agua mineral bidón"), [
    { nombre: "Agua Mineral Sin Gas Dia 6,25 Lt.", precio: 3600, lista: 3600 },
    { nombre: "Agua Mineral Sin Gas Valle Del Sol 2 Lt.", precio: 850, lista: 850 }, // 3× = $2.550 ← gana
    { nombre: "Agua Mineral con Gas Glaciar 1,5 Lt.", precio: 2267, lista: 2267 },   // con gas: afuera
  ]);
  assert.equal(el.p, 3 * 850);
  assert.match(el.n, /^3× Agua Mineral Sin Gas Valle Del Sol/);
});

test("Grasa bovina: también cuenta si el envase dice 'vacuna'", () => {
  const el = elegir(itemDia("Grasa bovina 1 kg"), [
    { nombre: "Grasa Vacuna Dia 1 Kg.", precio: 7300, lista: 7300 },
    { nombre: "Grasa Bovina Dia 500 Gr.", precio: 3690, lista: 3690 }, // 2× = $7.380
    { nombre: "Bizcochos de grasa 9 de Oro Clásico 200 Gr.", precio: 1389, lista: 1389 },
  ]);
  assert.equal(el.p, 7300);
  assert.match(el.n, /Vacuna/);
});

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

/* ---------- Descuentos adicionales por comercio ---------- */
test("DESCUENTOS: config editable con forma válida (días reales, % / tope / exclusiones)", () => {
  const validos = ["domingo", "lunes", "martes", "miercoles", "miércoles", "jueves", "viernes", "sabado", "sábado"];
  const tiendas = ["dia", "coto", "farma", "puente", "diet", "otros"];
  for (const [tienda, cfg] of Object.entries(DESCUENTOS)) {
    assert.ok(tiendas.includes(tienda), `id de comercio desconocido: ${tienda}`);
    const promos = Array.isArray(cfg) ? cfg : cfg.promos;
    assert.ok(Array.isArray(promos) && promos.length > 0, tienda);
    for (const d of promos) {
      const dias = d.dias || (d.dia ? [d.dia] : []);
      assert.ok(dias.length > 0, `promo sin días en ${tienda}`);
      for (const dd of dias) assert.ok(validos.includes(String(dd).toLowerCase()), `día raro: ${dd}`);
      assert.ok(d.pct >= 1 && d.pct <= 99, `porcentaje raro: ${d.pct}`);
      if (d.tope !== undefined) assert.ok(d.tope > 0, `tope raro: ${d.tope}`);
    }
    if (!Array.isArray(cfg) && cfg.sin) {
      for (const nombre of [...(cfg.sin.secciones || []), ...(cfg.sin.items || [])]) {
        assert.ok(typeof nombre === "string" && nombre.length > 1, `exclusión rara: ${nombre}`);
      }
    }
  }
});

test("DESCUENTOS: El Puente es lun a vie -20% con tope de $6.000", () => {
  const [dto] = DESCUENTOS.puente;
  assert.equal(dto.dias.length, 5);
  assert.equal(dto.pct, 20);
  assert.equal(dto.tope, 6000);
});

test("opcionesElPuente: precio de CADA queso del pick, con los nombres de la app", () => {
  const cand = [
    { nombre: "Sardo El Puente por kg fraccionado", precio: 29100, lista: 29100 },
    { nombre: "Sardo D70 por kg fracc.", precio: 22400, lista: 22400 },              // otra marca: afuera
    { nombre: "Reggianito El Puente por kg fraccionado", precio: 29400, lista: 29400 },
    { nombre: "Romanito El Puente x kg fraccionado", precio: 29300, lista: 29300 },  // "Romano" en la app
    { nombre: "Provolone El Puente por kg fraccionado", precio: 29590, lista: 29590 },
    { nombre: "Provolone El Puente por kg por horma (aprox. 4,5 kg)", precio: 23700, lista: 23700 }, // horma: afuera
  ];
  const ops = opcionesElPuente(ITEMS_ELPUENTE.find((i) => i.name === "Queso para rayar"), cand);
  assert.deepEqual(ops, {
    "Sardo": Math.round(0.3 * 29100),
    "Reggianito": Math.round(0.3 * 29400),
    "Romano": Math.round(0.3 * 29300),
    "Provolone": Math.round(0.3 * 29590),
  });
});

test("DESCUENTOS: COTO es mar/mié/jue/vie, sin carnicería ni harinas comunes", () => {
  const porDia = Object.fromEntries(DESCUENTOS.coto.promos.map((d) => [d.dia, d.pct]));
  assert.deepEqual(porDia, { martes: 20, "miércoles": 15, jueves: 30, viernes: 25 });
  assert.deepEqual(DESCUENTOS.coto.sin, { secciones: ["Carnicería"], items: ["Harina 000", "Harina 0000"] });
});

/* ---------- Variación diaria (campo d) ---------- */
test("conDelta: fecha cada variación y la conserva mientras el precio no cambie", () => {
  const HOY = "12/08/2026";
  assert.deepEqual(conDelta({ p: 900, n: "x" }, { p: 1000, n: "x" }, HOY), { p: 900, n: "x", d: -100, dv: HOY }); // bajó hoy
  assert.deepEqual(conDelta({ p: 1200, n: "x" }, { p: 1000, n: "x" }, HOY), { p: 1200, n: "x", d: 200, dv: HOY }); // subió hoy
  // mismo precio: conserva la variación anterior con su fecha (correr el robot 2 veces ya no la pisa)
  assert.deepEqual(conDelta({ p: 1000, n: "x" }, { p: 1000, n: "x", d: -50, dv: "10/08/2026" }, HOY), { p: 1000, n: "x", d: -50, dv: "10/08/2026" });
  // entrada vieja sin fecha: hereda la variación fechándola hoy
  assert.deepEqual(conDelta({ p: 1000, n: "x" }, { p: 1000, n: "x", d: 30 }, HOY), { p: 1000, n: "x", d: 30, dv: HOY });
  assert.deepEqual(conDelta({ p: 1000, n: "x" }, undefined, HOY), { p: 1000, n: "x" }); // ítem nuevo
  assert.equal(conDelta(null, { p: 1000 }, HOY), null);
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

/* ---------- Frigorífico Pesce (TiendaNube) ---------- */
const itemPesce = (name) => ITEMS_PESCE.find((i) => i.name === name);

test("parseQty: 'x kilo' sin dígito es 1 kg; '1.5 kilos' también parsea", () => {
  assert.deepEqual(parseQty("MEJILLÓN PELADO x kilo"), { amount: 1, unit: "kg" });
  assert.deepEqual(parseQty("SALMÓN AHUMADO REBANADO x 1.5 kilos"), { amount: 1.5, unit: "kg" });
});

test("paresDesdeTiendaNube: lo agotado queda afuera, salvo que se pida como referencia", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "ItemList",
    itemListElement: [
      { item: { "@type": "Product", name: "LANGOSTINO PELADO CRUDO x kilo", offers: { price: 30200, availability: "https://schema.org/InStock" } } },
      { item: { "@type": "Product", name: "SALMÓN CONGELADO PORCIONADO X 1 KG", offers: { price: 32000, availability: "https://schema.org/OutOfStock" } } },
    ],
  })}</script>`;
  assert.deepEqual(paresDesdeTiendaNube(html), [{ nombre: "LANGOSTINO PELADO CRUDO x kilo", precio: 30200, lista: 30200 }]);
  assert.equal(paresDesdeTiendaNube(html, true).length, 2); // con agotados, para la referencia SIN STOCK
});

test("Langostinos: el más barato POR KILO sin importar tamaño (la caja de 2 kg gana)", () => {
  const el = elegir(itemPesce("Langostinos"), [
    { nombre: "WOK DE LANGOSTINOS X 500 GR", precio: 24500, lista: 24500 },
    { nombre: "LANGOSTINOS EMPANADOS x 1 kg.", precio: 52800, lista: 52800 },
    { nombre: "LANGOSTINO ENTERO CRUDO NACIONAL x 1 kg.", precio: 24500, lista: 24500 }, // $24.500/kg
    { nombre: "LANGOSTINO ENTERO ECUADOR CAJA x 2 kg.", precio: 26400, lista: 26400 },   // $13.200/kg ← gana
  ]);
  assert.equal(el.p, 26400);
  assert.match(el.n, /CAJA x 2 kg/);
  assert.match(el.n, /\$13\.200\/kg/);
});

test("Mejillones: SOLO pelados, aunque el entero esté más barato", () => {
  const el = elegir(itemPesce("Mejillones"), [
    { nombre: "MEJILLÓN PELADO x kilo", precio: 15300, lista: 15300 },
    { nombre: "MEJILLÓN ENTERO ENVASADOS EN SU JUGO x kilo", precio: 10900, lista: 10900 },
  ]);
  assert.equal(el.p, 15300);
  assert.match(el.n, /PELADO/);
});

test("Salmón: el mejor $/kg aunque sea el combo de 4 kg; ahumado/pasta/blanco afuera", () => {
  const el = elegir(itemPesce("Salmón"), [
    { nombre: "PASTA DE SALMÓN ROSADO PARA RELLENO x kilo", precio: 13200, lista: 13200 },
    { nombre: "SALMÓN REBANADO SABOR AHUMADO x 200grs.", precio: 12700, lista: 12700 },
    { nombre: "SALMÓN CONGELADO PORCIONADO X 1 KG", precio: 32000, lista: 32000 },  // $32.000/kg
    { nombre: "COMBO DE SALMON ROSADO X 2KG", precio: 59000, lista: 59000 },        // $29.500/kg
    { nombre: "COMBO DE SALMON ROSADO X 4KG", precio: 104000, lista: 104000 },      // $26.000/kg ← gana
  ]);
  assert.equal(el.p, 104000);
  assert.match(el.n, /X 4KG/);
  assert.match(el.n, /\$26\.000\/kg/);
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
