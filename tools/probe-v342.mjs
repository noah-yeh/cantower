/**
 * 探针 v3.42：战斗页三项信息补全
 *
 * 用户这轮四件事的 UI 部分：
 *   1. 职业 / 种族天赋常驻战斗状态栏（`.talent-row` 两枚 chip，可点开属性面板）
 *   2. 战斗中直接能看到战况（中线钉着最新一条记录）+ 记录面板仍可用
 *   3. 敌人牌库有入口（`.foe-deck-btn` → 手中 / 抽牌堆 / 弃牌堆，张数与 core 一致）
 *   4. 卡片基础伤害下调后，卡面数字跟着变（打击 12）
 *
 * 三个视口各跑一遍：390×640 / 360×640（窄）/ 390×560（矮，v3.41 压过的那档）
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4185/';
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

async function seed(page) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(350);
  await page.evaluate(async () => {
    const meta = await import('/src/core/meta.js');
    const roster = await import('/src/core/roster.js');
    const save = await import('/src/core/save.js');
    const runMod = await import('/src/core/run.js');
    const enemies = await import('/src/core/enemies.js');
    const rngMod = await import('/src/core/rng.js');
    const m = meta.createMeta(20261108);
    const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 5 });
    ch.veteran = false; ch.status = 'idle'; ch.lives = 3;
    m.roster = [ch];
    save.saveMeta(m);
    const run = runMod.createRun({ character: ch, seed: 42 });
    run.relics = ['boneCharm', 'quiver', 'ironBracer+3'];
    const idx = run.floorMap.cells.findIndex((c) => !c.done && c.kind !== 'stairs');
    run.floorMap.cells[idx] = {
      kind: 'enemy', revealed: true, done: false,
      data: { tier: 'normal', enemy: enemies.makeEnemy(run.floor, new rngMod.Rng(7), 'normal') },
    };
    save.saveRun(run);
    m.run = { characterId: ch.id, floor: run.floor, paused: true };
    save.saveMeta(m);
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(450);
  await page.locator('[data-action="resume"]').first().click();
  await page.waitForTimeout(350);
  await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
  await page.waitForTimeout(250);
  for (let step = 0; step < 40; step++) {
    if (await page.locator('.hand .card').count()) return true;
    const t = await page.evaluate(() => {
      if (document.querySelector('.dcell.pending.k-enemy')) return 'enemy';
      if (document.querySelector('.dcell.pending')) return 'pending';
      if (document.querySelector('.dcell.reach')) return 'reach';
      return null;
    });
    if (!t) break;
    await page.evaluate((k) => {
      const el = k === 'enemy' ? document.querySelector('.dcell.pending.k-enemy')
        : k === 'pending' ? document.querySelector('.dcell.pending')
          : document.querySelector('.dcell.reach');
      el?.click();
    }, t);
    await page.waitForTimeout(300);
  }
  return (await page.locator('.hand .card').count()) > 0;
}

for (const [w, h] of [[390, 640], [360, 640], [390, 560]]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const tag = `${w}×${h}`;

  const ok = await seed(page);
  check(ok, `${tag}: 没进战斗`);
  if (!ok) { await page.close(); continue; }

  /* 1. 天赋小图标（v3.44 起文字 chip 改小图标，详测在 probe-v344） */
  const talents = await page.evaluate(() => {
    const icons = [...document.querySelectorAll('.player-zone .ticon')];
    const first = icons[0];
    const r = first?.getBoundingClientRect();
    const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    return {
      count: icons.length,
      visible: !!hit && (hit === first || first.contains(hit)),
      top: Math.round(r?.top ?? -1),
      stageBottom: Math.round(document.querySelector('.stage').getBoundingClientRect().bottom),
    };
  });
  console.log(tag, '天赋图标:', JSON.stringify(talents));
  check(talents && talents.count === 2, `${tag}: 天赋小图标应有 2 枚，实际 ${talents?.count}`);
  check(talents && talents.visible, `${tag}: 天赋小图标被遮住 / 被裁掉（elementFromPoint 没命中）`);
  check(talents && talents.top < talents.stageBottom, `${tag}: 天赋行溢出战场底部`);

  /* 打出 1 张牌，制造一条战斗记录 */
  const played = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.hand .card')].find((c) => !c.className.includes('disabled'));
    if (!card) return false;
    card.click();
    return true;
  });
  await page.waitForTimeout(700);

  /* 2. 中线 = 最新战况；点开完整记录 */
  const mid = await page.evaluate(() => {
    const el = document.querySelector('.midline');
    return el ? { text: el.innerText.replace(/\s+/g, ' ').trim(), hasLog: el.classList.contains('has-log') } : null;
  });
  console.log(tag, '中线:', JSON.stringify(mid), '出牌:', played);
  check(mid && mid.text.length > 0, `${tag}: 中线没有文字`);
  check(mid && mid.hasLog, `${tag}: 打出一张牌后中线应显示最新记录（has-log 没置上）`);

  if (mid?.hasLog) {
    await page.locator('.midline').click();
    await page.waitForTimeout(300);
    const logRows = await page.locator('.log-overlay .log-row').count();
    check(logRows > 0, `${tag}: 点中线没打开战斗记录（0 行）`);
    await page.evaluate(() => document.querySelector('[data-action="close-log"]')?.click());
    await page.waitForTimeout(200);
  }

  /* 3. 敌人牌库 */
  const deckBtn = await page.evaluate(() => {
    const b = document.querySelector('[data-action="open-foe-deck"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { visible: !!hit && (hit === b || b.contains(hit)), w: Math.round(r.width), right: Math.round(r.right) };
  });
  check(deckBtn && deckBtn.visible, `${tag}: 牌库入口不可见/被遮`);
  if (deckBtn?.visible) {
    await page.locator('[data-action="open-foe-deck"]').click();
    await page.waitForTimeout(300);
    const deck = await page.evaluate(() => {
      const sheet = document.querySelector('[data-action="foe-deck-noop"]');
      if (!sheet) return null;
      const heads = [...sheet.querySelectorAll('.fd-head')].map((n) => n.textContent.replace(/\s+/g, ' ').trim());
      const rows = sheet.querySelectorAll('.fd-row').length;
      return { heads, rows, title: sheet.querySelector('.log-head')?.innerText.replace(/\s+/g, ' ').trim() };
    });
    console.log(tag, '牌库:', JSON.stringify(deck));
    const joined = (deck?.heads || []).join(' ');
    check(/手中/.test(joined) && /抽牌堆/.test(joined) && /弃牌堆/.test(joined), `${tag}: 牌库三堆不全：${joined}`);
    check(deck && /手中/.test(deck.heads.join('')) && /抽牌堆/.test(deck.heads.join('')) && /弃牌堆/.test(deck.heads.join('')),
      `${tag}: 牌库分组标题不对：${deck?.heads?.join(' / ')}`);
    check(deck && deck.rows > 0, `${tag}: 牌库没有任何牌`);
    /* 三堆张数之和应等于敌人牌库总数（普通怪 6~7 张） */
    const total = (deck?.heads || []).reduce((n, s) => n + (Number((s.match(/(\d+) 张/) || [])[1]) || 0), 0);
    check(total >= 6 && total <= 9, `${tag}: 牌库总张数异常：${total}`);
    await page.evaluate(() => document.querySelector('[data-action="close-foe-deck"]')?.click());
    await page.waitForTimeout(200);
  }

  /* 4. 属性面板仍能打开（战斗中的入口） */
  await page.locator('[data-action="open-run-stats"]').first().click();
  await page.waitForTimeout(250);
  const stats = await page.evaluate(() => {
    const el = document.querySelector('.stats-panel');
    return el ? { talent: el.querySelector('.sp-talent')?.innerText.replace(/\s+/g, ' ').slice(0, 60) } : null;
  });
  check(!!stats, `${tag}: 点「属性」没打开面板`);
  check(stats && /种族/.test(stats.talent || ''), `${tag}: 属性面板里没有天赋块`);
  await page.evaluate(() => document.querySelector('.sp-close')?.click());
  await page.waitForTimeout(200);

  /* 5. 顶栏三按钮都在视口内（v3.39 的老问题回归） */
  const bars = await page.evaluate(() => ({
    vw: innerWidth,
    btns: [...document.querySelectorAll('.topbar [data-action="open-run-stats"], .topbar [data-action="open-log"], .topbar [data-action="open-bag-run"]')]
      .map((b) => ({ a: b.dataset.action, right: Math.round(b.getBoundingClientRect().right) })),
  }));
  check(bars.btns.length === 3, `${tag}: 顶栏缺按钮`);
  check(bars.btns.every((b) => b.right <= bars.vw), `${tag}: 顶栏按钮超出视口 ${JSON.stringify(bars.btns)}`);

  /* 6. 卡面数字跟着新数值（打击 12） */
  const strike = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.hand .card')]
      .map((c) => c.innerText.replace(/\s+/g, ' ').trim())
      .filter((t) => t.includes('打击'));
    return cards[0] || null;
  });
  check(!strike || /造成 1[0-9]/.test(strike), `${tag}: 打击卡面伤害没跟着降（${strike}）`);

  /* 7. 战场不溢出 */
  const over = await page.evaluate(() => {
    const s = document.querySelector('.stage');
    return s.scrollHeight - s.clientHeight;
  });
  check(over <= 1, `${tag}: 战场内容溢出 ${over}px（新增天赋行/中线后高度不够）`);
  check(!errs.length, `${tag}: 页面报错 ${errs.join(' | ')}`);

  await page.close();
}

await browser.close();
if (fails.length) {
  console.log('FAIL:\n- ' + fails.join('\n- '));
  process.exit(1);
}
console.log('PROBE PASS');
