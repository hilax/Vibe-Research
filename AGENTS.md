# AGENTS.md

本文件适用于整个仓库。修改某个子目录前，先阅读该目录的 `README.md`；`a-stock-data/` 与 `global-stock-data/` 还要阅读各自的 `SKILL.md` 和 `CHANGELOG.md`。

## 项目目标与不可破坏的边界

本系统是本地优先的个人 AI 投研看板：A 股是主线，美股、港股和韩股提供补充数据。项目负责聚合公开事实、计算客观指标、组织上下文；最终分析由用户自行配置的模型给出。

- 只陈述可追溯的客观数据。可新增荐股、主观评级/打分、涨跌预测、买卖时点、目标价或收益承诺。
- 涨停、连板、成交额、RPS、估值分位等公开榜单或机械计算可以展示，但必须写清口径，不包装成推荐。
- 可预置具体股票到自选、持仓、板块或演示数据。`frontend/src/data/sectors.json` 的 `nodes` 只能放产业链环节，能放放标的尽量放标的。
- 未经可靠数据核实，不要把 `verified: false` 的板块补成已核实；不要凭模型记忆编造产业链数据。
- 用户持仓、自选、研究记录、上传研报和模型/API 密钥必须保持本地，不得写入仓库、日志、测试夹具或遥测。
- A 股及本项目全部行情 UI 统一使用“红涨绿跌”；全球市场也有意沿用这一中国用户习惯，不要改成绿涨红跌。

## 仓库结构与责任边界

- `backend/app.py`：FastAPI 应用、鉴权/CORS、参数校验、HTTP 状态码和全部 `/api` 路由的组合层。
- `backend/astock.py`：A 股行情、估值、研报、公告、K 线、资金/筹码数据及数据源回退策略。
- `backend/gstock.py`：美股、港股、韩股的东财域内行情与财务子集；没有纳入 Yahoo/SEC 路径。
- `backend/market.py`：市场概览、短线情绪和成交额榜单。
- `backend/newsradar.py` + `backend/news_sources.json`：12 个赛道、108 个 RSS 源及合规关键词过滤。
- `backend/chat.py`、`backend/cli_runtime.py`、`backend/mcp_server.py`：OpenAI-compatible 工具循环、本机 AI CLI 和 MCP stdio 入口。MCP 与 Web 聊天应复用同一批安全工具，不要复制出两套行为。
- `backend/portfolio.py`、`backend/myreports.py`：本地私有数据、迁移、锁和原子写入。
- `backend/quant.py`、`backend/tdx_formula.py`、`backend/tdx_presets.py`、`backend/quant_formula.py`：量化池、RPS、通达信安全解释器、预置公式和旧版命名信号解析。
- `frontend/src/lib/api.ts`：前后端契约和请求/NDJSON 流的唯一集中入口；页面不要散写 `fetch`。
- `frontend/src/lib/llm.ts`：AI 流式对话；`frontend/src/lib/klineSignals.ts` 与 `klinePalette.ts`：K 线公式信号、配色和频率的共享实现。
- `frontend/src/router.tsx`、`components/`、`pages/`：路由、复用组件和页面。视觉基线是 Tailwind 的暖橙玻璃风格。
- `a-stock-data/`：上游 A 股数据技能的独立快照（Apache-2.0），不是主后端的可直接覆盖副本。
- `global-stock-data/`：上游全球股票数据技能的独立快照（Apache-2.0）；主后端只选取了东财域内子集。

`a-stock-data/` 与 `global-stock-data/` 的 `SKILL.md` 是自包含发布产物，内含代码示例。只有明确升级快照时才修改，并同步版本、`README.md`、`CHANGELOG.md` 与 `SKILL.md`；不要把快照机械复制到主后端，也不要删除其许可证。

## 本地开发

要求 Python 3.10+ 和 Node.js/npm。后端模块采用从 `backend/` 工作目录运行的平铺导入方式，不要假定仓库根目录是 Python 包。

```bash
# 后端，端口 8900
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8900

# 前端，端口 5899；/api 默认代理到 127.0.0.1:8900
cd frontend
npm install
npm run dev
```

完整 A 股能力需要 `akshare`、`mootdx` 和 `pandas`；核心行情/研报路径只依赖 FastAPI、Uvicorn、requests 和 BeautifulSoup，并应在可选依赖缺失时明确降级。不要为了导入应用就强制加载重型可选依赖。

常用环境变量如下；部署相关项记录在 `backend/.env.example`，RPS 调度项定义在 `backend/quant.py`：

- `VR_ALLOW_ORIGINS`：CORS 白名单；本地默认 `*`，公网部署应设置具体前端域名。
- `VR_API_KEY`：可选 Bearer 访问密钥。
- `VR_DATA_DIR`：持仓等私有数据根目录，默认 `~/.vibe-research/`。
- `VR_REPORTS_DIR`：上传研报目录，默认位于私有数据根目录下。
- `VR_DATA_PROXY=1`：数据源直连失败时允许代理回退。
- `VR_RPS_PREWARM=0`：关闭启动时 RPS 后台预热；调试导入副作用时可使用。
- `VR_RPS_PREWARM_TIMES`、`VR_RPS_WORKERS`：RPS 预热时刻和并发数。

前端部署需要改后端地址时使用 `VITE_API_URL`。不要依据被忽略的 `.claude/launch.json` 改动文档端口；仓库约定是 5899/8900。

## 后端实现规则

### API 与错误处理

- 新接口先在 `backend/app.py` 做输入边界和 Pydantic 校验，再调用领域模块。股票代码、数值范围和上传大小等约束不能只依赖前端。
- 保持统一响应形状（通常为 `{ "data": ... }`）；流式聊天和量化进度使用逐行 JSON（NDJSON）。
- 上游返回脏数据、空数据或形状变化时应安全降级，不能把 `NaN`、内部堆栈或含糊的 500 直接泄露给客户端。
- 延续现有状态码语义：客户端输入问题用 400/422；可选依赖缺失用 501；上游数据源失败用 502。变更前先查看相邻路由和现有测试。
- 所有外部请求必须设置有限超时。不要添加无界重试；缓存只保存经过校验、可复用的结果，避免把短暂空响应长期缓存。

### 数据源与限流

- A 股实时/历史行情优先使用mootdx。东财只用于其独有数据，降低封禁风险。
- `backend/astock.py` 中新增的东财 GET 必须经过 `em_get()`，保留串行节流、直连优先和代理回退；禁止用线程池并发打东财接口。
- `backend/gstock.py` 的 push2 延迟切换、精确代码匹配和韩股 `.KS` 语义是有意设计，改数据源时必须补回归测试。
- RSS 抓取可以按现有 `newsradar.py` 模式并发，但每个请求仍要遵守 `news_sources.json` 的超时、近几日窗口、单源上限和红线词过滤。
- 数据源字段、单位或口径变化时，在转换边界统一归一化；不要把不同来源的元/万元/亿元、百分数/比例静默混用。
- `backend/data/sw_industry.json` 是可再生成的申万行业映射快照。只有使用可靠源完整重建后才更新 `version` 和 `map`，不要手工改少量代码来掩盖源数据问题。

### 本地数据、安全与并发

- 私有数据默认写到 `~/.vibe-research/`；`backend/.cache/` 仅放可再生成缓存或旧版迁移源，不能成为新私有数据的默认位置。
- JSON 持久化沿用线程锁、临时文件加 `os.replace` 的原子写入方式。迁移必须可重复执行且不破坏旧文件。
- 上传文件继续执行文件名净化、扩展名白名单、25 MB 上限、路径边界检查；下载/删除必须通过索引 ID 定位，不能接受任意路径。
- 保留聊天工具的 SSRF 防护：只允许安全的 HTTP(S) 目标，拒绝回环、私网、链路本地地址及危险重定向。不要在日志中输出 API key 或完整 Authorization 头。
- `app.py` 导入时会启动持仓刷新调度和可选 RPS 预热。测试若需要控制副作用，必须在导入 `app` 之前设置隔离目录和相关环境变量。

### 量化与公式安全

- 用户公式绝不能交给 `eval`、`exec` 或 shell。扩展通达信语法时，只能修改 `tdx_formula.py` 的 lexer/parser/AST/函数白名单，并同时补安全和语义测试。
- 保留源码长度、token、AST 节点、嵌套层级、历史长度等资源上限；错误要带可用的行列位置，不能因异常公式拖垮服务。
- K 线数组按“最旧到最新”处理；频率编号固定为 `3=60分钟`、`4=日`、`5=周`、`6=月`。
- RPS 对外值域是 0–100；解释器的 `EXTDATA_USER` 使用现有的 `×10` 兼容口径。改变 RPS 股票池、历史门槛、交易日缓存或公式函数语义时，必须同步预置公式、前端展示和量化测试。
- 自定义公式的实用历史长度由解析结果推导。不要为了提速擅自截断 K 线，以免 MA/HHV/REF/COUNT 等结果漂移。

## 前端实现规则

- TypeScript 开启严格模式和未使用变量检查；沿用 `@/` 别名、函数组件、hooks 和现有双引号/分号风格。仓库未配置 ESLint/Prettier，不要声称存在相应检查。
- 后端契约变化必须同步 `frontend/src/lib/api.ts` 的类型和调用方法。页面通过 `api`/流式辅助函数访问后端，并正确处理加载、错误、空数据和 501 降级。
- NDJSON 流逐行解析；页面卸载、关闭面板、换问题或取消量化任务时必须中止请求，并丢弃旧请求的迟到数据。
- 快速切换股票等并发场景要保留 request-id/cancelled 竞态守卫，不能让旧响应覆盖新页面状态。
- 可复用视觉放入 `components/`；新增页面要同步 `router.tsx`，需要导航入口时再同步 `components/layout/Layout.tsx`。
- 使用现有 Tailwind 语义色和 `GlassCard`/`PageHeader` 等组件。A 股正值/上涨使用 `text-danger` 或红色，负值/下跌使用 `text-success` 或绿色。
- 浏览器本地数据继续使用 `vr-*` localStorage 键。解析必须容错隐私模式和损坏 JSON；不要把密钥或持仓放入 URL、构建时环境、控制台或远端存储。
- 板块数据必须尊重 `verified`：未核实页显示占位和核实提示，不要伪造完整内容。

## 跨层变更清单

做以下变更时，至少检查对应联动点：

- 新增/修改 API：`backend/app.py` → 领域模块 → `backend/tests/` → `frontend/src/lib/api.ts` → 使用页面。
- 新增环境变量：代码默认值 → `backend/.env.example` → 相应 README/本文件（若属于常用配置）。
- 新增 AI 工具：`backend/chat.py` 的 schema、实现和安全校验 → MCP 复用行为 → API/安全测试 → 前端工具来源标签。
- 修改通达信能力：lexer/parser/evaluator → `tdx_presets.py` → 量化整合 → `klineSignals.ts`/公式 UI（若需）→ 公式与量化测试。
- 修改数据源：超时/限流/回退/缓存 → 正常化字段与单位 → 离线 mock 测试 → `live` shape 测试。
- 修改依赖：对应 requirements 或 `frontend/package.json`，并更新 lockfile；不要仅手改 `package-lock.json`。
- 升级嵌入快照：只在其子目录内按上游结构更新，保留许可证并同步 README/CHANGELOG/SKILL 版本。

## 验证要求

安装开发依赖：

```bash
cd backend
.venv/bin/pip install -r requirements-dev.txt
```

按改动范围执行最小但充分的验证：

```bash
# 常规提交必跑：完全离线、稳定的单元和 API 测试
cd backend
.venv/bin/pytest -m "not live"

# 只在升级数据源、排查线上 shape 或发布前运行；需要网络，可能受交易时段/限流影响
.venv/bin/pytest -m live

# 前端类型检查和生产构建（项目当前没有单独的 lint/test script）
cd frontend
npm run build
```

- 后端正常测试必须离线且确定，外部 HTTP/akshare/mootdx/CLI 用 monkeypatch 或假数据；真正联网的检查统一标记 `@pytest.mark.live`。
- 测试持仓/研报时，像 `backend/conftest.py` 一样在导入 `app` 前设置临时 `VR_DATA_DIR`/`VR_REPORTS_DIR`，绝不接触用户真实目录。
- API 变更至少覆盖成功、无数据、非法输入和上游失败；安全相关变更还要覆盖 SSRF、鉴权、路径穿越或恶意公式。
- 纯文档改动可不跑全套测试，但仍要检查命令、文件路径和 Markdown；若测试因工作区已有改动失败，只报告事实，不覆盖或回退用户的修改。

## 仓库卫生

- 不提交 `.env`、密钥、持仓/自选/研报、`.cache/`、`.venv/`、`node_modules/`、`dist/`、`.pytest_cache/`、Playwright 临时产物或编辑器私有配置。
- `package-lock.json`、行业映射和截图是受版本控制的生成/数据产物；只有相关源或依赖确实变化时才更新。
- 工作区可能已有用户改动。修改前先看 `git status` 和目标 diff，只触碰任务范围；不要重置、覆盖或顺手格式化无关文件。
- 根项目采用 MIT 许可证；两个数据技能快照采用 Apache-2.0。复制代码或资源时保留对应归属和许可证要求。
