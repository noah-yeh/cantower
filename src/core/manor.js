/**
 * 庄园（v2.3）—— 星屑的唯一来源
 *
 * 规则来自用户：
 *   「强化的材料可以通过庄园获取，庄园可以通过转正的冒险家转化过来，
 *     这个材料应该是很难获取的」
 *
 * 所以庄园不是"建筑"，是**退役**：一个已经转正（活着从塔里回来过）的角色
 * 放弃出战，留在塔下种地，每小时产 1 个星屑，攒满 3 个就不再增长。
 *
 * 为什么用"退役"当成本：
 *   转正角色本来只剩竞技场一条路，而竞技场产出是封顶的（3 次 / 90 分钟）。
 *   有了庄园，玩家第一次要在「留着打竞技场」和「换成长期材料」之间做取舍 ——
 *   而且这个取舍是不可逆的。
 *
 * 时间一律由调用方传入 `now`：core 不读 Date.now()，否则没法用虚拟时钟测
 * "离线 5 小时回来能收几个"。
 */

import { unequipAllOf } from './equipment.js';

/** 产出一个星屑要多久。1 小时 —— 一件 +10 要 55 个，单庄园就是 55 小时 */
export const MANOR_INTERVAL_MS = 60 * 60 * 1000;

/** 每座庄园最多存几个（存满停产，不会无限累积） */
export const MANOR_CAP = 3;

/** 一次产出多少个 */
export const MANOR_YIELD = 1;

/**
 * 只读：算这座庄园现在有多少可收、下一个还要多久。**不写回**，渲染层每秒都会调。
 *
 * @returns {{ stored:number, full:boolean, nextIn:number, gained:number }}
 */
export function manorState(manor, now = 0) {
  const blank = { stored: 0, full: false, nextIn: MANOR_INTERVAL_MS, gained: 0 };
  if (!manor) return blank;

  /**
   * 注意用 `??` 而不是 `||`：`lastAt` 可以是 0（时间戳 0 在测试里是合法起点），
   * 用 `||` 会把它当成"没有起点"，于是永远算不出产出。
   */
  const last = manor.lastAt ?? now;
  const elapsed = Math.max(0, now - last);
  const gained = Math.floor(elapsed / MANOR_INTERVAL_MS);
  const stored = Math.min(MANOR_CAP, (manor.stored || 0) + gained * MANOR_YIELD);
  const full = stored >= MANOR_CAP;
  const nextIn = full
    ? 0
    : MANOR_INTERVAL_MS - (elapsed % MANOR_INTERVAL_MS);

  return { stored, full, nextIn, gained: gained * MANOR_YIELD };
}

/** 写回：把流逝的时间换成存货落进存档 */
export function tickManor(manor, now = 0) {
  if (!manor) return null;
  const s = manorState(manor, now);
  manor.stored = s.stored;
  if (s.full) {
    /** 满了就停产 —— 把计时起点钉在当下，攒不出"离线溢出" */
    manor.lastAt = now;
  } else if (s.gained > 0) {
    /** 只推进整点，余数留着，避免每秒都把余数抹掉导致永远差一点点 */
    manor.lastAt = (manor.lastAt ?? now) + s.gained * MANOR_INTERVAL_MS;
  }
  return s;
}

/**
 * 推进所有庄园。大厅计时器每秒调一次。
 * @returns {boolean} 有没有变化（有才需要重绘/存档）
 */
export function tickManors(meta, now = 0) {
  let changed = false;
  for (const m of meta?.manors || []) {
    const before = `${m.stored}|${m.lastAt}`;
    tickManor(m, now);
    if (`${m.stored}|${m.lastAt}` !== before) changed = true;
  }
  return changed;
}

/** 收取一座庄园：存货进 meta.stardust，生产从这一刻重新起算 */
export function collectManor(meta, index, now = 0) {
  if (!meta || !Array.isArray(meta.manors)) return { ok: false, reason: '没有庄园' };
  const manor = meta.manors[index];
  if (!manor) return { ok: false, reason: '没有这座庄园' };

  tickManor(manor, now);
  const got = manor.stored || 0;
  if (got <= 0) return { ok: false, reason: '还没有产出，再等等' };

  manor.stored = 0;
  manor.lastAt = now;
  meta.stardust = (meta.stardust || 0) + got;
  return { ok: true, amount: got, total: meta.stardust };
}

/**
 * 这个角色能不能退役去开庄园。
 *
 * 只放已转正的人：试用期的人还没证明自己，塔都还没爬完，
 * 让他去种地等于给了玩家一条"花 100 金买一座庄园"的捷径 ——
 * 而庄园产出的是**成长材料**，不能有价格标签。
 */
export function canConvertToManor(ch) {
  if (!ch) return { ok: false, reason: '角色不存在' };
  if (ch.status === 'dead' || (ch.lives ?? 0) <= 0) return { ok: false, reason: '没有命了' };
  if (ch.status === 'exploring') return { ok: false, reason: '还在塔里，先回来再说' };
  if (!ch.veteran) return { ok: false, reason: '还是试用期：先活着从塔里回来一次' };
  return { ok: true };
}

/**
 * 把角色转成庄园。**角色会被移出名册**（不可逆）。
 *
 * 身上的装备先脱回库里 —— 装备是账号资产，不该跟着人一起埋进土里。
 */
export function convertToManor(meta, charId, now = 0) {
  const ch = (meta?.roster || []).find((c) => c.id === charId);
  const check = canConvertToManor(ch);
  if (!check.ok) return check;

  unequipAllOf(meta, charId);

  const i = meta.roster.indexOf(ch);
  if (i >= 0) meta.roster.splice(i, 1);
  if (meta.activeCharId === ch.id) meta.activeCharId = null;

  if (!Array.isArray(meta.manors)) meta.manors = [];
  const manor = {
    id: `manor_${ch.id}`,
    charId: ch.id,
    name: ch.name,
    classId: ch.classId,
    raceId: ch.raceId,
    level: ch.level || 1,
    /** 退役那一刻起算 */
    lastAt: now,
    stored: 0,
  };
  meta.manors.push(manor);

  return { ok: true, manor };
}

/** 退役角色的称号，纯展示 */
export function manorTitle(manor) {
  return `Lv.${manor.level || 1} ${manor.name || '无名者'}`;
}
