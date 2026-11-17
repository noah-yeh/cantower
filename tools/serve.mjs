/**
 * 静态预览服务器（本地 npm run serve / 发布沙箱共用）。
 *
 * 为什么不用 `python -m http.server 4182 --bind 127.0.0.1`：
 * 发布工具会把 package.json 的 serve 脚本当成启动命令，而写死的 4182 + 127.0.0.1
 * 在沙箱里根本不在 PORT 上监听 —— v3.40 第一次发布就因此 60s 超时失败
 * （旧链接一度被打不开）。这里必须 `process.env.PORT` + 绑 0.0.0.0。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.env.PORT) || 4182;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = resolve(join(ROOT, rel));
    /** 目录穿越防护：解析后的路径必须还在 ROOT 里 */
    if (file !== ROOT && !file.startsWith(ROOT + sep)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const info = await stat(file).catch(() => null);
    const target = info?.isDirectory() ? join(file, 'index.html') : file;
    const body = await readFile(target).catch(() => null);
    if (!body) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      /** 和 sw.js 的 CACHE_VERSION 一起使用：HTML 不缓存，改版才能立刻生效 */
      'cache-control': extname(target) === '.html' ? 'no-cache' : 'public, max-age=300',
    }).end(body);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(String(e?.message || e));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`残塔预览：http://127.0.0.1:${PORT}/  (PORT=${PORT}, root=${ROOT})`);
});
