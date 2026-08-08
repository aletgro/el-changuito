# El Changuito 🧺

Organizador de compras por comercio y temporada. App web instalable (PWA): funciona en Android, Windows y Linux, y sigue andando sin conexión una vez instalada.

## Publicar en GitHub Pages

1. Creá una cuenta en https://github.com si no tenés.
2. Arriba a la derecha: **+** → **New repository**. Nombre: `el-changuito` (o el que quieras). Dejalo **Public** y tocá **Create repository**.
3. En el repo nuevo: **Add file** → **Upload files**. Arrastrá los 7 archivos de esta carpeta (`index.html`, `app.js`, `styles.css`, `manifest.webmanifest`, `sw.js`, `icon-192.png`, `icon-512.png`). Tocá **Commit changes**.
4. Andá a **Settings** → **Pages** (menú izquierdo). En *Source* elegí **Deploy from a branch**, branch **main**, carpeta **/ (root)**. **Save**.
5. Esperá 1 o 2 minutos. La app queda en:
   `https://TU-USUARIO.github.io/el-changuito/`

## Instalar en Android

1. Abrí esa URL en **Chrome** en el celu.
2. Menú **⋮** → **Agregar a la pantalla principal** (o "Instalar aplicación").
3. Listo: ícono propio, pantalla completa y funciona offline.

En Windows/Linux: misma URL en Chrome o Edge → ícono de instalar en la barra de direcciones.


## Precios automáticos

El archivo `precios.json` alimenta la estimación de gasto de la app. El workflow de GitHub Actions (`.github/workflows/precios.yml`) lo regenera solo **lunes y jueves a las 6:00 (hora argentina)** consultando los sitios de los comercios, y el sitio se republica con los precios nuevos sin que hagas nada.

Requisitos:
- La app tiene que vivir en un **repositorio de GitHub** (Pages, o Netlify/Cloudflare conectado al repo; Netlify Drop no sirve para esto). Con repo **privado** + Netlify gratis también funciona.
- Al subir los archivos, incluí las carpetas `scripts/` y `.github/` tal cual.

Actualización manual cuando quieras (ej. antes del día de ofertas): en GitHub → pestaña **Actions** → "Actualizar precios" → **Run workflow**. En 1-2 minutos el sitio tiene precios del momento. También podés editar `precios.json` a mano desde GitHub, o un precio puntual desde la app (Listas → Editar).

Si algún ítem aparece como "sin match" en el log del workflow, avisale a Claude para refinar la búsqueda de ese producto.

## Notas

- Los datos se guardan en cada dispositivo (localStorage): el celu y la compu no comparten listas entre sí.
- Si borrás los datos de navegación del sitio, se borran las listas.
- Para actualizar la app más adelante: reemplazá los archivos en el repo y subí el número de versión en `sw.js` (por ej. `changuito-v5` → `changuito-v6`), para que los dispositivos descarguen la versión nueva.
