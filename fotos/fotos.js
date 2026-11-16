// Álbumes de fotos de la familia: subir varias fotos, pies de foto y etiquetas con personas del árbol.
import {
  iniciarPagina, db, storage, h, $, timeEl, comprimirFoto, subirFoto, escucharPersonas, safeUrl,
  collection, doc, addDoc, updateDoc, deleteDoc, query, limit, onSnapshot, serverTimestamp, writeBatch,
} from "/comun/base.js";
import { collectionGroup } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { ref, deleteObject } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-storage.js";

const raiz = $("raiz");
const params = new URLSearchParams(location.search);
const st = { yo: null, isAdmin: false, albumes: [], fotos: [], personas: new Map(), album: params.get("album"), persona: params.get("persona") };

const dlg = h("dialog", { class: "dialogo", "aria-labelledby": "dlgTitulo" });
const visor = h("dialog", { class: "foto-grande", "aria-label": "Foto ampliada" });
document.body.append(dlg, visor);
visor.addEventListener("click", (e) => { if (e.target === visor) visor.close(); });
// Estado de la subida: vive fuera del repintado (cada foto nueva repinta el álbum).
const estadoSubida = h("span", { class: "muted small", role: "status" });

iniciarPagina({
  activa: "fotos",
  raiz,
  alEntrar: ({ user, isAdmin }) => {
    st.yo = user;
    st.isAdmin = isAdmin;
    const u1 = onSnapshot(query(collection(db, "albums"), limit(300)), (snap) => {
      st.albumes = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      pintar();
    }, (err) => console.error(err));
    const u2 = onSnapshot(query(collectionGroup(db, "photos"), limit(3000)), (snap) => {
      st.fotos = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
        .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
      pintar();
    }, (err) => console.error(err));
    const u3 = escucharPersonas((m) => { st.personas = m; pintar(); });
    return () => { u1(); u2(); u3(); };
  },
});

function ir(cambios) {
  Object.assign(st, cambios);
  estadoSubida.textContent = "";
  const p = new URLSearchParams(location.search);
  ["album", "persona"].forEach((k) => { if (st[k]) p.set(k, st[k]); else p.delete(k); });
  history.pushState(null, "", "?" + p.toString());
  pintar();
  window.scrollTo(0, 0);
}
window.addEventListener("popstate", () => {
  const p = new URLSearchParams(location.search);
  st.album = p.get("album"); st.persona = p.get("persona");
  pintar();
});

const fotosDe = (aid) => st.fotos.filter((f) => f.albumId === aid);
const nombrePersona = (id) => st.personas.get(id)?.name || "Familiar";

function pintar() {
  if (!st.yo) return;
  if (st.persona) return pintarPersona();
  if (st.album) return pintarAlbum();
  const tarjetas = st.albumes.map((a) => {
    const fs = fotosDe(a.id);
    const portada = safeUrl(fs[0]?.url);
    return h("a", { class: "album", href: `?album=${encodeURIComponent(a.id)}`, onclick: (e) => { e.preventDefault(); ir({ album: a.id, persona: null }); } },
      h("span", { class: "album-portada" }, portada ? h("img", { src: portada, alt: "", loading: "lazy" }) : h("span", { text: "Sin fotos todavía" })),
      h("b", { text: a.title }),
      h("span", { text: `${fs.length} ${fs.length === 1 ? "foto" : "fotos"} · creado por ${a.name.split(" ")[0]}` }));
  });
  const etiquetados = [...new Set(st.fotos.flatMap((f) => f.tags || []))].filter((id) => st.personas.has(id))
    .sort((a, b) => nombrePersona(a).localeCompare(nombrePersona(b), "es"));
  raiz.replaceChildren(
    h("div", { class: "pagina-cab" },
      h("div", {}, h("h1", { text: "Fotos de la familia" }), h("p", { text: "Álbumes por reunión, por rama o de fotos antiguas. Etiqueta a quien aparezca para que lo encuentren en el árbol." })),
      h("button", { type: "button", class: "primary", text: "+ Nuevo álbum", onclick: () => editarAlbum(null) })),
    tarjetas.length ? h("div", { class: "albumes" }, tarjetas) : h("div", { class: "card vacio", text: "Todavía no hay álbumes. Crea el primero, por ejemplo «Fotos históricas»." }),
    etiquetados.length ? h("section", { class: "card", "aria-labelledby": "tPersonas" },
      h("h2", { id: "tPersonas", text: "Buscar fotos de alguien" }),
      h("div", { class: "etiquetas" }, etiquetados.map((id) => h("a", { class: "etiqueta", href: `?persona=${encodeURIComponent(id)}`,
        onclick: (e) => { e.preventDefault(); ir({ persona: id, album: null }); } }, `${nombrePersona(id)} (${st.fotos.filter((f) => (f.tags || []).includes(id)).length})`)))) : ""); // "" y no null: replaceChildren escribiría «null»
}

function grillaFotos(fotos) {
  return h("div", { class: "fotos-grid" }, fotos.map((f) => h("figure", { class: "foto" },
    h("button", { type: "button", class: "ver", "aria-label": `Ver foto${f.caption ? ": " + f.caption : ""}`, onclick: () => verFoto(f) },
      h("img", { src: safeUrl(f.url) || "", alt: f.caption || "Foto de la familia", loading: "lazy" })),
    f.caption ? h("figcaption", { class: "pie", text: f.caption }) : null)));
}

function pintarAlbum() {
  const a = st.albumes.find((x) => x.id === st.album);
  if (!a) {
    raiz.replaceChildren(h("button", { type: "button", class: "ghost", text: "← Todos los álbumes", onclick: () => ir({ album: null }) }),
      h("div", { class: "card vacio", text: st.albumes.length ? "Ese álbum ya no existe." : "Cargando…" }));
    return;
  }
  const fotos = fotosDe(a.id);
  const puedeEditar = a.uid === st.yo.uid || st.isAdmin;
  const input = h("input", { type: "file", accept: "image/*", multiple: true, class: "sr-only", id: "subir" });
  const estado = estadoSubida; // el mismo elemento en cada repintado: así el «Listo…» no se pierde
  input.addEventListener("change", () => subirVarias([...input.files], a, estado).finally(() => { input.value = ""; }));
  raiz.replaceChildren(
    h("button", { type: "button", class: "ghost", style: "align-self:flex-start", text: "← Todos los álbumes", onclick: () => ir({ album: null }) }),
    h("div", { class: "pagina-cab" },
      h("div", {}, h("h1", { text: a.title }), h("p", { text: [a.description, `${fotos.length} fotos · creado por ${a.name}`].filter(Boolean).join(" · ") })),
      h("label", { class: "primary", for: "subir", tabindex: "0", text: "+ Agregar fotos",
        onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } } }), input,
      puedeEditar ? h("button", { type: "button", class: "ghost", text: "Editar álbum", onclick: () => editarAlbum(a) }) : null,
      puedeEditar ? h("button", { type: "button", class: "ghost", text: "Borrar álbum", onclick: () => borrarAlbum(a) }) : null),
    estado,
    fotos.length ? grillaFotos(fotos) : h("div", { class: "card vacio", text: "Este álbum está vacío. Pulsa «Agregar fotos»." }));
}

function pintarPersona() {
  const fotos = st.fotos.filter((f) => (f.tags || []).includes(st.persona));
  raiz.replaceChildren(
    h("button", { type: "button", class: "ghost", style: "align-self:flex-start", text: "← Todos los álbumes", onclick: () => ir({ persona: null }) }),
    h("div", { class: "pagina-cab" }, h("div", {}, h("h1", { text: `Fotos de ${nombrePersona(st.persona)}` }), h("p", { text: `${fotos.length} fotos en las que aparece` })),
      st.personas.has(st.persona) ? h("a", { class: "ghost", href: `/perfil/?persona=${encodeURIComponent(st.persona)}`, text: "Ver su perfil" }) : null),
    fotos.length ? grillaFotos(fotos) : h("div", { class: "card vacio", text: "Todavía no hay fotos etiquetadas de esta persona." }));
}

async function subirVarias(archivos, album, estado) {
  let ok = 0, motivo = "";
  for (const [i, file] of archivos.entries()) {
    estado.textContent = `Subiendo ${i + 1} de ${archivos.length}…`;
    try {
      const blob = await comprimirFoto(file);
      const { url, path } = await subirFoto(blob, "albums", st.yo.uid);
      await addDoc(collection(db, "albums", album.id, "photos"), {
        uid: st.yo.uid, name: (st.yo.displayName || st.yo.email).slice(0, 120), url, path, caption: "", tags: [], albumId: album.id, createdAt: serverTimestamp(),
      });
      ok++;
    } catch (err) {
      console.error(err);
      if (!motivo) motivo = `«${file.name}»: ${err.message || err.code || "error"}`;
    }
  }
  estado.textContent = ok === archivos.length ? `Listo: ${ok} ${ok === 1 ? "foto subida" : "fotos subidas"}. Ábrelas para ponerles pie y etiquetar a quien aparece.` : `Se subieron ${ok} de ${archivos.length}.${motivo ? " " + motivo : ""}`;
}

function verFoto(f) {
  const puedeEditar = f.uid === st.yo.uid || st.isAdmin;
  const personas = [...st.personas.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  const selector = h("select", { class: "entrada", "aria-label": "Etiquetar a una persona del árbol" },
    h("option", { value: "", text: "+ Etiquetar a alguien del árbol…" }),
    personas.filter((p) => !(f.tags || []).includes(p.id)).map((p) => h("option", { value: p.id, text: p.name })));
  selector.addEventListener("change", async () => {
    if (!selector.value) return;
    try { await updateDoc(doc(db, "albums", f.albumId, "photos", f.id), { tags: [...(f.tags || []), selector.value].slice(0, 30) }); visor.close(); }
    catch (err) { alert("No se pudo etiquetar: " + (err.code || err.message)); }
  });
  const pie = h("input", { type: "text", class: "entrada", maxlength: "500", value: f.caption || "", placeholder: "Pie de foto (quiénes, dónde, cuándo)", "aria-label": "Pie de foto" });
  visor.replaceChildren(
    h("img", { src: safeUrl(f.url) || "", alt: f.caption || "Foto de la familia" }),
    h("div", { class: "pie-grande" },
      f.caption ? h("div", { text: f.caption }) : null,
      (f.tags || []).length ? h("div", { class: "etiquetas", "aria-label": "Personas en la foto" }, (f.tags || []).map((id) => h("a", { class: "etiqueta",
        href: `/perfil/?persona=${encodeURIComponent(id)}`, title: `Ver el perfil de ${nombrePersona(id)}` }, nombrePersona(id)))) : null,
      h("div", { class: "tiempo", style: "color:#C9D3DC" }, `Subida por ${f.name} · `, timeEl(f.createdAt)),
      selector,
      puedeEditar ? h("form", { style: "display:flex;gap:8px", onsubmit: async (e) => {
        e.preventDefault();
        try { await updateDoc(doc(db, "albums", f.albumId, "photos", f.id), { caption: pie.value.trim().slice(0, 500) }); visor.close(); }
        catch (err) { alert("No se pudo guardar: " + (err.code || err.message)); }
      } }, pie, h("button", { type: "submit", class: "primary small", text: "Guardar" })) : null,
      h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" },
        h("button", { type: "button", class: "ghost", text: "Cerrar", onclick: () => visor.close() }),
        puedeEditar ? h("button", { type: "button", class: "ghost", text: "Borrar foto", onclick: async () => {
          if (!confirm("¿Borrar esta foto?")) return;
          try { await deleteDoc(doc(db, "albums", f.albumId, "photos", f.id)); if (f.path) deleteObject(ref(storage, f.path)).catch(() => {}); visor.close(); }
          catch (err) { alert("No se pudo borrar: " + (err.code || err.message)); }
        } }) : null)));
  visor.showModal();
}

function editarAlbum(a) {
  const titulo = h("input", { type: "text", required: true, maxlength: "120", value: a?.title || "", placeholder: "Ej. Fotos históricas" });
  const desc = h("textarea", { rows: "2", maxlength: "1000", placeholder: "De qué trata este álbum" });
  desc.value = a?.description || "";
  const form = h("form", {},
    h("h2", { id: "dlgTitulo", text: a ? "Editar álbum" : "Nuevo álbum" }),
    h("label", { class: "campo" }, "Nombre del álbum *", titulo),
    h("label", { class: "campo" }, "Descripción", desc),
    h("div", { class: "acciones" },
      h("button", { type: "button", class: "ghost", text: "Cancelar", onclick: () => dlg.close() }),
      h("button", { type: "submit", class: "primary small", text: a ? "Guardar" : "Crear álbum" })));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!titulo.value.trim()) { form.reportValidity(); return; }
    try {
      if (a) await updateDoc(doc(db, "albums", a.id), { title: titulo.value.trim().slice(0, 120), description: desc.value.trim().slice(0, 1000) });
      else {
        const r = await addDoc(collection(db, "albums"), { title: titulo.value.trim().slice(0, 120), description: desc.value.trim().slice(0, 1000), uid: st.yo.uid, name: (st.yo.displayName || st.yo.email).slice(0, 120), createdAt: serverTimestamp() });
        dlg.close();
        ir({ album: r.id });
        return;
      }
      dlg.close();
    } catch (err) { alert("No se pudo guardar: " + (err.code || err.message)); }
  });
  dlg.replaceChildren(form);
  dlg.showModal();
}

async function borrarAlbum(a) {
  const fotos = fotosDe(a.id);
  if (!confirm(`¿Borrar el álbum «${a.title}» y sus ${fotos.length} fotos?`)) return;
  try {
    const batch = writeBatch(db);
    fotos.forEach((f) => batch.delete(doc(db, "albums", a.id, "photos", f.id)));
    batch.delete(doc(db, "albums", a.id));
    await batch.commit();
    fotos.forEach((f) => f.path && deleteObject(ref(storage, f.path)).catch(() => {}));
    ir({ album: null });
  } catch (err) { alert("No se pudo borrar: " + (err.code || err.message)); }
}
