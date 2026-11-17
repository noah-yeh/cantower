/**
 * 大厅 / 竞技场 —— DOM 渲染
 *
 * 和 battle.js 一样：纯函数返回 HTML 字符串，事件靠 data-action 冒泡。
 * 这一层只读 core 的数据，不改任何状态。
 */

import { CLASSES, RACES, LIVES_MIN, LIVES_MAX } from '../core/characters.js';
import { RELICS } from '../core/relics.js';
import { cardName } from '../core/cards.js';
import {
  ratingOf, PROBATION_LIMIT, VETERAN_LIMIT, hasRoom, arenaState, ARENA_MAX,
} from '../core/roster.js';
import { RANKS, scoreOf, rankOf, nextRankOf, dailyState, rankOfChar } from '../core/arena-rank.js';
import { GROWTH } from '../core/leveling.js';
import {
  RECRUIT_COST, REFRESH_COST, RECRUIT_CAP,
  RECRUIT_REGEN_MS, nextTicketIn, fmtDuration,
} from '../core/meta.js';
import { adState } from '../core/ads.js';
import { statsPanel, candidateStatsPanel } from './stats.js';
import { isMuted } from './audio.js';
import { BUILD } from './build.js';
import { fullscreenButton } from './fullscreen.js';
import {
  EQUIP_SLOTS, MAX_ENHANCE, enhanceCost, enhancePreview, equipStats,
  itemsOf, itemText, equipTitle, totalEnhanceCost, equipDef,
  recycleValue, SHARDS_PER_STARDUST, EQUIP_RARITY,
} from '../core/equipment.js';
import { manorState, MANOR_CAP, MANOR_INTERVAL_MS, manorTitle } from '../core/manor.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------------------------------------------ *
 * 通用片段
 * ------------------------------------------------------------------ */

function livesHtml(ch) {
  let s = '';
  for (let i = 0; i < ch.maxLives; i++) {
    s += `<i class="pip${i < ch.lives ? ' on' : ''}"></i>`;
  }
  return `<span class="lives" title="命数 ${ch.lives}/${ch.maxLives}">${s}</span>`;
}

function relicDots(ch) {
  const total = ch.relics.length + (ch.relicSlots?.length || 0);
  const on = ch.relics.length;
  let s = '';
  for (let i = 0; i < total; i++) s += `<i class="rdot${i < on ? ' on' : ''}"></i>`;
  return s;
}

function classTag(raceId, classId) {
  const race = RACES[raceId];
  const cls = CLASSES[classId];
  return `${race?.name ?? raceId}${cls?.name ?? classId}`;
}

/* ------------------------------------------------------------------ *
 * 大厅
 * ------------------------------------------------------------------ */

/* ---------------- 大厅入口图标（v3.6） ----------------
 * 单色线条 SVG，和 v3 皮肤的描边语言一致。
 * 用 SVG 而不是 emoji：emoji 在不同手机上长得完全不一样，配色也会跳出石板底。
 */
const ICON_PEOPLE = `<svg class="hg-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="9" cy="8" r="2.6"/><path d="M4.4 17.4c0-2.4 2-4.3 4.6-4.3s4.6 1.9 4.6 4.3"/>
  <circle cx="16.9" cy="9.6" r="2"/><path d="M14.2 17.4c0-1.9 1.2-3.4 2.9-3.4s2.9 1.5 2.9 3.4"/></svg>`;

const ICON_MANOR = `<svg class="hg-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M3 11.2 12 4l9 7.2"/><path d="M6 10.4V20h12v-9.6"/><path d="M10 20v-4.6h4V20"/></svg>`;

const ICON_GRAVE = `<svg class="hg-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M7.5 20.5V10a4.5 4.5 0 0 1 9 0v10.5"/><path d="M4.4 20.5h15.2"/>
  <path d="M12 8.4v5.2"/><path d="M9.8 10.4h4.4"/></svg>`;

const ICON_AD = `<svg class="hg-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="8.4"/><path d="M10.2 8.6 16 12l-5.8 3.4z" fill="currentColor" stroke="none"/></svg>`;

/** 冒险：剑（塔里唯一真正解决问题的东西） */
const ICON_SWORD = `<svg class="hg-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M19.4 4.6 9.2 14.8"/><path d="M15.4 4h5v5l-5.6 5.6-4.4-4.4z"/>
  <path d="M6.2 15.2 3 18.4l2.6 2.6 3.2-3.2"/><path d="M6.6 12.6 11.4 17.4"/></svg>`;

/** 竞技场：两把交叉的剑 */
const ICON_DUEL = `<svg class="hg-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4.2 4.2h5.2l9.4 9.4-2.6 2.6L4.2 6.8z"/><path d="M19.8 4.2h-5.2L5.2 13.6l2.6 2.6Z"/>
  <path d="M6.4 21l2.4-2.4"/><path d="M17.6 21 15.2 18.6"/></svg>`;

/** 图鉴：打开的书 */
const ICON_BOOK = `<svg class="hg-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 6.4C10.2 5.1 7.9 4.6 4.4 4.8v12.6c3.5-.2 5.8.3 7.6 1.6 1.8-1.3 4.1-1.8 7.6-1.6V4.8c-3.5-.2-5.8.3-7.6 1.6Z"/>
  <path d="M12 6.4v12.6"/></svg>`;

/**
 * 大厅（v3.6：入口全部收成图标格）
 *
 * 「清爽」的具体含义：首屏只有三块 —— 进度条（有探险才出现）、四个图标入口、招募。
 * 原来平铺的广告横幅、营地行、庄园行、墓地点、以及那一大段规则文字全部让位：
 * 前者变成格子，后者收进右上角「?」。
 */
export function renderHall(meta, ui = {}) {
  const now = ui.now ?? Date.now();
  const roster = meta.roster.filter((c) => c.status !== 'dead');
  const running = meta.run ? roster.find((c) => c.id === meta.run.characterId) : null;
  const room = hasRoom(meta.roster);
  /**
   * 招募名额（v3.5）：一次只出一个人。
   *
   * 这里只是读 —— 真正的消耗在 core/recruitCandidate 里。
   * `nextIn` 为 0 表示名额已满（满额停工，不再倒计时）。
   */
  const tickets = Math.max(0, Math.min(RECRUIT_CAP, Math.floor(Number(meta.tickets ?? RECRUIT_CAP))));
  const nextIn = tickets >= RECRUIT_CAP ? 0 : nextTicketIn(meta, now);

  const probation = roster.filter((c) => !c.veteran);
  const veterans = roster.filter((c) => c.veteran);

  return `
  <div class="hall">
    <div class="hall-top">
      <div class="gold-box"><img class="ico-gold" src="assets/img/icons/gold.png" alt=""><b>${meta.gold}</b></div>
      <div class="hall-title">大厅</div>
      <button class="icon-btn snd-btn${isMuted() ? ' off' : ''}" data-action="toggle-sound"
        aria-pressed="${isMuted() ? 'false' : 'true'}"
        aria-label="${isMuted() ? '声音已关闭，点击开启' : '声音已开启，点击静音'}">♪</button>
      ${fullscreenButton()}
      <button class="icon-btn help-btn" data-action="toggle-help" aria-label="玩法速查">?</button>
    </div>

    ${ui.flash ? `<div class="flash">${esc(ui.flash)}</div>` : ''}

    ${/*
      主视觉（v3.7）：原画横幅占掉首页剩下的全部富余高度 ——
      首页不滚动，屏幕越高画越大，它就是"想玩"的第一眼。
      标题和一句世界观短句压在画上。
    */ ''}
    <div class="hall-hero" aria-hidden="true">
      <div class="hh-title">残 塔</div>
      <div class="hh-sub">活着回来，才算数</div>
    </div>

    <div class="hall-scroll">
      ${/*
        进行中的探险是一条**状态**，不是一个功能 —— 所以它不做成格子，
        而是横在最上面：暂停回大厅之后，回塔不该还要先进营地再找人。
      */ ''}
      ${running ? `
      <button class="resume-row${meta.run?.paused ? ' paused' : ''}" data-action="resume">
        <span class="rr-ico">▶</span>
        <span class="rr-main">
          <b>${esc(running.name)}</b>
          <span class="rr-sub">${meta.run?.paused ? '已暂停' : '探险中'} · 第 ${meta.run?.floor ?? 1} 层</span>
        </span>
        <span class="rr-go">回塔</span>
      </button>` : ''}

      ${/*
        两个主动作（v3.8）：冒险 / 竞技场是玩家每天真正在做的两件事，
        按用户要求独立成入口、各带图标 —— 不再藏在营地角色卡里。
      */ ''}
      <div class="hall-acts">
        ${mainAct('open-expedition', ICON_SWORD, '冒险',
    expeditionSub(probation, running))}
        ${mainAct('open-arena', ICON_DUEL, '竞技场',
    arenaSub(veterans, now))}
      </div>

      ${/* 次级入口：管理类功能，一行 6 个小图标（v3.89 加「种族」） */ ''}
      <div class="hall-tools">
        ${toolBtn('open-roster', ICON_PEOPLE, '营地', roster.length ? `${probation.length}/${PROBATION_LIMIT}` : '')}
        ${toolBtn('open-codex', ICON_BOOK, '图鉴')}
        ${toolBtn('open-manor', ICON_MANOR, '庄园', (meta.manors || []).length)}
        ${toolBtn('open-grave', ICON_GRAVE, '墓地', meta.graveyard.length)}
        ${adTool(meta, now)}
      </div>

      <div class="sec-head" style="margin-top:16px">
        ${/*
          v3.68：「招募」这块牌子本身就是按钮 —— 有候选人在时点它会提示
          "先把眼前这位处理掉"，比一个纯装饰标题多给一次入口。
        */ ''}
        <button class="sec-title-btn" data-action="recruit" aria-label="招募一位冒险家">招募</button>
        <span class="sec-sub">
          名额 <b class="ticket-n">${tickets}</b>/${RECRUIT_CAP}${nextIn
            ? ` · <span class="cd" data-cd="${now + nextIn}">${fmtDuration(nextIn)}</span> 后 +1`
            : ' · 已满'}
        </span>
      </div>

      ${/*
        招募槽（v3.9.4）：候选人=卡片+按钮行（约 199px），空位 CTA 只有 112px，
        两者直接互换会把富余高度全灌给原画 —— 整屏跟着伸缩。
        套一个恒定最小高的槽位，屏幕就真正不动了。
      */ ''}
      <div class="recruit-slot">
        ${meta.candidate
          ? candidateBox(meta.candidate, room, meta.gold, tickets)
          : recruitCta(tickets, nextIn, room)}
      </div>
    </div>

    ${ui.help ? helpSheet() : ''}
    ${ui.candStats && meta.candidate ? candidateStatsPanel(meta.candidate) : ''}
    ${ui.statsCharId ? statsPanel(meta, ui.statsCharId) : ''}
  </div>`;
}

/** 主动作按钮：图标 + 名称 + 状态副标题 */
function mainAct(action, icon, label, sub) {
  return `
  <button class="ha" data-action="${action}">
    <span class="ha-ico">${icon}</span>
    <span class="ha-main">
      <b>${label}</b>
      <span>${sub}</span>
    </span>
  </button>`;
}

/** 小图标入口：图标在上、名字在下，右侧可选计数 */
function toolBtn(action, icon, label, num = '') {
  return `
  <button class="ht" data-action="${action}">
    <span class="ht-ico">${icon}</span>
    <span class="ht-label">${label}${num !== '' ? `<i>${num}</i>` : ''}</span>
  </button>`;
}

/** 冒险的副标题：有探险在跑就提示那个，否则数"能派几个人" */
function expeditionSub(probation, running) {
  if (running) return '探险进行中 · 点上方继续';
  if (!probation.length) return '没有实习生可派';
  return `${probation.length} 位实习生待命`;
}

/** 竞技场的副标题：所有转正角色今天剩下的次数合计（v3.93：每日刷新） */
function arenaSub(veterans, now = Date.now()) {
  if (!veterans.length) return '还没有转正角色';
  const left = veterans.reduce((n, c) => n + (arenaState(c, now).left ?? 0), 0);
  return left > 0 ? `今日剩 ${left} 次` : '今日次数已用完';
}

/** 广告入口：能看时是"看一次 +30"，看完了变灰留着（明天还在，不是没了） */
function adTool(meta, now) {
  const st = adState(meta, now);
  const off = st.left <= 0;
  return `
  <button class="ht ad${off ? ' off' : ''}" data-action="open-shop">
    <span class="ht-ico">${ICON_AD}</span>
    <span class="ht-label">商城<i>${off ? '明日再来' : `广告 +${st.reward}`}</i></span>
  </button>`;
}

/** 玩法速查：把原来摊在大厅底部的长说明收进这里 */
function helpSheet() {
  /* 静态资源按 sharecode 门禁：链接必须把当前查询串带上，否则站点返回占位页 */
  const q = typeof location !== 'undefined' ? location.search : '';
  return `
  <div class="help-sheet">
    <div class="hs-card">
      <div class="hs-head">玩法速查</div>
      <div class="hs-body">
        <p><b>招募</b>　点一次消耗 1 个名额，一次来一位 —— 雇佣花金币，或者婉拒（免费，名额不退）。
          名额每 ${fmtDuration(RECRUIT_REGEN_MS)} 恢复 1 个，最多存 ${RECRUIT_CAP} 个。
          不想雇又舍不得名额，可以花 ${REFRESH_COST} 金换一位。</p>
        <p><b>种族</b>决定命数（招募时随机 ${LIVES_MIN}~${LIVES_MAX} 条）与两件未激活宝物，
          <b>职业</b>决定牌库与天赋。
          面板属性（防御 / 暴击 / 闪避 / 恢复）在招募时按职业基础值 ±1 掷定，
          <b>能量上限</b>则掷 5~8 —— 点候选人的种族头像可以看全九项属性。</p>
        <p><b>实习与转正</b>　新招的人是实习生，只能去探险；活着从塔里回来一次才转正，
          之后塔会关闭，只能打竞技场（每天 8 次，0 点回满）。</p>
        <p><b>命数</b>　进塔本身不扣命 —— 只有阵亡才 -1，中途放弃按阵亡算。
          阵亡时这一趟的成长、卡牌、宝物全部回滚，但<b>装备会留下</b>。</p>
        <p><b>装备与庄园</b>　最多穿 2 件，强化上限 +10，材料（星屑）只由庄园产出；
          庄园来自已转正角色的退役转化。</p>
        <p><b>图鉴</b>　四个页签：<b>卡牌</b>（通用 + 四职业，含职业天赋）/ <b>种族</b>
          （看图 + 解锁升级）/ <b>宝物</b> / <b>装备</b>，数值随版本自动同步。</p>
        <p><b>全屏</b>　顶栏的 ⛶ 能藏掉浏览器地址栏；想更彻底就把它装成应用：
          安卓 Chrome / Edge 菜单里「安装应用」，iPhone 用 Safari 的「分享 → 添加到主屏幕」，
          之后从桌面图标进来就没有上下框了。</p>
        <p class="hs-build">构建 ${BUILD}　·　看到旧图或没声音，多半是缓存没换：关掉页面重开一次即可。</p>
        <p class="hs-legal"><a href="legal/privacy.html${q}" target="_blank" rel="noopener">隐私政策</a>　·　<a href="legal/terms.html${q}" target="_blank" rel="noopener">用户协议</a>　·　本游戏为纯单机，进度只存在本机，不收集任何信息</p>
      </div>
      <button class="btn ghost wide" data-action="toggle-help">知道了</button>
      <button class="btn ghost wide hs-hard" data-action="hard-reload">没更新？强制更新一次</button>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ *
 * 冒险（v3.8：首页独立入口，先选人再进塔）
 * ------------------------------------------------------------------ */

/**
 * 派谁去爬塔。
 *
 * 首页的「冒险」不再直接开局 —— 实习生可能有 3 个，谁去是玩家的事。
 * 这一页只列**实习生**：转正的人塔已经关闭（规则如此，见 roster.canExplore）。
 */
export function renderExpedition(meta, ui = {}) {
  const now = ui.now ?? Date.now();
  const roster = meta.roster.filter((c) => c.status !== 'dead');
  const interns = roster.filter((c) => !c.veteran);
  const running = meta.run ? roster.find((c) => c.id === meta.run.characterId) : null;

  const rows = interns.map((ch) => {
    const race = RACES[ch.raceId];
    const cls = CLASSES[ch.classId];
    const isRunning = running?.id === ch.id;
    return `
    <div class="ex-card${isRunning ? ' running' : ''}" data-action="open-char" data-id="${ch.id}"
      role="button" tabindex="0" aria-label="查看 ${esc(ch.name)} 的详情">
      ${raceFace(ch.raceId)}
      <div class="ex-main">
        <div class="ex-name">
          <b>${esc(ch.name)}</b>
          <span class="ex-tag">${esc(race?.name ?? ch.raceId)}${esc(cls?.name ?? ch.classId)}</span>
          ${livesHtml(ch)}
        </div>
        <div class="ex-meta">
          生命 ${ch.maxHp} · 攻击 ${ch.atk} · 第 ${(ch.record?.exploreCount ?? 0) + 1} 次进塔 ·
          最远 ${ch.record?.bestFloor ?? 0} 层
        </div>
      </div>
      ${isRunning
        ? '<button class="btn primary ex-go" data-action="resume">继续</button>'
        : running
          ? '<button class="btn disabled ex-go" disabled>等待中</button>'
          : `<button class="btn primary ex-go" data-action="explore" data-id="${ch.id}">出发</button>`}
    </div>`;
  }).join('');

  return `
  <div class="hall">
    <div class="hall-top">
      <button class="icon-btn" data-action="back-hall">返回</button>
      <div class="hall-title">冒险</div>
      <span class="top-count">${interns.length} 人待命</span>
    </div>

    ${ui.flash ? `<div class="flash">${esc(ui.flash)}</div>` : ''}

    <div class="hall-scroll">
      <p class="rtab-hint">
        派一位<b>实习生</b>进塔 —— 30 层，一条命，活着回来才算数。
        阵亡扣 1 条命并清空这一趟的成长，但<b>捡到的装备会留下</b>。
      </p>
      ${running ? `<div class="ex-note">${esc(running.name)} 正在塔里（第 ${meta.run?.floor ?? 1} 层）—— 一次只能派一个人，先把他接回来或等他结束。</div>` : ''}
      ${rows || '<div class="empty">没有可派的实习生 —— 回大厅招募一位。</div>'}
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ *
 * 竞技场（v3.8：首页独立入口，先选人再匹配）
 * ------------------------------------------------------------------ */

/** 段位徽章（v3.35）：色点 + 段位名，颜色由 --rk 变量注入 */
function rankBadge(score, cls = '') {
  const r = rankOf(score);
  return `<span class="rank-badge${cls ? ` ${cls}` : ''}" style="--rk:${r.color}"><i></i>${r.name} ${Math.round(score)}</span>`;
}

export function renderArenaRoster(meta, ui = {}) {
  const now = ui.now ?? Date.now();
  const roster = meta.roster.filter((c) => c.status !== 'dead');
  const veterans = roster.filter((c) => c.veteran);
  const totalLeft = veterans.reduce((n, c) => n + (arenaState(c, now).left ?? 0), 0);

  const rows = veterans.map((ch) => {
    const race = RACES[ch.raceId];
    const cls = CLASSES[ch.classId];
    const ar = arenaState(ch, now);
    const daily = dailyState(meta, ch, now);
    const place = rankOfChar(meta, ch);
    return `
    <div class="ex-card" data-action="open-char" data-id="${ch.id}"
      role="button" tabindex="0" aria-label="查看 ${esc(ch.name)} 的详情">
      ${raceFace(ch.raceId)}
      <div class="ex-main">
        <div class="ex-name">
          <b>${esc(ch.name)}</b>
          <span class="ex-tag">${esc(race?.name ?? ch.raceId)}${esc(cls?.name ?? ch.classId)}</span>
        </div>
        <div class="ex-meta">
          ${rankBadge(ch.arenaScore ?? scoreOf(ch))}
          ${place ? ` · 榜上第 ${place.rank}/${place.total}` : ''} ·
          ${ch.record.arenaWins}胜${ch.record.arenaLosses}负 ·
          ${ar.left > 0 ? `今日 ${ar.left}/${ARENA_MAX} 次` : `<span class="regen">今日次数已用完</span>`}
        </div>
      </div>
      <div class="ex-actions">
        ${daily.claimed
          ? `<button class="btn disabled ex-go" aria-label="今日已领">今日已领</button>`
          : `<button class="btn ghost ex-go" data-action="arena-daily" data-id="${ch.id}"
              title="按当前段位每日领取">每日 +${daily.gold}</button>`}
        <button class="btn ${ar.left > 0 ? 'primary' : 'disabled'} ex-go" data-action="arena" data-id="${ch.id}">
          ${ar.left > 0 ? '挑战' : '明天再来'}
        </button>
      </div>
    </div>`;
  }).join('');

  return `
  <div class="hall">
    <div class="hall-top">
      <button class="icon-btn" data-action="back-hall">返回</button>
      <div class="hall-title">竞技场</div>
      <span class="top-count">今日剩 ${totalLeft} 次</span>
    </div>

    ${ui.flash ? `<div class="flash">${esc(ui.flash)}</div>` : ''}

    <div class="hall-scroll">
      <p class="rtab-hint">
        已转正的角色才能上场（塔对他们关闭了）。对手是其他玩家留下的影子，
        <b>按段位分就近匹配</b>；每人每天 ${ARENA_MAX} 次，0 点回满。
        胜负按 Elo 结算段位分，段位越高每日奖励越多。
      </p>
      ${rows || '<div class="empty">还没有转正角色 —— 先让一位实习生活着从塔里回来。</div>'}
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ *
 * 营地（v3.4 独立成页；v3.66 改成头像卡网格 + 点开看详情）
 *
 * 用户：「营地页面可以顶到最上面不需要展示上面的塔背景了，按照卡片形式展示
 * 不需要展示这么多文字按钮点击头像进去查看其他的东西」。
 *
 * 之前每张卡是"头像 + 一行 8 项数值 + 一行履历 + 4 个按钮"的密集版面，
 * 6 个人滚好几屏才看得完，而大部分文字（生命/攻击/知识/幸运…）玩家只有在
 * "比较两个人"的时候才看。所以首页只留**身份**：头像、名字、等级、命数；
 * 点卡片（头像）进详情，才摊开 9 项属性、天赋、卡组/宝物/装备和动作按钮。
 * ------------------------------------------------------------------ */

/** 营地里的一张卡：只回答"这是谁、几级、还有几条命" */
function campCard(ch, { running = false } = {}) {
  return `
  <button class="camp-card${ch.veteran ? ' veteran' : ' probation'}${running ? ' running' : ''}"
    data-action="open-char" data-id="${ch.id}" aria-label="查看 ${esc(ch.name)} 的详情">
    <span class="cc-face">${raceFace(ch.raceId)}</span>
    <span class="cc-name">${esc(ch.name)}</span>
    <span class="cc-sub"><i>Lv.${ch.level || 1}</i>${livesHtml(ch)}</span>
    ${running ? '<span class="cc-flag">塔中</span>' : ''}
  </button>`;
}

/**
 * 营地卡打开的是**角色详情页**（v3.67，hero.js）：参照原作的角色页 —— 立绘居中 +
 * 装备槽 + 生命/攻击/能量条 + 装备/角色/宝物页签。冒险 / 竞技场名册的角色行、
 * 竞技场对手、战斗页玩家头像共用同一副骨架（data-action="open-char" / "open-ghost"）。
 */

export function renderRoster(meta, ui = {}) {
  const now = ui.now ?? Date.now();
  const roster = meta.roster.filter((c) => c.status !== 'dead');
  const running = meta.run ? roster.find((c) => c.id === meta.run.characterId) : null;

  const probation = roster.filter((c) => !c.veteran);
  const veterans = roster.filter((c) => c.veteran);
  /** 默认停在有人的那一边：全转正了还停在空的"实习"tab 会像出 bug */
  const fallback = probation.length ? 'probation' : 'veteran';
  const tab = ui.tab === 'veteran' || ui.tab === 'probation' ? ui.tab : fallback;
  const list = tab === 'veteran' ? veterans : probation;

  /** 正在探险的人排最前 —— 他是唯一"有进展"的角色 */
  const byRunFirst = (a, b) => (b.id === running?.id ? 1 : 0) - (a.id === running?.id ? 1 : 0);

  return `
  <div class="hall">
    <div class="hall-top">
      <button class="icon-btn" data-action="back-hall">返回</button>
      <div class="hall-title">营地</div>
      <span class="top-count">共 <b>${roster.length}</b> 人</span>
    </div>

    ${ui.flash ? `<div class="flash">${esc(ui.flash)}</div>` : ''}

    <div class="rtabs">
      <button class="rtab${tab === 'probation' ? ' on' : ''}" data-action="roster-tab" data-tab="probation">
        实习 <b>${probation.length}</b><i>/${PROBATION_LIMIT}</i>
      </button>
      <button class="rtab${tab === 'veteran' ? ' on' : ''}" data-action="roster-tab" data-tab="veteran">
        转正 <b>${veterans.length}</b><i>/${VETERAN_LIMIT}</i>
      </button>
    </div>

    <div class="hall-scroll camp-scroll">
      ${list.length
        ? `<div class="camp-grid">${list.slice().sort(byRunFirst).map((c) => campCard(c, { running: c.id === running?.id })).join('')}</div>`
        : `<div class="empty">${tab === 'probation' ? '还没有实习生 —— 回大厅招一个。' : '还没有人转正 —— 先让实习生活着回来。'}</div>`}
    </div>

  </div>`;
}

/**
 * 招募按钮（眼前没人时）。
 *
 * 名额为 0 或营地已满时不是"禁用"而是"变灰但可点" —— 点一下会 flash
 * 出原因（还差几分几秒 / 满员要退役谁），比一个点不动的按钮好懂。
 */
function recruitCta(tickets, nextIn, room) {
  const off = tickets < 1 || !room;
  const sub = !room
    ? `实习位已满（${PROBATION_LIMIT} 人）—— 让实习生转正，或等有人阵亡空出位置`
    : tickets < 1
      ? `名额用完，${fmtDuration(nextIn)} 后恢复 1 个`
      : '花 1 个名额看看是谁 —— 不满意可以婉拒';
  return `
  <button class="recruit-cta${off ? ' off' : ''}" data-action="recruit">
    <span class="rc-ico">${off ? '·' : '+'}</span>
    <span class="rc-main">
      <span class="rc-title">招募一位冒险家</span>
      <span class="rc-sub">${sub}</span>
    </span>
    <span class="rc-ticket">${tickets}<i>名额</i></span>
  </button>`;
}

/**
 * 眼前的候选人（v3.5）。
 *
 * 一次只有一位 —— 所以可以把他摊开讲清楚：种族、职业、命数、面板、两个未激活宝物、
 * 每级成长。旧版 6 张卡并排时这些只能压缩成一行缩写。
 */
function candidateBox(ch, room, gold, tickets) {
  const race = RACES[ch.raceId];
  const cls = CLASSES[ch.classId];
  const rollTag = ch.hpRoll >= 1.03 ? '优' : ch.hpRoll <= 0.97 ? '劣' : '';
  const panel = [
    ch.def > 0 ? `防御 ${ch.def}` : '',
    ch.crit > 0 ? `暴击 ${ch.crit}%` : '',
    ch.dodge > 0 ? `闪避 ${ch.dodge}%` : '',
    ch.recovery > 0 ? `恢复 ${ch.recovery}` : '',
  ].filter(Boolean).join(' · ');
  const poor = gold < RECRUIT_COST;
  const canHire = room && !poor;

  return `
  <div class="cand${room ? '' : ' locked'}">
    <button class="cand-face" data-action="cand-stats" aria-label="查看候选人的全部属性" title="查看全部属性">${raceFace(ch.raceId)}<span class="face-more">属性</span></button>
    <div class="cand-main">
      <div class="slot-name">
        ${esc(race?.name ?? ch.raceId)}<b>${esc(cls?.name ?? ch.classId)}</b>
        ${livesHtml(ch)}
        <span class="slot-lv">${esc(cls?.tag ?? '')}</span>
      </div>
      <div class="slot-stats">
        生命 <b>${ch.maxHp}</b>${rollTag ? `<i class="roll ${rollTag}">${rollTag}</i>` : ''}
        攻击 <b>${ch.atk}</b> · 能量 <b>${ch.energy ?? 8}</b>${panel ? ` · ${panel}` : ''}
      </div>
      <div class="slot-relics">${ch.relicSlots.map((id) => `<span class="rl off">${RELICS[id]?.name ?? id}</span>`).join('')}</div>
      <div class="slot-sub">每级 ${GROWTH[ch.classId]?.text ?? '—'}</div>
    </div>
  </div>

  <div class="cand-acts">
    <button class="btn primary hire-btn${canHire ? '' : ' off'}" data-action="hire">
      ${room ? (poor ? `金币不足 · 需 ${RECRUIT_COST}` : `雇佣 · ${RECRUIT_COST} 金`) : '营地已满'}
    </button>
    <button class="btn ghost" data-action="dismiss">婉拒</button>
    <button class="btn mini" data-action="refresh" title="不消耗名额">换一位 · ${REFRESH_COST}</button>
  </div>`;
}

/**
 * 种族立绘小头像（v3.1 美术素材；形象按种族出，职业只换配件）
 *
 * v3.67：营地首页只留头像卡，数值与动作都在角色详情页（hero.js）里 ——
 * 属性数值走 `attrRows`，和局内/候选人是同一张 9 项表，不再各自拼一份。
 */
const raceFace = (raceId) => `<img class="race-face" src="assets/img/races/${raceId}.webp" alt="">`;


/* ------------------------------------------------------------------ *
 * 装备（v2.3）
 * ------------------------------------------------------------------ */

/**
 * 一行装备。
 *
 * @param {'worn'|'idle'|'other'} mode 自己身上 / 库里闲的 / 别人身上的
 */
export function equipRow(item, mode, { stardust = 0, slotsFull = false, ownerName = '' } = {}) {
  const def = equipDef(item.defId) || { name: item.defId, slot: '' };
  const lv = item.lv || 0;
  const preview = enhancePreview(item);
  const cost = preview?.cost ?? 0;
  const maxed = !preview;
  const afford = stardust >= cost;
  const rar = EQUIP_RARITY[def.rar || 'common'] || EQUIP_RARITY.common;

  const wear = mode === 'worn'
    ? `<button class="btn mini" data-action="unequip-item" data-id="${item.id}">卸下</button>`
    : mode === 'idle'
      /** v3.73：穿满也能点 —— equipItem 会自动换位（优先同槽位），不再 disabled */
      ? `<button class="btn mini" data-action="equip-item" data-id="${item.id}">穿上</button>`
      : '';
  /** 只有闲置的能回收 —— 穿着的先卸下，给玩家一次反悔机会 */
  const recycle = mode === 'idle'
    ? `<button class="btn mini ghost" data-action="recycle-item" data-id="${item.id}">回收 ${recycleValue(item)}✧</button>`
    : '';

  return `
  <div class="eq-row ${mode}">
    <img class="eq-ico" src="assets/img/equip/${item.defId}.png" alt="">
    <div class="eq-main">
      <div class="eq-name">
        ${esc(def.name)}${lv > 0 ? `<i class="eq-lv">+${lv}</i>` : ''}
        <span class="eq-slot">${esc(def.slot)}</span>
        ${rar.label ? `<span class="eq-rar ${rar.cls}">${rar.label}</span>` : ''}
      </div>
      <div class="eq-line">
        ${esc(itemText(item))}
        ${maxed
          ? '<span class="eq-max">已满级</span>'
          : `<span class="eq-up">下一级 ${esc(preview.text)}</span>`}
      </div>
      ${mode === 'other' ? `<div class="eq-wearer">${esc(ownerName)} 穿戴中</div>` : ''}
    </div>
    <div class="eq-acts">
      ${wear}
      <button class="btn mini${maxed || !afford ? ' disabled' : ''}" data-action="enhance-item" data-id="${item.id}">
        ${maxed ? '满级' : `强化 +${lv + 1} · ${cost}✦`}
      </button>
      ${recycle}
    </div>
  </div>`;
}

/**
 * 装备页（按角色）。
 *
 * 为什么按角色而不是一个全局仓库：
 * 这一版只有一件"操作"——给谁穿。按角色进来，玩家一眼看到"他还差几件"，
 * 不用先选角色再选装备。装备库仍然全局共享，只是列表按"这个人能不能穿"分了三档。
 */
export function renderEquip(meta, ch, ui = {}) {
  const worn = itemsOf(meta, ch.id);
  const stardust = meta.stardust || 0;
  const shards = meta.shards || 0;
  const idle = (meta.equipment || []).filter((it) => !it.by);
  const canCombine = shards >= SHARDS_PER_STARDUST;

  return `
  <div class="hall">
    <div class="hall-top">
      <button class="icon-btn" data-action="back-hall">返回</button>
      <div class="hall-title">装备库 · ${esc(ch.name)}</div>
      <div class="gold-box sd"><img class="sd-img" src="assets/img/icons/shard.png" alt="碎片"><b>${shards}</b></div>
      <div class="gold-box sd"><img class="sd-img" src="assets/img/icons/stardust.png" alt="星屑"><b>${stardust}</b></div>
    </div>
    <div class="hall-scroll">
      <!-- v3.72（用户：「装备库只需展示装备的仓库就行了」）：已穿戴 / 别人穿着的
           两段删除，这里只剩仓库。身上穿着在角色详情页顶部两个槽位看；
           穿满 2 件再穿会自动换位（equipment.js equipItem），穿 = 换、脱 = 穿另一件。 -->
      <div class="sec-head">
        <span>装备仓库</span>
        <span class="sec-sub">${idle.length} 件闲置 / 共 ${(meta.equipment || []).length} · 身上 ${worn.length}/${EQUIP_SLOTS}</span>
      </div>
      ${canCombine
        ? `<div class="combine-row">
             碎片 ${shards}✧ 够合成了
             <button class="btn mini" data-action="combine-shards">合成 1✦ 星屑</button>
           </div>`
        : ''}
      ${idle.length
        ? idle.map((it) => equipRow(it, 'idle', { stardust, slotsFull: false })).join('')
        : '<div class="empty small">库里没有闲置的装备。宝箱和精英/首领身上会有。</div>'}

      <p class="hint">
        最多穿 <b>${EQUIP_SLOTS}</b> 件；穿满后再点「穿上」会<b>自动换下</b>一件
        （优先同槽位）。强化上限 <b>+${MAX_ENHANCE}</b>，第 N 级正好要 <b>N</b> 个星屑
        （+0 到 +10 一共 ${totalEnhanceCost()} 个）。<br>
        装备是<b>账号资产</b>：在塔里捡到就进了装备库，角色阵亡或放弃都不会丢，
        只会从他身上脱下来还给下一个人。<br>
        重复的装备可以<b>回收</b>成星屑碎片✧，<b>${SHARDS_PER_STARDUST} 个碎片合成 1 个星屑</b> ——
        只是零头，星屑的大头还是要靠庄园。<br>
        星屑主要靠<b>庄园</b>产出：把已转正的角色送去退役，每小时 1 个。
      </p>

      <div class="sec-head" style="margin-top:16px">
        <span>庄园</span>
        <span class="sec-sub">退役换星屑 · 1 个 / 小时</span>
      </div>
      ${ch.veteran
        ? (ui.confirmConvert
          ? `<div class="convert-box warn-box">
               <div class="cb-text">让 <b>${esc(ch.name)}</b> 退役？他会离开名册、不再能打竞技场，只产出星屑。</div>
               <div class="cb-acts">
                 <button class="btn danger" data-action="convert-manor" data-id="${ch.id}">确认退役 · 不可逆</button>
                 <button class="btn ghost" data-action="cancel-convert">再想想</button>
               </div>
             </div>`
          : `<div class="convert-box">
               <div class="cb-text">已转正。可以送去退役开一座庄园 —— 每小时产 1 个星屑，代价是这个角色从此不能出战。</div>
               <button class="btn ghost" data-action="ask-convert" data-id="${ch.id}">退役成庄园</button>
             </div>`)
        : '<div class="convert-box off"><div class="cb-text">还是试用期。活着从塔里回来一次（转正）之后，才能退役成庄园。</div></div>'}
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ *
 * 庄园（v2.3）
 * ------------------------------------------------------------------ */

export function renderManor(meta, ui = {}) {
  const now = ui.now ?? Date.now();
  const manors = meta.manors || [];

  const rows = manors.map((m, i) => {
    const st = manorState(m, now);
    const nextAt = st.full ? 0 : (m.lastAt ?? now) + MANOR_INTERVAL_MS;
    return `
    <div class="manor-row">
      <div class="m-main">
        <div class="m-name">${esc(manorTitle(m))}</div>
        <div class="m-sub">
          库存 <b>${st.stored}</b>/${MANOR_CAP}
          ${st.full
            ? ' · <span class="m-full">满了，暂时停产</span>'
            : ` · <span class="cd" data-cd="${nextAt}">${fmtDuration(st.nextIn)}</span> 后 +1`}
        </div>
      </div>
      <button class="btn mini${st.stored > 0 ? ' primary' : ' disabled'}" data-action="collect-manor" data-index="${i}">
        ${st.stored > 0 ? `收取 ${st.stored}` : '等待产出'}
      </button>
    </div>`;
  }).join('');

  return `
  <div class="hall">
    <div class="hall-top">
      <button class="icon-btn" data-action="back-hall">返回</button>
      <div class="hall-title">庄园</div>
      <div class="gold-box sd"><img class="sd-img" src="assets/img/icons/stardust.png" alt="星屑"><b>${meta.stardust || 0}</b></div>
    </div>
    <div class="hall-scroll">
      <div class="sec-head"><span>在产的庄园</span><span class="sec-sub">${manors.length} 座</span></div>
      ${manors.length ? rows : '<div class="empty">还没有庄园。</div>'}
      <p class="hint">
        每座庄园 <b>${fmtDuration(MANOR_INTERVAL_MS)}</b> 产 1 个星屑，最多存 <b>${MANOR_CAP}</b> 个 ——
        存满就停产，不会离线累积。<br>
        星屑只用来强化装备，是这套系统里最慢的一条线：一件 +${MAX_ENHANCE} 要 ${totalEnhanceCost()} 个，
        单座庄园得不眠不休 ${Math.round(totalEnhanceCost() * MANOR_INTERVAL_MS / 3600000)} 小时。<br>
        <b>怎么开庄园</b>：把一个已转正的角色，在他的「装备」页最下面「退役成庄园」。
        角色会离开名册，不能反悔。
      </p>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ *
 * 竞技场
 * ------------------------------------------------------------------ */

export function renderArenaPick(meta, ch, opponents, ui = {}) {
  const now = ui.now ?? Date.now();
  const score = ch.arenaScore ?? scoreOf(ch);
  const rank = rankOf(score);
  const next = nextRankOf(score);
  const place = rankOfChar(meta, ch);
  const daily = dailyState(meta, ch, now);
  const nextHint = next
    ? `距${next.name}还差 ${next.min - score} 分`
    : '已是最高段位';
  return `
  <div class="hall">
    <div class="hall-top">
      <button class="icon-btn" data-action="back-hall">返回</button>
      <div class="hall-title">竞技场 · ${esc(ch.name)}</div>
      <div class="gold-box"><span class="pip on"></span><b>${ch.lives}</b></div>
    </div>
    <div class="hall-scroll">
      <div class="rank-panel" style="--rk:${rank.color}">
        <div class="rank-main">
          <span class="rank-badge big" style="--rk:${rank.color}"><i></i>${rank.name} ${Math.round(score)}</span>
          <span class="rank-place">${place ? `本地榜 第 ${place.rank} / ${place.total}` : ''}</span>
        </div>
        <div class="rank-sub">
          ${nextHint} · 今日${daily.claimed ? '奖励已领' : `可领 +${daily.gold}`}
        </div>
      </div>
      <p class="hint">
        <b>你亲手出牌</b>，对手由 AI 操作 —— 他和你用同一套卡牌、同一套规则：
        自己的卡组、宝物、职业天赋、能量循环全都生效，不做任何折算。
        对方回合会<b>逐张亮牌</b>，你看得到它打了什么。
      </p>
      <p class="hint">
        赛制：双方生命 ×3（把决斗拉到 7 回合上下）；先手掷骰决定，后手多拿
        <b>4 点首回合能量 + 2 张起始手牌</b>。赢了拿金币和段位分，输了扣 1 条命和段位分
        （属性与卡组不受影响）。
      </p>
      <div class="sec-head"><span>对手</span><span class="sec-sub">按段位分 ${Math.round(score)} 就近匹配</span></div>
      ${opponents.map((g, i) => `
        <div class="char-card ghost" data-action="fight" data-index="${i}">
          <div class="char-head">
            <span class="cname">${esc(g.name)}</span>
            <span class="tier-tag">Lv${g.level || 1} · ${rankBadge(g.arenaScore ?? scoreOf(g))}</span>
          </div>
          <div class="char-stats">
            <span>生命 <b>${g.maxHp}</b></span>
            <span>攻击 <b>${g.atk}</b></span>
            <span>卡组 <b>${g.deck.length}</b></span>
            <span>宝物 <b>${(g.relics || []).length}</b></span>
            ${(g.equipped || []).length ? `<span>装备 <b>${g.equipped.length}</b></span>` : ''}
          </div>
          <div class="char-actions">
            <button class="btn mini ghost" data-action="open-ghost" data-index="${i}">属性</button>
            <span class="btn primary">挑战</span>
          </div>
        </div>`).join('')}
    </div>
  </div>`;
}

/**
 * 竞技场战斗记录（结果页）—— 按回合分组。
 *
 * 双方都是角色，一回合能出 5~7 张牌，一场十几回合的记录会有上百行，
 * 直接铺在结算页会把「回大厅」挤到屏幕外 —— 所以默认收起，
 * 只留一个入口，点开才给固定高度的滚动区（v3.36）。
 */
function arenaLogHtml(result, open) {
  const log = result.log || [];
  if (!log.length) return '';

  if (!open) {
    return `
    <button class="result-log-toggle" data-action="toggle-result-log">
      战斗记录 · ${result.turns} 回合 ${log.length} 条 <i>▸</i>
    </button>`;
  }

  const groups = new Map();
  for (const row of log) {
    if (!groups.has(row.turn)) groups.set(row.turn, []);
    groups.get(row.turn).push(row);
  }

  const body = [...groups.entries()].map(([turn, rows]) => `
    <div class="log-group">
      <div class="log-turn">第 ${turn} 回合</div>
      ${rows.map((r) => `
        <div class="log-row ${r.side === 'p' ? 'player' : 'enemy'}">
          <span class="log-who">${r.side === 'p' ? '我' : '敌'}</span>
          <span class="log-name">${esc(r.name)}</span>
          <span class="log-detail">${esc(r.detail)}</span>
        </div>`).join('')}
    </div>`).join('');

  return `
  <div class="log-sheet arena-log">
    <button class="result-log-toggle" data-action="toggle-result-log">
      收起战斗记录 <i>▾</i>
    </button>
    <div class="log-body">${body}</div>
  </div>`;
}

export function renderArenaResult(ch, ghost, result, gold, scoreRes = null, ui = {}) {
  const win = result.win;
  const logOpen = ui.logOpen === true;
  /** 段位分变化（v3.35）：升段/降段给一句高亮 */
  const scoreRow = scoreRes ? `
        <div><span>段位分</span><b>${scoreRes.delta >= 0 ? '+' : ''}${scoreRes.delta} → ${Math.round(scoreRes.after)}
          <span class="rank-badge" style="--rk:${scoreRes.rank.color}"><i></i>${scoreRes.rank.name}</span></b></div>
        ${scoreRes.promoted ? `<div class="rank-flash up">晋升${scoreRes.rank.name}段位！每日奖励涨到 +${scoreRes.rank.daily} 金币</div>` : ''}
        ${scoreRes.demoted ? `<div class="rank-flash down">跌落${scoreRes.rank.name}段位</div>` : ''}` : '';
  return `
  <div class="hall">
    <div class="hall-top">
      <div class="gold-box"><span class="coin"></span><b>+${gold}</b></div>
      <div class="hall-title">${win ? '胜利' : '败北'}</div>
      <span></span>
    </div>
    <div class="hall-scroll result-scroll">
      <div class="big-result ${win ? 'win' : 'lose'}">${win ? '胜' : '负'}</div>
      <div class="result-rows">
        <div><span>对手</span><b>${esc(ghost.name)} · Lv${ghost.level || 1}</b></div>
        <div><span>先手</span><b>${result.playerFirst ? '你' : '对手'}（后手补偿 +4 能量 / +2 手牌）</b></div>
        <div><span>回合</span><b>${result.turns}</b></div>
        <div><span>剩余生命</span><b>${result.playerHp} / ${result.playerMaxHp}</b></div>
        <div><span>对手剩余</span><b>${result.enemyHp} / ${result.enemyMaxHp}</b></div>
        <div><span>金币</span><b>${win ? `+${gold}` : '0'}</b></div>
        ${scoreRow}
        <div><span>命数</span><b>${ch.lives}/${ch.maxLives}</b></div>
      </div>
      ${!win && ch.status === 'dead' ? '<p class="warn">这个角色的命已经用完了。</p>' : ''}
      ${arenaLogHtml(result, logOpen)}
      <button class="btn primary wide" data-action="back-hall">回大厅</button>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ *
 * 探险结算
 * ------------------------------------------------------------------ */

export function renderExploreResult(
  ch, outcome, gold, meta, justPromoted = false, livesBefore = null, abandoned = false,
  promoteBlocked = false,
) {
  const won = outcome.survived;
  /**
   * 试用期阵亡 → 当场给一个「再进一次」。
   *
   * 没转正的人只要有命就能一直爬，塔不会因为失败次数变强（难度只跟层数走），
   * 所以这里不该让玩家先回大厅再点一次出发 —— 那一步没有任何信息量。
   */
  const canRetry = !won && !ch.veteran && ch.status !== 'dead' && (ch.lives ?? 0) > 0;
  /**
   * 结局只有三种，必须一眼分得开：
   *   WIN  活着走出塔 —— 成果保留，这才是"成功"
   *   LOSE 死在塔里
   *   QUIT 主动放弃（按阵亡结算，但不是被打死的）
   * 之前成功写「归来 / 归」，只说了"回来了"，没说输赢 —— 玩家在结算页上
   * 第一个要确认的就是这一趟到底算不算赢。
   */
  const mark = won ? '胜' : abandoned ? '退' : '殁';
  const markEn = won ? 'WIN' : abandoned ? 'QUIT' : 'LOSE';
  const title = won ? '胜利' : abandoned ? '放弃' : '阵亡';
  return `
  <div class="hall">
    <div class="hall-top">
      <div class="gold-box"><span class="coin"></span><b>+${gold}</b></div>
      <div class="hall-title">${title}</div>
      <span></span>
    </div>
    <div class="hall-scroll result-scroll">
      <div class="big-result ${won ? 'win' : 'lose'}">${mark}<span class="br-en">${markEn}</span></div>
      <div class="result-rows">
        <div><span>角色</span><b>${esc(ch.name)}</b></div>
        <div><span>到达层数</span><b>${outcome.floor} / 30</b></div>
        <div><span>金币</span><b>${gold > 0 ? `+${gold}` : '0'}</b></div>
        <div><span>命数</span><b>${
          livesBefore != null && livesBefore !== ch.lives
            ? `${livesBefore} → ${ch.lives}（${ch.lives - livesBefore}）`
            : `${ch.lives}/${ch.maxLives}`
        }</b></div>
        <div><span>卡组</span><b>${won ? outcome.deck.length : ch.deck.length} 张</b></div>
      </div>
      ${justPromoted
        ? '<p class="promote">首次 WIN · 转正<br><span>塔不会再为他打开，竞技场已解锁（每天 8 次，0 点回满）。</span></p>'
        : ''}
      ${promoteBlocked
        ? `<p class="warn">转正席位已满（${VETERAN_LIMIT} 人）—— 这一趟成果保留，但他还是实习生。
           先去庄园退役一位转正角色，再爬一次就能转正。</p>`
        : ''}
      <p class="hint">
        ${won
          ? `这一趟是 WIN：成果全部保留 —— 卡组 ${outcome.deck.length} 张，已激活宝物 ${outcome.relics.length} 件。进塔本身不扣命。`
          : abandoned
            ? '主动放弃按阵亡算：扣 1 命，卡组、宝物、属性全部回滚到出发前。留在塔里继续爬，可能还有机会 —— 退出来就什么都没有了。'
            : '这一趟白干：卡组、宝物、属性全部回滚到招募时的样子，只换来命数 -1（进塔不扣命，死在塔里才扣）。'}
        <br>装备不在回滚范围内：这一趟捡到的都已经进了装备库，跟胜败无关。
      </p>
      ${!won && !ch.veteran && ch.status !== 'dead'
        ? `<p class="warn">还是试用期 —— 下次活着回来才算转正${canRetry ? `。还剩 ${ch.lives} 条命，塔不会因为你失败过而变强` : ''}。</p>`
        : ''}
      ${ch.status === 'dead' ? '<p class="warn">命数归零，这个角色已经消失。</p>' : ''}
      ${canRetry
        ? `<button class="btn primary wide" data-action="retry-explore" data-id="${ch.id}">再进一次 · 还剩 ${ch.lives} 条命</button>`
        : ''}
      <button class="btn ${canRetry ? 'ghost' : 'primary'} wide" data-action="back-hall">回大厅</button>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ *
 * 墓地
 * ------------------------------------------------------------------ */

export function renderGrave(meta) {
  return `
  <div class="hall">
    <div class="hall-top">
      <button class="icon-btn" data-action="back-hall">返回</button>
      <div class="hall-title">墓地</div>
      <div class="gold-box"><b>${meta.graveyard.length}</b></div>
    </div>
    <div class="hall-scroll">
      ${meta.graveyard.length === 0
        ? '<div class="empty">还没有人死在这里。</div>'
        : meta.graveyard
          .slice()
          .reverse()
          .map((g) => `
          <div class="grave-row">
            <span class="cname">${esc(g.name)}</span>
            <span class="g-meta">最远 ${g.bestFloor} 层 · 探险 ${g.exploreCount} 次 · 竞技 ${g.arenaWins} 胜</span>
          </div>`)
          .join('')}
    </div>
  </div>`;
}
