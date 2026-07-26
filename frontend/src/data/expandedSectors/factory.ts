import { researchSourceById, sourceItems } from "@/data/research";
import type { ContentBlock, Sector, Tag } from "@/data/sectors";
import type { ExpandedSectorSpec, ExpandedTagSpec } from "./types";

const AS_OF = "2026-07-26";

function sourceBlock(ids: string[]): ContentBlock {
  return { type: "sources", items: sourceItems(ids) };
}

function overviewBlocks(spec: ExpandedSectorSpec): ContentBlock[] {
  const groups = Array.from({ length: 4 }, (_, index) => spec.nodes.filter((_, nodeIndex) => nodeIndex % 4 === index));
  return [
    { type: "heading", text: "1. 研究对象与边界" },
    { type: "lead", text: spec.definition },
    {
      type: "callout",
      tone: "warn",
      text: "本页只组织可追溯事实和机械证据成熟度，不构成荐股、评级、涨跌预测或买卖建议。具体公司、客户、订单、产能、良率和收入没有一手材料时保持空白。",
    },
    { type: "heading", text: "2. 产业链主图" },
    {
      type: "supply-chain",
      title: `${spec.label}：从需求到财务兑现`,
      items: groups.map((items, index) => ({
        eyebrow: ["需求/规则", "技术/产品", "验证/制造", "交付/兑现"][index],
        title: items.join("、"),
        text: [
          "先确认真实需求、监管或项目主体，远景规划不计作已发生需求。",
          "路线和产品必须记录适用条件，不能用单项峰值覆盖系统短板。",
          "送样、试验、定点、核准、鉴定、良率和有效产能按阶段分栏。",
          "最后追到实际交付、收入、利润与现金流，不从产业空间反推公司收益。",
        ][index],
        highlight: index === 2,
      })),
      conclusion: `完整证据链：${spec.evidenceChain.join(" → ")}。任何环节缺失都保留为待验证。`,
    },
    {
      type: "table",
      caption: "统一证据成熟度：五个维度分别打分",
      headers: ["维度", "0—1分", "2—3分", "4—5分", "禁止误读"],
      rows: [
        ["真实需求", "概念/远景", "正式规划或需求已出现", "具名客户、项目或付费需求可核验", "政策目标≠订单"],
        ["技术路线", "原理/实验室", "样品或子系统验证", "产品级/工程级稳定验证", "单项指标≠系统成熟"],
        ["客户/监管/项目验证", "无明确对象", "送样、定点、中标或审查中", "认证、许可、验收或关键试验完成", "合作≠验证"],
        ["产能/良率/交付", "规划产能", "中试、小批或爬坡", "有效产能、良率与批量交付可核验", "建成≠达产"],
        ["收入/利润/现金流", "无相关收入", "早期收入或口径未拆", "产品级收入、利润与回款可核验", "市场空间≠公司收入"],
      ],
      note: `结构更新 ${AS_OF}；来源见页面底部。任何单项存在致命短板时强制红档；D/E级来源不能单独支撑绿档。`,
    },
    { type: "heading", text: "3. 产业化证据链" },
    { type: "list", ordered: true, items: spec.evidenceChain },
    { type: "research-assets", title: `${spec.label}专属卡工作台`, sector: spec.key, recordType: spec.recordType },
    { type: "valuation-counterevidence", title: "估值叙事与反证框架", sector: spec.key },
    sourceBlock(spec.sourceIds),
  ];
}

function standardTagBlocks(spec: ExpandedSectorSpec, tag: ExpandedTagSpec): ContentBlock[] {
  const blocks: ContentBlock[] = [
    { type: "heading", text: `1. ${tag.label}：研究范围` },
    { type: "lead", text: tag.description },
    {
      type: "theses",
      items: [
        { title: "核心研究问题", body: tag.focus },
        { title: "必须跟踪的指标", body: tag.metrics },
        { title: "不可跨越的结论边界", body: tag.boundary },
      ],
    },
    {
      type: "table",
      caption: `${tag.label}研究检查表`,
      headers: ["检查层", "要回答的问题", "合格证据", "空缺处理"],
      rows: [
        ["对象", tag.focus, "A/B级原始文件；必要时由供需双方交叉确认", "对象、时间、口径不完整时标记待补"],
        ["指标", tag.metrics, "同一测试/财务口径，附数据期、事件日和最后核验日", "不同层级、场景、人群或阶段不得直接横比"],
        ["边界", tag.boundary, "把计划、样品、验证、交付和收入拆成独立字段", "没有证据不作比例、份额或进度推算"],
      ],
      note: `结构更新 ${AS_OF}；对象级事实和来源在专属卡中维护。`,
    },
    {
      type: "callout",
      tone: "warn",
      text: `阶段边界：${tag.boundary}。页面所有空字段均表示“暂无可靠公开数据”，不是零，也不是系统判断不存在。`,
    },
  ];

  if (tag.key === spec.cardTagKey) {
    if (spec.key === "innovative-drug") {
      blocks.push({
        type: "drug-assets",
        title: "创新药资产卡（复用生物医药主数据）",
        intro: "同一批管线数据不复制；试验设计、人群、剂量、治疗线数和随访边界沿用生物医药资产卡。",
      });
    } else {
      blocks.push({ type: "research-assets", title: `${spec.label}专属数据卡`, sector: spec.key, recordType: spec.recordType });
    }
  }

  if (tag.key === spec.companyTagKey) {
    blocks.push(
      { type: "company-mapping", title: `${spec.label}上市公司映射`, sector: spec.key },
      { type: "valuation-counterevidence", title: "估值叙事、敏感性与反证", sector: spec.key },
    );
  }

  blocks.push(sourceBlock(spec.sourceIds));
  return blocks;
}

function certaintyBlocks(spec: ExpandedSectorSpec, tag: ExpandedTagSpec): ContentBlock[] {
  const blocks: ContentBlock[] = [
    { type: "heading", text: "1. 分档规则：只表示证据成熟度" },
    { type: "lead", text: tag.description },
    {
      type: "table",
      headers: ["档位", "机械规则", "研究动作"],
      rows: [
        ["绿档", spec.certaintyRules.green, "继续核验份额、持续性、利润质量与现金回款；不等于低风险。"],
        ["黄档", spec.certaintyRules.yellow, "明确下一项可验证锚点，不把进展阶段写成最终结果。"],
        ["红档", spec.certaintyRules.red, "保留概念或早期项目记录，但不用于确定性结论。"],
      ],
      note: `结构更新 ${AS_OF}；统一评分：需求、技术、验证、交付、财务各0—5分。存在致命短板强制红档；D/E级来源不能独立支撑绿档。`,
    },
    { type: "unified-certainty", title: `${spec.label}五维确定性地图`, sector: spec.key },
    {
      type: "table",
      caption: "催化剂跟踪类型（正式日期出现后才进入日历）",
      headers: ["类别", "需要记录", "不能提前写成"],
      rows: spec.catalysts.map((item) => [item, "预计日期、精度、观察指标、正负情景、实际结果与来源", "已发生事件或已确认收入"]),
      note: `结构更新 ${AS_OF}；没有正式日期的类型只保留在观察表，不进入事件日历。`,
    },
  ];

  if (spec.key === "innovative-drug") {
    blocks.push({ type: "catalyst-calendar", title: "创新药催化剂日历（复用生物医药主数据）" });
  } else {
    blocks.push({ type: "research-catalysts", title: `${spec.label}催化剂日历`, sector: spec.key });
  }

  blocks.push({
    type: "table",
    caption: "失败与延期复盘类型",
    headers: ["失败类型", "复盘最少字段", "处理原则"],
    rows: spec.failures.map((item) => [item, "原计划、实际结果、原因、产业链/财务影响、是否修复、来源", "无A/B/C级公开案例时不编造案例"]),
    note: `结构更新 ${AS_OF}；案例必须附原始来源和最后核验日。`,
  });

  if (spec.key === "innovative-drug") {
    blocks.push({ type: "failure-library", title: "创新药失败库（复用生物医药主数据）" });
  } else {
    blocks.push({ type: "research-failures", title: `${spec.label}失败与延期复盘库`, sector: spec.key });
  }

  blocks.push(
    { type: "valuation-counterevidence", title: "估值叙事、敏感性与反证", sector: spec.key },
    { type: "cross-sector-graph", title: "跨板块证据关联图" },
    { type: "sector-links", title: "相关一级研究板块", items: spec.related },
    { type: "research-sources", title: `${spec.label}来源索引`, sector: spec.key },
  );
  return blocks;
}

function buildTag(spec: ExpandedSectorSpec, tag: ExpandedTagSpec, index: number): Tag {
  const content = index === 0
    ? overviewBlocks(spec)
    : tag.key === spec.certaintyTagKey
      ? certaintyBlocks(spec, tag)
      : standardTagBlocks(spec, tag);
  return {
    key: tag.key,
    label: tag.label,
    icon: tag.icon,
    description: tag.description,
    verified: true,
    content,
  };
}

export function buildExpandedSector(spec: ExpandedSectorSpec): Sector {
  return {
    key: spec.key,
    label: spec.label,
    tagline: spec.tagline,
    hot: spec.hot,
    verified: true,
    nodes: spec.nodes,
    sources: spec.sourceIds.flatMap((id) => {
      const source = researchSourceById.get(id);
      return source
        ? [{ label: source.originalTitle, organization: source.name, date: source.publishedAt, url: source.url }]
        : [];
    }),
    tags: spec.tags.map((tag, index) => buildTag(spec, tag, index)),
  };
}

export const EXPANDED_RESEARCH_AS_OF = AS_OF;
