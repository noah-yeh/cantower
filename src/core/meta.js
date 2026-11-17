/**
 * 大厅状态 —— 金币、名册、招募候选、幽灵库、墓地
 *
 * 这一层只做"资源与集合"的增删，不碰战斗。探险由 run.js 跑，
 * 结束后的结算由 meta 的 settle* 系列写回。
 */

import { Rng } from './rng.js';
import {
  createCharacter, rollCandidate, hasRoom, PROBATION_LIMIT, VETERAN_LIMIT, ROSTER_LIMIT,
  ARENA_MAX,
} from './roster.js';
import { CLASSES } from './characters.js';
import { CARDS, GENERIC_CARD_IDS, parseCard } from './cards.js';
import { RELICS, grantRelic, ownedRelicIds, relicAvailableFor, pickRelicByRarity } from './relics.js';
import { GROWTH, MAX_LEVEL } from './leveling.js';
import { unequipAllOf, equippedSnapshot } from './equipment.js';
import { ARENA_START_SCORE, rankOf, scoreOf } from './arena-rank.js';
import { defaultRaceState, reviveRaceState, unlockedRaces, raceState, RACE_START } from './races.js';

/* ---------------- 经济常量（初版，待 meta-sim 校准） ---------------- */
export const START_GOLD = 200;
export const RECRUIT_COST = 100;
export const REFRESH_COST = 20;
export const MATERIAL_PER_RELIC = 3;
export const GOLD_PER_FLOOR = 1;
export const CLEAR_BONUS = 30;
export const ARENA_BASE = 8;
export const ARENA_PER_RATING = 0.06;
/**
 * 竞技场奖励的评级封顶。
 *
 * v0.5 把等级计入评级后，一个满级角色的评级从 ~250 涨到 ~700+，
 * 竞技场单胜奖励跟着从 20 金涨到 50 金 —— 金币直接通胀到 7 万。
 * 奖励不该随"角色有多强"线性膨胀，封在 200 档（单胜 8 + 12 = 20 金）。
 */
export const ARENA_RATING_CAP = 200;
/* 额度本身定义在 roster.js（角色身上的份额），这里只做对外转出 */

/* ---------------- 招募名额（v3.5：一次看一个） ---------------- */
/**
 * 招募名额上限。
 *
 * 旧版是 6 个常驻席位 + 每位独立冷却，玩家可以同时"浏览"6 个候选。
 * v3.5 改成**一次只出一个**：点招募消耗 1 个名额，看到的人要么花金币雇下，
 * 要么让他离开，处理完才能再点。名额是这条线唯一的闸门。
 */
export const RECRUIT_CAP = 10;
/**
 * 名额恢复速度。10 分钟 +1，存满 10 个就停产（不做离线累积）。
 *
 * 节奏对齐：一次探险 20~30 分钟，回来时正好多 2~3 个名额 —— 死一个人想补，
 * 通常够用；想连刷十几个挑最优种族，就会被这个数拦住。
 */
export const RECRUIT_REGEN_MS = 10 * 60 * 1000;
/** 开局给满：新玩家第一件事是招人，不该先等 10 分钟 */
export const RECRUIT_START = RECRUIT_CAP;

/**
 * v8（v3.35）：新增 `arenaDaily` / `starter` 字段与角色的 `arenaScore`。
 * 全是**新增**，旧档一律走 reviveMeta 补齐 —— 金币、名册、段位分缺省都按规则给。
 */
export const SAVE_VERSION = 8;
/**
 * 局内存档版本（独立于大厅）。
 *
 * v3.5 只改了大厅的招募结构，run 的字段一个没动 —— 跟着 SAVE_VERSION 一起升
 * 会让正在塔里的那趟探险读不出来（loadRun 严格比对版本）。玩家不该因为
 * "招募改了个按钮"就丢一次探险。
 */
export const RUN_SAVE_VERSION = 6;

/**
 * 生成一个大厅
 * @param {number} seed 决定候选与幽灵库
 */
export function createMeta(seed = 1) {
  const meta = {
    version: SAVE_VERSION,
    seed,
    gold: START_GOLD,
    roster: [],
    /**
     * 眼前这一位候选（v3.5）：一个角色对象，或 null。
     *
     * 同一时刻**最多只有一个** —— 雇下或让他离开之后才空出来，
     * 空出来才能再花名额点下一次招募。
     */
    candidate: null,
    /** 招募名额：点一次招募消耗 1 个，每 10 分钟恢复 1 个，封顶 RECRUIT_CAP */
    tickets: RECRUIT_START,
    /** 上一段计时起点：满额时停工（时间不累积），消耗一个名额的瞬间重新起算 */
    ticketAt: 0,
    ghosts: [],
    graveyard: [],
    /**
     * 装备库（v2.3）：账号级资产。
     *
     * **不进角色的 initial 快照**，所以阵亡回滚碰不到它 ——
     * 进塔捡到就永远是你的，这是"冒险失败也能把装备带出来"的实现方式。
     * 每件 `{ id, defId, lv, by }`，`by` 是穿戴者的角色 id（null = 在库里）。
     */
    equipment: [],
    /** 星屑（v2.3）：强化装备的唯一材料，由庄园产出，不放在角色身上 */
    stardust: 0,
    /** 星屑碎片（v2.3b）：回收重复装备得碎片，10 个合成 1 星屑 */
    shards: 0,
    /** 庄园（v2.3）：退役的转正角色，按时间产星屑 */
    manors: [],
    /**
     * 广告位记账：`{ day: '2026-11-04', used: 2, boxUsed: 0 }`。
     * `day` 不是今天时按 0 次算（懒重置），由 ads.adState 处理。
     * `used` 是金币位、`boxUsed` 是碎片宝箱位，两个额度分开算。
     */
    ads: { day: '', used: 0, boxUsed: 0 },
    /**
     * 种族养成（v3.89）：`{ stone: { unlocked, level, shards }, ... }`。
     * 开局只解锁石头人，其余靠广告宝箱攒碎片解锁/升级，等级抬高招募的属性区间。
     */
    races: defaultRaceState(),
    /**
     * 命数之种（v3.90）：商城古币宝箱 10% 掉落的消耗品，在角色详情页使用，
     * 给一位名册角色 +1 命数（封顶种族命数 +2）。账号级，可囤。
     */
    lifeSeeds: 0,
    activeCharId: null,
    run: null,
    counter: 0,
    log: [],
  };

  tickRecruit(meta, 0);
  meta.ghosts = buildGhostPool(seed);

  /**
   * 每日段位奖励账本（v3.35）：`{ day: 'YYYY-MM-DD', claimed: [charId] }`。
   * day 为空串表示"今天还没记过"，领取时写入。
   */
  meta.arenaDaily = { day: '', claimed: [] };

  /**
   * 初始转正角色（v3.35）：新档自带一位随机组合的 1 级转正角色（略弱）。
   * 段位/排名/每日奖励都是局外玩法 —— 没有这个角色，新玩家第一次点开
   * 竞技场只会看到"还没有转正角色"，什么都测不了。
   * `starter` 标记防止老档被重复赠送。
   */
  const starter = makeStarter(seed);
  meta.roster = starter ? [starter] : [];
  meta.activeCharId = starter ? starter.id : null;
  meta.starter = !!starter;
  return meta;
}

/**
 * 捏一个"稍微比较弱"的初始转正角色。
 *
 * 弱化只有一处：血量 / 攻击 ×0.9（用户：「稍微比较弱的，我用来测试」）。
 * 等级 1、卡组 10 张保持招募原样 —— 再弱就连最低段位的陪练都打不过了。
 * 回滚基准 `initial` 必须同步成弱化后的值：阵亡回到的应该是同一个弱版，
 * 不是"弱版打上去、死了变回满血版"。
 */
function makeStarter(seed) {
  const rng = new Rng((seed ^ 0x51ed270b) >>> 0);
  const cls = rng.pick(Object.keys(CLASSES));
  /**
   * 种族固定为开局开放的那个（v3.89）。
   *
   * 原来这里是四族随机，和"只开放石头人"直接打架：新档送的角色可能是余烬族，
   * 而余烬族的碎片一块都没有 —— 玩家一进游戏就拿到一个"官方送但我解锁不了"的角色，
   * 图鉴里还锁着，说不通。职业仍然随机，保留组合的新鲜感。
   */
  const race = RACE_START;
  const ch = createCharacter({ classId: cls, raceId: race, seed: (seed * 92821 + 11) >>> 0, raceLevel: 0 });
  ch.veteran = true;
  ch.status = 'idle';
  /** 转正福利与活着归来同口径：次数给满（arenaDay 留空 = 今天还没结算过） */
  ch.arenaLeft = ARENA_MAX;
  ch.arenaDay = '';
  ch.arenaScore = ARENA_START_SCORE;
  ch.maxHp = Math.max(1, Math.round(ch.maxHp * 0.9));
  ch.atk = Math.max(1, Math.round(ch.atk * 0.9));
  ch.initial = { ...ch.initial, maxHp: ch.maxHp, atk: ch.atk };
  return ch;
}

/** 候选的随机种子：递增序号保证每次刷新不重复 */
function nextCandidate(meta) {
  meta.counter += 1;
  /**
   * v3.89：只从**已解锁**的种族里出候选，掷点按该种族等级抬区间。
   * 没解锁的种族不该在招募里出现 —— 那是"看得见招不到"，比不显示更让人困惑。
   */
  return rollCandidate((meta.seed + meta.counter * 7919) >>> 0, {
    raceIds: unlockedRaces(meta),
    raceLevelOf: (id) => raceState(meta, id).level,
  });
}

/**
 * 兜底：旧档 / 外部构造的 meta 可能还带着 v6 的 `candidates` / `slotReadyAt`。
 *
 * 正规迁移在 save.js 里做，这里只保证"字段一定存在且类型对"——
 * core 里所有招募函数都从这里过一道，脏数据不该让大厅白屏。
 */
function ensureRecruit(meta) {
  if (!('candidate' in meta)) {
    /** 旧档：把第一个还站着的候选接过来，别让他凭空消失 */
    const old = Array.isArray(meta.candidates) ? meta.candidates.find((c) => c && c.id) : null;
    meta.candidate = old || null;
  }
  if (meta.candidate && (!meta.candidate.id || meta.candidate.status === 'dead')) meta.candidate = null;
  if (!Number.isFinite(Number(meta.tickets))) meta.tickets = RECRUIT_START;
  meta.tickets = Math.max(0, Math.min(RECRUIT_CAP, Math.floor(meta.tickets)));
  if (!Number.isFinite(Number(meta.ticketAt))) meta.ticketAt = 0;
  /** 旧字段别再写回存档 */
  delete meta.candidates;
  delete meta.slotReadyAt;
}

/**
 * 推进名额恢复。
 *
 * 这是唯一"产生名额"的入口 —— 招募、离线回来都走它。
 * **存满就停产**：满额期间流逝的时间不累积（和庄园的 stored 同一个规矩），
 * 否则离线一天回来直接多出 144 个名额，机制等于不存在。
 *
 * @returns {number} 本次补了几个名额
 */
export function tickRecruit(meta, now) {
  ensureRecruit(meta);
  if (meta.tickets >= RECRUIT_CAP) return 0;
  const elapsed = Math.max(0, now - meta.ticketAt);
  const gain = Math.floor(elapsed / RECRUIT_REGEN_MS);
  if (gain <= 0) return 0;

  const add = Math.min(gain, RECRUIT_CAP - meta.tickets);
  meta.tickets += add;
  /** 补齐后满额 → 计时清零；没满则把已用掉的整段推进，余数留给下一次 */
  meta.ticketAt = meta.tickets >= RECRUIT_CAP ? now : meta.ticketAt + gain * RECRUIT_REGEN_MS;
  return add;
}

/** 距下一个名额还有多久（毫秒）；已满额时 0 */
export function nextTicketIn(meta, now) {
  ensureRecruit(meta);
  if (meta.tickets >= RECRUIT_CAP) return 0;
  const passed = Math.max(0, now - meta.ticketAt);
  return Math.max(0, RECRUIT_REGEN_MS - (passed % RECRUIT_REGEN_MS));
}

/** 人话版倒计时：`m:ss` */
export function fmtDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ *
 * 招募（v3.5：一次只出一个，雇下或让他离开才算处理完）
 * ------------------------------------------------------------------ */

/** 现在能不能点"招募一位"（不判断金币 —— 金币在雇佣那一步才花） */
export function canRecruit(meta, now = 0) {
  ensureRecruit(meta);
  if (meta.candidate) return { ok: false, reason: '先把眼前这位处理掉（雇佣或让他离开）' };
  if (!hasRoom(meta.roster)) return { ok: false, reason: `实习位已满（${PROBATION_LIMIT} 人）—— 先让实习生转正或退役` };
  if (meta.tickets < 1) {
    const wait = nextTicketIn(meta, now);
    return { ok: false, reason: `招募名额用完了（${fmtDuration(wait)} 后 +1）` };
  }
  return { ok: true };
}

/**
 * 点一次招募：消耗 1 个名额，抽出一位候选。
 *
 * @param {number} now 当前时间戳（core 不读 Date.now）
 */
export function recruitCandidate(meta, now = 0) {
  ensureRecruit(meta);
  tickRecruit(meta, now);

  const check = canRecruit(meta, now);
  if (!check.ok) return check;

  /** 从满额消耗的那一刻起算第一个 10 分钟（满额期间时间不累积） */
  if (meta.tickets >= RECRUIT_CAP) meta.ticketAt = now;
  meta.tickets -= 1;
  meta.candidate = nextCandidate(meta);
  return { ok: true, character: meta.candidate };
}

/** 花金币把眼前这位雇进营地 */
export function hireCandidate(meta) {
  ensureRecruit(meta);
  const ch = meta.candidate;
  if (!ch) return { ok: false, reason: '眼前没有候选人' };
  if (!hasRoom(meta.roster)) return { ok: false, reason: `实习位已满（${PROBATION_LIMIT} 人）—— 先让实习生转正或退役` };
  if (meta.gold < RECRUIT_COST) return { ok: false, reason: `金币不足（需 ${RECRUIT_COST}）` };

  meta.gold -= RECRUIT_COST;
  ch.status = 'idle';
  /**
   * 新招的人**没有竞技场次数**：他要先活着从塔里回来一次才算转正，
   * 额度在 roster.onExploreReturn 里一次性给满。
   */
  ch.arenaLeft = 0;
  ch.arenaDay = '';
  meta.roster.push(ch);
  meta.candidate = null;
  return { ok: true, character: ch, gold: RECRUIT_COST };
}

/**
 * 让他离开：不花钱，也不退名额。
 *
 * 名额不退是刻意的 —— 否则"看完就走"零成本，可以无限刷到满意为止，
 * 这个系统也就没有意义了。想多看几个，代价是下一个 10 分钟。
 */
export function dismissCandidate(meta) {
  ensureRecruit(meta);
  if (!meta.candidate) return { ok: false, reason: '眼前没有候选人' };
  const ch = meta.candidate;
  meta.candidate = null;
  return { ok: true, character: ch };
}

export function canRefresh(meta) {
  if (!meta.candidate) return { ok: false, reason: '眼前没有候选人' };
  if (meta.gold < REFRESH_COST) return { ok: false, reason: `金币不足（需 ${REFRESH_COST}）` };
  return { ok: true };
}

/**
 * 换一位：花小钱重掷**眼前这位**，不消耗招募名额。
 *
 * 金币一局只赚二三十，20 金换一次重看很贵 —— 它救的是"名额已经花掉、
 * 但这个人实在不想雇"的场面，不是给人当抽卡机刷的。
 */
export function refreshCandidate(meta) {
  const check = canRefresh(meta);
  if (!check.ok) return check;
  meta.gold -= REFRESH_COST;
  meta.candidate = nextCandidate(meta);
  return { ok: true, character: meta.candidate, gold: REFRESH_COST };
}

/* ------------------------------------------------------------------ *
 * 结算
 * ------------------------------------------------------------------ */

/** 探险活着回来：按层数给金币，成果保留 */
export function settleExploreWin(meta, ch, floor, cleared) {
  const gain = floor * GOLD_PER_FLOOR + (cleared ? CLEAR_BONUS : 0);
  meta.gold += gain;
  return { gold: gain };
}

/** 探险阵亡：0 金币。命数扣减由 roster.wipeOnDeath 处理 */
export function settleExploreLose() {
  return { gold: 0 };
}

export function settleArenaWin(meta, score) {
  /**
   * v3.35：单胜金币改按段位给（rank.win），替代旧的
   * `8 + min(200, 评级)×0.06`（≈20 固定）—— 段位本身就是强度代理，
   * 高段位赢一场多给钱是正向反馈，低段位少给防白嫖。
   */
  const gain = rankOf(Number(score) || 0).win;
  meta.gold += gain;
  return { gold: gain };
}

/* ------------------------------------------------------------------ *
 * 幽灵库（本地异步 PvP）
 *
 * 预置 15 个对手（v3.35：3 个低段位陪练 + 12 个高段位），外加玩家自己归来的角色快照。
 * 将来接云端时，这里换成 opponents.js 的 fetchPool 即可。
 * ------------------------------------------------------------------ */

const GHOST_SPECS = [
  /* 低段位陪练（v3.35）：3~8 级，让 1 级新人在铁/青铜段位有得打 */
  { classId: 'warrior', raceId: 'ember', tier: 0.55, score: 760 },
  { classId: 'mage', raceId: 'moss', tier: 0.65, score: 830 },
  { classId: 'hunter', raceId: 'shade', tier: 0.7, score: 900 },
  { classId: 'warrior', raceId: 'stone', tier: 0.85, score: 980 },
  { classId: 'warrior', raceId: 'ember', tier: 1.0, score: 1120 },
  { classId: 'warrior', raceId: 'moss', tier: 1.2, score: 1370 },
  { classId: 'mage', raceId: 'shade', tier: 0.9, score: 1030 },
  { classId: 'mage', raceId: 'moss', tier: 1.05, score: 1190 },
  { classId: 'mage', raceId: 'stone', tier: 1.25, score: 1430 },
  { classId: 'hunter', raceId: 'ember', tier: 0.95, score: 1080 },
  { classId: 'hunter', raceId: 'shade', tier: 1.1, score: 1250 },
  { classId: 'hunter', raceId: 'stone', tier: 1.3, score: 1500 },
  { classId: 'traveler', raceId: 'moss', tier: 1.0, score: 1140 },
  { classId: 'traveler', raceId: 'shade', tier: 1.15, score: 1310 },
  { classId: 'traveler', raceId: 'ember', tier: 1.35, score: 1580 },
];

export function buildGhostPool(seed = 1) {
  return GHOST_SPECS.map((spec, i) => {
    const ch = createCharacter({
      classId: spec.classId,
      raceId: spec.raceId,
      seed: (seed * 131 + i * 977 + 13) >>> 0,
    });
    ch.name = `${ch.name}·幽灵`;
    ch.status = 'ghost';
    ch.tier = spec.tier;
    /** 段位分（v3.35）：预置值，随 tier 递增 —— 排行榜与匹配都看它 */
    ch.arenaScore = spec.score;
    // 幽灵默认已激活全部种族宝物（未激活的宝物不该出现在对手身上，和玩家一样）
    ch.relics = [...ch.relics, ...ch.relicSlots];
    ch.relicSlots = [];
    growGhost(ch, spec.tier, (seed * 7919 + i * 131) >>> 0);
    return ch;
  });
}

/**
 * 把预置幽灵"养成"到某个强度（v1.4）。
 *
 * 旧的写法是 `maxHp *= tier; atk *= tier` —— 一个纯缩放系数。
 * 那是折算，不是角色：缩放出来的 380 血 22 攻不来自任何一条成长规则，
 * 卡组还是白板 10 张、宝物还是只有开局那件。1:1 对打之后这种东西一站到
 * 玩家面前就是活靶子（玩家的角色是 8 级、20 张卡、5 件宝物）。
 *
 * 现在改成**走和玩家完全相同的成长路径**推演若干步：
 *   tier → 等级 → 升级表（GROWTH）/ 卡池补牌（通用 + 本职业，同名 ≤2）/ 点亮宝物
 * 于是幽灵也是一个"真打过几层的人"，它的血量是升级加出来的，不是乘出来的。
 */
function growGhost(ch, tier, seed) {
  const rng = new Rng(seed);
  const cls = CLASSES[ch.classId];
  if (!cls) return;

  /**
   * tier → 等级：0.85 → 10 级，1.0 → 13 级，1.35 → 21 级。
   *
   * 下限刻意不是 1 级：**能出现在竞技场里的对手，按世界观都是"转过正的人"**，
   * 而转正的定义就是活着从塔里回来一次 —— 那至少是 10 级上下。
   * 原来给 1~5 级的白板幽灵，等于让玩家去打"刚招募还没进过塔的新人"。
   */
  const levels = Math.max(1, Math.min(MAX_LEVEL, 10 + Math.round((tier - 0.85) * 22)));
  for (let i = 1; i < levels; i++) GROWTH[ch.classId]?.apply(ch);
  ch.level = levels;

  // 卡组：和玩家三选一同一套池子（v2.2：含本族种族套路卡）
  const count = new Map();
  for (const key of ch.deck) {
    const { id } = parseCard(key);
    count.set(id, (count.get(id) || 0) + 1);
  }
  let avail = [...GENERIC_CARD_IDS, ...cls.pool].filter(
    (id) => CARDS[id] && !CARDS[id].race && (count.get(id) || 0) < 2,
  );
  const want = levels * 2;
  for (let i = 0; i < want && avail.length; i++) {
    const id = rng.pick(avail);
    ch.deck.push(id);
    const n = (count.get(id) || 0) + 1;
    count.set(id, n);
    if (n >= 2) avail = avail.filter((x) => x !== id);
  }

  // 宝物：面板型立刻落到数值上（和玩家获得宝物时一致）
  const relicCount = Math.max(1, Math.round(levels / 3));
  const owned = ownedRelicIds(ch.relics);
  /** v3.62：幽灵也守种族专属门槛（月苔圣杯只出现在青苔族幽灵身上），同样按 rarity 加权 */
  const relicPool = Object.keys(RELICS).filter((id) => !owned.has(id) && relicAvailableFor(id, ch.raceId));
  for (let i = 0; i < relicCount && relicPool.length; i++) {
    const id = pickRelicByRarity(rng, relicPool);
    relicPool.splice(relicPool.indexOf(id), 1);
    /** 幽灵也是"真打过几层的人"，基础属性宝物给 1~2 级就够（v3.12） */
    grantRelic({ relics: ch.relics, player: ch }, id, rng.chance(0.35) ? 2 : 1);
  }

  // 评级要按成长后的数值算，否则匹配会挑到错的距离
  ch.tier = tier;
}

/**
 * 从玩家归来的角色里抽一个做对手快照（异步 PvP 的"自己的历史"）
 * 目前只存进 ghosts，供下次匹配。
 */
export function pushGhost(meta, ch, limit = 20) {
  const snap = JSON.parse(JSON.stringify(ch));
  snap.id = `g_${ch.id}_${Date.now().toString(36)}`;
  snap.status = 'ghost';
  snap.name = `${ch.name}·旧影`;
  /**
   * 快照要带上他当时穿的装备（v2.3）。
   * 不带的话，一个穿了两件 +5 的角色在竞技场里会变成"比我强的对手反而没装备"，
   * 镜像战就不再是 1:1 了。
   */
  snap.equipped = equippedSnapshot(meta, ch.id);
  meta.ghosts.push(snap);
  while (meta.ghosts.length > limit + GHOST_SPECS.length) meta.ghosts.shift();
  return snap;
}

/**
 * 挑对手：**真实快照，零缩放**（v1.4）。
 *
 * 旧版按玩家评级把幽灵的 HP/ATK 拉到三个目标值（0.86 / 0.96 / 1.06 倍评级）。
 * 那个"对手"不存在于任何存档里 —— 玩家打的是一个被算出来的数字，
 * 而且缩放只动 HP/ATK，卡组和宝物被缩放法则无视，所以它既不像人也不像怪。
 *
 * 现在直接从库里取**段位分相邻的三个人**：略弱、相当、略强（v3.35 起看分不看评级）。
 * 他们是真的存档（有卡组、有宝物、有等级），赢了就是赢了。
 *
 * 为什么还要"挑"而不是随机抽三个：让玩家有选择权 —— 想稳就打左边那个，
 * 想赌就打右边那个。三档来自库里真实的分布，不是伪造出来的。
 */
export function matchOpponents(meta, score, rng = new Rng(1), n = 3) {
  const pool = (meta.ghosts || []).filter((g) => g && g.deck && g.deck.length);
  if (!pool.length) return [];

  const rated = pool
    .map((g) => ({ g, r: scoreOf(g), tie: rng.next() }))
    .sort((a, b) => a.r - b.r || a.tie - b.tie);

  // 插入点：第一个分数 ≥ 玩家的位置
  let at = rated.findIndex((x) => x.r >= score);
  if (at < 0) at = rated.length;

  const picks = [];
  const push = (x) => {
    if (x && !picks.includes(x.g) && picks.length < n) picks.push(x.g);
  };
  // 先取"相当"这一档，再向两侧各扩一个
  push(rated[at]);
  push(rated[at - 1]);
  push(rated[at + 1]);
  // 库里人少（或都挤在同一边）时向后补满
  for (const x of rated) push(x);

  // 展示顺序：弱 → 强
  return picks.sort((a, b) => scoreOf(a) - scoreOf(b));
}

/** 把死掉的角色移进墓地 */
export function bury(meta, ch) {
  /**
   * 人死了，装备不能陪葬（v2.3）：装备是账号资产，
   * 自动脱回库里，玩家还能给下一个人穿。不脱的话它会永远挂在一个不存在的人身上。
   */
  unequipAllOf(meta, ch.id);
  const i = meta.roster.indexOf(ch);
  if (i >= 0) meta.roster.splice(i, 1);
  if (!meta.graveyard.some((g) => g.id === ch.id)) {
    meta.graveyard.push({
      id: ch.id,
      name: ch.name,
      raceId: ch.raceId,
      classId: ch.classId,
      bestFloor: ch.record?.bestFloor ?? 0,
      exploreCount: ch.record?.exploreCount ?? 0,
      arenaWins: ch.record?.arenaWins ?? 0,
      diedAt: Date.now(),
    });
  }
  if (meta.activeCharId === ch.id) meta.activeCharId = null;
}

export function findCharacter(meta, id) {
  return meta.roster.find((c) => c.id === id) || null;
}

export function idleCharacters(meta) {
  return meta.roster.filter((c) => c.status === 'idle');
}

export { ROSTER_LIMIT, PROBATION_LIMIT, VETERAN_LIMIT, ARENA_MAX };
