/**
 * 入口与状态机
 *
 * 渲染策略：整页重建（innerHTML）。一屏没几个节点，重建比 diff 便宜。
 *
 * 屏幕流（v2.0 迷宫层）：
 *   hall ⇄ bag
 *     ↓ explore
 *   dungeon ⇄ battle ⇄ reward ⇄ bag
 *     ↓（敌人清光后踩楼梯）
 *   下一层 dungeon …
 *     ↓ won / dead
 *   explore-result → hall
 *
 *   hall → arena → arena-result → hall
 */

import {
  createRun, play, pass, endPlayerTurn, enemyStepPve, applyReward, forgeInRun, activateRelicInRun, writeBackToCharacter, runOutcome,
  leaveShop, stepCell, chooseUpgradeCard, cancelUpgrade, reopenAltar,
  removeCardInRun, morphCardInRun, cancelRunAltar, acceptQuest, declineQuest,
} from '../core/run.js';
import { buyShopCard, buyShopRelic, refreshShop } from '../core/shop.js';
import { loadMeta, saveMeta, saveRun, loadRun, clearRun, rawMeta, writeCloudMeta } from '../core/save.js';
import * as M from '../core/meta.js';
import { scoreOf, applyArenaResult, claimDaily, dailyState, rankOfChar, rankOf, nextRankOf } from '../core/arena-rank.js';
import {
  onExploreReturn, onExploreDeath, abandonOnExplore, ratingOf, canEnterArena, canExplore,
  spendArena, tickArena, recoverOrphanedRun,
} from '../core/roster.js';
import {
  createArenaBattle, arenaPlay, arenaEndTurn, arenaEnemyStep, arenaBattleView, arenaResult,
} from '../core/arena.js';
import {
  canWatchAd, grantAdReward, AD_SLOT_ID, AD_REWARD_GOLD,
  canWatchBoxAd, grantBoxAdRecord, AD_BOX_SLOT_ID, AD_BOX_DAILY_LIMIT,
} from '../core/ads.js';
import { unlockRace, levelUpRace, grantShardBox, canUnlock, canLevelUp } from '../core/races.js';
import {
  openGoldChest, openEquipChest, useLifeSeed,
} from '../core/mall.js';
import { RACES } from '../core/characters.js';
import { playRewardedAd } from './ad-provider.js';
import { renderMall } from './mall.js';
import { cardName } from '../core/cards.js';
import { Rng } from '../core/rng.js';
import { renderBattle, alignTagRows } from './battle.js';
import { renderReward, renderUpgradeAltar, renderRunAltar, renderQuestOffer } from './panels.js';
import { renderShop } from './shop.js';
import { renderDungeon } from './dungeon.js';
import {
  renderHall, renderArenaPick, renderArenaResult, renderExploreResult, renderGrave,
  renderEquip, renderManor, renderRoster, renderExpedition, renderArenaRoster,
} from './hall.js';
import { renderArenaBattle } from './arena-battle.js';
import { renderCodex } from './codex.js';
import { runStatsPanel } from './stats.js';
import { heroPageChar, heroPageRun, heroPageGhost } from './hero.js';
import {
  addEquipment, equipItem, unequipItem, enhanceItem, equippedSnapshot,
  recycleItem, combineShards, equipTitle,
} from '../core/equipment.js';
import { collectManor, convertToManor, tickManors } from '../core/manor.js';
import { unlockAudio, sfx, playEvents, toggleMute, isMuted, audioState, audioSupported } from './audio.js';
import { BUILD } from './build.js';
import { toggleFullscreen } from './fullscreen.js';
import { createCloud } from '../core/cloud.js';
import { resolveCloudConfig } from '../core/cloud-config.js';

const app = document.getElementById('app');

/**
 * 云端（v3.94）。
 *
 * `src/core/cloud-config.js` 里 `baseUrl` 为空时整层停用 —— 所有调用会立刻返回
 * `{ok:false, code:'disabled'}`，不发任何请求。上 TapTap 时填上云引擎域名即可开启，
 * 游戏内没有任何"必须联网才能玩"的分支，断网照旧只写本地。
 */
const CLOUD = resolveCloudConfig();
const cloud = createCloud({ config: CLOUD });

const state = {
  screen: 'hall',
  meta: null,
  run: null,
  /** 装备页当前看的角色（v2.3） */
  equipCharId: null,
  /** 退役成庄园的二次确认：第一次点只弹确认框，第二次才真的移出名册 */
  confirmConvert: null,
  /** 营地页停在哪个 tab（'probation' 实习 / 'veteran' 转正） */
  rosterTab: 'probation',
  /**
   * 角色详情页（v3.67）：四种入口共用 —— 营地 / 冒险 / 竞技场名册点角色、
   * 竞技场选人页与决斗场点对手、战斗页点玩家头像。存打开时的上下文：
   *   { mode:'char', id }    名册角色
   *   { mode:'run' }         探险中的一趟（读 run.player 实时面板）
   *   { mode:'ghost', ghost } 竞技场对手快照
   * 外加 tab（'gear'|'char'|'relic'）与 openKey（卡组里展开的那张卡）。
   */
  hero: null,
  /** 图鉴（v3.8）：停在哪个 tab 和哪个职业筛选 */
  codexTab: 'cards',
  codexCls: 'generic',
  /** 从营地进装备/背包时记下来源，返回时回到营地而不是大厅 */
  returnTo: 'hall',
  /** 玩法速查浮层（v3.6）：大厅右上角「?」，原来摊在页面底部的那段长说明搬进去了 */
  help: false,
  /** 招募候选人属性面板（v3.57）：点头像开 */
  candStats: false,
  arena: null,
  explore: null,
  flash: '',
  recorded: false,
  /** 战斗记录面板是否展开 */
  showLog: false,
  /** 敌人牌库浮层（v3.42）：和记录面板互斥，同一层遮罩只能开一个 */
  showFoeDeck: false,
  /** 宝物效果浮层是否展开（战斗页 / 奖励页共用） */
  showRelics: false,
  /** 局内属性面板是否展开（v3.38：地图 / 战斗都能开） */
  runStats: false,
  /** 敌人词条/状态行是否展开（v3.44：放不下折叠，手动展开） */
  foeTagsOpen: false,
  /** 玩家状态行是否展开（v3.44） */
  playerTagsOpen: false,
  /** 放弃探险的二次确认：存 charId，第一次点只把按钮变红，第二次才真扣命 */
  confirmAbandon: null,
  /** 广告播放中：屏蔽计时器重绘与重复点击 */
  adPlaying: false,
  adAbort: null,
  /**
   * 出牌动画进行中（v3.2）。
   * 卡牌先飞 110ms 再结算，这期间必须锁住输入 —— 否则连点会在旧 DOM 上
   * 触发第二次 play，手牌索引已经错位（打出的是另一张牌）。
   */
  acting: false,
  /** 出牌前的血量快照：让血条从旧值"补刀"到新值，而不是瞬间跳变 */
  prevHp: null,
};

/* ------------------------------------------------------------------ *
 * 初始化
 * ------------------------------------------------------------------ */

function boot() {
  try {
    state.meta = loadMeta();

    /**
     * 上一场竞技场没打完就关了页面（v3.33）。
     *
     * 战斗对象里有宝物钩子函数，存不进 localStorage，所以这一场只能作废，
     * 次数也已经扣了。不退款 —— 退款等于"打不过就刷新"，那是比丢一次额度
     * 大得多的洞。这里只负责把话说清楚，别让玩家以为是 bug。
     */
    if (state.meta.arenaPending) {
      delete state.meta.arenaPending;
      saveMeta(state.meta);
      flash('上一场竞技场中途关掉了，次数已消耗、战绩未结算');
    }

    const run = loadRun();
    if (run) {
      const ch = state.meta.roster.find((c) => c.id === run.characterId);
      /**
       * v3.15.1：读出来的 run 已经是终局（won —— loadRun 的坏档防御会把
       * 层数越过塔顶的旧 build 坏档判成通关），不能再当"进行中"恢复：
       * 走下面的分支角色会永远卡在「探险中」、大厅挂着回不去的回塔。
       * 立即结算：胜利走 writeBack / 转正 / 结算屏，玩家看到的是 WIN。
       */
      if (ch && (run.phase === 'won' || run.phase === 'dead')) {
        state.run = run;
        finishExplore(false);
        return;
      }
      if (ch) {
        state.run = run;
        /** 暂停标记要跨刷新保留：player 主动退到大厅，重开页面不该被拽回塔里 */
        const paused = !!state.meta.run?.paused;
        state.meta.run = { characterId: ch.id, floor: run.floor, ...(paused ? { paused: true } : {}) };
        ch.status = 'exploring';
        /** 读档按阶段回到对应屏：商店回到货架、地图回到地图，别一律扔进战斗页 */
        if (paused) state.screen = 'hall';
        else if (run.phase === 'shop') state.screen = 'shop';
        else if (run.phase === 'map') state.screen = 'dungeon';
        else if (run.phase === 'battle') state.screen = 'battle';
        else if (run.phase === 'reward') state.screen = 'reward';
      } else {
        clearRun();
        state.meta.run = null;
      }
    } else if (state.meta.run) {
      /**
       * 大厅挂着「回塔」，但局内档读不出来（v3.9.1）。
       *
       * 典型场景：版本升级后 RUN_SAVE_VERSION 变了，旧档被 loadRun 判废，
       * 而 meta.run 还留着 —— 玩家点继续只会看到"战斗已结束"，且永远出不来。
       * 这趟本来就没数据落地，按没发生过处理：不扣命，人放回待命。
       */
      const orphan = state.meta.roster.find((c) => c.id === state.meta.run.characterId);
      const recovered = recoverOrphanedRun(orphan);
      state.meta.run = null;
      clearRun();
      saveMeta(state.meta);
      if (recovered) state.flash = '上次那趟探险的记录没找到，已作废（不扣命）';
    }

    render();
    /** 云端同步放到首屏之后跑：慢网不该让玩家多黑屏一秒（没配地址时这里直接返回） */
    cloudBoot().catch(() => {});
    /**
     * 开机成功：解掉 index.html 里自愈脚本的一次性守卫（v3.9.3）。
     * 不清的话，下次真遇到坏缓存时它就不敢再自动清一次了。
     */
    try { sessionStorage.removeItem('canta-boot-recover'); } catch (e) { /* 隐私模式 */ }
  } catch (err) {
    // 白屏是最糟的失败方式：玩家不知道发生了什么，也无从恢复
    app.innerHTML = `
      <div class="overlay">
        <h1 style="font-size:18px;letter-spacing:4px">出了点问题</h1>
        <p class="sub">读档或渲染时出错，存档没有被覆盖。</p>
        <p class="hint" style="word-break:break-all;opacity:.7">${String(err?.message || err)}</p>
        <button class="btn primary wide" data-action="hard-reset">清空存档重开</button>
        <button class="btn ghost wide" data-action="reload">重试</button>
      </div>`;
    console.error(err);
  }
}

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */

function render() {
  const meta = state.meta;

  switch (state.screen) {
    case 'battle': {
      const armed = state.confirmAbandon != null
        && state.confirmAbandon === state.run?.characterId;
      const b = state.run?.battle;
      /** 新的一场战斗：清掉上一场的"敌人刚出的牌"显示 */
      if (state.pveStep && state.pveBattle !== b) state.pveStep = null;
      /** 新的一场战斗：折叠行回到收起态（展开状态不属于下一场） */
      if (b && state.pveBattle !== b) {
        state.foeTagsOpen = false;
        state.playerTagsOpen = false;
      }
      state.pveBattle = b;
      app.innerHTML = renderBattle(state.run, {
        log: state.showLog, relics: state.showRelics, confirmAbandon: armed,
        foeDeck: state.showFoeDeck,
        foeTagsOpen: state.foeTagsOpen,
        playerTagsOpen: state.playerTagsOpen,
        busy: state.acting,
        step: state.pveStep,
      });
      /** v3.48：展开态多行时首行居中、续行按侧对齐（玩家靠左 / 敌人靠右） */
      alignTagRows();
      /**
       * v3.37 断链重连：暂停 / 换屏打断了敌人回合的播放链，回到战斗页时
       * phase 还停在 'enemy' —— 这里把链重新拉起来，否则永远"敌方回合…"。
       */
      if (b && b.phase === 'enemy' && !state.pveDriving) {
        state.pveDriving = true;
        state.acting = true;
        state.pveSeq = (state.pveSeq || 0) + 1;
        schedulePveEnemy(state.pveSeq, 480);
      }
      break;
    }
    case 'dungeon': {
      /** v3.19 一次性引导：第一次进迷宫自动弹（localStorage 记"教过了"） */
      if (state.mazeGuide === undefined) {
        state.mazeGuide = !localStorage.getItem('rs_maze_tut');
      }
      app.innerHTML = renderDungeon(state.run, {
        note: state.run?.lastCellNote,
        confirmAbandon: state.confirmAbandon === state.run?.characterId,
        guide: state.mazeGuide,
      });
      break;
    }
    case 'shop':
      app.innerHTML = renderShop(state.run, { flash: state.flash });
      break;
    case 'reward': {
      const armed = state.confirmAbandon != null
        && state.confirmAbandon === state.run?.characterId;
      app.innerHTML = renderReward(state.run, { confirmAbandon: armed, relics: state.showRelics });
      break;
    }
    case 'forge':
      /** v2.2 强化祭坛：奖励「强化」与铁匠事件的自选目标页 */
      app.innerHTML = renderUpgradeAltar(state.run);
      break;
    case 'altar':
      /** v3.37 付费祭坛：焚卡（remove）/ 变形（morph），phase 即模式 */
      app.innerHTML = renderRunAltar(state.run, { flash: state.flash });
      break;
    /** v3.85 委托板：接受 / 婉拒（唯一选项型事件，只在前 8 层、一局最多 3 份） */
    case 'quest':
      app.innerHTML = renderQuestOffer(state.run, { flash: state.flash });
      break;
    /** 装备页（v2.3）：按角色看已穿戴 + 全账号装备库 */
    case 'equip': {
      const ch = meta.roster.find((c) => c.id === state.equipCharId);
      if (!ch) {
        app.innerHTML = renderHall(meta, { flash: '这个角色已经不在了', now: Date.now() });
        break;
      }
      app.innerHTML = renderEquip(meta, ch, {
        flash: state.flash,
        now: Date.now(),
        confirmConvert: state.confirmConvert === ch.id,
      });
      break;
    }
    case 'manor':
      app.innerHTML = renderManor(meta, { now: Date.now(), flash: state.flash });
      break;
    /** 冒险 / 竞技场（v3.8）：首页独立入口，先选人 */
    case 'expedition':
      app.innerHTML = renderExpedition(meta, { now: Date.now(), flash: state.flash });
      break;
    case 'arena-roster':
      app.innerHTML = renderArenaRoster(meta, { now: Date.now(), flash: state.flash });
      break;
    case 'codex':
      app.innerHTML = renderCodex(meta, { tab: state.codexTab, cls: state.codexCls, flash: state.flash });
      break;
    /** 商城（v3.90）：广告金币 + 碎片宝箱 + 古币宝箱 + 装备宝箱（屏名 mall，'shop' 是局内行商） */
    case 'mall':
      app.innerHTML = renderMall(meta, { now: Date.now(), flash: state.flash });
      break;
    /** 营地（v3.4）：名册独立成页，实习 / 转正分 tab；v3.66 点卡进详情 */
    case 'roster':
      app.innerHTML = renderRoster(meta, {
        now: Date.now(),
        flash: state.flash,
        tab: state.rosterTab,
        confirmAbandon: state.confirmAbandon,
        charId: state.charId,
      });
      break;
    case 'arena':
      app.innerHTML = renderArenaPick(meta, findChar(state.arena.charId), state.arena.opponents);
      break;
    /** 竞技场战斗屏（v3.33）：你亲手出牌，对手逐张亮牌 */
    case 'arena-battle':
      app.innerHTML = renderArenaBattle(state.arena, {
        busy: state.acting,
        step: state.arena.step,
        logOpen: state.arena.logOpen !== false,
      });
      break;
    case 'arena-result': {
      const ch = findChar(state.arena.charId);
      app.innerHTML = renderArenaResult(ch, state.arena.ghost, state.arena.result, state.arena.gold, state.arena.scoreRes, {
        logOpen: state.arena.resultLogOpen === true,
      });
      break;
    }
    case 'explore-result':
      app.innerHTML = renderExploreResult(
        state.explore.char, state.explore.outcome, state.explore.gold, meta,
        state.explore.promoted, state.explore.livesBefore, state.explore.abandoned,
        state.explore.promoteBlocked,
      );
      break;
    case 'grave':
      app.innerHTML = renderGrave(meta);
      break;
    default:
      app.innerHTML = renderHall(meta, {
        flash: state.flash,
        now: Date.now(),
        confirmAbandon: state.confirmAbandon,
        help: state.help,
        candStats: state.candStats,
        statsCharId: state.statsCharId,
      });
      /**
       * 首页入场动画在下一帧才解锁（.hall.anim）：
       * 渲染是同步的，动画若立刻生效，首帧就是从-state，
       * 慢 WebView / 截图环境不跑帧时会永远卡在 opacity 0。
       * rAF 不跑 → 类不加 → 内容照常显示，动画只是锦上添花。
       */
      requestAnimationFrame(() => app.querySelector('.hall')?.classList.add('anim'));
      break;
  }

  /**
   * 局内属性面板（v3.38）：挂在屏幕内容**之后**，`.overlay` 相对 #app 铺满。
   *
   * 不塞进各渲染函数的 ui 参数里，是因为它要在五个屏（地图 / 战斗 / 行商 /
   * 祭坛 / 强化）通用 —— 一处追加，省得每个 renderXxx 都记着透传一个布尔。
   * 竞技场不在内：那边看的是名册角色，走局外的 statsPanel。
   */
  if (state.runStats && state.run && RUN_STAT_SCREENS.has(state.screen)) {
    app.insertAdjacentHTML('beforeend', runStatsPanel(state.run));
  }

  /**
   * 角色详情页（v3.67）：挂在屏幕内容**之后**的全屏浮层。
   * 四种入口共用（营地 / 冒险 / 竞技场名册的角色、竞技场对手、
   * 战斗页玩家头像），所以不塞进各 renderXxx —— 一处追加。
   * 数据源失效（角色阵亡 / run 已结束）就顺手关掉，不留空壳。
   */
  if (state.hero) {
    const h = state.hero;
    let heroHtml = '';
    if (h.mode === 'char') {
      const ch = meta.roster.find((c) => c.id === h.id);
      if (ch) {
        heroHtml = heroPageChar(meta, ch, {
          now: Date.now(),
          tab: h.tab,
          openKey: h.openKey,
          talentOpen: h.talentOpen ?? null,
          fresh: h.fresh ?? true,
          attrsOpen: h.attrsOpen ?? false,
          confirmAbandon: state.confirmAbandon === h.id,
        });
      }
    } else if (h.mode === 'run') {
      if (state.run) heroHtml = heroPageRun(meta, state.run, { tab: h.tab, openKey: h.openKey, talentOpen: h.talentOpen ?? null, fresh: h.fresh ?? true, attrsOpen: h.attrsOpen ?? false, forgeOpen: h.forgeOpen ?? false, forgeDetail: h.forgeDetail ?? null });
    } else if (h.mode === 'ghost' && h.ghost) {
      heroHtml = heroPageGhost(h.ghost, { tab: h.tab, openKey: h.openKey, talentOpen: h.talentOpen ?? null, fresh: h.fresh ?? true, attrsOpen: h.attrsOpen ?? false });
    }
    if (heroHtml) app.insertAdjacentHTML('beforeend', heroHtml);
    else state.hero = null;
  }

  state.flash = '';
  syncHallTimer();
}

/**
 * 能开局内属性面板的屏幕：v3.79 起只剩战斗（地图顶栏改开完整角色详情页）。
 * 行商 / 祭坛这些子页面没有入口（顶栏已经排满），返回地图点「属性」即可 —— 
 * 留着它们是死代码，不如不收。
 */
const RUN_STAT_SCREENS = new Set(['dungeon', 'battle']);

/* ------------------------------------------------------------------ *
 * 招募席位倒计时
 *
 * 只在大厅屏跑。每秒做两件事：
 *   1. tick 一次 —— 有席位到点就补人，补了才整页重绘
 *   2. 没补人就只改倒计时文本（整页重绘会打断滚动、也会让按钮闪）
 * ------------------------------------------------------------------ */

let hallTimer = null;

/** 需要走秒表的屏幕：大厅（招募/额度）、庄园（产量倒计时）、装备页（同样显示星屑数） */
const TIMED_SCREENS = new Set(['hall', 'manor', 'equip']);

function syncHallTimer() {
  const want = TIMED_SCREENS.has(state.screen);
  if (want && !hallTimer) {
    hallTimer = setInterval(tickHall, 1000);
  } else if (!want && hallTimer) {
    clearInterval(hallTimer);
    hallTimer = null;
  }
}

/* ------------------------------------------------------------------ *
 * 云端同步（v3.94）
 *
 * 三条策略，都是"宁可少同步，也不让玩家丢进度"：
 *   1. 只在**本地还没有存档**时（新设备首次打开）自动拉云端覆盖；
 *      本地有进度就只上传不下载 —— 静默覆盖本地进度是最不可原谅的失败方式。
 *   2. 上传是脏检查 + 节流：内容没变不发请求，变了最多 15 秒一次。
 *   3. 任何失败都只记在 cloud.status() 里，不弹错、不打断游戏。
 * ------------------------------------------------------------------ */

let cloudPushAt = 0;
let cloudBusy = false;

async function cloudBoot() {
  if (!cloud.enabled) return;
  const local = rawMeta();
  if (!local) {
    /** 新设备：带存档码（?code=p_xxx）就先接回原身份，再拉存档 */
    if (CLOUD.recoverCode) {
      const rc = await cloud.recover(CLOUD.recoverCode);
      if (!rc.ok) flash(`存档码没接上：${rc.message || '请检查后重试'}`);
    }
    const r = await cloud.pull();
    if (r.ok && r.payload && writeCloudMeta(r.payload)) {
      state.meta = loadMeta();
      flash('已从云端恢复存档');
      render();
    }
  }
  const ch = state.meta?.roster?.find((c) => c.id === state.meta.activeCharId) || state.meta?.roster?.[0];
  const score = ch ? scoreOf(ch) : 800;
  if (await cloud.syncGhosts(state.meta, score, 6)) {
    saveMeta(state.meta);
    if (state.screen === 'hall' || state.screen === 'arena') render();
  }
  /**
   * 开机这次上传用**磁盘上那份**（rawMeta）而不是内存态：
   * 内存态经过 reviveMeta 补充过默认字段，和上次上传的 hash 对不上，
   * 结果是每次刷新都白推一次（rev 无意义地 +1）。用同一份字节比，才是"没变就不推"。
   */
  await cloud.push(rawMeta() || state.meta);
}

function cloudTick(now) {
  if (!cloud.enabled || cloudBusy) return;
  if (now - cloudPushAt < 15000) return;
  cloudPushAt = now;
  cloudBusy = true;
  cloud.push(state.meta).finally(() => { cloudBusy = false; });
}

function tickHall() {
  if (!TIMED_SCREENS.has(state.screen)) return;
  // 广告播放期间整页重绘会把遮罩冲掉，冷却晚 3 秒结算没有代价
  if (state.adPlaying) return;
  const now = Date.now();

  /**
   * 庄园（v2.3）：每小时产出一次，推进后有变化才落盘重绘。
   * 放在大厅数据之前 —— 星屑数在大厅入口上就显示着，晚一秒都算"卡了"。
   */
  if (tickManors(state.meta, now)) {
    saveMeta(state.meta);
    render();
    return;
  }

  if (state.screen === 'hall') {
    if (M.tickRecruit(state.meta, now) > 0) {
      saveMeta(state.meta);
      render();
      return;
    }

    /**
     * 竞技场次数每日刷新（v3.93：每天 8 次，跨天回满）。
     *
     * 只有**剩余次数真的变了**才落盘 —— 跨天把 0 补回 8 要存；
     * 但"首次给转正角色补 arenaDay 日期键"不存：那只是把内存里的标记写掉，
     * 存档语义没变（arenaDay 空串本来就等于"今天还没打"），
     * 真正的落点在 spendArena 里，下次扣次数自然会带上日期键。
     */
    let arenaChanged = false;
    for (const ch of state.meta.roster) {
      if (!ch.veteran) continue;
      const beforeLeft = ch.arenaLeft ?? 0;
      tickArena(ch, now);
      if ((ch.arenaLeft ?? 0) !== beforeLeft) arenaChanged = true;
    }
    if (arenaChanged) {
      saveMeta(state.meta);
      render();
      return;
    }
  }

  let expired = false;
  for (const el of app.querySelectorAll('[data-cd]')) {
    const until = Number(el.dataset.cd);
    if (!until) continue;
    if (until <= now) {
      expired = true;
      break;
    }
    el.textContent = M.fmtDuration(until - now);
  }
  // 倒计时归零但席位还没补上（罕见：刚好卡在 tick 之后），立刻重绘一次
  if (expired) render();

  /** 云端自动上传（节流 15 秒 + 内容脏检查；没配地址时内部直接返回） */
  cloudTick(now);
}

function findChar(id) {
  return state.meta.roster.find((c) => c.id === id) || null;
}

/* ------------------------------------------------------------------ *
 * 事件
 * ------------------------------------------------------------------ */

/**
 * 浏览器不允许无手势自动播放：第一次按下（点/触摸/按键）时解锁 AudioContext 并起 BGM。
 *
 * v3.31：不再用 `once`。iOS 上第一次 `resume()` 有概率静默失败（state 仍是
 * suspended），`once` 一摘就再也没机会重试 —— 玩家会一直没声音。现在每次手势
 * 都重试，直到 state 真的变成 running 才把监听摘掉。
 */
const AUDIO_UNLOCK_EVENTS = ['pointerdown', 'keydown', 'click', 'touchend'];

function tryUnlockAudio() {
  unlockAudio();
  if (!audioSupported() || audioState() === 'running') {
    for (const ev of AUDIO_UNLOCK_EVENTS) window.removeEventListener(ev, tryUnlockAudio);
  }
}
for (const ev of AUDIO_UNLOCK_EVENTS) {
  window.addEventListener(ev, tryUnlockAudio, { passive: true });
}

/** 支持排查用：控制台敲 __rsAudio() / __rsBuild 就能看到跑的是哪一版、音频卡在哪 */
window.__rsAudio = () => ({
  supported: audioSupported(),
  state: audioState(),
  muted: isMuted(),
  inFrame: (() => { try { return window.self !== window.top; } catch { return true; } })(),
});
window.__rsBuild = BUILD;

/**
 * 全屏状态变化 → 重画（v3.43）。
 * 按钮文案要跟着从「⛶」变成「⤡」，否则玩家不知道现在是全屏还是没全屏。
 * 有的浏览器只发 webkit 前缀事件，两个都听。
 */
for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) {
  document.addEventListener(ev, () => {
    if (!state.meta) return;
    try { render(); } catch (e) { /* 渲染中途切全屏不该炸掉整页 */ }
  });
}

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.disabled) return;
  /** 出牌/翻格/战斗结算有自己的音效，别再叠一层点击声 */
  if (!['play', 'cell', 'end-turn', 'toggle-sound'].includes(el.dataset.action)) sfx('click');
  handle(el.dataset.action, el.dataset, el);
});

function handle(action, d, el) {
  switch (action) {
    /* ---------------- 大厅 ---------------- */
    /**
     * 招募（v3.5）：一次只出一个人。
     * `recruit` 花 1 个名额抽人，`hire` 花金币雇下，`dismiss` 让他离开（免费），
     * `refresh` 花小钱换一位（不占名额）。
     */
    case 'recruit': {
      const res = M.recruitCandidate(state.meta, Date.now());
      state.candStats = false;
      flash(res.ok ? `来了一位：${res.character.name}` : res.reason);
      persist();
      break;
    }
    case 'hire': {
      const res = M.hireCandidate(state.meta);
      state.candStats = false;
      flash(res.ok ? `${res.character.name} 加入了营地` : res.reason);
      persist();
      break;
    }
    case 'dismiss': {
      const res = M.dismissCandidate(state.meta);
      state.candStats = false;
      flash(res.ok ? `已婉拒 · ${res.character.name}` : res.reason);
      persist();
      break;
    }
    case 'refresh': {
      const res = M.refreshCandidate(state.meta);
      state.candStats = false;
      flash(res.ok ? `换了一位：${res.character.name}` : res.reason);
      persist();
      break;
    }
    case 'toggle-help':
      state.help = !state.help;
      render();
      break;
    /**
     * 强制更新（v3.31）：注销 sw + 清空全部缓存 + 重开。
     * 存档在 localStorage，不受影响。
     */
    case 'hard-reload': {
      const jobs = [];
      try {
        if ('serviceWorker' in navigator) {
          jobs.push(navigator.serviceWorker.getRegistrations()
            .then((rs) => Promise.all(rs.map((r) => r.unregister()))));
        }
      } catch { /* 隐私模式 */ }
      try {
        if (window.caches) {
          jobs.push(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))));
        }
      } catch { /* 隐私模式 */ }
      flash('正在清理缓存…');
      render();
      Promise.all(jobs).then(() => location.reload(), () => location.reload());
      break;
    }
    /**
     * 声音开关（v3.30）：BGM 与音效共用一个总开关。
     * 关掉时把 master gain 拉到 0（BGM 的振荡器继续跑，不做调度重建），
     * 再打开立刻有声，不会出现"开了还要等 5 秒才听到"的断层。
     *
     * v3.31：打开时补一记 `boot` 轻响，让玩家**立刻**能判断声音到底开没开；
     * 半秒后 state 还不是 running 就直接说人话（浏览器拦了 / 在预览框里）。
     */
    /**
     * 全屏（v3.43）：华为浏览器这类不支持"安装应用"的，点一下也能藏掉地址栏。
     * 必须在 click 里同步调用，浏览器才认为这是用户手势。
     */
    case 'toggle-fullscreen':
      toggleFullscreen();
      /** 全屏状态要立刻反映到按钮上；部分浏览器不会派发 fullscreenchange，这里先画一次 */
      render();
      break;
    case 'toggle-sound': {
      const nowMuted = toggleMute();
      if (nowMuted) {
        flash('已静音');
        render();
        break;
      }
      sfx('boot');
      flash('声音已开启');
      render();
      setTimeout(() => {
        if (audioState() === 'running') return;
        let inFrame = false;
        try { inFrame = window.self !== window.top; } catch { inFrame = true; }
        flash(inFrame
          ? '声音被预览框拦住了：点右上角在浏览器中打开'
          : '声音被浏览器拦住了：请允许本站播放声音');
        render();
      }, 500);
      break;
    }
    /** v3.20 属性面板：营地角色卡「属性」按钮开、点空白关 */
    case 'open-stats':
      state.statsCharId = d.id;
      render();
      break;
    case 'close-stats':
      state.statsCharId = null;
      render();
      break;
    /**
     * 角色详情页（v3.67）：点角色开、点空白或 ✕ 关。
     * 四个入口共用同一个动作名 —— 营地头像卡、冒险 / 竞技场名册的角色行、
     * 竞技场决斗场里自己的头像，都是 open-char。
     * 面板里的动作（出发 / 竞技场 / 装备 / 背包）走各自的 case，开屏前先关掉详情页。
     */
    case 'open-char':
      state.hero = { mode: 'char', id: d.id, tab: 'deck', openKey: null, fresh: true };
      render();
      break;
    case 'close-char':
    case 'close-hero-page':
      state.hero = null;
      render();
      break;
    case 'hero-tab':
      if (state.hero) {
        /** v3.73：gear 是 char 模式独有的页内页签（仓库），run / ghost 没有 */
        const allowed = state.hero.mode === 'char' ? ['deck', 'relic', 'gear'] : ['deck', 'relic'];
        state.hero.tab = allowed.includes(d.tab) ? d.tab : 'deck';
        state.hero.openKey = null;
        state.hero.talentOpen = null;
        state.hero.fresh = false;
        state.hero.attrsOpen = false;
        state.hero.forgeOpen = false;
        state.hero.forgeDetail = null;
        /** 仓库行的 穿上/强化/回收 动作都读 state.equipCharId —— 切到装备页签时对齐 */
        if (state.hero.tab === 'gear' && state.hero.mode === 'char') state.equipCharId = state.hero.id;
        render();
      }
      break;
    /** v3.73：❗属性蒙板（属性从页签挪进上面部分，点开蒙板看 9 项） */
    case 'hero-attrs':
      if (state.hero) {
        state.hero.attrsOpen = true;
        state.hero.fresh = false;
        render();
      }
      break;
    case 'hero-attrs-close':
      if (state.hero) {
        state.hero.attrsOpen = false;
        state.hero.fresh = false;
        render();
      }
      break;
    /* v3.84：牌库左上角的合成入口 —— 蒙板列表 / 前后对比两层 */
    case 'hero-forge-open':
      if (state.hero) {
        state.hero.forgeOpen = true;
        state.hero.forgeDetail = null;
        state.hero.fresh = false;
        render();
      }
      break;
    case 'hero-forge-close':
      if (state.hero) {
        state.hero.forgeOpen = false;
        state.hero.forgeDetail = null;
        state.hero.fresh = false;
        render();
      }
      break;
    case 'hero-forge-card':
      if (state.hero) {
        state.hero.forgeDetail = d.key;
        state.hero.fresh = false;
        render();
      }
      break;
    case 'hero-forge-back':
      if (state.hero) {
        state.hero.forgeDetail = null;
        state.hero.fresh = false;
        render();
      }
      break;
    /** 卡组里点一张卡：展开效果全文，再点收起 */
    case 'hero-card':
      if (state.hero) {
        state.hero.openKey = state.hero.openKey === d.key ? null : d.key;
        state.hero.fresh = false;
        render();
      }
      break;
    /** v3.72：头像下的天赋圆徽，点一下弹天赋蒙板，再点收起（v3.86 改蒙板） */
    case 'hero-talent':
      if (state.hero) {
        state.hero.talentOpen = state.hero.talentOpen === d.key ? null : d.key;
        state.hero.fresh = false;
        render();
      }
      break;
    case 'hero-talent-close':
      if (state.hero) {
        state.hero.talentOpen = null;
        state.hero.fresh = false;
        render();
      }
      break;
    case 'hero-noop':
      /** 详情页内部点击：挡住冒泡，别把页面关掉 */
      break;
    /**
     * 战斗页玩家头像（v3.44 起是这个动作名）：探险中的一趟，
     * 数值读 run.player 实时面板（含升级 / 宝物 / 装备加成）。
     */
    case 'open-hero':
      if (!state.run) return;
      state.hero = { mode: 'run', tab: 'deck', openKey: null, fresh: true };
      render();
      break;
    /**
     * 竞技场对手（v3.67）：选人页带 data-index（从 opponents 取），
     * 决斗场不带（直接用 state.arena.ghost —— 对手快照就是那份旧影）。
     */
    case 'open-ghost': {
      const a = state.arena;
      const ghost = d.index != null && a?.opponents ? a.opponents[Number(d.index)] : a?.ghost;
      if (!ghost) return;
      state.hero = { mode: 'ghost', ghost, tab: 'deck', openKey: null, fresh: true };
      render();
      break;
    }
    /**
     * 招募候选人属性面板（v3.57）：点种族头像开、点空白 / ✕ 关。
     * 候选人是 meta.candidate（还没入册），所以不复用 statsCharId 这条按 id 查名册的路径。
     */
    case 'cand-stats':
      if (!state.meta?.candidate) return;
      state.candStats = true;
      render();
      break;
    case 'close-cand-stats':
      state.candStats = false;
      render();
      break;
    /**
     * 局内属性面板（v3.38）：与局外分开两个状态位。
     * 共用一个会让"在营地看着属性、再开局内的"互相把对方关掉。
     */
    case 'open-run-stats':
      if (!state.run) return;
      state.runStats = true;
      render();
      break;
    case 'close-run-stats':
      state.runStats = false;
      render();
      break;
    case 'stats-noop':
      /** 面板内部点击：挡住冒泡，不让浮层关掉 */
      break;
    case 'explore':
      startExplore(d.id);
      break;
    case 'resume':
      state.hero = null;
      /**
       * 没有 run 就没什么可回的（v3.9.1）：只剩 meta.run 是个幽灵，
       * 硬渲染战斗页只会得到"战斗已结束"。清干净、把人放回待命。
       */
      if (!state.run) {
        const orphan = findChar(state.meta.run?.characterId);
        const recovered = recoverOrphanedRun(orphan);
        state.meta.run = null;
        clearRun();
        saveMeta(state.meta);
        flash(recovered ? '那趟探险的记录已经不在了 —— 人回营地，不扣命' : '现在没有进行中的探险');
        state.screen = 'hall';
        render();
        break;
      }
      /** 按 run.phase 回到对应屏：可能停在地图、战斗、奖励或行商 */
      if (state.meta.run?.paused) {
        delete state.meta.run.paused;
        saveMeta(state.meta);
      }
      syncRunScreen();
      render();
      break;
    /**
     * 阵亡结算页的「再进一次」。
     *
     * 走的是同一个 startExplore —— 准入判定仍在 core 的 canExplore 里，
     * UI 不自己判断"能不能再爬"。
     */
    case 'retry-explore':
      startExplore(d.id);
      break;
    /**
     * 放弃探险 = 认输，按阵亡结算（扣 1 命 + 成果回滚）。
     *
     * 大厅里点的是名册上的角色（带 data-id），局内点的是"这一趟"（没有 id，
     * 从 state.run 取）—— 两条入口共用同一个确认状态机，所以确认键统一成 charId。
     *
     * 这是**唯一**一处"没死却扣命"的操作，所以在 UI 上必须两步：
     * 第一次点只把按钮改成"真的放弃？扣 1 命"，第二次才执行。
     * 顺带一提，进塔本身是免费的 —— 命数只在阵亡或放弃时 -1。
     */
    case 'abandon': {
      const id = d.id || state.run?.characterId || null;
      if (!id) break;
      if (state.confirmAbandon !== id) {
        state.confirmAbandon = id;
        render();
        break;
      }
      state.confirmAbandon = null;
      abandonExplore(id);
      break;
    }
    case 'cancel-abandon':
      state.confirmAbandon = null;
      render();
      break;
    /**
     * 暂停回大厅（v3.3）。
     *
     * 和「放弃探险」互为反面：**不扣命、不结算、不丢任何进度**，
     * run 原样留在存档里，大厅名册上变成「继续探险」，点一下回到
     * 离开时的那个界面（地图 / 战斗 / 奖励 / 行商 / 祭坛）。
     *
     * 这不是新开的后门 —— 关掉页面再打开本来就回到塔里（boot 会读档）。
     * 把它做成按钮，只是让玩家不用靠"杀掉 App"来喘口气。
     * 塔内没有任何回复手段，暂停回去也变不强，所以谈不上作弊。
     */
    case 'pause': {
      if (!state.run) break;
      saveRun(state.run);
      state.meta.run = { characterId: state.run.characterId, floor: state.run.floor, paused: true };
      saveMeta(state.meta);
      state.confirmAbandon = null;
      state.showLog = false;
      state.showFoeDeck = false;
      state.showRelics = false;
      state.flash = '已暂停 · 进度保留，点「继续探险」回来';
      state.screen = 'hall';
      render();
      break;
    }
    /**
     * 营地（v3.4）。
     *
     * 名册从大厅平铺改成独立页面：大厅一半的高度都被 6 张角色卡占着，
     * "招募席位"要滑很久才看得到。营地页用两个 tab 分开实习 / 转正 ——
     * 这两拨人**能做的事完全不同**（实习只能进塔，转正只能打竞技场），
     * 混在一张列表里玩家得一张张读按钮才分得清。
     */
    /**
     * 三个入口（v3.8）：冒险 / 竞技场 / 图鉴。
     * 都先落到"选人 / 选页"这一步，不在首页直接开局 —— 首页只负责"去哪"。
     */
    case 'open-expedition':
      state.help = false;
      state.screen = 'expedition';
      render();
      break;
    case 'open-arena':
      state.help = false;
      state.screen = 'arena-roster';
      render();
      break;
    case 'open-codex':
      state.help = false;
      state.screen = 'codex';
      render();
      break;
    case 'codex-tab':
      if (state.screen !== 'codex') break;
      state.codexTab = ['cards', 'races', 'relics', 'equip'].includes(d.tab) ? d.tab : 'cards';
      render();
      break;
    case 'codex-class':
      if (state.screen !== 'codex') break;
      state.codexCls = d.cls || 'generic';
      render();
      break;
    case 'open-roster':
      state.help = false;
      state.screen = 'roster';
      state.confirmAbandon = null;
      render();
      break;
    /* ---------------- 商城（v3.90）—— 屏名用 mall：'shop' 是局内行商 ---------------- */
    case 'open-shop':
      state.help = false;
      state.screen = 'mall';
      render();
      break;
    /** 种族养成（v3.95：并入图鉴「种族」页签，独立页已删） */
    case 'race-unlock': {
      if (state.screen !== 'codex') break;
      const res = unlockRace(state.meta, d.race);
      if (res.ok) {
        saveMeta(state.meta);
        state.flash = `解锁了${RACES[d.race]?.name || '新种族'}`;
      } else {
        state.flash = res.reason;
      }
      render();
      break;
    }
    case 'race-levelup': {
      if (state.screen !== 'codex') break;
      const res = levelUpRace(state.meta, d.race);
      if (res.ok) {
        saveMeta(state.meta);
        state.flash = `${RACES[d.race]?.name || '种族'} 升到 Lv ${res.level}`;
      } else {
        state.flash = res.reason;
      }
      render();
      break;
    }
    /**
     * 碎片宝箱（v3.90 起挂在商城页）：和金币广告同一套契约 —— **播完才发奖**。
     * 顺序刻意是「记账 → 发碎片」：万一发奖逻辑抛错，次数也已经被扣掉，
     * 不会变成无限开箱（宁可少给一次，不能白送）。
     */
    case 'race-box': {
      if (state.screen !== 'mall' || state.adPlaying) break;
      const check = canWatchBoxAd(state.meta, Date.now());
      if (!check.ok) {
        state.flash = check.reason;
        render();
        break;
      }
      showAdThenReward();
      break;
    }
    /**
     * 古币宝箱 / 装备宝箱（v3.90）：金币线，不限次数 —— 金币本身是闸门。
     * 扣钱和发奖都在 core 一步完成（先校验后扣），UI 只负责转述结果。
     */
    case 'gold-chest': {
      if (state.screen !== 'mall') break;
      const got = openGoldChest(state.meta, new Rng((Date.now() ^ 0x5bf03635) >>> 0));
      if (!got.ok) {
        state.flash = got.reason;
        render();
        break;
      }
      saveMeta(state.meta);
      const parts = [];
      if (got.raceId) parts.push(`${got.name} 碎片 ×${got.shards}`);
      if (got.refund) parts.push(`碎片箱满级折 ${got.refund} 金`);
      if (got.seed) parts.push('<b>掉落命数之种 ×1！</b>');
      state.flash = `古币宝箱开出 ${parts.join(' · ') || '空箱'}`;
      render();
      break;
    }
    case 'equip-chest': {
      if (state.screen !== 'mall') break;
      const got = openEquipChest(state.meta, new Rng((Date.now() ^ 0x1f123bb5) >>> 0));
      if (!got.ok) {
        state.flash = got.reason;
        render();
        break;
      }
      saveMeta(state.meta);
      state.flash = `装备宝箱开出 <b>${got.name}</b>，已放进装备库`;
      render();
      break;
    }
    /** 命数之种（v3.90）：角色详情页使用，+1 命数封顶种族 +2 */
    case 'use-seed': {
      const ch = M.findCharacter(state.meta, d.id);
      const res = useLifeSeed(state.meta, ch);
      flash(res.ok ? `命数 +1 → ${res.lives}（剩 ${res.left} 颗种子）` : res.reason);
      if (res.ok) saveMeta(state.meta);
      render();
      break;
    }
    case 'roster-tab':
      if (state.screen !== 'roster') break;
      state.rosterTab = d.tab === 'veteran' ? 'veteran' : 'probation';
      render();
      break;
    case 'back-hall':
      if (state.screen === 'equip' && state.equipHero) {
        /** v3.72：从角色详情页进来的装备库，离开回详情页（hero 快照还原） */
        state.screen = state.returnTo === 'roster' ? 'roster' : 'hall';
        state.hero = state.equipHero;
        state.equipHero = null;
        state.returnTo = 'hall';
      } else if (state.returnTo === 'roster' && state.screen === 'equip') {
        /** 从营地进来的子页面，返回营地而不是甩回大厅 —— 少走一步 */
        state.screen = 'roster';
        state.returnTo = 'hall';
      } else {
        state.screen = 'hall';
      }
      state.confirmConvert = null;
      render();
      break;

    /* ---------------- 装备与庄园（v2.3） ---------------- */
    case 'open-equip':
      /**
       * v3.72：从角色详情页进来时把 hero 快照收起来，返回时原样还原 ——
       * 装备库的「离开」从此回到详情页而不是甩回大厅/营地。
       * 其他入口（营地行按钮等）行为不变。
       */
      state.equipHero = (state.hero?.mode === 'char' && state.hero?.id === d.id) ? state.hero : null;
      state.hero = null;
      state.equipCharId = d.id;
      state.confirmConvert = null;
      state.returnTo = state.screen === 'roster' ? 'roster' : 'hall';
      state.screen = 'equip';
      render();
      break;
    case 'open-manor':
      state.screen = 'manor';
      render();
      break;
    case 'equip-item': {
      const res = equipItem(state.meta, state.equipCharId, d.id);
      /** v3.72：穿满自动换位 —— 必须说清换下了什么，否则玩家以为装备丢了 */
      flash(res.ok ? (res.swapped ? `已换上，换下了 ${equipTitle(res.swapped)}` : '已穿上') : res.reason);
      saveMeta(state.meta);
      render();
      break;
    }
    case 'unequip-item': {
      const res = unequipItem(state.meta, d.id);
      flash(res.ok ? '已脱下' : res.reason);
      saveMeta(state.meta);
      render();
      break;
    }
    case 'enhance-item': {
      const res = enhanceItem(state.meta, d.id);
      flash(res.ok ? `强化成功 → +${res.lv}（花 ${res.cost} 星屑）` : res.reason);
      saveMeta(state.meta);
      render();
      break;
    }
    case 'recycle-item': {
      const res = recycleItem(state.meta, d.id);
      flash(res.ok ? `回收成功，星屑碎片 +${res.gain}✧` : res.reason);
      saveMeta(state.meta);
      render();
      break;
    }
    case 'combine-shards': {
      const res = combineShards(state.meta);
      flash(res.ok ? `合成成功，星屑 +1✦（剩碎片 ${res.shards}✧）` : res.reason);
      saveMeta(state.meta);
      render();
      break;
    }
    /**
     * 退役成庄园：不可逆，所以和「放弃探险」用同一套两段确认。
     * 角色会离开名册（装备先脱回库里），从此只产星屑。
     */
    case 'ask-convert':
      state.confirmConvert = d.id;
      render();
      break;
    case 'cancel-convert':
      state.confirmConvert = null;
      render();
      break;
    case 'convert-manor': {
      const res = convertToManor(state.meta, d.id, Date.now());
      flash(res.ok ? `${res.manor.name} 退役了，庄园开始产星屑` : res.reason);
      state.confirmConvert = null;
      if (res.ok) {
        state.equipCharId = null;
        state.screen = 'manor';
      }
      saveMeta(state.meta);
      render();
      break;
    }
    case 'collect-manor': {
      const res = collectManor(state.meta, Number(d.index), Date.now());
      flash(res.ok ? `收取 ${res.amount} 星屑（共 ${res.total}）` : res.reason);
      saveMeta(state.meta);
      render();
      break;
    }
    case 'open-grave':
      state.screen = 'grave';
      render();
      break;
    case 'watch-ad':
      watchAd();
      break;
    case 'abort-ad':
      state.adAbort?.abort();
      break;

    /* ---------------- 战斗 ---------------- */
    /**
     * 出牌（v3.2 加了打击反馈）。
     *
     * 以前这里是"算完 → 整页重绘"一步到位：牌没了、血少了一截，
     * 但中间没有任何东西告诉玩家"我刚才那一下打出去了"。现在分三步：
     *   1. 手牌缩着往上飞（110ms，纯 CSS）
     *   2. 结算并重绘
     *   3. 血条补间 + 敌人受击抖动 + 飘伤害数字（afterAction 里）
     * 动画期间 state.acting 锁输入 —— 旧 DOM 上的第二次点击会按错索引出牌。
     */
    case 'play': {
      if (state.acting) return;
      /** v3.33：竞技场的手牌复用同一张卡面，所以也走同一个动作名 */
      if (state.screen === 'arena-battle') { playArenaCard(Number(d.index), el); return; }
      if (state.screen !== 'battle') return;
      /** v3.37：敌方回合不许出牌（core 会挡，这里早退免得牌飞动画白播） */
      if (state.run?.battle?.phase !== 'player') return;
      state.showLog = false;
      state.showFoeDeck = false;
      state.showRelics = false;

      const idx = Number(d.index);
      state.prevHp = readHp();
      const card = el?.closest?.('.card');

      const commit = () => {
        state.acting = false;
        if (!state.run || state.screen !== 'battle') return;
        afterAction(play(state.run, idx));
      };

      if (card) {
        state.acting = true;
        card.classList.add('card-fly');
        setTimeout(commit, 110);
      } else {
        commit();
      }
      break;
    }
    case 'end-turn': {
      if (state.screen !== 'battle' || state.acting) return;
      state.showLog = false;
      state.showFoeDeck = false;
      state.showRelics = false;
      state.prevHp = readHp();

      /**
       * v3.37：敌人回合逐张播放。
       * endPlayerTurn 只收玩家回合 + 开敌方回合；敌方每张牌由 drivePveEnemy
       * 每 520ms 走一步 —— 和竞技场同款节奏，敌人不是一瞬间凭空打完的。
       */
      const r = endPlayerTurn(state.run);
      if (r.phase === 'enemy') {
        state.acting = true;
        state.pveStep = null;
        state.pveSeq = (state.pveSeq || 0) + 1;
        saveRun(state.run);
        syncRunScreen();
        render();
        animateHpBars(state.prevHp);
        state.prevHp = null;
        spawnFloats(r.events);
        schedulePveEnemy(state.pveSeq, 520);
      } else {
        afterAction(r.events);
      }
      break;
    }
    /* 战斗记录：敌人不预告意图，这里是唯一的"它刚才干了什么" */
    case 'open-log':
      state.showLog = true;
      state.showRelics = false;
      render();
      break;
    case 'close-log':
      state.showLog = false;
      state.showFoeDeck = false;
      render();
      break;
    /* 点面板本身不关闭，只有点遮罩或关闭按钮才关 */
    case 'log-noop':
      break;
    /**
     * 敌人牌库（v3.42，用户：「敌人的牌库应该是有入口可以查看的」）。
     * 只公开"带了哪些牌"，洗牌顺序不给 —— 意图不预告这条设计不能被入口破坏。
     */
    case 'open-foe-deck':
      state.showFoeDeck = true;
      state.showLog = false;
      state.showRelics = false;
      render();
      break;
    case 'close-foe-deck':
      state.showFoeDeck = false;
      render();
      break;
    /**
     * v3.44 战场折叠行：词条/状态放不下时收成单行，▾ 手动展开、▴ 收回。
     */
    case 'toggle-foe-tags':
      state.foeTagsOpen = !state.foeTagsOpen;
      render();
      break;
    case 'toggle-player-tags':
      state.playerTagsOpen = !state.playerTagsOpen;
      render();
      break;
    /** 点天赋小图标：蒙板卡片看完整描述（v3.45，与词条/宝物同一浮层） */
    case 'foe-deck-noop':
      break;
    /**
     * 竞技场记录（v3.36）：战斗中常驻面板的折叠开关；
     * 结算页默认收起，这里负责展开/收起。
     */
    case 'toggle-arena-log':
      if (state.screen !== 'arena-battle') return;
      state.arena.logOpen = !(state.arena.logOpen !== false);
      render();
      break;
    case 'toggle-result-log':
      if (state.screen !== 'arena-result') return;
      state.arena.resultLogOpen = !state.arena.resultLogOpen;
      render();
      break;
    /**
     * 宝物效果浮层。
     *
     * 宝物是整局都在生效的被动，但以前界面上只有个名字，玩家想知道
     * "铁砧到底给几点能量"只能靠记。任何一个名字都能点开看全文。
     */
    /**
     * 宝物气泡（v3.17.2）：触屏没有 hover，点一下把气泡钉住。
     * 只切 DOM class、不重渲染 —— 重渲染会把气泡打回原形，还得把
     * "钉住了哪个"存进 state 再传三层传下去，不值当。
     */
    case 'relic-tip': {
      /** v3.45：气泡改成蒙板卡片（与词条/天赋同一浮层），效果全文 + 升级预览 */
      const box = el.querySelector('.rtip-box');
      if (box) showTip(el.dataset.name || el.textContent.trim(), box.innerHTML);
      break;
    }
    case 'relics-noop':
      break;
    case 'choose': {
      if (state.screen !== 'reward') return;
      applyReward(state.run, Number(d.index));
      saveRun(state.run);
      syncRunScreen();
      render();
      break;
    }
    /* ---------------- 强化祭坛（v2.2） ---------------- */
    case 'pick-upgrade': {
      if (state.screen !== 'forge') return;
      chooseUpgradeCard(state.run, d.key);
      saveRun(state.run);
      syncRunScreen();
      render();
      break;
    }
    case 'cancel-upgrade': {
      if (state.screen !== 'forge') return;
      cancelUpgrade(state.run);
      saveRun(state.run);
      syncRunScreen();
      render();
      break;
    }
    /**
     * 从地图回到没选完的祭坛（v3.34）：离开不弃单，
     * 顶栏的「↑ 祭坛」按钮就是回来的路。
     */
    case 'open-altar': {
      if (state.screen !== 'dungeon' || !state.run) return;
      if (!reopenAltar(state.run)) {
        flash('这次强化已经用掉了');
        render();
        break;
      }
      saveRun(state.run);
      syncRunScreen();
      render();
      break;
    }
    /* ---------------- 付费祭坛（v3.37）：焚卡 / 变形 ---------------- */
    case 'altar-remove': {
      if (state.screen !== 'altar' || state.run?.phase !== 'remove') return;
      const res = removeCardInRun(state.run, d.key);
      if (!res.ok) flash(res.reason);
      else flash(res.text);
      saveRun(state.run);
      render();
      break;
    }
    case 'altar-morph': {
      if (state.screen !== 'altar' || state.run?.phase !== 'morph') return;
      const res = morphCardInRun(state.run, d.key);
      if (!res.ok) flash(res.reason);
      else flash(res.text);
      saveRun(state.run);
      render();
      break;
    }
    case 'cancel-altar': {
      if (state.screen !== 'altar') return;
      cancelRunAltar(state.run);
      saveRun(state.run);
      syncRunScreen();
      render();
      break;
    }
    /* ---------------- 委托板（v3.85）：接受 / 婉拒 ---------------- */
    case 'quest-accept': {
      if (state.screen !== 'quest' || !state.run) return;
      const res = acceptQuest(state.run);
      if (!res.ok) {
        flash(res.reason);
        render();
        break;
      }
      saveRun(state.run);
      syncRunScreen();
      render();
      break;
    }
    case 'quest-decline': {
      if (state.screen !== 'quest' || !state.run) return;
      declineQuest(state.run);
      saveRun(state.run);
      syncRunScreen();
      render();
      break;
    }
    /* ---------------- 行商（v1.8） ---------------- */
    case 'buy-card': {
      const res = buyShopCard(state.run, Number(d.index));
      if (!res.ok) flash(res.reason);
      saveRun(state.run);
      render();
      break;
    }
    case 'buy-relic': {
      const res = buyShopRelic(state.run, Number(d.index));
      if (!res.ok) flash(res.reason);
      saveRun(state.run);
      render();
      break;
    }
    case 'refresh-shop': {
      const res = refreshShop(state.run);
      if (!res.ok) flash(res.reason);
      else flash(`换了一批货 · 花掉 ${res.cost}${res.kind === 'relic' ? ' 水晶材料' : ' 古币'}`);
      saveRun(state.run);
      render();
      break;
    }
    case 'leave-shop': {
      leaveShop(state.run);
      saveRun(state.run);
      syncRunScreen();
      render();
      break;
    }
    /* ---------------- 迷宫层（v2.0） ---------------- */
    /**
     * 格子的两段式：
     *   未翻开 → 只翻开（看清是什么，不触发）
     *   已翻开 → 触发（进战斗 / 开箱子 / 进店 / 下楼）
     * 规则在 core 里判，UI 只负责把结果翻译成一句话。
     */
    /**
     * 格子：v3.14 起一段式 —— 暗格点一下就是"翻开并当场结算"，
     * 已翻开的格（旧存档）也是同一条路径。规则在 core 里判，
     * UI 只负责把结果翻译成一句话。
     */
    case 'cell': {
      if (state.screen !== 'dungeon' || !state.run) return;
      const idx = Number(d.index);
      const cell = state.run.floorMap?.cells?.[idx];
      if (!cell) return;

      const res = stepCell(state.run, idx);
      state.run.lastCellNote = res.text || res.reason || '';
      /**
       * 宝箱里的装备（v2.3）：**当场入账号库**，不进 run。
       * 这样就算下一秒死在塔里，这件装备也已经安全落地了 ——
       * 正是用户要的"冒险失败也能把装备带出来"。
       */
      if (res.equip) {
        addEquipment(state.meta, res.equip.defId);
        saveMeta(state.meta);
      }

      /**
       * v3.78：踩楼梯下到 31 层 = 通关（phase → won），这里必须立刻
       * 走 finishExplore 结算 —— 以前这个分支不查终局，syncRunScreen
       * 把 won 当 battle 渲染，屏幕卡死还能继续点楼梯涨层数。
       */
      if (state.run.phase === 'won' || state.run.phase === 'dead') {
        finishExplore(false);
        return;
      }

      saveRun(state.run);
      syncRunScreen();
      render();
      break;
    }
    /** v3.19 迷宫玩法引导：顶栏 ？ 回看 / 关闭时记住"教过了" */
    case 'maze-guide':
      state.mazeGuide = true;
      render();
      break;
    case 'maze-guide-ok':
      state.mazeGuide = false;
      localStorage.setItem('rs_maze_tut', '1');
      render();
      break;
    /* 点敌人词条 / 天赋图标：蒙板卡片看效果全文，点任意处关闭。
       d.name/d.text 是 dataset 读出来的，浏览器已自动解过实体 */
    case 'show-tip':
      showTip(d.name || '', escTip(d.text || ''));
      break;
    case 'close-tip':
      closeTip();
      break;

    /* ---------------- 背包 ---------------- */
    case 'forge': {
      const res = forgeInRun(state.run, d.key);
      flash(res.ok ? `合成成功：${cardName(res.key)}，水晶材料 +1` : res.reason);
      if (res.ok) {
        saveRun(state.run);
        /** v3.84：从详情页合成蒙板确认的，合完收起蒙板看牌库变化 */
        if (state.hero) {
          state.hero.forgeOpen = false;
          state.hero.forgeDetail = null;
        }
      }
      render();
      break;
    }
    case 'activate': {
      const res = activateRelicInRun(state.run, d.id, M.MATERIAL_PER_RELIC);
      flash(res.ok ? `激活了 ${res.name}` : res.reason);
      if (res.ok) saveRun(state.run);
      render();
      break;
    }

    /* ---------------- 竞技场 ---------------- */
    case 'arena-daily': {
      /** 每日段位奖励（v3.35）：哪个页发起的都回到原页 */
      const res = claimDaily(state.meta, findChar(d.id), Date.now());
      flash(res.ok ? `领取了 ${res.gold} 金币（${res.rank.name}段位每日奖励）` : res.reason);
      saveMeta(state.meta);
      render();
      break;
    }
    case 'arena':
      openArena(d.id);
      break;
    case 'fight': {
      const res = startArenaFight(Number(d.index));
      if (!res.ok) flash(res.reason);
      render();
      break;
    }
    /** 竞技场出牌走上面的 case 'play'（手牌是同一张卡面，动作名必须一致） */
    case 'arena-end-turn': {
      if (state.screen !== 'arena-battle' || state.acting) return;
      const a = state.arena;
      if (!a?.battle || a.battle.phase !== 'player') return;
      state.showLog = false;
      state.showFoeDeck = false;

      const prev = arenaHp();
      const res = arenaEndTurn(a.battle);
      a.step = null;
      syncArena();
      render();
      animateHpBars(prev);
      spawnFloats(res.events);

      if (a.battle.phase === 'enemy') {
        state.acting = true;
        scheduleEnemyTurn(a.seq, 420);
      } else {
        setTimeout(() => finishArenaFight(), 520);
      }
      break;
    }
    /** 弃权 = 认输，按败北结算（否则玩家被关在没有出口的决斗场里） */
    case 'arena-forfeit': {
      if (state.screen !== 'arena-battle') return;
      const a = state.arena;
      if (!a?.battle) return;
      a.battle.phase = 'lost';
      a.battle.winner = 'e';
      finishArenaFight();
      break;
    }

    /* ---------------- 兜底 ---------------- */
    case 'hard-reset':
      try {
        localStorage.removeItem('ruin-spire/hall');
        localStorage.removeItem('ruin-spire/run');
      } catch {
        /* 隐私模式 */
      }
      location.reload();
      break;
    case 'reload':
      location.reload();
      break;

    default:
      break;
  }
}

/* ------------------------------------------------------------------ *
 * 广告位
 *
 * 流程：点横幅 → 遮罩播放 → **播完才发奖**。
 * 提前关闭或 SDK 报错一律不发 —— 这是激励视频的基本契约，
 * 否则"点开就关"就成了免费金币机。
 * ------------------------------------------------------------------ */

async function watchAd() {
  if (state.adPlaying) return;

  const check = canWatchAd(state.meta, Date.now());
  if (!check.ok) {
    flash(check.reason);
    render();
    return;
  }

  state.adPlaying = true;
  const ac = new AbortController();
  state.adAbort = ac;

  const overlay = document.createElement('div');
  overlay.className = 'ad-overlay';
  overlay.dataset.slot = AD_SLOT_ID;
  overlay.innerHTML = `
    <div class="ad-frame">
      <div class="ad-tag">广告位</div>
      <div class="ad-count"><b>--</b></div>
      <p class="ad-note">看完发放 ${AD_REWARD_GOLD} 金币</p>
      <button class="btn ghost wide" data-action="abort-ad">关闭广告</button>
    </div>`;
  app.appendChild(overlay);

  const res = await playRewardedAd({
    signal: ac.signal,
    onTick: (left) => {
      const b = overlay.querySelector('.ad-count b');
      if (b) b.textContent = String(left);
    },
  });

  overlay.remove();
  state.adPlaying = false;
  state.adAbort = null;

  if (!res.ok) {
    flash('广告没看完，这次不算');
    render();
    return;
  }

  const got = grantAdReward(state.meta, Date.now());
  if (got.ok) {
    saveMeta(state.meta);
    flash(`看广告获得 ${got.gold} 金 · 今日还剩 ${got.left} 次`);
  } else {
    flash(got.reason);
  }
  render();
}

/* ------------------------------------------------------------------ *
 * 碎片宝箱（v3.89）
 *
 * 和金币广告共用一套遮罩与契约，只有两处不同：广告位换成 box、
 * 奖励换成"记账 + 抽碎片"。抽奖用 Rng 而不是 Math.random ——
 * 项目里所有随机都走同一个 Rng，方便复现和测试。
 * ------------------------------------------------------------------ */

async function showAdThenReward() {
  if (state.adPlaying) return;

  state.adPlaying = true;
  const ac = new AbortController();
  state.adAbort = ac;

  const overlay = document.createElement('div');
  overlay.className = 'ad-overlay';
  overlay.dataset.slot = AD_BOX_SLOT_ID;
  overlay.innerHTML = `
    <div class="ad-frame">
      <div class="ad-tag">广告位</div>
      <div class="ad-count"><b>--</b></div>
      <p class="ad-note">看完开一箱碎片（6~12 块）</p>
      <button class="btn ghost wide" data-action="abort-ad">关闭广告</button>
    </div>`;
  app.appendChild(overlay);

  const res = await playRewardedAd({
    slot: 'box',
    signal: ac.signal,
    onTick: (left) => {
      const b = overlay.querySelector('.ad-count b');
      if (b) b.textContent = String(left);
    },
  });

  overlay.remove();
  state.adPlaying = false;
  state.adAbort = null;

  if (!res.ok) {
    state.flash = res.reason === 'aborted' ? '广告没看完，这次不算' : (res.reason || '广告没播完');
    render();
    return;
  }

  /** 先记账再发奖：发奖万一抛错，次数也已经扣掉，不会变成无限开箱 */
  const rec = grantBoxAdRecord(state.meta, Date.now());
  if (!rec.ok) {
    state.flash = rec.reason;
    render();
    return;
  }

  const got = grantShardBox(state.meta, new Rng((Date.now() ^ 0x9e3779b9) >>> 0));
  saveMeta(state.meta);

  if (got.raceId) {
    state.flash = `开出 ${got.name} 碎片 ×${got.shards} · 今日还剩 ${rec.left} 次`;
  } else {
    state.flash = `所有种族都满级了，这一箱换成 ${got.gold} 金 · 今日还剩 ${rec.left} 次`;
  }
  render();
}

/* ------------------------------------------------------------------ *
 * 探险
 * ------------------------------------------------------------------ */

/**
 * 战斗掉落的装备（v2.3）：精英/首领打完会在 run 上挂一个 pendingEquip。
 * 这里把它转进**账号装备库** —— 哪怕下一场就死，这件也已经到手了。
 */
function collectBattleLoot(run) {
  if (!run?.pendingEquip) return null;
  const defId = run.pendingEquip.defId;
  run.pendingEquip = null;
  const item = addEquipment(state.meta, defId);
  if (item) saveMeta(state.meta);
  return item;
}

function startExplore(charId) {
  const ch = findChar(charId);
  if (!ch) return;
  /**
   * 准入判定放在 core：转正之后塔就关上了（canExplore 会拒绝）；
   * meta.run 挂着（有人正在塔里）同样拒绝 —— 否则新开局会覆盖他的存档。
   * 这里只负责把拒绝原因说给玩家听。
   */
  const check = canExplore(ch, state.meta.run);
  if (!check.ok) {
    flash(check.reason);
    render();
    return;
  }

  state.hero = null;
  state.run = createRun({
    character: ch,
    seed: (Date.now() % 900000) + 1,
    /** 装备快照：加成只进这一趟的 run.player，不写进角色本体（见 run.js 注释） */
    equipment: equippedSnapshot(state.meta, ch.id),
  });
  ch.status = 'exploring';
  state.meta.run = { characterId: ch.id, floor: 1 };
  state.recorded = false;
  state.showLog = false;
  state.showFoeDeck = false;
  state.explore = null;
  state.confirmAbandon = null;
  /** v2.0：开局落在地图上，不是直接进战斗（syncRunScreen 已按 phase 切到 dungeon） */
  syncRunScreen();
  saveRun(state.run);
  /**
   * 这里**不能**用 persist()：它会把 screen 强制设回 hall（那是给招募/刷新用的），
   * 结果就是点了「出发探险」还停在大厅，必须再点一次「继续探险」。
   */
  saveMeta(state.meta);
  render();
}

/** 中途放弃：按阵亡处理（扣 1 命 + 成果回滚），否则玩家可以在快死时退出重来 */
function abandonExplore(charId) {
  const ch = findChar(charId);
  if (!ch || !state.run) return;
  finishExplore(true);
}

/** 出牌前的血量快照（战斗页专用，别的屏一律 null） */
function readHp() {
  const b = state.run?.battle;
  if (!b) return null;
  return { p: b.player.hp, pm: b.player.maxHp, e: b.enemy.hp, em: b.enemy.maxHp };
}

/**
 * 敌人回合播放（v3.37）—— 与竞技场 scheduleEnemyTurn 同款结构。
 *
 * 一次走一张牌，间隔 520ms：敌人不是一瞬间凭空打完的，玩家要看清它打什么。
 * `seq` 是重入保护：换屏 / 新一场之后，上一条定时器链必须自己停。
 */
function schedulePveEnemy(seq, delay = 0) {
  if (state.pveSeq !== seq) return;
  setTimeout(() => drivePveEnemy(seq), delay);
}

function drivePveEnemy(seq) {
  const run = state.run;
  if (!run?.battle || state.pveSeq !== seq || state.screen !== 'battle') {
    state.pveDriving = false;
    return;
  }

  const prev = readHp();
  const step = enemyStepPve(run);
  state.pveStep = step;

  if (!step.done) {
    render();
    animateHpBars(prev);
    spawnFloats(step.events);
    schedulePveEnemy(seq, 520);
    return;
  }

  /** 敌人回合收场（或整场结束）：走 afterAction —— 战利品、存档、结束判定都在那 */
  state.acting = false;
  state.pveDriving = false;
  afterAction(step.events);
}

/** 竞技场的血量快照（animateHpBars 只认这个形状） */
function arenaHp() {
  const b = state.arena?.battle;
  if (!b) return null;
  return { p: b.player.hp, pm: b.player.maxHp, e: b.enemy.hp, em: b.enemy.maxHp };
}

/**
 * 血条补间（v3.2）。
 *
 * 每张牌都会整页重绘，`.hpbar .fill` 的 `transition: width` 其实从来没生效过 ——
 * 新元素一出生就是最终宽度，视觉上是"啪"地跳一下。这里把新元素先按旧值摆好，
 * 下一帧再放开到目标值，玩家才看得到那一截血真的被削掉了。
 */
function animateHpBars(prev) {
  if (!prev) return;
  const rows = [
    ['.hpbar.hp-player .fill', prev.p, prev.pm],
    ['.hpbar.hp-enemy .fill', prev.e, prev.em],
  ];
  for (const [sel, cur, max] of rows) {
    const fill = app.querySelector(sel);
    if (!fill || !max) continue;
    const to = fill.style.width || '100%';
    const from = Math.max(0, Math.min(100, (cur / max) * 100));
    if (`${from}%` === to) continue;
    fill.style.transition = 'none';
    fill.style.width = `${from}%`;
    void fill.offsetWidth;
    fill.style.transition = '';
    requestAnimationFrame(() => { fill.style.width = to; });
  }
}

function afterAction(events = []) {
  const run = state.run;
  if (!run) return;

  /**
   * v3.72：战斗中完成委托（杀怪 / 出攻击牌）时 core 会写 lastQuestNote ——
   * 挪到 lastCellNote 走地图横幅那一套展示（reward/map 屏都会带）。
   */
  if (run.lastQuestNote) {
    run.lastCellNote = run.lastQuestNote;
    run.lastQuestNote = '';
  }

  /** 先把战斗掉落的装备入账，再判断是不是结束 —— 最后一击掉的装备也算得到（v2.3） */
  collectBattleLoot(run);

  if (run.phase === 'dead' || run.phase === 'won') {
    finishExplore(false);
    return;
  }

  syncRunScreen();
  /**
   * 只要还没结束就存档：地图、战斗、奖励、行商都要能续。
   * （v2.0 尤其重要 —— 一层里翻开的格子不能因为关页面重新洗牌）
   */
  saveRun(run);
  state.meta.run = { characterId: run.characterId, floor: run.floor };

  render();
  animateHpBars(state.prevHp);
  state.prevHp = null;
  spawnFloats(events);
}

/**
 * 把 run.phase 映射成屏幕。
 *
 * v1.8 多了 'shop' 之后，"选完奖励"不再必然进战斗 —— 这一步不能再写死，
 * 否则 applyReward 一开商店就会去渲染一个没有 battle 的战斗页。
 */
function syncRunScreen() {
  /**
   * 没有 run 一律回大厅（v3.9.1）。
   * 之前这里读 `state.run?.phase` → undefined → 落到最后那个 else 的 'battle'，
   * 于是渲染出一个没有战斗对象的战斗页，屏幕上只剩"战斗已结束"。
   */
  if (!state.run) {
    state.screen = 'hall';
    return;
  }
  const phase = state.run.phase;
  const prevScreen = state.screen;
  state.screen = phase === 'reward' ? 'reward'
    : phase === 'shop' ? 'shop'
      : phase === 'upgrade' ? 'forge'
        : phase === 'remove' || phase === 'morph' ? 'altar'
          : phase === 'quest' ? 'quest'
            : phase === 'map' ? 'dungeon'
              : 'battle';
  /**
   * phase 说是战斗、却连战斗对象都没有 —— 状态已经坏了。
   * 有地图就退回地图（玩家还能继续翻格），没有就回大厅，绝不留在空战斗页。
   */
  if (state.screen === 'battle' && !state.run.battle) {
    state.screen = state.run.floorMap ? 'dungeon' : 'hall';
  }
  /**
   * 换屏一律收起浮层：留在旧屏的遮罩会挡住新屏，点哪都没反应。
   *
   * v3.87：**只在真的换屏时收**。这里被 `afterAction` 每次动作都调用，
   * 敌人回合的逐帧推进也算动作 —— 原来无条件 `state.hero = null`，
   * 于是玩家在敌人出牌动画中点开角色详情，两百毫秒后就被"顺手关掉"，
   * 看起来像是详情页点不进去。屏幕没变就不用动浮层。
   */
  if (prevScreen !== state.screen) {
    state.showRelics = false;
    state.runStats = false;
    state.hero = null;
  }
}

/**
 * 结束一次探险
 * @param {boolean} forced 是否中途放弃（按阵亡算）
 */
function finishExplore(forced) {
  const run = state.run;
  const meta = state.meta;
  const ch = findChar(run.characterId);
  if (!ch) return;

  /** 阵亡前掉的装备也要收下（v2.3）—— 这是"失败也能带出装备"最直接的一条 */
  collectBattleLoot(run);

  /**
   * 进塔不扣命，**只有这一趟真的死了才 -1**。
   * 记下出发前的命数，结算页直接显示 "-1"，别让玩家自己猜。
   */
  const livesBefore = ch.lives;

  const outcome = forced
    ? { survived: false, cleared: false, floor: Math.max(0, run.floor - 1), deck: run.deck, relics: run.relics }
    : runOutcome(run);

  sfx(outcome.survived ? 'win' : 'lose');

  let gold = 0;
  let promoted = false;
  let promoteBlocked = false;
  if (outcome.survived) {
    writeBackToCharacter(run, ch);
    const res = onExploreReturn(ch, outcome.floor, meta.roster);
    promoted = !!res?.promoted;
    promoteBlocked = !!res?.promoteBlocked;
    gold = M.settleExploreWin(meta, ch, outcome.floor, outcome.cleared).gold;
    M.pushGhost(meta, ch);
  } else {
    onExploreDeath(ch, outcome.floor);
    M.settleExploreLose();
    if (ch.status === 'dead') M.bury(meta, ch);
  }

  state.explore = { char: ch, outcome, gold, promoted, promoteBlocked, livesBefore, abandoned: forced };
  state.run = null;
  state.hero = null;
  state.confirmAbandon = null;
  meta.run = null;
  clearRun();
  saveMeta(meta);

  state.screen = 'explore-result';
  render();
}

/* ------------------------------------------------------------------ *
 * 竞技场
 * ------------------------------------------------------------------ */

function openArena(charId) {
  const ch = findChar(charId);
  if (!ch) return;
  const check = canEnterArena(ch, Date.now());
  if (!check.ok) {
    flash(check.reason);
    render();
    return;
  }

  const rng = new Rng((Date.now() % 100000) + 3);
  /** v3.35：匹配看段位分，不再看角色评级 */
  const opponents = M.matchOpponents(state.meta, scoreOf(ch), rng, 3);
  if (!opponents.length) {
    flash('没有可匹配的对手');
    render();
    return;
  }

  state.hero = null;
  state.arena = { charId, opponents, ghost: null, battle: null, view: null, step: null, result: null, gold: 0, seq: 0 };
  state.screen = 'arena';
  render();
}

/** 竞技场战斗对象 → 渲染快照。每一步之后都调一次 */
function syncArena() {
  const a = state.arena;
  if (a?.battle) a.view = arenaBattleView(a.battle);
}

/**
 * 开打（v3.33）：不再"一次模拟出结果"，而是把战斗对象交给玩家。
 *
 * 次数在这里就扣 —— 与旧版一致。中途关页面这一场作废（战斗对象里有宝物钩子函数，
 * 存不进 localStorage），所以开局写一个 `arenaPending` 标记，重进时给一句提示。
 */
function startArenaFight(index) {
  const a = state.arena;
  const ch = findChar(a.charId);
  const ghost = a.opponents[index];
  if (!ch || !ghost) return { ok: false, reason: '对手不存在' };
  const check = canEnterArena(ch, Date.now());
  if (!check.ok) return check;

  const battle = createArenaBattle(
    { ...ch, equipped: equippedSnapshot(state.meta, ch.id) },
    ghost,
    (Date.now() % 90000) + 7,
  );

  spendArena(ch, Date.now());
  state.meta.arenaPending = { charId: ch.id, at: Date.now() };
  saveMeta(state.meta);

  Object.assign(a, {
    ghost,
    battle,
    view: null,
    step: null,
    result: null,
    gold: 0,
    raceId: ch.raceId,
    /** 宝物条吃的是存档里的 key（`ironBracer+3`），不是 resolve 后的对象 */
    relics: ch.relics || [],
    seq: a.seq + 1,
  });
  syncArena();
  state.screen = 'arena-battle';
  a.logOpen = true; // 记录面板常驻展开（v3.36）
  a.resultLogOpen = false;
  /** 对手先手时，从第一帧起就不许点牌 */
  state.acting = battle.phase !== 'player';

  /** 对手先手：进来就该看到它出牌，UI 主动开始播放 */
  if (battle.phase === 'enemy') scheduleEnemyTurn(a.seq, 260);
  return { ok: true };
}

/**
 * 对手回合播放（v3.33）。
 *
 * 一次走一张牌，间隔 520ms —— 这个数字是"看得清"和"不烦"的折中：
 * 再快就跟不上牌名，再慢一场决斗要拖两分钟。
 * `seq` 是重入保护：换屏 / 重开一场之后，上一条定时器链必须自己停。
 */
function scheduleEnemyTurn(seq, delay = 0) {
  const a = state.arena;
  if (!a || a.seq !== seq) return;
  setTimeout(() => driveEnemyTurn(seq), delay);
}

function driveEnemyTurn(seq) {
  const a = state.arena;
  if (!a || !a.battle || a.seq !== seq || state.screen !== 'arena-battle') return;

  const prev = { p: a.battle.player.hp, pm: a.battle.player.maxHp, e: a.battle.enemy.hp, em: a.battle.enemy.maxHp };
  const step = arenaEnemyStep(a.battle);
  a.step = step;
  syncArena();

  if (step.done) {
    /** 这一回合结束（或者整场结束） */
    if (a.battle.phase === 'player') {
      state.acting = false;
      render();
      animateHpBars(prev);
      spawnFloats(step.events);
      return;
    }
    render();
    animateHpBars(prev);
    spawnFloats(step.events);
    setTimeout(() => finishArenaFight(), 620);
    return;
  }

  render();
  animateHpBars(prev);
  spawnFloats(step.events);
  scheduleEnemyTurn(seq, 520);
}

/**
 * 结算这一场。
 *
 * 与旧版 `fightArena` 的结算逻辑逐行一致 —— 赢给金币、输扣 1 命，
 * 改的只是"什么时候算完"（从点挑战的那一刻，变成血量归零的那一刻）。
 */
/**
 * 竞技场出牌（v3.33）。
 *
 * 与探险战斗同一个手感：牌先飞 110ms 再结算，动画期间锁输入 ——
 * 连点在旧 DOM 上会按错索引出牌，这个坑在战斗页踩过一次。
 * 差别只在结算完之后：这里不换屏，继续留在决斗场。
 */
function playArenaCard(idx, el) {
  const a = state.arena;
  if (!a?.battle || a.battle.phase !== 'player') return;
  state.showLog = false;
  state.showFoeDeck = false;

  const prev = arenaHp();
  const cardEl = el?.closest?.('.card');

  const commit = () => {
    state.acting = false;
    if (!a.battle || state.screen !== 'arena-battle') return;
    const res = arenaPlay(a.battle, idx);
    if (!res.ok) {
      render();
      return;
    }
    a.step = { done: false, card: res.card, line: res.line };
    syncArena();
    render();
    animateHpBars(prev);
    spawnFloats(res.events);
    if (a.battle.phase !== 'player') setTimeout(() => finishArenaFight(), 620);
  };

  if (cardEl && !cardEl.classList.contains('disabled')) {
    state.acting = true;
    cardEl.classList.add('card-fly');
    setTimeout(commit, 110);
  } else {
    commit();
  }
}

function finishArenaFight() {
  const a = state.arena;
  if (!a || !a.battle || a.result) return;
  const ch = findChar(a.charId);
  if (!ch) return;

  const result = arenaResult(a.battle);
  const foeScore = scoreOf(a.ghost);

  let gold = 0;
  if (result.win) {
    gold = M.settleArenaWin(state.meta, foeScore).gold;
    ch.record.arenaWins += 1;
  } else {
    ch.lives -= 1;
    if (ch.lives <= 0) {
      ch.lives = 0;
      ch.status = 'dead';
      M.bury(state.meta, ch);
    }
    ch.record.arenaLosses += 1;
  }

  /** v3.35：段位分 Elo 结算（胜负都动），升段/降段给结算页高亮 */
  const scoreRes = applyArenaResult(ch, foeScore, result.win);

  delete state.meta.arenaPending;
  Object.assign(a, { result, gold, scoreRes });
  state.screen = 'arena-result';
  a.resultLogOpen = false; // 结算页记录默认收起（v3.36）
  state.acting = false;
  saveMeta(state.meta);
  /**
   * 云端镜像池（v3.94）：打完一场就把自己的最新快照传上去，
   * 段位分用刚结算完的新分 —— 别人才会按"你现在的强度"匹配到你。
   * 已经阵亡的角色不传：让一个死人在榜上等人挑战没有意义。
   */
  if (cloud.enabled && ch.status !== 'dead') {
    cloud.publishGhost(ch, scoreOf(ch)).catch(() => {});
  }
  sfx(result.win ? 'win' : 'lose');
  render();
}

/* ------------------------------------------------------------------ *
 * 杂项
 * ------------------------------------------------------------------ */

/**
 * 展开一条敌人词条的说明。
 * 直接改 DOM 而不是整页重绘 —— 重绘会把这个展开状态连同飘字一起冲掉。
 */
function showTraitDetail(text, index) {
  const wrap = app.querySelector('.traits');
  if (!wrap) return;

  const old = app.querySelector('.trait-detail');
  const same = old && Number(old.dataset.index) === index;
  if (old) old.remove();
  if (same) return; // 点同一条 = 收起

  const el = document.createElement('div');
  el.className = 'trait-detail';
  el.dataset.index = String(index);
  el.textContent = text;
  wrap.after(el);
}

/**
 * 效果说明浮层（v3.45，用户给了参考截图）：一层蒙板 + 居中小卡片，
 * 卡片上是名字 + 效果全文，**点任意处关闭**。词条 / 天赋 / 宝物共用。
 *
 * 之前的做法各不相同：敌人词条在词条下方展开（v3.44 改版后还找错了容器，
 * 点了没反应）、宝物是钉住的气泡、天赋是行内展开 —— 手机上没有一个顺手。
 * 统一成蒙板卡片后，看一眼、点掉、继续打，所有入口行为一致。
 *
 * 纯 DOM 操作、不重渲染：点开说明时战场状态一个字节都不许动。
 * 任何 render() 都会顺手把它抹掉（innerHTML 重写），正好符合"点别处就关"。
 */
function showTip(name, html) {
  closeTip();
  const el = document.createElement('div');
  /** 带上 .overlay 类：`.tower-bg ~ *:not(.overlay)` 会把兄弟层改成 relative，
      不带这个类整个浮层会掉进文档流压到底部（2026-11-07 地牢提示同款坑） */
  el.className = 'tip-overlay overlay';
  el.dataset.action = 'close-tip';
  el.innerHTML = `
    <div class="tip-card" data-action="close-tip">
      <div class="tip-name">${escTip(name)}</div>
      <div class="tip-text">${html}</div>
      <div class="tip-hint">点击任意处关闭</div>
    </div>`;
  app.appendChild(el);
}

/** main.js 没有 esc 助手（渲染层模块各自带），浮层需要最朴素的文本转义 */
function escTip(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function closeTip() {
  app.querySelector('.tip-overlay')?.remove();
}

function flash(msg) {
  state.flash = msg || '';
}

function persist() {
  saveMeta(state.meta);
  state.screen = 'hall';
  render();
}

/**
 * 出牌 / 结束回合的打击反馈（v3.2）。
 *
 * 这里修的是一个真 bug：浮字坐标一直取 `getBoundingClientRect()` 的**视口值**，
 * 而 `.float-layer` 是 `position:absolute` 相对 `#app` 定位的。`#app` 一旦
 * `margin:auto` 居中（任何比 480px 宽的窗口 —— 桌面、平板、预览面板），
 * 浮字就整体右移了半个窗口，再被 `overflow:hidden` 裁掉。
 * 表现就是：牌打出去了、血也掉了，但屏幕上什么都没发生。下面统一减掉 app 原点。
 *
 * 顺带把打击感补齐：伤害分轻重、暴击更大更亮、受击方抖动、
 * 大伤害震屏，闪避 / 格挡 / 虚弱 / 回能这些原本只进战斗记录的也浮出来。
 */
function spawnFloats(events) {
  if (!events || !events.length) return;
  /** 声音和飘字同一个漏斗：一次出牌的事件只在这里过一遍 */
  playEvents(events);
  const stage = app.querySelector('.stage');
  if (!stage) return;

  const enemyZone = app.querySelector('.enemy-zone');
  const playerZone = app.querySelector('.player-zone');
  if (!enemyZone && !playerZone) return;

  const layer = document.createElement('div');
  layer.className = 'float-layer';
  app.appendChild(layer);

  /** 视口坐标 → #app 内坐标 */
  const base = app.getBoundingClientRect();

  let i = 0;
  let critPending = false;
  let critHit = false;
  let enemyHit = 0;
  let playerHit = 0;

  /** 同一个 class 连续加两次不会重播动画，先摘掉再强制回流 */
  const pop = (zone, classes) => {
    if (!zone) return;
    const list = Array.isArray(classes) ? classes : [classes];
    zone.classList.remove(...list);
    void zone.offsetWidth;
    zone.classList.add(...list);
  };

  for (const ev of events) {
    /** 玩家暴击：挂在随后那条 damage 上（target:'player' 是它打你时暴击，v3.55） */
    if (ev.type === 'crit' && ev.target !== 'player') { critPending = true; continue; }

    let text = null;
    let cls = '';
    let anchor = null;

    if (ev.type === 'damage') {
      const onEnemy = ev.target === 'enemy';
      anchor = onEnemy ? enemyZone : playerZone;
      if (ev.value > 0) {
        text = `-${ev.value}`;
        cls = onEnemy ? 'dmg-enemy' : 'dmg-player';
        if (onEnemy && critPending) {
          cls += ' crit';
          text = `暴击 -${ev.value}`;
          critHit = true;
          pop(anchor, 'crit-hit');
        }
        if (onEnemy) enemyHit = Math.max(enemyHit, ev.value);
        else playerHit = Math.max(playerHit, ev.value);
      } else if (ev.absorbed > 0) {
        /** 全被护甲吃掉也要有反馈，否则玩家以为这张牌没生效 */
        text = `格挡 ${ev.absorbed}`;
        cls = 'block';
      }
      critPending = false;
    } else if (ev.type === 'heal') {
      if (ev.value <= 0) continue;
      text = `+${ev.value}`;
      cls = 'heal';
      /* 敌人也会回血（撕咬、汲取），飘字要落在它头上而不是玩家区 */
      anchor = ev.target === 'enemy' ? enemyZone : playerZone;
    } else if (ev.type === 'armor') {
      if (ev.value <= 0) continue;
      text = `+${ev.value}甲`;
      cls = 'armor';
      anchor = ev.target === 'enemy' ? enemyZone : playerZone;
    } else if (ev.type === 'poison') {
      if (!ev.value) continue;
      text = `毒 ${ev.value}`;
      cls = 'poison';
      anchor = enemyZone;
    } else if (ev.type === 'poisonTick') {
      if (ev.value <= 0) continue;
      text = `毒 -${ev.value}`;
      cls = 'poison';
      anchor = enemyZone;
    } else if (ev.type === 'dodge') {
      /** v3.55：敌人也会闪（它闪开=你的牌白打），飘字要落在它头上 */
      text = ev.target === 'enemy' ? '它闪开了' : '闪避';
      cls = 'dodge';
      anchor = ev.target === 'enemy' ? enemyZone : playerZone;
    } else if (ev.type === 'crit') {
      /** 它打你时暴击：飘在你身上，别把 critPending 留给下一张牌 */
      text = '它暴击';
      cls = 'crit';
      anchor = playerZone;
    } else if (ev.type === 'weak') {
      text = `虚弱 ${ev.value}`;
      cls = 'weak';
      anchor = ev.target === 'enemy' ? enemyZone : playerZone;
    } else if (ev.type === 'strength') {
      text = `力量 +${ev.value}`;
      cls = 'buff';
      anchor = playerZone;
    } else if (ev.type === 'thorns') {
      /** v3.53：荆棘层数——飘在玩家身上，和护甲/力量一类 */
      text = `荆棘 +${ev.value} 层`;
      cls = 'buff';
      anchor = playerZone;
    } else if (ev.type === 'energy') {
      /** v3.50：带来源标注的回能（法师「法术循环」）直接显示原因，别让玩家猜 */
      text = ev.label || `+${ev.value} 能量`;
      cls = 'buff';
      anchor = playerZone;
    } else {
      continue;
    }

    if (!text || !anchor) continue;

    const r = anchor.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = `float ${cls}`;
    el.textContent = text;
    /** 相对 #app 定位；第一个数字落正中，后面的左右错开避免叠在一起 */
    const dx = [0, -34, 34][i % 3];
    el.style.left = `${r.left + r.width / 2 - base.left + dx}px`;
    el.style.top = `${r.top + r.height * 0.38 - base.top + i * 20}px`;
    layer.appendChild(el);
    i++;
    if (i > 7) break;
  }

  /** 受击：抖动 + 红闪。轻伤小抖，重伤连屏幕一起带一下 */
  if (enemyHit > 0) pop(enemyZone, enemyHit >= 12 ? ['hit', 'hard'] : 'hit');
  if (playerHit > 0) pop(playerZone, playerHit >= 8 ? ['hit', 'hard'] : 'hit');
  if (enemyHit >= 12 || playerHit >= 8 || critHit) pop(stage, 'shake');

  setTimeout(() => layer.remove(), 1000);
}

/** 旋转屏幕 / 地址栏收起会改变宽度 → 分行变了，重新标一次对齐（非战斗页空转） */
window.addEventListener('resize', () => alignTagRows());

boot();
