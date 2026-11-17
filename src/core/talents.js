/**
 * 委托与额外天赋（v3.72，v3.85 重做）。
 *
 * 设计（见 GAME_DESIGN.md）：
 *   - 迷宫事件格 `herald 委托板`：**只在前 8 层出现**（v3.85 用户：「任务委托只会
 *     在前面 6 层出现」）。触发进入 `phase='quest'` 的委托页，可以**接受或婉拒**
 *     （v3.85 用户：「可以拒绝」）—— 这是全游戏唯一的选项型事件，因为它一局
 *     最多只来 3 次（`QUEST_MAX_PER_RUN`），不是每层都打断节奏。
 *   - 委托进度在杀怪 / 出攻击牌 / 下楼 / 开宝箱 / 合成五个钩子上累加，
 *     完成当场发一枚**额外天赋**。
 *   - 每份委托有**自己的天赋池**（v3.85 用户：「多做一些天赋给不同的任务」）：
 *     完成时只从这个池里挑一枚未拥有的 —— 接什么委托 = 期待哪类成长。
 *   - 天赋只做**即时属性**（血 / 攻 / 能量 / 暴击 / 防御 / 闪避），不引入新战斗
 *     机制 —— 沿用坑 7 的教训：新机制会稀释已有职业的套路。
 *   - run-only：只写进 run.talents，探险结束不写回角色（写回会永久膨胀，
 *     与装备快照同理）。旧档缺字段按空处理。
 */

import { ENERGY_CAP, DEF_CAP, CRIT_CAP, DODGE_CAP } from './leveling.js';

/** 一局最多接受几份委托（v3.85） */
export const QUEST_MAX_PER_RUN = 3;
/** 委托板只在前几层出现（v3.85 定 6 层，v3.86 用户：「扩展到前 8 层」） */
export const QUEST_MAX_FLOOR = 8;

/**
 * 额外天赋池（v3.85 建 13 枚，v3.86 扩到 21 枚）。
 * apply 直接改 run.player（战斗开打时按 player 字段起手，
 * 所以这里不需要碰 combat.js）。
 *
 * 单项天赋都做「主属性 + 一点搭头」，池子里再错开搭配 ——
 * 这样同一份委托抽两次也能抽出手感不同的两枚。
 */
export const EXTRA_TALENTS = {
  /* ---- 生命 / 防御 ---- */
  ironbody: {
    name: '铁躯',
    icon: '❤',
    text: '最大生命 +8',
    apply(p) {
      p.maxHp += 8;
      p.hp = Math.min(p.maxHp, p.hp + 8);
    },
  },
  colossus: {
    name: '巨躯',
    icon: '💗',
    text: '最大生命 +14',
    apply(p) {
      p.maxHp += 14;
      p.hp = Math.min(p.maxHp, p.hp + 14);
    },
  },
  vigor: {
    name: '活力',
    icon: '🌿',
    text: '最大生命 +5，防御 +1',
    apply(p) {
      p.maxHp += 5;
      p.hp = Math.min(p.maxHp, p.hp + 5);
      p.def = Math.min(DEF_CAP, (p.def || 0) + 1);
    },
  },
  guard: {
    name: '坚壁',
    icon: '🛡',
    text: '防御 +2',
    apply(p) {
      p.def = Math.min(DEF_CAP, (p.def || 0) + 2);
    },
  },
  bastion: {
    name: '堡垒',
    icon: '🏰',
    text: '防御 +3',
    apply(p) {
      p.def = Math.min(DEF_CAP, (p.def || 0) + 3);
    },
  },
  stoneheart: {
    name: '石心',
    icon: '💎',
    text: '最大生命 +10，防御 +1',
    apply(p) {
      p.maxHp += 10;
      p.hp = Math.min(p.maxHp, p.hp + 10);
      p.def = Math.min(DEF_CAP, (p.def || 0) + 1);
    },
  },
  sturdy: {
    name: '硬骨',
    icon: '🦴',
    text: '防御 +2，最大生命 +4',
    apply(p) {
      p.def = Math.min(DEF_CAP, (p.def || 0) + 2);
      p.maxHp += 4;
      p.hp = Math.min(p.maxHp, p.hp + 4);
    },
  },
  mend: {
    name: '愈合',
    icon: '💚',
    text: '每场战斗胜利后回复 2 生命',
    apply(p) {
      p.recovery = (p.recovery || 0) + 2;
    },
  },
  /* ---- 攻击 / 暴击 ---- */
  blade: {
    name: '利刃',
    icon: '⚔',
    text: '攻击 +2',
    apply(p) {
      p.atk += 2;
    },
  },
  fury: {
    name: '狂怒',
    icon: '🔥',
    text: '攻击 +3',
    apply(p) {
      p.atk += 3;
    },
  },
  edge: {
    name: '锋芒',
    icon: '🗡',
    text: '攻击 +1，暴击 +3%',
    apply(p) {
      p.atk += 1;
      p.crit = Math.min(CRIT_CAP, (p.crit || 0) + 3);
    },
  },
  keen: {
    name: '锐目',
    icon: '👁',
    text: '暴击 +5%',
    apply(p) {
      p.crit = Math.min(CRIT_CAP, (p.crit || 0) + 5);
    },
  },
  eagle: {
    name: '鹰眼',
    icon: '🎯',
    text: '暴击 +8%',
    apply(p) {
      p.crit = Math.min(CRIT_CAP, (p.crit || 0) + 8);
    },
  },
  valor: {
    name: '勇武',
    icon: '🏅',
    text: '攻击 +2，暴击 +2%',
    apply(p) {
      p.atk += 2;
      p.crit = Math.min(CRIT_CAP, (p.crit || 0) + 2);
    },
  },
  bloodlust: {
    name: '嗜血',
    icon: '🩸',
    text: '攻击 +1，最大生命 +6',
    apply(p) {
      p.atk += 1;
      p.maxHp += 6;
      p.hp = Math.min(p.maxHp, p.hp + 6);
    },
  },
  /* ---- 闪避 / 能量 ---- */
  shade: {
    name: '轻影',
    icon: '🌫',
    text: '闪避 +5%',
    apply(p) {
      p.dodge = Math.min(DODGE_CAP, (p.dodge || 0) + 5);
    },
  },
  wind: {
    name: '疾风',
    icon: '💨',
    text: '闪避 +8%',
    apply(p) {
      p.dodge = Math.min(DODGE_CAP, (p.dodge || 0) + 8);
    },
  },
  swift: {
    name: '迅影',
    icon: '🌀',
    text: '闪避 +4%，暴击 +4%',
    apply(p) {
      p.dodge = Math.min(DODGE_CAP, (p.dodge || 0) + 4);
      p.crit = Math.min(CRIT_CAP, (p.crit || 0) + 4);
    },
  },
  agile: {
    name: '轻捷',
    icon: '🍃',
    text: '闪避 +6%，最大生命 +4',
    apply(p) {
      p.dodge = Math.min(DODGE_CAP, (p.dodge || 0) + 6);
      p.maxHp += 4;
      p.hp = Math.min(p.maxHp, p.hp + 4);
    },
  },
  surge: {
    name: '灵涌',
    icon: '⚡',
    text: '能量上限 +1',
    /** 能量顶满时这枚不再进随机池（见 pickTalent），这里只兜底 */
    apply(p) {
      if (p.energy < ENERGY_CAP) p.energy += 1;
    },
  },
  insight: {
    name: '通明',
    icon: '🔮',
    text: '能量上限 +1，暴击 +3%',
    apply(p) {
      if (p.energy < ENERGY_CAP) p.energy += 1;
      p.crit = Math.min(CRIT_CAP, (p.crit || 0) + 3);
    },
  },
};

/**
 * 委托池（v3.85：5 种，各带自己的天赋池）。
 * goal 对应 bumpQuest 的五个钩子：
 *   kills    杀怪（finishBattle）
 *   atkCards 打出攻击牌（play 时看牌的 kind）
 *   floors   通过层数（advanceFloor）
 *   treasures 打开宝箱（triggerCell 的宝箱分支）
 *   forges   合成卡牌（forgeInRun）
 */
export const QUESTS = {
  hunt: {
    name: '讨伐委托',
    goal: 'kills',
    target: 4,
    text: '击败 4 个敌人',
    goalLabel: '击败敌人',
    reward: '战斗天赋',
    pool: ['blade', 'fury', 'valor', 'bloodlust', 'eagle'],
  },
  drill: {
    name: '修行委托',
    goal: 'atkCards',
    target: 8,
    text: '打出 8 张攻击牌',
    goalLabel: '打出攻击牌',
    reward: '攻势天赋',
    pool: ['edge', 'fury', 'keen', 'surge', 'insight'],
  },
  trek: {
    name: '跋涉委托',
    goal: 'floors',
    target: 3,
    text: '通过 3 层',
    goalLabel: '通过层数',
    reward: '生存天赋',
    pool: ['ironbody', 'guard', 'vigor', 'sturdy', 'mend'],
  },
  scavenge: {
    name: '寻宝委托',
    goal: 'treasures',
    target: 2,
    text: '打开 2 个宝箱',
    goalLabel: '打开宝箱',
    reward: '身法天赋',
    pool: ['wind', 'shade', 'swift', 'agile', 'keen'],
  },
  craft: {
    name: '精进委托',
    goal: 'forges',
    target: 1,
    text: '合成 1 次卡牌',
    goalLabel: '合成卡牌',
    reward: '厚积天赋',
    pool: ['colossus', 'vigor', 'bastion', 'stoneheart', 'surge'],
  },
};

/**
 * 掷一份委托 offer（不写进 run.quest —— 接受前它只是一张纸）。
 * target / 文案 / 天赋池名一并写进 offer：UI 显示「奖励：XX 天赋」要用，
 * 别指望 UI 自己查表。
 */
export function makeQuestOffer(run, rng) {
  const ids = Object.keys(QUESTS).filter((id) => id !== run.lastQuestId);
  const id = ids[rng.int(ids.length)] || Object.keys(QUESTS)[0];
  return questOfferOf(id);
}

/** 由 id 造 offer（UI / 测试 / 存档共用一套字段）
 *  v3.86：带 poolInfo（名字 + 图标 + 效果），委托页要**把效果写清楚** ——
 *  只报名字玩家没法判断该不该接。旧档没有 poolInfo，UI 会回落到 pool 查表。 */
export function questOfferOf(id) {
  const q = QUESTS[id];
  if (!q) return null;
  return {
    id,
    name: q.name,
    goal: q.goal,
    target: q.target,
    text: q.text,
    goalLabel: q.goalLabel,
    reward: q.reward,
    pool: q.pool.slice(),
    poolNames: q.pool.map((t) => EXTRA_TALENTS[t]?.name).filter(Boolean),
    poolInfo: q.pool
      .filter((t) => EXTRA_TALENTS[t])
      .map((t) => ({ id: t, name: EXTRA_TALENTS[t].name, icon: EXTRA_TALENTS[t].icon, text: EXTRA_TALENTS[t].text })),
  };
}

/** 接受一份 offer → 写进 run.quest（由 run.acceptQuest 调用） */
export function startQuest(run, offer) {
  const q = QUESTS[offer.id];
  if (!q) return null;
  run.quest = {
    id: offer.id,
    progress: 0,
    target: q.target,
    name: q.name,
    goalLabel: q.goalLabel,
    reward: q.reward,
  };
  run.lastQuestId = offer.id;
  return q;
}

/**
 * 委托进度累加。完成时从**这份委托的天赋池**里随机发一枚。
 * @param {string} goal  'kills' | 'atkCards' | 'floors' | 'treasures' | 'forges'
 * @param {number} n
 * @returns {string|null} 完成时的提示文案（UI flash），没完成返回 null
 */
export function bumpQuest(run, goal, n = 1, rng = null) {
  if (!run.quest) return null;
  const q = QUESTS[run.quest.id];
  if (!q || q.goal !== goal) return null;
  run.quest.progress += n;
  if (run.quest.progress < (run.quest.target ?? q.target)) return null;

  const talentId = pickTalent(run, rng, q.pool);
  run.talents = run.talents || [];
  run.talents.push(talentId);
  const t = EXTRA_TALENTS[talentId];
  t.apply(run.player);
  run.quest = null;
  run.lastQuestNote = `委托完成「${q.name}」，习得天赋「${t.name}」：${t.text}`;
  return run.lastQuestNote;
}

/**
 * 随机挑一枚**委托指定池**里没有的天赋。
 * 池子抽干（4 枚都拿过）→ 从全池兜底；全池抽干 → 利刃。
 */
function pickTalent(run, rng, prefPool = []) {
  const owned = new Set(run.talents || []);
  const p = run.player;
  const usable = (id) => {
    if (owned.has(id)) return false;
    /** 灵涌 / 通明只在能量没顶满时进池（顶满 = 白拿，文案没法圆） */
    if ((id === 'surge' || id === 'insight') && (p.energy || 0) >= ENERGY_CAP) return false;
    return true;
  };
  const preferred = prefPool.filter((id) => EXTRA_TALENTS[id] && usable(id));
  const pool = preferred.length
    ? preferred
    : Object.keys(EXTRA_TALENTS).filter(usable);
  if (!pool.length) return 'blade';
  return pool[rng ? rng.int(pool.length) : 0];
}

/** 天赋展示用（hero.js 头像下的图标行）：id → { name, icon, text } */
export function talentInfo(id) {
  return EXTRA_TALENTS[id] || null;
}

/** 委托奖励文案：「战斗天赋 · 利刃 / 狂怒 / 锐目 / 鹰眼」 */
export function questRewardText(offerOrQuest) {
  const names = offerOrQuest?.poolNames
    ?? (QUESTS[offerOrQuest?.id]?.pool || []).map((t) => EXTRA_TALENTS[t]?.name).filter(Boolean);
  return `${offerOrQuest?.reward ?? QUESTS[offerOrQuest?.id]?.reward ?? '天赋'} · ${names.join(' / ')}`;
}
