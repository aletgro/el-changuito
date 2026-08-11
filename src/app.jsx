import { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

/* ============================================================
   EL CHANGUITO — organizador de compras por comercio
   Datos persistentes con window.storage (clave única).
   ============================================================ */

const KEY = "el-changuito-v1";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const ALLM = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/* ---------- Temporadas (Argentina, zona pampeana) ----------
   k: f=fruta, v=verdura · m: meses en temporada · p: pico    */
const SEASON = {
  "Ananá": { k: "f", m: [11, 12, 1, 2, 3], p: [12, 1, 2] },
  "Arándanos": { k: "f", m: [9, 10, 11, 12, 1], p: [10, 11] },
  "Banana": { k: "f", m: ALLM, p: [] },
  "Caqui": { k: "f", m: [3, 4, 5, 6], p: [4, 5] },
  "Cereza": { k: "f", m: [11, 12, 1], p: [12] },
  "Ciruela": { k: "f", m: [12, 1, 2, 3], p: [1, 2] },
  "Durazno": { k: "f", m: [11, 12, 1, 2, 3], p: [12, 1, 2] },
  "Frambuesa": { k: "f", m: [12, 1, 2, 3], p: [1, 2] },
  "Frutilla": { k: "f", m: [8, 9, 10, 11, 12, 1], p: [9, 10, 11] },
  "Granada": { k: "f", m: [3, 4, 5], p: [4] },
  "Higo": { k: "f", m: [12, 1, 2, 3], p: [2] },
  "Kiwi": { k: "f", m: [4, 5, 6, 7, 8, 9, 10], p: [5, 6, 7] },
  "Mandarina": { k: "f", m: [3, 4, 5, 6, 7, 8, 9], p: [5, 6, 7] },
  "Mango": { k: "f", m: [12, 1, 2], p: [1] },
  "Manzana": { k: "f", m: [2, 3, 4, 5, 6, 7, 8, 9], p: [3, 4, 5] },
  "Maracuya": { k: "f", m: [2, 3, 4, 5, 6, 7], p: [3, 4, 5] },
  "Melón": { k: "f", m: [12, 1, 2, 3], p: [1, 2] },
  "Membrillo": { k: "f", m: [2, 3, 4], p: [3] },
  "Mora": { k: "f", m: [12, 1, 2], p: [1] },
  "Naranja": { k: "f", m: [5, 6, 7, 8, 9, 10, 11], p: [6, 7, 8] },
  "Papaya": { k: "f", m: [2, 3, 4, 5, 6], p: [3, 4] },
  "Pera": { k: "f", m: [1, 2, 3, 4, 5, 6], p: [2, 3, 4] },
  "Pitahaya": { k: "f", m: [12, 1, 2, 3, 4], p: [1, 2, 3] },
  "Pomelo": { k: "f", m: [5, 6, 7, 8, 9], p: [6, 7, 8] },
  "Sandía": { k: "f", m: [12, 1, 2, 3], p: [1, 2] },
  "Uva": { k: "f", m: [1, 2, 3, 4], p: [2, 3] },
  "Limón": { k: "f", m: ALLM, p: [5, 6, 7, 8] },
  "Palta": { k: "f", m: [3, 4, 5, 6, 7, 8, 9, 10], p: [4, 5, 6, 7] },
  "Apio": { k: "v", m: ALLM, p: [5, 6, 7, 8] },
  "Alcaucil": { k: "v", m: [3, 4, 8, 9, 10, 11], p: [9, 10, 11] },
  "Espárragos": { k: "v", m: [9, 10, 11, 12], p: [10, 11] },
  "Berro": { k: "v", m: [5, 6, 7, 8, 9, 10, 11], p: [7, 8, 9] },
  "Lechuga": { k: "v", m: ALLM, p: [9, 10, 11] },
  "Rabanitos": { k: "v", m: ALLM, p: [9, 10, 11] },
  "Radicheta": { k: "v", m: ALLM, p: [4, 5, 6, 7, 8] },
  "Rúcula": { k: "v", m: ALLM, p: [3, 4, 5, 9, 10, 11] },
  "Berenjena": { k: "v", m: [11, 12, 1, 2, 3, 4], p: [1, 2, 3] },
  "Brócoli": { k: "v", m: [4, 5, 6, 7, 8, 9, 10], p: [6, 7, 8] },
  "Hakusay": { k: "v", m: [4, 5, 6, 7, 8, 9], p: [6, 7] },
  "Hinojo": { k: "v", m: [5, 6, 7, 8, 9, 10], p: [6, 7, 8] },
  "Repollo": { k: "v", m: ALLM, p: [5, 6, 7, 8] },
  "Zapallito": { k: "v", m: [10, 11, 12, 1, 2, 3, 4], p: [12, 1, 2] },
  "Zucchini": { k: "v", m: [10, 11, 12, 1, 2, 3, 4], p: [12, 1, 2] },
  "Acelga": { k: "v", m: ALLM, p: [5, 6, 7, 8, 9] },
  "Chaucha": { k: "v", m: [11, 12, 1, 2, 3, 4], p: [12, 1, 2] },
  "Espinaca": { k: "v", m: [4, 5, 6, 7, 8, 9, 10], p: [6, 7, 8] },
  "Kale": { k: "v", m: [4, 5, 6, 7, 8, 9, 10], p: [6, 7, 8] },
  "Batata": { k: "v", m: [2, 3, 4, 5, 6, 7, 8], p: [3, 4, 5] },
  "Calabaza": { k: "v", m: ALLM, p: [3, 4, 5, 6] },
  "Choclo": { k: "v", m: [11, 12, 1, 2, 3, 4], p: [12, 1, 2] },
  "Coliflor": { k: "v", m: [4, 5, 6, 7, 8, 9, 10], p: [6, 7, 8] },
  "Mandioca": { k: "v", m: [3, 4, 5, 6, 7, 8, 9], p: [4, 5, 6] },
  "Remolacha": { k: "v", m: ALLM, p: [10, 11, 12] },
  "Zapallo anco": { k: "v", m: ALLM, p: [4, 5, 6, 7] },
  "Albahaca": { k: "v", m: [11, 12, 1, 2, 3, 4], p: [12, 1, 2] },
  "Cilantro": { k: "v", m: ALLM, p: [4, 5, 6, 7, 8, 9] },
  "Perejil": { k: "v", m: ALLM, p: [] },
  "Puerro": { k: "v", m: [4, 5, 6, 7, 8, 9, 10], p: [6, 7, 8] },
  "Verdeo": { k: "v", m: ALLM, p: [] },
  "Tomate": { k: "v", m: [11, 12, 1, 2, 3, 4], p: [12, 1, 2, 3] },
  "Morrón": { k: "v", m: [12, 1, 2, 3, 4, 5], p: [2, 3, 4] },
};

function seasonOf(name, month) {
  const base = name.split(" (")[0];
  const d = SEASON[base];
  if (!d) return null;
  if (d.p.includes(month)) return "peak";
  if (d.m.includes(month)) return "in";
  return "out";
}

function estacionDe(month) {
  if ([12, 1, 2].includes(month)) return { name: "verano", emoji: "☀️" };
  if ([3, 4, 5].includes(month)) return { name: "otoño", emoji: "🍂" };
  if ([6, 7, 8].includes(month)) return { name: "invierno", emoji: "❄️" };
  return { name: "primavera", emoji: "🌸" };
}

const esInvernal = (m) => m >= 4 && m <= 9;

function dynNote(code, month) {
  const inv = esInvernal(month);
  if (code === "combo") return inv ? "1 falda + 2 osobuco · estofados, braseados y empanadas" : "1 marucha + 2 arañita · bifes y salteados";
  if (code === "roast") return inv ? "Para milanesas" : "Para empanadas y boloñesa";
  return "";
}

function CarneBanner({ month }) {
  const inv = esInvernal(month);
  return (
    <div className="mt-1 mb-1">
      <span className="rounded-full text-xs font-semibold" style={{
        background: inv ? "#E8F0F8" : "#FFF3DE",
        color: inv ? "#2E5E8C" : "#A05A00",
        padding: "2px 10px",
      }}>
        {inv ? "❄️ Temporada de frío" : "☀️ Temporada de calor"}
      </span>
    </div>
  );
}

/* ---------- Datos iniciales (tus listas) ---------- */
let _c = 0;
const nid = () => "x" + _c++;
const I = (name, note = "", extra = {}) => ({ id: nid(), name, note, have: true, spec: "", ...extra });
const P = (name, options, note = "") => I(name, note, { type: "pick", options, picked: [] });
const G = (name) => I(name, "", { askSpec: true });

const FRUTAS = ["Ananá", "Arándanos", "Banana", "Caqui", "Cereza", "Ciruela", "Durazno", "Frambuesa", "Frutilla", "Granada", "Higo", "Kiwi", "Mandarina", "Mango", "Manzana", "Maracuya (fruta de la pasión)", "Melón", "Membrillo", "Mora", "Naranja", "Papaya", "Pera", "Pitahaya (fruta del dragón)", "Pomelo", "Sandía", "Uva"];

function seedStores() {
  _c = 0;
  return [
    {
      id: "dia", name: "DIA", emoji: "🛒", color: "#D7263D",
      note: "Supermercado general: todo lo que no tiene un lugar mejor.",
      sections: [
        { id: nid(), name: "Almacén", items: [I("Aceite de girasol 1 L"), I("Agua mineral bidón"), I("Arroz integral 1 kg"), I("Atún"), I("Azúcar 500 g"), I("Grasa bovina 1 kg"), I("Harina de maíz 1 kg"), I("Leche larga vida"), I("Maicena 500 g"), I("Papas fritas"), I("Polenta 1 kg"), I("Sal entrefina 500 g"), I("Sal fina 500 g"), I("Sal gruesa 500 g"), I("Vinagre de alcohol 1 L"), I("Vinagre de manzana 1 L"), I("Yerba 1 kg")] },
        { id: nid(), name: "Limpieza e higiene", items: [I("Aerosol de ambiente"), I("Bolsa de basura baño"), I("Cif crema"), I("Desinfectante de piso"), I("Desinfectante de superficies"), I("Detergente líquido"), I("Esponja"), I("Jabón Dove"), I("Jabón líquido manos"), I("Jabón líquido ropa"), I("Lavandina"), I("Limpia vidrios"), I("Papel higiénico"), I("Pastilla inodoro"), I("Rollo de cocina"), I("Suavizante"), I("Trapo de piso"), I("Trapo rejilla"), I("Trapo amarillo"), I("Virulana")] },
        { id: nid(), name: "Almacén (compra secundaria)", items: [I("Arvejas en lata"), I("Caldo en cubos"), I("Choclo en lata"), I("Jardinera en lata"), I("Jugo de tomate en sachet"), I("Levadura"), I("Pan rallado")] },
        { id: nid(), name: "Electricidad", items: [I("4 pilas AAA", "Control + balanza")] },
        { id: nid(), name: "Otros", items: [I("Escarbadientes")] },
      ],
    },
    {
      id: "coto", name: "COTO", emoji: "🥩", color: "#E4572E",
      note: "Harinas Chacabuco y carnicería.",
      sections: [
        { id: nid(), name: "Almacén · harinas Chacabuco", items: [I("Harina 000"), I("Harina 000 de fuerza", "Chacabuco W300 · 13 g proteína"), I("Harina 0000"), I("Harina 0000 de fuerza", "Chacabuco Napolitana W330"), I("Harina integral"), I("Sémola"), I("Semolín")] },
        {
          id: nid(), name: "Carnicería", banner: "carne", items: [
            P("Achura", ["Molleja", "Chinchulín", "Riñón", "Chorizo", "Lengua", "Morcilla"]),
            I("Asado", "Vacío o tapa de asado + tira de asado"),
            I("Combo de temporada", "", { dyn: "combo" }),
            I("Roast beef", "", { dyn: "roast" }),
          ]
        },
      ],
    },
    {
      id: "puente", name: "El Puente", emoji: "🧀", color: "#2E6FA3",
      note: "Lácteos y quesos: encadenando ofertas queda buen precio.",
      sections: [
        {
          id: nid(), name: "Quesos", items: [
            I("Fundente", "Cremoso o Por Salud · ~600 g por mes"),
            P("Queso para picada", ["Fontina", "Gouda", "Gruyere", "Mar del Plata", "Queso duro"]),
            I("Pizza", "300–400 g de mozzarella o cremoso hilado · rinde 2 pizzas"),
            I("Provoletta"),
            P("Queso para rayar", ["Sardo", "Reggianito", "Romano", "Provolone"]),
          ]
        },
        {
          id: nid(), name: "Lácteos", items: [
            I("Crema", "2 potes de 220 cc por recarga de manteca (~270 g, dura ~3 semanas)"),
            I("Leche", "~2 por semana + 3 por mes para ricotta"),
          ]
        },
      ],
    },
    {
      id: "verdu", name: "Verdulería", emoji: "🥬", color: "#3E8914",
      note: "Comprar por temporada. Súper solo si hay mega oferta.",
      sections: [
        { id: nid(), name: "Siempre en stock", items: [I("Ajo"), I("Cebolla"), I("Cúrcuma"), I("Jengibre"), I("Limón"), I("Morrón"), I("Papa"), I("Palta"), I("Tomate"), I("Zanahoria")] },
        {
          id: nid(), name: "Algo de cada categoría", items: [
            P("Fruta", FRUTAS),
            P("Solo ensalada", ["Apio", "Berro", "Lechuga", "Rabanitos", "Radicheta", "Rúcula"]),
            P("Estructurales", ["Alcaucil", "Berenjena", "Brócoli", "Espárragos", "Hakusay", "Hinojo", "Repollo", "Zapallito", "Zucchini"], "Flexibles"),
            P("Apoyo", ["Acelga", "Chaucha", "Espinaca", "Kale"], "Flexibles"),
            P("Contundentes", ["Batata", "Calabaza", "Choclo", "Coliflor", "Mandioca", "Remolacha", "Zapallo anco"]),
            P("Hierbas de terminación", ["Albahaca", "Cilantro", "Perejil"]),
            P("Aromáticos de cocción", ["Puerro (frío)", "Verdeo (calor)"]),
          ]
        },
      ],
    },
    {
      id: "diet", name: "Dietética", emoji: "🌿", color: "#9A6A1F",
      note: "Más barato directo en dietética. Mantener frescura de especias.",
      sections: [
        { id: nid(), name: "Especias · stock permanente", items: [I("Ají molido / pimentón picante 100 g"), I("Amapola 25 g"), I("Canela 15 g"), I("Clavos de olor 10 g"), I("Comino 100 g"), I("Coriandro 25 g"), I("Hinojo 50 g"), I("Laurel 15 hojas"), I("Mostaza rubia 25 g"), I("Nuez moscada 5 unidades"), I("Orégano 50 g"), I("Pimentón 100 g"), I("Pimienta blanca 50 g"), I("Pimienta negra 50 g + 50 g"), I("Romero 25 g"), I("Tomillo 50 g")] },
        { id: nid(), name: "Perecederos", items: [I("Almendras 500 g"), I("Cacao 500 g"), I("Castañas de cajú 500 g"), I("Girasol 250 g"), I("Huevo"), I("Lino 250 g"), I("Maní 2 kg"), I("Nueces 500 g"), I("Piñones"), I("Sésamo integral 500 g")] },
        { id: nid(), name: "Duraderos", items: [I("Avena 500 g"), I("Bicarbonato de sodio 200 g"), I("Copos de maíz 500 g"), I("Polvo para hornear 100 g")] },
        { id: nid(), name: "Muy duraderos", items: [I("Arvejas 1 kg"), I("Chía 500 g"), I("Garbanzos 1 kg"), I("Lentejas 1 kg"), I("Porotos negros 1 kg"), I("Porotos de soja 1 kg"), I("Quínoa 1 kg"), I("Salsa de pescado", "La compramos en New Garden")] },
        { id: nid(), name: "Té", items: [I("Té negro"), I("Té verde"), I("Té de boldo"), G("Té a elección")] },
        { id: nid(), name: "Especias · compra puntual", items: [I("Achiote 10 g", "Solo cuando se necesita"), I("Anís 20 g", "Solo cuando se necesita"), I("Cardamomo 20 g", "Solo cuando se necesita"), I("Eneldo 10 g", "Solo cuando se necesita"), I("Estragón 10 g", "Solo cuando se necesita"), I("Fenogreco 15 g", "Solo cuando se necesita"), I("Vainilla", "Solo cuando se necesita")] },
      ],
    },
    {
      id: "farma", name: "Farmacity", emoji: "💊", color: "#0E8C8C",
      note: "Para no pensar demasiado, todo esto acá (suele haber mejor oferta que en DIA).",
      sections: [
        { id: nid(), name: "Higiene", items: [I("Alcohol"), I("Alcohol en gel"), I("Algodón"), I("Cepillo de dientes"), I("Curitas"), I("Desodorante"), I("Enjuague bucal"), I("Hilo dental"), I("Máquina de afeitar"), I("Pasta dental"), I("Preservativos"), I("Repelente")] },
        { id: nid(), name: "Belleza", items: [I("Crema humectante"), I("Gel de limpieza"), I("Protector solar corporal"), I("Protector solar facial")] },
      ],
    },
    {
      id: "otros", name: "Otros lugares", emoji: "📍", color: "#6C5CE7",
      note: "Cada producto tiene su lugar identificado.",
      sections: [
        { id: nid(), name: "Tercero", items: [G("Café"), I("Aceite de oliva"), I("Miel")] },
        { id: nid(), name: "Carmín (congelados)", items: [I("Hongos para cocinar", "Si aparece más barato en otro lado, cambiar")] },
        { id: nid(), name: "BonVino", items: [I("Aceto balsámico Millán")] },
        { id: nid(), name: "Tienda Nova", items: [I("Salsa de soja Lee Kum Kee premium")] },
        { id: nid(), name: "Esquina de las Aceitunas", items: [I("Aceitunas")] },
        { id: nid(), name: "Buscar lugar", items: [G("Crema rosácea"), G("Proteína"), I("Shampoo sólido"), I("1 pila LR44"), I("2 pilas LR43"), I("Bombillas techo"), I("Bombillas escritorio")] },
      ],
    },
    {
      id: "gustitos", name: "Gustitos", emoji: "✨", color: "#C2185B",
      note: "Al activarlos, anotá qué buscar exactamente esta vez.",
      sections: [
        { id: nid(), name: "Gustitos", items: [G("Queso premium"), G("Fiambre")] },
      ],
    },
  ];
}

/* Ítems que piden especificar qué buscar al activarse */
const SPEC_ITEMS = ["Café", "Crema rosácea", "Proteína", "Queso premium", "Fiambre", "Té a elección"];

/* Ítems que piden el precio pagado al marcarlos comprados (queda historial para comparar) */
const ASK_PRICE_ITEMS = ["Huevo"];

/* ---------- Foto de precios DIA (criterio: más barato normalizado por kg/L en tamaño similar) ---------- */
const PRICE_SNAPSHOT_V = "08/08/2026";
const PRICES = {
  "Aceite de girasol 1 L": { p: 5200, n: "Cañuelas 1,5 L · oferta -20% · $3.467/L" },
  "Agua mineral bidón": { p: 3600, n: "DIA 6,25 L" },
  "Arroz integral 1 kg": { p: 1395, n: "Cuquets 1 kg · oferta -34%" },
  "Atún": { p: 1390, n: "Desmenuzado DIA 170 g · lomitos DIA $2.300 c/oferta" },
  "Azúcar 500 g": { p: 590, n: "Azucel 500 g · oferta -17%" },
  "Grasa bovina 1 kg": { p: 5100, n: "2× Grasa Bovina DIA 500 g · oferta -15% · gana al 1 kg ($6.800)" },
  "Harina de maíz 1 kg": { p: 3650, n: "Morixe p/arepas 1 kg" },
  "Leche larga vida": { p: 1700, n: "DIA entera 1 L · oferta -22%" },
  "Maicena 500 g": { p: 4089, n: "Maizena clásica 500 g" },
  "Papas fritas": { p: 4601, n: "Tubo DIA sabor original 150 g" },
  "Polenta 1 kg": { p: 1390, n: "2× Molinos Ala 500 g · oferta -35%" },
  "Sal entrefina 500 g": { p: 840, n: "DIA Parrillera 500 g" },
  "Sal fina 500 g": { p: 650, n: "DIA 500 g · oferta -34%" },
  "Sal gruesa 500 g": { p: 1050, n: "DIA 1 kg · mejor $/kg" },
  "Vinagre de alcohol 1 L": { p: 1565, n: "DIA 1 L" },
  "Vinagre de manzana 1 L": { p: 4060, n: "2× DIA 500 ml" },
  "Yerba 1 kg": { p: 3200, n: "Amanda Tradicional 1 kg · oferta -35%" },
};
const fmt = (n) => "$ " + Math.round(n).toLocaleString("es-AR");

const hoyStr = () => {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  return p2(d.getDate()) + "/" + p2(d.getMonth() + 1) + "/" + d.getFullYear();
};

const difTxt = (nuevo, viejo) => {
  const d = Math.round((nuevo / viejo - 1) * 100);
  return d === 0 ? "igual" : (d > 0 ? "+" : "") + d + "%";
};

/* Compra con precio cargado a mano (askPrice, hoy solo Huevo): marca comprado, guarda
   el pago en el historial (últimos 12) y arma la nota comparativa contra el anterior */
function compraConPrecio(it, precio, priceDate) {
  const fecha = hoyStr();
  const previos = (it.priceHist || []).filter((h) => h.t !== fecha); // corregir el mismo día no duplica
  const ult = previos[previos.length - 1];
  const nota = "Pagado el " + fecha + (ult && ult.p > 0 ? ` · antes ${fmt(ult.p)} (${difTxt(precio, ult.p)})` : "");
  return {
    have: true,
    price: precio,
    priceNote: nota,
    priceV: "manual@" + priceDate,
    priceHist: [...previos, { p: precio, t: fecha }].slice(-12),
  };
}

/* Aplica un set de precios sobre las listas, respetando ediciones manuales de la misma versión */
function applyPrices(stores, prices, version) {
  return stores.map((s) => ({
    ...s,
    sections: s.sections.map((sec) => ({
      ...sec,
      items: sec.items.map((it) => {
        const snap = prices[it.name];
        if (snap && snap.p > 0 && it.priceV !== version && it.priceV !== "manual@" + version) {
          return { ...it, price: snap.p, priceNote: snap.n || "", priceV: version };
        }
        return it;
      }),
    })),
  }));
}

/* Normaliza datos guardados con versiones anteriores de la app */
function migrate(stores) {
  let out = stores.map((s) => ({
    ...s,
    sections: s.sections.map((sec) => ({
      ...sec,
      items: sec.items.map((it) => (it.type === "pick" ? it : { ...it, askSpec: SPEC_ITEMS.includes(it.name), askPrice: ASK_PRICE_ITEMS.includes(it.name) })),
    })),
  }));

  // v2 · Huevo: de Verdulería a Dietética (conservando su estado)
  let huevo = null;
  out = out.map((s) => s.id !== "verdu" ? s : {
    ...s,
    sections: s.sections.map((sec) => {
      const found = sec.items.find((it) => it.name === "Huevo");
      if (found) huevo = found;
      return found ? { ...sec, items: sec.items.filter((it) => it.name !== "Huevo") } : sec;
    }),
  });
  if (huevo) {
    out = out.map((s) => s.id !== "diet" ? s : {
      ...s,
      sections: s.sections.map((sec) => {
        if (sec.name !== "Perecederos" || sec.items.some((it) => it.name === "Huevo")) return sec;
        return { ...sec, items: [huevo, ...sec.items] };
      }),
    });
  }

  // v2 · Farmacity: sumar Desodorante y Preservativos si no están
  out = out.map((s) => s.id !== "farma" ? s : {
    ...s,
    sections: s.sections.map((sec) => {
      if (sec.name !== "Higiene") return sec;
      const nuevos = [];
      if (!sec.items.some((it) => it.name === "Desodorante")) nuevos.push({ id: "mig-deso", name: "Desodorante", note: "", spec: "", have: true });
      if (!sec.items.some((it) => it.name === "Preservativos")) nuevos.push({ id: "mig-prese", name: "Preservativos", note: "", spec: "", have: true });
      return nuevos.length ? { ...sec, items: [...sec.items, ...nuevos] } : sec;
    }),
  });

  // v3 · Estructurales: sumar Alcaucil y Espárragos a las opciones
  out = out.map((s) => s.id !== "verdu" ? s : {
    ...s,
    sections: s.sections.map((sec) => ({
      ...sec,
      items: sec.items.map((it) => {
        if (it.type !== "pick" || it.name !== "Estructurales") return it;
        const faltan = ["Alcaucil", "Espárragos"].filter((n) => !it.options.includes(n));
        return faltan.length ? { ...it, options: [...it.options, ...faltan] } : it;
      }),
    })),
  });

  // v4 · COTO: combo unificado en un solo ítem + bandera de temporada en Carnicería
  out = out.map((s) => s.id !== "coto" ? s : {
    ...s,
    sections: s.sections.map((sec) => {
      if (sec.name !== "Carnicería") return sec;
      let items = sec.items;
      const viejos = items.filter((it) => it.name === "Combo de temporada · corte 1" || it.name === "Combo de temporada · corte 2");
      if (viejos.length > 0) {
        const pendiente = viejos.some((it) => !it.have);
        const idx = items.indexOf(viejos[0]);
        items = items.filter((it) => !viejos.includes(it));
        items = [
          ...items.slice(0, idx),
          { id: "mig-combo", name: "Combo de temporada", note: "", spec: "", have: !pendiente, dyn: "combo" },
          ...items.slice(idx),
        ];
      }
      return { ...sec, banner: "carne", items };
    }),
  });

  // v6 · Dietética: sumar Piñones a Perecederos (precio de referencia de New Garden)
  out = out.map((s) => s.id !== "diet" ? s : {
    ...s,
    sections: s.sections.map((sec) => {
      if (sec.name !== "Perecederos" || sec.items.some((it) => it.name === "Piñones")) return sec;
      const idx = sec.items.findIndex((it) => it.name === "Nueces 500 g");
      const nuevo = { id: "mig-pinones", name: "Piñones", note: "", spec: "", have: true };
      const items = idx >= 0 ? [...sec.items.slice(0, idx + 1), nuevo, ...sec.items.slice(idx + 1)] : [...sec.items, nuevo];
      return { ...sec, items };
    }),
  });

  // v7 · Salsa de pescado pasa de "Otros lugares" a Dietética/Muy duraderos
  //      y Champiñones congelados se convierte en Hongos para cocinar (Carmín)
  const dietTieneSalsa = out.some((s) => s.id === "diet" && s.sections.some((sec) => sec.items.some((it) => it.name === "Salsa de pescado")));
  const dietTieneMuyDuraderos = out.some((s) => s.id === "diet" && s.sections.some((sec) => sec.name === "Muy duraderos"));
  let salsa = null;
  if (dietTieneSalsa || dietTieneMuyDuraderos) {
    out = out.map((s) => s.id !== "otros" ? s : {
      ...s,
      sections: s.sections
        .map((sec) => {
          const found = sec.items.find((it) => it.name === "Salsa de pescado");
          if (found) salsa = found;
          return found ? { ...sec, items: sec.items.filter((it) => it.name !== "Salsa de pescado") } : sec;
        })
        .filter((sec) => !(sec.name === "New Garden" && sec.items.length === 0)),
    });
  }
  if (salsa && !dietTieneSalsa) {
    out = out.map((s) => s.id !== "diet" ? s : {
      ...s,
      sections: s.sections.map((sec) => sec.name !== "Muy duraderos" ? sec : { ...sec, items: [...sec.items, { ...salsa, note: salsa.note || "La compramos en New Garden" }] }),
    });
  }
  out = out.map((s) => s.id !== "otros" ? s : {
    ...s,
    sections: s.sections.map((sec) => ({
      ...sec,
      items: sec.items.map((it) => it.name === "Champiñones congelados"
        ? { ...it, name: "Hongos para cocinar", price: 0, priceNote: "", priceV: "" }
        : it),
    })),
  });

  // v8 · Farmacity: sumar Alcohol en gel a Higiene
  out = out.map((s) => s.id !== "farma" ? s : {
    ...s,
    sections: s.sections.map((sec) => {
      if (sec.name !== "Higiene" || sec.items.some((it) => it.name === "Alcohol en gel")) return sec;
      const idx = sec.items.findIndex((it) => it.name === "Alcohol");
      const nuevo = { id: "mig-alcogel", name: "Alcohol en gel", note: "", spec: "", have: true };
      const items = idx >= 0 ? [...sec.items.slice(0, idx + 1), nuevo, ...sec.items.slice(idx + 1)] : [...sec.items, nuevo];
      return { ...sec, items };
    }),
  });

  // v9 · askPrice (Huevo): historial de pagos; se siembra una sola vez desde el precio
  //      manual que ya estuviera cargado (la fecha sale del propio priceV)
  out = out.map((s) => ({
    ...s,
    sections: s.sections.map((sec) => ({
      ...sec,
      items: sec.items.map((it) => {
        if (!ASK_PRICE_ITEMS.includes(it.name)) return it;
        if (Array.isArray(it.priceHist) && it.priceHist.length > 0) return it;
        if (it.price > 0 && typeof it.priceV === "string" && it.priceV.startsWith("manual@")) {
          return { ...it, priceHist: [{ p: it.price, t: it.priceV.slice("manual@".length) }] };
        }
        return { ...it, priceHist: [] };
      }),
    })),
  }));

  // v5 · asegurar campos de precio y aplicar la foto embebida como base
  out = out.map((s) => ({
    ...s,
    sections: s.sections.map((sec) => ({
      ...sec,
      items: sec.items.map((it) => ({ ...it, price: it.price || 0, priceNote: it.priceNote || "", priceV: it.priceV || "" })),
    })),
  }));
  out = applyPrices(out, PRICES, PRICE_SNAPSHOT_V);

  return out;
}

/* ---------- Componentes chicos ---------- */

function SeasonBadge({ name, month }) {
  const s = seasonOf(name, month);
  if (!s || s === "out") return null;
  const styles = {
    peak: { background: "#FFE8C7", color: "#8A4B00", label: "🔥 plena temporada" },
    in: { background: "#E2F0DA", color: "#2F5E14", label: "en temporada" },
  }[s];
  return (
    <span className="rounded-full font-medium" style={{ background: styles.background, color: styles.color, fontSize: 10, padding: "2px 8px", whiteSpace: "nowrap" }}>
      {styles.label}
    </span>
  );
}

function CircleBuy({ color, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label="Marcar como comprado"
      className="rounded-full border-2 flex-shrink-0 transition-colors"
      style={{ width: 26, height: 26, borderColor: color, marginTop: 2, background: "transparent" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = color + "22"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    />
  );
}

function SpecEditor({ value, color, onSave }) {
  const [txt, setTxt] = useState(value || "");
  return (
    <div className="flex gap-2 mt-1 items-center">
      <input
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        placeholder="¿Qué buscar esta vez?"
        className="flex-1 rounded-lg border px-2 py-1 text-sm"
        style={{ borderColor: "#D8D2C4", background: "#FFFFFF", color: "#2B2620", outline: "none" }}
      />
      <button onClick={() => onSave(txt)} className="text-sm font-semibold rounded-lg px-2 py-1" style={{ color: "#FFFFFF", background: color }}>
        OK
      </button>
    </div>
  );
}

/* Editor inline del precio pagado (askPrice): aparece al marcar comprado */
function PriceEditor({ color, prev, onSave, onSkip }) {
  const [txt, setTxt] = useState("");
  const val = parseFloat(txt);
  const ok = val > 0;
  return (
    <div className="mt-1">
      <div className="flex gap-2 items-center">
        <span className="text-sm font-semibold" style={{ color: "#8A8170" }}>$</span>
        <input
          type="number" min="0" step="any" inputMode="decimal" autoFocus
          value={txt}
          onChange={(e) => setTxt(e.target.value)}
          placeholder="¿Cuánto pagaste?"
          className="flex-1 rounded-lg border px-2 py-1 text-sm"
          style={{ borderColor: "#D8D2C4", background: "#FFFFFF", color: "#2B2620", outline: "none" }}
        />
        <button onClick={() => ok && onSave(val)} disabled={!ok} className="text-sm font-semibold rounded-lg px-2 py-1"
          style={{ color: "#FFFFFF", background: ok ? color : "#E5E1D6" }}>
          OK
        </button>
        <button onClick={onSkip} className="text-xs flex-shrink-0" style={{ color: "#A39B89" }}>sin precio</button>
      </div>
      {prev && prev.p > 0 ? (
        <div className="text-xs mt-1" style={{ color: "#8A8170" }}>
          Última vez {fmt(prev.p)} ({prev.t.slice(0, 5)}){ok ? ` · esta vez ${difTxt(val, prev.p)}` : ""}
        </div>
      ) : null}
    </div>
  );
}

/* Ítem pendiente normal (con nota / spec / precio al comprar) */
function PendingRow({ it, color, month, onBuy, onSpec, priceDate }) {
  const [editingSpec, setEditingSpec] = useState(!!it.askSpec && !it.spec);
  const [askingPrice, setAskingPrice] = useState(false);
  const note = it.dyn ? dynNote(it.dyn, month) : it.note;
  const hist = it.priceHist || [];
  return (
    <div className="flex items-start gap-3 py-2">
      <CircleBuy color={color} onClick={it.askPrice ? () => setAskingPrice((p) => !p) : () => onBuy()} />
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium" style={{ color: "#2B2620" }}>{it.name || "(sin nombre)"}</span>
          <SeasonBadge name={it.name} month={month} />
        </div>
        {note ? <div className="text-xs mt-1" style={{ color: "#8A8170" }}>{note}</div> : null}
        {it.price > 0 && it.priceNote && !(it.askPrice && hist.length > 0) ? (
          <div className="text-xs mt-1 font-medium" style={{ color: "#4E6B35" }}>→ {it.priceNote}</div>
        ) : null}
        {it.askPrice && hist.length > 0 ? (
          <div className="text-xs mt-1 italic" style={{ color: "#A39B89" }}>
            Pagado antes: {hist.slice(-3).reverse().map((h) => `${fmt(h.p)} (${h.t.slice(0, 5)})`).join(" · ")}
          </div>
        ) : null}
        {askingPrice ? (
          <PriceEditor color={color} prev={hist[hist.length - 1]}
            onSave={(v) => onBuy(compraConPrecio(it, v, priceDate))}
            onSkip={() => onBuy()} />
        ) : null}
        {it.askSpec ? (
          editingSpec ? (
            <SpecEditor value={it.spec} color={color} onSave={(v) => { onSpec(v); setEditingSpec(false); }} />
          ) : (
            <div className="flex items-center gap-2 mt-1">
              {it.spec ? <span className="text-sm italic" style={{ color }}>{it.spec}</span> : null}
              <button onClick={() => setEditingSpec(true)} className="text-xs" style={{ color: "#A39B89" }}>
                {it.spec ? "editar" : "+ qué buscar"}
              </button>
            </div>
          )
        ) : null}
      </div>
      {it.price > 0 ? (
        <span className="text-sm font-semibold flex-shrink-0" style={{ color: "#2B2620", marginTop: 3 }}>{fmt(it.price)}</span>
      ) : null}
    </div>
  );
}

/* Ítem pendiente de tipo "elegir de la categoría" */
function PickPending({ it, color, month, onConfirm }) {
  const [sel, setSel] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const order = { peak: 0, in: 1, none: 2, out: 3 };
  const opts = [...it.options].sort((a, b) => {
    const sa = seasonOf(a, month) || "none";
    const sb = seasonOf(b, month) || "none";
    if (order[sa] !== order[sb]) return order[sa] - order[sb];
    return a.localeCompare(b);
  });
  const shown = showAll || opts.length <= 10 ? opts : opts.slice(0, 8);
  const toggle = (name) => setSel((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]));
  return (
    <div className="py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium" style={{ color: "#2B2620" }}>{it.name}</span>
        <span className="text-xs rounded-full" style={{ background: color + "18", color, padding: "2px 8px" }}>elegí al menos 1</span>
        {it.price > 0 ? (
          <span className="text-sm font-semibold" style={{ color: "#2B2620", marginLeft: "auto" }}>{fmt(it.price)}</span>
        ) : null}
      </div>
      {it.note ? <div className="text-xs mt-1" style={{ color: "#8A8170" }}>{it.note}</div> : null}
      {it.price > 0 && it.priceNote ? (
        <div className="text-xs mt-1 font-medium" style={{ color: "#4E6B35" }}>→ {it.priceNote}</div>
      ) : null}
      {it.picked && it.picked.length > 0 ? (
        <div className="text-xs mt-1 italic" style={{ color: "#A39B89" }}>Última vez: {it.picked.join(", ")}</div>
      ) : null}
      <div className="flex flex-wrap gap-2 mt-2">
        {shown.map((name) => {
          const s = seasonOf(name, month);
          const selected = sel.includes(name);
          return (
            <button
              key={name}
              onClick={() => toggle(name)}
              className="rounded-full border text-sm transition-colors"
              style={{
                padding: "4px 12px",
                borderColor: selected ? color : s === "peak" ? "#E0A23C" : "#D8D2C4",
                background: selected ? color : s === "peak" ? "#FFF4E0" : "#FFFFFF",
                color: selected ? "#FFFFFF" : s === "out" ? "#B3AB9A" : "#2B2620",
              }}
            >
              {s === "peak" && !selected ? "🔥 " : ""}{name}
            </button>
          );
        })}
        {!showAll && opts.length > 10 ? (
          <button onClick={() => setShowAll(true)} className="rounded-full text-sm" style={{ padding: "4px 12px", color, background: "transparent" }}>
            ver todas ({opts.length})
          </button>
        ) : null}
      </div>
      <button
        onClick={() => sel.length > 0 && onConfirm(sel)}
        disabled={sel.length === 0}
        className="mt-2 rounded-lg font-semibold text-sm"
        style={{ padding: "6px 14px", background: sel.length ? color : "#E5E1D6", color: sel.length ? "#FFFFFF" : "#A39B89" }}
      >
        Comprado {sel.length > 0 ? `(${sel.length})` : ""}
      </button>
    </div>
  );
}

/* ---------- Vista: COMPRAR ---------- */
function ShoppingView({ stores, month, patchItem, buyAll, priceDate }) {
  const [collapsed, setCollapsed] = useState({});
  const [secClosed, setSecClosed] = useState({});
  const pendings = stores.map((s) => ({
    store: s,
    rows: s.sections
      .map((sec) => ({ sec, items: sec.items.filter((i) => !i.have) }))
      .filter((g) => g.items.length > 0),
  })).filter((g) => g.rows.length > 0);

  if (pendings.length === 0) {
    return (
      <div className="text-center py-3" style={{ color: "#8A8170" }}>
        <div style={{ fontSize: 40 }}>🧺</div>
        <p className="mt-2 font-medium" style={{ color: "#2B2620" }}>Nada pendiente</p>
        <p className="text-sm mt-1">Cuando se te termine algo, destildalo en <b>Listas</b> y aparece acá, agrupado por comercio.</p>
      </div>
    );
  }

  const allCollapsed = pendings.every((p) => collapsed[p.store.id]);
  const toggleAll = () => {
    const next = {};
    pendings.forEach((p) => { next[p.store.id] = !allCollapsed; });
    setCollapsed(next);
  };

  const totalEst = pendings.reduce((a, g) => a + g.rows.reduce((b, r) => b + r.items.reduce((c, i) => c + (i.price > 0 ? i.price : 0), 0), 0), 0);
  const totalSinPrecio = pendings.reduce((a, g) => a + g.rows.reduce((b, r) => b + r.items.filter((i) => !(i.price > 0)).length, 0), 0);

  return (
    <div className="space-y-4">
      {totalEst > 0 ? (
        <section className="rounded-xl px-4 py-3" style={{ background: "#2B2620", color: "#F4F5F1" }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Total estimado</span>
            <span className="font-bold" style={{ fontSize: 18 }}>{fmt(totalEst)}</span>
          </div>
          <div className="text-xs mt-1" style={{ color: "#B3AB9A" }}>
            Precios al {priceDate}{totalSinPrecio > 0 ? ` · ${totalSinPrecio} ítems sin precio` : ""} · editables en Listas → Editar
          </div>
        </section>
      ) : null}
      <div className="flex justify-end">
        <button onClick={toggleAll} className="text-xs font-semibold uppercase" style={{ color: "#8A8170", letterSpacing: "0.06em" }}>
          {allCollapsed ? "▾ Expandir todo" : "▴ Compactar todo"}
        </button>
      </div>
      {pendings.map(({ store, rows }) => {
        const count = rows.reduce((a, g) => a + g.items.length, 0);
        const subtotal = rows.reduce((a, g) => a + g.items.reduce((b, i) => b + (i.price > 0 ? i.price : 0), 0), 0);
        const isCollapsed = !!collapsed[store.id];
        return (
          <section key={store.id} className="rounded-xl overflow-hidden" style={{ background: "#FFFFFF", border: "1px solid #E8E2D6", borderLeft: `6px solid ${store.color}` }}>
            <header
              onClick={() => setCollapsed((p) => ({ ...p, [store.id]: !isCollapsed }))}
              className="flex items-center justify-between px-4 py-3 select-none"
              style={{ borderBottom: isCollapsed ? "none" : "1px solid #F0EBE0", cursor: "pointer" }}
            >
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 18 }}>{store.emoji}</span>
                <h2 className="font-semibold uppercase" style={{ color: "#2B2620", letterSpacing: "0.06em", fontFamily: "Futura, 'Trebuchet MS', 'Century Gothic', sans-serif" }}>{store.name}</h2>
                <span className="rounded-full text-xs font-semibold" style={{ background: store.color, color: "#FFFFFF", padding: "1px 8px" }}>{count}</span>
                {subtotal > 0 ? <span className="text-xs font-semibold" style={{ color: "#6E6757" }}>≈ {fmt(subtotal)}</span> : null}
              </div>
              <div className="flex items-center gap-3">
                {!isCollapsed ? (
                  <button onClick={(e) => { e.stopPropagation(); buyAll(store.id); }} className="text-xs font-medium" style={{ color: store.color }}>
                    ✓ todo comprado
                  </button>
                ) : null}
                <span style={{ color: "#A39B89" }}>{isCollapsed ? "▾" : "▴"}</span>
              </div>
            </header>
            {!isCollapsed ? (
              <div className="px-4 pb-2">
                {rows.map(({ sec, items }) => {
                  const sk = store.id + ":" + sec.id;
                  const secIsClosed = !!secClosed[sk];
                  return (
                    <div key={sec.id} className="pt-2">
                      <button
                        onClick={() => setSecClosed((p) => ({ ...p, [sk]: !secIsClosed }))}
                        className="w-full flex items-center justify-between select-none"
                      >
                        <span className="text-xs uppercase font-semibold" style={{ color: "#A39B89", letterSpacing: "0.08em" }}>{sec.name}</span>
                        <span className="flex items-center gap-2">
                          {secIsClosed ? (
                            <span className="rounded-full text-xs font-semibold" style={{ background: store.color + "1E", color: store.color, padding: "0px 7px" }}>{items.length}</span>
                          ) : null}
                          <span className="text-xs" style={{ color: "#C9C2B2" }}>{secIsClosed ? "▾" : "▴"}</span>
                        </span>
                      </button>
                      {!secIsClosed ? (
                        <>
                          {sec.banner === "carne" ? <CarneBanner month={month} /> : null}
                          <div style={{ borderTop: "1px dashed #EDE8DC" }}>
                            {items.map((it) =>
                              it.type === "pick" ? (
                                <PickPending key={it.id} it={it} color={store.color} month={month}
                                  onConfirm={(sel) => patchItem(store.id, sec.id, it.id, { have: true, picked: sel })} />
                              ) : (
                                <PendingRow key={it.id} it={it} color={store.color} month={month} priceDate={priceDate}
                                  onBuy={(patch) => patchItem(store.id, sec.id, it.id, patch || { have: true })}
                                  onSpec={(v) => patchItem(store.id, sec.id, it.id, { spec: v })} />
                              )
                            )}
                          </div>
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/* ---------- Vista: LISTAS ---------- */
function ListsView({ stores, month, patchItem, addItem, delItem, resetAll, priceDate }) {
  const [open, setOpen] = useState({});
  const [secClosed, setSecClosed] = useState({});
  const [edit, setEdit] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: "#8A8170" }}>
          Tildado = en stock. <b>Destildá lo que se te terminó</b> y pasa a Comprar.
        </p>
        <button
          onClick={() => setEdit(!edit)}
          className="rounded-lg text-sm font-semibold flex-shrink-0"
          style={{ padding: "6px 12px", background: edit ? "#2B2620" : "#FFFFFF", color: edit ? "#FFFFFF" : "#2B2620", border: "1px solid #D8D2C4", marginLeft: 8 }}
        >
          {edit ? "Listo" : "Editar"}
        </button>
      </div>

      {stores.map((store) => {
        const total = store.sections.reduce((a, s) => a + s.items.length, 0);
        const pending = store.sections.reduce((a, s) => a + s.items.filter((i) => !i.have).length, 0);
        const isOpen = !!open[store.id];
        return (
          <section key={store.id} className="rounded-xl overflow-hidden" style={{ background: "#FFFFFF", border: "1px solid #E8E2D6", borderLeft: `6px solid ${store.color}` }}>
            <button onClick={() => setOpen((p) => ({ ...p, [store.id]: !isOpen }))} className="w-full flex items-center justify-between px-4 py-3 text-left">
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 18 }}>{store.emoji}</span>
                <span className="font-semibold uppercase" style={{ color: "#2B2620", letterSpacing: "0.06em", fontFamily: "Futura, 'Trebuchet MS', 'Century Gothic', sans-serif" }}>{store.name}</span>
                {pending > 0 ? (
                  <span className="rounded-full text-xs font-semibold" style={{ background: store.color, color: "#FFFFFF", padding: "1px 8px" }}>{pending} por comprar</span>
                ) : (
                  <span className="text-xs" style={{ color: "#A39B89" }}>{total} ítems</span>
                )}
              </div>
              <span style={{ color: "#A39B89" }}>{isOpen ? "▴" : "▾"}</span>
            </button>
            {isOpen ? (
              <div className="px-4 pb-3">
                {store.note ? <p className="text-xs italic mb-2" style={{ color: "#A39B89" }}>{store.note}</p> : null}
                {store.sections.map((sec) => {
                  const sk = store.id + ":" + sec.id;
                  const secIsClosed = !!secClosed[sk];
                  const secPending = sec.items.filter((i) => !i.have).length;
                  return (
                    <div key={sec.id} className="pt-1 pb-2">
                      <button
                        onClick={() => setSecClosed((p) => ({ ...p, [sk]: !secIsClosed }))}
                        className="w-full flex items-center justify-between py-1 select-none"
                        style={{ borderBottom: "1px dashed #EDE8DC" }}
                      >
                        <span className="text-xs uppercase font-semibold" style={{ color: "#A39B89", letterSpacing: "0.08em" }}>{sec.name}</span>
                        <span className="flex items-center gap-2">
                          {secIsClosed && secPending > 0 ? (
                            <span className="rounded-full text-xs font-semibold" style={{ background: store.color, color: "#FFFFFF", padding: "0px 7px" }}>{secPending}</span>
                          ) : null}
                          {secIsClosed ? (
                            <span className="text-xs" style={{ color: "#C9C2B2" }}>{sec.items.length} ítems</span>
                          ) : null}
                          <span className="text-xs" style={{ color: "#C9C2B2" }}>{secIsClosed ? "▾" : "▴"}</span>
                        </span>
                      </button>
                      {!secIsClosed ? (
                        <div>
                          {sec.banner === "carne" ? <CarneBanner month={month} /> : null}
                          {sec.items.map((it) => (
                            edit ? (
                              <EditRow key={it.id} it={it} priceDate={priceDate}
                                onPatch={(patch) => patchItem(store.id, sec.id, it.id, patch)}
                                onDel={() => delItem(store.id, sec.id, it.id)} />
                            ) : (
                              <DisplayRow key={it.id} it={it} color={store.color} month={month}
                                onToggle={() => patchItem(store.id, sec.id, it.id, (prev) => ({ have: !prev.have }))} />
                            )
                          ))}
                          {edit ? (
                            <button onClick={() => addItem(store.id, sec.id)} className="text-sm font-medium mt-1" style={{ color: store.color }}>
                              + Agregar ítem
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>
        );
      })}

      <div className="text-center pt-2">
        <button
          onClick={() => { if (confirmReset) { resetAll(); setConfirmReset(false); } else { setConfirmReset(true); setTimeout(() => setConfirmReset(false), 4000); } }}
          className="text-xs"
          style={{ color: confirmReset ? "#D7263D" : "#B3AB9A" }}
        >
          {confirmReset ? "¿Seguro? Tocá de nuevo para restaurar las listas originales" : "Restaurar listas originales"}
        </button>
      </div>
    </div>
  );
}

function DisplayRow({ it, color, month, onToggle }) {
  return (
    <div className="flex items-start gap-3 py-2" style={{ borderBottom: "1px solid #F6F2EA" }}>
      <button
        onClick={onToggle}
        aria-label={it.have ? "Marcar como faltante" : "Marcar en stock"}
        className="rounded flex-shrink-0 flex items-center justify-center text-xs font-bold"
        style={{
          width: 22, height: 22, marginTop: 2,
          border: `2px solid ${it.have ? "#C9C2B2" : color}`,
          background: it.have ? "#F1EDE3" : "#FFFFFF",
          color: it.have ? "#8A8170" : color,
        }}
      >
        {it.have ? "✓" : ""}
      </button>
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span style={{ color: it.have ? "#6E6757" : "#2B2620", fontWeight: it.have ? 400 : 600 }}>{it.name || "(sin nombre)"}</span>
          {!it.have ? <span className="text-xs font-semibold" style={{ color }}>· por comprar</span> : null}
          <SeasonBadge name={it.name} month={month} />
        </div>
        {it.dyn ? <div className="text-xs mt-1" style={{ color: "#8A8170" }}>{dynNote(it.dyn, month)}</div> : it.note ? <div className="text-xs mt-1" style={{ color: "#8A8170" }}>{it.note}</div> : null}
        {it.price > 0 && it.priceNote ? <div className="text-xs mt-1" style={{ color: "#A39B89" }}>{it.priceNote}</div> : null}
        {it.type === "pick" && it.picked && it.picked.length > 0 ? (
          <div className="text-xs mt-1 italic" style={{ color: "#A39B89" }}>Última compra: {it.picked.join(", ")}</div>
        ) : null}
        {it.askSpec && it.spec ? <div className="text-xs mt-1 italic" style={{ color }}>{it.spec}</div> : null}
      </div>
      {it.price > 0 ? (
        <span className="text-sm font-semibold flex-shrink-0" style={{ color: it.have ? "#A39B89" : "#2B2620", marginTop: 2 }}>{fmt(it.price)}</span>
      ) : null}
    </div>
  );
}

function EditRow({ it, onPatch, onDel, priceDate }) {
  return (
    <div className="py-2 space-y-1" style={{ borderBottom: "1px solid #F6F2EA" }}>
      <div className="flex items-center gap-2">
        <input
          value={it.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          placeholder="Nombre del producto"
          className="flex-1 rounded-lg border px-2 py-1 text-sm font-medium"
          style={{ borderColor: "#D8D2C4", background: "#FFFFFF", color: "#2B2620", outline: "none" }}
        />
        <button onClick={onDel} aria-label="Eliminar" className="text-sm flex-shrink-0" style={{ color: "#D7263D" }}>🗑</button>
      </div>
      <input
        value={it.note || ""}
        onChange={(e) => onPatch({ note: e.target.value })}
        placeholder="Nota (opcional)"
        className="w-full rounded-lg border px-2 py-1 text-xs"
        style={{ borderColor: "#E5E1D6", background: "#FCFBF7", color: "#6E6757", outline: "none" }}
      />
      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: "#8A8170" }}>Precio $</span>
        <input
          type="number"
          min="0"
          value={it.price ? it.price : ""}
          onChange={(e) => onPatch({ price: e.target.value === "" ? 0 : Math.max(0, parseFloat(e.target.value) || 0), priceV: "manual@" + priceDate })}
          placeholder="0"
          className="rounded-lg border px-2 py-1 text-sm"
          style={{ borderColor: "#E5E1D6", background: "#FCFBF7", color: "#2B2620", outline: "none", width: 110 }}
        />
      </div>
      {it.type === "pick" ? (
        <input
          key={it.id + "-opts"}
          defaultValue={it.options.join(", ")}
          onBlur={(e) => onPatch({ options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
          placeholder="Opciones separadas por coma"
          className="w-full rounded-lg border px-2 py-1 text-xs"
          style={{ borderColor: "#E5E1D6", background: "#FCFBF7", color: "#6E6757", outline: "none" }}
        />
      ) : null}
    </div>
  );
}

/* ---------- Vista: TEMPORADA ---------- */
function SeasonView({ month }) {
  const est = estacionDe(month);
  const next = (month % 12) + 1;
  const entries = Object.entries(SEASON);
  const list = (kind) =>
    entries
      .filter(([, d]) => d.k === kind && d.m.includes(month))
      .sort(([a, da], [b, db]) => {
        const pa = da.p.includes(month) ? 0 : 1;
        const pb = db.p.includes(month) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return a.localeCompare(b);
      });
  const ending = entries.filter(([, d]) => d.m.includes(month) && !d.m.includes(next)).map(([n]) => n);
  const coming = entries.filter(([, d]) => !d.m.includes(month) && d.m.includes(next)).map(([n]) => n);

  const Chip = ({ name, peak }) => (
    <span className="rounded-full text-sm" style={{
      padding: "4px 12px",
      background: peak ? "#FFE8C7" : "#FFFFFF",
      border: `1px solid ${peak ? "#E0A23C" : "#E0DACB"}`,
      color: peak ? "#8A4B00" : "#2B2620",
      fontWeight: peak ? 600 : 400,
    }}>
      {peak ? "🔥 " : ""}{name}
    </span>
  );

  const Card = ({ title, children }) => (
    <section className="rounded-xl px-4 py-3" style={{ background: "#FFFFFF", border: "1px solid #E8E2D6" }}>
      <h3 className="text-xs uppercase font-semibold mb-2" style={{ color: "#A39B89", letterSpacing: "0.08em" }}>{title}</h3>
      {children}
    </section>
  );

  return (
    <div className="space-y-4">
      <div className="text-center py-2">
        <div style={{ fontSize: 36 }}>{est.emoji}</div>
        <h2 className="font-semibold" style={{ color: "#2B2620", fontSize: 20, fontFamily: "Futura, 'Trebuchet MS', 'Century Gothic', sans-serif" }}>
          {MESES[month - 1].charAt(0).toUpperCase() + MESES[month - 1].slice(1)} · {est.name}
        </h2>
        <p className="text-xs mt-1" style={{ color: "#A39B89" }}>La quinta se actualiza sola con la fecha. 🔥 = punto justo de precio y sabor.</p>
      </div>

      <Card title="Frutas en temporada">
        <div className="flex flex-wrap gap-2">
          {list("f").map(([name, d]) => <Chip key={name} name={name} peak={d.p.includes(month)} />)}
        </div>
      </Card>

      <Card title="Verduras en temporada">
        <div className="flex flex-wrap gap-2">
          {list("v").map(([name, d]) => <Chip key={name} name={name} peak={d.p.includes(month)} />)}
        </div>
      </Card>

      {ending.length > 0 ? (
        <Card title="Últimas semanas · aprovechá">
          <div className="flex flex-wrap gap-2">{ending.map((n) => <Chip key={n} name={n} peak={false} />)}</div>
        </Card>
      ) : null}

      {coming.length > 0 ? (
        <Card title={`Se viene en ${MESES[next - 1]}`}>
          <div className="flex flex-wrap gap-2">{coming.map((n) => <Chip key={n} name={n} peak={false} />)}</div>
        </Card>
      ) : null}

      <Card title="Carnicería COTO · temporada">
        <CarneBanner month={month} />
        <div className="space-y-1 text-sm mt-1" style={{ color: "#2B2620" }}>
          <p><b>Combo:</b> {dynNote("combo", month)}</p>
          <p><b>Roast beef:</b> {dynNote("roast", month).toLowerCase()}</p>
        </div>
      </Card>
    </div>
  );
}

/* ---------- App ---------- */
function App() {
  const [stores, setStores] = useState(null);
  const [tab, setTab] = useState("comprar");
  const [loaded, setLoaded] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  const [priceDate, setPriceDate] = useState(PRICE_SNAPSHOT_V);
  const first = useRef(true);

  const now = new Date();
  const month = now.getMonth() + 1;
  const est = estacionDe(month);

  useEffect(() => {
    let data = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) data = JSON.parse(raw);
    } catch (e) { /* primera vez o datos corruptos */ }
    setStores(migrate(data && data.stores ? data.stores : seedStores()));
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded || !stores) return;
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify({ stores }));
        setSaveErr(false);
      } catch (e) { setSaveErr(true); }
    }, 300);
    return () => clearTimeout(t);
  }, [stores, loaded]);

  // Precios frescos: si el sitio publica precios.json, se aplica sobre lo guardado.
  // Falla en silencio sin conexión (o en el artefacto de Claude): quedan los últimos conocidos.
  useEffect(() => {
    if (!loaded) return;
    fetch("./precios.json", { cache: "no-store" })
      .then((r) => (r && r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.prices && data.version) {
          setPriceDate(data.version);
          setStores((prev) => (prev ? applyPrices(prev, data.prices, data.version) : prev));
        }
      })
      .catch(() => {});
  }, [loaded]);

  const patchItem = (sId, secId, itId, patch) =>
    setStores((prev) => prev.map((s) => s.id !== sId ? s : {
      ...s,
      sections: s.sections.map((sec) => sec.id !== secId ? sec : {
        ...sec,
        items: sec.items.map((it) => it.id !== itId ? it : { ...it, ...(typeof patch === "function" ? patch(it) : patch) }),
      }),
    }));

  const addItem = (sId, secId) =>
    setStores((prev) => prev.map((s) => s.id !== sId ? s : {
      ...s,
      sections: s.sections.map((sec) => sec.id !== secId ? sec : {
        ...sec,
        items: [...sec.items, { id: "n" + Date.now(), name: "", note: "", spec: "", have: false }],
      }),
    }));

  const delItem = (sId, secId, itId) =>
    setStores((prev) => prev.map((s) => s.id !== sId ? s : {
      ...s,
      sections: s.sections.map((sec) => sec.id !== secId ? sec : {
        ...sec,
        items: sec.items.filter((it) => it.id !== itId),
      }),
    }));

  const buyAll = (sId) =>
    setStores((prev) => prev.map((s) => s.id !== sId ? s : {
      ...s,
      sections: s.sections.map((sec) => ({ ...sec, items: sec.items.map((it) => ({ ...it, have: true })) })),
    }));

  const resetAll = () => setStores(seedStores());

  const totalPending = stores
    ? stores.reduce((a, s) => a + s.sections.reduce((b, sec) => b + sec.items.filter((i) => !i.have).length, 0), 0)
    : 0;

  if (!loaded || !stores) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F4F5F1", color: "#8A8170" }}>
        Cargando tus listas…
      </div>
    );
  }

  const tabs = [
    { id: "comprar", label: "Comprar", emoji: "🧺", badge: totalPending },
    { id: "listas", label: "Listas", emoji: "📋" },
    { id: "temporada", label: "Temporada", emoji: est.emoji },
  ];

  return (
    <div className="min-h-screen" style={{ background: "#F4F5F1", fontFamily: "-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif" }}>
      <header className="sticky top-0 z-10" style={{ background: "rgba(244,245,241,0.93)", backdropFilter: "blur(8px)", borderBottom: "1px solid #E3E0D6" }}>
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-baseline justify-between">
          <h1 className="uppercase font-bold" style={{ fontFamily: "Futura, 'Trebuchet MS', 'Century Gothic', sans-serif", fontSize: 20, letterSpacing: "0.1em", color: "#2B2620" }}>
            El Changuito
          </h1>
          <span className="text-sm" style={{ color: "#8A8170" }}>{MESES[month - 1]} · {est.name} {est.emoji}</span>
        </div>
        {saveErr ? (
          <div className="text-xs text-center py-1" style={{ background: "#FBE3E3", color: "#9B1C1C" }}>
            No se pudo guardar el último cambio. Probá de nuevo en un momento.
          </div>
        ) : null}
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-4 pb-24">
        {tab === "comprar" ? <ShoppingView stores={stores} month={month} patchItem={patchItem} buyAll={buyAll} priceDate={priceDate} /> : null}
        {tab === "listas" ? <ListsView stores={stores} month={month} patchItem={patchItem} addItem={addItem} delItem={delItem} resetAll={resetAll} priceDate={priceDate} /> : null}
        {tab === "temporada" ? <SeasonView month={month} /> : null}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-20" style={{ background: "#FFFFFF", borderTop: "1px solid #E3E0D6" }}>
        <div className="max-w-2xl mx-auto flex">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className="flex-1 py-2 flex flex-col items-center gap-1 select-none">
              <span style={{ fontSize: 20, position: "relative" }}>
                {t.emoji}
                {t.badge ? (
                  <span className="rounded-full font-bold" style={{ position: "absolute", top: -4, right: -14, background: "#D7263D", color: "#FFFFFF", fontSize: 10, padding: "0px 5px" }}>
                    {t.badge}
                  </span>
                ) : null}
              </span>
              <span className="text-xs font-semibold uppercase" style={{ color: tab === t.id ? "#2B2620" : "#A39B89", letterSpacing: "0.06em" }}>
                {t.label}
              </span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
