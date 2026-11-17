/**
 * 激励视频广告位 —— 规则层
 *
 * 只回答三件事：今天还剩几次、现在能不能看、看完记一笔并加金币。
 * 不碰 DOM、不碰计时器、不发网络请求 —— "播放"本身在 ui/ad-provider.js。
 *
 * 这样分层的原因：广告的**规则**（次数、重置、奖励）属于经济系统，必须能被
 * node --test 直接验证；而**播放**属于平台能力，将来换 SDK 时只改一个文件。
 */

/**
 * 每天的次数上限。
 *
 * 5 次 × 30 金 = 150 金/天，约等于 1.5 次招募 —— 够救急，但撑不起一队人。
 * 这个数不是拍脑袋：广告必须是"补充"，一旦能替代探险，玩家就不爬塔了。
 */
export const AD_DAILY_LIMIT = 5;

/**
 * 单次奖励。
 *
 * 一次完整探险（30 层）产出 30 金，通关 60 金。取 30 = 半趟探险的量：
 * 看完能补上被打断的节奏，但拿不到成长（卡组、宝物、等级）——
 * 成长只从塔里来，这是经济不崩的前提。
 */
export const AD_REWARD_GOLD = 30;

/** 广告位标识。接真实 SDK 时用它换广告位配置，现在只做调试输出 */
export const AD_SLOT_ID = 'hall_gold';

/**
 * 第二个广告位：种族碎片宝箱（v3.89）。
 *
 * 和金币位**分开计数**：金币是"救急"，碎片是"养成"，两者的额度混在一起会让
 * 玩家被迫二选一 —— 想练种族就买不起人，这种耦合没有意义。
 * 奖励不发在这里：碎片由 `races.grantShardBox` 抽（要按种族权重、要处理满级退化），
 * 本文件只负责记那一次数，保证"看完才给"的契约不被绕过。
 */
export const AD_BOX_SLOT_ID = 'shard_box';
export const AD_BOX_DAILY_LIMIT = 5;

/**
 * 本地自然日的 key（`2026-11-04`）。
 *
 * 用本地时区而不是 UTC：玩家感知的是"我这边过了 0 点"。
 * 用 UTC 的话北京时间早上 8 点才重置，会被当成 bug。
 */
export function dayKey(now) {
  const d = new Date(Number.isFinite(now) ? now : 0);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * 当前广告位状态。**只读**，不改 meta —— 渲染层每秒都会调它。
 * 跨天时 `used` 按 0 算（懒重置，等真正领取时才写回）。
 */
export function adState(meta, now) {
  const day = dayKey(now);
  const raw = meta?.ads;
  const used = raw && raw.day === day ? Math.max(0, Number(raw.used) || 0) : 0;
  return {
    day,
    used,
    left: Math.max(0, AD_DAILY_LIMIT - used),
    limit: AD_DAILY_LIMIT,
    reward: AD_REWARD_GOLD,
  };
}

/** 能不能看。返回原因而不是 false，UI 直接显示 */
export function canWatchAd(meta, now) {
  const st = adState(meta, now);
  if (st.left <= 0) return { ok: false, reason: '今日广告次数已用完，明天再来' };
  return { ok: true };
}

/**
 * 看完广告后记账 + 发奖。
 *
 * 调用方**必须**先确认广告真的播完了（`ad-provider` 返回 ok），
 * 否则这里就成了白送金币的入口。
 */
export function grantAdReward(meta, now) {
  const check = canWatchAd(meta, now);
  if (!check.ok) return check;

  const day = dayKey(now);
  const used = meta.ads?.day === day ? Math.max(0, Number(meta.ads.used) || 0) : 0;
  /** boxUsed 必须原样带过来 —— 整对象覆盖会把碎片宝箱的次数清零，等于白送额度 */
  const boxUsed = meta.ads?.day === day ? Math.max(0, Number(meta.ads.boxUsed) || 0) : 0;
  meta.ads = { day, used: used + 1, boxUsed };
  meta.gold += AD_REWARD_GOLD;

  return {
    ok: true,
    gold: AD_REWARD_GOLD,
    left: AD_DAILY_LIMIT - meta.ads.used,
  };
}

/* ------------------------------------------------------------------ *
 * 碎片宝箱广告位（v3.89）
 * ------------------------------------------------------------------ */

/** 宝箱位的状态。跨天同样懒重置 */
export function boxAdState(meta, now) {
  const day = dayKey(now);
  const raw = meta?.ads;
  const used = raw && raw.day === day ? Math.max(0, Number(raw.boxUsed) || 0) : 0;
  return {
    day,
    used,
    left: Math.max(0, AD_BOX_DAILY_LIMIT - used),
    limit: AD_BOX_DAILY_LIMIT,
  };
}

export function canWatchBoxAd(meta, now) {
  const st = boxAdState(meta, now);
  if (st.left <= 0) return { ok: false, reason: '今天的宝箱次数用完了，明天再来' };
  return { ok: true };
}

/**
 * 记一次宝箱广告。
 *
 * 调用方顺序必须是：canWatchBoxAd → 播放 → 播完 → grantBoxAdRecord → grantShardBox。
 * 先记账再发奖，是为了让"发奖时抛异常"也不会变成无限次数。
 */
export function grantBoxAdRecord(meta, now) {
  const check = canWatchBoxAd(meta, now);
  if (!check.ok) return check;

  const day = dayKey(now);
  const used = meta.ads?.day === day ? Math.max(0, Number(meta.ads.used) || 0) : 0;
  const boxUsed = meta.ads?.day === day ? Math.max(0, Number(meta.ads.boxUsed) || 0) : 0;
  meta.ads = { day, used, boxUsed: boxUsed + 1 };

  return { ok: true, left: AD_BOX_DAILY_LIMIT - meta.ads.boxUsed };
}
