import type { ResearchRecord, ResearchSectorKey } from "@/data/research";

export interface ExpandedTagSpec {
  key: string;
  label: string;
  icon: string;
  description: string;
  focus: string;
  metrics: string;
  boundary: string;
}

export interface ExpandedSectorSpec {
  key: Extract<
    ResearchSectorKey,
    | "semiconductor"
    | "solid-state-battery"
    | "low-altitude"
    | "smart-driving"
    | "innovative-drug"
    | "power-grid"
    | "defense"
    | "fusion"
  >;
  label: string;
  tagline: string;
  hot: boolean;
  definition: string;
  nodes: string[];
  tags: ExpandedTagSpec[];
  sourceIds: string[];
  cardTagKey: string;
  companyTagKey: string;
  certaintyTagKey: string;
  recordType: ResearchRecord["recordType"];
  evidenceChain: string[];
  certaintyRules: {
    green: string;
    yellow: string;
    red: string;
  };
  catalysts: string[];
  failures: string[];
  related: {
    label: string;
    to: string;
    description: string;
  }[];
}
