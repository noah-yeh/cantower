/**
 * 层间三选一面板
 *
 * 菜单和旧结算页在 v0.4 改成大厅后就没用了，已删 —— 死代码会误导后来的人。
 */

import { CARDS, cardText, cardKey, parseCard } from '../core/cards.js';
import { kw } from './bits.js';
import { EXTRA_TALENTS, QUEST_MAX_FLOOR, QUEST_MAX_PER_RUN } from '../core/talents.js';
import { CHAINS, relicChain, relicAt, relicLvOf, nextRelicLv } from '../core/relics.js';
import { levelProgress } from '../core/leveling.js';
import { removeCost, morphCost } from '../core/run.js';
import { relicBar, relicSheet } from './relics.js';
import { costPill, runCoin } from './bits.js';

/* ------------------------------------------------------------------ *
 * 三选一
 * ------------------------------------------------------------------ */

/** HTML 转义（与 hero.js 同一份口径，这里只需要它） */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ICON = { card: '⚔', relic: '✦', heal: '✚', upgrade: '↑', material: '◆' };

function rewardBody(run, opt) {
  const atk = run.player.atk + (run.player.strength || 0);

  switch (opt.kind) {
    case 'card': {
      const c = CARDS[opt.id];
      /** v3.24：卡面按本职业天赋折算，与实战一致 */
      return { name: c.name, kind: '卡牌', text: cardText(opt.id, atk, { perk: run.perk }), icon: ICON.card, cost: c.cost };
    }
    /**
     * 强化（v2.2 祭坛化）：选项不再预掷具体卡，而是一张"祭坛门票" ——
     * 选中后进入祭坛页自选目标。文案写清楚规则，玩家知道自己会得到选择权。
     */
    case 'upgrade': {
      return {
        name: '强化祭坛',
        kind: '强化 · 自选一张 +1',
        text: '从卡组中任选一张未满级的卡，强化到下一级（+3 封顶，种族卡也可以）',
        icon: ICON.upgrade,
      };
    }
    case 'material':
      return {
        name: `水晶材料 ×${opt.amount ?? 2}`,
        kind: '水晶材料',
        text: '用于激活种族宝物（每件 3 个）',
        icon: ICON.material,
      };
    case 'relic': {
      /** v3.12：宝物有 1~5 级，弹出来的必须是"这一件、这个等级"的文案 */
      const lv = opt.lv || 1;
      const r = relicAt(opt.id, lv);
      const own = relicLvOf(run.relics, opt.id);
      const finalLv = nextRelicLv(own, lv);
      const chain = relicChain(opt.id);
      const tag = chain === 'X' ? '通用' : `链 ${chain} · ${CHAINS[chain]}`;
      const name = r.levels
        ? `${r.name} <b class="lvtag">${own > 0 ? `Lv.${own} → ` : ''}Lv.${finalLv}</b>`
        : r.name;
      return {
        name,
        kind: own > 0 ? `宝物 · 升级 · ${tag}` : `宝物 · ${tag}`,
        text: r.text,
        icon: ICON.relic,
      };
    }
    case 'heal': {
      const amount = Math.round(run.player.maxHp * 0.3);
      return { name: '治疗', kind: '恢复', text: `回复 ${amount} 点生命`, icon: ICON.heal };
    }
    default:
      return { name: '未知', kind: '', text: '', icon: '?' };
  }
}

export function renderReward(run, ui = {}) {
  if (!run?.reward) return '<div class="overlay"><p class="sub">没有可选的奖励</p></div>';

  const list = run.reward.options
    .map((opt, i) => {
      const b = rewardBody(run, opt);
      return `
      <button class="reward kind-${opt.kind}" data-action="choose" data-index="${i}">
        <span class="icon">${b.icon}</span>
        <span>
          <span class="rname">${b.name}${costPill(b.cost)}</span>
          <span class="rkind">　${b.kind}</span>
          <div class="rtext">${kw(b.text)}</div>
        </span>
      </button>`;
    })
    .join('');

  const lv = levelProgress(run.player);
  const up = run.lastLevelUp;
  const upBanner =
    up && up.levels > 0
      ? `<div class="lvup">升级 Lv.${up.from} → ${up.to}　<span class="lvup-gain">${up.gained.join(' / ')}</span></div>`
      : `<div class="hint">获得经验 ${up?.expGain ?? 0}</div>`;

  return `
    <div class="overlay">
      <h1 style="font-size:20px;letter-spacing:5px">第 ${run.floor} 层已破</h1>
      <div class="sub">选一样带走</div>
      ${upBanner}
      <div class="expbar">
        <div class="fill" style="width:${(lv.pct * 100).toFixed(1)}%"></div>
        <div class="label">Lv.${lv.level}${lv.maxed ? ' 满级' : ` ${lv.exp} / ${lv.need}`}</div>
      </div>
      <div class="reward-list">${list}</div>
      <div class="hint">生命 ${run.player.hp} / ${run.player.maxHp} · 攻击 ${run.player.atk} · 卡组 ${run.deck.length} 张 · ${runCoin()} 古币 ${run.gold || 0}</div>
      ${relicBar(run.relics)}
      <button class="btn ghost wide" data-action="open-hero">角色详情 · 合成与宝物（水晶材料 ${run.materials || 0}）</button>
      ${ui.relics ? relicSheet(run.relics) : ''}
    </div>`;
}

/* ------------------------------------------------------------------ *
 * 委托板（v3.85）：接受 / 婉拒
 *
 * 用户：「任务委托只会在前面 6 层出现，可以拒绝，最多一局可以接受 3 个任务，
 * 可以多做一些天赋给不同的任务」。所以这一页要把三件事说清：
 *   ① 这是第几份 / 最多 3 份；② 要干什么；③ 完成后能从哪几枚天赋里抽。
 * v3.86：用户「委托板的天赋查看不了是什么效果」→ 候选天赋逐条列出**效果全文**
 * （图标 + 名字 + 数值），不再只报名字。
 * ------------------------------------------------------------------ */

/** 候选天赋行：图标 / 名字 / 效果。旧档的 offer 没有 poolInfo，回落到 pool 查表。 */
function questPoolRows(offer) {
  const list = offer.poolInfo
    || (offer.pool || []).map((id) => {
      const t = EXTRA_TALENTS[id];
      return t ? { id, name: t.name, icon: t.icon, text: t.text } : null;
    }).filter(Boolean);
  if (!list.length) return '';
  return list.map((t) => `
    <div class="qo-pool-row">
      <i>${esc(t.icon || '✦')}</i>
      <b>${esc(t.name)}</b>
      <span>${esc(t.text)}</span>
    </div>`).join('');
}

export function renderQuestOffer(run, ui = {}) {
  const offer = run.questOffer;
  if (!offer) return '<div class="overlay"><p class="sub">委托板已经空了</p></div>';

  const taken = run.questsTaken || 0;
  const rows = questPoolRows(offer);

  return `
    <div class="overlay quest-page">
      <h1 style="font-size:20px;letter-spacing:5px">委托板</h1>
      <div class="sub">第 ${run.floor} 层 · 一局最多接 ${QUEST_MAX_PER_RUN} 份（已接 ${taken} / ${QUEST_MAX_PER_RUN}）</div>
      <div class="quest-offer">
        <span class="qo-icon">📜</span>
        <b class="qo-name">${offer.name}</b>
        <span class="qo-goal">${offer.text}</span>
        <span class="qo-reward">完成奖励：<b>${offer.reward} ×1</b></span>
        ${rows ? `<div class="qo-pool">
          <span class="qo-pool-cap">随机一枚 · 不与已有重复</span>
          ${rows}
        </div>` : ''}
      </div>
      ${ui.flash ? `<div class="flash">${ui.flash}</div>` : ''}
      <div class="qo-acts">
        <button class="btn primary" data-action="quest-accept">接受委托</button>
        <button class="btn ghost" data-action="quest-decline">婉拒</button>
      </div>
      <p class="hint" style="text-align:center">委托板只在前 ${QUEST_MAX_FLOOR} 层出现。接了就得办 —— 进度在杀敌 / 出攻击牌 / 下楼 / 开宝箱 / 合成里攒。</p>
    </div>`;
}

/* ------------------------------------------------------------------ *
 * 强化祭坛（v2.2）
 *
 * 奖励里的「强化」和铁匠事件都汇到这里：卡组里所有没满级的卡摆出来，
 * 玩家自选一张 +1。样式复用三选一的 reward 按钮 —— 同一种"选一样带走"
 * 的交互，不该发明第二种视觉语言。
 * ------------------------------------------------------------------ */

export function renderUpgradeAltar(run) {
  const atk = run.player.atk + (run.player.strength || 0);
  const targets = run.upgradeTargets || [];
  const list = targets
    .map((key) => {
      const { id, lv } = parseCard(key);
      const c = CARDS[id];
      if (!c) return '';
      return `
      <button class="reward kind-upgrade" data-action="pick-upgrade" data-key="${key}">
        <span class="icon">↑</span>
        <span>
          <span class="rname">${c.name}<b class="lvtag">+${lv} → +${lv + 1}</b>${costPill(c.cost)}</span>
          <span class="rkind">　强化后效果</span>
          <div class="rtext">${kw(cardText(cardKey(id, lv + 1), atk, { perk: run.perk }))}</div>
        </span>
      </button>`;
    })
    .join('');

  return `
    <div class="overlay">
      <button class="back-btn" data-action="cancel-upgrade" aria-label="返回地图，祭坛保留">返回</button>
      <h1 style="font-size:20px;letter-spacing:5px">强化祭坛</h1>
      <div class="sub">选一张卡强化到下一级</div>
      <div class="reward-list">${list || '<p class="sub">没有可强化的卡</p>'}</div>
      <p class="hint" style="text-align:center">先回去看看也行 —— 祭坛就在这一层等着，随时回来再选。</p>
    </div>`;
}

/* ------------------------------------------------------------------ *
 * 付费祭坛（v3.37）：焚卡 / 变形
 *
 * 与强化祭坛同一种视觉语言（reward 按钮 + 返回键），差别在：
 * 每点一张都要付钱，页面上必须把单价顶在眼前；付不起照样能点，
 * 由 core 返回原因再 flash 出来（和商店同一条约定）。
 * ------------------------------------------------------------------ */

const RUNE_KIND = { attack: '攻击', skill: '技能', power: '本场', status: '状态' };

export function renderRunAltar(run, ui = {}) {
  const isRemove = run.phase === 'remove';
  const cost = isRemove ? removeCost(run) : morphCost(run);
  const atk = run.player.atk + (run.player.strength || 0);

  const list = (run.deck || [])
    .map((key) => {
      const { id, lv } = parseCard(key);
      const c = CARDS[id];
      if (!c) return '';
      const lvTag = lv > 0 ? `<b class="lvtag">+${lv}</b>` : '';
      const kindTag = `　${RUNE_KIND[c.kind] ?? ''}${c.race ? ' · 种族' : ''}`;
      return `
      <button class="reward kind-upgrade" data-action="${isRemove ? 'altar-remove' : 'altar-morph'}" data-key="${key}">
        <span class="icon">${isRemove ? '🔥' : '✧'}</span>
        <span>
          <span class="rname">${c.name}${lvTag}${costPill(c.cost)}</span>
          <span class="rkind">${kindTag}</span>
          <div class="rtext">${kw(cardText(key, atk, { perk: run.perk }))}</div>
        </span>
      </button>`;
    })
    .join('');

  const sub = isRemove
    ? `每焚一张付 ${cost} 古币 · 卡组至少留 5 张`
    : `每变形一张付 ${cost} 古币 · 随机变成同类型同费用的另一张`;

  return `
    <div class="overlay">
      <button class="back-btn" data-action="cancel-altar" aria-label="返回地图，祭坛保留">返回</button>
      <h1 style="font-size:20px;letter-spacing:5px">${isRemove ? '焚卡祭坛' : '变形祭坛'}</h1>
      <div class="sub">${sub}</div>
      <div class="purse">
        <span class="chip gold">${runCoin()} 古币 <b>${run.gold || 0}</b></span>
        <span class="chip">卡组 <b>${(run.deck || []).length}</b> 张</span>
      </div>
      ${ui.flash ? `<div class="flash">${ui.flash}</div>` : ''}
      <div class="reward-list">${list || '<p class="sub">卡组是空的</p>'}</div>
      <p class="hint" style="text-align:center">${isRemove
        ? '焚掉多余的牌，抽牌就更稳 —— 但每一张都是真金白银。'
        : '变形是随机的：赌它变成你想要的，费用比焚卡便宜。'}离开后祭坛留在原处，随时回来。</p>
    </div>`;
}
