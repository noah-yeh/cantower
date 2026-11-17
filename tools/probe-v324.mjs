/**
 * 探针 v3.24：打击职业化（GAME_DESIGN §4.16）
 *
 * 要确认四件事：
 *   1. 招募 → 探险 → 进战斗这条路没被改崩（无 pageerror）
 *   2. 战斗手牌里「打击」的卡面写的是**本职业**的效果
 *      （战士带甲 / 旅行家带毒 / 法师猎人只多伤害）
 *   3. 背包点开打击，文案与战斗卡面同口径
 *   4. 界面没有溢出或挤压
 */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
let errors = 0;
page.on('pageerror', (e) => { errors++; console.log('[pageerror]', e.message); });

await page.goto('http://127.0.0.1:4182/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

await page.locator('[data-action="recruit"]').first().click();
await page.waitForTimeout(300);
const hire = page.locator('[data-action="hire"]').first();
if (await hire.count()) { await hire.click(); await page.waitForTimeout(400); }

await page.locator('[data-action="open-expedition"]').first().click();
await page.waitForTimeout(300);
await page.locator('[data-action="explore"]').first().click();
await page.waitForTimeout(600);

/** 关掉首次引导 */
const ok = page.locator('.maze-guide button[data-action="maze-guide-ok"]');
if (await ok.count()) { await ok.click(); await page.waitForTimeout(250); }

/** 顶栏拿到「职业 · 种族」 */
const top = (await page.locator('.top-right').first().innerText()).replace(/\s+/g, ' ');
console.log('① 本次角色:', top);

/**
 * 翻格直到进战斗。
 * 中途可能翻到宝箱/事件/商店 —— 遇到浮层就点它的主按钮（继续/关闭），
 * 这不是本探针要测的东西，走过去就行。
 */
async function walkToBattle(max = 24) {
  for (let i = 0; i < max; i++) {
    if (await page.locator('.hand .card').count()) return true;
    // 三选一：随便拿一张走人
    const choose = page.locator('.overlay [data-action="choose"]').first();
    if (await choose.count()) { await choose.click(); await page.waitForTimeout(300); continue; }
    // 强化祭坛：放弃
    const cancel = page.locator('.overlay [data-action="cancel-upgrade"]').first();
    if (await cancel.count()) { await cancel.click(); await page.waitForTimeout(300); continue; }
    // 敌人格优先；先翻暗格（楼梯 pending 会因"敌人未清"被拒，先点它会死锁）
    const enemyCell = page.locator('.dcell.pending.k-enemy');
    if (await enemyCell.count()) { await enemyCell.first().click(); await page.waitForTimeout(320); continue; }
    const reach = page.locator('.dcell.reach');
    if (await reach.count()) { await reach.first().click(); await page.waitForTimeout(320); continue; }
    // 已翻开未触发的格（两段式的第二下）
    const pending = page.locator('.dcell.pending');
    if (await pending.count()) { await pending.first().click(); await page.waitForTimeout(320); continue; }
    break;
  }
  return !!(await page.locator('.hand .card').count());
}

const inBattle = await walkToBattle();
console.log('①b 进入战斗:', inBattle ? 'PASS' : 'FAIL');

/** ② 手牌里所有打击的卡面 */
const strikeTexts = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('.hand .card')) {
    const name = el.querySelector('.cname')?.textContent?.trim() ?? '';
    const body = el.innerText.replace(/\s+/g, ' ').trim();
    if (name.includes('打击')) out.push(body);
  }
  return out;
});
console.log('② 手牌打击卡面:', strikeTexts.length ? strikeTexts.join(' | ') : '（本手没有打击）');

/** 按职业判断注脚对不对 */
const needArmor = top.includes('战士');
const needPoison = top.includes('旅行家');
const joined = strikeTexts.join(' ');
const noteOk = strikeTexts.length === 0
  ? true
  : (needArmor ? joined.includes('护甲') : true) && (needPoison ? joined.includes('中毒') : true)
    && (!needArmor && !needPoison ? !joined.includes('护甲') && !joined.includes('中毒') : true);
console.log('②b 注脚与职业一致:', noteOk ? 'PASS' : 'FAIL', `(战士=${needArmor}, 旅行家=${needPoison})`);

await page.screenshot({ path: 'tools/.v324-battle.png' });

/** ③ 背包：点开打击看是否同一套文案 */
if (inBattle) {
  const bagBtn = page.locator('[data-action="open-bag-run"]').first();
  if (await bagBtn.count()) {
    await bagBtn.click();
    await page.waitForTimeout(350);
    const dc = page.locator('button.dc', { hasText: '打击' }).first();
    if (await dc.count()) {
      await dc.click();
      await page.waitForTimeout(300);
      const bagText = await page.locator('.bcd-text').first().innerText();
      console.log('③ 背包打击文案:', bagText.replace(/\s+/g, ' '));
      const bagOk = (needArmor ? bagText.includes('护甲') : true)
        && (needPoison ? bagText.includes('中毒') : true)
        && (!needArmor && !needPoison ? !bagText.includes('护甲') && !bagText.includes('中毒') : true);
      console.log('③b 背包与职业一致:', bagOk ? 'PASS' : 'FAIL');
      await page.screenshot({ path: 'tools/.v324-bag.png' });
    }
  }
}

/** ④ 溢出与报错 */
const overflow = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 2);
console.log('④ 无溢出:', !overflow ? 'PASS' : 'FAIL', '| 无运行时错误:', errors === 0 ? 'PASS' : `FAIL(${errors})`);

await browser.close();
