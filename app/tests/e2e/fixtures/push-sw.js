// The service worker of the push fixture tells what it finds of push.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('message', (event) => {
  event.ports[0]?.postMessage({
    push: 'PushManager' in self,
    manager: typeof self.registration.pushManager,
  });
});
