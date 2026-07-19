export type ResearchSectorKey = "ai-computing" | "hbm" | "cpo" | "business-space";
export type EvidenceGrade = "A" | "B" | "C" | "D" | "E";
export type CertaintyLevel = "green" | "yellow" | "red";
export type VerificationState = "cross-verified" | "single-source" | "pending";
export type EvidenceDimension = "technology" | "customer" | "capacity" | "financial";

export interface ResearchSource {
  id: string;
  name: string;
  sourceType: "regulator" | "standard" | "filing" | "official-product" | "earnings" | "government" | "paper" | "industry-media" | "research";
  originalTitle: string;
  publishedAt: string;
  eventAt: string | null;
  period: string | null;
  accessedAt: string;
  url: string;
  sectors: ResearchSectorKey[];
  companies: string[];
  grade: EvidenceGrade;
  verification: VerificationState;
  note: string;
}

export interface EvidenceStatus {
  dimension: EvidenceDimension;
  stage: string;
  summary: string;
  sourceIds: string[];
  fatalShortfall?: string;
}

export interface ResearchRecord {
  id: string;
  sector: ResearchSectorKey;
  recordType: "ai-asset" | "hbm-product" | "optical-product" | "space-project" | "company" | "bottleneck";
  title: string;
  subtitle: string;
  company: string;
  stage: string;
  certainty: CertaintyLevel;
  evidenceGrade: EvidenceGrade;
  updatedAt: string;
  tags: string[];
  fields: Record<string, string | null>;
  sourceIds: string[];
  evidence: EvidenceStatus[];
  relatedIds: string[];
  pending: string[];
}

export interface AiComputeAsset {
  id: string;
  company: string;
  product: string;
  productType: string | null;
  workload: string | null;
  architecture: string | null;
  process: string | null;
  package: string | null;
  chipCount: string | null;
  hbm: string | null;
  chipInterconnect: string | null;
  nodeInterconnect: string | null;
  networkProtocol: string | null;
  power: string | null;
  cooling: string | null;
  formFactor: string | null;
  software: string | null;
  customers: string | null;
  announcedAt: string | null;
  massProductionAt: string | null;
  delivery: string | null;
  bottleneck: string | null;
  competitors: string | null;
  sourceIds: string[];
  updatedAt: string;
  certainty: CertaintyLevel;
}

export interface HbmProduct {
  id: string;
  company: string;
  generation: string;
  capacity: string | null;
  layers: string | null;
  ioWidth: string | null;
  pinRate: string | null;
  bandwidth: string | null;
  dramProcess: string | null;
  baseDie: string | null;
  baseDieFab: string | null;
  tsvBonding: string | null;
  package: string | null;
  cooling: string | null;
  customers: string | null;
  qualification: string | null;
  sampledAt: string | null;
  massProductionAt: string | null;
  plannedCapacity: string | null;
  actualOutput: string | null;
  disclosedYield: string | null;
  pricing: string | null;
  equipment: string | null;
  materials: string | null;
  bottleneck: string | null;
  sourceIds: string[];
  updatedAt: string;
  certainty: CertaintyLevel;
}

export interface OpticalProduct {
  id: string;
  company: string;
  product: string;
  rate: string | null;
  application: string | null;
  networkLayer: string | null;
  distance: string | null;
  opticalInterface: string | null;
  electricalInterface: string | null;
  laneRate: string | null;
  lanes: string | null;
  modulation: string | null;
  lightSource: string | null;
  opticalRoute: string | null;
  dsp: string | null;
  form: string | null;
  power: string | null;
  cooling: string | null;
  customers: string | null;
  qualification: string | null;
  sampledAt: string | null;
  massProductionAt: string | null;
  shipment: string | null;
  pricing: string | null;
  grossMargin: string | null;
  yield: string | null;
  bom: string | null;
  suppliers: string | null;
  sourceIds: string[];
  updatedAt: string;
  certainty: CertaintyLevel;
}

export interface SpaceProject {
  id: string;
  company: string;
  project: string;
  projectType: string | null;
  rocket: string | null;
  engine: string | null;
  propulsion: string | null;
  reuse: string | null;
  payload: string | null;
  orbit: string | null;
  launchSite: string | null;
  firstFlight: string | null;
  launches: string | null;
  successes: string | null;
  latestMission: string | null;
  nextMission: string | null;
  customers: string | null;
  contractValue: string | null;
  commercialOrder: string | null;
  governmentProject: string | null;
  satelliteBus: string | null;
  payloadSystem: string | null;
  plannedConstellation: string | null;
  authorized: string | null;
  manufactured: string | null;
  launched: string | null;
  inserted: string | null;
  operational: string | null;
  payingUsers: string | null;
  revenueModel: string | null;
  revenue: string | null;
  cashBurn: string | null;
  funding: string | null;
  regulatory: string | null;
  sourceIds: string[];
  updatedAt: string;
  certainty: CertaintyLevel;
}

export interface ListedCompanyMapping {
  id: string;
  company: string;
  ticker: string;
  market: string;
  sectors: ResearchSectorKey[];
  chainPosition: string;
  products: string;
  customers: string | null;
  headCustomerSupplyChain: string | null;
  qualification: string | null;
  relatedRevenue: string | null;
  relatedRevenueShare: string | null;
  relatedGrossMargin: string | null;
  orders: string | null;
  capacity: string | null;
  utilization: string | null;
  expansion: string | null;
  capex: string | null;
  inventory: string | null;
  receivables: string | null;
  contractLiabilities: string | null;
  operatingCashFlow: string | null;
  rdExpense: string | null;
  customerConcentration: string | null;
  overseasRevenueShare: string | null;
  advantage: string;
  risk: string;
  valuation: string | null;
  dataDate: string;
  sourceIds: string[];
}

export interface CatalystEvent {
  id: string;
  sector: ResearchSectorKey;
  company: string;
  product: string;
  eventType: string;
  expectedAt: string;
  datePrecision: "day" | "month" | "quarter" | "half-year" | "year" | "unknown";
  consensus: string;
  metric: string;
  positive: string;
  negative: string;
  actual: string | null;
  impact: string | null;
  sourceIds: string[];
  updatedAt: string;
}

export interface FailureCase {
  id: string;
  sector: ResearchSectorKey;
  occurredAt: string;
  project: string;
  plan: string;
  outcome: string;
  cause: string;
  chainImpact: string;
  companyImpact: string;
  repaired: string;
  lesson: string;
  sourceIds: string[];
  updatedAt: string;
}

export interface CrossSectorLink {
  id: string;
  fromId: string;
  toId: string;
  relation: "contains" | "uses" | "connects" | "supplies" | "constrains" | "operates";
  evidence: string;
  sourceIds: string[];
}
