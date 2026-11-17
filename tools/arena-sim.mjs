/**
 * 竞技场模拟 —— 验证"镜像战是不是公平的"
 *
 * 回答三个问题：
 *   1. 同角色自我对战，总胜率是不是 50%？（镜像战的核心不变量）
 *   2. 先手优势有多大？后手补偿抹平了多少？
 *   3. 职业之间有代差吗？（坦克对坦克打 14 回合、猎人 2 回合，
 *      这是节奏差异，不是错误，但要看一眼）
 *
 * 用法：node tools/arena-sim.mjs [每种对局样本数] [种子]
 */

import { simulateArena, ARENA_HP_MUL, SECOND_ENERGY, SECOND_DRAW } from '../src/core/arena.js';
import { createMeta } from '../src/core/meta.js';

const N = Number(process.argv[2] || 40);
const SEED = Number(process.argv[3] || 11);
const meta = createMeta(SEED);

const pct = (x) => `${(x * 100).toFixed(1)}%`.padStart(6);

/* ---------------- 1. 自我对战：对称性 ---------------- */

let win = 0;
let first = 0;
let turns = 0;
let n = 0;
const byClass = {};

for (const g of meta.ghosts) {
  let cw = 0;
  let ct = 0;
  for (let s = 0; s < N; s++) {
    const r = simulateArena(g, g, 30_000 + s * 37 + Math.round(g.maxHp));
    n++;
    turns += r.turns;
    ct += r.turns;
    if (r.win) { win++; cw++; }
    if (r.playerFirst) first++;
  }
  const k = g.classId;
  byClass[k] = byClass[k] || { w: 0, n: 0, t: 0 };
  byClass[k].w += cw;
  byClass[k].n += N;
  byClass[k].t += ct;
}

console.log(`\n=== 竞技场 self-play（${meta.ghosts.length} 个快照 × ${N} 局）===`);
console.log(`赛制血量 ×${ARENA_HP_MUL} | 后手补偿 +${SECOND_ENERGY} 能量 / +${SECOND_DRAW} 手牌\n`);
console.log(`总胜率 ${pct(win / n)}   先手率 ${pct(first / n)}   场均 ${(turns / n).toFixed(1)} 回合`);

/* ---------------- 2. 先手优势 ---------------- */

function firstAdvantage(secondEnergy, secondDraw) {
  let w = 0;
  let m = 0;
  for (const g of meta.ghosts.slice(0, 6)) {
    for (let s = 0; s < N; s++) {
      const r = simulateArena(g, g, 40_000 + s * 41, {
        secondEnergy, secondDraw, forceFirst: 'p',
      });
      m++;
      if (r.win) w++;
    }
  }
  return w / m;
}

const raw = firstAdvantage(0, 0);
const fixed = firstAdvantage(SECOND_ENERGY, SECOND_DRAW);
console.log(`\n先手方胜率：无补偿 ${pct(raw)} → 有补偿 ${pct(fixed)}`);
console.log('（先手优势永远不可能归零：多打一回合就是多一回合的输出。');
console.log('  随机先手 + 补偿，目标是把"后手坐牢"变成"后手劣势"。）');

/* ---------------- 3. 分职业 ---------------- */

console.log('\n分职业（自我对战）：');
for (const [k, v] of Object.entries(byClass)) {
  console.log(`  ${k.padEnd(9)} 胜率 ${pct(v.w / v.n)}   场均 ${(v.t / v.n).toFixed(1)} 回合`);
}

/* ---------------- 4. 跨职业对撞 ---------------- */

console.log('\n跨职业对撞（左方胜率，斜线为自我对战）：');
const classes = ['warrior', 'mage', 'hunter', 'traveler'];
const heroes = {};
for (const cls of classes) {
  /**
   * 取 tier 最接近 1.0 的那个幽灵。
   * 池子里同一职业有 0.85 / 1.0 / 1.2 三档，拿最低档的猎人去打最高档的战士，
   * 测出来的是"等级差"不是"职业差"。
   */
  const cands = meta.ghosts.filter((g) => g.classId === cls);
  cands.sort((a, b) => Math.abs((a.tier ?? 1) - 1) - Math.abs((b.tier ?? 1) - 1));
  heroes[cls] = cands[0];
}

const head = `         ${classes.map((c) => c.padStart(9)).join('')}`;
console.log(head);
for (const a of classes) {
  const row = classes.map((b) => {
    if (a === b) return '        —';
    let w = 0;
    for (let s = 0; s < N; s++) {
      if (simulateArena(heroes[a], heroes[b], 50_000 + s * 43).win) w++;
    }
    return pct(w / N);
  });
  console.log(`${a.padEnd(9)}${row.join('')}`);
}

console.log('\n提示：跨职业出现 70%+ 是构筑克制，不是 bug；');
console.log('      但若同一行所有格子都 >70%，说明该职业在 PvP 里超模了。\n');
