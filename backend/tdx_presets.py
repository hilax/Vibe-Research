"""可直接复制到/来自通达信的默认选股公式。"""

from __future__ import annotations

import copy


NEAR_HIGH = r"""{接近一年新高：默认距离250日最高价不超过5%}
XG:C>=HHV(H,250)*0.95;
"""


MONTHLY_REVERSAL_62 = r"""{月线反转 6.2；EXTDATA_USER(1/2/3)=RPS120/RPS250/RPS50}
Z50:=EXTDATA_USER(3,0);{50天的RPS}
RPS50:=Z50/10;
FYX11:=IF(RPS50<=87,0,1);{RPS50大于87}
Z120:=EXTDATA_USER(1,0);{120天的RPS}
RPS120:=Z120/10;
FYX12:=IF(RPS120<=90,0,1);{RPS120大于90}
FYX130:=RPS50>=90 OR RPS120>=90;
FYX131:=C>=HHV(C,70);
FYX13:=FYX130 AND FYX131;
FYX1:=FYX11 OR FYX12;

FYX21:=LLV(L,50)>LLV(L,200) AND FYX13;
FYX22:=LLV(L,30)>LLV(L,120) AND FYX13;
FYX23:=LLV(L,20)>LLV(L,50) AND LLV(L,10)>LLV(L,20);
FYX2:=FYX21 OR FYX22 OR FYX23;

NH80:=IF(H<HHV(H,80),0,1);
FYX31:=COUNT(NH80,10);
FYX32:=(C>=HHV(C,50) OR H>=HHV(H,50)) AND FYX130;
FYX3:=FYX31 OR FYX32;

FYX4:=C>MA(C,20) AND C>MA(C,200) AND MA(C,120)/MA(C,200)>0.9;

NN200:=IF(C>MA(C,200),1,0);
AA200:=COUNT(NN200,45);
FYX51:=AA200>2 AND AA200<45;
LNN200:=IF(L<MA(C,200),1,0);
LAA200:=COUNT(LNN200,45);
FYX52:=LAA200>0 AND AA200>2;
FYX5:=FYX51 OR FYX52;

FYX601:=MA(C,120)>=REF(MA(C,120),15) OR MA(C,200)>=REF(MA(C,200),15);
FYX602:=MA(C,120)>=REF(MA(C,120),15) AND MA(C,200)>=REF(MA(C,200),15);
FYX603:=MA(C,120)>MA(C,200) AND MA(C,200)>MA(C,250);
FYX61:=HHV(H,30)/LLV(L,120)<1.50 AND FYX601;
FYX62:=HHV(H,30)/LLV(L,120)<1.60 AND FYX602;
FYX63:=HHV(H,30)/LLV(L,120)<1.75 AND FYX603 AND FYX13;
FYX6:=FYX61 OR FYX62 OR FYX63;

FYX71:=HHV(H,5)/HHV(H,120)>0.85;
FYX72:=HHV(H,5)/HHV(H,120)>0.8 AND FYX13;
FYX73:=C/HHV(H,10)>0.9;
FYX7:=(FYX71 OR FYX72) AND FYX73;

YXFZ:FYX1 AND FYX2 AND FYX3 AND FYX4 AND FYX5 AND FYX6 AND FYX7;
"""


GROWTH_MRGC_SXHCG = r"""{MRGC / SXHCG 高成长；可直接作为通达信条件选股公式}
XG120:=EXTDATA_USER(1,0);{120天的RPS}
RPSXG120:=XG120/10;
XG250:=EXTDATA_USER(2,0);{250天的RPS}
RPSXG250:=XG250/10;
XG50:=EXTDATA_USER(3,0);{50天的RPS}
RPSXG50:=XG50/10;

MRGC00:=VOL/CAPITAL*100<25;
MRGC新高天数:=HHVBARS(H,120);
MRGC新低天数:=IF(MRGC新高天数=0,0,LLVBARS(L,MRGC新高天数));
MRGC新高价:=REF(H,MRGC新高天数);
MRGC新低价:=REF(L,MRGC新低天数);
MRGC回撤幅度:=(MRGC新高价-MRGC新低价)/MRGC新高价;
MRGC001:=MRGC回撤幅度<=0.5 AND COUNT(MRGC回撤幅度>0.5,MRGC新高天数)=0;
MRGC002:=C/HHV(C,250)>0.7;
MRGC01:=MRGC001 AND MRGC002;
MRGC003:=MRGC回撤幅度<=0.35 AND COUNT(MRGC回撤幅度>0.35,MRGC新高天数)=0;
MRGC004:=C/HHV(C,250)>0.8;
MRGC回撤HC:=MRGC003 AND MRGC004;

XG11:=COUNT(C=HHV(C,250),5)>=1;
XG12:=IF(RPSXG120<=95.99,0,1) OR IF(RPSXG250<=95.99,0,1);
XG13:=IF(RPSXG120<=94.99,0,1) AND IF(RPSXG50<=94.99,0,1);
XG1:=XG11 AND (XG12 OR XG13);
XG21:=C/HHV(H,250)>=0.85;
XG22:=IF(RPSXG120<=96.99,0,1) OR IF(RPSXG250<=96.99,0,1);
XG2:=XG21 AND XG22;
XG31:=C/HHV(H,250)>=0.70;
XG32:=IF(RPSXG120<=97.99,0,1) OR IF(RPSXG250<=97.99,0,1);
XG3:=XG31 AND XG32;
XG41:=MRGC回撤HC;
XG42:=IF(RPSXG120<=94.99,0,1) OR IF(RPSXG250<=94.99,0,1);
XG4:=XG41 AND XG42;
MRGC:=MRGC00 AND MRGC01 AND (XG1 OR XG2 OR XG3 OR XG4);

HC120:=EXTDATA_USER(1,0);{120天的RPS}
RPSHC120:=HC120/10;
HC250:=EXTDATA_USER(2,0);{250天的RPS}
RPSHC250:=HC250/10;
SXHCG1:=RPSHC120+RPSHC250>185;
SXHCG20:=C>MA(C,20);
SXHCG21:=COUNT(C>MA(C,250),30)>=25;
SXHCG22:=COUNT(C>MA(C,200),30)>=25;
SXHCG23:=COUNT(C>MA(C,20),10)>=9;
SXHCG24:=COUNT(C>MA(C,10),4)>=3 AND COUNT(C>MA(C,20),4)>=3;
SXHCG2:=SXHCG20 AND SXHCG21 AND SXHCG22 AND (SXHCG23 OR SXHCG24);

新高天数:=HHVBARS(H,20);
新低天数:=IF(新高天数=0,0,LLVBARS(L,新高天数));
新高价:=REF(H,新高天数);
新低价:=REF(L,新低天数);
回撤幅度:=(新高价-新低价)/新高价;
SXHCG31:=回撤幅度<=0.25 AND COUNT(回撤幅度>0.25,新高天数)=0;
SXHCG32:=C/HHV(C,250)>0.8;
SXHCG3:=SXHCG31 AND SXHCG32;

SXHCG411:=EVERY(MA(C,20)>=REF(MA(C,20),1),5);
SXHCG412:=EVERY(MA(C,10)>=MA(C,20),5);
SXHCG41:=SXHCG411 AND SXHCG412;
SXHCG421:=MA(C,10)>=REF(MA(C,10),1);
SXHCG422:=MA(C,20)>=REF(MA(C,20),1);
SXHCG423:=MA(C,10)>=MA(C,20);
SXHCG42:=SXHCG421 AND SXHCG422 AND SXHCG423;
SXHCG4:=SXHCG41 OR SXHCG42;
SXHCG5:=VOL/CAPITAL*100<15;
SXHCG6:=MRGC001;
SXHCG:=SXHCG1 AND SXHCG2 AND SXHCG3 AND SXHCG4 AND SXHCG5 AND SXHCG6;

营收同比达标:=FINANCE(44)>20;
净利同比达标:=FINANCE(43)>40;
非科创板:=NOT(CODELIKE('688'));

(SXHCG OR MRGC) AND 营收同比达标 AND 净利同比达标 AND 非科创板;
"""


KLINE_MAIN_CHART = r"""{金手指信号}
PDI:=DMI.PDI;
DRAWICON(PERIOD=7 AND PDI<7,LOW,11);

{顺向火车轨3.0}
HC120:=EXTDATA_USER(1,0);{120天的RPS}
RPSHC120:=HC120/10;
HC250:=EXTDATA_USER(2,0);{250天的RPS}
RPSHC250:=HC250/10;
SXHCG1:=RPSHC120+RPSHC250>185;
SXHCG20:=C>MA(C,20);
SXHCG21:=COUNT(C>MA(C,250),30)>=25;
SXHCG22:=COUNT(C>MA(C,200),30)>=25;
SXHCG23:=COUNT(C>MA(C,20),10)>=9;
SXHCG24:=COUNT(C>MA(C,10),4)>=3 AND COUNT(C>MA(C,20),4)>=3;
SXHCG2:=SXHCG20 AND SXHCG21 AND SXHCG22 AND (SXHCG23 OR SXHCG24);
新高天数:=HHVBARS(H,20);
新低天数:=IF(新高天数=0,0,LLVBARS(L,新高天数));
新高价:=REF(H,新高天数);
新低价:=REF(L,新低天数);
回撤幅度:=(新高价-新低价)/新高价;
SXHCG31:=回撤幅度<=0.25 AND COUNT(回撤幅度>0.25,新高天数)=0;
SXHCG32:=C/HHV(C,250)>0.8;
SXHCG3:=SXHCG31 AND SXHCG32;
SXHCG411:=EVERY(MA(C,20)>=REF(MA(C,20),1),5);
SXHCG412:=EVERY(MA(C,10)>=MA(C,20),5);
SXHCG41:=SXHCG411 AND SXHCG412;
SXHCG421:=MA(C,10)>=REF(MA(C,10),1);
SXHCG422:=MA(C,20)>=REF(MA(C,20),1);
SXHCG423:=MA(C,10)>=MA(C,20);
SXHCG42:=SXHCG421 AND SXHCG422 AND SXHCG423;
SXHCG4:=SXHCG41 OR SXHCG42;
SXHCG5:=VOL/CAPITAL*100<10;
SXHCG:=SXHCG1 AND SXHCG2 AND SXHCG3 AND SXHCG4 AND SXHCG5;
DRAWICON(PERIOD=5 AND BARSSINCEN(SXHCG,8)=0,LOW*0.96,13);

{蓝钻公式-左侧低吸}
ZC50:=EXTDATA_USER(3,0);{50天的RPS}
ZCRPS50:=ZC50/10;
ZC20:=EXTDATA_USER(4,0);{20天的RPS}
ZCRPS20:=ZC20/10;
ZC新高天数:=HHVBARS(H,20);
ZC新低天数:=IF(ZC新高天数=0,0,LLVBARS(L,ZC新高天数));
ZC新高价:=REF(H,ZC新高天数);
ZC新低价:=REF(L,ZC新低天数);
ZC回撤幅度:=(ZC新高价-ZC新低价)/ZC新高价;
ZCDX0001:=ZC回撤幅度<=0.25 AND COUNT(ZC回撤幅度>0.25,ZC新高天数)=0;
ZCDX0002:=C/HHV(C,250)>0.8;
ZCDX00:=ZCDX0001 AND ZCDX0002;
ZCDX011:=ZCRPS50>=98;
ZCDX012:=ZCRPS20>=98;
ZCDX013:=ZCRPS50>=97 AND ZCRPS20+ZCRPS50>=190;
ZCDX01:=ZCDX011 OR ZCDX012 OR ZCDX013;
ZCDX02:=C/MA(C,20)<1.005;
ZCDX03:=COUNT(C<MA(C,20),20)<=2 AND COUNT(C<MA(C,10),20)<=8 AND (COUNT(L<MA(C,20),20)<=4 OR ZCRPS50>=99);
ZCDX04:=MA(C,50)>MA(C,120) AND MA(C,50)>MA(C,200) AND MA(C,50)>MA(C,250);
ZCDX05:=VOL/CAPITAL*100<10;
ZCDX:=ZCDX00 AND ZCDX01 AND ZCDX02 AND ZCDX03 AND ZCDX04 AND ZCDX05;
DRAWICON(ZCDX,LOW*0.96,24);

{月线反转6.5；使用冒号的输出线会绘制在主图，使用:=的中间变量不会绘制}
MA5:MA(CLOSE,5);
MA10:MA(CLOSE,10);
MA20:MA(CLOSE,20);
MA50:MA(CLOSE,50);
MA120:MA(CLOSE,120);
MA200:MA(CLOSE,200);
MA250:MA(CLOSE,250);
Z50:=EXTDATA_USER(3,0);
RPS50:=Z50/10;
FYX11:=IF(RPS50<=87,0,1);
Z120:=EXTDATA_USER(1,0);
RPS120:=Z120/10;
FYX12:=IF(RPS120<=90,0,1);
FYX130:=RPS50>=90 OR RPS120>=90;
FYX131:=C>=HHV(C,70);
FYX13:=FYX130 AND FYX131;
FYX1:=FYX11 OR FYX12;
FYX21:=LLV(L,50)>LLV(L,200) AND FYX13;
FYX22:=LLV(L,30)>LLV(L,120) AND FYX13;
FYX23:=LLV(L,20)>LLV(L,50);
FYX2:=FYX21 OR FYX22 OR FYX23;
NH80:=IF(H<HHV(H,80),0,1);
FYX31:=COUNT(NH80,10);
FYX32:=(C>=HHV(C,50) OR H>=HHV(H,50)) AND FYX130;
FYX3:=FYX31 OR FYX32;
FYX4:=C>MA(C,20) AND C>MA(C,200) AND MA(C,120)/MA(C,200)>0.9;
NN200:=IF(C>MA(C,200),1,0);
AA200:=COUNT(NN200,45);
NN250:=IF(C>MA(C,250),1,0);
AA250:=COUNT(NN250,45);
FYX51:=AA200>=2 AND AA200<45;
LNN200:=IF(L<MA(C,200),1,0);
LAA200:=COUNT(LNN200,45);
FYX52:=LAA200>0 AND AA200>2;
LNN250:=IF(L<MA(C,250),1,0);
LAA250:=COUNT(LNN250,45);
FYX53:=LAA250>0 AND AA250>2;
FYX5:=FYX51 OR FYX52 OR FYX53;
FYX6011:=MA(C,120)>=REF(MA(C,120),10) OR MA(C,200)>=REF(MA(C,200),10);
FYX6012:=MA(C,120)>=REF(MA(C,120),15) OR MA(C,200)>=REF(MA(C,200),15);
FYX601:=FYX6011 OR FYX6012;
FYX6021:=MA(C,120)>=REF(MA(C,120),10) AND MA(C,200)>=REF(MA(C,200),10);
FYX6022:=MA(C,120)>=REF(MA(C,120),15) AND MA(C,200)>=REF(MA(C,200),15);
FYX602:=FYX6021 OR FYX6022;
FYX603:=MA(C,120)>MA(C,200) AND FYX601;
FYX61:=HHV(H,30)/LLV(L,120)<1.50 AND FYX601;
FYX62:=HHV(H,30)/LLV(L,120)<1.55 AND FYX602;
FYX63:=HHV(H,30)/LLV(L,120)<1.65 AND FYX603 AND FYX13;
FYX6:=FYX61 OR FYX62 OR FYX63;
FYX71:=HHV(H,5)/HHV(H,120)>0.85;
FYX72:=HHV(H,5)/HHV(H,120)>0.8 AND FYX13;
FYX73:=C/HHV(H,10)>0.9;
FYX7:=(FYX71 OR FYX72) AND FYX73;
YXFZ:=FYX1 AND FYX2 AND FYX3 AND FYX4 AND FYX5 AND FYX6 AND FYX7;
DRAWICON(BARSSINCEN(YXFZ,15)=0,LOW,34);
"""


_PRESETS = {
    "near_high": {
        "label": "接近一年新高",
        "description": "通达信条件选股源码；默认收盘价距250日最高价不超过5%。",
        "default_source": NEAR_HIGH,
        "default_history_days": 250,
    },
    "monthly_reversal_62": {
        "label": "月线反转 6.2",
        "description": "完整 FYX1–FYX7 公式，可直接粘贴通达信源码并修改阈值或逻辑。",
        "default_source": MONTHLY_REVERSAL_62,
        "default_history_days": 250,
    },
    "growth_mrgc_sxhcg": {
        "label": "RPS 高成长（MRGC / SXHCG）",
        "description": "完整 MRGC/SXHCG、财务增长及板块过滤公式。",
        "default_source": GROWTH_MRGC_SXHCG,
        "default_history_days": 280,
    },
}


SUPPORTED_FUNCTIONS = [
    "MA", "HHV", "LLV", "REF", "COUNT", "IF", "EVERY",
    "HHVBARS", "LLVBARS", "BARSSINCEN", "EXTDATA_USER",
    "FINANCE", "CODELIKE", "DRAWICON",
]


def get_preset(strategy: str) -> dict:
    if strategy not in _PRESETS:
        raise KeyError(strategy)
    return copy.deepcopy(_PRESETS[strategy])


def strategy_presets() -> list[dict]:
    return [
        {
            "strategy": strategy,
            **copy.deepcopy(preset),
            "syntax_version": "tdx-compatible-v1",
            "supported_functions": list(SUPPORTED_FUNCTIONS),
        }
        for strategy, preset in _PRESETS.items()
    ]


def effective_history(strategy: str, program) -> int:
    """把解释器的严格递归预热量折算为通达信实际可用的取数长度。

    通达信会用上市以来已有数据计算早期窗口；嵌套动态窗口因此不要求每一层都
    完整预热。解释器对这种公式会保守得到800，这里仍尊重用户显式写入的周期，
    但默认增长公式按320日取数，避免错误剔除上市一年多的股票。
    """
    literal_periods: list[int] = []
    history_functions = {
        "MA", "HHV", "LLV", "REF", "COUNT", "EVERY",
        "HHVBARS", "LLVBARS", "BARSSINCEN",
    }

    def walk(expression) -> None:
        name = str(getattr(expression, "name", "")).upper()
        arguments = getattr(expression, "arguments", None)
        if arguments is not None:
            if name in history_functions and len(arguments) >= 2:
                value = getattr(arguments[1], "value", None)
                if isinstance(value, (int, float)) and float(value).is_integer():
                    literal_periods.append(max(1, min(800, int(value))))
            for argument in arguments:
                walk(argument)
        for attribute in ("operand", "left", "right"):
            child = getattr(expression, attribute, None)
            if child is not None:
                walk(child)

    for statement in program.statements:
        walk(statement.expression)
    strict = int(program.required_history)
    strict_hint = strict if strict < 800 else 1
    return max(
        int(_PRESETS[strategy]["default_history_days"]),
        max(literal_periods, default=1),
        strict_hint,
    )
