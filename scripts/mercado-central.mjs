#!/usr/bin/env node
/* ============================================================
   EL CHANGUITO · precios mayoristas del Mercado Central (Bs. As.)
   Baja de la página oficial los ZIP mensuales de frutas y hortalizas
   (adentro hay un Excel 2.x por día hábil, formato binario BIFF2) y arma
   el precio POR KILO de cada especie, día por día, más el promedio del mes.

   Uso:  node scripts/mercado-central.mjs               → ÚLTIMO día publicado (por rubro)
                                                          → precios-mayoristas/ultimo.json + .csv
         node scripts/mercado-central.mjs --mes 2026-09  → un mes completo, día por día
         node scripts/mercado-central.mjs --todos        → todos los meses de la página
         node scripts/mercado-central.mjs --salida dir   → otra carpeta de salida

   El robot de precios (actualizar-precios.mjs) importa ultimoDiaMercadoCentral()
   para poner la referencia mayorista en los ítems de Verdulería de precios.json.

   ultimo.json: por rubro, la fecha y `especies[ESP] = { kilo, lineas }` ($/kg
   moda de la fila Prom.Esp. y cada línea variedad/procedencia/envase con su
   máximo/moda/mínimo). Los archivos por mes (AAAA-MM.json/.csv) traen además
   el $/kg de cada día y el promedio del mes. Sin dependencias (Node 20).

   Formato de origen (columnas del XLS): ESP VAR PROC ENV KG CAL TAM GRADO ·
   MAddmmaa MOddmmaa MIddmmaa = máximo / moda / mínimo POR BULTO ·
   MAPK MOPK MIPK = lo mismo POR KILO. La fila "Prom.Esp." de cada especie
   trae el promedio de la especie (bulto en MO…, kilo en MOPK).
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const PAGINA = "https://mercadocentral.gob.ar/informaci%C3%B3n/precios-mayoristas";
const CARPETA = "precios-mayoristas";
const CAB = { headers: { "user-agent": "Mozilla/5.0 (compatible; ElChanguito/1.0)" } };
const ESPERA_MS = 500;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 1. Links de la página → { url, nombre, rubro, mes } ----------
   Los nombres de archivo son irregulares (FRUTRAS_AGOSTO-26_0, HORTALIZA_
   SPTIEMBRE_26, "FRUTAS  ENERO-26", ABRIL2026…): el mes se detecta por un
   patrón tolerante y el año por 20AA o AA. La fecha REAL de cada planilla
   sale después del nombre del XLS de adentro (RF040926 = 04/09/26). */
const MESES = [
  ["01", /ENE/], ["02", /FEB/], ["03", /MAR/], ["04", /ABR/], ["05", /MAY/], ["06", /JUN/],
  ["07", /JUL/], ["08", /AGO/], ["09", /SE?PT|SEP/], ["10", /OCT/], ["11", /NOV/], ["12", /DIC/],
];

export function mesDeNombre(nombre) {
  let s;
  try { s = decodeURIComponent(nombre); } catch { s = nombre; }
  s = s.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\.ZIP$/, "").replace(/FRUT[A-Z]*|HORT[A-Z]*/g, " ");
  const mes = MESES.find(([, re]) => re.test(s))?.[0];
  const anio = s.match(/20\d\d/)?.[0] ?? (s.match(/(?:^|\D)(\d\d)(?:\D|$)/)?.[1] ? "20" + s.match(/(?:^|\D)(\d\d)(?:\D|$)/)[1] : null);
  return mes && anio ? `${anio}-${mes}` : null;
}

export function rubroDeNombre(nombre) {
  const s = nombre.toUpperCase();
  return /FRUT/.test(s) ? "frutas" : /HORT/.test(s) ? "hortalizas" : null;
}

export function linksMayoristas(html, base = PAGINA) {
  const out = [];
  for (const m of html.matchAll(/href="([^"]+\.zip(?:\?[^"]*)?)"/gi)) {
    const href = m[1].replace(/&amp;/g, "&");
    const url = new URL(href, base).href;
    const nombre = new URL(url).pathname.split("/").pop();
    if (out.some((l) => l.url === url)) continue;
    out.push({ url, nombre, rubro: rubroDeNombre(nombre), mes: mesDeNombre(nombre) });
  }
  return out;
}

/* ---------- 2. Lector de ZIP (directorio central + inflateRaw) ----------
   Devuelve [{ nombre, datos: Buffer }] con los ZIP anidados ya abiertos
   (el de hortalizas de 09/2026 traía otro ZIP adentro con un día repetido). */
export function leerZip(buf, prefijo = "") {
  const fin = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fin < 0) throw new Error("no es un ZIP (falta el directorio central)");
  const cantidad = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const entradas = [];
  for (let i = 0; i < cantidad; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("ZIP: entrada corrupta");
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const nLen = buf.readUInt16LE(p + 28), eLen = buf.readUInt16LE(p + 30), cLen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const nombre = buf.toString("latin1", p + 46, p + 46 + nLen);
    p += 46 + nLen + eLen + cLen;
    if (nombre.endsWith("/")) continue;
    if (buf.readUInt32LE(off) !== 0x04034b50) throw new Error(`ZIP: cabecera local corrupta (${nombre})`);
    const ini = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const comp = buf.subarray(ini, ini + tamComp);
    const datos = metodo === 0 ? Buffer.from(comp) : metodo === 8 ? zlib.inflateRawSync(comp) : null;
    if (!datos) throw new Error(`ZIP: método de compresión ${metodo} no soportado (${nombre})`);
    entradas.push({ nombre: prefijo + nombre, datos });
  }
  const planas = entradas.filter((e) => !/\.zip$/i.test(e.nombre));
  for (const e of entradas.filter((e) => /\.zip$/i.test(e.nombre))) planas.push(...leerZip(e.datos, e.nombre + "/"));
  return planas;
}

/* ---------- 3. Lector de Excel 2.x (BIFF2) ----------
   Registros de 4 bytes de cabecera (tipo, largo). Solo hacen falta las celdas:
   0x0004 LABEL (fila, col, 3 de atributos, largo, texto), 0x0003 NUMBER
   (fila, col, 3 de atributos, double) y 0x0002 INTEGER. Devuelve una grilla
   filas[fila][col]. El texto viene en codificación DOS: la Ñ es 0xA5 (y en
   algunas planillas la tipearon como 0xF1/0xD1 de Latin-1). */
function textoDos(bytes) {
  let s = "";
  for (const b of bytes) s += b === 0xa5 || b === 0xf1 || b === 0xd1 ? "Ñ" : String.fromCharCode(b);
  return s;
}

export function leerBiff2(buf) {
  if (buf.length < 4 || buf.readUInt16LE(0) !== 0x0009) {
    const cdf = buf.length >= 4 && buf.readUInt32LE(0) === 0xe011cfd0;
    throw new Error(cdf ? "la planilla ya no es Excel 2.x (BIFF2) sino un Excel moderno: hay que actualizar el lector"
      : "la planilla no arranca con un BOF de Excel 2.x");
  }
  const filas = [];
  let p = 0;
  while (p + 4 <= buf.length) {
    const tipo = buf.readUInt16LE(p), largo = buf.readUInt16LE(p + 2);
    const d = buf.subarray(p + 4, p + 4 + largo);
    p += 4 + largo;
    if (tipo === 0x000a) break;
    if (tipo !== 0x0002 && tipo !== 0x0003 && tipo !== 0x0004) continue;
    const fila = d.readUInt16LE(0), col = d.readUInt16LE(2);
    const valor = tipo === 0x0004 ? textoDos(d.subarray(8, 8 + d[7])).trim()
      : tipo === 0x0003 ? d.readDoubleLE(7) : d.readUInt16LE(7);
    (filas[fila] ??= [])[col] = valor;
  }
  return filas;
}

/* ---------- 4. Grilla → filas con nombre y fecha ---------- */
export function fechaDeCodigo(ddmmaa) {
  if (!/^\d{6}$/.test(ddmmaa ?? "")) return null;
  return `20${ddmmaa.slice(4)}-${ddmmaa.slice(2, 4)}-${ddmmaa.slice(0, 2)}`;
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const txt = (v) => (v == null ? "" : String(v).trim());
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

export function tablaDesdeGrilla(grilla, nombreArchivo = "") {
  const iCab = grilla.findIndex((f) => f && f.some((c) => txt(c).toUpperCase() === "ESP"));
  if (iCab < 0) throw new Error(`${nombreArchivo}: no encontré la fila de cabecera (ESP, VAR, PROC…)`);
  const cab = grilla[iCab].map((c) => txt(c).toUpperCase());
  const col = (re) => cab.findIndex((c) => re.test(c));
  const ix = {
    especie: col(/^ESP$/), variedad: col(/^VAR$/), procedencia: col(/^PROC$/), envase: col(/^ENV$/),
    kg: col(/^KG$/), calidad: col(/^CAL$/), tamano: col(/^TAM$/), grado: col(/^GRADO$/),
    bMax: col(/^MA\d{6}$/), bModa: col(/^MO\d{6}$/), bMin: col(/^MI\d{6}$/),
    kMax: col(/^MAPK$/), kModa: col(/^MOPK$/), kMin: col(/^MIPK$/),
  };
  if (ix.kModa < 0) throw new Error(`${nombreArchivo}: falta la columna MOPK ($/kg moda); ¿cambió el formato?`);
  const fecha = fechaDeCodigo(cab[ix.bModa]?.slice(2)) ?? fechaDeCodigo(nombreArchivo.match(/(\d{6})\.xls$/i)?.[1]);
  if (!fecha) throw new Error(`${nombreArchivo}: no pude deducir la fecha (ni de la cabecera ni del nombre)`);
  const celda = (f, i) => (i >= 0 ? f[i] : undefined);
  const filas = [];
  for (const f of grilla.slice(iCab + 1)) {
    if (!f) continue;
    const especie = txt(celda(f, ix.especie));
    if (!especie) continue;
    const variedad = txt(celda(f, ix.variedad));
    filas.push({
      especie, variedad, procedencia: txt(celda(f, ix.procedencia)), envase: txt(celda(f, ix.envase)),
      kg: num(celda(f, ix.kg)), calidad: txt(celda(f, ix.calidad)), tamano: txt(celda(f, ix.tamano)), grado: txt(celda(f, ix.grado)),
      promedio: /^prom/i.test(variedad),
      bulto: { max: num(celda(f, ix.bMax)), moda: num(celda(f, ix.bModa)), min: num(celda(f, ix.bMin)) },
      kilo: { max: num(celda(f, ix.kMax)), moda: num(celda(f, ix.kModa)), min: num(celda(f, ix.kMin)) },
    });
  }
  return { fecha, filas };
}

export function rubroDeArchivo(nombre) {
  const base = nombre.split("/").pop().toUpperCase();
  return base.startsWith("RF") ? "frutas" : base.startsWith("RH") ? "hortalizas" : null;
}

/* ---------- 5. Lecturas de varios días → resumen del mes ----------
   lecturas: [{ rubro, fecha, filas }]. Por especie: porDia = $/kg de la fila
   "Prom.Esp." (si falta, promedio de las líneas), mes = promedio de los días
   con dato, y cada línea (variedad/procedencia/envase/kg/calidad/tamaño/grado)
   con su $/kg moda por día. */
export function armarMes(lecturas) {
  const dias = [...new Set(lecturas.map((l) => l.fecha))].sort();
  const out = { dias, frutas: {}, hortalizas: {} };
  for (const { rubro, fecha, filas } of lecturas) {
    const especies = out[rubro] ??= {};
    const sinPromedio = {};
    for (const f of filas) {
      const e = especies[f.especie] ??= { porDia: {}, mes: null, lineas: [] };
      if (f.promedio) { if (f.kilo.moda != null) e.porDia[fecha] = r2(f.kilo.moda); continue; }
      (sinPromedio[f.especie] ??= []).push(f.kilo.moda);
      const clave = [f.variedad, f.procedencia, f.envase, f.kg, f.calidad, f.tamano, f.grado].join("|");
      let linea = e.lineas.find((l) => l.clave === clave);
      if (!linea) {
        linea = { clave, variedad: f.variedad, procedencia: f.procedencia, envase: f.envase, kg: f.kg, calidad: f.calidad, tamano: f.tamano, grado: f.grado, porDia: {} };
        e.lineas.push(linea);
      }
      if (f.kilo.moda != null) linea.porDia[fecha] = r2(f.kilo.moda);
    }
    for (const [esp, valores] of Object.entries(sinPromedio)) {
      const v = valores.filter((x) => x != null);
      if (especies[esp].porDia[fecha] == null && v.length) especies[esp].porDia[fecha] = r2(v.reduce((a, b) => a + b, 0) / v.length);
    }
  }
  for (const rubro of ["frutas", "hortalizas"]) {
    for (const e of Object.values(out[rubro])) {
      const v = Object.values(e.porDia);
      e.mes = v.length ? r2(v.reduce((a, b) => a + b, 0) / v.length) : null;
      e.lineas.forEach((l) => delete l.clave);
      e.lineas.sort((a, b) => a.variedad.localeCompare(b.variedad) || a.procedencia.localeCompare(b.procedencia) || (a.kg ?? 0) - (b.kg ?? 0));
    }
    out[rubro] = Object.fromEntries(Object.entries(out[rubro]).sort(([a], [b]) => a.localeCompare(b)));
  }
  return out;
}

/* Último día de cada rubro: { frutas: { fecha, especies, filas }, hortalizas: {...} }.
   especies[ESP] = { kilo: $/kg de la fila Prom.Esp. (si falta, promedio de las
   líneas), lineas: [{ variedad, procedencia, envase, kg, calidad, tamano, grado,
   bulto, kilo }] }. `filas` son las filas crudas de ese día (para el CSV). */
export function ultimoDeLecturas(lecturas) {
  const out = {};
  for (const rubro of ["frutas", "hortalizas"]) {
    const del = lecturas.filter((l) => l.rubro === rubro);
    if (!del.length) continue;
    const fecha = del.map((l) => l.fecha).sort().pop();
    const filas = del.find((l) => l.fecha === fecha).filas;
    const especies = {};
    for (const f of filas) {
      const e = especies[f.especie] ??= { kilo: null, lineas: [] };
      if (f.promedio) { if (f.kilo.moda != null) e.kilo = r2(f.kilo.moda); continue; }
      e.lineas.push({
        variedad: f.variedad, procedencia: f.procedencia, envase: f.envase, kg: f.kg, calidad: f.calidad, tamano: f.tamano, grado: f.grado,
        bulto: { ...f.bulto }, kilo: { max: r2(f.kilo.max), moda: r2(f.kilo.moda), min: r2(f.kilo.min) },
      });
    }
    for (const e of Object.values(especies)) {
      if (e.kilo != null) continue;
      const v = e.lineas.map((l) => l.kilo.moda).filter((x) => x != null);
      if (v.length) e.kilo = r2(v.reduce((a, b) => a + b, 0) / v.length);
    }
    out[rubro] = { fecha, especies: Object.fromEntries(Object.entries(especies).sort(([a], [b]) => a.localeCompare(b))), filas };
  }
  return out;
}

/* ---------- 6. CSV largo con todas las filas de todos los días ---------- */
const COLUMNAS_CSV = ["fecha", "rubro", "especie", "variedad", "procedencia", "envase", "kg_bulto", "calidad", "tamano", "grado",
  "bulto_max", "bulto_moda", "bulto_min", "kilo_max", "kilo_moda", "kilo_min"];
const csvCelda = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function csvDelMes(lecturas) {
  const filas = [COLUMNAS_CSV.join(",")];
  const orden = [...lecturas].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.rubro.localeCompare(b.rubro));
  for (const { rubro, fecha, filas: fs_ } of orden) {
    for (const f of fs_) {
      filas.push([fecha, rubro, f.especie, f.variedad, f.procedencia, f.envase, f.kg, f.calidad, f.tamano, f.grado,
        f.bulto.max, f.bulto.moda, f.bulto.min, r2(f.kilo.max), r2(f.kilo.moda), r2(f.kilo.min)].map(csvCelda).join(","));
    }
  }
  return filas.join("\n") + "\n";
}

/* ---------- 7. Orquestación ---------- */
export function mesActual() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).slice(0, 7);
}

async function bajar(url) {
  const r = await fetch(url, CAB);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export function lecturasDeZip(buf, rubroLink) {
  const lecturas = [], errores = [];
  for (const e of leerZip(buf)) {
    if (!/\.xls$/i.test(e.nombre)) continue;
    try {
      const { fecha, filas } = tablaDesdeGrilla(leerBiff2(e.datos), e.nombre);
      lecturas.push({ rubro: rubroDeArchivo(e.nombre) ?? rubroLink, fecha, filas, archivo: e.nombre });
    } catch (err) { errores.push(`${e.nombre}: ${err.message}`); }
  }
  return { lecturas, errores };
}

const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("es-AR"));
const ddmm = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

/* Baja los ZIP de un mes y devuelve sus lecturas (una por rubro y día, sin repetidos) */
async function lecturasDelMes(mes, links, log = console.log) {
  const lecturas = [], vistos = new Set();
  for (const l of links) {
    try {
      const buf = await bajar(l.url);
      const { lecturas: nuevas, errores } = lecturasDeZip(buf, l.rubro);
      errores.forEach((e) => log(`  ✘ ${e}`));
      let sumadas = 0;
      for (const n of nuevas) {
        if (!n.rubro) { log(`  ✘ ${n.archivo}: no sé si es fruta u hortaliza (no empieza con RF/RH)`); continue; }
        if (!n.fecha.startsWith(mes)) { log(`  · ${n.archivo}: es de ${n.fecha}, no de ${mes}; lo salteo`); continue; }
        const clave = n.rubro + n.fecha;
        if (vistos.has(clave)) continue; // día repetido (ZIP anidado): gana el primero
        vistos.add(clave); lecturas.push(n); sumadas++;
      }
      log(`  ✔ ${l.nombre} (${l.rubro ?? "?"}): ${sumadas} día${sumadas === 1 ? "" : "s"}`);
    } catch (err) {
      log(`  ✘ ${l.nombre}: ${err.message}`);
    }
    await dormir(ESPERA_MS);
  }
  return lecturas;
}

async function linksDeLaPagina() {
  const html = await (await fetch(PAGINA, CAB)).text();
  const links = linksMayoristas(html);
  if (!links.length) throw new Error("la página no tiene ningún ZIP: ¿cambió el sitio del Mercado Central?");
  return links;
}

/* Último día publicado, POR RUBRO: recorre los meses de más nuevo a más viejo hasta
   tener frutas y hortalizas (a principio de mes puede estar subido uno solo).
   Devuelve { frutas: { fecha, zip, especies, filas } | null, hortalizas: ídem }. */
export async function ultimoDiaMercadoCentral({ log = console.log } = {}) {
  const links = (await linksDeLaPagina()).filter((l) => l.mes && l.rubro);
  const meses = [...new Set(links.map((l) => l.mes))].sort().reverse();
  const out = { frutas: null, hortalizas: null };
  for (const mes of meses) {
    const faltan = ["frutas", "hortalizas"].filter((r) => !out[r]);
    if (!faltan.length) break;
    const delMes = links.filter((l) => l.mes === mes && faltan.includes(l.rubro));
    if (!delMes.length) continue;
    log(`=== ${mes} ===`);
    const u = ultimoDeLecturas(await lecturasDelMes(mes, delMes, log));
    for (const r of faltan) if (u[r]) out[r] = { ...u[r], zip: delMes.find((l) => l.rubro === r)?.url };
  }
  if (!out.frutas && !out.hortalizas) throw new Error("no pude leer ninguna planilla del Mercado Central");
  return out;
}

function escribirUltimo(u, salida) {
  const sinFilas = (r) => (r ? { fecha: r.fecha, zip: r.zip, especies: r.especies } : null);
  const json = {
    fuente: PAGINA, generado: new Date().toISOString(),
    unidad: "$/kg · moda del último día publicado de cada rubro; 'kilo' de la especie = fila Prom.Esp. (promedio de la especie)",
    frutas: sinFilas(u.frutas), hortalizas: sinFilas(u.hortalizas),
  };
  fs.mkdirSync(salida, { recursive: true });
  fs.writeFileSync(path.join(salida, "ultimo.json"), JSON.stringify(json, null, 1) + "\n");
  fs.writeFileSync(path.join(salida, "ultimo.csv"), csvDelMes(["frutas", "hortalizas"].filter((r) => u[r]).map((r) => ({ rubro: r, fecha: u[r].fecha, filas: u[r].filas }))));
  for (const rubro of ["frutas", "hortalizas"]) {
    if (!u[rubro]) { console.log(`\n${rubro.toUpperCase()}: sin datos`); continue; }
    console.log(`\n${rubro.toUpperCase()} · último día publicado: ${ddmm(u[rubro].fecha)}/${u[rubro].fecha.slice(0, 4)} · $/kg (moda)`);
    for (const [nombre, e] of Object.entries(u[rubro].especies)) console.log(`  ${nombre.padEnd(14)} $${fmt(e.kilo).padStart(8)}/kg   (${e.lineas.length} línea${e.lineas.length === 1 ? "" : "s"})`);
  }
  console.log(`\n✔ ${path.join(salida, "ultimo.json")} y .csv`);
}

function resumenConsola(mes, resumen) {
  for (const rubro of ["frutas", "hortalizas"]) {
    const especies = Object.entries(resumen[rubro]);
    if (!especies.length) { console.log(`\n${rubro.toUpperCase()}: sin datos`); continue; }
    console.log(`\n${rubro.toUpperCase()} · ${mes} · $/kg promedio del mes (moda diaria) · último día leído`);
    for (const [nombre, e] of especies) {
      const fechas = Object.keys(e.porDia).sort();
      const ult = fechas[fechas.length - 1];
      console.log(`  ${nombre.padEnd(14)} $${fmt(e.mes).padStart(8)}/kg   ${ult ? `${ddmm(ult)} $${fmt(e.porDia[ult])}` : "sin precio"}   (${fechas.length} día${fechas.length === 1 ? "" : "s"})`);
    }
  }
}

export async function procesarMes(mes, links, salida) {
  console.log(`\n=== ${mes} ===`);
  const lecturas = await lecturasDelMes(mes, links);
  if (!lecturas.length) { console.log("  ✘ No se pudo leer ninguna planilla: no escribo nada."); return null; }
  for (const rubro of ["frutas", "hortalizas"]) {
    if (!lecturas.some((l) => l.rubro === rubro)) console.log(`  ⚠ ${mes}: no hay ZIP de ${rubro} en la página`);
  }
  const resumen = armarMes(lecturas);
  const salidaJson = {
    fuente: PAGINA, mes, generado: new Date().toISOString(),
    unidad: "$/kg · moda del día (precio más repetido en el Mercado Central); 'mes' = promedio de los días publicados",
    zips: Object.fromEntries(links.map((l) => [l.rubro ?? l.nombre, l.url])),
    ...resumen,
  };
  fs.mkdirSync(salida, { recursive: true });
  fs.writeFileSync(path.join(salida, `${mes}.json`), JSON.stringify(salidaJson, null, 1) + "\n");
  fs.writeFileSync(path.join(salida, `${mes}.csv`), csvDelMes(lecturas));
  resumenConsola(mes, resumen);
  console.log(`\n✔ ${mes}: ${resumen.dias.length} día${resumen.dias.length === 1 ? "" : "s"} (${resumen.dias.map(ddmm).join(", ")}) → ${path.join(salida, mes + ".json")} y .csv`);
  return salidaJson;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const todos = args.includes("--todos");
  const mesPedido = arg("--mes");
  const salida = arg("--salida") ?? CARPETA;
  if (mesPedido && !/^\d{4}-\d{2}$/.test(mesPedido)) { console.error("✘ --mes espera AAAA-MM (ej. 2026-09)"); process.exit(2); }

  if (!todos && !mesPedido) {
    // Modo por defecto: solo la última actualización publicada
    escribirUltimo(await ultimoDiaMercadoCentral(), salida);
    return;
  }

  const links = await linksDeLaPagina();
  links.filter((l) => !l.mes || !l.rubro).forEach((l) => console.log(`⚠ No entiendo el nombre "${l.nombre}" (mes: ${l.mes ?? "?"}, rubro: ${l.rubro ?? "?"}); lo salteo`));
  const disponibles = [...new Set(links.map((l) => l.mes).filter(Boolean))].sort();
  console.log(`Meses publicados: ${disponibles.join(", ")}`);
  let meses;
  if (todos) meses = disponibles;
  else if (disponibles.includes(mesPedido)) meses = [mesPedido];
  else { console.error(`✘ ${mesPedido} no está publicado. Disponibles: ${disponibles.join(", ")}`); process.exit(1); }
  let ok = 0;
  for (const mes of meses) if (await procesarMes(mes, links.filter((l) => l.mes === mes && l.rubro), salida)) ok++;
  if (!ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  main().catch((err) => { console.error("✘ " + (err.stack ?? err.message)); process.exit(1); });
}
