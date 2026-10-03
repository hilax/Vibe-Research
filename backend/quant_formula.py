"""量化策略的可编辑参数与受限布尔公式。

这里刻意不执行任意 Python/通达信源码。用户可修改所有开放参数，并使用
AND / OR / NOT / 括号组合已经计算好的命名信号；表达式由本模块自行解析。
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import tdx_formula


class FormulaValidationError(ValueError):
    def __init__(self, message: str, *, code: str = "invalid_formula", column: int | None = None):
        super().__init__(message)
        self.issues = [{
            "code": code,
            "message": message,
            "line": 1,
            "column": column,
            "severity": "error",
        }]


def _p(
    key: str, label: str, default: Any, *, group: str,
    kind: str = "number", minimum: float | None = None,
    maximum: float | None = None, step: float | None = None, suffix: str = "",
) -> dict:
    return {
        "key": key, "label": label, "default": default, "group": group,
        "type": kind, "min": minimum, "max": maximum, "step": step,
        "suffix": suffix,
    }


_PRESETS: dict[str, dict] = {
    "near_high": {
        "label": "接近一年新高",
        "description": "修改回看周期、距高点比例，并用命名信号组合最终条件。",
        "params": [
            _p("lookback_days", "回看周期", 250, group="价格位置", kind="integer", minimum=60, maximum=800, step=10, suffix="交易日"),
            _p("max_distance_pct", "距周期最高价不超过", 5, group="价格位置", minimum=0, maximum=50, step=0.5, suffix="%"),
        ],
        "technical_expression": "NEAR_HIGH",
        "technical_signals": ["NEAR_HIGH"],
        "fundamental_expression": None,
        "fundamental_signals": [],
    },
    "monthly_reversal_62": {
        "label": "月线反转 6.5",
        "description": "开放 RPS、新高、均线、平台宽度和接近高点参数；FYX 组合按观察窗口内首次成立筛选。",
        "params": [
            _p("rps50_min", "FYX11 · RPS50 大于", 87, group="RPS", minimum=0, maximum=100, step=0.5),
            _p("rps120_min", "FYX12 · RPS120 大于", 90, group="RPS", minimum=0, maximum=100, step=0.5),
            _p("breakout_rps_min", "突破条件 RPS 下限", 90, group="RPS", minimum=0, maximum=100, step=0.5),
            _p("close_breakout_days", "最高收盘价周期", 70, group="新高", kind="integer", minimum=5, maximum=400, step=5, suffix="日"),
            _p("recent_high_days", "近期新高周期", 80, group="新高", kind="integer", minimum=5, maximum=400, step=5, suffix="日"),
            _p("recent_high_window", "近期新高观察窗口", 10, group="新高", kind="integer", minimum=1, maximum=120, step=1, suffix="日"),
            _p("secondary_breakout_days", "次级突破周期", 50, group="新高", kind="integer", minimum=5, maximum=400, step=5, suffix="日"),
            _p("ma_short_days", "短期均线", 20, group="均线", kind="integer", minimum=2, maximum=120, step=1, suffix="日"),
            _p("ma_mid_days", "中期均线", 120, group="均线", kind="integer", minimum=20, maximum=300, step=5, suffix="日"),
            _p("ma_long_days", "长期均线", 200, group="均线", kind="integer", minimum=50, maximum=500, step=5, suffix="日"),
            _p("ma_very_long_days", "超长期均线", 250, group="均线", kind="integer", minimum=100, maximum=600, step=5, suffix="日"),
            _p("ma_ratio_min", "中期/长期均线下限", 0.9, group="均线", minimum=0.5, maximum=1.5, step=0.01),
            _p("ma_above_window", "统计站上长期均线窗口", 45, group="均线", kind="integer", minimum=5, maximum=200, step=1, suffix="日"),
            _p("ma_above_min_days", "至少站上长期均线", 2, group="均线", kind="integer", minimum=0, maximum=199, step=1, suffix="日"),
            _p("trend_short_lookback_days", "均线短期趋势回看", 10, group="平台", kind="integer", minimum=1, maximum=120, step=1, suffix="日"),
            _p("trend_lookback_days", "均线长期趋势回看", 15, group="平台", kind="integer", minimum=1, maximum=120, step=1, suffix="日"),
            _p("platform_high_days", "平台最高价周期", 30, group="平台", kind="integer", minimum=5, maximum=200, step=5, suffix="日"),
            _p("platform_low_days", "平台最低价周期", 120, group="平台", kind="integer", minimum=20, maximum=500, step=5, suffix="日"),
            _p("platform_ratio_1", "平台宽度条件1", 1.5, group="平台", minimum=1, maximum=5, step=0.05),
            _p("platform_ratio_2", "平台宽度条件2", 1.55, group="平台", minimum=1, maximum=5, step=0.05),
            _p("platform_ratio_3", "平台宽度条件3", 1.65, group="平台", minimum=1, maximum=5, step=0.05),
            _p("near_high_short_days", "近期最高价周期", 5, group="价格位置", kind="integer", minimum=1, maximum=60, step=1, suffix="日"),
            _p("near_high_long_days", "长期最高价周期", 120, group="价格位置", kind="integer", minimum=20, maximum=500, step=5, suffix="日"),
            _p("near_high_ratio_1", "近期/长期高点条件1", 0.85, group="价格位置", minimum=0.1, maximum=1.2, step=0.01),
            _p("near_high_ratio_2", "近期/长期高点条件2", 0.8, group="价格位置", minimum=0.1, maximum=1.2, step=0.01),
            _p("close_near_high_days", "收盘接近高点周期", 10, group="价格位置", kind="integer", minimum=1, maximum=120, step=1, suffix="日"),
            _p("close_near_high_ratio", "收盘/高点下限", 0.9, group="价格位置", minimum=0.1, maximum=1.2, step=0.01),
            _p("first_event_window", "首次成立观察窗口", 15, group="事件过滤", kind="integer", minimum=1, maximum=120, step=1, suffix="日"),
        ],
        "technical_expression": "FYX1 AND FYX2 AND FYX3 AND FYX4 AND FYX5 AND FYX6 AND FYX7",
        "technical_signals": [
            "FYX11", "FYX12", "FYX13", "FYX21", "FYX22", "FYX23",
            "FYX31", "FYX32", "FYX51", "FYX52", "FYX53",
            "FYX6011", "FYX6012", "FYX601", "FYX6021", "FYX6022", "FYX602", "FYX603",
            "FYX61", "FYX62", "FYX63",
            "FYX71", "FYX72", "FYX73", "FYX1", "FYX2", "FYX3", "FYX4",
            "FYX5", "FYX6", "FYX7",
        ],
        "fundamental_expression": None,
        "fundamental_signals": [],
    },
    "growth_mrgc_sxhcg": {
        "label": "RPS 高成长（MRGC / SXHCG）",
        "description": "开放 RPS、回撤、换手、均线及财务阈值；技术与财务表达式分阶段执行。",
        "params": [
            _p("mrgc_turnover_max_pct", "MRGC 换手率上限", 25, group="换手与回撤", minimum=0, maximum=100, step=0.5, suffix="%"),
            _p("sxhcg_turnover_max_pct", "SXHCG 换手率上限", 15, group="换手与回撤", minimum=0, maximum=100, step=0.5, suffix="%"),
            _p("drawdown120_max_pct", "120日最大回撤上限", 50, group="换手与回撤", minimum=0, maximum=100, step=1, suffix="%"),
            _p("drawdown120_strict_pct", "120日严格回撤上限", 35, group="换手与回撤", minimum=0, maximum=100, step=1, suffix="%"),
            _p("drawdown20_max_pct", "20日最大回撤上限", 25, group="换手与回撤", minimum=0, maximum=100, step=1, suffix="%"),
            _p("year_ratio_1", "XG3 · 收盘/年高下限", 0.7, group="价格位置", minimum=0.1, maximum=1.2, step=0.01),
            _p("year_ratio_2", "XG4 · 收盘/年高下限", 0.8, group="价格位置", minimum=0.1, maximum=1.2, step=0.01),
            _p("year_ratio_3", "XG2 · 收盘/年高下限", 0.85, group="价格位置", minimum=0.1, maximum=1.2, step=0.01),
            _p("rps_xg1_or_min", "XG1 · RPS 或条件", 96, group="RPS", minimum=0, maximum=100, step=0.5),
            _p("rps_xg1_and_min", "XG1 · RPS 且条件", 95, group="RPS", minimum=0, maximum=100, step=0.5),
            _p("rps_xg2_min", "XG2 · RPS 下限", 97, group="RPS", minimum=0, maximum=100, step=0.5),
            _p("rps_xg3_min", "XG3 · RPS 下限", 98, group="RPS", minimum=0, maximum=100, step=0.5),
            _p("rps_xg4_min", "XG4 · RPS 下限", 95, group="RPS", minimum=0, maximum=100, step=0.5),
            _p("rps_sum_min", "RPS120 + RPS250 下限", 185, group="RPS", minimum=0, maximum=200, step=1),
            _p("above_ma_window", "站上长期均线统计窗口", 30, group="均线", kind="integer", minimum=5, maximum=120, step=1, suffix="日"),
            _p("above_ma_min_days", "站上长期均线最少天数", 25, group="均线", kind="integer", minimum=1, maximum=120, step=1, suffix="日"),
            _p("above20_window", "站上20日线统计窗口", 10, group="均线", kind="integer", minimum=2, maximum=60, step=1, suffix="日"),
            _p("above20_min_days", "站上20日线最少天数", 9, group="均线", kind="integer", minimum=1, maximum=60, step=1, suffix="日"),
            _p("recent_ma_window", "短期均线统计窗口", 4, group="均线", kind="integer", minimum=2, maximum=30, step=1, suffix="日"),
            _p("recent_ma_min_days", "短期均线最少天数", 3, group="均线", kind="integer", minimum=1, maximum=30, step=1, suffix="日"),
            _p("ma_trend_days", "均线连续趋势周期", 5, group="均线", kind="integer", minimum=1, maximum=60, step=1, suffix="日"),
            _p("revenue_yoy_min_pct", "营收同比下限", 20, group="财务过滤", minimum=-100, maximum=1000, step=1, suffix="%"),
            _p("net_profit_yoy_min_pct", "净利润同比下限", 40, group="财务过滤", minimum=-100, maximum=3000, step=1, suffix="%"),
            _p("excluded_prefixes", "排除代码前缀", ["688"], group="财务过滤", kind="prefixes"),
        ],
        "technical_expression": "MRGC OR SXHCG",
        "technical_signals": [
            "MRGC00", "MRGC001", "MRGC002", "MRGC003", "MRGC004", "MRGC_HC",
            "XG1", "XG2", "XG3", "XG4", "MRGC", "SXHCG1", "SXHCG2",
            "SXHCG3", "SXHCG4", "SXHCG5", "SXHCG6", "SXHCG",
        ],
        "fundamental_expression": "REVENUE_YOY_OK AND NET_PROFIT_YOY_OK AND NON_EXCLUDED_BOARD",
        "fundamental_signals": [
            "REVENUE_YOY_OK", "NET_PROFIT_YOY_OK", "NON_EXCLUDED_BOARD",
        ],
    },
}


_TOKEN_RE = re.compile(r"\s*(AND|OR|NOT|[A-Z_][A-Z0-9_]*|\(|\))", re.IGNORECASE)


class _BoolParser:
    def __init__(self, expression: str, allowed: set[str], values: dict[str, bool] | None = None):
        if not isinstance(expression, str) or not expression.strip():
            raise FormulaValidationError("组合表达式不能为空", code="empty_expression", column=1)
        if len(expression) > 512:
            raise FormulaValidationError("组合表达式不能超过512个字符", code="expression_too_long", column=513)
        self.source = expression
        self.allowed = allowed
        self.values = {key.upper(): bool(value) for key, value in (values or {}).items()}
        self.tokens: list[tuple[str, int]] = []
        cursor = 0
        while cursor < len(expression):
            if expression[cursor:].strip() == "":
                break
            match = _TOKEN_RE.match(expression, cursor)
            if not match:
                raise FormulaValidationError(
                    "仅支持条件名、AND、OR、NOT 和括号",
                    code="unsupported_syntax", column=cursor + 1,
                )
            self.tokens.append((match.group(1).upper(), match.start(1) + 1))
            cursor = match.end()
        self.index = 0
        self.nodes = 0

    def parse(self) -> Any:
        node = self._or(0)
        if self.index != len(self.tokens):
            token, column = self.tokens[self.index]
            raise FormulaValidationError(f"无法识别的标记：{token}", column=column)
        if self.nodes > 64:
            raise FormulaValidationError("组合表达式最多允许64个节点", code="too_many_nodes")
        return node

    def _or(self, depth: int):
        node = self._and(depth + 1)
        while self._peek("OR"):
            self.index += 1
            node = ("OR", node, self._and(depth + 1))
            self.nodes += 1
        return node

    def _and(self, depth: int):
        node = self._not(depth + 1)
        while self._peek("AND"):
            self.index += 1
            node = ("AND", node, self._not(depth + 1))
            self.nodes += 1
        return node

    def _not(self, depth: int):
        if depth > 16:
            raise FormulaValidationError("组合表达式括号/NOT嵌套不能超过16层", code="too_deep")
        if self._peek("NOT"):
            self.index += 1
            self.nodes += 1
            return ("NOT", self._not(depth + 1))
        return self._primary(depth + 1)

    def _primary(self, depth: int):
        if self._peek("("):
            self.index += 1
            node = self._or(depth + 1)
            if not self._peek(")"):
                column = self.tokens[self.index - 1][1] if self.index else 1
                raise FormulaValidationError("缺少右括号", code="missing_parenthesis", column=column)
            self.index += 1
            return node
        if self.index >= len(self.tokens):
            raise FormulaValidationError("表达式不完整", code="incomplete_expression", column=len(self.source) + 1)
        name, column = self.tokens[self.index]
        if name in {"AND", "OR", "NOT", ")"}:
            raise FormulaValidationError(f"此处不能使用 {name}", code="unexpected_token", column=column)
        self.index += 1
        self.nodes += 1
        if name not in self.allowed:
            raise FormulaValidationError(f"当前策略不支持条件名 {name}", code="unknown_signal", column=column)
        return ("NAME", name)

    def _peek(self, value: str) -> bool:
        return self.index < len(self.tokens) and self.tokens[self.index][0] == value

    def evaluate(self, node: Any) -> bool:
        kind = node[0]
        if kind == "NAME":
            return bool(self.values.get(node[1], False))
        if kind == "NOT":
            return not self.evaluate(node[1])
        if kind == "AND":
            return self.evaluate(node[1]) and self.evaluate(node[2])
        if kind == "OR":
            return self.evaluate(node[1]) or self.evaluate(node[2])
        raise AssertionError(kind)


def evaluate_expression(expression: str, allowed: list[str], values: dict[str, bool]) -> bool:
    parser = _BoolParser(expression, {name.upper() for name in allowed}, values)
    return parser.evaluate(parser.parse())


def expression_names(expression: str) -> set[str]:
    return {
        token.upper()
        for token in re.findall(r"[A-Z_][A-Z0-9_]*", expression, flags=re.IGNORECASE)
        if token.upper() not in {"AND", "OR", "NOT"}
    }


def _default_config(strategy: str) -> dict:
    preset = _PRESETS[strategy]
    return {
        "version": 1,
        "params": {item["key"]: copy.deepcopy(item["default"]) for item in preset["params"]},
        "technical_expression": preset["technical_expression"],
        "fundamental_expression": preset["fundamental_expression"],
    }


def normalize_formula(
    strategy: str,
    formula: dict | None = None,
    *,
    legacy_near_high_pct: float | None = None,
    legacy_lookback_days: int | None = None,
) -> dict:
    if strategy not in _PRESETS:
        raise FormulaValidationError(f"不支持的策略：{strategy}", code="unknown_strategy")
    config = _default_config(strategy)
    if formula is None:
        if strategy == "near_high":
            if legacy_near_high_pct is not None:
                config["params"]["max_distance_pct"] = legacy_near_high_pct
            if legacy_lookback_days is not None:
                config["params"]["lookback_days"] = legacy_lookback_days
    else:
        if not isinstance(formula, dict):
            raise FormulaValidationError("formula 必须是对象", code="invalid_config")
        unknown_fields = set(formula) - {"version", "params", "technical_expression", "fundamental_expression"}
        if unknown_fields:
            raise FormulaValidationError(f"不支持的公式字段：{', '.join(sorted(unknown_fields))}", code="unknown_field")
        if formula.get("version", 1) != 1:
            raise FormulaValidationError("只支持公式版本1", code="unsupported_version")
        supplied_params = formula.get("params") or {}
        if not isinstance(supplied_params, dict):
            raise FormulaValidationError("params 必须是对象", code="invalid_params")
        config["params"].update(supplied_params)
        if "technical_expression" in formula:
            config["technical_expression"] = formula["technical_expression"]
        if "fundamental_expression" in formula:
            config["fundamental_expression"] = formula["fundamental_expression"]

    preset = _PRESETS[strategy]
    schemas = {item["key"]: item for item in preset["params"]}
    unknown_params = set(config["params"]) - set(schemas)
    if unknown_params:
        raise FormulaValidationError(f"不支持的参数：{', '.join(sorted(unknown_params))}", code="unknown_parameter")
    normalized_params = {}
    for key, schema in schemas.items():
        value = config["params"].get(key)
        kind = schema["type"]
        if kind == "prefixes":
            if not isinstance(value, list) or len(value) > 20:
                raise FormulaValidationError(f"{schema['label']}必须是最多20项的前缀列表", code="invalid_parameter")
            prefixes = []
            for prefix in value:
                prefix = str(prefix).strip()
                if not re.fullmatch(r"\d{1,6}", prefix):
                    raise FormulaValidationError(f"无效代码前缀：{prefix}", code="invalid_parameter")
                prefixes.append(prefix)
            normalized_params[key] = prefixes
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
            raise FormulaValidationError(f"{schema['label']}必须是有效数字", code="invalid_parameter")
        number: int | float = int(value) if kind == "integer" else float(value)
        if kind == "integer" and float(value) != number:
            raise FormulaValidationError(f"{schema['label']}必须是整数", code="invalid_parameter")
        if schema["min"] is not None and number < schema["min"]:
            raise FormulaValidationError(f"{schema['label']}不能小于{schema['min']}", code="parameter_out_of_range")
        if schema["max"] is not None and number > schema["max"]:
            raise FormulaValidationError(f"{schema['label']}不能大于{schema['max']}", code="parameter_out_of_range")
        normalized_params[key] = number
    config["params"] = normalized_params

    if strategy == "monthly_reversal_62" and normalized_params["ma_above_min_days"] >= normalized_params["ma_above_window"]:
        raise FormulaValidationError("至少站上长期均线天数必须小于统计窗口", code="invalid_parameter_relation")
    if strategy == "growth_mrgc_sxhcg":
        for minimum_key, window_key in (
            ("above_ma_min_days", "above_ma_window"),
            ("above20_min_days", "above20_window"),
            ("recent_ma_min_days", "recent_ma_window"),
        ):
            if normalized_params[minimum_key] > normalized_params[window_key]:
                raise FormulaValidationError("均线最少天数不能大于对应统计窗口", code="invalid_parameter_relation")

    _BoolParser(config["technical_expression"], set(preset["technical_signals"])).parse()
    if preset["fundamental_expression"] is not None:
        if not isinstance(config["fundamental_expression"], str):
            raise FormulaValidationError("财务表达式不能为空", code="empty_expression")
        _BoolParser(config["fundamental_expression"], set(preset["fundamental_signals"])).parse()
    else:
        config["fundamental_expression"] = None
    return config


def formula_hash(strategy: str, config: dict) -> str:
    payload = json.dumps({"strategy": strategy, "formula": config}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


def monthly_reversal_source(config: dict) -> str:
    """将兼容的命名条件配置转换为安全解释器使用的月线反转 6.5 源码。"""
    p = config["params"]
    return f"""RPS50:=EXTDATA_USER(3,0)/10;
RPS120:=EXTDATA_USER(1,0)/10;
FYX11:=RPS50>{p['rps50_min']};
FYX12:=RPS120>{p['rps120_min']};
FYX130:=RPS50>={p['breakout_rps_min']} OR RPS120>={p['breakout_rps_min']};
FYX131:=C>=HHV(C,{p['close_breakout_days']});
FYX13:=FYX130 AND FYX131;
FYX1:=FYX11 OR FYX12;
FYX21:=LLV(L,50)>LLV(L,200) AND FYX13;
FYX22:=LLV(L,30)>LLV(L,120) AND FYX13;
FYX23:=LLV(L,20)>LLV(L,50);
FYX2:=FYX21 OR FYX22 OR FYX23;
NH80:=IF(H<HHV(H,{p['recent_high_days']}),0,1);
FYX31:=COUNT(NH80,{p['recent_high_window']});
FYX32:=(C>=HHV(C,{p['secondary_breakout_days']}) OR H>=HHV(H,{p['secondary_breakout_days']})) AND FYX130;
FYX3:=FYX31 OR FYX32;
MAS:=MA(C,{p['ma_short_days']});
MAM:=MA(C,{p['ma_mid_days']});
MAL:=MA(C,{p['ma_long_days']});
MAVL:=MA(C,{p['ma_very_long_days']});
FYX4:=C>MAS AND C>MAL AND MAM/MAL>{p['ma_ratio_min']};
NN200:=IF(C>MAL,1,0);
AA200:=COUNT(NN200,{p['ma_above_window']});
NN250:=IF(C>MAVL,1,0);
AA250:=COUNT(NN250,{p['ma_above_window']});
FYX51:=AA200>={p['ma_above_min_days']} AND AA200<{p['ma_above_window']};
LNN200:=IF(L<MAL,1,0);
LAA200:=COUNT(LNN200,{p['ma_above_window']});
FYX52:=LAA200>0 AND AA200>{p['ma_above_min_days']};
LNN250:=IF(L<MAVL,1,0);
LAA250:=COUNT(LNN250,{p['ma_above_window']});
FYX53:=LAA250>0 AND AA250>{p['ma_above_min_days']};
FYX5:=FYX51 OR FYX52 OR FYX53;
FYX6011:=MAM>=REF(MAM,{p['trend_short_lookback_days']}) OR MAL>=REF(MAL,{p['trend_short_lookback_days']});
FYX6012:=MAM>=REF(MAM,{p['trend_lookback_days']}) OR MAL>=REF(MAL,{p['trend_lookback_days']});
FYX601:=FYX6011 OR FYX6012;
FYX6021:=MAM>=REF(MAM,{p['trend_short_lookback_days']}) AND MAL>=REF(MAL,{p['trend_short_lookback_days']});
FYX6022:=MAM>=REF(MAM,{p['trend_lookback_days']}) AND MAL>=REF(MAL,{p['trend_lookback_days']});
FYX602:=FYX6021 OR FYX6022;
FYX603:=MAM>MAL AND FYX601;
FYX61:=HHV(H,{p['platform_high_days']})/LLV(L,{p['platform_low_days']})<{p['platform_ratio_1']} AND FYX601;
FYX62:=HHV(H,{p['platform_high_days']})/LLV(L,{p['platform_low_days']})<{p['platform_ratio_2']} AND FYX602;
FYX63:=HHV(H,{p['platform_high_days']})/LLV(L,{p['platform_low_days']})<{p['platform_ratio_3']} AND FYX603 AND FYX13;
FYX6:=FYX61 OR FYX62 OR FYX63;
FYX71:=HHV(H,{p['near_high_short_days']})/HHV(H,{p['near_high_long_days']})>{p['near_high_ratio_1']};
FYX72:=HHV(H,{p['near_high_short_days']})/HHV(H,{p['near_high_long_days']})>{p['near_high_ratio_2']} AND FYX13;
FYX73:=C/HHV(H,{p['close_near_high_days']})>{p['close_near_high_ratio']};
FYX7:=(FYX71 OR FYX72) AND FYX73;
YXFZ:=({config['technical_expression']});
YXFZXG:BARSSINCEN(YXFZ,{p['first_event_window']})=0;
"""


@lru_cache(maxsize=64)
def _compiled_monthly_reversal(source: str) -> tdx_formula.Program:
    return tdx_formula.compile_formula(source)


def monthly_reversal_program(config: dict) -> tdx_formula.Program:
    return _compiled_monthly_reversal(monthly_reversal_source(config))


def effective_formula(strategy: str, config: dict) -> str:
    params = ", ".join(f"{key}={value}" for key, value in config["params"].items())
    expression = f"({config['technical_expression']})"
    if strategy == "monthly_reversal_62":
        expression = f"BARSSINCEN({expression},{config['params']['first_event_window']})=0"
    text = f"PARAMS({params}); TECHNICAL:={expression}"
    if config.get("fundamental_expression"):
        text += f"; FUNDAMENTAL:=({config['fundamental_expression']})"
    return text + ";"


def strategy_presets() -> list[dict]:
    result = []
    for strategy, preset in _PRESETS.items():
        result.append({
            "strategy": strategy,
            "label": preset["label"],
            "description": preset["description"],
            "syntax_version": "named-signals-v1",
            "params": copy.deepcopy(preset["params"]),
            "allowed_technical_signals": list(preset["technical_signals"]),
            "allowed_fundamental_signals": list(preset["fundamental_signals"]),
            "default_formula": _default_config(strategy),
        })
    return result


def allowed_signals(strategy: str, stage: str = "technical") -> list[str]:
    key = "technical_signals" if stage == "technical" else "fundamental_signals"
    return list(_PRESETS[strategy][key])


def required_history(strategy: str, config: dict) -> int:
    p = config["params"]
    if strategy == "near_high":
        return int(p["lookback_days"])
    if strategy == "monthly_reversal_62":
        return monthly_reversal_program(config).required_history
    return min(800, int(max(280, 250 + p["above_ma_window"], 20 + p["ma_trend_days"])))


@dataclass(frozen=True)
class CompiledFormula:
    strategy: str
    config: dict
    hash: str
    effective: str


def compile_formula(
    strategy: str,
    formula: dict | None = None,
    *,
    legacy_near_high_pct: float | None = None,
    legacy_lookback_days: int | None = None,
) -> CompiledFormula:
    config = normalize_formula(
        strategy, formula,
        legacy_near_high_pct=legacy_near_high_pct,
        legacy_lookback_days=legacy_lookback_days,
    )
    return CompiledFormula(strategy, config, formula_hash(strategy, config), effective_formula(strategy, config))
