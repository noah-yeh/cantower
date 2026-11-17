/**
 * 确定性随机 —— mulberry32
 *
 * 为什么不用 Math.random：
 *   1. 战斗可重放（同一个种子跑出同一局），测试才能断言
 *   2. 机器人模拟可以批量跑固定种子族，结果可复现
 *   3. 存档能续流，退出再进来不会洗牌
 *
 * 注意：Rng 自己持有内部状态 a，不能用闭包版（闭包版状态拿不出来，存档只能存种子）。
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = 1) {
    // 注意：不能写 `(seed >>> 0) || 1`。mulberry32 的内部状态 0 是合法值，
    // 存档里存下 0 再读回来会被改成 1，续流就错位了。
    this.a = seed >>> 0;
  }

  /** [0, 1) */
  next() {
    let a = (this.a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    this.a = a;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 整数 [0, n) */
  int(n) {
    return Math.floor(this.next() * n);
  }

  /** 闭区间 [min, max] 整数 */
  range(min, max) {
    return min + this.int(max - min + 1);
  }

  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[this.int(arr.length)];
  }

  /** 原地洗牌，返回同一个数组 */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** 按权重取一个 key：weights = { a: 2, b: 1 } */
  weighted(weights) {
    const entries = Object.entries(weights).filter(([, w]) => w > 0);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    if (total <= 0) return null;
    let roll = this.next() * total;
    for (const [key, w] of entries) {
      roll -= w;
      if (roll <= 0) return key;
    }
    return entries[entries.length - 1][0];
  }

  /** 从数组里不重复抽 n 个（不改原数组） */
  sample(arr, n) {
    const pool = arr.slice();
    this.shuffle(pool);
    return pool.slice(0, Math.min(n, pool.length));
  }

  /** 导出内部状态，用于存档续流 */
  save() {
    return this.a;
  }
}
