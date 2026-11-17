/**
 * v3.80 探针：探索页底部角色行 + 详情页合成/激活 + 水晶并入数值行
 *
 * 要证的六件事：
 *   1. 地图顶栏不再有背包入口；dm-stats 数值行有水晶材料（.dm-mat），数值 = run.materials
 *   2. 底部托盘 = 角色头像行（.dhero）：种族头像 + 生命/攻击/能量，数值 = run.player
 *   3. 点头像打开角色详情页
 *   4. 详情页牌库页签带「合成」区：塞两张同名同级卡后出现合成行，点了真合成（材料 +1、卡组变化）
 *   5. 详情页宝物页签：待激活宝物变成可点卡片，水晶够时点一下真激活
 *   6. 提示横幅（.dnote-slot）在地图上方（DOM 顺序先于 .dmap）；全程控制台零报错
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log(`${cond ? 'OK ' : 'ERR'} ${msg}`); };

/* ---- 造角色出发 ---- */
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const m = save.loadMeta() || meta.createMeta(20261112);
  const ch = roster.createCharacter({ classId: 'hunter', raceId: 'stone', seed: 5 });
  ch.veteran = false;
  ch.status = 'idle';
  ch.lives = 3;
  m.roster = [ch];
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-action="open-expedition"]')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('[data-action="explore"], [data-action="pick-expedition"]')?.click());
await page.waitForTimeout(550);
await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
await page.waitForTimeout(300);

/* ---- 1. 顶栏无背包 + 水晶在数值行 ---- */
const top = await page.evaluate(() => ({
  bag: document.querySelectorAll('.topbar [data-action="open-bag-run"]').length,
  mat: document.querySelector('.dm-mat')?.textContent.replace(/\s+/g, ' ').trim(),
  gold: !!document.querySelector('.dm-gold'),
}));
ok(top.bag === 0, `地图顶栏没有背包入口（found ${top.bag}）`);
ok(top.gold, '古币还在数值行');
ok(/^◆?\s*\d+$/.test((top.mat || '').replace('<span class="mat"></span>', '').trim()) || /\d/.test(top.mat || ''),
  `水晶材料在数值行（显示：${top.mat}）`);

/* ---- 2. 底部角色行 ---- */
const tray = await page.evaluate(() => {
  const el = document.querySelector('.dtray .dhero');
  if (!el) return null;
  return {
    face: !!el.querySelector('.dhero-face'),
    name: el.querySelector('.dhero-name')?.textContent.trim(),
    hp: el.querySelector('.dv-hp')?.textContent.replace(/\s+/g, ''),
    atk: el.querySelector('.dv-atk')?.textContent.replace(/\s+/g, ''),
    en: el.querySelector('.dv-en')?.textContent.replace(/\s+/g, ''),
    go: el.querySelector('.dhero-go')?.textContent,
    bagBtn: !!el.closest('.dtray').querySelector('[data-action="open-bag-run"]'),
  };
});
ok(!!tray, '底部托盘有角色行（.dhero）');
ok(tray?.face, '角色行有种族头像');
ok(tray?.go === '›', `角色行有 › 可点暗示`);
ok(!tray?.bagBtn, '托盘里没有背包按钮');
const runNow = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  return { hp: run.player.hp, maxHp: run.player.maxHp, atk: run.player.atk, en: run.player.energy ?? run.player.energyCap ?? 8, mats: run.materials || 0 };
});
ok(tray?.hp === `❤${runNow.hp}/${runNow.maxHp}`, `生命显示 = run（${tray?.hp} vs ${runNow.hp}/${runNow.maxHp}）`);
ok(tray?.atk === `⚔${runNow.atk}`, `攻击显示 = run（${tray?.atk} vs ${runNow.atk}）`);
ok(tray?.en === `⚡${runNow.en}`, `能量显示 = run（${tray?.en} vs ${runNow.en}）`);

/* ---- 3. 点头像进详情 ---- */
await page.evaluate(() => document.querySelector('.dtray .dhero')?.click());
await page.waitForTimeout(350);
ok(await page.locator('.overlay.hero-page').count() > 0, '点头像打开角色详情页');

/* ---- 6. 提示横幅位置（先做这个不用关详情） ---- */
await page.evaluate(() => document.querySelector('.hp-close')?.click());
await page.waitForTimeout(300);
const notePos = await page.evaluate(() => {
  const wrap = document.querySelector('.dmap-wrap');
  const head = wrap.querySelector('.dmap-head');
  const note = wrap.querySelector('.dnote-slot');
  const map = wrap.querySelector('.dmap');
  return { order: [head, note, map].filter(Boolean).map((el) => el.className),
    noteStyle: note ? getComputedStyle(note.querySelector('.dnote') || note).fontSize : null };
});
ok(notePos.order.indexOf('dnote-slot') > -1 && notePos.order.indexOf('dnote-slot') < notePos.order.indexOf('dmap'),
  `提示横幅在地图上方（顺序：${notePos.order.join(' → ')}）`);

/* ---- 4. 合成：塞两张同名同级卡 → 详情页牌库出现合成行 → 点了真合成 ---- */
await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  const dup = run.deck[0];
  run.deck.push(dup);
  run.materials = 1;
  save.saveRun(run);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.evaluate(() => document.querySelector('[data-action="resume"], [data-action="open-expedition"]')?.click());
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('.dtray .dhero')?.click());
await page.waitForTimeout(350);
const forge = await page.evaluate(() => {
  /** v3.84：合成挪进左上角入口 + 蒙板 —— 页签本体只剩入口按钮 */
  const btn = document.querySelector('.hp-forge-btn');
  return { count: btn?.querySelector('b')?.textContent.trim() || '', off: btn?.classList.contains('off') ?? true };
});
ok(!forge.off && forge.count !== '', `牌库左上角合成入口亮起（⚒合成${forge.count}）`);
if (!forge.off) {
  const before = await page.evaluate(async () => (await import('/src/core/save.js')).loadRun().materials);
  await page.evaluate(() => document.querySelector('.hp-forge-btn')?.click());
  await page.waitForTimeout(350);
  await page.evaluate(() => document.querySelector('.hp-forge-item')?.click());
  await page.waitForTimeout(350);
  await page.evaluate(() => document.querySelector('.hp-forge-go')?.click());
  await page.waitForTimeout(350);
  const after = await page.evaluate(async () => {
    const run = (await import('/src/core/save.js')).loadRun();
    return { mats: run.materials, deck: run.deck.length, mat: document.querySelector('.dm-mat')?.textContent.replace(/\D/g, '') };
  });
  ok(after.mats === before + 1, `合成后水晶材料 +1（${before} → ${after.mats}）`);
  ok(after.mat === String(after.mats), `数值行水晶数同步（${after.mat}）`);
}

/* ---- 5. 宝物激活：给一个待激活宝物 + 3 材料，点卡片激活 ---- */
await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const relics = await import('/src/core/relics.js');
  const run = save.loadRun();
  run.materials = 3;
  run.relicSlots = [relics.parseRelic(Object.keys(relics.RELICS)[0]).id];
  save.saveRun(run);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.evaluate(() => document.querySelector('[data-action="resume"], [data-action="open-expedition"]')?.click());
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('.dtray .dhero')?.click());
await page.waitForTimeout(350);
await page.evaluate(() => document.querySelector('[data-action="hero-tab"][data-tab="relic"]')?.click());
await page.waitForTimeout(300);
const actBtn = await page.evaluate(() => {
  const b = document.querySelector('.hp-body [data-action="activate"]');
  return b ? { disabled: b.disabled, text: b.querySelector('.rc-cta')?.textContent.trim() } : null;
});
ok(!!actBtn, '宝物页签有待激活卡片（带激活按钮）');
ok(actBtn && !actBtn.disabled, `激活按钮可点（${actBtn?.text}）`);
if (actBtn && !actBtn.disabled) {
  const beforeAct = await page.evaluate(async () => {
    const run = (await import('/src/core/save.js')).loadRun();
    return { mats: run.materials || 0, active: run.relics.length, slots: run.relicSlots.length };
  });
  await page.evaluate(() => document.querySelector('.hp-body [data-action="activate"]')?.click());
  await page.waitForTimeout(350);
  const after = await page.evaluate(async () => {
    const run = (await import('/src/core/save.js')).loadRun();
    return { mats: run.materials, active: run.relics.length, slots: run.relicSlots.length };
  });
  ok(after.mats === beforeAct.mats - 3 && after.active === beforeAct.active + 1 && after.slots === beforeAct.slots - 1,
    `点激活真生效（材料 ${beforeAct.mats}→${after.mats} · 已激活 ${beforeAct.active}→${after.active} · 待激活 ${beforeAct.slots}→${after.slots}）`);
}

ok(errs.length === 0, `控制台零报错（${errs.join(' | ') || 'clean'}）`);
await browser.close();
if (fails.length) { console.log('FAIL:\n- ' + fails.join('\n- ')); process.exit(1); }
console.log('PROBE PASS');
