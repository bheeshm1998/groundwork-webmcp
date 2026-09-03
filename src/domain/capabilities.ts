import type {
  AnalysisFreshness,
  CanonicalWorkspace,
  DerivedAnalysis,
  OperationState,
} from './schemas';

export type Capability =
  | 'get_workspace'
  | 'search_locations'
  | 'configure_plan'
  | 'add_destination'
  | 'remove_destination'
  | 'add_travel_condition'
  | 'add_place_condition'
  | 'request_user_drawing'
  | 'update_condition'
  | 'delete_condition'
  | 'set_layer_visibility'
  | 'find_matching_areas'
  | 'recalculate'
  | 'analyze_restriction'
  | 'select_area'
  | 'explain_area'
  | 'remove_area'
  | 'undo'
  | 'create_share_link';

export function getCapabilities(
  canonical: CanonicalWorkspace,
  derived: DerivedAnalysis,
  freshness: AnalysisFreshness,
  hasUndo: boolean,
  operation: OperationState = 'idle',
  drawingReady = true,
): Set<Capability> {
  const capabilities = new Set<Capability>([
    'get_workspace',
    'search_locations',
    'create_share_link',
  ]);

  if (operation === 'calculating' || operation === 'drawing') return capabilities;

  if (canonical.destinations.length < 4) capabilities.add('add_destination');
  capabilities.add('configure_plan');
  if (canonical.destinations.length > 0) capabilities.add('remove_destination');
  if (canonical.conditions.length < 20) {
    capabilities.add('add_place_condition');
    if (canonical.destinations.length > 0) capabilities.add('add_travel_condition');
    if (drawingReady) capabilities.add('request_user_drawing');
  }
  if (canonical.conditions.length > 0) {
    capabilities.add('update_condition');
    capabilities.add('delete_condition');
    capabilities.add('set_layer_visibility');
  }
  if (canonical.conditions.length >= 2) capabilities.add('find_matching_areas');
  if (freshness === 'stale') capabilities.add('recalculate');
  if (freshness === 'fresh' && derived.feasibleRegion) {
    capabilities.add('analyze_restriction');
  }
  if (derived.candidates.length > 0) {
    capabilities.add('select_area');
    capabilities.add('explain_area');
    capabilities.add('remove_area');
  }
  if (hasUndo) capabilities.add('undo');
  return capabilities;
}
