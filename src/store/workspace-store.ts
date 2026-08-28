import { create } from 'zustand';
import { DATASET_VERSION, EMPTY_CANONICAL, EMPTY_DERIVED } from '../domain/defaults';
import type {
  ActivityEntry,
  AnalysisFreshness,
  CanonicalWorkspace,
  DerivedAnalysis,
  OperationState,
} from '../domain/schemas';

export interface WorkspaceStore {
  datasetVersion: string;
  canonical: CanonicalWorkspace;
  derived: DerivedAnalysis;
  activity: ActivityEntry[];
  undo: CanonicalWorkspace | null;
  operation: OperationState;
  analysisFreshness: AnalysisFreshness;
  error: string | null;
  initialized: boolean;
  setOperation: (operation: OperationState, error?: string | null) => void;
  commit: (next: Partial<Omit<WorkspaceStore, 'setOperation' | 'commit'>>) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  datasetVersion: DATASET_VERSION,
  canonical: structuredClone(EMPTY_CANONICAL),
  derived: structuredClone(EMPTY_DERIVED),
  activity: [],
  undo: null,
  operation: 'idle',
  analysisFreshness: 'not-combined',
  error: null,
  initialized: false,
  setOperation: (operation, error = null) => set({ operation, error }),
  commit: (next) => set(next),
}));

export function workspaceSnapshot() {
  return useWorkspaceStore.getState();
}
