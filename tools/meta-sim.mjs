/**
 * 元游戏模拟 —— 连续跑几百次"探险 + 竞技场 + 招募"
 *
 * 回答的是局内 balance.mjs 回答不了的问题：
 *   - 金币会不会破产 / 溢出
 *   - 一个角色平均能活几次探险
 *   - 玩家会不会陷入"没钱也没人"的死锁
 *
 * 用法：node tools/meta-sim.mjs 200
 */

import { Rng } from '../src/core/rng.js';
import * as M from '../src/core/meta.js';
import { createRun, play, pass, applyReward, acceptQuest } from '../src/core/run.js';
import { onExploreReturn, onExploreDeath, ratingOf, canExplore, canEnterArena, tickArena, spendArena, hasRoom } from '../src/core/roster.js';
import { scoreOf } from '../src/core/arena-rank.js';
import { simulateArena } from '../src/core/arena.js';
import { autoTurn, scoreReward, autoShop, autoMap, autoUpgrade } from './bot.mjs';

const RUNS = Number(process.argv[2] || 120);
/** 第 2 个参数是种子（默认 20261104），用于观察不同随机轨迹下的方差 */
const seedArg = Number(process.argv[3] || 20261104);
const meta = M.createMeta(seedArg);
const rng = new Rng(777);

/**
 * 虚拟时钟。
 *
 * 招募名额按时间恢复（10 分钟 +1），core 层不读 Date.now()，
 * 所以模拟里得自己推时间。一次行动按 3 分钟算 —— 一次探险 20 分钟、
 * 一场竞技场几分钟，取个偏保守的低值，避免"时间过得比玩家快"。
 */
let clock = 1_700_000_000_000;
const ADVANCE_MS = 3 * 60 * 1000;

const stats = {
  explores: 0,
  survived: 0,
  cleared: 0,
  deaths: 0,
  recruited: 0,
  /** 想招人但名额用光的次数 —— 名额制带来的新摩擦 */
  waited: 0,
  arenaWins: 0,
  arenaLosses: 0,
  bankrupt: 0,
  goldCurve: [],
  charRuns: [],
  floors: [],
};

/** 打完一次探险（全自动） */
function runOneExplore(ch) {
  const run = createRun({ character: ch, seed: (rng.next() * 1e9) >>> 0 });

  let guard = 0;
  while ((run.phase === 'map' || run.phase === 'battle' || run.phase === 'reward' || run.phase === 'shop' || run.phase === 'upgrade' || run.phase === 'quest') && guard++ < 8000) {
    if (run.phase === 'map') {
      autoMap(run);
    } else if (run.phase === 'shop') {
      autoShop(run);
    } else if (run.phase === 'battle') {
      autoTurn(run);
    } else if (run.phase === 'upgrade') {
      // v2.2：强化祭坛（奖励与铁匠事件都会进）
      autoUpgrade(run);
    } else if (run.phase === 'quest') {
      // v3.85：委托板 —— 机器人一律接受
      acceptQuest(run);
    } else {
      // 三选一：用机器人评分
      let best = 0;
      let bestScore = -1;
      run.reward.options.forEach((opt, i) => {
        const s = scoreReward(run, opt);
        if (s > bestScore) {
          bestScore = s;
          best = i;
        }
      });
      applyReward(run, best);
    }
  }

  return run;
}

function settle(ch, run) {
  const floor = run.phase === 'won' ? 30 : Math.max(0, run.floor - 1);
  stats.floors.push(floor);
  stats.explores++;

  if (run.phase === 'won') {
    stats.cleared++;
    // 存活：成果保留
    ch.deck = run.deck.slice();
    ch.relics = run.relics.slice();
    ch.relicSlots = run.relicSlots.slice();
    ch.maxHp = run.player.maxHp;
    ch.atk = run.player.atk;
    onExploreReturn(ch, floor);
    M.settleExploreWin(meta, ch, floor, true);
    M.pushGhost(meta, ch);
  } else {
    stats.deaths++;
    onExploreDeath(ch, floor);
    if (ch.status === 'dead') M.bury(meta, ch);
  }

  return floor;
}

/* ---------------- 主循环 ---------------- */

/**
 * 把一个人的竞技场额度打空。
 *
 * "有额度就打"是玩家的自然选择：竞技场不消耗成长、只赌命，还能出金币。
 * 所以模拟里也不该留着不用 —— 否则会低估金币产出、高估角色寿命。
 */
function drainArena(ch) {
  while (ch.lives > 0 && canEnterArena(ch, clock).ok) {
    const opps = M.matchOpponents(meta, scoreOf(ch), rng, 3);
    if (!opps.length) break;
    const ghost = opps[0];
    // 先扣额度再打：万一扣不动就说明判断和状态不一致，不该继续
    if (!spendArena(ch, clock)) break;
    const res = simulateArena(ch, ghost, (rng.next() * 1e6) >>> 0);
    if (res.win) {
      stats.arenaWins++;
      ch.record.arenaWins += 1;
      M.settleArenaWin(meta, scoreOf(ghost));
    } else {
      stats.arenaLosses++;
      ch.record.arenaLosses += 1;
      ch.lives -= 1;
      if (ch.lives <= 0) {
        ch.lives = 0;
        ch.status = 'dead';
        M.bury(meta, ch);
      }
    }
  }
}

for (let i = 0; i < RUNS; i++) {
  clock += ADVANCE_MS;
  M.tickRecruit(meta, clock);
  // 竞技场额度按虚拟时钟恢复（30 分钟 1 次），不推的话模拟里永远是 0
  for (const c of meta.roster) tickArena(c, clock);

  /**
   * 1. 只有**试用期**的人能进塔（v1.1）。
   *
   * 原来是 `status === 'idle' && lives > 0` —— 转正的人也会被派进塔，
   * 等于模拟走了一条真实游戏里已经不存在的路。
   */
  const canRun = meta.roster.filter((c) => canExplore(c).ok);
  if (!canRun.length) {
    /**
     * 没人能进塔：先看眼前有没有候选，再决定要不要花名额抽人（v3.5）。
     *
     * 真实玩家的路径也一样 —— 候选人只有处理掉（雇或放走）才能抽下一个，
     * 所以这里必须两步都走，不能只调 recruitCandidate。
     */
    let cand = meta.candidate;
    if (!cand && meta.tickets > 0 && hasRoom(meta.roster)) {
      const r = M.recruitCandidate(meta, clock);
      if (r.ok) cand = r.character;
    }
    if (cand && meta.gold >= M.RECRUIT_COST && hasRoom(meta.roster)) {
      const r = M.hireCandidate(meta);
      if (r.ok) {
        stats.recruited++;
        canRun.push(r.character);
      }
    } else {
      if (cand) M.dismissCandidate(meta);
      if (meta.tickets < 1) {
        // 名额用光：这一轮只能干等
        stats.waited++;
      } else if (meta.gold >= M.RECRUIT_COST && hasRoom(meta.roster)) {
        stats.bankrupt++;
        // 破产兜底：直接补一次"救济"以继续观测（真实游戏里会卡死）
        meta.gold += M.RECRUIT_COST;
      }
    }
    if (!canRun.length) {
      // 没新人可派，但名册里可能有转正的活人 —— 他们的额度照样要打
      for (const c of meta.roster.slice()) {
        if (c.status === 'idle' && c.veteran && c.lives > 0) drainArena(c);
      }
      continue;
    }
  }

  // 2. 派评级最高的试用期角色去探险（玩家自然会这么选）
  canRun.sort((a, b) => ratingOf(b) - ratingOf(a));
  const ch = canRun[0];

  const run = runOneExplore(ch);
  settle(ch, run);

  // 3. 名册里所有转正角色的额度都打空（刚转正的不例外）
  for (const c of meta.roster.slice()) {
    if (c.status === 'idle' && c.veteran && c.lives > 0) drainArena(c);
  }

  if (i % 20 === 0) stats.goldCurve.push({ at: i, gold: meta.gold, roster: meta.roster.length });
}

/* ---------------- 输出 ---------------- */

const median = (arr) => {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

console.log(`\n=== 元游戏模拟 ${RUNS} 次行动 ===\n`);
console.log(`探险 ${stats.explores} 次 | 通关 ${stats.cleared} 次 (${((stats.cleared / stats.explores) * 100).toFixed(1)}%) | 阵亡 ${stats.deaths} 次`);
console.log(`招募 ${stats.recruited} 人 | 墓地 ${meta.graveyard.length} 人 | 现存 ${meta.roster.length} 人`);
console.log(`名额用光干等 ${stats.waited} 次（共 ${RUNS} 次行动）| 结束名额 ${meta.tickets}/${M.RECRUIT_CAP}`);
console.log(`竞技场 ${stats.arenaWins + stats.arenaLosses} 场：${stats.arenaWins} 胜 ${stats.arenaLosses} 负 (${((stats.arenaWins / Math.max(1, stats.arenaWins + stats.arenaLosses)) * 100).toFixed(1)}%)`);
console.log(`中位到达层数 ${median(stats.floors)} | 平均 ${avg(stats.floors).toFixed(1)} 层`);
console.log(`破产次数 ${stats.bankrupt} | 结束金币 ${meta.gold}`);
/**
 * 每角色平均探险次数 = 总探险次数 ÷ 经手过的角色数。
 *
 * 以前这里记的是 `exploreCount - before`，也就是"这次探险让计数涨了多少"，
 * 恒等于 1，指标永远是 1.0 次 —— 看着像"角色一碰就死"，其实是统计错了。
 */
console.log(
  `每角色平均探险 ${(stats.explores / Math.max(1, stats.recruited + 1)).toFixed(1)} 次`,
);

console.log('\n金币曲线：');
for (const p of stats.goldCurve) {
  console.log(`  第 ${String(p.at).padStart(3)} 次行动：${String(p.gold).padStart(5)} 金 · 名册 ${p.roster}`);
}

const last = stats.goldCurve[stats.goldCurve.length - 1];
if (meta.gold > RUNS * 80) console.log('\n⚠ 金币溢出：每轮净赚超过 80 金，产出偏高');
if (stats.bankrupt > RUNS * 0.05) console.log('\n⚠ 破产频繁：产出或招募价需要重调');
if (stats.recruited > 0 && meta.graveyard.length >= stats.recruited) {
  console.log('\n⚠ 所有招募的角色都死了：命数消耗可能过快（也可能是设计如此，角色本就是消耗品）');
}
