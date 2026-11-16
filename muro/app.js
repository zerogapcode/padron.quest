// Muro de la familia Padrón — Firebase Auth (Google) + Firestore + Storage.
// La seguridad la imponen las reglas de Firestore/Storage: solo miembros invitados
// leen y publican; cada quien solo marca su propio "me gusta"; solo los
// administradores gestionan la lista de invitados.
import {
  GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import {
  collection, collectionGroup, doc, getDoc, getDocs, setDoc, deleteDoc, addDoc, updateDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, arrayUnion, arrayRemove, writeBatch,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL, deleteObject,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-storage.js";
import { auth, db, storage, EMULADOR, avisar, montarCampana, montarContadorMensajes } from "/comun/base.js";

if (EMULADOR) window.__db = { db, doc, updateDoc, arrayUnion, setDoc, getDoc };

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
const state = {
  user: null,
  isAdmin: false,
  member: null,
  people: new Map(),
  rootId: null,
  posts: [],
  comments: new Map(),
  members: [],
  profiles: new Map(),
  branches: {},
  pendingProposals: 0,
  filter: "todo",
  openComments: new Set(),
  allComments: new Set(),
  drafts: new Map(),
};
const unsubs = [];
const myEmail = () => (state.user?.email || "").toLowerCase();
const safeUrl = (u) => (typeof u === "string" && (/^https:\/\//.test(u) || (EMULADOR && /^http:\/\/127\.0\.0\.1:/.test(u))) ? u : null);
const GRUPO = new URLSearchParams(location.search).get("grupo") || null;

// Construye elementos sin innerHTML (todo el texto de usuarios entra como texto).
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  children.flat().forEach((c) => { if (c !== null && c !== undefined && c !== false) el.append(c); });
  return el;
}
const SVG_NS = "http://www.w3.org/2000/svg";
function icon(paths) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "19"); svg.setAttribute("height", "19"); svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round"); svg.setAttribute("aria-hidden", "true");
  paths.forEach((d) => { const p = document.createElementNS(SVG_NS, "path"); p.setAttribute("d", d); svg.append(p); });
  return svg;
}
const ICON_CORAZON = ["M12 20s-7-4.4-7-9.6A4 4 0 0 1 12 8a4 4 0 0 1 7 2.4c0 5.2-7 9.6-7 9.6Z"];
const ICON_GLOBO = ["M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5v-7Z"];

function initials(name) {
  const parts = String(name || "?").replace(/["'()]/g, "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function avatar(name, photoURL, cls = "avatar-ini") {
  const url = safeUrl(photoURL);
  const el = h("span", { class: cls, "aria-hidden": "true" });
  if (url) el.append(h("img", { src: url, alt: "", referrerpolicy: "no-referrer", loading: "lazy" }));
  else el.textContent = initials(name);
  return el;
}

const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
function timeAgo(date) {
  const s = Math.round((date - Date.now()) / 1000);
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [u, sec] of units) if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), u);
  return "ahora";
}
function timeEl(ts) {
  if (!ts?.toDate) return h("time", { class: "post-time", text: "ahora" });
  const date = ts.toDate();
  return h("time", { class: "post-time", datetime: date.toISOString(), title: date.toLocaleString("es"), text: timeAgo(date) });
}

// ---------------------------------------------------------------------------
// Fechas del árbol ("23 Ene 1960", "1898", "1903-10-01") y cumpleaños
// ---------------------------------------------------------------------------
const MESES = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, set: 8, oct: 9, nov: 10, dic: 11 };
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function parseFecha(texto) {
  const s = String(texto || "").trim().toLowerCase();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return { d: +m[3], m: +m[2] - 1, y: +m[1] };
  m = /^(\d{1,2})\s+(?:de\s+)?([a-záéíóú]+)\.?(?:\s+(?:de\s+)?(\d{4}))?$/.exec(s);
  if (m) {
    const mes = MESES[m[2].normalize("NFD").replace(/[̀-ͯ]/g, "").slice(0, 3)];
    if (mes !== undefined) return { d: +m[1], m: mes, y: m[3] ? +m[3] : null };
  }
  return null;
}
function proximosCumpleanos() {
  const hoy = new Date();
  const base = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const lista = [];
  state.people.forEach((p) => {
    if (p.isDeceased) return;
    const sinPadresEnArbol = !state.people.has(p.fatherId) && !state.people.has(p.motherId);
    const soloExPareja = sinPadresEnArbol && (p.spouses || []).length > 0 && p.spouses.every((x) => x.status === "divorced");
    if (soloExPareja) return;
    const f = parseFecha(p.birthDate);
    if (!f || !f.d) return;
    let next = new Date(base.getFullYear(), f.m, f.d);
    if (next < base) next = new Date(base.getFullYear() + 1, f.m, f.d);
    const dias = Math.round((next - base) / 86400000);
    lista.push({ p, f, next, dias, edad: f.y ? next.getFullYear() - f.y : null });
  });
  return lista.sort((a, b) => a.dias - b.dias);
}
const fechaCorta = (f) => `${f.d} de ${MESES_LARGOS[f.m]}`;

// ---------------------------------------------------------------------------
// Acceso
// ---------------------------------------------------------------------------
const views = ["view-loading", "view-login", "view-denied", "view-wall"];
function show(view) { views.forEach((v) => ($(v).hidden = v !== view)); }

$("btn-login").addEventListener("click", async () => {
  $("login-error").hidden = true;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, provider);
      return;
    }
    if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") return;
    $("login-error").textContent = "No se pudo iniciar sesión: " + (err.code || err.message);
    $("login-error").hidden = false;
  }
});
$("btn-logout").addEventListener("click", () => signOut(auth));
$("btn-retry").addEventListener("click", () => auth.currentUser && enter(auth.currentUser));

onAuthStateChanged(auth, (user) => {
  while (unsubs.length) { try { unsubs.pop()(); } catch { /* nada */ } }
  state.user = user;
  if (!user) {
    $("user").hidden = true;
    $("nav").hidden = true;
    show("view-login");
    return;
  }
  $("user").hidden = false;
  $("user-name").textContent = user.displayName || user.email;
  const photo = safeUrl(user.photoURL);
  $("user-photo").hidden = !photo;
  if (photo) $("user-photo").src = photo;
  enter(user);
});

async function enter(user) {
  show("view-loading");
  const email = (user.email || "").toLowerCase();
  state.isAdmin = false;
  try {
    await getDocs(query(collection(db, "members"), limit(1)));
    state.isAdmin = true; // solo los administradores pueden listar miembros
  } catch { /* no es admin */ }
  state.member = null;
  try {
    const m = await getDoc(doc(db, "members", email));
    if (m.exists()) state.member = m.data();
  } catch { /* sin acceso */ }
  if (!state.isAdmin && !state.member) {
    $("denied-email").textContent = email;
    show("view-denied");
    return;
  }

  // Perfil público dentro de la familia (nombre y foto), para mostrar quién da "me gusta".
  setDoc(doc(db, "profiles", user.uid), {
    name: (user.displayName || email).slice(0, 120), photoURL: safeUrl(user.photoURL), email, updatedAt: serverTimestamp(),
  }).catch((e) => console.warn("perfil:", e));

  $("nav").hidden = false;
  $("admin").hidden = !state.isAdmin;
  unsubs.push(montarCampana($("campana")));
  unsubs.push(montarContadorMensajes($("navMensajes")));
  $("composer-avatar").replaceChildren(avatar(user.displayName || email, user.photoURL, "avatar-ini"));
  show("view-wall");

  try {
    const cfg = await getDoc(doc(db, "config", "arbol"));
    state.rootId = cfg.exists() ? cfg.data().rootId || null : null;
    state.branches = cfg.exists() ? cfg.data().branches || {} : {};
    pintarGrupos();
  } catch { /* árbol aún sin cargar */ }

  const qPosts = GRUPO
    ? query(collection(db, "posts"), where("group", "==", GRUPO), limit(150))
    : query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(80));
  unsubs.push(onSnapshot(qPosts, (snap) => {
    state.posts = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
      .filter((p) => (GRUPO ? p.group === GRUPO : !p.group))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    renderFeed();
    renderSaludo();
  }, (err) => { console.error(err); $("feed").textContent = "No se pudo cargar el muro (" + err.code + ")."; }));

  unsubs.push(onSnapshot(query(collectionGroup(db, "comments"), limit(1000)), (snap) => {
    const map = new Map();
    snap.docs.forEach((d) => {
      const c = { id: d.id, ...d.data({ serverTimestamps: "estimate" }) };
      if (!map.has(c.postId)) map.set(c.postId, []);
      map.get(c.postId).push(c);
    });
    map.forEach((list) => list.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0)));
    state.comments = map;
    renderFeed();
  }, (err) => console.error("comentarios:", err)));

  unsubs.push(onSnapshot(collection(db, "profiles"), (snap) => {
    state.profiles = new Map(snap.docs.map((d) => [d.id, d.data()]));
    renderFeed();
  }, (err) => console.error("perfiles:", err)));

  unsubs.push(onSnapshot(collection(db, "people"), (snap) => {
    state.people = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    renderSide();
    renderSaludo();
    if (state.isAdmin) renderMembers();
  }, (err) => console.error("árbol:", err)));

  const propQ = state.isAdmin
    ? query(collection(db, "proposals"), where("status", "==", "pending"))
    : query(collection(db, "proposals"), where("uid", "==", user.uid), where("status", "==", "pending"));
  unsubs.push(onSnapshot(propQ, (snap) => {
    state.pendingProposals = snap.size;
    $("navProposals").textContent = String(snap.size);
    $("navProposals").hidden = !state.isAdmin || snap.size === 0;
    renderSaludo();
  }, (err) => console.error("propuestas:", err)));

  if (state.isAdmin) {
    unsubs.push(onSnapshot(collection(db, "members"), (snap) => {
      state.members = snap.docs.map((d) => ({ email: d.id, ...d.data() })).sort((a, b) => a.email.localeCompare(b.email));
      renderMembers();
    }, (err) => console.error("miembros:", err)));
  }
  renderSaludo();
  renderSide();
}

// ---------------------------------------------------------------------------
// Saludo
// ---------------------------------------------------------------------------
function miPersona() {
  const id = state.member?.personId;
  return id ? state.people.get(id) || null : null;
}

function renderSaludo() {
  if (!state.user) return;
  const ahora = new Date();
  const hora = ahora.getHours();
  $("saludo-hola").textContent = hora < 12 ? "Buenos días" : hora < 19 ? "Buenas tardes" : "Buenas noches";
  const persona = miPersona();
  const nombre = (persona?.name || state.user.displayName || myEmail()).split(/\s+/)[0];
  $("saludo-nombre").textContent = nombre;
  const fecha = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" }).format(ahora);
  $("saludo-fecha").textContent = fecha.charAt(0).toUpperCase() + fecha.slice(1);

  const partes = [];
  const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();
  const hoyPosts = state.posts.filter((p) => (p.createdAt?.toMillis?.() || 0) >= inicioHoy).length;
  partes.push(hoyPosts === 0 ? "Hoy todavía nadie ha publicado" : hoyPosts === 1 ? "1 publicación nueva hoy" : `${hoyPosts} publicaciones nuevas hoy`);
  const cumple = proximosCumpleanos()[0];
  if (cumple) {
    const quien = cumple.p.name.split(/\s+/).slice(0, 2).join(" ");
    partes.push(cumple.dias === 0 ? `¡hoy cumple años ${quien}!` : cumple.dias === 1 ? `mañana cumple ${quien}` : `el próximo cumpleaños es el de ${quien} (${fechaCorta(cumple.f)})`);
  }
  if (state.pendingProposals > 0) {
    partes.push(state.isAdmin
      ? `${state.pendingProposals} ${state.pendingProposals === 1 ? "propuesta espera" : "propuestas esperan"} tu revisión en el árbol`
      : `tienes ${state.pendingProposals} ${state.pendingProposals === 1 ? "propuesta pendiente" : "propuestas pendientes"} en el árbol`);
  }
  const texto = partes.join(" · ");
  $("saludo-resumen").textContent = texto.charAt(0).toUpperCase() + texto.slice(1) + ".";
}

$("btn-ir-compartir").addEventListener("click", () => {
  $("post-text").focus();
  $("composer").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
});

// ---------------------------------------------------------------------------
// Muro
// ---------------------------------------------------------------------------
document.querySelectorAll(".filtro").forEach((b) => {
  b.addEventListener("click", () => {
    state.filter = b.dataset.filtro;
    document.querySelectorAll(".filtro").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderFeed();
  });
});

function nombreDeUid(uid) {
  if (uid === state.user?.uid) return "ti";
  const perfil = state.profiles.get(uid);
  if (perfil?.name) return perfil.name.split(/\s+/)[0];
  const p = state.posts.find((x) => x.uid === uid);
  if (p) return (p.name || p.email || "").split(/\s+/)[0];
  for (const list of state.comments.values()) {
    const c = list.find((x) => x.uid === uid);
    if (c) return (c.name || c.email || "").split(/\s+/)[0];
  }
  return "alguien";
}

function textoLikes(likedBy) {
  if (!likedBy.length) return "";
  const meGusta = likedBy.includes(state.user.uid);
  const otros = likedBy.filter((u) => u !== state.user.uid).map(nombreDeUid);
  if (meGusta && otros.length === 0) return "Te gusta a ti";
  const nombres = meGusta ? ["ti", ...otros] : otros;
  if (nombres.length <= 2) return `Les gusta a ${nombres.join(" y ")}`.replace("Les gusta a ti", "Te gusta a ti");
  return `Les gusta a ${nombres.slice(0, 2).join(", ")} y ${nombres.length - 2} más`;
}

function renderFeed() {
  if (!state.user) return;
  const feed = $("feed");
  // Conservar lo que el usuario está escribiendo en un comentario.
  const activo = document.activeElement;
  const foco = activo?.dataset?.comentarPost ? { id: activo.dataset.comentarPost, pos: activo.selectionStart } : null;

  let lista = state.posts;
  if (state.filter === "fotos") lista = lista.filter((p) => p.imageURL);
  if (state.filter === "mias") lista = lista.filter((p) => p.uid === state.user.uid);
  feed.replaceChildren(...lista.map(renderPost));
  $("feed-empty").hidden = lista.length > 0;

  if (foco) {
    const el = feed.querySelector(`[data-comentar-post="${CSS.escape(foco.id)}"]`);
    if (el) { el.focus(); try { el.setSelectionRange(foco.pos, foco.pos); } catch { /* nada */ } }
  }
}

function renderPost(p) {
  const me = state.user;
  const likedBy = Array.isArray(p.likedBy) ? p.likedBy : [];
  const meGusta = likedBy.includes(me.uid);
  const comentarios = state.comments.get(p.id) || [];
  const abierto = state.openComments.has(p.id);
  const puedeBorrar = p.uid === me.uid || state.isAdmin;

  const art = h("article", { class: "card post", "data-post-id": p.id },
    h("header", { class: "post-head" },
      avatar(p.name || p.email, p.photoURL),
      h("div", { class: "post-autor" },
        h("div", { class: "post-name", text: p.name || p.email }),
        timeEl(p.createdAt))));

  if (p.text) art.append(h("p", { class: "post-text", text: p.text }));
  const img = safeUrl(p.imageURL);
  if (img) {
    art.append(h("button", { type: "button", class: "post-img-btn", "aria-label": "Ver la foto en grande", onclick: () => verFoto(img) },
      h("img", { class: "post-img", src: img, alt: "Foto de la publicación", loading: "lazy" })));
  }
  const likesTxt = textoLikes(likedBy);
  if (likesTxt) art.append(h("div", { class: "likes-quien", text: likesTxt }));

  const btnLike = h("button", {
    type: "button", class: "accion", "aria-pressed": String(meGusta),
    onclick: async (e) => {
      e.currentTarget.disabled = true;
      try {
        await updateDoc(doc(db, "posts", p.id), { likedBy: meGusta ? arrayRemove(me.uid) : arrayUnion(me.uid) });
        if (!meGusta) avisar(p.uid, { type: "me-gusta", text: `A ${(me.displayName || "un familiar").split(" ")[0]} le gustó tu publicación${p.text ? `: «${p.text.slice(0, 60)}»` : ""}.`, link: location.pathname + location.search });
      }
      catch (err) { console.error(err); alert("No se pudo marcar: " + (err.code || err.message)); }
    },
  }, icon(ICON_CORAZON), h("span", { text: likedBy.length ? `Me gusta · ${likedBy.length}` : "Me gusta" }));
  const btnCom = h("button", {
    type: "button", class: "accion", "aria-expanded": String(abierto),
    onclick: () => {
      if (abierto) state.openComments.delete(p.id); else state.openComments.add(p.id);
      renderFeed();
      if (!abierto) $("feed").querySelector(`[data-comentar-post="${CSS.escape(p.id)}"]`)?.focus();
    },
  }, icon(ICON_GLOBO), h("span", { text: comentarios.length ? `Comentar · ${comentarios.length}` : "Comentar" }));
  const acciones = h("div", { class: "post-actions" }, btnLike, btnCom);
  if (puedeBorrar) {
    acciones.append(h("button", { type: "button", class: "accion borrar", text: "Borrar", onclick: () => borrarPost(p) }));
  }
  art.append(acciones);

  // Comentarios: siempre se ven los dos últimos; el resto al pedirlo.
  if (comentarios.length || abierto) {
    const box = h("div", { class: "comentarios" });
    const todos = state.allComments.has(p.id) || abierto;
    const visibles = todos ? comentarios : comentarios.slice(-2);
    if (!todos && comentarios.length > 2) {
      box.append(h("button", { type: "button", class: "ver-mas", text: `Ver los ${comentarios.length} comentarios`,
        onclick: () => { state.allComments.add(p.id); renderFeed(); } }));
    }
    visibles.forEach((c) => {
      const cuerpo = h("div", { class: "comentario-cuerpo" },
        h("b", { text: c.name || c.email }), timeEl(c.createdAt),
        h("div", { class: "comentario-texto", text: c.text }));
      const fila = h("div", { class: "comentario" }, avatar(c.name || c.email, c.photoURL, "avatar-ini sm"), cuerpo);
      if (c.uid === me.uid || state.isAdmin) {
        cuerpo.append(h("button", { type: "button", class: "borrar-com", text: "Borrar", onclick: async () => {
          if (!confirm("¿Borrar este comentario?")) return;
          try { await deleteDoc(doc(db, "posts", p.id, "comments", c.id)); } catch (err) { alert("No se pudo borrar: " + (err.code || err.message)); }
        } }));
      }
      box.append(fila);
    });
    if (abierto) {
      const ta = h("textarea", { rows: "1", maxlength: "1000", placeholder: "Escribe un comentario…", "aria-label": "Escribe un comentario", "data-comentar-post": p.id });
      ta.value = state.drafts.get(p.id) || "";
      ta.addEventListener("input", () => state.drafts.set(p.id, ta.value));
      const form = h("form", { class: "comentar" }, ta, h("button", { type: "submit", class: "primary small", text: "Enviar" }));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const texto = ta.value.trim();
        if (!texto) return;
        const btn = form.querySelector("button");
        btn.disabled = true;
        try {
          await addDoc(collection(db, "posts", p.id, "comments"), {
            uid: me.uid, email: myEmail(), name: (me.displayName || myEmail()).slice(0, 120),
            photoURL: safeUrl(me.photoURL), text: texto.slice(0, 1000), postId: p.id, createdAt: serverTimestamp(),
          });
          state.drafts.delete(p.id);
          ta.value = "";
          const quien = (me.displayName || "Un familiar").split(" ")[0];
          avisar(p.uid, { type: "comentario", text: `${quien} comentó tu publicación: «${texto.slice(0, 80)}»`, link: location.pathname + location.search });
          new Set(comentarios.map((c) => c.uid)).forEach((uid) => { if (uid !== p.uid) avisar(uid, { type: "comentario", text: `${quien} también comentó: «${texto.slice(0, 80)}»`, link: location.pathname + location.search }); });
        } catch (err) {
          console.error(err);
          alert("No se pudo comentar: " + (err.code || err.message));
        } finally {
          btn.disabled = false;
        }
      });
      ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
      box.append(form);
    }
    art.append(box);
  }
  return art;
}

async function borrarPost(p) {
  if (!confirm("¿Borrar esta publicación y sus comentarios?")) return;
  try {
    const batch = writeBatch(db);
    (state.comments.get(p.id) || []).forEach((c) => batch.delete(doc(db, "posts", p.id, "comments", c.id)));
    batch.delete(doc(db, "posts", p.id));
    await batch.commit();
    if (p.imagePath) deleteObject(ref(storage, p.imagePath)).catch((e) => console.warn("foto no borrada", e));
  } catch (err) {
    console.error(err);
    alert("No se pudo borrar: " + (err.code || err.message));
  }
}

function verFoto(url) {
  $("foto-grande-img").src = url;
  $("foto-grande").showModal();
}
$("btn-cerrar-foto").addEventListener("click", () => $("foto-grande").close());
$("foto-grande").addEventListener("click", (e) => { if (e.target === $("foto-grande")) $("foto-grande").close(); });

// ---------------------------------------------------------------------------
// Publicar
// ---------------------------------------------------------------------------
let pendingImage = null;
let previewURL = null;
function setStatus(msg) { $("composer-status").textContent = msg; }

$("post-photo").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  setStatus("Preparando foto…");
  try {
    pendingImage = await compressImage(file);
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = URL.createObjectURL(pendingImage);
    $("preview-img").src = previewURL;
    $("preview").hidden = false;
    setStatus("");
  } catch (err) {
    console.error(err);
    pendingImage = null;
    setStatus("No se pudo leer la foto.");
  }
});
$("btn-remove-photo").addEventListener("click", () => { pendingImage = null; $("preview").hidden = true; });

$("composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("post-text").value.trim();
  if (!text && !pendingImage) { $("post-text").focus(); return; }
  const user = auth.currentUser;
  $("btn-post").disabled = true;
  try {
    let imageURL = null, imagePath = null;
    if (pendingImage) {
      setStatus("Subiendo foto…");
      const rand = Math.random().toString(36).slice(2, 10);
      imagePath = `posts/${user.uid}/${Date.now()}-${rand}.jpg`;
      const objRef = ref(storage, imagePath);
      await uploadBytes(objRef, pendingImage, { contentType: "image/jpeg", cacheControl: "public, max-age=31536000" });
      imageURL = await getDownloadURL(objRef);
    }
    setStatus("Publicando…");
    await addDoc(collection(db, "posts"), {
      uid: user.uid,
      email: myEmail(),
      name: (user.displayName || user.email).slice(0, 120),
      photoURL: safeUrl(user.photoURL),
      text,
      imageURL,
      imagePath,
      ...(GRUPO ? { group: GRUPO } : {}),
      createdAt: serverTimestamp(),
    });
    $("post-text").value = "";
    pendingImage = null;
    $("preview").hidden = true;
    setStatus("");
  } catch (err) {
    console.error(err);
    setStatus("No se pudo publicar (" + (err.code || err.message) + ").");
  } finally {
    $("btn-post").disabled = false;
  }
});

// Reduce la foto en el navegador antes de subirla (máximo 2048 px, JPEG < 4 MB).
// Al redibujarla en un canvas se descartan los metadatos (incluida la ubicación GPS).
const MAX_SIDE = 2048;
const MAX_BYTES = 4 * 1024 * 1024;
const toBlob = (canvas, q) => new Promise((res) => canvas.toBlob(res, "image/jpeg", q));
async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let side = MAX_SIDE;
    for (let attempt = 0; attempt < 5; attempt++) {
      const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const hgt = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = hgt;
      canvas.getContext("2d").drawImage(img, 0, 0, w, hgt);
      for (const quality of [0.85, 0.72]) {
        const blob = await toBlob(canvas, quality);
        if (blob && blob.size < MAX_BYTES) return blob;
      }
      side = Math.round(side * 0.75);
    }
    throw new Error("La foto es demasiado grande incluso comprimida");
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// Columna lateral: cumpleaños, tu rama, completar el árbol
// ---------------------------------------------------------------------------
function renderSide() {
  // Cumpleaños
  const cumples = proximosCumpleanos();
  const dest = $("cumple-destacado");
  const lista = $("cumple-lista");
  dest.replaceChildren();
  lista.replaceChildren();
  $("cumple-vacio").hidden = cumples.length > 0;
  if (cumples.length) {
    const c = cumples[0];
    const cuando = c.dias === 0 ? "¡Hoy!" : c.dias === 1 ? "Mañana" : fechaCorta(c.f);
    dest.append(h("div", { class: "cumple-hoy" },
      avatar(c.p.name, c.p.photoURL),
      h("div", {}, h("b", { text: c.p.name }), h("span", { text: c.edad ? `${cuando} · cumple ${c.edad}` : cuando }))));
    cumples.slice(1, 5).forEach((x) => {
      lista.append(h("li", {}, h("span", { text: x.p.name }), h("span", { text: x.dias === 1 ? "mañana" : `${x.f.d} ${MESES_LARGOS[x.f.m].slice(0, 3)}` })));
    });
  }

  // Tu rama
  const rama = $("mi-rama");
  rama.replaceChildren();
  const yo = miPersona();
  $("mi-ficha-vacia").hidden = Boolean(yo);
  if (yo) {
    const cadena = [yo];
    let cur = yo;
    for (let i = 0; i < 4; i++) {
      const padres = [cur.fatherId, cur.motherId].map((id) => state.people.get(id)).filter(Boolean);
      // Preferir el padre o la madre que sigue la línea Padrón.
      const siguiente = padres.find((x) => /padr[oó]n/i.test(x.name)) || padres[0];
      if (!siguiente) break;
      cadena.unshift(siguiente);
      cur = siguiente;
    }
    const titulos = ["Tú", "Tu padre o madre", "Tu abuelo o abuela", "Tu bisabuelo o bisabuela", "Tu tatarabuelo o tatarabuela"];
    cadena.forEach((p, i) => {
      const nivel = cadena.length - 1 - i;
      let rol = titulos[nivel] || "Antepasado";
      if (nivel > 0 && nivel <= 4) {
        const m = p.gender === "Female";
        rol = ["", m ? "Tu madre" : "Tu padre", m ? "Tu abuela" : "Tu abuelo", m ? "Tu bisabuela" : "Tu bisabuelo", m ? "Tu tatarabuela" : "Tu tatarabuelo"][nivel];
      }
      rama.append(h("li", {},
        h("span", { class: "eje" }, h("span", { class: "punto" }), h("span", { class: "tramo" })),
        h("span", { class: "dato" }, h("b", { text: nivel === 0 ? `${p.name}` : p.name }), h("span", { text: [rol, p.birthPlace].filter(Boolean).join(" · ") }))));
    });
  }

  // Completar el árbol
  const barras = $("barras");
  barras.replaceChildren();
  const total = state.people.size;
  if (total) {
    const conFecha = [...state.people.values()].filter((p) => parseFecha(p.birthDate) || /\d{4}/.test(p.birthDate || "")).length;
    const conLugar = [...state.people.values()].filter((p) => (p.birthPlace || "").trim()).length;
    const conFoto = [...state.people.values()].filter((p) => safeUrl(p.photoURL)).length;
    [["Fechas de nacimiento", conFecha, "var(--drago)"], ["Lugares de nacimiento", conLugar, "var(--atlantico)"], ["Fotos", conFoto, "var(--ocre)"]]
      .forEach(([label, n, color]) => {
        const pct = Math.round((n / total) * 100);
        const relleno = h("div", { class: "barra-relleno" });
        relleno.style.width = Math.max(2, pct) + "%";
        relleno.style.background = color;
        barras.append(h("div", { class: "barra" },
          h("div", { class: "barra-fila" }, h("span", { text: label }), h("span", { text: `${n} de ${total}` })),
          h("div", { class: "barra-fondo", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(total), "aria-valuenow": String(n), "aria-label": label }, relleno)));
      });
  } else {
    barras.append(h("p", { class: "muted small", text: "El árbol todavía no se ha cargado." }));
  }
}

// ---------------------------------------------------------------------------
// Administración de invitados (solo admins)
// ---------------------------------------------------------------------------
function opcionesPersonas(seleccion) {
  const personas = [...state.people.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  return [h("option", { value: "", text: "— Sin vincular a una ficha —" }),
    ...personas.map((p) => { const o = h("option", { value: p.id, text: p.name }); if (p.id === seleccion) o.selected = true; return o; })];
}

function renderMembers() {
  if (!state.isAdmin) return;
  const sel = $("member-person");
  const actual = sel.value;
  sel.replaceChildren(...opcionesPersonas(actual));
  $("member-count").textContent = `(${state.members.length})`;
  const list = $("member-list");
  if (!state.members.length) {
    list.replaceChildren(h("li", { class: "muted small", text: "Aún no hay invitados." }));
    return;
  }
  list.replaceChildren(...state.members.map((m) => {
    const s = h("select", { "aria-label": `Ficha del árbol de ${m.email}` }, ...opcionesPersonas(m.personId));
    s.addEventListener("change", async () => {
      const persona = state.people.get(s.value);
      try {
        await setDoc(doc(db, "members", m.email), { personId: persona ? persona.id : null, name: persona ? persona.name : null }, { merge: true });
      } catch (err) { alert("No se pudo vincular: " + (err.code || err.message)); }
    });
    return h("li", {},
      h("div", { class: "fila" }, h("span", { text: m.email }),
        h("button", { type: "button", class: "ghost small", text: "Quitar", onclick: async () => {
          if (!confirm(`¿Quitar el acceso de ${m.email}?`)) return;
          try { await deleteDoc(doc(db, "members", m.email)); } catch (err) { alert("No se pudo quitar: " + (err.code || err.message)); }
        } })),
      s);
  }));
}

$("member-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("member-email").value.trim().toLowerCase();
  if (!email) return;
  const persona = state.people.get($("member-person").value);
  try {
    await setDoc(doc(db, "members", email), {
      addedAt: serverTimestamp(), addedBy: myEmail(),
      personId: persona ? persona.id : null, name: persona ? persona.name : null,
    });
    $("member-email").value = "";
    $("member-person").value = "";
  } catch (err) {
    alert("No se pudo invitar: " + (err.code || err.message));
  }
});

// ---------------------------------------------------------------------------
// Grupos por rama
// ---------------------------------------------------------------------------
function pintarGrupos() {
  const ramas = Object.values(state.branches).filter((b) => b.id !== "raiz").sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const lista = $("grupos-lista");
  lista.replaceChildren(
    h("a", { href: "/muro/", class: "grupo" + (GRUPO ? "" : " activo") }, h("span", { class: "punto-color", style: "background:#13293D" }), "Toda la familia Padrón Perera"),
    ...ramas.map((b) => h("a", { href: `/muro/?grupo=${encodeURIComponent(b.id)}`, class: "grupo" + (GRUPO === b.id ? " activo" : "") },
      h("span", { class: "punto-color", style: `background:${/^#[0-9A-Fa-f]{6}$/.test(b.color) ? b.color : "#56636E"}` }), b.shortLabel)));
  const banner = $("grupo-banner");
  if (GRUPO) {
    const b = state.branches[GRUPO];
    banner.hidden = false;
    banner.replaceChildren(
      h("b", { text: `Grupo de la rama ${b ? b.shortLabel : ""}` }),
      h("span", { text: b ? ` · ${b.description || b.label}. Lo que publiques aquí lo verá toda la familia, pero se guarda en este grupo.` : " · Este grupo ya no existe." }),
      " ", h("a", { href: "/muro/", text: "Volver al muro de toda la familia" }));
    document.title = `${b ? b.shortLabel : "Grupo"} · Familia Padrón Perera`;
  }
}
