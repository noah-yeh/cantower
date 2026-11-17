/**
 * 委托与额外天赋（v3.72 建，v3.85 重做）。
 *
 * 覆盖：
 *   - offer 只是"一张纸"：掷 offer 不改 run.quest，接受后才写
 *   - 接受 / 婉拒两条路（v3.85 用户：「可以拒绝」）
 *   - 委托板只在前 8 层出现、一局最多接 3 份（v3.85 → v3.86 扩到 8 层）
 *   - 每份委托只发**自己池子里**的天赋（v3.85 用户：「多做一些天赋给不同的任务」）
 *   - 五个真实钩子：杀怪 / 出攻击牌 / 下楼 / 开宝箱 / 合成
 *   - 存档往返：offer 与已接份数都要续上
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CELL, makeFloorMap } from '../src/core/dungeon.js';
import {
  createRun, advanceFloor, play, pass, triggerCell, applyReward, acceptQuest, declineQuest, forgeInRun,
} from '../src/core/run.js';
import { canPlay } from '../src/core/combat.js';
import { Rng } from '../src/core/rng.js';
import { createCharacter } from '../src/core/roster.js';
import {
  EXTRA_TALENTS, QUESTS, QUEST_MAX_FLOOR, QUEST_MAX_PER_RUN,
  makeQuestOffer, questOfferOf, bumpQuest,
} from '../src/core/talents.js';
import { serializeRun, saveRun, loadRun, clearRun } from '../src/core/save.js';
import { enterFirstBattle, clearAllEnemies, newRunWith } from './_helpers.mjs';

function newRun(seed = 5, floor = 1) {
  const character = createCharacter({ classId: 'warrior', raceId: 'stone', seed });
  const run = createRun({ character, seed });
  run.floor = floor;
  makeFloorMap(run);
  return run;
}

/** 固定掷取桩：int(n) 永远给 idx，但要夹在 n 里（真 Rng 的语义） */
const stubRng = (idx) => ({ int: (n) => idx % Math.max(1, n) });

/** 造一个"正停在委托页"的 run */
function runAtOffer(seed = 21, id = 'hunt') {
  const run = newRun(seed);
  run.phase = 'quest';
  run.questOffer = questOfferOf(id);
  return run;
}

/* ------------------------------------------------------------------ *
 * offer / 接受 / 婉拒
 * ------------------------------------------------------------------ */

test('makeQuestOffer 只掷 offer，不写 run.quest；字段齐全且不重复上一份', () => {
  const run = newRun(11);
  const off = makeQuestOffer(run, stubRng(0));
  assert.equal(run.quest, null, '接受之前不应该有进行中的委托');
  assert.equal(off.id, Object.keys(QUESTS)[0]);
  assert.equal(off.target, QUESTS[off.id].target);
  assert.ok(off.text && off.goalLabel && off.reward, '给自己看/给 UI 用的字段都要有');
  assert.ok(off.poolNames.length >= 3, '奖励池至少要报得出 3 枚名字');

  run.lastQuestId = off.id;
  const seen = new Set();
  const rng2 = new Rng(3);
  for (let i = 0; i < 40; i++) {
    const o = makeQuestOffer(run, rng2);
    seen.add(o.id);
    assert.notEqual(o.id, run.lastQuestId, '不能立刻再给一份同样的');
    run.lastQuestId = o.id;
  }
  assert.ok(seen.size >= 3, `池子里至少能轮到三种委托（实际 ${seen.size}）`);
});

test('接受委托：写 run.quest / 已接份数 +1 / 回地图', () => {
  const run = runAtOffer(21, 'hunt');
  const res = acceptQuest(run);
  assert.equal(res.ok, true);
  assert.equal(run.quest.id, 'hunt');
  assert.equal(run.quest.progress, 0);
  assert.equal(run.quest.target, QUESTS.hunt.target);
  assert.equal(run.quest.name, '讨伐委托', '名字写进 run.quest，UI 不再硬编码 id 表');
  assert.equal(run.questsTaken, 1);
  assert.equal(run.phase, 'map');
  assert.equal(run.questOffer, null);
  assert.match(run.lastCellNote, /接下「讨伐委托」/);
});

test('婉拒委托：不接、不给天赋、回地图', () => {
  const run = runAtOffer(22, 'trek');
  const res = declineQuest(run);
  assert.equal(res.ok, true);
  assert.equal(run.quest, null);
  assert.equal(run.questsTaken, 0, '婉拒不算接过');
  assert.equal(run.phase, 'map');
  assert.match(run.lastCellNote, /婉拒了「跋涉委托」/);
});

test('不在委托页时接受/婉拒都会被拒', () => {
  const run = newRun(23);
  assert.equal(acceptQuest(run).ok, false);
  assert.equal(declineQuest(run).ok, false);
});

test('一局最多接 3 份：第 4 份直接拒绝', () => {
  const run = runAtOffer(24, 'hunt');
  run.questsTaken = QUEST_MAX_PER_RUN;
  const res = acceptQuest(run);
  assert.equal(res.ok, false);
  assert.match(res.reason, /最多接 3 份/);
  assert.equal(run.quest, null);
  assert.equal(run.phase, 'quest', '失败时不改变状态');
});

/* ------------------------------------------------------------------ *
 * 地图出现条件：前 6 层 + 没委托 + 没接满
 * ------------------------------------------------------------------ */

test('委托板只在前 8 层出现，第 9 层起一个都没有', () => {
  const hasHerald = (run) => run.floorMap.cells.some((c) => c.kind === CELL.EVENT && c.data?.event === 'herald');

  for (const floor of [1, 4, 8]) {
    let hit = 0;
    for (let seed = 1; seed <= 60; seed++) {
      if (hasHerald(newRun(seed, floor))) hit++;
    }
    assert.ok(hit > 0, `第 ${floor} 层应该偶尔刷出委托板（60 种子里 ${hit} 次）`);
  }

  for (const floor of [9, 12, 20, 30]) {
    for (let seed = 1; seed <= 40; seed++) {
      assert.equal(hasHerald(newRun(seed, floor)), false, `第 ${floor} 层 seed ${seed} 不该有委托板`);
    }
  }
  assert.equal(QUEST_MAX_FLOOR, 8);
});

test('已有进行中的委托 / 已接满 3 份时，地图不再刷委托板', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const a = newRun(seed, 3);
    a.quest = { id: 'hunt', progress: 1 };
    makeFloorMap(a);
    assert.equal(a.floorMap.cells.filter((c) => c.kind === CELL.EVENT && c.data?.event === 'herald').length, 0,
      `seed ${seed} 有委托时不该再刷`);

    const b = newRun(seed, 3);
    b.questsTaken = QUEST_MAX_PER_RUN;
    makeFloorMap(b);
    assert.equal(b.floorMap.cells.filter((c) => c.kind === CELL.EVENT && c.data?.event === 'herald').length, 0,
      `seed ${seed} 接满 3 份后不该再刷`);
  }
});

/* ------------------------------------------------------------------ *
 * 触发路径：委托板 → 委托页（不是触发即接单）
 * ------------------------------------------------------------------ */

test('踩委托板：进委托页、格子算揭过，接受后才开始计数', () => {
  const run = newRunWith(CELL.EVENT, (seed) => newRun(seed));
  const i = run.floorMap.cells.findIndex((c) => c.kind === CELL.EVENT && !c.done);
  run.floorMap.cells[i].revealed = true;
  run.floorMap.cells[i].data = { event: 'herald' };

  const res = triggerCell(run, i);
  assert.equal(res.ok, true);
  assert.equal(run.phase, 'quest', '先进委托页');
  assert.ok(run.questOffer, '纸上写着委托内容');
  assert.equal(run.quest, null, '还没接');
  assert.equal(run.floorMap.cells[i].done, true, '纸只有一张，接不接都算揭过');

  const acc = acceptQuest(run);
  assert.equal(acc.ok, true);
  assert.equal(run.quest.id, run.lastQuestId);
  assert.equal(run.phase, 'map');
});

/* ------------------------------------------------------------------ *
 * 完成奖励：只发该委托自己的天赋池
 * ------------------------------------------------------------------ */

test('每份委托的奖励天赋都属于它自己的池子', () => {
  for (const [id, q] of Object.entries(QUESTS)) {
    assert.ok(q.pool.length >= 5, `${q.name} 至少要给 5 枚候选天赋`);
    for (const t of q.pool) assert.ok(EXTRA_TALENTS[t], `${q.name} 的天赋 ${t} 必须在池子里`);
    assert.ok(q.reward && q.goalLabel, `${q.name} 要有奖励名与进度说明`);
  }
  assert.ok(Object.keys(EXTRA_TALENTS).length >= 21, 'v3.86 至少 21 枚额外天赋');
});

test('offer 带 poolInfo：每枚天赋都报得出名字 + 图标 + 效果全文', () => {
  for (const id of Object.keys(QUESTS)) {
    const off = questOfferOf(id);
    assert.equal(off.poolInfo.length, QUESTS[id].pool.length, `${off.name} 的 poolInfo 要覆盖整池`);
    for (const t of off.poolInfo) {
      assert.ok(t.name && t.icon, `${off.name} 的 ${t.id} 缺名字或图标`);
      assert.ok(/[+\-%生命攻击防御暴击闪避能量恢复]/.test(t.text), `${t.name} 的效果文案没写清数值：${t.text}`);
    }
  }
});

test('新天赋都会落到 player 上，且不超上限', () => {
  const run = newRun(37);
  const p = run.player;
  const before = { hp: p.maxHp, atk: p.atk, def: p.def || 0, crit: p.crit || 0, dodge: p.dodge || 0, rec: p.recovery || 0 };
  for (const id of ['stoneheart', 'sturdy', 'mend', 'valor', 'bloodlust', 'swift', 'agile', 'insight']) {
    EXTRA_TALENTS[id].apply(p);
  }
  assert.ok(p.maxHp > before.hp, '生命要涨');
  assert.ok(p.atk > before.atk, '攻击要涨');
  assert.ok((p.def || 0) > before.def, '防御要涨');
  assert.ok((p.crit || 0) > before.crit, '暴击要涨');
  assert.ok((p.dodge || 0) > before.dodge, '闪避要涨');
  assert.ok((p.recovery || 0) > before.rec, '战后恢复要涨');
  assert.ok(p.crit <= 60 && p.def <= 40 && p.dodge <= 30, '不能突破属性上限');
});

test('bumpQuest 完成时从该委托池里发天赋并落到 player 属性上', () => {
  for (const id of ['hunt', 'drill', 'trek']) {
    const run = newRun(31);
    const q = QUESTS[id];
    run.quest = { id, progress: q.target - 1, target: q.target };
    const note = bumpQuest(run, q.goal, 1, stubRng(0));
    assert.match(note, /委托完成/);
    assert.match(note, /习得天赋/);
    assert.equal(run.quest, null);
    assert.equal(run.talents.length, 1);
    assert.ok(q.pool.includes(run.talents[0]), `${q.name} 发了池外的天赋 ${run.talents[0]}`);
    assert.ok(EXTRA_TALENTS[run.talents[0]]);
    assert.equal(run.lastQuestNote, note);
  }
});

test('池子抽干后从全池兜底（不会卡死）', () => {
  const run = newRun(32);
  run.talents = QUESTS.hunt.pool.slice();
  run.quest = { id: 'hunt', progress: QUESTS.hunt.target - 1, target: QUESTS.hunt.target };
  const note = bumpQuest(run, 'kills', 1, stubRng(0));
  assert.match(note, /习得天赋/);
  assert.ok(!QUESTS.hunt.pool.includes(run.talents.at(-1)), '池里已有的不再发');
});

test('灵涌在能量顶满时不进随机池', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const run = newRun(40 + seed);
    run.player.energy = 10; // ENERGY_CAP
    run.quest = { id: 'drill', progress: 0, target: QUESTS.drill.target };
    for (let i = 0; i < 20 && run.quest; i++) {
      bumpQuest(run, 'atkCards', 1, stubRng(seed % 6));
    }
    assert.equal(run.quest, null);
    assert.ok(!run.talents.includes('surge'), '顶满能量不该发灵涌');
    assert.ok(!run.talents.includes('insight'), '顶满能量不该发通明');
  }
});

test('属性上限要夹住：暴击 58 + 鹰眼 = 60，防御 39 + 堡垒 = 40', () => {
  const run = newRun(33);
  run.player.crit = 58;
  run.player.def = 39;
  EXTRA_TALENTS.eagle.apply(run.player);
  EXTRA_TALENTS.bastion.apply(run.player);
  assert.equal(run.player.crit, 60);
  assert.equal(run.player.def, 40);
});

/* ------------------------------------------------------------------ *
 * 五个真实钩子：下楼 / 出攻击牌 / 开宝箱 / 合成
 * ------------------------------------------------------------------ */

test('advanceFloor 推进跋涉委托，完成时写 lastQuestNote', () => {
  const run = newRun(31);
  run.quest = { id: 'trek', progress: 2, target: 3 };
  clearAllEnemies(run.floorMap);
  assert.equal(advanceFloor(run), true);
  assert.equal(run.quest, null, '3 层委托在这次下楼时完成');
  assert.match(run.lastQuestNote, /习得天赋/);
  assert.equal(run.talents.length, 1);
});

test('play 打出攻击牌推进修行委托（连打两场也行）', () => {
  const run = newRun(32);
  /** 纯打击卡组：打出去的一定是攻击牌 */
  run.deck = Array.from({ length: 12 }, () => 'strike');
  run.quest = { id: 'drill', progress: 0, target: 8 };
  assert.equal(enterFirstBattle(run), true);

  let guard = 0;
  while (run.quest && guard++ < 300) {
    if (run.phase === 'battle' && run.battle) {
      const b = run.battle;
      const idx = b.hand.findIndex((_, i) => canPlay(b, i));
      if (idx >= 0) play(run, idx);
      else pass(run);
    } else if (run.phase === 'reward') {
      const opts = run.reward?.options || [];
      const heal = opts.findIndex((o) => o.kind === 'heal');
      applyReward(run, heal >= 0 ? heal : 0);
    } else if (run.phase === 'map') {
      assert.equal(enterFirstBattle(run), true);
    } else {
      break;
    }
  }
  assert.equal(run.quest, null, '8 张攻击牌打满，委托完成');
  assert.match(run.lastQuestNote, /习得天赋/);
  assert.equal(run.talents.length, 1);
});

test('开宝箱推进寻宝委托（开满 2 个就完成）', () => {
  const run = newRunWith(CELL.TREASURE, (seed) => newRun(seed));
  const i = run.floorMap.cells.findIndex((c) => c.kind === CELL.TREASURE && !c.done);
  run.floorMap.cells[i].revealed = true;
  run.quest = { id: 'scavenge', progress: 1, target: 2 };
  triggerCell(run, i);
  assert.equal(run.quest, null, '第 2 个宝箱把委托办完了');
  assert.match(run.lastQuestNote, /寻宝委托/);
  assert.ok(QUESTS.scavenge.pool.includes(run.talents[0]));
});

test('合成推进精进委托（合一次就完成）', () => {
  const run = newRun(34);
  run.deck = ['strike', 'strike', ...Array(8).fill('brace')];
  run.quest = { id: 'craft', progress: 0, target: 1 };
  const res = forgeInRun(run, 'strike');
  assert.equal(res.ok, true);
  assert.equal(run.quest, null);
  assert.match(run.lastQuestNote, /精进委托/);
  assert.ok(QUESTS.craft.pool.includes(run.talents[0]));
});

/* ------------------------------------------------------------------ *
 * 存档
 * ------------------------------------------------------------------ */

test('存档往返：委托页的 offer 与已接份数都续得上', () => {
  /** save.js 只认 globalThis.localStorage：shop.test 同款内存桩 */
  const store = new Map();
  const had = 'localStorage' in globalThis;
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    const run = runAtOffer(35, 'scavenge');
    run.questsTaken = 2;
    saveRun(run);
    const back = loadRun();
    assert.equal(back.phase, 'quest', '读档回委托页，不能让玩家白拿或白丢');
    assert.equal(back.questOffer.id, 'scavenge');
    assert.equal(back.questOffer.target, QUESTS.scavenge.target);
    assert.equal(back.questsTaken, 2);

    const acc = acceptQuest(back);
    assert.equal(acc.ok, true);
    assert.equal(back.quest.id, 'scavenge');
  } finally {
    clearRun();
    if (!had) delete globalThis.localStorage;
  }
});

test('serializeRun 带上委托字段（questOffer / questsTaken）', () => {
  const run = runAtOffer(36, 'trek');
  run.questsTaken = 1;
  const data = serializeRun(run);
  assert.equal(data.questOffer.id, 'trek');
  assert.equal(data.questsTaken, 1);
});
