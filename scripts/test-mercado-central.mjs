#!/usr/bin/env node
/* Tests del lector de precios mayoristas del Mercado Central (sin framework:
   node scripts/test-mercado-central.mjs). Arma ZIPs y planillas BIFF2
   sintéticas con el mismo formato que publica el Mercado y verifica la
   detección de mes/rubro por nombre de archivo, el lector de ZIP (deflate,
   stored y anidado), el lector de Excel 2.x (incluida la Ñ en DOS), la tabla
   con fecha y el resumen del mes. */

import assert from "node:assert/strict";
import zlib from "node:zlib";
import {
  mesDeNombre, rubroDeNombre, linksMayoristas, leerZip, leerBiff2, fechaDeCodigo,
  tablaDesdeGrilla, rubroDeArchivo, armarMes, csvDelMes, lecturasDeZip,
} from "./mercado-central.mjs";

let pasan = 0;
const test = (nombre, fn) => { fn(); pasan++; console.log("✔ " + nombre); };

/* ---------- Constructores sintéticos ---------- */
function zipDePrueba(entradas, metodo = 8) {
  const partes = [], centrales = [];
  let off = 0;
  for (const { nombre, datos } of entradas) {
    const comp = metodo === 8 ? zlib.deflateRawSync(datos) : datos;
    const n = Buffer.from(nombre, "latin1");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(datos.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(metodo, 10);
    central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(datos.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(off, 42);
    partes.push(local, n, comp); centrales.push(central, n);
    off += local.length + n.length + comp.length;
  }
  const cd = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entradas.length, 8); fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(off, 16);
  return Buffer.concat([...partes, cd, fin]);
}

const rec = (tipo, cuerpo) => { const h = Buffer.alloc(4); h.writeUInt16LE(tipo, 0); h.writeUInt16LE(cuerpo.length, 2); return Buffer.concat([h, cuerpo]); };
const label = (fila, col, texto) => {
  const t = Buffer.isBuffer(texto) ? texto : Buffer.from(texto, "latin1");
  const b = Buffer.alloc(8); b.writeUInt16LE(fila, 0); b.writeUInt16LE(col, 2); b[7] = t.length;
  return rec(0x0004, Buffer.concat([b, t]));
};
const number = (fila, col, n) => { const b = Buffer.alloc(15); b.writeUInt16LE(fila, 0); b.writeUInt16LE(col, 2); b.writeDoubleLE(n, 7); return rec(0x0003, b); };
const entero = (fila, col, n) => { const b = Buffer.alloc(9); b.writeUInt16LE(fila, 0); b.writeUInt16LE(col, 2); b.writeUInt16LE(n, 7); return rec(0x0002, b); };
const BOF = rec(0x0009, Buffer.from([0x00, 0x02, 0x10, 0x00]));
const EOF_ = rec(0x000a, Buffer.alloc(0));
const COLWIDTH = rec(0x0024, Buffer.from([0, 0, 0, 0])); // registro que el lector debe ignorar

const CABECERA = ["ESP", "VAR", "PROC", "ENV", "KG", "CAL", "TAM", "GRADO", "MA040926", "MO040926", "MI040926", "MAPK", "MOPK", "MIPK"];
/* Planilla con el formato real: cabecera + líneas + fila Prom.Esp. por especie.
   Cada fila: [textos…8, números…6]. */
function planilla(cabecera, filas) {
  const regs = [BOF, COLWIDTH];
  cabecera.forEach((c, i) => regs.push(label(0, i, c)));
  filas.forEach((f, r) => f.forEach((v, c) => {
    if (v == null) return;
    regs.push(typeof v === "number" ? number(r + 1, c, v) : label(r + 1, c, v));
  }));
  regs.push(EOF_);
  return Buffer.concat(regs);
}
const PINIA = Buffer.from([0x50, 0x49, 0xa5, 0x41]); // "PIÑA" en codificación DOS (Ñ = 0xA5)
const FRUTAS_0409 = planilla(CABECERA, [
  ["ANANA", PINIA, "BRASIL", "CA", 18, "EL", "010/012", "", 35000, 34000, 33000, 1944.44, 1888.89, 1833.33],
  ["ANANA", "Prom.Esp.", "", "", 0, "", "", "", 0, 34000, 0, 0, 1888.89, 0],
  ["BANANA", "CAVENDISH", "ECUADOR", "CA", 20, "EL", "GRANDE", "", 44000, 42000, 40000, 2200, 2100, 2000],
  ["BANANA", "NANIKA", "SALTA", "PE", 22, "CL", "MEDIANO", "", 19000, 18000, 16000, 863.64, 818.18, 727.27],
  ["BANANA", "Prom.Esp.", "", "", 0, "", "", "", 0, 30000, 0, 0, 1459.09, 0],
  ["KUMQUAT", "", "E. RIOS", "BO", 1, "EL", "GRANEL", "", 3000, 2700, 2500, 3000, 2700, 2500], // sin fila Prom.Esp.
]);

/* ---------- Nombres de archivo de la página (los reales, con sus errores de tipeo) ---------- */
test("mesDeNombre: entiende todos los nombres reales de 2026", () => {
  const casos = {
    "FRUTAS%20%20ENERO-26_0.zip": "2026-01", "HORTALIZAS%20ENERO-26_0.zip": "2026-01",
    "FRUTAS_FEBRERO-26_0.zip": "2026-02", "HORTALIZAS_FEBRERO-26.zip": "2026-02",
    "FRUTAS_MARZO-2026.zip": "2026-03", "HORTALIZAS_MARZO-2026_0.zip": "2026-03",
    "FRUTAS_ABRIL2026_0.zip": "2026-04", "HORTALIZAS_ABRIL2026.zip": "2026-04",
    "FRUTAS-MAYO-2026.zip": "2026-05", "HORTALIZAS-MAYO-2026.zip": "2026-05",
    "FRUTA_JUNIO_2026_0.zip": "2026-06", "HORTALIZA-JUNIO-2026.zip": "2026-06",
    "FRUTAS_JULIO_26.zip": "2026-07", "HORTALIZA_JULIO_26_1.zip": "2026-07",
    "FRUTRAS_AGOSTO-26_0.zip": "2026-08", "HORTALIZA_%20AGOSTO_26.zip": "2026-08",
    "FRUTAS_SEPTIEMBRE_26.zip": "2026-09", "HORTALIZA_SEPTIENBRE_26_0.zip": "2026-09", "HORTALIZA_SPTIEMBRE_26.zip": "2026-09",
    "FRUTAS_OCTUBRE_26.zip": "2026-10", "HORTALIZAS_NOVIEMBRE-2026.zip": "2026-11", "FRUTAS_DICIEMBRE_26.zip": "2026-12",
  };
  for (const [nombre, mes] of Object.entries(casos)) assert.equal(mesDeNombre(nombre), mes, nombre);
  assert.equal(mesDeNombre("FRUTAS.zip"), null);
  assert.equal(mesDeNombre("HORTALIZAS_2026.zip"), null);
});
test("rubroDeNombre: FRUT*/HORT* con o sin S, con typo", () => {
  assert.equal(rubroDeNombre("FRUTRAS_AGOSTO-26_0.zip"), "frutas");
  assert.equal(rubroDeNombre("HORTALIZA_JULIO_26_1.zip"), "hortalizas");
  assert.equal(rubroDeNombre("OTRACOSA.zip"), null);
});
test("linksMayoristas: resuelve URLs, decodifica &amp; y no repite", () => {
  const html = `<a href="https://mercadocentral.gob.ar/sites/default/files/precios_mayoristas/FRUTAS_SEPTIEMBRE_26.zip">x</a>
    <a href="/sites/default/files/precios_mayoristas/HORTALIZA_%20AGOSTO_26.zip?a=1&amp;b=2">y</a>
    <a href="https://mercadocentral.gob.ar/sites/default/files/precios_mayoristas/FRUTAS_SEPTIEMBRE_26.zip">repetido</a>`;
  const links = linksMayoristas(html);
  assert.equal(links.length, 2);
  assert.deepEqual(links[0], { url: "https://mercadocentral.gob.ar/sites/default/files/precios_mayoristas/FRUTAS_SEPTIEMBRE_26.zip", nombre: "FRUTAS_SEPTIEMBRE_26.zip", rubro: "frutas", mes: "2026-09" });
  assert.equal(links[1].url, "https://mercadocentral.gob.ar/sites/default/files/precios_mayoristas/HORTALIZA_%20AGOSTO_26.zip?a=1&b=2");
  assert.equal(links[1].mes, "2026-08");
});

/* ---------- ZIP ---------- */
test("leerZip: deflate, stored, carpeta ignorada y ZIP anidado", () => {
  const interno = zipDePrueba([{ nombre: "RH010926.XLS", datos: Buffer.from("adentro") }], 0);
  const zip = zipDePrueba([
    { nombre: "RF010926.XLS", datos: Buffer.from("hola ".repeat(50)) },
    { nombre: "carpeta/", datos: Buffer.alloc(0) },
    { nombre: "HORTALIZA_SPTIEMBRE_26.zip", datos: interno },
  ]);
  const e = leerZip(zip);
  assert.deepEqual(e.map((x) => x.nombre), ["RF010926.XLS", "HORTALIZA_SPTIEMBRE_26.zip/RH010926.XLS"]);
  assert.equal(e[0].datos.toString(), "hola ".repeat(50));
  assert.equal(e[1].datos.toString(), "adentro");
  assert.throws(() => leerZip(Buffer.from("no soy un zip")), /directorio central/);
});

/* ---------- BIFF2 ---------- */
test("leerBiff2: grilla con LABEL, NUMBER, INTEGER; ignora otros registros; Ñ en DOS y Latin-1", () => {
  const buf = Buffer.concat([BOF, COLWIDTH, label(0, 0, "ESP"), number(1, 4, 18.5), entero(1, 5, 7), label(2, 1, PINIA),
    label(3, 1, Buffer.from([0x4a, 0x41, 0xf1, 0x4f])), EOF_, label(9, 9, "después del EOF")]);
  const g = leerBiff2(buf);
  assert.equal(g[0][0], "ESP");
  assert.equal(g[1][4], 18.5);
  assert.equal(g[1][5], 7);
  assert.equal(g[2][1], "PIÑA");
  assert.equal(g[3][1], "JAÑO");
  assert.equal(g[9], undefined);
});
test("leerBiff2: avisa claro si la planilla dejó de ser Excel 2.x", () => {
  assert.throws(() => leerBiff2(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])), /Excel moderno/);
  assert.throws(() => leerBiff2(Buffer.from("PK")), /BOF/);
});

/* ---------- Tabla ---------- */
test("fechaDeCodigo: ddmmaa → AAAA-MM-DD", () => {
  assert.equal(fechaDeCodigo("040926"), "2026-09-04");
  assert.equal(fechaDeCodigo("MO040926"), null);
});
test("tablaDesdeGrilla: fecha de la cabecera, filas con nombre, Prom.Esp. marcado", () => {
  const { fecha, filas } = tablaDesdeGrilla(leerBiff2(FRUTAS_0409), "RF040926.XLS");
  assert.equal(fecha, "2026-09-04");
  assert.equal(filas.length, 6);
  assert.deepEqual(filas[0], {
    especie: "ANANA", variedad: "PIÑA", procedencia: "BRASIL", envase: "CA", kg: 18, calidad: "EL", tamano: "010/012", grado: "", promedio: false,
    bulto: { max: 35000, moda: 34000, min: 33000 }, kilo: { max: 1944.44, moda: 1888.89, min: 1833.33 },
  });
  assert.equal(filas[1].promedio, true);
  assert.equal(filas[1].kilo.moda, 1888.89);
});
test("tablaDesdeGrilla: si la cabecera no trae fecha, la saca del nombre del archivo", () => {
  const cab = CABECERA.map((c) => (c === "MO040926" ? "MO" : c));
  const { fecha } = tablaDesdeGrilla(leerBiff2(planilla(cab, [["PAPA", "", "BS. AS.", "BO", 20, "1A", "", "", 20000, 19000, 18000, 1000, 950, 900]])), "x/RH150926.XLS");
  assert.equal(fecha, "2026-09-15");
  assert.throws(() => tablaDesdeGrilla([["hola"]], "RH010926.XLS"), /cabecera/);
});
test("rubroDeArchivo: RF = frutas, RH = hortalizas (también dentro de un ZIP anidado)", () => {
  assert.equal(rubroDeArchivo("RF040926.XLS"), "frutas");
  assert.equal(rubroDeArchivo("HORTALIZA_SPTIEMBRE_26.zip/RH010926.XLS"), "hortalizas");
  assert.equal(rubroDeArchivo("otro.xls"), null);
});

/* ---------- Resumen del mes ---------- */
const dia = (rubro, fecha, filas) => ({ rubro, fecha, filas });
const linea = (especie, variedad, procedencia, moda, promedio = false) => ({
  especie, variedad, procedencia, envase: "CA", kg: 20, calidad: "EL", tamano: "", grado: "", promedio,
  bulto: { max: null, moda: null, min: null }, kilo: { max: moda + 100, moda, min: moda - 100 },
});
test("armarMes: $/kg de la especie por día desde Prom.Esp., promedio del mes y líneas unidas entre días", () => {
  const r = armarMes([
    dia("frutas", "2026-09-02", [linea("BANANA", "CAVENDISH", "ECUADOR", 2000), linea("BANANA", "Prom.Esp.", "", 1500, true)]),
    dia("frutas", "2026-09-01", [linea("BANANA", "CAVENDISH", "ECUADOR", 2200), linea("BANANA", "NANIKA", "SALTA", 800), linea("BANANA", "Prom.Esp.", "", 1700, true)]),
    dia("hortalizas", "2026-09-01", [linea("PAPA", "", "BS. AS.", 950), linea("PAPA", "Prom.Esp.", "", 950, true)]),
  ]);
  assert.deepEqual(r.dias, ["2026-09-01", "2026-09-02"]);
  assert.deepEqual(r.frutas.BANANA.porDia, { "2026-09-01": 1700, "2026-09-02": 1500 });
  assert.equal(r.frutas.BANANA.mes, 1600);
  assert.equal(r.frutas.BANANA.lineas.length, 2);
  const cav = r.frutas.BANANA.lineas.find((l) => l.variedad === "CAVENDISH");
  assert.deepEqual(cav.porDia, { "2026-09-01": 2200, "2026-09-02": 2000 });
  assert.equal(cav.clave, undefined);
  assert.deepEqual(r.hortalizas.PAPA.porDia, { "2026-09-01": 950 });
});
test("armarMes: sin fila Prom.Esp. promedia las líneas del día", () => {
  const r = armarMes([dia("frutas", "2026-09-01", [linea("KUMQUAT", "", "E. RIOS", 2700), linea("KUMQUAT", "", "CTES.", 2300)])]);
  assert.equal(r.frutas.KUMQUAT.porDia["2026-09-01"], 2500);
  assert.equal(r.frutas.KUMQUAT.mes, 2500);
});

/* ---------- CSV ---------- */
test("csvDelMes: una fila por línea y día, ordenado por fecha, con comillas cuando hace falta", () => {
  const f = linea("BANANA", "CAVENDISH", "ECUADOR", 2100);
  f.tamano = 'GRANDE, "X"';
  const csv = csvDelMes([dia("frutas", "2026-09-02", [f]), dia("hortalizas", "2026-09-01", [linea("PAPA", "", "BS. AS.", 950)])]);
  const lineas = csv.trim().split("\n");
  assert.equal(lineas[0], "fecha,rubro,especie,variedad,procedencia,envase,kg_bulto,calidad,tamano,grado,bulto_max,bulto_moda,bulto_min,kilo_max,kilo_moda,kilo_min");
  assert.equal(lineas[1], "2026-09-01,hortalizas,PAPA,,BS. AS.,CA,20,EL,,,,,,1050,950,850");
  assert.equal(lineas[2], '2026-09-02,frutas,BANANA,CAVENDISH,ECUADOR,CA,20,EL,"GRANDE, ""X""",,,,,2200,2100,2000');
});

/* ---------- De punta a punta: ZIP con planillas ---------- */
test("lecturasDeZip: lee cada XLS, deduce el rubro por RF/RH y reporta el que falla sin frenar", () => {
  const zip = zipDePrueba([
    { nombre: "RF040926.XLS", datos: FRUTAS_0409 },
    { nombre: "RF050926.XLS", datos: Buffer.from("no soy una planilla") },
    { nombre: "leeme.txt", datos: Buffer.from("ignorado") },
  ]);
  const { lecturas, errores } = lecturasDeZip(zip, "frutas");
  assert.equal(lecturas.length, 1);
  assert.equal(lecturas[0].rubro, "frutas");
  assert.equal(lecturas[0].fecha, "2026-09-04");
  assert.equal(lecturas[0].filas.length, 6);
  assert.equal(errores.length, 1);
  assert.match(errores[0], /RF050926\.XLS/);
  const r = armarMes(lecturas);
  assert.equal(r.frutas.BANANA.porDia["2026-09-04"], 1459.09);
  assert.equal(r.frutas.KUMQUAT.porDia["2026-09-04"], 2700);
  assert.equal(r.frutas.ANANA.lineas[0].variedad, "PIÑA");
});

console.log(`\n${pasan} tests OK`);
