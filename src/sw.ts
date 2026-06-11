/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

declare let self: ServiceWorkerGlobalScope;

// PWA shell precache (vite-plugin-pwa injectManifest)
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
self.skipWaiting();
clientsClaim();

// Web push (ARCHITECTURE §7.6) — payload from convex/brain/push.ts
self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; severity?: string } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    /* opaque payload */
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'BlindSpot', {
      body: data.body ?? '',
      tag: `blindspot-${data.severity ?? 'alert'}`,
      icon: '/icons/pwa-192.png',
      badge: '/icons/pwa-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/command'));
});
