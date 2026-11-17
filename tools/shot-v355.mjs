/**
 * v3.55 探针：敌人属性面板 = 玩家同一套 9 项，且暴击 / 闪避 / 知识已有真实数值。
 *
 * 用户：「所有怪物敌人的属性面板应该是跟玩家同一套的呀，现在总共应该有 9 种属性，
 * 怎么把机制啥的也放进去」→ 9 项同表、词条独立成「机制」块；
 * 「暴击，闪避，知识敌人也可以吃到」→ 这三项不再是 —，显示它的真实点数。
 *
 * 断言：9 行 / 顺序 / 6 项数值对拍 / 3 项不再是 — / 只剩恢复·幸运为 — /
 *       词条不在属性块 / 机制条数 / 与玩家面板行名逐字相同。
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4187/';
const ok = (c, m) => console.log(c ? 'OK ' : 'ERR', m);
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 })).newPage();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(350);

/** 造一场带确定词条的战斗：核心荆棘 + 一条变异 */
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');
  const enemies = await import('/src/core/enemies.js');
  const traitsMod = await import('/src/core/enemyTraits.js');
  const rngMod = await import('/src/core/rng.js');

  const m = meta.createMeta(20261109);
  const ch = roster.createCharacter({ classId: 'mage', raceId: 'stone', seed: 5 });
  ch.status = 'idle'; ch.lives = 3; m.roster = [ch]; save.saveMeta(m);

  const run = runMod.createRun({ character: ch, seed: 42 });
  const idx = run.floorMap.cells.findIndex((c) => !c.done && c.kind !== 'stairs');
  /** 用第 20 层的精英：暴击/闪避/知识三项都非 0，面板才看得出"敌人真的吃这三项" */
  const foe = enemies.makeEnemy(20, new rngMod.Rng(7), 'elite');
  foe.traits = [traitsMod.CORE_TRAITS.guardian, traitsMod.MUTATIONS.mut_thorns];
  foe.core = traitsMod.CORE_TRAITS.guardian;
  foe.mutations = [traitsMod.MUTATIONS.mut_thorns];
  run.floorMap.cells[idx] = { kind: 'enemy', revealed: true, done: false,
    data: { tier: 'normal', enemy: foe } };
  save.saveRun(run);
  m.run = { characterId: ch.id, floor: run.floor, paused: true };
  save.saveMeta(m);
});

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(450);
await page.locator('[data-action="resume"]').first().click();
await page.waitForTimeout(350);
await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
await page.waitForTimeout(250);
for (let step = 0; step < 40; step++) {
  if (await page.locator('.hand .card').count()) break;
  const t = await page.evaluate(() => {
    if (document.querySelector('.dcell.pending.k-enemy')) return 'enemy';
    if (document.querySelector('.dcell.pending')) return 'pending';
    if (document.querySelector('.dcell.reach')) return 'reach';
    return null;
  });
  if (!t) break;
  await page.evaluate((k) => {
    const el = k === 'enemy' ? document.querySelector('.dcell.pending.k-enemy')
      : k === 'pending' ? document.querySelector('.dcell.pending')
        : document.querySelector('.dcell.reach');
    el?.click();
  }, t);
  await page.waitForTimeout(300);
}
await page.waitForTimeout(250);
await page.screenshot({ path: 'tools/shots/v355-battle.png' });

/** 敌人真实数值（直接从存档里的敌人对象取，避免和视图口径混淆） */
const real = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const enemies = await import('/src/core/enemies.js');
  const run = save.loadRun();
  const cell = run.floorMap.cells.find((c) => c.kind === 'enemy' && c.data?.enemy);
  const e = cell.data.enemy;
  return { maxHp: e.maxHp, atk: e.atk, def: e.def || 0, energy: enemies.enemyEnergyOf(e),
    crit: e.crit || 0, dodge: e.dodge || 0, knowledge: e.knowledge || 0,
    traitNames: e.traits.map((t) => t.name) };
});

/* ---- 1. 打开敌人面板 ---- */
await page.evaluate(() => document.querySelector('.enemy-zone .face-btn')?.click());
await page.waitForTimeout(320);

const sheet = await page.evaluate(() => {
  const secs = [...document.querySelectorAll('.log-sheet .fd-sec')];
  const attrSec = secs.find((s) => s.querySelector('.fd-head')?.textContent.trim() === '属性');
  const mechSec = secs.find((s) => s.querySelector('.fd-head')?.textContent.includes('机制'));
  const rowsOf = (sec) => [...(sec?.querySelectorAll('.sp-row') || [])].map((r) => ({
    name: r.querySelector('.sp-key b')?.textContent.trim() || '',
    val: r.querySelector('.sp-key i')?.textContent.trim() ?? '',
    desc: r.querySelector('.sp-desc')?.textContent.trim() || '',
    off: r.className.includes('off'),
  }));
  return {
    attr: rowsOf(attrSec),
    mech: mechSec ? rowsOf(mechSec) : null,
    mechHead: mechSec?.querySelector('.fd-head')?.textContent.trim() || '',
    battleChips: [...document.querySelectorAll('.log-sheet .sp-battle .chip')].map((c) => c.textContent.trim()),
  };
});

console.log('属性行:', JSON.stringify(sheet.attr.map((r) => `${r.name}=${r.val}`)));
console.log('机制块:', sheet.mechHead, JSON.stringify(sheet.mech?.map((r) => r.name)));

ok(sheet.attr.length === 9, `属性正好 9 行（实际 ${sheet.attr.length}）`);
const NAMES = ['生命上限', '攻击力', '防御', '暴击', '闪避', '恢复', '知识', '幸运', '能量上限'];
ok(JSON.stringify(sheet.attr.map((r) => r.name)) === JSON.stringify(NAMES),
  `9 项顺序与玩家面板一致：${sheet.attr.map((r) => r.name).join('/')}`);

const byName = Object.fromEntries(sheet.attr.map((r) => [r.name, r]));
ok(byName['生命上限']?.val === String(real.maxHp), `生命上限 ${byName['生命上限']?.val} == 敌人 maxHp ${real.maxHp}`);
ok(byName['攻击力']?.val === String(real.atk), `攻击力 ${byName['攻击力']?.val} == 敌人 atk ${real.atk}`);
ok(byName['防御']?.val === String(real.def), `防御 ${byName['防御']?.val} == 敌人 def ${real.def}`);
ok(byName['能量上限']?.val === String(real.energy), `能量上限 ${byName['能量上限']?.val} == 敌人 energyCap ${real.energy}`);

/** v3.55：暴击 / 闪避 / 知识 已经有真实数值（用户：「敌人也可以吃到」），只剩两项不参与 */
ok(byName['暴击']?.val === String(real.crit) && !byName['暴击']?.off,
  `暴击 ${byName['暴击']?.val} == 敌人 crit ${real.crit}（不再是 —）`);
ok(byName['闪避']?.val === String(real.dodge) && !byName['闪避']?.off,
  `闪避 ${byName['闪避']?.val} == 敌人 dodge ${real.dodge}（不再是 —）`);
ok(byName['知识']?.val === String(real.knowledge) && !byName['知识']?.off,
  `知识 ${byName['知识']?.val} == 敌人 knowledge ${real.knowledge}（不再是 —）`);
ok(real.crit > 0 && real.dodge > 0, `这只怪的暴击/闪避都是非 0（${real.crit} / ${real.dodge}）`);
ok(byName['暴击']?.desc.includes('暴击'), '暴击说明按敌人口径写（暴击对你造成 X 倍伤害）');
ok(byName['知识']?.desc.includes('虚弱'), '知识说明按敌人口径写（提升它施加的虚弱回合数）');

const OFFS = ['恢复', '幸运'];
ok(OFFS.every((n) => byName[n]?.val === '—' && byName[n]?.off),
  `仍不参与的只有 2 项：${OFFS.map((n) => `${n}=${byName[n]?.val}`).join(' ')}`);
ok(OFFS.every((n) => byName[n]?.desc.includes('不参与')), '这 2 项的说明写明「敌人不参与这一项结算」');

ok(!!sheet.mech, `有独立的机制块（${sheet.mechHead}）`);
ok(sheet.mech?.length === real.traitNames.length,
  `机制条数 ${sheet.mech?.length} == 词条数 ${real.traitNames.length}`);
ok(!sheet.attr.some((r) => real.traitNames.includes(r.name)),
  '词条名不再出现在属性列表里（机制与属性分开）');
ok(sheet.mech?.every((r) => r.name && r.desc.length > 0), '每条机制都有说明文字');

ok(sheet.battleChips.some((c) => c.includes('生命')), `属性块顶部有本场状态：${sheet.battleChips.join(' / ')}`);

await page.screenshot({ path: 'tools/shots/v355-foe.png' });

/* ---- 2. 与玩家面板逐字比对 ---- */
await page.evaluate(() => document.querySelector('[data-action="close-foe-deck"]')?.click());
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector('.player-zone .face-btn')?.click());
await page.waitForTimeout(320);
const playerNames = await page.evaluate(() =>
  [...document.querySelectorAll('.stats-panel .sp-list .sp-row')].map((r) => r.querySelector('.sp-key b')?.textContent.trim()));
console.log('玩家面板:', JSON.stringify(playerNames));
ok(JSON.stringify(playerNames) === JSON.stringify(NAMES), '玩家面板同样是这 9 项（同一张表）');
ok(playerNames.length === 9, `玩家面板 9 行（实际 ${playerNames.length}）`);
await page.screenshot({ path: 'tools/shots/v355-player.png' });

await browser.close();
console.log('probe ok');
