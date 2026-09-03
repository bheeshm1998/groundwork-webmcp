import { create } from 'zustand';
import { DATASET_VERSION, EMPTY_CANONICAL, EMPTY_DERIVED } from '../domain/defaults';
import type {
  ActivityEntry,
  AnalysisFreshness,
  CanonicalWorkspace,
  DerivedAnalysis,
  OperationState,
} from '../domain/schemas';
import type { DatasetMetadata } from '../geo-worker/api';
import type { AnalysisProgress } from '../geo-worker/api';
import { DEFAULT_CITY_ID, type CityId } from '../domain/cities';

export interface WorkspaceStore {
  cityId: CityId;
  datasetVersion: string;
  datasetMetadata: DatasetMetadata | null;
  canonical: CanonicalWorkspace;
  derived: DerivedAnalysis;
  activity: ActivityEntry[];
  undo: CanonicalWorkspace | null;
  operation: OperationState;
  analysisFreshness: AnalysisFreshness;
  error: string | null;
  initialized: boolean;
  drawingReady: boolean;
  activeAgentAction: string | null;
  calculationLabel: string | null;
  calculationProgress: AnalysisProgress | null;
  workspaceEpoch: number;
  setOperation: (operation: OperationState, error?: string | null) => void;
  commit: (next: Partial<Omit<WorkspaceStore, 'setOperation' | 'commit'>>) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  cityId: DEFAULT_CITY_ID,
  datasetVersion: DATASET_VERSION,
  datasetMetadata: null,
  canonical: structuredClone(EMPTY_CANONICAL),
  derived: structuredClone(EMPTY_DERIVED),
  activity: [],
  undo: null,
  operation: 'idle',
  analysisFreshness: 'not-combined',
  error: null,
  initialized: false,
  drawingReady: false,
  activeAgentAction: null,
  calculationLabel: null,
  calculationProgress: null,
  workspaceEpoch: 0,
  setOperation: (operation, error = null) =>
    set({ operation, error, calculationLabel: null, calculationProgress: null }),
  commit: (next) => set(next),
}));

export function workspaceSnapshot() {
  return useWorkspaceStore.getState();
}
