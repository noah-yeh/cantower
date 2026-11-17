/**
 * 单局逐层追踪 —— 调到"某一层突然打不过"时用它看现场
 *
 * 用法：node tools/trace.mjs [职业] [种族] [种子]
 *   node tools/trace.mjs warrior stone 7
 */

import { createRun, MAX_FLOOR, acceptQuest } from '../src/core/run.js';
import { CARDS } from '../src/core/cards.js';
import { CLASSES, RACES } from '../src/core/characters.js';
import { autoTurn, autoReward, autoShop, autoMap } from './bot.mjs';

const classId = process.argv[2] || 'warrior';
const raceId = process.argv[3] || 'stone';
const seed = Number(process.argv[4]) || 7;

if (!CLASSES[classId] || !RACES[raceId]) {
  console.error(`未知组合：${classId}/${raceId}`);
  console.error(`职业：${Object.keys(CLASSES).join(' / ')}`);
  console.error(`种族：${Object.keys(RACES).join(' / ')}`);
  process.exit(1);
}

const run = createRun({ classId, raceId, seed });

console.log(`\n残塔 · 逐层追踪   种子 ${seed}`);
console.log(`${run.characterName}   初始 ${run.player.hp}HP / ${run.player.atk}ATK   卡组 ${run.deck.length} 张\n`);
console.log('层  敌人         类型   敌HP/敌ATK   我方HP  护甲  回合  结果   词条（核心/变异）');
console.log('----|------------|------|------------|-------|-----|-----|------|------------------');

let step = 0;

while ((run.phase === 'map' || run.phase === 'battle' || run.phase === 'reward' || run.phase === 'shop' || run.phase === 'quest') && step++ < 1200) {
  if (run.phase === 'map') {
    /** 地图阶段不逐格打印（一层十几步），只在换层时提示一次 */
    const beforeFloor = run.floor;
    autoMap(run);
    if (run.floor !== beforeFloor) console.log(`      → 下到第 ${run.floor} 层`);
    continue;
  }
  if (run.phase === 'shop') {
    console.log(`      → 行商：金币 ${run.gold} / 材料 ${run.materials}`);
    autoShop(run);
    continue;
  }
  if (run.phase === 'quest') {
    console.log(`      → 委托板：${run.questOffer?.name ?? '未知'}（接受）`);
    acceptQuest(run);
    continue;
  }
  if (run.phase === 'reward') {
    const picked = autoReward(run);
    if (picked && picked.option) {
      const o = picked.option;
      const label = o.kind === 'card' ? CARDS[o.id].name : o.kind === 'relic' ? `宝物·${o.id}` : o.kind === 'stat' ? `属性·${o.id}` : '治疗';
      console.log(`      → 三选一：${label}`);
    }
    continue;
  }

  const b = run.battle;
  const enemy = b.enemy;
  const snapshot = {
    floor: run.floor,
    name: enemy.name,
    tier: enemy.tier,
    hp: enemy.hp,
    atk: enemy.atk,
    traits: (enemy.traits || []).map((t) => t.name).join('/'),
    energyCap: enemy.energyCap ?? null,
    playerHp: run.player.hp,
    armor: b.player.armor,
  };

  // 打完整场，不是只打一回合
  let turns = 0;
  while (run.phase === 'battle' && run.battle?.phase === 'player' && turns < 100) {
    const before = run.battle.turn;
    autoTurn(run);
    turns += Math.max(1, (run.battle?.turn ?? before + 1) - before);
  }

  const result = run.phase === 'dead' ? '阵亡' : '胜';

  console.log(
    `${String(snapshot.floor).padStart(2)}  ${snapshot.name.padEnd(10, '　')} ${snapshot.tier.padEnd(5)} ${String(snapshot.hp).padStart(5)}/${String(snapshot.atk).padStart(4)}   ${String(snapshot.playerHp).padStart(5)}  ${String(snapshot.armor).padStart(4)}  ${String(turns).padStart(4)}  ${result}   ${snapshot.traits}`,
  );

  if (run.phase === 'dead') break;
}

const won = run.phase === 'won';
console.log(`\n结果：${won ? '登顶' : `止步第 ${run.floor} 层`}   卡组 ${run.deck.length} 张   宝物 ${run.relics.length} 件`);
console.log(`宝物：${run.relics.join(', ') || '无'}`);
console.log(`攻击 ${run.player.atk}   最终生命 ${run.player.hp}/${run.player.maxHp}\n`);
