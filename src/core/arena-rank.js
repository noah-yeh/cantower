/**
 * 竞技场段位 / 排名 / 每日奖励（v3.35）。
 *
 * 设计要点（GAME_DESIGN §5.5.2）：
 *  - 段位分 `arenaScore` 随胜负浮动（Elo K=40），初始 800（铁）。
 *  - 角色"评级"（roster.ratingOf）只随养成单调上涨，用于面板展示；
 *    匹配、排名、奖励全看段位分 —— 两个数字必须分开，
 *    否则"角色养强了"和"段位打上去了"就是一回事。
 *  - 本模块是纯函数层：不读 Date.now()，时间一律由调用方传入；
 *    不碰 DOM、不做存档（改角色字段 + meta.arenaDaily 由调用方负责持久化）。
 */

/** 六个段位：分数门槛 → 每日奖励 / 单胜金币 */
export const RANKS = [
  { id: 'iron', name: '铁', min: 0, daily: 8, win: 16, color: '#9aa0a6' },
  { id: 'bronze', name: '青铜', min: 900, daily: 14, win: 20, color: '#b08d57' },
  { id: 'silver', name: '白银', min: 1100, daily: 22, win: 25, color: '#cfd8e3' },
  { id: 'gold', name: '黄金', min: 1300, daily: 34, win: 30, color: '#f0b64e' },
  { id: 'platinum', name: '铂金', min: 1500, daily: 50, win: 36, color: '#7fd4c1' },
  { id: 'diamond', name: '钻石', min: 1700, daily: 70, win: 44, color: '#8fb8ff' },
];

/** 新角色的起点：铁段位中游，赢几场就能摸到青铜，有上升感 */
export const ARENA_START_SCORE = 800;

/** Elo K 值：40 → 均势胜负各 ±20，两三场就能跨一个段位边缘 */
export const ELO_K = 40;

/** 读角色分数：字段缺失（旧档）按起点补 */
export function scoreOf(ch) {
  const v = Number(ch?.arenaScore);
  return Number.isFinite(v) ? Math.max(0, Math.round(v)) : ARENA_START_SCORE;
}

/** 分数落在哪个段位（门槛取满足 min ≤ score 的最后一个） */
export function rankOf(score) {
  const s = Math.max(0, Math.round(Number(score) || 0));
  let hit = RANKS[0];
  for (const r of RANKS) if (s >= r.min) hit = r;
  return hit;
}

/** 下一个段位（已是钻石时 null）—— UI 拿它显示"还差 X 分升段" */
export function nextRankOf(score) {
  const cur = rankOf(score);
  return RANKS[RANKS.indexOf(cur) + 1] || null;
}

/**
 * Elo 单场分差。期望胜率越低，赢了拿得越多、输了扣得越少；
 * 保底 1 分 —— 0 分封底时不再产生"越输越不痛"的错觉。
 */
export function eloDelta(myScore, foeScore, win) {
  const e = 1 / (1 + 10 ** ((foeScore - myScore) / 400));
  const d = ELO_K * (win ? 1 - e : -e);
  const r = Math.round(d);
  if (r === 0) return d > 0 ? 1 : -1;
  return r;
}

/**
 * 结算一场：直接把分数写回角色，返回 UI 需要的全部变化。
 * 升段/降段用于结算页的高亮（"晋升白银！"）。
 */
export function applyArenaResult(ch, foeScore, win) {
  if (!ch) return null;
  const before = scoreOf(ch);
  const delta = eloDelta(before, Math.max(0, Math.round(Number(foeScore) || 0)), !!win);
  const after = Math.max(0, before + delta);
  ch.arenaScore = after;
  const rankBefore = rankOf(before);
  const rank = rankOf(after);
  return {
    before,
    after,
    delta,
    rank,
    rankBefore,
    promoted: rank.id !== rankBefore.id && delta > 0,
    demoted: rank.id !== rankBefore.id && delta < 0,
  };
}

/** 本地日期键：每日奖励按"玩家所在的那一天"算，不按 UTC */
export function dayKey(now) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 某角色今天的奖励状态。meta.arenaDaily 是账号级账本：
 * `{ day: '2026-11-08', claimed: [charId, …] }`，跨天时 claimed 作废重记。
 */
export function dailyState(meta, ch, now) {
  const day = dayKey(now);
  const rank = rankOf(scoreOf(ch));
  const book = meta?.arenaDaily;
  const claimed = !!(book && book.day === day && Array.isArray(book.claimed) && book.claimed.includes(ch.id));
  return { day, claimed, gold: rank.daily, rank };
}

/** 领取每日段位奖励。死亡角色在 UI 层就不该出现按钮，这里再拦一道 */
export function claimDaily(meta, ch, now) {
  if (!meta || !ch) return { ok: false, reason: '参数缺失' };
  if (ch.status === 'dead') return { ok: false, reason: '这个角色已经不在了' };
  const st = dailyState(meta, ch, now);
  if (st.claimed) return { ok: false, reason: '今天已经领过了' };

  if (!meta.arenaDaily || meta.arenaDaily.day !== st.day) {
    meta.arenaDaily = { day: st.day, claimed: [] };
  }
  meta.arenaDaily.claimed.push(ch.id);
  meta.gold += st.gold;
  return { ok: true, gold: st.gold, rank: st.rank };
}

/**
 * 排行榜：玩家转正角色 + 幽灵池混排。
 * 幽灵分数是预置的（760~1580），爬过 1580 就是全场第一。
 * 同分按名字稳定排序，避免每次渲染排名跳来跳去。
 */
export function ladderOf(meta) {
  const rows = [];
  for (const c of meta?.roster || []) {
    if (!c || c.status === 'dead' || !c.veteran) continue;
    rows.push({ id: c.id, name: c.name, score: scoreOf(c), mine: true });
  }
  for (const g of meta?.ghosts || []) {
    if (!g || !g.deck) continue;
    rows.push({ id: g.id, name: g.name, score: scoreOf(g), mine: false });
  }
  rows.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/** 某角色在榜上的位置：`{ rank, total }`；不在榜（没转正/已死）返回 null */
export function rankOfChar(meta, ch) {
  if (!ch) return null;
  const rows = ladderOf(meta);
  const hit = rows.find((r) => r.id === ch.id);
  return hit ? { rank: hit.rank, total: rows.length } : null;
}
