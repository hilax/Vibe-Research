"""A small, safe interpreter for the TongdaXin formula subset used by quant screens.

The module deliberately implements its own lexer, parser and time-series evaluator.
It never passes user text to ``eval``/``exec`` and only exposes explicitly listed
variables and functions.  Bars must be ordered from oldest to newest.
"""

from __future__ import annotations

import math
import re
from collections import deque
from dataclasses import dataclass
from typing import Any, Iterable


MAX_SOURCE_LENGTH = 100_000
MAX_TOKENS = 20_000
MAX_AST_NODES = 4_096
MAX_NESTING = 64
MAX_HISTORY = 800
MAX_IDENTIFIER_LENGTH = 128
MAX_STRING_LENGTH = 4_096


class TdxFormulaError(ValueError):
    """Base error with a frontend-friendly issue payload."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "tdx_formula_error",
        line: int = 1,
        column: int = 1,
    ) -> None:
        super().__init__(message)
        self.issues = [{
            "code": code,
            "message": message,
            "line": line,
            "column": column,
            "severity": "error",
        }]


class TdxFormulaSyntaxError(TdxFormulaError):
    """Lexing, parsing or static validation failure."""


class TdxFormulaEvaluationError(TdxFormulaError):
    """A valid formula cannot be evaluated with the supplied stock context."""


@dataclass(frozen=True)
class Token:
    kind: str
    value: Any
    line: int
    column: int


def _syntax(token: Token, message: str, code: str = "syntax_error") -> TdxFormulaSyntaxError:
    return TdxFormulaSyntaxError(
        message, code=code, line=token.line, column=token.column,
    )


def _canon(name: str) -> str:
    return name.upper()


def _tokenize(source: str) -> list[Token]:
    if not isinstance(source, str):
        raise TdxFormulaSyntaxError("公式必须是文本", code="invalid_source")
    if len(source) > MAX_SOURCE_LENGTH:
        raise TdxFormulaSyntaxError(
            f"公式不能超过 {MAX_SOURCE_LENGTH} 个字符", code="source_too_long",
        )

    tokens: list[Token] = []
    index = 0
    line = 1
    column = 1

    def advance(character: str) -> None:
        nonlocal line, column
        if character == "\n":
            line += 1
            column = 1
        else:
            column += 1

    while index < len(source):
        character = source[index]
        if character.isspace():
            advance(character)
            index += 1
            continue

        if character == "{":
            comment_line, comment_column = line, column
            advance(character)
            index += 1
            while index < len(source) and source[index] != "}":
                advance(source[index])
                index += 1
            if index >= len(source):
                raise TdxFormulaSyntaxError(
                    "公式注释缺少右花括号",
                    code="unclosed_comment",
                    line=comment_line,
                    column=comment_column,
                )
            advance(source[index])
            index += 1
            continue

        token_line, token_column = line, column
        two = source[index:index + 2]
        if two == ":=":
            tokens.append(Token("ASSIGN", two, token_line, token_column))
            for item in two:
                advance(item)
            index += 2
        elif two in {">=", "<=", "<>", "!=", "=="}:
            tokens.append(Token("OP", two, token_line, token_column))
            for item in two:
                advance(item)
            index += 2
        elif character in "'\"":
            quote = character
            advance(character)
            index += 1
            value: list[str] = []
            while index < len(source):
                current = source[index]
                if current == quote:
                    if index + 1 < len(source) and source[index + 1] == quote:
                        value.append(quote)
                        advance(current)
                        advance(source[index + 1])
                        index += 2
                        continue
                    advance(current)
                    index += 1
                    break
                if current == "\\" and index + 1 < len(source):
                    escaped = source[index + 1]
                    value.append({"n": "\n", "r": "\r", "t": "\t"}.get(escaped, escaped))
                    advance(current)
                    advance(escaped)
                    index += 2
                    continue
                value.append(current)
                advance(current)
                index += 1
            else:
                raise TdxFormulaSyntaxError(
                    "字符串缺少结束引号",
                    code="unclosed_string",
                    line=token_line,
                    column=token_column,
                )
            string_value = "".join(value)
            if len(string_value) > MAX_STRING_LENGTH:
                raise TdxFormulaSyntaxError(
                    f"字符串不能超过 {MAX_STRING_LENGTH} 个字符",
                    code="string_too_long",
                    line=token_line,
                    column=token_column,
                )
            tokens.append(Token("STRING", string_value, token_line, token_column))
        elif character.isdigit() or (
            character == "." and index + 1 < len(source) and source[index + 1].isdigit()
        ):
            start = index
            saw_dot = False
            while index < len(source):
                current = source[index]
                if current == "." and not saw_dot:
                    saw_dot = True
                elif not current.isdigit():
                    break
                advance(current)
                index += 1
            raw = source[start:index]
            tokens.append(Token("NUMBER", float(raw), token_line, token_column))
        elif character == "_" or character.isalpha():
            start = index
            while index < len(source):
                current = source[index]
                if current != "_" and not current.isalnum():
                    break
                advance(current)
                index += 1
            identifier = source[start:index]
            if len(identifier) > MAX_IDENTIFIER_LENGTH:
                raise TdxFormulaSyntaxError(
                    f"变量或函数名不能超过 {MAX_IDENTIFIER_LENGTH} 个字符",
                    code="identifier_too_long",
                    line=token_line,
                    column=token_column,
                )
            tokens.append(Token("IDENT", identifier, token_line, token_column))
        else:
            single_kinds = {
                "(": "LPAREN", ")": "RPAREN", ",": "COMMA", ";": "SEMI",
                ":": "COLON", "+": "OP", "-": "OP", "*": "OP", "/": "OP",
                ">": "OP", "<": "OP", "=": "OP",
            }
            kind = single_kinds.get(character)
            if not kind:
                raise TdxFormulaSyntaxError(
                    f"不支持的字符：{character}",
                    code="unsupported_character",
                    line=token_line,
                    column=token_column,
                )
            tokens.append(Token(kind, character, token_line, token_column))
            advance(character)
            index += 1

        if len(tokens) > MAX_TOKENS:
            raise TdxFormulaSyntaxError(
                f"公式最多允许 {MAX_TOKENS} 个标记",
                code="too_many_tokens",
                line=token_line,
                column=token_column,
            )

    tokens.append(Token("EOF", "", line, column))
    return tokens


@dataclass(frozen=True)
class Expr:
    line: int
    column: int


@dataclass(frozen=True)
class Literal(Expr):
    value: Any


@dataclass(frozen=True)
class Name(Expr):
    name: str


@dataclass(frozen=True)
class Unary(Expr):
    operator: str
    operand: Expr


@dataclass(frozen=True)
class Binary(Expr):
    operator: str
    left: Expr
    right: Expr


@dataclass(frozen=True)
class Call(Expr):
    name: str
    arguments: tuple[Expr, ...]


@dataclass(frozen=True)
class Statement:
    line: int
    column: int


@dataclass(frozen=True)
class Assignment(Statement):
    name: str
    expression: Expr
    display: bool


@dataclass(frozen=True)
class ExpressionStatement(Statement):
    expression: Expr


class _Parser:
    def __init__(self, tokens: list[Token]):
        self.tokens = tokens
        self.index = 0
        self.nodes = 0
        self.nesting = 0

    def parse(self) -> tuple[Statement, ...]:
        statements: list[Statement] = []
        while not self._at("EOF"):
            if self._match("SEMI"):
                continue
            statements.append(self._statement())
            if self._match("SEMI"):
                continue
            if not self._at("EOF"):
                raise _syntax(self._current(), "语句之间缺少分号", "missing_semicolon")
        if not statements:
            raise _syntax(self._current(), "公式不能为空", "empty_formula")
        return tuple(statements)

    def _statement(self) -> Statement:
        if self._at("IDENT") and self._peek(1).kind in {"ASSIGN", "COLON"}:
            name = self._take()
            operator = self._take()
            expression = self._or_expression()
            self._bump(name)
            return Assignment(
                name.line, name.column, name.value, expression, operator.kind == "COLON",
            )
        expression = self._or_expression()
        self._bump(Token("NODE", "", expression.line, expression.column))
        return ExpressionStatement(expression.line, expression.column, expression)

    def _or_expression(self) -> Expr:
        expression = self._and_expression()
        while self._keyword("OR"):
            operator = self._take()
            right = self._and_expression()
            self._bump(operator)
            expression = Binary(operator.line, operator.column, "OR", expression, right)
        return expression

    def _and_expression(self) -> Expr:
        expression = self._not_expression()
        while self._keyword("AND"):
            operator = self._take()
            right = self._not_expression()
            self._bump(operator)
            expression = Binary(operator.line, operator.column, "AND", expression, right)
        return expression

    def _not_expression(self) -> Expr:
        token = self._current()
        if self._keyword("NOT"):
            self._take()
            self._enter(token)
            try:
                operand = self._not_expression()
            finally:
                self.nesting -= 1
            self._bump(token)
            return Unary(token.line, token.column, "NOT", operand)
        return self._comparison()

    def _comparison(self) -> Expr:
        expression = self._additive()
        while self._at("OP") and self._current().value in {"=", "==", "!=", "<>", ">", ">=", "<", "<="}:
            operator = self._take()
            right = self._additive()
            self._bump(operator)
            expression = Binary(operator.line, operator.column, operator.value, expression, right)
        return expression

    def _additive(self) -> Expr:
        expression = self._multiplicative()
        while self._at("OP") and self._current().value in {"+", "-"}:
            operator = self._take()
            right = self._multiplicative()
            self._bump(operator)
            expression = Binary(operator.line, operator.column, operator.value, expression, right)
        return expression

    def _multiplicative(self) -> Expr:
        expression = self._unary()
        while self._at("OP") and self._current().value in {"*", "/"}:
            operator = self._take()
            right = self._unary()
            self._bump(operator)
            expression = Binary(operator.line, operator.column, operator.value, expression, right)
        return expression

    def _unary(self) -> Expr:
        token = self._current()
        if token.kind == "OP" and token.value in {"+", "-"}:
            self._take()
            self._enter(token)
            try:
                operand = self._unary()
            finally:
                self.nesting -= 1
            self._bump(token)
            return Unary(token.line, token.column, _canon(str(token.value)), operand)
        return self._primary()

    def _primary(self) -> Expr:
        token = self._current()
        if self._match("NUMBER") or self._match("STRING"):
            self._bump(token)
            return Literal(token.line, token.column, token.value)
        if self._match("IDENT"):
            if self._match("LPAREN"):
                self._enter(token)
                try:
                    arguments: list[Expr] = []
                    if not self._at("RPAREN"):
                        while True:
                            arguments.append(self._or_expression())
                            if not self._match("COMMA"):
                                break
                    self._expect("RPAREN", "函数调用缺少右括号", "missing_parenthesis")
                finally:
                    self.nesting -= 1
                self._bump(token)
                return Call(token.line, token.column, token.value, tuple(arguments))
            self._bump(token)
            return Name(token.line, token.column, token.value)
        if self._match("LPAREN"):
            self._enter(token)
            try:
                expression = self._or_expression()
                self._expect("RPAREN", "表达式缺少右括号", "missing_parenthesis")
            finally:
                self.nesting -= 1
            return expression
        raise _syntax(token, f"无法识别的标记：{token.value or '文件结尾'}", "unexpected_token")

    def _enter(self, token: Token) -> None:
        self.nesting += 1
        if self.nesting > MAX_NESTING:
            raise _syntax(token, f"公式嵌套不能超过 {MAX_NESTING} 层", "too_deep")

    def _bump(self, token: Token) -> None:
        self.nodes += 1
        if self.nodes > MAX_AST_NODES:
            raise _syntax(token, f"公式最多允许 {MAX_AST_NODES} 个节点", "too_many_nodes")

    def _keyword(self, value: str) -> bool:
        return self._at("IDENT") and _canon(str(self._current().value)) == value

    def _current(self) -> Token:
        return self.tokens[self.index]

    def _peek(self, offset: int) -> Token:
        return self.tokens[min(self.index + offset, len(self.tokens) - 1)]

    def _at(self, kind: str) -> bool:
        return self._current().kind == kind

    def _take(self) -> Token:
        token = self._current()
        self.index += 1
        return token

    def _match(self, kind: str) -> bool:
        if not self._at(kind):
            return False
        self.index += 1
        return True

    def _expect(self, kind: str, message: str, code: str) -> Token:
        if not self._at(kind):
            raise _syntax(self._current(), message, code)
        return self._take()


_FUNCTION_ARITY: dict[str, int] = {
    "MA": 2,
    "HHV": 2,
    "LLV": 2,
    "REF": 2,
    "COUNT": 2,
    "IF": 3,
    "EVERY": 2,
    "HHVBARS": 2,
    "LLVBARS": 2,
    "EXTDATA_USER": 2,
    "FINANCE": 1,
    "CODELIKE": 1,
    "DRAWICON": 3,
    "BARSSINCEN": 2,
}

_BASE_NAMES = {
    "C", "CLOSE", "H", "HIGH", "L", "LOW", "VOL", "VOLUME", "CAPITAL",
    "V", "O", "OPEN", "TRUE", "FALSE",
}


def _walk_validate(expression: Expr, defined: set[str], used_functions: set[str]) -> None:
    if isinstance(expression, Literal):
        return
    if isinstance(expression, Name):
        name = _canon(expression.name)
        if name not in defined:
            raise TdxFormulaSyntaxError(
                f"变量 {expression.name} 尚未定义",
                code="unknown_variable",
                line=expression.line,
                column=expression.column,
            )
        return
    if isinstance(expression, Unary):
        _walk_validate(expression.operand, defined, used_functions)
        return
    if isinstance(expression, Binary):
        _walk_validate(expression.left, defined, used_functions)
        _walk_validate(expression.right, defined, used_functions)
        return
    if isinstance(expression, Call):
        name = _canon(expression.name)
        arity = _FUNCTION_ARITY.get(name)
        if arity is None:
            raise TdxFormulaSyntaxError(
                f"不支持通达信函数 {expression.name}",
                code="unsupported_function",
                line=expression.line,
                column=expression.column,
            )
        if len(expression.arguments) != arity:
            raise TdxFormulaSyntaxError(
                f"函数 {expression.name} 需要 {arity} 个参数，实际为 {len(expression.arguments)} 个",
                code="wrong_arity",
                line=expression.line,
                column=expression.column,
            )
        used_functions.add(name)
        for argument in expression.arguments:
            _walk_validate(argument, defined, used_functions)
        if name == "EXTDATA_USER":
            slot, data_type = expression.arguments
            if not (
                isinstance(slot, Literal) and slot.value in {1.0, 2.0, 3.0, 4.0}
                and isinstance(data_type, Literal) and data_type.value == 0.0
            ):
                raise TdxFormulaSyntaxError(
                    "EXTDATA_USER 仅支持 (1|2|3|4, 0)，分别对应 RPS120/250/50/20",
                    code="unsupported_external_data",
                    line=expression.line,
                    column=expression.column,
                )
        if name == "FINANCE":
            index = expression.arguments[0]
            if not isinstance(index, Literal) or index.value not in {43.0, 44.0}:
                raise TdxFormulaSyntaxError(
                    "FINANCE 当前仅支持 43（净利润同比）和 44（营收同比）",
                    code="unsupported_finance_field",
                    line=expression.line,
                    column=expression.column,
                )
        if name == "CODELIKE":
            prefix = expression.arguments[0]
            if not (
                isinstance(prefix, Literal)
                and isinstance(prefix.value, str)
                and re.fullmatch(r"\d{1,6}", prefix.value)
            ):
                raise TdxFormulaSyntaxError(
                    "CODELIKE 仅支持1至6位数字代码前缀字面量",
                    code="invalid_code_prefix",
                    line=expression.line,
                    column=expression.column,
                )
        return
    raise AssertionError(type(expression))


def _numeric_bound(expression: Expr, bounds: dict[str, float | None]) -> float | None:
    if isinstance(expression, Literal) and isinstance(expression.value, (int, float)):
        return min(MAX_HISTORY, abs(float(expression.value)))
    if isinstance(expression, Name):
        return bounds.get(_canon(expression.name))
    if isinstance(expression, Unary):
        return _numeric_bound(expression.operand, bounds)
    if isinstance(expression, Binary):
        left = _numeric_bound(expression.left, bounds)
        right = _numeric_bound(expression.right, bounds)
        if left is None or right is None:
            return None
        if expression.operator in {"+", "-"}:
            return min(MAX_HISTORY, left + right)
        if expression.operator == "*":
            return min(MAX_HISTORY, left * right)
        if expression.operator == "/" and right:
            return min(MAX_HISTORY, left / right)
        return 1
    if isinstance(expression, Call):
        name = _canon(expression.name)
        if name in {"HHVBARS", "LLVBARS", "BARSSINCEN"}:
            return _numeric_bound(expression.arguments[1], bounds)
        if name == "IF":
            left = _numeric_bound(expression.arguments[1], bounds)
            right = _numeric_bound(expression.arguments[2], bounds)
            if left is None or right is None:
                return None
            return max(left, right)
    return None


def _history_for(expression: Expr, histories: dict[str, int], bounds: dict[str, float | None]) -> int:
    if isinstance(expression, Literal):
        return 1
    if isinstance(expression, Name):
        return histories.get(_canon(expression.name), 1)
    if isinstance(expression, Unary):
        return _history_for(expression.operand, histories, bounds)
    if isinstance(expression, Binary):
        return max(
            _history_for(expression.left, histories, bounds),
            _history_for(expression.right, histories, bounds),
        )
    if isinstance(expression, Call):
        argument_history = [
            _history_for(argument, histories, bounds) for argument in expression.arguments
        ]
        name = _canon(expression.name)
        if name in {"MA", "HHV", "LLV", "COUNT", "EVERY", "HHVBARS", "LLVBARS", "BARSSINCEN"}:
            if not isinstance(expression.arguments[1], Literal):
                # Dynamic periods can become zero; in TongdaXin zero means all
                # available history, so cap the conservative requirement at 800.
                return MAX_HISTORY
            period = _numeric_bound(expression.arguments[1], bounds)
            period_int = MAX_HISTORY if period is None else max(1, int(math.ceil(period)))
            return min(MAX_HISTORY, max(argument_history[1], argument_history[0] + period_int - 1))
        if name == "REF":
            offset = _numeric_bound(expression.arguments[1], bounds)
            offset_int = MAX_HISTORY if offset is None else max(0, int(math.ceil(offset)))
            return min(MAX_HISTORY, max(argument_history[1], argument_history[0] + offset_int))
        return min(MAX_HISTORY, max(argument_history, default=1))
    raise AssertionError(type(expression))


@dataclass(frozen=True)
class Program:
    source: str
    statements: tuple[Statement, ...]
    required_history: int
    used_functions: tuple[str, ...]
    uses_finance: bool
    uses_rps: bool

    def evaluate(
        self,
        bars: list[dict],
        *,
        rps: dict | None = None,
        financial: dict | None = None,
        code: str = "",
        capital: float | list[float] | None = None,
        context: dict | None = None,
    ) -> dict:
        return _Evaluator(
            self,
            bars,
            rps=rps,
            financial=financial,
            code=code,
            capital=capital,
            context=context,
        ).run()


def compile_formula(source: str) -> Program:
    """Parse and statically validate a TDX formula without evaluating market data."""
    statements = _Parser(_tokenize(source)).parse()
    defined = set(_BASE_NAMES)
    used_functions: set[str] = set()
    histories = {name: 1 for name in _BASE_NAMES}
    bounds: dict[str, float | None] = {name: None for name in _BASE_NAMES}
    max_history = 1

    for statement in statements:
        expression = statement.expression
        _walk_validate(expression, defined, used_functions)
        expression_history = _history_for(expression, histories, bounds)
        max_history = max(max_history, expression_history)
        if isinstance(statement, Assignment):
            name = _canon(statement.name)
            if name in _BASE_NAMES or name in _FUNCTION_ARITY or name in {"AND", "OR", "NOT"}:
                raise TdxFormulaSyntaxError(
                    f"不能覆盖保留名称 {statement.name}",
                    code="reserved_name",
                    line=statement.line,
                    column=statement.column,
                )
            if name in defined:
                raise TdxFormulaSyntaxError(
                    f"变量 {statement.name} 重复定义",
                    code="duplicate_variable",
                    line=statement.line,
                    column=statement.column,
                )
            defined.add(name)
            histories[name] = expression_history
            bounds[name] = _numeric_bound(expression, bounds)

    ordered_functions = tuple(sorted(used_functions))
    return Program(
        source=source,
        statements=statements,
        required_history=min(MAX_HISTORY, max_history),
        used_functions=ordered_functions,
        uses_finance="FINANCE" in used_functions,
        uses_rps="EXTDATA_USER" in used_functions,
    )


def validate_formula(source: str) -> dict:
    program = compile_formula(source)
    return {
        "valid": True,
        "required_history": program.required_history,
        "used_functions": list(program.used_functions),
        "uses_finance": program.uses_finance,
        "uses_rps": program.uses_rps,
    }


def execute_formula(
    source_or_program: str | Program,
    bars: list[dict],
    *,
    rps: dict | None = None,
    financial: dict | None = None,
    code: str = "",
    capital: float | list[float] | None = None,
    context: dict | None = None,
) -> dict:
    program = compile_formula(source_or_program) if isinstance(source_or_program, str) else source_or_program
    if not isinstance(program, Program):
        raise TypeError("source_or_program 必须是公式文本或 Program")
    return program.evaluate(
        bars,
        rps=rps,
        financial=financial,
        code=code,
        capital=capital,
        context=context,
    )


evaluate_formula = execute_formula


def _finite_number(value: Any) -> float | None:
    if isinstance(value, str):
        value = value.strip().replace(",", "").replace("%", "")
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _truth(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value)
    number = _finite_number(value)
    return bool(number) if number is not None else bool(value)


def _last(series: list[Any]) -> Any:
    if not series:
        return None
    value = series[-1]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _expression_key(expression: Expr) -> tuple:
    """Location-independent key used for safe common-subexpression caching."""
    if isinstance(expression, Literal):
        return ("LITERAL", expression.value)
    if isinstance(expression, Name):
        return ("NAME", _canon(expression.name))
    if isinstance(expression, Unary):
        return ("UNARY", expression.operator, _expression_key(expression.operand))
    if isinstance(expression, Binary):
        return (
            "BINARY", expression.operator,
            _expression_key(expression.left), _expression_key(expression.right),
        )
    if isinstance(expression, Call):
        return (
            "CALL", _canon(expression.name),
            tuple(_expression_key(argument) for argument in expression.arguments),
        )
    raise AssertionError(type(expression))


class _Evaluator:
    def __init__(
        self,
        program: Program,
        bars: list[dict],
        *,
        rps: dict | None,
        financial: dict | None,
        code: str,
        capital: float | list[float] | None,
        context: dict | None,
    ) -> None:
        if not isinstance(bars, list) or not bars:
            raise TdxFormulaEvaluationError("bars 必须是非空数组", code="invalid_bars")
        if any(not isinstance(bar, dict) for bar in bars):
            raise TdxFormulaEvaluationError("bars 中每一项都必须是对象", code="invalid_bars")
        self.program = program
        self.bars = bars
        self.size = len(bars)
        self.context = dict(context or {})
        self.rps = dict(rps or self.context.get("rps") or {})
        self.financial = dict(financial or self.context.get("financial") or {})
        self.code = str(code or self.context.get("code") or "")
        self.external_data = dict(self.context.get("external_data") or {})
        self.env: dict[str, list[Any]] = {}
        self.variable_names: list[tuple[str, str]] = []
        self.outputs: list[dict] = []
        self.graphics: list[dict] = []
        self.expression_cache: dict[tuple, list[Any]] = {}
        context_capital = self.context.get("capital")
        financial_capital = self.financial.get("capital", self.financial.get("CAPITAL"))
        effective_capital = capital
        if effective_capital is None:
            effective_capital = context_capital if context_capital is not None else financial_capital
        self._install_market_series(effective_capital)

    def _install_market_series(self, capital: float | list[float] | None) -> None:
        aliases = {
            "C": ("close", "c"),
            "H": ("high", "h"),
            "L": ("low", "l"),
            "O": ("open", "o"),
            "VOL": ("vol", "volume"),
        }
        for canonical, keys in aliases.items():
            values = []
            found = False
            for bar in self.bars:
                raw = next((bar[key] for key in keys if key in bar), None)
                number = _finite_number(raw)
                found = found or number is not None
                values.append(number)
            if found:
                self.env[canonical] = values
        for alias, canonical in {
            "CLOSE": "C", "HIGH": "H", "LOW": "L", "OPEN": "O", "VOLUME": "VOL", "V": "VOL",
        }.items():
            if canonical in self.env:
                self.env[alias] = self.env[canonical]

        capital_values: list[Any] | None = None
        if isinstance(capital, list):
            if len(capital) != self.size:
                raise TdxFormulaEvaluationError(
                    "capital 序列长度必须与 bars 一致", code="invalid_context",
                )
            capital_values = [_finite_number(value) for value in capital]
        elif capital is not None:
            number = _finite_number(capital)
            capital_values = [number] * self.size
        else:
            bar_values = [_finite_number(bar.get("capital")) for bar in self.bars]
            if any(value is not None for value in bar_values):
                capital_values = bar_values
            else:
                shares = _finite_number(
                    self.financial.get("free_float_shares")
                    or self.context.get("free_float_shares")
                )
                if shares is not None:
                    # TongdaXin VOL and CAPITAL are both expressed in board lots.
                    capital_values = [shares / 100] * self.size
        if capital_values is not None:
            self.env["CAPITAL"] = capital_values
        self.env["TRUE"] = [True] * self.size
        self.env["FALSE"] = [False] * self.size

        datetimes = [str(bar.get("datetime") or bar.get("date") or "") for bar in self.bars]
        if all(datetimes) and any(current <= previous for previous, current in zip(datetimes, datetimes[1:])):
            raise TdxFormulaEvaluationError(
                "bars 必须按时间严格升序且不能包含重复交易日",
                code="invalid_bars_order",
            )

    def run(self) -> dict:
        final_series: list[Any] | None = None
        for statement in self.program.statements:
            final_series = self._evaluate(statement.expression)
            if isinstance(statement, Assignment):
                canonical = _canon(statement.name)
                self.env[canonical] = final_series
                self.variable_names.append((canonical, statement.name))
                if statement.display:
                    self.outputs.append({
                        "name": statement.name,
                        "value": _last(final_series),
                        "display": True,
                    })
            else:
                self.outputs.append({"name": None, "value": _last(final_series), "display": True})
        assert final_series is not None
        variables = {
            original: _last(self.env[canonical])
            for canonical, original in self.variable_names
        }
        return {
            "matched": _truth(_last(final_series)),
            "last_value": _last(final_series),
            "variables": variables,
            "outputs": self.outputs,
            "graphics": self.graphics,
            "required_history": self.program.required_history,
            "used_functions": list(self.program.used_functions),
            "uses_finance": self.program.uses_finance,
            "uses_rps": self.program.uses_rps,
        }

    def _evaluate(self, expression: Expr) -> list[Any]:
        cache_key = _expression_key(expression)
        cached = self.expression_cache.get(cache_key)
        if cached is not None:
            return cached
        if isinstance(expression, Literal):
            result = [expression.value] * self.size
        elif isinstance(expression, Name):
            canonical = _canon(expression.name)
            values = self.env.get(canonical)
            if values is None:
                raise TdxFormulaEvaluationError(
                    f"缺少变量 {expression.name} 所需的数据",
                    code="missing_market_data",
                    line=expression.line,
                    column=expression.column,
                )
            if canonical in _BASE_NAMES and any(value is None for value in values):
                raise TdxFormulaEvaluationError(
                    f"行情字段 {expression.name} 存在缺失值",
                    code="missing_market_data",
                    line=expression.line,
                    column=expression.column,
                )
            result = values
        elif isinstance(expression, Unary):
            values = self._evaluate(expression.operand)
            if expression.operator == "NOT":
                result = [not _truth(value) for value in values]
            elif expression.operator == "+":
                result = [_finite_number(value) for value in values]
            elif expression.operator == "-":
                result = [(-number if number is not None else None) for number in map(_finite_number, values)]
            else:
                raise AssertionError(expression.operator)
        elif isinstance(expression, Binary):
            result = self._binary(expression)
        elif isinstance(expression, Call):
            result = self._call(expression)
        else:
            raise AssertionError(type(expression))
        self.expression_cache[cache_key] = result
        return result

    def _binary(self, expression: Binary) -> list[Any]:
        left = self._evaluate(expression.left)
        right = self._evaluate(expression.right)
        operator = expression.operator
        result: list[Any] = []
        for first, second in zip(left, right):
            if operator == "AND":
                result.append(_truth(first) and _truth(second))
                continue
            if operator == "OR":
                result.append(_truth(first) or _truth(second))
                continue
            if operator in {"=", "==", "!=", "<>", ">", ">=", "<", "<="}:
                if first is None or second is None:
                    result.append(False)
                    continue
                try:
                    if operator in {"=", "=="}:
                        result.append(first == second)
                    elif operator in {"!=", "<>"}:
                        result.append(first != second)
                    elif operator == ">":
                        result.append(first > second)
                    elif operator == ">=":
                        result.append(first >= second)
                    elif operator == "<":
                        result.append(first < second)
                    else:
                        result.append(first <= second)
                except TypeError as error:
                    raise TdxFormulaEvaluationError(
                        "比较两侧的数据类型不兼容",
                        code="incompatible_types",
                        line=expression.line,
                        column=expression.column,
                    ) from error
                continue
            first_number = _finite_number(first)
            second_number = _finite_number(second)
            if first_number is None or second_number is None:
                result.append(None)
            elif operator == "+":
                result.append(first_number + second_number)
            elif operator == "-":
                result.append(first_number - second_number)
            elif operator == "*":
                result.append(first_number * second_number)
            elif operator == "/":
                result.append(None if second_number == 0 else first_number / second_number)
            else:
                raise AssertionError(operator)
        return result

    def _call(self, expression: Call) -> list[Any]:
        name = _canon(expression.name)
        arguments = [self._evaluate(argument) for argument in expression.arguments]
        if name == "MA":
            return self._rolling_numeric(arguments[0], arguments[1], "MA", expression)
        if name == "HHV":
            return self._rolling_numeric(arguments[0], arguments[1], "HHV", expression)
        if name == "LLV":
            return self._rolling_numeric(arguments[0], arguments[1], "LLV", expression)
        if name == "REF":
            return self._reference(arguments[0], arguments[1], expression)
        if name == "COUNT":
            return self._rolling_boolean(arguments[0], arguments[1], False, expression)
        if name == "EVERY":
            return self._rolling_boolean(arguments[0], arguments[1], True, expression)
        if name in {"HHVBARS", "LLVBARS"}:
            return self._extreme_bars(arguments[0], arguments[1], name == "HHVBARS", expression)
        if name == "IF":
            return [yes if _truth(condition) else no for condition, yes, no in zip(*arguments)]
        if name == "EXTDATA_USER":
            return self._external_data(arguments[0], expression)
        if name == "FINANCE":
            return self._finance(arguments[0], expression)
        if name == "CODELIKE":
            return [self.code.startswith(str(prefix)) for prefix in arguments[0]]
        if name == "BARSSINCEN":
            return self._bars_since_n(arguments[0], arguments[1], expression)
        if name == "DRAWICON":
            conditions = [_truth(value) for value in arguments[0]]
            self.graphics.append({
                "function": "DRAWICON",
                "condition": conditions[-1],
                "price": _last(arguments[1]),
                "icon": _last(arguments[2]),
            })
            return conditions
        raise AssertionError(name)

    def _period(self, value: Any, expression: Expr) -> int:
        number = _finite_number(value)
        if number is None or int(number) != number:
            raise TdxFormulaEvaluationError(
                "周期参数必须是整数",
                code="invalid_period",
                line=expression.line,
                column=expression.column,
            )
        period = int(number)
        if period < 0 or period > MAX_HISTORY:
            raise TdxFormulaEvaluationError(
                f"周期参数必须在 0 到 {MAX_HISTORY} 之间",
                code="period_out_of_range",
                line=expression.line,
                column=expression.column,
            )
        return period

    def _window_start(self, index: int, period: int) -> int:
        return 0 if period == 0 else max(0, index - period + 1)

    def _constant_period(self, periods: list[Any], expression: Expr) -> int | None:
        if not periods:
            return None
        first = self._period(periods[0], expression)
        for value in periods[1:]:
            if self._period(value, expression) != first:
                return None
        return first

    def _rolling_numeric(
        self, values: list[Any], periods: list[Any], kind: str, expression: Expr,
    ) -> list[Any]:
        constant_period = self._constant_period(periods, expression)
        if constant_period is not None:
            if kind == "MA":
                return self._moving_average(values, constant_period)
            return self._moving_extreme(values, constant_period, kind == "HHV")
        result: list[Any] = []
        for index, period_value in enumerate(periods):
            period = self._period(period_value, expression)
            start = self._window_start(index, period)
            window = [_finite_number(value) for value in values[start:index + 1]]
            valid = [value for value in window if value is not None]
            if kind == "MA":
                enough = period == 0 or index - start + 1 >= period
                result.append(sum(valid) / len(valid) if enough and len(valid) == len(window) and valid else None)
            elif kind == "HHV":
                result.append(max(valid) if valid else None)
            else:
                result.append(min(valid) if valid else None)
        return result

    def _moving_average(self, values: list[Any], period: int) -> list[Any]:
        result: list[Any] = []
        running_sum = 0.0
        invalid = 0
        numeric = [_finite_number(value) for value in values]
        for index, value in enumerate(numeric):
            if value is None:
                invalid += 1
            else:
                running_sum += value
            if period > 0 and index >= period:
                expired = numeric[index - period]
                if expired is None:
                    invalid -= 1
                else:
                    running_sum -= expired
            window_size = index + 1 if period == 0 else min(index + 1, period)
            enough = period == 0 or index + 1 >= period
            result.append(running_sum / window_size if enough and invalid == 0 and window_size else None)
        return result

    def _moving_extreme(self, values: list[Any], period: int, highest: bool) -> list[Any]:
        numeric = [_finite_number(value) for value in values]
        positions: deque[int] = deque()
        result: list[Any] = []
        for index, value in enumerate(numeric):
            start = self._window_start(index, period)
            while positions and positions[0] < start:
                positions.popleft()
            if value is not None:
                if highest:
                    while positions and numeric[positions[-1]] <= value:
                        positions.pop()
                else:
                    while positions and numeric[positions[-1]] >= value:
                        positions.pop()
                positions.append(index)
            result.append(numeric[positions[0]] if positions else None)
        return result

    def _reference(self, values: list[Any], offsets: list[Any], expression: Expr) -> list[Any]:
        constant_offset = self._constant_period(offsets, expression)
        if constant_offset is not None:
            return [values[index - constant_offset] if index >= constant_offset else None for index in range(self.size)]
        result = []
        for index, offset_value in enumerate(offsets):
            offset = self._period(offset_value, expression)
            source_index = index - offset
            result.append(values[source_index] if source_index >= 0 else None)
        return result

    def _rolling_boolean(
        self,
        values: list[Any],
        periods: list[Any],
        require_every: bool,
        expression: Expr,
    ) -> list[Any]:
        prefix = [0]
        for value in values:
            prefix.append(prefix[-1] + int(_truth(value)))
        result: list[Any] = []
        for index, period_value in enumerate(periods):
            period = self._period(period_value, expression)
            start = self._window_start(index, period)
            true_count = prefix[index + 1] - prefix[start]
            window_size = index - start + 1
            if require_every:
                enough = period == 0 or window_size >= period
                result.append(enough and true_count == window_size)
            else:
                result.append(true_count)
        return result

    def _extreme_bars(
        self,
        values: list[Any],
        periods: list[Any],
        highest: bool,
        expression: Expr,
    ) -> list[Any]:
        constant_period = self._constant_period(periods, expression)
        if constant_period is not None:
            numeric = [_finite_number(value) for value in values]
            positions: deque[int] = deque()
            result = []
            for index, value in enumerate(numeric):
                start = self._window_start(index, constant_period)
                while positions and positions[0] < start:
                    positions.popleft()
                if value is not None:
                    if highest:
                        while positions and numeric[positions[-1]] <= value:
                            positions.pop()
                    else:
                        while positions and numeric[positions[-1]] >= value:
                            positions.pop()
                    positions.append(index)
                result.append(index - positions[0] if positions else None)
            return result
        result = []
        for index, period_value in enumerate(periods):
            period = self._period(period_value, expression)
            start = self._window_start(index, period)
            candidates = [
                (position, _finite_number(values[position]))
                for position in range(start, index + 1)
            ]
            candidates = [(position, value) for position, value in candidates if value is not None]
            if not candidates:
                result.append(None)
                continue
            extreme = (max if highest else min)(value for _, value in candidates)
            # TongdaXin uses the most recent bar when the extreme is tied.
            position = max(position for position, value in candidates if value == extreme)
            result.append(index - position)
        return result

    def _bars_since_n(
        self, values: list[Any], periods: list[Any], expression: Expr,
    ) -> list[Any]:
        constant_period = self._constant_period(periods, expression)
        if constant_period is not None:
            matches: deque[int] = deque()
            result = []
            for index, value in enumerate(values):
                start = self._window_start(index, constant_period)
                while matches and matches[0] < start:
                    matches.popleft()
                if _truth(value):
                    matches.append(index)
                result.append(None if not matches else index - matches[0])
            return result
        result = []
        for index, period_value in enumerate(periods):
            period = self._period(period_value, expression)
            start = self._window_start(index, period)
            first = next((position for position in range(start, index + 1) if _truth(values[position])), None)
            # An absent event is invalid rather than zero; this prevents `BARSSINCEN(...)=0`
            # from producing a signal when the source condition never happened.
            result.append(None if first is None else index - first)
        return result

    def _external_data(self, slots: list[Any], expression: Expr) -> list[Any]:
        result = []
        normalized_rps = {_canon(str(key)): value for key, value in self.rps.items()}
        normalized_external = {_canon(str(key)): value for key, value in self.external_data.items()}
        slot_keys = {
            1: ("1", "RPS120", "RPS_120"),
            2: ("2", "RPS250", "RPS_250"),
            3: ("3", "RPS50", "RPS_50"),
            4: ("4", "RPS20", "RPS_20"),
        }
        for index, slot_value in enumerate(slots):
            slot_number = _finite_number(slot_value)
            if slot_number is None or int(slot_number) != slot_number:
                raise TdxFormulaEvaluationError(
                    "EXTDATA_USER 数据编号必须是整数",
                    code="invalid_external_slot",
                    line=expression.line,
                    column=expression.column,
                )
            slot = int(slot_number)
            keys = slot_keys.get(slot, (str(slot),))
            raw = next((normalized_external[key] for key in keys if key in normalized_external), None)
            scale = 1.0
            if raw is None:
                raw = next((normalized_rps[key] for key in keys if key in normalized_rps), None)
                scale = 10.0
            if raw is None:
                raise TdxFormulaEvaluationError(
                    f"缺少 EXTDATA_USER({slot}, ...) 对应的 RPS/外部数据",
                    code="missing_external_data",
                    line=expression.line,
                    column=expression.column,
                )
            if isinstance(raw, list):
                if len(raw) != self.size:
                    raise TdxFormulaEvaluationError(
                        f"EXTDATA_USER({slot}, ...) 序列长度与 bars 不一致",
                        code="invalid_context",
                        line=expression.line,
                        column=expression.column,
                    )
                value = raw[index]
            else:
                value = raw
            number = _finite_number(value)
            result.append(number * scale if number is not None else None)
        return result

    def _finance(self, indices: list[Any], expression: Expr) -> list[Any]:
        aliases = {
            43: ("43", "FINANCE43", "FINANCE_43", "NET_PROFIT_YOY_PCT", "NET_PROFIT_YOY"),
            44: ("44", "FINANCE44", "FINANCE_44", "REVENUE_YOY_PCT", "REVENUE_YOY"),
        }
        normalized = {_canon(str(key)): value for key, value in self.financial.items()}
        result = []
        for position, index_value in enumerate(indices):
            number = _finite_number(index_value)
            if number is None or int(number) != number:
                raise TdxFormulaEvaluationError(
                    "FINANCE 数据编号必须是整数",
                    code="invalid_finance_index",
                    line=expression.line,
                    column=expression.column,
                )
            finance_index = int(number)
            keys = aliases.get(finance_index, (str(finance_index), f"FINANCE{finance_index}", f"FINANCE_{finance_index}"))
            raw = next((normalized[key] for key in keys if key in normalized), None)
            if raw is None:
                raise TdxFormulaEvaluationError(
                    f"缺少 FINANCE({finance_index}) 对应的财务数据",
                    code="missing_financial_data",
                    line=expression.line,
                    column=expression.column,
                )
            if isinstance(raw, list):
                if len(raw) != self.size:
                    raise TdxFormulaEvaluationError(
                        f"FINANCE({finance_index}) 序列长度与 bars 不一致",
                        code="invalid_context",
                        line=expression.line,
                        column=expression.column,
                    )
                raw = raw[position]
            result.append(_finite_number(raw))
        return result


__all__ = [
    "Program",
    "TdxFormulaError",
    "TdxFormulaSyntaxError",
    "TdxFormulaEvaluationError",
    "compile_formula",
    "validate_formula",
    "execute_formula",
    "evaluate_formula",
]
