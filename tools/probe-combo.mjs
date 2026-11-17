/**
 * 探针 v3.15：连携牌有没有真的进卡组
 *
 * 只看一件事：最终卡组里 combo 牌（重砸/陨石/狙击/枯萎）有几张。
 * 如果是 0，说明奖励页/商店的估值没让它们进来 —— 那这套机制等于没做。
 */
import { runOne } from './bot.mjs';
import { CARDS } from '../src/core/cards.js';

const COMBO = Object.entries(CARDS).filter(([, c]) => c.combo).map(([id]) => id);
console.log('combo 牌:', COMBO.join(', '));

const classes = ['warrior', 'mage', 'hunter', 'traveler'];
const races = ['stone', 'moss', 'shade', 'ember'];

for (const cls of classes) {
  let total = 0;
  let runs = 0;
  let picked = 0;
  for (const race of races) {
    for (let s = 1; s <= 10; s++) {
      const o = runOne(cls, race, s);
      runs++;
      const n = (o.deck || []).filter((k) => COMBO.includes(String(k).split('+')[0])).length;
      total += n;
      if (n > 0) picked++;
    }
  }
  console.log(`  ${cls}: 平均 ${(total / runs).toFixed(2)} 张 · ${picked}/${runs} 局至少带 1 张`);
}
