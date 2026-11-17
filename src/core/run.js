/**
 * 爬塔流程 —— 一层一层往上推
 *
 * v2.0：每层不再是"一场战斗"，而是一张**迷雾迷宫地图**（见 dungeon.js）。
 *
 * 状态：
 *   map ──翻格──►（敌人）battle ──► 45% reward ──► map
 *                                              └──► map
 *   map ──楼梯且敌人清光──► 下一层 map … → won / dead
 *
 * 这一层只管流程与数值结算，不碰渲染。
 */

import { Rng } from './rng.js';
import { CARDS, parseCard, cardKey, cardName, GENERIC_CARD_IDS, MAX_FORGE_LEVEL, cardDrawWeight, upgradable } from './cards.js';
import { forge } from './forge.js';
import {
  RELICS, RELIC_VALUE, RELIC_MAX_LV, resolveRelics, applyRelicStats,
  grantRelic, relicAt, relicLevelFor, relicLvOf,
  relicAvailableFor, pickRelicByRarity,
} from './relics.js';
import { buildCharacter, CLASSES, RACES } from './characters.js';
import { MAX_FLOOR, floorTier } from './enemies.js';
import { createBattle, endTurn, endPlayerPhase, enemyStep, playCard, settleBattle } from './combat.js';
import { gainExp, expFromBattle, luckRelicBonus, levelProgress, ENERGY_CAP } from './leveling.js';
import { goldFromBattle, makeShop, shopRng, SHOP_KIND } from './shop.js';
import { EQUIP_IDS, MAX_ENHANCE, equipBonus, equipName, equipDef, EQUIP_RARITY, pickEquipDefId } from './equipment.js';
import {
  makeFloorMap, canReveal, revealCell, enemiesLeftOf, CELL, CELL_LABEL, EVENTS, FOG,
} from './dungeon.js';
import { makeQuestOffer, startQuest, bumpQuest, QUEST_MAX_PER_RUN } from './talents.js';

/**
 * 成长上限 —— v0.5 重写
 *
 * v0.4 用的是"属性最多长到初始的 1.5 倍"，因为当时的成长来自三选一的百分比加成，
 * 没有上限就会指数爆炸（模拟里 60 次行动跑出 86.7% 通关率、1e39 金币）。
 *
 * v0.5 起成长来源换成了两条**固定值**的线：
 *   升级 → 每级只加本职业那一项（战士 +5 生命 / 猎人 +2 攻击 / …）
 *   宝物 → 属性加成
 * 固定值天然就是有上限的（30 层最多升到 17 级左右），不需要再叠一层百分比封顶，
 * 否则会把"猎人 +2 攻击"这种设计意图直接砍掉。
 *
 * **卡组没有张数上限（v1.3）**：玩家想拿多少张就拿多少张。
 * 原来那个 20 张的盖子只干了一件事 —— 从第 10 层之后把奖励位堵死，
 * 逼着三选一退化成治疗。厚度本身就是代价：牌越多，每回合抽到的关键牌越稀。
 * 单个卡牌仍最多拿 2 张（这是"别把卡组刷成一堆同名"的防刷规则，不是厚度上限）。
 *
 * 上限常量随 `run.caps` 一起删掉了。旧存档里残留的 `caps` 字段不读也不报错。
 */

/**
 * 开始一次探险
 *
 * 两种入口：
 *   createRun({ character, seed })           —— 大厅来的角色实体（v0.4 主路径）
 *   createRun({ classId, raceId, seed })     —— 临时组合（测试 / 机器人 / trace）
 *
 * 角色实体路径会带上未激活宝物槽（relicSlots）和材料（materials）。
 * v2.3 起还会带**装备快照**（`equipment` 或角色身上的 `equipped`）——
 * 装备加成只落进这一趟的 run.player，不写进角色本体，
 * 否则每进一次塔就叠一次（活着回来时会再写回角色）。
 */
export function createRun({ classId, raceId, seed = 1, character = null, equipment = null }) {
  const rng = new Rng(seed);

  let ch;
  if (character) {
    const cls = CLASSES[character.classId];
    const race = RACES[character.raceId];
    ch = {
      name: character.name,
      classId: character.classId,
      raceId: character.raceId,
      maxHp: character.maxHp,
      atk: character.atk,
      /** 角色身上已经累积的成长（之前几趟探险升的级），带进这一趟 */
      level: character.level ?? 1,
      exp: character.exp ?? 0,
      knowledge: character.knowledge ?? 0,
      luck: character.luck ?? 0,
      /** v0.6 属性面板：招募时掷定，全程不变 */
      def: character.def ?? 0,
      crit: character.crit ?? 0,
      dodge: character.dodge ?? 0,
      recovery: character.recovery ?? 0,
      /** v3.58：能量上限是角色的招募掷点（v3.87 起 4~6）；旧角色没有这个字段就按 6 */
      energy: character.energy ?? 6,
      deck: character.deck.slice(),
      relics: character.relics.slice(),
      relicSlots: (character.relicSlots || []).slice(),
      perk: { ...cls.perk },
      racePerk: { ...race.perk },
    };
  } else {
    const built = buildCharacter(classId, raceId);
    ch = { ...built, ...built.stats, relicSlots: [] };
  }

  const run = {
    seed,
    rngState: rng.save(),
    characterId: character?.id ?? null,
    classId: ch.classId ?? classId,
    raceId: ch.raceId ?? raceId,
    characterName: ch.name,
    player: {
      hp: ch.maxHp,
      maxHp: ch.maxHp,
      atk: ch.atk,
      /** 印记（中毒/虚弱）叠加层数的乘区，法师主属性 */
      knowledge: ch.knowledge ?? 0,
      level: ch.level ?? 1,
      exp: ch.exp ?? 0,
      strength: 0,
      luck: ch.luck ?? 0,
      /** v0.6 属性面板四项，见 leveling.js 的上限常量 */
      def: ch.def ?? 0,
      crit: ch.crit ?? 0,
      dodge: ch.dodge ?? 0,
      recovery: ch.recovery ?? 0,
      /** v3.58：每回合的能量上限，招募时掷 4~6（v3.87；旧角色按 6） */
      energy: ch.energy ?? 6,
    },
    deck: ch.deck.slice(),
    relics: ch.relics.slice(),
    relicSlots: ch.relicSlots ?? [],
    materials: 0,
    /**
     * 局内金币（v1.8）：杀怪当场给，只能在塔里花（商店买卡）。
     *
     * 和大厅金币（meta.gold）是**两套钱**：大厅金币是跨局的存款，
     * 局内金币是这一趟的战利品，死了就一起蒸发。分开存是为了让"这一层赚了多少"
     * 有即时反馈，同时不给玩家"反复爬塔刷金币"的套利空间。
     */
    gold: 0,
    /** 最近一场给了多少金币，UI 用它弹提示 */
    lastGold: 0,
    /** 当前商店货架（phase === 'shop' 时非空） */
    shop: null,
    /** 上一次开商店的层数，用于保底判定 */
    lastShopFloor: 1,
    /** 上一次进宝库（只卖宝物那家）的层数，各自独立算保底（v3.13） */
    lastRelicShopFloor: 1,
    /** 卡组没有张数上限（v1.3）：想拿多少张拿多少张，厚度自己承担稀释代价 */
    /**
     * 塔不认得"第几次来"（v1.1）。
     *
     * v0.4~v1.0 有 `diffMul = 1 + 探险次数 × 0.55`，本意是"反复爬塔要付代价"。
     * 这个前提本身就是错的：试用期只要有命就会一直来，转正之后又进不来，
     * 难度只该由层数决定 —— 同样的层数、同样的种子，敌人就该一模一样，
     * 剩下的差异全部来自 roguelike 的随机（模板 / 变异词条 / 出牌顺序）。
     */
    perk: ch.perk,
    racePerk: ch.racePerk,
    /**
     * v3.72 委托与额外天赋：quest 是进行中的委托（talents.js），
     * talents 是这一局拿到的额外天赋 id（run-only，不写回角色）。
     * v3.85：questOffer 是委托板上那张还没回应的纸（phase='quest' 时非空），
     * questsTaken 记这一局已接受几份（上限 QUEST_MAX_PER_RUN=3）。
     * 旧档没有这些字段，读进来按空处理（所有读点都带 || 兜底）。
     */
    quest: null,
    questOffer: null,
    questsTaken: 0,
    lastQuestId: null,
    lastQuestNote: '',
    talents: [],
    floor: 1,
    phase: 'map',
    battle: null,
    reward: null,
    /** 本层的迷宫地图（v2.0），结构见 dungeon.makeFloorMap */
    floorMap: null,
    stats: { floorsCleared: 0, turns: 0, kills: 0, cardsPlayed: 0, relicsTaken: 0, forged: 0, expGained: 0 },
    /** 最近一次经验结算，UI 用它弹"升级"提示 */
    lastLevelUp: null,
    /** 最近一次格子触发的提示文案（宝箱/事件/空房间用） */
    lastCellNote: '',
    /**
     * 装备（v2.3）。`equip` 是快照，`equipBonus` 是它带来的属性合计。
     *
     * 两样都要留在 run 上：
     *   - equip 用来在背包里展示"我这一趟穿了什么"
     *   - equipBonus 用来在**活着回来时把加成减掉**再写回角色
     *     （角色身上只存本体属性，装备永远是外挂的；不减就会每趟叠一次）
     */
    equip: [],
    equipBonus: null,
    /** 刚掉落的装备（精英/首领），UI 负责收进账号装备库 */
    pendingEquip: null,
    history: [],
  };

  /** 装备加成落到这一趟的面板上（不碰角色本体） */
  const eq = (equipment || character?.equipped || [])
    .filter((it) => it && EQUIP_IDS.includes(it.defId))
    .map((it) => ({ defId: it.defId, lv: Math.max(0, Math.min(MAX_ENHANCE, it.lv || 0)) }));
  if (eq.length) {
    const bonus = equipBonus(eq);
    run.equip = eq;
    run.equipBonus = bonus;
    run.player.maxHp += bonus.maxHp || 0;
    run.player.atk += bonus.atk || 0;
    run.player.def += bonus.def || 0;
    run.player.crit += bonus.crit || 0;
    run.player.dodge += bonus.dodge || 0;
    run.player.recovery += bonus.recovery || 0;
    /** 上限涨了，开局血量也要跟着涨满，否则穿了皮甲反而"血条更稀" */
    run.player.hp = run.player.maxHp;
  }

  applyFloorStart(run, true);
  makeFloorMap(run);
  run.phase = 'map';
  return run;
}

/** 进入新一层时的恢复：种族被动 + 宝物（药囊） */
function applyFloorStart(run, first = false) {
  if (first) return;
  const ratio =
    resolveRelics(run.relics).reduce((s, r) => s + (r.floorHeal || 0), 0);
  if (ratio > 0) {
    const heal = Math.round(run.player.maxHp * ratio);
    run.player.hp = Math.min(run.player.maxHp, run.player.hp + heal);
  }
}

/**
 * 用地图上某一格的敌人开一场战斗（v2.0）。
 *
 * 敌人**深拷贝**进战斗：格子里的原始数据保持满血，
 * 玩家中途退档再进来是"这一格从头打"，而不是接着残血敌人占便宜。
 */
export function startCellBattle(run, idx) {
  const map = run.floorMap;
  const cell = map?.cells?.[idx];
  if (!cell || cell.kind !== CELL.ENEMY || cell.done) {
    return { ok: false, reason: '这里没有敌人' };
  }

  map.activeCell = idx;
  const enemy = JSON.parse(JSON.stringify(cell.data.enemy));
  run.battle = createBattle({
    player: run.player,
    enemy,
    /** v2.1：陷阱/事件攒下的「伤口」只在下一场战斗内生效（deck 本来就是拷贝） */
    deck: [...run.deck, ...Array(run.pendingWounds || 0).fill('wound')],
    relics: resolveRelics(run.relics),
    rng: new Rng(run.rngState),
    perk: run.perk,
    racePerk: run.racePerk,
  });
  run.phase = 'battle';
  return { ok: true, tier: enemy.tier, name: enemy.name };
}

/**
 * 读档续战：地图上有 activeCell 就照它重建这一场。
 * save.js 用它，避免把"怎么开一场战斗"的知识复制两份。
 */
export function resumeCellBattle(run) {
  const map = run.floorMap;
  if (!map || map.activeCell == null) return false;
  const res = startCellBattle(run, map.activeCell);
  return res.ok;
}

/** 战斗正在跑的时候，rng 状态要回写到 run，否则存档续不上 */
export function syncBattleRng(run) {
  if (run.battle?.rng) run.rngState = run.battle.rng.save();
}

/** 普通敌人胜利后回多少血（v2.0：一层 2~3 场，必须有层内补给） */
const KILL_HEAL = 0;

/** 本层第 2 场起经验打几折 */
const REPEAT_EXP_MUL = 0.2;

/** 普通敌人掉三选一的概率；精英/首领必掉 */
const NORMAL_DROP = 0.35;

/**
 * 装备掉落的独立随机流（v2.3）。
 * 由种子 + 层数 + 已击杀数派生，天然"每场战斗一条新流"，
 * 又不碰主 rng —— 见 finishBattle 里的说明。
 */
function equipRng(run) {
  return new Rng((((run.seed >>> 0) + run.floor * 7919 + (run.stats.kills || 0) * 131 + 17) >>> 0));
}

/**
 * 战斗结束后调用。返回 'map' | 'reward' | 'won' | 'dead'
 */
export function finishBattle(run) {
  const b = run.battle;
  if (!b) return run.phase;

  const settled = settleBattle(b);
  run.player.hp = settled.hp;
  run.player.atk = settled.atk;
  run.player.strength = settled.strength;
  run.stats.turns += b.turn;
  /** v2.1：伤口只属于"这一场战斗"，打完（无论胜负）就清 —— 保留到战后会让陷阱变成永久削弱 */
  run.pendingWounds = 0;

  if (b.phase === 'lost') {
    run.phase = 'dead';
    run.battle = null;
    return run.phase;
  }

  if (b.phase === 'won') {
    /** 档位跟着**这一格的敌人**走，不再跟着层号走（第 5 层只有一只精英） */
    const tier = b.enemy?.tier ?? floorTier(run.floor);
    run.stats.kills++;
    /** v3.72：讨伐委托进度（完成当场发额外天赋，提示走 lastQuestNote） */
    bumpQuest(run, 'kills', 1, talentRng(run, 1));

    /** 杀怪当场给局内金币（v1.8）：精英 ×1.5、首领 ×2.5，具体见 shop.goldFromBattle */
    const goldGain = goldFromBattle(run.floor, tier);
    run.gold += goldGain;
    run.lastGold = goldGain;

    /**
     * 经验：本层第 1 场全额，之后 35%。
     *
     * 一层现在有 2~3 场战斗，如果每场都给全额，30 层下来经验是原来的 2~3 倍，
     * 等级会从 17 级冲到 30+，整条成长曲线就废了。
     */
    const map = run.floorMap;
    map.killsThisFloor = (map.killsThisFloor || 0) + 1;
    const expMul = map.killsThisFloor === 1 ? 1 : REPEAT_EXP_MUL;
    const expGain = Math.round(expFromBattle(run.floor, tier) * expMul);
    const lv = gainExp(run.player, run.classId, expGain);
    run.stats.expGained += expGain;
    run.lastLevelUp = { expGain, levels: lv.levels, from: lv.from, to: lv.to, gained: lv.gained };

    /** 把这一格标记为已清，并更新剩余敌人计数 */
    if (map.activeCell != null) {
      map.cells[map.activeCell].done = true;
      map.cells[map.activeCell].data = { tier, cleared: true };
      map.activeCell = null;
    }
    map.enemiesLeft = enemiesLeftOf(map);

    /**
     * 搜刮补给：普通战斗胜利回 5% 最大生命。
     * 精英/首领不给 —— 它们的价值是掉落，不该再送续航。
     */
    if (tier === 'normal') {
      const heal = Math.round(run.player.maxHp * KILL_HEAL);
      run.player.hp = Math.min(run.player.maxHp, run.player.hp + heal);
    }

    run.battle = null;

    /**
     * 装备掉落（v2.3c 调率）：精英 10%、首领 60%、普通不掉。
     *
     * 目标"一局 1~3 件"（用户指定）。结构账：首领层是 10/20/30，
     * 平均一局打 2.2 个首领 —— 必掉一项就贡献 2.2 件，所以压到 60%；
     * 精英层 5/15/25，一局约 1.3 个，45% → 10%。
     * 合计战斗 ≈ 1.5 件 + 宝箱（权重 3，≈3.3%）≈ 1.0 件 → 全局 ≈ 2.4 件。
     *
     * 用**独立随机流**（不消耗主 rng），理由和 shopRng 一样：
     * 掉落是"额外奖励"，不该把整局的敌人模板、卡牌三选一一起洗牌 ——
     * 那样每加一个掉落表，既有种子跑出来的局就会全变。
     */
    const eqRng = equipRng(run);
    const eqChance = tier === 'boss' ? 0.60 : tier === 'elite' ? 0.10 : 0;
    if (eqChance > 0 && eqRng.chance(eqChance)) {
      const defId = pickEquipDefId(eqRng);
      const rar = EQUIP_RARITY[equipDef(defId)?.rar || 'common'];
      run.pendingEquip = { defId };
      run.lastCellNote = `战利品：${equipName({ defId })}${rar.label ? `（${rar.label}）` : ''}（已放入装备库，阵亡也不会丢）`;
    }

    /** 掉落：普通 45%、精英/首领必掉（用户："有几率出现不同掉落"） */
    const rng = new Rng(run.rngState);
    const dropped = tier !== 'normal' || rng.chance(NORMAL_DROP);
    run.rngState = rng.save();

    if (dropped) {
      run.reward = buildReward(run, tier);
      run.phase = 'reward';
      return run.phase;
    }

    run.reward = null;
    run.phase = 'map';
    return run.phase;
  }

  return run.phase;
}

/* ------------------------------------------------------------------ *
 * 三选一
 * ------------------------------------------------------------------ */

/** 卡池抽空时，一次三选一给多少材料（激活一件种族宝物要 3） */
const MATERIAL_REWARD = 2;

/**
 * 三选一。
 *
 * v1.2 修掉了三个真 bug（全职业混抽 / 卡组封顶导致三格全治疗 / 治疗不去重）。
 * v1.3 按用户要求把**卡组张数上限整个去掉**：卡池 = 通用卡 + 本职业，
 * 唯一的限制是"同名最多 2 张"。
 * v1.5 把「强化已有卡」从兜底提升为**常规选项**（用户："没拿满也可能出强化的"）：
 *   之前它只在"同名 2 张全拿满、且都强化到 +3"时才会冒出来，等于整局见不到一次 ——
 *   而强化本该是构筑的第二条腿：加牌是"更宽"，强化是"更深"。
 *   两者并存才让玩家真的在做选择，而不是无脑堆厚度。
 *
 * 兜底顺序：目标档 → 卡牌 → 强化 → 宝物 → 治疗 → 材料。
 * 保证任何时候三格都不是重复的空奖励。
 */
function buildReward(run, tier) {
  const rng = new Rng(run.rngState);
  const cls = CLASSES[run.classId];

  // 按"卡 id"计数，强化卡（strike+2）也算 strike；同时记下每张卡的最低强化等级
  const idCount = new Map();
  const lowestLv = new Map();
  for (const key of run.deck) {
    const { id, lv } = parseCard(key);
    idCount.set(id, (idCount.get(id) || 0) + 1);
    if (!CARDS[id]) continue;
    const prev = lowestLv.get(id);
    lowestLv.set(id, prev == null ? lv : Math.min(prev, lv));
  }

  /** 可以强化的卡（同名最低等级还没满 3 级）。v2.2：种族卡也可以强化了。 */
  const upgradePool = [...lowestLv.entries()]
    .filter(([id, lv]) => upgradable(id) && lv < MAX_FORGE_LEVEL)
    .map(([id, lv]) => ({ id, from: lv, to: lv + 1 }));

  /** 同名最多 2 张 —— 这是防"把卡组刷成一堆同名"的规则，跟厚度无关 */
  const cardPool = [...GENERIC_CARD_IDS, ...cls.pool].filter(
    (id) => CARDS[id] && !CARDS[id].race && (idCount.get(id) || 0) < 2,
  );

  /**
   * 宝物池（v3.12）。
   *
   * 两条规则：没拿过的都能出；**基础属性宝物拿过还能出，用来升级**（1~5 级），
   * 升到 5 级就从池子里消失。这样"再抽到一件护腕"不是白拿，而是把它往上推一格。
   */
  const relicPool = Object.keys(RELICS).filter((id) => {
    /** v3.62：种族专属件（月苔圣杯）只对该种族出池 */
    if (!relicAvailableFor(id, run.raceId)) return false;
    const owned = relicLvOf(run.relics, id);
    if (owned === 0) return !(run.relicSlots || []).includes(id);
    return !!RELICS[id].levels && owned < RELIC_MAX_LV;
  });
  const relicWeight = 22 + luckRelicBonus(run.player);
  /**
   * 强化 14（v2.2 从 22 降下来）：祭坛化之后每次强化都能落在**最优卡**上，
   * 而旧版是引擎随机指一张。同样的出现频率，自选目标的收益明显更高 ——
   * 实测 22 的权重下总通关率 61%，降档后回到正常区间。
   *
   * 强化 14 是**常规权重**，不是兜底（v1.5）。
   *
   * 卡牌 52 / 强化 22 / 宝物 22+luck / 治疗 14 —— 大约每两层就会碰到一次强化。
   * 强化不给卡组加厚度，正好也是"这层不想加牌"时最实在的出口。
   */
  const weights = { card: 52, upgrade: 10, relic: relicWeight, heal: 14 };

  const options = [];
  const usedCards = new Set();
  const usedRelics = new Set();
  let healUsed = false;

  const pushUpgrade = () => {
    /** v2.2：不再预掷目标 —— 出「祭坛」选项，选中后进祭坛自选目标 */
    if (!upgradePool.length) return false;
    options.push({ kind: 'upgrade', id: 'altar', label: '强化祭坛' });
    return true;
  };

  const pushCard = () => {
    const fresh = cardPool.filter((id) => !usedCards.has(id));
    const source = fresh.length ? fresh : cardPool;
    /**
     * 职业卡加权（v1.6）。
     *
     * 通用池从 8 张扩到 14 张（加了 6 张一次性道具）之后，通用卡在卡池里
     * 占到了将近一半，**职业卡的密度被压到 52%**。对"单卡即战力"的职业
     * （战士、猎人）影响不大，但对靠机制串联的法师（能量循环）和旅行家（叠毒）
     * 是致命的：它们要靠职业卡彼此配合，通用道具再好也串不起来。
     * 实测加卡后法师 43%→29%、旅行家 44%→33%，而战士反而 46%→55%。
     *
     * 所以给职业卡一个 1.6 倍的抽取权重，把密度拉回 60% 左右（≈加卡前的水平）。
     * 通用卡照样出，只是不再是"每两张就有一张"。
     */
    const weighted = {};
    for (const id of source) weighted[id] = cardDrawWeight(cls.pool, id);
    const id = rng.weighted(weighted);
    if (id) {
      usedCards.add(id);
      options.push({ kind: 'card', id, label: CARDS[id].name });
      return true;
    }
    // 卡池空（每个可用 id 都拿满 2 张）→ 出「强化已有卡」，而不是掉头变成治疗
    return pushUpgrade();
  };

  const pushRelic = () => {
    const fresh = relicPool.filter((id) => !usedRelics.has(id));
    /**
     * v3.62：按 rarity 权重掷（星辉烛台 / 月苔圣杯 0.35，其余 1）。
     * 以前是均匀 pick，新加的稀有件会跟普通件一样刷脸 —— 用户明确要求
     * 能量途径"概率不要太大"。pool 空（fresh 全用过）时也从全池加权掷。
     */
    const id = pickRelicByRarity(rng, fresh.length ? fresh : relicPool);
    if (!id) return false;
    usedRelics.add(id);
    /** 等级按层数掷（v3.12）：深层掉得高，同一层里也有高下 */
    const lv = relicLevelFor(run.floor, rng);
    options.push({ kind: 'relic', id, lv, label: RELICS[id].name });
    return true;
  };

  const pushHeal = () => {
    if (healUsed || run.player.hp >= run.player.maxHp) return false;
    healUsed = true;
    options.push({ kind: 'heal', id: 'heal', label: '治疗' });
    return true;
  };

  const pushMaterial = () => {
    options.push({ kind: 'material', id: 'material', amount: MATERIAL_REWARD, label: `水晶材料 +${MATERIAL_REWARD}` });
    return true;
  };

  for (let i = 0; i < 3; i++) {
    // 第一格强制出卡牌，保证每层至少有一次"加牌"的机会
    const kind = i === 0 ? 'card' : rng.weighted(weights);
    if (kind === 'card' && pushCard()) continue;
    if (kind === 'upgrade' && pushUpgrade()) continue;
    if (kind === 'relic' && pushRelic()) continue;
    if (kind === 'heal' && pushHeal()) continue;
    if (pushCard()) continue;
    if (pushUpgrade()) continue;
    if (pushRelic()) continue;
    if (pushHeal()) continue;
    pushMaterial();
  }

  // BOSS 层额外保证有一个宝物（章节奖励）
  if (tier === 'boss' && !options.some((o) => o.kind === 'relic')) {
    const id = pickRelicByRarity(rng, relicPool.filter((x) => !usedRelics.has(x)));
    if (id) options[2] = { kind: 'relic', id, lv: relicLevelFor(run.floor, rng), label: RELICS[id].name };
  }

  /**
   * 至少保证一格是"不加牌"的选项（v1.3）。
   *
   * 去掉张数上限之后，如果三格可能全是卡牌，就等于"每层被迫加牌"——
   * 30 层下来卡组 39 张，每回合抽 5 张，抽到关键牌的概率被自己稀释掉。
   * 上限取消的前提是"加不加由玩家决定"，所以这里留一个出口。
   *
   * 「强化」也算不加牌（v1.5）：它把已有的一张卡升一级，卡组厚度不变，
   * 所以只要三格里有强化，就已经满足"可以不长大"这个条件了。
   *
   * 顺序是**治疗 → 材料**，不是宝物优先：
   * 宝物一共 16 件、每件都是永久加成，如果每层都能白拿一件，一局下来
   * 能堆到 14 件（实测通关率直接冲到 58%，战士 77%），比卡牌强太多。
   * 治疗和材料才是"这层没有更好的选择"时该拿到的东西。
   */
  if (options.every((o) => o.kind === 'card')) {
    const slot = options.length - 1;
    if (!healUsed && run.player.hp < run.player.maxHp) {
      healUsed = true;
      options[slot] = { kind: 'heal', id: 'heal', label: '治疗' };
    } else {
      options[slot] = {
        kind: 'material', id: 'material', amount: MATERIAL_REWARD, label: `水晶材料 +${MATERIAL_REWARD}`,
      };
    }
  }

  run.rngState = rng.save();
  return { options, tier };
}

export function applyReward(run, index) {
  const opt = run.reward?.options?.[index];
  if (!opt) return false;

  switch (opt.kind) {
    case 'card':
      /** 没有张数上限（v1.3）：拿到就进卡组，不再有"折算成治疗"的降级 */
      run.deck.push(opt.id);
      break;
    /**
     * 强化（v2.2 祭坛化）：不再由引擎代选目标，而是进入强化祭坛 ——
     * 卡组里所有没满级的卡摆出来，玩家自选一张 +1。
     * 强化是卡组里最稀缺的资源，目标选择权应该归玩家。
     */
    case 'upgrade': {
      run.reward = null;
      enterUpgradeAltar(run);
      return true;
    }
    case 'relic': {
      /**
       * v3.12：走 grantRelic，因为它同时处理"第一次拿到"和"重复拿到 = 升级"。
       * 面板型宝物（铁环 +18 生命、护腕 +N 防御）的加成在这里当场落到数值上。
       */
      const got = grantRelic({ relics: run.relics, player: run.player }, opt.id, opt.lv || 1);
      if (got?.ok) run.stats.relicsTaken++;
      break;
    }
    case 'heal': {
      const heal = Math.round(run.player.maxHp * 0.3);
      run.player.hp = Math.min(run.player.maxHp, run.player.hp + heal);
      break;
    }
    case 'material':
      run.materials += opt.amount ?? MATERIAL_REWARD;
      break;
    default:
      break;
  }

  run.reward = null;
  /** v2.0：选完不是"去下一层"，而是回到本层地图继续探 */
  run.phase = 'map';
  return true;
}

/* ------------------------------------------------------------------ *
 * 强化祭坛（v2.2）
 *
 * 奖励里的「强化」与铁匠事件都汇入这里：列出卡组中所有可强化的卡，
 * 玩家自选一张 +1。取消则放弃本次机会回地图（奖励来源已被清，不回奖励页）。
 * ------------------------------------------------------------------ */

/** 卡组中所有可强化的卡（含种族卡 —— v2.2 起种族卡也能强化到 +3） */
export function upgradeCandidates(run) {
  return run.deck.filter((k) => {
    const p = parseCard(k);
    return upgradable(p.id) && p.lv < MAX_FORGE_LEVEL;
  });
}

/** 进入祭坛，落点固定回地图（取消不回奖励页 —— 那一格已经消耗掉了） */
export function enterUpgradeAltar(run) {
  run.upgradeTargets = upgradeCandidates(run);
  run.upgradeReturnPhase = 'map';
  run.phase = 'upgrade';
  return run.upgradeTargets.length > 0;
}

/** 选定强化目标：+1 并回地图。key 必须是卡组里的原始 key（如 'strike+1'） */
export function chooseUpgradeCard(run, key) {
  if (run.phase !== 'upgrade') return false;
  const p = parseCard(key);
  const i = run.deck.indexOf(key);
  if (i < 0 || !upgradable(p.id) || p.lv >= MAX_FORGE_LEVEL) return false;
  run.deck[i] = cardKey(p.id, p.lv + 1);
  run.upgradeTargets = null;
  run.upgradeReturnPhase = null;
  run.phase = 'map';
  return true;
}

/** 取消强化（v3.34：离开不弃单 —— 回地图，祭坛入口还在，随时回来接着选） */
export function cancelUpgrade(run) {
  if (run.phase !== 'upgrade') return false;
  run.phase = 'map';
  return true;
}

/** 从地图重新进入待选的祭坛（离开后可再进，目标列表不变） */
export function reopenAltar(run) {
  if (run.phase !== 'map' || !run.upgradeTargets?.length) return false;
  run.phase = 'upgrade';
  return true;
}

/* ------------------------------------------------------------------ *
 * 付费祭坛（v3.37）
 *
 * 两个都是**花钱办事**的地图事件格，和强化祭坛（白送一次机会）刻意区分：
 *   焚卡祭坛（pyre）→ 付古币从卡组删一张。卡组没有张数上限，但厚度
 *     本身就是代价（关键牌被稀释）；以前唯一的"减厚"出口是硬扛，
 *     现在允许用钱买回来 —— 这也是古币在塔里最贵的一笔开销。
 *   变形祭坛（morph）→ 付古币把一张卡随机变成**同类型同费用**的另一张。
 *     随机，不保底：它是给"这张牌对我没用但又舍不得删"的便宜出口，
 *     定价比焚卡低，赌对了赚、赌错了不亏太多。
 *
 * 待遇与商店一致：格子不 done，离开可再进，状态不变（卡组本身就是状态）。
 * 每次办事单独扣钱，付得起就能一直办 —— 钱多本来就该能多办事。
 * ------------------------------------------------------------------ */

/** 卡组下限：删到这个数就不许再删（没牌的卡组没法打） */
export const MIN_DECK_SIZE = 5;

/** 焚一张卡的价钱：随层数涨（后期一场战斗十几块，固定价等于白送） */
export function removeCost(run) {
  return Math.round((45 + run.floor * 2) / 5) * 5;
}

/** 变形一次的价钱：比焚卡便宜 —— 它是随机的，期望收益低于定向删除 */
export function morphCost(run) {
  return Math.round((30 + run.floor * 2) / 5) * 5;
}

/** 变形池：通用 + 本职业、非种族卡，和商店/奖励同一套口径 */
function morphPool(run, self) {
  const cls = CLASSES[run.classId];
  const count = new Map();
  for (const key of run.deck) {
    const { id } = parseCard(key);
    count.set(id, (count.get(id) || 0) + 1);
  }
  const base = [...GENERIC_CARD_IDS, ...cls.pool].filter((id) => {
    const c = CARDS[id];
    if (!c || c.race || c.kind === 'status') return false;
    if (id === self.id) return false;
    /** 同名上限 2 张：变形不破坏这条规则（少一张再加一张，正好不越界） */
    if ((count.get(id) || 0) >= 2) return false;
    return true;
  });
  const sameKind = base.filter((id) => CARDS[id].kind === self.kind);
  const sameCost = sameKind.filter((id) => CARDS[id].cost === self.cost);
  /** 三级回退：同类型同费用 → 同类型 → 任意（池子小到没得挑时别卡死玩家） */
  if (sameCost.length) return { pool: sameCost, level: 'same' };
  if (sameKind.length) return { pool: sameKind, level: 'kind' };
  return { pool: base, level: 'any' };
}

/**
 * 变形一张卡：随机换成同类型同费用的另一张（强化等级清零）。
 *
 * 等级清零是刻意的：留着 +N 变形等于"先强化便宜卡、再变形成贵卡白赚等级"，
 * 一条纯套利通道；新卡按全新未强化算，玩家自会权衡。
 */
export function morphCardInRun(run, key) {
  if (run.phase !== 'morph') return { ok: false, reason: '这里不是变形祭坛' };
  const i = run.deck.indexOf(key);
  if (i < 0) return { ok: false, reason: '卡组里没有这张牌' };
  const self = parseCard(key);
  const card = CARDS[self.id];
  if (!card) return { ok: false, reason: '这张牌认不出来' };

  const cost = morphCost(run);
  if (run.gold < cost) {
    return { ok: false, reason: `古币不足（变形需 ${cost}，现有 ${run.gold}）` };
  }

  const rng = new Rng(run.rngState);
  const { pool, level } = morphPool(run, { id: self.id, kind: card.kind, cost: card.cost });
  const toId = pool.length ? rng.pick(pool) : null;
  if (!toId) return { ok: false, reason: '没有可变成的牌' };
  run.rngState = rng.save();

  run.gold -= cost;
  run.deck[i] = cardKey(toId, 0);
  const from = card.name;
  const to = CARDS[toId].name;
  const lvTag = level === 'same' ? '同类型同费用' : level === 'kind' ? '同类型' : '随机';
  return { ok: true, from, to, cost, level: lvTag, text: `${from} 变成了 ${to}（${lvTag} · 古币 -${cost}）` };
}

/** 焚掉一张卡：付钱、从卡组移除。卡组在下限时不许再删。 */
export function removeCardInRun(run, key) {
  if (run.phase !== 'remove') return { ok: false, reason: '这里不是焚卡祭坛' };
  const i = run.deck.indexOf(key);
  if (i < 0) return { ok: false, reason: '卡组里没有这张牌' };
  if (run.deck.length <= MIN_DECK_SIZE) {
    return { ok: false, reason: `卡组至少要留 ${MIN_DECK_SIZE} 张牌` };
  }
  const cost = removeCost(run);
  if (run.gold < cost) {
    return { ok: false, reason: `古币不足（焚卡需 ${cost}，现有 ${run.gold}）` };
  }
  run.gold -= cost;
  const name = cardName(key);
  run.deck.splice(i, 1);
  return { ok: true, name, cost, text: `${name} 已投入火中（古币 -${cost}）` };
}

/** 离开付费祭坛：回地图，格子还在原处，随时回来接着办事 */
export function cancelRunAltar(run) {
  if (run.phase !== 'remove' && run.phase !== 'morph') return false;
  run.phase = 'map';
  return true;
}

/**
 * 进入下一层（v2.0：由楼梯格触发）
 *
 * 顺序：记下本层已清 → 层数 +1 → 通关判定 → 层首恢复 → 生成本层地图。
 * 商店不再是"层间拦截"，而是地图上的一个格子（§4.7）。
 */
export function advanceFloor(run) {
  run.stats.floorsCleared = run.floor;
  run.floor++;
  if (run.floor > MAX_FLOOR) {
    run.phase = 'won';
    return true;
  }
  /** v3.72：跋涉委托进度 */
  bumpQuest(run, 'floors', 1, talentRng(run, 3));
  applyFloorStart(run);
  makeFloorMap(run);
  run.phase = 'map';
  /** 上一层的提示（"捡到 3 金币"）不该跟着带到新一层 */
  run.lastCellNote = '';
  return true;
}

/** 离开商店：回到本层地图（商店是格子，不是层间关卡） */
export function leaveShop(run) {
  if (run.phase !== 'shop') return false;
  /**
   * v3.34：货架快照留在格子上（cell.data.shop），离开只是走出店门。
   * 再点同一个格子原样回来 —— 已售出、刷新次数、价格都不变。
   */
  run.shop = null;
  run.phase = 'map';
  return true;
}

/* ------------------------------------------------------------------ *
 * 迷雾迷宫：翻格与触发（v2.0）
 * ------------------------------------------------------------------ */

/**
 * 翻一格。
 *
 * 只是"看见"，不触发。UI 走下面的 `stepCell`（v3.16 两段式：第一下翻、
 * 第二下触发），这个函数保留给读档修复和单测用。
 */
export function revealCellInRun(run, idx) {
  if (!run.floorMap) return { ok: false, reason: '这一层没有地图' };
  if (!FOG) return { ok: false, reason: '这一层不用翻，直接点格子' };
  if (!canReveal(run.floorMap, idx)) return { ok: false, reason: '这里还看不清' };
  revealCell(run.floorMap, idx);
  return { ok: true, cell: run.floorMap.cells[idx] };
}

/**
 * 点一下暗格：**只翻开，不触发**（v3.16 回归两段式）。
 *
 * v3.14 曾把这里做成"翻开并当场结算"的一段式 —— 依据是用户 v3.12 说"翻地砖太费时间"。
 * v3.16 用户改了主意（原话）："不要点开自动触发事件，还是需要人为决策一下"：
 * 翻开先看清是什么，**再点一下才触发** —— 摆在面前的敌人可以绕开先去开宝箱，
 * 这是两段式才有决策价值。点击数回到一层最多 18 下，是用户知情后的取舍。
 *
 * 已翻开的格子（旧存档、或刚被邻格点开的）再点就是触发，不会重复"翻开"。
 */
export function stepCell(run, idx) {
  const cell = run.floorMap?.cells?.[idx];
  if (!cell) return { ok: false, reason: '没有这一格' };
  /** v3.78：终局（won / dead / 战斗中）不许再翻格 —— 30 层点楼梯卡死的那条路 */
  if (run.phase !== 'map') return { ok: false, reason: '这一趟已经结束了' };
  if (FOG && !cell.revealed) {
    const r = revealCellInRun(run, idx);
    if (!r.ok) return r;
    const name = cell.data?.entry ? '入口' : (CELL_LABEL[cell.kind] ?? '未知');
    return { ok: true, kind: 'reveal', cell, text: `翻开了：${name} —— 再点一下触发` };
  }
  return triggerCell(run, idx);
}

/**
 * 触发一格。返回 { ok, kind, text } 或 { ok:false, reason }。
 *
 * 敌人走战斗（phase → battle），行商走 shop，其余当场结算并留在 map。
 */
export function triggerCell(run, idx) {
  /**
   * v3.78：终局防重入。曾出现过"第 30 层点楼梯 → phase 已经 won，
   * 屏幕卡住，再点楼梯层数还在涨（31、32…）"—— 根因是这里不判 phase，
   * UI 又绕过了 afterAction 的终局检查。地图只在 map 阶段可点。
   */
  if (run.phase !== 'map') return { ok: false, reason: '这一趟已经结束了' };
  const map = run.floorMap;
  const cell = map?.cells?.[idx];
  if (!cell) return { ok: false, reason: '没有这一格' };
  /**
   * 迷雾开着时才要求"先翻开"。关掉之后（v3.12）格子开局全明，
   * 这里若还卡 revealed，读档进来遇到旧的未翻格就彻底点不动了。
   */
  if (!cell.revealed && FOG) return { ok: false, reason: '先翻开这一格' };
  if (cell.done) return { ok: false, reason: '这里已经空了' };

  switch (cell.kind) {
    case CELL.ENEMY:
      return startCellBattle(run, idx);

    case CELL.TREASURE: {
      const r = cell.data.reward;
      cell.done = true;
      /** v3.85：寻宝委托 —— 开箱即计数（不论开出金币/材料/装备/治疗） */
      bumpQuest(run, 'treasures', 1, talentRng(run, 5));
      if (r.kind === 'gold') {
        run.gold += r.amount;
        return { ok: true, kind: 'treasure', text: `宝箱：古币 +${r.amount}` };
      }
      if (r.kind === 'material') {
        run.materials += r.amount;
        return { ok: true, kind: 'treasure', text: `宝箱：水晶材料 +${r.amount}` };
      }
      /**
       * 装备（v2.3）：这里只把"捡到了什么"报出去，**入账由 UI 层做**。
       * core 不持有 meta（账号库），也不给 run 加一个"待入库"字段 ——
       * 多一个待办字段就多一条"关页面丢失"的路径。返回即入账，最直。
       */
      if (r.kind === 'equip') {
        const rar = EQUIP_RARITY[equipDef(r.defId)?.rar || 'common'];
        return {
          ok: true,
          kind: 'treasure',
          text: `宝箱：${equipName(r)}${rar.label ? `（${rar.label}）` : ''}（已放入装备库，阵亡也不会丢）`,
          equip: { defId: r.defId },
        };
      }
      const heal = Math.min(r.amount, run.player.maxHp - run.player.hp);
      run.player.hp += heal;
      return { ok: true, kind: 'treasure', text: `宝箱：回复 ${heal} 点生命` };
    }

    case CELL.EVENT: {
      const id = cell.data.event;
      /**
       * 付费祭坛（v3.37）：不结算、不 done —— 进入自选页，
       * 每次办事单独扣钱。离开只是走出石门，格子留在原处可再进。
       */
      if (id === 'pyre' || id === 'morph') {
        run.phase = id === 'pyre' ? 'remove' : 'morph';
        return {
          ok: true,
          kind: 'altar',
          text: id === 'pyre'
            ? `焚卡祭坛：古币 ${removeCost(run)} 焚一张`
            : `变形祭坛：古币 ${morphCost(run)} 变一张`,
        };
      }
      /**
       * v3.85 委托板：进委托页让玩家**接受 / 婉拒**（用户：「可以拒绝」）。
       * 格子当场 done —— 纸只有一张，拿不拿都算揭过去了；
       * 接受/婉拒后回地图，下一份委托要等后面几层里再刷出来（前 8 层内）。
       */
      if (id === 'herald' && !run.quest && (run.questsTaken || 0) < QUEST_MAX_PER_RUN) {
        run.questOffer = makeQuestOffer(run, talentRng(run, 1));
        run.phase = 'quest';
        cell.done = true;
        return { ok: true, kind: 'quest', text: '委托板：钉着一张墨迹未干的委托' };
      }
      const text = applyEvent(run, id);
      cell.done = true;
      return { ok: true, kind: 'event', text: `${EVENTS[id]?.name ?? '事件'}：${text}` };
    }

    case CELL.SHOP:
    case CELL.RELIC_SHOP: {
      /**
       * v3.34：离开还能再进来，货架原样保留。
       *
       * 旧版触发即 `cell.done = true`，离开 = 这家店从此消失 —— 这也是
       * 商店页要摆一个"暂停（货架还在）"按钮的原因。现在货架快照挂在
       * 格子上（cell.data.shop），离开只是走出店门：再点这个格子，
       * 已售出的、刷新次数、价格全都原样回来。下楼后整层重生成，自然作废。
       */
      const kind = cell.kind === CELL.RELIC_SHOP ? SHOP_KIND.RELIC : SHOP_KIND.CARD;
      if (!cell.data?.shop) {
        cell.data = { shop: makeShop(run, shopRng(run, kind === SHOP_KIND.RELIC ? 2 : 0), kind) };
      }
      run.shop = cell.data.shop;
      run.phase = 'shop';
      return {
        ok: true,
        kind: 'shop',
        text: cell.kind === CELL.RELIC_SHOP ? '宝库：石匣里锁着几件旧物' : '行商支起了摊子',
      };
    }

    case CELL.STAIRS: {
      const left = enemiesLeftOf(map);
      if (left > 0) {
        return { ok: false, reason: `还有 ${left} 个敌人挡在楼梯口` };
      }
      advanceFloor(run);
      /** v3.78：30 层下楼 = 通关，别再报"下到第 31 层" */
      return run.phase === 'won'
        ? { ok: true, kind: 'stairs', text: '塔顶到了 —— 这一趟爬完了！' }
        : { ok: true, kind: 'stairs', text: `下到第 ${run.floor} 层` };
    }

    case CELL.EMPTY:
    default: {
      /**
       * 空房间不是纯浪费步数：翻它也在推进迷雾，顺手给点碎钱。
       *
       * v3.14 从 2~5 提到 4~9：一层平均有 3~4 个空房间，如果每个只给两块，
       * 玩家翻空时的感受就是"白点一下"。现在一层空房间合计约 20 古币，
       * 差不多半张卡 —— 翻空有代价但不算亏，这才是"有些格子就是空的"能成立的前提。
       */
      const gold = 4 + (idx % 5);
      run.gold += gold;
      cell.done = true;
      return { ok: true, kind: 'empty', text: `空房间：捡到 ${gold} 古币` };
    }
  }
}

/**
 * v3.72 委托/天赋的确定性掷取：不消耗主 rngState（那是一条被宝箱/商店
 * 共享的流，混进来会把"同种子同局面"的复现打乱），用 seed + 层数 +
 * 击杀数做盐。salt 区分接单 / 发天赋两处。
 */
function talentRng(run, salt) {
  return new Rng((((run.seed >>> 0) + run.floor * 7919 + (run.stats.kills || 0) * 131 + salt * 7717 + 11) >>> 0));
}

/**
 * 事件结算。文案与效果写在一处，避免 UI 自己解释一遍。
 * 上限都夹住了：陷阱不会致死（掉血最多到 1），祭坛不会溢出。
 */
function applyEvent(run, id) {
  const p = run.player;
  switch (id) {
    case 'spring': {
      const heal = Math.min(Math.round(p.maxHp * 0.15), p.maxHp - p.hp);
      p.hp += heal;
      /** 满血时喝泉水 = 白来一趟，必须直说，不然玩家以为坏了 */
      return heal > 0 ? `回复 ${heal} 点生命` : '泉水清冽，但你毫发无伤（无效果）';
    }
    case 'altar': {
      p.maxHp += 6;
      p.hp = Math.min(p.maxHp, p.hp + 6);
      return '最大生命 +6';
    }
    case 'remains': {
      const gold = 12 + run.floor;
      run.gold += gold;
      return `古币 +${gold}`;
    }
    case 'crystals':
      run.materials += 2;
      return '水晶材料 +2';
    /**
     * v3.62 星髓神龛：唯一加能量上限的**事件**。
     * 出现权重 0.4（其他事件都是 1，见 dungeon.js EVENT_WEIGHTS），
     * 且同样夹在 10 的硬顶 —— 满了就白来，文案必须直说。
     */
    case 'shrine': {
      if ((p.energy || 0) >= ENERGY_CAP) {
        return `神龛里的星髓已经无处可栖（能量已达上限 ${ENERGY_CAP}）`;
      }
      p.energy += 1;
      return `星髓入体，能量上限 +1（${p.energy}/${ENERGY_CAP}）`;
    }
    case 'trap': {
      const dmg = Math.max(1, Math.round(p.hp * 0.08));
      const real = Math.min(dmg, p.hp - 1);
      p.hp -= real;
      // v2.1：陷阱不再只扣血 —— 另外把 1 张「伤口」混入下一场战斗的抽牌堆。
      // 纯扣血是个不需要思考的事件；现在它给你一道题：带不带净化、
      // 先打带伤口的那场还是先绕去宝箱。伤口只在下一场战斗内生效，不进永久卡组
      run.pendingWounds = (run.pendingWounds || 0) + 1;
      return real > 0
        ? `失去 ${real} 点生命，「伤口」混入了牌堆（下一场战斗生效）`
        : '你及时收脚，有惊无险，但「伤口」混入了牌堆（下一场战斗生效）';
    }
    case 'smith': {
      // v2.2：铁匠不再代选目标，同样进祭坛自选（无卡可强化时才给金币兑底）
      if (upgradeCandidates(run).length === 0) {
        run.gold += 10;
        return '没有可强化的卡，铁匠给了 10 古币';
      }
      enterUpgradeAltar(run);
      return '铁匠的锻炉燃起来了 —— 选择一张卡强化';
    }
    /**
     * v3.72 委托板：正常路径是 triggerCell 里进委托页（v3.85 起可接受/婉拒）。
     * 这里是兜底 —— 已有委托 / 接满 3 份 / 旧档之类走到 applyEvent，给 8 古币。
     */
    case 'herald': {
      run.gold += 8;
      if (run.quest) return '委托还在身上，先办完这份 —— 翻到 8 古币';
      if ((run.questsTaken || 0) >= QUEST_MAX_PER_RUN) return `这一趟已经接了 ${QUEST_MAX_PER_RUN} 份委托 —— 翻到 8 古币`;
      return '板上只剩些钉孔 —— 翻到 8 古币';
    }
    default:
      return '什么也没发生';
  }
}

/* ------------------------------------------------------------------ *
 * 便捷封装 —— UI / 机器人共用的高层动作
 * ------------------------------------------------------------------ */

export function play(run, handIndex) {
  const b = run.battle;
  if (!b || run.phase !== 'battle') return [];
  const playedId = b.hand[handIndex];
  const events = playCard(b, handIndex);
  syncBattleRng(run);
  /** v3.72：修行委托 —— 只数攻击牌（player 阶段才打得出去，不用管 kind 边角） */
  if (playedId && parseCard(playedId)) {
    const played = CARDS[parseCard(playedId).id];
    if (played?.kind === 'attack') bumpQuest(run, 'atkCards', 1, talentRng(run, 2));
  }
  if (b.phase !== 'player') finishBattle(run);
  return events;
}

export function pass(run) {
  const b = run.battle;
  if (!b || run.phase !== 'battle') return [];
  const events = endTurn(b);
  syncBattleRng(run);
  if (b.phase !== 'player') finishBattle(run);
  return events;
}

/**
 * 玩家回合收场（v3.37）—— 敌人回合改成逐张播放后的第一步。
 *
 * 只做"玩家收场 + 敌人回合开场"，敌人出牌交给 enemyStepPve 一步一步走：
 * 和竞技场 v3.33 同一个思路，敌人不是一瞬间凭空打完的，玩家要能看到它打什么。
 * 同步版 `pass` 保留给模拟 / 测试 / 机器人 —— 数值口径不分裂。
 *
 * @returns {{events:Array, phase:string}} phase='enemy' 表示敌人回合开播
 */
export function endPlayerTurn(run) {
  const b = run.battle;
  if (!b || run.phase !== 'battle') return { events: [], phase: 'map' };
  const r = endPlayerPhase(b);
  syncBattleRng(run);
  /** 敌人回合中不结算战斗；只有打死了人（光合反噬 / 收势毒杀不会发生，但保险）才收 */
  if (b.phase !== 'player' && b.phase !== 'enemy') finishBattle(run);
  return { events: r.events, phase: b.phase };
}

/** 敌人走一步：打一张牌；没得打就收场、跨轮、交回玩家回合。见 combat.enemyStep */
export function enemyStepPve(run) {
  const b = run.battle;
  if (!b || b.phase !== 'enemy') return { done: true, phase: b?.phase ?? 'map', events: [] };
  const s = enemyStep(b);
  syncBattleRng(run);
  if (b.phase !== 'player' && b.phase !== 'enemy') finishBattle(run);
  return { ...s, phase: b.phase };
}

/* ------------------------------------------------------------------ *
 * 委托板（v3.85）：接受 / 婉拒
 *
 * 委托板是唯一的选项型事件 —— 一局最多来 3 次（前 8 层内，v3.86），
 * 每次打断都值得。接受后进 run.quest，进度见 talents.bumpQuest。
 * ------------------------------------------------------------------ */

/**
 * 接受在当前委托板上的那份委托。
 * @returns {{ok:boolean, quest?:object, reason?:string}}
 */
export function acceptQuest(run) {
  if (run.phase !== 'quest') return { ok: false, reason: '现在没有等着回应的委托' };
  if (!run.questOffer) return { ok: false, reason: '委托板已经空了' };
  if (run.quest) return { ok: false, reason: '身上已经有一份委托了，先办完它' };
  if ((run.questsTaken || 0) >= QUEST_MAX_PER_RUN) {
    return { ok: false, reason: `这一趟最多接 ${QUEST_MAX_PER_RUN} 份委托` };
  }
  const q = startQuest(run, run.questOffer);
  if (!q) return { ok: false, reason: '这份委托已经失效了' };
  run.questsTaken = (run.questsTaken || 0) + 1;
  run.questOffer = null;
  run.phase = 'map';
  run.lastCellNote = `接下「${q.name}」——${q.text}（完成得${run.quest.reward}）`;
  return { ok: true, quest: run.quest };
}

/** 婉拒当前的委托（格子已经算揭过了，回地图） */
export function declineQuest(run) {
  if (run.phase !== 'quest') return { ok: false, reason: '现在没有等着回应的委托' };
  const offer = run.questOffer;
  run.questOffer = null;
  run.phase = 'map';
  run.lastCellNote = offer ? `婉拒了「${offer.name}」——这份委托作废` : '你走开了';
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * 合成与宝物激活（v0.4）
 *
 * 这两件事只在探险内发生，且死了全没 —— 这是"赌注"和"存款"的分界线。
 * ------------------------------------------------------------------ */

/**
 * 合成一张卡：两张同名同级 → 一张强化版 + 1 材料
 * 允许在战斗外（reward 阶段）操作，战斗中也允许（不消耗回合）
 */
export function forgeInRun(run, key) {
  const res = forge(run.deck, key);
  if (res.ok) {
    run.materials += res.material;
    run.stats.forged = (run.stats.forged || 0) + 1;
    /** v3.85：精进委托 —— 合成次数走 forge 钩子 */
    bumpQuest(run, 'forges', 1, talentRng(run, 4));
  }
  return res;
}

/**
 * 花材料激活一件种族宝物。当前战斗立即生效（不用等下一层）。
 */
export function activateRelicInRun(run, relicId, cost = 3) {
  const i = run.relicSlots.indexOf(relicId);
  if (i < 0) return { ok: false, reason: '该宝物不在未激活槽位里' };
  if (run.materials < cost) return { ok: false, reason: `水晶材料不足（需 ${cost}，现有 ${run.materials}）` };

  run.materials -= cost;
  run.relicSlots.splice(i, 1);
  run.relics.push(relicId);
  const relic = relicAt(relicId, 1);
  if (relic) {
    /** 面板型宝物（铁环 / 磨石）当场生效；战斗内激活还要同步到当前战斗的玩家副本 */
    applyRelicStats(run.player, relic);
    if (run.battle) applyRelicStats(run.battle.player, relic);
    if (run.battle) run.battle.relics.push(relic);
  }

  return { ok: true, relicId, name: RELICS[relicId]?.name };
}

/**
 * 探险存活归来：把 run 的成果写回角色实体
 * 注意 maxHp / atk 也要写回 —— 途中吃到的体质/力量是真成长
 */
export function writeBackToCharacter(run, ch) {
  ch.deck = run.deck.slice();
  ch.relics = run.relics.slice();
  ch.relicSlots = run.relicSlots.slice();
  /**
   * 装备加成要**先减掉**再写回（v2.3）。
   *
   * 角色身上只存本体属性，装备是外挂的：不减的话，穿铁剑活回来一次角色就永久 +2 攻击，
   * 下一趟再穿同一把剑又 +2 —— 死循环叠加上去。所以 maxHp / atk 都要扣掉那份快照。
   */
  const eb = run.equipBonus || {};
  ch.maxHp = Math.max(1, run.player.maxHp - (eb.maxHp || 0));
  ch.atk = Math.max(1, run.player.atk - (eb.atk || 0));
  /**
   * 等级、经验、知识、幸运都要写回 —— 它们是这趟探险真正的成长。
   *
   * v3.12 补上面板四项：基础属性宝物（护腕 +防御、疾风靴 +闪避…）是**永久资产**，
   * 但之前只写回 maxHp/atk —— 玩家带着 +6 防御活着回来，那 6 点就凭空蒸发了，
   * 而宝物还留在背包里，下一趟也不会重新加。写回的是绝对值，不重复叠加。
   */
  ch.level = run.player.level;
  ch.exp = run.player.exp;
  ch.knowledge = run.player.knowledge || 0;
  ch.luck = run.player.luck || 0;
  ch.def = Math.max(0, (run.player.def || 0) - (eb.def || 0));
  ch.crit = Math.max(0, (run.player.crit || 0) - (eb.crit || 0));
  ch.dodge = Math.max(0, (run.player.dodge || 0) - (eb.dodge || 0));
  ch.recovery = Math.max(0, (run.player.recovery || 0) - (eb.recovery || 0));
  /**
   * v3.62：能量上限写回。宝物 / 神龛给的能量是**永久资产**（跟基础属性宝物同规则）：
   * 活着回来保留，死了 wipeOnDeath 跟 initial 快照一起回滚（roster.js 已有该行）。
   */
  ch.energy = Math.max(1, run.player.energy || 8);
  ch.materials = 0;
  return ch;
}

/** 结算信息（给大厅用） */
export function runOutcome(run) {
  return {
    survived: run.phase === 'won',
    cleared: run.phase === 'won',
    floor: run.stats.floorsCleared || Math.max(0, run.floor - 1),
    turns: run.stats.turns,
    deck: run.deck.slice(),
    relics: run.relics.slice(),
    relicSlots: run.relicSlots.slice(),
    materials: run.materials,
    maxHp: run.player.maxHp,
    atk: run.player.atk,
    level: run.player.level,
    exp: run.player.exp,
    knowledge: run.player.knowledge || 0,
    luck: run.player.luck || 0,
  };
}

export function runSummary(run) {
  return {
    character: run.characterName,
    classId: run.classId,
    raceId: run.raceId,
    floor: run.floor,
    phase: run.phase,
    hp: run.player.hp,
    maxHp: run.player.maxHp,
    atk: run.player.atk,
    level: run.player.level,
    exp: run.player.exp,
    progress: levelProgress(run.player),
    deckSize: run.deck.length,
    relics: run.relics.slice(),
    stats: { ...run.stats },
  };
}

export { MAX_FLOOR, CLASSES, RACES, RELICS, CARDS, RELIC_VALUE };

/**
 * 导出给测试直接用。
 *
 * 三选一的规则（卡池范围、去重、兜底顺序）如果只能在"打一局"里间接验证，
 * 测试就会变成又慢又脆的模拟；它本身是纯函数，直接喂一个 run 就该能验。
 */
export { buildReward };
