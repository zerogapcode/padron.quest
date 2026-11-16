/* Service worker de avisos de padron.quest (Firebase Cloud Messaging, web push).
   Recibe los avisos con la página cerrada o en segundo plano, los muestra como notificación
   y, al tocarla, abre (o enfoca) la página del aviso dentro del sitio. */

// Se registra antes de cargar el SDK para que el clic en nuestras notificaciones lo atendamos nosotros.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = enlaceInterno(event.notification.data && event.notification.data.link);
  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const v of ventanas) {
      if (new URL(v.url).origin !== self.location.origin) continue;
      try {
        if ("navigate" in v && v.url !== destino) await v.navigate(destino);
        return await v.focus();
      } catch (e) { /* si no se puede reutilizar, se abre otra */ }
    }
    return self.clients.openWindow(destino);
  })());
});

// Toma el control enseguida al instalarse o actualizarse (no guarda nada en caché).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Cada push SIEMPRE muestra una notificación, también con una pestaña de padron.quest visible.
// Si lo dejáramos al SDK, con la página visible pasaría el mensaje a la pestaña (onMessage, que el sitio no
// usa) y no mostraría nada; en iPhone, además, Safari retira el permiso a quien recibe push sin notificación.
// Este oyente se registra antes de cargar el SDK y corta la propagación para que el SDK no lo procese.
self.addEventListener("push", (event) => {
  event.stopImmediatePropagation();
  let carga = {};
  try { carga = event.data ? event.data.json() : {}; } catch (e) { carga = {}; }
  // FCM entrega { data: { title, body, link, tag }, from, fcmMessageId, ... }.
  const d = (carga && (carga.data || carga.notification)) || {};
  event.waitUntil(mostrarAviso(d));
});

function mostrarAviso(d) {
  return self.registration.showNotification(String(d.title || "Familia Padrón Perera"), {
    body: String(d.body || "Tienes un aviso nuevo."),
    icon: "/comun/icono-192.png",
    badge: "/comun/badge-96.png", // silueta blanca con fondo transparente (Android usa solo el alfa)
    tag: d.tag || undefined,
    renotify: !!d.tag,
    lang: "es",
    data: { link: enlaceInterno(d.link) },
  });
}

// Solo se abren páginas de este mismo sitio (el enlace llega como https://padron.quest/ruta).
function enlaceInterno(link) {
  try {
    const u = new URL(String(link || "/muro/"), self.location.origin);
    return self.location.origin + (u.pathname.startsWith("/") ? u.pathname : "/muro/") + u.search + u.hash;
  } catch (e) {
    return self.location.origin + "/muro/";
  }
}

importScripts("https://www.gstatic.com/firebasejs/13.3.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/13.3.0/firebase-messaging-compat.js");

// Misma configuración pública que comun/base.js.
firebase.initializeApp({
  apiKey: "AIzaSyDkrGcwFUpxtImQdC0WWOgES5gfvGSjAsU",
  authDomain: "padron-quest.firebaseapp.com",
  projectId: "padron-quest",
  storageBucket: "padron-quest.firebasestorage.app",
  messagingSenderId: "570581063341",
  appId: "1:570581063341:web:c595054a2ff6b043349824",
});

// El SDK queda cargado para que el token siga ligado a este service worker (getToken en la página lo usa
// con esta misma registración). Los push los atiende el oyente propio de arriba.
firebase.messaging();
