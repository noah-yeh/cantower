/**
 * 临时脚本：统计一局探险平均捡几件装备 → 折算碎片/星屑产出速度
 * 与 tools/bot.mjs 的 runOne 同路径，但保留 run 并数装备掉落。
 */
import { createCharacter } from '../src/core/roster.js';
import { CLASSES, RACES } from '../src/core/characters.js';
import {
  createRun, play, pass, applyReward, leaveShop, triggerCell, revealCellInRun,
  chooseUpgradeCard, acceptQuest,
} from '../src/core/run.js';
import { autoTurn, autoReward, autoShop, autoUpgrade, autoMap } from './bot.mjs';
import { canReveal } from '../src/core/dungeon.js';
import { recycleValue, SHARDS_PER_STARDUST, EQUIP_DEFS } from '../src/core/equipment.js';

function runWithDrops(classId, raceId, seed) {
  const character = createCharacter({ classId, raceId, seed });
  const run = createRun({ character, seed });
  let steps = 0;
  let equips = []; // { src, defId, lv }

  /**
   * 复刻 bot.autoMap 的策略，但把 triggerCell 的返回值接住 ——
   * 原版把结果丢掉，宝箱掉装备（12%）就统计不到了。
   */
  const mapTrigger = (kind) => {
    const m = run.floorMap;
    const i = m.cells.findIndex((c) => c.revealed && !c.done && c.kind === kind);
    if (i < 0) return;
    const res = triggerCell(run, i);
    if (res?.kind === 'treasure' && res.equip?.defId) {
      equips.push({ src: 'treasure', defId: res.equip.defId, lv: 0 });
    }
  };

  while (['map', 'battle', 'reward', 'shop', 'upgrade', 'quest'].includes(run.phase)) {
    if (steps++ > 12000) break;
    if (run.phase === 'map') {
      // 与 bot.autoMap 完全同优先级：敌人 → 宝箱 → 事件 → 行商 → 空房 → 楼梯 → 翻格
      const m = run.floorMap;
      const pending = (kind) => m.cells.findIndex((c) => c.revealed && !c.done && c.kind === kind);
      let acted = false;
      for (const kind of ['enemy', 'treasure', 'event', 'shop', 'empty']) {
        if (pending(kind) >= 0) { mapTrigger(kind); acted = true; break; }
      }
      if (!acted && m.enemiesLeft === 0 && pending('stairs') >= 0) {
        mapTrigger('stairs'); acted = true;
      }
      if (!acted) {
        for (let i = 0; i < m.cells.length; i++) {
          if (canReveal(m, i)) { revealCellInRun(run, i); break; }
        }
      }
      continue;
    }
    if (run.phase === 'shop') { autoShop(run); continue; }
    if (run.phase === 'reward') { autoReward(run); continue; }
    if (run.phase === 'upgrade') { autoUpgrade(run); continue; }
    if (run.phase === 'quest') { acceptQuest(run); continue; }
    // 战斗结束的下一拍：收集 pendingEquip（战斗掉落）
    if (run.pendingEquip) {
      equips.push({ src: 'battle', defId: run.pendingEquip.defId, lv: 0 });
      run.pendingEquip = null;
    }
    autoTurn(run);
  }
  return { won: run.phase === 'won', floors: run.stats.floorsCleared, equips,
    turns: run.stats.turns || 0, kills: run.stats.kills };
}

function main() {
  const N = Number(process.argv[2]) || 200;
  const all = [];
  for (const c of Object.keys(CLASSES)) {
    for (const r of Object.keys(RACES)) {
      for (let i = 0; i < Math.ceil(N / (Object.keys(CLASSES).length * Object.keys(RACES).length)); i++) {
        all.push(runWithDrops(c, r, 1000 + i * 37 + c.length * 101 + r.length * 7));
      }
    }
  }

  const totalEq = all.reduce((s, x) => s + x.equips.length, 0);
  const avgEq = totalEq / all.length;
  const treasureCnt = all.reduce((s, x) => s + x.equips.filter((e) => e.src === 'treasure').length, 0);
  const battleCnt = totalEq - treasureCnt;
  const fineCnt = all.reduce((s, x) => s + x.equips.filter((e) => {
    const def = EQUIP_DEFS[e.defId];
    return def && def.rar === 'fine';
  }).length, 0);
  const eqDist = {};
  for (const x of all) eqDist[x.equips.length] = (eqDist[x.equips.length] || 0) + 1;
  const distStr = Object.keys(eqDist).sort((a, b) => a - b)
    .map((k) => `${k}件:${((eqDist[k] / all.length) * 100).toFixed(0)}%`).join('  ');
  const inRange = all.filter((x) => x.equips.length >= 1 && x.equips.length <= 3).length / all.length;
  const avgTurns = all.reduce((s, x) => s + x.turns, 0) / all.length;
  const avgKills = all.reduce((s, x) => s + x.kills, 0) / all.length;
  const avgFloors = all.reduce((s, x) => s + x.floors, 0) / all.length;
  const winRate = all.filter((x) => x.won).length / all.length;

  // 时长估算沿用 balance.mjs 公式
  const avgMinutes = (avgTurns * 11 + avgKills * 15 + avgFloors * 20) / 60;

  // 折算碎片：模拟里掉的都是 +0 → 每件 1✧；玩家局里混一点强化过的，按 1.1✧/件估上限
  const shardsPerRun = avgEq * 1.0;
  const shardsPerRunHi = avgEq * 1.1;

  console.log(`模拟 ${all.length} 局（真实路径机器人）`);
  console.log(`  通关率 ${(winRate * 100).toFixed(0)}%  平均层数 ${avgFloors.toFixed(1)}  平均击杀 ${avgKills.toFixed(1)}  估算时长 ${avgMinutes.toFixed(0)} 分钟`);
  console.log(`  平均装备掉落 ${avgEq.toFixed(2)} 件/局（宝箱 ${treasureCnt} + 战斗 ${battleCnt}）`);
  console.log(`  掉落分布：${distStr}   落在 1~3 件区间的比例 ${(inRange * 100).toFixed(0)}%`);
  console.log(`  稀有度：精良 ${fineCnt} 件（${(fineCnt / totalEq * 100).toFixed(0)}%）/ 常见 ${totalEq - fineCnt} 件`);
  console.log('');
  console.log('—— 两条星屑线的速度对比（统一按 ✦ 当量/小时）——');
  const recEqPerRun = shardsPerRun / SHARDS_PER_STARDUST;
  const recPerHour = recEqPerRun / (avgMinutes / 60);
  console.log(`  回收线：${shardsPerRun.toFixed(2)}✧/局 ÷ ${SHARDS_PER_STARDUST} = ${recEqPerRun.toFixed(3)}✦/局 ≈ ${recPerHour.toFixed(2)}✦/小时（要肝，每局 ${avgMinutes.toFixed(0)} 分钟）`);
  console.log(`  庄园线：理论 1✦/小时/座；实际按一天收 2 次封顶 = 6✦/天 ≈ 0.25✦/小时（挂机，可叠多座）`);
  console.log(`  → 回收 ≈ ${(recPerHour / 0.25).toFixed(1)} 座「勤快庄园」的当量，且必须一直肝；庄园躺着涨、能叠`);
  console.log('');
  const totalShards = 55 * SHARDS_PER_STARDUST;
  console.log(`—— 强化 +10 一件（55✦ = ${totalShards}✧）需要 ——`);
  console.log(`  纯庄园：55 小时（1 座）`);
  console.log(`  纯回收：${(totalShards / shardsPerRun).toFixed(0)} 局（每局 ${avgMinutes.toFixed(0)} 分钟 ≈ ${(totalShards / shardsPerRun * avgMinutes / 60).toFixed(0)} 小时净肝）`);
  console.log(`  混合（1 座庄园 + 每天 1 局）：按庄园日产 6✧（库存封顶 3、一天收 2 次）+ 回收 ${shardsPerRun.toFixed(1)}✧ ≈ ${(6 + shardsPerRun).toFixed(1)}✧/天 → ${(totalShards / (6 + shardsPerRun)).toFixed(0)} 天`);
}

main();
