/**
 * 宝物展示：卡片、局内小标签、浮层
 *
 * 效果文案一律取自 core（relicAt 生成的 text）—— UI 不复制一份。
 * 之前大厅和背包里只印了个名字（"铁砧"），玩家没有任何地方能读到
 * 这件宝物到底干了什么；而复制一份说明到 UI 里，改平衡时就会两边不一致，
 * 变成写给玩家看的假承诺。
 *
 * v3.12：存档里是"带等级的 key"（`ironBracer+3`），展示要靠 relicAt 解出来，
 * 直接 `RELICS[id]` 只会拿到 1 级文案。
 */

import { CHAINS, relicChain, parseRelic, relicAt, RELIC_MAX_LV } from '../core/relics.js';
import { kw } from './bits.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 链标签：通用宝物不分链，挂在任何职业身上都成立 */
export function relicTag(id) {
  const chain = relicChain(id);
  return chain === 'X' ? '通用' : `链 ${chain} · ${CHAINS[chain] ?? ''}`;
}

/** 名字后面挂等级：只有可升级的宝物才显示 Lv */
export function relicNameOf(id, lv = 1) {
  const r = relicAt(id, lv);
  if (!r) return esc(id);
  return r.levels ? `${esc(r.name)} <b class="lvtag">Lv.${r.lv}</b>` : esc(r.name);
}

/**
 * 宝物卡片：名字 + 链 + 效果全文。
 *
 * `active=false` 用于「未激活槽位」—— 用虚线边框区分，避免看起来已经生效。
 */
/**
 * @param {object}  opts
 * @param {boolean} opts.active  已激活样式
 * @param {object|null} opts.activate  v3.80：给详情页的待激活宝物带激活按钮
 *   （{ materials, cost }）；不传保持旧的纯展示 div。
 */
export function relicCard(key, { active = true, activate = null } = {}) {
  const { id, lv } = parseRelic(key);
  const r = relicAt(id, lv);
  if (!r) return '';
  /** 可升级宝物补一行"满级是多少"，让玩家知道还值不值得再拿一件 */
  const grow = r.levels && r.lv < RELIC_MAX_LV
    ? `<div class="rc-next">Lv.${r.lv + 1}：${kw(r.describe(r.levels[r.lv]))}</div>`
    : '';
  if (activate) {
    const afford = activate.materials >= activate.cost;
    return `
      <button class="relic-card off" data-action="activate" data-id="${id}" ${afford ? '' : 'disabled'}>
        <div class="rc-head">
          <span class="rc-name">${relicNameOf(id, r.lv)}</span>
          <span class="rc-tag">${esc(relicTag(id))}</span>
        </div>
        <div class="rc-text">${kw(r.text)}</div>
        <div class="rc-cta">${afford
          ? `激活 · ${activate.cost} 水晶材料`
          : `水晶材料不足（${activate.cost} 个激活）`}</div>
      </button>`;
  }
  return `
    <div class="relic-card${active ? ' on' : ' off'}">
      <div class="rc-head">
        <span class="rc-name">${relicNameOf(id, r.lv)}</span>
        <span class="rc-tag">${esc(relicTag(id))}</span>
      </div>
      <div class="rc-text">${kw(r.text)}</div>
      ${grow}
    </div>`;
}

/**
 * 宝物 chip（v3.51 拆出）：逐件渲染成 `.rl rtip` 标签，返回数组。
 *
 * 战斗页（battle.js）现在把它们拼进血条上方的 tags-row —— 用户要求
 * 「全部机制宝物状态放一起，血条上方区域展示」。迷宫/面板/竞技场仍用
 * relicBar 整条横排。
 *
 * 交互不变：data-action="relic-tip" 在 main.js 里取 .rtip-box 的内容
 * 走 showTip 蒙板卡片（v3.45 起统一），所以放进 overflow:hidden 的
 * tags-line 也不会把气泡裁掉。
 *
 * v3.17.2：查看效果从"点开底部整块面板"改成 **悬停/点按弹一小段文字**（用户：
 * "点击宝物查看效果的时候不对，应该直接 hover 一小段文字介绍就行"）——
 * 面板会把整个战区盖住，只为读一句话不值。
 * 可升级宝物附带下一级预览，和背包里的 relicCard 口径一致。
 */
export function relicChips(keys = []) {
  return (keys || [])
    .map((k) => ({ k, ...parseRelic(k) }))
    .filter((x) => relicAt(x.id, x.lv))
    .map(({ k, id, lv }) => {
      const r = relicAt(id, lv);
      const grow = r.levels && r.lv < RELIC_MAX_LV
        ? `<i class="rtip-next">Lv.${r.lv + 1}：${kw(r.describe(r.levels[r.lv]))}</i>`
        : '';
      /** data-name 必须是纯文本：relicNameOf 对带等级件返回富文本（Lv 标签），
          塞进属性会截断 HTML 标签（v3.45 探针截图抓到的） */
      const plainName = r.levels ? `${r.name} Lv.${lv}` : r.name;
      return `<span class="rl on rtip" data-action="relic-tip" data-name="${esc(plainName)}" tabindex="0">
        ✦ ${relicNameOf(id, lv)}
        <span class="rtip-box">${kw(r.text)}${grow}</span>
      </span>`;
    });
}

/** 宝物整条横排：迷宫 / 面板 / 竞技场仍在用 */
export function relicBar(keys = []) {
  const chips = relicChips(keys);
  if (!chips.length) return '';
  return `<div class="relic-bar">${chips.join('')}</div>`;
}

/**
 * 宝物浮层（战斗页 / 奖励页共用）。
 *
 * 复用战斗记录的 `.log-overlay` 骨架：贴底、可滚、点遮罩关闭。
 * 手机上这是一个熟悉的手势，不必为宝物再造一套弹窗。
 */
export function relicSheet(keys = []) {
  const alive = (keys || []).filter((k) => {
    const { id, lv } = parseRelic(k);
    return !!relicAt(id, lv);
  });
  const body = alive.length
    ? alive.map((k) => relicCard(k)).join('')
    : '<div class="empty small">这一趟还没有宝物。三选一选「宝物」，或者在第 5 层后遇到的「行商」那里用水晶材料买。</div>';

  return `
  <div class="log-overlay overlay" data-action="close-relics">
    <div class="log-sheet" data-action="relics-noop">
      <div class="log-head">
        <span>宝物 · ${alive.length} 件</span>
        <button class="btn ghost mini" data-action="close-relics">关闭</button>
      </div>
      <div class="log-body">${body}</div>
    </div>
  </div>`;
}
