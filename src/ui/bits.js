/**
 * 跨界面共用的小片段（UI 层拼装用）
 *
 * 只放"到处都要用、且必须长得一模一样"的东西 —— 费用胶囊就是第一个：
 * 三选一、行商、战斗手牌三处显示的是同一个数值，样式各写一份迟早会漂。
 */

/**
 * 卡牌费用胶囊。
 *
 * 三选一里"这张牌要几费"是选牌的第一判据 —— 之前卡面只写效果，
 * 玩家得先背一遍卡池才知道 3 费的爆发能不能塞进自己的曲线。
 * 用能量色（--energy），和战斗手牌右上角的费用球一眼对得上。
 */
export function costPill(cost) {
  if (cost == null) return '';
  return `<i class="c-cost" title="打出需要 ${cost} 点能量">◈${cost}</i>`;
}

/**
 * 局内货币「古币」的图标（v3.9.2）。
 *
 * 局外是金币（gold.png，账号存款），局内是古币（暗铜方孔旧币，SVG 内联）——
 * 两套钱含义不同（古币出塔就蒸发），图标和名字都必须一眼分得开。
 * 内联 SVG 而不是 PNG：单色小图标走线条风格，和营地/图鉴的图标语言一致。
 */
export function runCoin(size = 14) {
  return `<svg class="ico-runc" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="8" cy="8" r="7.1" fill="#a9713d" stroke="#5b3a1a" stroke-width="1.4"/>
    <rect x="5.5" y="5.5" width="5" height="5" rx="1" fill="#453018"/>
  </svg>`;
}

/**
 * 机制关键词高亮（v3.17.3，参照用户提供的竞品截图）。
 *
 * 效果文字此前是一整段纯文本，机制词（中毒/护甲/能量…）混在里面得逐字读；
 * 竞品把关键词着色后"一目了然"。按机制配色 —— 和状态 chips 同一套颜色语言
 * （护甲蓝、中毒绿、能量金），玩家在战斗里建立的颜色记忆直接复用。
 *
 * 输入是**未转义的原文**（cardText / relic text 的返回值），内部先 esc 再替换；
 * 词表按长度降序进正则（"中毒"必须排在"毒"前面，否则先命中单字）。
 * 注意：只用于纯文本来源，别把已经含 HTML 的字符串喂进来。
 */
const KEYWORDS = [
  ['中毒', 'poison'], ['荆棘', 'thorns'], ['虚弱', 'weak'], ['护甲', 'armor'], ['能量', 'energy'],
  ['力量', 'strength'], ['伤害', 'dmg'], ['生命', 'heal'], ['回复', 'heal'],
  ['反伤', 'thorns'], ['耗尽', 'exhaust'], ['消耗', 'exhaust'],
  ['抽牌', 'draw'], ['毒', 'poison'], ['抽', 'draw'],
];
const KW_CLS = Object.fromEntries(KEYWORDS);
const KW_RE = new RegExp(`(${KEYWORDS.map(([w]) => w).join('|')})`, 'g');

export function kw(rawText) {
  const esc2 = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
  return esc2(rawText).replace(KW_RE, (m) => `<b class="kw kw-${KW_CLS[m]}">${m}</b>`);
}
