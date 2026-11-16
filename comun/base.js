// Módulo común de padron.quest: Firebase, acceso con Google, cabecera, avisos y utilidades.
// Lo usan Mensajes, Fotos y Eventos; el muro y el árbol reutilizan la campana de avisos.
// La seguridad real la imponen las reglas de Firestore y Storage.
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
  connectAuthEmulator, signInWithCredential,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, where, limit, orderBy,
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
// ?emulador=2, =3… usan puertos desplazados de 10 en 10, para correr varias pruebas a la vez.
export const EMULADOR = new URLSearchParams(location.search).has("emulador") && ["localhost", "127.0.0.1"].includes(location.hostname);
export const EMU_DESPLAZA = EMULADOR ? (Math.max(1, Number(new URLSearchParams(location.search).get("emulador")) || 1) - 1) * 10 : 0;
if (EMULADOR && !yaIniciada) {
  connectAuthEmulator(auth, `http://127.0.0.1:${9099 + EMU_DESPLAZA}`, { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080 + EMU_DESPLAZA);
  connectStorageEmulator(storage, "127.0.0.1", 9199 + EMU_DESPLAZA);
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

// Foto de Google para guardar en profiles/{uid} (las reglas solo aceptan https).
// Las reglas solo aceptan fotos de Google (googleusercontent.com) y el nombre de la cuenta (o el correo).
export const fotoPerfil = (u) => (typeof u === "string" && /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//.test(u) ? u : null);
export const nombrePerfil = (u, email) => (u.displayName && u.displayName.length <= 120 ? u.displayName : email);

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

// ---------------------------------------------------------------------------
// Fotos: se comprimen SIEMPRE en el navegador antes de subirlas, para que el
// almacenamiento de Firebase no crezca sin control.
// - Lado mayor ≤ 1600 px (se ve nítida en cualquier teléfono o computadora).
// - WebP (o JPEG en navegadores que no saben generar WebP).
// - Objetivo ≈ 300 KB por foto; nunca más de 900 KB (las reglas de Storage rechazan ≥ 1 MB).
// - Al redibujarla en un canvas se pierden los metadatos, incluida la ubicación GPS.
// Una foto de teléfono de 3–6 MB queda en unos 150–350 KB: 5 GB alcanzan para ~15.000 fotos.
// ---------------------------------------------------------------------------
export const FOTO = { maxLado: 1600, minLado: 720, objetivo: 300 * 1024, maximo: 900 * 1024, calidades: [0.8, 0.7, 0.6] };

let formatoFoto = null;
async function formatoDeFoto() {
  if (formatoFoto) return formatoFoto;
  const c = document.createElement("canvas");
  c.width = c.height = 2;
  const b = await new Promise((res) => c.toBlob(res, "image/webp", 0.8));
  formatoFoto = b && b.type === "image/webp" ? "image/webp" : "image/jpeg";
  return formatoFoto;
}

async function decodificarFoto(file) {
  // createImageBitmap respeta la orientación de la cámara (EXIF) y gasta menos memoria.
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* sigue con <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function comprimirFoto(file, maxLado = FOTO.maxLado) {
  if (!file || (file.type && !file.type.startsWith("image/"))) throw new Error("Ese archivo no es una foto.");
  const tipo = await formatoDeFoto();
  let img;
  try { img = await decodificarFoto(file); } catch { throw new Error("No se pudo leer la foto (prueba con una JPG o PNG)."); }
  const ancho = img.width || img.naturalWidth, alto = img.height || img.naturalHeight;
  if (!ancho || !alto) throw new Error("No se pudo leer la foto.");
  let lado = Math.min(maxLado, Math.max(ancho, alto));
  let mejor = null;
  try {
    for (;;) {
      const escala = lado / Math.max(ancho, alto);
      const w = Math.max(1, Math.round(ancho * escala)), hgt = Math.max(1, Math.round(alto * escala));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = hgt;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; // las transparencias (PNG) quedan blancas, no negras
      ctx.fillRect(0, 0, w, hgt);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, hgt);
      for (const q of FOTO.calidades) {
        const blob = await new Promise((res) => canvas.toBlob(res, tipo, q));
        if (!blob) continue;
        if (blob.size <= FOTO.objetivo) return blob;
        if (blob.size <= FOTO.maximo && (!mejor || blob.size < mejor.size)) mejor = blob;
      }
      canvas.width = canvas.height = 0; // libera memoria en teléfonos modestos
      if (lado <= FOTO.minLado) break;
      lado = Math.max(FOTO.minLado, Math.round(lado * 0.8));
    }
  } finally {
    if (typeof img.close === "function") img.close();
  }
  if (mejor) return mejor;
  throw new Error("La foto es demasiado pesada incluso comprimida.");
}

export async function subirFoto(blob, carpeta, uid) {
  const tipo = blob.type === "image/webp" ? "image/webp" : "image/jpeg";
  const rand = Math.random().toString(36).slice(2, 10);
  const path = `${carpeta}/${uid}/${Date.now()}-${rand}.${tipo === "image/webp" ? "webp" : "jpg"}`;
  const objRef = ref(storage, path);
  await uploadBytes(objRef, blob, { contentType: tipo, cacheControl: "public, max-age=31536000" });
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

// ---------------------------------------------------------------------------
// Avisos en el dispositivo: notificaciones push (Firebase Cloud Messaging) aunque la página esté cerrada.
// Cada dispositivo guarda su token en profiles/{uid}/pushTokens/{token}; las Cloud Functions envían.
// ---------------------------------------------------------------------------
// Clave pública VAPID (consola de Firebase → Configuración → Cloud Messaging → Certificados push web).
// Vacía: el SDK 13.3.0 usa la clave por defecto de Firebase (getToken → updateVapidKey).
const VAPID_KEY = "";
const SDK_MENSAJERIA = "https://www.gstatic.com/firebasejs/13.3.0/firebase-messaging.js";
const CLAVE_LOCAL = "padron.avisosDispositivo"; // { uid, token, revisado } de este navegador
const UN_DIA = 86400000;
const leerLocal = () => { try { return JSON.parse(localStorage.getItem(CLAVE_LOCAL) || "null"); } catch { return null; } };
const guardarLocal = (v) => { try { if (v) localStorage.setItem(CLAVE_LOCAL, JSON.stringify(v)); else localStorage.removeItem(CLAVE_LOCAL); } catch { /* nada */ } };
const esIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const enPantallaDeInicio = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
const pushPosible = () => window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const opcionesVapid = () => (VAPID_KEY ? { vapidKey: VAPID_KEY } : {});
// "granted" | "denied" | "default". Se consulta la API de permisos (más fiable) y, si no existe, Notification.permission.
async function permisoNotificaciones() {
  try {
    const s = await navigator.permissions?.query({ name: "notifications" });
    if (s?.state) return s.state === "prompt" ? "default" : s.state;
  } catch { /* navegador sin esa consulta */ }
  return Notification.permission;
}

let mensajeriaPromesa = null;
function mensajeria() {
  mensajeriaPromesa ??= (async () => {
    const m = await import(SDK_MENSAJERIA);
    if (!(await m.isSupported())) return null;
    return { m, messaging: m.getMessaging(app) };
  })().catch((e) => { mensajeriaPromesa = null; throw e; });
  return mensajeriaPromesa;
}
const registrarSW = () => navigator.serviceWorker.register("/firebase-messaging-sw.js");

// Token de FCM de este navegador. En el emulador no hay FCM: se usa un token simulado.
async function tokenDelDispositivo() {
  const reg = await registrarSW();
  if (EMULADOR) return leerLocal()?.token || "emu-" + crypto.randomUUID().replace(/-/g, "");
  const mm = await mensajeria();
  if (!mm) throw new Error("sin-soporte");
  return mm.m.getToken(mm.messaging, { serviceWorkerRegistration: reg, ...opcionesVapid() });
}
async function guardarToken(uid, token) {
  await setDoc(doc(db, "profiles", uid, "pushTokens", token), { token, ua: navigator.userAgent.slice(0, 200), createdAt: serverTimestamp() });
  guardarLocal({ uid, token, revisado: Date.now() });
}
// Apaga los avisos de este navegador: borra el documento (si hay sesión de esa cuenta) e invalida el token en FCM.
async function apagarDispositivo(uidConSesion) {
  const local = leerLocal();
  guardarLocal(null);
  if (!local?.token) return;
  if (uidConSesion && local.uid === uidConSesion) {
    try { await deleteDoc(doc(db, "profiles", uidConSesion, "pushTokens", local.token)); } catch { /* nada */ }
  }
  if (EMULADOR || (await permisoNotificaciones()) !== "granted") return;
  try {
    const mm = await mensajeria();
    if (!mm) return;
    await mm.m.getToken(mm.messaging, { serviceWorkerRegistration: await registrarSW(), ...opcionesVapid() });
    await mm.m.deleteToken(mm.messaging);
  } catch (e) { console.warn("avisos del dispositivo:", e.code || e.message); }
}

const TXT_BLOQUEADO = "Las notificaciones están bloqueadas para este sitio. Permítelas en la configuración del navegador (el candado junto a la dirección) y vuelve a intentarlo.";

// Interruptor "Recibir avisos en este dispositivo" para el panel de la campana.
function controlDispositivo(yo) {
  const detalle = h("small");
  const boton = h("button", { type: "button", class: "disp-interruptor", role: "switch", "aria-checked": "false" },
    h("span", { class: "disp-textos" }, h("b", { text: "Recibir avisos en este dispositivo" }), detalle),
    h("span", { class: "disp-pista", "aria-hidden": "true" }));
  const nota = h("p", { class: "disp-nota", role: "status", hidden: true });
  const el = h("div", { class: "campana-disp" }, boton, nota);

  if (!pushPosible()) {
    boton.hidden = true;
    nota.hidden = false;
    nota.textContent = esIOS() && !enPantallaDeInicio()
      ? "Para recibir avisos en el iPhone: toca Compartir → «Añadir a pantalla de inicio» y abre Padrón desde ese ícono (iOS 16.4 o más reciente)."
      : "Este navegador no puede recibir avisos en el dispositivo. Prueba con Chrome, Edge, Firefox o Safari actualizados.";
    return { el, limpiar: () => {} };
  }

  let activo = false;
  let ocupado = false;
  const poner = (on, texto = "") => {
    activo = on;
    boton.setAttribute("aria-checked", String(on));
    detalle.textContent = on ? "Activado: te llegan aunque tengas la página cerrada." : "Te llegan al teléfono o a la computadora aunque tengas la página cerrada.";
    nota.textContent = texto;
    nota.hidden = !texto;
  };

  poner(false);
  const local = leerLocal();
  if (local && local.uid !== yo.uid) apagarDispositivo(null); // los dejó encendidos otra cuenta: se apagan
  (async () => {
    const permiso = await permisoNotificaciones();
    if (ocupado) return; // ya lo está cambiando a mano
    poner(!!(local && local.uid === yo.uid && permiso === "granted"), permiso === "denied" ? TXT_BLOQUEADO : "");
    if (!activo) return;
    // El servidor borra los tokens caducados; y una vez al día se renueva el token por si FCM lo cambió.
    const s = await getDoc(doc(db, "profiles", yo.uid, "pushTokens", local.token));
    if (!s.exists()) { guardarLocal(null); if (!ocupado) poner(false); return; }
    if (EMULADOR || Date.now() - (local.revisado || 0) < UN_DIA) return;
    const nuevo = await tokenDelDispositivo();
    if (nuevo !== local.token) {
      await guardarToken(yo.uid, nuevo);
      await deleteDoc(doc(db, "profiles", yo.uid, "pushTokens", local.token)).catch(() => {});
    } else guardarLocal({ ...local, revisado: Date.now() });
  })().catch((e) => console.warn("avisos del dispositivo:", e.code || e.message));

  boton.addEventListener("click", async () => {
    if (ocupado) return;
    ocupado = true;
    boton.setAttribute("aria-busy", "true");
    try {
      if (activo) {
        await apagarDispositivo(yo.uid);
        poner(false, "Listo: este dispositivo ya no recibirá avisos.");
      } else {
        const permiso = await Notification.requestPermission(); // se pide solo al tocar el interruptor
        if (permiso !== "granted") { poner(false, permiso === "denied" ? TXT_BLOQUEADO : "No se activó: hace falta que permitas las notificaciones."); return; }
        await guardarToken(yo.uid, await tokenDelDispositivo());
        poner(true, "¡Listo! Te avisaremos también en este dispositivo.");
      }
    } catch (e) {
      console.warn("avisos del dispositivo:", e.code || e.message);
      poner(activo, e.message === "sin-soporte" ? "Este navegador no puede recibir avisos en el dispositivo." : "No se pudo cambiar. Inténtalo de nuevo en un momento.");
    } finally {
      ocupado = false;
      boton.removeAttribute("aria-busy");
    }
  });

  // Al cerrar sesión, este dispositivo deja de recibir los avisos de esa cuenta.
  const limpiar = () => { if (activo && auth.currentUser?.uid !== yo.uid) apagarDispositivo(null); };
  return { el, limpiar };
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
  const disp = controlDispositivo(yo);
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
      // El interruptor va arriba: con muchos avisos, al pie quedaría fuera de la vista.
      disp.el,
      lista.length ? h("div", { class: "campana-lista" }, lista) : h("p", { class: "muted small", text: "No tienes avisos todavía." }));
  };
  boton.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    boton.setAttribute("aria-expanded", String(!panel.hidden));
  });
  document.addEventListener("click", (e) => { if (!caja.contains(e.target)) { panel.hidden = true; boton.setAttribute("aria-expanded", "false"); } });
  pintar();
  // Los 100 más recientes (sin orderBy, Firestore devolvería los 100 primeros por id y los nuevos se perderían).
  const quitar = onSnapshot(query(collection(db, "inbox", yo.uid, "items"), orderBy("createdAt", "desc"), limit(100)), (snap) => {
    items = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    pintar();
  }, (err) => console.warn("avisos:", err.code));
  return () => { quitar(); disp.limpiar(); };
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
    h("a", { class: "user-link", href: "/perfil/", "aria-label": "Mi perfil", title: "Mi perfil" },
      h("img", { id: "user-photo", alt: "", referrerpolicy: "no-referrer", hidden: true }),
      h("span", { id: "user-ini", class: "avatar-ini sm", "aria-hidden": "true" }),
      h("span", { id: "user-name" })),
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
    // merge: no borra lo que el familiar escribió en su perfil ("Sobre mí", ciudad).
    setDoc(doc(db, "profiles", u.uid), {
      name: nombrePerfil(u, email), photoURL: fotoPerfil(u.photoURL), email,
      personId: member?.personId || null, updatedAt: serverTimestamp(),
    }, { merge: true }).catch((e) => console.warn("perfil:", e.code || e.message));
    $("user-name").textContent = u.displayName || email;
    const foto = safeUrl(u.photoURL);
    $("user-photo").hidden = !foto;
    if (foto) $("user-photo").src = foto;
    $("user-ini").hidden = Boolean(foto);
    $("user-ini").textContent = initials(u.displayName || email);
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
