// Eventos y cumpleaños de la familia: reuniones con confirmación de asistencia
// y el calendario de cumpleaños que sale del árbol.
import {
  iniciarPagina, db, h, $, avatar, parseFecha, MESES_LARGOS, avisar, escucharPerfiles, escucharPersonas,
  collection, doc, setDoc, addDoc, updateDoc, deleteDoc, query, limit, onSnapshot, serverTimestamp, writeBatch,
} from "/comun/base.js";
import { collectionGroup } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";

const raiz = $("raiz");
const st = { yo: null, isAdmin: false, eventos: [], rsvps: new Map(), personas: new Map(), perfiles: new Map(), verPasados: false };

raiz.append(
  h("div", { class: "pagina-cab" },
    h("div", {}, h("h1", { text: "Eventos y cumpleaños" }), h("p", { text: "Reuniones de la familia y el calendario de cumpleaños del árbol." })),
    h("button", { type: "button", class: "primary", id: "btnNuevo", text: "+ Nuevo evento" })),
  h("div", { class: "eventos" },
    h("div", { class: "eventos-lista", id: "lista" }),
    h("aside", { class: "eventos-lado" },
      h("section", { class: "card cumple-mes", "aria-labelledby": "tCumples" },
        h("h2", { id: "tCumples", text: "Cumpleaños" }), h("div", { id: "cumples" }))))
);
const dlg = h("dialog", { class: "dialogo", "aria-labelledby": "dlgTitulo" });
document.body.append(dlg);

iniciarPagina({
  activa: "eventos",
  raiz,
  alEntrar: ({ user, isAdmin }) => {
    st.yo = user;
    st.isAdmin = isAdmin;
    $("btnNuevo").onclick = () => editarEvento(null);
    const u1 = onSnapshot(query(collection(db, "events"), limit(300)), (snap) => {
      st.eventos = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
      pintar();
    }, (err) => console.error(err));
    const u2 = onSnapshot(query(collectionGroup(db, "rsvps"), limit(3000)), (snap) => {
      const m = new Map();
      snap.docs.forEach((d) => {
        const r = { uid: d.id, ...d.data() };
        if (!m.has(r.eventId)) m.set(r.eventId, []);
        m.get(r.eventId).push(r);
      });
      st.rsvps = m;
      pintar();
    }, (err) => console.error(err));
    const u3 = escucharPersonas((m) => { st.personas = m; pintarCumples(); });
    const u4 = escucharPerfiles((m) => { st.perfiles = m; });
    return () => { u1(); u2(); u3(); u4(); };
  },
});

const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function pintar() {
  if (!st.yo) return;
  const hoy = hoyISO();
  const orden = (a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || ""));
  const proximos = st.eventos.filter((e) => e.date >= hoy).sort(orden);
  const pasados = st.eventos.filter((e) => e.date < hoy).sort(orden).reverse();
  const lista = $("lista");
  const items = [];
  items.push(proximos.length ? proximos.map(tarjeta) : h("div", { class: "card vacio", text: "No hay reuniones programadas. ¡Organiza la próxima con «Nuevo evento»!" }));
  if (pasados.length) {
    items.push(h("button", { type: "button", class: "ghost", text: st.verPasados ? "Ocultar eventos pasados" : `Ver eventos pasados (${pasados.length})`,
      onclick: () => { st.verPasados = !st.verPasados; pintar(); } }));
    if (st.verPasados) items.push(pasados.map(tarjeta));
  }
  lista.replaceChildren(...items.flat());
}

function tarjeta(e) {
  const [y, m, d] = e.date.split("-").map(Number);
  const fecha = new Date(y, m - 1, d);
  const dia = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(fecha);
  const respuestas = st.rsvps.get(e.id) || [];
  const mia = respuestas.find((r) => r.uid === st.yo.uid)?.status;
  const van = respuestas.filter((r) => r.status === "si");
  const quizas = respuestas.filter((r) => r.status === "quizas");
  const responder = async (status) => {
    try {
      if (mia === status) await deleteDoc(doc(db, "events", e.id, "rsvps", st.yo.uid));
      else await setDoc(doc(db, "events", e.id, "rsvps", st.yo.uid), { status, eventId: e.id, name: (st.yo.displayName || st.yo.email).slice(0, 120), updatedAt: serverTimestamp() });
    } catch (err) { alert("No se pudo guardar: " + (err.code || err.message)); }
  };
  const puedeEditar = e.uid === st.yo.uid || st.isAdmin;
  return h("article", { class: "card evento" },
    h("div", { class: "evento-fecha", "aria-hidden": "true" }, h("small", { text: MESES_LARGOS[m - 1].slice(0, 3) }), h("b", { text: String(d) })),
    h("div", { class: "evento-cuerpo" },
      h("h3", { text: e.title }),
      h("div", { class: "evento-meta", text: [dia.charAt(0).toUpperCase() + dia.slice(1), e.time, e.place].filter(Boolean).join(" · ") }),
      e.description ? h("p", { class: "evento-desc", text: e.description }) : null,
      h("div", { class: "evento-meta", text: `Organiza: ${e.name}` }),
      h("div", { class: "rsvp", role: "group", "aria-label": "¿Vas a ir?" },
        [["si", "Asistiré"], ["quizas", "Tal vez"], ["no", "No podré"]].map(([v, t]) =>
          h("button", { type: "button", "aria-pressed": String(mia === v), text: t, onclick: () => responder(v) }))),
      van.length || quizas.length ? h("div", { class: "asistentes", text: [
        van.length ? `Van (${van.length}): ${van.map((r) => r.name.split(" ")[0]).join(", ")}` : "",
        quizas.length ? `Tal vez (${quizas.length}): ${quizas.map((r) => r.name.split(" ")[0]).join(", ")}` : "",
      ].filter(Boolean).join(" · ") }) : null,
      puedeEditar ? h("div", { class: "rsvp" },
        h("button", { type: "button", text: "Editar", onclick: () => editarEvento(e) }),
        h("button", { type: "button", text: "Borrar", onclick: async () => {
          if (!confirm(`¿Borrar el evento «${e.title}»?`)) return;
          try {
            const batch = writeBatch(db);
            (st.rsvps.get(e.id) || []).forEach((r) => batch.delete(doc(db, "events", e.id, "rsvps", r.uid)));
            batch.delete(doc(db, "events", e.id));
            await batch.commit();
          } catch (err) { alert("No se pudo borrar: " + (err.code || err.message)); }
        } })) : null));
}

function editarEvento(e) {
  const campo = (label, input) => h("label", { class: "campo" }, label, input);
  const titulo = h("input", { type: "text", required: true, maxlength: "120", value: e?.title || "", placeholder: "Ej. Almuerzo de los Padrón" });
  const fecha = h("input", { type: "date", required: true, value: e?.date || "" });
  const hora = h("input", { type: "time", value: e?.time || "" });
  const lugar = h("input", { type: "text", maxlength: "200", value: e?.place || "", placeholder: "Ej. Casa de la tía, Caracas" });
  const desc = h("textarea", { rows: "3", maxlength: "2000", placeholder: "Qué llevar, cómo llegar…" });
  desc.value = e?.description || "";
  const form = h("form", {},
    h("h2", { id: "dlgTitulo", text: e ? "Editar evento" : "Nuevo evento" }),
    campo("Nombre del evento *", titulo), campo("Fecha *", fecha), campo("Hora", hora), campo("Lugar", lugar), campo("Detalles", desc),
    h("div", { class: "acciones" },
      h("button", { type: "button", class: "ghost", text: "Cancelar", onclick: () => dlg.close() }),
      h("button", { type: "submit", class: "primary small", text: e ? "Guardar" : "Crear evento" })));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!titulo.value.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(fecha.value)) { form.reportValidity(); return; }
    const datos = { title: titulo.value.trim().slice(0, 120), date: fecha.value, time: hora.value.slice(0, 10), place: lugar.value.trim().slice(0, 200), description: desc.value.trim().slice(0, 2000) };
    try {
      if (e) {
        await updateDoc(doc(db, "events", e.id), datos);
      } else {
        await addDoc(collection(db, "events"), { ...datos, uid: st.yo.uid, name: (st.yo.displayName || st.yo.email).slice(0, 120), createdAt: serverTimestamp() });
        const quien = (st.yo.displayName || "Un familiar").split(" ")[0];
        st.perfiles.forEach((_, uid) => avisar(uid, { type: "evento", text: `${quien} organizó «${datos.title}» para el ${fechaLarga(datos.date)}.`, link: "/eventos/" }));
      }
      dlg.close();
    } catch (err) {
      alert("No se pudo guardar: " + (err.code || err.message));
    }
  });
  dlg.replaceChildren(form);
  dlg.showModal();
}

function fechaLarga(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES_LARGOS[m - 1]}` + (y !== new Date().getFullYear() ? ` de ${y}` : "");
}

function pintarCumples() {
  const caja = $("cumples");
  const hoy = new Date();
  const base = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const lista = [];
  st.personas.forEach((p) => {
    if (p.isDeceased) return;
    const sinPadres = !st.personas.has(p.fatherId) && !st.personas.has(p.motherId);
    if (sinPadres && (p.spouses || []).length && p.spouses.every((s) => s.status === "divorced")) return;
    const f = parseFecha(p.birthDate);
    if (!f || !f.d) return;
    let next = new Date(base.getFullYear(), f.m, f.d);
    if (next < base) next = new Date(base.getFullYear() + 1, f.m, f.d);
    lista.push({ p, f, next, edad: f.y ? next.getFullYear() - f.y : null });
  });
  lista.sort((a, b) => a.next - b.next);
  if (!lista.length) { caja.replaceChildren(h("p", { class: "muted small", text: "Cuando el árbol tenga fechas de nacimiento completas, aquí aparecerá el calendario." })); return; }
  const porMes = new Map();
  lista.forEach((x) => {
    const k = `${x.next.getFullYear()}-${x.next.getMonth()}`;
    if (!porMes.has(k)) porMes.set(k, { mes: x.next.getMonth(), items: [] });
    porMes.get(k).items.push(x);
  });
  caja.replaceChildren(...[...porMes.values()].flatMap(({ mes, items }) => [
    h("h3", { text: MESES_LARGOS[mes] }),
    h("ul", {}, items.map((x) => h("li", {}, h("span", { text: x.p.name }), h("span", { text: `${x.f.d}${x.edad ? ` · ${x.edad}` : ""}` })))),
  ]));
  void avatar;
}
