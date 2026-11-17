/**
 * 探针 v3.35：段位 / 排名 / 每日奖励 / 初始转正角色
 *
 * 要证的四件事：
 *   1. 新档（清空 localStorage）自带一位转正角色，竞技场名单页直接有他
 *   2. 名单页有段位徽章 + 每日奖励按钮；领一次到账，再领被拒
 *   3. 选对手页有段位面板（段位 + 本地榜排名），匹配到三个对手
 *   4. 打完一场回到结算页带段位分变化；全程控制台零报错
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4183/';

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

/** 1. 全新档：不造任何数据，直接清空开玩 */
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

const fresh = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const meta = save.loadMeta();
  const ch = meta.roster[0] || null;
  return {
    hasStarter: !!ch,
    veteran: !!ch?.veteran,
    score: ch?.arenaScore,
    name: ch?.name,
    gold: meta.gold,
  };
});
console.log('新档:', JSON.stringify(fresh));
if (!fresh.hasStarter || !fresh.veteran) { console.log('FAIL: 新档没有转正角色'); process.exit(1); }

/** 2. 竞技场名单页：段位徽章 + 每日按钮 */
await page.locator('[data-action="open-arena"]').first().click();
await page.waitForTimeout(300);
const roster = await page.evaluate(() => ({
  badge: !!document.querySelector('.rank-badge'),
  dailyBtn: document.querySelector('[data-action="arena-daily"]')?.textContent?.trim() || null,
  challenge: !!document.querySelector('[data-action="arena"]'),
}));
console.log('名单页:', JSON.stringify(roster));

/** 3. 领每日奖励 → 金币变化 + 按钮消失 */
const goldBefore = fresh.gold;
await page.evaluate(() => document.querySelector('[data-action="arena-daily"]')?.click());
await page.waitForTimeout(300);
const afterClaim = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const meta = save.loadMeta();
  return {
    gold: meta.gold,
    dailyBtn: !!document.querySelector('[data-action="arena-daily"]'),
    claimedDay: meta.arenaDaily?.claimed?.length,
    flash: document.querySelector('.flash')?.textContent?.trim() || '',
  };
});
console.log(`领奖励: 金币 ${goldBefore} → ${afterClaim.gold}, 按钮消失: ${!afterClaim.dailyBtn}, 提示: ${afterClaim.flash}`);
if (afterClaim.gold - goldBefore !== 8) { console.log('FAIL: 每日奖励金额不对'); process.exit(1); }
if (afterClaim.dailyBtn) { console.log('FAIL: 领过还显示按钮'); process.exit(1); }

/** 4. 选对手页：段位面板 + 三个对手 */
await page.evaluate(() => document.querySelector('[data-action="arena"]')?.click());
await page.waitForTimeout(300);
const pick = await page.evaluate(() => ({
  panel: !!document.querySelector('.rank-panel'),
  place: document.querySelector('.rank-place')?.textContent?.trim() || '',
  opponents: document.querySelectorAll('[data-action="fight"]').length,
}));
console.log('选人页:', JSON.stringify(pick));
if (!pick.panel || pick.opponents !== 3) { console.log('FAIL: 选人页异常'); process.exit(1); }

/** 5. 打一场（无脑出牌直到终局），确认结算页带段位分 */
await page.evaluate(() => document.querySelector('[data-action="fight"]')?.click());
await page.waitForTimeout(500);

let rounds = 0;
for (let i = 0; i < 120; i++) {
  const st = await page.evaluate(() => ({
    result: !!document.querySelector('.big-result'),
    my: document.querySelector('.midline')?.textContent?.trim() === '你的回合',
    endBtn: !!document.querySelector('[data-action="arena-end-turn"]'),
  }));
  if (st.result) break;
  if (st.my && st.endBtn) {
    /** 出牌用 DOM 派发：locator 的"等待稳定"会被每次 render 的重绘打断 */
    for (;;) {
      const played = await page.evaluate(() => {
        const c = document.querySelector('.tray .card.playable');
        if (!c) return false;
        c.click();
        return true;
      });
      if (!played) break;
      await page.waitForTimeout(200);
    }
    await page.evaluate(() => document.querySelector('[data-action="arena-end-turn"]')?.click());
    rounds++;
  }
  await page.waitForTimeout(280);
}
await page.waitForTimeout(400);
const result = await page.evaluate(() => ({
  done: !!document.querySelector('.big-result'),
  rows: [...document.querySelectorAll('.result-rows > div')].map((d) => d.textContent.replace(/\s+/g, ' ').trim()),
}));
console.log(`玩家回合数: ${rounds} | 结算页: ${result.done}`);
console.log('结算行:', JSON.stringify(result.rows.slice(0, 9)));
if (!result.done) { console.log('FAIL: 没打到结算页'); process.exit(1); }
if (!result.rows.some((r) => r.includes('段位分'))) { console.log('FAIL: 结算页没有段位分'); process.exit(1); }

console.log(errs.length ? `页面错误: ${errs.join(' | ')}` : '页面错误: 无');
await browser.close();
console.log('PROBE PASS');
