import type { AnalysisFreshness, CanonicalWorkspace, DerivedAnalysis } from './schemas';

export type Capability =
  | 'get-workspace'
  | 'search-locations'
  | 'set-office'
  | 'add-bike'
  | 'add-access'
  | 'start-draw'
  | 'update-condition'
  | 'delete-condition'
  | 'set-visibility'
  | 'combine'
  | 'recalculate'
  | 'rank'
  | 'analyze-restriction'
  | 'select-candidate'
  | 'explain-candidate'
  | 'remove-candidate'
  | 'undo'
  | 'create-share-link';

export function getCapabilities(
  canonical: CanonicalWorkspace,
  derived: DerivedAnalysis,
  freshness: AnalysisFreshness,
  hasUndo: boolean,
): Set<Capability> {
  const capabilities = new Set<Capability>([
    'get-workspace',
    'search-locations',
    'set-office',
    'add-access',
    'start-draw',
    'create-share-link',
  ]);

  if (canonical.office) capabilities.add('add-bike');
  if (canonical.conditions.length > 0) {
    capabilities.add('update-condition');
    capabilities.add('delete-condition');
    capabilities.add('set-visibility');
  }
  if (canonical.conditions.length >= 2) capabilities.add('combine');
  if (freshness === 'stale') capabilities.add('recalculate');
  if (freshness === 'fresh' && derived.feasibleRegion) {
    capabilities.add('rank');
    capabilities.add('analyze-restriction');
  }
  if (derived.candidates.length > 0) {
    capabilities.add('select-candidate');
    capabilities.add('explain-candidate');
    capabilities.add('remove-candidate');
  }
  if (hasUndo) capabilities.add('undo');
  return capabilities;
}
