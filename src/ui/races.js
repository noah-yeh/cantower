/**
 * 种族卡（v3.89 起，v3.95 起**只作为图鉴「种族」页签的内容**）
 *
 * 这里做两件事的**呈现**：解锁还没开的种族、花 10 碎片升 1 级。
 * 逻辑全在 core/races.js，本文件只排版。
 *
 * v3.95 用户发话："把种族移到图鉴里面展示就行……解锁升级都在那边，
 * 外面不需要再放入口了" —— 于是**独立种族页整页删除**，大厅的「种族」
 * 图标也撤掉。图鉴从"只看得全"变成"看得全 + 养得成"，一个概念只在一个
 * 页签出现（GAME_DESIGN §4.3.3）。
 *
 * 设计上刻意**把属性区间直接印在卡上**：
 * "等级 +1" 如果只写数字，玩家不知道值多少；写成「生命 79~93 → 80~94」
 * 才知道自己花的 10 块碎片换到了什么。
 */

import { RACES, CLASSES, raceBonus, RACE_MAX_LEVEL, LIVES_MIN, LIVES_MAX, RACE_IDS } from '../core/characters.js';
import {
  raceState, canLevelUp, shardsToNext,
  SHARDS_TO_UNLOCK,
} from '../core/races.js';
import { RELICS } from '../core/relics.js';
import { cardView } from '../core/cards.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** 种族配色：只用来区分身份，不承载数值含义 */
const RACE_TONE = {
  stone: 'stone',
  moss: 'moss',
  shade: 'shade',
  ember: 'ember',
};

/**
 * 某个种族在指定等级下、用**战士**做基准的招募区间。
 *
 * 为什么固定用战士：四个职业的基础值不同，把 16 种组合都列出来玩家也看不懂。
 * 战士是最常配的初始职业，用一个稳定的锚点展示"涨了多少"就够了。
 */
const SHOWCASE_CLASS = 'warrior';

function rollRange(raceId, level) {
  const cls = CLASSES[SHOWCASE_CLASS];
  if (!cls) return null;
  const bonus = raceBonus(level);
  const race = RACES[raceId];
  const hpMul = race?.perk?.hpMul ?? 1;
  const atkMul = race?.perk?.atkMul ?? 1;
  const lo = 1 - 0.08;
  const hi = 1 + 0.08;
  return {
    hpMin: Math.round(cls.baseHp * hpMul * lo) + bonus.hp,
    hpMax: Math.round(cls.baseHp * hpMul * hi) + bonus.hp,
    atkMin: Math.round(cls.baseAtk * atkMul * lo) + bonus.atk,
    atkMax: Math.round(cls.baseAtk * atkMul * hi) + bonus.atk,
  };
}

const rangeText = (r) => `生命 ${r.hpMin}~${r.hpMax}　攻击 ${r.atkMin}~${r.atkMax}`;

/** 一条细进度条：`cur / max`，满级时整条点亮 */
function bar(cur, max, cls = '') {
  const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 100;
  return `<span class="race-bar ${cls}"><i style="width:${pct.toFixed(1)}%"></i></span>`;
}

/** 这族自带的宝物与专属卡：只做指路，不展开数值（在「宝物」「卡牌」页签） */
function raceTags(race) {
  return `
    <div class="cx-tags">
      ${race.relics.map((rid) => `<span class="rl off">${esc(RELICS[rid]?.name ?? rid)}</span>`).join('')}
      <span class="rl on">${esc(cardView(race.card).name)}</span>
    </div>`;
}

function raceCard(raceId, meta) {
  const race = RACES[raceId];
  const st = raceState(meta, raceId);
  const tone = RACE_TONE[raceId] || '';
  const here = rollRange(raceId, st.level);
  const next = st.level < RACE_MAX_LEVEL ? rollRange(raceId, st.level + 1) : null;

  /* 未解锁：只显示碎片进度和解锁条件，不显示等级 */
  if (!st.unlocked) {
    const need = SHARDS_TO_UNLOCK;
    const ok = st.shards >= need;
    return `
    <div class="race-card locked ${tone}">
      <div class="rc-head">
        <img class="rc-face" src="assets/img/races/${raceId}.webp" alt="${esc(race.name)}">
        <span class="rc-title">
          <b>${esc(race.name)}</b>
          <i>未解锁 · 命数 ${LIVES_MIN}~${LIVES_MAX}</i>
        </span>
        <span class="rc-lv">🔒</span>
      </div>
      <p class="rc-perk">${esc(race.desc)}</p>
      ${raceTags(race)}
      <div class="rc-progress">
        ${bar(st.shards, need, 'shard')}
        <span class="rc-num">碎片 <b>${st.shards}</b>/${need}</span>
      </div>
      <div class="rc-actions">
        <button class="btn ${ok ? 'primary' : 'ghost'} wide" data-action="race-unlock" data-race="${raceId}" ${ok ? '' : 'disabled'}>
          ${ok ? `解锁 · 消耗 ${need} 碎片` : `还差 ${need - st.shards} 块碎片`}
        </button>
      </div>
    </div>`;
  }

  /* 已解锁：等级 / 碎片进度 / 升级按钮 / 区间变化 */
  const maxed = st.level >= RACE_MAX_LEVEL;
  const cost = shardsToNext(st.level);
  const canUp = canLevelUp(meta, raceId);

  return `
  <div class="race-card ${tone}">
    <div class="rc-head">
      <img class="rc-face" src="assets/img/races/${raceId}.webp" alt="${esc(race.name)}">
      <span class="rc-title">
        <b>${esc(race.name)}</b>
        <i>命数 ${LIVES_MIN}~${LIVES_MAX} · ${maxed ? '已满级' : `再 ${cost} 碎片升 1 级`}</i>
      </span>
      <span class="rc-lv">Lv <b>${st.level}</b><i>/${RACE_MAX_LEVEL}</i></span>
    </div>
    <p class="rc-perk">${esc(race.desc)}</p>
    ${raceTags(race)}

    <div class="rc-range">
      <span class="rc-range-label">招募区间（战士）</span>
      <span class="rc-range-val">${rangeText(here)}</span>
      ${next ? `<span class="rc-range-up">升级后 ${rangeText(next)}</span>` : ''}
    </div>

    <div class="rc-progress">
      ${bar(maxed ? 1 : st.shards, maxed ? 1 : cost, maxed ? 'full' : 'shard')}
      <span class="rc-num">碎片 <b>${st.shards}</b>${maxed ? '' : `/${cost}`}</span>
    </div>

    <div class="rc-actions">
      <button class="btn ${canUp.ok ? 'primary' : 'ghost'} wide" data-action="race-levelup" data-race="${raceId}" ${canUp.ok ? '' : 'disabled'}>
        ${maxed ? '已满级' : canUp.ok ? `升级 · 消耗 ${cost} 碎片` : `还差 ${cost - st.shards} 块碎片`}
      </button>
    </div>
  </div>`;
}

/** 图鉴「种族」页签的全部内容（v3.95：原独立种族页的唯一消费者） */
export function raceCardsHtml(meta) {
  return `<div class="race-list">${RACE_IDS.map((id) => raceCard(id, meta)).join('')}</div>`;
}
