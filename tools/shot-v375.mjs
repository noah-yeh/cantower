/**
 * v3.75 探针：详情页三轮微调（v3.76 起同步「属性入口在第一格 + 方案 A」。
 *
 * 用户：「两边还是有黑边；属性的感叹号放到后面去；已转正下面的竞技场次数
 * 不用展示，竞技场直接在竞技场那边才能参与」。
 *
 * 检查：
 *   ① 430 / 480 宽屏下 hp-box 铺满 #app（无左右黑边）；
 *   ② ❗属性 入口文字是「属性❗」（感叹号在后面）；
 *   ③ 转正角色详情：动作区为空、全页搜不到「额度」与「竞技场 · N/M」，
 *     属性蒙板里保留评级 / 战绩；
 *   ④ 属性蒙板照常开合。
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const ok = (c, m) => console.log(c ? 'OK ' : 'ERR', m);

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });

async function seed(page) {
  await page.evaluate(async () => {
    const meta = await import('/src/core/meta.js');
    const roster = await import('/src/core/roster.js');
    const save = await import('/src/core/save.js');
    const m = meta.createMeta(20261111);
    const a = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 3 });
    a.status = 'idle';
    const b = roster.createCharacter({ classId: 'mage', raceId: 'ember', seed: 4 });
    b.status = 'idle'; b.veteran = true;
    b.record.arenaWins = 2; b.record.arenaLosses = 1;
    m.roster = [a, b];
    save.saveMeta(m);
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
}

for (const w of [390, 430, 480]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: 2 })).newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await seed(page);
  await page.locator('[data-action="open-expedition"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('.ex-card').first().click();
  await page.waitForTimeout(400);

  const geo = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    const ov = r('.hero-page'), bx = r('.hp-box'), app = r('#app');
    return {
      ov: ov && { x: Math.round(ov.x), w: Math.round(ov.width) },
      bx: bx && { x: Math.round(bx.x), w: Math.round(bx.width) },
      appW: Math.round(app.width),
    };
  });
  ok(geo.ov && geo.bx && geo.ov.x === geo.bx.x && geo.ov.w === geo.bx.w,
    `[${w}宽] hp-box 铺满 overlay（box x=${geo.bx?.x} w=${geo.bx?.w}，overlay x=${geo.ov?.x} w=${geo.ov?.w}）`);
  await page.close();
}

{
  const page = await (await browser.newContext({ viewport: { width: 430, height: 860 }, deviceScaleFactor: 2 })).newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await seed(page);

  /* ② 实习生详情：属性入口 = 数值条第一格（方案 A：金盾图标，无感叹号） */
  await page.locator('[data-action="open-expedition"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('.ex-card').first().click();
  await page.waitForTimeout(400);
  const entry = await page.evaluate(() => {
    const b = document.querySelector('.hp-v-attrs');
    const kids = [...document.querySelectorAll('.hero-page .hp-vitals > *')];
    return {
      text: b?.textContent.replace(/\s+/g, ' ').trim(),
      html: b?.innerHTML,
      first: kids[0]?.classList.contains('hp-v-attrs'),
      order: kids.map((k) => k.textContent.replace(/\s+/g, ' ').trim().slice(0, 4)),
      shield: !!b?.querySelector('svg'),
      bg: b ? getComputedStyle(b).backgroundImage === getComputedStyle(document.querySelector('.hp-v.hp')).backgroundImage : null,
    };
  });
  ok(entry.first, `属性入口在数值条第一格（${entry.order.join(' | ')}）`);
  ok(/^属性 ?›$/.test(entry.text), `入口文字是「属性 ›」（可点暗示箭头）（${entry.text}）`);
  ok(entry.shield, '图标是内联 SVG 盾牌');
  ok(entry.bg, '底色与生命/攻击/能量同款（方案 A 隐入同排）');
  const fill = await page.evaluate(() => {
    const grid = document.querySelector('.hp-deck-cards');
    const cs = getComputedStyle(grid);
    const cols = cs.gridTemplateColumns.split(' ').length;
    const maxR = Math.max(...[...grid.children].map((c) => c.getBoundingClientRect().right));
    return { display: cs.display, cols, maxR: Math.round(maxR), gridR: Math.round(grid.getBoundingClientRect().right) };
  });
  ok(fill.display === 'grid', '牌库是自适应网格（repeat(auto-fill, minmax(88px,1fr))）');
  ok(Math.abs(fill.maxR - fill.gridR) <= 2,
    `满行卡牌右缘贴齐网格右缘（卡 ${fill.maxR} vs 网格 ${fill.gridR}，${fill.cols} 列）`);

  await page.locator('.hero-page .hp-close').click();
  await page.waitForTimeout(300);

  /* ③④ 转正角色详情 */
  await page.locator('[data-action="back-hall"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('[data-action="open-arena"]').first().click();
  await page.waitForTimeout(350);
  await page.locator('.ex-card').first().click();
  await page.waitForTimeout(400);

  const vet = await page.evaluate(() => {
    const acts = [...document.querySelectorAll('.hero-page .hp-acts button')].map((b) => b.textContent.trim());
    const text = document.querySelector('.hero-page .hp-box').textContent;
    return {
      acts,
      hasQuota: /额度|恢复中|竞技场 · \d/.test(text),
      hasRating: text.includes('评级'),
      hasRecord: text.includes('2胜1负'),
      sub: document.querySelector('.hero-page .hp-sub')?.textContent.trim(),
    };
  });
  ok(vet.acts.length === 0, `转正动作区为空（${vet.acts.join(',')}）`);
  ok(!vet.hasQuota, '全页没有竞技场额度 / 次数');

  await page.locator('.hp-v-attrs').click();
  await page.waitForTimeout(300);
  const mask = await page.evaluate(() => ({
    open: !!document.querySelector('.hp-attrs-mask'),
    text: document.querySelector('.hp-attrs-box')?.textContent.replace(/\s+/g, ' ').trim(),
  }));
  ok(mask.open, '属性蒙板照常打开');
  ok(mask.text.includes('评级') && mask.text.includes('2胜1负'), `蒙板保留 评级 + 战绩（${mask.text.slice(0, 80)}）`);
  ok(!/额度|恢复中/.test(mask.text), '蒙板里也没有额度 / 恢复倒计时');
  await page.screenshot({ path: 'tools/probe/v375-veteran.png' });
  await page.close();
}

await browser.close();
console.log('done');
