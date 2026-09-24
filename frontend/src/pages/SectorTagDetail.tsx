import { Link, useParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { AskAiButton } from "@/components/ui/AskAiButton";
import { sectorTagIcons, sectorTagFallbackIcon } from "@/components/sector/iconMap";
import { TagContentView } from "@/components/sector/TagContentView";
import { BIOPHARMA_AS_OF } from "@/data/biopharma";
import { RESEARCH_AS_OF } from "@/data/research";
import { sectorsData } from "@/data/sectors";

const RESEARCH_SECTOR_KEYS = new Set(["ai-computing", "hbm", "cpo", "business-space"]);

// 针对性建议放在页面顶部就近维护，避免通用 AI 入口失去板块上下文。
const SUGGESTIONS_BY_TAG: Record<string, string[]> = {
  overview: [
    "用一张表对比全球主要人形机器人本体厂商进度",
    "按时间线列出 2024–2026 的关键量产节点",
    "整板块的供需格局短期怎么演化",
    "总览层面容易踩哪些概念误区",
  ],
  "joints-actuators": [
    "谐波减速器、行星滚柱丝杠、无框力矩电机的卡口点排序",
    "扭矩密度对比：国内 vs 海外主流方案",
    "关节模组的成本拆解：哪些材料在卡脖子",
    "关节良率提升最大瓶颈在工艺还是设计",
  ],
  "value-bottleneck": [
    "单台人形机器人 BOM 各环节价值占比排个序",
    "最可能卡脖子的 3 个零部件或材料是什么",
    "国产化率最可能快速提升的环节",
    "哪些环节存在显著的'价高量小'窗口",
  ],
  "dexterous-hand": [
    "灵巧手主流自由度方案对比（5/10/15/22 DOF 等）",
    "灵巧手价值量在整机中占多大",
    "触觉传感器在灵巧手中的技术路线",
    "灵巧手供应商格局与潜在替代者",
  ],
  "oem-vendors": [
    "主要本体厂的量产时间表、客户、关键供应链",
    "哪些本体厂更可能率先跑通商业化",
    "硬件代工与软件算法的分工模式",
    "产业链上下游谁最受益于本体厂放量",
  ],
  "certainty-map": [
    "按确定性强弱给环节排个序（先看落地确定性）",
    "哪些环节短期就看得到催化（事件驱动）",
    "哪些环节要等 1–2 年才有可见数据（赔率型）",
    "把 6 个栏目按'先看哪几个'排个研究优先级",
  ],
};

const BIOPHARMA_SUGGESTIONS: Record<string, string[]> = {
  overview: ["把行业变化拆成审批、临床、BD和销售证据", "解释患者数为什么不等于市场", "按证据等级给主要技术路线定位", "未来一年哪些数据最应更新"],
  "innovative-drug": ["用五层框架拆一款具体创新药", "PD-(L)1×VEGF同机制竞争怎么看", "哪些技术路线已验证、半验证、未验证", "如何识别伪Best-in-Class"],
  "ai-drug": ["AI在Rentosertib中实际贡献了什么", "把AI制药公司按证据阶梯分类", "合作上限和真实收入怎么拆", "哪些AI价值尚未被人体数据验证"],
  "frontier-biotech": ["比较ADC、细胞、基因、RNA和核药卡口", "哪些平台已有获批产品但仍难复制", "从毒性追溯到结构和制造环节", "哪些递送路线仍未收敛"],
  "disease-tracks": ["按未满足需求比较九个疾病赛道", "不同疾病为什么不能共用肿瘤终点", "把患者总数拆成可治疗和可支付人群", "哪些赛道最拥挤"],
  "clinical-pipeline": ["按检查清单审阅一张药物资产卡", "未来12个月催化剂逐项列风险", "复盘失败案例的共同原因", "解释PFS、OS、ORR和DoR边界"],
  "supply-chain": ["用四关筛子过滤铲子环节", "全球硬卡口和国产替代分别列出", "层析、过滤、培养基谁的验证壁垒更硬", "核药供应链为何受半衰期约束"],
  "global-companies": ["按原创、临床、CMC和商业化比较中外公司", "中国在哪些环节局部领先", "识别依赖单一产品的护城河", "哪些公司有全球商业化验证"],
  "certainty-map": ["把重点资产按四维短板重排", "绿黄红档各自应该跟踪什么", "哪些红档不能借用同机制数据", "生成免费公开信号跟踪表"],
};

// tag 与 nodes 的轻映射；未命中则使用全部节点。
const NODE_HINT: Record<string, string[]> = {
  "joints-actuators": ["谐波减速器", "行星滚柱丝杠", "无框力矩电机"],
  "value-bottleneck": ["谐波减速器", "行星滚柱丝杠", "六维力传感器"],
  "dexterous-hand": ["灵巧手", "六维力传感器", "具身大模型"],
};

function relevantNodesHint(sectorKey: string, tagKey: string, allNodes: string[]): string {
  const hinted = sectorKey === "humanoid" ? NODE_HINT[tagKey] : undefined;
  if (hinted?.length) return hinted.join("、");
  return `（全部节点：${allNodes.join("、")}）`;
}

export function SectorTagDetail() {
  const { key, tag: tagKey } = useParams();
  const sector = sectorsData.sectors.find((s) => s.key === key);
  const tag = sector?.tags?.find((t) => t.key === tagKey);

  if (!sector) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        未找到该板块。<Link to="/sectors" className="text-primary">返回板块中心</Link>
      </div>
    );
  }
  if (!tag) {
    return (
      <div>
        <Link to={`/sectors/${sector.key}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          ← {sector.label}
        </Link>
        <div className="py-20 text-center text-muted-foreground">
          未找到该栏目。<Link to={`/sectors/${sector.key}`} className="text-primary">返回 {sector.label}</Link>
        </div>
      </div>
    );
  }

  const TagIcon = sectorTagIcons[tag.icon] ?? sectorTagFallbackIcon;
  const suggestions = sector.key === "ai-pharma"
    ? BIOPHARMA_SUGGESTIONS[tag.key] ?? []
    : RESEARCH_SECTOR_KEYS.has(sector.key)
      ? [
          `用真实需求到财务兑现的证据链复核「${tag.label}」`,
          `列出「${tag.label}」当前已验证和待验证的数据`,
          `把「${tag.label}」的技术、客户、产能和财务证据分开`,
          `未来12个月「${tag.label}」最应跟踪哪些催化剂和风险`,
        ]
      : sector.key === "humanoid"
        ? SUGGESTIONS_BY_TAG[tag.key] ?? []
        : [
            `「${tag.label}」包含哪些产业环节，各自解决什么问题`,
            `用公开来源核对「${tag.label}」目前可验证的进展`,
            `「${tag.label}」应跟踪哪些具体指标和验证节点`,
            `「${tag.label}」还有哪些技术或落地边界`,
          ];

  const aiContextParts = [
    `板块：${sector.label}`,
    `定位：${sector.tagline}`,
    `栏目：${tag.label}（key=${tag.key}）`,
    `栏目定位：${tag.description}`,
    `全板块的产业链环节：` + (sector.nodes.length ? sector.nodes.join("、") : "（环节梳理中）"),
    `相关节点提示：` + relevantNodesHint(sector.key, tag.key, sector.nodes),
  ];
  if (sector.sources?.length) {
    aiContextParts.push("公开资料来源：" + sector.sources.map((source) => `${source.label} ${source.url}`).join("；"));
  }
  if (!tag.verified) {
    aiContextParts.push(
      `⚠ 内容状态：${tag.label} 栏目骨架尚未核实，请按"先列提纲 + 缺数据节点反问"的方式回答；不要伪造研报/标的/比例数字。`,
    );
  }
  const aiContext = aiContextParts.join("\n");

  return (
    <div>
      {/* breadcrumb: 板块中心 / 当前板块 / 当前栏目 */}
      <div className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/sectors" className="hover:text-foreground">板块中心</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link to={`/sectors/${sector.key}`} className="hover:text-foreground">{sector.label}</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground">{tag.label}</span>
      </div>

      <PageHeader
        title={tag.label}
        subtitle={tag.description}
        actions={
          <AskAiButton
            context={aiContext}
            label="让 AI 拆这个栏目"
            suggestions={suggestions}
          />
        }
      />

      <nav aria-label={`${sector.label}栏目切换`} className="mb-6 overflow-x-auto pb-1">
        <div className="flex min-w-max gap-2">
          {sector.tags?.map((item) => {
            const active = item.key === tag.key;
            return (
              <Link
                key={item.key}
                to={`/sectors/${sector.key}/${item.key}`}
                aria-current={active ? "page" : undefined}
                className={
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors " +
                  (active
                    ? "border-primary/45 bg-primary/15 text-primary shadow-glow"
                    : "border-border/60 bg-muted/20 text-muted-foreground hover:border-primary/30 hover:text-foreground")
                }
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {sector.key === "ai-pharma" ? (
        <p className="mb-5 rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          研究底稿与表格统一截至 {BIOPHARMA_AS_OF}；临床阶段按具体适应症记录，来源见各页底部，无法从可靠公开资料确认的字段保留为空或标记“待验证”。
        </p>
      ) : RESEARCH_SECTOR_KEYS.has(sector.key) ? (
        <p className="mb-5 rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          研究底稿与结构化卡片统一截至 {RESEARCH_AS_OF}；事实、公司口径、机构预测和系统情景分开展示，送样不等于认证，扩产不等于收入，缺少可靠公开数据的字段保持空白或标记“待验证”。
        </p>
      ) : null}

      {tag.verified && tag.content?.length ? (
        <TagContentView blocks={tag.content} />
      ) : tag.verified ? (
        <GlassCard>
          <div className="py-8 text-center text-sm text-muted-foreground">
            栏目内容已核实——暂未填充。
          </div>
        </GlassCard>
      ) : (
        <GlassCard>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <TagIcon className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              该栏目内容尚在<b className="text-foreground">实时核实</b>补全中（不靠模型记忆）——已核实的栏目见板块详情。
            </p>
            <p className="max-w-md text-xs text-muted-foreground/70">
              也可以点右上角「让 AI 拆这个栏目」，用你自己的 AI 当场梳理这一栏的要点。
            </p>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
