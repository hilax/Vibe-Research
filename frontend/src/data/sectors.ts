import raw from "./sectors.json";
import { aiComputingSector } from "./aiComputing";
import { biopharmaSector } from "./biopharma";
import { businessSpaceSector } from "./businessSpace";
import { digitalNodeDetails, digitalSectors } from "./sectorExpansionDigital";
import { industryNodeDetails, industrySectors } from "./sectorExpansionIndustry";
import { techNodeDetails, techSectors } from "./sectorExpansionTech";
import { hbmSector } from "./hbm";
import { opticalSector } from "./optical";
import { sectorNodeDetails, type CoreNodeDetail } from "./sectorNodeDetails";
import { researchedSectorNodeDetails } from "./sectorNodeDetailsResearched";

export type { CoreNodeDetail } from "./sectorNodeDetails";

// 内容块的结构化定义。每个 block 是独立类型，渲染器按 type 分支。
// 文字、引用、来源底注都来自结构化字段，杜绝"凭模型记忆"——任何具体数字必须可溯源。
export type ContentBlock =
  | { type: "heading"; level?: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "lead"; text: string } // 首屏大字定义段
  | { type: "theses"; items: { title: string; body: string }[] } // 几条并列论点
  | { type: "list"; ordered?: boolean; items: string[] }
  | { type: "kv"; items: { term: string; value: string; note?: string }[] } // 表格化术语
  | { type: "table"; caption?: string; headers: string[]; rows: string[][]; note?: string }
  | {
      type: "value-bars";
      basis: string;
      items: {
        label: string;
        share: number;
        range: string;
        amount: string;
        components: string;
        usage: string;
        largest?: boolean;
      }[];
      note?: string;
    }
  | {
      type: "bottleneck-map";
      items: {
        link: string;
        value: string;
        upstream: string;
        chokeType: "材料" | "设备" | "工艺/检测" | "芯片/器件" | "非稀缺";
        choke: string;
        bypass: string;
      }[];
      note?: string;
    }
  | {
      type: "supply-chain";
      title: string;
      items: { eyebrow: string; title: string; text: string; highlight?: boolean }[];
      conclusion: string;
    }
  | {
      type: "three-gates";
      gates: { number: string; title: string; question: string; evidence: string }[];
      candidates: {
        label: string;
        volume: "pass" | "conditional" | "fail";
        necessity: "pass" | "conditional" | "fail";
        moat: "pass" | "conditional" | "fail";
        result: string;
      }[];
      note?: string;
    }
  | {
      type: "production-anchor";
      eyebrow: string;
      title: string;
      asOf: string;
      metrics: {
        label: string;
        value: string;
        detail: string;
        tone?: "positive" | "caution" | "neutral";
      }[];
      jointGroups: {
        kind: "rotary" | "linear";
        label: string;
        total: string;
        positions: string;
      }[];
      steps: {
        label: string;
        text: string;
        state: "confirmed" | "boundary";
      }[];
      reference: string;
      conclusion: string;
    }
  | {
      type: "certainty-map";
      asOf: string;
      rule: string;
      levels: {
        level: "formed" | "converging" | "open";
        title: string;
        definition: string;
        action: string;
        items: {
          title: string;
          route: string;
          evidence: string;
          watch: string;
        }[];
      }[];
      note?: string;
    }
  | {
      type: "tracking-signals";
      signals: {
        number: string;
        title: string;
        question: string;
        evidence: string;
        freeSources: string;
      }[];
      rules: {
        level: "formed" | "converging" | "open";
        title: string;
        text: string;
      }[];
      note?: string;
    }
  | {
      type: "vendor-landscape";
      asOf: string;
      scope: string;
      groups: {
        region: string;
        lens: string;
        accent: "overseas" | "china";
        vendors: {
          name: string;
          product: string;
          country: string;
          positioning: string;
          stage: "scaled-operation" | "batch-delivery" | "ramping" | "pilot" | "production-prep" | "preorder";
          status: string;
          evidence: string;
        }[];
      }[];
      note?: string;
    }
  | {
      type: "capability-tiers";
      asOf: string;
      rule: string;
      items: {
        link: string;
        tier: "leading" | "catching" | "gap";
        verdict: string;
        evidence: string;
        boundary: string;
      }[];
      note?: string;
    }
  | {
      type: "hardness-moat";
      rule: string;
      universal: { title: string; body: string }[];
      substitution: { title: string; body: string }[];
      layers: {
        number: string;
        title: string;
        barrier: string;
        body: string;
        highlight?: boolean;
      }[];
      conclusion: string;
    }
  | { type: "drug-assets"; title: string; intro?: string; assetIds?: string[] }
  | { type: "catalyst-calendar"; title: string }
  | { type: "failure-library"; title: string }
  | { type: "research-assets"; title: string; sector?: import("./research").ResearchSectorKey; recordType?: import("./research").ResearchRecord["recordType"] }
  | { type: "company-mapping"; title: string; sector?: import("./research").ResearchSectorKey }
  | { type: "unified-certainty"; title: string; sector?: import("./research").ResearchSectorKey }
  | { type: "research-catalysts"; title: string; sector?: import("./research").ResearchSectorKey }
  | { type: "research-failures"; title: string; sector?: import("./research").ResearchSectorKey }
  | { type: "cross-sector-graph"; title: string }
  | { type: "research-sources"; title: string; sector?: import("./research").ResearchSectorKey }
  | { type: "sector-links"; title: string; items: { label: string; to: string; description: string }[] }
  | { type: "quote"; text: string; cite?: string }
  | { type: "callout"; tone?: "info" | "warn"; text: string }
  | { type: "sources"; items: { label: string; date?: string; url?: string }[] };

export interface Tag {
  key: string;
  label: string;
  icon: string;
  description: string;
  verified?: boolean;
  content?: ContentBlock[]; // 当 verified=true 且 content 非空，渲染长内容；否则显示占位
}

export interface Sector {
  key: string;
  label: string;
  tagline: string;
  hot: boolean;
  verified: boolean;
  nodes: string[];
  nodeDetails?: Record<string, CoreNodeDetail>;
  sources?: { label: string; url: string; date?: string }[];
  tags?: Tag[];
}

export interface SectorsFile {
  _comment?: string;
  indices: { aShare: string[]; us: string[] };
  sectors: Sector[];
}

const rawData = raw as SectorsFile;

// 大型研究板块使用独立、可持续更新的数据集；保留 sectors.json 中的板块顺序，
// 仅在运行时替换通用索引中的对应条目，避免把研究底稿塞回导航索引。
const researchSectors = new Map<string, Sector>(
  [aiComputingSector, hbmSector, opticalSector, businessSpaceSector, biopharmaSector, ...digitalSectors, ...techSectors, ...industrySectors]
    .map((sector): [string, Sector] => [sector.key, sector]),
);

const allNodeDetails: Record<string, Record<string, CoreNodeDetail>> = {
  ...sectorNodeDetails,
  ...researchedSectorNodeDetails,
  ...digitalNodeDetails,
  ...techNodeDetails,
  ...industryNodeDetails,
};

export const sectorsData: SectorsFile = {
  ...rawData,
  sectors: rawData.sectors.map((sector) => {
    const resolvedSector = researchSectors.get(sector.key) ?? sector;
    const nodeDetails = allNodeDetails[resolvedSector.key];
    return nodeDetails ? { ...resolvedSector, nodeDetails } : resolvedSector;
  }),
};
