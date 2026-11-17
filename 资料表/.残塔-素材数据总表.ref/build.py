# -*- coding: utf-8 -*-
"""
残塔 · 素材数据总表
数据来源：data/catalog.json（由 tools/export-catalog.mjs 从 src/core 导出）
"""

import json
import os
import sys
from datetime import datetime

try:
    import openpyxl
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", "openpyxl>=3.1.0"])
    import openpyxl

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter


def xl_color(css_hex: str) -> str:
    value = css_hex.removeprefix("#").upper()
    if len(value) != 6:
        raise ValueError(f"Expected #RRGGBB, got: {css_hex}")
    return "FF" + value


XL_PRIMARY = xl_color("#4472C4")
XL_PRIMARY_DARK = xl_color("#2F5597")
XL_LIGHT = xl_color("#D9E2F3")
XL_ZEBRA = xl_color("#F4F7FC")
XL_BORDER = xl_color("#BFBFBF")
XL_TEXT = xl_color("#1A1A1A")
XL_MUTED = xl_color("#666666")

THIN = Side(style="thin", color=XL_BORDER)
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

TITLE_FONT = Font(name="微软雅黑", size=16, bold=True, color=XL_PRIMARY_DARK)
SUB_FONT = Font(name="微软雅黑", size=9, color=XL_MUTED)
SECTION_FONT = Font(name="微软雅黑", size=11, bold=True, color=XL_PRIMARY_DARK)
HEADER_FONT = Font(name="微软雅黑", size=10, bold=True, color="FFFFFFFF")
BODY_FONT = Font(name="微软雅黑", size=10, color=XL_TEXT)
MONO_FONT = Font(name="Consolas", size=9, color=XL_TEXT)

HEADER_FILL = PatternFill("solid", fgColor=XL_PRIMARY)
SECTION_FILL = PatternFill("solid", fgColor=XL_LIGHT)
ZEBRA_FILL = PatternFill("solid", fgColor=XL_ZEBRA)

LEFT = Alignment(horizontal="left", vertical="center", wrap_text=False)
LEFT_WRAP = Alignment(horizontal="left", vertical="center", wrap_text=True)
CENTER = Alignment(horizontal="center", vertical="center")
RIGHT = Alignment(horizontal="right", vertical="center")

# 脚本位于 资料表/.<stem>.ref/ 下，项目根是上溯三层
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
with open(os.path.join(ROOT, "data", "catalog.json"), encoding="utf-8") as f:
    D = json.load(f)

# 输出文件可用 `python build.py 新文件名.xlsx` 覆盖 —— 原表被 Excel / WPS 打开时会锁住
# （目录里出现 ~$ 前缀就是被占用），这时写到另一个名字，别去动用户正在看的那个文件。
OUT_NAME = sys.argv[1] if len(sys.argv) > 1 else "残塔-素材数据总表.xlsx"
OUT = os.path.join(ROOT, "资料表", OUT_NAME)

wb = Workbook()
wb.properties.title = "残塔 · 全量数据表"


# ---------------------------------------------------------------- 通用构件
def sheet_title(ws, text, span, sub=None):
    """标题区。返回下一个可用行号。"""
    ws.merge_cells(f"A1:{get_column_letter(span)}1")
    c = ws["A1"]
    c.value = text
    c.font = TITLE_FONT
    c.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[1].height = 30
    if sub:
        ws.merge_cells(f"A2:{get_column_letter(span)}2")
        c = ws["A2"]
        c.value = sub
        c.font = SUB_FONT
        c.alignment = Alignment(horizontal="left", vertical="center")
        return 4
    return 3


def section(ws, row, text, span):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    c = ws.cell(row=row, column=1, value=text)
    c.font = SECTION_FONT
    c.fill = SECTION_FILL
    c.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[row].height = 22


def table(ws, row, headers, widths, rows, aligns=None, formats=None, zebra=True, mono_cols=()):
    """
    铺一张明细表：表头 + 数据。
    row     表头所在行
    widths  每列宽度
    aligns  每列对齐（默认文本左、数字右）
    formats 每列 number_format
    """
    n = len(headers)
    for j, (h, w) in enumerate(zip(headers, widths), start=1):
        c = ws.cell(row=row, column=j, value=h)
        c.font = HEADER_FONT
        c.fill = HEADER_FILL
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BOX
        ws.column_dimensions[get_column_letter(j)].width = w
    ws.row_dimensions[row].height = 26

    for i, data in enumerate(rows):
        r = row + 1 + i
        for j in range(1, n + 1):
            v = data[j - 1] if j - 1 < len(data) else None
            c = ws.cell(row=r, column=j, value=v)
            c.border = BOX
            is_num = isinstance(v, (int, float)) and not isinstance(v, bool)
            if aligns and aligns[j - 1]:
                c.alignment = aligns[j - 1]
            elif is_num:
                c.alignment = RIGHT
            else:
                c.alignment = LEFT_WRAP
            if formats and formats[j - 1] and is_num:
                c.number_format = formats[j - 1]
            c.font = MONO_FONT if j in mono_cols else BODY_FONT
            if zebra and i % 2 == 1:
                c.fill = ZEBRA_FILL
    ws._data_end_row = row + len(rows)
    return row + len(rows)


def finish(ws, header_row, first_col="A", last_col=None, freeze=True):
    """加筛选与冻结窗格（筛选范围覆盖到数据末行）"""
    last = last_col or get_column_letter(ws.max_column)
    last_row = getattr(ws, "_data_end_row", header_row)
    ws.auto_filter.ref = f"{first_col}{header_row}:{last}{last_row}"
    if freeze:
        ws.freeze_panes = f"A{header_row + 1}"


# ================================================================ 1 总览
ws = wb.active
ws.title = "总览"
ws.sheet_view.showGridLines = False

r = sheet_title(
    ws, "残塔 · 全量数据表",
    6,
    f"版本 {D['meta']['version']}　|　数据源 {D['meta']['source']}（由 tools/export-catalog.mjs 自动导出）　|　"
    f"生成于 {datetime.now().strftime('%Y-%m-%d %H:%M')}",
)

section(ws, r, "一、数据规模", 6)
scale_head = r + 1
N = {k: len(D[k]) for k in ("playerCards", "enemyCards", "relics", "enemyTemplates",
                            "traits", "classes", "races", "combos", "statRanges",
                            "talents", "quests", "mechanics", "constants")}
OWN = {}
for c0 in D["playerCards"]:
    k = "种族卡" if c0["owner"].startswith("种族") else c0["owner"]
    OWN[k] = OWN.get(k, 0) + 1
scale_rows = [
    ["玩家卡牌", N["playerCards"],
     "通用 %d + 战士 %d + 法师 %d + 猎人 %d + 旅行家 %d + 种族 %d"
     % (OWN.get("通用", 0), OWN.get("战士", 0), OWN.get("法师", 0),
        OWN.get("猎人", 0), OWN.get("旅行家", 0), OWN.get("种族卡", 0))],
    ["敌人行动牌", N["enemyCards"], "敌人共用的小牌库"],
    ["宝物", N["relics"], "三条转化链（A 叠甲 / B 毒转盾 / C 法术环）+ 通用 X，带等级 1~5"],
    ["敌人模板", N["enemyTemplates"], "10 普通 + 3 首领"],
    ["敌人词条", N["traits"],
     "%d 核心 + %d 变异" % (sum(1 for t in D["traits"] if t["kind"] == "核心"),
                          sum(1 for t in D["traits"] if t["kind"] == "变异"))],
    ["职业", N["classes"], "四职业：基础属性 / 成长 / 技能 / 起始卡组"],
    ["种族", N["races"], "命数 / 被动 / 专属卡 / 携带宝物"],
    ["角色组合", N["combos"], "4 职业 × 4 种族（期望值）"],
    ["初始属性范围", N["statRanges"], "16 种组合的招募掷点上下限"],
    ["天赋", N["talents"], "种族 4 + 职业 4 + 委托额外 21"],
    ["委托", N["quests"], "五条委托线，各带独立天赋池"],
    ["机制", N["mechanics"], "卡牌 / 战斗 / 敌人三类字段字典"],
    ["数值常量", N["constants"], "战斗 / 敌人 / 等级 / 经济 / 招募 / 奖励"],
]
for j, text in enumerate(["分类", "数量", "说明"], start=1):
    c = ws.cell(row=scale_head, column=j, value=text)
    c.font = HEADER_FONT
    c.fill = HEADER_FILL
    c.alignment = CENTER
    c.border = BOX
for i, (name, count, note) in enumerate(scale_rows):
    rr = scale_head + 1 + i
    a = ws.cell(row=rr, column=1, value=name)
    b = ws.cell(row=rr, column=2, value=count)
    c = ws.cell(row=rr, column=3, value=note)
    a.font = BODY_FONT
    b.font = Font(name="微软雅黑", size=10, bold=True, color=XL_PRIMARY_DARK)
    b.alignment = CENTER
    b.number_format = "0"
    c.font = BODY_FONT
    for cell in (a, b, c):
        cell.border = BOX
    if i % 2 == 1:
        for cell in (a, b, c):
            cell.fill = ZEBRA_FILL
n_cards = N["playerCards"]

r = scale_head + 1 + len(scale_rows) + 1
section(ws, r, "二、玩家卡牌构成（按归属）", 6)
own_head = r + 1
for j, text in enumerate(["归属", "张数", "占比", "典型卡"], start=1):
    c = ws.cell(row=own_head, column=j, value=text)
    c.font = HEADER_FONT
    c.fill = HEADER_FILL
    c.alignment = CENTER
    c.border = BOX
owner_rows = [
    ("通用", "打击 / 格挡 / 凝神"),
    ("战士", "举盾 / 盾击 / 处决"),
    ("法师", "奥术弹 / 火球 / 陨石"),
    ("猎人", "射击 / 多重射击 / 狙击"),
    ("旅行家", "涂毒 / 毒雾 / 瘟疫"),
    ("种族卡", "石肤 / 苔生 / 影步 / 余烬爆"),
]
own_count = {}
for c0 in D["playerCards"]:
    key = "种族卡" if c0["owner"].startswith("种族") else c0["owner"]
    own_count[key] = own_count.get(key, 0) + 1

for i, (own, sample) in enumerate(owner_rows):
    rr = own_head + 1 + i
    cnt = own_count.get(own, 0)
    a = ws.cell(row=rr, column=1, value=own)
    a.font = BODY_FONT
    b = ws.cell(row=rr, column=2, value=cnt)
    b.font = Font(name="微软雅黑", size=10, bold=True, color=XL_PRIMARY_DARK)
    b.alignment = CENTER
    b.number_format = "0"
    p = ws.cell(row=rr, column=3, value=round(cnt / n_cards, 4) if n_cards else 0)
    p.font = BODY_FONT
    p.alignment = CENTER
    p.number_format = "0.0%"
    ws.cell(row=rr, column=4, value=sample).font = BODY_FONT
    for cell in ws[rr][:4]:
        cell.border = BOX
    if i % 2 == 1:
        for cell in ws[rr][:4]:
            cell.fill = ZEBRA_FILL

r = own_head + 1 + len(owner_rows) + 1
section(ws, r, "三、工作表导航", 6)
nav_head = r + 1
for j, text in enumerate(["工作表", "内容", "行数"], start=1):
    c = ws.cell(row=nav_head, column=j, value=text)
    c.font = HEADER_FONT
    c.fill = HEADER_FILL
    c.alignment = CENTER
    c.border = BOX
nav_rows = [
    ("种族", "四种族的命数、种族天赋、专属卡与携带宝物（含卡面效果）", N["races"]),
    ("职业", "四职业基础数值、职业天赋、自带宝物、起始卡组与升级成长", N["classes"]),
    ("初始属性范围", "16 种组合招募时的生命/攻击/面板/能量掷点上下限", N["statRanges"]),
    ("角色组合", "16 种组合的期望生命/攻击/面板/评级", N["combos"]),
    ("玩家卡牌", "全部卡牌数值与卡面效果（通用 / 职业 / 种族专属，含满强化预览）", N["playerCards"]),
    ("天赋", "种族天赋 4 + 职业天赋 4 + 委托额外天赋 21", N["talents"]),
    ("委托", "五条委托线的目标、奖励与专属天赋池", N["quests"]),
    ("机制", "所有会改数值的字段：口径、说明与相关卡牌数", N["mechanics"]),
    ("宝物", "宝物效果、所属转化链、等级数值与机器人估值", N["relics"]),
    ("敌人模板", "10 普通 + 3 首领的系数、牌库与核心词条", N["enemyTemplates"]),
    ("敌人词条", "核心词条（定身份）与变异词条（定变化）", N["traits"]),
    ("敌人卡牌", "敌人行动牌：伤害、护甲、自愈、削能量", N["enemyCards"]),
    ("升级经验", "1~30 级所需经验与四职业累计成长", 30),
    ("数值常量", "全局常量：战斗 / 敌人 / 等级 / 经济 / 招募 / 奖励", N["constants"]),
]
for i, (name, desc, count) in enumerate(nav_rows):
    rr = nav_head + 1 + i
    a = ws.cell(row=rr, column=1, value=name)
    a.font = Font(name="微软雅黑", size=10, bold=True, color=XL_PRIMARY_DARK)
    b = ws.cell(row=rr, column=2, value=desc)
    b.font = BODY_FONT
    b.alignment = LEFT_WRAP
    c = ws.cell(row=rr, column=3, value=count)
    c.font = BODY_FONT
    c.alignment = CENTER
    c.number_format = "0"
    for cell in (a, b, c):
        cell.border = BOX
    if i % 2 == 1:
        for cell in (a, b, c):
            cell.fill = ZEBRA_FILL

r = nav_head + 1 + len(nav_rows) + 1
section(ws, r, "四、怎么用这张表调数值", 6)
guide_head = r + 1
guide_rows = [
    ["1. 只改数值", "费用、伤害、护甲、生命、概率、层数这些数字列随便改；改完保存即可。",
     "改「效果」这类文字列也行 —— 文字由数值生成，我会按你的文字反推该动哪个字段。"],
    ["2. 别改 ID 列", "卡牌ID / 宝物ID / 种族ID / 词条ID / 字段 这几列是代码的索引键，改了等于换了一张新牌。",
     "要新增内容就往下加一行，ID 用英文小写 + 下划线，我会补进代码。"],
    ["3. 交付方式", "保存后在对话里说一句「按表回写」。我会先 diff 出你改了哪些格，",
     "再改 src/core、跑测试与 balance 模拟，最后重新生成本表（附改动清单）。"],
    ["4. 单向管线", "表 → 代码 → 重生成表。直接改表不会改游戏，一定要走一次回写；",
     "反过来改代码后也要重跑导出，否则表会落后于游戏（这就是本表存在的意义）。"],
    ["5. 平衡看模拟", "数值改完我会跑 tools/balance.mjs（单局）与 tools/meta-sim.mjs（长期经济，3 个种子）。",
     "「机器人估值」列只服务于模拟，不是玩家可见数值，一般不用动。"],
]
for j, text in enumerate(["步骤", "做法", "备注"], start=1):
    c = ws.cell(row=guide_head, column=j, value=text)
    c.font = HEADER_FONT
    c.fill = HEADER_FILL
    c.alignment = CENTER
    c.border = BOX
for i, (a_t, b_t, c_t) in enumerate(guide_rows):
    rr = guide_head + 1 + i
    a = ws.cell(row=rr, column=1, value=a_t)
    a.font = Font(name="微软雅黑", size=10, bold=True, color=XL_PRIMARY_DARK)
    b = ws.cell(row=rr, column=2, value=b_t)
    b.font = BODY_FONT
    b.alignment = LEFT_WRAP
    c = ws.cell(row=rr, column=3, value=c_t)
    c.font = BODY_FONT
    c.alignment = LEFT_WRAP
    for cell in (a, b, c):
        cell.border = BOX
    if i % 2 == 1:
        for cell in (a, b, c):
            cell.fill = ZEBRA_FILL

r = guide_head + 1 + len(guide_rows) + 1
ws.merge_cells(start_row=r, start_column=1, end_row=r + 3, end_column=6)
note = ws.cell(
    row=r, column=1,
    value="说明：本表全部数值由 data/catalog.json 生成，而 JSON 由 tools/export-catalog.mjs 直接从 src/core 导出。\n"
          "改完代码后重跑 node tools/export-catalog.mjs 再重建本表，即可保证表格与游戏一致，不存在手抄误差。\n"
          "「机器人估值」列只服务于 tools/balance.mjs 的平衡模拟，不是玩家可见数值。",
)
note.font = SUB_FONT
note.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
note.fill = SECTION_FILL

for col, w in zip("ABCDEF", [18, 62, 44, 30, 4, 4]):
    ws.column_dimensions[col].width = w


# ================================================================ 2 玩家卡牌
ws = wb.create_sheet("玩家卡牌")
ws.sheet_view.showGridLines = False
r = sheet_title(ws, "玩家卡牌", 17,
                "伤害/护甲/治疗为「× 攻击力」的倍率；效果说明按攻击力 10 计算。「满强化」为合成 3 次后的数值。")
head = r
cards = D["playerCards"]
rows = []
for i, c in enumerate(cards, 1):
    rows.append([
        i, c["id"], c["name"], c["owner"], c["kind"], c["cost"],
        c["dmg"], c["hits"], c["block"], c["heal"],
        c["poison"], c["weak"], c["draw"], c["energy"], c["strength"],
        c["special"], c["text"], c["textMax"],
    ])
headers = ["序号", "卡牌ID", "名称", "归属", "类型", "费用", "伤害", "段数", "护甲",
           "治疗", "中毒", "虚弱", "抽牌", "能量", "力量", "特殊机制", "效果说明（攻10）", "满强化（+3）效果"]
widths = [5, 16, 10, 12, 7, 5, 7, 5, 7, 7, 6, 6, 6, 6, 6, 22, 42, 44]
fmts = [None, None, None, None, None, "0", "0.##", "0", "0.##", "0.##", "0", "0", "0", "0", "0", None, None, None]
aligns = [CENTER, LEFT, LEFT, LEFT, CENTER, CENTER, RIGHT, CENTER, RIGHT, RIGHT,
          CENTER, CENTER, CENTER, CENTER, CENTER, LEFT_WRAP, LEFT_WRAP, LEFT_WRAP]
table(ws, head, headers, widths, rows, aligns=aligns, formats=fmts, mono_cols=(2,))
# 数值为 0 的格子灰显：值仍是数字，筛选排序不受影响，只是让"没有这项效果"不抢视线
ws.conditional_formatting.add(
    f"G{head + 1}:O{head + len(rows)}",
    CellIsRule(operator="equal", formula=["0"], font=Font(name="微软雅黑", size=10, color="FFBFBFBF")),
)
finish(ws, head, last_col="R")
ws.freeze_panes = "C" + str(head + 1)


# ================================================================ 3 敌人卡牌
ws = wb.create_sheet("敌人卡牌")
ws.sheet_view.showGridLines = False
r = sheet_title(ws, "敌人行动牌", 14,
                "所有倍率均为「× 敌人当前攻击力」；自愈为「× 最大生命」；效果说明按攻击 10 / 血量 100 计算。")
head = r
rows = []
for i, c in enumerate(D["enemyCards"], 1):
    rows.append([
        i, c["id"], c["name"], c["cost"], c["dmg"], c["hits"], c["block"],
        c["healPct"] if c["healPct"] else None, c["weak"] or None, c["drain"] or None,
        c["charge"] or None, c["strength"] or None, c["purge"], c["text"],
    ])
headers = ["序号", "卡牌ID", "名称", "费用", "伤害", "段数", "护甲",
           "自愈（%最大生命）", "虚弱回合", "削能量", "蓄势倍率", "攻击加成", "清除负面", "效果说明"]
widths = [5, 18, 10, 5, 7, 5, 7, 16, 10, 8, 10, 10, 10, 34]
fmts = [None, None, None, "0", "0.##", "0", "0.##", "0.0%", "0", "0", "0.0", "0%", None, None]
aligns = [CENTER, LEFT, LEFT, CENTER, RIGHT, CENTER, RIGHT, CENTER, CENTER, CENTER, CENTER, CENTER, CENTER, LEFT_WRAP]
table(ws, head, headers, widths, rows, aligns=aligns, formats=fmts, mono_cols=(2,))
finish(ws, head, last_col="N")


# ================================================================ 4 宝物
ws = wb.create_sheet("宝物")
ws.sheet_view.showGridLines = False
r = sheet_title(ws, "宝物", 8,
                "三条转化链各自缺一环就不成立，这是构筑的取舍空间。A 叠甲永动 / B 毒转盾 / C 法术循环 / X 通用。")
head = r
rows = []
for i, c in enumerate(D["relics"], 1):
    rows.append([i, c["id"], c["name"], c["chain"], c["text"], c["value"], c["source"]])
headers = ["序号", "宝物ID", "名称", "转化链", "效果", "机器人估值", "获取途径"]
widths = [5, 14, 12, 16, 52, 10, 34]
fmts = [None, None, None, None, None, "0", None]
aligns = [CENTER, LEFT, LEFT, LEFT, LEFT_WRAP, CENTER, LEFT_WRAP]
table(ws, head, headers, widths, rows, aligns=aligns, formats=fmts, mono_cols=(2,))
finish(ws, head, last_col="G")


# ================================================================ 5 敌人模板
ws = wb.create_sheet("敌人模板")
ws.sheet_view.showGridLines = False
r = sheet_title(ws, "敌人模板", 10,
                "生命/攻击系数围绕 1.0 浮动；实际数值 = 层数曲线 × 模板系数 × 品阶系数 × 词条折算。")
head = r
rows = []
for i, c in enumerate(D["enemyTemplates"], 1):
    rows.append([i, c["id"], c["name"], c["tier"], c["hpMul"], c["atkMul"],
                 c["deckSize"], c["deck"], c["core"], c["floors"]])
headers = ["序号", "模板ID", "名称", "类型", "生命系数", "攻击系数", "牌库张数", "牌库构成", "核心词条", "出现层"]
widths = [5, 14, 14, 7, 9, 9, 8, 46, 30, 12]
fmts = [None, None, None, None, "0.00", "0.00", "0", None, None, None]
aligns = [CENTER, LEFT, LEFT, CENTER, RIGHT, RIGHT, CENTER, LEFT_WRAP, LEFT_WRAP, CENTER]
table(ws, head, headers, widths, rows, aligns=aligns, formats=fmts, mono_cols=(2,))
finish(ws, head, last_col="J")


# ================================================================ 6 敌人词条
ws = wb.create_sheet("敌人词条")
ws.sheet_view.showGridLines = False
r = sheet_title(ws, "敌人词条", 11,
                "核心词条每个模板固定 1 个（定身份）；变异词条随机附加，普通 1 个 / 精英与首领 2 个，同 key 不叠加。")
head = r
rows = []
for i, c in enumerate(D["traits"], 1):
    rows.append([i, c["id"], c["name"], c["kind"], c["owner"], c["family"], c["type"],
                 c["value"], c["extra"], c["power"], c["text"]])
headers = ["序号", "词条ID", "名称", "类别", "所属", "效果族", "效果类型",
           "数值", "附加参数", "威胁值", "效果说明"]
widths = [5, 16, 10, 7, 18, 14, 14, 9, 14, 8, 40]
fmts = [None, None, None, None, None, None, None, "General", None, "0.00", None]
aligns = [CENTER, LEFT, LEFT, CENTER, LEFT_WRAP, LEFT, LEFT, CENTER, LEFT, CENTER, LEFT_WRAP]
table(ws, head, headers, widths, rows, aligns=aligns, formats=fmts, mono_cols=(2,))
finish(ws, head, last_col="K")


# ================================================================ 7 职业
ws = wb.create_sheet("职业")
ws.sheet_view.showGridLines = False
r = sheet_title(ws, "职业", 16,
                "基础值为招募时的期望值，实际会按 ±8%（生命/攻击）与 ±1（四项面板）浮动。「保底起始卡」之外再随机抽 4 张职业牌。")
head = r
rows = []
for i, c in enumerate(D["classes"], 1):
    rows.append([i, c["id"], c["name"], c["tag"], c["hp"], c["atk"],
                 c["def"], c["crit"], c["dodge"], c["recovery"],
                 c["growth"], c["perk"], c["relic"], c["core"], c["poolSize"], c["desc"]])
headers = ["序号", "职业ID", "名称", "定位", "基础生命", "基础攻击", "防御", "暴击",
           "闪避", "恢复", "每级成长", "职业天赋", "自带宝物", "保底起始卡", "职业池张数", "设计意图"]
widths = [5, 10, 8, 12, 9, 9, 6, 6, 6, 6, 18, 44, 10, 40, 10, 50]
fmts = [None, None, None, None, "0", "0", "0", "0", "0", "0", None, None, None, None, "0", None]
aligns = [CENTER, LEFT, LEFT, LEFT, RIGHT, RIGHT, CENTER, CENTER, CENTER, CENTER,
          LEFT_WRAP, LEFT_WRAP, LEFT, LEFT_WRAP, CENTER, LEFT_WRAP]
table(ws, head, headers, widths, rows, aligns=aligns, formats=fmts, mono_cols=(2,))
finish(ws, head, last_col="P")


# ================================================================ 8 种族
ws = wb.create_sheet("种族")
ws.sheet_view.showGridLines = False
r = sheet_title(ws, "种族", 10,
                "命数是种族身份：探险阵亡扣 1 命并回滚全部成果，命归零则角色永久消失。携带的宝物初始未激活，需 3 个材料点亮。"
                "种族**不改属性乘区**（hpMul/atkMul 都是 1.0），只给命数 / 被动 / 专属卡 / 宝物。")
head = r
CARD_BY_ID = {c["id"]: c for c in D["playerCards"]}
rows = []
for i, c in enumerate(D["races"], 1):
    card = CARD_BY_ID.get(c.get("cardId"), {})
    rows.append([i, c["id"], c["name"], c["lives"], c["perk"], c["relics"],
                 c.get("cardId", ""), c["card"], card.get("text", ""),
                 f"生命 ×{c.get('hpMul', 1):.2f}　攻击 ×{c.get('atkMul', 1):.2f}"])
headers = ["序号", "种族ID", "名称", "命数", "被动（种族天赋）", "携带宝物", "专属卡ID", "专属卡", "专属卡效果（攻10）", "属性乘区"]
widths = [5, 10, 8, 6, 40, 28, 16, 12, 40, 22]
fmts = [None, None, None, "0", None, None, None, None, None, None]
aligns = [CENTER, LEFT, LEFT, CENTER, LEFT_WRAP, LEFT_WRAP, LEFT, LEFT, LEFT_WRAP, CENTER]
table(ws, head, headers, widths, rows, aligns=aligns, formats=fmts, mono_cols=(2, 7))
finish(ws, head, last_col="J")


# ================================================================ 9 角色组合
ws = wb.create_sheet("角色组合")
ws.sheet_view.showGridLines = False
r = sheet_title(ws, "角色组合（4 职业 × 4 种族）", 13,
                "期望值不含 ±8% 掷定浮动；评级 = 生命×0.5 + 攻击×5 + 卡组×2 + 宝物×10（1 级时）。")
head = r
rows = []
for i, c in enumerate(D["combos"], 1):
    rows.append([i, c["name"], c["classId"], c["raceId"], c["hp"], c["atk"],
                 c["def"], c["crit"], c["dodge"], c["recovery"], c["lives"], c["rating"], c["deckSize"]])
headers = ["序号", "组合名", "职业", "种族", "期望生命", "期望攻击", "防御", "暴击",
           "闪避", "恢复", "命数", "初始评级", "起始卡组张数"]
widths = [5, 16, 10, 10, 10, 10, 6, 6, 6, 6, 6, 10, 12]
fmts = [None, None, None, None, "0", "0", "0", "0", "0", "0", "0", "0", "0"]
aligns = [CENTER, LEFT, LEFT, LEFT, RIGHT, RIGHT, CENTER, CENTER, CENTER, CENTER, CENTER, RIGHT, CENTER]
table(ws, head, headers, widths, rows, aligns=aligns, formats=fmts)
finish(ws, head, last_col="M")


# ================================================================ 9.1 初始属性范围
ws = wb.create_sheet("初始属性范围")
ws.sheet_view.showGridLines = False
r = sheet_title(ws, "初始属性范围（16 种组合）", 16,
                f"生命/攻击 = 职业基准 × 种族乘区 × (1±{D['constants'] and 8}%)；四项面板 = 基础值 ±1（不低于 0）；"
                "能量在招募时单独掷 4~6。带「期望」的是不带浮动的标准值。")
head = r
rows = []
for i, c in enumerate(D["statRanges"], 1):
    rows.append([i, c["name"], c["classId"], c["raceId"],
                 c["hpMin"], c["hpExp"], c["hpMax"], c["atkMin"], c["atkExp"], c["atkMax"],
                 c["def"], c["crit"], c["dodge"], c["recovery"], c["energy"], c["lives"]])
headers = ["序号", "组合", "职业", "种族", "生命下限", "生命期望", "生命上限",
           "攻击下限", "攻击期望", "攻击上限", "防御", "暴击", "闪避", "恢复", "能量", "命数"]
widths = [5, 16, 8, 8, 9, 9, 9, 9, 9, 9, 8, 8, 8, 8, 8, 6]
fmts = [None, None, None, None] + ["0"] * 12
aligns = [CENTER, LEFT, LEFT, LEFT] + [CENTER] * 12
table(ws, head, headers, widths, rows, aligns=aligns, formats=fmts)
finish(ws, head, last_col="P")


# ================================================================ 9.2 天赋
ws = wb.create_sheet("天赋")
ws.sheet_view.showGridLines = False
r = sheet_title(ws, "天赋（种族 4 + 职业 4 + 委托额外 21）", 9,
                "种族/职业天赋是**常驻**的，招募时就定了；委托额外天赋是**局内**的，完成委托后从该委托的池子里随机 1 枚，"
                "只写进本局、探险结束不写回角色。同一局最多接 3 份委托，委托板只在前 8 层出现。")
head = r
rows = []
for i, c in enumerate(D["talents"], 1):
    rows.append([i, c["kind"], c["owner"], c["id"], c["name"], c["icon"], c["text"], c["pools"], c["note"]])
headers = ["序号", "类型", "归属", "天赋ID", "天赋名", "图标", "效果", "可用委托池", "备注"]
widths = [5, 12, 22, 16, 12, 6, 52, 30, 44]
fmts = [None] * 9
aligns = [CENTER, CENTER, LEFT, LEFT, LEFT, CENTER, LEFT_WRAP, LEFT_WRAP, LEFT_WRAP]
table(ws, head, headers, widths, rows, aligns=aligns, formats=fmts, mono_cols=(4,))
finish(ws, head, last_col="I")


# ================================================================ 9.3 委托
ws = wb.create_sheet("委托")
ws.sheet_view.showGridLines = False
r = sheet_title(ws, "委托（迷宫事件「委托板」）", 11,
                "全游戏唯一的选项型事件：可以接受，也可以婉拒。进度在杀怪 / 出攻击牌 / 下楼 / 开宝箱 / 合成五个钩子上累加，"
                "完成当场发一枚该池的额外天赋。")
head = r
rows = []
for i, c in enumerate(D["quests"], 1):
    rows.append([i, c["id"], c["name"], c["goal"], c["target"], c["text"],
                 c["reward"], c["floors"], c["perRun"], c["pool"], c["poolDetail"]])
headers = ["序号", "委托ID", "名称", "目标类型", "目标值", "达成条件",
           "奖励类别", "出现楼层", "每局上限", "天赋池", "天赋池效果明细"]
widths = [5, 12, 14, 14, 8, 22, 12, 14, 10, 34, 90]
fmts = [None, None, None, None, "0", None, None, None, "0", None, None]
aligns = [CENTER, LEFT, LEFT, LEFT, CENTER, LEFT, LEFT, CENTER, CENTER, LEFT_WRAP, LEFT_WRAP]
table(ws, head, headers, widths, rows, aligns=aligns, formats=fmts, mono_cols=(2,))
finish(ws, head, last_col="K")


# ================================================================ 9.4 机制
ws = wb.create_sheet("机制")
ws.sheet_view.showGridLines = False
r = sheet_title(ws, "机制字典（会改数值的字段）", 8,
                "「相关卡牌数」由代码现场统计：改完牌重跑导出脚本，这一列会自己变。"
                "数值类机制大多以「× 攻击力」为口径，所以攻击力是全局乘法基底。")
head = r
rows = []
for c in D["mechanics"]:
    rows.append([c["idx"], c["group"], c["key"], c["name"], c["unit"], c["text"], c["cards"], c["enemies"]])
headers = ["序号", "分类", "字段", "机制名", "单位/口径", "说明", "相关卡牌数", "相关敌人牌数"]
widths = [5, 8, 18, 14, 16, 72, 12, 14]
fmts = [None, None, None, None, None, None, "0", "0"]
aligns = [CENTER, CENTER, LEFT, LEFT, CENTER, LEFT_WRAP, CENTER, CENTER]
table(ws, head, headers, widths, rows, aligns=aligns, formats=fmts, mono_cols=(3,))
finish(ws, head, last_col="H")


# ================================================================ 10 升级经验
ws = wb.create_sheet("升级经验")
ws.sheet_view.showGridLines = False
r = sheet_title(ws, "升级与经验（1~30 级）", 7,
                "升级只加本职业那一项，玩家没有选择权。单场经验 = 18 + 层数×2，精英 ×1.6、首领 ×2.5；"
                "30 层全清大约到 17 级。")
head = r
rows = []
cum = 0
for i in range(30):
    lv = i + 1
    need = 10 + lv * 30
    rows.append([lv, need, cum, (lv - 1) * 7, (lv - 1) * 3, (lv - 1) * 1, (lv - 1) * 5])
    cum += need
table(ws, head,
      ["等级", "升到下一级所需经验", "累计经验", "战士累计生命", "法师累计知识", "猎人累计攻击", "旅行家累计幸运"],
      [8, 18, 14, 16, 16, 16, 18], rows,
      aligns=[CENTER, RIGHT, RIGHT, RIGHT, RIGHT, RIGHT, RIGHT],
      formats=[None, "0", "0", "0", "0", "0", "0"])
finish(ws, head, last_col="G")


# ================================================================ 11 数值常量
ws = wb.create_sheet("数值常量")
ws.sheet_view.showGridLines = False
r = sheet_title(ws, "全局数值常量", 4,
                "全部数值的单一入口。改完源码后重跑 node tools/export-catalog.mjs 与建表脚本，本表会同步更新。")
head = r
const_rows = [[c0["group"], c0["key"], c0["value"], c0["note"]] for c0 in D["constants"]]
table(ws, head,
      ["分组", "参数", "值", "说明"], [12, 30, 24, 66], const_rows,
      aligns=[CENTER, LEFT, CENTER, LEFT_WRAP], formats=[None, None, "General", None])
finish(ws, head, last_col="D")

# ---------------------------------------------------------------- 保存
for sheet in wb.worksheets:
    sheet.sheet_properties.tabColor = "4472C4"
wb.save(OUT)
print(f"OK {OUT}")
