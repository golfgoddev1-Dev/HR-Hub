/* HR Hub service worker.
 *
 * Scope on purpose: Web Push only. There is NO fetch handler, so the service
 * worker never caches a page, an API response or a signed URL. The cache
 * storage is left untouched, which keeps leave data out of it entirely.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function safeUrl(value) {
  // Only same-origin paths are accepted: a payload cannot redirect the user
  // to another site.
  if (typeof value !== "string") return "/leave";
  if (!value.startsWith("/") || value.startsWith("//")) return "/leave";
  return value;
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = typeof payload.title === "string" && payload.title.length > 0 ? payload.title : "HR Hub";
  const options = {
    body: typeof payload.body === "string" ? payload.body : "",
    tag: typeof payload.tag === "string" ? payload.tag : "leave",
    icon: "/icon.svg",
    badge: "/icon.svg",
    data: { url: safeUrl(payload.url) },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeUrl(event.notification.data && event.notification.data.url);

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      for (const client of windows) {
        if (client.url.includes(target) && "focus" in client) return client.focus();
      }

      const reusable = windows.find((client) => "focus" in client);
      if (reusable) {
        await reusable.focus();
        if ("navigate" in reusable) {
          try {
            return await reusable.navigate(target);
          } catch {
            // Some browsers refuse navigate() on an uncontrolled client.
          }
        }
      }

      return self.clients.openWindow(target);
    })()
  );
});
