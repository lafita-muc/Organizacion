# 🦎 LAFITA 2026 — Tablero del equipo

Tablero de tareas de las Lateinamerikanische Filmtage München 2026, organizado por áreas:
Programación, Textos y traducción, Programa joven, Inauguración, Sedes y técnica, Invitados y cooperaciones,
DES-MIRAR, Ticketing, Social media, Prensa y web, Diseño e impresos, Merch, Fotografía, Sponsoring y Equipo.

Cada tarea tiene responsable, fecha límite, estado, descripción y checklist. Al hacer clic en una tarea
se abre un pop-up donde todo se edita directamente; **los cambios se guardan solos**, no hay botón de enviar.

Contraseña por defecto: `lafitaeschevere2026` (se cambia en `js/config.js`).

---

## Estructura

```
index.html        la página
css/style.css     estilos
js/app.js         lógica (filtros, pop-up, guardado automático)
js/config.js      contraseña y conexión opcional a Firebase
data/tasks.json   TODAS las áreas y tareas (los datos base)
.nojekyll         necesario para GitHub Pages
```

## Publicar en GitHub Pages

1. En github.com crea un repositorio nuevo, por ejemplo `lafita-2026`.
2. Descomprime el zip en tu computadora.
3. En el repositorio: **Add file → Upload files** y arrastra **todo el contenido** de la carpeta
   (`index.html`, `README.md`, `.nojekyll` y las carpetas `css`, `js`, `data`). GitHub no descomprime zips,
   por eso hay que subir los archivos sueltos. Si `.nojekyll` no aparece (es un archivo oculto), no pasa nada grave.
4. **Settings → Pages → Branch: `main` / `(root)` → Save.**
5. En uno o dos minutos queda en `https://<tu-usuario>.github.io/lafita-2026/`.

Para probarlo en tu computadora antes, abre una terminal en la carpeta y ejecuta
`python3 -m http.server` y entra a `http://localhost:8000`. Abrir `index.html` con doble clic no funciona,
porque el navegador bloquea la lectura de `data/tasks.json`.

## Cómo se guardan los datos

Hay dos modos:

**Modo local (por defecto).** Cada persona ve las tareas de `data/tasks.json` y sus cambios se guardan
automáticamente en su propio navegador. No se comparten entre personas.

**Modo en vivo (con Firebase).** Todo el equipo ve y edita lo mismo, al instante, y todo se guarda solo.
Ver la sección siguiente.

En los dos modos, el botón **«Descargar tasks.json»** (al pie de la página) baja el estado actual.
Si reemplazas `data/tasks.json` del repositorio por ese archivo, esa pasa a ser la nueva base (y queda
el historial de cambios en GitHub). **«Importar tasks.json»** carga un archivo y reemplaza todo.

Para agregar o cambiar áreas, edita la lista `categories` en `data/tasks.json`
(`key`, `name`, `emoji`, `color`, `description`).

## Activar la edición en vivo (Firebase, gratis)

GitHub Pages solo sirve archivos; no puede guardar lo que escribe cada persona. Para eso se usa
Firebase Realtime Database, que es gratis para este volumen.

1. Entra a https://console.firebase.google.com y crea un proyecto (por ejemplo `lafita-2026`).
2. En el menú: **Build → Realtime Database → Create database**. Elige la ubicación Europa y
   empieza en *locked mode*.
3. En la pestaña **Rules** pega esto y publica:

   ```json
   {
     "rules": {
       "lafita2026": { ".read": true, ".write": true }
     }
   }
   ```

4. En **Project settings (⚙️) → General → Your apps**, agrega una app web (`</>`).
   Firebase te muestra un objeto `firebaseConfig`.
5. Copia ese objeto en `js/config.js`, en el campo `firebase`. Tiene que incluir `databaseURL`.
6. Sube el `config.js` actualizado al repositorio. La primera vez que alguien abra la página,
   la base de datos se llena con el contenido de `data/tasks.json`. Desde ahí, manda Firebase.

Arriba a la derecha de los filtros aparece el estado: «En vivo — guardado», «Guardando…» o «Sin conexión».

## Seguridad: leer antes de compartir el link

- La contraseña está en `js/config.js`, que es público en un repositorio público. Sirve para que
  un visitante casual no entre, pero cualquiera que mire el código la puede leer.
- Con las reglas de Firebase de arriba, quien tenga la configuración podría escribir en la base.
  Para un equipo chico y un link no publicitado suele alcanzar. Si hace falta más protección,
  el siguiente paso es agregar Firebase Authentication (por ejemplo, entrar con Google) y
  restringir las reglas a los emails del equipo.
- No guarden en el tablero datos sensibles (contraseñas, datos bancarios, direcciones privadas).

## Origen de los datos

Las tareas iniciales salen de las actas de las reuniones de 2026 (10.06, 20.06, 19.08 y 15.09),
del Recap LAFITA 2025, del recap de 2023, del spreadsheet de programación 2026 y del comunicado
de prensa de DES-MIRAR.
