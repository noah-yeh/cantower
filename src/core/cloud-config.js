/**
 * 云端配置（v3.94）。
 *
 * `baseUrl` 留空 = **整层云端停用**，游戏行为和现在完全一致：
 * 不建连接、不发请求、存档照旧只写 localStorage。
 *
 * 上 TapTap 时把云引擎绑定的域名填进来（不要带尾斜杠），例如：
 *   baseUrl: 'https://canta-api.your-domain.com'
 * 域名必须和你部署在云引擎上的服务一致；本地调试填 http://127.0.0.1:4188。
 *
 * 这里只放地址，不放任何密钥 —— 后端没有密钥可放，
 * 身份是「playerId + token」，token 存在玩家自己浏览器的 localStorage 里。
 */
export const CLOUD_CONFIG = {
  baseUrl: '',
  /** 存档变更后自动上传（大厅里静默进行，失败不打扰玩家） */
  autoSync: true,
  /** 每次进大厅拉一次镜像池（异步 PvP 的对手来源） */
  autoGhosts: true,
  /** 单次请求超时（毫秒）。移动端弱网下 8 秒足够，再久就该按离线处理 */
  timeoutMs: 8000,
  /**
   * 存档码（换设备用）。新设备打开 `?code=<存档码>` 时，本地没有存档就会用它恢复身份。
   * 存档码就是 playerId，服务端只认它换发新 token —— 84 位随机，猜不出来。
   */
  recoverCode: '',
};

/**
 * 运行时配置。允许 `window.__CANTA_CLOUD__` 覆盖（调试探针用），
 * 也允许 URL 上的 `?code=` 当存档码 —— 那是给玩家换设备用的：
 * 老设备把码发过来，新设备打开链接就自动接上，不用做输入框。
 */
export function resolveCloudConfig(env = typeof window !== 'undefined' ? window : null) {
  const cfg = { ...CLOUD_CONFIG };
  if (env && env.__CANTA_CLOUD__ && typeof env.__CANTA_CLOUD__ === 'object') {
    Object.assign(cfg, env.__CANTA_CLOUD__);
  }
  try {
    const q = env && env.location ? env.location.search : '';
    const m = /[?&]code=([A-Za-z0-9_-]{6,40})/.exec(q || '');
    if (m) cfg.recoverCode = m[1];
  } catch {
    /* 隐私模式/异常环境：忽略 */
  }
  return cfg;
}
