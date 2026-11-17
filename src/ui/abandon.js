/**
 * 局内底部的「暂停 / 放弃」条 —— 战斗页、地图页、奖励页共用。
 *
 * 这里有两件完全相反的事，必须摆在一起让玩家看清区别（v3.3）：
 *
 *   暂停 → 什么都不发生。进度原样留在存档里，大厅名册上变成「继续探险」。
 *          塔里没有任何回复手段，暂停回去也不能变强，所以这不是逃命通道 ——
 *          它只是把「关掉页面再打开」这件本来就能做的事做成一个按钮。
 *
 *   放弃 → 认输。结算路径和阵亡**完全一样**：扣 1 命，这一趟的等级、卡牌、
 *          宝物、水晶材料全部回滚。所以必须两步确认。
 */

export function abandonBar(confirm = false) {
  if (confirm) {
    return `
    <div class="abandon-bar armed">
      <p>放弃这一趟？<b>扣 1 条命</b>，等级、卡牌、宝物全部作废。</p>
      <button class="btn danger" data-action="abandon">确认放弃 · -1 命</button>
      <button class="btn ghost" data-action="cancel-abandon">再想想</button>
    </div>`;
  }
  return `
  <div class="abandon-bar">
    <button class="btn ghost mini" data-action="pause">暂停 · 回大厅</button>
    <button class="btn ghost mini danger" data-action="abandon">放弃探险</button>
  </div>`;
}
