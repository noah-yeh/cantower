/**
 * 战斗界面 —— 只读 core，不改状态
 */

import { battleView } from '../core/combat.js';
import { cardText, cardOf } from '../core/cards.js';
import { MAX_FLOOR } from '../core/enemies.js';
import { ENEMY_CARDS, enemyCardText } from '../core/enemyCards.js';
import { CLASSES, RACES } from '../core/characters.js';
import { KNOWLEDGE_PER_POINT } from '../core/leveling.js';
import { relicChips, relicSheet } from './relics.js';
import { attrRows } from './stats.js';
import { runCoin } from './bits.js';

const KIND_SIGN = { attack: '⚔', skill: '❖', power: '✦', gem: '◆', status: '✖' };

/** 宝石配色（v3.91）：卡面与状态栏 chip 共用一套色，看见颜色就知道是哪颗 */
export const GEM_TONE = {
  gem_ruby: 'ruby',
  gem_sapphire: 'sapphire',
  gem_emerald: 'emerald',
  gem_topaz: 'topaz',
  gem_amethyst: 'amethyst',
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * 已镶宝石的状态 chip（v3.91）—— 战场与竞技场共用。
 *
 * 用户的要求是「使用后可以装备在状态栏」：宝石不像力量/荆棘那样只是一个数字，
 * 玩家要能认出"我这把镶了哪几颗"。所以 chip 带宝石自己的颜色 + 名称，
 * 点开看具体效果（走既有的 show-tip 气泡，和词条/宝物同一套交互）。
 */
export function gemChips(gems) {
  return (gems || []).map((g) => `
    <span class="chip gem g-${GEM_TONE[g.id] || 'plain'}"
      data-action="show-tip" data-name="${esc(g.name)}"
      data-text="${esc(`镶嵌效果（本场战斗）：${g.text}`)}">◆ ${esc(g.name)}</span>`).join('');
}

function pct(cur, max) {
  return max <= 0 ? 0 : Math.max(0, Math.min(100, (cur / max) * 100));
}

/**
 * 通用折叠信息行（v3.44，参照用户给的参考截图）。
 *
 * 状态 chips + 词条/天赋挤在血条旁；v3.69 起默认**最多铺 3 行**，
 * 装不下的自动收起（overflow hidden 裁掉），右侧一枚 ▾ 手动展开 /
 * ▴ 收回。开关是否真的出现由 `alignTagRows()` 在渲染后实测：
 * 3 行装得下就藏起按钮，装不下才给入口。
 *
 * @param {string[]} chips  已渲染好的 chip HTML
 * @param {boolean} open    当前是否展开
 * @param {string} action   展开按钮的 action 名
 * @param {'player'|'foe'} side  多行时的对齐方向（v3.48，见 `alignTagRows`）
 */
function tagsRow(chips, open, action, side = 'player') {
  if (!chips.length) return '';
  /** 超过一枚大概率有富余才需要开关；是否溢出由渲染后的实测决定 */
  const overflow = chips.length > 3;
  return `
  <div class="tags-row side-${side}${open ? ' open' : ''}">
    <div class="tags-line">${chips.join('')}</div>
    ${overflow ? `<button class="tags-toggle" data-action="${action}"
      aria-label="${open ? '收起' : '展开'}">${open ? '▴' : '▾'}</button>` : ''}
  </div>`;
}

/**
 * 折叠行展开后的多行对齐（v3.48，用户：「往上排第二行起应该是左对齐，
 * 敌人也是一样镜像 …右对齐」）。
 *
 * 首行（贴血条那行）保持居中 —— 状态少时一行居中最好看；
 * 从第二行起，玩家侧向左对齐、敌人侧向右对齐（镜像），形成整齐的一侧边界。
 *
 * 纯 CSS 做不到「首行居中、续行左对齐」：`justify-content` 对整块生效。
 * 这里用 auto margin 实现 —— 只在**首行**的首/末元素上挂左右 auto，
 * 该行内容被挤到中间；其余行交给容器的 flex-start / flex-end。
 * 行边界用 offsetTop 判定（同高即同一行）。
 */
export function alignTagRows(root = document) {
  /**
   * v3.69：开关显隐实测。默认态最多 3 行，装得下就没必要给开关；
   * 装不下（scrollHeight 超出裁剪区）才显示 ▾。展开态恒显 ▴ 供收回。
   */
  for (const row of root.querySelectorAll('.tags-row')) {
    const line = row.querySelector('.tags-line');
    const btn = row.querySelector('.tags-toggle');
    if (!line || !btn) continue;
    if (row.classList.contains('open')) { btn.style.display = ''; continue; }
    btn.style.display = line.scrollHeight > line.clientHeight + 1 ? '' : 'none';
  }
  for (const row of root.querySelectorAll('.tags-row.open')) {
    const line = row.querySelector('.tags-line');
    if (!line) continue;
    const kids = [...line.children].filter((el) => el.nodeType === 1);
    for (const el of kids) { el.style.marginLeft = ''; el.style.marginRight = ''; }
    if (kids.length < 3) continue;
    const rows = [];
    let top = null;
    for (const el of kids) {
      if (top === null || Math.abs(el.offsetTop - top) > 4) { rows.push([]); top = el.offsetTop; }
      rows[rows.length - 1].push(el);
    }
    if (rows.length < 2) continue;
    /**
     * 贴血条的那一行居中，其余行按侧对齐。
     * 敌人是往下排，贴血条的是 DOM 第一行；玩家是往上长，
     * 贴血条的反而是**最后一行**（新行叠在上方）。
     */
    const keep = row.classList.contains('side-player') ? rows[rows.length - 1] : rows[0];
    keep[0].style.marginLeft = 'auto';
    keep[keep.length - 1].style.marginRight = 'auto';
    /** 玩家侧是往上长的：行数多到要滚时，血条旁那一行才是要看的 */
    if (row.classList.contains('side-player')) line.scrollTop = line.scrollHeight;
  }
}

/**
 * 战斗记录面板。
 *
 * 敌人不再预告意图，玩家只能从"它上一回合实际打了什么"去读它 ——
 * 这份记录就是那个窗口。按回合分组、最新在上，和聊天记录一个习惯。
 */
function logPanel(log) {
  const groups = [];
  for (const row of log || []) {
    if (row.side === 'turn') groups.push({ label: row.detail, rows: [] });
    else if (groups.length) groups[groups.length - 1].rows.push(row);
  }
  groups.reverse();

  const body = groups.length === 0
    ? '<div class="empty small">还没有记录</div>'
    : groups.map((g) => `
      <div class="log-group">
        <div class="log-turn">${esc(g.label)}</div>
        ${g.rows.map((r) => `
          <div class="log-row ${r.side}">
            <span class="log-who">${r.side === 'player' ? '你' : '敌'}</span>
            <span class="log-name">${esc(r.name || '—')}</span>
            <span class="log-detail">${esc(r.detail)}</span>
          </div>`).join('')}
      </div>`).join('');

  return `
  <div class="log-overlay overlay" data-action="close-log">
    <div class="log-sheet" data-action="log-noop">
      <div class="log-head">
        <span>战斗记录</span>
        <button class="btn ghost mini" data-action="close-log">关闭</button>
      </div>
      <div class="log-body">${body}</div>
    </div>
  </div>`;
}

/**
 * 连携条件满没满（v3.15）。
 *
 * 口径必须和 combat.applyCard 的结算完全一致 —— 差一点玩家就会觉得
 * "牌面说亮了，打出去却没加成"。门槛值只用于显示，不改结算。
 */
function comboReady(v, c) {
  if (!c.combo) return null;
  const p = v.player;
  const e = v.enemy;
  if (c.poisonBurst != null) return e.poison >= 6;
  if (c.consumeArmorMul != null) return p.armor >= 12;
  if (c.dmgPerArmor != null) return p.armor >= 10;
  if (c.perSkill != null) return (v.skillsThisTurn || 0) >= 1;
  if (c.perCard != null) return (v.cardsThisTurn || 0) >= 2;
  if (c.ifWeakMul != null) return e.weakTurns > 0;
  return null;
}

/**
 * 手牌卡面（v3.33 起导出给竞技场复用）。
 *
 * 竞技场的手牌必须是**同一张卡**、同一个数字口径 —— 复制一份出来迟早会分叉，
 * 所以这里只导出、不复制。
 */
export function cardHtml(id, index, playable, atk, view) {
  const c = cardOf(id);
  if (!c) return '';
  /**
   * v3.24：卡面数字按**当前角色的职业天赋**折算（法师的打击 +34%、猎人 +8%）。
   * 传 view.perk 而不是写死 —— 否则玩家会看到"卡面 16、实际打 21"。
   */
  const text = cardText(id, atk, { perk: view?.perk });
  /**
   * 连携牌挂角标：满足条件时点亮成金色。
   * 这是"套路"能被玩家看见的唯一入口 —— 光在说明文字里写一句加成就等于没做。
   */
  const ready = view ? comboReady(view, c) : null;
  const comboTag = c.combo
    ? `<span class="ccombo${ready ? ' on' : ''}">${ready ? '连携 ✓' : '连携'}</span>`
    : '';
  /**
   * 宝石（v3.91）：没有对应的 kind 图（只有 attack/skill/power/status 四张），
   * 用配色代替插画 —— 五颗宝石各一个色调，卡面一眼能分出是哪颗。
   */
  const gemTone = GEM_TONE[id.replace(/\+\d+$/, '')];
  const art = c.kind === 'gem'
    ? `<i class="card-art gem-art" aria-hidden="true"></i>`
    : `<i class="card-art" style="background-image:url('assets/img/cards/${c.kind}.webp')" aria-hidden="true"></i>`;
  return `
    <button class="card kind-${c.kind}${gemTone ? ` g-${gemTone}` : ''} ${playable ? 'playable' : 'disabled'}${ready ? ' combo-on' : ''}"
            data-action="play" data-index="${index}">
      ${art}
      <span class="ccost">${c.cost}</span>
      ${comboTag}
      <span class="cname">${KIND_SIGN[c.kind] || ''} ${c.name}</span>
      <span class="ctext">${text}</span>
    </button>`;
}

/**
 * 敌人刚打出的那张牌（v3.37）。
 *
 * 与竞技场 foePlayHtml 同构：敌人回合逐张播放，这里显示"它刚刚打了什么、
 * 实际结算是多少"。没牌时显示回合状态（你的回合 / 敌人正在出牌）。
 * 敌人牌不做卡面折算 —— 它结算的摘要就是最准的数字（记录行里有）。
 */
function foePlayHtml(step, enemyTurn) {
  if (!step) {
    return `<div class="foe-play idle">
      <span class="fp-name">${enemyTurn ? '敌方回合' : '你的回合'}</span>
      <span class="fp-detail">${enemyTurn ? '它正在出牌…' : '轮到你了'}</span>
    </div>`;
  }
  if (step.done && !step.card) {
    return `<div class="foe-play idle"><span class="fp-name">敌方回合结束</span>
      <span class="fp-detail">${esc(step.line?.detail || '回合交还给你')}</span></div>`;
  }
  return `<div class="foe-play">
    <span class="fp-cost">${step.card.cost}</span>
    <span class="fp-name">${esc(step.card.name)}</span>
    <span class="fp-detail">${esc(step.line?.detail || '')}</span>
  </div>`;
}

/**
 * 天赋小图标（v3.44，用户：「去掉中间的种族职业描述，直接用小图标展示，
 * 点击再展示描述」）。
 *
 * v3.42 的两枚文字 chip 太占宽度（一行只装得下它们，状态被挤走）。
 * 现在改成两枚 24px 小图（种族立绘 + 职业徽记），与状态 chips 并排；
 * 点一下在行下方展开完整描述，再点收起。悬停（桌面）保留 title。
 */
const CLASS_ICON_FILE = { warrior: 'warrior', mage: 'mage', hunter: 'hunter', traveler: 'ranger' };

function talentIcons(run) {
  const race = RACES[run.raceId];
  const cls = CLASSES[run.classId];
  const icon = (src, name, text) => `
    <button class="ticon" data-action="show-tip" data-name="${esc(name)}" data-text="${esc(text)}"
      title="${esc(name)}" aria-label="${esc(name)}">
      <img src="${src}" alt="" onerror="this.remove()">
    </button>`;
  const icons = [];
  if (race) icons.push(icon(`assets/img/races/${run.raceId}.webp`, `种族 · ${race.name}`, race.desc));
  if (cls?.perkText) {
    const file = CLASS_ICON_FILE[run.classId] || 'warrior';
    icons.push(icon(`assets/img/classes/${file}.png`, `职业 · ${cls.name}`, cls.perkText));
  }
  return icons;
}

/**
 * 战场中线：平时是一句"敌方回合"提示，现在兼作**最新一条战斗记录**。
 *
 * 用户两次反馈"战斗时看不到战斗记录"。入口按钮其实一直在，问题是它得先点开 ——
 * 战斗中玩家没有那个耐心。把最近一条动态钉在这条中线上，战况就一直在眼前，
 * 想看完整的分回合记录再点进来。
 */
function midlineHtml(v, enemyTurn) {
  const last = [...(v.log || [])].reverse().find((r) => r.side !== 'turn');
  const text = last
    ? `${last.side === 'player' ? '你' : '敌'} · ${last.name} ${last.detail}`
    : (enemyTurn ? '敌方回合' : '· · ·');
  return `<button class="midline${last ? ' has-log' : ''}" data-action="open-log"
    title="点开完整战斗记录">${enemyTurn ? '<i class="ml-turn">敌</i>' : ''}<span class="ml-text">${esc(text)}</span></button>`;
}

/** 同名牌合并成「挥击 ×2」，牌库一屏才放得下 */
function groupByCard(ids) {
  const map = new Map();
  for (const id of ids || []) map.set(id, (map.get(id) || 0) + 1);
  return [...map].map(([id, n]) => ({ id, n }));
}

/**
 * 敌人信息浮层（v3.44，用户：「可以直接点击敌人查看牌库以及属性，机制跟玩家一样」）。
 *
 * 点敌人立绘打开。上半是属性区（生命/攻击/防御/每回合能量 + 词条全文，
 * 对齐玩家属性面板的口径），下半是牌库三堆。
 * 只公开"它带了哪些牌、什么词条"，**不公开洗牌顺序与意图** ——
 * 敌人不预告意图这条设计不被破坏：能预判它可能打什么，猜不到这回合先打哪张。
 */
/**
 * 词条说明文案（v3.52）。
 * 尖刺/荆棘的反弹不是固定点数、也不吃层数，而是 **本体生命 × 比例**
 * （尖刺 2%、荆棘 3%）：怪物的生命随深入成长，反弹自然变高。
 * 旧文案「受击时反弹伤害」既不说反弹多少、也不说按什么算（用户反馈），
 * 这里按真实公式折算成当前这一只的具体数字。
 */
function traitText(t, e) {
  if (t.kind === 'thorns') {
    const pct = Math.round((t.value || 0) * 100);
    const body = e.baseHp || e.maxHp || 0;
    const n = Math.round((t.value || 0) * body);
    return `受击时反弹 ${n} 点伤害（按它自身生命 ${body} 的 ${pct}% 计算）`;
  }
  return t.text;
}

/**
 * 敌人属性与牌库（v3.54 重排）。
 *
 * 用户：「所有怪物敌人的属性面板应该是跟玩家同一套的呀，现在总共应该有 9 种属性，
 * 怎么把机制啥的也放进去」—— 旧版把词条（荆棘 / 迅捷…）排进「属性」块，
 * 还只列 4 行，读起来像敌人另有一套残缺属性。
 *
 * 现在三块分开：
 *   1. 属性 —— 与玩家面板同一个渲染器（stats.js `attrRows`），9 项全列；
 *      敌人不参与结算的 5 项显示 `—` 并注明，不编 0。
 *   2. 机制 —— 核心词条 + 变异词条，才是"这只怪的特殊规则"。
 *   3. 牌库 —— 手中 / 抽牌堆 / 弃牌堆。
 */
function foeInfoSheet(e) {
  const d = e.deck || { hand: [], draw: [], discard: [] };

  const status = [];
  status.push(`<span class="chip">生命 ${e.hp} / ${e.maxHp}</span>`);
  if (e.armor > 0) status.push(`<span class="chip armor">护甲 ${e.armor}</span>`);
  if (e.poison > 0) status.push(`<span class="chip">中毒 ${e.poison}</span>`);
  if (e.weakTurns > 0) status.push(`<span class="chip weak">虚弱 ${e.weakTurns}</span>`);

  const attrs = `
    <div class="fd-sec">
      <div class="fd-head">属性</div>
      <div class="sp-battle"><span class="sp-battle-tag">本场</span>${status.join('')}</div>
      ${attrRows({
        maxHp: e.maxHp, atk: e.atk, def: e.def || 0,
        crit: e.crit || 0, dodge: e.dodge || 0, knowledge: e.knowledge || 0,
        energy: e.energyCap,
      }, { foe: true })}
    </div>`;

  const traits = e.traits || [];
  const mech = traits.length
    ? `<div class="fd-sec">
        <div class="fd-head">机制 <b>${traits.length}</b> 条</div>
        <div class="sp-list">
          ${traits.map((t) => `
            <div class="sp-row mech">
              <span class="sp-ico i-${t.core ? 'mech' : 'mut'}">${t.core ? '✦' : '✧'}</span>
              <span class="sp-key"><b>${esc(t.name)}${t.core ? '<i class="fd-n">核心</i>' : ''}</b></span>
              <span class="sp-desc">${esc(traitText(t, e))}</span>
            </div>`).join('')}
        </div>
      </div>`
    : '';

  const section = (label, ids, tone) => {
    const groups = groupByCard(ids);
    const body = groups.length
      ? groups.map((g) => {
        const c = ENEMY_CARDS[g.id];
        if (!c) return '';
        return `<div class="fd-row ${tone}">
          <span class="fd-cost">${c.cost}</span>
          <span class="fd-name">${esc(c.name)}${g.n > 1 ? `<i class="fd-n">×${g.n}</i>` : ''}</span>
          <span class="fd-text">${esc(enemyCardText(g.id, e.atk, e.maxHp))}</span>
        </div>`;
      }).join('')
      : '<div class="empty small">空</div>';
    return `<div class="fd-sec">
      <div class="fd-head">${label} <b>${(ids || []).length}</b> 张</div>${body}
    </div>`;
  };

  const total = d.hand.length + d.draw.length + d.discard.length;
  return `
  <div class="log-overlay overlay" data-action="close-foe-deck">
    <div class="log-sheet" data-action="foe-deck-noop">
      <div class="log-head">
        <span>${esc(e.name)} · 属性与牌库 ${total} 张</span>
        <button class="btn ghost mini" data-action="close-foe-deck">关闭</button>
      </div>
      <div class="log-body attr-ui">
        ${attrs}
        ${mech}
        ${section('手中', d.hand, 'hand')}
        ${section('抽牌堆', d.draw, 'draw')}
        ${section('弃牌堆', d.discard, 'discard')}
        <div class="fd-note">顺序不公开：能看出它可能打什么，看不出这回合一定先打哪张。</div>
      </div>
    </div>
  </div>`;
}

const TIER_BADGE_OF = { elite: '<span class="tier">精英</span>', boss: '<span class="tier">章节首领</span>' };

/**
 * 敌人立绘（v3.10 全员单体像）：10 种小怪 + 3 个首领每只都有自己的图，
 * 直接按 id 取图，没有的兜底到 goblin。地图页（dungeon.js）不剧透具体是谁，
 * 普通格用 goblin、首领格用守门人。
 */
function monsterImgOf(id) {
  return `assets/img/monsters/${id}.webp`;
}

export function renderBattle(run, ui = {}) {
  /**
   * 兜底页必须留一条出路（v3.9.1）。
   *
   * 以前这里只印一句"战斗已结束"、没有任何按钮 —— 状态一旦坏掉，
   * 玩家就被关在这个空屏上，只能杀进程重开。现在给一个明确的回大厅出口。
   */
  if (!run || !run.battle) {
    return `<div class="overlay">
      <p class="sub">这一场已经不在了</p>
      <p class="hint">战斗状态没能恢复。回大厅看看，那趟探险可能已经结束。</p>
      <button class="btn primary wide" data-action="back-hall">回大厅</button>
    </div>`;
  }

  const v = battleView(run.battle);
  const p = v.player;
  const e = v.enemy;
  const atk = p.atk + p.strength;
  const energy = p.energy;
  const enemyTurn = v.phase === 'enemy';
  const busy = !!ui.busy;

  const chapter = run.floor <= 10 ? '第一章 · 塔基' : run.floor <= 20 ? '第二章 · 回廊' : '第三章 · 塔顶';

  const enemyStatus = [];
  if (e.armor > 0) enemyStatus.push(`<span class="chip armor">护甲 ${e.armor}</span>`);
  if (e.poison > 0) enemyStatus.push(`<span class="chip poison">中毒 ${e.poison}</span>`);
  if (e.weakTurns > 0) enemyStatus.push(`<span class="chip weak">虚弱 ${e.weakTurns}</span>`);
  if (e.def > 0) enemyStatus.push(`<span class="chip def">防御 ${e.def}</span>`);

  const playerStatus = [];
  /** 宝石（v3.91）排在最前：它是玩家这一场主动"装上去"的东西，最该先看见 */
  const gemHtml = gemChips(v.gems);
  if (gemHtml) playerStatus.push(gemHtml);
  if (p.armor > 0) playerStatus.push(`<span class="chip armor">护甲 ${p.armor}</span>`);
  if (p.strength > 0) playerStatus.push(`<span class="chip">力量 +${p.strength}</span>`);
  if (p.thorns > 0) playerStatus.push(`<span class="chip">荆棘 ${p.thorns}</span>`);
  if (p.weakTurns > 0) playerStatus.push(`<span class="chip weak">虚弱 ${p.weakTurns}</span>`);
  if (p.knowledge > 0) {
    const bonus = Math.round(p.knowledge * KNOWLEDGE_PER_POINT * 100);
    playerStatus.push(`<span class="chip know">知识 ${p.knowledge} · 印记 +${bonus}%</span>`);
  }
  /** v3.46：防御/暴击/闪避/恢复四项不再进战斗状态行（用户：「在详情属性里面都有」）。
      它们是整局不变的面板值，每场战斗都常驻占一行只会把天赋图标挤走；
      动态状态（护甲/力量/虚弱/知识）仍保留 —— 那些是战斗里实时变化的。 */

  const hand = v.hand
    /** v2.1：unplayable（伤口）即使能量够也不亮 —— 判定与 combat.canPlay 同源 */
    .map((id, i) => {
      const c = cardOf(id);
      const playable = !enemyTurn && !busy && !!c && !c.unplayable && c.cost <= energy;
      return cardHtml(id, i, playable, atk, v);
    })
    .join('');

  /**
   * v3.83（用户：「出完牌卡牌的情况下不用收缩起来，保持牌区展开的状态，
   * 可以在牌区做点什么样式，就不会空着的时候看着怪」）：
   * 手牌空时不再留一片塌陷的空白 —— 牌区高度锚定两排，空位用四个虚影牌位
   * + 一句提示填上，读起来是"牌打完了"而不是"界面坏了"。
   */
  const handEmpty = !v.hand.length
    ? `<div class="hand-empty" aria-hidden="true">
         <span class="he-ghosts"><i></i><i></i><i></i><i></i></span>
         <span class="he-title">${enemyTurn ? '敌方回合' : '手牌打完了'}</span>
         <span class="he-sub">${enemyTurn ? '等它出完牌…' : '点右下「结束回合」进入下一轮'}</span>
       </div>`
    : '';

  const tierBadge = TIER_BADGE_OF[e.tier] ?? '';
  /** 立绘缺失时 onerror 直接移除，不留破图图标。v3.44：包成按钮 —— 点它看敌人属性与牌库 */
  const face = `<button class="face-btn" data-action="open-foe-deck" title="点击查看敌人属性与牌库" aria-label="查看敌人信息">
    <img class="enemy-face" src="${monsterImgOf(e.id)}" alt="" onerror="this.remove()">
  </button>`;

  return `
    <div class="topbar">
      <span class="floor">第 ${run.floor} 层 / ${MAX_FLOOR}</span>
      <!-- 章节文字在战斗页省掉：顶栏要塞下暂停 / 职业 / 金币 / 记录 / 背包，密度已经到顶 -->
      <span class="top-right">
        <button class="mini-btn" data-action="pause" title="暂停并回大厅，进度保留">⏸</button>
        <!-- v3.39 顶栏瘦身：职业种族挪进属性面板（加「属性」按钮后这里会挤出屏幕，
             「记录」「背包」被顶出可视区 —— 用户报的"看不到战斗记录"就是它） -->
        <b>Lv.${run.player.level}</b>
        <span class="run-gold" title="古币 · 塔里的钱，只能给行商，出塔就蒸发">${runCoin()} ${run.gold || 0}</span>
        <button class="mini-btn" data-action="open-run-stats" title="查看属性与天赋">属性</button>
        <button class="mini-btn" data-action="open-log">记录</button>
        <!-- v3.87：背包并入角色详情页（牌库/宝物/合成都在那儿） -->
        <button class="mini-btn" data-action="open-hero" title="角色详情 · 卡组与宝物">角色</button>
      </span>
    </div>

    <div class="tower-bg" style="background-image:url('assets/img/bg/ch${run.floor <= 10 ? 1 : run.floor <= 20 ? 2 : 3}.webp')" aria-hidden="true"></div>
    <div class="stage">
      <div class="enemy-zone">
        ${face}
        <div class="enemy-name">${e.name}${tierBadge}</div>
        <div class="hpbar hp-enemy">
          <div class="fill" style="width:${pct(e.hp, e.maxHp)}%"></div>
          <div class="label">${e.hp} / ${e.maxHp}</div>
        </div>
        ${/*
          v3.44：状态 + 词条合成一行，紧贴血条（用户给的参考截图就是这种密度）。
          「每回合 N 能量 · 手牌 N」整行删掉 —— 那是敌人信息浮层里的内容，
          战场上它常驻却没人读。词条/状态放不下时收成单行，点 ▾ 展开。
        */ ''}
        ${tagsRow([...enemyStatus, ...(e.traits || []).map((t) =>
          `<span class="trait ${t.core ? 'core' : ''}" data-action="show-tip"
            data-name="${esc(t.name)}" data-text="${esc(traitText(t, e))}">${esc(t.name)}</span>`)],
          ui.foeTagsOpen, 'toggle-foe-tags', 'foe')}
        ${foePlayHtml(ui.step, enemyTurn)}
      </div>

      ${midlineHtml(v, enemyTurn)}

      <div class="player-zone">
        ${/*
          v3.47：天赋图标 + 状态整行挪到血条**上方**。血条下方是手牌区，
          图标一多就会往下压牌区；放在上方时 player-zone 底部是锚定的，
          行高增长只会向上占位，血条位置不动。
          v3.51（用户：「全部机制宝物状态放一起，血条上方区域展示就行」）：
          宝物 chip（实验之眼等）从手牌区顶上的 relic-bar 并入这一行，
          点开仍是同一套蒙板说明；超限折叠机制共用。
        */ ''}
        ${tagsRow([...talentIcons(run), ...relicChips(run.relics), ...playerStatus], ui.playerTagsOpen, 'toggle-player-tags', 'player')}
        <div class="player-row">
          <button class="face-btn" data-action="open-hero" title="点击查看角色详情" aria-label="查看角色详情">
            <img class="player-face" src="assets/img/races/${run.raceId}.webp" alt="">
          </button>
          <span class="energy-orb">◈ ${energy}</span>
          <div class="hpbar hp-player">
            <div class="fill" style="width:${pct(p.hp, p.maxHp)}%"></div>
            <div class="label">${p.hp} / ${p.maxHp}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="tray">
      ${/*
        宝物条已于 v3.51 并入血条上方的 tags-row（用户要求机制宝物和
        状态放一起）；手牌区顶部不再重复展示一行。
      */ ''}
      <div class="hand${enemyTurn || busy ? ' dim' : ''}">${hand}${handEmpty}</div>
      <div class="controls">
        <span class="pileinfo">抽 ${v.drawCount} · 弃 ${v.discardCount} · 耗 ${v.exhaustCount}</span>
        <button class="btn primary${enemyTurn || busy ? ' disabled' : ''}" data-action="end-turn">
          ${enemyTurn ? '敌方回合…' : '结束回合'}
        </button>
      </div>
    </div>
    ${ui.log ? logPanel(v.log) : ''}
    ${ui.foeDeck ? foeInfoSheet(v.enemy) : ''}
    ${ui.relics ? relicSheet(run.relics) : ''}
  `;
}
