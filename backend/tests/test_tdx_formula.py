"""TDX source interpreter tests using the user's two representative full formulas."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

import tdx_formula


MONTHLY_REVERSAL_SOURCE = r"""
MA10:MA(CLOSE,10);MA20:MA(CLOSE,20);MA50:MA(CLOSE,50);
MA120:MA(CLOSE,120);MA200:MA(CLOSE,200);MA250:MA(CLOSE,250);
Z50:=EXTDATA_USER(3,0);{50天的}RPS50:=Z50/10;
FYX11:=IF(RPS50<=87,0,1);{RPS50大于87}
Z120:=EXTDATA_USER(1,0);{120天的}RPS120:=Z120/10;
FYX12:=IF(RPS120<=90,0,1);{RPS120大于90}
FYX130:=RPS50>=90 OR RPS120>=90;
FYX131:=C>=HHV(C,70);
FYX13:=FYX130 AND FYX131;
FYX1:=FYX11 OR FYX12;
FYX21:=LLV(L,50)>LLV(L,200) AND FYX13;
FYX22:=LLV(L,30)>LLV(L,120) AND FYX13;
FYX23:=LLV(L,20)>LLV(L,50) AND LLV(L,10)>LLV(L,20);
FYX2:=FYX21 OR FYX22 OR FYX23;
NH80:=IF(H<HHV(H,80),0,1);FYX31:=COUNT(NH80,10);
FYX32:=(C>=HHV(C,50) OR H>=HHV(H,50)) AND FYX130;
FYX3:=FYX31 OR FYX32;
FYX4:=C>MA(C,20) AND C>MA(C,200) AND MA(C,120)/MA(C,200)>0.9;
NN200:=IF(C>MA(C,200),1,0);AA200:=COUNT(NN200,45);
FYX51:=AA200>2 AND AA200<45;
LNN200:=IF(L<MA(C,200),1,0);LAA200:=COUNT(LNN200,45);
FYX52:=LAA200>0 AND AA200>2;FYX5:=FYX51 OR FYX52;
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
YXFZ:=FYX1 AND FYX2 AND FYX3 AND FYX4 AND FYX5 AND FYX6 AND FYX7;
DRAWICON(BARSSINCEN(YXFZ,15)=0,LOW,34);{黄色笑脸}
"""


GROWTH_SOURCE = r"""
XG120:=EXTDATA_USER(1,0);{120天的RPS}RPSXG120:=XG120/10;
XG250:=EXTDATA_USER(2,0);{250天的RPS}RPSXG250:=XG250/10;
XG50:=EXTDATA_USER(3,0);{50天的RPS}RPSXG50:=XG50/10;
MRGC00:=VOL/CAPITAL*100<25;
MRGC新高天数:=HHVBARS(H,120);
MRGC新低天数:=IF(MRGC新高天数=0,0,LLVBARS(L,MRGC新高天数));
MRGC新高价:=REF(H,MRGC新高天数);MRGC新低价:=REF(L,MRGC新低天数);
MRGC回撤幅度:=(MRGC新高价-MRGC新低价)/MRGC新高价;
MRGC001:=MRGC回撤幅度<=0.5 AND COUNT(MRGC回撤幅度>0.5,MRGC新高天数)=0;
MRGC002:=C/HHV(C,250)>0.7;MRGC01:=MRGC001 AND MRGC002;
MRGC003:=MRGC回撤幅度<=0.35 AND COUNT(MRGC回撤幅度>0.35,MRGC新高天数)=0;
MRGC004:=C/HHV(C,250)>0.8;MRGC回撤HC:=MRGC003 AND MRGC004;
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
HC120:=EXTDATA_USER(1,0);RPSHC120:=HC120/10;
HC250:=EXTDATA_USER(2,0);RPSHC250:=HC250/10;
SXHCG1:=RPSHC120+RPSHC250>185;
SXHCG20:=C>MA(C,20);
SXHCG21:=COUNT(C>MA(C,250),30)>=25;
SXHCG22:=COUNT(C>MA(C,200),30)>=25;
SXHCG23:=COUNT(C>MA(C,20),10)>=9;
SXHCG24:=COUNT(C>MA(C,10),4)>=3 AND COUNT(C>MA(C,20),4)>=3;
SXHCG2:=SXHCG20 AND SXHCG21 AND SXHCG22 AND (SXHCG23 OR SXHCG24);
新高天数:=HHVBARS(H,20);
新低天数:=IF(新高天数=0,0,LLVBARS(L,新高天数));
新高价:=REF(H,新高天数);新低价:=REF(L,新低天数);
回撤幅度:=(新高价-新低价)/新高价;
SXHCG31:=回撤幅度<=0.25 AND COUNT(回撤幅度>0.25,新高天数)=0;
SXHCG32:=C/HHV(C,250)>0.8;SXHCG3:=SXHCG31 AND SXHCG32;
SXHCG411:=EVERY(MA(C,20)>=REF(MA(C,20),1),5);
SXHCG412:=EVERY(MA(C,10)>=MA(C,20),5);
SXHCG41:=SXHCG411 AND SXHCG412;
SXHCG421:=MA(C,10)>=REF(MA(C,10),1);
SXHCG422:=MA(C,20)>=REF(MA(C,20),1);
SXHCG423:=MA(C,10)>=MA(C,20);
SXHCG42:=SXHCG421 AND SXHCG422 AND SXHCG423;
SXHCG4:=SXHCG41 OR SXHCG42;
SXHCG5:=VOL/CAPITAL*100<15;SXHCG6:=MRGC001;
SXHCG:=SXHCG1 AND SXHCG2 AND SXHCG3 AND SXHCG4 AND SXHCG5 AND SXHCG6;
{================= 附加过滤条件 =================}
营收同比达标:=FINANCE(44)>20;
净利同比达标:=FINANCE(43)>40;
非科创板:=NOT(CODELIKE('688'));
{================= 最终输出条件 =================}
(SXHCG OR MRGC) AND 营收同比达标 AND 净利同比达标 AND 非科创板;
"""


def _trend_bars(count: int = 320) -> list[dict]:
    rows = []
    start = date(2024, 1, 1)
    for index in range(count):
        baseline = 70 + index * 0.1
        close = 80 if index == count - 40 else baseline
        rows.append({
            "datetime": f"{start + timedelta(days=index)} 15:00",
            "open": baseline * 0.998,
            "high": baseline * 1.005,
            "low": min(close, baseline) * 0.995,
            "close": close,
            "vol": 100_000,
        })
    return rows


def _bars_from_values(closes: list[float], highs: list[float] | None = None, lows: list[float] | None = None) -> list[dict]:
    start = date(2026, 1, 1)
    highs = highs or closes
    lows = lows or closes
    return [
        {
            "datetime": f"{start + timedelta(days=index)} 15:00",
            "close": close,
            "high": highs[index],
            "low": lows[index],
        }
        for index, close in enumerate(closes)
    ]


def test_compile_monthly_source_with_comments_chinese_variables_and_graphics():
    program = tdx_formula.compile_formula(MONTHLY_REVERSAL_SOURCE)

    assert 250 <= program.required_history <= 800
    assert program.uses_rps is True
    assert program.uses_finance is False
    assert {"MA", "HHV", "LLV", "REF", "COUNT", "IF", "BARSSINCEN", "DRAWICON"} <= set(
        program.used_functions,
    )

    result = program.evaluate(
        _trend_bars(),
        rps={"rps50": 99, "rps120": 99, "rps250": 99},
        code="600000",
    )
    assert isinstance(result["matched"], bool)
    assert result["variables"]["RPS50"] == 99.0
    assert result["variables"]["RPS120"] == 99.0
    assert result["variables"]["YXFZ"] is True
    assert result["outputs"][0]["name"] == "MA10"
    assert result["graphics"][0]["function"] == "DRAWICON"


def test_compile_and_execute_full_growth_source_with_dynamic_windows():
    program = tdx_formula.compile_formula(GROWTH_SOURCE)

    assert 279 <= program.required_history <= 800
    assert program.uses_rps is True
    assert program.uses_finance is True
    assert {"HHVBARS", "LLVBARS", "EVERY", "FINANCE", "CODELIKE"} <= set(program.used_functions)

    result = tdx_formula.execute_formula(
        program,
        _trend_bars(),
        rps={"rps50": 99, "rps120": 99, "rps250": 99},
        financial={"revenue_yoy_pct": 25, "net_profit_yoy_pct": 45},
        code="600000",
        capital=10_000_000,
    )
    assert result["matched"] is True
    assert result["variables"]["营收同比达标"] is True
    assert result["variables"]["净利同比达标"] is True
    assert result["variables"]["非科创板"] is True
    assert result["variables"]["MRGC新高天数"] == 0


def test_display_assignment_last_expression_and_aliases():
    source = "均线:MA(CLOSE,3); 条件:=C>=均线 AND HIGH>=LOW;\u00a0{NBSP兼容}条件;"
    result = tdx_formula.evaluate_formula(source, _trend_bars(10))

    assert result["matched"] is True
    assert result["variables"]["条件"] is True
    assert result["outputs"][0]["name"] == "均线"
    assert result["outputs"][-1]["name"] is None


@pytest.mark.parametrize(
    ("source", "code", "line"),
    [
        ("A:=MA(C,20);\nB:=UNKNOWN(C,5); B;", "unsupported_function", 2),
        ("A:=MA(C,20; A;", "missing_parenthesis", 1),
        ("A:=__IMPORT__('os'); A;", "unsupported_function", 1),
        ("A:=C;\nA:=H; A;", "duplicate_variable", 2),
    ],
)
def test_parse_and_validation_errors_include_line_and_column(source: str, code: str, line: int):
    with pytest.raises(tdx_formula.TdxFormulaSyntaxError) as exc_info:
        tdx_formula.compile_formula(source)

    issue = exc_info.value.issues[0]
    assert issue["code"] == code
    assert issue["line"] == line
    assert issue["column"] >= 1


def test_missing_stock_context_is_traceable():
    program = tdx_formula.compile_formula(GROWTH_SOURCE)
    with pytest.raises(tdx_formula.TdxFormulaEvaluationError) as exc_info:
        program.evaluate(
            _trend_bars(),
            rps={"rps50": 99, "rps120": 99, "rps250": 99},
            financial={},
            code="600000",
            capital=10_000_000,
        )

    issue = exc_info.value.issues[0]
    assert issue["code"] == "missing_financial_data"
    assert issue["line"] >= 1
    assert issue["column"] >= 1


def test_rps_history_series_and_raw_external_data_are_supported():
    source = "原值:=EXTDATA_USER(1,0); RPS120:=原值/10; RPS120>90;"
    bars = _trend_bars(5)
    scaled = tdx_formula.execute_formula(
        source, bars, rps={"rps120": [80, 85, 90, 95, 99]},
    )
    raw = tdx_formula.execute_formula(
        source, bars, context={"external_data": {1: [800, 850, 900, 950, 990]}},
    )

    assert scaled["matched"] is True
    assert raw["matched"] is True
    assert scaled["variables"]["RPS120"] == raw["variables"]["RPS120"] == 99.0


def test_extdata_user_slot_four_maps_to_rps20():
    source = "原值:=EXTDATA_USER(4,0); RPS20:=原值/10; RPS20>90;"
    bars = _trend_bars(5)
    scaled = tdx_formula.execute_formula(
        source, bars, rps={"rps20": [80, 85, 90, 95, 99]},
    )
    raw = tdx_formula.execute_formula(
        source, bars, context={"external_data": {4: [800, 850, 900, 950, 990]}},
    )

    assert scaled["matched"] is True
    assert raw["matched"] is True
    assert scaled["variables"]["RPS20"] == raw["variables"]["RPS20"] == 99.0


def test_extreme_bars_use_most_recent_tie_and_dynamic_ref():
    source = (
        "高距:=HHVBARS(H,3);低距:=LLVBARS(L,3);"
        "高价:=REF(H,高距);低价:=REF(L,低距);"
        "高距=0 AND 低距=0 AND 高价=H AND 低价=L;"
    )
    result = tdx_formula.execute_formula(
        source,
        _bars_from_values(
            [8, 9, 10, 11],
            highs=[10, 12, 12, 12],
            lows=[5, 4, 4, 4],
        ),
    )

    assert result["matched"] is True
    assert result["variables"]["高距"] == 0
    assert result["variables"]["低距"] == 0


def test_dynamic_llvbars_window_excludes_the_high_bar():
    result = tdx_formula.execute_formula(
        "高距:=HHVBARS(H,4);低距:=LLVBARS(L,高距);高距=3 AND 低距=0;",
        _bars_from_values(
            [10, 9, 8, 7],
            highs=[100, 90, 80, 70],
            lows=[1, 5, 4, 3],
        ),
    )

    # 高点距今3根；LLVBARS(L,3)只看高点之后的[5,4,3]，不能把高点K线的1算进去。
    assert result["matched"] is True
    assert result["variables"] == {"高距": 3, "低距": 0}


def test_count_zero_uses_all_history_and_barssincen_has_distinct_no_match():
    cumulative = tdx_formula.execute_formula(
        "累计:=COUNT(C>0,0);累计=2;",
        _bars_from_values([1, 0, 1]),
    )
    no_event = tdx_formula.execute_formula(
        "BARSSINCEN(C>0,3)=0;",
        _bars_from_values([0, 0, 0]),
    )
    only_today = tdx_formula.execute_formula(
        "BARSSINCEN(C>0,3)=0;",
        _bars_from_values([0, 0, 1]),
    )
    yesterday_and_today = tdx_formula.execute_formula(
        "BARSSINCEN(C>0,3)=0;",
        _bars_from_values([0, 1, 1]),
    )
    dynamic_zero = tdx_formula.execute_formula(
        "周期:=HHVBARS(H,3);累计:=COUNT(C>0,周期);周期=0 AND 累计=2;",
        _bars_from_values([1, 0, 1], highs=[1, 2, 3]),
    )

    assert cumulative["matched"] is True
    assert no_event["matched"] is False
    assert only_today["matched"] is True
    assert yesterday_and_today["matched"] is False
    assert dynamic_zero["matched"] is True


def test_not_precedence_is_below_comparison_and_context_validation_is_strict():
    result = tdx_formula.execute_formula(
        "NOT C>10;",
        _bars_from_values([9]),
    )
    assert result["matched"] is True

    with pytest.raises(tdx_formula.TdxFormulaSyntaxError) as finance_error:
        tdx_formula.compile_formula("FINANCE(42)>0;")
    assert finance_error.value.issues[0]["code"] == "unsupported_finance_field"

    with pytest.raises(tdx_formula.TdxFormulaSyntaxError) as external_error:
        tdx_formula.compile_formula("EXTDATA_USER(5,0)>0;")
    assert external_error.value.issues[0]["code"] == "unsupported_external_data"


def test_bars_must_be_strictly_ascending():
    bars = _bars_from_values([1, 2])
    bars.reverse()
    with pytest.raises(tdx_formula.TdxFormulaEvaluationError) as exc_info:
        tdx_formula.execute_formula("C>0;", bars)
    assert exc_info.value.issues[0]["code"] == "invalid_bars_order"


def test_chart_evaluation_supports_period_dmi_member_and_full_draw_series():
    bars = _trend_bars(40)
    source = "PDI:=DMI.PDI;均线:MA(C,5);DRAWICON(PERIOD=7 AND PDI<100,LOW*0.96,11);"
    program = tdx_formula.compile_formula(source)

    monthly = program.evaluate_chart(
        bars,
        capital=10_000_000,
        context={"period": 7},
    )
    daily = program.evaluate_chart(
        bars,
        capital=10_000_000,
        context={"period": 5},
    )

    assert len(monthly["outputs"][0]["series"]) == len(bars)
    expected_ma = sum(row["close"] for row in bars[-5:]) / 5
    assert abs(monthly["outputs"][0]["series"][-1] - expected_ma) < 1e-9
    assert len(monthly["graphics"][0]["points"]) == len(bars)
    last_point = monthly["graphics"][0]["points"][-1]
    assert last_point["index"] == len(bars) - 1
    assert abs(last_point["price"] - bars[-1]["low"] * 0.96) < 1e-9
    assert last_point["icon"] == 11
    assert daily["graphics"][0]["points"] == []


def test_drawicon_rejects_types_outside_tongdaxin_range():
    program = tdx_formula.compile_formula("DRAWICON(C>0,LOW,52);")
    with pytest.raises(tdx_formula.TdxFormulaEvaluationError) as exc_info:
        program.evaluate_chart(_trend_bars(5), context={"period": 5})
    assert exc_info.value.issues[0]["code"] == "invalid_icon_type"
