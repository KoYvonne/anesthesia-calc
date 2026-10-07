// 修改 app.jsx 等檔案後請把版本號 +1，使用者下次開啟才會拿到新版
const CACHE = 'anes-calc-v4';
const SHELL = [
  './',
  './index.html',
  './app.jsx',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.tailwindcss.com/3.4.16',
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.26.4/babel.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return; // 回饋 POST 不經快取
  const url = new URL(request.url);
  if (url.hostname.endsWith('google.com') || url.hostname.endsWith('googleusercontent.com')) return;

  // 本站檔案：網路優先（拿得到新版就用新版），離線時回快取
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
    );
    return;
  }
  // CDN：快取優先
  e.respondWith(caches.match(request).then((r) => r || fetch(request)));
});
