// Mensajes privados entre familiares (uno a uno o en grupo).
// Solo los participantes de una conversación pueden leerla (reglas de Firestore).
import {
  iniciarPagina, db, h, $, avatar, timeEl, escucharPerfiles,
  collection, doc, setDoc, query, where, limit, onSnapshot, serverTimestamp, writeBatch, updateDoc,
} from "/comun/base.js";

const raiz = $("raiz");
const st = { yo: null, perfiles: new Map(), convs: [], actual: null, msgs: [], unsubMsgs: null };

raiz.append(
  h("div", { class: "pagina-cab" },
    h("div", {}, h("h1", { text: "Mensajes" }), h("p", { text: "Conversaciones privadas: solo las ven quienes participan." })),
    h("button", { type: "button", class: "primary", id: "btnNueva", text: "+ Nueva conversación" })),
  h("div", { class: "chat" },
    h("div", { class: "chat-lista", id: "lista", "aria-label": "Tus conversaciones" }),
    h("section", { class: "chat-hilo", id: "hilo", "aria-label": "Conversación" },
      h("div", { class: "vacio", text: "Elige una conversación o empieza una nueva." }))),
);

const dlg = h("dialog", { class: "dialogo", "aria-labelledby": "dlgTitulo" });
document.body.append(dlg);

iniciarPagina({
  activa: "mensajes",
  raiz,
  alSalir: () => { st.unsubMsgs?.(); st.unsubMsgs = null; st.actual = null; },
  alEntrar: ({ user }) => {
    st.yo = user;
    const u1 = escucharPerfiles((m) => { st.perfiles = m; pintarLista(); });
    const u2 = onSnapshot(query(collection(db, "conversations"), where("members", "array-contains", user.uid), limit(200)), (snap) => {
      st.convs = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
        .sort((a, b) => (b.lastAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0) - (a.lastAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0));
      pintarLista();
      const pedido = new URLSearchParams(location.search).get("c");
      if (!st.actual && pedido && st.convs.some((c) => c.id === pedido)) abrir(pedido);
      else if (st.actual) pintarCabecera();
    }, (err) => console.error(err));
    $("btnNueva").onclick = nuevaConversacion;
    return () => { u1(); u2(); };
  },
});

function titulo(c) {
  if (c.title) return c.title;
  const otros = (c.members || []).filter((u) => u !== st.yo.uid);
  const nombres = otros.map((u) => c.info?.[u]?.name || st.perfiles.get(u)?.name || "Familiar");
  return nombres.join(", ") || "Solo tú";
}
function fotoDe(c) {
  const otros = (c.members || []).filter((u) => u !== st.yo.uid);
  if (otros.length !== 1) return null;
  return st.perfiles.get(otros[0])?.photoURL || c.info?.[otros[0]]?.photoURL || null;
}
const sinLeer = (c) => (c.lastAt?.toMillis?.() || 0) > (c.readBy?.[st.yo.uid]?.toMillis?.() || 0) && c.lastFrom && c.lastFrom !== st.yo.uid;

function pintarLista() {
  const lista = $("lista");
  if (!st.yo) return;
  if (!st.convs.length) {
    lista.replaceChildren(h("div", { class: "card vacio", text: "Aún no tienes conversaciones. Pulsa «Nueva conversación» para escribirle a un familiar." }));
    return;
  }
  lista.replaceChildren(...st.convs.map((c) => h("button", {
    type: "button", class: "chat-item", "aria-current": String(c.id === st.actual), onclick: () => abrir(c.id),
  },
  avatar(titulo(c), fotoDe(c)),
  h("span", { class: "info" }, h("b", { text: titulo(c) }), h("span", { text: c.lastText ? (c.lastFrom === st.yo.uid ? "Tú: " : "") + c.lastText : "Sin mensajes todavía" })),
  sinLeer(c) ? h("span", { class: "punto-nuevo", "aria-label": "Sin leer" }) : null)));
}

function pintarCabecera() {
  const c = st.convs.find((x) => x.id === st.actual);
  const cab = $("hilo").querySelector(".hilo-cab");
  if (!c || !cab) return;
  cab.replaceChildren(avatar(titulo(c), fotoDe(c)), h("div", {},
    h("h2", { text: titulo(c) }),
    h("span", { class: "tiempo", text: `${(c.members || []).length} participantes` })));
}

function abrir(id) {
  st.actual = id;
  st.unsubMsgs?.();
  const hilo = $("hilo");
  const msgs = h("div", { class: "hilo-msgs", id: "msgs", "aria-live": "polite" });
  const ta = h("textarea", { rows: "1", maxlength: "2000", placeholder: "Escribe un mensaje…", "aria-label": "Escribe un mensaje" });
  const form = h("form", { class: "hilo-form" }, ta, h("button", { type: "submit", class: "primary small", text: "Enviar" }));
  hilo.replaceChildren(h("div", { class: "hilo-cab" }), msgs, form);
  pintarCabecera();
  pintarLista();
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const texto = ta.value.trim();
    if (!texto) return;
    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      const batch = writeBatch(db);
      batch.set(doc(collection(db, "conversations", id, "messages")), {
        uid: st.yo.uid, name: (st.yo.displayName || st.yo.email).slice(0, 120), text: texto.slice(0, 2000), createdAt: serverTimestamp(),
      });
      batch.update(doc(db, "conversations", id), {
        lastText: texto.slice(0, 140), lastAt: serverTimestamp(), lastFrom: st.yo.uid, [`readBy.${st.yo.uid}`]: serverTimestamp(),
      });
      await batch.commit();
      ta.value = "";
    } catch (err) {
      console.error(err);
      alert("No se pudo enviar: " + (err.code || err.message));
    } finally {
      btn.disabled = false;
      ta.focus();
    }
  });
  st.unsubMsgs = onSnapshot(query(collection(db, "conversations", id, "messages"), limit(500)), (snap) => {
    st.msgs = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
      .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
    const caja = $("msgs");
    if (!caja) return;
    const alFinal = caja.scrollHeight - caja.scrollTop - caja.clientHeight < 80;
    caja.replaceChildren(...(st.msgs.length ? st.msgs.map((m) => h("div", { class: "msg" + (m.uid === st.yo.uid ? " mio" : "") },
      m.uid !== st.yo.uid ? h("span", { class: "autor", text: m.name }) : null,
      h("div", { class: "texto", text: m.text }), timeEl(m.createdAt, "tiempo"))) : [h("div", { class: "vacio", text: "Escribe el primer mensaje." })]));
    if (alFinal || snap.docChanges().length === snap.size) caja.scrollTop = caja.scrollHeight;
    // Marcar como leída.
    const c = st.convs.find((x) => x.id === id);
    if (c && sinLeer(c)) updateDoc(doc(db, "conversations", id), { [`readBy.${st.yo.uid}`]: serverTimestamp() }).catch(() => {});
  }, (err) => console.error(err));
  if (window.matchMedia("(max-width: 900px)").matches) hilo.scrollIntoView({ block: "start" });
  history.replaceState(null, "", `?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.search)), c: id })}`);
}

function nuevaConversacion() {
  const otros = [...st.perfiles.entries()].filter(([uid]) => uid !== st.yo.uid)
    .sort((a, b) => (a[1].name || "").localeCompare(b[1].name || "", "es"));
  const lista = h("div", { class: "lista-elegir", role: "group", "aria-label": "Familiares" },
    otros.length ? otros.map(([uid, p]) => h("label", {},
      h("input", { type: "checkbox", value: uid }), avatar(p.name, p.photoURL, "avatar-ini sm"), h("span", { text: p.name })))
      : h("p", { class: "muted small", text: "Todavía ningún otro familiar ha entrado a la red." }));
  const tituloIn = h("input", { type: "text", maxlength: "80", placeholder: "Ej. Primos Padrón Porras" });
  const campoTitulo = h("label", { class: "campo", hidden: true }, "Nombre del grupo (opcional)", tituloIn);
  lista.addEventListener("change", () => { campoTitulo.hidden = lista.querySelectorAll("input:checked").length < 2; });
  const form = h("form", {},
    h("h2", { id: "dlgTitulo", text: "Nueva conversación" }),
    h("p", { class: "muted small", text: "Elige a una persona o a varias para un grupo. Solo aparecen los familiares que ya entraron a la red." }),
    lista, campoTitulo,
    h("div", { class: "acciones" },
      h("button", { type: "button", class: "ghost", text: "Cancelar", onclick: () => dlg.close() }),
      h("button", { type: "submit", class: "primary small", text: "Empezar" })));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const elegidos = [...lista.querySelectorAll("input:checked")].map((i) => i.value);
    if (!elegidos.length) return;
    const miembros = [st.yo.uid, ...elegidos];
    const info = {};
    miembros.forEach((uid) => {
      const p = uid === st.yo.uid ? { name: st.yo.displayName || st.yo.email, photoURL: st.yo.photoURL } : st.perfiles.get(uid);
      info[uid] = { name: String(p?.name || "Familiar").slice(0, 120), photoURL: p?.photoURL && /^https:\/\//.test(p.photoURL) ? p.photoURL : null };
    });
    const id = elegidos.length === 1 ? "dm_" + [...miembros].sort().join("_") : doc(collection(db, "conversations")).id;
    try {
      if (!st.convs.some((c) => c.id === id)) {
        await setDoc(doc(db, "conversations", id), {
          members: miembros, info, title: elegidos.length > 1 ? tituloIn.value.trim().slice(0, 80) : "",
          createdBy: st.yo.uid, createdAt: serverTimestamp(), lastText: "", lastAt: serverTimestamp(), lastFrom: "",
          readBy: { [st.yo.uid]: serverTimestamp() },
        });
      }
      dlg.close();
      abrir(id);
    } catch (err) {
      console.error(err);
      alert("No se pudo crear la conversación: " + (err.code || err.message));
    }
  });
  dlg.replaceChildren(form);
  dlg.showModal();
}
