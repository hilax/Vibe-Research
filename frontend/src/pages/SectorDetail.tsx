import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Plus, Wrench } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { AskAiButton } from "@/components/ui/AskAiButton";
import { CoreNodeExplorer } from "@/components/sector/CoreNodeExplorer";
import { SectorSources } from "@/components/sector/SectorSources";
import { TagGrid } from "@/components/sector/TagGrid";
import { sectorsData } from "@/data/sectors";

export function SectorDetail() {
  const { key } = useParams();
  const sector = sectorsData.sectors.find((s) => s.key === key);

  if (!sector) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        未找到该板块。<Link to="/sectors" className="text-primary">返回板块中心</Link>
      </div>
    );
  }

  const aiContextParts = [
    `板块：${sector.label}`,
    `定位：${sector.tagline}`,
    `产业链环节：` + (sector.nodes.length ? sector.nodes.join("、") : "（环节梳理中）"),
  ];
  if (sector.tags?.length) {
    aiContextParts.push(
      "板块栏目：" + sector.tags
        .map((t) => `\n  - ${t.key}（${t.label}）：${t.description}${t.verified ? "" : "（待补）"}`)
        .join(""),
    );
  }
  const aiContext = aiContextParts.join("\n");
  const suggestions = sector.key === "ai-pharma"
    ? ["按人体证据重排研究优先级", "当前最重要的临床催化剂", "哪些技术路线仍未验证", "全球硬卡口与国产替代分开看"]
    : ["按七维框架拆解", "这个板块的产业链地图", "哪个环节卡脖子", "有什么风险信号"];

  return (
    <div>
      <Link to="/sectors" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> 板块中心
      </Link>

      <PageHeader
        title={sector.label}
        subtitle={sector.tagline}
        actions={
          <AskAiButton
            context={aiContext}
            label="让 AI 拆这个板块"
            suggestions={suggestions}
          />
        }
      />

      {sector.verified ? (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
            核心环节（{sector.nodes.length}）{sector.nodeDetails ? " · 点击查看解释" : ""}
          </h3>
          <CoreNodeExplorer
            key={sector.key}
            sectorKey={sector.key}
            nodes={sector.nodes}
            details={sector.nodeDetails}
          />
          {sector.sources?.length ? <SectorSources sources={sector.sources} /> : null}
          <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Plus className="h-3.5 w-3.5" /> 想在某个环节挂上自己关注的标的？数据存在你本地，不会上传、不进仓库。
          </p>
        </div>
      ) : (
        <GlassCard>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Wrench className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              该板块的环节骨架尚在<b className="text-foreground">实时核实</b>补全中（不靠模型记忆）——已核实的板块见左侧。
            </p>
            <p className="max-w-md text-xs text-muted-foreground/70">
              也可以点右上角「让 AI 拆这个板块」，用你自己的 AI 按七维框架当场梳理它的产业链。
            </p>
          </div>
        </GlassCard>
      )}

      {sector.tags?.length ? (
        <section className="mt-8">
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
            板块栏目（{sector.tags.length}）
          </h3>
          <TagGrid sector={sector} />
        </section>
      ) : null}
    </div>
  );
}
