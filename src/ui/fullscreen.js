/**
 * 全屏（v3.43）—— 用户：「怎么安装应用版，这样就不会有浏览器上下框的影响了」。
 *
 * 两条路都能去框，这里是**兜底的那条**：
 *   1. 装成 PWA（Chrome / Edge / iOS Safari）—— 真正的独立窗口，见 manifest.webmanifest；
 *   2. 浏览器全屏 API —— 华为浏览器这类不支持"安装应用"的，点一下也能把地址栏藏掉。
 *
 * 注意 iOS Safari 不支持元素全屏（只有 video 可以），那边检测不到能力就不显示按钮，
 * 让它走「分享 → 添加到主屏幕」。
 */

const el = () => document.documentElement;

export function canFullscreen() {
  const d = el();
  return !!(d.requestFullscreen || d.webkitRequestFullscreen);
}

export function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

/**
 * 已经以"应用窗口"运行（装到桌面后启动）时不必再给全屏按钮 ——
 * 那时地址栏本来就没有。`navigator.standalone` 是 iOS 的私有标记。
 */
export function isAppMode() {
  try {
    if (typeof matchMedia === 'function'
      && (matchMedia('(display-mode: standalone)').matches
        || matchMedia('(display-mode: fullscreen)').matches
        || matchMedia('(display-mode: minimal-ui)').matches)) return true;
  } catch (e) { /* 老浏览器没有 matchMedia */ }
  return navigator.standalone === true;
}

/** 能不能给他看到这个按钮 */
export function showFullscreenButton() {
  return canFullscreen() && !isAppMode();
}

/**
 * 切换全屏。必须由用户手势触发（click 里同步调用），浏览器才允许。
 * 各家实现都返回 Promise 或什么都不返回，统一吞掉失败 —— 全屏失败不影响游戏本身。
 */
export function toggleFullscreen() {
  const d = el();
  if (isFullscreen()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) {
      try { exit.call(document); } catch (e) { /* 忽略 */ }
    }
    return;
  }
  if (d.requestFullscreen) {
    d.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  } else if (d.webkitRequestFullscreen) {
    d.webkitRequestFullscreen();
  }
}

/** 游戏页顶栏 / 大厅顶栏共用的一枚按钮 */
export function fullscreenButton() {
  if (!showFullscreenButton()) return '';
  const on = isFullscreen();
  return `<button class="icon-btn fs-btn${on ? ' on' : ''}" data-action="toggle-fullscreen"
    aria-label="${on ? '退出全屏' : '全屏显示，藏掉浏览器地址栏'}">${on ? '⤡' : '⛶'}</button>`;
}
