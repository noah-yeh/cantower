/**
 * 残塔 Service Worker —— 让「安装到主屏幕」之后断网也能玩。
 *
 * 策略（v13 重写，v45 收紧）：
 *  - 入口 + 代码（html / js / css / webmanifest）：**网络优先**，失败才落缓存。
 *    v12 之前是"缓存优先"，发版后会出现「新入口 + 旧模块」的混搭 ——
 *    ES Module 的具名导出一变就整页 import 失败，玩家看到的是纯黑屏。
 *  - 图片 / 字体 / 图标：**缓存优先 + 后台刷新（stale-while-revalidate）**。
 *    v44 之前是"命中缓存就永不刷新"，结果换美术后老玩家一直看旧切图，
 *    刷新多少次都不变。现在命中缓存照旧秒出，同时后台拉一份新的写回缓存，
 *    下一次打开就是新的 —— 代价最多一次会话。
 *  - **只缓存成功响应**：404 / 5xx 一旦塞进缓存，会被缓存优先永远吐出来，
 *    刷新一百次也还是坏的（这次黑屏的帮凶之一）。
 *
 * 更新游戏时把 CACHE_VERSION 加一，旧缓存整体作废。
 */
const CACHE_VERSION = 'v110';
const CACHE_NAME = `canta-${CACHE_VERSION}`;
/**
 * 预缓存只放**真实存在的文件**（v3.42）：`'./'` 在带分享码访问的线上站点上
 * 会返回 403「链接不完整」页 —— cache.addAll 遇到非 2xx 整体 reject，
 * 结果三个文件一个都没缓存，离线首屏反而没兜底。改从 index.html 起。
 */
const PRECACHE = ['./index.html', './style.css'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    // 预缓存失败不能挡住安装：缺一个文件就整个 SW 卡死更糟
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

/** 入缓存前过一道闸：只留正常响应，别把 404 做成永久缓存 */
function remember(req, res) {
  if (!res || !res.ok || res.type !== 'basic') return res;
  const copy = res.clone();
  caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
  return res;
}

/** 代码与入口：网络优先，离线才退回缓存 */
const CODE_RE = /\.(?:js|mjs|css|html|webmanifest)$/;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate' || CODE_RE.test(url.pathname)) {
    event.respondWith(
      fetch(req)
        .then((res) => remember(req, res))
        .catch(() => caches.open(CACHE_NAME).then((c) =>
          c.match(req).then((hit) => hit || c.match('./index.html')))),
    );
    return;
  }

  /**
   * 图片 / 字体：缓存优先，但**每次都在后台拉一份新的**（stale-while-revalidate）。
   * v44 是纯缓存优先 —— 美术换了以后，老玩家缓存里永远是旧图。
   *
   * 两个关键坑，v46 都踩实了：
   *  - 后台拉新必须 `cache: 'reload'`。服务器不发 Cache-Control，浏览器会用
   *    "启发式新鲜期"缓存图片；v45 的后台 fetch 直接撞上 disk cache 拿回**旧图**，
   *    再由 remember 原样写回缓存 —— 更新机制形同虚设（本次"切图还是旧的"的真因）。
   *  - 别在 respondWith 的回调里调 waitUntil（事件已派发完，会抛 InvalidStateError）。
   *    后台 fetch 自走，失败也无所谓。
   */
  event.respondWith(
    /** 只在**本版本**缓存里找：不带 cacheName 的 caches.match 会翻出旧版本的旧图 */
    caches.open(CACHE_NAME).then((c) => c.match(req)).then((hit) => {
      const fresh = fetch(new Request(req, { cache: 'reload' }))
        .then((res) => remember(req, res))
        .catch(() => null);
      if (hit) return hit;
      return fresh.then((res) => res || new Response('', { status: 504, statusText: 'offline' }));
    }),
  );
});
