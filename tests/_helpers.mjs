/**
 * 测试辅助（v2.0）
 *
 * 迷宫层之后，"createRun 完就有一场战斗"这件事不再成立 ——
 * 得先翻格才碰得到敌人。所有流程测试都需要这同一段"往下探"的动作，
 * 复制到每个文件里迟早会各自漂移，所以抽在这里。
 */

import { canReveal } from '../src/core/dungeon.js';
import { triggerCell, revealCellInRun } from '../src/core/run.js';

/**
 * 一路翻格，翻到第一只敌人就踩上去。
 * 成功后 run.phase === 'battle'；失败（这一层没有敌人，理论上不该发生）返回 false。
 */
export function enterFirstBattle(run) {
  for (let step = 0; step < 40; step++) {
    if (run.phase === 'battle') return true;
    const map = run.floorMap;
    if (!map) return false;

    const enemy = map.cells.findIndex((c) => c.revealed && !c.done && c.kind === 'enemy');
    if (enemy >= 0) {
      triggerCell(run, enemy);
      continue;
    }

    const next = map.cells.findIndex((c, i) => !c.revealed && canReveal(map, i));
    if (next < 0) return false;
    revealCellInRun(run, next);
  }
  return run.phase === 'battle';
}

/** 把这一层所有敌人清光（直接改标记，用于只关心"能否下楼"的测试） */
export function clearAllEnemies(map) {
  for (const c of map.cells) {
    if (c.kind === 'enemy') c.done = true;
  }
  map.enemiesLeft = 0;
}

/**
 * 找一个**带这种格子**的种子再建局。
 *
 * v3.14 起宝箱/事件是概率出现（各 70%），固定种子有 30% 的几率这一层没有，
 * 测试如果写死 newRun(21) 就会在某次改动后突然找不到格子 —— 那不是规则坏了。
 */
export function newRunWith(kind, build, maxSeed = 80) {
  for (let seed = 1; seed <= maxSeed; seed++) {
    const run = build(seed);
    if (run.floorMap?.cells?.some((c) => c.kind === kind)) return run;
  }
  throw new Error(`试了 ${maxSeed} 个种子都没有 ${kind} 格`);
}

/** 找一格指定类型并翻开（不触发） */
export function revealKind(run, kind) {
  const map = run.floorMap;
  const i = map.cells.findIndex((c) => c.kind === kind);
  if (i < 0) return -1;
  map.cells[i].revealed = true;
  return i;
}
