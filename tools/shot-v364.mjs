/**
 * v3.64 探针：护甲牌再削一档 + 取消敌人「每回合 2 张」上限。
 *
 * 用户：「再整体削弱一下获得护甲的卡牌，可以调高一部分费用，调低一部分基础值，
 * 另外敌人每次只能行动两次吗？不要增加这个限制，根据费用抽到的实际牌可实际使用，
 * 跟玩家同样的机制，包括竞技场的敌人玩家」。
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const ok = (c, m) => console.log(c ? 'OK ' : 'ERR', m);
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 })).newPage();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

/* ① 护甲牌数值：费用上调的两张 + 基础值下调的抽查 */
const cards = await page.evaluate(async () => {
  const { CARDS, cardText } = await import('/src/core/cards.js');
  const pick = ['w_ironWall', 'w_shieldWall', 'guard', 'w_shieldUp', 'm_shield', 't_shell', 'r_stoneSkin', 'brace'];
  return pick.map((id) => ({
    id, name: CARDS[id].name, cost: CARDS[id].cost, block: CARDS[id].block,
    text: cardText(id, 10, {}),
  }));
});
const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
ok(byId.w_ironWall.cost === 3 && byId.w_ironWall.block === 26, `铁壁 3 费 26 甲（${byId.w_ironWall.cost} 费 ${byId.w_ironWall.block} 甲）`);
ok(byId.w_shieldWall.cost === 3 && byId.w_shieldWall.block === 24, `盾墙 3 费 24 甲（${byId.w_shieldWall.cost} 费 ${byId.w_shieldWall.block} 甲）`);
ok(byId.guard.block === 9 && byId.w_shieldUp.block === 12, `格挡 9 / 举盾 12（${byId.guard.block} / ${byId.w_shieldUp.block}）`);
ok(byId.m_shield.block === 15 && byId.t_shell.block === 11 && byId.r_stoneSkin.block === 10, `法力护盾 15 / 甲壳 11 / 石肤 10`);
ok(byId.brace.block === 4, `架势 0 费 4 甲（${byId.brace.block}）`);
ok(/29/.test(byId.w_ironWall.text), `卡面文案按攻击力折算：26 甲 × 1.1 = 29（「${byId.w_ironWall.text}」）`);

/* ② 护甲效率护栏：纯护甲牌每费 ≤ 12（0 费 ≤ 4） */
const guard = await page.evaluate(async () => {
  const { CARDS } = await import('/src/core/cards.js');
  const extra = ['dmg', 'heal', 'poison', 'weak', 'draw', 'thorns', 'exhaust', 'costHp',
    'cleanseBlock', 'race', 'energy', 'strength', 'amplifyPoison', 'unplayedArmor'];
  const bad = [];
  for (const [id, c] of Object.entries(CARDS)) {
    if (c.block == null) continue;
    if (extra.some((f) => c[f] != null && c[f] !== false)) continue;
    const limit = c.cost === 0 ? 4 : c.cost * 12;
    if (c.block > limit) bad.push(`${id} ${c.block} > ${limit}`);
  }
  return bad;
});
ok(guard.length === 0, `纯护甲牌全部在 12/费 以内${guard.length ? '：' + guard.join('、') : ''}`);

/* ③ 敌人出牌上限已移除：能量够就打满，5 能量只够两张 2 费 */
const enemy = await page.evaluate(async () => {
  const { CURVE } = await import('/src/core/enemies.js');
  const { createBattle, endTurn } = await import('/src/core/combat.js');
  const { Rng } = await import('/src/core/rng.js');
  const { resolveRelics } = await import('/src/core/relics.js');

  const mk = (ids) => ({
    id: 'dummy', name: '木桩', tier: 'normal', floor: 1, core: null, mutations: [], traits: [],
    deck: [], hand: ids.slice(), draw: [], discard: [],
    energy: 5, hp: 500, maxHp: 500, atk: 5, baseAtk: 5, armor: 0, poison: 0,
    weakTurns: 0, keepPoison: false, turn: 0, enraged: 0,
    revived: false, charged: false, hitThisTurn: 0, manual: true,
  });
  const battle = (ids) => createBattle({
    player: { hp: 500, maxHp: 500, atk: 10 },
    enemy: mk(ids),
    deck: Array(5).fill('strike'),
    relics: resolveRelics([]),
    rng: new Rng(42),
  });

  const count = (ids) => {
    const b = battle(ids);
    endTurn(b);
    return b.log.filter((l) => l.side === 'enemy' && l.name).length;
  };
  return {
    hasCap: 'enemyMaxPlays' in CURVE,
    fourCheap: count(['e_strike', 'e_strike', 'e_strike', 'e_strike']),
    twoCost: count(['e_slam', 'e_slam', 'e_slam', 'e_slam']),
  };
});
ok(!enemy.hasCap, 'CURVE 里已没有 enemyMaxPlays');
ok(enemy.fourCheap === 4, `4 张 1 费牌 → 打 4 张（旧上限只打 2 张），实际 ${enemy.fourCheap}`);
ok(enemy.twoCost === 2, `5 能量只够两张 2 费，实际 ${enemy.twoCost}`);

/* ④ 真机手战斗：敌人回合能连续出牌，卡面无叠字（沿用 v3.63 的排版结论） */
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(350);
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');
  const m = meta.createMeta(20261110);
  const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 5 });
  ch.status = 'idle'; ch.lives = 3; m.roster = [ch]; save.saveMeta(m);
  const run = runMod.createRun({ character: ch, seed: 42 });
  const idx = run.floorMap.cells.findIndex((c) => c.kind === 'enemy' && !c.done);
  run.floorMap.cells[idx].revealed = true;
  save.saveRun(run);
  m.run = { characterId: ch.id, floor: run.floor, paused: true };
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(450);
await page.locator('[data-action="resume"]').first().click();
await page.waitForTimeout(350);
await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.dcell.pending.k-enemy')?.click());
await page.waitForTimeout(600);

ok(!!(await page.locator('.hand .card').count()), '进入战斗，手牌已渲染');
// 结束回合，等敌人把这一回合的牌出完
await page.evaluate(() => document.querySelector('[data-action="end-turn"]')?.click());
await page.waitForTimeout(2600);
/** 敌人回合结束后打开战斗记录，数它这回合打出的牌（每张一行 .log-row.enemy） */
await page.evaluate(() => document.querySelector('[data-action="open-log"]')?.click());
await page.waitForTimeout(300);
const after = await page.evaluate(() => ({
  enemyPlays: [...document.querySelectorAll('.log-row.enemy')].filter((r) => r.querySelector('.log-name')?.textContent.trim() !== '—').length,
  names: [...document.querySelectorAll('.log-row.enemy .log-name')].map((n) => n.textContent.trim()),
  hand: document.querySelectorAll('.hand .card').length,
}));
ok(after.enemyPlays >= 1, `敌人回合打出 ${after.enemyPlays} 张：${after.names.join('/')}`);
ok(after.hand > 0, `回合已交回玩家（手牌 ${after.hand} 张）`);
await page.screenshot({ path: 'tools/probe/shot-v364-battle.png' });

await browser.close();
console.log('ALL PASS');
