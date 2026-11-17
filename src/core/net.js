/**
 * 云端传输层（v3.94）：只负责"把 JSON 发出去、把 JSON 收回来"。
 *
 * 这一层不认识 meta，也不认识角色 —— 业务语义全在 cloud.js。
 * 分开的理由：传输层要能被单测里的假 fetch 整个替换掉，
 * 而同步逻辑（rev 递增、镜像合并）必须能在没有网络的环境里断言。
 *
 * 所有方法都返回 `{ ok, status, data, code }` 而不抛异常：
 * 大厅启动时并行拉存档/拉镜像，任何一路失败都不该让另外一路跟着炸，
 * 调用方一个 `if (!r.ok)` 就能兜住，不用把整段逻辑包进 try。
 */

const DEFAULTS = { timeoutMs: 8000 };

export class NetError extends Error {}

/**
 * @param {object} opt
 * @param {string} opt.baseUrl  例如 https://api.canta.example.com（不带尾斜杠）
 * @param {string} [opt.token]  玩家 token，登录后由 cloud.js 注入
 */
export function createNet({ baseUrl, token = '', fetchImpl, timeoutMs = DEFAULTS.timeoutMs } = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  let bearer = token;

  async function call(method, path, body) {
    if (!base) return { ok: false, status: 0, code: 'disabled' };
    if (!doFetch) return { ok: false, status: 0, code: 'no_fetch' };

    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (bearer) headers.authorization = `Bearer ${bearer}`;

    try {
      const res = await doFetch(base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined,
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (res.ok) return { ok: true, status: res.status, data };
      return {
        ok: false,
        status: res.status,
        code: (data && data.error) || `http_${res.status}`,
        message: (data && data.message) || '',
        data,
      };
    } catch (e) {
      /** 超时和断网对玩家是同一件事：先按"离线"处理，云端那步下次再说 */
      const code = e && e.name === 'AbortError' ? 'timeout' : 'network';
      return { ok: false, status: 0, code, message: code === 'timeout' ? '连接超时' : '连不上服务器' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    baseUrl: base,
    get token() { return bearer; },
    setToken(t) { bearer = String(t || ''); },

    health() { return call('GET', '/health'); },

    /** 首次进入：换一个 playerId + token。无密码，设备级身份 */
    createPlayer(nick) { return call('POST', '/v1/player', { nick: nick || undefined }); },

    /** 换设备：用存档码换一个**新** token（旧 token 同时失效） */
    recover(playerId) { return call('POST', '/v1/recover', { playerId }); },

    pullSave() { return call('GET', '/v1/save'); },

    pushSave(rev, payload) { return call('PUT', '/v1/save', { rev, payload }); },

    pushGhost(payload) { return call('POST', '/v1/ghost', payload); },

    fetchGhosts(score, n = 3) {
      const q = `?score=${Math.max(0, Math.round(Number(score) || 800))}&n=${Math.max(1, Math.round(Number(n) || 3))}`;
      return call('GET', `/v1/ghosts${q}`);
    },
  };
}
