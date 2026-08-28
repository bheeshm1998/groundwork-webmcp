import { DATASET_VERSION, EMPTY_CANONICAL, EMPTY_DERIVED } from './defaults';
import {
  CanonicalWorkspaceSchema,
  type ActivityEntry,
  type CanonicalWorkspace,
  type CommandResult,
  type Coordinate,
  type LocationResult,
  type WorkspaceCommand,
  type WorkspaceQuery,
} from './schemas';
import { getGeoWorker } from '../geo-worker/client';
import {
  clearLocalWorkspace,
  createShareUrl,
  readLocalWorkspace,
  readSharedWorkspace,
  saveLocalWorkspace,
} from '../sharing/share';
import { useWorkspaceStore, workspaceSnapshot } from '../store/workspace-store';

function id(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

function activity(message: string, actor: ActivityEntry['actor'] = 'user'): ActivityEntry {
  return { id: id('activity'), actor, message, timestamp: Date.now() };
}

function withActivity(entries: ActivityEntry[], entry: ActivityEntry): ActivityEntry[] {
  return [...entries, entry].slice(-40);
}

function commandMessage(command: WorkspaceCommand): string {
  switch (command.type) {
    case 'set-office':
      return `Set the office to ${command.office.label}.`;
    case 'add-bike':
      return `Created a ${command.maxMinutes}-minute bicycle area.`;
    case 'add-access':
      return `Added ${command.maxMinutes}-minute ${command.category} access.`;
    case 'add-preference':
      return 'Added the area you would personally consider.';
    case 'update-condition':
      return `Changed a condition to ${command.maxMinutes} minutes.`;
    case 'delete-condition':
      return 'Deleted a condition.';
    case 'set-visibility':
      return `${command.visible ? 'Showed' : 'Hid'} a condition layer.`;
    case 'combine':
      return 'Combined the active conditions.';
    case 'recalculate':
      return 'Recalculated the analysis from the current workspace.';
    case 'rank':
      return 'Ranked the three strongest candidate areas.';
    case 'select-candidate':
      return command.id ? 'Selected a candidate area.' : 'Cleared the candidate selection.';
    case 'remove-candidate':
      return 'Removed a candidate from consideration.';
    case 'undo':
      return 'Undid the most recent workspace change.';
    case 'reset':
      return 'Reset the workspace.';
    case 'set-view':
      return '';
  }
}

function cloneCanonical(canonical: CanonicalWorkspace): CanonicalWorkspace {
  return structuredClone(canonical);
}

function persist() {
  const state = workspaceSnapshot();
  saveLocalWorkspace({
    schemaVersion: 1,
    datasetVersion: state.datasetVersion,
    canonical: state.canonical,
    activity: state.activity,
    undo: state.undo,
  });
}

export class WorkspaceService {
  private presets: LocationResult[] = [];

  async initialize(): Promise<CommandResult> {
    const store = useWorkspaceStore.getState();
    store.setOperation('calculating');
    try {
      const initialized = await getGeoWorker().initialize();
      this.presets = initialized.presets;
      let restored = null;
      try {
        restored = readSharedWorkspace() ?? readLocalWorkspace();
      } catch (error) {
        store.commit({
          error:
            error instanceof Error ? error.message : 'The saved workspace could not be opened.',
        });
      }
      const canonical = restored?.canonical ?? cloneCanonical(EMPTY_CANONICAL);
      const derived = canonical.conditions.length
        ? await getGeoWorker().analyze(canonical)
        : structuredClone(EMPTY_DERIVED);
      store.commit({
        datasetVersion: initialized.metadata.datasetVersion,
        canonical,
        derived,
        activity: restored?.activity ?? [],
        undo: restored?.undo ?? null,
        operation: 'idle',
        analysisFreshness: canonical.combined ? 'fresh' : 'not-combined',
        initialized: true,
      });
      return { ok: true, message: 'Groundwork is ready.' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Groundwork could not initialize.';
      store.setOperation('error', message);
      return { ok: false, message };
    }
  }

  async execute(command: WorkspaceCommand): Promise<CommandResult> {
    const state = workspaceSnapshot();
    if (state.operation === 'calculating')
      return { ok: false, message: 'Another calculation is still running.' };
    if (command.type === 'set-view') {
      state.commit({ canonical: { ...state.canonical, view: command.view } });
      persist();
      return { ok: true, message: 'Map view updated.' };
    }
    if (command.type === 'undo') {
      if (!state.undo) return { ok: false, message: 'There is no recent change to undo.' };
      state.setOperation('calculating');
      try {
        const restored = CanonicalWorkspaceSchema.parse(state.undo);
        const derived = restored.conditions.length
          ? await getGeoWorker().analyze(restored)
          : structuredClone(EMPTY_DERIVED);
        state.commit({
          canonical: restored,
          derived,
          undo: null,
          activity: withActivity(state.activity, activity(commandMessage(command), command.actor)),
          operation: 'idle',
          analysisFreshness: restored.combined ? 'fresh' : 'not-combined',
        });
        persist();
        return { ok: true, message: 'The last change was undone.' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Undo failed.';
        state.setOperation('error', message);
        return { ok: false, message };
      }
    }
    if (command.type === 'reset') {
      clearLocalWorkspace();
      state.commit({
        canonical: cloneCanonical(EMPTY_CANONICAL),
        derived: structuredClone(EMPTY_DERIVED),
        activity: [activity(commandMessage(command), command.actor)],
        undo: null,
        operation: 'idle',
        analysisFreshness: 'not-combined',
        error: null,
      });
      if (window.location.hash)
        history.replaceState(null, '', window.location.pathname + window.location.search);
      return { ok: true, message: 'Workspace reset.' };
    }

    state.setOperation('calculating');
    const before = cloneCanonical(state.canonical);
    let canonical = cloneCanonical(state.canonical);
    let needsAnalysis = true;
    let freshness = state.analysisFreshness;

    try {
      switch (command.type) {
        case 'set-office':
          canonical.office = command.office;
          if (canonical.combined && canonical.conditions.some(({ kind }) => kind === 'bike')) {
            freshness = 'stale';
            needsAnalysis = false;
          }
          break;
        case 'add-bike':
          if (!canonical.office)
            throw new Error('Set an office before adding a bicycle condition.');
          canonical.conditions.push({
            id: id('bike'),
            kind: 'bike',
            label: `${command.maxMinutes}-minute bicycle area`,
            visible: true,
            maxMinutes: command.maxMinutes,
          });
          break;
        case 'add-access':
          canonical.conditions.push({
            id: id(command.category),
            kind: 'access',
            category: command.category,
            label: `${command.maxMinutes}-minute ${command.category} access`,
            visible: true,
            maxMinutes: command.maxMinutes,
            groceryType: command.groceryType,
          });
          break;
        case 'add-preference':
          canonical.conditions = canonical.conditions.filter(({ kind }) => kind !== 'preference');
          canonical.conditions.push({
            id: id('preference'),
            kind: 'preference',
            label: 'Personal preference area',
            visible: true,
            geometry: command.geometry,
          });
          break;
        case 'update-condition': {
          const target = canonical.conditions.find(
            ({ id: conditionId }) => conditionId === command.id,
          );
          if (!target || target.kind === 'preference')
            throw new Error('That condition cannot be updated with a time limit.');
          target.maxMinutes = command.maxMinutes;
          target.label = `${command.maxMinutes}-minute ${target.kind === 'bike' ? 'bicycle area' : `${target.category} access`}`;
          if (canonical.combined && target.kind === 'bike') {
            freshness = 'stale';
            needsAnalysis = false;
          }
          break;
        }
        case 'delete-condition':
          canonical.conditions = canonical.conditions.filter(
            ({ id: conditionId }) => conditionId !== command.id,
          );
          if (canonical.conditions.length < 2) canonical.combined = false;
          break;
        case 'set-visibility': {
          const target = canonical.conditions.find(
            ({ id: conditionId }) => conditionId === command.id,
          );
          if (!target) throw new Error('Condition not found.');
          target.visible = command.visible;
          needsAnalysis = false;
          break;
        }
        case 'combine':
          if (canonical.conditions.length < 2)
            throw new Error('Add at least two conditions before combining them.');
          canonical.combined = true;
          freshness = 'fresh';
          break;
        case 'recalculate':
          freshness = canonical.combined ? 'fresh' : 'not-combined';
          break;
        case 'rank':
          if (!canonical.combined || freshness !== 'fresh')
            throw new Error('Create a fresh feasible region before ranking candidates.');
          break;
        case 'select-candidate':
          canonical.selectedCandidateId = command.id;
          needsAnalysis = false;
          break;
        case 'remove-candidate':
          canonical.removedCandidateIds = [
            ...new Set([...canonical.removedCandidateIds, command.id]),
          ];
          if (canonical.selectedCandidateId === command.id) canonical.selectedCandidateId = null;
          break;
      }

      canonical = CanonicalWorkspaceSchema.parse(canonical);
      const derived = needsAnalysis ? await getGeoWorker().analyze(canonical) : state.derived;
      if (!canonical.combined) freshness = 'not-combined';
      state.commit({
        canonical,
        derived,
        undo: before,
        activity: withActivity(state.activity, activity(commandMessage(command), command.actor)),
        operation: 'idle',
        analysisFreshness: freshness,
        error: null,
      });
      persist();
      return { ok: true, message: commandMessage(command), data: derived };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The workspace change failed.';
      state.setOperation('error', message);
      return { ok: false, message };
    }
  }

  async query(query: WorkspaceQuery): Promise<CommandResult> {
    const state = workspaceSnapshot();
    switch (query.type) {
      case 'get-workspace':
        return {
          ok: true,
          message: 'Workspace summary.',
          data: {
            office: state.canonical.office,
            conditions: state.canonical.conditions.map(({ id, label, kind, visible }) => ({
              id,
              label,
              kind,
              visible,
            })),
            feasibleAreaKm2: state.derived.feasibleAreaKm2,
            candidates: state.derived.candidates,
            freshness: state.analysisFreshness,
          },
        };
      case 'search-locations':
        return {
          ok: true,
          message: 'Location matches.',
          data: await this.searchLocations(query.query),
        };
      case 'explain-candidate': {
        const candidate = state.derived.candidates.find(
          ({ id: candidateId }) => candidateId === query.id,
        );
        return candidate
          ? { ok: true, message: candidate.tradeoff, data: candidate }
          : { ok: false, message: 'Candidate not found.' };
      }
      case 'analyze-restriction':
        return state.derived.restriction
          ? {
              ok: true,
              message: state.derived.restriction.message,
              data: state.derived.restriction,
            }
          : { ok: false, message: 'Combine conditions before analyzing restrictions.' };
      case 'create-share-link':
        try {
          return {
            ok: true,
            message: 'Share link created.',
            data: {
              url: createShareUrl({
                schemaVersion: 1,
                datasetVersion: state.datasetVersion || DATASET_VERSION,
                canonical: state.canonical,
                activity: state.activity,
                undo: state.undo,
              }),
            },
          };
        } catch (error) {
          return {
            ok: false,
            message: error instanceof Error ? error.message : 'Share link creation failed.',
          };
        }
    }
  }

  private async searchLocations(query: string): Promise<LocationResult[]> {
    const normalized = query.trim().toLowerCase();
    const local = this.presets.filter(({ label }) => label.toLowerCase().includes(normalized));
    const key = import.meta.env.VITE_MAPTILER_KEY;
    if (!key || !query.trim()) return local;
    try {
      const url = new URL(`https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json`);
      url.searchParams.set('key', key);
      url.searchParams.set('bbox', '-122.53,37.69,-122.34,37.83');
      url.searchParams.set('limit', '5');
      const response = await fetch(url);
      if (!response.ok) return local;
      const payload = (await response.json()) as {
        features?: Array<{ id: string; place_name?: string; center?: Coordinate }>;
      };
      return (payload.features ?? [])
        .filter((feature): feature is { id: string; place_name: string; center: Coordinate } =>
          Boolean(feature.place_name && feature.center?.length === 2),
        )
        .map((feature) => ({
          id: feature.id,
          label: feature.place_name,
          coordinates: feature.center,
        }));
    } catch {
      return local;
    }
  }
}

export const workspaceService = new WorkspaceService();
