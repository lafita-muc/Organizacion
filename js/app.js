(() => {
  "use strict";

  const CFG = window.LAFITA_CONFIG || {};
  const LS_KEY = "lafita2026.board.v2";
  const SESSION_KEY = "lafita2026.unlocked";
  const FIREBASE_VERSION = "10.12.2";
  const STATUSES = [
    { key: "pendiente", label: "Pendiente" },
    { key: "en_curso", label: "En curso" },
    { key: "hecho", label: "Hecho" },
    { key: "bloqueado", label: "Bloqueado" },
  ];
  const STATUS_LABEL = Object.fromEntries(STATUSES.map(s => [s.key, s.label]));
  const CYCLE = ["pendiente", "en_curso", "hecho"];
  const NO_OWNER = "__none__";
  const ORPHAN = { key: "__otros", name: "Otros", emoji: "📂", color: "#888888", description: "Tareas con un área que ya no existe." };

  const state = {
    meta: {}, categories: [], catMap: {}, seedTasks: {}, tasks: {},
    filters: { q: "", person: "", status: "", hideDone: false },
    openId: null, mode: "local", fbRef: null,
    dirty: new Set(), timers: {}, booted: false,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));

  // ---------------- Fechas ----------------
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function parseISO(s) { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); }
  function fmtDate(s) { return s ? parseISO(s).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : ""; }
  function daysUntil(s) { return Math.round((parseISO(s) - parseISO(todayISO())) / 86400000); }

  // ---------------- Datos ----------------
  function normalizeTask(t, id) {
    let cl = t.checklist;
    if (cl && !Array.isArray(cl) && typeof cl === "object") cl = Object.values(cl); // Firebase puede devolver objetos
    return {
      id: id || t.id,
      category: t.category || (state.categories[0] ? state.categories[0].key : "general"),
      title: String(t.title || ""),
      owner: String(t.owner || ""),
      due: String(t.due || ""),
      status: STATUS_LABEL[t.status] ? t.status : "pendiente",
      description: String(t.description || ""),
      checklist: (Array.isArray(cl) ? cl : []).filter(Boolean).map(i => ({ text: String(i.text || ""), done: !!i.done })),
      order: typeof t.order === "number" ? t.order : 0,
      updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : 0,
    };
  }
  function toMap(arr) {
    const m = {};
    (arr || []).forEach(t => { if (t && t.id) m[t.id] = normalizeTask(t, t.id); });
    return m;
  }
  function normalizeMap(obj) {
    const m = {};
    Object.keys(obj || {}).forEach(id => { if (obj[id]) m[id] = normalizeTask(obj[id], id); });
    return m;
  }
  function sortedTasks() {
    const idx = Object.fromEntries(state.categories.map((c, i) => [c.key, i]));
    return Object.values(state.tasks).sort((a, b) =>
      ((idx[a.category] ?? 999) - (idx[b.category] ?? 999)) || a.order - b.order || a.title.localeCompare(b.title, "es"));
  }

  // "Todo el equipo", "alle", "NN"… no son responsables reales: la tarea necesita owner
  const GENERIC_OWNER = /^(todo el equipo|todo el team|el equipo|equipo|team|todos|todas|todes|alle|nn|n\.n\.|\?+|-+)$/i;
  function splitOwners(s) {
    return String(s || "").split(/\s*(?:,|\/|&|\+|;|\by\b|\bo\b|\bund\b)\s*/i)
      .map(x => x.trim()).filter(x => x && !GENERIC_OWNER.test(x));
  }
  const needsOwner = t => t.status !== "hecho" && !splitOwners(t.owner).length;
  function allPeople() {
    const seen = new Map();
    Object.values(state.tasks).forEach(t => splitOwners(t.owner).forEach(p => {
      const k = p.toLowerCase();
      if (!seen.has(k)) seen.set(k, p);
    }));
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "es"));
  }

  function visibleCats() {
    const hasOrphans = Object.values(state.tasks).some(t => !state.catMap[t.category]);
    return hasOrphans ? [...state.categories, ORPHAN] : state.categories;
  }
  function tasksIn(key) {
    return Object.values(state.tasks)
      .filter(t => key === ORPHAN.key ? !state.catMap[t.category] : t.category === key)
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, "es"));
  }
  function catOf(t) { return state.catMap[t.category] || ORPHAN; }

  function matches(t) {
    const f = state.filters;
    if (f.hideDone && t.status === "hecho") return false;
    if (f.status && t.status !== f.status) return false;
    if (f.person === NO_OWNER) {
      if (!needsOwner(t)) return false;
    } else if (f.person) {
      const p = f.person.toLowerCase();
      if (!splitOwners(t.owner).some(o => o.toLowerCase() === p)) return false;
    }
    if (f.q) {
      const hay = [t.title, t.owner, t.description, ...t.checklist.map(i => i.text)].join(" ").toLowerCase();
      if (!hay.includes(f.q.toLowerCase())) return false;
    }
    return true;
  }
  const filtersActive = () => { const f = state.filters; return !!(f.q || f.person || f.status || f.hideDone); };

  // ---------------- Contraseña ----------------
  function initGate() {
    let unlocked = false;
    try { unlocked = sessionStorage.getItem(SESSION_KEY) === "1"; } catch (_) {}
    if (!CFG.password || unlocked) { start(); return; }
    const gate = $("#gate");
    gate.hidden = false;
    const input = $("#gate-input");
    input.focus();
    $("#gate-form").addEventListener("submit", e => {
      e.preventDefault();
      if (input.value === CFG.password) {
        try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (_) {}
        gate.hidden = true;
        start();
      } else {
        $("#gate-error").textContent = "Contraseña incorrecta.";
        input.select();
      }
    });
  }

  // ---------------- Arranque ----------------
  async function start() {
    $("#app").hidden = false;
    let seed = window.LAFITA_SEED || null; // vista previa en un solo archivo
    if (!seed) try {
      const r = await fetch("data/tasks.json", { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      seed = await r.json();
    } catch (e) {
      console.error(e);
      $("#board").innerHTML = `<p class="empty">No se pudo cargar <b>data/tasks.json</b>. Si abriste index.html directamente desde tu computadora, ábrelo desde GitHub Pages o con un servidor local (ver README.md).</p>`;
      return;
    }
    state.meta = seed.festival || {};
    state.categories = (seed.categories || []).filter(c => c && c.key);
    state.catMap = Object.fromEntries(state.categories.map(c => [c.key, c]));
    state.seedTasks = toMap(seed.tasks || []);

    $("#fest-name").textContent = state.meta.name || "LAFITA";
    $("#fest-sub").textContent = [state.meta.fullName, state.meta.subtitle].filter(Boolean).join(" — ");
    document.title = (state.meta.name || "LAFITA") + " — Tablero del equipo";

    bindUI();

    if (CFG.firebase && CFG.firebase.databaseURL) {
      try { await initFirebase(); return; }
      catch (e) {
        console.error(e);
        alert("No se pudo conectar con Firebase. El tablero funciona en modo local (solo en este navegador).");
      }
    }
    initLocal();
  }

  function initLocal() {
    state.mode = "local";
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (_) {}
    state.tasks = stored && stored.tasks ? normalizeMap(stored.tasks) : clone(state.seedTasks);
    $("#mode-note").textContent = "Modo local: los cambios se guardan automáticamente en este navegador. Para que todo el equipo edite lo mismo en vivo, configura Firebase en js/config.js (ver README). Con «Descargar tasks.json» puedes subir el estado actual al repositorio.";
    $("#btn-reset").hidden = false;
    setSync("local", "Guardado en este navegador");
    state.booted = true;
    renderAll();
    openFromHash();
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("No se pudo cargar " + src));
      document.head.appendChild(s);
    });
  }

  async function initFirebase() {
    setSync("saving", "Conectando…");
    await loadScript(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app-compat.js`);
    await loadScript(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-database-compat.js`);
    const app = window.firebase.initializeApp(CFG.firebase);
    const db = window.firebase.database(app);
    const ref = db.ref(CFG.firebasePath || "lafita2026/tasks");
    const first = await ref.once("value");
    if (!first.exists()) await ref.set(clean(state.seedTasks));
    state.fbRef = ref;
    state.mode = "firebase";
    $("#mode-note").textContent = "Modo en vivo: todos los cambios se guardan automáticamente y el equipo los ve al instante. Con «Descargar tasks.json» puedes guardar una copia en el repositorio.";
    $("#btn-reset").hidden = true;

    ref.on("value", snap => {
      const incoming = normalizeMap(snap.val() || {});
      for (const id of state.dirty) {           // no pisar lo que se está escribiendo aquí
        if (state.tasks[id]) incoming[id]  = state.tasks[id];
        else delete incoming[id];
      }
      state.tasks = incoming;
      renderAll();
      if (state.openId) refreshModal();
      if (!state.booted) { state.booted = true; openFromHash(); }
    }, err => {
      console.error(err);
      setSync("error", "Sin permiso para leer la base de datos");
    });
    db.ref(".info/connected").on("value", s => {
      if (state.dirty.size) return;
      if (s.val()) setSync("ok", "En vivo — guardado");
      else setSync("offline", "Sin conexión — se sincroniza al volver");
    });
  }

  // ---------------- Guardado automático ----------------
  function clean(obj) { return JSON.parse(JSON.stringify(obj)); }

  function setSync(kind, text) {
    const el = $("#sync");
    el.className = "sync sync-" + kind;
    el.textContent = text;
    const ms = $("#m-saved");
    if (ms) ms.textContent = kind === "saving" ? "Guardando…" : kind === "error" ? "Error al guardar" : "Guardado ✓";
  }

  function saveLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ savedAt: Date.now(), tasks: state.tasks })); }
    catch (e) { console.error(e); setSync("error", "No se pudo guardar en el navegador"); throw e; }
  }

  function persist(id) {
    state.dirty.add(id);
    setSync("saving", "Guardando…");
    clearTimeout(state.timers[id]);
    state.timers[id] = setTimeout(() => flush(id), 400);
  }

  async function flush(id) {
    const t = state.tasks[id];
    try {
      if (state.mode === "firebase") {
        if (t) await state.fbRef.child(id).set(clean(t));
        else await state.fbRef.child(id).remove();
      } else {
        saveLocal();
      }
      state.dirty.delete(id);
      if (!state.dirty.size) setSync(state.mode === "firebase" ? "ok" : "local", state.mode === "firebase" ? "En vivo — guardado" : "Guardado en este navegador");
    } catch (e) {
      console.error(e);
      setSync("error", "Error al guardar — revisa la conexión");
    }
  }

  function touch(id) {
    const t = state.tasks[id];
    if (t) t.updatedAt = Date.now();
    persist(id);
  }

  // ---------------- Render ----------------
  function renderAll() {
    renderHeader();
    renderPeople();
    renderNav();
    renderUpcoming();
    renderBoard();
  }

  function renderHeader() {
    const all = Object.values(state.tasks);
    const done = all.filter(t => t.status === "hecho").length;
    const pct = all.length ? Math.round(done / all.length * 100) : 0;
    $("#overall-text").textContent = `${done} de ${all.length} · ${pct}%`;
    $("#overall-bar").style.width = pct + "%";
    const need = all.filter(needsOwner).length;
    const nb = $("#need-owner");
    nb.hidden = !need;
    nb.innerHTML = `⚠ <b>${need}</b> ${need === 1 ? "tarea necesita" : "tareas necesitan"} owner`;
    nb.classList.toggle("on", state.filters.person === NO_OWNER);
    const m = state.meta;
    if (m.start) {
      const d = daysUntil(m.start);
      const running = d <= 0 && m.end && daysUntil(m.end) >= 0;
      $("#countdown").innerHTML = d > 0
        ? `<b>${d}</b><span>${d === 1 ? "día" : "días"} para el festival</span>`
        : running ? `<b>¡Hoy!</b><span>festival en curso</span>` : `<b>✓</b><span>festival terminado</span>`;
    }
  }

  function renderPeople() {
    const people = allPeople();
    const sel = $("#f-person");
    const cur = state.filters.person;
    sel.innerHTML = `<option value="">Todas las personas</option>` +
      people.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("") +
      `<option value="${NO_OWNER}">⚠ Necesita owner</option>`;
    sel.value = cur;
    if (sel.value !== cur) { state.filters.person = ""; sel.value = ""; }
    $("#people-list").innerHTML = people.map(p => `<option value="${esc(p)}"></option>`).join("");
  }

  function renderNav() {
    $("#cat-nav").innerHTML = visibleCats().map(c => {
      const open = tasksIn(c.key).filter(t => t.status !== "hecho").length;
      return `<button class="chip" data-jump="${esc(c.key)}" style="--c:${esc(c.color)}" title="${open} abiertas">
        <span aria-hidden="true">${esc(c.emoji || "")}</span>${esc(c.name)}<em class="${open ? "" : "zero"}">${open}</em></button>`;
    }).join("");
  }

  function renderUpcoming() {
    const list = Object.values(state.tasks)
      .filter(t => t.due && t.status !== "hecho" && daysUntil(t.due) <= 14)
      .sort((a, b) => a.due.localeCompare(b.due))
      .slice(0, 12);
    const el = $("#upcoming");
    if (!list.length) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    el.innerHTML = `<h2 class="sec-title">Próximas fechas</h2><ul class="up-list">${list.map(t => {
      const d = daysUntil(t.due);
      const when = d < 0 ? `vencida hace ${-d} d` : d === 0 ? "hoy" : d === 1 ? "mañana" : `en ${d} días`;
      return `<li><button class="up-item ${d < 0 ? "late" : ""}" data-open="${esc(t.id)}" style="--c:${esc(catOf(t).color)}">
        <span class="up-date">${esc(fmtDate(t.due))}<small>${when}</small></span>
        <span class="up-title">${esc(t.title || "Sin título")}</span>
        <span class="up-owner ${needsOwner(t) ? "need" : ""}">${esc(splitOwners(t.owner).join(", ") || "⚠ Necesita owner")}</span></button></li>`;
    }).join("")}</ul>`;
  }

  function rowHTML(t) {
    const owners = splitOwners(t.owner);
    const cDone = t.checklist.filter(i => i.done).length;
    let due = "";
    if (t.due) {
      const d = daysUntil(t.due);
      const open = t.status !== "hecho";
      const cls = open && d < 0 ? "late" : open && d <= 7 ? "soon" : "";
      due = `<span class="due ${cls}">📅 ${esc(fmtDate(t.due))}</span>`;
    }
    return `<li class="task s-${t.status}">
      <button class="status" data-cycle="${esc(t.id)}" title="${esc(STATUS_LABEL[t.status])} — toca para cambiar" aria-label="Estado: ${esc(STATUS_LABEL[t.status])}. Cambiar estado"></button>
      <button class="task-main" data-open="${esc(t.id)}">
        <span class="task-title">${esc(t.title || "Sin título")}</span>
        <span class="task-meta">
          ${owners.length ? owners.map(o => `<span class="who">${esc(o)}</span>`).join("") : (t.status === "hecho" ? "" : `<span class="who none">⚠ Necesita owner</span>`)}
          ${due}
          ${t.checklist.length ? `<span>☑ ${cDone}/${t.checklist.length}</span>` : ""}
          ${t.status === "en_curso" ? `<span>En curso</span>` : ""}
          ${t.status === "bloqueado" ? `<span class="blk">Bloqueado</span>` : ""}
          ${t.description ? `<span class="has-desc" title="Tiene descripción">¶</span>` : ""}
        </span>
      </button>
    </li>`;
  }

  function renderBoard() {
    const active = filtersActive();
    let html = "";
    let shown = 0;
    for (const c of visibleCats()) {
      const all = tasksIn(c.key);
      const items = all.filter(matches);
      if (active && !items.length) continue;
      shown += items.length;
      const done = all.filter(t => t.status === "hecho").length;
      const pct = all.length ? Math.round(done / all.length * 100) : 0;
      html += `<section class="cat" id="cat-${esc(c.key)}" style="--c:${esc(c.color)}">
        <header class="cat-head">
          <span class="cat-emoji" aria-hidden="true">${esc(c.emoji || "")}</span>
          <div class="cat-titles"><h2>${esc(c.name)}</h2>${c.description ? `<p>${esc(c.description)}</p>` : ""}</div>
          <span class="cat-count">${done}/${all.length}</span>
        </header>
        <div class="cat-bar"><i style="width:${pct}%"></i></div>
        <ul class="tasks">${items.map(rowHTML).join("")}</ul>
        ${c.key === ORPHAN.key ? "" : `<button class="add-task" data-add="${esc(c.key)}">+ Agregar tarea</button>`}
      </section>`;
    }
    if (active && !shown) html = `<p class="empty">Ninguna tarea coincide con los filtros. <button class="link" data-clear>Quitar filtros</button></p>`;
    $("#board").innerHTML = html;
  }

  let renderTimer;
  function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(renderAll, 150); }

  // ---------------- Acciones ----------------
  function cycleStatus(id) {
    const t = state.tasks[id];
    if (!t) return;
    const i = CYCLE.indexOf(t.status);
    t.status = CYCLE[(i + 1) % CYCLE.length];
    touch(id);
    renderAll();
    if (state.openId === id) refreshModal();
  }

  function addTask(cat) {
    const order = tasksIn(cat).reduce((m, t) => Math.max(m, t.order), 0) + 1;
    const id = `${cat}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    state.tasks[id] = normalizeTask({ id, category: cat, order }, id);
    touch(id);
    renderAll();
    openModal(id, true);
  }

  function deleteTask(id) {
    const t = state.tasks[id];
    if (!t) return;
    if (!confirm(`¿Eliminar «${t.title || "esta tarea"}»? No se puede deshacer.`)) return;
    delete state.tasks[id];
    persist(id);
    closeModal();
    renderAll();
  }

  function clearFilters() {
    state.filters = { q: "", person: "", status: "", hideDone: false };
    $("#f-search").value = "";
    $("#f-person").value = "";
    $("#f-status").value = "";
    $("#f-hide").checked = false;
    renderBoard();
  }

  function exportJSON() {
    const data = {
      festival: state.meta,
      categories: state.categories,
      exportedAt: new Date().toISOString(),
      tasks: sortedTasks().map(t => {
        const { updatedAt, ...rest } = t;
        return updatedAt ? { ...rest, updatedAt } : rest;
      }),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tasks.json";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      let data;
      try { data = JSON.parse(reader.result); } catch (_) { alert("El archivo no es un JSON válido."); return; }
      const list = Array.isArray(data) ? data : data.tasks;
      if (!Array.isArray(list)) { alert("No encontré una lista «tasks» en el archivo."); return; }
      if (!confirm(`Esto reemplaza todas las tareas actuales por ${list.length} tareas del archivo. ¿Seguir?`)) return;
      state.tasks = toMap(list);
      try {
        if (state.mode === "firebase") await state.fbRef.set(clean(state.tasks));
        else saveLocal();
        setSync(state.mode === "firebase" ? "ok" : "local", "Importado y guardado");
      } catch (e) { console.error(e); setSync("error", "Error al guardar la importación"); }
      renderAll();
    };
    reader.readAsText(file);
  }

  function resetToSeed() {
    if (!confirm("Esto borra los cambios guardados en este navegador y vuelve a cargar data/tasks.json del repositorio. ¿Seguir?")) return;
    state.tasks = clone(state.seedTasks);
    try { saveLocal(); } catch (_) {}
    setSync("local", "Guardado en este navegador");
    renderAll();
  }

  // ---------------- Pop-up ----------------
  function autosize(el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }

  function openModal(id, isNew) {
    if (!state.tasks[id]) return;
    state.openId = id;
    $("#modal").hidden = false;
    document.body.classList.add("modal-open");
    fillModal(true);
    try { history.replaceState(null, "", "#tarea=" + encodeURIComponent(id)); } catch (_) {}
    setTimeout(() => {
      const el = isNew ? $("#m-title") : $("#m-close");
      if (el) el.focus();
      autosize($("#m-title"));
    }, 30);
  }

  function closeModal() {
    const id = state.openId;
    if (!id) return;
    state.openId = null;
    $("#modal").hidden = true;
    document.body.classList.remove("modal-open");
    try { history.replaceState(null, "", location.pathname + location.search); } catch (_) {}
    const t = state.tasks[id];
    if (t && !t.title.trim() && !t.description.trim() && !t.checklist.length) { // tarea nueva vacía: se descarta
      delete state.tasks[id];
      persist(id);
      renderAll();
    }
  }

  function openFromHash() {
    const m = location.hash.match(/tarea=([^&]+)/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (state.tasks[id] && state.openId !== id) openModal(id);
    }
  }

  function fillModal(force) {
    const t = state.tasks[state.openId];
    if (!t) { closeModal(); return; }
    const set = (sel, val) => {
      const el = $(sel);
      if ((force || document.activeElement !== el) && el.value !== val) el.value = val;
    };
    const cat = catOf(t);
    $("#m-cat-label").textContent = `${cat.emoji || ""} ${cat.name}`;
    $("#modal .modal-card").style.setProperty("--c", cat.color);
    set("#m-title", t.title);
    set("#m-status", t.status);
    set("#m-category", state.catMap[t.category] ? t.category : "");
    set("#m-owner", t.owner);
    set("#m-due", t.due);
    set("#m-desc", t.description);
    autosize($("#m-title"));
    $("#m-updated").textContent = t.updatedAt
      ? "Última edición: " + new Date(t.updatedAt).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : "";
    if (force || !$("#m-checklist").contains(document.activeElement)) renderChecklist(t);
    $("#m-check-count").textContent = t.checklist.length ? `${t.checklist.filter(i => i.done).length}/${t.checklist.length}` : "";
    if (force) $("#m-saved").textContent = "";
  }
  function refreshModal() { if (state.openId) fillModal(false); }

  function renderChecklist(t) {
    $("#m-checklist").innerHTML = t.checklist.map((it, i) => `
      <li class="${it.done ? "done" : ""}">
        <input type="checkbox" data-ci="${i}" ${it.done ? "checked" : ""} aria-label="Marcar punto">
        <input type="text" class="ci-text" data-ct="${i}" value="${esc(it.text)}" aria-label="Texto del punto">
        <button class="icon-btn" data-cdel="${i}" aria-label="Quitar punto">✕</button>
      </li>`).join("");
  }

  function editField(field, value) {
    const t = state.tasks[state.openId];
    if (!t || t[field] === value) return;
    t[field] = value;
    touch(t.id);
    if (field === "category" || field === "status") { fillModal(false); renderAll(); }
    else scheduleRender();
  }

  function editChecklist(mutator) {
    const t = state.tasks[state.openId];
    if (!t) return;
    mutator(t.checklist);
    touch(t.id);
    $("#m-check-count").textContent = t.checklist.length ? `${t.checklist.filter(i => i.done).length}/${t.checklist.length}` : "";
    scheduleRender();
  }

  // ---------------- Eventos ----------------
  function bindUI() {
    const statusOpts = STATUSES.map(s => `<option value="${s.key}">${s.label}</option>`).join("");
    $("#m-status").innerHTML = statusOpts;
    $("#f-status").innerHTML = `<option value="">Todos los estados</option>` + statusOpts;
    $("#m-category").innerHTML = state.categories.map(c => `<option value="${esc(c.key)}">${esc((c.emoji ? c.emoji + " " : "") + c.name)}</option>`).join("");

    $("#f-search").addEventListener("input", e => { state.filters.q = e.target.value.trim(); renderBoard(); });
    $("#f-person").addEventListener("change", e => { state.filters.person = e.target.value; renderBoard(); });
    $("#f-status").addEventListener("change", e => { state.filters.status = e.target.value; renderBoard(); });
    $("#f-hide").addEventListener("change", e => { state.filters.hideDone = e.target.checked; renderBoard(); });

    document.addEventListener("click", e => {
      const el = e.target.closest("[data-cycle],[data-open],[data-add],[data-jump],[data-clear],[data-close],[data-cdel]");
      if (!el) return;
      const ds = el.dataset;
      if ("cycle" in ds) cycleStatus(ds.cycle);
      else if ("open" in ds) openModal(ds.open);
      else if ("add" in ds) addTask(ds.add);
      else if ("jump" in ds) { const s = document.getElementById("cat-" + ds.jump); if (s) s.scrollIntoView({ behavior: "smooth", block: "start" }); }
      else if ("clear" in ds) clearFilters();
      else if ("close" in ds) closeModal();
      else if ("cdel" in ds) { const i = Number(ds.cdel); editChecklist(cl => cl.splice(i, 1)); renderChecklist(state.tasks[state.openId]); }
    });

    const title = $("#m-title");
    title.addEventListener("input", () => { autosize(title); editField("title", title.value.replace(/\n/g, " ")); });
    title.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("#m-desc").focus(); } });
    $("#m-status").addEventListener("change", e => editField("status", e.target.value));
    $("#m-category").addEventListener("change", e => {
      const t = state.tasks[state.openId];
      if (t) t.order = tasksIn(e.target.value).reduce((m, x) => Math.max(m, x.order), 0) + 1;
      editField("category", e.target.value);
    });
    $("#m-owner").addEventListener("input", e => editField("owner", e.target.value));
    $("#m-due").addEventListener("input", e => editField("due", e.target.value));
    $("#m-due").addEventListener("change", e => editField("due", e.target.value));
    $("#m-desc").addEventListener("input", e => editField("description", e.target.value));

    const cl = $("#m-checklist");
    cl.addEventListener("change", e => {
      if (e.target.matches("[data-ci]")) {
        const i = Number(e.target.dataset.ci);
        editChecklist(list => { if (list[i]) list[i].done = e.target.checked; });
        e.target.closest("li").classList.toggle("done", e.target.checked);
      }
    });
    cl.addEventListener("input", e => {
      if (e.target.matches("[data-ct]")) {
        const i = Number(e.target.dataset.ct);
        editChecklist(list => { if (list[i]) list[i].text = e.target.value; });
      }
    });
    $("#m-check-new").addEventListener("keydown", e => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const text = e.target.value.trim();
      if (!text) return;
      editChecklist(list => list.push({ text, done: false }));
      e.target.value = "";
      renderChecklist(state.tasks[state.openId]);
    });

    $("#m-delete").addEventListener("click", () => deleteTask(state.openId));
    document.addEventListener("keydown", e => { if (e.key === "Escape" && state.openId) closeModal(); });
    window.addEventListener("hashchange", openFromHash);

    $("#need-owner").addEventListener("click", () => {
      const on = state.filters.person === NO_OWNER;
      state.filters.person = on ? "" : NO_OWNER;
      $("#f-person").value = state.filters.person;
      renderAll();
      if (!on) $("#upcoming").hidden = true, window.scrollTo({ top: $(".toolbar").offsetTop - 10, behavior: "smooth" });
    });
    $("#btn-export").addEventListener("click", exportJSON);
    $("#btn-import").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", e => { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ""; });
    $("#btn-reset").addEventListener("click", resetToSeed);

    // Recalcular la cuenta regresiva y las fechas si la pestaña queda abierta varios días
    setInterval(() => { if (!state.openId) renderAll(); }, 60 * 60 * 1000);
  }

  initGate();
})();
