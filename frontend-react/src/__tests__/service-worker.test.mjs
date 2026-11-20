// @vitest-environment node
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {describe, expect, it, vi} from "vitest";

const serviceWorkerSource = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

function createServiceWorker(fetchMock) {
  const listeners = new Map();
  const cache = {addAll: vi.fn(async () => undefined), put: vi.fn(async () => undefined)};
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => ["mis-cuentas-shell-v4", "unrelated-app-cache", "mis-cuentas-shell-v5"]),
    delete: vi.fn(async () => true),
    match: vi.fn(async () => new Response("cached shell")),
  };
  const self = {
    location: {origin: "https://app.test"},
    addEventListener: (type, listener) => listeners.set(type, listener),
    clients: {claim: vi.fn(async () => undefined)},
    skipWaiting: vi.fn(),
  };
  runInNewContext(serviceWorkerSource, {self, caches, fetch: fetchMock, Request, URL, Promise, Set, Array, Error});
  return {listeners, cache, caches};
}

describe("PWA service worker cache", () => {
  it("installs the current HTML and every hashed asset it references", async () => {
    const fetchMock = vi.fn(async () => new Response('<script type="module" src="/assets/app-a1.js"></script><link rel="stylesheet" href="/assets/app-b2.css">'));
    const {listeners, cache} = createServiceWorker(fetchMock);
    let installTask;
    listeners.get("install")?.({waitUntil: (promise) => { installTask = promise; }});
    await installTask;

    const shellRequest = fetchMock.mock.calls[0][0];
    expect(shellRequest.url).toBe("https://app.test/");
    expect(shellRequest.cache).toBe("reload");
    expect(cache.put).toHaveBeenCalledWith("/", expect.any(Response));
    expect(cache.addAll).toHaveBeenLastCalledWith(["/assets/app-a1.js", "/assets/app-b2.css"]);
  });

  it("uses only the app shell cache for offline navigation and activation", async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError("offline"); });
    const {listeners, caches} = createServiceWorker(fetchMock);
    let activateTask;
    listeners.get("activate")?.({waitUntil: (promise) => { activateTask = promise; }});
    await activateTask;
    expect(caches.delete).toHaveBeenCalledExactlyOnceWith("mis-cuentas-shell-v4");

    let navigationResponse;
    listeners.get("fetch")?.({
      request: {method: "GET", mode: "navigate", url: "https://app.test/"},
      respondWith: (promise) => { void promise.then((response) => { navigationResponse = response; }); },
    });
    await vi.waitFor(() => expect(navigationResponse).toBeInstanceOf(Response));
    expect(caches.match).toHaveBeenCalledWith("/", {cacheName: "mis-cuentas-shell-v5"});
  });
});
