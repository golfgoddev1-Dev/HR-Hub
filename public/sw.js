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

// Keep this list in step with src/lib/notification-routes.js. A payload may
// name only one of these keys; it never supplies a path or URL.
const ROUTE_PATHS = Object.freeze({
  approvals: "/leave/approvals",
  leave: "/leave",
});

function routeKey(value) {
  return value === "approvals" || value === "leave" ? value : null;
}

function mappedPath(value) {
  return ROUTE_PATHS[value] ?? "/";
}

function mappedUrl(value) {
  return new URL(mappedPath(value), self.location.origin).href;
}

function sameOrigin(value) {
  try {
    return new URL(value).origin === self.location.origin;
  } catch {
    return false;
  }
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
    data: { route: routeKey(payload.route) },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = mappedUrl(data.route);

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const appWindow = windows.find((client) => sameOrigin(client.url));

      if (appWindow) {
        await appWindow.focus();
        if (typeof appWindow.navigate === "function") {
          try {
            return await appWindow.navigate(target);
          } catch {
            // Fall through to a fresh window if the browser refuses navigate().
          }
        }
      }

      return self.clients.openWindow(target);
    })()
  );
});
