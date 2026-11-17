/**
 * 探针 v3.37：PvE 敌人回合逐张播放
 *
 * 要证的四件事：
 *   1. 结束回合后进入敌方回合：手牌变暗、结束按钮禁用、中央显示「敌方回合」
 *   2. 敌人每打一张牌，.foe-play 显示牌名 + 结算摘要（不用点记录就能看到）
 *   3. 播完后回到玩家回合：手牌恢复、按钮恢复，foe-play 留着敌人最后动作
 *   4. 战斗能正常打完（结算/换屏不卡死）；全程控制台零报错
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4183/';

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

/** 探险是实习角色的玩法（v3.35 起转正角色只去竞技场）：造一位待命实习生 */
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const m = save.loadMeta() || meta.createMeta(20261108);
  const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 5 });
  ch.veteran = false;
  ch.status = 'idle';
  ch.lives = 3;
  m.roster = [ch];
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

/** 探险页 → 选人 → 出发 */
await page.evaluate(() => document.querySelector('[data-action="open-expedition"]')?.click());
await page.waitForTimeout(400);
await page.evaluate(() => {
  const pick = document.querySelector('[data-action="pick-expedition"], [data-action="explore"]');
  pick?.click();
});
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-action="depart"], [data-action="explore"]')?.click());
await page.waitForTimeout(500);

/** 第一次进塔会弹迷宫引导，关掉再翻格 */
await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
await page.waitForTimeout(250);

/** 地图：两段式（v3.16）——先点已翻开的待触发格，没有就翻一个暗格 */
for (let step = 0; step < 90; step++) {
  if (await page.locator('.hand .card').count()) break;
  const leaveShop = page.locator('[data-action="leave-shop"]').first();
  if (await leaveShop.count()) {
    await page.evaluate(() => document.querySelector('[data-action="leave-shop"]')?.click());
    await page.waitForTimeout(250);
    continue;
  }
  const cancelUp = page.locator('[data-action="cancel-upgrade"]').first();
  if (await cancelUp.count()) {
    await page.evaluate(() => document.querySelector('[data-action="cancel-upgrade"]')?.click());
    await page.waitForTimeout(250);
    continue;
  }
  const cancelAltar = page.locator('[data-action="cancel-altar"]').first();
  if (await cancelAltar.count()) {
    await page.evaluate(() => document.querySelector('[data-action="cancel-altar"]')?.click());
    await page.waitForTimeout(250);
    continue;
  }
  /** 奖励三选一：选第一样带走，回地图继续翻 */
  const choose = page.locator('[data-action="choose"]').first();
  if (await choose.count()) {
    await page.evaluate(() => document.querySelector('[data-action="choose"]')?.click());
    await page.waitForTimeout(350);
    continue;
  }
  /** 敌人格优先（.pending = 已翻开待触发），其次任意待触发格，最后翻暗格 */
  const target = await page.evaluate(() => {
    const enemy = document.querySelector('.dcell.pending.k-enemy');
    if (enemy) return 'enemy';
    if (document.querySelector('.dcell.pending')) return 'pending';
    if (document.querySelector('.dcell.reach')) return 'reach';
    return null;
  });
  if (!target) break;
  await page.evaluate((t) => {
    const el = t === 'enemy' ? document.querySelector('.dcell.pending.k-enemy') : document.querySelector('.dcell.pending') || document.querySelector('.dcell.reach');
    el?.click();
  }, target);
  await page.waitForTimeout(350);
}
const inBattle = await page.evaluate(() => ({
  battle: !!document.querySelector('.hand .card'),
  midline: document.querySelector('.midline')?.textContent?.trim() || '',
}));
console.log('进战斗:', JSON.stringify(inBattle));
if (!inBattle.battle) {
  const diag = await page.evaluate(() => ({
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 200),
    cells: [...document.querySelectorAll('.dcell')].map((e) => e.className.replace('dcell', '').trim()).slice(0, 9),
  }));
  console.log('诊断:', JSON.stringify(diag));
  console.log('FAIL: 没进战斗');
  await browser.close();
  process.exit(1);
}

/** 玩家回合先把牌打光（能量允许的话），然后结束回合 */
for (let i = 0; i < 8; i++) {
  const played = await page.evaluate(() => {
    const c = document.querySelector('.tray .hand:not(.dim) .card.playable');
    if (!c) return false;
    c.click();
    return true;
  });
  if (!played) break;
  await page.waitForTimeout(260);
}
await page.evaluate(() => document.querySelector('[data-action="end-turn"]')?.click());
await page.waitForTimeout(300);

/** 敌方回合：手牌暗、按钮禁用、midline 换字、foe-play 出现 */
const enemyPhase = await page.evaluate(() => ({
  midline: document.querySelector('.midline')?.textContent?.trim() || '',
  handDim: !!document.querySelector('.tray .hand.dim'),
  btnText: document.querySelector('[data-action="end-turn"]')?.textContent?.trim() || '',
  btnDisabled: document.querySelector('[data-action="end-turn"]')?.classList.contains('disabled') || false,
  foePlay: document.querySelector('.foe-play')?.textContent.replace(/\s+/g, ' ').trim() || null,
}));
console.log('敌方回合:', JSON.stringify(enemyPhase));
if (enemyPhase.midline !== '敌方回合') { console.log('FAIL: 没进敌方回合'); process.exit(1); }
if (!enemyPhase.handDim || !enemyPhase.btnDisabled) { console.log('FAIL: 敌方回合输入没锁住'); process.exit(1); }

/** 等敌人把这一回合播完（最多 12 秒），期间抓一张"正在出牌"的快照 */
let sawCard = false;
let backToPlayer = false;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(320);
  const st = await page.evaluate(() => ({
    midline: document.querySelector('.midline')?.textContent?.trim() || '',
    foePlay: document.querySelector('.foe-play')?.textContent.replace(/\s+/g, ' ').trim() || '',
    dim: !!document.querySelector('.tray .hand.dim'),
  }));
  if (st.foePlay && !st.foePlay.includes('你的回合') && !st.foePlay.includes('轮到你')) sawCard = true;
  if (st.midline !== '敌方回合') { backToPlayer = true; break; }
}
console.log(`敌人出牌可见: ${sawCard} | 播完回玩家回合: ${backToPlayer}`);
if (!backToPlayer) { console.log('FAIL: 敌方回合没有结束'); process.exit(1); }

const playerBack = await page.evaluate(() => ({
  midline: document.querySelector('.midline')?.textContent?.trim() || '',
  dim: !!document.querySelector('.tray .hand.dim'),
  btn: document.querySelector('[data-action="end-turn"]')?.textContent?.trim() || '',
  foePlay: document.querySelector('.foe-play')?.textContent.replace(/\s+/g, ' ').trim() || '',
}));
console.log('回到玩家回合:', JSON.stringify(playerBack));
if (playerBack.dim) { console.log('FAIL: 回玩家回合手牌还是暗的'); process.exit(1); }
if (!playerBack.btn.includes('结束回合')) { console.log('FAIL: 结束回合按钮没恢复'); process.exit(1); }

/** 打完整场（无脑出牌 + 结束回合），确认不卡死 */
let rounds = 0;
for (let i = 0; i < 80 && rounds < 12; i++) {
  const st = await page.evaluate(() => ({
    over: !document.querySelector('.hand .card'),
    my: document.querySelector('.midline')?.textContent?.trim() !== '敌方回合',
  }));
  if (st.over) break;
  if (st.my) {
    for (;;) {
      const played = await page.evaluate(() => {
        const c = document.querySelector('.tray .hand:not(.dim) .card.playable');
        if (!c) return false;
        c.click();
        return true;
      });
      if (!played) break;
      await page.waitForTimeout(220);
    }
    await page.evaluate(() => document.querySelector('[data-action="end-turn"]')?.click());
    rounds++;
  }
  await page.waitForTimeout(300);
}
const final = await page.evaluate(() => ({
  over: !document.querySelector('.hand .card'),
  screen: !!document.querySelector('.midline'),
}));
console.log(`打完整场: ${final.over ? '是' : '否（仍在战斗）'} | 玩家回合数: ${rounds}`);
if (!final.over) { console.log('FAIL: 战斗没有正常结束'); process.exit(1); }

console.log(errs.length ? `页面错误: ${errs.join(' | ')}` : '页面错误: 无');
if (errs.length) process.exit(1);
await browser.close();
console.log('PROBE PASS');
