// Muro privado de padron.quest — Firebase Auth (Google) + Firestore.
// La seguridad la imponen las reglas de Firestore (solo miembros invitados
// leen/publican; solo el administrador gestiona la lista de miembros).
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, addDoc, query, orderBy, limit,
  onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL, deleteObject,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDkrGcwFUpxtImQdC0WWOgES5gfvGSjAsU",
  authDomain: "padron-quest.firebaseapp.com",
  projectId: "padron-quest",
  storageBucket: "padron-quest.firebasestorage.app",
  messagingSenderId: "570581063341",
  appId: "1:570581063341:web:c595054a2ff6b043349824",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const $ = (id) => document.getElementById(id);
const views = ["view-loading", "view-login", "view-denied", "view-wall"];
function show(view) { views.forEach((v) => ($(v).hidden = v !== view)); }

let unsubscribeFeed = null;
let isAdmin = false;

// ---------- Sesión ----------
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
  stopFeed();
  if (!user) {
    $("user").hidden = true;
    show("view-login");
    return;
  }
  $("user").hidden = false;
  $("user-name").textContent = user.displayName || user.email;
  $("user-photo").src = user.photoURL || "";
  $("user-photo").hidden = !user.photoURL;
  enter(user);
});

async function enter(user) {
  show("view-loading");
  const email = (user.email || "").toLowerCase();
  // ¿Es administrador? Solo el admin puede listar la colección de miembros.
  isAdmin = false;
  try {
    await getDocs(query(collection(db, "members"), limit(1)));
    isAdmin = true;
  } catch { /* no es admin */ }

  // ¿Es miembro? Puede leer su propio documento de invitación.
  let member = isAdmin;
  if (!member) {
    try { member = (await getDoc(doc(db, "members", email))).exists(); } catch { member = false; }
  }
  if (!member) {
    $("denied-email").textContent = email;
    show("view-denied");
    return;
  }
  show("view-wall");
  $("admin").hidden = !isAdmin;
  if (isAdmin) loadMembers();
  startFeed();
}

// ---------- Muro ----------
function startFeed() {
  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(50));
  unsubscribeFeed = onSnapshot(q, (snap) => renderFeed(snap), (err) => {
    console.error(err);
    $("feed").textContent = "No se pudo cargar el muro (" + err.code + ").";
  });
}
function stopFeed() { if (unsubscribeFeed) { unsubscribeFeed(); unsubscribeFeed = null; } }

const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
function timeAgo(date) {
  const s = Math.round((date - Date.now()) / 1000);
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [u, sec] of units) if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), u);
  return "ahora";
}

function renderFeed(snap) {
  const feed = $("feed");
  feed.replaceChildren();
  $("feed-empty").hidden = !snap.empty;
  const me = auth.currentUser;
  snap.forEach((d) => {
    const p = d.data({ serverTimestamps: "estimate" });
    const el = $("tpl-post").content.firstElementChild.cloneNode(true);
    const av = el.querySelector(".avatar");
    if (p.photoURL) av.src = p.photoURL; else av.removeAttribute("src");
    el.querySelector(".post-name").textContent = p.name || p.email;
    const t = el.querySelector(".post-time");
    if (p.createdAt) {
      const date = p.createdAt.toDate();
      t.textContent = timeAgo(date);
      t.dateTime = date.toISOString();
      t.title = date.toLocaleString("es");
    }
    el.querySelector(".post-text").textContent = p.text || "";
    if (p.imageURL) {
      const img = el.querySelector(".post-img");
      img.src = p.imageURL;
      img.hidden = false;
    }
    if (me && (p.uid === me.uid || isAdmin)) {
      const del = el.querySelector(".post-delete");
      del.hidden = false;
      del.addEventListener("click", async () => {
        if (!confirm("¿Borrar esta publicación?")) return;
        await deleteDoc(doc(db, "posts", d.id));
        if (p.imagePath) deleteObject(ref(storage, p.imagePath)).catch((e) => console.warn("foto no borrada", e));
      });
    }
    feed.appendChild(el);
  });
}

// ---------- Publicar ----------
let pendingImage = null; // Blob JPEG listo para subir
let previewURL = null;

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
$("btn-remove-photo").addEventListener("click", () => {
  pendingImage = null;
  $("preview").hidden = true;
});

$("composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("post-text").value.trim();
  if (!text && !pendingImage) return;
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
      email: (user.email || "").toLowerCase(),
      name: user.displayName || user.email,
      photoURL: user.photoURL || null,
      text,
      imageURL,
      imagePath,
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

function setStatus(msg) { $("composer-status").textContent = msg; }

// Reduce la foto en el navegador antes de subirla a Storage: máximo 2048 px
// y JPEG con calidad decreciente hasta < 4 MB (las reglas aceptan hasta 5 MB).
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
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
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

// ---------- Administración de miembros ----------
async function loadMembers() {
  const list = $("member-list");
  list.replaceChildren();
  const snap = await getDocs(collection(db, "members"));
  if (snap.empty) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "Aún no hay invitados.";
    list.appendChild(li);
  }
  snap.forEach((d) => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = d.id;
    const btn = document.createElement("button");
    btn.className = "ghost small";
    btn.type = "button";
    btn.textContent = "Quitar";
    btn.addEventListener("click", async () => {
      if (!confirm(`¿Quitar a ${d.id}?`)) return;
      await deleteDoc(doc(db, "members", d.id));
      loadMembers();
    });
    li.append(span, btn);
    list.appendChild(li);
  });
}

$("member-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("member-email").value.trim().toLowerCase();
  if (!email) return;
  try {
    await setDoc(doc(db, "members", email), { addedAt: serverTimestamp(), addedBy: auth.currentUser.email.toLowerCase() });
    $("member-email").value = "";
    loadMembers();
  } catch (err) {
    alert("No se pudo invitar: " + (err.code || err.message));
  }
});
