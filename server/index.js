/**
 * 启动入口。
 *
 * 本地：node server/index.js            → file 驱动，数据落 server/.data/db.json
 * 云引擎：STORE=mysql MYSQL_URL=...     → LeanDB 驱动（环境变量在控制台配）
 *
 * 云引擎要求监听 process.env.PORT 且绑定 0.0.0.0，HTTPS/证书/负载均衡由平台那一层处理，
 * 所以这里只有裸 http —— 不要自己加 TLS，也不要写死端口。
 */

import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createFileStore } from './store-file.js';
import { createMysqlStore } from './store-mysql.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 4188;
const STORE = String(process.env.STORE || '').toLowerCase();
const MYSQL_URL = process.env.MYSQL_URL || '';
const DATA_FILE = process.env.DATA_FILE || join(HERE, '.data', 'db.json');
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
/** 本地压测时可设 RATE_MAX=0 关掉限流 */
const RATE_MAX = process.env.RATE_MAX === undefined ? undefined : Number(process.env.RATE_MAX);

async function makeStore() {
  if (STORE === 'mysql' || MYSQL_URL) {
    if (!MYSQL_URL) throw new Error('STORE=mysql 需要同时提供 MYSQL_URL');
    const store = await createMysqlStore({ url: MYSQL_URL });
    await store.init();
    return store;
  }
  const store = createFileStore(DATA_FILE);
  await store.init();
  return store;
}

const store = await makeStore();
const app = createApp({ store, corsOrigin: CORS_ORIGIN, rateMax: RATE_MAX });
const server = createServer(app);

server.listen(PORT, '0.0.0.0', () => {
  const where = store.kind === 'mysql' ? 'LeanDB(MySQL)' : DATA_FILE;
  console.log(`[canta-cloud] http://0.0.0.0:${PORT}  store=${store.kind}  data=${where}`);
  console.log('[canta-cloud] GET /health  POST /v1/player  GET|PUT /v1/save  POST /v1/ghost  GET /v1/ghosts');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
