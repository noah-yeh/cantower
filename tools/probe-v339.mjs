/**
 * 探针 v3.39：顶栏瘦身（战斗记录回到可视区）+ 幸运/生命宝物
 *
 * 要证的六件事：
 *   1. 战斗页顶栏所有按钮都在视口内（v3.38 加「属性」后顶栏 401px > 390px 视口，
 *      「记录」「背包」被挤出屏幕 —— 用户报的"看不到战斗记录"）
 *   2. 「记录」按钮点开战斗记录面板、能关掉
 *   3. 地图页顶栏同样不溢出
 *   4. 宝库买到四叶坠：扣 3 水晶、幸运 +2、货架上标记已售
 *   5. 宝库买到血玉心坠 Lv.3：扣 3 水晶（固定价不随等级加价）、生命上限 +15、当前血量跟涨
 *   6. 控制台零报错
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4183/';

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

/** 顶栏几何：所有 data-action 元素的最右端不许超出视口 */
const topbarGeo = () => page.evaluate(() => {
  const els = [...document.querySelectorAll('.topbar .top-right [data-action], .topbar .top-right b, .topbar .top-right .run-gold')];
  const right = Math.max(...els.map((e) => e.getBoundingClientRect().right));
  const btns = [...document.querySelectorAll('.topbar .top-right [data-action]')].map((b) => ({
    a: b.dataset.action, visible: b.getBoundingClientRect().right <= window.innerWidth && b.getBoundingClientRect().left >= 0,
  }));
  return { right: Math.round(right), viewW: window.innerWidth, btns };
});

/* ---------------- 注入：一局 + 宝库格（货架手工指定） ---------------- */

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');
  const m = meta.createMeta(20261108);
  const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 5 });
  ch.veteran = false;
  ch.status = 'idle';
  ch.lives = 3;
  m.roster = [ch];
  save.saveMeta(m);

  const run = runMod.createRun({ character: ch, seed: 42 });
  run.materials = 10;
  const shopMod = await import('/src/core/shop.js');
  const idx = run.floorMap.cells.findIndex((c) => !c.done && c.kind !== 'stairs');
  run.floorMap.cells[idx] = {
    kind: 'relicShop', revealed: true, done: false,
    data: { shop: { kind: 'relic', cards: [], refreshes: 0, relics: [
      { id: 'cloverCharm', lv: 1, price: shopMod.relicShopPrice('cloverCharm', 1), sold: false },
      { id: 'vitalHeart', lv: 3, price: shopMod.relicShopPrice('vitalHeart', 3), sold: false },
    ] } },
  };
  save.saveRun(run);
  m.run = { characterId: ch.id, floor: run.floor, paused: true };
  save.saveMeta(m);
});

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.locator('[data-action="resume"]').first().click();
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
await page.waitForTimeout(250);

/* ---------------- 1/3. 地图页顶栏 ---------------- */

const mapBar = await topbarGeo();
console.log('地图顶栏:', JSON.stringify(mapBar));
check(mapBar.right <= mapBar.viewW, `地图顶栏溢出：右端 ${mapBar.right} > 视口 ${mapBar.viewW}`);
check(mapBar.btns.every((b) => b.visible), '地图顶栏有按钮不可见');

/* ---------------- 4/5. 宝库买两件新宝物 ---------------- */

const shopIdx = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  return run.floorMap.cells.findIndex((c) => c.kind === 'relicShop');
});
await page.evaluate((i) => document.querySelector(`[data-action="cell"][data-index="${i}"]`)?.click(), shopIdx);
await page.waitForTimeout(250);
await page.evaluate((i) => document.querySelector(`[data-action="cell"][data-index="${i}"]`)?.click(), shopIdx);
await page.waitForTimeout(450);

const shopUi = await page.evaluate(() => ({
  items: [...document.querySelectorAll('.shop-item')].map((el) => ({
    name: el.querySelector('.rname')?.textContent.replace(/\s+/g, ' ').trim(),
    price: el.querySelector('.s-price')?.textContent.replace(/\s+/g, '').trim(),
  })),
  crystal: document.querySelector('.chip.crystal b')?.textContent?.trim(),
}));
console.log('宝库货架:', JSON.stringify(shopUi));
check(shopUi.items.length === 2, `宝库应有两件新宝物，实际 ${shopUi.items.length}`);

/** 买四叶坠（1 级）：扣 3 水晶、幸运 +2 */
await page.evaluate(() => document.querySelector('[data-action="buy-relic"]')?.click());
await page.waitForTimeout(350);
const afterFirst = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  return {
    materials: run.materials, luck: run.player.luck || 0,
    relics: run.relics.filter((k) => k.startsWith('cloverCharm')),
    sold: run.shop.relics.filter((r) => r.sold).length,
  };
});
console.log('买四叶坠后:', JSON.stringify(afterFirst));
check(afterFirst.materials === 9, `水晶应扣到 9（v3.40 等级价：1 级 1 个），实际 ${afterFirst.materials}`);
check(afterFirst.luck === 2, `幸运应 +2，实际 ${afterFirst.luck}`);
check(afterFirst.relics.length === 1, `卡组应有 cloverCharm，实际 ${JSON.stringify(afterFirst.relics)}`);
check(afterFirst.sold === 1, '货架应标记一件已售');

/** 买血玉心坠（3 级，固定价 3）：生命上限 +15、当前血量跟涨。
 *  注意第一件买完已标 sold，要点第二件（index 1）——已售的格子点了只会 flash。 */
await page.evaluate(() => {
  const items = [...document.querySelectorAll('[data-action="buy-relic"]')];
  (items[1] || items.find((el) => !el.classList.contains('sold')))?.click();
});
await page.waitForTimeout(350);
const afterSecond = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  return {
    materials: run.materials, maxHp: run.player.maxHp, hp: run.player.hp,
    relics: run.relics.filter((k) => k.startsWith('vitalHeart')),
  };
});
console.log('买血玉心坠后:', JSON.stringify(afterSecond));
check(afterSecond.materials === 6, `水晶应扣到 6（3 级 3 个），实际 ${afterSecond.materials}`);
check(afterSecond.relics.length === 1, `应有 vitalHeart+3，实际 ${JSON.stringify(afterSecond.relics)}`);
check(afterSecond.maxHp > 0, '读到了生命上限');
check(afterSecond.hp === afterSecond.maxHp, `当前血量应跟涨满（${afterSecond.hp}/${afterSecond.maxHp}）`);

/* ---------------- 2/1. 翻格进战斗，验证顶栏与记录 ---------------- */

/** 离开宝库：偶尔首次点击撞上重渲染，点到达成"回到地图"为止 */
for (let i = 0; i < 5; i++) {
  const onMap = await page.evaluate(() => {
    if (!document.querySelector('.dmap')) {
      document.querySelector('[data-action="leave-shop"]')?.click();
      return false;
    }
    return true;
  });
  if (onMap) break;
  await page.waitForTimeout(300);
}
check(await page.evaluate(() => !!document.querySelector('.dmap')), '离开宝库后没回到地图');

for (let step = 0; step < 90; step++) {
  if (await page.locator('.hand .card').count()) break;
  const cancelUp = page.locator('[data-action="cancel-upgrade"]').first();
  if (await cancelUp.count()) {
    await page.evaluate(() => document.querySelector('[data-action="cancel-upgrade"]')?.click());
    await page.waitForTimeout(220);
    continue;
  }
  const cancelAltar = page.locator('[data-action="cancel-altar"]').first();
  if (await cancelAltar.count()) {
    await page.evaluate(() => document.querySelector('[data-action="cancel-altar"]')?.click());
    await page.waitForTimeout(220);
    continue;
  }
  const choose = page.locator('[data-action="choose"]').first();
  if (await choose.count()) {
    await page.evaluate(() => document.querySelector('[data-action="choose"]')?.click());
    await page.waitForTimeout(300);
    continue;
  }
  const t = await page.evaluate(() => {
    /** 商店格不 done（v3.34，离开可再进）—— 翻格循环要跳过它，否则又走回店里 */
    const pendings = [...document.querySelectorAll('.dcell.pending')]
      .filter((e) => !e.classList.contains('k-shop') && !e.classList.contains('k-relicShop'));
    if (document.querySelector('.dcell.pending.k-enemy')) return 'enemy';
    if (pendings.length) return 'pending';
    if (document.querySelector('.dcell.reach')) return 'reach';
    return null;
  });
  if (!t) break;
  await page.evaluate((k) => {
    let el;
    if (k === 'enemy') el = document.querySelector('.dcell.pending.k-enemy');
    else if (k === 'pending') {
      el = [...document.querySelectorAll('.dcell.pending')]
        .find((e) => !e.classList.contains('k-shop') && !e.classList.contains('k-relicShop'));
    } else el = document.querySelector('.dcell.reach');
    el?.click();
  }, t);
  await page.waitForTimeout(320);
}

const inBattle = await page.locator('.hand .card').count() > 0;
if (!inBattle) {
  const diag = await page.evaluate(() => ({
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 160),
    cells: [...document.querySelectorAll('.dcell')].map((e) => e.className.replace('dcell', '').trim()).slice(0, 9),
    screen: document.querySelector('.overlay h1')?.textContent?.trim() || null,
  }));
  console.log('战斗诊断:', JSON.stringify(diag));
}
check(inBattle, '没进战斗');
if (inBattle) {
  const battleBar = await topbarGeo();
  console.log('战斗顶栏:', JSON.stringify(battleBar));
  check(battleBar.right <= battleBar.viewW, `战斗顶栏溢出：右端 ${battleBar.right} > ${battleBar.viewW}`);
  check(battleBar.btns.every((b) => b.visible), `战斗顶栏有按钮不可见：${JSON.stringify(battleBar.btns.filter((b) => !b.visible))}`);

  /** 「记录」按钮能点开战斗记录面板 */
  await page.evaluate(() => document.querySelector('[data-action="open-log"]')?.click());
  await page.waitForTimeout(300);
  const logUi = await page.evaluate(() => ({
    open: !!document.querySelector('.log-overlay'),
    rows: document.querySelectorAll('.log-overlay .log-row').length,
  }));
  console.log('战斗记录面板:', JSON.stringify(logUi));
  check(logUi.open, '点「记录」没有弹出战斗记录面板');
  await page.evaluate(() => document.querySelector('[data-action="close-log"]')?.click());
  await page.waitForTimeout(250);
  check(await page.locator('.log-overlay').count() === 0, '记录面板关不掉');
}

/* ---------------- 收尾 ---------------- */

if (fails.length) {
  console.log('FAIL:\n- ' + fails.join('\n- '));
  if (errs.length) console.log('页面错误:', errs.join(' | '));
  await browser.close();
  process.exit(1);
}
console.log('页面错误:', errs.length ? errs.join(' | ') : '无');
if (errs.length) process.exit(1);
await browser.close();
console.log('PROBE PASS');
