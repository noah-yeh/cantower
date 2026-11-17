/**
 * 局内商店（v1.8，v3.13 拆成两家）
 *
 * 两个动机（用户提出）：
 *   1. **杀怪要有局内金币** —— 之前"金币"只在大厅结算时给，塔里打完一层没有任何
 *      即时回报，玩家感觉不到"这一层赚了"。现在每场胜利当场给钱。
 *   2. **商店能用合成出来的水晶材料换宝物** —— 材料原来只有"激活种族宝物"一个出口，
 *      而种族槽位一共就 2 件，第 5 层之后多出来的材料完全没用，锻造也就失去意义。
 *
 * 资源分工是刻意的：
 *   局内金币 → 买卡牌（卡组是"这一趟"的构筑，钱也只在这一趟有意义，死了就没了）
 *   水晶材料 → 买宝物（材料本来就是锻造/合成的产物，直接换成品最顺）
 * 两者不互通 —— 否则"钱多就能为所欲为"，两条资源都会退化成同一种东西。
 *
 * **v3.13 拆店**（用户："宝物商店应该分开，宝物商店出现概率可以低一些"）：
 *   原来一家店同时卖卡和宝物，玩家进店只有一次"看一眼"的机会，
 *   古币到后期就只是躺在包里（一场战斗十几块，卡价六七十，攒着也没别的用）。
 *   现在分成两家、各自上架：
 *     - 行商（CELL.SHOP）：只卖卡，**古币**买，可以用古币刷新货架
 *     - 宝库（CELL.RELIC_SHOP）：只卖宝物，**水晶材料**买，可以用材料刷新
 *   宝物店概率压得更低（约卡店一半）、保底也更长 —— 宝物是"这一趟的稀有收获"，
 *   不该在任意一层随手可得；而卡牌是构筑的日常材料，密度可以高一些。
 *
 * 刷新是**古币的新出口**：成本按次数递增（20 / 35 / 50 …），
 * 材料那侧按用户说的"每次 +1"（1 / 2 / 3 …）。刷不刷得动，等于让玩家自己决定
 * "这堆钱是留着买一张贵的，还是赌两把换一货架"。
 *
 * 商店出现的口径（用户："应该有几率出现"）：
 *   基础概率随层数上升，但**连续 N 层没出就必出**。
 *   纯概率会让一部分种子整局一次商店都碰不到，而商店是这套经济的地基，
 *   不该靠运气决定有没有 —— 但"保底"不能变成"常态"，否则就成了 v3.10 之前
 *   那样每两层一个。
 */

import { CARDS, GENERIC_CARD_IDS, parseCard, cardDrawWeight } from './cards.js';
import { RELICS, RELIC_MAX_LV, relicChain, grantRelic, relicLevelFor, relicLvOf, parseRelic, relicAvailableFor, pickRelicByRarity } from './relics.js';
import { CLASSES } from './characters.js';
import { Rng } from './rng.js';

/**
 * 商店里同时挂几张卡 / 几件宝物。
 *
 * v3.37：卡位 2 → 4（一次看全更好比价）。
 * v3.65：卡位/宝位统一 **6**（用户："所有的商店包括宝库商店，每次刷新可以展示 6 个，
 * 不需要滑动固定屏幕高度"）。宝库从 1 件变 6 件是大改：以前是"刷一次赌一件"，
 * 现在是"从 6 件里挑一件买得起、也真想要的"。材料本来就稀缺（一件 1~5 个），
 * 货架再宽也不会变成自动贩卖机 —— 变的是**选择的主动性**，不是获取速度。
 */
export const SHOP_CARD_SLOTS = 6;
export const SHOP_RELIC_SLOTS = 6;

/** 两家店（v3.13） */
export const SHOP_KIND = { CARD: 'card', RELIC: 'relic' };

/**
 * 出现概率（v3.11 大幅下调）。
 *
 * 旧值 0.22 起步 / 每层 +1.2% / 封顶 50% / 5 层保底，模拟出来是
 * **30 层 12.5 次**（约每 2.4 层一个）—— 玩家反馈"怎么感觉每层都有商店"，
 * 体感是对的：概率判定 + 保底叠在一起，几乎每隔一层就会开张。
 * 商店太密不只是"烦"：卡牌和宝物都从商店大量流入，三选一的取舍被稀释，
 * 金币也没有攒的必要（下两层又能花）。
 *
 * 新值模拟约 **6.7 次 / 30 层**（约每 4.5 层一个），保底拉到 7 层。
 */
export const SHOP_BASE_CHANCE = 0.07;
export const SHOP_CHANCE_PER_FLOOR = 0.006;
export const SHOP_MAX_CHANCE = 0.20;

/**
 * 距上次商店 ≥ 这么多层，则这一层必定开张。
 *
 * v3.13 从 7 拉到 9：拆店之后地图上多了一家宝库，两家合计一度是
 * **11.7 次 / 30 层（每 2.5 层一家）** —— 跟 v3.11 之前那个"每层都有商店"
 * 的体感又撞上了。行商让一档，合计压到 **7~8 次（每 4 层左右一家）**。
 */
export const SHOP_MIN_GAP = 9;

/**
 * 宝库（只卖宝物）出现概率 —— 刻意比行商低一半。
 *
 * 宝物是「这一趟的稀有收获」：一次三连或者一件 5 级基础件，能改变整局的走向。
 * 如果和卡店一个密度，30 层下来能买十几件，选择就退化成"看到就买"。
 * 大约 **2 次 / 30 层**，保底 16 层 —— 一局最少也能碰到一次，运气好两次。
 */
export const RELIC_SHOP_BASE_CHANCE = 0.03;
export const RELIC_SHOP_CHANCE_PER_FLOOR = 0.003;
export const RELIC_SHOP_MAX_CHANCE = 0.09;
export const RELIC_SHOP_MIN_GAP = 16;

/**
 * 刷新费用（v3.13）
 *
 * 古币那侧：30 起，每层 +2.5，每次刷新再 +25（第 20 层约 80 / 105 / 130）。
 *
 * 为什么定这么高：机器人打满 30 层后**中位还剩 1566 古币**（宝箱一趟能给上千，
 * 卡组又有 24 张的软上限）—— 钱根本花不掉。刷新要能真正吃掉这笔余钱，
 * 就得跟一张卡（60~100）同一个量级，而不是十几块的零头。
 *
 * 材料那侧：按用户的原话"每次刷新增加 1 个"，即 1 / 2 / 3 …
 * 材料本来就稀缺（一件宝物 3~5 个），刷两次就等于放弃一件宝物，
 * 这个代价必须疼，否则宝库变成无风险的自动贩卖机。
 */
export const CARD_REFRESH_BASE = 30;
export const CARD_REFRESH_STEP = 25;
/** 每层再加一点：后期一场战斗就给十几块，固定价等于白送 */
export const CARD_REFRESH_PER_FLOOR = 2.5;
export const RELIC_REFRESH_BASE = 1;

/** 每家店的概率参数表（判断 + 保底计时字段都在这里） */
const SHOP_SPEC = {
  [SHOP_KIND.CARD]: {
    base: SHOP_BASE_CHANCE,
    per: SHOP_CHANCE_PER_FLOOR,
    max: SHOP_MAX_CHANCE,
    gap: SHOP_MIN_GAP,
    lastKey: 'lastShopFloor',
  },
  [SHOP_KIND.RELIC]: {
    base: RELIC_SHOP_BASE_CHANCE,
    per: RELIC_SHOP_CHANCE_PER_FLOOR,
    max: RELIC_SHOP_MAX_CHANCE,
    gap: RELIC_SHOP_MIN_GAP,
    lastKey: 'lastRelicShopFloor',
  },
};

/**
 * 宝物按链定价（材料）。
 *
 * 比激活种族槽位的 3 个略贵：激活是"已经属于你的东西，只差材料"，
 * 商店是"直接买一件成品"，而且**不占种族槽位**，本来就该更贵。
 */
export const RELIC_PRICE = { A: 3, B: 4, C: 5, X: 5 };

/**
 * 带等级的宝物定价（v3.40，用户定口径）：**等级 = 水晶数**。
 *
 * 1 级 1 个、2 级 2 个 …… 5 级 5 个，一眼能算清。
 * 之前是"X 链基础价 5 + 每级 1"（5~9 水晶），两件新宝物又单独固定 3 ——
 * 同一格货架上 5 级卖 9 和卖 3 并存，读起来没有规律，所以统一成等级价。
 *
 * 只作用于 `RELICS[id].levels` 存在的 8 件（6 件基础属性件 + 四叶坠 / 血玉心坠）；
 * 不带等级的机制宝物（铁砧、毒龙宝石……）仍按链条基础价，且**不吃等级加价**。
 */
export function leveledRelicPrice(lv = 1) {
  return Math.max(1, Math.min(RELIC_MAX_LV, Math.round(lv) || 1));
}

/** 一场胜利给多少局内金币 */
export function goldFromBattle(floor, tier = 'normal') {
  const base = 3.5 + floor * 0.5;
  const mul = tier === 'boss' ? 2.5 : tier === 'elite' ? 1.5 : 1;
  return Math.round(base * mul);
}

/** 卡价：费用越高、越是 power（永久成长）越贵，随层数微涨 */
export function cardPrice(id, floor = 1) {
  const c = CARDS[id];
  const base = 65 + (c?.cost ?? 1) * 10 + (c?.kind === 'power' ? 15 : 0) + floor;
  return Math.ceil(base / 5) * 5;
}

export function relicPrice(id) {
  return RELIC_PRICE[relicChain(id)] ?? 5;
}

/**
 * 宝库货架上的最终价（v3.40）。
 *
 * - 带等级件：等级即价格（见 leveledRelicPrice）。
 * - 无等级件：链条基础价，不随层数/等级浮动。
 */
export function relicShopPrice(id, lv = 1) {
  const def = RELICS[parseRelic(id).id];
  if (Array.isArray(def?.levels)) return leveledRelicPrice(lv);
  return relicPrice(id);
}

/**
 * 商店用**独立随机流**（种子 + 层数 + salt 派生）。
 *
 * 这个不是洁癖：如果商店判定去消耗主 rng，那么"这一层有没有行商"就会
 * 改写后面所有敌人、奖励和洗牌的序列 —— 同一个种子，多开一次店整局走向全变。
 * 实测把商店接进主 rng 后，400 局的总通关率从 47% 掉到 40~41%，
 * 那不是商店变弱了，是整批种子被推到了另一条分支上。
 *
 * 判定和货架都从这条派生流里取，主流程完全不受影响 ——
 * 关掉商店时，同一 seed 打出来的局和以前一模一样。
 *
 * salt 是 v3.13 为"刷新"加的：同一层刷第二次要拿到**不同**的货，
 * 但又不能去动主 rng，所以拿刷新次数当偏移量。salt=0 就是首次判定/首批货。
 */
export function shopRng(run, salt = 0) {
  let seed = Math.imul(run.seed >>> 0, 0x9e3779b1) ^ Math.imul(run.floor, 0x85ebca6b);
  if (salt) seed = Math.imul(seed ^ (salt + 0x9e37), 0xc2b2ae35);
  return new Rng(seed >>> 0);
}

/**
 * 这一层通关后要不要开某家店（纯判定，不写状态）
 *
 * 第 1 层不开：玩家还没有任何金币和材料，开了也只能看。
 * kind 默认 'card' —— 老调用方（测试、旧存档路径）不传也还是行商。
 */
export function shouldOpenShop(run, rng, kind = SHOP_KIND.CARD) {
  if (run.floor < 2) return false;
  const spec = SHOP_SPEC[kind] ?? SHOP_SPEC[SHOP_KIND.CARD];
  const gap = run.floor - (run[spec.lastKey] ?? 1);
  if (gap >= spec.gap) return true;
  const chance = Math.min(spec.max, spec.base + run.floor * spec.per);
  return rng.next() < chance;
}

/** 上一次开这家店的层数写回（地图生成时调用） */
export function markShopFloor(run, kind) {
  const spec = SHOP_SPEC[kind] ?? SHOP_SPEC[SHOP_KIND.CARD];
  run[spec.lastKey] = run.floor;
}

/* ------------------------------------------------------------------ *
 * 货架
 * ------------------------------------------------------------------ */

/** 抽卡牌货架（卡池：通用 + 本职业，同名最多 2 张） */
function rollCards(run, rng) {
  const cls = CLASSES[run.classId];

  const count = new Map();
  for (const key of run.deck) {
    const { id } = parseCard(key);
    count.set(id, (count.get(id) || 0) + 1);
  }
  const cardPool = [...GENERIC_CARD_IDS, ...cls.pool].filter(
    (id) => CARDS[id] && !CARDS[id].race && (count.get(id) || 0) < 2,
  );

  const cards = [];
  const taken = new Set();
  for (let i = 0; i < SHOP_CARD_SLOTS; i++) {
    const fresh = cardPool.filter((id) => !taken.has(id));
    if (!fresh.length) break;
    /** 和奖励三选一同一套权重：商店不该变成"把卡组稀释成道具堆"的陷阱 */
    const weights = {};
    for (const id of fresh) weights[id] = cardDrawWeight(cls.pool, id);
    const id = rng.weighted(weights);
    if (!id) break;
    taken.add(id);
    cards.push({ id, price: cardPrice(id, run.floor), sold: false });
  }
  return cards;
}

/**
 * 抽宝物货架。
 *
 * 已经在手上的不能卖：既包括已激活的（run.relics），也包括种族槽里
 * **还没激活**的那些 —— 槽位宝物虽然没生效，但已经有了，买一件重复的
 * 等于让玩家花材料买了个"本来再攒 3 个就能点亮"的东西。
 *
 * v3.12 的唯一例外：基础属性宝物（1~5 级）没满级时还能买，买来就是升级。
 */
function rollRelics(run, rng) {
  const relicPool = Object.keys(RELICS).filter((id) => {
    /** v3.62：种族专属件只对该种族上架（月苔圣杯只给青苔族） */
    if (!relicAvailableFor(id, run.raceId)) return false;
    if ((run.relicSlots || []).includes(id)) return false;
    const owned = relicLvOf(run.relics, id);
    if (owned === 0) return true;
    return !!RELICS[id].levels && owned < RELIC_MAX_LV;
  });
  const relics = [];
  for (let i = 0; i < SHOP_RELIC_SLOTS; i++) {
    const fresh = relicPool.filter((id) => !relics.some((r) => r.id === id));
    if (!fresh.length) break;
    /** v3.62：按 rarity 权重掷 —— 星辉烛台 / 月苔圣杯 0.35，刷脸率降到 1/3 */
    const id = pickRelicByRarity(rng, fresh);
    const lv = relicLevelFor(run.floor, rng);
    /** 带等级件按"等级 = 水晶数"计价（v3.40） */
    relics.push({ id, lv, price: relicShopPrice(id, lv), sold: false });
  }
  return relics;
}

/**
 * 生成货架。kind='card' 只出卡、kind='relic' 只出宝物（v3.13 拆店）。
 *
 * `refreshes` 记这一轮刷了几次，既用于定价，也用于派生随机流。
 */
export function makeShop(run, rng, kind = SHOP_KIND.CARD) {
  const isRelic = kind === SHOP_KIND.RELIC;
  return {
    kind: isRelic ? SHOP_KIND.RELIC : SHOP_KIND.CARD,
    cards: isRelic ? [] : rollCards(run, rng),
    relics: isRelic ? rollRelics(run, rng) : [],
    refreshes: 0,
  };
}

/* ------------------------------------------------------------------ *
 * 刷新
 * ------------------------------------------------------------------ */

/** 下一次刷新要花多少（古币 / 水晶材料） */
export function refreshCost(run) {
  const n = run.shop?.refreshes || 0;
  if (run.shop?.kind === SHOP_KIND.RELIC) return RELIC_REFRESH_BASE + n;
  const raw = CARD_REFRESH_BASE + run.floor * CARD_REFRESH_PER_FLOOR + n * CARD_REFRESH_STEP;
  /** 取整到 5：和卡价同一个口径，商店里不出现 73 这种数 */
  return Math.round(raw / 5) * 5;
}

/**
 * 刷新货架：花掉货币、次数 +1、按新随机流重新上货。
 *
 * 刷新会**丢掉没买的货**（这是它的代价），已买的也已经结算过了，不影响。
 */
export function refreshShop(run) {
  const shop = run.shop;
  if (!shop) return { ok: false, reason: '店里没人' };
  const isRelic = shop.kind === SHOP_KIND.RELIC;
  const cost = refreshCost(run);
  const have = isRelic ? (run.materials || 0) : (run.gold || 0);

  if (have < cost) {
    return {
      ok: false,
      reason: isRelic
        ? `水晶材料不足（刷新需 ${cost}，现有 ${have}）`
        : `古币不足（刷新需 ${cost}，现有 ${have}）`,
    };
  }

  if (isRelic) run.materials -= cost;
  else run.gold -= cost;

  shop.refreshes = (shop.refreshes || 0) + 1;
  const fresh = makeShop(run, shopRng(run, 100 + shop.refreshes), shop.kind);
  shop.cards = fresh.cards;
  shop.relics = fresh.relics;

  return { ok: true, cost, kind: shop.kind, refreshes: shop.refreshes };
}

/* ------------------------------------------------------------------ *
 * 购买
 *
 * 都返回 { ok, reason? }：UI 只负责把 reason 显示出来，不自己判断能不能买。
 * ------------------------------------------------------------------ */

export function buyShopCard(run, index) {
  const item = run.shop?.cards?.[index];
  if (!item) return { ok: false, reason: '没有这件商品' };
  if (item.sold) return { ok: false, reason: '已经买走了' };
  if (run.gold < item.price) {
    return { ok: false, reason: `古币不足（需 ${item.price}，现有 ${run.gold}）` };
  }

  run.gold -= item.price;
  run.deck.push(item.id);
  item.sold = true;
  return { ok: true, kind: 'card', id: item.id, price: item.price };
}

export function buyShopRelic(run, index) {
  const item = run.shop?.relics?.[index];
  if (!item) return { ok: false, reason: '没有这件商品' };
  if (item.sold) return { ok: false, reason: '已经买走了' };
  if (run.materials < item.price) {
    return { ok: false, reason: `水晶材料不足（需 ${item.price}，现有 ${run.materials}）` };
  }

  run.materials -= item.price;
  /** v3.12：走 grantRelic —— 已经有的会升级，面板加成当场落到数值上 */
  const got = grantRelic({ relics: run.relics, player: run.player }, item.id, item.lv || 1);
  if (got?.ok) run.stats.relicsTaken = (run.stats.relicsTaken || 0) + 1;
  item.sold = true;
  return { ok: true, kind: 'relic', id: item.id, lv: got?.lv ?? item.lv ?? 1, price: item.price };
}
