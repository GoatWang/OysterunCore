self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(
    event.notification.data && event.notification.data.url
      ? event.notification.data.url
      : "/app",
    self.location.origin
  ).href;

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windowClients) {
        if ("navigate" in client && client.url !== targetUrl) {
          try {
            await client.navigate(targetUrl);
          } catch (err) {
            // Focus the existing client if navigation is not available.
          }
        }
        if ("focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })()
  );
});
