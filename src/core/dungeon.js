/**
 * 迷雾迷宫层（v2.0）
 *
 * 用户原话：
 *   「下塔可以做层不可思议迷宫的类型，每一层有多少格子，翻开格子才会出现对应的事件，
 *     再点一下才会触发事件，可以有几个敌人，或者事件或者商店，需要全部敌人杀死下
 *     可以进入下一层」
 *
 * 这一层是**纯结构**：怎么排格子、能不能翻、翻开后显示什么。
 * 触发之后要打架 / 开店 / 加血，都由 run.js 决定 —— 那边才知道玩家和奖励。
 * 这么切是为了让"地图规则"能被单测直接验证，不用跑一局。
 *
 * 规则要点（详见 GAME_DESIGN §4.7）：
 *   1. 3×3 = 9 格，入口格开局是明的，其余 8 格都在迷雾里
 *   2. 迷雾（v3.14 重新打开）：只能翻已翻开格的上下左右邻格
 *   3. 一段式：点暗格 = 翻开并当场结算（run.stepCell）；
 *      宝箱/事件是概率出现（各 70%），一层有 3~4 格真的什么都没有
 *   4. 本层敌人没清光就下不去
 */

import { Rng } from './rng.js';
import { makeEnemy, floorTier, MAX_FLOOR } from './enemies.js';
import { shouldOpenShop, markShopFloor, shopRng, SHOP_KIND } from './shop.js';
import { pickEquipDefId } from './equipment.js';
import { QUEST_MAX_FLOOR, QUEST_MAX_PER_RUN } from './talents.js';

export const MAP_W = 3;
export const MAP_H = 3;
export const MAP_CELLS = MAP_W * MAP_H;

export const CELL = {
  EMPTY: 'empty',
  ENEMY: 'enemy',
  TREASURE: 'treasure',
  EVENT: 'event',
  SHOP: 'shop',
  /** 宝库（v3.13）：只卖宝物、用水晶材料结账，和行商是两家店 */
  RELIC_SHOP: 'relicShop',
  STAIRS: 'stairs',
};

/** 格子在地图上显示的字（翻开的格） */
export const CELL_LABEL = {
  [CELL.EMPTY]: '空房间',
  [CELL.ENEMY]: '敌人',
  [CELL.TREASURE]: '宝箱',
  [CELL.EVENT]: '事件',
  [CELL.SHOP]: '行商',
  [CELL.RELIC_SHOP]: '宝库',
  [CELL.STAIRS]: '楼梯',
};

/** 格子图标（CSS 里按 kind 上色） */
export const CELL_ICON = {
  [CELL.EMPTY]: '·',
  [CELL.ENEMY]: '⚔',
  [CELL.TREASURE]: '◆',
  [CELL.EVENT]: '❖',
  [CELL.SHOP]: '⌂',
  [CELL.RELIC_SHOP]: '✦',
  [CELL.STAIRS]: '▼',
};

/**
 * 事件表：触发即生效，没有二次选择。
 *
 * 刻意不做"选项型事件"：一层 1~2 个事件，每次都弹一个选择会打断
 * "翻格 → 打怪 → 翻格"的节奏，而节奏正是迷宫层唯一的价值。
 */
export const EVENTS = {
  spring: { name: '泉眼', text: '掬一口，伤口在收紧', kind: 'heal' },
  altar: { name: '祭坛', text: '石台认下了你的血', kind: 'maxhp' },
  remains: { name: '遗骸', text: '前辈的行囊还没被翻空', kind: 'gold' },
  crystals: { name: '晶簇', text: '敲下来一小把', kind: 'material' },
  trap: { name: '陷阱', text: '地面塌了一块', kind: 'damage' },
  smith: { name: '铁匠', text: '炉子还是热的', kind: 'forge' },
  /**
   * v3.62 星髓神龛：能量上限 +1（夹在 10 的硬顶）。
   * 出现权重单独压低（0.4，其他事件 1）—— 用户要求能量途径"概率不要太大"。
   */
  shrine: { name: '星髓神龛', text: '石缝里的星火仍在明灭', kind: 'energy' },
  /**
   * 付费祭坛（v3.37）：进塔不消失，付一次古币办一次事。
   * 刻意不进「触发即生效」的默认分支 —— 它们要进自选页（phase remove/morph），
   * 而且格子不 done：离开还能回来接着付钱办事，跟商店一个待遇。
   */
  pyre: { name: '焚卡祭坛', text: '火焰只烧多余的牌', kind: 'forge' },
  morph: { name: '变形祭坛', text: '石面映出另一张牌的影子', kind: 'forge' },
  /**
   * v3.72 委托板：触发即接单（不做选择型事件），进度在杀怪 / 出攻击牌 /
   * 下楼的钩子上累加（见 talents.js），完成当场发一枚额外天赋。
   * 有进行中的委托时不再刷出（makeFloorMap 里从事件池剔除）。
   *
   * v3.85（用户：「任务委托只会在前面 6 层出现，可以拒绝，最多一局可以接受
   * 3 个任务」）：只在前几层进池；接满 3 份后不再出现；触发改成委托页
   * （接受 / 婉拒），不再是「触发即接单」。
   * v3.86：用户「扩展到前 8 层都有机会遇到」→ QUEST_MAX_FLOOR 6 → 8。
   */
  herald: { name: '委托板', text: '钉着一张墨迹未干的委托', kind: 'quest' },
};

/**
 * 事件的掷取权重（v3.62）：没列的都是 1。神龛压到 0.4 保持稀有。
 * v3.85：委托板提到 2.5 —— 它只在前几层出现、一局最多接 3 份，
 * 权重仍是 1 的话一局见到的委托板不足 0.5 块（实测 300 局：41% 有、均 0.52），
 * 「最多 3 份」永远用不满。
 * v3.86 扩到前 8 层后实测 400 局：81% 一局至少一块、均 1.51 块
 * （0 块 19% / 1 块 35% / 2 块 30% / 3+ 块 17%），权重维持 2.5。
 */
export const EVENT_WEIGHTS = { shrine: 0.4, herald: 2.5 };

/**
 * 迷雾开关（v3.14 重新打开）
 *
 * 版本沿革，别再走回头路：
 *   v3.12 用户试玩后说"先把翻地砖这个设定先暂时注释掉吧，现场测试感觉翻地砖太费时间了
 *   还没有什么正负反馈" → FOG=false，两段式一起停用。
 *   v3.14 用户想了一下还是留着，但明确补充"没必要每个翻开都有相关的事件，
 *   有些可以是空房间的" —— 也就是说他嫌的不是"翻"这个动作，是**翻开就必须有事**。
 *
 * 所以这次不是简单把开关打回去，而是同时改了两件事：
 *   1. **一段式**：点暗格 = 翻开并当场结算（`run.stepCell`），
 *      不再"先翻开看一眼、再点一下"。一层最多 9 次点击，比旧两段式少一半。
 *   2. **空房间变多**：宝箱和事件从"每层各 1 个"改成概率出现（70%），
 *      一层约有 3~4 格真的什么都没有 —— 翻空是允许的，它本身就是"赌错了"的反馈。
 *
 * 存档里已翻开的格不受影响；旧档（v3.12 全摊开）读进来等于这一层全明，下一层才回到迷雾。
 */
export const FOG = true;

/**
 * 每层几个敌人（v3.12 随机）。
 *
 * 用户："怎么每层都是固定 2 个敌人的，随机性太少了吧"。
 * 旧版写死 2 个（21 层起 3 个），整局 30 层的敌人总数完全一样，
 * 每层的分量也就完全一样 —— 一层顺不顺只取决于敌人模板，不取决于"这层多不多"。
 *
 * 现在 1~20 层 1~3 个、21 层起 2~4 个。**均值刻意等于旧值**（2 / 3），
 * 这样随机性变强的同时不会顺手把难度抬上去 —— 平衡模拟是这么验的。
 */
export const ENEMY_RANGE = { early: [1, 3], late: [2, 4] };

export function enemyCountFor(floor, rng = null) {
  const [min, max] = floor >= 21 ? ENEMY_RANGE.late : ENEMY_RANGE.early;
  return min + (rng ? rng.int(max - min + 1) : 0);
}

export function coords(idx) {
  return { r: Math.floor(idx / MAP_W), c: idx % MAP_W };
}

export function idxOf(r, c) {
  return r * MAP_W + c;
}

/** 上下左右邻格（不含对角） */
export function neighbors(idx) {
  const { r, c } = coords(idx);
  const out = [];
  if (r > 0) out.push(idxOf(r - 1, c));
  if (r < MAP_H - 1) out.push(idxOf(r + 1, c));
  if (c > 0) out.push(idxOf(r, c - 1));
  if (c < MAP_W - 1) out.push(idxOf(r, c + 1));
  return out;
}

function blankCell() {
  return { kind: CELL.EMPTY, revealed: false, done: false, data: null };
}

/**
 * 生成一层地图，并把 rng 状态写回 run。
 *
 * 布局顺序（先放什么很关键）：
 *   楼梯 → 敌人 → 宝箱 → 事件 → 宝库 → 行商
 * 前面的先占位，剩下的自然变成空房间 —— 这样"楼梯永远存在"这条
 * 硬约束不会因为空位不够而被挤掉。两家店排在最后：塞不下时优先砍商店，
 * 而不是砍掉基础供给（宝箱/事件）。
 */
export function makeFloorMap(run) {
  const rng = new Rng(run.rngState);
  const cells = Array.from({ length: MAP_CELLS }, blankCell);

  /** 入口固定左下角：和"从下往上爬"的直觉一致，也让第一屏有个确定的起点 */
  const entry = idxOf(MAP_H - 1, 0);
  cells[entry] = { kind: CELL.EMPTY, revealed: true, done: true, data: { entry: true } };

  const spots = [];
  for (let i = 0; i < MAP_CELLS; i++) if (i !== entry) spots.push(i);
  rng.shuffle(spots);
  let p = 0;
  const take = () => (p < spots.length ? spots[p++] : -1);

  const stairs = take();
  cells[stairs].kind = CELL.STAIRS;

  const tier = floorTier(run.floor);
  const enemies = enemyCountFor(run.floor, rng);
  for (let i = 0; i < enemies; i++) {
    const idx = take();
    if (idx < 0) break;
    /** 第一个敌人吃本层的档位：第 5 层是精英、第 10 层是首领，其余是普通 */
    const t = i === 0 ? tier : 'normal';
    cells[idx].kind = CELL.ENEMY;
    cells[idx].data = { tier: t, enemy: makeEnemy(run.floor, rng, t) };
  }

  /**
   * v3.78：第 30 层（顶层）**必有行商 + 宝库** —— 通关前最后的补给关口，
   * 用户原话「在 30 层一定会有一个卡牌商店一个宝物商店」。
   * 排在宝箱/事件**前面**占位：最坏情况（4 敌 + 双店 + 入口 + 楼梯 = 8 格）
   * 被挤掉的是宝箱/事件，两家店永远都在。普通层的随机商店照旧。
   */
  const finalFloor = run.floor >= MAX_FLOOR;
  if (finalFloor) {
    for (const [kind, kindCell] of [[SHOP_KIND.RELIC, CELL.RELIC_SHOP], [SHOP_KIND.CARD, CELL.SHOP]]) {
      const idx = take();
      if (idx >= 0) {
        cells[idx].kind = kindCell;
        markShopFloor(run, kind);
      }
    }
  }

  /**
   * 宝箱与事件：**概率出现**（v3.14，各自 70%）。
   *
   * 沿革（这个旋钮是整条曲线最敏感的，动之前先读）：
   *   v3.12 迷雾关掉后"全收"，供给必须砍，从 1~2 改成各固定 1 个，通关率回到 51%。
   *   v3.14 迷雾重新打开，但用户明确要求"没必要每个翻开都有相关的事件，有些可以是空房间的"。
   *   于是把"每层必有"松成 70% —— 9 格里平均 3~4 格是真空的，
   *   翻空的概率上来了，"这一下翻到了什么"才有悬念。
   *
   * 注意：掉一个宝箱 ≈ 少 8+层×2 古币，对续航的影响远大于数字看起来那么大。
   * 改完必须跑 `node tools/balance.mjs 40`（640 局），单跑几十局会被方差骗。
   */
  const treasureCount = rng.chance(0.85) ? 1 : 0;
  for (let i = 0; i < treasureCount; i++) {
    const idx = take();
    if (idx < 0) break;
    cells[idx].kind = CELL.TREASURE;
    cells[idx].data = { reward: rollTreasure(run, rng) };
  }

  const eventCount = rng.chance(0.8) ? 1 : 0;
  /**
   * v3.62：事件按权重掷，神龛 0.4、其余 1。每层 0~1 个事件格里，
   * 神龛出现率 ≈ 0.8 × 0.4 / (7 + 0.4) ≈ 4% —— 一局 30 层期望不到 1 次，
   * 配合宝物那边的 0.35 权重，能量途径整体保持稀有。
   */
  const eventWeights = Object.fromEntries(
    Object.keys(EVENTS)
      /**
       * v3.72：已有进行中的委托就不再刷委托板，一份委托没做完不叠第二份。
       * v3.85：委托板只在前 6 层出现（`QUEST_MAX_FLOOR`），且一局接满
       * `QUEST_MAX_PER_RUN`（3）份后也剔除。
       */
      .filter((id) => !(id === 'herald' && (
        run.quest
        || run.floor > QUEST_MAX_FLOOR
        || (run.questsTaken || 0) >= QUEST_MAX_PER_RUN
      )))
      .map((id) => [id, EVENT_WEIGHTS[id] ?? 1]),
  );
  for (let i = 0; i < eventCount; i++) {
    const idx = take();
    if (idx < 0) break;
    cells[idx].kind = CELL.EVENT;
    cells[idx].data = { event: rng.weighted(eventWeights) };
  }

  /**
   * 两家店（v3.13）：宝库（只卖宝物）在前，行商（只卖卡）在后。
   *
   * 9 格地图在"4 敌 + 宝箱 + 事件 + 楼梯 + 入口"时只剩 1 个空位，
   * 两家店不可能都塞进来 —— 让**更稀有的宝库先占位**，行商让位。
   * 被挤掉的那家不更新保底计时（见下面的 markShopFloor），下层继续判，
   * 所以"保底 7 层必有一个行商"这条约束仍然成立。
   *
   * 判定流仍是独立的 shopRng（salt 区分两家店），不消耗主 rng ——
   * 理由见 shop.shopRng 的注释，这是被 800 局模拟打脸过一次的地方。
   */
  if (!finalFloor && shouldOpenShop(run, shopRng(run, 1), SHOP_KIND.RELIC)) {
    const idx = take();
    if (idx >= 0) {
      cells[idx].kind = CELL.RELIC_SHOP;
      markShopFloor(run, SHOP_KIND.RELIC);
    }
  }
  if (!finalFloor && shouldOpenShop(run, shopRng(run), SHOP_KIND.CARD)) {
    const idx = take();
    if (idx >= 0) {
      cells[idx].kind = CELL.SHOP;
      markShopFloor(run, SHOP_KIND.CARD);
    }
  }

  run.floorMap = {
    floor: run.floor,
    w: MAP_W,
    h: MAP_H,
    cells,
    entry,
    stairs,
    enemiesLeft: cells.filter((c) => c.kind === CELL.ENEMY).length,
    /** 当前正在打的格子（战斗中断存档用） */
    activeCell: null,
  };
  /** 关掉迷雾时整层摊开（见文件顶部的 FOG 说明） */
  if (!FOG) unfog(run.floorMap);
  run.rngState = rng.save();
  return run.floorMap;
}

/**
 * 把整层摊开。给 makeFloorMap 和读档用 ——
 * 读档时玩家可能带着"旧版本存下来的未翻开格"，不摊开就会卡住（翻不开也点不动）。
 */
export function unfog(map) {
  if (!map?.cells) return map;
  for (const c of map.cells) c.revealed = true;
  return map;
}

/**
 * 宝箱内容：金币 / 材料 / 治疗 / 装备，按层数缩放。
 *
 * 权重沿革（这条也是被模拟拧出来的，动之前先跑 balance）：
 *   v2.3c  gold 44 / material 26 / heal 18 / equip 2
 *   v3.14  gold 36 / material 22 / heal 32 / equip 2
 *
 * v3.14 大幅上调治疗的原因：迷雾重新打开后，玩家不知道下一格是什么，
 * 经常在低血量时被迫接战（v3.13 全明时可以先清弱怪攒血再打强敌），
 * 通关率从 53% 掉到 41%。**空房间的古币救不了命**（试过，只涨 1 个点），
 * 真正把通关率拉回 46% 的是"宝箱三成多是回血"。
 * 装备权重没动：宝箱约 0.6 件/局，全局 ≈ 2 件，仍在"一局 1~3 件"。
 */
export function rollTreasure(run, rng) {
  const kind = rng.weighted({ gold: 36, material: 22, heal: 32, equip: 2 });
  if (kind === 'equip') return { kind, defId: pickEquipDefId(rng) };
  if (kind === 'material') return { kind, amount: rng.chance(0.3) ? 2 : 1 };
  if (kind === 'heal') return { kind, amount: Math.round(run.player.maxHp * 0.1) };
  return { kind: 'gold', amount: 8 + run.floor * 2 + rng.int(5) };
}

/** 这一格现在能不能翻：没翻开、且至少有一个已翻开的邻格 */
export function canReveal(map, idx) {
  const cell = map?.cells?.[idx];
  if (!cell || cell.revealed) return false;
  return neighbors(idx).some((i) => map.cells[i].revealed);
}

/** 已翻开、还没触发 —— UI 用它区分「这是啥」和「可以点」 */
export function isPending(cell) {
  return !!cell && cell.revealed && !cell.done;
}

/** 翻开一格（不触发）。返回是否成功 */
export function revealCell(map, idx) {
  if (!canReveal(map, idx)) return false;
  map.cells[idx].revealed = true;
  return true;
}

/** 本层还有几个敌人没打 */
export function enemiesLeftOf(map) {
  return map ? map.cells.filter((c) => c.kind === CELL.ENEMY && !c.done).length : 0;
}

export { shouldOpenShop };
