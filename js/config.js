// ============================================================
//  Configuración del tablero LAFITA 2026
// ============================================================

window.LAFITA_CONFIG = {
  // Contraseña para entrar. Ojo: se ve en el código fuente del repositorio,
  // así que solo filtra a curiosos; no es seguridad real.
  password: "lafitaeschevere2026",

  // Edición compartida en vivo (opcional).
  // Mientras esto sea null, cada persona guarda los cambios en su propio navegador.
  // Para que todo el equipo vea y edite lo mismo en vivo, pega aquí el objeto
  // firebaseConfig de tu proyecto de Firebase (ver README.md). Ejemplo:
  //
  // firebase: {
  //   apiKey: "AIza...",
  //   authDomain: "lafita-2026.firebaseapp.com",
  //   databaseURL: "https://lafita-2026-default-rtdb.europe-west1.firebasedatabase.app",
  //   projectId: "lafita-2026",
  //   appId: "1:123:web:abc"
  // },
  firebase: null,

  // Ruta dentro de la base de datos donde se guardan las tareas.
  firebasePath: "lafita2026/tasks"
};
