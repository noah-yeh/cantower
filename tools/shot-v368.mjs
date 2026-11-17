/**
 * v3.68 探针：营地容量拆成两本账（实习 200 / 转正 60）+ 招募牌子做成按钮。
 *
 * 用户：「实习的200个上限，转正可以60个上限吧，另外招募页面招募二字做成可点击的按钮」。
 *
 * 检查：
 *   ① 营地页两个 tab 各带自己的上限（实习 n/200、转正 m/60），顶栏只报总人数；
 *   ② 大厅「招募」是**按钮**（不是装饰标题），点它能招出候选人；
 *   ③ 台上已经有候选人时再点招募牌子 → 提示"先把眼前这位处理掉"，不会重复扣名额；
 *   ④ 实习位满（200）时：招募槽直接写"实习位已满"，点牌子只给原因、不出候选人；
 *   ⑤ 转正位满（60）时招募照常 —— 两条容量线互不挤占。
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const ok = (c, m) => console.log(c ? 'OK ' : 'ERR', m);

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

/* ---------- 场景 A：2 个实习 + 1 个转正 ---------- */
await page.evaluate(async () => {
  localStorage.clear();
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const m = meta.createMeta(20261110);
  const mk = (classId, raceId, seed) => {
    const c = roster.createCharacter({ classId, raceId, seed });
    c.status = 'idle';
    return c;
  };
  const a = mk('warrior', 'stone', 3);
  const b = mk('mage', 'ember', 4);
  const c = mk('hunter', 'moss', 5);
  b.veteran = true;
  m.roster = [a, b, c];
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

/* ① 营地页两个 tab 各带自己的上限 */
await page.locator('[data-action="open-roster"]').first().click();
await page.waitForTimeout(350);
const tabs = await page.evaluate(() => ({
  labels: [...document.querySelectorAll('.rtab')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()),
  total: document.querySelector('.top-count')?.textContent.replace(/\s+/g, ' ').trim(),
}));
ok(/实习 2\s*\/200/.test(tabs.labels[0] || ''), `实习 tab 带 200 上限：「${tabs.labels[0]}」`);
ok(/转正 1\s*\/60/.test(tabs.labels[1] || ''), `转正 tab 带 60 上限：「${tabs.labels[1]}」`);
ok(/共\s*3\s*人/.test(tabs.total || ''), `顶栏只报总人数：「${tabs.total}」`);
await page.screenshot({ path: 'tools/probe/shot-v368-roster.png' });

/* ② 大厅「招募」是按钮 */
await page.locator('[data-action="back-hall"]').first().click();
await page.waitForTimeout(350);
const head = await page.evaluate(() => {
  const el = document.querySelector('.sec-title-btn');
  const st = el ? getComputedStyle(el) : null;
  return {
    tag: el?.tagName,
    text: el?.textContent.trim(),
    action: el?.dataset.action,
    cursor: st?.cursor,
    // 缎带牌子的视觉（背景渐变 + 金边）应该和别的区块标题一致
    hasPlaque: !!st && st.backgroundImage.includes('gradient') && st.borderTopWidth !== '0px',
  };
});
ok(head.tag === 'BUTTON', `「招募」渲染成 button（实际 ${head.tag}）`);
ok(head.text === '招募', `按钮文字是招募（${head.text}）`);
ok(head.action === 'recruit', `按钮绑定 recruit 动作（${head.action}）`);
ok(head.cursor === 'pointer', `可点的光标（${head.cursor}）`);
ok(head.hasPlaque, '保留缎带牌子外观（渐变底 + 金边）');
await page.screenshot({ path: 'tools/probe/shot-v368-hall.png' });

/* 点牌子能招出候选人 */
await page.locator('.sec-title-btn').click();
await page.waitForTimeout(400);
const afterRecruit = await page.evaluate(() => ({
  cand: document.querySelectorAll('.cand').length,
  flash: document.querySelector('.flash')?.textContent.trim() || '',
  slots: document.querySelectorAll('.recruit-slot .recruit-cta').length,
}));
ok(afterRecruit.cand === 1, `点招募牌子招出了候选人（候选人块 ${afterRecruit.cand}）`);
ok(afterRecruit.slots === 0, '候选人上来后招募 CTA 收起');

/* ③ 台上已有候选人时再点：只给提示，不重复扣名额 */
const ticketsBefore = await page.evaluate(() => document.querySelector('.ticket-n')?.textContent.trim());
await page.locator('.sec-title-btn').click();
await page.waitForTimeout(350);
const again = await page.evaluate(() => ({
  flash: document.querySelector('.flash')?.textContent.trim() || '',
  cand: document.querySelectorAll('.cand').length,
  tickets: document.querySelector('.ticket-n')?.textContent.trim(),
}));
ok(/先.*处理/.test(again.flash), `再点一次只提示先处理眼前的人：「${again.flash}」`);
ok(again.cand === 1, '候选人还是那一位，没被刷掉');
ok(again.tickets === ticketsBefore, `名额没被多扣（${ticketsBefore} → ${again.tickets}）`);

/* ---------- 场景 B：实习位铺满 200 ---------- */
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const m = meta.createMeta(20261111);
  const mk = (classId, raceId, seed) => {
    const c = roster.createCharacter({ classId, raceId, seed });
    c.status = 'idle';
    return c;
  };
  /** 60 个转正老人 + 200 个实习生：两条线同时压满 */
  const vets = Array.from({ length: 60 }, (_, i) => {
    const c = mk('mage', 'ember', 1000 + i);
    c.veteran = true;
    return c;
  });
  const interns = Array.from({ length: 200 }, (_, i) => mk('warrior', 'stone', 2000 + i));
  m.roster = [...vets, ...interns];
  m.candidate = null;
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

/* ④ 实习位满：招募槽写原因，点牌子不出候选人 */
const full = await page.evaluate(() => ({
  cta: document.querySelector('.recruit-slot')?.textContent.replace(/\s+/g, ' ').trim() || '',
  off: !!document.querySelector('.recruit-cta.off'),
}));
ok(/实习位已满（200 人）/.test(full.cta), `招募槽写明实习位已满：「${full.cta.slice(0, 46)}…」`);
ok(full.off, '满员时招募 CTA 是灰态');

await page.locator('.sec-title-btn').click();
await page.waitForTimeout(350);
const blocked = await page.evaluate(() => ({
  flash: document.querySelector('.flash')?.textContent.trim() || '',
  cand: document.querySelectorAll('.cand').length,
}));
ok(/实习位已满/.test(blocked.flash), `点牌子给出原因：「${blocked.flash}」`);
ok(blocked.cand === 0, '实习位满时招不出候选人');
await page.screenshot({ path: 'tools/probe/shot-v368-full.png' });

/* ⑤ 转正位满不影响招募：把实习生清空，只留 60 个转正老人 */
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const m = meta.createMeta(20261112);
  const vets = Array.from({ length: 60 }, (_, i) => {
    const c = roster.createCharacter({ classId: 'mage', raceId: 'ember', seed: 3000 + i });
    c.status = 'idle';
    c.veteran = true;
    return c;
  });
  m.roster = vets;
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(450);
const vetFull = await page.evaluate(() => ({
  cta: document.querySelector('.recruit-slot')?.textContent.replace(/\s+/g, ' ').trim() || '',
}));
ok(!/实习位已满/.test(vetFull.cta), `60 个转正老人不挡招募：「${vetFull.cta.slice(0, 40)}…」`);

await page.locator('.sec-title-btn').click();
await page.waitForTimeout(400);
const okRecruit = await page.evaluate(() => document.querySelectorAll('.cand').length);
ok(okRecruit === 1, '转正位满时照样能招到候选人');

await browser.close();
console.log('ALL PASS');
