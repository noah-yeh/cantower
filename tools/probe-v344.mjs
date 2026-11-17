/**
 * 探针 v3.44：战场信息行重排（参照用户给的参考截图）
 *
 *   1. 敌人侧：状态 + 词条一行紧贴血条、放不下折叠可手动展开；
 *      「每回合 N 能量 · 手牌 N」已删除；点敌人立绘开属性 + 牌库浮层。
 *   2. 玩家侧：种族/职业文字 chip 换成小图标，与状态并排；
 *      点图标在行下展开描述；点玩家头像开「属性 + 背包」一体面板。
 *
 * ⚠ 已过时（2026-11-12 记）：第 2 部分断言的「属性 + 背包一体面板」
 *   在 v3.72 详情页重做时被移除（背包职能并入详情页、天赋改圆徽冒泡、
 *   属性走蒙板），本探针自那以后就不该再进回归集。
 *   敌人浮层部分（第 1 部分）仍有效，但整体不再作为通过门槛。
 *
 * 视口：390×640 / 360×640（窄）/ 390×560（矮）
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
    const m = meta.createMeta(20261109);
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
      /** 迷宫优先把暗格翻完：楼梯 pending 会因"敌人未清"被拒，先点它会死锁 */
      if (document.querySelector('.dcell.reach')) return 'reach';
      if (document.querySelector('.dcell.pending')) return 'pending';
      return null;
    });
    if (!t) break;
    await page.evaluate((k) => {
      const el = k === 'enemy' ? document.querySelector('.dcell.pending.k-enemy')
        : k === 'reach' ? document.querySelector('.dcell.reach')
          : document.querySelector('.dcell.pending');
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

  /* ---- 1. 敌人侧 ---- */
  const foe = await page.evaluate(() => {
    const zone = document.querySelector('.enemy-zone');
    const hp = zone?.querySelector('.hp-enemy');
    const row = zone?.querySelector('.tags-row');
    const line = row?.querySelector('.tags-line');
    const traits = line ? [...line.querySelectorAll('.trait')] : [];
    const metaEl = zone?.querySelector('.enemy-meta');
    const hr = hp?.getBoundingClientRect();
    const rr = row?.getBoundingClientRect();
    const first = traits[0];
    const fr = first?.getBoundingClientRect();
    const hit = fr ? document.elementFromPoint(fr.left + fr.width / 2, fr.top + fr.height / 2) : null;
    return {
      hasMeta: !!metaEl,
      metaText: metaEl?.innerText || '',
      chips: line ? line.children.length : 0,
      traitCount: traits.length,
      belowHp: hr && rr ? rr.top >= hr.top : null,
      gap: hr && rr ? Math.round(rr.top - hr.bottom) : null,
      visible: !!hit && (!!first && (hit === first || first.contains(hit))),
      rowH: Math.round(rr?.height ?? 0),
      hasToggle: !!row?.querySelector('.tags-toggle'),
    };
  });
  console.log(tag, '敌人行:', JSON.stringify(foe));
  check(!foe.hasMeta, `${tag}: 「每回合 N 能量」行还在（.enemy-meta 应删除）`);
  check(!/每回合/.test(foe.metaText || ''), `${tag}: 页面仍有"每回合"文字`);
  check(foe.traitCount >= 1, `${tag}: 敌人词条没进信息行（${foe.traitCount} 枚）`);
  check(foe.belowHp === true && foe.gap >= 0, `${tag}: 词条行没紧贴血条下方`);
  check(foe.visible, `${tag}: 词条 chip 被遮住 / 被裁掉（elementFromPoint 没命中）`);
  check(foe.rowH <= 26, `${tag}: 信息行没收成单行（高 ${foe.rowH}px）`);

  /* 点敌人立绘 → 属性 + 牌库浮层 */
  await page.locator('.enemy-zone .face-btn').click();
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => {
    const sheet = document.querySelector('[data-action="foe-deck-noop"]');
    if (!sheet) return null;
    const text = sheet.innerText.replace(/\s+/g, ' ');
    const heads = [...sheet.querySelectorAll('.fd-head')].map((n) => n.textContent.trim());
    return {
      hasAttrs: /属性/.test(text) && /攻击/.test(text) && /每回合能量/.test(text),
      heads,
      rows: sheet.querySelectorAll('.fd-row').length,
    };
  });
  console.log(tag, '敌人浮层:', JSON.stringify(info));
  check(info && info.hasAttrs, `${tag}: 敌人浮层缺属性区（生命/攻击/每回合能量）`);
  const joined = (info?.heads || []).join(' ');
  check(info && /手中/.test(joined) && /抽牌堆/.test(joined) && /弃牌堆/.test(joined),
    `${tag}: 牌库三堆不全：${joined}`);
  check(info && info.rows > 0, `${tag}: 敌人浮层没有内容行`);
  await page.evaluate(() => document.querySelector('[data-action="close-foe-deck"]')?.click());
  await page.waitForTimeout(200);

  /* ---- 2. 玩家侧 ---- */
  const mine = await page.evaluate(() => {
    const zone = document.querySelector('.player-zone');
    const row = zone?.querySelector('.tags-row');
    const icons = row ? [...row.querySelectorAll('.ticon')] : [];
    const status = row ? [...row.querySelectorAll('.chip')].length : 0;
    const noTalentRow = !document.querySelector('.talent-row');
    const first = icons[0];
    const r = first?.getBoundingClientRect();
    const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    return {
      icons: icons.length,
      statusChips: status,
      noTalentRow,
      visible: !!hit && (hit === first || first.contains(hit)),
      iconSrc: icons.map((i) => i.querySelector('img')?.getAttribute('src') || ''),
    };
  });
  console.log(tag, '玩家行:', JSON.stringify(mine));
  check(mine.noTalentRow, `${tag}: 旧文字天赋行 .talent-row 还在`);
  check(mine.icons === 2, `${tag}: 天赋小图标应有 2 枚，实际 ${mine.icons}`);
  check(mine.statusChips >= 0, `${tag}: 状态 chips 计数异常`);
  check(mine.visible, `${tag}: 天赋小图标被遮住 / 被裁掉`);
  check(mine.iconSrc.every((s) => !!s), `${tag}: 有图标 img 没挂 src`);

  /* 点种族图标 → 蒙板卡片浮层（v3.45 起不再是行内展开）；点任意处关闭 */
  await page.locator('.player-zone .tags-line .ticon').first().click();
  await page.waitForTimeout(250);
  const detail1 = await page.evaluate(() => {
    const ov = document.querySelector('.tip-overlay');
    return { open: !!ov, text: ov?.innerText.replace(/\s+/g, ' ').trim() || '' };
  });
  check(detail1.open && /种族/.test(detail1.text), `${tag}: 点种族图标没出浮层（${detail1.text.slice(0, 30)}）`);
  await page.evaluate(() => document.querySelector('.tip-overlay')?.click());
  await page.waitForTimeout(200);
  const detail2 = await page.evaluate(() => !!document.querySelector('.tip-overlay'));
  check(!detail2, `${tag}: 点浮层没关闭`);

  /* ---- 3. 英雄面板：点玩家头像 ---- */
  await page.locator('.player-zone .face-btn').click();
  await page.waitForTimeout(300);
  const hero = await page.evaluate(() => {
    const el = document.querySelector('.stats-panel');
    if (!el) return null;
    const bag = el.querySelector('.sp-bag');
    return {
      open: true,
      hasBag: !!bag,
      bagText: bag?.innerText.replace(/\s+/g, ' ').slice(0, 80) || '',
      bagCards: bag ? bag.querySelectorAll('.sp-bag-card').length : 0,
      hasTalent: !!el.querySelector('.sp-talent'),
      scrollable: (() => { const b = el.querySelector('.sp-box'); return b.scrollHeight > b.clientHeight; })(),
    };
  });
  console.log(tag, '英雄面板:', JSON.stringify(hero));
  check(hero && hero.hasBag, `${tag}: 英雄面板没有背包区`);
  check(hero && hero.bagCards >= 5, `${tag}: 背包区卡组行太少（${hero?.bagCards}）`);
  check(hero && /水晶材料/.test(hero.bagText) && /古币/.test(hero.bagText), `${tag}: 背包区缺材料/古币行`);
  check(hero && hero.hasTalent, `${tag}: 英雄面板缺天赋块`);
  await page.evaluate(() => document.querySelector('.sp-close')?.click());
  await page.waitForTimeout(200);

  /* ---- 4. 战场不溢出 + 无报错 ---- */
  const over = await page.evaluate(() => {
    const s = document.querySelector('.stage');
    return s.scrollHeight - s.clientHeight;
  });
  check(over <= 1, `${tag}: 战场内容溢出 ${over}px`);
  check(!errs.length, `${tag}: 页面报错 ${errs.join(' | ')}`);

  await page.close();
}

await browser.close();
if (fails.length) {
  console.log('FAIL:\n- ' + fails.join('\n- '));
  process.exit(1);
}
console.log('PROBE PASS');
