/**
 * 角色详情页（v3.67，v3.71 / v3.72 按用户反馈两轮重排，v3.75 / v3.76 微调）。
 *
 * v3.76（用户：「方案 A 但是放在第一位」）：数值条第一格是「属性」入口 ——
 *   与生命/攻击/能量同底色同描边，图标是金线小盾（不再用告警味的 ❗）。
 * v3.75（用户：「两边还有黑边；属性的感叹号放到后面；已转正下面的竞技场
 * 次数不用展示，竞技场直接在竞技场那边才能参与」）：
 *   - hp-box 铺满 #app（420 上限在宽一点的屏上左右露黑边）；
 *   - ❗属性 入口的感叹号挪到文字后面（属性❗）；
 *   - 转正角色详情不再放「竞技场 · N/M」按钮和额度恢复倒计时，
 *     上场只去竞技场页；属性蒙板里保留评级与战绩。
 *
 * v3.72（用户：「空槽名字改武器/防具；种族头像完整展示；牌库做成真正的卡牌；
 * 装备库只展示仓库、返回回角色详情、装备 tab 移到页签同一排；详情里的背包去掉；
 * 属性不展示天赋，天赋放头像下面两个图标点击冒泡；局内接任务完成后获取额外
 * 天赋，正常额外 2-3 个」）：
 *   - 页签行变「❗属性 | 牌库 | 宝物 | 装备」：装备是一枚 tab 样式按钮
 *     （char 模式才有），点开进装备库页；底部动作去掉「装备」「背包」。
 *   - 天赋挪到立绘下：种族 / 职业（+本局额外天赋）一排小圆徽，点击弹出
 *     天赋蒙板（state.hero.talentOpen，v3.86 从内联气泡改成蒙板）；
 *     属性页签不再放天赋。
 *   - 牌库页签用真卡面（kind 配色 / 卡图 / 费用 / 文案按攻击力+天赋折算），
 *     唯一化去重，×N / +lv 角标。
 *   - 空槽小字「武器 / 防具」；立绘完整展示（height:100% contain）。
 *
 * 三种数据源共用同一副骨架：
 *   char  —— 名册角色（营地 / 冒险 / 竞技场名册点开）
 *   run   —— 探险中的一趟（战斗页点玩家头像；数值读 run.player 实时面板）
 *   ghost —— 竞技场对手快照（选人页 / 决斗场点开；只有展示，没有动作）
 *
 * 纯函数返回 HTML 字符串；tab / 展开卡由调用方状态（state.hero）传入。
 */

import { CLASSES, RACES } from '../core/characters.js';
import { CARDS, cardName, cardText, parseCard, cardKey } from '../core/cards.js';
import { itemsOf, equipBonus, equipDef as equipDefOf, EQUIP_SLOTS, SHARDS_PER_STARDUST } from '../core/equipment.js';
import { forgeTargets } from '../core/forge.js';
import { MATERIAL_PER_RELIC } from '../core/meta.js';
import { canUseLifeSeed } from '../core/mall.js';
import { talentInfo } from '../core/talents.js';
import { attrRows, valsOf } from './stats.js';
import { relicCard } from './relics.js';
import { kw } from './bits.js';
import { equipRow } from './hall.js';
import { ratingOf } from '../core/roster.js';
import { rankOf } from '../core/arena-rank.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 与 battle.js 同表（那边是模块私有的，卡面文案要同口径就抄同一份） */
const KIND_SIGN = { attack: '⚔', skill: '❖', power: '✦', status: '✖' };

/** 段位徽章（与竞技场页同一套视觉，hall.js 里那份是模块私有的，这里内联一份） */
const rankBadgeOf = (score) => {
  const r = rankOf(score);
  return `<span class="rank-badge" style="--rk:${r.color}"><i></i>${r.name} ${Math.round(score)}</span>`;
};

const faceOf = (raceId, cls = '') =>
  `<img class="hp-face-img" src="assets/img/races/${raceId}.webp" alt=""${cls ? ` data-${cls}` : ''}>`;

/** 职业小图文件名（与 battle.js 的 talentIcons 同一张表） */
const CLASS_ICON_FILE = { warrior: 'warrior', mage: 'mage', hunter: 'hunter', traveler: 'ranger' };

/** 命数点（与营地卡同一套 pip，这里独立实现避免反向依赖 hall.js） */
function livesOf(ch) {
  let s = '';
  for (let i = 0; i < ch.maxLives; i++) {
    s += `<i class="hp-pip${i < ch.lives ? ' on' : ''}"></i>`;
  }
  return `<span class="hp-lives" title="命数 ${ch.lives}/${ch.maxLives}">${s}</span>`;
}

/* ------------------------------------------------------------------ *
 * 装备槽（立绘两侧）：穿着一眼可见；管理走页签行唯一的「装备」
 * ------------------------------------------------------------------ */

/**
 * 一个装备槽：有装备显示图标 + 强化等级；空槽小字按槽位叫「武器 / 防具」
 * （v3.72：不再写"空槽"——玩家一眼知道这里该放什么）。
 */
function slotHtml(item, { id = null, cap = '空槽' } = {}) {
  const def = item ? (equipDefOf(item.defId) || { name: item.defId, slot: '' }) : null;
  const label = def ? esc(def.name) : cap;
  const inner = item
    ? `<img class="hp-slot-img" src="assets/img/equip/${item.defId}.png" alt="${esc(def.name)}">` +
      ((item.lv || 0) > 0 ? `<b class="hp-slot-lv">+${item.lv}</b>` : '')
    : '<i class="hp-slot-plus">+</i>';
  /** 名册角色：点槽位直达装备库；局内 / 幽灵只做展示 */
  const box = id && item
    ? `<button class="hp-slot" data-action="open-equip" data-id="${id}" title="${label} · 去装备库">${inner}</button>`
    : `<span class="hp-slot${item ? '' : ' empty'}" title="${label}">${inner}</span>`;
  return `<span class="hp-slot-col">${box}<i class="hp-slot-cap">${label}</i></span>`;
}

/* ------------------------------------------------------------------ *
 * 天赋：立绘下一排小圆徽（v3.72），点开是蒙板（v3.86）
 * ------------------------------------------------------------------ */

/**
 * @param {Array<{key,name,icon,text,cls}>} list  icon 是图片路径或单字符号
 * @param {string|null} openKey  当前展开的天赋 key（决定圆徽高亮）
 */
function talentsRow(list, openKey) {
  if (!list.length) return '';
  const icons = list.map((t) => `
    <button type="button" class="hp-tal${t.cls ? ` ${t.cls}` : ''}${openKey === t.key ? ' on' : ''}"
      data-action="hero-talent" data-key="${esc(t.key)}" aria-label="${esc(t.name)}">
      ${t.img ? `<img src="${t.img}" alt="">` : `<i>${esc(t.icon)}</i>`}
    </button>`).join('');
  return `<div class="hp-tal-row">${icons}</div>`;
}

/**
 * 天赋蒙板（v3.86）。
 * 用户：「点击天赋应该是弹出蒙板提示框，不要往下挤」—— 原来的气泡长在
 * 立绘下方，一展开就把数值条和页签整体推下去；改成压在页面上的卡片。
 * 顺手把**所有**天赋一次列全（当前点的那枚高亮），省得逐个点开对照。
 */
function talentMaskHtml(list, openKey) {
  const open = list.find((t) => t.key === openKey);
  if (!open) return '';
  const rows = list.map((t) => `
    <div class="hp-talent-row${t.key === openKey ? ' on' : ''}">
      <span class="hp-talent-ico">${t.img ? `<img src="${t.img}" alt="">` : `<i>${esc(t.icon)}</i>`}</span>
      <span class="hp-talent-txt">
        <b>${esc(t.name)}</b>
        <span>${kw(t.text)}</span>
      </span>
    </div>`).join('');

  return `
    <div class="hp-attrs-mask" data-action="hero-talent-close">
      <div class="hp-attrs-box hp-talent-box" data-action="hero-noop" role="dialog" aria-label="天赋详情">
        <button class="hp-close" data-action="hero-talent-close" aria-label="关闭天赋">✕</button>
        <div class="hp-sec-head"><span>天赋</span><span class="hp-sec-sub">${list.length} 枚 · 天生与委托所得</span></div>
        <div class="hp-talent-list">${rows}</div>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ *
 * 页签内容
 * ------------------------------------------------------------------ */

/** 属性蒙板内容（v3.73：属性从页签挪到上面部分的 ❗ 入口，点开蒙板展示） */
function attrMask({ attrs, extra = '' }) {
  return `
    <div class="hp-sec-head"><span>属性</span><span class="hp-sec-sub">含装备加成</span></div>
    <div class="attr-ui hp-attrs">${attrs}</div>
    ${extra}`;
}

/** 真卡面（与战斗 cardHtml 同款结构，非交互）：唯一化由调用方做好。
 *  v3.84：cardText 传整卡 key（含 +lv）—— 之前传基础 id，强化卡的数值
 *  全按 0 级显示，合成前后对比会一模一样。 */
function cardFace(key, n, atk, perk) {
  const k = parseCard(key);
  const c = CARDS[k.id];
  if (!c) return '';
  const text = cardText(key, atk, { perk: perk || {} });
  const comboTag = c.combo ? '<span class="ccombo">连携</span>' : '';
  return `
    <span class="card kind-${c.kind} hp-card">
      <i class="card-art" style="background-image:url('assets/img/cards/${c.kind}.webp')" aria-hidden="true"></i>
      <span class="ccost">${c.cost}</span>
      ${comboTag}
      <span class="cname">${KIND_SIGN[c.kind] || ''} ${cardName(key)}${n > 1 ? `<b class="hp-card-n">×${n}</b>` : ''}</span>
      <span class="ctext">${text}</span>
    </span>`;
}

/** 牌库页签（v3.72：真卡面；唯一化排序，强化级高的在前）。
 *  v3.84：页签上已有「牌库」二字，标题行去掉；左上角只留「合成」入口，
 *  点开蒙板列出可合成的卡，点卡再看合成前后对比 —— 内联合成列表撤掉。 */
function deckTab({ deck, atk, perk, forge = null }) {
  const groups = new Map();
  for (const key of deck) groups.set(key, (groups.get(key) || 0) + 1);
  const kinds = { attack: 0, skill: 0, power: 0 };
  for (const key of deck) {
    const c = CARDS[parseCard(key).id];
    if (c && kinds[c.kind] != null) kinds[c.kind]++;
  }
  const faces = [...groups.entries()]
    .sort((a, b) => parseCard(b[0]).lv - parseCard(a[0]).lv)
    .map(([key, n]) => cardFace(key, n, atk, perk)).join('');

  /** 左上角合成入口（run 模式）：有可合成的才亮，没有时也放着但变灰 */
  const forgeBtn = forge == null ? '' : `
    <button class="hp-forge-btn${forge.length ? '' : ' off'}" data-action="hero-forge-open">
      <i>⚒</i>合成${forge.length ? `<b>${forge.length}</b>` : ''}
    </button>`;

  return `
    <div class="hp-deck-head">
      ${forgeBtn}
      <span class="hp-sec-sub">${deck.length} 张 · 攻击 ${kinds.attack} / 技能 ${kinds.skill} / 本场 ${kinds.power}</span>
    </div>
    ${deck.length ? `<div class="hp-deck-cards">${faces}</div>` : '<div class="hp-hint">牌库是空的。</div>'}`;
}

/** 合成蒙板（v3.84）：第一层是可合成卡牌列表，点卡进入前后对比 + 确认合成。
 *  复用属性蒙板的外壳样式（.hp-attrs-mask / .hp-attrs-box），只换内容。 */
function forgeMaskHtml(forge, atk, perk, detailKey) {
  if (!forge) return '';
  const box = detailKey
    ? (() => {
      const t = forge.find((x) => x.key === detailKey);
      if (!t) return `
        <div class="hp-sec-head"><span>合成</span><span class="hp-sec-sub">这张卡不在可合成列表里了</span></div>
        <div class="hp-hint">可能刚被合成过。回列表看看别的。</div>
        <button class="btn ghost hp-forge-go" data-action="hero-forge-back">返回列表</button>`;
      const nextKey = cardKey(t.id, t.nextLv);
      return `
        <div class="hp-sec-head">
          <button class="hp-forge-back" data-action="hero-forge-back">‹ 可合成列表</button>
          <span class="hp-sec-sub">${esc(t.name)} ×${t.count}</span>
        </div>
        <div class="hp-forge-cmp">
          <div class="hp-forge-col">
            <span class="hp-forge-cap">当前</span>
            ${cardFace(t.key, 1, atk, perk)}
          </div>
          <i class="hp-forge-arr">→</i>
          <div class="hp-forge-col">
            <span class="hp-forge-cap">合成后</span>
            ${cardFace(nextKey, 1, atk, perk)}
          </div>
        </div>
        <div class="hp-hint">消耗两张同级的「${esc(t.name)}」（${t.lv > 0 ? `各 +${t.lv}` : '都是未强化'}）合成 1 张强化版：卡组少 1 张，另得 1 水晶材料。<br>不同等级的卡不能合 —— 一张 +${t.lv}、一张 +${t.lv + 1} 是合不了的。</div>
        <button class="btn primary hp-forge-go" data-action="forge" data-key="${esc(t.key)}">确认合成 → ${esc(t.nextName)}</button>`;
    })()
    : `
      <div class="hp-sec-head"><span>合成</span><span class="hp-sec-sub">两张同名同级 → 强化版 + 1 水晶材料</span></div>
      ${forge.length
        ? `<div class="hp-forge-list">${forge.map((t) => `
            <button class="hp-forge-item" data-action="hero-forge-card" data-key="${esc(t.key)}">
              ${cardFace(t.key, 1, atk, perk)}
              <span class="hp-forge-item-sub">${t.count} 张${t.times > 1 ? ` · 可合 ${t.times} 次` : ''}</span>
            </button>`).join('')}</div>`
        : '<div class="hp-hint">没有可以合成的卡（需要两张同名同级，且强化未满 3 级）</div>'}`;

  return `
    <div class="hp-attrs-mask hp-forge-mask" data-action="hero-forge-close">
      <div class="hp-attrs-box hp-forge-box" data-action="hero-noop" role="dialog" aria-label="卡牌合成">
        <button class="hp-close" data-action="hero-forge-close" aria-label="关闭合成">✕</button>
        ${box}
      </div>
    </div>`;
}

/** 装备页签（v3.73）：只放装备仓库 —— 空了就一行空提示，上半部分不动 */
function gearTab(meta, ch) {
  const idle = (meta.equipment || []).filter((it) => !it.by);
  const worn = itemsOf(meta, ch.id);
  const stardust = meta.stardust || 0;
  const slotsFull = worn.length >= EQUIP_SLOTS;
  const shards = meta.shards || 0;
  const canCombine = shards >= SHARDS_PER_STARDUST;
  return `
    <div class="hp-sec-head"><span>装备仓库</span><span class="hp-sec-sub">${idle.length} 件闲置 / 共 ${(meta.equipment || []).length} · 身上 ${worn.length}/${EQUIP_SLOTS}</span></div>
    ${canCombine
      ? `<div class="combine-row">
           碎片 ${shards}✧ 够合成了
           <button class="btn mini" data-action="combine-shards">合成 1✦ 星屑</button>
         </div>`
      : ''}
    ${idle.length
      ? idle.map((it) => equipRow(it, 'idle', { stardust, slotsFull })).join('')
      : '<div class="hp-hint">库里没有闲置的装备。宝箱和精英/首领身上会有。</div>'}
    <div class="hp-hint">点上面的装备槽可以进完整装备页（强化 / 庄园）。仓库里「穿上」＝自动换位。</div>`;
}

/** 宝物页签：已激活 + 待激活。
 *  v3.80：run 模式传 activate（{ materials, cost }）—— 待激活的变成
 *  带按钮的卡片，水晶材料够就能当场激活，不用再回背包页。
 *  v3.84：页签上已有「宝物」二字，顶部标题与说明行撤掉，直接上内容。 */
function relicTab(relicKeys, slots, opts = {}) {
  const act = opts.activate ?? null;
  const active = (relicKeys || []).map((key) => relicCard(key, { active: true })).join('');
  const pending = (slots || []).map((id) => relicCard(id, { active: false, activate: act })).join('');
  return `
    <div class="hp-sec-head"><span>已激活</span><span class="hp-sec-sub">${(relicKeys || []).length} 件</span></div>
    ${active || '<div class="hp-hint">还没有已激活的宝物。</div>'}
    ${pending ? `<div class="hp-sec-head"><span>待激活</span><span class="hp-sec-sub">${slots.length} 件 · ${act ? `点卡片用 ${act.cost} 水晶材料激活` : '回背包页用水晶材料激活'}</span></div>${pending}` : ''}`;
}

/* ------------------------------------------------------------------ *
 * 天赋清单组装：种族 / 职业 + 本局额外（run 模式）
 * ------------------------------------------------------------------ */

function innateTalents(race, cls, raceId) {
  const list = [];
  if (race) list.push({
    key: 'race', name: `种族 · ${race.name}`, img: `assets/img/races/${raceId}.webp`, text: race.desc, cls: 'race',
  });
  if (cls?.perkText) list.push({
    key: 'class', name: `职业 · ${cls.name}`,
    img: `assets/img/classes/${CLASS_ICON_FILE[cls.id] || 'warrior'}.png`,
    text: cls.perkText, cls: 'job',
  });
  return list;
}

function extraTalentList(run) {
  return (run.talents || []).map((id, i) => {
    const t = talentInfo(id);
    return t ? { key: `t${i}_${id}`, name: `天赋 · ${t.name}`, icon: t.icon, text: t.text, cls: 'extra' } : null;
  }).filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * 骨架
 * ------------------------------------------------------------------ */

/**
 * @param {object} p
 *   name / sub / raceId / lives / worn / hp / atk / energy
 *   tab 'deck'|'relic'|'gear'（gear 仅 char 模式）
 *   fresh         首次打开（true 时播入场动画；切页签不重播，v3.73）
 *   attrMaskBody  属性蒙板内容（❗ 入口点开时展示）
 *   attrsOpen     蒙板当前是否打开
 *   gearTab       是否显示「装备」页签（char 模式，v3.73）
 *   gearBody      装备页签内容（仓库）
 *   talents { list, openKey }  头像下的天赋圆徽 + 点开的天赋蒙板
 *   forgeMask 合成蒙板 HTML（run 模式牌库页签，v3.84）
 *   acts  底部动作按钮 HTML（可空）
 *   eqClickable  装备槽是否可点（名册角色 true）
 *   extraHead  名字下的小徽章（幽灵的段位）
 */
function skeleton(p) {
  const tabBtn = (key, label, mark = '') =>
    `<button class="hp-tab${p.tab === key ? ' on' : ''}" data-action="hero-tab" data-tab="${key}">${mark ? `<i class="hp-tab-mark">${mark}</i>` : ''}${label}</button>`;

  const body = p.tab === 'relic' ? p.relicBody : p.tab === 'gear' ? p.gearBody : p.deckBody;

  return `
  <div class="overlay hero-page${p.fresh ? ' fresh' : ''}" data-action="close-hero-page" role="dialog" aria-label="角色详情">
    <div class="hp-box" data-action="hero-noop">
      <button class="hp-close" data-action="close-hero-page" aria-label="关闭">✕</button>

      <div class="hp-head">
        <div class="hp-name-row">
          <b class="hp-name">${esc(p.name)}</b>
          ${p.extraHead || ''}
          ${p.lives || ''}
        </div>
        <span class="hp-sub">${p.sub}</span>
      </div>

      <div class="hp-stage">
        ${slotHtml(p.worn[0], { id: p.eqClickable ? p.charId : null, cap: '武器' })}
        <div class="hp-portrait-wrap">
          <div class="hp-portrait">${faceOf(p.raceId)}</div>
          ${talentsRow(p.talents?.list || [], p.talents?.openKey ?? null)}
        </div>
        ${slotHtml(p.worn[1], { id: p.eqClickable ? p.charId : null, cap: '防具' })}
      </div>

      <div class="hp-vitals">
        <button class="hp-v hp-v-attrs" data-action="hero-attrs" aria-label="查看属性详情">
          <i class="hp-v-shield"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/></svg></i>属性<span class="hp-v-go">›</span>
        </button>
        <span class="hp-v hp"><i>❤</i>生命 <b>${p.hp}</b></span>
        <span class="hp-v atk"><i>⚔</i>攻击 <b>${p.atk}</b></span>
        <span class="hp-v en"><i>⚡</i>能量 <b>${p.energy}</b></span>
      </div>

      <div class="hp-tabs">
        ${tabBtn('deck', '牌库')}
        ${tabBtn('relic', '宝物')}
        ${p.gearTab ? tabBtn('gear', '装备') : ''}
      </div>

      <div class="hp-body">${body}</div>

      ${p.acts ? `<div class="hp-acts">${p.acts}</div>` : ''}

      ${p.attrsOpen ? `
      <div class="hp-attrs-mask" data-action="hero-attrs-close">
        <div class="hp-attrs-box" data-action="hero-noop" role="dialog" aria-label="属性详情">
          <button class="hp-close" data-action="hero-attrs-close" aria-label="关闭属性">✕</button>
          ${p.attrMaskBody || ''}
        </div>
      </div>` : ''}

      ${p.forgeMask || ''}

      ${talentMaskHtml(p.talents?.list || [], p.talents?.openKey ?? null)}
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ *
 * 三种数据源
 * ------------------------------------------------------------------ */

const TAB_KEYS = ['deck', 'relic', 'gear'];
const tabOf = (t) => (TAB_KEYS.includes(t) ? t : 'deck');

/** 名册角色（营地 / 冒险 / 竞技场名册） */
export function heroPageChar(meta, ch, ui = {}) {
  const cls = CLASSES[ch.classId];
  const race = RACES[ch.raceId];
  const worn = itemsOf(meta, ch.id);
  const bonus = equipBonus(worn);
  const running = meta.run?.characterId === ch.id;
  const tab = tabOf(ui.tab);

  const sub = `Lv.${ch.level || 1} · ${ch.name === `${race?.name ?? ''}${cls?.name ?? ''}` ? '' : `${esc(race?.name ?? ch.raceId)}${esc(cls?.name ?? ch.classId)} · `}${ch.veteran ? '已转正' : '实习期'}`;

  /**
   * 动作区（v3.75：转正角色不再放「竞技场」按钮 —— 参与只在竞技场页，
   * 详情页专心看人。探险中只能继续/放弃；实习的名册角色没有动作。）
   */
  let acts = '';
  if (running) {
    acts = `
      <button class="btn primary" data-action="resume">继续探险</button>
      ${ui.confirmAbandon
        ? `<button class="btn danger" data-action="abandon" data-id="${ch.id}">真的放弃？扣 1 命</button>
           <button class="btn ghost" data-action="cancel-abandon">再想想</button>`
        : `<button class="btn ghost danger" data-action="abandon" data-id="${ch.id}">放弃探险 · -1 命</button>`}`;
  } else if (ch.veteran || ch.status === 'idle') {
    /**
     * 命数之种（v3.90）：有名册角色、账号里有种子、命数没到顶，才亮按钮。
     * 不可用时按钮消失而不是 disabled —— 差一个条件就多一行灰字，页面太吵；
     * 种子的获取途径写在商城那侧，详情页只负责"能用就给按"。
     */
    const seed = canUseLifeSeed(meta, ch);
    if (seed.ok) {
      acts = `
        <button class="btn primary" data-action="use-seed" data-id="${ch.id}">
          🌱 种下命数之种 · ${ch.lives} → ${ch.lives + 1}（种子 ×${meta.lifeSeeds}）
        </button>`;
    }
  }

  const note = running
    ? (meta.run?.paused ? '<div class="hp-note">探险已暂停 · 进度保留</div>' : `<div class="hp-note">探险中 · 第 ${meta.run?.floor ?? 1} 层 · 阵亡或放弃都要 -1 命</div>`)
    : ch.veteran
      ? `<div class="hp-note">评级 ${ratingOf(ch)} · 竞技场 ${ch.record.arenaWins}胜${ch.record.arenaLosses}负 · 要上场去竞技场页</div>`
      : `<div class="hp-note">第 ${(ch.record?.exploreCount ?? 0) + 1} 次进塔 · 最远 ${ch.record?.bestFloor ?? 0} 层 · 活着回来就转正</div>`;

  return skeleton({
    name: ch.name,
    sub,
    raceId: ch.raceId,
    lives: livesOf(ch),
    worn,
    hp: ch.maxHp,
    atk: ch.atk,
    energy: ch.energy ?? 8,
    tab,
    fresh: !!ui.fresh,
    attrsOpen: !!ui.attrsOpen,
    charId: ch.id,
    eqClickable: true,
    gearTab: true,
    gearBody: gearTab(meta, ch),
    talents: { list: innateTalents(race, cls, ch.raceId), openKey: ui.talentOpen ?? null },
    attrMaskBody: attrMask({
      attrs: attrRows(valsOf(ch), { cls, bonus }),
      extra: note,
    }),
    deckBody: deckTab({
      deck: ch.deck,
      atk: ch.atk,
      perk: cls?.perk,
    }),
    relicBody: relicTab(ch.relics, ch.relicSlots),
    acts,
  });
}

/** 探险中的一趟（战斗页点玩家头像）：数值读 run.player 实时面板 */
export function heroPageRun(meta, run, ui = {}) {
  const cls = CLASSES[run.classId];
  const race = RACES[run.raceId];
  const worn = itemsOf(meta, run.characterId);
  const p = run.player;
  const tab = tabOf(ui.tab);
  const b = run.battle?.player;

  const sub = `${esc(race?.name ?? '')}${esc(cls?.name ?? '')} Lv.${p.level || 1} · 第 ${run.floor} 层 · 古币 ${run.gold || 0}`;

  /** 战斗中血条读本场实时血量；地图上就是满血 */
  const hpText = b ? `${b.hp} / ${b.maxHp}` : `${p.maxHp}`;

  /** 本场临时状态（护甲 / 力量…）—— 属性之外"我现在几斤几两" */
  const chips = [];
  if (b) {
    if (b.armor > 0) chips.push(`<span class="chip">护甲 ${b.armor}</span>`);
    if (b.strength > 0) chips.push(`<span class="chip">力量 +${b.strength}</span>`);
    if (b.thorns > 0) chips.push(`<span class="chip">荆棘 ${b.thorns}</span>`);
    if (b.weakTurns > 0) chips.push(`<span class="chip weak">虚弱 ${b.weakTurns}</span>`);
  }
  /**
   * v3.72：进行中的委托进度（天赋 / 委托都在这一趟里攒）。
   * v3.85：委托扩到 5 种 —— 名字与进度口径从 run.quest 直接读
   * （接受时写进去的），不再在 UI 里硬编码 id 表；旧档没有字段时按表兜底。
   */
  const questNote = run.quest
    ? (() => {
      const q = { hunt: ['讨伐委托', '击败敌人'], drill: ['修行委托', '打出攻击牌'], trek: ['跋涉委托', '通过层数'], scavenge: ['寻宝委托', '打开宝箱'], craft: ['精进委托', '合成卡牌'] }[run.quest.id] || ['委托', '进度'];
      const name = run.quest.name || q[0];
      const label = run.quest.goalLabel || q[1];
      return `<div class="hp-note quest"><span class="chip-tag">委托</span>${name} · ${label} ${run.quest.progress}/${run.quest.target}</div>`;
    })()
    : '';

  const battleNote = chips.length
    ? `<div class="hp-note battle"><span class="chip-tag">本场</span>${chips.join('')}</div>`
    : '';

  return skeleton({
    name: run.characterName ?? '冒险者',
    sub,
    raceId: run.raceId,
    lives: livesOf(meta.roster.find((c) => c.id === run.characterId) || { lives: 0, maxLives: 0 }),
    worn,
    hp: hpText,
    atk: p.atk,
    energy: p.energy ?? p.energyCap ?? 8,
    tab,
    fresh: !!ui.fresh,
    attrsOpen: !!ui.attrsOpen,
    eqClickable: false,
    talents: {
      list: [...innateTalents(race, cls, run.raceId), ...extraTalentList(run)],
      openKey: ui.talentOpen ?? null,
    },
    attrMaskBody: attrMask({
      attrs: attrRows(valsOf(p), { cls }),
      extra: questNote + battleNote,
    }),
    deckBody: deckTab({
      deck: run.deck,
      atk: p.atk,
      perk: run.perk ?? cls?.perk,
      forge: forgeTargets(run.deck), // v3.80：run 模式带合成入口
    }),
    // v3.84：合成蒙板只在 forgeOpen 时渲染；forgeDetail 决定是列表还是前后对比
    forgeMask: ui.forgeOpen
      ? forgeMaskHtml(forgeTargets(run.deck), p.atk, run.perk ?? cls?.perk, ui.forgeDetail ?? null)
      : '',
    relicBody: relicTab(run.relics, run.relicSlots, { activate: { materials: run.materials || 0, cost: MATERIAL_PER_RELIC } }),
    acts: '',
  });
}

/** 竞技场对手快照（选人页 / 决斗场）：只展示，无动作 */
export function heroPageGhost(ghost, ui = {}) {
  const cls = CLASSES[ghost.classId];
  const race = RACES[ghost.raceId];
  const worn = ghost.equipped || [];
  const tab = tabOf(ui.tab);

  return skeleton({
    name: ghost.name,
    sub: `Lv.${ghost.level || 1} · ${esc(race?.name ?? ghost.raceId)}${esc(cls?.name ?? ghost.classId)} · ${ghost.veteran ? '已转正' : '实习期'} · 其他玩家的旧影`,
    raceId: ghost.raceId,
    lives: livesOf(ghost),
    extraHead: ghost.arenaScore != null ? rankBadgeOf(ghost.arenaScore) : '',
    worn,
    hp: ghost.maxHp,
    atk: ghost.atk,
    energy: ghost.energy ?? 8,
    tab,
    fresh: !!ui.fresh,
    attrsOpen: !!ui.attrsOpen,
    eqClickable: false,
    talents: { list: innateTalents(race, cls, ghost.raceId), openKey: ui.talentOpen ?? null },
    attrMaskBody: attrMask({
      attrs: attrRows(valsOf(ghost), { cls }),
    }),
    deckBody: deckTab({
      deck: ghost.deck,
      atk: ghost.atk,
      perk: cls?.perk,
    }),
    relicBody: relicTab(ghost.relics, ghost.relicSlots || []),
    acts: '',
  });
}
