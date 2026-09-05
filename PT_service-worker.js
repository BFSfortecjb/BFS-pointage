// =========================================================================
// Pointage BFS — PT_service-worker.js
// =========================================================================
// Portée "./" impérative (jamais "/") pour ne pas intercepter la
// navigation des autres applis Univers BFS hébergées sur le même domaine
// GitHub Pages. Ne jamais mettre en cache l'authentification ni les
// données (/auth/, /rest/).
// =========================================================================

const VERSION_CACHE = 'pointage-v33';

const FICHIERS_APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './PT_config.js',
  './PT_debug.js',
  './PT_core.js',
  './PT_app.js',
  './manifest.json',
];

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    caches.open(VERSION_CACHE).then((cache) => cache.addAll(FICHIERS_APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    caches.keys().then((cles) =>
      Promise.all(cles.filter((cle) => cle !== VERSION_CACHE).map((cle) => caches.delete(cle)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evenement) => {
  const url = new URL(evenement.request.url);

  // Ne jamais intercepter l'authentification ni les appels à l'API REST
  // Supabase : toujours passer par le réseau.
  if (url.pathname.includes('/auth/') || url.pathname.includes('/rest/')) {
    return;
  }

  evenement.respondWith(
    caches.match(evenement.request).then((reponseEnCache) => reponseEnCache || fetch(evenement.request))
  );
});
