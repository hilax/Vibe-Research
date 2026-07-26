import { buildExpandedSector, EXPANDED_RESEARCH_AS_OF } from "./factory";
import { expandedSectorSpecs } from "./configs";

export const expandedResearchSectors = expandedSectorSpecs.map(buildExpandedSector);

export { EXPANDED_RESEARCH_AS_OF };
