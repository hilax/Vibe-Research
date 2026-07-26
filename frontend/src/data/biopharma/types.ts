export type ConfidenceLevel = "高" | "中" | "待验证";
export type CertaintyLevel = "绿" | "黄" | "红";

export interface ResearchSource {
  id: string;
  title: string;
  organization: string;
  date: string;
  accessed: string;
  kind: "监管" | "临床登记" | "论文" | "公司公告" | "行业标准" | "疾病负担";
  url: string;
}

/**
 * 统一药物资产卡。所有阶段、疗效和安全性字段都必须连同 asOf 与 sourceIds 使用；
 * 不同人群、线数、方案、剂量和随访时间不得直接横向比较。
 */
export interface DrugAsset {
  id: string;
  company: string;
  drug: string;
  modality: string;
  mechanism: string;
  indication: string;
  regimen: string;
  overallStage: string;
  chinaStage: string;
  overseasStage: string;
  trialIds: string[];
  design: string;
  enrollment: string;
  population: string;
  treatmentLine: string;
  biomarker?: string;
  comparator: string;
  primaryEndpoints: string;
  secondaryEndpoints: string;
  efficacy: string;
  safety: string;
  dataMaturity?: string;
  followUp?: string;
  dataCutoff: string;
  nextCatalyst: string;
  designations: string;
  filingStatus?: string;
  approvalStatus?: string;
  commercializationStatus?: string;
  salesRevenue?: string;
  insuranceStatus?: string;
  partner: string;
  bd: {
    upfront: string;
    nearTerm: string;
    developmentMilestones: string;
    salesMilestones: string;
    headlineCeiling: string;
    royalties: string;
    territory: string;
  };
  chinaRights: string;
  exChinaRights: string;
  sourceIds: string[];
  confidence: ConfidenceLevel;
  certainty: CertaintyLevel;
  certaintyReason: string;
  asOf: string;
  comparisonBoundary: string;
}

export interface CatalystEvent {
  company: string;
  drug: string;
  target: string;
  indication: string;
  stage: string;
  eventType: string;
  expected: string;
  venue: string;
  consensus: string;
  watch: string;
  positive: string;
  negative: string;
  actual: string;
  sourceIds: string[];
  asOf: string;
}

export interface FailureCase {
  company: string;
  asset: string;
  indication: string;
  phase: string;
  design: string;
  outcome: string;
  primaryCause: string;
  lesson: string;
  sourceIds: string[];
  asOf: string;
}
