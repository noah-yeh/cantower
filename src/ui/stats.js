/**
 * 属性面板（v3.20，v3.38 局内可用）—— 参照原作《了不起魔塔》的属性列表形式。
 *
 * 每行 = 图标 + 名称 + 数值（+装备加成）+ 右侧一句效果说明。
 * 只列**真实存在的 9 项属性**：原作的 速度/命中/抗暴/财运/法强 在残塔没有对应机制，
 * 不造假行；食量按用户要求去掉；法力上限 → 能量上限（沿用能量机制，见 §4.14）。
 *
 * v3.38 两件事（用户：「局内也应该有入口可以看到属性面板」「下面可以往下滑动一点，
 * 应该固定不能滑动」「稍微小一点」「加一个 ✕ 可以直接叉掉」）：
 *   1. 局内也能看：新增 `runStatsPanel(run)`，读的是**这一趟的实时面板**
 *      （run.player 已含升级成长、宝物、装备加成），不是名册上的出发前快照。
 *      战斗中额外列一行本场临时状态（护甲 / 力量 / 虚弱…），那才是"我现在几斤几两"。
 *   2. 尺寸收紧 + 右上 ✕：整块面板压到 9 行 + 天赋也能在一屏内装下（约 460px），
 *      外层不再溢出滚动（.stats-panel overflow: hidden）。
 *
 * 纯函数返回 HTML 字符串；数据只读 run / meta，不改任何状态。
 */

import { CLASSES, RACES } from '../core/characters.js';
import { MAX_ENERGY } from '../core/combat.js';
import { CRIT_CAP, DEF_CAP, DODGE_CAP, GROWTH } from '../core/leveling.js';
import { itemsOf, equipBonus } from '../core/equipment.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 装备加成小尾巴：`+2` / `+2%`。没有加成时是空串 */
function plus(v, pct = false) {
  return v > 0 ? `<i class="sp-plus">+${v}${pct ? '%' : ''}</i>` : '';
}

/**
 * 9 项属性定义 —— **敌我共用这一张表**（v3.54）。
 *
 * 用户：「所有怪物敌人的属性面板应该是跟玩家同一套的呀，现在总共应该有 9 种属性，
 * 怎么把机制啥的也放进去」—— 旧敌人面板只列 生命/攻击/防御/能量 四行，还把
 * 词条（荆棘、迅捷…）混排在同一块「属性」里，看起来像"敌人另有 5 项属性没有"。
 *
 * 所以这里把 9 项抽成唯一来源，敌人的面板也走这张表；词条属于**机制**，
 * 单独一块（见 battle.js 的 机制 分区），不再冒充属性。
 *
 * `foeOff`：敌人确实不参与该项结算，面板里显示 `—` 并注明。
 * v3.55 起只剩 **恢复 / 幸运** 两项 —— 暴击、闪避、知识已经接进敌人结算
 * （用户：「暴击，闪避，知识敌人也可以吃到」），现在会显示它的真实数值。
 * 收尾那两项是纯玩家系统（战胜回血、掉宝率），敌人没有对应通路。
 * **不编一个 0 出来**（写 0 会被读成"它有这项，只是没加"）。
 */
function attrDefs(cls) {
  /** 暴击倍率按职业取（v3.23：猎人是 1.75，其余 1.5）—— 面板不能写死一个数 */
  const critDmg = cls?.perk?.critDmg ?? 1.5;
  return [
    { key: 'maxHp', icon: '❤', tone: 'hp', name: '生命上限',
      desc: '提升冒险者的生存能力，归零则本次探险失败',
      foeDesc: '归零即被你击败' },
    { key: 'atk', icon: '⚔', tone: 'atk', name: '攻击力',
      desc: '伤害 = 卡牌基础伤害 ×（1 + 攻击力%）；力量 +N 就是 +N%' },
    { key: 'def', icon: '🛡', tone: 'def', name: '防御',
      desc: `每点降低 1% 受到的直接伤害（上限 ${DEF_CAP}），中毒不减免` },
    { key: 'crit', icon: '✦', tone: 'crit', name: '暴击',
      desc: `每点 +1% 暴击率（上限 ${CRIT_CAP}），暴击造成 ${critDmg} 倍伤害`,
      foeDesc: `每点 +1% 暴击率（上限 ${CRIT_CAP}），暴击对你造成 ${critDmg} 倍伤害` },
    { key: 'dodge', icon: '»', tone: 'dodge', name: '闪避',
      desc: `每点 +1% 闪避率（上限 ${DODGE_CAP}），完全躲开一次敌人攻击`,
      foeDesc: `每点 +1% 闪避率（上限 ${DODGE_CAP}），完全躲开你的一次攻击` },
    { key: 'recovery', icon: '✚', tone: 'rec', name: '恢复', foeOff: true,
      desc: '每战胜一场战斗，回复等量生命' },
    { key: 'knowledge', icon: '❖', tone: 'know', name: '知识',
      desc: '每点提升 1% 印记（中毒 / 灼烧）的叠加层数',
      foeDesc: '每点提升 1% 它施加的虚弱回合数（印记口径）' },
    { key: 'luck', icon: '♣', tone: 'luck', name: '幸运', foeOff: true,
      desc: '幸运越高，越容易遇到宝物与稀有事件' },
    { key: 'energy', icon: '⚡', tone: 'energy', name: '能量上限',
      desc: '每回合重置的能量点数，出牌都要消耗它（原作法力沿用能量机制）',
      foeDesc: '每回合重置的能量点数，它的每张牌都要消耗它' },
  ];
}

/** 角色 → 9 项数值。enemy 侧只有前 3 项与能量，其余由 attrRows 标成不参与 */
export function valsOf(src) {
  return {
    maxHp: src.maxHp,
    atk: src.atk,
    def: src.def || 0,
    crit: src.crit || 0,
    dodge: src.dodge || 0,
    recovery: src.recovery || 0,
    knowledge: src.knowledge || 0,
    luck: src.luck || 0,
    /** v3.58：能量上限是角色属性（招募掷 5~8）—— 角色/战斗单位都带着，敌人给 energyCap */
    energy: src.energy ?? src.energyCap ?? MAX_ENERGY,
  };
}

function rowHtml(r) {
  return `
    <div class="sp-row${r.off ? ' off' : ''}">
      <span class="sp-ico i-${r.tone}">${r.icon}</span>
      <span class="sp-key"><b>${r.name}</b><i>${r.val == null ? '—' : r.val}${r.p ?? ''}</i></span>
      <span class="sp-desc">${r.desc}</span>
    </div>`;
}

/**
 * 渲染 9 行属性（v3.54 敌我通用）。
 *
 * @param {object} vals  { maxHp, atk, def, crit, dodge, recovery, knowledge, luck, energy }
 * @param {object} opts
 *   cls    职业（只为了取暴击倍率）
 *   bonus  装备/外挂加成，渲染成 `+N` 小尾巴（名册角色才有；局内已含加成）
 *   foe    true = 敌人面板：不参与结算的项显示 `—`，生命那行换成"归零即被击败"
 */
export function attrRows(vals, { cls, bonus = {}, foe = false } = {}) {
  const rows = attrDefs(cls).map((d) => {
    const off = foe && d.foeOff;
    const v = vals?.[d.key];
    return {
      ...d,
      off,
      val: off || v == null ? null : v,
      p: off ? '' : plus(bonus[d.key]),
      desc: off ? '敌人不参与这一项结算' : (foe && d.foeDesc) || d.desc,
    };
  });
  return `<div class="sp-list">${rows.map(rowHtml).join('')}</div>`;
}

/**
 * 面板骨架。`action` 决定关闭动作名 —— 局外的 open-stats / 局内的 open-run-stats
 * 各有各的状态位，混用会让另一个面板关不掉。
 * `bag`（v3.44 英雄面板）：非空时面板带背包区、允许内部滚动。
 */
function sheetHtml({ action, name, sub, attrs, race, cls, battle, foot, bag = '' }) {
  /**
   * 天赋此前只存在于「图鉴 → 天赋」页签，玩家在局内和角色面板都看不到 ——
   * 用户问「种族的天赋在哪里展示为什么没看到」。种族天赋是开局就在生效的规则
   * （磐石每回合给甲、光合把余能量转甲……），藏进图鉴等于让玩家不知道自己在玩什么。
   * 所以属性面板底部补一块「天赋」，种族 + 职业各一行。
   */
  const talent = (race || cls?.perkText)
    ? `<div class="sp-talent">
        ${race ? `<div class="sp-t-row"><i>种族 · ${esc(race.name)}</i><b>${esc(race.desc)}</b></div>` : ''}
        ${cls?.perkText ? `<div class="sp-t-row"><i>职业 · ${esc(cls.name)}</i><b>${esc(cls.perkText)}</b></div>` : ''}
      </div>`
    : '';

  return `
    <div class="overlay stats-panel" data-action="${action}" role="dialog" aria-label="角色属性">
    <div class="sp-box attr-ui${bag ? ' with-bag' : ''}" data-action="stats-noop">
      <button class="sp-close" data-action="${action}" aria-label="关闭">✕</button>
      <div class="sp-head">
        <b>${esc(name)}</b>
        <span>${sub}</span>
      </div>
      ${battle ? `<div class="sp-battle">${battle}</div>` : ''}
      ${attrs}${talent}
      ${bag}
      <div class="sp-foot">${foot}</div>
    </div>
  </div>`;
}

/** 局外：名册里的角色（含装备加成，用 plus 单独标出来） */
export function statsPanel(meta, charId) {
  const ch = meta.roster.find((c) => c.id === charId);
  if (!ch) return '';
  const b = equipBonus(itemsOf(meta, ch.id));
  const cls = CLASSES[ch.classId];
  const race = RACES[ch.raceId];
  const sub = `Lv.${ch.level || 1} · ${esc(race?.name ?? '')}${esc(cls?.name ?? '')}${ch.veteran ? ' · 已转正' : ' · 试用期'}`;

  return sheetHtml({
    action: 'close-stats',
    name: ch.name,
    sub,
    attrs: attrRows(valsOf(ch), { cls, bonus: b }),
    race,
    cls,
    foot: '点击空白处或 ✕ 关闭',
  });
}

/**
 * 招募候选人（v3.57）：还没入册，不能走 statsPanel(meta, id) —— 直接吃角色对象。
 *
 * 用户：「招募的时候应该可以点击种族头像查看当前出来的全部属性值」。
 * 大厅招人那一眼只能看到 生命 / 攻击 和几项非零属性（`candidateBox` 的 slot-stats），
 * 掷点好坏、知识/幸运这些 0 值项全都被省略了 —— 想比较两位候选人就没法比。
 * 面板沿用同一套 9 行 + 种族/职业天赋，页脚补上每级成长，决策所需一次看全。
 */
export function candidateStatsPanel(ch) {
  const cls = CLASSES[ch.classId];
  const race = RACES[ch.raceId];
  if (!cls || !race) return '';
  const roll = ch.hpRoll >= 1.03 ? '生命掷点 优' : ch.hpRoll <= 0.97 ? '生命掷点 劣' : '生命掷点 平';
  const growth = GROWTH[ch.classId]?.text;

  return sheetHtml({
    action: 'close-cand-stats',
    name: ch.name ?? `${race.name}${cls.name}`,
    /** 名字本身就是"种族+职业"，副标题别再念一遍 —— 这里只补入册前的信息 */
    sub: `招募候选人 · 初始 ${ch.lives ?? 3} 命 · ${roll}`,
    attrs: attrRows(valsOf(ch), { cls }),
    race,
    cls,
    foot: `${growth ? `每级成长：${esc(growth)} · ` : ''}点击空白处或 ✕ 关闭`,
  });
}

/**
 * 局内（v3.38）：这一趟的实时面板。
 *
 * 数值直接读 run.player —— 升级成长、宝物、装备加成早就落在这里了，
 * 所以**不再叠 equipBonus**（叠了就等于重复计算）。战斗中再补一行临时状态，
 * 让玩家能一次看清"护甲还剩多少、力量叠到几"。
 * v3.67：点玩家头像改开角色详情页（hero.js），这个面板只留给顶栏「属性」按钮，
 * 原先的背包区（v3.44）随之移除 —— 卡组 / 宝物在详情页的「角色 / 宝物」页签里。
 */
export function runStatsPanel(run, opts = {}) {
  if (!run?.player) return '';
  const p = run.player;
  const cls = CLASSES[run.classId];
  const race = RACES[run.raceId];
  const zero = { maxHp: 0, atk: 0, def: 0, crit: 0, dodge: 0, recovery: 0 };

  const sub = `${esc(race?.name ?? '')}${esc(cls?.name ?? '')} Lv.${p.level || 1} · 第 ${run.floor} 层 · 卡组 ${run.deck?.length ?? 0} 张`;

  /**
   * 本场临时状态（只在战斗中存在）。
   *
   * 血量放在最前且常驻 —— 局外看的 maxHp 是"满血多少"，
   * 战斗中玩家真正关心的是"现在还剩多少"，而 run.player.hp 在战斗里不跟着掉。
   */
  const chips = [];
  const b = run.battle?.player;
  if (b) {
    chips.push(`<span class="chip">生命 ${b.hp} / ${b.maxHp}</span>`);
    if (b.armor > 0) chips.push(`<span class="chip armor">护甲 ${b.armor}</span>`);
    if (b.strength > 0) chips.push(`<span class="chip">力量 +${b.strength}</span>`);
    if (b.thorns > 0) chips.push(`<span class="chip">荆棘 ${b.thorns}</span>`);
    if (b.weakTurns > 0) chips.push(`<span class="chip weak">虚弱 ${b.weakTurns}</span>`);
  }

  return sheetHtml({
    action: 'close-run-stats',
    name: run.characterName ?? '冒险者',
    sub,
    attrs: attrRows(valsOf(p), { cls, bonus: zero }),
    race,
    cls,
    battle: chips.length ? `<span class="sp-battle-tag">本场</span>${chips.join('')}` : '',
    foot: `古币 ${run.gold || 0} · 点击空白处或 ✕ 关闭`,
  });
}
