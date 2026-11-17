/**
 * 机器人平衡模拟 —— 调参的唯一依据
 *
 * 用法：
 *   node tools/balance.mjs              20 局 × 全部组合
 *   node tools/balance.mjs 50           50 局 × 全部组合
 *   node tools/balance.mjs 20 warrior   只跑某个职业
 *
 * 策略在 tools/bot.mjs，与 trace.mjs 共用。
 */

import { CLASSES, RACES } from '../src/core/characters.js';
import { MAX_FLOOR } from '../src/core/enemies.js';
import { runOne } from './bot.mjs';

function pct(n, d) {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(0)}%`;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function quantile(arr, q) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}

function pad(s, n) {
  const str = String(s);
  const width = [...str].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
  return str + ' '.repeat(Math.max(0, n - width));
}

function main() {
  const args = process.argv.slice(2);
  const runsPerCombo = Number(args[0]) || 20;
  const onlyClass = args[1];

  const classIds = onlyClass ? [onlyClass] : Object.keys(CLASSES);
  const raceIds = Object.keys(RACES);
  const results = [];

  for (const c of classIds) {
    for (const r of raceIds) {
      for (let i = 0; i < runsPerCombo; i++) {
        results.push(runOne(c, r, 1000 + i * 37));
      }
    }
  }

  console.log(
    `\n残塔 · 平衡模拟  ——  ${runsPerCombo} 局 × ${classIds.length * raceIds.length} 组合 = ${results.length} 局\n`,
  );

  console.log('职业      | 通关率 | 中位层数 | 中位时长 | 每场回合 | 平均卡组 | 平均宝物 | 平均攻击');
  console.log('----------|--------|----------|----------|----------|----------|----------|----------');

  for (const c of classIds) {
    const rs = results.filter((r) => r.classId === c);
    const wins = rs.filter((r) => r.won).length;
    const floors = rs.map((r) => r.floor);
    const mins = rs.map((r) => r.minutes);
    const decks = rs.reduce((s, r) => s + r.deckSize, 0) / rs.length;
    const rels = rs.reduce((s, r) => s + r.relics, 0) / rs.length;
    const atks = rs.reduce((s, r) => s + r.atk, 0) / rs.length;
    const tpf = rs.reduce((s, r) => s + (r.turnsPerFight || 0), 0) / rs.length;

    console.log(
      `${pad(CLASSES[c].name, 10)}| ${pct(wins, rs.length).padStart(5)} | ${String(median(floors)).padStart(8)} | ${median(mins).toFixed(1).padStart(6)}分 | ${tpf.toFixed(1).padStart(8)} | ${decks.toFixed(1).padStart(8)} | ${rels.toFixed(1).padStart(8)} | ${atks.toFixed(0).padStart(8)}`,
    );
  }

  const wins = results.filter((r) => r.won).length;
  const mins = results.map((r) => r.minutes);
  const floors = results.map((r) => r.floor);

  console.log('\n—— 汇总 ——');
  console.log(`总通关率         ${pct(wins, results.length)}  (${wins}/${results.length})`);
  console.log(`中位到达层数     ${median(floors)} / ${MAX_FLOOR}`);
  console.log(`中位单局时长     ${median(mins).toFixed(1)} 分钟`);
  console.log(`时长 p25 / p75   ${quantile(mins, 0.25).toFixed(1)} / ${quantile(mins, 0.75).toFixed(1)} 分钟`);

  const dead = results.filter((r) => !r.won);
  const buckets = {};
  for (const r of dead) {
    const b = Math.floor((r.floor - 1) / 5) * 5 + 1;
    buckets[b] = (buckets[b] || 0) + 1;
  }
  console.log('\n死亡层分布（按 5 层分段）');
  for (const k of Object.keys(buckets).sort((a, b) => a - b)) {
    const n = buckets[k];
    const bar = '█'.repeat(Math.round((n / dead.length) * 40));
    console.log(`  第 ${String(k).padStart(2)}-${String(Number(k) + 4).padStart(2)} 层  ${String(n).padStart(4)}  ${bar}`);
  }

  console.log('');
}

main();
