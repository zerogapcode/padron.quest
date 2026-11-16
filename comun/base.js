// Módulo común de padron.quest: Firebase, acceso con Google, cabecera, avisos y utilidades.
// Lo usan Mensajes, Fotos y Eventos; el muro y el árbol reutilizan la campana de avisos.
// La seguridad real la imponen las reglas de Firestore y Storage.
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
  connectAuthEmulator, signInWithCredential,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, where, limit,
  onSnapshot, serverTimestamp, writeBatch, connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL, connectStorageEmulator,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDkrGcwFUpxtImQdC0WWOgES5gfvGSjAsU",
  authDomain: "padron-quest.firebaseapp.com",
  projectId: "padron-quest",
  storageBucket: "padron-quest.firebasestorage.app",
  messagingSenderId: "570581063341",
  appId: "1:570581063341:web:c595054a2ff6b043349824",
};

const yaIniciada = getApps().length > 0;
export const app = yaIniciada ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Pruebas locales con emuladores (?emulador=1 en localhost). Sin efecto en el sitio publicado.
export const EMULADOR = new URLSearchParams(location.search).has("emulador") && ["localhost", "127.0.0.1"].includes(location.hostname);
if (EMULADOR && !yaIniciada) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  window.__entrarPrueba = (email, nombre) => signInWithCredential(auth, GoogleAuthProvider.credential(
    JSON.stringify({ sub: email, email, email_verified: true, name: nombre || email })));
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
export const $ = (id) => document.getElementById(id);
export const safeUrl = (u) => (typeof u === "string" && (/^https:\/\//.test(u) || (EMULADOR && /^http:\/\/127\.0\.0\.1:/.test(u))) ? u : null);

export function h(tag, props = {}, ...children) {
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

export function initials(name) {
  const parts = String(name || "?").replace(/["'()]/g, "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function avatar(name, photoURL, cls = "avatar-ini") {
  const url = safeUrl(photoURL);
  const el = h("span", { class: cls, "aria-hidden": "true" });
  if (url) el.append(h("img", { src: url, alt: "", referrerpolicy: "no-referrer", loading: "lazy" }));
  else el.textContent = initials(name);
  return el;
}

const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
export function timeAgo(date) {
  const s = Math.round((date - Date.now()) / 1000);
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [u, sec] of units) if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), u);
  return "ahora";
}
export function timeEl(ts, cls = "tiempo") {
  if (!ts?.toDate) return h("time", { class: cls, text: "ahora" });
  const date = ts.toDate();
  return h("time", { class: cls, datetime: date.toISOString(), title: date.toLocaleString("es"), text: timeAgo(date) });
}

// Fechas del árbol ("23 Ene 1960", "1898", "1903-10-01").
const MESES = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, set: 8, oct: 9, nov: 10, dic: 11 };
export const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function parseFecha(texto) {
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

// Reduce una foto en el navegador (máx. 2048 px, JPEG < 4 MB); al redibujarla se pierden los metadatos GPS.
export async function comprimirFoto(file, maxSide = 2048) {
  const MAX_BYTES = 4 * 1024 * 1024;
  const toBlob = (canvas, q) => new Promise((res) => canvas.toBlob(res, "image/jpeg", q));
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let side = maxSide;
    for (let attempt = 0; attempt < 5; attempt++) {
      const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale), hgt = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = hgt;
      canvas.getContext("2d").drawImage(img, 0, 0, w, hgt);
      for (const q of [0.85, 0.72]) {
        const blob = await toBlob(canvas, q);
        if (blob && blob.size < MAX_BYTES) return blob;
      }
      side = Math.round(side * 0.75);
    }
    throw new Error("La foto es demasiado grande incluso comprimida");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function subirFoto(blob, carpeta, uid) {
  const rand = Math.random().toString(36).slice(2, 10);
  const path = `${carpeta}/${uid}/${Date.now()}-${rand}.jpg`;
  const objRef = ref(storage, path);
  await uploadBytes(objRef, blob, { contentType: "image/jpeg", cacheControl: "public, max-age=31536000" });
  return { path, url: await getDownloadURL(objRef) };
}

// ---------------------------------------------------------------------------
// Avisos (campana): cada usuario tiene su bandeja en inbox/{uid}/items
// ---------------------------------------------------------------------------
export async function avisar(paraUid, { type, text, link }) {
  const yo = auth.currentUser;
  if (!yo || !paraUid || paraUid === yo.uid) return;
  try {
    await addDoc(collection(db, "inbox", paraUid, "items"), {
      type: String(type).slice(0, 30), text: String(text).slice(0, 300), link: String(link || "/muro/"),
      fromUid: yo.uid, fromName: (yo.displayName || yo.email || "").slice(0, 120), read: false, createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn("aviso no enviado:", err.code || err.message);
  }
}

// Monta la campana en `contenedor` y devuelve la función para quitar el escucha.
export function montarCampana(contenedor) {
  const yo = auth.currentUser;
  if (!yo || !contenedor) return () => {};
  const badge = h("span", { class: "campana-num", hidden: true });
  const panel = h("div", { class: "campana-panel", hidden: true, role: "dialog", "aria-label": "Avisos" });
  const boton = h("button", { type: "button", class: "campana", "aria-label": "Avisos", "aria-expanded": "false" },
    svgIcono(["M6 9a6 6 0 1 1 12 0c0 6 2.5 7 2.5 7h-17S6 15 6 9Z", "M10 20a2 2 0 0 0 4 0"]), badge);
  const caja = h("div", { class: "campana-caja" }, boton, panel);
  contenedor.replaceChildren(caja);
  let items = [];
  const pintar = () => {
    const sinLeer = items.filter((i) => !i.read);
    badge.textContent = String(sinLeer.length);
    badge.hidden = sinLeer.length === 0;
    boton.setAttribute("aria-label", sinLeer.length ? `Avisos: ${sinLeer.length} sin leer` : "Avisos");
    const lista = items.slice(0, 30).map((it) => h("a", {
      class: "aviso" + (it.read ? "" : " nuevo"), href: it.link || "/muro/",
      onclick: async () => { if (!it.read) { try { await updateDoc(doc(db, "inbox", yo.uid, "items", it.id), { read: true }); } catch { /* nada */ } } },
    }, h("span", { class: "aviso-texto", text: it.text }), timeEl(it.createdAt, "aviso-tiempo")));
    panel.replaceChildren(
      h("div", { class: "campana-cab" }, h("b", { text: "Avisos" }),
        sinLeer.length ? h("button", { type: "button", class: "enlace-boton", text: "Marcar todo como leído", onclick: async () => {
          const batch = writeBatch(db);
          sinLeer.forEach((i) => batch.update(doc(db, "inbox", yo.uid, "items", i.id), { read: true }));
          try { await batch.commit(); } catch (e) { console.warn(e); }
        } }) : null),
      lista.length ? h("div", { class: "campana-lista" }, lista) : h("p", { class: "muted small", text: "No tienes avisos todavía." }));
  };
  boton.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    boton.setAttribute("aria-expanded", String(!panel.hidden));
  });
  document.addEventListener("click", (e) => { if (!caja.contains(e.target)) { panel.hidden = true; boton.setAttribute("aria-expanded", "false"); } });
  pintar();
  return onSnapshot(query(collection(db, "inbox", yo.uid, "items"), limit(100)), (snap) => {
    items = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    pintar();
  }, (err) => console.warn("avisos:", err.code));
}

export function svgIcono(paths, size = 20) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.9", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, v);
  paths.forEach((d) => { const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); svg.append(p); });
  return svg;
}

// Contador de conversaciones sin leer (para el enlace "Mensajes" del menú).
export function montarContadorMensajes(span) {
  const yo = auth.currentUser;
  if (!yo || !span) return () => {};
  return onSnapshot(query(collection(db, "conversations"), where("members", "array-contains", yo.uid), limit(200)), (snap) => {
    const n = snap.docs.filter((d) => {
      const c = d.data();
      const leido = c.readBy?.[yo.uid]?.toMillis?.() || 0;
      return c.lastAt?.toMillis?.() > leido && c.lastFrom !== yo.uid;
    }).length;
    span.textContent = String(n);
    span.hidden = n === 0;
  }, () => {});
}

// ---------------------------------------------------------------------------
// Página estándar: cabecera + acceso + arranque
// ---------------------------------------------------------------------------
export const SECCIONES = [
  ["muro", "/muro/", "Inicio"],
  ["arbol", "/arbol/", "Árbol"],
  ["mensajes", "/mensajes/", "Mensajes"],
  ["fotos", "/fotos/", "Fotos"],
  ["eventos", "/eventos/", "Eventos"],
];

function cabecera(activa) {
  const nav = h("nav", { class: "nav", "aria-label": "Principal", hidden: true },
    SECCIONES.map(([id, href, label]) => h("a", { href, "aria-current": id === activa ? "page" : null },
      label, id === "mensajes" ? h("span", { class: "nav-badge", id: "navMensajes", hidden: true }) : null)));
  const user = h("div", { class: "user", hidden: true },
    h("span", { id: "campana" }),
    h("img", { id: "user-photo", alt: "", referrerpolicy: "no-referrer", hidden: true }),
    h("span", { id: "user-name" }),
    h("button", { type: "button", class: "ghost small", text: "Salir", onclick: () => signOut(auth) }));
  const top = h("header", { class: "top" }, h("div", { class: "top-in" },
    h("a", { class: "brand", href: "/" }, marca(), h("span", {}, h("b", { text: "Padrón Perera" }), h("small", { text: "Familia" }))),
    nav, user));
  return { top, nav, user };
}

function marca() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", "38"); svg.setAttribute("height", "38"); svg.setAttribute("viewBox", "0 0 40 40"); svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = '<circle cx="20" cy="20" r="19" fill="#D9A55B"/><path d="M9 18c1-6 5.6-9 11-9s10 3 11 9c-3 .9-19 .9-22 0Z" fill="#13293D"/><path d="M18.4 31.5 18.9 22h2.2l.5 9.5Z" fill="#13293D"/><path d="M20 23.5 14.5 18M20 23.5 25.5 18M20 23.5V17" stroke="#13293D" stroke-width="1.8" stroke-linecap="round" fill="none"/>';
  return svg;
}

/**
 * Arranca una página privada: monta cabecera y pantallas de acceso, comprueba que la
 * cuenta sea de la familia y llama a `alEntrar(ctx)` con { user, isAdmin, member }.
 * `alSalir()` se llama al cerrar sesión para soltar escuchas.
 */
export function iniciarPagina({ activa, raiz, alEntrar, alSalir }) {
  const { top, nav, user } = cabecera(activa);
  document.body.prepend(top);
  const gate = h("section", { class: "center", id: "gate" }, h("p", { class: "muted", text: "Cargando…" }));
  raiz.before(gate);
  raiz.hidden = true;
  const limpiezas = [];
  const limpiar = () => { while (limpiezas.length) { try { limpiezas.pop()(); } catch { /* nada */ } } alSalir?.(); };

  const mostrarLogin = () => {
    const err = h("p", { class: "error", hidden: true });
    gate.replaceChildren(
      h("h1", {}, "La familia ", h("span", { class: "accent", text: "Padrón Perera" })),
      h("p", { class: "muted", text: "Solo para familiares invitados. Entra con tu cuenta de Google." }),
      h("button", { type: "button", class: "primary", text: "Entrar con Google", onclick: async () => {
        err.hidden = true;
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        try { await signInWithPopup(auth, provider); }
        catch (e) {
          if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") { await signInWithRedirect(auth, provider); return; }
          if (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") return;
          err.textContent = "No se pudo entrar: " + (e.code || e.message); err.hidden = false;
        }
      } }), err);
  };

  onAuthStateChanged(auth, async (u) => {
    limpiar();
    raiz.hidden = true;
    gate.hidden = false;
    nav.hidden = true;
    user.hidden = true;
    if (!u) { mostrarLogin(); return; }
    gate.replaceChildren(h("p", { class: "muted", text: "Cargando…" }));
    const email = (u.email || "").toLowerCase();
    let isAdmin = false;
    try { await getDocs(query(collection(db, "members"), limit(1))); isAdmin = true; } catch { /* no es admin */ }
    let member = null;
    try { const m = await getDoc(doc(db, "members", email)); if (m.exists()) member = m.data(); } catch { /* nada */ }
    if (!isAdmin && !member) {
      gate.replaceChildren(h("h1", { text: "Aún no estás invitado" }),
        h("p", { class: "muted" }, "La cuenta ", h("strong", { text: email }), " no está en la lista de familiares. Pídele a un administrador que te agregue."),
        h("button", { type: "button", class: "ghost", text: "Usar otra cuenta", onclick: () => signOut(auth) }));
      return;
    }
    setDoc(doc(db, "profiles", u.uid), {
      name: (u.displayName || email).slice(0, 120), photoURL: safeUrl(u.photoURL), email, updatedAt: serverTimestamp(),
    }).catch(() => {});
    $("user-name").textContent = u.displayName || email;
    const foto = safeUrl(u.photoURL);
    $("user-photo").hidden = !foto;
    if (foto) $("user-photo").src = foto;
    nav.hidden = false;
    user.hidden = false;
    gate.hidden = true;
    raiz.hidden = false;
    limpiezas.push(montarCampana($("campana")));
    limpiezas.push(montarContadorMensajes($("navMensajes")));
    const extra = await alEntrar({ user: u, isAdmin, member });
    if (typeof extra === "function") limpiezas.push(extra);
  });
}

// Lista de familiares que ya entraron (perfiles) — para elegir destinatarios.
export function escucharPerfiles(cb) {
  return onSnapshot(collection(db, "profiles"), (snap) => cb(new Map(snap.docs.map((d) => [d.id, d.data()]))), () => {});
}
export function escucharPersonas(cb) {
  return onSnapshot(collection(db, "people"), (snap) => cb(new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]))), () => {});
}

export { collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, where, limit, onSnapshot, serverTimestamp, writeBatch };
