/**
 * 竞技场战斗屏（v3.33）—— 你亲手打的一场镜像决斗
 *
 * 为什么不复用 renderBattle：战斗页的敌人是**怪物**（ENEMY_CARDS、词条、没有手牌），
 * 这里的对手是个**和你一样的角色**（自己的卡组、宝物、天赋、能量循环）。
 * 两边状态栏长得像、语义完全不同，硬塞进一个函数只会到处 if。
 * 所以这里只复用两样东西：`cardHtml`（同一张卡面）与 `.stage/.tray` 这套布局。
 *
 * 只读 core：所有数据来自 arenaBattleView(b)，这里不碰战斗对象。
 */

import { cardText, cardOf } from '../core/cards.js';
import { CLASSES, RACES } from '../core/characters.js';
import { KNOWLEDGE_PER_POINT, CRIT_CAP, DEF_CAP, DODGE_CAP } from '../core/leveling.js';
import { relicBar } from './relics.js';
import { cardHtml, gemChips } from './battle.js';

/** 职业立绘（旅行家用 ranger 的图，与图鉴同一张表） */
const CLASS_IMG = { warrior: 'warrior', mage: 'mage', hunter: 'hunter', traveler: 'ranger' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function pct(cur, max) {
  return max <= 0 ? 0 : Math.max(0, Math.min(100, (cur / max) * 100));
}

/** 双方共用的状态条（字段同名，只是摆在不同区域） */
function chipsOf(s) {
  const out = [];
  if (s.armor > 0) out.push(`<span class="chip armor">护甲 ${s.armor}</span>`);
  if (s.poison > 0) out.push(`<span class="chip poison">中毒 ${s.poison}</span>`);
  if (s.weakTurns > 0) out.push(`<span class="chip weak">虚弱 ${s.weakTurns}</span>`);
  if (s.strength > 0) out.push(`<span class="chip">力量 +${s.strength}</span>`);
  if (s.def > 0) out.push(`<span class="chip def">防御 ${s.def}（-${Math.min(DEF_CAP, s.def)}%）</span>`);
  if (s.crit > 0) out.push(`<span class="chip crit">暴击 ${Math.min(CRIT_CAP, s.crit)}%</span>`);
  if (s.dodge > 0) out.push(`<span class="chip crit">闪避 ${Math.min(DODGE_CAP, s.dodge)}%</span>`);
  if (s.knowledge > 0) {
    out.push(`<span class="chip know">知识 ${s.knowledge} · 印记 +${Math.round(s.knowledge * KNOWLEDGE_PER_POINT * 100)}%</span>`);
  }
  if (s.recovery > 0) out.push(`<span class="chip know">恢复 ${s.recovery}/胜场</span>`);
  return out.join('');
}

/**
 * 决斗记录（v3.36）—— 内嵌在战斗屏里的**常驻**面板。
 *
 * 旧版是"记录"按钮弹全屏遮罩：对手 0.5 秒一张牌地播，玩家得先点按钮、
 * 再盖上遮罩才能翻 —— 出牌节奏直接被打断。现在面板常驻在战场下方，
 * 最新在上，跟着每一步自动刷新；顶栏按钮只负责折叠/展开。
 *
 * 收起时不是消失，是留一行最新动态 —— "它刚才干了什么"永远可见。
 */
function liveLogHtml(v, open) {
  const rows = v.log || [];
  const groups = [];
  for (const row of rows) {
    let g = groups.find((x) => x.turn === row.turn);
    if (!g) { g = { turn: row.turn, rows: [] }; groups.push(g); }
    g.rows.push(row);
  }
  groups.reverse();

  const head = `
    <div class="ll-head" data-action="toggle-arena-log">
      <span class="ll-title">决斗记录</span>
      <span class="ll-toggle">${open ? '收起 ▾' : '展开 ▸'}</span>
    </div>`;

  if (!open) {
    const last = rows[rows.length - 1];
    const lastLine = last
      ? `<span class="log-who ${last.side === 'p' ? 'player' : 'enemy'}">${last.side === 'p' ? '我' : '敌'}</span>
         <span class="log-name">${esc(last.name || '—')}</span>
         <span class="log-detail">${esc(last.detail)}</span>`
      : '<span class="log-detail">还没有记录</span>';
    return `<div class="live-log closed">${head}<div class="ll-last">${lastLine}</div></div>`;
  }

  const body = groups.length === 0
    ? '<div class="empty small">还没有记录</div>'
    : groups.map((g) => `
      <div class="log-group">
        <div class="log-turn">第 ${g.turn} 回合</div>
        ${g.rows.map((r) => `
          <div class="log-row ${r.side === 'p' ? 'player' : 'enemy'}">
            <span class="log-who">${r.side === 'p' ? '我' : '敌'}</span>
            <span class="log-name">${esc(r.name || '—')}</span>
            <span class="log-detail">${esc(r.detail)}</span>
          </div>`).join('')}
      </div>`).join('');

  return `<div class="live-log open">${head}<div class="ll-body">${body}</div></div>`;
}

/**
 * 对手刚打出的那张牌。
 *
 * 这是"对方回合也能看到对方出牌"的落点：牌名 + 它的实际结算（扣了多少血、
 * 加了多少甲），而不是一句"敌人行动完毕"。没打出牌时显示当前回合状态。
 */
function foePlayHtml(step, view) {
  if (!step) {
    return `<div class="foe-play idle">
      <span class="fp-name">${view.phase === 'enemy' ? '对手回合' : '你的回合'}</span>
      <span class="fp-detail">${view.phase === 'enemy' ? '它正在出牌…' : '轮到你了'}</span>
    </div>`;
  }
  if (step.done && !step.card) {
    return `<div class="foe-play idle"><span class="fp-name">对手结束回合</span>
      <span class="fp-detail">手牌或能量用完了</span></div>`;
  }
  const e = view.enemy;
  const c = cardOf(step.card.key);
  const text = c ? cardText(step.card.key, e.atk + e.strength, { perk: e.perk }) : '';
  return `<div class="foe-play">
    <span class="fp-cost">${step.card.cost}</span>
    <span class="fp-name">${esc(step.card.name)}</span>
    <span class="fp-detail">${esc(step.line?.detail || text)}</span>
  </div>`;
}

export function renderArenaBattle(arena, ui = {}) {
  const v = arena.view;
  const logOpen = ui.logOpen !== false; // 默认展开：战斗中记录常驻可见
  if (!v) {
    return `<div class="overlay">
      <p class="sub">这场决斗已经不在了</p>
      <button class="btn primary wide" data-action="back-hall">回大厅</button>
    </div>`;
  }

  const p = v.player;
  const e = v.enemy;
  const atk = p.atk + p.strength;
  const myTurn = v.phase === 'player';
  const cls = CLASSES[e.classId] || CLASSES.warrior;
  const race = RACES[arena.raceId] || null;
  const busy = !!ui.busy;

  const hand = v.hand.map((id, i) => {
    const c = cardOf(id);
    const playable = myTurn && !busy && !!c && !c.unplayable && c.cost <= p.energy;
    return cardHtml(id, i, playable, atk, v);
  }).join('');

  return `
    <div class="topbar">
      <span class="floor">竞技场 · 第 ${v.turn} 回合</span>
      <span class="top-right">
        <button class="mini-btn" data-action="toggle-arena-log">${logOpen ? '收起记录' : '记录'}</button>
        <button class="mini-btn" data-action="arena-forfeit" title="认输，按败北结算">弃权</button>
      </span>
    </div>

    <div class="tower-bg" style="background-image:url('assets/img/bg/ch2.webp')" aria-hidden="true"></div>
    <div class="stage">
      <div class="enemy-zone">
        <button class="face-btn foe" data-action="open-ghost" title="点击查看对手详情" aria-label="查看对手信息">
          <img class="enemy-face arena-foe-face" src="assets/img/classes/${CLASS_IMG[e.classId] || 'warrior'}.png" alt="" onerror="this.remove()">
        </button>
        <div class="enemy-name">${esc(e.name)}<span class="tier">Lv${e.level} · ${cls.name}</span></div>
        <div class="hpbar hp-enemy">
          <div class="fill" style="width:${pct(e.hp, e.maxHp)}%"></div>
          <div class="label">${e.hp} / ${e.maxHp}</div>
        </div>
        <div class="statuses">${chipsOf(e)}</div>
        <div class="enemy-meta">
          能量 <b>${e.energy}</b> · 手牌 <b>${e.handCount}</b> · 赛制生命 ×3
        </div>
        ${foePlayHtml(ui.step, v)}
      </div>

      <div class="midline">${myTurn ? '你的回合' : '对手的回合'}</div>

      <div class="player-zone">
        <div class="player-row">
          <button class="face-btn" data-action="open-char" data-id="${arena.charId}" title="点击查看角色详情" aria-label="查看角色信息">
            <img class="player-face" src="assets/img/races/${arena.raceId || 'stone'}.webp" alt="">
          </button>
          <span class="energy-orb">◈ ${p.energy}</span>
          <div class="hpbar hp-player">
            <div class="fill" style="width:${pct(p.hp, p.maxHp)}%"></div>
            <div class="label">${p.hp} / ${p.maxHp}</div>
          </div>
        </div>
        <div class="statuses">${chipsOf(p)}${gemChips(v.gems)}</div>
        <div class="enemy-meta">
          ${race ? `${race.name} · ` : ''}${CLASSES[p.classId]?.name || ''} · 掷骰${v.playerFirst ? '你' : '对手'}先手
        </div>
      </div>
    </div>

    ${liveLogHtml(v, logOpen)}

    <div class="tray">
      ${/* v3.41：宝物条挪进手牌区顶部，理由同 battle.js（矮屏不被挤进牌区） */ ''}
      ${relicBar(arena.relics)}
      <div class="hand${myTurn && !busy ? '' : ' dim'}">${hand}</div>
      <div class="controls">
        <span class="pileinfo">抽 ${v.drawCount} · 弃 ${v.discardCount} · 耗 ${v.exhaustCount}</span>
        <button class="btn primary${myTurn && !busy ? '' : ' disabled'}" data-action="arena-end-turn">
          ${myTurn ? '结束回合' : '对手回合…'}
        </button>
      </div>
    </div>
  `;
}
