/**
 * 战斗状态机 —— 纯逻辑，零 DOM，零定时器
 *
 * 这一层是整局的数学核心。四条硬规则：
 *   1. 护甲在战斗内跨回合保留（叠甲流成立的前提），战斗结束清零
 *   2. 能量每回合重置为 10，不随层数增长
 *   3. 生命跨层延续，战斗结束不回血
 *   4. 输出只有 events 数组，UI 靠读状态渲染，不在这一层碰任何展示逻辑
 */

import { cardOf, parseCard, gemText } from './cards.js';
import { ENEMY_CARDS, enemyHit } from './enemyCards.js';
import { CURVE, drawEnemyHand, pickEnemyCard, enemyEnergyOf } from './enemies.js';
import { markMultiplier, DEF_CAP, CRIT_CAP, CRIT_DMG, DODGE_CAP, KNOWLEDGE_PER_POINT, atkMul } from './leveling.js';
import { Rng } from './rng.js';

/**
 * 全局能量上限兜底值（v3.15 定 8，v3.58 起"上限"变成角色属性，见 characters.ENERGY_MIN/MAX）。
 *
 * v3.87（用户：「卡牌消耗水晶太少了，初始水晶都太高了」）：**8 → 6**。
 * 8 点配 5 张手牌（费用总和 ~5.6）永远打得完，等于没有"出哪张"的决策；
 * 6 点是新招募区间的上限，也用作旧数据缺字段时的兜底。
 */
export const MAX_ENERGY = 6;

/**
 * 手牌上限 8（v3.82，用户拍板：出牌区两排、每排 4 张）。
 *
 * 历史：v2.1 定 10（"攒一手 combo"）；v3.82 收到 8 并把抽牌降到 5 ——
 * 界面上正好两排 × 4 张，8 张手牌**全部可见**，不再横向滚动。
 * 于是"手牌位"重新变成稀缺资源：伤口牌占位真的会疼，连携要挑着留。
 */
export const HAND_LIMIT = 8;
/** 每回合默认抽 5 张（v3.82，原 6）。箭袋/谋略之卷等宝物可再加。 */
export const DRAW_PER_TURN = 5;

/* ------------------------------------------------------------------ *
 * 初始化
 * ------------------------------------------------------------------ */

export function createBattle({ player, enemy, deck, relics = [], rng, perk = {}, racePerk = {} }) {
  const b = {
    rng,
    relics,
    perk,
    racePerk,
    player: {
      hp: player.hp,
      maxHp: player.maxHp,
      atk: player.atk,
      /**
       * 知识：印记（中毒/虚弱/荆棘）叠加层数的乘区。v0.6 对齐原作后
       * 只作用于"叠层"，护甲/治疗/力量不吃加成。见 markMul()。
       * v3.53：荆棘改成层数 buff 后也纳入这个乘区。
       */
      knowledge: player.knowledge || 0,
      /** v0.6 属性面板四项：防御减伤 / 暴击倍伤 / 闪避免伤 / 战胜回血 */
      def: player.def || 0,
      crit: player.crit || 0,
      dodge: player.dodge || 0,
      recovery: player.recovery || 0,
      armor: 0,
      energy: 0,
      /**
       * 每回合的能量上限（v3.58）：跟着角色走（招募掷 5~8），不再是全局 8。
       * 旧存档里 run.player 没有 energy → 退回 MAX_ENERGY，老角色不会被打折。
       */
      energyCap: Math.max(1, Number(player.energy) || MAX_ENERGY),
      energyDrain: 0,
      strength: 0,
      thorns: 0,
      weakTurns: 0,
    },
    enemy,
    draw: rng.shuffle(deck.slice()),
    /**
     * 暴击判定用**独立**随机流（v3.23）。
     *
     * 以前暴击和敌人出牌共用 `b.rng`，于是"暴击率越高 → 消耗的随机数越多 →
     * 敌人后续出什么牌全变了"。玩家不可见，但后果很实：
     * 堆暴击会隐性改变怪物行为，而且平衡模拟里改一个暴击参数就跑出另一批故事，
     * 不同配置之间根本没法比（实测同一套猎人参数，+2 和 +3 暴击给出 30% / 23%，
     * 差的不是强度而是随机流）。
     * 这里拿主流的当前状态 XOR 一个常量派生**不推进主流**的子种子（用 save()
     * 读状态，不消耗），之后暴击判定只动子流 —— 主序列、敌人出牌、洗牌全不受影响。
     */
    critRng: new Rng((rng.save() ^ 0x9e3779b9) >>> 0),
    /**
     * 敌人的暴击流（v3.55）：再派生一条，和玩家那条**分开**。
     * 共用一条的话，玩家堆暴击会连带改变敌人何时暴击 —— 还是"改一个参数跑出
     * 另一批故事"的老问题。存档兼容：老战斗对象没有这个字段时按无暴击处理。
     */
    foeCritRng: new Rng((rng.save() ^ 0x85ebca6b) >>> 0),
    hand: [],
    discard: [],
    exhaust: [],
    /**
     * 已镶嵌的宝石（v3.91）：`[{ id, name, atkBonus?, armorPerTurn?, ... }]`。
     * 只在**本场战斗**里存在 —— battle 对象结束即丢，不会写回卡组/角色。
     * 同名可以镶多颗（效果叠加），UI 逐颗显示在血条上方的状态行里。
     */
    gems: [],
    turn: 1,
    phase: 'player', // player | won | lost
    cardsPlayed: 0,
    /** 本回合已打出的攻击牌数 —— perAttack 连击牌的乘区（v2.1） */
    attacksThisTurn: 0,
    /** 本回合已打出的技能牌数 —— perSkill 法术连携的乘区（v3.15） */
    skillsThisTurn: 0,
    /** 本回合已打出的总牌数 —— perCard 终结技的乘区（v3.15） */
    cardsThisTurn: 0,
    /** 本回合摸进手里几张（v3.87 收势结算用：摸进来 - 打出去 = 打不完的） */
    drawnThisTurn: 0,
    /**
     * v3.18 机制套路化：
     * played —— 鏖战计数（基础牌 id → 本场打出次数），战斗开始清零；
     * turnPayoffs —— 当回合打出过的「收势」牌（回合结束按未打出手牌数结算）。
     */
    played: {},
    turnPayoffs: [],
    pendingDraw: 0,
    firstAttacksUsed: 0,
    notes: [],
    events: [],
    /**
     * 本场战斗的回放记录。每行 `{ turn, side, name, detail }`，
     * side: 'turn'（回合分隔）| 'player' | 'enemy'。
     *
     * 为什么必须记：敌人不再显示意图，玩家只能从"它上一回合干了什么"推断打法。
     * 没有这份记录，战斗就变成盲盒 —— 对面突然叠了 40 甲，玩家只会觉得莫名其妙。
     */
    log: [],
  };

  for (const r of relics) r.onCombatStart?.(b);

  // 敌人开场词条（覆甲 / 石肤）。抽牌与回能在敌人自己的回合开始时做，
  // 跟玩家"回合开始抽牌"完全对称，不再提前预演。
  applyCombatStartTraits(b);

  startTurn(b, true);
  return b;
}

/* ------------------------------------------------------------------ *
 * 战斗记录
 * ------------------------------------------------------------------ */

/** 把一次出牌产生的 events 压成一句人话。记录"实际发生了什么"，不是卡面文案 */
function summarizeEvents(events) {
  const out = [];
  for (const ev of events) {
    switch (ev.type) {
      case 'damage': {
        const who = ev.target === 'player' ? '你 ' : '';
        if (ev.value <= 0 && ev.absorbed > 0) out.push(`${who}被护甲挡住`);
        else if (ev.absorbed > 0) out.push(`${who}-${ev.value}（护甲吃 ${ev.absorbed}）`);
        else out.push(`${who}-${ev.value}`);
        break;
      }
      case 'armor': if (ev.value > 0) out.push(`+${ev.value} 护甲`); break;
      case 'heal': if (ev.value > 0) out.push(`+${ev.value} 生命`); break;
      case 'poison': out.push(`毒 ${ev.value}`); break;
      case 'poisonTick': out.push(`毒发 ${ev.value}`); break;
      case 'weak': out.push(`虚弱 ${ev.value}`); break;
      case 'strength': out.push(`力量 +${ev.value}`); break;
      case 'thorns': out.push(`荆棘 +${ev.value} 层`); break;
      /** 宝石（v3.91）：战斗记录里要能看出"这颗石头是什么时候镶上的" */
      case 'gem': out.push(`镶嵌「${ev.name}」`); break;
      case 'energy': out.push(`能量 +${ev.value}`); break;
      case 'dodge': out.push(ev.target === 'enemy' ? '被它闪开' : '被闪避'); break;
      /** 无 target = 你的暴击；target:'player' = 它打你时暴击（v3.55） */
      case 'crit': out.push(ev.target === 'player' ? '它暴击' : '暴击'); break;
      case 'note': out.push(ev.text); break;
      default: break;
    }
  }
  return out.join(' · ');
}

function pushLog(b, side, name, detail) {
  b.log.push({ turn: b.turn, side, name: name || '', detail: detail || '' });
  // 一场战斗正常 5~8 回合、每回合十来条，240 是给"狂暴拖满"留的余量
  if (b.log.length > 240) b.log.splice(0, b.log.length - 240);
}

function startTurn(b, first = false) {
  /**
   * 能量上限 = 角色能量 + 已镶宝石（v3.91，琥珀宝石 +1）。
   * 宝石加的是**上限**而不是"本回合额外回能"：这样能量条上显示的就是真实可用量，
   * 玩家不用在脑子里做加法。
   */
  const gemEnergy = gemSum(b, 'energyPerTurn');
  b.player.energy = (b.player.energyCap ?? MAX_ENERGY) + gemEnergy - (b.player.energyDrain || 0);
  b.player.energyDrain = 0;

  /**
   * 种族天赋（v2.2 机制化）。
   *
   * 「磐石」石头人：战斗开始获得 armorStart 点护甲，之后每回合开始 armorPerTurn 点。
   * 走 gainArmor —— 战士的 armorGain 天赋对它同样生效，石头人战士是刻意的
   * 正向协同（坦度双乘），不是疏忽。余烬族的旧 atkMul 同理被「余烬」替代。
   */
  if (first && b.racePerk.armorStart) gainArmor(b, b.racePerk.armorStart);
  if (b.racePerk.armorPerTurn) gainArmor(b, b.racePerk.armorPerTurn);
  /** 苍蓝宝石（v3.91）：每回合开始补甲，走 gainArmor 吃战士的 armorGain */
  const gemArmor = gemSum(b, 'armorPerTurn');
  if (gemArmor) gainArmor(b, gemArmor);

  /** 「残影」影族：每回合首受击减伤，每回合开始重置标记（见 damagePlayer） */
  b.firstHitUsed = false;
  /** 「余烬」余烬族：每回合只有第一张攻击牌附带灼烧 */
  b.burnUsedThisTurn = false;

  if (b.player.weakTurns > 0) b.player.weakTurns--;

  // 宝物回合开始钩子（铁砧、毒龙宝石、厚重壁垒）
  for (const r of b.relics) r.onTurnStart?.(b);

  const drawBonus = b.relics.reduce((s, r) => s + (r.drawBonus || 0), 0);
  /**
   * v3.87：**回合结束不再丢手牌**（用户：「回合结束不应该丢弃手牌的」）。
   *
   * 手牌留在手里，所以回合开始只"补抽到目标张数"，而不是无脑再抽 5 张 ——
   * 否则手牌两回合就顶到 8 张上限、之后再也抽不到新牌。
   * 保留手牌的代价由**能量**承担：抽到打不出的牌可以留着下一回合打，
   * 但每回合就只多这几张，"这回合先打哪张"变成真的要选。
   */
  const target = DRAW_PER_TURN + drawBonus;
  b.drawnThisTurn = 0;
  let drawN = Math.max(0, target - b.hand.length);
  /**
   * 兜底：手里满编**却一张都打不起**（能量被 energyPenalty 压到 0 这种边角）
   * 时至少换一张进来 —— 否则手牌永远不动，回合只能空过，等于卡死。
   */
  if (drawN === 0 && b.hand.length < HAND_LIMIT
    && !b.hand.some((k) => (cardOf(k)?.cost ?? 99) <= b.player.energy)) {
    drawN = 1;
  }
  drawCards(b, drawN);
  b.attacksThisTurn = 0;
  b.skillsThisTurn = 0;
  b.cardsThisTurn = 0;

  pushLog(b, 'turn', '', `第 ${b.turn} 回合 · 你的行动`);
}

/* ------------------------------------------------------------------ *
 * 抽牌 / 护甲 / 伤害
 * ------------------------------------------------------------------ */

function drawCards(b, n) {
  for (let i = 0; i < n; i++) {
    if (b.hand.length >= HAND_LIMIT) break;
    if (b.draw.length === 0) {
      if (b.discard.length === 0) break;
      b.draw = b.rng.shuffle(b.discard);
      b.discard = [];
    }
    b.hand.push(b.draw.pop());
    /** v3.87：记「本回合摸进来几张」—— 收势按"本回合没打出去的牌"结算 */
    b.drawnThisTurn = (b.drawnThisTurn || 0) + 1;
  }
}

function effectiveAtk(b) {
  const raw = b.player.atk + b.player.strength;
  return b.player.weakTurns > 0 ? raw * 0.75 : raw;
}

/**
 * 已镶嵌宝石的某一项加成合计（v3.91）。
 *
 * 所有"镶进状态栏"的持续效果都从这里取，**不要在各自的结算点遍历 b.gems** ——
 * 那样以后加一种宝石就要改四五处，而且极容易漏掉某个乘区
 * （宝石看着镶上了、实际没生效，这种 bug 玩家很难说清，只能觉得"这牌没用"）。
 */
export function gemSum(b, key) {
  let n = 0;
  for (const g of b.gems || []) n += g[key] || 0;
  return n;
}

/**
 * 知识的印记倍率 —— v0.6 收窄，v3.53 把荆棘收进来。
 *
 * 只作用于**叠层**效果：中毒层数、虚弱回合数、荆棘层数
 * （对齐原作「每点知识 +1% 印记叠加层数」）。
 * 护甲 / 治疗 / 力量是即时数值，不吃加成；攻击力更不参与。
 * 后面再加新的"按层结算"的 buff，记得在这里乘一次。
 */
function markMul(b) {
  return markMultiplier(b.player);
}

/**
 * 获得荆棘层数（v3.53）：唯一的加层入口，走知识倍率。
 * 层数是叠层 buff，和中毒/虚弱同口径 —— 每点知识 +1% 层数（至少 1 层）。
 * 导出给宝物（荆棘背心的 onCombatStart）复用。
 */
export function gainThorns(b, n) {
  if (!n) return 0;
  const add = Math.max(1, Math.round(n * markMul(b)));
  b.player.thorns = (b.player.thorns || 0) + add;
  b.events.push({ type: 'thorns', value: add });
  b.notes.push(`荆棘 +${add} 层`);
  return add;
}

/**
 * 护甲获取的唯一入口（种族天赋「磐石/光合」与竞技场镜像也走这里，
 * 所以导出）。战士的 armorGain 与宝物的 armorGain 在这里统一生效。
 */
export function gainArmor(b, amount) {
  let mul = 1;
  if (b.perk.armorGain) mul *= 1 + b.perk.armorGain;
  for (const r of b.relics) if (r.armorGain) mul *= r.armorGain;
  const gained = Math.round(amount * mul);
  b.player.armor += gained;
  b.events.push({ type: 'armor', value: gained });
  return gained;
}

/** 玩家 → 敌人。pierce 无视护甲与防御，noReflect 用于毒伤/反伤，避免递归 */
function hitEnemy(b, raw, { pierce = false, noReflect = false } = {}) {
  const e = b.enemy;
  let dmg = raw;

  /**
   * 敌人闪避（v3.55）：完全躲开你的一次攻击，这张牌就白打了。
   *
   * 只闪**直接打上去**的伤害 —— 中毒 tick 与荆棘反弹都走 pierce，一律不闪。
   * 理由和玩家侧「词条派生伤害不可闪避」同一条：看不见来源的豁免读不懂。
   * 用 b.rng（与玩家闪避同一个流），不额外开随机源。
   */
  if (!pierce && e.dodge > 0 && b.rng.next() < Math.min(DODGE_CAP, e.dodge) / 100) {
    b.events.push({ type: 'dodge', target: 'enemy' });
    b.notes.push('它闪开了');
    return;
  }

  // 旅行家天赋：敌人每层毒，受伤 +2%
  if (b.perk.poisonAmp && e.poison > 0) dmg *= 1 + b.perk.poisonAmp * e.poison;

  /**
   * 影族天赋「残影」（v2.2，防守侧）—— 竞技场镜像里被打的是 side 对象，
   * 它自带 racePerk；PvE 的怪物没有这个字段，自动跳过。口径与 damagePlayer
   * 的玩家侧一致：穿甲（毒 tick / 破防）不触发，每回合首次重置由回合循环负责。
   */
  if (!pierce && !e.firstHitUsed && e.racePerk?.firstHitReduce) {
    e.firstHitUsed = true;
    dmg = Math.max(1, Math.round(dmg * (1 - e.racePerk.firstHitReduce)));
    b.events.push({ type: 'note', text: `残影：伤害 -${Math.round(e.racePerk.firstHitReduce * 100)}%` });
  }

  // 敌人防御（v0.6，仅精英 3 / BOSS 6）：降低受到的直接伤害。
  // 穿甲牌与中毒 tick（都走 pierce）不吃减免 —— 穿甲的定位就是"破防"
  if (!pierce && e.def > 0) dmg *= 1 - Math.min(40, e.def) / 100;

  /**
   * 圆整必须在扣护甲**之前**。
   *
   * v1.4 之前是"先拿小数伤害扣护甲、最后才 Math.round 显示"，
   * 于是护甲被扣成 8.815625 这种小数，下一次再参与计算就一路脏下去。
   * 战斗记录里会看到「护甲吃 8.815625」—— 玩家会以为程序坏了。
   */
  dmg = Math.round(dmg);

  let absorbed = 0;
  if (!pierce && e.armor > 0) {
    absorbed = Math.min(e.armor, dmg);
    e.armor -= absorbed;
    dmg -= absorbed;
  }

  e.hp -= dmg;
  b.events.push({ type: 'damage', target: 'enemy', value: dmg, absorbed });

  // 荆棘 / 尖刺词条：被攻击时反伤
  if (!noReflect && raw > 0) {
    let thorns = 0;
    for (const t of e.traits || []) {
      if (t.kind === 'thorns') {
        /**
         * v3.52：反弹 = 本体生命 × 比例（尖刺 2% / 荆棘 3%）。
         * 旧口径 `value + scale × 层数` 已废弃 —— 层数不该直接进公式，
         * 层数差异由怪物的生命成长承担。baseHp 老档可能没有，兜底 maxHp。
         */
        thorns += Math.round((t.value || 0) * (e.baseHp || e.maxHp || 0));
      }
    }
    if (thorns > 0) damagePlayer(b, thorns, { noReflect: true });
  }
}

/** 敌人 → 玩家。canDodge=false 用于词条派生伤害（吸血额外伤等），不可闪避。
 *  导出仅供测试与竞技场内部使用，游戏流程里的伤害都走 playEnemyCard */
export function damagePlayer(b, raw, { noReflect = false, canDodge = true } = {}) {
  const p = b.player;

  // 闪避（v0.6）：完全躲避一次敌人攻击。只有"敌人主动打的这一下"能闪，
  // 词条派生伤害不闪 —— 否则玩家会被看不见的来源打死，读不懂
  if (canDodge && p.dodge > 0 && b.rng.next() < Math.min(DODGE_CAP, p.dodge) / 100) {
    b.events.push({ type: 'dodge' });
    b.notes.push('闪避！');
    return;
  }

  let dmg = raw;

  // 影族天赋「残影」（v2.2）：每回合第一次受到的攻击减伤 35%。
  // 口径与闪避一致：只对敌人主动的攻击生效，词条派生伤害（吸血额外伤等）不触发 ——
  // 看不见来源的减伤读不懂。至少留 1 点
  if (canDodge && !b.firstHitUsed && b.racePerk.firstHitReduce) {
    b.firstHitUsed = true;
    dmg = Math.max(1, Math.round(dmg * (1 - b.racePerk.firstHitReduce)));
    b.events.push({ type: 'note', text: `残影：伤害 -${Math.round(b.racePerk.firstHitReduce * 100)}%` });
    b.notes.push('残影！');
  }

  // 防御（v0.6）：每点降低 1% 受到的直接伤害，封顶 40%
  const def = Math.min(DEF_CAP, p.def || 0);
  if (def > 0) dmg *= 1 - def / 100;
  // 同上：先圆整再扣护甲，护甲永远是整数
  dmg = Math.round(dmg);

  const absorbed = Math.min(p.armor, dmg);
  p.armor -= absorbed;
  dmg -= absorbed;

  p.hp -= dmg;
  b.events.push({ type: 'damage', target: 'player', value: dmg, absorbed });

  // 荆棘背心：按剩余护甲反弹
  if (!noReflect) {
    let reflect = 0;
    for (const r of b.relics) reflect += r.onDamageTaken?.(b, raw) || 0;
    /**
     * 牌面反伤（「反击」w_counter）。
     *
     * **这是 v1.4 修的一个真 bug**：`p.thorns` 从 v0.5 就被 applyCard 写进去，
     * 但 damagePlayer 从来没读过它 —— 战士的「反击」是一张完全无效的牌，
     * 荆棘背心也只剩饰品自己那 30%。
     *
     * 它是怎么被发现的：竞技场改成 1:1 镜像之后，战士对法师 0 胜、
     * 对猎人 0 胜。查下来战士在 PvP 里只会叠甲，护甲不能杀人，
     * **而唯一能把护甲变成伤害的那张牌，什么都没做。**
     *
     * v3.53：`p.thorns` 的含义从"护甲比例"改成**层数**（用户要求 buff 化）：
     * 每层在每次受击时反弹 1 点，不再乘护甲 —— 护甲一被打空反伤归零的
     * 旧手感读不出强度。知识加成在获得层数时已经结算（gainThorns）。
     */
    if (p.thorns > 0) reflect += p.thorns;
    if (reflect > 0) hitEnemy(b, reflect, { pierce: true, noReflect: true });
  }

  if (p.hp <= 0) {
    p.hp = 0;
    b.phase = 'lost';
  }
}

/* ------------------------------------------------------------------ *
 * 出牌
 * ------------------------------------------------------------------ */

export function canPlay(b, index) {
  if (b.phase !== 'player') return false;
  const id = b.hand[index];
  if (!id) return false;
  const card = cardOf(id);
  if (!card || card.unplayable) return false;
  return card.cost <= b.player.energy;
}

export function playCard(b, index) {
  if (!canPlay(b, index)) return [];
  const id = b.hand[index];
  const card = cardOf(id);

  b.events = [];
  b.notes = [];
  b.hand.splice(index, 1);
  b.player.energy -= card.cost;

  applyCard(b, card, id);

  b.cardsPlayed++;
  for (const r of b.relics) r.onCardPlayed?.(b);

  /**
   * 法师天赋「法术循环」：每打出 `energyPerCards` 张牌回 1 点能量。
   *
   * v3.50：这条回能以前只往 `notes` 里塞一句话，而 UI 从来不显示 notes ——
   * 玩家看到的只有"能量数字对不上账"：0 费牌打完涨 1、1 费牌打完不变、
   * 2 费牌只掉 1（用户原话）。其实那是每 2 张牌 +1 落在他正好打的那几张上。
   * 现在推一条带 label 的 energy 事件：战斗里飘字、记录里留痕，来源可见。
   */
  if (b.perk.energyPerCards && b.cardsPlayed % b.perk.energyPerCards === 0) {
    b.player.energy += 1;
    b.notes.push('法术循环 +1 能量');
    b.events.push({ type: 'energy', value: 1, label: '法术循环 +1 能量' });
  }

  if (b.pendingDraw > 0) {
    drawCards(b, b.pendingDraw);
    b.pendingDraw = 0;
  }

  if (card.exhaust) b.exhaust.push(id);
  else b.discard.push(id);

  /**
   * 日志放到最后写：宝物的 onCardPlayed 与法术循环的回能都在它之前结算，
   * 这样这一条记录的明细才是"这张牌到底发生了什么"的完整版本。
   */
  pushLog(b, 'player', card.name, summarizeEvents(b.events));

  checkEnemyDeath(b);
  return b.events;
}

/**
 * 一张牌的全部结算。
 *
 * **导出给竞技场镜像战复用**（arena.js）。它只认 b.player / b.enemy，
 * 所以对方只要能凑出一个"同形状的视图"，就能跑同一份出牌逻辑 ——
 * 这正是"竞技场对手是另一个玩家角色"的技术前提：不是折算，是同一套规则。
 *
 * 注意它不碰"打完之后"的事（弃牌、抽牌、能量校验、死亡判定），
 * 那些在 playCard 里，镜像战有自己的循环。
 */
export function applyCard(b, card, id) {
  const p = b.player;
  const e = b.enemy;

  /**
   * 宝石（v3.91）：**不结算一次性效果**，镶进状态栏、本场持续生效。
   * 后续所有乘区都通过 gemSum() 读它 —— 这里只负责"登记 + 留一条记录"。
   */
  if (card.kind === 'gem' && card.gem) {
    b.gems.push({ id: parseCard(id).id, name: card.name, ...card.gem });
    b.notes.push(`镶嵌 ${card.name}`);
    b.events.push({ type: 'gem', name: card.name, text: gemText(card.gem) });
  }

  /** 代价：失去生命（v2.1）。强牌的通行费 —— 最低留 1 点，代价不直接杀人 */
  if (card.costHp != null) {
    const lost = Math.max(1, Math.round(p.maxHp * card.costHp));
    const real = Math.min(lost, p.hp - 1);
    p.hp -= real;
    if (real > 0) b.events.push({ type: 'note', text: `失去 ${real} 点生命` });
  }

  /* 攻击牌的额外倍率 */
  let dmgMul = 1;
  if (card.kind === 'attack') {
    if (b.perk.attackBonus) dmgMul *= 1 + b.perk.attackBonus;
    /** 赤红宝石（v3.91）：攻击牌伤害 +N%（与职业 attackBonus 同乘区，叠乘） */
    const gemAtk = gemSum(b, 'atkBonus');
    if (gemAtk) dmgMul *= 1 + gemAtk;
    const limit = b.perk.firstAttackDouble;
    if (limit && b.firstAttacksUsed < limit) {
      dmgMul *= 2;
      b.firstAttacksUsed++;
      b.notes.push('猎人天赋：首击翻倍');
    }
    for (const r of b.relics) if (r.dmgBonus) dmgMul *= r.dmgBonus;
  }

  /* 消耗护甲（甲碎） */
  let armorSpent = 0;
  if (card.consumeArmor && p.armor > 0) {
    armorSpent = p.armor;
    p.armor = 0;
    for (const r of b.relics) r.onArmorSpent?.(b, armorSpent);
  }

  /* 伤害 */
  /**
   * 连携（v3.15）—— 这一版的核心。
   *
   * 用户反馈：「卡牌之间配合还是太少了，没什么套路，都是啪啪啪直接点玩」。
   * 诊断：不是没有协同字段（scaleArmor / dmgPerPoison / perAttack 都在），
   * 而是**每一张牌的协同都只是"线性小加成"**，散打和连携打出来差不多，
   * 玩家自然只会一路点最高伤害的牌。
   *
   * 所以这里补的是"**兑现口**"：铺垫牌（叠甲 / 铺毒 / 攒能量 / 上虚弱）
   * 本身打不出伤害，兑现牌单独打是废牌，必须在铺完之后打才有质变。
   * 下面每个 mul 字段都对应一条明确的构筑路线，详见 cards.js 的注释。
   */
  let burstPoison = 0;
  if (card.dmg != null) {
    /**
     * 暴击（v0.6）：每点 +1% 暴击率，默认 1.5 倍伤害，每张伤害牌判定一次。
     * v3.23：倍率可由职业天赋覆盖（猎人 1.75）—— 成长轴换成暴击之后，
     * "爆得更狠"就是猎人这条轴的身份，不能所有职业都吃同一个倍率。
     */
    const critMul = b.perk?.critDmg ?? CRIT_DMG;
    /** 紫晶宝石（v3.91）：暴击率 +N 点（1 点 = 1%），与角色暴击同口径、同上限 */
    const critPts = p.crit + gemSum(b, 'critBonus');
    if (critPts > 0 && b.critRng.next() < Math.min(CRIT_CAP, critPts) / 100) {
      dmgMul *= critMul;
      b.notes.push(critMul > CRIT_DMG ? `暴击 ×${critMul}！` : '暴击！');
      b.events.push({ type: 'crit' });
    }
    let dmg = card.dmg * atkMul(effectiveAtk(b)) * dmgMul;
    if (card.hits > 1) dmg *= card.hits;
    /** 旧口径：按消耗掉的护甲给百分比加成（保留给 甲碎/撞击） */
    if (card.scaleArmor != null) dmg *= 1 + armorSpent * card.scaleArmor;
    /** 护甲连携：**不消耗**护甲，按当前护甲加伤 —— 叠甲流的持续兑现口 */
    if (card.dmgPerArmor != null) dmg += p.armor * card.dmgPerArmor * atkMul(effectiveAtk(b));
    /** 碎甲连携：把消耗掉的护甲按点数直接转成伤害（比百分比直观得多） */
    if (card.consumeArmorMul != null && armorSpent > 0) {
      dmg += armorSpent * card.consumeArmorMul * atkMul(effectiveAtk(b));
      b.notes.push(`碎甲 +${armorSpent}`);
    }
    if (card.dmgPerPoison != null) dmg += e.poison * card.dmgPerPoison * atkMul(effectiveAtk(b));
    /** 毒爆：把敌人当前全部毒层一次兑换成伤害（清空在命中之后做） */
    if (card.poisonBurst != null && e.poison > 0) {
      dmg += e.poison * card.poisonBurst * atkMul(effectiveAtk(b));
      burstPoison = e.poison;
    }
    /** 能量兑现：把剩余能量全部烧掉换伤害（奥能爆） */
    if (card.energyBurst != null && p.energy > 0) {
      dmg += p.energy * card.energyBurst * atkMul(effectiveAtk(b));
      b.notes.push(`耗能 ${p.energy}`);
      p.energy = 0;
    }
    /**
     * 连击（v2.1）：本回合每打出过一张攻击牌，额外 +perAttack × 攻击力。
     * 用“打出过的数量”而不是“这张之前的数量”，机器人与玩家读法一致：
     * 第 1 张攻击牌吃 0 层，第 2 张吃 1 层……铺得越多尾刀越疼。
     */
    if (card.perAttack != null) {
      dmg += card.perAttack * b.attacksThisTurn * atkMul(effectiveAtk(b)) * dmgMul;
    }
    /** 法术连携（v3.15）：本回合每打出过一张**技能**牌 */
    if (card.perSkill != null) {
      dmg += card.perSkill * b.skillsThisTurn * atkMul(effectiveAtk(b)) * dmgMul;
    }
    /** 终结（v3.15）：本回合每打出过一张牌（任意类型） */
    if (card.perCard != null) {
      dmg += card.perCard * b.cardsThisTurn * atkMul(effectiveAtk(b)) * dmgMul;
    }
    /**
     * 同袍（v3.18）：牌组里每有一张同名基础牌（含自己），伤害 +perCopy × 攻击力。
     * 给「拿重复基础牌 / 合成同名卡」第二重价值 —— 名字相同的牌在互相撑攻击。
     */
    if (card.perCopy != null) {
      const baseId = parseCard(id).id;
      /** +1 是打出的这张本身 —— 它已离开手牌，剩下四个牌堆数不到它 */
      const copies = 1 + [...b.draw, ...b.hand, ...b.discard, ...b.exhaust]
        .filter((k) => parseCard(k).id === baseId).length;
      if (copies > 1) {
        dmg += card.perCopy * copies * atkMul(effectiveAtk(b)) * dmgMul;
        b.notes.push(`同袍 ×${copies}`);
      }
    }
    /**
     * 鏖战（v3.18）：本场这张牌每打出过一次，伤害再 +growMul。
     * 第一打无加成，第二打 +X%，第三打 +2X%…… 参照竞品「无限攻击」的
     * 战斗内成长，但不联动牌组同名（那是同袍的职责，两条机制不混）。
     */
    if (card.growMul != null) {
      const times = b.played[parseCard(id).id] || 0;
      if (times > 0) {
        dmg *= 1 + card.growMul * times;
        b.notes.push(`鏖战 ×${times}`);
      }
    }
    /** 猎杀（v3.15）：目标处于虚弱时整张牌质变 */
    if (card.ifWeakMul != null && e.weakTurns > 0) {
      dmg *= card.ifWeakMul;
      b.notes.push('猎杀！');
    }
    if (card.exec != null && e.hp / e.maxHp < card.exec) {
      dmg *= 2;
      b.notes.push('处决生效');
    }
    hitEnemy(b, dmg, { pierce: !!card.pierce });
    if (burstPoison > 0) {
      e.poison = 0;
      b.notes.push(`毒爆 ${burstPoison} 层`);
    }
  }
  /**
   * 职业基础牌（v3.25）：劈砍带甲 / 毒牙带毒这些差异**已经写在卡牌数据里**，
   * 走上面的通用结算 —— 这里不再按 id 给某张牌追加职业效果。
   *
   * v3.24 曾用 `perk.strikeArmor / strikePoison` 给四职业共用的「打击」追加效果，
   * 结果是"同一个 id、同一张卡面"，图鉴与背包里看不出职业差异。用户的判断更直接：
   * 名字变了就是另一张牌，效果就该写在卡上。
   */
  if (card.kind === 'attack') b.attacksThisTurn++;
  if (card.kind === 'skill') b.skillsThisTurn++;
  b.cardsThisTurn++;
  /** 鏖战计数：按基础牌 id 累计（v3.18） */
  b.played[parseCard(id).id] = (b.played[parseCard(id).id] || 0) + 1;
  /** 收势登记：这张牌在回合结束时按「未打出的手牌数」结算（v3.18） */
  if (card.unplayedArmor != null || card.unplayedPoison != null) {
    b.turnPayoffs.push({ armor: card.unplayedArmor, poison: card.unplayedPoison });
  }

  /** 净化（v2.1）：移除手牌里所有「伤口」，每张按 cleanseBlock × 攻击力获得护甲 */
  if (card.cleanseBlock != null) {
    let wounds = 0;
    for (let i = b.hand.length - 1; i >= 0; i--) {
      if (cardOf(b.hand[i])?.unplayable) {
        b.exhaust.push(b.hand[i]);
        b.hand.splice(i, 1);
        wounds++;
      }
    }
    if (wounds > 0) {
      gainArmor(b, wounds * card.cleanseBlock * atkMul(p.atk));
      b.events.push({ type: 'note', text: `净化 ${wounds} 张伤口` });
    }
  }

  /* 护甲 */
  if (card.block != null) gainArmor(b, card.block * atkMul(p.atk));

  /* 治疗（不吃知识 —— 不是叠层效果） */
  if (card.heal != null) {
    const heal = Math.round(card.heal * atkMul(p.atk));
    p.hp = Math.min(p.maxHp, p.hp + heal);
    b.events.push({ type: 'heal', value: heal });
  }

  /* 中毒：印记，吃知识加成（至少叠 1 层） */
  if (card.poison != null) {
    const bonus = b.relics.reduce((s, r) => s + (r.poisonBonus || 0), 0);
    /** 翠绿宝石（v3.91）：每次施加中毒额外 +N 层（与宝物毒加成同口径，一起进知识乘区） */
    const add = Math.max(1, Math.round((card.poison + bonus + gemSum(b, 'poisonBonus')) * markMul(b)));
    e.poison += add;
    b.events.push({ type: 'poison', value: add });
  }
  /**
   * 「余烬」余烬族（v2.2）：**每回合第一张攻击牌**命中时附带灼烧。
   * 不是每次攻击都附 —— 猎人/连击型一回合 3~4 张攻击牌，每次都附会让
   * 毒层滚成第二套输出引擎（实测通关率 63%）。不吃印记乘区，同上下文。
   */
  if (card.kind === 'attack' && b.racePerk.burnOnHit && !b.burnUsedThisTurn) {
    b.burnUsedThisTurn = true;
    e.poison += b.racePerk.burnOnHit;
    b.events.push({ type: 'poison', value: b.racePerk.burnOnHit });
  }

  if (card.amplifyPoison != null && e.poison > 0) {
    const before = e.poison;
    e.poison = Math.round(e.poison * (1 + card.amplifyPoison));
    b.events.push({ type: 'poison', value: e.poison - before });
  }

  if (card.keepPoison) e.keepPoison = true;
  if (card.weak != null) {
    /* 虚弱也是印记：按回合数叠层，吃知识加成 */
    const add = Math.max(1, Math.round(card.weak * markMul(b)));
    e.weakTurns += add;
    /** target 是给 UI 飘字用的：同一条事件，落在谁头上决定它出现在哪一侧 */
    b.events.push({ type: 'weak', target: 'enemy', value: add });
  }
  if (card.strength != null) {
    const add = Math.round(card.strength);
    p.strength += add;
    b.events.push({ type: 'strength', value: add });
  }
  if (card.energy != null) {
    p.energy += card.energy;
    b.events.push({ type: 'energy', value: card.energy });
  }
  /** 代价：下回合能量 -N（复用敌人侧 drainEnergy 的同一状态位） */
  if (card.energyPenalty != null) {
    p.energyDrain += card.energyPenalty;
    b.events.push({ type: 'note', text: `下回合能量 -${card.energyPenalty}` });
  }
  /** 代价：随机弃 N 张手牌（v2.1）——爆发的另一面是丢资源 */
  if (card.discardRandom != null && card.discardRandom > 0) {
    let n = Math.min(card.discardRandom, b.hand.length);
    const dropped = [];
    while (n-- > 0) {
      const i = Math.floor(b.rng.next() * b.hand.length);
      dropped.push(b.hand[i]);
      b.discard.push(b.hand[i]);
      b.hand.splice(i, 1);
    }
    if (dropped.length > 0) {
      b.events.push({ type: 'note', text: `随机弃 ${dropped.length} 张手牌` });
    }
  }
  if (card.draw != null) drawCards(b, card.draw);
  /**
   * 荆棘（v3.53）：加的是**层数**，不是"护甲 × 比例"。
   * 每层每次受击反弹 1 点，本场累计不衰减；获得时吃知识倍率（见 gainThorns）。
   */
  if (card.thorns != null) gainThorns(b, card.thorns);
}

/* ------------------------------------------------------------------ *
 * 结束回合 → 敌人行动
 * ------------------------------------------------------------------ */

/**
 * v3.37 拆分：旧版 endTurn 把"玩家收场 + 敌人整回合 + 毒结算 + 跨轮"一口气
 * 跑完，UI 只能在一瞬间拿到最终结果 —— 敌人打了什么全靠战斗记录翻。
 * 竞技场 v3.33 已经拆过一次（beginTurn / arenaEnemyStep），现在 PvE 对齐：
 *
 *   endPlayerPhase(b)  玩家收场 + 敌人回合开场（抽牌回能），b.phase = 'enemy'
 *   enemyStep(b)       敌人走一步：打一张牌；没得打就收场、跨轮、交回玩家回合
 *   endTurn(b)         同步包装：上面两步一口气跑完 —— 模拟 / 测试 / 机器人继续用它
 *
 * 拆分是逐行平移，顺序任何一处挪动都会让 PvE 胜率与已标定的平衡数值不可比。
 */
export function endPlayerPhase(b) {
  if (b.phase !== 'player') return { events: [], phase: b.phase };

  b.events = [];
  b.notes = [];

  for (const r of b.relics) r.onTurnEnd?.(b);

  /**
   * 青苔族天赋「光合」（v2.2）：回合结束时剩余能量转化为护甲。
   * 这是个真决策：能量留给下回合没用（会重置），所以"这一回合还剩几点"
   * 变成了"花掉还是换甲"的选择 —— 精确用能的玩家和防御玩家有了不同的最优解。
   */
  if (b.racePerk.energyToArmor && b.player.energy > 0) {
    const gained = gainArmor(b, b.player.energy * b.racePerk.energyToArmor);
    if (gained > 0) {
      pushLog(b, 'turn', '', `光合：${b.player.energy} 点剩余能量化为 ${gained} 点护甲`);
      b.notes.push(`光合 +${gained} 护甲`);
    }
    b.player.energy = 0;
  }

  /**
   * 伤口回合末"结痂脱落"进消耗堆，而不是洗回弃牌堆（v2.1 调参修正）。
   *
   * 第一版照搬杀戮尖塔让伤口循环洗回 —— 实测战士对着「污染」精英打出过
   * 34 回合的拖延局：伤口在 10 张的早期牌堆里滚雪球，引擎牌全被挤出去，
   * 战斗变成双方互相干瞪眼。本作战斗只有 3~6 回合，正确的惩罚量级是
   * "废掉你一回合的手牌容量"，不是"毁掉这一场"。净化仍有价值：
   * 当回合就把手牌位腾出来，还换成护甲。
   */
  const wounds = b.hand.filter((k) => cardOf(k)?.unplayable);
  if (wounds.length > 0) {
    b.exhaust.push(...wounds);
    b.hand = b.hand.filter((k) => !cardOf(k)?.unplayable);
    pushLog(b, 'turn', '', `${wounds.length} 张伤口结痂脱落`);
  }

  /**
   * 收势（v3.18）：回合结束时每有一张"本回合摸到却没打出"的牌，结算当回合
   * 打出过的收势牌。v3.15 把能量收紧到 8 之后"有牌打不出"成了常态 ——
   * 这里把弃牌变成一条资源线，打不完的手牌也有价值。伤口结痂（unplayable）不算：
   * 它们已经进消耗堆，不奖励废牌。
   *
   * v3.87：手牌不再在回合末丢弃，所以这里不能再用 `b.hand.length` ——
   * 留着的老牌会每回合重复结算，收势会白白翻倍。改成"本回合摸进来 - 本回合打出去"。
   */
  const fresh = Math.min(b.hand.length, Math.max(0, (b.drawnThisTurn || 0) - b.cardsThisTurn));
  if (fresh > 0 && b.turnPayoffs.length > 0) {
    const n = fresh;
    const armorRatio = b.turnPayoffs.reduce((t, x) => t + (x.armor || 0), 0);
    const poisonAdd = b.turnPayoffs.reduce((t, x) => t + (x.poison || 0), 0);
    if (armorRatio > 0) {
      const g = Math.round(armorRatio * n * atkMul(b.player.atk));
      if (g > 0) {
        gainArmor(b, g);
        b.notes.push(`收势：${n} 张未打出 → +${g} 护甲`);
      }
    }
    if (poisonAdd > 0) {
      const pg = Math.round(poisonAdd * n);
      if (pg > 0) {
        b.enemy.poison += pg;
        b.events.push({ type: 'poison', value: b.enemy.poison });
        b.notes.push(`收势：${n} 张未打出 → +${pg} 毒`);
      }
    }
  }
  b.turnPayoffs = [];

  /**
   * v3.87：手牌**不丢弃**。留着的牌下回合继续能打，
   * 回合开始只补抽到目标张数（见 startTurn）。
   * 弃牌堆只收"这一回合真的打出去的牌"，所以牌堆的循环速度也跟着变慢 ——
   * 这是保留手牌的必然代价，靠能量收紧来平衡。
   */

  // 敌人回合开场（原 enemyTurn 的开场段）：抽牌 → 回满能量
  const e = b.enemy;
  e.turn++;
  e.hitThisTurn = 0;
  pushLog(b, 'turn', '', `第 ${b.turn} 回合 · 敌方行动`);
  if (!e.manual) drawEnemyHand(e, b.rng);
  e.energy = enemyEnergyOf(e);
  /** 逐张播放的状态：已出几张 / 是否已因"无牌可出"写过结束日志 */
  b.enemyStepState = { plays: 0, spentOut: false };

  b.phase = 'enemy';
  return { events: b.events.slice(), phase: 'enemy' };
}

/**
 * 敌人走一步：打一张牌；打不起了就收场、跨轮、把回合交回玩家。
 *
 * 一次只出一张是刻意的 —— UI 每 0.5 秒调一次，玩家能看到"它刚刚打了什么"。
 *
 * @returns {{done:boolean, phase:string, events:Array, card?:{name:string, cost:number}, line?:{name:string, detail:string}}}
 *          done=false 表示"还有牌要出"，done=true 表示这一回合（或整场）结束
 */
export function enemyStep(b) {
  if (b.phase !== 'enemy') return { done: true, phase: b.phase, events: [] };

  const e = b.enemy;
  const st = b.enemyStepState || (b.enemyStepState = { plays: 0, spentOut: false });
  b.events = [];
  b.notes = [];

  /**
   * v3.64：出牌张数**不再设上限**，唯一约束是能量 —— 和玩家同一套机制。
   *
   * 用户：「敌人每次只能行动两次吗？不要增加这个限制，根据费用抽到的实际牌
   * 可实际使用，跟玩家同样的机制」。旧实现 `maxPlays = 2` 会让敌人攥着 5 点
   * 能量只打两张，手里明明还有买得起的牌却不打，读起来像在放水。
   * 现在：手里有买得起的就打，打不起才收场（手牌上限 4 顺带兜住了上界）。
   */
  const pick = pickEnemyCard(e, b.rng);
  if (pick) {
    st.plays++;
    e.hand.splice(pick.index, 1);
    e.discard.push(pick.id);
    e.energy -= pick.cost;
    playEnemyCard(b, pick.id);
    const card = ENEMY_CARDS[pick.id];
    const info = card ? { name: card.name, cost: pick.cost } : null;
    const line = b.log[b.log.length - 1];
    /** 反伤把自己打死了 —— 整场结束，跳过收场（对齐旧 enemyTurn 的 lost 分支） */
    if (b.phase === 'lost') {
      return { done: true, phase: 'lost', events: b.events.slice(), card: info, line };
    }
    return { done: false, phase: 'enemy', events: b.events.slice(), card: info, line };
  }
  /** 打不起了（能量不够 / 手里全是买不起的）—— 收场时要把原因写进记录 */
  st.spentOut = true;

  return closeEnemyTurn(b);
}

/** 敌人回合收场：结束原因 → 词条 → 狂暴 → 毒结算 → 死亡判定 → 跨轮开局 */
function closeEnemyTurn(b) {
  const e = b.enemy;
  const st = b.enemyStepState;
  b.enemyStepState = null;

  /** 玩家在敌人回合中途死了：跳过一切收场（对齐旧 enemyTurn 的 lost 分支） */
  if (b.phase === 'lost') return { done: true, phase: 'lost', events: [] };

  // 结束回合的原因也要记：否则玩家会以为敌人这回合在放水
  if (st?.spentOut) {
    pushLog(b, 'enemy', '', e.hand.length === 0 ? '无牌可出，结束回合' : '能量不足，结束回合');
  }

  applyTurnEndTraits(b);

  // 狂暴：拖过 12 回合，每回合伤害 +15%（v3.22 起乘伤害，不再乘攻击力）
  if (e.turn > CURVE.enrageTurn) {
    e.dmgMul = (e.dmgMul ?? 1) * (1 + CURVE.enragePct);
    e.enraged++;
  }

  if (e.weakTurns > 0) e.weakTurns--;

  // 中毒结算：无视护甲，每回合末掉一次，然后衰减一层
  if (b.enemy.hp > 0 && b.enemy.poison > 0) {
    hitEnemy(b, b.enemy.poison, { pierce: true, noReflect: true });
    if (!b.enemy.keepPoison) b.enemy.poison -= 1;
    b.events.push({ type: 'poisonTick', value: b.enemy.poison });
  }

  checkEnemyDeath(b);
  if (b.phase === 'won' || b.phase === 'lost') {
    return { done: true, phase: b.phase, events: b.events.slice() };
  }

  b.turn++;
  startTurn(b);
  /** 旧版 phase 恒为 'player'、从不写回；拆分后必须显式交回，否则同步包装会死循环 */
  b.phase = 'player';
  return { done: true, phase: 'player', events: b.events.slice() };
}

/**
 * 同步版：一口气跑完整个敌人回合。
 *
 * 返回值与旧 endTurn 完全一致（全程 events 拼接）——
 * 模拟、测试、机器人的调用方一行都不用改，数值口径也不会分叉。
 */
export function endTurn(b) {
  const r = endPlayerPhase(b);
  if (r.phase !== 'enemy') return r.events;
  const all = r.events.slice();
  let guard = 0;
  while (b.phase === 'enemy' && guard++ < 60) {
    const s = enemyStep(b);
    all.push(...s.events);
  }
  return all;
}

/** 敌人打出一张行动牌，并把这次结算写进战斗记录 */
function playEnemyCard(b, id) {
  const c = ENEMY_CARDS[id];
  if (!c) return;
  const from = b.events.length;
  resolveEnemyCard(b, c);
  pushLog(b, 'enemy', c.name, summarizeEvents(b.events.slice(from)));
}

function resolveEnemyCard(b, c) {
  const e = b.enemy;
  const p = b.player;

  let mul = 1;
  if (e.chargeMul) {
    mul *= e.chargeMul;
    e.chargeMul = 0;
  }

  if (c.dmg != null) {
    /**
     * v3.22 敌我同构：敌人和玩家走同一个 atkMul —— 每点攻击 +1%。
     * 敌人牌面系数（ENEMY_CARDS 里的 0.28/0.49…）本来就比玩家牌小，
     * 差异在"牌更弱"，不在"算法不同"。
     */
    let dmg = c.dmg * enemyHit(e.atk) * mul * (e.dmgMul ?? 1);
    if (c.hits > 1) dmg *= c.hits;
    if (e.weakTurns > 0) dmg *= 0.75;
    // 群猎：每回合第一张攻击牌加成
    if (e.hitThisTurn === 0) {
      for (const t of e.traits || []) if (t.kind === 'firstHit') dmg *= 1 + t.value;
    }
    e.hitThisTurn++;

    /**
     * 敌人暴击（v3.55，用户：「暴击…敌人也可以吃到」）。
     *
     * 和玩家同一个口径：每点 +1% 概率、命中后 ×1.5。用 b.critRng（独立的
     * "运气流"）而不是主 rng —— 否则多加一次随机会让整局的抽牌 / 决策序列
     * 全部错位，同样的种子在改动前后毫无可比性。
     *
     * 被闪避时这一下根本没落地，所以事件要等 damagePlayer 返回、确认掉了血
     * 才补，避免出现「暴击 · 被闪避」这种自相矛盾的记录。
     */
    const willCrit = e.crit > 0 && !!b.foeCritRng
      && b.foeCritRng.next() < Math.min(CRIT_CAP, e.crit) / 100;
    if (willCrit) dmg *= e.critDmg ?? CRIT_DMG;

    const hpBefore = p.hp;
    damagePlayer(b, dmg);
    if (b.phase === 'lost') return;
    if (willCrit && p.hp < hpBefore) b.events.push({ type: 'crit', target: 'player' });
    onHitLanded(b, dmg);
  }

  if (c.block != null) {
    const add = Math.round(c.block * enemyHit(e.atk));
    e.armor += add;
    b.events.push({ type: 'armor', target: 'enemy', value: add });
  }
  if (c.heal != null) {
    const before = e.hp;
    e.hp = Math.min(e.maxHp, e.hp + Math.round(c.heal * e.maxHp));
    b.events.push({ type: 'heal', target: 'enemy', value: e.hp - before });
  }
  if (c.weak != null) {
    /**
     * 敌人的知识（v3.55）：每点 +1% 它施加的印记层数 —— 与玩家 markMultiplier
     * 同一口径（玩家涨中毒/虚弱，敌人涨虚弱回合数）。这是"知识"对敌人唯一
     * 有意义的落点：它不叠毒、不掉宝。至少 1 回合，不能因为取整被吃没。
     */
    const weak = Math.max(1, Math.round(c.weak * (1 + (e.knowledge || 0) * KNOWLEDGE_PER_POINT)));
    p.weakTurns += weak;
    b.events.push({ type: 'weak', target: 'player', value: weak });
  }
  if (c.drainEnergy != null) {
    p.energyDrain += c.drainEnergy;
    b.events.push({ type: 'note', text: `你下回合 -${c.drainEnergy} 能量` });
  }
  if (c.charge != null) {
    e.chargeMul = c.charge;
    b.events.push({ type: 'note', text: `蓄势 ×${c.charge}` });
  }
  if (c.strength != null) {
    // v3.22：线性模型下 `atk ±5%` 只值伤害 ±0.3%（攻击力是个小数），
    // 改乘伤害乘区，效果与改版前等价，文案也从"攻击"改成"伤害"
    e.dmgMul = (e.dmgMul ?? 1) * (1 + c.strength);
    b.events.push({ type: 'note', text: `伤害 +${Math.round(c.strength * 100)}%` });
  }
  if (c.purge) {
    e.poison = 0;
    e.weakTurns = 0;
    b.events.push({ type: 'note', text: '清除自身负面' });
  }
}

/** 命中后的词条结算（吸血 / 穿甲 / 抽能 / 虚弱） */
function onHitLanded(b, raw) {
  const e = b.enemy;
  if (raw <= 0) return;

  for (const t of e.traits || []) {
    switch (t.kind) {
      case 'leech': {
        const heal = Math.round(raw * t.value);
        if (heal > 0) e.hp = Math.min(e.maxHp, e.hp + heal);
        break;
      }
      case 'pierceOnHit': {
        const extra = Math.round(raw * t.value);
        if (extra > 0) damagePlayer(b, extra, { noReflect: true, canDodge: false });
        break;
      }
      case 'drainOnHit':
        b.player.energyDrain += t.value;
        break;
      case 'curseOnHit':
        // 污染词条（v2.1）：每次命中往玩家抽牌堆塞「伤口」。战斗内限定 ——
        // createBattle 用的是 deck 的拷贝，战斗结束伤口自然蒸发，不污染永久卡组
        for (let i = 0; i < (t.value || 1); i++) b.draw.push('wound');
        b.events.push({ type: 'note', text: '「伤口」混入了你的牌堆' });
        break;
      case 'weakOnHit':
        b.player.weakTurns += t.value;
        break;
      default:
        break;
    }
  }
}

function applyCombatStartTraits(b) {
  const e = b.enemy;
  for (const t of e.traits || []) {
    if (t.kind === 'openArmor') e.armor += Math.round(e.maxHp * t.value);
  }
}

function applyTurnEndTraits(b) {
  const e = b.enemy;
  for (const t of e.traits || []) {
    switch (t.kind) {
      case 'regen':
        e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * t.value));
        break;
      case 'frenzy':
        // v3.22：同 `strength`，改乘伤害乘区（原先是乘 atk，线性模型下几乎无效）
        e.dmgMul = (e.dmgMul ?? 1) * (1 + t.value);
        break;
      case 'armorPerTurn':
        e.armor += Math.round(enemyHit(e.atk) * t.value);
        break;
      case 'armorEvery':
        if (t.every && e.turn % t.every === 0) e.armor += Math.round(e.maxHp * t.value);
        break;
      case 'purge':
        // 只清虚弱，不碰中毒 —— 否则毒流派会被一条随机词条直接废掉
        if (t.every && e.turn % t.every === 0) {
          e.weakTurns = 0;
          e.armor += Math.round(enemyHit(e.atk) * 0.6);
        }
        break;
      default:
        break;
    }
  }
}

function checkEnemyDeath(b) {
  // v3.37：毒结算发生在敌人相位 —— 只挡已分出胜负，不再写死 'player'
  if (b.phase === 'lost' || b.phase === 'won') return;
  const e = b.enemy;
  if (e.hp > 0) return;

  // 不散：首次死亡时站起来一次
  const revive = (e.traits || []).find((t) => t.kind === 'revive');
  if (revive && !e.revived) {
    e.revived = true;
    e.hp = Math.max(1, Math.round(e.maxHp * revive.value));
    e.poison = 0;
    e.armor = 0;
    b.revivedThisTurn = true;
    return;
  }

  e.hp = 0;
  b.phase = 'won';
  for (const r of b.relics) r.onEnemyKilled?.(b);
}

/* ------------------------------------------------------------------ *
 * 对外快照 —— UI 与机器人只用这个，不直接摸内部结构
 * ------------------------------------------------------------------ */

export function battleView(b) {
  return {
    turn: b.turn,
    phase: b.phase,
    player: { ...b.player },
    enemy: {
      id: b.enemy.id,
      name: b.enemy.name,
      hp: b.enemy.hp,
      maxHp: b.enemy.maxHp,
      atk: b.enemy.atk,
      def: b.enemy.def || 0,
      /** v3.55：敌人也吃暴击 / 闪避 / 知识，面板按同 9 项展示 */
      crit: b.enemy.crit || 0,
      dodge: b.enemy.dodge || 0,
      knowledge: b.enemy.knowledge || 0,
      armor: b.enemy.armor,
      poison: b.enemy.poison,
      weakTurns: b.enemy.weakTurns,
      tier: b.enemy.tier,
      floor: b.enemy.floor,
      /** 本体生命（v3.52）：尖刺/荆棘的反弹基数，不含精英/首领难度倍率 */
      baseHp: b.enemy.baseHp ?? b.enemy.maxHp,
      traits: (b.enemy.traits || []).map((t) => ({
        id: t.id,
        name: t.name,
        text: t.text,
        /**
         * v3.51：kind/value 一并给视图 —— 尖刺/荆棘的说明文案
         * 要按「本体生命 × 比例」折算成具体反弹量（用户：
         * 「受击是反弹多少伤害，根据什么来计算的」），视图层没有原始
         * 数值就只能念静态 text。
         */
        kind: t.kind,
        value: t.value,
        core: t === b.enemy.core,
      })),
      /**
       * 敌人也是"有能量的角色"。这里给上限而不是剩余值：
       * 玩家回合看到的是上回合的余额，显示出来只会误导（"它只剩 1 点？"）。
       * 真实的消耗过程在战斗记录里。
       */
      energyCap: enemyEnergyOf(b.enemy),
      handCount: b.enemy.hand.length,
      /**
       * 敌人牌库（v3.42）：玩家要求「敌人的牌库应该是有入口可以查看的」。
       * 给的是**三个堆的内容本身**，不给顺序 —— 洗牌顺序仍然藏着，
       * 所以"它这回合先打哪张"依旧不可预告，只公开"它手上有哪些牌"。
       * 旧档可能没有 draw/discard 字段，兜底成空数组。
       */
      deck: {
        hand: (b.enemy.hand || []).slice(),
        draw: (b.enemy.draw || []).slice(),
        discard: (b.enemy.discard || []).slice(),
      },
    },
    hand: b.hand.slice(),
    /**
     * 已镶嵌的宝石（v3.91）：状态栏逐颗显示 + 点开看效果。
     * 给副本不给引用 —— 视图层不该能改战斗状态。
     */
    gems: (b.gems || []).map((g) => ({ ...g, text: gemText(g) })),
    /**
     * v3.24：卡面按职业天赋折算需要它 —— 战斗手牌的「打击」要显示
     * 战士 +1 甲 / 法师 +34% / 猎人 +8% / 旅行家 +1 毒，与实战同口径。
     */
    perk: b.perk,
    drawCount: b.draw.length,
    discardCount: b.discard.length,
    exhaustCount: b.exhaust.length,
    /**
     * 本回合的出牌计数（v3.15）：UI 靠它判断"连携条件满没满"。
     * 不给的话，卡面上的"本回合每打过 1 张技能牌 +5"就只是文字，玩家看不到当前状态。
     */
    skillsThisTurn: b.skillsThisTurn || 0,
    cardsThisTurn: b.cardsThisTurn || 0,
    attacksThisTurn: b.attacksThisTurn || 0,
    notes: b.notes.slice(),
    log: b.log.slice(),
  };
}

/**
 * 战斗结束后把护甲清零，返回玩家剩余状态（供 run 层回写）。
 *
 * 恢复属性（v0.6）：胜利才回血，每点回 1。失败不回 —— 续航是奖励不是保底，
 * 否则毒系旅行家永远死不掉，元游戏"强者恒强"的闸门就废了。
 */
export function settleBattle(b) {
  b.player.armor = 0;
  b.enemy.armor = 0;
  if (b.phase === 'won' && b.player.recovery > 0) {
    b.player.hp = Math.min(b.player.maxHp, b.player.hp + b.player.recovery);
  }
  return { hp: b.player.hp, maxHp: b.player.maxHp, atk: b.player.atk, strength: b.player.strength };
}
