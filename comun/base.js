// Módulo común de padron.quest: Firebase, acceso (Google o cualquier correo), cabecera, avisos y utilidades.
// Lo usan Mensajes, Fotos y Eventos; el muro y el árbol reutilizan la campana de avisos.
// La seguridad real la imponen las reglas de Firestore y Storage.
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
  connectAuthEmulator, signInWithCredential, signInWithEmailAndPassword,
  sendEmailVerification, updateProfile,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, where, limit, orderBy,
  onSnapshot, serverTimestamp, writeBatch, connectFirestoreEmulator, getDocFromServer, waitForPendingWrites,
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
  // Lee una ruta con la sesión actual (documento o colección) y devuelve "ok" o el código de error.
  window.__leerPrueba = async (ruta) => {
    const partes = ruta.split("/");
    try {
      if (partes.length % 2) await getDocs(query(collection(db, ...partes), limit(1)));
      else await getDoc(doc(db, ...partes));
      return "ok";
    } catch (e) { return e.code || e.message; }
  };
}
// Los correos de Firebase (confirmar el correo, crear contraseña nueva) llegan en español.
auth.languageCode = "es";

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
// Acceso: con Google o con CUALQUIER correo (Hotmail, Yahoo, iCloud, trabajo…) y contraseña.
// Lo usan las tres puertas: iniciarPagina (abajo), el muro y el árbol.
// Las reglas exigen el correo confirmado (email_verified) y, con contraseña, la marca del servidor
// (claveSegura): la contraseña solo se elige con el enlace que Firebase envía al correo (ver pedirEnlaceClave).
// ---------------------------------------------------------------------------
export const ACCESO = { esperaReenvio: 60 }; // segundos entre reenvíos del correo de confirmación
if (EMULADOR) window.__acceso = ACCESO;

// A dónde vuelve quien toca el enlace del correo (confirmar o crear contraseña nueva).
const urlContinuar = () => `${location.origin}/muro/${EMULADOR ? `?emulador=${new URLSearchParams(location.search).get("emulador") || 1}` : ""}`;
// Si Firebase no aceptara la dirección de vuelta, el correo se envía igual, sin ella.
async function conVuelta(enviar) {
  try { await enviar({ url: urlContinuar() }); }
  catch (e) {
    if (/continue-uri|unauthorized-domain/.test(e.code || "")) await enviar(undefined);
    else throw e;
  }
}

const ERRORES_ACCESO = {
  "auth/invalid-credential": "El correo o la contraseña no son correctos. Revísalos e inténtalo de nuevo. Si te registraste con Google, usa el botón de Google.",
  "auth/invalid-login-credentials": "auth/invalid-credential",
  "auth/wrong-password": "auth/invalid-credential",
  "auth/user-not-found": "auth/invalid-credential",
  "auth/email-already-in-use": "Ese correo ya tiene cuenta: toca «Entrar». Si te registraste con Google, usa el botón de Google.",
  "auth/weak-password": "Esa contraseña es muy fácil de adivinar. Usa al menos 8 caracteres, mezclando letras y números.",
  "auth/invalid-email": "Ese correo no parece válido. Revísalo (por ejemplo: nombre@hotmail.com).",
  "auth/missing-email": "auth/invalid-email",
  "auth/missing-password": "Escribe tu contraseña.",
  "auth/too-many-requests": "Demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo.",
  "auth/network-request-failed": "No hay conexión a internet. Revisa tu conexión y vuelve a intentarlo.",
  "auth/user-disabled": "Esta cuenta está desactivada. Escríbele a un administrador de la familia.",
  "auth/account-exists-with-different-credential": "Ese correo ya tiene cuenta con contraseña: entra abajo con tu correo y tu contraseña.",
  "auth/operation-not-allowed": "Esta forma de entrar no está disponible ahora. Avísale a un administrador de la familia.",
  "auth/popup-blocked": "El navegador bloqueó la ventana de Google. Permite las ventanas emergentes e inténtalo de nuevo.",
  // Cloud Function prepararCuenta («Crear cuenta», «¿Olvidaste tu contraseña?»).
  "functions/invalid-argument": "auth/invalid-email",
  "functions/resource-exhausted": "auth/too-many-requests",
  "functions/unavailable": "auth/network-request-failed",
  "functions/deadline-exceeded": "auth/network-request-failed",
};
// Mensaje claro en español; nunca el código técnico.
export function mensajeAcceso(e) {
  let t = ERRORES_ACCESO[e?.code];
  if (t && ERRORES_ACCESO[t]) t = ERRORES_ACCESO[t];
  if (!t && !navigator.onLine) t = ERRORES_ACCESO["auth/network-request-failed"];
  return t || "No se pudo completar. Inténtalo de nuevo en un momento.";
}

const LOGO_GOOGLE = '<svg aria-hidden="true" viewBox="0 0 48 48" width="22" height="22"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

async function entrarConGoogle(avisarError) {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    if (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") return;
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
      try { await signInWithRedirect(auth, provider); return; } catch (e2) { e = e2; }
    }
    avisarError(mensajeAcceso(e));
  }
}

// Cuándo se envió el último correo de confirmación (para la espera entre reenvíos), por cuenta.
const CLAVE_ENVIO = "padron.confirmacionEnviada";
const envios = new Map();
function marcarEnvio(uid) {
  envios.set(uid, Date.now());
  try { localStorage.setItem(CLAVE_ENVIO, JSON.stringify({ uid, t: Date.now() })); } catch { /* nada */ }
}
function ultimoEnvio(uid) {
  if (envios.has(uid)) return envios.get(uid);
  try { const v = JSON.parse(localStorage.getItem(CLAVE_ENVIO) || "null"); if (v?.uid === uid) return v.t; } catch { /* nada */ }
  return 0;
}
async function enviarConfirmacion(user) {
  await conVuelta((ajustes) => sendEmailVerification(user, ajustes));
  marcarEnvio(user.uid);
}

// «Crear cuenta» y «¿Olvidaste tu contraseña?» son lo mismo: la contraseña SOLO la elige quien tiene el
// buzón, con el enlace del correo. Así nadie puede crear de antemano la cuenta de otra persona con una
// contraseña suya (robo «pre-hijack»). La Cloud Function prepararCuenta deja lista la cuenta de CUALQUIER
// correo (sin contraseña, con la marca que exigen las reglas) y el servidor mismo envía el enlace.
// Responde siempre igual (también cuando limita los envíos): no revela quién tiene cuenta.
let prepararRemoto = null;
function llamarPrepararCuenta(correo) {
  prepararRemoto ||= import("https://www.gstatic.com/firebasejs/13.3.0/firebase-functions.js").then((f) => {
    const fns = f.getFunctions(app, "us-central1");
    if (EMULADOR) f.connectFunctionsEmulator(fns, "127.0.0.1", 5001 + EMU_DESPLAZA);
    return f.httpsCallable(fns, "prepararCuenta");
  }).catch((e) => { prepararRemoto = null; throw e; });
  return prepararRemoto.then((llamar) => llamar({ correo, vuelta: urlContinuar() }));
}
// Solo se avisan los problemas de conexión o de formato; nunca si el correo tiene cuenta.
const pedirEnlaceClave = (correo) => llamarPrepararCuenta(correo);

// El nombre que escribió en «Crear cuenta» se guarda en este navegador para proponérselo al entrar.
const CLAVE_NOMBRE = "padron.nombreNuevo";
function guardarNombrePendiente(correo, nombre) {
  try { localStorage.setItem(CLAVE_NOMBRE, JSON.stringify({ correo, nombre })); } catch { /* nada */ }
}
function nombrePendiente(correo) {
  try { const v = JSON.parse(localStorage.getItem(CLAVE_NOMBRE) || "null"); if (v?.correo === (correo || "").toLowerCase()) return v.nombre || ""; } catch { /* nada */ }
  return "";
}

const correoValido = (c) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c);
// El mismo mensaje para cualquier correo (tenga cuenta o no, y aunque el servidor haya limitado los envíos).
export const TEXTO_ENLACE_ENVIADO = (correo) => `Listo. En unos minutos te llegará a ${correo} un correo con un enlace para elegir tu contraseña. Ábrelo, elige tu contraseña y luego vuelve aquí y toca «Entrar». Si no lo ves, revisa la carpeta de spam o correo no deseado. Si lo pediste hace muy poco, espera unos minutos antes de pedirlo otra vez.`;
const limpiarCorreo = (c) => c.replace(/\s+/g, "").toLowerCase();
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Campo con etiqueta visible. `extra` son atributos del <input>.
function campo(etiqueta, extra, pista) {
  const input = h("input", { class: "entrada", ...extra });
  const label = h("label", { class: "campo" }, h("span", { text: etiqueta }), pista ? h("small", { text: pista }) : null);
  return { input, el: h("div", { class: "acceso-campo" }, label, input), label };
}
let idCampo = 0;
function enlazar(c) { // une etiqueta e input por id (el botón Mostrar va dentro del mismo bloque)
  const id = `acceso-${++idCampo}`;
  c.input.id = id; c.label.setAttribute("for", id);
  return c;
}
function campoClave(etiqueta, autocomplete, pista) {
  const c = enlazar(campo(etiqueta, { type: "password", autocomplete, autocapitalize: "off", spellcheck: "false", enterkeyhint: "go", minlength: autocomplete === "new-password" ? "8" : null }, pista));
  const ver = h("button", { type: "button", class: "acceso-ver", "aria-pressed": "false", "aria-controls": c.input.id, "aria-label": "Mostrar la contraseña", text: "Mostrar" });
  ver.addEventListener("click", () => {
    const mostrar = c.input.type === "password";
    c.input.type = mostrar ? "text" : "password";
    ver.textContent = mostrar ? "Ocultar" : "Mostrar";
    ver.setAttribute("aria-pressed", String(mostrar));
    ver.setAttribute("aria-label", mostrar ? "Ocultar la contraseña" : "Mostrar la contraseña");
    c.input.focus();
  });
  c.el.replaceChildren(c.label, h("div", { class: "acceso-clave" }, c.input, ver));
  return c;
}
// `autocomplete`: "username" en «Entrar» (así el gestor de contraseñas une el correo con la contraseña guardada).
const campoCorreo = (siguiente = true, autocomplete = "email") => enlazar(campo("Correo electrónico", {
  type: "email", inputmode: "email", autocomplete, autocapitalize: "off", spellcheck: "false",
  enterkeyhint: siguiente ? "next" : "send", maxlength: "254",
}));
// «Siguiente» (Enter) en un campo que no es el último: pasa al siguiente campo vacío sin mostrar errores.
// Si ya están todos llenos (p. ej. lo completó el gestor de contraseñas), envía el formulario.
function encadenar(campos) {
  campos.forEach((c, i) => c.input.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" || ev.isComposing || i === campos.length - 1) return;
    const vacio = campos.slice(i + 1).find((x) => !x.input.value.trim());
    if (!vacio) return;
    ev.preventDefault();
    vacio.input.focus();
  }));
}
// Mensaje bajo el formulario y botón ocupado mientras trabaja. El mensaje se trae a la pantalla: en un teléfono
// queda debajo del botón, y sin esto quien toca «Crear mi cuenta» no vería que pasó algo.
function mensajero() {
  const msg = h("p", { class: "acceso-msg", role: "status", "aria-live": "polite", hidden: true });
  const decir = (texto, tipo = "error") => {
    msg.textContent = texto; msg.className = "acceso-msg " + tipo; msg.hidden = !texto;
    if (texto) requestAnimationFrame(() => { if (msg.isConnected && !msg.hidden) msg.scrollIntoView({ block: "nearest" }); });
  };
  return { msg, decir };
}
async function ocupado(boton, texto, fn) {
  const original = boton.textContent;
  boton.disabled = true; boton.textContent = texto;
  try { await fn(); } finally { if (boton.isConnected) { boton.disabled = false; boton.textContent = original; } }
}

/**
 * Monta en `contenedor` el acceso: botón de Google y, debajo, "o con tu correo" con dos modos
 * ("Entrar" y "Crear cuenta") más "¿Olvidaste tu contraseña?". Al entrar, onAuthStateChanged
 * de cada página hace el resto.
 */
export function montarAcceso(contenedor) {
  if (!contenedor) return;
  const { msg, decir } = mensajero();

  const google = h("button", { type: "button", class: "acceso-google" });
  google.innerHTML = LOGO_GOOGLE;
  google.append(h("span", { text: "Entrar con Google" }));
  google.addEventListener("click", () => { decir(""); entrarConGoogle((t) => decir(t)); });

  // --- Entrar ---
  const eCorreo = campoCorreo(true, "username");
  const eClave = campoClave("Contraseña", "current-password");
  const eBoton = h("button", { type: "submit", class: "primary", text: "Entrar" });
  const olvide = h("button", { type: "button", class: "enlace-boton acceso-enlace", text: "¿Olvidaste tu contraseña?" });
  const fEntrar = h("form", { class: "acceso-form", novalidate: true, "aria-label": "Entrar con tu correo" }, eCorreo.el, eClave.el, eBoton, olvide);

  // --- Crear cuenta: nombre y correo; la contraseña se elige con el enlace del correo ---
  const cNombre = enlazar(campo("Nombre y apellido", { type: "text", autocomplete: "name", autocapitalize: "words", enterkeyhint: "next", maxlength: "80" }));
  const cCorreo = campoCorreo(false);
  cCorreo.label.append(h("small", { text: "Ahí te llegará el enlace para elegir tu contraseña." }));
  const cBoton = h("button", { type: "submit", class: "primary", text: "Crear mi cuenta" });
  const fCrear = h("form", { class: "acceso-form", novalidate: true, "aria-label": "Crear cuenta con tu correo", hidden: true },
    cNombre.el, cCorreo.el, cBoton,
    h("p", { class: "acceso-nota", text: "Te enviaremos un correo con un enlace para que elijas tu contraseña. Así nadie más puede crear tu cuenta." }));

  // --- Olvidé mi contraseña ---
  const rCorreo = campoCorreo(false);
  const rBoton = h("button", { type: "submit", class: "primary", text: "Enviar el enlace" });
  const volver = h("button", { type: "button", class: "enlace-boton acceso-enlace", text: "Volver a «Entrar»" });
  const fOlvide = h("form", { class: "acceso-form", novalidate: true, "aria-label": "Crear una contraseña nueva", hidden: true },
    h("p", { class: "acceso-nota", text: "Escribe tu correo y te enviaremos un enlace para crear una contraseña nueva." }),
    rCorreo.el, rBoton, volver);

  const tabEntrar = h("button", { type: "button", "aria-pressed": "true", text: "Entrar" });
  const tabCrear = h("button", { type: "button", "aria-pressed": "false", text: "Crear cuenta" });
  const modos = h("div", { class: "acceso-modos", role: "group", "aria-label": "Con tu correo" }, tabEntrar, tabCrear);

  // El último correo escrito (en cualquiera de los tres modos) pasa a los otros, aunque ya tuvieran uno.
  const correos = [eCorreo, cCorreo, rCorreo];
  let correoEscrito = "";
  correos.forEach((c) => c.input.addEventListener("input", () => { correoEscrito = c.input.value.trim(); }));
  encadenar([eCorreo, eClave]);
  encadenar([cNombre, cCorreo]);

  const modo = (cual, enfocar = true) => {
    fEntrar.hidden = cual !== "entrar";
    fCrear.hidden = cual !== "crear";
    fOlvide.hidden = cual !== "olvide";
    modos.hidden = cual === "olvide";
    tabEntrar.setAttribute("aria-pressed", String(cual === "entrar"));
    tabCrear.setAttribute("aria-pressed", String(cual === "crear"));
    decir("");
    correos.forEach((c) => { c.input.value = correoEscrito; });
    if (enfocar) (cual === "crear" ? cNombre : cual === "olvide" ? rCorreo : eCorreo).input.focus();
  };
  tabEntrar.addEventListener("click", () => modo("entrar"));
  tabCrear.addEventListener("click", () => modo("crear"));
  olvide.addEventListener("click", () => modo("olvide"));
  volver.addEventListener("click", () => modo("entrar"));

  // Comprueba los campos y enfoca el primero que falte.
  const falta = (pares) => {
    for (const [c, texto] of pares) if (texto) { decir(texto); c.input.focus(); return true; }
    return false;
  };
  const errorCorreo = (correo) => (!correo ? "Escribe tu correo." : !correoValido(correo) ? ERRORES_ACCESO["auth/invalid-email"] : "");

  fEntrar.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const correo = limpiarCorreo(eCorreo.input.value), clave = eClave.input.value;
    if (falta([[eCorreo, errorCorreo(correo)], [eClave, !clave ? "Escribe tu contraseña." : ""]])) return;
    decir("");
    return ocupado(eBoton, "Entrando…", async () => {
      try { await signInWithEmailAndPassword(auth, correo, clave); }
      catch (e) { decir(mensajeAcceso(e)); eClave.input.select?.(); }
    });
  });

  fCrear.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const nombre = cNombre.input.value.replace(/\s+/g, " ").trim(), correo = limpiarCorreo(cCorreo.input.value);
    if (falta([[cNombre, nombre.length < 2 ? "Escribe tu nombre y apellido." : ""], [cCorreo, errorCorreo(correo)]])) return;
    decir("");
    guardarNombrePendiente(correo, nombre);
    return ocupado(cBoton, "Enviando…", async () => {
      try { await pedirEnlaceClave(correo); } catch (e) { decir(mensajeAcceso(e)); return; }
      decir(TEXTO_ENLACE_ENVIADO(correo), "ok");
    });
  });

  fOlvide.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const correo = limpiarCorreo(rCorreo.input.value);
    if (falta([[rCorreo, errorCorreo(correo)]])) return;
    decir("");
    return ocupado(rBoton, "Enviando…", async () => {
      try { await pedirEnlaceClave(correo); } catch (e) { decir(mensajeAcceso(e)); return; }
      decir(TEXTO_ENLACE_ENVIADO(correo), "ok");
    });
  });

  contenedor.replaceChildren(h("div", { class: "acceso" },
    google,
    h("p", { class: "acceso-o" }, h("span", { text: "o con tu correo" })),
    h("p", { class: "acceso-nota acceso-centro", text: "Gmail, Hotmail, Outlook, Yahoo, iCloud o el de tu trabajo." }),
    modos, fEntrar, fCrear, fOlvide, msg));
  // «Empezar» de la portada llega con ?nuevo=1: quien es nuevo ve directamente «Crear cuenta».
  modo(new URLSearchParams(location.search).has("nuevo") ? "crear" : "entrar", false);
}

// ¿Le falta un paso antes de entrar? Confirmar el correo o, si su cuenta no tiene nombre, escribirlo.
export const accesoPendiente = (user) => !user.emailVerified || !(user.displayName || "").trim();

/**
 * Pasos antes de entrar, en `contenedor`: "Confirma tu correo" (si el correo no está confirmado) y
 * "¿Cómo te llamas?" (si la cuenta no tiene nombre). `alConfirmar(user)` se llama al terminar, con el
 * token ya renovado (las reglas leen email_verified y name del token).
 */
export function vistaConfirmarCorreo(contenedor, user, alConfirmar) {
  if (!contenedor) return;
  const seguir = (u) => ((u.displayName || "").trim() ? alConfirmar(u) : vistaNombre(contenedor, u, alConfirmar));
  if (user.emailVerified) { seguir(user); return; }
  const { msg, decir } = mensajero();
  const destino = h("strong", { class: "acceso-correo", text: user.email || "" });
  const ya = h("button", { type: "button", class: "primary", text: "Ya lo confirmé" });
  const reenviar = h("button", { type: "button", class: "ghost", text: "Reenviar el correo" });
  const otro = h("button", { type: "button", class: "enlace-boton acceso-enlace", text: "Usar otro correo", onclick: () => signOut(auth) });
  const tarjeta = h("div", { class: "acceso acceso-confirmar" },
    h("span", { class: "acceso-icono", "aria-hidden": "true" }, svgIcono(["M4 6.5h16v11H4z", "m4.5 7 7.5 6 7.5-6"], 28)),
    h("h1", { class: "acceso-titulo", text: "Confirma tu correo" }),
    h("p", { class: "acceso-texto" }, "Te enviamos un enlace a ", destino, ". Ábrelo para confirmar que el correo es tuyo y luego vuelve aquí."),
    h("p", { class: "acceso-nota", text: "¿No lo ves? Revisa la carpeta de spam o correo no deseado. Puede tardar unos minutos." }),
    h("div", { class: "acceso-acciones" }, ya, reenviar, otro), msg);
  contenedor.replaceChildren(tarjeta);

  let fin = false;
  const terminar = () => { fin = true; clearInterval(reloj); document.removeEventListener("visibilitychange", alVolver); };
  // Espera entre reenvíos (se recalcula cada segundo; la prueba puede acortarla en el emulador).
  const tic = () => {
    if (!tarjeta.isConnected) { terminar(); return; }
    const falta = Math.ceil((ultimoEnvio(user.uid) + ACCESO.esperaReenvio * 1000 - Date.now()) / 1000);
    if (reenviar.getAttribute("aria-busy")) return;
    reenviar.disabled = falta > 0;
    reenviar.textContent = falta > 0 ? `Reenviar el correo (en ${falta} s)` : "Reenviar el correo";
  };
  let reloj = 0;

  const comprobar = async (silencioso) => {
    const u = auth.currentUser;
    if (fin || !u || u.uid !== user.uid) return;
    try {
      await u.reload();
      if (!u.emailVerified) {
        if (!silencioso) decir("Todavía no vemos la confirmación. Abre el enlace del correo que te enviamos y vuelve a tocar «Ya lo confirmé».", "error");
        return;
      }
      await u.getIdToken(true); // el token nuevo lleva email_verified (y el nombre) para las reglas
      terminar();
      seguir(u);
    } catch (e) {
      if (!silencioso) decir(mensajeAcceso(e), "error");
    }
  };
  // Al volver a esta pestaña (después de abrir el enlace en el correo) se comprueba sola.
  const alVolver = () => { if (document.visibilityState === "visible") comprobar(true); };

  ya.addEventListener("click", async () => {
    ya.disabled = true;
    decir("");
    try { await comprobar(false); } finally { ya.disabled = false; }
  });
  const enviar = async (avisarListo) => {
    reenviar.disabled = true;
    reenviar.setAttribute("aria-busy", "true");
    try {
      await enviarConfirmacion(auth.currentUser || user);
      if (avisarListo) decir(`Listo: te enviamos otro enlace a ${user.email}.`, "ok");
    } catch (e) {
      decir(mensajeAcceso(e), "error");
    } finally {
      reenviar.removeAttribute("aria-busy");
      tic();
    }
  };
  reenviar.addEventListener("click", () => { if (!reenviar.disabled) enviar(true); });

  reloj = setInterval(tic, 1000);
  tic();
  document.addEventListener("visibilitychange", alVolver);
  // Si a esta cuenta aún no se le envió ningún enlace desde este navegador, se envía ya.
  if (!ultimoEnvio(user.uid)) enviar(false);
}

// "¿Cómo te llamas?": cuentas sin nombre (las de correo, al entrar la primera vez). Reintenta si falla la conexión.
function vistaNombre(contenedor, user, alListo) {
  const { msg, decir } = mensajero();
  const c = enlazar(campo("Nombre y apellido", { type: "text", autocomplete: "name", autocapitalize: "words", enterkeyhint: "done", maxlength: "80" }));
  c.input.value = nombrePendiente(user.email);
  const boton = h("button", { type: "submit", class: "primary", text: "Continuar" });
  const form = h("form", { class: "acceso-form", novalidate: true, "aria-label": "Tu nombre" }, c.el, boton);
  const otro = h("button", { type: "button", class: "enlace-boton acceso-enlace", text: "Usar otro correo", onclick: () => signOut(auth) });
  contenedor.replaceChildren(h("div", { class: "acceso acceso-confirmar acceso-nombre" },
    h("span", { class: "acceso-icono", "aria-hidden": "true" }, svgIcono(["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4.5 20a7.5 7.5 0 0 1 15 0"], 28)),
    h("h1", { class: "acceso-titulo", text: "¿Cómo te llamas?" }),
    h("p", { class: "acceso-texto", text: "Así te verá la familia en el muro, los mensajes y el árbol." }),
    form, otro, msg));
  if (!c.input.value) c.input.focus();

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const nombre = c.input.value.replace(/\s+/g, " ").trim();
    if (nombre.length < 2) { decir("Escribe tu nombre y apellido."); c.input.focus(); return; }
    decir("");
    return ocupado(boton, "Guardando…", async () => {
      const u = auth.currentUser;
      if (!u || u.uid !== user.uid) return;
      let error = null;
      for (let intento = 0; intento < 3; intento++) {
        try {
          if (u.displayName !== nombre) await updateProfile(u, { displayName: nombre });
          await u.getIdToken(true); // las reglas de profiles comparan con el nombre del token
          error = null;
          break;
        } catch (e) { error = e; await espera(700 * (intento + 1)); }
      }
      if (error) { decir(mensajeAcceso(error)); return; }
      try { localStorage.removeItem(CLAVE_NOMBRE); } catch { /* nada */ }
      alListo(u);
    });
  });
}

// El token de sesión puede haberse emitido antes de confirmar el correo o de poner el nombre:
// las reglas leen email_verified y name del token, así que se renueva si no coincide con la cuenta.
export async function asegurarToken(user) {
  try {
    const { claims } = await user.getIdTokenResult();
    if (claims.email_verified !== user.emailVerified || (user.displayName && claims.name !== user.displayName)) await user.getIdToken(true);
  } catch (e) { console.warn("sesión:", e.code || e.message); }
}

// ¿Es de la familia? Admin (solo los admins pueden listar members) o aprobado en members/{correo en minúsculas}.
// Los administradores son los fundadores (fijos en las reglas) y los miembros con role 'admin'.
// `esFundador`: admin sin documento propio o con la marca fundador (las reglas solo dejan ponerla a los fundadores).
export async function comprobarFamilia(user) {
  await asegurarToken(user);
  const email = (user.email || "").toLowerCase();
  let isAdmin = false;
  try { await getDocs(query(collection(db, "members"), limit(1))); isAdmin = true; } catch { /* no es admin */ }
  let member = null;
  try { const m = await getDoc(doc(db, "members", email)); if (m.exists()) member = m.data(); } catch { /* nada */ }
  // Un admin que no es fundador SIEMPRE tiene members/{correo} con role 'admin'. Así que un admin sin documento,
  // o con uno sin ese rango (documento antiguo, de cuando solo había invitaciones), es fundador.
  const esFundador = isAdmin && (!member || member.fundador === true || member.role !== "admin");
  // El fundador se marca en su documento (así aparece en «Miembros» como Fundador y puede tener su ficha).
  // Las reglas solo se lo permiten a los fundadores.
  if (esFundador && member?.fundador !== true) {
    const datos = member
      ? { ...member, fundador: true, role: "admin" }
      : { fundador: true, role: "admin", addedBy: email, name: (user.displayName || "").slice(0, 200) || null };
    try { await setDoc(doc(db, "members", email), datos); member = datos; } catch { /* nada: no es fundador */ }
  }
  return { email, isAdmin, member, esFundador };
}

// ---------------------------------------------------------------------------
// Solicitud de acceso (las tres puertas): quien entra con su cuenta y aún no es de la familia pide entrar
// (requests/{uid}); un administrador la aprueba o la rechaza. Mientras espera, un escucha en vivo de su
// propio members/{correo} lo deja entrar SOLO, sin recargar, en cuanto lo aprueban.
// ---------------------------------------------------------------------------
export const SOLICITUD = { relacionMax: 300, telefonoMax: 30, nombreMax: 120, esperaReenvioMs: 24 * 3600 * 1000 };
const fechaLarga = (ts) => {
  const d = ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : null;
  return d ? new Intl.DateTimeFormat("es", { dateStyle: "long", timeStyle: "short" }).format(d) : "";
};
const limpiarTexto = (t) => String(t || "").replace(/\s+/g, " ").trim();

// Formulario de la solicitud: nombre, «¿Quién eres en la familia?» y teléfono opcional.
function formSolicitud({ name = "", relacion = "", telefono = "" }, textoBoton, alEnviar, decir) {
  const cNombre = enlazar(campo("Tu nombre y apellido", { type: "text", autocomplete: "name", autocapitalize: "words", enterkeyhint: "next", maxlength: String(SOLICITUD.nombreMax), name: "nombre" }));
  cNombre.input.value = name;
  const idRel = `acceso-${++idCampo}`;
  const relacionTa = h("textarea", { class: "entrada", id: idRel, rows: "3", maxlength: String(SOLICITUD.relacionMax), autocapitalize: "sentences", name: "relacion",
    placeholder: "Por ejemplo: nieta de Pedro y Rosa, hija de Marta" });
  relacionTa.value = relacion;
  const cuenta = h("small", { class: "acceso-cuenta", "aria-live": "polite" });
  const contar = () => { cuenta.textContent = `${relacionTa.value.length} de ${SOLICITUD.relacionMax}`; };
  relacionTa.addEventListener("input", contar);
  contar();
  const cRel = h("div", { class: "acceso-campo" },
    h("label", { class: "campo", for: idRel }, h("span", { text: "¿Quién eres en la familia?" }),
      h("small", { text: "Di de quién eres hijo, hija, nieto, nieta o pareja. Así el administrador te encuentra en el árbol." })),
    relacionTa, cuenta);
  const cTel = enlazar(campo("Teléfono o WhatsApp (opcional)", { type: "tel", inputmode: "tel", autocomplete: "tel", enterkeyhint: "send", maxlength: String(SOLICITUD.telefonoMax), name: "telefono" },
    "Por si el administrador necesita confirmar quién eres."));
  cTel.input.value = telefono || "";
  const boton = h("button", { type: "submit", class: "primary", text: textoBoton });
  const form = h("form", { class: "acceso-form", novalidate: true, "aria-label": "Tu solicitud" }, cNombre.el, cRel, cTel.el, boton);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const datos = { name: limpiarTexto(cNombre.input.value), relacion: limpiarTexto(relacionTa.value), telefono: limpiarTexto(cTel.input.value) };
    if (datos.name.length < 2) { decir("Escribe tu nombre y apellido."); cNombre.input.focus(); return; }
    if (datos.relacion.length < 3) { decir("Cuéntanos quién eres en la familia (por ejemplo, de quién eres hijo o nieta)."); relacionTa.focus(); return; }
    decir("");
    return ocupado(boton, "Enviando…", () => alEnviar(datos));
  });
  return form;
}

/**
 * Pantalla de solicitud de acceso en `contenedor` (muro, árbol o iniciarPagina). `alAprobar(user)` se llama
 * en cuanto existe su members/{correo}. Devuelve la función que suelta los escuchas.
 */
export function vistaSolicitud(contenedor, user, alAprobar) {
  if (!contenedor) return () => {};
  const email = (user.email || "").toLowerCase();
  const refSol = doc(db, "requests", user.uid);
  const { msg, decir } = mensajero();
  const tarjeta = h("div", { class: "acceso acceso-confirmar acceso-solicitud" }, h("p", { class: "acceso-nota", text: "Cargando…" }));
  contenedor.replaceChildren(tarjeta);
  let sol; // undefined: cargando · null: no ha pedido · objeto: su solicitud
  let editando = false;
  let terminado = false;
  let reloj = 0;
  const quitar = [];
  const fin = () => {
    if (terminado) return;
    terminado = true;
    clearTimeout(reloj);
    while (quitar.length) { try { quitar.pop()(); } catch { /* nada */ } }
  };
  const otraCuenta = () => h("button", { type: "button", class: "enlace-boton acceso-enlace", text: "Usar otra cuenta", onclick: () => { fin(); signOut(auth); } });
  const icono = (paths) => h("span", { class: "acceso-icono", "aria-hidden": "true" }, svgIcono(paths, 28));
  const ICONO_FAMILIA = ["M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z", "M2.5 20a6.5 6.5 0 0 1 13 0", "M16 11a3 3 0 1 0 0-6", "M18 20a5.5 5.5 0 0 0-3-4.9"];
  const ICONO_RELOJ = ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7v5l3 2"];
  const cuentaDe = () => h("p", { class: "acceso-nota" }, "Entraste como ", h("strong", { class: "acceso-correo", text: email }), ".");
  const errorAlGuardar = (e) => (e?.code === "permission-denied"
    ? "No se pudo guardar. Si tu solicitud fue rechazada hace poco, todavía no puedes enviarla de nuevo. Recarga la página e inténtalo más tarde."
    : mensajeAcceso(e));

  const resumen = (s) => h("dl", { class: "acceso-resumen" },
    h("div", {}, h("dt", { text: "Nombre" }), h("dd", { text: s.name || "" })),
    h("div", {}, h("dt", { text: "Quién eres en la familia" }), h("dd", { text: s.relacion || "" })),
    s.telefono ? h("div", {}, h("dt", { text: "Teléfono o WhatsApp" }), h("dd", { text: s.telefono })) : null,
    s.createdAt ? h("div", {}, h("dt", { text: "Enviada" }), h("dd", { text: fechaLarga(s.createdAt) })) : null);

  const pintar = () => {
    if (terminado || !tarjeta.isConnected) { fin(); return; }
    clearTimeout(reloj);
    decir("");
    if (sol === undefined) return;
    const valores = { name: sol?.name || user.displayName || "", relacion: sol?.relacion || "", telefono: sol?.telefono || "" };

    if (sol === null) {
      const form = formSolicitud(valores, "Enviar mi solicitud", async (d) => {
        try {
          await setDoc(refSol, { uid: user.uid, email, name: d.name, relacion: d.relacion, ...(d.telefono ? { telefono: d.telefono } : {}), status: "pending", createdAt: serverTimestamp() });
        } catch (e) { decir(errorAlGuardar(e)); }
      }, decir);
      const nombre = (user.displayName || "").split(/\s+/)[0];
      tarjeta.replaceChildren(icono(ICONO_FAMILIA),
        h("h1", { class: "acceso-titulo", text: "Pide entrar a la familia" }),
        h("p", { class: "acceso-texto", text: `${nombre ? `Hola, ${nombre}. ` : ""}Para ver el muro, el árbol y las fotos, un administrador de la familia tiene que aprobar tu entrada. Cuéntanos quién eres.` }),
        cuentaDe(), form, msg, otraCuenta());
      return;
    }

    if (sol.status === "pending") {
      if (editando) {
        const form = formSolicitud(valores, "Guardar cambios", async (d) => {
          try {
            await updateDoc(refSol, { name: d.name, relacion: d.relacion, telefono: d.telefono || null });
            editando = false;
            pintar();
            decir("Listo: guardamos tus cambios.", "ok");
          } catch (e) { decir(errorAlGuardar(e)); }
        }, decir);
        tarjeta.replaceChildren(icono(ICONO_RELOJ),
          h("h1", { class: "acceso-titulo", text: "Corrige tu solicitud" }),
          form, msg,
          h("button", { type: "button", class: "ghost", text: "Cancelar", onclick: () => { editando = false; pintar(); } }),
          otraCuenta());
        return;
      }
      tarjeta.replaceChildren(icono(ICONO_RELOJ),
        h("h1", { class: "acceso-titulo", text: "Tu solicitud está en revisión" }),
        h("p", { class: "acceso-texto", text: "Un administrador de la familia la revisará pronto. Cuando la apruebe, entrarás aquí mismo, sin hacer nada más. También puedes cerrar y volver más tarde." }),
        resumen(sol), cuentaDe(),
        h("div", { class: "acceso-acciones" },
          h("button", { type: "button", class: "ghost", text: "Corregir mis datos", onclick: () => { editando = true; pintar(); } })),
        msg, otraCuenta());
      return;
    }

    // Rechazada (o aprobada antes y luego quitada de la red): puede enviarla de nuevo pasadas 24 h de la decisión.
    const rechazada = sol.status !== "approved";
    const decidida = sol.decidedAt?.toMillis?.() || 0;
    const desde = decidida + SOLICITUD.esperaReenvioMs;
    const puede = Date.now() >= desde;
    const partes = [icono(ICONO_FAMILIA),
      h("h1", { class: "acceso-titulo", text: rechazada ? "Tu solicitud no fue aprobada" : "Ya no estás en la red de la familia" })];
    if (rechazada && sol.motivo) partes.push(h("p", { class: "acceso-texto acceso-motivo" }, h("b", { text: "Motivo: " }), sol.motivo));
    else if (rechazada) partes.push(h("p", { class: "acceso-texto", text: "El administrador no dejó un motivo." }));
    if (puede) {
      partes.push(h("p", { class: "acceso-texto", text: "Si crees que es un error, revisa tus datos y envíala de nuevo." }),
        formSolicitud(valores, "Enviar de nuevo", async (d) => {
          try {
            await updateDoc(refSol, { name: d.name, relacion: d.relacion, telefono: d.telefono || null, status: "pending", createdAt: serverTimestamp() });
          } catch (e) { decir(errorAlGuardar(e)); }
        }, decir));
    } else {
      partes.push(h("p", { class: "acceso-texto acceso-espera", text: `Podrás enviarla de nuevo a partir del ${fechaLarga(new Date(desde))}.` }));
      // Cuando llegue la hora, la pantalla se actualiza sola.
      const falta = desde - Date.now();
      if (falta < 2 ** 31 - 1) reloj = setTimeout(pintar, falta + 500);
    }
    partes.push(cuentaDe(), msg, otraCuenta());
    tarjeta.replaceChildren(...partes);
  };

  // Aprobado: existe su members/{correo} (las reglas le dejan leer SOLO el suyo).
  quitar.push(onSnapshot(doc(db, "members", email), (s) => {
    // Solo lo que confirmó el servidor: una escritura local rechazada (p. ej. alguien que intenta crearse su
    // members desde la consola) no lo deja «entrar» ni un instante.
    if (s.exists() && !s.metadata.hasPendingWrites && !terminado) { fin(); alAprobar(auth.currentUser || user); }
  }, (e) => console.warn("aprobación:", e.code || e.message)));
  quitar.push(onSnapshot(refSol, (s) => {
    const nuevo = s.exists() ? s.data({ serverTimestamps: "estimate" }) : null;
    const cambio = sol === undefined || (sol?.status || null) !== (nuevo?.status || null);
    sol = nuevo;
    if (cambio) editando = false;
    if (cambio || !editando) {
      // No se repinta encima de lo que está escribiendo (p. ej. el formulario de reenvío).
      const escribiendo = tarjeta.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement?.tagName || "");
      if (cambio || !escribiendo) pintar();
    }
  }, (e) => { console.warn("solicitud:", e.code || e.message); if (sol === undefined) { sol = null; pintar(); } }));
  return fin;
}

// Número de solicitudes de acceso pendientes (solo admins). `alCambiar(n)` opcional.
// Con solicitudes pendientes, el enlace «Administrar» lleva la clase `con-pendientes`: en el teléfono pasa al
// principio del menú (si no, quedaría fuera del borde derecho y el admin no vería el número).
export function montarContadorSolicitudes(span, alCambiar) {
  const enlace = span?.closest("a");
  return onSnapshot(query(collection(db, "requests"), where("status", "==", "pending"), limit(300)), (snap) => {
    if (span) { span.textContent = String(snap.size); span.hidden = snap.size === 0; }
    if (enlace) {
      enlace.classList.toggle("con-pendientes", snap.size > 0);
      enlace.setAttribute("aria-label", snap.size ? `Administrar: ${snap.size} ${snap.size === 1 ? "solicitud pendiente" : "solicitudes pendientes"}` : "Administrar");
    }
    alCambiar?.(snap.size);
  }, (e) => console.warn("solicitudes:", e.code || e.message));
}

/**
 * Vigila el propio members/{correo} (de quien NO es fundador): si lo quitan de la red o le dan o quitan el rango
 * de administrador con la página abierta, llama a `alCambiar()` (una vez) para volver a entrar con lo nuevo.
 * Se confirma con el servidor: una escritura local que las reglas rechazan no cuenta.
 */
export function vigilarMiRango(email, isAdmin, alCambiar) {
  let hecho = false;
  const ref = doc(db, "members", email);
  const igual = (d) => d.exists() && (d.data().role === "admin") === Boolean(isAdmin);
  const avisar = () => { if (!hecho) { hecho = true; alCambiar(); } };
  const quitar = onSnapshot(ref, (s) => {
    if (hecho || s.metadata.hasPendingWrites || igual(s)) return;
    waitForPendingWrites(db).catch(() => {})
      .then(() => getDocFromServer(ref))
      .then((d) => { if (!igual(d)) avisar(); })
      .catch(avisar);
  }, () => {});
  return () => { hecho = true; quitar(); };
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
// Enlace «Administrar» (solo se ve si eres administrador), con el número de solicitudes pendientes.
export const ENLACE_ADMIN = ["admin", "/admin/", "Administrar"];

function cabecera(activa) {
  const nav = h("nav", { class: "nav", "aria-label": "Principal", hidden: true },
    SECCIONES.map(([id, href, label]) => h("a", { href, "aria-current": id === activa ? "page" : null },
      label, id === "mensajes" ? h("span", { class: "nav-badge", id: "navMensajes", hidden: true }) : null)),
    h("a", { href: ENLACE_ADMIN[1], id: "navAdmin", hidden: true, "aria-current": activa === ENLACE_ADMIN[0] ? "page" : null },
      ENLACE_ADMIN[2], h("span", { class: "nav-badge", id: "navSolicitudes", hidden: true })));
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
    const acceso = h("div");
    gate.replaceChildren(
      h("h1", {}, "La familia ", h("span", { class: "accent", text: "Padrón Perera" })),
      h("p", { class: "muted", text: "Solo para la familia. Entra o crea tu cuenta con Google o con tu correo." }),
      acceso);
    montarAcceso(acceso);
  };

  const entrar = async (u) => {
    gate.replaceChildren(h("p", { class: "muted", text: "Cargando…" }));
    const { email, isAdmin, member, esFundador } = await comprobarFamilia(u);
    if (auth.currentUser?.uid !== u.uid) return; // cerró sesión mientras tanto
    let reentrando = false;
    const reentrar = () => { if (reentrando || auth.currentUser?.uid !== u.uid) return; reentrando = true;
      limpiar();
      raiz.hidden = true; gate.hidden = false; nav.hidden = true; user.hidden = true;
      entrar(u);
    };
    if (!isAdmin && !member) {
      // Aún no es de la familia: pide entrar (o ve cómo va su solicitud). Al aprobarla, entra solo.
      limpiezas.push(vistaSolicitud(gate, u, (yo) => entrar(yo)));
      return;
    }
    // Si lo quitan de la red o le cambian el rango con la página abierta, vuelve a entrar (sin recargar).
    if (!esFundador) limpiezas.push(vigilarMiRango(email, isAdmin, reentrar));
    // merge: no borra lo que el familiar escribió en su perfil ("Sobre mí", ciudad).
    setDoc(doc(db, "profiles", u.uid), {
      name: nombrePerfil(u, email), photoURL: fotoPerfil(u.photoURL), email,
      personId: member?.personId || null, updatedAt: serverTimestamp(),
    }, { merge: true }).catch((e) => console.warn("perfil:", e.code || e.message));
    $("user-name").textContent = u.displayName || member?.name || email;
    const foto = safeUrl(u.photoURL);
    $("user-photo").hidden = !foto;
    if (foto) $("user-photo").src = foto;
    $("user-ini").hidden = Boolean(foto);
    $("user-ini").textContent = initials(u.displayName || member?.name || email);
    nav.hidden = false;
    user.hidden = false;
    gate.hidden = true;
    raiz.hidden = false;
    limpiezas.push(montarCampana($("campana")));
    limpiezas.push(montarContadorMensajes($("navMensajes")));
    $("navAdmin").hidden = !isAdmin;
    if (isAdmin) limpiezas.push(montarContadorSolicitudes($("navSolicitudes")));
    const extra = await alEntrar({ user: u, isAdmin, member, esFundador });
    if (typeof extra === "function") limpiezas.push(extra);
  };

  onAuthStateChanged(auth, (u) => {
    limpiar();
    raiz.hidden = true;
    gate.hidden = false;
    nav.hidden = true;
    user.hidden = true;
    if (!u) { mostrarLogin(); return; }
    // Con correo y contraseña: primero confirmar el correo (las reglas no dejan leer nada antes) y poner su nombre.
    if (accesoPendiente(u)) { vistaConfirmarCorreo(gate, u, entrar); return; }
    entrar(u);
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
