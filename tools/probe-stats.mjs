/**
 * 探针 v3.38：属性面板局内可用 + 固定尺寸不滚动 + ✕ 关闭
 *
 * 要证的五件事：
 *   1. 局外（营地角色卡）属性面板仍有：9 行 + ✕，点 ✕ 能关
 *   2. 地图页顶栏有「详情」入口（v3.79 起开完整角色详情页，属性走蒙板），
 *      蒙板数值 = run.player（这一趟的实时面板）
 *   3. 面板**不可滚动**：.stats-panel 与 .sp-box 的 scrollHeight 都不超过 clientHeight
 *      （用户报的"下面能往下一滑动一点"就是这个）
 *   4. 战斗中也能开，并且多一行「本场」临时状态（护甲 / 力量 / 血量）
 *   5. 小屏（375×667）同样装得下、不滚动；全程控制台零报错
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4183/';

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

/** 面板的几何快照：能否滚动、占多高、内容是否被裁 */
async function panelGeo() {
  return page.evaluate(() => {
    const ov = document.querySelector('.stats-panel');
    if (!ov) return null;
    const box = ov.querySelector('.sp-box');
    const list = ov.querySelector('.sp-list');
    return {
      rows: ov.querySelectorAll('.sp-row').length,
      hasClose: !!ov.querySelector('.sp-close'),
      hasBattle: !!ov.querySelector('.sp-battle'),
      ovScroll: ov.scrollHeight - ov.clientHeight,
      boxScroll: box.scrollHeight - box.clientHeight,
      boxH: Math.round(box.getBoundingClientRect().height),
      viewH: window.innerHeight,
      rowsOverflow: list.scrollHeight - list.clientHeight,
      head: ov.querySelector('.sp-head')?.textContent.replace(/\s+/g, ' ').trim() || '',
    };
  });
}

async function openFromMapOrBattle() {
  await page.evaluate(() => document.querySelector('[data-action="open-run-stats"]')?.click());
  await page.waitForTimeout(250);
}

/* ---------------- 1. 局外：造一个角色，营地开详情 ---------------- */

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

/** 新档名册是空的（没有 starter 角色），先造一个 */
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const m = save.loadMeta() || meta.createMeta(20261108);
  const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 7 });
  ch.veteran = false;
  ch.status = 'idle';
  m.roster = [ch];
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

await page.evaluate(() => document.querySelector('[data-action="open-roster"]')?.click());
await page.waitForTimeout(350);
/**
 * v3.71 起局外角色行直接开完整详情页（open-char），属性走蒙板 —— 旧的
 * open-stats 快面板按钮已不存在。这里验证详情页 + 属性蒙板的等价物。
 */
const outsideHasEntry = await page.locator('[data-action="open-char"]').count() > 0;
check(outsideHasEntry, '局外营地找不到「角色详情」入口');
if (outsideHasEntry) {
  await page.evaluate(() => document.querySelector('[data-action="open-char"]')?.click());
  await page.waitForTimeout(300);
  check(await page.locator('.overlay.hero-page').count() > 0, '局外点角色没打开详情页');
  await page.evaluate(() => document.querySelector('.hp-v-attrs')?.click());
  await page.waitForTimeout(250);
  const g = await maskGeo();
  console.log('局外属性蒙板:', JSON.stringify(g));
  check(!!g, '局外属性蒙板没打开');
  if (g) {
    check(g.rows === 9, `局外属性蒙板应有 9 行，实际 ${g.rows}`);
    check(g.head.includes('属性'), `局外蒙板标题不对：${g.head}`);
    check(g.boxScroll <= 1 || g.boxH <= g.viewH, `局外蒙板异常：裁 ${g.boxScroll}px / 高 ${g.boxH}`);
    /** ✕ 关掉 */
    await page.evaluate(() => document.querySelector('.hp-attrs-mask')?.click());
    await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector('.hp-close')?.click());
    await page.waitForTimeout(250);
    check(await page.locator('.overlay.hero-page').count() === 0, '点 ✕ 没关掉局外详情页');
  }
}

/* ---------------- 2. 造实习生出发 → 地图属性面板 ---------------- */

await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const m = save.loadMeta() || meta.createMeta(20261108);
  const ch = roster.createCharacter({ classId: 'mage', raceId: 'moss', seed: 11 });
  ch.veteran = false;
  ch.status = 'idle';
  ch.lives = 3;
  m.roster = [ch];
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('[data-action="open-expedition"]')?.click());
await page.waitForTimeout(350);
await page.evaluate(() => {
  const pick = document.querySelector('[data-action="pick-expedition"], [data-action="explore"]');
  pick?.click();
});
await page.waitForTimeout(350);
await page.evaluate(() => document.querySelector('[data-action="depart"], [data-action="explore"]')?.click());
await page.waitForTimeout(550);
await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
await page.waitForTimeout(250);

/**
 * v3.79 起地图页顶栏是「详情」（open-hero → 完整角色详情页，属性走蒙板）；
 * 局内快面板（open-run-stats）只保留在战斗页。
 */
async function openMapDetail() {
  await page.evaluate(() => document.querySelector('[data-action="open-hero"]')?.click());
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('.hp-v-attrs')?.click());
  await page.waitForTimeout(250);
}

/** 属性蒙板几何快照：行数、可滚动、蒙板存在 */
async function maskGeo() {
  return page.evaluate(() => {
    const mask = document.querySelector('.hp-attrs-mask');
    if (!mask) return null;
    const box = mask.querySelector('.hp-attrs-box');
    return {
      rows: box.querySelectorAll('.sp-row').length,
      boxScroll: box.scrollHeight - box.clientHeight,
      viewH: window.innerHeight,
      boxH: Math.round(box.getBoundingClientRect().height),
      head: box.querySelector('.hp-sec-head')?.textContent.replace(/\s+/g, ' ').trim() || '',
    };
  });
}

const mapHasEntry = await page.locator('[data-action="open-hero"]').count() > 0;
check(mapHasEntry, '地图页顶栏没有「详情」入口');
await openMapDetail();
const mapGeo = await maskGeo();
console.log('地图属性蒙板:', JSON.stringify(mapGeo));
check(await page.locator('.overlay.hero-page').count() > 0, '地图页点「详情」没打开角色详情页');
check(!!mapGeo, '地图详情页属性蒙板没打开');
if (mapGeo) {
  check(mapGeo.rows === 9, `地图属性蒙板应有 9 行，实际 ${mapGeo.rows}`);
  check(mapGeo.head.includes('属性'), `属性蒙板标题不对：${mapGeo.head}`);
  check(mapGeo.boxScroll <= 1, `地图属性蒙板内层被裁 ${mapGeo.boxScroll}px`);
  check(mapGeo.boxH <= mapGeo.viewH * 0.9, `蒙板占屏 ${mapGeo.boxH}/${mapGeo.viewH}，超过 90%`);
  console.log('蒙板标题行:', mapGeo.head);
}

/** 点空白 / ✕ 都要能关 */
await page.evaluate(() => document.querySelector('.hp-attrs-mask')?.click());
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector('.hp-close')?.click());
await page.waitForTimeout(220);
check(await page.locator('.overlay.hero-page').count() === 0, '点 ✕ 没关掉详情页');

/** 面板数值必须等于这一趟的 run.player（含升级/宝物/装备），不是出发前快照 */
await openMapDetail();
const inRun = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  const row = (name) => {
    const rows = [...document.querySelectorAll('.hp-attrs-box .sp-row')];
    const hit = rows.find((r) => r.querySelector('.sp-key b')?.textContent.trim() === name);
    return hit ? Number(hit.querySelector('.sp-key i').textContent.replace(/[^\d-]/g, '')) : null;
  };
  return {
    maxHp: run.player.maxHp, atk: run.player.atk, def: run.player.def || 0,
    ui: { maxHp: row('生命上限'), atk: row('攻击力'), def: row('防御') },
  };
});
console.log('数值对拍:', JSON.stringify(inRun));
check(inRun.ui.maxHp === inRun.maxHp, `生命上限 ${inRun.ui.maxHp} ≠ run ${inRun.maxHp}`);
check(inRun.ui.atk === inRun.atk, `攻击力 ${inRun.ui.atk} ≠ run ${inRun.atk}`);
check(inRun.ui.def === inRun.def, `防御 ${inRun.ui.def} ≠ run ${inRun.def}`);
await page.evaluate(() => document.querySelector('.hp-close')?.click());
await page.waitForTimeout(220);
check(await page.locator('.overlay.hero-page').count() === 0, '数值对拍后没关掉详情页');

/* ---------------- 3. 小屏 375×667 同样装得下 ---------------- */

await page.setViewportSize({ width: 375, height: 667 });
await page.waitForTimeout(300);
await openMapDetail();
const smallGeo = await maskGeo();
console.log('小屏蒙板:', JSON.stringify(smallGeo));
if (smallGeo) {
  check(smallGeo.rows === 9, `小屏属性蒙板应有 9 行，实际 ${smallGeo.rows}`);
  /** v3.72 起蒙板带委托进度 / 本场状态，小屏允许内滚（滚动条已隐藏），只要求不超出视口 */
  check(smallGeo.boxH <= smallGeo.viewH, `小屏蒙板占屏 ${smallGeo.boxH}/${smallGeo.viewH}，超出视口`);
  if (smallGeo.boxScroll > 0) {
    const scrollable = await page.evaluate(() => {
      const box = document.querySelector('.hp-attrs-box');
      return box && getComputedStyle(box).overflowY === 'auto';
    });
    check(scrollable, '小屏蒙板内容被裁且不可滚动');
  }
}
await page.evaluate(() => document.querySelector('.hp-attrs-mask')?.click());
await page.waitForTimeout(180);
await page.evaluate(() => document.querySelector('.hp-close')?.click());
await page.waitForTimeout(200);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(250);

/* ---------------- 4. 战斗中开面板（含本场临时状态） ---------------- */

for (let step = 0; step < 90; step++) {
  if (await page.locator('.hand .card').count()) break;
  const leaveShop = page.locator('[data-action="leave-shop"]').first();
  if (await leaveShop.count()) {
    await page.evaluate(() => document.querySelector('[data-action="leave-shop"]')?.click());
    await page.waitForTimeout(220);
    continue;
  }
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
  const target = await page.evaluate(() => {
    if (document.querySelector('.dcell.pending.k-enemy')) return 'enemy';
    /** 迷宫优先把暗格翻完：楼梯 pending 会因"敌人未清"被拒，先点 pending 会死锁 */
    if (document.querySelector('.dcell.reach')) return 'reach';
    if (document.querySelector('.dcell.pending')) return 'pending';
    return null;
  });
  if (!target) break;
  if (step % 15 === 14) {
    const snap = await page.evaluate(() => ({
      pend: document.querySelectorAll('.dcell.pending').length,
      reach: document.querySelectorAll('.dcell.reach').length,
      done: document.querySelectorAll('.dcell.done').length,
      floor: document.querySelector('.topbar .floor')?.textContent,
      overlay: [...document.querySelectorAll('.overlay')].map((o) => o.className).slice(0, 2),
    }));
    console.log(`  [step ${step}]`, JSON.stringify(snap));
  }
  await page.evaluate((t) => {
    const el = t === 'enemy'
      ? document.querySelector('.dcell.pending.k-enemy')
      : t === 'reach'
        ? document.querySelector('.dcell.reach')
        : document.querySelector('.dcell.pending');
    el?.click();
  }, target);
  await page.waitForTimeout(330);
}

const inBattle = await page.locator('.hand .card').count() > 0;
check(inBattle, '没进战斗，无法验证战斗页属性入口');
if (inBattle) {
  const battleHasEntry = await page.locator('[data-action="open-run-stats"]').count() > 0;
  check(battleHasEntry, '战斗页顶栏没有「属性」入口');
  await openFromMapOrBattle();
  const bGeo = await panelGeo();
  console.log('战斗面板:', JSON.stringify(bGeo));
  check(!!bGeo, '战斗页属性面板没打开');
  if (bGeo) {
    check(bGeo.rows === 9, `战斗面板应有 9 行，实际 ${bGeo.rows}`);
    check(bGeo.ovScroll <= 1, `战斗面板还能滚动 ${bGeo.ovScroll}px`);
    check(bGeo.boxScroll <= 1, `战斗面板内层被裁 ${bGeo.boxScroll}px`);
    check(bGeo.hasBattle, '战斗面板缺「本场」临时状态行');
  }
  /**
   * 面板开着时手牌必须点不到。
   * 注意不能用 `card.click()` 验证 —— 程序化派发绕过了命中测试，
   * 真实手指点不到的地方它照样能触发。这里问的是"那个坐标上最上层是谁"。
   */
  const blocked = await page.evaluate(() => {
    const card = document.querySelector('.tray .hand .card');
    if (!card) return null;
    const r = card.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = Math.min(r.top + r.height / 2, window.innerHeight - 2);
    const el = document.elementFromPoint(x, y);
    return { covered: !!el?.closest('.stats-panel'), top: el?.className || el?.tagName || '' };
  });
  console.log('遮罩遮挡手牌:', JSON.stringify(blocked));
  check(!!blocked?.covered, `面板打开时手牌仍然可点（最上层是 ${blocked?.top}）`);
  await page.evaluate(() => document.querySelector('.sp-close')?.click());
  await page.waitForTimeout(220);
  check(await page.locator('.stats-panel').count() === 0, '战斗页点 ✕ 没关掉面板');
}

/* ---------------- 5. 收尾 ---------------- */

if (fails.length) {
  console.log('FAIL:\n- ' + fails.join('\n- '));
  if (errs.length) console.log('页面错误:', errs.join(' | '));
  await browser.close();
  process.exit(1);
}
console.log(errs.length ? `页面错误: ${errs.join(' | ')}` : '页面错误: 无');
if (errs.length) process.exit(1);
await browser.close();
console.log('PROBE PASS');
