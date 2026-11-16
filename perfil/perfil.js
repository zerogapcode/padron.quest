// Perfil de cada familiar: datos del árbol, familia cercana, "Sobre mí", fotos y publicaciones.
// /perfil/?persona=<id del árbol>, /perfil/?uid=<cuenta> o /perfil/ (mi propio perfil).
// Todo el texto entra con textContent (h()); la seguridad real la ponen las reglas de Firestore.
import {
  iniciarPagina, db, h, $, initials, safeUrl, fotoPerfil, nombrePerfil, timeEl, parseFecha, MESES_LARGOS, escucharPersonas, EMULADOR,
  collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where, limit, onSnapshot, serverTimestamp,
} from "/comun/base.js";
import { collectionGroup } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";

if (EMULADOR) window.__db = { db, doc, getDoc, setDoc, updateDoc };

const raiz = $("raiz");
const ID_OK = /^[A-Za-z0-9_-]{1,128}$/;
const COLOR_OK = /^#[0-9A-Fa-f]{6}$/;
const MAX_BIO = 500;
const MAX_CIUDAD = 80;

const st = {
  yo: null, member: null, isAdmin: false,
  propio: false,      // se pidió /perfil/ sin parámetros
  fichaPerdida: false, // mi members.personId apunta a una ficha que ya no existe
  tipo: null,         // "persona" | "uid" | "invalido"
  personaId: null,    // ficha del árbol que se muestra (si hay)
  uid: null,          // cuenta que se muestra (si hay)
  personas: new Map(), personasListas: false,
  ramas: {},
  cuenta: null, cuentaLista: false,
  posts: [], postsListos: false,
  todasFotos: null,   // fotos de todos los álbumes (misma consulta que /fotos/)
  editando: false,
  unsubCuenta: null, unsubPosts: null, unsubBusqueda: null,
};

// Contenedores fijos: así una actualización en vivo no borra el formulario "Sobre mí" a medio escribir.
const cajas = {
  aviso: h("div"),
  hero: h("section", { class: "card perfil-hero", "aria-labelledby": "perfilNombre" }),
  sobre: h("section", { class: "card", "aria-labelledby": "tSobre" }),
  familia: h("section", { class: "card", "aria-labelledby": "tFamilia" }),
  fotos: h("section", { class: "card", "aria-labelledby": "tFotos" }),
  posts: h("section", { class: "card", "aria-labelledby": "tPosts" }),
};
const columnas = h("div", { class: "perfil-columnas" },
  h("div", { class: "perfil-col" }, cajas.sobre, cajas.familia),
  h("div", { class: "perfil-col ancha" }, cajas.fotos, cajas.posts));
raiz.append(cajas.aviso, cajas.hero, columnas);

iniciarPagina({
  activa: "perfil",
  raiz,
  alSalir: () => {
    [st.unsubCuenta, st.unsubPosts, st.unsubBusqueda].forEach((u) => u?.());
    st.unsubCuenta = st.unsubPosts = st.unsubBusqueda = null;
  },
  alEntrar: ({ user, member, isAdmin }) => {
    st.yo = user;
    st.member = member;
    st.isAdmin = Boolean(isAdmin);
    st.editando = false;
    elegirObjetivo();
    const u1 = escucharPersonas((m) => { st.personas = m; st.personasListas = true; pintar(); });
    getDoc(doc(db, "config", "arbol"))
      .then((c) => { st.ramas = (c.exists() && c.data().branches) || {}; pintar(); })
      .catch((e) => console.warn("ramas:", e.code || e.message));

    if (st.tipo === "uid") seguirCuenta(st.uid);
    else if (st.tipo === "persona") buscarCuentaDePersona(st.personaId);
    if (st.personaId) cargarFotos();
    pintar();
    return () => { u1(); };
  },
});

// ---------------------------------------------------------------------------
// Qué perfil se pidió
// ---------------------------------------------------------------------------
function elegirObjetivo() {
  const p = new URLSearchParams(location.search);
  const persona = p.get("persona");
  const uid = p.get("uid");
  st.personaId = null; st.uid = null; st.fichaPerdida = false;
  st.propio = persona === null && uid === null;
  if (persona !== null) {
    if (ID_OK.test(persona)) { st.tipo = "persona"; st.personaId = persona; } else st.tipo = "invalido";
  } else if (uid !== null) {
    if (ID_OK.test(uid)) { st.tipo = "uid"; st.uid = uid; } else st.tipo = "invalido";
  } else if (st.member?.personId && ID_OK.test(st.member.personId)) {
    // Mi propio perfil, vinculado a mi ficha del árbol.
    st.tipo = "persona"; st.personaId = st.member.personId;
  } else {
    st.tipo = "uid"; st.uid = st.yo.uid;
  }
}

// La cuenta de una persona del árbol: profiles donde personId == id (la más reciente, si hay varias).
function buscarCuentaDePersona(personaId) {
  st.unsubBusqueda?.();
  st.unsubBusqueda = onSnapshot(query(collection(db, "profiles"), where("personId", "==", personaId), limit(5)), (snap) => {
    let docs = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    // Mi propio perfil: aunque mi profiles/{uid} aún no se haya guardado, la cuenta soy yo.
    if (st.member?.personId === personaId && !docs.some((d) => d.uid === st.yo.uid)) docs.push({ uid: st.yo.uid });
    docs.sort((a, b) => (b.uid === st.yo.uid) - (a.uid === st.yo.uid) || (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
    const elegida = docs[0]?.uid || null;
    if (elegida && elegida !== st.uid) seguirCuenta(elegida);
    if (!elegida) { st.uid = null; st.cuenta = null; st.cuentaLista = true; pintar(); }
  }, (err) => { console.warn("cuenta:", err.code || err.message); st.cuentaLista = true; pintar(); });
}

function seguirCuenta(uid) {
  st.uid = uid;
  st.cuentaLista = false;
  st.unsubCuenta?.();
  st.unsubCuenta = onSnapshot(doc(db, "profiles", uid), (d) => {
    if (d.exists()) st.cuenta = { uid, ...d.data({ serverTimestamps: "estimate" }) };
    else if (uid === st.yo.uid) st.cuenta = { uid, name: st.yo.displayName || st.yo.email, photoURL: st.yo.photoURL };
    else st.cuenta = null;
    st.cuentaLista = true;
    // ?uid= de una cuenta vinculada al árbol: mostrar también su ficha.
    if (st.tipo === "uid" && st.cuenta?.personId && ID_OK.test(st.cuenta.personId) && st.personaId !== st.cuenta.personId) {
      st.personaId = st.cuenta.personId;
      cargarFotos();
    }
    pintar();
  }, (err) => { console.warn("perfil:", err.code || err.message); st.cuenta = null; st.cuentaLista = true; pintar(); });
  st.unsubPosts?.();
  st.postsListos = false;
  // Sin orderBy: una sola condición de igualdad no necesita índice compuesto. Se ordena aquí.
  // Sin límite: con limit() sin orden saldrían unas publicaciones cualquiera, no las más recientes.
  st.unsubPosts = onSnapshot(query(collection(db, "posts"), where("uid", "==", uid)), (snap) => {
    st.posts = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    st.postsListos = true;
    pintarPosts();
  }, (err) => { console.warn("publicaciones:", err.code || err.message); st.postsListos = true; pintarPosts(); });
}

// Misma consulta que /fotos/ (todas las fotos de los álbumes) y se filtra por etiqueta aquí: sin índices nuevos.
async function cargarFotos() {
  if (st.todasFotos) { pintarFotos(); return; }
  try {
    const snap = await getDocs(query(collectionGroup(db, "photos"), limit(3000)));
    st.todasFotos = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  } catch (err) {
    console.warn("fotos:", err.code || err.message);
    st.todasFotos = [];
  }
  pintarFotos();
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const enlacePersona = (id) => `/perfil/?persona=${encodeURIComponent(id)}`;
const ramaDe = (p) => (p && st.ramas[p.branch]) || null;
const colorDe = (p) => { const c = ramaDe(p)?.color; return COLOR_OK.test(c || "") ? c : "#13293D"; };
const esMujer = (p) => p?.gender === "Female";
const anio = (t) => (/(\d{4})/.exec(String(t || "")) || [])[1] || "";
const esMio = () => Boolean(st.uid && st.uid === st.yo.uid);

function fechaTexto(t) {
  const f = parseFecha(t);
  if (f) return `${f.d} de ${MESES_LARGOS[f.m]}${f.y ? ` de ${f.y}` : ""}`;
  return /\d/.test(String(t || "")) ? String(t).trim() : "";
}
function edad(p) {
  if (p.isDeceased) return null;
  const f = parseFecha(p.birthDate);
  if (!f?.y) return null;
  const hoy = new Date();
  let e = hoy.getFullYear() - f.y;
  if (hoy.getMonth() < f.m || (hoy.getMonth() === f.m && hoy.getDate() < f.d)) e--;
  return e >= 0 && e < 120 ? e : null;
}
function aniosVida(p) {
  const n = anio(p.birthDate), m = anio(p.deathDate);
  if (n && m) return `${n} – ${m}`;
  if (n) return p.isDeceased ? `${n} – †` : `n. ${n}`;
  if (p.isDeceased) return m ? `† ${m}` : "†";
  return "";
}
function nombreCorto(nombre) { return String(nombre || "").split(/\s+/)[0] || "esta persona"; }

function fotoGrande(nombre, foto, color) {
  const el = h("div", { class: "perfil-foto", style: `--rama:${color}` });
  const url = safeUrl(foto);
  if (url) el.append(h("img", { src: url, alt: `Foto de ${nombre}`, referrerpolicy: "no-referrer" }));
  else { el.setAttribute("role", "img"); el.setAttribute("aria-label", `Iniciales de ${nombre}`); el.textContent = initials(nombre); }
  return el;
}

function mensajeAmable(titulo, texto) {
  cajas.aviso.replaceChildren(h("div", { class: "card perfil-aviso", role: "status" },
    h("h1", { text: titulo }), h("p", { class: "muted", text: texto }),
    h("div", { class: "perfil-acciones" },
      h("a", { class: "primary", href: "/arbol/", text: "Ir al árbol" }),
      st.propio ? null : h("a", { class: "ghost", href: "/perfil/", text: "Ver mi perfil" }))));
  cajas.hero.hidden = true;
  columnas.hidden = true;
  document.title = "Perfil · Familia Padrón Perera";
}

// ---------------------------------------------------------------------------
// Pintar
// ---------------------------------------------------------------------------
function pintar() {
  if (!st.yo) return;
  cajas.aviso.replaceChildren();
  cajas.hero.hidden = false;
  columnas.hidden = false;
  if (st.tipo === "invalido") return mensajeAmable("Ese perfil no existe", "La dirección del perfil no es válida. Busca a la persona en el árbol de la familia.");
  const persona = st.personaId ? st.personas.get(st.personaId) : null;
  const esperandoPersona = st.personaId && !st.personasListas;
  const esperandoCuenta = st.tipo === "uid" && !st.cuentaLista;
  if (esperandoPersona || esperandoCuenta) {
    cajas.hero.replaceChildren(h("p", { class: "muted", text: "Cargando perfil…" }));
    columnas.hidden = true;
    return;
  }
  if (st.tipo === "persona" && !persona && st.propio) {
    // Mi ficha del árbol ya no existe (se borró o cambió): muestro mi perfil por cuenta, con aviso.
    st.unsubBusqueda?.(); st.unsubBusqueda = null;
    st.tipo = "uid"; st.personaId = null; st.fichaPerdida = true;
    seguirCuenta(st.yo.uid);
    return pintar();
  }
  if (st.tipo === "persona" && !persona) {
    return mensajeAmable("No encontramos a esa persona", "Puede que la ficha se haya borrado o que el enlace esté incompleto. Búscala en el árbol de la familia.");
  }
  if (st.tipo === "uid" && !st.cuenta) {
    return mensajeAmable("No encontramos ese perfil", "Esa cuenta no existe o todavía no ha entrado a la red. Busca a la persona en el árbol de la familia.");
  }
  const nombre = persona?.name || st.cuenta?.name || "Familiar";
  document.title = `${nombre} · Familia Padrón Perera`;
  pintarHero(persona, nombre);
  if (!st.editando) pintarSobre(persona, nombre);
  pintarFamilia(persona, nombre);
  pintarFotos();
  pintarPosts();
}

function pintarHero(persona, nombre) {
  const color = colorDe(persona);
  const rama = ramaDe(persona);
  const vida = [];
  if (persona) {
    const nac = fechaTexto(persona.birthDate);
    const e = edad(persona);
    if (nac || persona.birthPlace) {
      vida.push(h("li", {}, h("b", { text: esMujer(persona) ? "Nacida: " : "Nació: " }),
        [nac, persona.birthPlace ? `en ${persona.birthPlace}` : ""].filter(Boolean).join(" "), e !== null ? ` (${e} años)` : ""));
    }
    if (persona.isDeceased) {
      const muerte = fechaTexto(persona.deathDate);
      vida.push(h("li", {}, h("b", { text: "Falleció: " }),
        [muerte, persona.deathPlace ? `en ${persona.deathPlace}` : ""].filter(Boolean).join(" ") || "sin fecha registrada"));
    }
  }
  if (st.cuenta?.city) vida.push(h("li", {}, h("b", { text: "Vive en: " }), st.cuenta.city));

  const acciones = [];
  if (persona) acciones.push(h("a", { class: "ghost", href: `/arbol/?persona=${encodeURIComponent(persona.id)}`, text: "Ver en el árbol" }));
  if (st.cuenta && !esMio()) acciones.push(h("a", { class: "primary", href: `/mensajes/?con=${encodeURIComponent(st.cuenta.uid)}`, text: "Enviar mensaje" }));
  if (esMio()) acciones.push(h("button", { type: "button", class: "primary", text: "Editar «Sobre mí»", onclick: () => abrirEdicion() }));

  cajas.hero.style.setProperty("--rama", color);
  cajas.hero.replaceChildren(
    fotoGrande(nombre, st.cuenta?.photoURL, color),
    h("div", { class: "perfil-datos" },
      rama ? h("p", { class: "perfil-rama" }, h("span", { class: "punto-rama", "aria-hidden": "true" }), `Rama ${rama.shortLabel || rama.label || ""}`) : null,
      h("h1", { id: "perfilNombre", text: nombre }),
      esMio() ? h("p", { class: "perfil-chip", text: "Este es tu perfil" }) : null,
      persona?.isDeceased ? h("p", { class: "perfil-chip memoria", text: "En memoria" }) : null,
      vida.length ? h("ul", { class: "perfil-vida" }, vida) : null,
      acciones.length ? h("div", { class: "perfil-acciones" }, acciones) : null));
}

function pintarSobre(persona, nombre) {
  const titulo = h("h2", { id: "tSobre", text: esMio() ? "Sobre mí" : `Sobre ${nombreCorto(nombre)}` });
  const partes = [];
  if (st.cuenta?.bio) partes.push(h("p", { class: "bio", text: st.cuenta.bio }));
  if (esMio()) {
    if (!st.cuenta?.bio) partes.push(h("p", { class: "muted", text: "Cuéntale a la familia algo de ti: a qué te dedicas, dónde vives, qué te gusta." }));
    partes.push(h("button", { type: "button", class: "ghost", text: st.cuenta?.bio || st.cuenta?.city ? "Editar" : "Escribir mi presentación", onclick: () => abrirEdicion() }));
    if (!persona) partes.push(h("p", { class: "muted small", text: textoSinFicha() }));
  } else if (!st.cuenta) {
    partes.push(h("p", { class: "muted", text: persona?.isDeceased
      ? `${nombreCorto(nombre)} forma parte de la historia de la familia.`
      : `${nombreCorto(nombre)} todavía no tiene cuenta en la red de la familia.` }));
  } else if (!st.cuenta.bio) {
    partes.push(h("p", { class: "muted", text: `${nombreCorto(nombre)} aún no ha escrito su presentación.` }));
  }
  if (persona?.notes) partes.push(h("div", { class: "notas" }, h("h3", { text: "Notas del árbol" }), h("p", { text: persona.notes })));
  cajas.sobre.replaceChildren(titulo, ...partes);
}

function abrirEdicion() {
  if (!esMio()) return;
  st.editando = true;
  const bio = h("textarea", { id: "bioTexto", rows: "5", maxlength: String(MAX_BIO), placeholder: "Ej. Soy hija de… Vivo con mi familia en… Me encanta cocinar las recetas de la abuela." });
  bio.value = st.cuenta?.bio || "";
  const ciudad = h("input", { id: "bioCiudad", type: "text", maxlength: String(MAX_CIUDAD), placeholder: "Ej. Valencia, Venezuela", autocomplete: "address-level2" });
  ciudad.value = st.cuenta?.city || "";
  const contador = h("span", { class: "contador", "aria-live": "polite" });
  const actualizar = () => { contador.textContent = `${bio.value.length} de ${MAX_BIO} caracteres`; };
  bio.addEventListener("input", actualizar);
  actualizar();
  const estado = h("p", { class: "error", role: "alert", hidden: true });
  const guardar = h("button", { type: "submit", class: "primary small", text: "Guardar" });
  const form = h("form", { class: "form-sobre" },
    h("label", { class: "campo", for: "bioTexto" }, "Presentación corta", bio), contador,
    h("label", { class: "campo", for: "bioCiudad" }, "Ciudad donde vives", ciudad),
    estado,
    h("div", { class: "perfil-acciones" },
      guardar,
      h("button", { type: "button", class: "ghost", text: "Cancelar", onclick: () => { st.editando = false; pintar(); } })));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    guardar.disabled = true;
    estado.hidden = true;
    const yo = st.yo;
    const email = (yo.email || "").toLowerCase();
    try {
      await setDoc(doc(db, "profiles", yo.uid), {
        name: nombrePerfil(yo, email), photoURL: fotoPerfil(yo.photoURL), email,
        personId: st.member?.personId || null,
        bio: bio.value.trim().slice(0, MAX_BIO), city: ciudad.value.trim().slice(0, MAX_CIUDAD),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      st.editando = false;
      pintar();
    } catch (err) {
      console.warn(err);
      estado.textContent = "No se pudo guardar (" + (err.code || err.message) + "). Inténtalo de nuevo.";
      estado.hidden = false;
      guardar.disabled = false;
    }
  });
  cajas.sobre.replaceChildren(h("h2", { id: "tSobre", text: "Sobre mí" }), form);
  bio.focus();
}

function textoSinFicha() {
  if (st.isAdmin) return "Para vincular tu cuenta con tu ficha, agrega tu correo en el panel de invitados del muro y elige tu ficha del árbol.";
  if (st.fichaPerdida) return "Tu ficha del árbol ya no existe. Pídele a un administrador que te vuelva a vincular.";
  return "Tu cuenta aún no está vinculada a tu ficha del árbol. Pídele a un administrador que la vincule.";
}

function pintarFamilia(persona, nombre) {
  const titulo = h("h2", { id: "tFamilia", text: "Familia cercana" });
  if (!persona) {
    cajas.familia.replaceChildren(titulo, h("p", { class: "muted", text: esMio()
      ? `${textoSinFicha()} Entonces aquí verás a tus padres, hermanos e hijos.`
      : `La cuenta de ${nombreCorto(nombre)} todavía no está vinculada a una ficha del árbol.` }));
    return;
  }
  const P = st.personas;
  const porNacimiento = (a, b) => (anio(a.birthDate) || "9999").localeCompare(anio(b.birthDate) || "9999") || a.name.localeCompare(b.name, "es");
  const padres = [P.get(persona.fatherId), P.get(persona.motherId)].filter(Boolean)
    .map((p) => ({ p, rol: esMujer(p) ? "Madre" : "Padre" }));
  const parejas = (persona.spouses || []).map((s) => ({ s, p: P.get(s.id) })).filter((x) => x.p)
    .map(({ s, p }) => ({ p, rol: s.status === "divorced" ? "Divorciados" : s.status === "partner" ? "Pareja" : esMujer(p) ? "Esposa" : "Esposo" }));
  const hijos = [...P.values()].filter((p) => p.id !== persona.id && (p.fatherId === persona.id || p.motherId === persona.id))
    .sort(porNacimiento).map((p) => ({ p, rol: esMujer(p) ? "Hija" : "Hijo" }));
  const hermanos = [...P.values()].filter((p) => p.id !== persona.id
      && ((persona.fatherId && p.fatherId === persona.fatherId) || (persona.motherId && p.motherId === persona.motherId)))
    .sort(porNacimiento).map((p) => {
      const completos = p.fatherId === persona.fatherId && p.motherId === persona.motherId;
      return { p, rol: completos ? (esMujer(p) ? "Hermana" : "Hermano") : (esMujer(p) ? "Media hermana" : "Medio hermano") };
    });
  const grupo = (t, lista) => (lista.length ? h("div", { class: "familia-grupo" },
    h("h3", { text: t }),
    h("ul", { class: "familia-lista" }, lista.map(({ p, rol }) => h("li", {},
      h("a", { class: "familiar", href: enlacePersona(p.id) },
        h("span", { class: "ini", style: `--rama:${colorDe(p)}`, "aria-hidden": "true", text: initials(p.name) }),
        h("span", { class: "familiar-txt" }, h("b", { text: p.name }), h("span", { class: "det", text: [rol, aniosVida(p)].filter(Boolean).join(" · ") }))))))) : null);
  const grupos = [grupo("Padres", padres), grupo(parejas.length > 1 ? "Parejas" : "Pareja", parejas), grupo("Hijos", hijos), grupo("Hermanos", hermanos)].filter(Boolean);
  cajas.familia.replaceChildren(titulo, ...(grupos.length ? grupos : [h("p", { class: "muted", text: "Todavía no hay familiares cercanos registrados en el árbol." })]));
}

function pintarFotos() {
  if (!st.yo || st.tipo === "invalido") return;
  const persona = st.personaId ? st.personas.get(st.personaId) : null;
  if (!persona) { cajas.fotos.hidden = true; return; }
  cajas.fotos.hidden = false;
  const nombre = nombreCorto(persona.name);
  const href = `/fotos/?persona=${encodeURIComponent(persona.id)}`;
  const titulo = h("h2", { id: "tFotos", text: "Fotos donde aparece" });
  if (!st.todasFotos) { cajas.fotos.replaceChildren(titulo, h("p", { class: "muted", text: "Buscando fotos…" })); return; }
  const fotos = st.todasFotos.filter((f) => Array.isArray(f.tags) && f.tags.includes(persona.id) && safeUrl(f.url));
  if (!fotos.length) {
    cajas.fotos.replaceChildren(titulo, h("p", { class: "muted" },
      `Todavía no hay fotos etiquetadas con ${nombre}. Si tienes alguna, súbela en `, h("a", { href: "/fotos/", text: "Fotos" }), " y etiquétala."));
    return;
  }
  cajas.fotos.replaceChildren(titulo,
    h("div", { class: "perfil-fotos" }, fotos.slice(0, 9).map((f) => h("a", { href, title: f.caption || `Foto de ${nombre}` },
      h("img", { src: safeUrl(f.url), alt: f.caption || `Foto en la que aparece ${persona.name}`, loading: "lazy" })))),
    h("a", { class: "ghost ver-todas", href, text: fotos.length > 1 ? `Ver las ${fotos.length} fotos` : "Ver la foto" }));
}

function pintarPosts() {
  if (!st.yo || st.tipo === "invalido") return;
  if (!st.cuenta) { cajas.posts.hidden = true; return; }
  cajas.posts.hidden = false;
  const titulo = h("h2", { id: "tPosts", text: esMio() ? "Mis publicaciones" : "Publicaciones recientes" });
  if (!st.postsListos) { cajas.posts.replaceChildren(titulo, h("p", { class: "muted", text: "Cargando…" })); return; }
  if (!st.posts.length) {
    cajas.posts.replaceChildren(titulo, h("p", { class: "muted" }, esMio() ? "Aún no has publicado nada. " : "Aún no ha publicado nada en el muro. ",
      esMio() ? h("a", { href: "/muro/", text: "Comparte algo en el muro" }) : null));
    return;
  }
  cajas.posts.replaceChildren(titulo, ...st.posts.slice(0, 10).map((p) => {
    const img = safeUrl(p.imageURL);
    const enlace = p.group ? `/muro/?grupo=${encodeURIComponent(p.group)}` : "/muro/";
    const grupo = p.group ? st.ramas[p.group] : null;
    const likes = Array.isArray(p.likedBy) ? p.likedBy.length : 0;
    return h("article", { class: "mini-post" },
      h("div", { class: "pie" }, timeEl(p.createdAt), grupo ? h("span", { text: `en el grupo ${grupo.shortLabel || grupo.label}` }) : null,
        likes ? h("span", { text: `${likes} me gusta` }) : null),
      p.text ? h("p", { text: p.text.length > 400 ? p.text.slice(0, 400) + "…" : p.text }) : null,
      img ? h("img", { src: img, alt: "Foto de la publicación", loading: "lazy" }) : null,
      h("a", { class: "ver-muro", href: enlace, text: "Ver en el muro" }));
  }));
}
