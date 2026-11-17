/**
 * 种族强度对比 —— 按种族聚合
 *
 * 为什么单独写一个：tools/balance.mjs 只按「职业」聚合，看不到种族差异。
 * 而 bot 的绝对通关率是失效基线（长期 0%），所以这里**只做相对比较**：
 * 同一批种子、同一批组合，四个种族谁的中位层数低，谁就是最弱的。
 *
 * 用法：
 *   node tools/race-balance.mjs          12 局 × 16 组合
 *   node tools/race-balance.mjs 30       30 局 × 16 组合
 */

import { CLASSES, RACES, LIVES_MIN, LIVES_MAX } from '../src/core/characters.js';
import { MAX_FLOOR } from '../src/core/enemies.js';
import { runOne } from './bot.mjs';

function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - [...String(s)].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));

const runsPerCombo = Number(process.argv[2]) || 12;
const classIds = Object.keys(CLASSES);
const raceIds = Object.keys(RACES);

const results = [];
const t0 = Date.now();
for (const c of classIds) {
  for (const r of raceIds) {
    for (let i = 0; i < runsPerCombo; i++) {
      results.push({ ...runOne(c, r, 1000 + i * 37), classId: c, raceId: r });
    }
  }
}
const secs = ((Date.now() - t0) / 1000).toFixed(0);

console.log(`\n残塔 · 种族强度对比  ——  ${runsPerCombo} 局 × ${classIds.length * raceIds.length} 组合 = ${results.length} 局（${secs}s）\n`);
console.log('种族      |  命数  | 中位层数 | 平均层数 | 达 10 层 | 达 20 层 | 平均卡组 | 平均宝物');
console.log('----------|------|----------|----------|----------|----------|----------|----------');

const byRace = raceIds.map((r) => {
  const rs = results.filter((x) => x.raceId === r);
  const floors = rs.map((x) => x.floor);
  return {
    id: r,
    name: RACES[r].name,
    lives: `${LIVES_MIN}~${LIVES_MAX}`,
    med: median(floors),
    avg: mean(floors),
    f10: rs.filter((x) => x.floor >= 10).length / rs.length,
    f20: rs.filter((x) => x.floor >= 20).length / rs.length,
    deck: mean(rs.map((x) => x.deckSize)),
    rel: mean(rs.map((x) => x.relics)),
  };
});

for (const b of byRace) {
  console.log(
    `${pad(b.name, 10)}| ${String(b.lives).padStart(6)} | ${String(b.med).padStart(8)} | ${b.avg.toFixed(1).padStart(8)} | ${(b.f10 * 100).toFixed(0).padStart(7)}% | ${(b.f20 * 100).toFixed(0).padStart(7)}% | ${b.deck.toFixed(1).padStart(8)} | ${b.rel.toFixed(1).padStart(8)}`,
  );
}

const sorted = [...byRace].sort((a, b) => a.avg - b.avg || a.med - b.med);
console.log(`\n最弱 → 最强：${sorted.map((b) => `${b.name}(${b.avg.toFixed(1)}层)`).join('  <  ')}`);

/* 种族 × 职业交叉：看是不是某个职业把某种族拖低了 */
console.log('\n种族 × 职业（平均到达层数）');
console.log('          ' + classIds.map((c) => pad(CLASSES[c].name, 8)).join(''));
for (const r of raceIds) {
  const cells = classIds.map((c) => {
    const rs = results.filter((x) => x.raceId === r && x.classId === c);
    return pad(mean(rs.map((x) => x.floor)).toFixed(1), 8);
  });
  console.log(pad(RACES[r].name, 10) + cells.join(''));
}
console.log('');
