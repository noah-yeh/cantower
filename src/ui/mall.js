/**
 * 商城（v3.90）—— 广告与宝箱收拢成一页
 *
 * 玩家在这里做四件事：
 *   1. 看广告领金币（每天 5 次，原大厅"广告 +30"入口搬入）
 *   2. 看广告开碎片宝箱（每天 5 次，原种族页搬入）
 *   3. 花金币开古币宝箱：碎片 + 小概率命数之种
 *   4. 花金币开装备宝箱：随机装备一件
 *
 * 两张金币卡是**不限次**的 —— 金币本身就是闸门，没必要再叠每日上限；
 * 但单发收益刻意压在广告线之下（GAME_DESIGN 5.4.2），广告才是主产出。
 */

import { adState, boxAdState, AD_DAILY_LIMIT, AD_REWARD_GOLD } from '../core/ads.js';
import { BOX_DAILY_LIMIT } from '../core/races.js';
import {
  GOLD_CHEST_COST, GOLD_CHEST_SHARDS_MIN, GOLD_CHEST_SHARDS_MAX, GOLD_CHEST_SEED_CHANCE,
  EQUIP_CHEST_COST,
} from '../core/mall.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

/** 商城卡：左图标 + 标题说明，右侧状态与按钮（复用种族页宝箱条的骨架） */
function mallCard({ ico, title, sub, side, action, cta, off, tone = '' }) {
  return `
  <div class="mall-card ${tone}">
    <div class="rb-main">
      <span class="rb-ico">${ico}</span>
      <span class="rb-txt">
        <b>${esc(title)}</b>
        <i>${sub}</i>
      </span>
    </div>
    <div class="rb-side">
      <span class="rb-left">${side}</span>
      ${action ? `<button class="btn ${off ? 'ghost' : 'primary'}" data-action="${action}" ${off ? 'disabled' : ''}>${cta}</button>` : ''}
    </div>
  </div>`;
}

export function renderMall(meta, { now, flash } = {}) {
  const gold = adState(meta, now);
  const box = boxAdState(meta, now);
  const seeds = meta.lifeSeeds || 0;

  return `
  <div class="race-page mall-page">
    <div class="race-top">
      <button class="mini-btn" data-action="back-hall">‹ 返回</button>
      <span class="race-top-title">商城</span>
      <span class="race-top-sub">古币余额 <b>${meta.gold}</b>${seeds ? ` · 命数之种 ×${seeds}` : ''}</span>
    </div>

    ${flash ? `<div class="flash">${esc(flash)}</div>` : ''}

    <div class="race-scroll">
      <p class="race-hint">
        广告线每天有次数，是种族养成的主产出；两张古币宝箱不限次数，
        但单箱收益更低 —— 急着解锁/升级再来买。
      </p>

      <div class="mall-list">
        ${mallCard({
          ico: '🪙', tone: 'gold',
          title: '广告金币',
          sub: `看一段广告领 ${AD_REWARD_GOLD} 古币`,
          side: `今日 <b>${gold.left}</b>/${AD_DAILY_LIMIT}`,
          action: 'watch-ad',
          cta: gold.left > 0 ? '看广告' : '明天再来',
          off: gold.left <= 0,
        })}
        ${mallCard({
          ico: '🎁', tone: 'shard',
          title: '碎片宝箱',
          sub: '看一段广告开一箱 · 每次 6~12 块种族碎片',
          side: `今日 <b>${box.left}</b>/${BOX_DAILY_LIMIT}`,
          action: 'race-box',
          cta: box.left > 0 ? '看广告开箱' : '明天再来',
          off: box.left <= 0,
        })}
        ${mallCard({
          ico: '🎲', tone: 'coinbox',
          title: '古币宝箱',
          sub: `花 ${GOLD_CHEST_COST} 古币 · 抽 3~6 块碎片 · ${Math.round(GOLD_CHEST_SEED_CHANCE * 100)}% 掉命数之种`,
          side: seeds ? `已有种子 <b>${seeds}</b>` : '不限次数',
          action: 'gold-chest',
          cta: `开箱 · ${GOLD_CHEST_COST} 古币`,
          off: false,
        })}
        ${mallCard({
          ico: '⚔️', tone: 'equip',
          title: '装备宝箱',
          sub: `花 ${EQUIP_CHEST_COST} 古币 · 随机装备一件，直接进装备库`,
          side: '不限次数',
          action: 'equip-chest',
          cta: `开箱 · ${EQUIP_CHEST_COST} 古币`,
          off: false,
        })}
      </div>

      <p class="race-foot">
        命数之种在角色详情页使用：给一位角色 +1 命数（最多高出种族上限 2 点）。
      </p>
    </div>
  </div>`;
}
