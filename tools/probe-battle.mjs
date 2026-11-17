/**
 * 临时探针：进一场战斗，出一张牌，连拍几帧看有没有飘字/动效。
 * 用法：node tools/probe-battle.mjs
 */
import { chromium } from 'playwright-core';

const OUT = 'tools/.probe';
const URL = 'http://127.0.0.1:4182/';

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('console', (m) => console.log('[console]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);

// 招募到有角色
for (let i = 0; i < 3; i++) {
  const btn = page.locator('[data-action="recruit"]').first();
  if (await btn.count()) {
    await btn.click().catch(() => {});
    await page.waitForTimeout(400);
  }
}
await page.screenshot({ path: `${OUT}-0-hall.png` });

// 出发
const exp = page.locator('[data-action="explore"]').first();
if (await exp.count()) {
  await exp.click().catch(() => {});
  await page.waitForTimeout(500);
}

// 地图：翻格 → 触发，直到进战斗
for (let step = 0; step < 90; step++) {
  if (await page.locator('.hand .card').count()) break;
  const cancelUp = page.locator('[data-action="cancel-upgrade"]').first();
  if (await cancelUp.count()) {
    await cancelUp.click().catch(() => {});
    await page.waitForTimeout(250);
    continue;
  }
  // 已翻开、能触发、还是敌人 → 直接开战
  const foe = page.locator('.dcell.reach.k-enemy').first();
  if (await foe.count()) {
    await foe.click().catch(() => {});
    await page.waitForTimeout(400);
    continue;
  }
  const pend = page.locator('.dcell.pending').first();
  if (await pend.count()) {
    await pend.click().catch(() => {});
    await page.waitForTimeout(350);
    continue;
  }
  const reach = page.locator('.dcell.reach').first();
  if (await reach.count()) {
    await reach.click().catch(() => {});
    await page.waitForTimeout(250);
  } else break;
}
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}-1-battle.png` });
console.log('cards:', await page.locator('.hand .card').count());

const card = page.locator('.hand .card.playable').first();
if (!(await card.count())) {
  console.log('没有可出的牌');
  await browser.close();
  process.exit(0);
}
const name = (await card.locator('.cname').innerText()).trim();
console.log('出牌:', name);

// 记录 DOM 里 float / 受击 class 的出现
await page.evaluate(() => {
  window.__floats = [];
  window.__hits = [];
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList?.contains('float-layer')) {
          window.__floats.push({ at: performance.now(), childs: n.children.length });
        }
      }
      if (m.type === 'attributes' && m.target.classList?.contains('hit')) {
        window.__hits.push(m.target.className);
      }
    }
  });
  mo.observe(document.querySelector('#app'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
});

for (let round = 0; round < 3; round++) {
  const card = page.locator('.hand .card.playable').first();
  if (!(await card.count())) break;
  const name = (await card.locator('.cname').innerText()).trim();
  console.log(`\n=== 第 ${round + 1} 张: ${name}`);

  // 出牌瞬间（动画进行中）截一帧
  await card.click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}-2-play-${round}a.png` });
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${OUT}-2-play-${round}b.png` });

  const info = await page.evaluate(() => ({
    floats: window.__floats.splice(0),
    hits: window.__hits.splice(0),
    live: [...document.querySelectorAll('.float')].map((c) => ({ t: c.textContent, cls: c.className })),
    bars: [...document.querySelectorAll('.hpbar')].map((b) => ({
      cls: b.className,
      w: b.querySelector('.fill')?.style.width,
    })),
    zones: [...document.querySelectorAll('.enemy-zone,.player-zone')].map((z) => z.className),
  }));
  console.log('  ', JSON.stringify(info));
  await page.waitForTimeout(700);
  // 敌人回合结算完再继续
  const endTurn = page.locator('[data-action="end-turn"]').first();
  if (await page.locator('.hand .card.playable').count() === 0) {
    if (await endTurn.count()) {
      await endTurn.click().catch(() => {});
      await page.waitForTimeout(600);
      const info2 = await page.evaluate(() => ({
        hits: window.__hits.splice(0),
        live: [...document.querySelectorAll('.float')].map((c) => ({ t: c.textContent, cls: c.className })),
      }));
      console.log('  结束回合后:', JSON.stringify(info2));
      await page.waitForTimeout(600);
    }
  }
  if (await page.locator('.hand .card').count() === 0) break;
}

await browser.close();
