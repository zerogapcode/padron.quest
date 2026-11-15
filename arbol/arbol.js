// ============================================================================
// El árbol de los Padrón · padron.quest/arbol
// Firebase Auth (Google) + Firestore. Las reglas de Firestore imponen:
//   - solo miembros leen el árbol;
//   - solo administradores escriben `people` (directo o al aprobar);
//   - cualquier miembro crea `proposals`; solo administradores las deciden.
// Ningún dato familiar vive en este archivo (el repo es público).
// ============================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
  connectAuthEmulator, signInWithCredential,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, onSnapshot, query, where, limit, orderBy,
  writeBatch, serverTimestamp, addDoc, deleteDoc, setDoc, connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDkrGcwFUpxtImQdC0WWOgES5gfvGSjAsU",
  authDomain: "padron-quest.firebaseapp.com",
  projectId: "padron-quest",
  storageBucket: "padron-quest.firebasestorage.app",
  messagingSenderId: "570581063341",
  appId: "1:570581063341:web:c595054a2ff6b043349824",
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

// Pruebas locales: con ?emulador=1 en localhost se usan los emuladores de Firebase
// (no afecta al sitio publicado: allí la condición nunca se cumple).
if (new URLSearchParams(location.search).has("emulador") && ["localhost", "127.0.0.1"].includes(location.hostname)) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  // El emulador de Auth acepta credenciales de Google sin firmar: así se prueba sin ventana emergente.
  window.__entrarPrueba = (email, nombre) => signInWithCredential(auth, GoogleAuthProvider.credential(
    JSON.stringify({ sub: email, email, email_verified: true, name: nombre || email })));
  window.__db = { db, doc, setDoc, getDoc };
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
const state = {
  user: null,
  isAdmin: false,
  people: [],
  byId: new Map(),
  branches: {},
  generationsInfo: {},
  rootId: null,
  proposals: [],
  pendingByPerson: new Map(),
  proposalFilter: "pending",
  activeView: "tree",
  focusPersonId: null,
  selectedPersonId: null,
  treeLayoutMode: "descendants",
  searchQuery: "",
  activeBranch: "all",
  dirSort: "generation",
  dirStatus: "all",
  panX: 0,
  panY: 0,
  zoom: 0.8,
  nodePositions: new Map(),
  firstRenderDone: false,
};
const unsubs = [];

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
const safeUrl = (u) => (typeof u === "string" && /^https:\/\//.test(u) ? u : null);
const myEmail = () => (state.user?.email || "").toLowerCase();

function showToast(message) {
  const container = $("toastContainer");
  if (!container) return;
  const el = document.createElement("div");
  el.className = "toast-msg";
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

function getPerson(id) {
  if (!id) return null;
  return state.byId.get(id) || null;
}

function getInitials(name) {
  if (!name) return "?";
  const parts = name.replace(/["'()]/g, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getBranchInfo(branchId) {
  return state.branches[branchId] || { id: branchId || "", label: "Sin rama", shortLabel: "Sin rama", color: "#56636E" };
}

const genLabel = (g) => `Generación ${g ?? "?"}`;

function formatLifeSpan(p) {
  const b = p.birthDate || "";
  const d = p.deathDate || "";
  const vague = (x) => /^(fallecid[oa]|deceased)$/i.test(x);
  if (b && d) return vague(d) ? `* ${b} · †` : `${b} – ${d}`;
  if (b) return `* ${b}`;
  if (d) return vague(d) ? "† Fallecido/a" : `† ${d}`;
  return p.birthPlace || "Sin fecha registrada";
}

function avatarColor(p) {
  return p.gender === "Female" ? "var(--female-accent)" : p.gender === "Male" ? "var(--male-accent)" : "var(--unknown-accent)";
}
function avatarInner(p) {
  const url = safeUrl(p.photoURL);
  return url ? `<img src="${escapeHtml(url)}" alt="" referrerpolicy="no-referrer" />` : escapeHtml(getInitials(p.name));
}

function rebuildChildrenLinks() {
  state.byId = new Map();
  state.people.forEach((p) => {
    p.childrenIds = [];
    if (!Array.isArray(p.spouses)) p.spouses = [];
    state.byId.set(p.id, p);
  });
  state.people.forEach((p) => {
    [p.fatherId, p.motherId].forEach((pid) => {
      const parent = pid && state.byId.get(pid);
      if (parent && !parent.childrenIds.includes(p.id)) parent.childrenIds.push(p.id);
    });
  });
}

function getSiblings(person) {
  if (!person || (!person.fatherId && !person.motherId)) return [];
  return state.people.filter(
    (o) => o.id !== person.id &&
      ((person.fatherId && o.fatherId === person.fatherId) || (person.motherId && o.motherId === person.motherId))
  );
}

function matchesFilters(person) {
  if (state.activeBranch !== "all" && person.branch !== state.activeBranch) return false;
  const q = state.searchQuery.toLowerCase().trim();
  if (q) {
    const hay = [person.name, person.birthPlace, person.birthDate, person.deathPlace, person.deathDate, person.notes,
      getBranchInfo(person.branch).shortLabel].filter(Boolean).join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function cleanForFirestore(obj) {
  // Firestore no acepta `undefined`.
  const out = {};
  Object.entries(obj).forEach(([k, v]) => { out[k] = v === undefined ? null : v; });
  return out;
}

const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
function timeAgo(date) {
  if (!date) return "";
  const s = Math.round((date - Date.now()) / 1000);
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [u, sec] of units) if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), u);
  return "ahora";
}

// ---------------------------------------------------------------------------
// Acceso
// ---------------------------------------------------------------------------
function showGate(which) {
  $("gate").hidden = which === null;
  $("app").hidden = which !== null;
  ["gate-loading", "gate-login", "gate-denied", "gate-empty"].forEach((id) => { $(id).hidden = id !== which; });
}

$("btnLogin").addEventListener("click", async () => {
  $("loginError").hidden = true;
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
    $("loginError").textContent = "No se pudo entrar: " + (err.code || err.message);
    $("loginError").hidden = false;
  }
});
$("btnLogout").addEventListener("click", () => signOut(auth));
$("btnLogoutDenied").addEventListener("click", () => signOut(auth));
$("btnRetry").addEventListener("click", () => auth.currentUser && enter(auth.currentUser));

onAuthStateChanged(auth, (user) => {
  stopListeners();
  state.user = user;
  if (!user) { showGate("gate-login"); return; }
  enter(user);
});

function stopListeners() {
  while (unsubs.length) { try { unsubs.pop()(); } catch { /* nada */ } }
}

async function enter(user) {
  showGate("gate-loading");
  const email = (user.email || "").toLowerCase();
  state.isAdmin = false;
  try {
    await getDocs(query(collection(db, "members"), limit(1)));
    state.isAdmin = true; // solo los admins pueden listar miembros
  } catch { /* no es admin */ }
  let member = state.isAdmin;
  if (!member) {
    try { member = (await getDoc(doc(db, "members", email))).exists(); } catch { member = false; }
  }
  if (!member) {
    $("deniedEmail").textContent = email;
    showGate("gate-denied");
    return;
  }

  $("userName").textContent = user.displayName || email;
  const photo = safeUrl(user.photoURL);
  $("userPhoto").hidden = !photo;
  if (photo) $("userPhoto").src = photo;
  $("adminBadge").hidden = !state.isAdmin;
  $("btnOpenAdmin").hidden = !state.isAdmin;

  try {
    const cfg = await getDoc(doc(db, "config", "arbol"));
    const c = cfg.exists() ? cfg.data() : {};
    state.branches = c.branches || {};
    state.generationsInfo = c.generationsInfo || {};
    state.rootId = c.rootId || null;
  } catch (err) {
    console.error(err);
  }

  unsubs.push(onSnapshot(collection(db, "people"), (snap) => {
    state.people = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    rebuildChildrenLinks();
    if (state.people.length === 0) {
      $("emptyText").textContent = state.isAdmin
        ? "Todavía no se ha cargado el árbol. Impórtalo desde el archivo del árbol original."
        : "Todavía no se ha cargado el árbol. Un administrador de la familia lo hará muy pronto.";
      $("btnImportFromGate").hidden = !state.isAdmin;
      showGate("gate-empty");
      return;
    }
    showGate(null);
    if (!state.focusPersonId || !getPerson(state.focusPersonId)) state.focusPersonId = state.rootId && getPerson(state.rootId) ? state.rootId : state.people[0].id;
    if (!state.selectedPersonId || !getPerson(state.selectedPersonId)) state.selectedPersonId = state.focusPersonId;
    refreshAll();
    if (!state.firstRenderDone) {
      state.firstRenderDone = true;
      // En pantallas pequeñas la ficha tapa el árbol: empieza cerrada y se abre al tocar a alguien.
      if (window.matchMedia("(max-width: 900px)").matches) $("inspectorDrawer").classList.add("closed");
      // Arranca legible, centrado en la raíz; "Ver todo" muestra el árbol entero.
      setTimeout(() => {
        centerTreeOnPerson(state.focusPersonId, window.innerWidth < 760 ? 0.6 : 0.85);
        const pos = state.nodePositions.get(state.focusPersonId);
        if (pos) { state.panY = 32 - pos.topY * state.zoom; applyStageTransform(); }
      }, 40);
    }
  }, (err) => {
    console.error(err);
    showToast("No se pudo cargar el árbol (" + err.code + ").");
  }));

  const propQuery = state.isAdmin
    ? query(collection(db, "proposals"), orderBy("createdAt", "desc"), limit(300))
    : query(collection(db, "proposals"), where("uid", "==", user.uid), limit(300));
  unsubs.push(onSnapshot(propQuery, (snap) => {
    state.proposals = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    state.proposals.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    state.pendingByPerson = new Map();
    state.proposals.filter((p) => p.status === "pending").forEach((p) => {
      state.pendingByPerson.set(p.personId, (state.pendingByPerson.get(p.personId) || 0) + 1);
    });
    updateProposalsBadge();
    if (state.activeView === "proposals") renderProposalsView();
    if (state.people.length) { renderActiveView(); const sel = getPerson(state.selectedPersonId); if (sel) renderInspector(sel); }
  }, (err) => console.error("propuestas:", err)));
}

function refreshAll() {
  updateHeaderCounters();
  renderBranchPills();
  populateFocusSelect();
  renderQuickChips();
  renderActiveView();
  const sel = getPerson(state.selectedPersonId);
  if (sel) renderInspector(sel);
}

// ---------------------------------------------------------------------------
// Cabecera, filtros y selector
// ---------------------------------------------------------------------------
function updateHeaderCounters() {
  $("totalPeopleBadge").textContent = `${state.people.length} personas`;
  const unions = new Set();
  state.people.forEach((p) => (p.spouses || []).forEach((s) => unions.add([p.id, s.id].sort().join("_"))));
  $("totalUnionsBadge").textContent = `${unions.size} uniones`;
  const gens = new Set(state.people.map((p) => p.generation));
  $("totalGensBadge").textContent = `${gens.size} generaciones`;
}

function updateProposalsBadge() {
  const pending = state.proposals.filter((p) => p.status === "pending").length;
  $("proposalsCount").textContent = String(pending);
  $("proposalsCount").hidden = pending === 0;
}

function renderBranchPills() {
  const container = $("branchPillsContainer");
  const counts = { all: state.people.length };
  state.people.forEach((p) => { counts[p.branch] = (counts[p.branch] || 0) + 1; });
  let html = `<button type="button" class="branch-pill ${state.activeBranch === "all" ? "active" : ""}" data-branch="all">Todas (${counts.all})</button>`;
  Object.values(state.branches)
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .forEach((b) => {
      html += `<button type="button" class="branch-pill ${state.activeBranch === b.id ? "active" : ""}" data-branch="${escapeHtml(b.id)}" title="${escapeHtml(b.description || b.label)}">
        <span class="dot" style="background:${escapeHtml(b.color)}"></span>${escapeHtml(b.shortLabel)} (${counts[b.id] || 0})</button>`;
    });
  container.innerHTML = html;
  container.querySelectorAll(".branch-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeBranch = btn.getAttribute("data-branch");
      renderBranchPills();
      renderActiveView();
    });
  });
}

function sortedPeople() {
  return [...state.people].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function populateFocusSelect() {
  $("focusPersonSelect").innerHTML = sortedPeople()
    .map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === state.focusPersonId ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
    .join("");
  document.querySelectorAll("#quickFocusChips .focus-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.getAttribute("data-focus-id") === state.focusPersonId);
  });
}

function renderQuickChips() {
  const chips = [];
  if (state.rootId && getPerson(state.rootId)) chips.push({ id: state.rootId, label: "Toda la familia" });
  Object.values(state.branches)
    .filter((b) => b.anchorId && getPerson(b.anchorId))
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .forEach((b) => chips.push({ id: b.anchorId, label: b.shortLabel }));
  $("quickFocusChips").innerHTML = chips
    .map((c) => `<button type="button" class="focus-chip ${c.id === state.focusPersonId ? "active" : ""}" data-focus-id="${escapeHtml(c.id)}">${escapeHtml(c.label)}</button>`)
    .join("");
  $("quickFocusChips").querySelectorAll(".focus-chip").forEach((chip) => {
    chip.addEventListener("click", () => setFocusPerson(chip.getAttribute("data-focus-id")));
  });
}

// ---------------------------------------------------------------------------
// Vista 1: árbol
// ---------------------------------------------------------------------------
function collectTreeSubgraph(rootId, mode) {
  const root = getPerson(rootId) || state.people[0];
  if (!root) return { nodes: [] };
  const included = new Set();
  const addWithSpouses = (pid, withSpouses = true) => {
    const p = getPerson(pid);
    if (!p) return;
    included.add(p.id);
    if (withSpouses) (p.spouses || []).forEach((s) => { if (getPerson(s.id)) included.add(s.id); });
  };
  const collectAncestors = (pid, depth, withSiblings) => {
    const p = getPerson(pid);
    if (!p || depth > 9) return;
    addWithSpouses(p.id, depth <= 2);
    if (withSiblings && depth <= 2) {
      getSiblings(p).forEach((sib) => {
        addWithSpouses(sib.id, depth <= 1);
        if (depth <= 1) (sib.childrenIds || []).forEach((cid) => addWithSpouses(cid, depth === 0));
      });
    }
    if (p.fatherId) collectAncestors(p.fatherId, depth + 1, withSiblings);
    if (p.motherId) collectAncestors(p.motherId, depth + 1, withSiblings);
  };
  const collectDescendants = (pid, depth) => {
    const p = getPerson(pid);
    if (!p || depth > 9) return;
    addWithSpouses(p.id, true);
    (p.childrenIds || []).forEach((cid) => collectDescendants(cid, depth + 1));
  };
  if (mode === "ancestors") collectAncestors(root.id, 0, false);
  else if (mode === "descendants") collectDescendants(root.id, 0);
  else { collectAncestors(root.id, 0, true); collectDescendants(root.id, 0); }

  let nodes = Array.from(included).map(getPerson).filter(Boolean);
  if (state.activeBranch !== "all" || state.searchQuery.trim() !== "") {
    const filtered = state.people.filter(matchesFilters);
    if (filtered.length > 0) nodes = filtered;
  }
  return { nodes };
}

const CARD_W = 230;
const CARD_H = 104;

function renderTreeView() {
  const svg = $("treeSvg");
  const nodesLayer = $("treeNodesLayer");
  const { nodes } = collectTreeSubgraph(state.focusPersonId, state.treeLayoutMode);
  state.nodePositions.clear();

  const genBuckets = new Map();
  nodes.forEach((p) => {
    const g = Number(p.generation || 0);
    if (!genBuckets.has(g)) genBuckets.set(g, []);
    genBuckets.get(g).push(p);
  });
  const sortedGens = Array.from(genBuckets.keys()).sort((a, b) => a - b);
  const GAP_X = 34, COUPLE_GAP_X = 18, ROW_GAP_Y = 185;
  const nodeSet = new Set(nodes.map((n) => n.id));

  // Orden de cada fila: los hijos siguen el orden de sus padres en la fila anterior.
  const orderIndex = new Map();
  const orderedRows = new Map();
  sortedGens.forEach((gen) => {
    const rawRow = genBuckets.get(gen) || [];
    const parentKey = (p) => {
      const idx = [p.fatherId, p.motherId].map((id) => orderIndex.get(id)).filter((v) => v !== undefined);
      if (idx.length) return Math.min(...idx);
      const sp = (p.spouses || []).map((s) => getPerson(s.id)).find((s) => s && nodeSet.has(s.id));
      if (sp) {
        const sIdx = [sp.fatherId, sp.motherId].map((id) => orderIndex.get(id)).filter((v) => v !== undefined);
        if (sIdx.length) return Math.min(...sIdx) + 0.5;
      }
      return 1e9;
    };
    rawRow.sort((a, b) => parentKey(a) - parentKey(b) || (a.birthDate || "").localeCompare(b.birthDate || "") || a.name.localeCompare(b.name, "es"));
    const placed = new Set();
    const rowUnits = [];
    rawRow.forEach((person) => {
      if (placed.has(person.id)) return;
      const unit = [person];
      placed.add(person.id);
      (person.spouses || []).forEach((sp) => {
        const spObj = getPerson(sp.id);
        if (spObj && nodeSet.has(spObj.id) && !placed.has(spObj.id) && Number(spObj.generation || 0) === gen) {
          unit.push(spObj);
          placed.add(spObj.id);
        }
      });
      rowUnits.push(unit);
    });
    let i = 0;
    rowUnits.forEach((u) => u.forEach((p) => orderIndex.set(p.id, i++)));
    orderedRows.set(gen, rowUnits);
  });

  let maxRowWidth = 1400;
  const rowWidth = (units) => units.reduce((w, u, idx) => w + u.length * CARD_W + (u.length - 1) * COUPLE_GAP_X + (idx < units.length - 1 ? GAP_X : 0), 0);
  orderedRows.forEach((units) => { maxRowWidth = Math.max(maxRowWidth, rowWidth(units)); });
  const STAGE_PAD_X = 240, STAGE_PAD_Y = 120;
  const totalStageWidth = maxRowWidth + STAGE_PAD_X * 2;
  const totalStageHeight = Math.max(1200, sortedGens.length * ROW_GAP_Y + STAGE_PAD_Y * 2);
  svg.setAttribute("width", String(totalStageWidth));
  svg.setAttribute("height", String(totalStageHeight));

  sortedGens.forEach((gen, rowIdx) => {
    const units = orderedRows.get(gen) || [];
    let curX = (totalStageWidth - rowWidth(units)) / 2;
    const curY = STAGE_PAD_Y + rowIdx * ROW_GAP_Y;
    units.forEach((u) => {
      u.forEach((person, i) => {
        state.nodePositions.set(person.id, { x: curX, y: curY, cx: curX + CARD_W / 2, cy: curY + CARD_H / 2, topY: curY, bottomY: curY + CARD_H, person });
        curX += CARD_W + (i < u.length - 1 ? COUPLE_GAP_X : 0);
      });
      curX += GAP_X;
    });
  });

  let cardsHtml = "";
  state.nodePositions.forEach((pos) => {
    const p = pos.person;
    const branch = getBranchInfo(p.branch);
    const pending = state.pendingByPerson.get(p.id);
    cardsHtml += `
      <article class="tree-node-card ${p.id === state.focusPersonId ? "is-focus-root" : ""} ${p.id === state.selectedPersonId ? "is-selected" : ""}"
               style="left:${pos.x}px;top:${pos.y}px;border-left-color:${escapeHtml(branch.color)};" data-person-id="${escapeHtml(p.id)}">
        ${pending ? `<span class="pending-flag">Cambio pendiente</span>` : ""}
        <div class="node-card-top">
          <div class="avatar-circle" style="background:${avatarColor(p)};">${avatarInner(p)}</div>
          <div class="node-title-wrap">
            <div class="node-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
            <div class="node-rel-badge" style="color:${escapeHtml(branch.color)};">${escapeHtml(branch.shortLabel)}</div>
          </div>
        </div>
        <div class="node-meta-row">
          <span class="node-dates" title="${escapeHtml(formatLifeSpan(p))}">${escapeHtml(formatLifeSpan(p))}</span>
          <div class="node-quick-actions">
            <button type="button" class="node-mini-btn" data-action="focus" data-id="${escapeHtml(p.id)}">Centrar</button>
            <button type="button" class="node-mini-btn" data-action="add-child" data-id="${escapeHtml(p.id)}">+Hijo</button>
          </div>
        </div>
      </article>`;
  });
  nodesLayer.innerHTML = cardsHtml;
  nodesLayer.querySelectorAll(".tree-node-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      const actionBtn = e.target.closest("[data-action]");
      const pid = card.getAttribute("data-person-id");
      if (actionBtn) {
        e.stopPropagation();
        if (actionBtn.getAttribute("data-action") === "focus") setFocusPerson(pid);
        else openAddRelativeModal(pid, "child");
        return;
      }
      selectPerson(pid);
    });
  });

  let svgPaths = "";
  const drawnPairs = new Set();
  state.nodePositions.forEach((pos) => {
    const p = pos.person;
    (p.spouses || []).forEach((sp) => {
      const spPos = state.nodePositions.get(sp.id);
      if (!spPos) return;
      const key = [p.id, sp.id].sort().join("_");
      if (drawnPairs.has(key)) return;
      drawnPairs.add(key);
      const L = pos.x < spPos.x ? pos : spPos;
      const R = pos.x < spPos.x ? spPos : pos;
      const divorced = sp.status === "divorced";
      if (Math.abs(L.cy - R.cy) < 2) {
        svgPaths += `<path d="M ${L.x + CARD_W} ${L.cy} L ${R.x} ${R.cy}" stroke="${divorced ? "var(--connector-line)" : "var(--connector-highlight)"}" stroke-width="2.5" fill="none" ${divorced ? 'stroke-dasharray="5,4"' : ""} />`;
      }
    });
    const fPos = p.fatherId ? state.nodePositions.get(p.fatherId) : null;
    const mPos = p.motherId ? state.nodePositions.get(p.motherId) : null;
    if (fPos || mPos) {
      let startX, startY;
      if (fPos && mPos && Math.abs(fPos.y - mPos.y) < 10) { startX = (fPos.cx + mPos.cx) / 2; startY = Math.max(fPos.bottomY, mPos.bottomY); }
      else if (fPos) { startX = fPos.cx; startY = fPos.bottomY; }
      else { startX = mPos.cx; startY = mPos.bottomY; }
      const endX = pos.cx, endY = pos.topY, midY = startY + (endY - startY) * 0.52;
      const hl = p.id === state.focusPersonId || p.id === state.selectedPersonId;
      svgPaths += `<path d="M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}" stroke="${hl ? "var(--connector-highlight)" : "var(--connector-line)"}" stroke-width="${hl ? 2.4 : 1.65}" fill="none" opacity="0.9" />`;
    }
  });
  svg.innerHTML = svgPaths;
}

function centerTreeOnPerson(personId, customZoom) {
  const viewport = $("treeViewport");
  const pos = state.nodePositions.get(personId) || state.nodePositions.get(state.focusPersonId) || state.nodePositions.values().next().value;
  if (!pos) return;
  if (typeof customZoom === "number") state.zoom = customZoom;
  const vw = viewport.clientWidth || 1000, vh = viewport.clientHeight || 700;
  state.panX = vw / 2 - pos.cx * state.zoom;
  state.panY = vh / 2 - pos.cy * state.zoom;
  applyStageTransform();
}

function fitTreeToViewport() {
  const viewport = $("treeViewport");
  if (state.nodePositions.size === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  state.nodePositions.forEach((pos) => {
    minX = Math.min(minX, pos.x); minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + CARD_W); maxY = Math.max(maxY, pos.y + CARD_H);
  });
  const contentW = Math.max(400, maxX - minX + 120), contentH = Math.max(300, maxY - minY + 120);
  const vw = viewport.clientWidth || 1000, vh = viewport.clientHeight || 700;
  state.zoom = Math.max(0.2, Number(Math.min(vw / contentW, vh / contentH, 1.05).toFixed(2)));
  state.panX = vw / 2 - ((minX + maxX) / 2) * state.zoom;
  state.panY = vh / 2 - ((minY + maxY) / 2) * state.zoom;
  applyStageTransform();
}

function applyStageTransform() {
  $("treeStage").style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  $("zoomReadout").textContent = `${Math.round(state.zoom * 100)}%`;
}

function zoomAt(newZoom, px, py) {
  newZoom = Math.min(1.8, Math.max(0.2, newZoom));
  state.panX = px - ((px - state.panX) / state.zoom) * newZoom;
  state.panY = py - ((py - state.panY) / state.zoom) * newZoom;
  state.zoom = newZoom;
  applyStageTransform();
}

// Arrastre con ratón o dedo, y pellizco para acercar en el teléfono.
function setupCanvasInteractions() {
  const viewport = $("treeViewport");
  const pointers = new Map();
  let drag = null;
  let pinch = null;

  viewport.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".canvas-hud") || (e.pointerType === "mouse" && e.target.closest(".tree-node-card"))) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      drag = { startX: e.clientX - state.panX, startY: e.clientY - state.panY, moved: false, ox: e.clientX, oy: e.clientY };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: state.zoom };
      drag = null;
    }
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const rect = viewport.getBoundingClientRect();
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt(pinch.zoom * (dist / pinch.dist), (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      return;
    }
    if (drag) {
      if (!drag.moved && Math.hypot(e.clientX - drag.ox, e.clientY - drag.oy) > 6) {
        drag.moved = true;
        viewport.classList.add("dragging");
        try { viewport.setPointerCapture(e.pointerId); } catch { /* nada */ }
      }
      if (drag.moved) {
        state.panX = e.clientX - drag.startX;
        state.panY = e.clientY - drag.startY;
        applyStageTransform();
      }
    }
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      if (drag?.moved) {
        // Evita que el "click" final de un arrastre abra una ficha.
        viewport.addEventListener("click", (ev) => ev.stopPropagation(), { capture: true, once: true });
      }
      drag = null;
      viewport.classList.remove("dragging");
    }
  };
  viewport.addEventListener("pointerup", end);
  viewport.addEventListener("pointercancel", end);

  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    zoomAt(Number((state.zoom * (e.deltaY < 0 ? 1.09 : 0.91)).toFixed(2)), e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  $("btnZoomIn").addEventListener("click", () => { const v = $("treeViewport"); zoomAt(state.zoom + 0.12, v.clientWidth / 2, v.clientHeight / 2); });
  $("btnZoomOut").addEventListener("click", () => { const v = $("treeViewport"); zoomAt(state.zoom - 0.12, v.clientWidth / 2, v.clientHeight / 2); });
  $("btnCenterTree").addEventListener("click", () => centerTreeOnPerson(state.selectedPersonId || state.focusPersonId, 0.9));
  $("btnFitTree").addEventListener("click", fitTreeToViewport);
}

// ---------------------------------------------------------------------------
// Vista 2: generaciones
// ---------------------------------------------------------------------------
function renderPersonGridCard(p) {
  const branch = getBranchInfo(p.branch);
  const father = getPerson(p.fatherId), mother = getPerson(p.motherId);
  const parentsLabel = father || mother ? `Padres: ${[father?.name, mother?.name].filter(Boolean).join(" y ")}` : "Padres no registrados";
  const pending = state.pendingByPerson.get(p.id);
  return `
    <article class="person-grid-card" style="border-left-color:${escapeHtml(branch.color)};" data-person-id="${escapeHtml(p.id)}">
      <div class="node-card-top">
        <div class="avatar-circle" style="background:${avatarColor(p)};">${avatarInner(p)}</div>
        <div class="node-title-wrap">
          <div class="node-name">${escapeHtml(p.name)}</div>
          <div class="node-rel-badge" style="color:${escapeHtml(branch.color)};">${escapeHtml(branch.shortLabel)}</div>
        </div>
      </div>
      <div style="font-size:0.8rem;color:var(--text-secondary);">
        <div><strong>Fechas:</strong> ${escapeHtml(formatLifeSpan(p))}</div>
        ${p.birthPlace ? `<div><strong>Lugar:</strong> ${escapeHtml(p.birthPlace)}</div>` : ""}
        <div style="font-size:0.75rem;margin-top:0.15rem;">${escapeHtml(parentsLabel)}</div>
        ${pending ? `<div style="margin-top:.35rem"><span class="pending-flag">Cambio pendiente</span></div>` : ""}
      </div>
      <div class="person-card-footer">
        <span>${(p.childrenIds || []).length} hijos · ${(p.spouses || []).length} uniones</span>
        <div class="node-quick-actions">
          <button type="button" class="node-mini-btn" data-action="focus-tree" data-id="${escapeHtml(p.id)}">Ver en árbol</button>
          <button type="button" class="node-mini-btn" data-action="add-child" data-id="${escapeHtml(p.id)}">+Hijo/a</button>
          <button type="button" class="node-mini-btn" data-action="edit" data-id="${escapeHtml(p.id)}">${state.isAdmin ? "Editar" : "Proponer cambio"}</button>
        </div>
      </div>
    </article>`;
}

function bindPersonCardEvents(rootEl) {
  rootEl.querySelectorAll("[data-person-id]").forEach((card) => {
    card.addEventListener("click", (e) => {
      const pid = card.getAttribute("data-person-id");
      const actBtn = e.target.closest("[data-action]");
      if (actBtn) {
        e.stopPropagation();
        const act = actBtn.getAttribute("data-action");
        const targetId = actBtn.getAttribute("data-id") || pid;
        if (act === "focus-tree") { switchView("tree"); setFocusPerson(targetId); }
        else if (act === "add-child") openAddRelativeModal(targetId, "child");
        else if (act === "edit") openEditPersonModal(targetId);
        return;
      }
      selectPerson(pid);
    });
  });
}

function renderGenerationsView() {
  const container = $("generationsContainer");
  const byGen = new Map();
  state.people.filter(matchesFilters).forEach((p) => {
    const g = String(p.generation ?? 0);
    if (!byGen.has(g)) byGen.set(g, []);
    byGen.get(g).push(p);
  });
  const genKeys = Array.from(byGen.keys()).sort((a, b) => Number(a) - Number(b));
  if (genKeys.length === 0) {
    container.innerHTML = `<div class="empty-state">No se encontraron personas con esos filtros.</div>`;
    return;
  }
  container.innerHTML = genKeys.map((gk) => {
    const list = byGen.get(gk);
    list.sort((a, b) => (a.branch || "").localeCompare(b.branch || "") || a.name.localeCompare(b.name, "es"));
    const info = state.generationsInfo[gk] || { title: genLabel(gk), subtitle: "" };
    return `
      <section class="generation-section" data-gen="${escapeHtml(gk)}">
        <header class="generation-header">
          <div class="generation-header-left">
            <span class="gen-badge">${escapeHtml(gk)}</span>
            <div><h3>${escapeHtml(info.title)}</h3><p>${escapeHtml(info.subtitle || "")}</p></div>
          </div>
          <span class="stat-pill">${list.length} personas</span>
        </header>
        <div class="generation-grid">${list.map(renderPersonGridCard).join("")}</div>
      </section>`;
  }).join("");
  container.querySelectorAll(".generation-header").forEach((hdr) => {
    hdr.addEventListener("click", () => hdr.closest(".generation-section").classList.toggle("collapsed"));
  });
  bindPersonCardEvents(container);
}

// ---------------------------------------------------------------------------
// Vista 3: familias (parejas e hijos)
// ---------------------------------------------------------------------------
function renderNucleiView() {
  const container = $("nucleiContainer");
  const nucleiMap = new Map();
  state.people.forEach((p) => {
    (p.spouses || []).forEach((s) => {
      const sp = getPerson(s.id);
      if (!sp) return;
      const key = [p.id, sp.id].sort().join("_");
      if (nucleiMap.has(key)) return;
      const p1 = p.gender === "Male" ? p : sp.gender === "Male" ? sp : p;
      const p2 = p1.id === p.id ? sp : p;
      const children = state.people.filter((c) => (c.fatherId === p1.id && c.motherId === p2.id) || (c.fatherId === p2.id && c.motherId === p1.id));
      nucleiMap.set(key, { p1, p2, status: s.status || "married", details: s.details || "", children,
        generation: Math.min(p1.generation ?? 0, p2.generation ?? 0), branch: p1.branch || p2.branch });
    });
  });
  let list = Array.from(nucleiMap.values());
  if (state.activeBranch !== "all" || state.searchQuery.trim() !== "") {
    list = list.filter((n) => matchesFilters(n.p1) || matchesFilters(n.p2) || n.children.some(matchesFilters));
  }
  list.sort((a, b) => a.generation - b.generation || a.p1.name.localeCompare(b.p1.name, "es"));
  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state">No hay familias que coincidan con la búsqueda.</div>`;
    return;
  }
  container.innerHTML = list.map((n) => {
    const branch = getBranchInfo(n.branch);
    const statusBadge = n.status === "divorced" ? "Ex-pareja" : n.status === "partner" ? "Pareja" : "Matrimonio";
    return `
      <article class="nucleus-card" style="border-top-color:${escapeHtml(branch.color)};">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;flex-wrap:wrap;">
          <span class="stat-pill" style="color:${escapeHtml(branch.color)};">${escapeHtml(branch.shortLabel)} · ${genLabel(n.generation)}</span>
          <button type="button" class="node-mini-btn" data-nucleus-add-child="${escapeHtml(n.p1.id)}|${escapeHtml(n.p2.id)}">+ Agregar hijo/a</button>
        </div>
        <div class="nucleus-parents">
          <div class="nucleus-spouse-box" data-person-id="${escapeHtml(n.p1.id)}">
            <span class="nucleus-spouse-name">${escapeHtml(n.p1.name)}</span>
            <span class="nucleus-spouse-meta">${escapeHtml(formatLifeSpan(n.p1))}</span>
          </div>
          <span class="nucleus-union-symbol">${statusBadge}</span>
          <div class="nucleus-spouse-box" data-person-id="${escapeHtml(n.p2.id)}">
            <span class="nucleus-spouse-name">${escapeHtml(n.p2.name)}</span>
            <span class="nucleus-spouse-meta">${escapeHtml(formatLifeSpan(n.p2))}</span>
          </div>
        </div>
        ${n.details ? `<div style="font-size:0.8rem;color:var(--text-secondary);">${escapeHtml(n.details)}</div>` : ""}
        <div class="nucleus-children-list">
          <div style="font-size:0.75rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Hijos (${n.children.length})</div>
          ${n.children.length === 0
            ? `<div style="font-size:0.8rem;color:var(--text-muted);font-style:italic;">Sin hijos registrados</div>`
            : n.children.map((c) => `
              <div class="nucleus-child-row" data-person-id="${escapeHtml(c.id)}">
                <span style="font-weight:600;">${escapeHtml(c.name)}</span>
                <span style="font-size:0.75rem;color:var(--text-secondary);">${escapeHtml(formatLifeSpan(c))}</span>
              </div>`).join("")}
        </div>
      </article>`;
  }).join("");
  container.querySelectorAll("[data-person-id]").forEach((el) => {
    el.addEventListener("click", () => selectPerson(el.getAttribute("data-person-id")));
  });
  container.querySelectorAll("[data-nucleus-add-child]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const [id1, id2] = btn.getAttribute("data-nucleus-add-child").split("|");
      openAddChildForCoupleModal(id1, id2);
    });
  });
}

// ---------------------------------------------------------------------------
// Vista 4: directorio
// ---------------------------------------------------------------------------
function renderDirectoryView() {
  const tbody = $("directoryTableBody");
  let list = state.people.filter(matchesFilters);
  if (state.dirStatus === "living") list = list.filter((p) => !p.isDeceased);
  else if (state.dirStatus === "deceased") list = list.filter((p) => p.isDeceased);
  const byName = (a, b) => a.name.localeCompare(b.name, "es");
  if (state.dirSort === "name") list.sort(byName);
  else if (state.dirSort === "branch") list.sort((a, b) => (a.branch || "").localeCompare(b.branch || "") || byName(a, b));
  else if (state.dirSort === "generation_desc") list.sort((a, b) => (b.generation ?? 0) - (a.generation ?? 0) || byName(a, b));
  else list.sort((a, b) => (a.generation ?? 0) - (b.generation ?? 0) || byName(a, b));
  $("directoryCountLabel").textContent = `Mostrando ${list.length} de ${state.people.length} personas`;
  tbody.innerHTML = list.map((p) => {
    const branch = getBranchInfo(p.branch);
    const birthInfo = [p.birthDate, p.birthPlace].filter(Boolean).join(" · ") || "—";
    const deathInfo = p.isDeceased ? [p.deathDate || "Fallecido/a", p.deathPlace].filter(Boolean).join(" · ") : "Con vida";
    return `
      <tr data-person-id="${escapeHtml(p.id)}">
        <td><div style="font-weight:700;color:var(--text-primary);">${escapeHtml(p.name)}</div>
          ${state.pendingByPerson.get(p.id) ? `<span class="pending-flag">Cambio pendiente</span>` : ""}</td>
        <td><span class="stat-pill" style="border-color:${escapeHtml(branch.color)};color:${escapeHtml(branch.color)};">${escapeHtml(branch.shortLabel)}</span></td>
        <td>${escapeHtml(String(p.generation ?? "—"))}</td>
        <td>${escapeHtml(birthInfo)}</td>
        <td>${escapeHtml(deathInfo)}</td>
        <td><div class="node-quick-actions">
          <button type="button" class="node-mini-btn" data-action="focus-tree" data-id="${escapeHtml(p.id)}">Ver árbol</button>
          <button type="button" class="node-mini-btn" data-action="add-child" data-id="${escapeHtml(p.id)}">+Hijo/a</button>
          <button type="button" class="node-mini-btn" data-action="edit" data-id="${escapeHtml(p.id)}">${state.isAdmin ? "Editar" : "Proponer"}</button>
        </div></td>
      </tr>`;
  }).join("");
  bindPersonCardEvents(tbody);
}

// ---------------------------------------------------------------------------
// Vista 5: propuestas
// ---------------------------------------------------------------------------
const FIELD_LABELS = {
  name: "Nombre", gender: "Sexo", branch: "Rama", generation: "Generación", isDeceased: "Estado",
  birthDate: "Nacimiento", birthPlace: "Lugar de nacimiento", deathDate: "Defunción", deathPlace: "Lugar de defunción",
  fatherId: "Padre", motherId: "Madre", notes: "Notas", _spouse: "Pareja", _parentOf: "Es padre o madre de",
};

function formatFieldValue(key, value) {
  if (value === null || value === undefined || value === "") return "—";
  if (key === "gender") return value === "Male" ? "Masculino" : value === "Female" ? "Femenino" : "No especificado";
  if (key === "isDeceased") return value ? "Fallecido/a" : "Con vida";
  if (key === "branch") return getBranchInfo(value).shortLabel;
  if (key === "fatherId" || key === "motherId") return getPerson(value)?.name || "(persona nueva)";
  if (key === "_spouse") {
    const kind = value.status === "divorced" ? "ex-pareja" : value.status === "partner" ? "pareja" : "matrimonio";
    return `${getPerson(value.id)?.name || "(persona nueva)"} (${kind})`;
  }
  if (key === "_parentOf") return `${getPerson(value.targetId)?.name || "?"} (${value.role === "mother" ? "madre" : "padre"})`;
  return String(value);
}

function renderProposalsView() {
  const container = $("proposalsContainer");
  $("proposalsIntro").textContent = state.isAdmin
    ? "Revisa lo que propone la familia. Nada cambia en el árbol hasta que lo apruebes."
    : "Tus propuestas de cambio y su estado. Un administrador las revisa antes de publicarlas.";
  const list = state.proposals.filter((p) => state.proposalFilter === "all" || p.status === state.proposalFilter);
  if (list.length === 0) {
    const msg = state.proposalFilter === "pending"
      ? (state.isAdmin ? "No hay propuestas pendientes. ¡Todo al día!" : "No tienes propuestas pendientes. Para proponer un cambio, abre la ficha de una persona.")
      : "No hay propuestas en esta lista.";
    container.innerHTML = `<div class="empty-state">${escapeHtml(msg)}</div>`;
    return;
  }
  container.innerHTML = list.map((pr) => {
    const after = pr.after || {};
    const before = pr.before || {};
    const keys = Object.keys(after).filter((k) => k in FIELD_LABELS);
    const created = pr.createdAt?.toDate ? pr.createdAt.toDate() : null;
    const statusText = pr.status === "pending" ? "Pendiente" : pr.status === "approved" ? "Aprobada" : "Rechazada";
    const mine = pr.uid === state.user?.uid;
    return `
      <article class="proposal-card" data-proposal-id="${escapeHtml(pr.id)}">
        <div class="proposal-head">
          <span class="proposal-kind ${pr.kind === "add" ? "add" : ""}">${pr.kind === "add" ? "Nueva persona" : "Cambio de datos"}</span>
          <h3>${escapeHtml(pr.personName || after.name || "")}</h3>
          <span class="proposal-status ${escapeHtml(pr.status)}">${statusText}</span>
        </div>
        <div class="proposal-meta">Propuesta por ${escapeHtml(pr.name || pr.email)}${created ? " · " + escapeHtml(timeAgo(created)) : ""}</div>
        <table class="diff-table">
          <thead><tr><th>Dato</th>${pr.kind === "add" ? "" : "<th>Hoy en el árbol</th>"}<th>Propuesto</th></tr></thead>
          <tbody>
            ${keys.map((k) => `<tr><td>${escapeHtml(FIELD_LABELS[k])}</td>${pr.kind === "add" ? "" : `<td class="before">${escapeHtml(formatFieldValue(k, before[k]))}</td>`}<td class="after">${escapeHtml(formatFieldValue(k, after[k]))}</td></tr>`).join("")}
          </tbody>
        </table>
        ${pr.note ? `<p class="proposal-note"><strong>Fuente o comentario:</strong> ${escapeHtml(pr.note)}</p>` : ""}
        ${pr.status !== "pending" && (pr.decisionNote || pr.decidedBy) ? `<p class="proposal-note"><strong>${pr.status === "approved" ? "Aprobada" : "Rechazada"}${pr.decidedBy ? " por " + escapeHtml(pr.decidedBy) : ""}.</strong> ${escapeHtml(pr.decisionNote || "")}</p>` : ""}
        ${pr.status === "pending" && state.isAdmin ? `
          <div class="proposal-actions">
            <label class="sr-only" for="dn-${escapeHtml(pr.id)}">Nota para quien la propuso</label>
            <textarea id="dn-${escapeHtml(pr.id)}" data-decision-note placeholder="Nota para quien la propuso (opcional)"></textarea>
            <button type="button" class="btn btn-primary" data-approve>Aprobar y publicar</button>
            <button type="button" class="btn" data-reject>Rechazar</button>
          </div>` : ""}
        ${pr.status === "pending" && mine && !state.isAdmin ? `<div class="proposal-actions"><button type="button" class="btn btn-sm" data-withdraw>Retirar mi propuesta</button></div>` : ""}
        ${pr.personId && getPerson(pr.personId) ? `<div><button type="button" class="node-mini-btn" data-goto="${escapeHtml(pr.personId)}">Ver ficha</button></div>` : ""}
      </article>`;
  }).join("");

  container.querySelectorAll(".proposal-card").forEach((card) => {
    const pr = state.proposals.find((p) => p.id === card.getAttribute("data-proposal-id"));
    const note = () => card.querySelector("[data-decision-note]")?.value.trim() || "";
    card.querySelector("[data-approve]")?.addEventListener("click", (e) => decideProposal(pr, "approved", note(), e.currentTarget));
    card.querySelector("[data-reject]")?.addEventListener("click", (e) => decideProposal(pr, "rejected", note(), e.currentTarget));
    card.querySelector("[data-withdraw]")?.addEventListener("click", async () => {
      if (!confirm("¿Retirar esta propuesta?")) return;
      try { await deleteDoc(doc(db, "proposals", pr.id)); showToast("Propuesta retirada."); }
      catch (err) { showToast("No se pudo retirar: " + (err.code || err.message)); }
    });
    card.querySelector("[data-goto]")?.addEventListener("click", (e) => {
      const id = e.currentTarget.getAttribute("data-goto");
      switchView("tree");
      setFocusPerson(id);
    });
  });
}

// ---------------------------------------------------------------------------
// Escritura: aplicar cambios (admins), proponer (miembros), decidir
// ---------------------------------------------------------------------------
function applyChangeToBatch(batch, kind, personId, after) {
  const data = { ...after };
  const spouseLink = data._spouse;
  const parentLink = data._parentOf;
  delete data._spouse;
  delete data._parentOf;
  const existing = getPerson(personId);
  const stamp = { updatedAt: serverTimestamp(), updatedBy: myEmail() };

  if (spouseLink && spouseLink.id && spouseLink.id !== personId) {
    const mySpouses = (existing?.spouses || []).filter((s) => s.id !== spouseLink.id);
    mySpouses.push({ id: spouseLink.id, status: spouseLink.status || "married", details: "" });
    data.spouses = mySpouses;
    const other = getPerson(spouseLink.id);
    if (other) {
      const otherSpouses = (other.spouses || []).filter((s) => s.id !== personId);
      otherSpouses.push({ id: personId, status: spouseLink.status || "married", details: "" });
      batch.update(doc(db, "people", other.id), { spouses: otherSpouses, ...stamp });
    }
  } else if (kind === "add" && !data.spouses) {
    data.spouses = [];
  }
  if (parentLink && parentLink.targetId && getPerson(parentLink.targetId)) {
    batch.update(doc(db, "people", parentLink.targetId), { [parentLink.role === "mother" ? "motherId" : "fatherId"]: personId, ...stamp });
  }
  batch.set(doc(db, "people", personId), cleanForFirestore({ ...data, ...stamp }), { merge: true });
}

function historyEntry(batch, entry) {
  batch.set(doc(collection(db, "history")), cleanForFirestore({ ...entry, by: myEmail(), at: serverTimestamp() }));
}

async function decideProposal(pr, status, decisionNote, button) {
  if (!pr || !state.isAdmin) return;
  if (status === "approved" && pr.kind === "edit" && !getPerson(pr.personId)) {
    showToast("Esa persona ya no está en el árbol; no se puede aplicar.");
    return;
  }
  if (button) button.disabled = true;
  try {
    const batch = writeBatch(db);
    if (status === "approved") {
      applyChangeToBatch(batch, pr.kind, pr.personId, pr.after || {});
    }
    batch.update(doc(db, "proposals", pr.id), {
      status, decidedBy: myEmail(), decidedAt: serverTimestamp(), decisionNote: decisionNote || "",
    });
    historyEntry(batch, {
      kind: status === "approved" ? "proposal-approved" : "proposal-rejected",
      proposalId: pr.id, personId: pr.personId, personName: pr.personName || "",
      proposedBy: pr.email, before: pr.before || {}, after: pr.after || {}, note: decisionNote || "",
    });
    await batch.commit();
    showToast(status === "approved" ? `Aprobado: ${pr.personName}` : `Rechazado: ${pr.personName}`);
  } catch (err) {
    console.error(err);
    showToast("No se pudo guardar la decisión: " + (err.code || err.message));
    if (button) button.disabled = false;
  }
}

async function adminDeletePerson(p) {
  if (!state.isAdmin || !p) return;
  if (!confirm(`¿Eliminar a ${p.name} del árbol? Sus hijos y parejas quedarán sin ese vínculo.`)) return;
  try {
    const batch = writeBatch(db);
    const stamp = { updatedAt: serverTimestamp(), updatedBy: myEmail() };
    state.people.forEach((o) => {
      const upd = {};
      if (o.fatherId === p.id) upd.fatherId = null;
      if (o.motherId === p.id) upd.motherId = null;
      if ((o.spouses || []).some((s) => s.id === p.id)) upd.spouses = o.spouses.filter((s) => s.id !== p.id);
      if (Object.keys(upd).length) batch.update(doc(db, "people", o.id), { ...upd, ...stamp });
    });
    batch.delete(doc(db, "people", p.id));
    historyEntry(batch, { kind: "delete", personId: p.id, personName: p.name, before: { name: p.name }, after: {} });
    await batch.commit();
    state.selectedPersonId = state.focusPersonId === p.id ? state.rootId : state.selectedPersonId;
    if (state.focusPersonId === p.id) state.focusPersonId = state.rootId;
    showToast(`Eliminado: ${p.name}`);
  } catch (err) {
    showToast("No se pudo eliminar: " + (err.code || err.message));
  }
}

// ---------------------------------------------------------------------------
// Ficha (inspector)
// ---------------------------------------------------------------------------
function selectPerson(personId) {
  const p = getPerson(personId);
  if (!p) return;
  state.selectedPersonId = p.id;
  document.querySelectorAll(".tree-node-card").forEach((c) => c.classList.toggle("is-selected", c.getAttribute("data-person-id") === p.id));
  $("inspectorDrawer").classList.remove("closed");
  renderInspector(p);
}

function setFocusPerson(personId) {
  const p = getPerson(personId);
  if (!p) return;
  state.focusPersonId = p.id;
  state.selectedPersonId = p.id;
  populateFocusSelect();
  renderTreeView();
  centerTreeOnPerson(p.id);
  renderInspector(p);
}

function relItem(person, role) {
  return `<div class="rel-link-item" data-jump-id="${escapeHtml(person.id)}" role="button" tabindex="0">
    <div><div class="rel-link-name">${escapeHtml(person.name)}</div><div class="rel-link-role">${escapeHtml(role)}</div></div><span aria-hidden="true">&rarr;</span></div>`;
}

function renderInspector(p) {
  const header = $("inspectorHeader");
  const body = $("inspectorBody");
  const branch = getBranchInfo(p.branch);
  header.innerHTML = `
    <div class="inspector-profile-top">
      <div class="inspector-avatar" style="background:${avatarColor(p)};">${avatarInner(p)}</div>
      <div>
        <span class="stat-pill" style="color:${escapeHtml(branch.color)};border-color:${escapeHtml(branch.color)};margin-bottom:0.25rem;">${escapeHtml(branch.shortLabel)} · ${genLabel(p.generation)}</span>
        <h2 style="margin:0;font-family:var(--font-serif);font-weight:600;font-size:1.2rem;line-height:1.25;">${escapeHtml(p.name)}</h2>
      </div>
    </div>
    <button type="button" class="btn btn-icon btn-sm" id="btnCloseInspector" aria-label="Cerrar ficha">&times;</button>`;

  const father = getPerson(p.fatherId), mother = getPerson(p.motherId);
  const siblings = getSiblings(p);
  const children = (p.childrenIds || []).map(getPerson).filter(Boolean);
  const spouses = (p.spouses || []).map((s) => ({ ...s, person: getPerson(s.id) })).filter((s) => s.person);
  const pending = state.pendingByPerson.get(p.id);

  body.innerHTML = `
    <div style="display:flex;gap:0.45rem;flex-wrap:wrap;">
      <button type="button" class="btn btn-primary btn-sm" id="inspBtnFocusTree" style="flex:1;">Ver en el árbol</button>
      <button type="button" class="btn btn-sm" id="inspBtnEditPerson">${state.isAdmin ? "Editar" : "Proponer un cambio"}</button>
    </div>
    ${pending ? `<div class="context-link-banner" style="margin:0;">Hay ${pending} cambio(s) pendiente(s) de aprobación para esta ficha.</div>` : ""}
    <div>
      <h3 class="inspector-section-title">Agregar familiar</h3>
      <div class="add-rel-grid">
        <button type="button" class="btn btn-soft btn-sm" data-add-rel="child">+ Hijo/a</button>
        <button type="button" class="btn btn-soft btn-sm" data-add-rel="spouse">+ Pareja</button>
        <button type="button" class="btn btn-soft btn-sm" data-add-rel="parent">+ Padre/Madre</button>
        <button type="button" class="btn btn-soft btn-sm" data-add-rel="sibling">+ Hermano/a</button>
      </div>
    </div>
    <div>
      <h3 class="inspector-section-title">Datos</h3>
      <div style="background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:10px;padding:0.75rem;font-size:0.88rem;display:flex;flex-direction:column;gap:0.4rem;">
        <div><strong>Nacimiento:</strong> ${escapeHtml(p.birthDate || "Sin fecha")}${p.birthPlace ? ` · ${escapeHtml(p.birthPlace)}` : ""}</div>
        <div><strong>Estado:</strong> ${p.isDeceased ? `${escapeHtml(p.deathDate || "Fallecido/a")}${p.deathPlace ? ` · ${escapeHtml(p.deathPlace)}` : ""}` : "Con vida"}</div>
        <div><strong>Rama:</strong> ${escapeHtml(branch.label)}</div>
        ${p.notes ? `<div><strong>Notas:</strong> ${escapeHtml(p.notes)}</div>` : ""}
      </div>
    </div>
    <div>
      <h3 class="inspector-section-title">Padres (${[father, mother].filter(Boolean).length})</h3>
      ${!father && !mother ? `<div style="font-size:0.85rem;color:var(--text-muted);">Sin padres registrados.</div>` : ""}
      ${father ? relItem(father, "Padre · " + formatLifeSpan(father)) : ""}
      ${mother ? relItem(mother, "Madre · " + formatLifeSpan(mother)) : ""}
    </div>
    <div>
      <h3 class="inspector-section-title">Parejas (${spouses.length})</h3>
      ${spouses.length === 0 ? `<div style="font-size:0.85rem;color:var(--text-muted);">Sin pareja registrada.</div>` : spouses.map((s) => relItem(s.person, (s.status === "divorced" ? "Ex-pareja" : s.status === "partner" ? "Pareja" : "Cónyuge") + (s.details ? " · " + s.details : ""))).join("")}
    </div>
    <div>
      <h3 class="inspector-section-title">Hijos (${children.length})</h3>
      ${children.length === 0 ? `<div style="font-size:0.85rem;color:var(--text-muted);">Sin hijos registrados.</div>` : children.map((c) => relItem(c, "Hijo/a · " + formatLifeSpan(c))).join("")}
    </div>
    <div>
      <h3 class="inspector-section-title">Hermanos (${siblings.length})</h3>
      ${siblings.length === 0 ? `<div style="font-size:0.85rem;color:var(--text-muted);">Sin hermanos registrados.</div>` : siblings.map((s) => relItem(s, "Hermano/a · " + formatLifeSpan(s))).join("")}
    </div>
    ${state.isAdmin ? `<div><button type="button" class="btn btn-sm" id="inspBtnDelete">Eliminar del árbol</button></div>` : ""}`;

  $("btnCloseInspector").addEventListener("click", () => $("inspectorDrawer").classList.add("closed"));
  $("inspBtnFocusTree").addEventListener("click", () => { switchView("tree"); setFocusPerson(p.id); });
  $("inspBtnEditPerson").addEventListener("click", () => openEditPersonModal(p.id));
  $("inspBtnDelete")?.addEventListener("click", () => adminDeletePerson(p));
  body.querySelectorAll("[data-add-rel]").forEach((btn) => btn.addEventListener("click", () => openAddRelativeModal(p.id, btn.getAttribute("data-add-rel"))));
  body.querySelectorAll("[data-jump-id]").forEach((item) => {
    const go = () => {
      const jumpId = item.getAttribute("data-jump-id");
      selectPerson(jumpId);
      if (state.activeView === "tree") {
        if (!state.nodePositions.has(jumpId)) setFocusPerson(jumpId);
        else centerTreeOnPerson(jumpId);
      }
    };
    item.addEventListener("click", go);
    item.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
}

// ---------------------------------------------------------------------------
// Formulario de persona
// ---------------------------------------------------------------------------
function populateFormSelects() {
  $("formBranch").innerHTML = Object.values(state.branches)
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.label)}</option>`).join("");
  const gens = state.people.map((p) => p.generation || 0);
  const minG = Math.min(1, ...gens) - 1, maxG = Math.max(1, ...gens) + 2;
  let genOpts = "";
  for (let g = Math.max(1, minG); g <= maxG; g++) {
    const info = state.generationsInfo[String(g)];
    genOpts += `<option value="${g}">${escapeHtml(info?.title || genLabel(g))}</option>`;
  }
  $("formGeneration").innerHTML = genOpts;
  const opts = (empty) => `<option value="">${empty}</option>` + sortedPeople().map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
  $("formFatherId").innerHTML = opts("— Sin asignar —");
  $("formMotherId").innerHTML = opts("— Sin asignar —");
  $("formSpouseId").innerHTML = opts("— Sin pareja —");
}

function resetPersonForm() {
  $("personForm").reset();
  $("formPersonId").value = "";
  $("formLinkMode").value = "";
  $("formTargetPersonId").value = "";
  const banner = $("relationContextBanner");
  banner.style.display = "none";
  banner.textContent = "";
  populateFormSelects();
  $("approvalBanner").hidden = state.isAdmin;
  $("btnSavePerson").textContent = state.isAdmin ? "Guardar en el árbol" : "Enviar propuesta";
  $("sourceField").querySelector("label").textContent = state.isAdmin
    ? "Nota para el historial (opcional)"
    : "¿De dónde sale este dato? (para quien lo revise)";
}

function setBanner(text) {
  const banner = $("relationContextBanner");
  banner.style.display = "block";
  banner.textContent = text;
}

function openAddPersonStandaloneModal() {
  resetPersonForm();
  $("personDialogTitle").textContent = "Agregar un familiar";
  const anchor = getPerson(state.selectedPersonId);
  if (anchor) { $("formBranch").value = anchor.branch; $("formGeneration").value = String(anchor.generation ?? 1); }
  $("personDialog").showModal();
}

function openAddChildForCoupleModal(id1, id2) {
  resetPersonForm();
  const p1 = getPerson(id1), p2 = getPerson(id2);
  $("personDialogTitle").textContent = "Agregar hijo/a a esta familia";
  if (p1 && p2) setBanner(`Se conectará como hijo/a de ${p1.name} y ${p2.name}.`);
  const father = p1?.gender === "Male" ? p1 : p2?.gender === "Male" ? p2 : p1;
  const mother = father?.id === p1?.id ? p2 : p1;
  if (father) $("formFatherId").value = father.id;
  if (mother) $("formMotherId").value = mother.id;
  const blood = [p1, p2].find((x) => x && (x.fatherId || x.motherId)) || p1;
  if (blood) { $("formBranch").value = blood.branch; $("formGeneration").value = String((blood.generation ?? 1) + 1); }
  $("personDialog").showModal();
}

function openAddRelativeModal(targetId, relType) {
  const target = getPerson(targetId);
  if (!target) return;
  resetPersonForm();
  $("formLinkMode").value = relType;
  $("formTargetPersonId").value = target.id;
  $("formBranch").value = target.branch;
  if (relType === "child") {
    $("personDialogTitle").textContent = `Agregar hijo/a de ${target.name}`;
    setBanner(`Se conectará como hijo/a de ${target.name}.`);
    $("formGeneration").value = String((target.generation ?? 1) + 1);
    const partner = target.spouses?.[0]?.id || "";
    if (target.gender === "Male") { $("formFatherId").value = target.id; $("formMotherId").value = partner; }
    else { $("formMotherId").value = target.id; $("formFatherId").value = partner; }
  } else if (relType === "spouse") {
    $("personDialogTitle").textContent = `Agregar pareja de ${target.name}`;
    setBanner(`Se conectará como pareja de ${target.name}.`);
    $("formGeneration").value = String(target.generation ?? 1);
    $("formSpouseId").value = target.id;
    $("formGender").value = target.gender === "Male" ? "Female" : "Male";
  } else if (relType === "parent") {
    $("personDialogTitle").textContent = `Agregar padre o madre de ${target.name}`;
    setBanner(`Se conectará como padre o madre de ${target.name}.`);
    $("formGeneration").value = String(Math.max(1, (target.generation ?? 1) - 1));
    if (target.fatherId && !target.motherId) { $("formGender").value = "Female"; $("formSpouseId").value = target.fatherId; }
    else if (!target.fatherId && target.motherId) { $("formGender").value = "Male"; $("formSpouseId").value = target.motherId; }
  } else if (relType === "sibling") {
    $("personDialogTitle").textContent = `Agregar hermano/a de ${target.name}`;
    setBanner(`Tendrá los mismos padres que ${target.name}.`);
    $("formGeneration").value = String(target.generation ?? 1);
    if (target.fatherId) $("formFatherId").value = target.fatherId;
    if (target.motherId) $("formMotherId").value = target.motherId;
  }
  $("personDialog").showModal();
}

function openEditPersonModal(personId) {
  const p = getPerson(personId);
  if (!p) return;
  resetPersonForm();
  $("personDialogTitle").textContent = state.isAdmin ? `Editar: ${p.name}` : `Proponer un cambio: ${p.name}`;
  $("formPersonId").value = p.id;
  $("formName").value = p.name || "";
  $("formGender").value = p.gender || "Unknown";
  $("formBranch").value = p.branch || "";
  $("formGeneration").value = String(p.generation ?? 1);
  $("formBirthDate").value = p.birthDate || "";
  $("formBirthPlace").value = p.birthPlace || "";
  $("formIsDeceased").value = p.isDeceased ? "true" : "false";
  $("formDeathDate").value = p.deathDate || "";
  $("formDeathPlace").value = p.deathPlace || "";
  $("formFatherId").value = p.fatherId || "";
  $("formMotherId").value = p.motherId || "";
  if (p.spouses?.length) {
    $("formSpouseId").value = p.spouses[0].id || "";
    $("formSpouseStatus").value = p.spouses[0].status || "married";
  }
  $("formNotes").value = p.notes || "";
  $("personDialog").showModal();
}

const EDITABLE = ["name", "gender", "branch", "generation", "isDeceased", "birthDate", "birthPlace", "deathDate", "deathPlace", "fatherId", "motherId", "notes"];

function newPersonId() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return "p_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function handlePersonFormSubmit(e) {
  e.preventDefault();
  const nameInput = $("formName");
  if (!nameInput.checkValidity() || nameInput.value.trim().length < 2) { nameInput.reportValidity(); return; }

  const existingId = $("formPersonId").value.trim();
  const linkMode = $("formLinkMode").value;
  const targetId = $("formTargetPersonId").value;
  const deathDate = $("formDeathDate").value.trim();
  const values = {
    name: nameInput.value.trim(),
    gender: $("formGender").value,
    branch: $("formBranch").value,
    generation: Number($("formGeneration").value || 1),
    isDeceased: $("formIsDeceased").value === "true" || Boolean(deathDate),
    birthDate: $("formBirthDate").value.trim(),
    birthPlace: $("formBirthPlace").value.trim(),
    deathDate,
    deathPlace: $("formDeathPlace").value.trim(),
    fatherId: $("formFatherId").value || null,
    motherId: $("formMotherId").value || null,
    notes: $("formNotes").value.trim(),
  };
  const spouseId = $("formSpouseId").value || null;
  const spouseStatus = $("formSpouseStatus").value || "married";
  const note = $("formSource").value.trim();

  let kind, personId, before = {}, after = {};
  if (existingId) {
    const p = getPerson(existingId);
    if (!p) return;
    kind = "edit";
    personId = existingId;
    EDITABLE.forEach((k) => {
      const oldV = p[k] ?? (typeof values[k] === "string" ? "" : null);
      if (JSON.stringify(oldV) !== JSON.stringify(values[k])) { before[k] = p[k] ?? null; after[k] = values[k]; }
    });
    const currentSpouse = (p.spouses || []).find((s) => s.id === spouseId);
    if (spouseId && (!currentSpouse || currentSpouse.status !== spouseStatus)) {
      after._spouse = { id: spouseId, status: spouseStatus };
      before._spouse = currentSpouse ? { id: currentSpouse.id, status: currentSpouse.status } : null;
    }
    if (Object.keys(after).length === 0) { showToast("No cambiaste ningún dato."); return; }
  } else {
    kind = "add";
    personId = newPersonId();
    after = { ...values, photoURL: null };
    if (spouseId) after._spouse = { id: spouseId, status: spouseStatus };
    if (linkMode === "parent" && targetId) after._parentOf = { targetId, role: values.gender === "Female" ? "mother" : "father" };
  }

  const btn = $("btnSavePerson");
  btn.disabled = true;
  try {
    if (state.isAdmin) {
      const batch = writeBatch(db);
      applyChangeToBatch(batch, kind, personId, after);
      historyEntry(batch, { kind: kind === "add" ? "add" : "edit", personId, personName: values.name, before, after, note });
      await batch.commit();
      showToast(kind === "add" ? `Agregado: ${values.name}` : `Guardado: ${values.name}`);
      state.selectedPersonId = personId;
    } else {
      await addDoc(collection(db, "proposals"), {
        uid: state.user.uid,
        email: myEmail(),
        name: (state.user.displayName || myEmail()).slice(0, 120),
        kind,
        personId,
        personName: values.name.slice(0, 200),
        before,
        after,
        note,
        status: "pending",
        createdAt: serverTimestamp(),
      });
      showToast("¡Gracias! Tu propuesta quedó pendiente de aprobación.");
    }
    $("personDialog").close();
  } catch (err) {
    console.error(err);
    showToast("No se pudo enviar: " + (err.code || err.message));
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Importación del árbol (solo admins): filtra la línea Padrón
// ---------------------------------------------------------------------------
const BRANCH_COLORS = ["#1F5673", "#8A5A1E", "#4E7A62", "#7A4F86", "#B0654F", "#3C6E8F", "#6E7F3A", "#A0526B", "#5A6B7A", "#9C7A2E", "#2F6B6B", "#80603A"];

function parseTreeFile(text, fileName) {
  if (/\.json$/i.test(fileName)) {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : parsed.people;
  }
  // data.js del árbol original: define window.INITIAL_FAMILY_DATA. Se evalúa con un
  // "window" falso; es un archivo que el propio administrador elige de su disco.
  const fakeWindow = {};
  new Function("window", text)(fakeWindow);
  return fakeWindow.INITIAL_FAMILY_DATA?.people;
}

function extractPadronLine(all) {
  const by = new Map(all.map((p) => [String(p.id), p]));
  const kids = new Map();
  all.forEach((p) => {
    [p.fatherId, p.motherId].forEach((pid) => {
      const k = pid != null ? String(pid) : null;
      if (k && by.has(k)) { if (!kids.has(k)) kids.set(k, []); if (!kids.get(k).includes(String(p.id))) kids.get(k).push(String(p.id)); }
    });
  });
  const descOf = (id) => { const s = new Set(); (function walk(x) { if (s.has(x)) return; s.add(x); (kids.get(x) || []).forEach(walk); })(id); return s; };

  const isPadron = (p) => /padr[oó]n/i.test(p.name || "");
  const candidates = all.filter((p) => isPadron(p) && !p.fatherId && !p.motherId);
  if (!candidates.length) throw new Error("No encontré a ningún Padrón sin padres registrados para usar como raíz.");
  const root = candidates.map((p) => ({ p, n: descOf(String(p.id)).size })).sort((a, b) => b.n - a.n)[0].p;
  const rootId = String(root.id);
  const desc = descOf(rootId);
  const spouses = new Set();
  desc.forEach((id) => (by.get(id).spouses || []).forEach((s) => { const sid = String(s.id); if (by.has(sid) && !desc.has(sid)) spouses.add(sid); }));
  const keep = new Set([...desc, ...spouses]);
  const rootGen = Number(root.generation ?? 0);
  const newGen = (p) => Number(p.generation ?? rootGen) - rootGen + 1;

  // Ramas: se baja por la línea única hasta el primer padre con varios hijos con descendencia;
  // cada hijo es una rama, y si una rama es muy grande se divide por nietos.
  const hasDesc = (id) => (kids.get(id) || []).length > 0;
  const branchOf = new Map();
  const branches = {};
  let order = 0;
  const raiz = { id: "raiz", label: "Raíces de la familia", shortLabel: "Raíces", color: "#13293D", description: "Los primeros Padrón y sus hermanos", order: order++ };
  branches.raiz = raiz;
  let cursor = rootId;
  const raizIds = new Set();
  for (;;) {
    raizIds.add(cursor);
    const ch = kids.get(cursor) || [];
    ch.filter((c) => !hasDesc(c)).forEach((c) => raizIds.add(c));
    const withDesc = ch.filter(hasDesc);
    if (withDesc.length === 1) { cursor = withDesc[0]; continue; }
    const surnamesFrom = (anchorId) => {
      const firstChild = (kids.get(anchorId) || []).map((id) => by.get(id)).find(Boolean);
      const words = (firstChild?.name || "").replace(/["'()]/g, " ").trim().split(/\s+/);
      return words.length >= 3 ? words.slice(-2).join(" ") : (by.get(anchorId).name || "").split(/\s+/)[0];
    };
    const addBranch = (anchorId) => {
      const key = "b_" + anchorId.replace(/[^A-Za-z0-9_]/g, "");
      const anchor = by.get(anchorId);
      branches[key] = {
        id: key, anchorId, label: `Rama de ${anchor.name}`, shortLabel: surnamesFrom(anchorId),
        description: `${anchor.name} y su descendencia`, color: BRANCH_COLORS[(order - 1) % BRANCH_COLORS.length], order: order++,
      };
      descOf(anchorId).forEach((id) => branchOf.set(id, key));
    };
    withDesc.forEach((c) => {
      if (descOf(c).size > 30) {
        raizIds.add(c);
        (kids.get(c) || []).forEach((gc) => addBranch(gc));
      } else {
        addBranch(c);
      }
    });
    break;
  }
  raizIds.forEach((id) => { if (!branchOf.has(id)) branchOf.set(id, "raiz"); });
  // Parejas: la rama de su pareja Padrón.
  spouses.forEach((sid) => {
    const partner = (by.get(sid).spouses || []).map((s) => String(s.id)).find((x) => desc.has(x));
    branchOf.set(sid, branchOf.get(partner) || "raiz");
  });

  const people = [...keep].map((id) => {
    const p = by.get(id);
    const fid = p.fatherId != null ? String(p.fatherId) : null;
    const mid = p.motherId != null ? String(p.motherId) : null;
    return {
      id,
      name: String(p.name || "").trim(),
      gender: ["Male", "Female"].includes(p.gender) ? p.gender : "Unknown",
      birthDate: p.birthDate || "",
      birthPlace: p.birthPlace || "",
      deathDate: p.deathDate || "",
      deathPlace: p.deathPlace || "",
      isDeceased: Boolean(p.isDeceased),
      photoURL: null,
      fatherId: fid && keep.has(fid) ? fid : null,
      motherId: mid && keep.has(mid) ? mid : null,
      spouses: (p.spouses || []).filter((s) => keep.has(String(s.id))).map((s) => ({ id: String(s.id), status: s.status || "married", details: s.details || "" })),
      generation: newGen(p),
      branch: branchOf.get(id) || "raiz",
      notes: p.notes || "",
    };
  });

  const generationsInfo = {};
  [...new Set(people.map((p) => p.generation))].sort((a, b) => a - b).forEach((g) => {
    const names = people.filter((p) => p.generation === g && desc.has(p.id)).map((p) => p.name);
    generationsInfo[String(g)] = {
      title: genLabel(g),
      subtitle: names.slice(0, 3).join(" · ") + (names.length > 3 ? ` y ${names.length - 3} más` : ""),
    };
  });
  return { people, config: { rootId, branches, generationsInfo } };
}

async function importTree(file) {
  const status = $("importStatus");
  const say = (t) => { status.textContent = t; };
  try {
    say("Leyendo archivo…");
    const all = parseTreeFile(await file.text(), file.name);
    if (!Array.isArray(all) || all.length === 0) throw new Error("El archivo no contiene una lista de personas.");
    const { people, config } = extractPadronLine(all);
    if (!confirm(`Se cargarán ${people.length} personas de la línea Padrón (de ${all.length} en el archivo) y reemplazarán el árbol actual. ¿Continuar?`)) { say(""); return; }
    say("Guardando en Firebase…");
    const keepIds = new Set(people.map((p) => p.id));
    const ops = [];
    state.people.filter((p) => !keepIds.has(p.id)).forEach((p) => ops.push((b) => b.delete(doc(db, "people", p.id))));
    people.forEach((p) => {
      const { id, ...data } = p;
      ops.push((b) => b.set(doc(db, "people", id), { ...data, updatedAt: serverTimestamp(), updatedBy: myEmail() }));
    });
    ops.push((b) => b.set(doc(db, "config", "arbol"), { ...config, updatedAt: serverTimestamp(), updatedBy: myEmail() }));
    ops.push((b) => historyEntry(b, { kind: "import", personId: "", personName: "", before: {}, after: { count: people.length }, note: file.name }));
    for (let i = 0; i < ops.length; i += 400) {
      const batch = writeBatch(db);
      ops.slice(i, i + 400).forEach((op) => op(batch));
      await batch.commit();
    }
    state.branches = config.branches;
    state.generationsInfo = config.generationsInfo;
    state.rootId = config.rootId;
    state.focusPersonId = config.rootId;
    state.selectedPersonId = config.rootId;
    state.firstRenderDone = false;
    say(`Listo: ${people.length} personas cargadas.`);
    showToast(`Árbol importado: ${people.length} personas.`);
  } catch (err) {
    console.error(err);
    say("No se pudo importar: " + (err.code || err.message));
  }
}

// ---------------------------------------------------------------------------
// Navegación y arranque de la interfaz
// ---------------------------------------------------------------------------
function switchView(viewName) {
  state.activeView = viewName;
  document.querySelectorAll(".view-tab").forEach((t) => t.classList.toggle("active", t.getAttribute("data-view") === viewName));
  document.querySelectorAll(".view-container").forEach((c) => c.classList.toggle("active", c.id === `view-${viewName}`));
  renderActiveView();
}

function renderActiveView() {
  if (!state.people.length) return;
  if (state.activeView === "tree") renderTreeView();
  else if (state.activeView === "generations") renderGenerationsView();
  else if (state.activeView === "nuclei") renderNucleiView();
  else if (state.activeView === "directory") renderDirectoryView();
  else if (state.activeView === "proposals") renderProposalsView();
}

function setupDialogFallbacks() {
  document.querySelectorAll("dialog.modern-dialog").forEach((dialog) => {
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      dialog.addEventListener("click", (event) => {
        if (event.target !== dialog) return;
        const r = dialog.getBoundingClientRect();
        const inside = r.top <= event.clientY && event.clientY <= r.bottom && r.left <= event.clientX && event.clientX <= r.right;
        if (!inside) dialog.close();
      });
    }
  });
}

function initUi() {
  setupDialogFallbacks();
  setupCanvasInteractions();

  document.querySelectorAll(".view-tab").forEach((tab) => tab.addEventListener("click", () => switchView(tab.getAttribute("data-view"))));
  $("focusPersonSelect").addEventListener("change", (e) => setFocusPerson(e.target.value));
  $("treeLayoutModeSelect").addEventListener("change", (e) => {
    state.treeLayoutMode = e.target.value;
    renderTreeView();
    fitTreeToViewport();
  });
  const searchInput = $("globalSearchInput");
  searchInput.addEventListener("input", () => { state.searchQuery = searchInput.value; renderActiveView(); });
  $("btnClearSearch").addEventListener("click", () => { searchInput.value = ""; state.searchQuery = ""; renderActiveView(); });
  $("btnExpandAllGens").addEventListener("click", () => document.querySelectorAll(".generation-section").forEach((s) => s.classList.remove("collapsed")));
  $("btnCollapseAllGens").addEventListener("click", () => document.querySelectorAll(".generation-section").forEach((s) => s.classList.add("collapsed")));
  $("dirSortSelect").addEventListener("change", (e) => { state.dirSort = e.target.value; renderDirectoryView(); });
  $("dirStatusSelect").addEventListener("change", (e) => { state.dirStatus = e.target.value; renderDirectoryView(); });
  $("proposalFilter").addEventListener("change", (e) => { state.proposalFilter = e.target.value; renderProposalsView(); });

  $("btnAddPersonTop").addEventListener("click", openAddPersonStandaloneModal);
  $("btnClosePersonDialog").addEventListener("click", () => $("personDialog").close());
  $("btnCancelPersonDialog").addEventListener("click", () => $("personDialog").close());
  $("personForm").addEventListener("submit", handlePersonFormSubmit);

  $("btnOpenAdmin").addEventListener("click", () => $("adminDialog").showModal());
  $("btnImportFromGate").addEventListener("click", () => $("adminDialog").showModal());
  $("btnCloseAdminDialog").addEventListener("click", () => $("adminDialog").close());
  $("importFile").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) importTree(file).finally(() => { e.target.value = ""; });
  });
  $("btnDownloadJson").addEventListener("click", () => {
    const payload = { exportedAt: new Date().toISOString(), rootId: state.rootId, branches: state.branches, people: state.people.map(({ childrenIds, ...p }) => p) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `arbol-padron-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const THEME_KEY = "padron-arbol-tema";
  try { const t = localStorage.getItem(THEME_KEY); if (t) document.documentElement.setAttribute("data-theme", t); } catch { /* nada */ }
  $("btnThemeToggle").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* nada */ }
  });
}

initUi();
