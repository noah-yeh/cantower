/**
 * 迷宫层界面（v2.0）—— 只读 core，不改状态
 *
 * 一屏放下 12 格：3 列 × 4 行。
 * 三种格子状态必须一眼分得开（这是整个玩法的手感所在）：
 *   未翻 + 可翻  → 金色虚线的「?」，能点
 *   未翻 + 够不着 → 暗块，点不动（迷雾）
 *   已翻未触发   → 亮起图标（这就是按钮），再点才生效
 *   已翻已处理   → 压暗，不再响应
 * v3.19 不思议迷宫式减负：格子上不再写"点开 / 再点·XX / 名字"，
 * 操作规则只教一次（首次进迷宫弹引导，之后靠顶栏 ？ 随时回看）。
 */

import { CLASSES, RACES } from '../core/characters.js';
import { isMuted } from './audio.js';
import { CELL, CELL_LABEL, CELL_ICON, canReveal, FOG } from '../core/dungeon.js';
import { MAX_FLOOR } from '../core/enemies.js';
import { abandonBar } from './abandon.js';
import { fullscreenButton } from './fullscreen.js';
import { runCoin } from './bits.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TIER_TAG = { elite: '精英', boss: '首领' };

/**
 * 迷宫格图标（v3.1 美术素材）。
 * 敌人格在生成时不带模板 id，按段位给代表形象：首领骷髅骑士、其余哥布林。
 * 事件格按事件 key 取图；祭坛/遗骸/晶簇复用资源图标。
 */
const CELL_IMG = {
  [CELL.TREASURE]: 'dungeon/chest.png',
  [CELL.SHOP]: 'dungeon/shop.png',
  /** 宝库（v3.13）：用晶簇图标，和行商的摊位图区分开 */
  [CELL.RELIC_SHOP]: 'icons/crystal.png',
  [CELL.STAIRS]: 'dungeon/portal.png',
};
const EVENT_IMG = {
  spring: 'dungeon/spring.png', smith: 'dungeon/smith.png', trap: 'dungeon/trap.png',
  altar: 'icons/stardust.png', crystals: 'icons/crystal.png',
  /** 付费祭坛（v3.37）：焚卡用火纹、变形用漩涡，和普通事件区分开 */
  pyre: 'icons/altar-pyre.png', morph: 'icons/altar-morph.png',
  // 遗骸给的是古币（塔里的钱），图标用内联铜币，别再借局外金币的图
};

function cellImg(cell) {
  if (cell.kind === CELL.ENEMY) {
    /** 不剧透具体是哪只：普通怪统一哥布林剪影，首领格给守门人压阵（v3.10） */
    const img = cell.data?.tier === 'boss' ? 'boss_warden' : 'goblin';
    return `<img class="dcell-img" src="assets/img/monsters/${img}.webp" alt="">`;
  }
  if (cell.kind === CELL.EVENT) {
    if (cell.data?.event === 'remains') return runCoin(26);
    const src = EVENT_IMG[cell.data?.event];
    return src ? `<img class="dcell-img" src="assets/img/${src}" alt="">` : '';
  }
  const src = CELL_IMG[cell.kind];
  return src ? `<img class="dcell-img" src="assets/img/${src}" alt="">` : '';
}

/**
 * 触发结果的横幅。
 *
 * 结果只写在地图下面一行小字里时，玩家会以为"点了什么都没发生"——
 * 事件的产出（回血/加金币/强化卡）大多不在地图屏上直接可见，
 * 所以这条反馈必须大到不容错过：事件名一行、结果一行，弹入动画。
 */
function noteBanner(note) {
  const s = String(note);
  const cut = s.indexOf('：');
  const name = cut > 0 ? s.slice(0, cut) : '';
  const text = cut > 0 ? s.slice(cut + 1) : s;
  const icon = { 泉眼: '⛲', 祭坛: '🜂', 遗骸: '⚱', 晶簇: '◆', 陷阱: '☠', 铁匠: '⚒', 宝箱: '◆', 行商: '⌂', 宝库: '✦', 楼梯: '▼', 空房间: '·', 焚卡祭坛: '🔥', 变形祭坛: '✧' }[name] ?? '❖';
  return `
    <div class="dnote">
      <span class="dn-ico">${icon}</span>
      <span class="dn-body">
        ${name ? `<b>${esc(name)}</b>` : ''}
        <span>${esc(text)}</span>
      </span>
    </div>`;
}

function cellHtml(run, idx) {
  const map = run.floorMap;
  const cell = map.cells[idx];

  /** 只有迷雾开着的时候才有"未翻开的暗格 / 能翻的 ?"这两态 */
  if (!cell.revealed && FOG) {
    if (!canReveal(map, idx)) return `<div class="dcell dark" aria-hidden="true"></div>`;
    return `<button class="dcell reach" data-action="cell" data-index="${idx}" aria-label="暗格">
      <span class="dc-mark">?</span>
    </button>`;
  }

  const label = cell.data?.entry ? '入口' : (CELL_LABEL[cell.kind] ?? '');
  const icon = cell.data?.entry ? '◉' : (CELL_ICON[cell.kind] ?? '·');
  const img = cellImg(cell);
  const tier = cell.kind === CELL.ENEMY ? cell.data?.tier : null;
  const tag = tier && TIER_TAG[tier] ? `<span class="dc-tier ${tier}">${TIER_TAG[tier]}</span>` : '';

  if (cell.done) {
    return `<div class="dcell k-${cell.kind} done${cell.data?.entry ? ' entry' : ''}">
      ${img || `<span class="dc-icon">${icon}</span>`}
      <span class="dc-label">${esc(label)}</span>
      ${tag}
    </div>`;
  }

  /**
   * v3.19：待触发的格子只有图标（+ 精英/首领角标）——图标本身就是按钮。
   * 没图的格保留一行小名字兜底；"点了会发生什么"第一次进迷宫就教过，
   * 翻开时地图下的横幅也会报一遍，不必每个格子都写。
   */
  return `<button class="dcell k-${cell.kind} pending" data-action="cell" data-index="${idx}" aria-label="${esc(label)}">
    ${img || `<span class="dc-icon">${icon}</span>`}
    ${!img && label ? `<span class="dc-label">${esc(label)}</span>` : ''}
    ${tag}
  </button>`;
}

/**
 * v3.19 一次性玩法引导（参照不思议迷宫：规则只教一次，之后靠图标自解释）。
 * 首次进迷宫自动弹出；点浮层任意处或「知道了」关闭。
 */
function guideOverlay() {
  return `
    <div class="overlay maze-guide" data-action="maze-guide-ok" role="dialog" aria-label="迷宫探索玩法">
      <div class="mg-panel">
        <h2>迷宫探索</h2>
        <ol class="mg-list">
          <li><b>点暗格</b> 翻开看清是什么</li>
          <li><b>再点一下</b> 触发：开宝箱、进战斗、下楼</li>
          <li>敌人可以<b>绕开</b>，清完才亮楼梯</li>
        </ol>
        <button class="btn primary" data-action="maze-guide-ok">知道了</button>
      </div>
    </div>`;
}

/**
 * v3.16 防跳动：结果横幅放在固定高度的 `.dnote-slot` 槽位里。
 * 之前 note 有则出现、无则消失（约 50px），而 .dmap 是 flex:1 的弹性区 ——
 * 每翻一块石板整片地图就被压一下又弹回去（用户报的"翻一下挤一下"就是它）。
 */
export function renderDungeon(run, ui = {}) {
  if (!run?.floorMap) return '<div class="overlay"><p class="sub">这一层没有地图</p></div>';

  const map = run.floorMap;
  const left = map.enemiesLeft ?? 0;
  const cells = map.cells.map((_, i) => cellHtml(run, i)).join('');
  const chapter = run.floor <= 10 ? '第一章 · 塔基' : run.floor <= 20 ? '第二章 · 回廊' : '第三章 · 塔顶';

  const bgCh = run.floor <= 10 ? 'ch1' : run.floor <= 20 ? 'ch2' : 'ch3';
  return `
    <div class="tower-bg" style="background-image:url('assets/img/bg/${bgCh}.webp')" aria-hidden="true"></div>
    <div class="topbar">
      <span class="floor">第 ${run.floor} 层 / ${MAX_FLOOR}</span>
      <span class="chapter">${chapter}</span>
      <span class="top-right">
        <!-- v3.39 顶栏瘦身：职业种族挪进属性面板（dm-level 已显示 Lv），给「属性」按钮腾位 -->
        ${run.upgradeTargets?.length ? '<button class="mini-btn altar-open" data-action="open-altar" title="有祭坛强化还没选">↑ 祭坛</button>' : ''}
        <button class="mini-btn snd-btn${isMuted() ? ' off' : ''}" data-action="toggle-sound"
          aria-pressed="${isMuted() ? 'false' : 'true'}"
          aria-label="${isMuted() ? '声音已关闭，点击开启' : '声音已开启，点击静音'}">♪</button>
        <button class="mini-btn" data-action="maze-guide" aria-label="玩法说明">?</button>
        <!-- v3.81：全屏按钮回到探险顶栏（大厅那枚早就有，这边一直被挤掉）。
             「详情」按钮撤掉 —— 底部角色行点头像就是详情入口 -->
        ${fullscreenButton()}
      </span>
    </div>

    <div class="dmap-wrap">
      <div class="dmap-head">
        <!-- v3.81：左上角只留钱 —— 生命/等级移到底部角色行（避免和那里重复） -->
        <span class="dm-stats">
          <span class="dm-gold" title="古币 · 塔里的钱，只能给行商，出塔就蒸发">${runCoin()} ${run.gold || 0}</span>
          <span class="dm-mat" title="水晶材料 · 合成卡牌与激活宝物（角色详情页里用）"><span class="mat"></span><b>${run.materials || 0}</b></span>
        </span>
        <span class="dm-right">
          ${left > 0
            ? `<span class="dm-left-enemies">敌人 <b>${left}</b> 未清</span>`
            : '<span class="dm-clear">敌人已清 · 可下楼</span>'}
        </span>
      </div>

      <!-- v3.80：提示横幅从地图下面挪到上面，字号收小 -->
      <div class="dnote-slot">${ui.note ? noteBanner(ui.note) : ''}</div>

      <div class="dmap">${cells}</div>
    </div>
    ${ui.guide ? guideOverlay() : ''}

    <div class="dtray">
      <!-- v3.80：底部 = 角色头像 + 生命/攻击/能量，点头像进角色详情（合成/激活在里面） -->
      <button class="dhero" data-action="open-hero" aria-label="查看角色详情">
        <img class="dhero-face" src="assets/img/races/${run.raceId}.webp" alt="">
        <span class="dhero-id">
          <span class="dhero-name">${esc(run.characterName ?? '冒险者')}</span>
          <span class="dhero-lv">Lv.${run.player.level}</span>
        </span>
        <span class="dhero-v">
          <span class="dv dv-hp" title="生命">❤ <b>${run.player.hp}</b>/${run.player.maxHp}</span>
          <span class="dv dv-atk" title="攻击">⚔ <b>${run.player.atk}</b></span>
          <span class="dv dv-en" title="能量">⚡ <b>${run.player.energy ?? run.player.energyCap ?? 8}</b></span>
        </span>
        <i class="dhero-go" aria-hidden="true">›</i>
      </button>
      ${abandonBar(!!ui.confirmAbandon)}
    </div>
  `;
}
