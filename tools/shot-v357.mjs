/**
 * v3.57 探针：招募点名册外的候选人也能看全属性。
 *
 * 用户：「招募的时候应该可以点击种族头像查看当前出来的全部属性值」。
 * 大厅候选人卡片只显示 生命/攻击 + 非零属性，掷点、知识、幸运都看不到 ——
 * 现在点种族头像开属性面板（9 行 + 种族/职业天赋 + 每级成长）。
 *
 * 断言：头像可点开面板 / 9 行齐全 / 数值与 candidate 对拍 / 天赋两块 /
 *       页脚含每级成长 / 点空白能关 / 换人后面板不残留。
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const ok = (c, m) => console.log(c ? 'OK ' : 'ERR', m);
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

// 招一位候选人（不雇，留在招募槽里）
await page.locator('[data-action="recruit"]').first().click();
await page.waitForTimeout(350);

ok(await page.locator('.cand-face .face-more').count() === 1, '头像上有「属性」可点角标');

// ① 点头像开面板
await page.locator('.cand-face').click();
await page.waitForTimeout(300);
const panel = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const ch = save.loadMeta().candidate;
  const rows = [...document.querySelectorAll('.stats-panel .sp-row')].map((r) => ({
    name: r.querySelector('.sp-key b')?.textContent,
    val: r.querySelector('.sp-key i')?.textContent,
  }));
  return {
    open: !!document.querySelector('.stats-panel'),
    head: document.querySelector('.stats-panel .sp-head')?.innerText.replace(/\n/g, ' · '),
    rows,
    talents: [...document.querySelectorAll('.stats-panel .sp-t-row i')].map((e) => e.textContent),
    foot: document.querySelector('.stats-panel .sp-foot')?.textContent.trim(),
    cand: ch && {
      name: ch.name, maxHp: ch.maxHp, atk: ch.atk, def: ch.def, crit: ch.crit,
      dodge: ch.dodge, recovery: ch.recovery, knowledge: ch.knowledge, luck: ch.luck,
    },
  };
});
ok(panel.open, `点头像开出了属性面板（${panel.head}）`);
ok(panel.rows.length === 9, `9 行属性齐全（${panel.rows.map((r) => `${r.name}=${r.val}`).join(' ')}）`);

const c = panel.cand;
/** 面板里的百分比不带 %（数值就是点数，说明行写 +1%/点），所以统一按数字比 */
const expect = { 生命上限: c.maxHp, 攻击力: c.atk, 防御: c.def, 暴击: c.crit, 闪避: c.dodge, 恢复: c.recovery, 知识: c.knowledge, 幸运: c.luck };
const bad = [];
for (const [name, v] of Object.entries(expect)) {
  const row = panel.rows.find((r) => r.name === name);
  if (!row) { bad.push(`${name} 缺行`); continue; }
  const got = Number(String(row.val).replace('%', ''));
  if (got !== Number(v)) bad.push(`${name} 显示 ${row.val}，候选人是 ${v}`);
}
ok(bad.length === 0, `数值与候选人对象一致${bad.length ? `（${bad.join('；')}）` : ''}`);
ok(panel.talents.length === 2, `天赋两块（${panel.talents.join(' / ')}）`);
ok(/每级成长/.test(panel.foot || ''), `页脚有每级成长：「${panel.foot}」`);

await page.screenshot({ path: 'tools/probe/shot-v357-cand-stats.png' });

// ② 点空白关
await page.mouse.click(195, 20);
await page.waitForTimeout(250);
ok(await page.locator('.stats-panel').count() === 0, '点空白处关掉面板');

// ③ 换一位候选人：面板不残留、换完再点开还是 9 行
await page.locator('[data-action="refresh"]').click();
await page.waitForTimeout(350);
ok(await page.locator('.stats-panel').count() === 0, '换人后没有残留面板');
await page.locator('.cand-face').click();
await page.waitForTimeout(250);
ok(await page.locator('.stats-panel .sp-row').count() === 9, '新候选人照样 9 行');

await browser.close();
console.log('ALL PASS');
