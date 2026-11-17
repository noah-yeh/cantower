/**
 * 局内商店（v1.8，v3.13 拆成两家）—— 只读 core，不改状态
 *
 * 行商：古币买卡、古币刷新；宝库：水晶材料换宝物、材料刷新。
 * 买不起的格子**不做 disabled**：点了由 core 返回原因，再 flash 出来 ——
 * 灰着点不动的话，玩家不知道自己差多少。
 */

import { CARDS, cardText, parseCard, cardKey, MAX_FORGE_LEVEL } from '../core/cards.js';
import { kw } from './bits.js';
import { relicChain, CHAINS, relicAt, relicLvOf, nextRelicLv } from '../core/relics.js';
import { refreshCost, SHOP_KIND } from '../core/shop.js';
import { costPill, runCoin } from './bits.js';

/** 卡牌类型标签（v3.59：power 从「永久」改「本场」—— 它只在当前战斗中生效） */
const KIND = { attack: '攻击', skill: '技能', power: '本场' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function priceTag(price, have, unit) {
  const ok = have >= price;
  return `<span class="s-price${ok ? '' : ' off'}">${price}<i>${unit}</i></span>`;
}

function cardRow(run, item, i) {
  const c = CARDS[item.id];
  const atk = run.player.atk + (run.player.strength || 0);
  if (!c) return '';

  /**
   * v3.70「背包已有」提示（用户：「卡牌商店出现的卡牌如果背包已经有的，可以升级的
   * 可以增加一点不同的效果提示」）。
   *
   * 卡组里已经有同名卡时：名字旁挂一枚「已有 ×N」（带当前强化级），
   * 种类行补「可强化 +N / 已满强化」，可强化的再在描述下多给一行金色
   * 「强化 +N 后：…」—— 按当前攻击力折算，和强化祭坛/背包同一套文案。
   * 只加信息，不改购买规则：再买一张仍是多一张（同名上限 2），
   * 升级走祭坛（+1）或背包合成（两张同名同级 + 1 材料）。
   */
  const ownKeys = (run.deck || []).filter((k) => parseCard(k).id === item.id);
  const copies = ownKeys.length;
  const topLv = ownKeys.reduce((m, k) => Math.max(m, parseCard(k).lv), -1);
  /**
   * v3.87：合成必须**同名同级**（一张 +0 和一张 +1 合不了，见 forge.js 硬规则 1）。
   * 原来这里只报「最高 +N / 可强化 +N+1」，玩家看到"×2 · +1 · 可强化 +2"会以为
   * 一张 0 级一张 1 级就能合出 2 级 —— 所以改成按**等级分组**报数。
   */
  const lvCount = new Map();
  for (const k of ownKeys) {
    const lv = parseCard(k).lv;
    lvCount.set(lv, (lvCount.get(lv) || 0) + 1);
  }
  const pairLv = [...lvCount.entries()]
    .filter(([lv, n]) => n >= 2 && lv < MAX_FORGE_LEVEL)
    .map(([lv]) => lv)
    .sort((a, b) => b - a)[0];
  const nextLv = topLv + 1;
  const ownTag = copies > 0
    ? `<b class="own-tag">已有 ×${copies}${topLv > 0 ? ` · 最高 +${topLv}` : ''}</b>`
    : '';
  const kindMore = copies === 0
    ? ''
    : topLv >= MAX_FORGE_LEVEL
      ? ' · 已满强化'
      : pairLv !== undefined
        ? ` · 同级 2 张 · 可合 +${pairLv + 1}`
        : ` · 还差一张同级${topLv > 0 ? ` +${topLv}` : ''}才能合`;
  const upLine = copies > 0 && topLv < MAX_FORGE_LEVEL
    ? `<span class="up">升到 +${nextLv} 后：${kw(cardText(cardKey(item.id, nextLv), atk, { perk: run.perk }))}</span>`
    : '';

  return `
  <button class="reward shop-item${item.sold ? ' sold' : ''}${copies > 0 ? ' owned' : ''}" data-action="buy-card" data-index="${i}">
    <span class="icon">⚔</span>
    <span class="s-body">
      <span class="rname">${esc(c.name)}${costPill(c.cost)}${ownTag}</span>
      <span class="rkind">　${KIND[c.kind] ?? ''}${kindMore}</span>
      <div class="rtext">${kw(cardText(item.id, atk, { perk: run.perk }))}${upLine}</div>
    </span>
    ${item.sold ? '<span class="s-price sold">已售出</span>' : priceTag(item.price, run.gold, '古币')}
  </button>`;
}

function relicRow(run, item, i) {
  const lv = item.lv || 1;
  const r = relicAt(item.id, lv);
  if (!r) return '';
  const chain = relicChain(item.id);
  const tag = chain === 'X' ? '通用' : `链 ${chain} · ${CHAINS[chain]}`;
  const own = relicLvOf(run.relics, item.id);
  const name = r.levels
    ? `${esc(r.name)} <b class="lvtag">${own > 0 ? `Lv.${own} → ` : ''}Lv.${nextRelicLv(own, lv)}</b>`
    : esc(r.name);
  return `
  <button class="reward kind-relic shop-item${item.sold ? ' sold' : ''}" data-action="buy-relic" data-index="${i}">
    <span class="icon">✦</span>
    <span class="s-body">
      <span class="rname">${name}</span>
      <span class="rkind">　${tag}${own > 0 ? ' · 升级' : ''}</span>
      <div class="rtext">${kw(r.text)}</div>
    </span>
    ${item.sold ? '<span class="s-price sold">已售出</span>' : priceTag(item.price, run.materials, '晶')}
  </button>`;
}

/** 刷新按钮：写清这一次的价钱，玩家不用点下去才知道贵 */
function refreshBtn(run, count) {
  const cost = refreshCost(run);
  const isRelic = run.shop?.kind === SHOP_KIND.RELIC;
  const have = isRelic ? (run.materials || 0) : (run.gold || 0);
  const off = have < cost ? ' off' : '';
  return `
    <button class="btn wide refresh-btn${off}" data-action="refresh-shop">
      <span class="rf-main">↻ 换一批货 · <b>${cost}</b> ${isRelic ? '晶' : '古币'}</span>
      <span class="rf-note">第 ${(count || 0) + 1} 次刷新${isRelic ? '，每刷一次 +1' : '，每刷一次更贵'}</span>
    </button>`;
}

export function renderShop(run, ui = {}) {
  if (!run?.shop) return '<div class="overlay"><p class="sub">店门已经关上了</p></div>';

  /**
   * 旧存档没有 kind（v3.12 以前）：退回"一家店卖两样"的布局，不让宝物凭空消失。
   *
   * v3.65 的固定一屏版式（`.shop-fixed`：6 格等分、整页不滚动）只给新存档用 ——
   * 老存档同时有两段货架（卡 6 + 宝物 6），硬塞一屏会把每一格压到看不清字，
   * 那种店仍按原来的可滚动布局显示。
   */
  const legacy = !run.shop.kind;
  const isRelic = run.shop.kind === SHOP_KIND.RELIC;
  const refreshes = run.shop.refreshes || 0;

  const cards = (run.shop.cards || []).map((it, i) => cardRow(run, it, i)).join('');
  const relics = (run.shop.relics || []).map((it, i) => relicRow(run, it, i)).join('');



  const title = isRelic ? '宝 库' : '行 商';
  const sub = isRelic
    ? `第 ${run.floor} 层 · 只收水晶材料，不占种族槽位`
    : `第 ${run.floor} 层 · 古币与材料只在塔里算数`;

  const cardBlock = `
      <div class="shop-head">
        <span>卡牌</span>
        <span class="sec-sub">用古币买 · 直接进卡组</span>
      </div>
      <div class="reward-list">${cards || '<div class="empty small">今天没有牌可卖</div>'}</div>`;

  const relicBlock = `
      <div class="shop-head">
        <span>宝物</span>
        <span class="sec-sub">用合成出的水晶材料换 · 不占种族槽位</span>
      </div>
      <div class="reward-list">${relics || '<div class="empty small">宝物已经卖光了</div>'}</div>`;

  const body = isRelic ? relicBlock : legacy ? cardBlock + relicBlock : cardBlock;

  const hint = isRelic
    ? '水晶材料来自锻造与晶簇 —— 在这里换成品，或者留着点亮种族宝物。刷新一次比一次贵 1 个。'
    : '古币是塔里的钱，出塔就蒸发 —— 买牌，或者换一批货。刷新一次比一次贵。';

  return `
    <div class="overlay shop${isRelic ? ' shop-relic' : ''}${legacy ? '' : ' shop-fixed'}">
      <button class="back-btn" data-action="leave-shop" aria-label="离开，回到这一层">离开</button>
      <!-- v3.70 右上角入口随时看卡组；v3.87（用户：「行商里面的背包还是旧的页面，
           应该进入角色详情页」）：改开角色详情页 —— 牌库/宝物页签就在那儿，还能顺手
           合成与激活。返回时 run.phase 仍是 shop，回到这台摊子、货架不变。 -->
      <button class="back-btn right" data-action="open-hero" aria-label="查看角色与卡组">角色</button>
      <h1 style="font-size:22px;letter-spacing:8px">${title}</h1>
      <div class="sub">${sub}</div>
      ${ui.flash ? `<div class="flash">${esc(ui.flash)}</div>` : ''}

      <div class="purse">
        <span class="chip gold">${runCoin()} 古币 <b>${run.gold}</b></span>
        <span class="chip crystal">水晶材料 <b>${run.materials}</b></span>
      </div>

      ${body}

      ${refreshBtn(run, refreshes)}
      <p class="hint" style="text-align:center">${hint}离开后摊子还在原处，回来货架不变。</p>
    </div>`;
}
