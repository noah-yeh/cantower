/**
 * 角色实体 —— 招募、命数、回滚
 *
 * 这是 v0.4 的核心结构。角色不再是一个"组合 id"，而是一个可存续的对象：
 *   - 招募时掷定属性（±8%），生成随机卡组
 *   - 有命数（招募时掷 5~8，v3.93 前由种族决定）
 *   - 探险阵亡 → 扣 1 命 + 全部成果回滚
 *   - 命归零 → 永久消失
 *
 * 关键不变量：initial 快照。任何"回滚"都必须回到 initial，不允许回到"上一次的状态"，
 * 否则玩家可以靠反复死亡刷出比初始更好的卡组。
 */

import { Rng } from './rng.js';
import { CLASSES, RACES, rollCharacter, CLASS_IDS, RACE_IDS, LIVES_MIN, LIVES_MAX } from './characters.js';
import { CARDS } from './cards.js';
import { ARENA_START_SCORE, dayKey } from './arena-rank.js';

/**
 * 营地容量：**实习 / 转正分开算**（v3.68，用户：「实习的200个上限，转正可以60个上限吧」）。
 *
 * 为什么不再是一个总数：两边走的是完全不同的玩法 ——
 * 实习生只能进塔、转正后只能打竞技场，混在一个 6 人上限里，
 * 攒到 5 个转正老人就再也招不进新实习生（塔没人爬了）。
 * 拆开之后两边互不挤占：招人只看实习位，转正只看转正位。
 *
 * 200 / 60 是"容量"不是"目标"：正常玩很难摸到顶，
 * 这两条线主要是给"收集型玩家"留够仓库，而不是逼玩家去管理。
 */
export const PROBATION_LIMIT = 200;
export const VETERAN_LIMIT = 60;

/** 旧名保留：外部工具（图鉴导出 / 经济模拟）还在按"一个上限"读它 */
export const ROSTER_LIMIT = PROBATION_LIMIT;

/**
 * 竞技场每日次数（v3.93）。
 *
 * 定义在这里而不是 meta.js：它属于"角色身上的一份额度"，
 * 而 meta 依赖 roster（循环依赖），反过来引会成环。
 * meta.js 负责对外转出这个名字，老的 import 路径不用改。
 *
 * v1.1~v3.92 是"3 次上限 + 每 30 分钟回 1 次"的计时恢复 —— 那套东西要求
 * 玩家盯着倒计时（大厅里还挂着「x 分钟后 +1」），实际体验是"想起来才打"，
 * 而额度本身又永远在满/不满之间跳。用户要的是「每日 8 次」：
 * **一天一结算，0 点回满**，没有倒计时、没有半小时提醒，想打就一次打完。
 *
 * 8 次也顺手把竞技场从"零碎补给"变成"每天必做的一条线"：
 * 一场约 20 金，8 场 ≈ 160 金，够一次招募的一多半。
 */
export const ARENA_MAX = 8;

let seq = 0;
function nextId() {
  seq += 1;
  return `ch${Date.now().toString(36)}${seq.toString(36)}`;
}

/**
 * 生成一个角色（也是招募候选）
 *
 * @param {object} opts
 * @param {string} opts.classId
 * @param {string} opts.raceId
 * @param {number} opts.seed   决定属性与卡组的随机种子
 */
export function createCharacter({ classId, raceId, seed = 1, raceLevel = 0 }) {
  const cls = CLASSES[classId];
  const race = RACES[raceId];
  if (!cls || !race) throw new Error(`未知角色组合: ${classId}/${raceId}`);

  const rng = new Rng(seed);
  const roll = rollCharacter(classId, raceId, rng, raceLevel);

  // 卡组：5 张保底 + 随机 4 张职业牌 + 1 张种族卡
  //
  // 起始池要排除 power 牌（奥术强化 / 战吼 / 瞄准 / 植物精华）。
  // 这些是"永久成长"牌，在 30 层的局里收益远高于普通牌：
  // 随机抽到一张就等于白送 30%~40% 攻击力，直接让法师/猎人的通关率翻倍（实测 75%/73%）。
  // 它们应该留在三选一里作为构筑选择，而不是白给。
  const starterPool = cls.pool.filter((id) => CARDS[id]?.kind !== 'power');
  const picks = rng.sample(starterPool, 4);
  const deck = [...cls.core, ...picks, race.card];

  /**
   * 命数（v3.93）：招募时掷 5~8，**不再由种族决定**。
   *
   * 抽取顺序刻意放在卡组抽完之后 —— 这一步只影响命数本身，
   * 放在前面会把同一个种子的卡组洗掉，几十条按种子断言的测试会集体变红，
   * 而那些测试断言的是「卡组里有什么牌」，和命数无关。
   */
  const lives = rng.range(LIVES_MIN, LIVES_MAX);

  const character = {
    id: nextId(),
    name: `${race.name}${cls.name}`,
    raceId,
    classId,
    maxHp: roll.maxHp,
    atk: roll.atk,
    hpRoll: Math.round(roll.hpRoll * 100) / 100,
    atkRoll: Math.round(roll.atkRoll * 100) / 100,
    /**
     * 能量上限（v3.58）：招募时掷 5~8，进塔 / 竞技场都按这个值每回合回能。
     * 写进 initial，阵亡回滚时跟着回到招募那一刻（不能被换装或事件改掉）。
     */
    energy: roll.energy,
    /** v0.6 属性面板四项：招募掷定（职业基础值 ±1），不随升级成长（果实系统留给庄园） */
    def: roll.def,
    crit: roll.crit,
    dodge: roll.dodge,
    recovery: roll.recovery,
    lives,
    maxLives: lives,

    /**
     * 转正标记（v0.8）
     *
     * 新招的人只是"试用"，只能去探险 —— 竞技场这类局外玩法要等他
     * **活着从塔里回来**一次才解锁。理由：竞技场是稳定的金币产出，
     * 如果刚花 100 金招来的人立刻能打，招募就变成了"买一张竞技场门票"，
     * 试错成本和风险都不存在了。
     *
     * 注意它**不进 initial 快照**：转正是身份，不是这一趟的成果，
     * 阵亡回滚时不该被抹掉。
     */
    veteran: false,

    /**
     * 等级与成长（v0.5）
     *
     * 招募出来是 1 级。升级只加本职业那一项，具体加什么由 leveling.GROWTH 决定：
     * 战士→最大生命，法师→知识，猎人→攻击力，旅行家→幸运。
     * 这四个字段是**角色级**的：活着回来就保留，阵亡就跟着 initial 一起回滚。
     */
    level: 1,
    exp: 0,
    knowledge: 0,
    luck: 0,

    /** 已激活宝物：职业自带 1 件 + 探险中点亮的种族宝物 */
    relics: [cls.relic],
    /** 未激活的种族宝物，灰着，要花材料点亮 */
    relicSlots: race.relics.slice(),

    deck,
    /** 宝物激活材料，只在本次探险内有效 */
    materials: 0,

    status: 'idle',
    /**
     * 竞技场次数（v3.93：每天 8 次，跨天回满）。
     *
     * 招募出来是 0 —— 试用期没有局外玩法；转正那一刻才给满 ARENA_MAX。
     * `arenaDay` 是当天的日期键，空串表示"今天还没结算过"（arenaState 直接给满）。
     */
    arenaLeft: 0,
    arenaDay: '',
    record: { bestFloor: 0, exploreCount: 0, arenaWins: 0, arenaLosses: 0 },

    /** 回滚基准 —— 招募那一刻的样子，永不变 */
    initial: {
      maxHp: roll.maxHp,
      atk: roll.atk,
      def: roll.def,
      crit: roll.crit,
      dodge: roll.dodge,
      recovery: roll.recovery,
      energy: roll.energy,
      level: 1,
      exp: 0,
      knowledge: 0,
      luck: 0,
      deck: deck.slice(),
      relics: [cls.relic],
      relicSlots: race.relics.slice(),
    },
  };

  return character;
}

/** 随机一个候选（种族 × 职业都随机） */
/**
 * 生成一位候选人。
 *
 * v3.89：接受可选的种族范围与等级查询 —— 招募只能出**已解锁**的种族，
 * 且掷点要按那个种族的等级抬高区间。不传 opts 时退回旧行为（全部种族、0 级），
 * 这样老测试与工具脚本不用改。
 *
 * @param {number} seed
 * @param {object} [opts]
 * @param {string[]} [opts.raceIds]     可出现的种族 id（默认全部）
 * @param {(raceId:string)=>number} [opts.raceLevelOf] 取该种族等级
 */
export function rollCandidate(seed, opts = {}) {
  const rng = new Rng(seed);
  const classId = rng.pick(CLASS_IDS);
  const pool = opts.raceIds && opts.raceIds.length ? opts.raceIds : RACE_IDS;
  const raceId = rng.pick(pool);
  const level = Math.max(0, Math.floor(Number(opts.raceLevelOf?.(raceId)) || 0));
  return createCharacter({ classId, raceId, seed: (seed * 2654435761) >>> 0, raceLevel: level });
}

/**
 * 探险阵亡：扣 1 命 + 成果全部回滚
 * @returns {{ dead: boolean, wiped: true }}
 */
export function wipeOnDeath(ch) {
  ch.lives -= 1;
  if (ch.lives < 0) ch.lives = 0;

  ch.maxHp = ch.initial.maxHp;
  ch.atk = ch.initial.atk;
  /**
   * 面板四项也要回滚（v3.12）。它们以前不回滚是因为"面板不会变"，
   * 而基础属性宝物让它可以变了 —— 宝物跟着 initial 一起掉了，数值却留着，
   * 就成了"人死了反而白赚 6 点防御"。
   */
  ch.def = ch.initial.def ?? ch.def ?? 0;
  ch.crit = ch.initial.crit ?? ch.crit ?? 0;
  ch.dodge = ch.initial.dodge ?? ch.dodge ?? 0;
  ch.recovery = ch.initial.recovery ?? ch.recovery ?? 0;
  ch.energy = ch.initial.energy ?? ch.energy ?? 6;
  /** 等级与成长一起回滚 —— 死一次等于这一趟的经验全白拿 */
  ch.level = ch.initial.level ?? 1;
  ch.exp = ch.initial.exp ?? 0;
  ch.knowledge = ch.initial.knowledge ?? 0;
  ch.luck = ch.initial.luck ?? 0;
  ch.deck = ch.initial.deck.slice();
  ch.relics = ch.initial.relics.slice();
  ch.relicSlots = ch.initial.relicSlots.slice();
  ch.materials = 0;

  if (ch.lives <= 0) {
    ch.status = 'dead';
    return { dead: true, wiped: true };
  }
  ch.status = 'idle';
  return { dead: false, wiped: true };
}

/**
 * 探险记录丢了，把人放回待命（v3.9.1）。
 *
 * 什么时候会丢：局内存档（RUN_SAVE_VERSION）与当前版本不符、被浏览器清掉、
 * 或者写盘时被中断。这时 meta.run 还挂着"某某正在塔里"，但真正的 run 已经没了 ——
 * 点「回塔」只会渲染一个没有战斗对象的战斗页，永远卡在"战斗已结束"。
 *
 * 处理原则：这趟本来就没留下任何东西，按**没发生过**算 ——
 * 不扣命、不转正、不回滚属性，只把 status 从 exploring 放回 idle。
 * @returns {boolean} 是否真的复位了一个卡住的人
 */
export function recoverOrphanedRun(ch) {
  if (!ch || ch.status !== 'exploring') return false;
  ch.status = 'idle';
  return true;
}

/**
 * 竞技场失败：只扣命，不回滚
 * @returns {{ dead: boolean, wiped: false }}
 */
export function loseArenaLife(ch) {
  ch.lives -= 1;
  if (ch.lives < 0) ch.lives = 0;
  if (ch.lives <= 0) {
    ch.status = 'dead';
    return { dead: true, wiped: false };
  }
  return { dead: false, wiped: false };
}

/**
 * 探险活着回来：成果保留、**转正**，并给满当天竞技场次数
 *
 * 转正只在这里发生 —— onExploreDeath 走 wipeOnDeath，不给 veteran。
 * 也就是说"第一次探险就死"仍然是试用期，得再爬一次。
 *
 * 转正之后塔就关上了（`canExplore` 会拒绝），这个角色剩下的路只有竞技场。
 */
export function onExploreReturn(ch, floor, roster = null) {
  ch.status = 'idle';
  ch.materials = 0;
  const wasVeteran = !!ch.veteran;
  /**
   * 转正席位已满（v3.68，60 人）：成果照留、命数照在，但人还是实习生 ——
   * 先把一个转正老人退役进庄园，再爬一次就能转。
   * 不传 roster 的旧调用点（测试 / 模拟）一律按"有位子"处理，行为不变。
   */
  const blocked = !wasVeteran && !!roster && !hasRoom(roster, true);
  if (!blocked) {
    ch.veteran = true;
    // 次数在这里才给满：试用期没有局外玩法。arenaDay 留空 = 今天还没结算过，arenaState 按满额算
    ch.arenaLeft = ARENA_MAX;
    ch.arenaDay = '';
  }
  ch.record.exploreCount += 1;
  ch.record.bestFloor = Math.max(ch.record.bestFloor, floor);
  return { promoted: !wasVeteran && !!ch.veteran, promoteBlocked: blocked };
}

/**
 * 阵亡时也记一次探险次数
 *
 * 竞技场次数**完全不碰**：它是每日刷新的资源，跟这一趟的生死无关。
 */
export function onExploreDeath(ch, floor) {
  ch.record.exploreCount += 1;
  ch.record.bestFloor = Math.max(ch.record.bestFloor, floor);
  return wipeOnDeath(ch);
}

/**
 * 中途放弃探险（v1.7）：**和阵亡同一条结算路径**。
 *
 * 为什么放弃必须扣命：不扣的话，这一趟就变成了可以免费重掷的骰子 ——
 * 血量见底、或者三个奖励都不想要时退出去重来，命数就只剩"战斗失败"一个含义。
 * 所以放弃的唯一好处是"提前止损，不用把血打完"，代价和死在塔里一模一样：
 * 扣 1 命 + 这一趟的等级/卡牌/宝物/材料全部作废，也就不可能靠放弃转正。
 *
 * 单独开一个名字而不是让 UI 直接调 onExploreDeath：放弃是玩家主动做的决定，
 * 在代码里应该读得出来，将来要统计"多少人靠放弃止损"也有地方挂。
 */
export function abandonOnExplore(ch, floor) {
  return onExploreDeath(ch, floor);
}

/* ------------------------------------------------------------------ *
 * 竞技场次数：每日刷新（v3.93）
 *
 * 全部函数都把 `now` 作为参数传入 —— core 不读 Date.now()，
 * 这样才能用虚拟时钟在 node 里测"过了午夜会怎样"。
 * 日期键用 arena-rank.dayKey（本地日历日），与每日段位奖励同一套口径。
 * ------------------------------------------------------------------ */

/**
 * 只读：算今天还剩几次，**不写回**。
 *
 * 渲染层每秒都会调它，所以不能有副作用。
 * 跨天（或旧档没有 arenaDay 字段）一律按满额算 —— 纯函数里唯一能表达
 * "今天还没动过"的方式就是不落盘，等 tickArena 去写。
 *
 * @returns {{ left:number, max:number, day:string, full:boolean, fresh:boolean }}
 */
export function arenaState(ch, now = 0) {
  const blank = { left: 0, max: ARENA_MAX, day: '', full: false, fresh: false };
  if (!ch || !ch.veteran) return blank;

  const day = dayKey(now);
  if (ch.arenaDay !== day) {
    return { left: ARENA_MAX, max: ARENA_MAX, day, full: true, fresh: true };
  }
  const left = Math.max(0, Math.min(ARENA_MAX, ch.arenaLeft ?? 0));
  return { left, max: ARENA_MAX, day, full: left >= ARENA_MAX, fresh: false };
}

/** 写回：把跨天重置落进存档。大厅 tick 和进入竞技场前都该调一次 */
export function tickArena(ch, now) {
  const s = arenaState(ch, now);
  if (!ch || !s.day) return s;
  ch.arenaLeft = s.left;
  ch.arenaDay = s.day;
  return s;
}

/**
 * 花掉一次竞技场次数（v3.93：跨天先回满，再扣）。
 * @returns {boolean} 是否扣成功
 */
export function spendArena(ch, now) {
  if (!ch) return false;
  const s = tickArena(ch, now);
  if (!s.day || s.left <= 0) return false;
  ch.arenaLeft = s.left - 1;
  return true;
}

/**
 * 用材料激活一件种族宝物
 * @returns {boolean} 是否成功
 */
export function activateRelic(ch, relicId, cost = 3) {
  const i = ch.relicSlots.indexOf(relicId);
  if (i < 0) return false;
  if (ch.materials < cost) return false;
  ch.materials -= cost;
  ch.relicSlots.splice(i, 1);
  ch.relics.push(relicId);
  return true;
}

/** 角色评级 —— 竞技场匹配与展示用 */
export function ratingOf(ch) {
  return Math.round(
    ch.maxHp * 0.5 +
      ch.atk * 5 +
      ch.deck.length * 2 +
      ch.relics.length * 10 +
      /**
       * 等级必须计入，而且权重不低。
       *
       * 评级只有一个用途：竞技场匹配时找"评级最近的三个人"（v1.4 起不再
       * 用它反推 HP/ATK）。如果等级不值钱，一个升满级、卡组宝物一堆的角色
       * 评级会和 10 级新人差不多，匹配就会给他配到明显更弱的对手。
       * 这里按 1 级 ≈ 20 点折算。
       */
      ((ch.level || 1) - 1) * 20 +
      (ch.knowledge || 0) * 10 +
      (ch.luck || 0) * 3,
  );
}

/**
 * 名册里某一类角色还有没有空位（v3.68：实习 / 转正分开算）。
 *
 * `veteran = false`（默认）看实习位：招募招进来的都是实习生，所以
 * canRecruit / hireCandidate 走的就是这条默认路径。
 * `veteran = true` 看转正位：探险活着回来要占一个转正席。
 */
export function hasRoom(roster, veteran = false) {
  const alive = roster.filter((c) => c.status !== 'dead');
  const n = alive.filter((c) => !!c.veteran === !!veteran).length;
  return n < (veteran ? VETERAN_LIMIT : PROBATION_LIMIT);
}

/**
 * 能不能参加竞技场这类**局外玩法**。
 *
 * 规则的唯一入口：试用期（veteran=false）一律不行。
 * 放在 core 而不是 UI 里，是为了让"未转正不能打竞技场"能被 node --test 直接验证 ——
 * 只写在按钮的 disabled 上，等于规则只存在于浏览器里。
 *
 * `now` 用来判断是否跨天（跨天直接回满）；不传就按 1970 年算 = 当作换了一天。
 */
export function canEnterArena(ch, now = 0) {
  if (!ch) return { ok: false, reason: '角色不存在' };
  if (ch.status === 'dead' || ch.lives <= 0) return { ok: false, reason: '没有命了' };
  if (!ch.veteran) return { ok: false, reason: '还是试用期：先去探险，活着回来才算转正' };
  if (arenaState(ch, now).left <= 0) {
    return { ok: false, reason: `今天的竞技场次数已经打完了（${ARENA_MAX} 次），明天 0 点回满` };
  }
  return { ok: true };
}

/**
 * 能不能进塔探险（v1.1）。
 *
 * **转正之后塔就关上了。** 塔是试用期的试炼场：没转正的人只要还有命就能一直爬，
 * 死了回滚重来，难度不随次数变化（塔只看层数）；活着回来即转正，之后的路只有竞技场。
 */
export function canExplore(ch, activeRun = null) {
  if (!ch) return { ok: false, reason: '角色不存在' };
  if (ch.status === 'dead' || ch.lives <= 0) return { ok: false, reason: '没有命了' };
  if (ch.veteran) return { ok: false, reason: '已经转正，塔不会再为你打开 —— 去竞技场' };
  /**
   * 一次只能有一个人在塔里（v3.9）。
   *
   * meta.run 挂着就说明塔里有人 —— 不管是不是本人。是本人的时候重新开局
   * 会把他正在爬的那一趟整个覆盖掉（进度凭空蒸发），所以同样拒绝，
   * 让玩家走「继续」回塔。
   */
  if (activeRun) {
    return {
      ok: false,
      reason: activeRun.characterId === ch.id
        ? '你已经在塔里了 —— 用「继续」回去'
        : '有人在塔里 —— 一次只能派一个人进塔',
    };
  }
  return { ok: true };
}

/** 存档用：剥掉不需要持久化的字段 */
export function serializeCharacter(ch) {
  return JSON.parse(JSON.stringify(ch));
}

/** 读档用：补齐旧字段，避免旧档缺字段导致崩溃 */
export function reviveCharacter(raw) {
  if (!raw || !raw.raceId || !raw.classId) return null;
  const base = createCharacter({ classId: raw.classId, raceId: raw.raceId, seed: 1 });
  const ch = { ...base, ...raw };
  ch.record = { ...base.record, ...(raw.record || {}) };
  /** 旧档没有升级系统，缺的字段一律按 1 级 / 0 经验补，等价于"还没升过级" */
  ch.level = raw.level ?? 1;
  ch.exp = raw.exp ?? 0;
  ch.knowledge = raw.knowledge ?? 0;
  ch.luck = raw.luck ?? 0;
  ch.initial = { ...base.initial, ...(raw.initial || {}) };
  /**
   * 能量上限（v3.58）：旧档没有这个字段 —— 一律补 6（v3.87 的区间上限），
   * 不能跟着 base 的随机值走。base 是 seed 1 掷出来的样本，
   * 拿它当默认值等于给老角色随机改强度。
   */
  ch.energy = raw.energy ?? raw.initial?.energy ?? 6;
  ch.initial.energy = raw.initial?.energy ?? ch.energy;
  ch.relicSlots = raw.relicSlots || [];
  ch.relics = raw.relics || [];
  /**
   * 转正标记：旧档（v0.7 及以前）没有这个字段，一律按已转正处理。
   * 那些角色早就在名册里、之前也能打竞技场，不该因为一次版本升级被打回试用期。
   * 招募候选不适用这条 —— save.js 恢复候选时会强制写回 false。
   */
  ch.veteran = raw.veteran ?? true;
  /**
   * 竞技场次数（v3.93：计时恢复 → 每日刷新）。
   * arenaDay 留空 = 今天还没结算过，读档后第一次 arenaState / tickArena 会直接给满；
   * 旧档的 arenaNextAt 字段不再读取，留着不碍事（下次存档自然消失）。
   * 旧 arenaLeft 比新上限大时夹到 ARENA_MAX，比 0 小夹到 0 —— 次数不该是负数。
   */
  ch.arenaLeft = raw.arenaLeft == null
    ? (ch.veteran ? ARENA_MAX : 0)
    : Math.max(0, Math.min(ARENA_MAX, raw.arenaLeft));
  ch.arenaDay = typeof raw.arenaDay === 'string' ? raw.arenaDay : '';
  /** 段位分（v3.35）：旧档缺字段按起点（铁 800）补 */
  ch.arenaScore = (() => {
    const v = Number(raw.arenaScore);
    return Number.isFinite(v) ? Math.max(0, Math.round(v)) : ARENA_START_SCORE;
  })();
  return ch;
}
