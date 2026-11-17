/**
 * 图鉴（v3.8）
 *
 * 三页：卡牌 / 天赋 / 装备。全部内容**从 core 的数据表生成**，
 * 不在 UI 里手写任何一条数值文案 —— 卡面调了、装备加成调了，图鉴自动跟着变。
 * 这里只做"编排与呈现"，一条游戏规则都不实现。
 */

import { GENERIC_CARD_IDS, cardView } from '../core/cards.js';
import { kw } from './bits.js';
import { CLASSES, CLASS_IDS, RACE_IDS, RACE_MAX_LEVEL } from '../core/characters.js';
import { raceCardsHtml } from './races.js';
import { RELICS, CHAINS } from '../core/relics.js';
import {
  EQUIP_DEFS, EQUIP_IDS, EQUIP_RARITY, MAX_ENHANCE, enhanceCost, statsText, totalEnhanceCost,
} from '../core/equipment.js';
import { GROWTH } from '../core/leveling.js';

/** 卡牌类型显示名 */
const KIND_LABEL = { attack: '攻击', skill: '技能', power: '能力', gem: '宝石', status: '状态' };

/** 分类内部的排列顺序：攻击打头（玩家找牌时脑子里先想的是"我要一张伤害牌"） */
const KIND_ORDER = ['attack', 'skill', 'power', 'gem', 'status'];

/** 职业立绘（旅行家用 ranger 的图） */
const CLASS_IMG = { warrior: 'warrior', mage: 'mage', hunter: 'hunter', traveler: 'ranger' };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

const pct = (v) => `${Math.round(v * 100)}%`;

/**
 * 卡面显示用的攻击力：图鉴是数据手册，统一按**基础伤害**展示（攻击 0）。
 * v3.26 曾按攻击 10 折算，用户指出「图鉴里的数字也受攻击力影响了吗？」——
 * 折算层只会添乱（法球显示「造成 18（基础 16）」，18 不知道哪来的），
 * 卡牌自带基础伤害之后，图鉴直接给底子，攻击加成交给战斗里的卡面去体现。
 */
const CODEX_ATK = 0;

/* ------------------------------------------------------------------ *
 * 卡牌
 * ------------------------------------------------------------------ */

/**
 * 某个职业**自己的**牌：起始卡组 + 职业池，去掉通用牌（v3.91）。
 *
 * 之前把 `cls.core` 原样并进来，于是「格挡」在四个职业各印一遍、加上通用页一共出现 5 次
 * —— 用户报「格挡牌应该在通用里面的，不需要放到各职业里面」。
 * 通用牌归通用页；职业页只在说明行里提一句"起始卡组还带了格挡 ×2"。
 */
function classCards(classId) {
  const cls = CLASSES[classId];
  const own = (id) => !GENERIC_CARD_IDS.includes(id);
  const core = new Set(cls.core.filter(own));
  const ids = [...new Set([...cls.core, ...cls.pool])].filter(own);
  return ids.map((id) => ({ id, core: core.has(id) }));
}

/** 起始卡组的一句话说明（含通用牌，例如「劈砍 ×3 · 格挡 ×2（通用）」） */
function coreLine(classId) {
  const counts = new Map();
  for (const id of CLASSES[classId].core) counts.set(id, (counts.get(id) || 0) + 1);
  return [...counts].map(([id, n]) => {
    const generic = GENERIC_CARD_IDS.includes(id) ? '（通用）' : '';
    return `${cardView(id, CODEX_ATK).name} ×${n}${generic}`;
  }).join(' · ');
}

/** 按牌型分组渲染（"类型"的第二层含义：攻击 / 技能 / 能力 / 宝石 / 状态） */
function kindSections(ids) {
  const byKind = new Map();
  for (const x of ids) {
    const c = cardView(x.id, CODEX_ATK);
    if (!byKind.has(c.kind)) byKind.set(c.kind, []);
    byKind.get(c.kind).push(x);
  }
  return KIND_ORDER.filter((k) => byKind.has(k)).map((k) => `
    <div class="sec-head"><span>${KIND_LABEL[k]}牌</span><span class="sec-sub">${byKind.get(k).length} 张</span></div>
    ${byKind.get(k).map((x) => cardRow(x.id, x.core)).join('')}`).join('');
}

function cardsTab(cls) {
  /**
   * 筛选条（v3.91）：「全部」页签删掉 —— 它把同一张牌在四个职业里各印一遍，
   * 读起来像卡池有 bug。现在一张牌只在自己的分类里出现一次。
   */
  const chips = [['generic', '通用'], ...CLASS_IDS.map((id) => [id, CLASSES[id].name])]
    .map(([id, label]) => `
    <button class="cx-chip${cls === id ? ' on' : ''}" data-action="codex-class" data-cls="${id}">${label}</button>`)
    .join('');

  let body;
  if (cls === 'generic') {
    body = `<p class="cx-note">通用牌 · 任何职业的三选一与行商货架里都会出现</p>`
      + kindSections(GENERIC_CARD_IDS.map((id) => ({ id, core: false })));
  } else {
    const c = CLASSES[cls];
    body = `
      <div class="cx-clshead">
        <img class="cx-clsface" src="assets/img/classes/${CLASS_IMG[cls] ?? cls}.png" alt="">
        <div>
          <div class="cx-clsname">${esc(c.name)}<i>${esc(c.tag)}</i></div>
          <div class="cx-clsdesc">${esc(c.desc)}</div>
        </div>
      </div>
      <div class="cx-talent-line"><b>职业天赋</b>${esc(c.perkText)}</div>
      <div class="cx-talent-line"><b>每级成长</b>${esc(GROWTH[cls]?.text ?? '—')}</div>
      <div class="cx-talent-line"><b>起始宝物</b>${esc(RELICS[c.relic]?.name ?? c.relic)}</div>
      <div class="cx-talent-line"><b>起始卡组</b>${esc(coreLine(cls))}</div>
      <p class="cx-note">该职业专属的 <b>${classCards(cls).length}</b> 张牌（"起始"是开局保底卡；通用牌见「通用」）</p>
      ${kindSections(classCards(cls))}`;
  }

  return `<div class="cx-chips">${chips}</div>${body}`;
}

/** 卡牌总数（去重口径：通用 + 四个职业各自专属） */
function cardTotal() {
  const ids = new Set(GENERIC_CARD_IDS);
  for (const id of CLASS_IDS) for (const x of classCards(id)) ids.add(x.id);
  return ids.size;
}

function cardRow(id, isCore = false) {
  const c = cardView(id, CODEX_ATK);
  return `
  <article class="cx-card kind-${esc(c.kind)}">
    <span class="cx-cost">${c.cost}</span>
    <div class="cx-main">
      <div class="cx-title">
        <b>${esc(c.name)}</b>
        <i class="cx-kind">${KIND_LABEL[c.kind] ?? c.kind}</i>
        ${isCore ? '<i class="cx-core">起始</i>' : ''}
      </div>
      <div class="cx-text">${kw(c.text)}</div>
    </div>
  </article>`;
}

/* ------------------------------------------------------------------ *
 * 种族（v3.90 独立页签：切图大图展示 · v3.95 起连养成一起收进来）
 *
 * 原来挤在"天赋"页签里当一小节，v3.90 用户发话：
 * "种族不是有切图的嘛……应该放入图鉴里面单独展示"。
 * v3.95 再做一步：**独立种族页整页删掉**，解锁 / 升级按钮直接长在卡片上 ——
 * "解锁升级都在那边，外面不需要再放入口了"。
 * 于是图鉴这一页既是数据手册也是养成入口，一个概念只在一个页签出现（§4.3.3）。
 * ------------------------------------------------------------------ */

function racesTab(meta) {
  return `
    <p class="cx-note">
      共 <b>${RACE_IDS.length}</b> 族 · 种族决定命数、被动、两件未激活宝物与一张专属卡 ·
      <b>每 10 块碎片升 1 级</b>，等级会抬高这个种族招募时的属性区间
    </p>
    ${raceCardsHtml(meta)}
    <p class="cx-note">
      碎片从<b>商城</b>的广告宝箱 / 古币宝箱来 · 满级（${RACE_MAX_LEVEL} 级）合计：生命 +${RACE_MAX_LEVEL}、攻击 +2、面板 +6
    </p>`;
}

/* ------------------------------------------------------------------ *
 * 宝物（v3.92：本页签原名「天赋」，只讲宝物）
 *
 * 种族天赋已搬去「种族」页签（v3.90）、职业天赋已印在「卡牌」页签的职业页头
 * 与角色详情页（v3.71）—— 用户 v3.92 指出这里再列一遍是三重展示：
 * "把种族天赋和职业天赋去掉，这两个分别在种族页、职业里面展示了"。
 * 于是本页只留宝物，页签名也改成「宝物」——名字与内容对齐。
 * ------------------------------------------------------------------ */

function relicsTab() {
  const relics = Object.entries(CHAINS).map(([key, label]) => {
    const list = Object.entries(RELICS).filter(([, r]) => (r.chain ?? 'X') === key);
    if (!list.length) return '';
    return `
    <div class="sec-head"><span>${esc(label)}</span><span class="sec-sub">${list.length} 件</span></div>
    ${list.map(([id, r]) => `
      <div class="cx-row">
        <div class="cx-rowtop"><b>${esc(r.name)}</b><i>${r.levels ? '1~5 级' : (CHAINS[key] ?? '通用')}</i></div>
        <div class="cx-rowtext">${kw(r.text)}</div>
        ${r.levels ? `<div class="cx-rowsmall">${r.levels.map((v, i) => `Lv.${i + 1} ${esc(r.describe(v))}`).join(' · ')}</div>` : ''}
      </div>`).join('')}`;
  }).join('');

  return `
    <p class="cx-note">
      共 <b>${Object.keys(RELICS).length}</b> 件 · 三选一奖励 / 事件获取 · 带等级的宝物重复获得会自动升级（1~5 级）
    </p>
    ${relics}`;
}

/* ------------------------------------------------------------------ *
 * 装备
 * ------------------------------------------------------------------ */

function equipTab(meta) {
  /** 库存里每件装备各有多少（图鉴上标"已有 N"，比干讲数值更实用） */
  const owned = {};
  for (const it of meta?.equipment ?? []) owned[it.defId] = (owned[it.defId] || 0) + 1;

  const rows = EQUIP_IDS.map((id) => {
    const def = EQUIP_DEFS[id];
    const rar = EQUIP_RARITY[def.rar] ?? { label: '', cls: '' };
    const perText = statsText(def.per);
    return `
    <article class="cx-eq">
      <img class="cx-eqico" src="assets/img/equip/${id}.png" alt="">
      <div class="cx-eqmain">
        <div class="cx-eqname">
          <b>${esc(def.name)}</b>
          <span class="eq-slot">${esc(def.slot)}</span>
          ${rar.label ? `<span class="eq-rar ${rar.cls}">${rar.label}</span>` : ''}
          ${owned[id] ? `<span class="cx-owned">已有 ${owned[id]}</span>` : ''}
        </div>
        <div class="cx-eqline">${esc(statsText(def.stats)) || '无加成'}</div>
        <div class="cx-eqsmall">每级强化 +${esc(perText)}</div>
      </div>
    </article>`;
  }).join('');

  return `
    <p class="cx-note">
      共 <b>${EQUIP_IDS.length}</b> 件 · 最多同时穿戴 <b>2</b> 件 · 强化上限 <b>+${MAX_ENHANCE}</b>（第 N 级要 N 星屑，满级共 ${totalEnhanceCost()}）
    </p>
    ${rows}
    <p class="cx-note">星屑只由庄园产出；重复装备可回收成碎片（${enhanceCost(0)} 碎片起，${MAX_ENHANCE} 星屑 = 1 合成）</p>`;
}

/* ------------------------------------------------------------------ *
 * 页面
 * ------------------------------------------------------------------ */

const TABS = [
  ['cards', '卡牌'],
  ['races', '种族'],
  ['relics', '宝物'],
  ['equip', '装备'],
];

/**
 * @param {object} meta  账号存档（装备页标"已有 N"、种族页标解锁状态）
 * @param {{tab?:string, cls?:string, flash?:string}} ui
 */
export function renderCodex(meta, ui = {}) {
  const tab = TABS.some(([id]) => id === ui.tab) ? ui.tab : 'cards';
  /** 默认停在「通用」（v3.91 删掉「全部」之后） */
  const cls = ui.cls === 'generic' || CLASS_IDS.includes(ui.cls) ? ui.cls : 'generic';

  const body = tab === 'cards' ? cardsTab(cls)
    : tab === 'races' ? racesTab(meta)
      : tab === 'relics' ? relicsTab()
        : equipTab(meta);

  return `
  <div class="hall">
    <div class="hall-top">
      <button class="icon-btn" data-action="back-hall">返回</button>
      <div class="hall-title">图鉴</div>
      <span class="top-count">${
  tab === 'cards' ? `${cardTotal()} 张`
    : tab === 'races' ? `${RACE_IDS.length} 族`
      : tab === 'relics' ? `${Object.keys(RELICS).length} 件`
        : `${EQUIP_IDS.length} 件`
}</span>
    </div>

    <div class="rtabs">
      ${TABS.map(([id, label]) => `
        <button class="rtab${tab === id ? ' on' : ''}" data-action="codex-tab" data-tab="${id}">${label}</button>`).join('')}
    </div>

    ${/* v3.95：种族页签里能解锁 / 升级了，操作反馈得有地方落 */ ''}
    ${ui.flash ? `<div class="flash">${ui.flash}</div>` : ''}

    <div class="hall-scroll cx-scroll">
      ${body}
    </div>
  </div>`;
}
