// Panel de administración (solo administradores): solicitudes de acceso, miembros y rangos, y aprobar un
// correo por adelantado. Está en su propia página (y no en la columna del muro) porque ya son tres secciones
// con acciones por persona: en la columna lateral, en un teléfono, empujaría el muro muy abajo.
// La seguridad real la imponen las reglas (firestore.rules): este panel solo muestra lo que el admin puede hacer.
import {
  iniciarPagina, db, h, $, avatar, escucharPerfiles, escucharPersonas,
  collection, doc, getDocs, updateDoc, deleteDoc, query, where, limit, onSnapshot, serverTimestamp, writeBatch,
} from "/comun/base.js";

const raiz = $("raiz");
const st = {
  email: "", esFundador: false,
  solicitudes: [], miembros: [], personas: new Map(), perfilesPorCorreo: new Map(),
  cargadas: false, buscaMiembro: "",
};
// Una caché por lista: reconciliar() borra de su caché lo que no está en SU lista.
const cachePend = new Map();
const cacheDec = new Map();
const cacheMie = new Map();
const MAX_MOTIVO = 300;

const normal = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const fecha = (ts) => {
  const d = ts?.toDate?.();
  return d ? new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(d) : "";
};
const anio = (p) => (/\d{4}/.exec(p?.birthDate || "") || [""])[0];
// Para elegir bien entre muchas fichas (muchas sin año): cada una dice de quién es hijo o hija.
const padresDe = (p) => [p?.fatherId, p?.motherId].map((id) => st.personas.get(id)?.name).filter(Boolean);
const etiquetaPersona = (p) => {
  const padres = padresDe(p);
  const rel = p.gender === "Female" ? "hija de" : p.gender === "Male" ? "hijo de" : "hijo/a de";
  return `${p.name}${anio(p) ? ` (${anio(p)})` : ""}${padres.length ? ` · ${rel} ${padres.join(" y ")}` : ""}`;
};
const fallo = (err) => (err?.code === "permission-denied"
  ? "No tienes permiso para hacerlo (o alguien acaba de cambiarlo). Recarga la página."
  : `No se pudo completar (${err?.code || err?.message || "error"}). Inténtalo de nuevo.`);

// ---------------------------------------------------------------------------
// Selector de ficha del árbol: buscador + lista (opcional). Lo usan «Aprobar», «Cambiar ficha» y «por adelantado».
// Busca por el nombre de la persona y por el de sus padres; las fallecidas van aparte, al final.
// ---------------------------------------------------------------------------
let nSel = 0;
const selectoresVivos = new Set(); // se repintan cuando cambia el árbol, sin perder lo elegido ni la búsqueda
function selectorPersona({ etiqueta = "Su ficha en el árbol (opcional)", seleccion = "", alCambiar } = {}) {
  const id = `sel-${++nSel}`;
  const busca = h("input", { type: "search", id: `${id}-b`, placeholder: "Su nombre o el de su padre o madre…", autocomplete: "off", enterkeyhint: "search", "aria-label": `${etiqueta}: buscar` });
  const select = h("select", { id, "data-selector-persona": "1" });
  const pintar = () => {
    const q = normal(busca.value.trim());
    const actual = select.value || seleccion;
    const todas = [...st.personas.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
    let lista = q ? todas.filter((p) => normal([p.name, ...padresDe(p)].join(" ")).includes(q)) : todas;
    const elegida = st.personas.get(actual);
    if (elegida && !lista.includes(elegida)) lista = [elegida, ...lista];
    lista = lista.slice(0, 300);
    const opcion = (p) => h("option", { value: p.id, text: etiquetaPersona(p) });
    const vivas = lista.filter((p) => !p.isDeceased);
    const fallecidas = lista.filter((p) => p.isDeceased);
    select.replaceChildren(h("option", { value: "", text: q && !lista.length ? "— No hay nadie con ese nombre —" : "— Sin vincular a una ficha —" }),
      ...(vivas.length ? [h("optgroup", { label: "Con vida" }, vivas.map(opcion))] : []),
      ...(fallecidas.length ? [h("optgroup", { label: "Fallecidos" }, fallecidas.map(opcion))] : []));
    select.value = elegida ? elegida.id : "";
    // Si la búsqueda deja a una sola persona, se propone (el admin igual confirma con el botón).
    if (q && lista.length === 1) select.value = lista[0].id;
    alCambiar?.(select.value);
  };
  busca.addEventListener("input", pintar);
  select.addEventListener("change", () => alCambiar?.(select.value));
  const el = h("div", { class: "selector-persona" },
    h("label", { for: id }, h("span", { text: etiqueta })),
    busca, select, h("small", { text: "Busca por su nombre o el de su padre o madre, y elige su ficha. Puedes dejarlo sin ficha y vincularlo después." }));
  const sel = { el, valor: () => select.value || "", select, busca, pintar };
  pintar();
  selectoresVivos.add(sel);
  return sel;
}
function repintarSelectores() {
  for (const sel of selectoresVivos) { if (sel.el.isConnected) sel.pintar(); else selectoresVivos.delete(sel); }
}

// Pinta una lista con nodos estables por clave: solo rehace la tarjeta cuyo contenido cambió
// (así no se pierde lo que el admin está escribiendo en otra tarjeta cuando llega un cambio en vivo).
function reconciliar(ul, items, clave, firma, crear, cache) {
  const vistos = new Set();
  const nodos = items.map((it) => {
    const k = clave(it);
    vistos.add(k);
    const f = firma(it);
    let c = cache.get(k);
    if (!c || c.firma !== f) { c = { firma: f, el: crear(it) }; cache.set(k, c); }
    return c.el;
  });
  for (const k of [...cache.keys()]) if (!vistos.has(k)) cache.delete(k);
  nodos.forEach((n, i) => { if (ul.children[i] !== n) ul.insertBefore(n, ul.children[i] || null); });
  while (ul.children.length > nodos.length) ul.lastElementChild.remove();
}

function aviso(contenedor, texto, tipo = "ok") {
  const p = h("p", { class: `admin-aviso${tipo === "error" ? " error" : ""}`, role: "status", text: texto });
  contenedor.replaceChildren(p);
  if (tipo !== "error") setTimeout(() => { if (p.isConnected) p.remove(); }, 6000);
}

// Confirmación flotante, siempre a la vista (en el teléfono, el aviso de arriba de la sección quedaría fuera de la
// pantalla al aprobar una tarjeta de más abajo, y la tarjeta simplemente desaparecería). Tocarla la cierra.
const toastEl = h("p", { class: "admin-toast", id: "adminToast", role: "status", "aria-live": "polite", hidden: true });
toastEl.addEventListener("click", () => { toastEl.hidden = true; });
document.body.append(toastEl);
let relojToast = 0;
function confirmar(texto) {
  toastEl.textContent = texto;
  toastEl.hidden = false;
  clearTimeout(relojToast);
  relojToast = setTimeout(() => { toastEl.hidden = true; }, 7000);
}

// ---------------------------------------------------------------------------
// Estructura
// ---------------------------------------------------------------------------
const numPend = h("span", { class: "admin-num cero", id: "numSolicitudes", text: "0" });
const listaPend = h("ul", { class: "admin-lista", id: "solicitudesPendientes" });
const vacioPend = h("p", { class: "muted", id: "sinSolicitudes", text: "No hay solicitudes pendientes. ¡Todo al día!", hidden: true });
const listaDec = h("ul", { class: "admin-lista", id: "solicitudesDecididas" });
const resumenDec = h("summary", { text: "Decididas recientemente" });
const detallesDec = h("details", { hidden: true }, resumenDec, listaDec);

const numMie = h("span", { class: "admin-num cero", id: "numMiembros", text: "0" });
const listaMie = h("ul", { class: "admin-lista", id: "miembros" });
const buscaMie = h("input", { type: "search", class: "entrada admin-buscar", placeholder: "Buscar por nombre o correo…", "aria-label": "Buscar miembro", autocomplete: "off" });

const correoAdel = h("input", { type: "email", class: "entrada", id: "adelantoCorreo", inputmode: "email", autocomplete: "off", autocapitalize: "off", spellcheck: "false", maxlength: "254", placeholder: "nombre@hotmail.com" });
let selAdel = null;
const cajaSelAdel = h("div");
const btnAdel = h("button", { type: "submit", class: "primary", text: "Aprobar este correo" });
const avisoAdel = h("div", { "aria-live": "polite" });
const formAdel = h("form", { class: "admin-seccion", id: "adelantoForm", novalidate: true },
  h("label", { class: "campo", for: "adelantoCorreo" }, h("span", { text: "Correo (Gmail, Hotmail, iCloud… cualquiera)" })), correoAdel,
  cajaSelAdel, btnAdel, avisoAdel);

const secciones = [
  h("div", { class: "pagina-cab" }, h("div", {},
    h("h1", { text: "Administrar la red" }),
    h("p", { text: "Aprueba a quien pide entrar, cuida la lista de miembros y quién más puede administrar." }))),
  h("section", { class: "card admin-seccion", id: "solicitudes", "aria-labelledby": "tSol" },
    h("h2", { id: "tSol" }, "Solicitudes de acceso ", numPend),
    h("p", { class: "admin-nota", text: "Revisa quién es cada persona. Si dudas, llámala o escríbele por WhatsApp antes de aprobar. Al aprobar puedes vincularla a su ficha del árbol." }),
    listaPend, vacioPend, detallesDec),
  h("section", { class: "card admin-seccion", id: "seccionMiembros", "aria-labelledby": "tMie" },
    h("h2", { id: "tMie" }, "Miembros ", numMie),
    h("p", { class: "admin-nota", text: "Los administradores aprueban solicitudes, gestionan miembros y editan el árbol. Los fundadores no pueden perder el rango ni ser quitados." }),
    buscaMie, listaMie),
  h("section", { class: "card admin-seccion", id: "adelanto", "aria-labelledby": "tAdel" },
    h("h2", { id: "tAdel", text: "Aprobar un correo por adelantado" }),
    h("p", { class: "admin-nota", text: "Esa persona entrará directamente con ese correo (con Google o creando su cuenta), sin tener que enviar una solicitud." }),
    formAdel),
];
raiz.append(...secciones);
buscaMie.addEventListener("input", () => { st.buscaMiembro = buscaMie.value; pintarMiembros(); });

// ---------------------------------------------------------------------------
// Solicitudes
// ---------------------------------------------------------------------------
const esMiembro = (correo) => st.miembros.some((m) => m.email === correo);

function datosContacto(s) {
  const partes = [];
  if (s.telefono) {
    const digitos = s.telefono.replace(/[^\d]/g, "");
    partes.push(h("span", {}, "Teléfono: ", h("a", { href: `tel:${s.telefono.replace(/[^\d+]/g, "")}`, text: s.telefono })));
    if (digitos.length >= 8) partes.push(h("a", { href: `https://wa.me/${digitos}`, target: "_blank", rel: "noopener", text: "Escribir por WhatsApp" }));
  }
  if (s.createdAt) partes.push(h("span", { text: `Enviada: ${fecha(s.createdAt)}` }));
  return h("div", { class: "datos" }, partes);
}

function tarjetaSolicitud(s) {
  const pendiente = s.status === "pending";
  const yaMiembro = esMiembro(s.email);
  const chip = pendiente ? ["pendiente", "Pendiente"] : s.status === "approved" ? ["aprobada", "Aprobada"] : ["rechazada", "Rechazada"];
  const li = h("li", { class: `solicitud${pendiente ? "" : " decidida"}`, "data-solicitud": s.uid, "data-correo": s.email },
    h("div", { class: "solicitud-cab" }, avatar(s.name || s.email),
      h("div", {}, h("b", { text: s.name || s.email }), h("span", { class: "correo", text: s.email })),
      h("span", { class: `chip-estado ${chip[0]}`, text: chip[1] }),
      yaMiembro && pendiente ? h("span", { class: "chip-estado ya", text: "Ya es miembro" }) : null),
    h("p", { class: "relacion", text: s.relacion || "" }),
    datosContacto(s));
  if (!pendiente) {
    const quien = s.decidedBy ? ` por ${s.decidedBy}` : "";
    li.append(h("p", { class: "admin-nota", text: `${s.status === "approved" ? "Aprobada" : "Rechazada"}${quien}${s.decidedAt ? ` · ${fecha(s.decidedAt)}` : ""}` }));
    if (s.motivo) li.append(h("p", { class: "admin-nota" }, h("b", { text: "Motivo: " }), s.motivo));
    return li;
  }
  if (s.decidedAt && s.motivo) li.append(h("p", { class: "admin-nota" }, h("b", { text: "La rechazaron antes. Motivo: " }), s.motivo));
  const msg = h("div", { "aria-live": "polite" });
  const aprobar = h("button", { type: "button", class: "primary", "data-accion": "aprobar", text: "Aprobar" });
  const rechazar = h("button", { type: "button", class: "ghost", "data-accion": "rechazar", text: "Rechazar" });
  const acciones = h("div", { class: "acciones-fila" }, aprobar, rechazar);

  // «Aprobar» despliega la elección de la ficha (opcional) y la confirmación: la tarjeta cerrada es corta.
  const cajaAprobar = h("div", { class: "aprobar-caja", hidden: true });
  let sel = null;
  aprobar.addEventListener("click", () => {
    const confirmarBtn = h("button", { type: "button", class: "primary", "data-accion": "confirmar-aprobacion", text: "Aprobar sin ficha" });
    const cancelar = h("button", { type: "button", class: "ghost", text: "Cancelar", onclick: () => { cajaAprobar.hidden = true; acciones.hidden = false; } });
    sel = selectorPersona({ alCambiar: (v) => { confirmarBtn.textContent = v ? "Aprobar con esta ficha" : "Aprobar sin ficha"; } });
    confirmarBtn.addEventListener("click", async () => {
      confirmarBtn.disabled = true;
      try {
        await aprobarSolicitud(s, sel.valor());
        confirmar(`Aprobaste a ${s.name || s.email}. Ya puede entrar.`);
      } catch (err) { aviso(msg, fallo(err), "error"); confirmarBtn.disabled = false; }
    });
    cajaAprobar.replaceChildren(sel.el, h("div", { class: "acciones-fila" }, confirmarBtn, cancelar));
    cajaAprobar.hidden = false;
    acciones.hidden = true;
    sel.busca.focus();
  });

  const motivo = h("textarea", { class: "entrada", rows: "2", maxlength: String(MAX_MOTIVO), "aria-label": "Motivo del rechazo (opcional)", placeholder: "Motivo (opcional). Lo verá la persona." });
  const confirmarRechazo = h("button", { type: "button", class: "ghost peligro", "data-accion": "confirmar-rechazo", text: "Confirmar el rechazo" });
  const cancelarRechazo = h("button", { type: "button", class: "ghost", text: "Cancelar" });
  const cajaRechazo = h("div", { class: "rechazo", hidden: true },
    h("label", { class: "campo" }, h("span", { text: "Motivo del rechazo (opcional)" }), motivo),
    h("div", { class: "acciones-fila" }, confirmarRechazo, cancelarRechazo));
  li.append(acciones, cajaAprobar, cajaRechazo, msg);

  rechazar.addEventListener("click", () => { cajaRechazo.hidden = false; acciones.hidden = true; motivo.focus(); });
  cancelarRechazo.addEventListener("click", () => { cajaRechazo.hidden = true; acciones.hidden = false; });
  confirmarRechazo.addEventListener("click", async () => {
    confirmarRechazo.disabled = true;
    try {
      const m = motivo.value.replace(/\s+/g, " ").trim().slice(0, MAX_MOTIVO);
      await updateDoc(doc(db, "requests", s.uid), { status: "rejected", decidedBy: st.email, decidedAt: serverTimestamp(), motivo: m || null });
      confirmar(`Rechazaste la solicitud de ${s.name || s.email}.`);
    } catch (err) { aviso(msg, fallo(err), "error"); confirmarRechazo.disabled = false; }
  });
  return li;
}

// En un solo lote: members/{correo} (si aún no existe) + la solicitud aprobada.
async function aprobarSolicitud(s, personId) {
  const persona = st.personas.get(personId) || null;
  const lote = writeBatch(db);
  const ref = doc(db, "members", s.email);
  if (!esMiembro(s.email)) {
    lote.set(ref, {
      personId: persona ? persona.id : null, name: (s.name || "").slice(0, 200) || null, role: "member",
      addedBy: st.email, addedAt: serverTimestamp(), approvedBy: st.email, approvedAt: serverTimestamp(),
    });
  } else if (persona) {
    lote.update(ref, { personId: persona.id });
  }
  lote.update(doc(db, "requests", s.uid), { status: "approved", decidedBy: st.email, decidedAt: serverTimestamp() });
  await lote.commit();
}

function pintarSolicitudes() {
  const pend = st.solicitudes.filter((s) => s.status === "pending")
    .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
  const dec = st.solicitudes.filter((s) => s.status !== "pending")
    .sort((a, b) => (b.decidedAt?.toMillis?.() || 0) - (a.decidedAt?.toMillis?.() || 0)).slice(0, 30);
  numPend.textContent = String(pend.length);
  numPend.classList.toggle("cero", pend.length === 0);
  numPend.setAttribute("aria-label", `${pend.length} pendientes`);
  vacioPend.hidden = !st.cargadas || pend.length > 0;
  // (Sin nada del árbol en la firma: si cambia, los selectores abiertos se repintan solos, sin rehacer la tarjeta.)
  const firma = (s) => JSON.stringify([s.status, s.name, s.relacion, s.telefono, s.motivo, s.decidedBy, s.createdAt?.toMillis?.(), s.decidedAt?.toMillis?.(), esMiembro(s.email)]);
  reconciliar(listaPend, pend, (s) => s.uid, firma, tarjetaSolicitud, cachePend);
  detallesDec.hidden = dec.length === 0;
  resumenDec.textContent = `Decididas recientemente (${dec.length})`;
  reconciliar(listaDec, dec, (s) => s.uid, firma, tarjetaSolicitud, cacheDec);
}

// ---------------------------------------------------------------------------
// Miembros
// ---------------------------------------------------------------------------
const nombreMiembro = (m) => st.perfilesPorCorreo.get(m.email)?.name || m.name || m.email;
const rango = (m) => (m.fundador ? 0 : m.role === "admin" ? 1 : 2);

function tarjetaMiembro(m) {
  const yo = m.email === st.email;
  const fundador = m.fundador === true;
  const admin = fundador || m.role === "admin";
  const nombre = nombreMiembro(m);
  const persona = st.personas.get(m.personId);
  const msg = h("div", { "aria-live": "polite" });
  const li = h("li", { class: "miembro", "data-miembro": m.email },
    h("div", { class: "miembro-cab" }, avatar(nombre, st.perfilesPorCorreo.get(m.email)?.photoURL),
      h("div", {}, h("b", { text: nombre }), h("span", { class: "correo", text: m.email })),
      fundador ? h("span", { class: "chip-estado fundador", text: "Fundador" })
        : admin ? h("span", { class: "chip-estado admin", text: "Administrador" }) : null,
      yo ? h("span", { class: "chip-estado", text: "Tú" }) : null));

  // Ficha del árbol (editable). Los documentos de los fundadores solo los cambian los fundadores; nadie el suyo propio
  // salvo un fundador (las reglas lo imponen).
  const puedeFicha = fundador ? st.esFundador : !yo;
  const ficha = h("p", { class: "ficha-actual" }, "Ficha del árbol: ", persona ? h("b", { text: etiquetaPersona(persona) }) : h("span", { text: "sin vincular" }));
  li.append(ficha);
  if (puedeFicha) {
    const cambiar = h("button", { type: "button", class: "ghost", "data-accion": "cambiar-ficha", text: "Cambiar ficha" });
    const caja = h("div", { class: "rechazo", hidden: true });
    cambiar.addEventListener("click", () => {
      const sel = selectorPersona({ etiqueta: "Su ficha en el árbol", seleccion: m.personId || "" });
      const guardar = h("button", { type: "button", class: "primary", "data-accion": "guardar-ficha", text: "Guardar ficha" });
      const cancelar = h("button", { type: "button", class: "ghost", text: "Cancelar", onclick: () => { caja.hidden = true; cambiar.hidden = false; } });
      guardar.addEventListener("click", async () => {
        guardar.disabled = true;
        try {
          await updateDoc(doc(db, "members", m.email), { personId: sel.valor() || null });
          confirmar(`Ficha de ${nombre} guardada.`);
        } catch (err) { aviso(msg, fallo(err), "error"); guardar.disabled = false; }
      });
      caja.replaceChildren(sel.el, h("div", { class: "acciones-fila" }, guardar, cancelar));
      caja.hidden = false;
      cambiar.hidden = true;
      sel.busca.focus();
    });
    li.append(h("div", {}, cambiar), caja);
  }

  if (fundador) {
    li.append(h("p", { class: "admin-nota", text: "Fundador: no se le puede quitar el rango ni sacar de la red." }));
  } else if (yo) {
    li.append(h("p", { class: "admin-nota", text: "Eres tú. Otro administrador puede cambiar tu rango." }));
  } else {
    const rangoBtn = admin
      ? h("button", { type: "button", class: "ghost", "data-accion": "quitar-admin", text: "Quitar administrador" })
      : h("button", { type: "button", class: "ghost", "data-accion": "hacer-admin", text: "Hacer administrador" });
    const quitar = h("button", { type: "button", class: "ghost peligro", "data-accion": "quitar-red", text: "Quitar de la red" });
    rangoBtn.addEventListener("click", async () => {
      const pregunta = admin
        ? `¿Quitarle a ${nombre} el rango de administrador? Seguirá siendo miembro de la familia.`
        : `¿Hacer administrador a ${nombre}? Podrá aprobar solicitudes, gestionar miembros y editar el árbol.`;
      if (!confirm(pregunta)) return;
      rangoBtn.disabled = true;
      try {
        await updateDoc(doc(db, "members", m.email), { role: admin ? "member" : "admin", roleBy: st.email, roleAt: serverTimestamp() });
        confirmar(admin ? `${nombre} ya no es administrador.` : `${nombre} ahora es administrador. Le avisamos en su campana.`);
      } catch (err) { aviso(msg, fallo(err), "error"); rangoBtn.disabled = false; }
    });
    quitar.addEventListener("click", async () => {
      if (!confirm(`¿Quitar a ${nombre} (${m.email}) de la red? Dejará de ver el muro, el árbol y las fotos.`)) return;
      quitar.disabled = true;
      try { await deleteDoc(doc(db, "members", m.email)); } catch (err) { aviso(msg, fallo(err), "error"); quitar.disabled = false; return; }
      confirmar(`Quitaste a ${nombre} de la red.`);
      // Su perfil deja de aparecer en la red (y vinculado a su ficha del árbol); su solicitud vieja se borra para que,
      // si vuelve a pedir entrar, empiece de cero. Sus dispositivos los borra el servidor (limpiarDispositivosAlQuitar).
      try {
        const [ps, rs] = await Promise.all([
          getDocs(query(collection(db, "profiles"), where("email", "==", m.email))),
          getDocs(query(collection(db, "requests"), where("email", "==", m.email))),
        ]);
        await Promise.all([...ps.docs, ...rs.docs].map((d) => deleteDoc(d.ref)));
      } catch (err) { console.warn("limpieza del miembro:", err.code || err.message); }
    });
    li.append(h("div", { class: "acciones-fila" }, rangoBtn, quitar));
  }
  li.append(msg);
  return li;
}

function pintarMiembros() {
  const q = normal(st.buscaMiembro.trim());
  const lista = st.miembros
    .filter((m) => !q || normal(`${nombreMiembro(m)} ${m.email}`).includes(q))
    .sort((a, b) => rango(a) - rango(b) || nombreMiembro(a).localeCompare(nombreMiembro(b), "es"));
  numMie.textContent = String(st.miembros.length);
  numMie.classList.toggle("cero", st.miembros.length === 0);
  const persona = (m) => st.personas.get(m.personId);
  const firma = (m) => JSON.stringify([m.role, m.fundador, m.personId, m.name, nombreMiembro(m), st.perfilesPorCorreo.get(m.email)?.photoURL, persona(m) ? etiquetaPersona(persona(m)) : null, st.esFundador]);
  reconciliar(listaMie, lista, (m) => m.email, firma, tarjetaMiembro, cacheMie);
  if (!lista.length && listaMie.children.length === 0) {
    listaMie.append(h("li", { class: "muted", text: q ? "Nadie coincide con esa búsqueda." : "Aún no hay miembros." }));
    cacheMie.clear();
  }
}

// ---------------------------------------------------------------------------
// Aprobar un correo por adelantado (el antiguo «invitar»)
// ---------------------------------------------------------------------------
formAdel.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const correo = correoAdel.value.replace(/\s+/g, "").toLowerCase(); // el id de members/ es el correo en minúsculas
  if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(correo)) { aviso(avisoAdel, "Escribe un correo válido (por ejemplo: nombre@hotmail.com).", "error"); correoAdel.focus(); return; }
  if (esMiembro(correo)) { aviso(avisoAdel, `${correo} ya es miembro de la red.`, "error"); return; }
  const persona = st.personas.get(selAdel?.valor()) || null;
  btnAdel.disabled = true;
  try {
    const lote = writeBatch(db);
    lote.set(doc(db, "members", correo), {
      personId: persona ? persona.id : null, name: persona ? persona.name.slice(0, 200) : null, role: "member",
      addedBy: st.email, addedAt: serverTimestamp(), approvedBy: st.email, approvedAt: serverTimestamp(),
    });
    // Si esa persona ya había pedido entrar, su solicitud queda aprobada también.
    st.solicitudes.filter((s) => s.email === correo && s.status === "pending")
      .forEach((s) => lote.update(doc(db, "requests", s.uid), { status: "approved", decidedBy: st.email, decidedAt: serverTimestamp() }));
    await lote.commit();
    aviso(avisoAdel, `Listo: ${correo} ya puede entrar.`);
    correoAdel.value = "";
    selAdel = selectorPersona();
    cajaSelAdel.replaceChildren(selAdel.el);
  } catch (err) {
    aviso(avisoAdel, fallo(err), "error");
  } finally {
    btnAdel.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
iniciarPagina({
  activa: "admin",
  raiz,
  alEntrar: ({ user, isAdmin, esFundador }) => {
    st.email = (user.email || "").toLowerCase();
    st.esFundador = Boolean(esFundador);
    if (!isAdmin) {
      toastEl.hidden = true;
      raiz.replaceChildren(h("div", { class: "card vacio", id: "soloAdmins" },
        h("h1", { text: "Solo para administradores" }),
        h("p", { text: "Esta página la usan los administradores de la red. Si necesitas algo, escríbele a uno de ellos." }),
        h("p", {}, h("a", { class: "primary", href: "/muro/", text: "Ir al muro" }))));
      return;
    }
    // (Si entró antes sin el rango y se lo acaban de dar, la página vuelve a montar el panel.)
    if (!raiz.contains(listaPend)) raiz.replaceChildren(...secciones);
    selAdel = selectorPersona();
    cajaSelAdel.replaceChildren(selAdel.el);
    const quitar = [];
    quitar.push(onSnapshot(query(collection(db, "requests"), limit(500)), (snap) => {
      st.solicitudes = snap.docs.map((d) => ({ uid: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
      st.cargadas = true;
      pintarSolicitudes();
    }, (err) => console.warn("solicitudes:", err.code || err.message)));
    quitar.push(onSnapshot(collection(db, "members"), (snap) => {
      st.miembros = snap.docs.map((d) => ({ email: d.id, ...d.data() }));
      pintarMiembros();
      pintarSolicitudes();
    }, (err) => console.warn("miembros:", err.code || err.message)));
    quitar.push(escucharPerfiles((perfiles) => {
      st.perfilesPorCorreo = new Map([...perfiles.values()].filter((p) => p.email).map((p) => [String(p.email).toLowerCase(), p]));
      pintarMiembros();
    }));
    quitar.push(escucharPersonas((personas) => {
      st.personas = personas;
      repintarSelectores();
      pintarMiembros();
    }));
    // Si otro administrador le quita el rango con el panel abierto, iniciarPagina (vigilarMiRango) vuelve a entrar
    // y esta página muestra «Solo para administradores».
    if (location.hash === "#solicitudes") setTimeout(() => $("solicitudes")?.scrollIntoView({ block: "start" }), 50);
    return () => { while (quitar.length) { try { quitar.pop()(); } catch { /* nada */ } } };
  },
});
