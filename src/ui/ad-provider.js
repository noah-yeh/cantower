/**
 * 激励视频播放器 —— 平台适配层
 *
 * 契约只有一个，上层（main.js）不用关心底下是哪个平台：
 *
 *   const res = await playRewardedAd({ slot: 'box', signal });
 *   if (res.ok) grantShardBox(...)      // **只有播完才发奖**
 *
 * 三个实现分支：
 *   1. **TapTap 容器**（线上）—— 全局 `tap` 对象由运行时注入，不用 npm 装、不用 import，
 *      就和浏览器里的 `window` 一样。走 `tap.createRewardedVideoAd`。
 *   2. **不在容器里**（网页版 / 开发者预览）—— 走 3 秒模拟，方便调试流程。
 *   3. **没填广告位 ID** —— 同样走模拟，但不会真出广告（也就没有收入）。
 *
 * 为什么要第 2、3 条：游戏同时挂在 workbuddy.host 上给人试玩，那里没有 TapTap 环境。
 * 没有降级的话，网页版玩家点广告会看到报错，而我们又没法在真机上先验一遍 ——
 * 结果就是"上架之后才发现广告点不开"。
 */

/**
 * 广告位 ID。**这两个空字符串就是唯一需要手填的地方**：
 * TapTap 后台 → 你的游戏 → 商店 → 小游戏广告 → 申请开通 → 创建广告位后拿到。
 *
 * 留空时自动退回模拟播放，不会崩，但也不会有收入。
 */
export const AD_UNITS = {
  /** 大厅「看广告领 30 金」 */
  gold: '',
  /** 种族碎片宝箱 */
  box: '',
};

/** 模拟播放时长。真实激励视频 15~30 秒，这里 3 秒是为了本地调试不烦人 */
export const AD_MOCK_MS = 3000;

/** 当前实际会用的播放器，UI 拿它决定要不要显示"模拟"角标 */
export function adProvider() {
  const hasTap = typeof globalThis.tap !== 'undefined'
    && typeof globalThis.tap.createRewardedVideoAd === 'function';
  return hasTap ? 'taptap' : 'mock';
}

/** 这个环境下广告能不能真播（用于 UI 提示，不影响发奖流程） */
export function adIsReal() {
  return adProvider() === 'taptap';
}

/* ------------------------------------------------------------------ *
 * TapTap 激励视频
 * ------------------------------------------------------------------ */

/**
 * 一个广告位一个实例（SDK 侧是单例，重复 create 会拿到同一个）。
 * 缓存起来是为了复用 onLoad 的预加载状态，别每次点都重新拉一遍素材。
 */
const tapAds = new Map();

function tapAd(unitId) {
  if (tapAds.has(unitId)) return tapAds.get(unitId);
  const ad = globalThis.tap.createRewardedVideoAd({ adUnitId: unitId });
  tapAds.set(unitId, ad);
  return ad;
}

/**
 * 播一段真实激励视频。
 *
 * 三个容易踩的点：
 *  - `show()` 返回 Promise，素材没加载完会 reject —— 要 `load()` 之后再 `show()`，
 *    不能直接把错误丢给玩家；
 *  - 只有 `onClose` 的 `res.isEnded === true` 才算看完，中途划掉不算；
 *  - 监听器是**累加**的，每次播放前必须把上一次的摘掉，否则第二次点会 resolve 两次。
 */
function playTapAd(unitId, { signal } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const ad = tapAd(unitId);

    const cleanup = () => {
      ad.offClose?.(onClose);
      ad.offError?.(onError);
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const onClose = (res) => {
      if (res && res.isEnded === false) finish({ ok: false, reason: 'aborted' });
      else finish({ ok: true });
    };

    const onError = (err) => {
      finish({ ok: false, reason: err?.errMsg || err?.message || '广告加载失败，请稍后再试' });
    };

    ad.onClose?.(onClose);
    ad.onError?.(onError);

    signal?.addEventListener?.('abort', () => finish({ ok: false, reason: 'aborted' }), { once: true });

    Promise.resolve()
      .then(() => ad.show())
      .catch(() =>
        Promise.resolve()
          .then(() => ad.load())
          .then(() => ad.show())
          .catch(() => finish({ ok: false, reason: '广告暂时拉不到，稍后再试' })),
      );
  });
}

/* ------------------------------------------------------------------ *
 * 模拟播放（网页端 / 没填广告位）
 * ------------------------------------------------------------------ */

export function playRewardedAdMock({ durationMs = AD_MOCK_MS, onTick, signal } = {}) {
  return new Promise((resolve) => {
    const total = Math.max(1, Math.ceil(durationMs / 1000));
    let left = total;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      resolve(result);
    };

    onTick?.(left, total);

    const timer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        onTick?.(0, total);
        finish({ ok: true });
        return;
      }
      onTick?.(left, total);
    }, 1000);

    // 中途关闭 = 没看完 = 不发奖。这是激励视频的基本契约，
    // 否则"点开就关"就成了免费奖励机。
    signal?.addEventListener?.('abort', () => finish({ ok: false, reason: 'aborted' }), { once: true });
  });
}

/* ------------------------------------------------------------------ *
 * 统一入口
 * ------------------------------------------------------------------ */

/**
 * 播放一段激励视频。
 *
 * @param {object} opts
 * @param {'gold'|'box'} [opts.slot]  广告位（决定用哪个 adUnitId）
 * @param {number} [opts.durationMs]  模拟播放时长（真实广告忽略）
 * @param {(left:number,total:number)=>void} [opts.onTick] 每秒回调剩余秒数（模拟用）
 * @param {AbortSignal} [opts.signal] 用户中途关闭
 * @returns {Promise<{ok:true}|{ok:false,reason:string}>}
 */
export function playRewardedAd({ slot = 'gold', durationMs, onTick, signal } = {}) {
  const unitId = AD_UNITS[slot] || '';
  if (adProvider() === 'taptap' && unitId) {
    return playTapAd(unitId, { signal });
  }
  return playRewardedAdMock({ durationMs, onTick, signal });
}
