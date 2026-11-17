/**
 * 探针 v3.15：战斗页的连携角标
 *
 * 三件事必须一眼可见：
 *   1. 卡面多了一条"每点护甲额外 +0.3"的说明（不再是纯伤害数字）
 *   2. 左上角挂着「连携」角标
 *   3. 条件满足时角标变金、卡框也亮起来（这里用「举盾 → 重砸」验证）
 */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://127.0.0.1:4182/', { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

await page.locator('[data-action="recruit"]').first().click();
await page.waitForTimeout(300);
const hire = page.locator('[data-action="hire"]').first();
if (await hire.count()) { await hire.click(); await page.waitForTimeout(300); }
await page.locator('[data-action="open-expedition"]').first().click();
await page.waitForTimeout(300);
await page.locator('[data-action="explore"]').first().click();
await page.waitForTimeout(500);

/** 把卡组换成"举盾 ×5 + 重砸 ×5"，保证这场能看到连携牌 */
await page.evaluate(() => {
  const raw = localStorage.getItem('ruin-spire/run');
  const run = JSON.parse(raw);
  run.deck = ['w_shieldUp', 'w_shieldUp', 'w_shieldUp', 'w_slam', 'w_slam', 'w_slam', 'w_slam', 'guard', 'guard', 'strike'];
  localStorage.setItem('ruin-spire/run', JSON.stringify(run));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);

/** 进第一场战斗：翻到敌人为止 */
for (let i = 0; i < 12; i++) {
  if (await page.locator('.hand').count()) break;
  const reach = page.locator('.dcell.reach');
  const pending = page.locator('.dcell.pending');
  if (await pending.count()) await pending.first().click();
  else if (await reach.count()) await reach.first().click();
  else break;
  await page.waitForTimeout(300);
}

const state = await page.evaluate(() => ({
  inBattle: !!document.querySelector('.hand'),
  cards: [...document.querySelectorAll('.card')].map((el) => ({
    name: el.querySelector('.cname')?.textContent?.trim(),
    combo: el.querySelector('.ccombo')?.textContent?.trim() || null,
    on: el.classList.contains('combo-on'),
    text: el.querySelector('.ctext')?.textContent?.trim(),
    overflow: el.scrollHeight > el.clientHeight + 2,
  })),
}));
console.log(JSON.stringify(state, null, 1));
await page.screenshot({ path: 'tools/.v315-battle.png' });

/** 打一张举盾（叠甲），再看重砸是否点亮 */
const shield = page.locator('.card', { hasText: '举盾' }).first();
if (await shield.count()) {
  await shield.click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const slam = [...document.querySelectorAll('.card')].find((el) => el.querySelector('.cname')?.textContent?.includes('重砸'));
    return slam
      ? { combo: slam.querySelector('.ccombo')?.textContent?.trim(), on: slam.classList.contains('combo-on') }
      : null;
  });
  console.log('打了一张举盾之后的重砸:', JSON.stringify(after));
  await page.screenshot({ path: 'tools/.v315-battle-combo.png' });
}

await browser.close();
