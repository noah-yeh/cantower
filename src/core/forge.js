/**
 * 卡牌合成
 *
 * 两张同名同级的卡 → 一张升级卡（+50% 基础值）+ 1 个宝物激活材料。
 *
 * 为什么合成是个真取舍：卡组会少一张。薄卡组更容易稳定抽到核心牌，
 * 但抽到的东西杂；厚卡组数量够但质量平。这个选择每局要做十几次。
 *
 * 硬规则：
 *   1. 必须同 id 且同等级（lv1 不能和 lv2 合，否则可以刷等级）
 *   2. 单卡最多 3 级
 *   3. 合成产出 1 个材料，材料只在本局有效
 */

import { parseCard, cardKey, cardOf, cardName, MAX_FORGE_LEVEL, upgradable } from './cards.js';

/** 卡组里所有可合成的目标 */
export function forgeTargets(deck) {
  const counts = new Map();
  for (const key of deck) counts.set(key, (counts.get(key) || 0) + 1);

  const out = [];
  for (const [key, count] of counts) {
    const { id, lv } = parseCard(key);
    /** 宝石不能强化（v3.91，见 cards.upgradable）—— 合成里也不该出现 */
    if (!upgradable(id)) continue;
    if (lv >= MAX_FORGE_LEVEL) continue;
    if (count < 2) continue;
    out.push({
      key,
      id,
      lv,
      count,
      name: cardName(key),
      nextName: cardName(cardKey(id, lv + 1)),
      nextLv: lv + 1,
      /** 能合几次（受数量与等级上限双重限制） */
      times: Math.min(Math.floor(count / 2), MAX_FORGE_LEVEL - lv),
    });
  }
  return out;
}

export function canForge(deck, key) {
  const { id, lv } = parseCard(key);
  if (!upgradable(id)) return false;
  if (lv >= MAX_FORGE_LEVEL) return false;
  if (!cardOf(key)) return false;
  return deck.filter((k) => k === key).length >= 2;
}

/**
 * 执行一次合成。直接修改 deck（就地）。
 * @returns {{ok:boolean, key?:string, material?:number, reason?:string}}
 */
export function forge(deck, key) {
  if (!canForge(deck, key)) {
    return { ok: false, reason: '需要两张同名同级的卡，或已达强化上限' };
  }

  const { id, lv } = parseCard(key);
  const next = cardKey(id, lv + 1);

  // 移除两张
  let removed = 0;
  for (let i = deck.length - 1; i >= 0 && removed < 2; i--) {
    if (deck[i] === key) {
      deck.splice(i, 1);
      removed++;
    }
  }

  deck.push(next);
  return { ok: true, key: next, from: key, material: 1 };
}

/** 一行摘要，给 UI 用 */
export function forgeSummary(deck) {
  const targets = forgeTargets(deck);
  return {
    canForgeCount: targets.length,
    targets,
  };
}
