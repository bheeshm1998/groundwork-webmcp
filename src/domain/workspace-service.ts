import { DATASET_VERSION, EMPTY_DERIVED, emptyCanonical } from './defaults';
import { CITIES, DEFAULT_CITY_ID, coordinateIsInCity, type CityId } from './cities';
import {
  ACCESS_MODES,
  CanonicalWorkspaceSchema,
  PLACE_CATEGORIES,
  TRAVEL_MODES,
  type ActivityEntry,
  type CanonicalWorkspace,
  type CommandResult,
  type LocationResult,
  type WorkspaceCommand,
  type WorkspaceQuery,
} from './schemas';
import { placeConditionLabel, travelConditionLabel } from './options';
import { getGeoWorker } from '../geo-worker/client';
import {
  clearLocalWorkspace,
  createShareUrl,
  readLocalWorkspace,
  readSharedWorkspace,
  saveLocalWorkspace,
} from '../sharing/share';
import { useWorkspaceStore, workspaceSnapshot } from '../store/workspace-store';
import { cancelPreferenceDraw } from '../map/drawing';
import { searchOnlineLocations } from './geocoder';

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
    case 'add-destination':
      return `Added ${command.destination.label} as a destination.`;
    case 'update-destination':
      return `Moved ${command.destination.label}.`;
    case 'remove-destination':
      return 'Removed a destination and its travel priorities.';
    case 'add-travel':
      return `Added a ${command.maxMinutes}-minute ${command.mode} travel priority.`;
    case 'add-place':
      return `Added ${command.maxMinutes}-minute ${command.mode} access to ${command.category}.`;
    case 'add-preference':
      return 'Added the area you would personally consider.';
    case 'update-condition':
      return 'Updated a priority.';
    case 'delete-condition':
      return 'Removed a priority.';
    case 'set-visibility':
      return `${command.visible ? 'Showed' : 'Hid'} a map layer.`;
    case 'combine':
      return 'Found the areas that match your priorities.';
    case 'recalculate':
      return 'Updated the matching areas.';
    case 'rank':
      return 'Ranked the three strongest candidate areas.';
    case 'select-candidate':
      return command.id ? 'Selected a recommended area.' : 'Cleared the selected area.';
    case 'remove-candidate':
      return 'Removed a recommended area from consideration.';
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

function persist(): string | null {
  const state = workspaceSnapshot();
  try {
    saveLocalWorkspace({
      schemaVersion: 1,
      cityId: state.cityId,
      datasetVersion: state.datasetVersion,
      canonical: state.canonical,
      activity: state.activity,
      undo: state.undo,
    });
    return null;
  } catch {
    return 'Your change is available in this tab, but the browser could not save it locally.';
  }
}

function isMeaningfulChange(command: WorkspaceCommand): boolean {
  return !['set-view', 'set-visibility', 'recalculate', 'rank', 'select-candidate'].includes(
    command.type,
  );
}

function userMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.name === 'ZodError') {
    return 'That value is outside the supported range or has an invalid format.';
  }
  return error instanceof Error ? error.message : fallback;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The operation was cancelled.', 'AbortError');
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function normalizedSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/\bst\.?\b/gu, 'street')
    .replace(/\bave\.?\b/gu, 'avenue')
    .replace(/\bblvd\.?\b/gu, 'boulevard')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

function searchTokens(query: string, cityId: CityId): string[] {
  const ignored = new Set([
    ...normalizedSearchText(CITIES[cityId].name).split(' '),
    ...normalizedSearchText(CITIES[cityId].country).split(' '),
    'ca',
    'california',
    'telangana',
    'india',
  ]);
  const tokens = normalizedSearchText(query)
    .split(' ')
    .filter((token) => token && !ignored.has(token));
  return tokens.length ? tokens : normalizedSearchText(query).split(' ').filter(Boolean);
}

function localSearchScore(label: string, query: string, cityId: CityId): number {
  const normalizedLabel = normalizedSearchText(label);
  const normalizedQuery = normalizedSearchText(query);
  if (normalizedLabel === normalizedQuery) return 1_000;
  if (normalizedLabel.startsWith(normalizedQuery)) return 900;
  if (normalizedLabel.includes(normalizedQuery)) return 800;

  const labelTokens = normalizedLabel.split(' ');
  const queryTokens = searchTokens(query, cityId);
  const matched = queryTokens.filter((queryToken) =>
    labelTokens.some(
      (labelToken) => labelToken === queryToken || labelToken.startsWith(queryToken),
    ),
  ).length;
  if (matched === queryTokens.length) return 700 + matched;
  const coverage = matched / queryTokens.length;
  return coverage >= 0.66 ? 400 + coverage * 100 : 0;
}

function uniqueLocations(results: LocationResult[]): LocationResult[] {
  const unique = new Map<string, LocationResult>();
  for (const match of results) {
    const coordinateKey = match.coordinates.map((value) => value.toFixed(5)).join(',');
    const key = `${normalizedSearchText(match.label)}:${coordinateKey}`;
    if (!unique.has(key)) unique.set(key, match);
    if (unique.size === 8) break;
  }
  return [...unique.values()];
}

export class WorkspaceService {
  private searchIndex: LocationResult[] = [];
  private initialization: { cityId: CityId; promise: Promise<CommandResult> } | null = null;

  async initialize(requestedCityId: CityId = DEFAULT_CITY_ID): Promise<CommandResult> {
    if (this.initialization) {
      if (this.initialization.cityId === requestedCityId) return this.initialization.promise;
      try {
        await this.initialization.promise;
      } catch {
        // A request for another city should still get its own initialization attempt.
      }
    }
    const promise = this.initializeOnce(requestedCityId);
    this.initialization = { cityId: requestedCityId, promise };
    try {
      return await promise;
    } finally {
      if (this.initialization?.promise === promise) this.initialization = null;
    }
  }

  private async initializeOnce(requestedCityId: CityId): Promise<CommandResult> {
    const store = useWorkspaceStore.getState();
    store.setOperation('calculating');
    try {
      let restored = null;
      try {
        const shared = readSharedWorkspace();
        const local = shared ? null : readLocalWorkspace();
        restored = shared ?? local;
      } catch (error) {
        store.commit({
          error:
            error instanceof Error ? error.message : 'The saved workspace could not be opened.',
        });
      }
      if (restored?.cityId === undefined) restored = { ...restored, cityId: DEFAULT_CITY_ID };
      if (restored && !window.location.hash && restored.cityId !== requestedCityId) restored = null;
      const cityId = restored?.cityId ?? requestedCityId;
      const initialized = await getGeoWorker().initialize(cityId);
      this.searchIndex = initialized.search;
      if (restored && restored.datasetVersion !== initialized.metadata.datasetVersion) {
        store.commit({
          error: window.location.hash
            ? 'This share link uses a different map dataset and cannot be opened safely.'
            : 'The saved workspace used an older map dataset and was not restored.',
        });
        if (!window.location.hash) {
          try {
            clearLocalWorkspace();
          } catch {
            // The incompatible snapshot is still ignored when storage is unavailable.
          }
        }
        restored = null;
      }
      const canonical = restored?.canonical ?? emptyCanonical(cityId);
      const derived = canonical.conditions.length
        ? await getGeoWorker().analyze(canonical)
        : structuredClone(EMPTY_DERIVED);
      store.commit({
        cityId,
        datasetVersion: initialized.metadata.datasetVersion,
        datasetMetadata: initialized.metadata,
        canonical,
        derived,
        activity: restored?.activity ?? [],
        undo: restored?.undo ?? null,
        operation: 'idle',
        analysisFreshness: canonical.combined ? 'fresh' : 'not-combined',
        initialized: true,
      });
      return { ok: true, message: `SweetSpot is ready for ${CITIES[cityId].name}.` };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SweetSpot could not initialize.';
      store.setOperation('error', message);
      return { ok: false, message };
    }
  }

  async execute(command: WorkspaceCommand, signal?: AbortSignal): Promise<CommandResult> {
    const state = workspaceSnapshot();
    if (signal?.aborted) return { ok: false, message: 'The operation was cancelled.' };
    if (state.operation === 'calculating')
      return { ok: false, message: 'Another calculation is still running.' };
    if (state.operation === 'drawing' && !['set-view', 'reset'].includes(command.type)) {
      return { ok: false, message: 'Finish or cancel the active drawing first.' };
    }
    if (command.type === 'set-view') {
      try {
        const canonical = CanonicalWorkspaceSchema.parse({
          ...state.canonical,
          view: command.view,
        });
        state.commit({ canonical });
        const warning = persist();
        if (warning) state.commit({ error: warning });
        return { ok: true, message: warning ?? 'Map view updated.' };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : 'The map view could not be saved.',
        };
      }
    }
    if (command.type === 'undo') {
      if (!state.undo) return { ok: false, message: 'There is no recent change to undo.' };
      state.setOperation('calculating');
      try {
        throwIfAborted(signal);
        const restored = CanonicalWorkspaceSchema.parse(state.undo);
        const derived = restored.conditions.length
          ? await getGeoWorker().analyze(restored)
          : structuredClone(EMPTY_DERIVED);
        throwIfAborted(signal);
        state.commit({
          canonical: restored,
          derived,
          undo: null,
          activity: withActivity(state.activity, activity(commandMessage(command), command.actor)),
          operation: 'idle',
          analysisFreshness: restored.combined ? 'fresh' : 'not-combined',
        });
        const warning = persist();
        if (warning) state.commit({ error: warning });
        return { ok: true, message: warning ?? 'The last change was undone.' };
      } catch (error) {
        if (isAbort(error)) {
          state.setOperation('idle');
          return { ok: false, message: 'The operation was cancelled.' };
        }
        const message = userMessage(error, 'Undo failed.');
        state.setOperation('error', message);
        return { ok: false, message };
      }
    }
    if (command.type === 'reset') {
      if (state.operation === 'drawing') cancelPreferenceDraw('Drawing was cancelled by reset.');
      try {
        clearLocalWorkspace();
      } catch {
        // The in-memory reset remains useful even when browser storage is unavailable.
      }
      state.commit({
        canonical: emptyCanonical(state.cityId),
        derived: structuredClone(EMPTY_DERIVED),
        activity: [activity(commandMessage(command), command.actor)],
        undo: cloneCanonical(state.canonical),
        operation: 'idle',
        analysisFreshness: 'not-combined',
        error: null,
        activeAgentAction: null,
        workspaceEpoch: state.workspaceEpoch + 1,
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
      throwIfAborted(signal);
      switch (command.type) {
        case 'add-destination': {
          if (canonical.destinations.length >= 4) {
            throw new Error('A workspace can contain up to four destinations.');
          }
          if (!coordinateIsInCity(state.cityId, command.destination.coordinates)) {
            throw new Error(
              `Choose a location inside the supported ${CITIES[state.cityId].name} area.`,
            );
          }
          if (!(await getGeoWorker().isCoordinateSupported(command.destination.coordinates))) {
            throw new Error(
              `Choose a location inside the supported ${CITIES[state.cityId].name} map boundary.`,
            );
          }
          throwIfAborted(signal);
          canonical.destinations.push({
            ...command.destination,
            id: command.destination.id ?? id('destination'),
          });
          canonical.selectedCandidateId = null;
          needsAnalysis = false;
          break;
        }
        case 'update-destination': {
          const destinationIndex = canonical.destinations.findIndex(
            ({ id: destinationId }) => destinationId === command.destination.id,
          );
          if (destinationIndex < 0) throw new Error('Destination not found.');
          if (!coordinateIsInCity(state.cityId, command.destination.coordinates)) {
            throw new Error(
              `Choose a location inside the supported ${CITIES[state.cityId].name} area.`,
            );
          }
          if (!(await getGeoWorker().isCoordinateSupported(command.destination.coordinates))) {
            throw new Error(
              `Choose a location inside the supported ${CITIES[state.cityId].name} map boundary.`,
            );
          }
          throwIfAborted(signal);
          canonical.destinations[destinationIndex] = command.destination;
          canonical.selectedCandidateId = null;
          const isTravelDestination = canonical.conditions.some(
            (condition) =>
              condition.kind === 'travel' && condition.destinationId === command.destination.id,
          );
          if (canonical.combined && isTravelDestination) {
            freshness = 'stale';
            needsAnalysis = false;
          } else if (!isTravelDestination) {
            needsAnalysis = false;
          }
          break;
        }
        case 'remove-destination': {
          if (
            !canonical.destinations.some(({ id: destinationId }) => destinationId === command.id)
          ) {
            throw new Error('Destination not found.');
          }
          canonical.destinations = canonical.destinations.filter(
            ({ id: destinationId }) => destinationId !== command.id,
          );
          const conditionCount = canonical.conditions.length;
          canonical.conditions = canonical.conditions.filter(
            (condition) => condition.kind !== 'travel' || condition.destinationId !== command.id,
          );
          if (canonical.conditions.length < 2) canonical.combined = false;
          if (conditionCount === canonical.conditions.length) needsAnalysis = false;
          break;
        }
        case 'add-travel': {
          const destination = canonical.destinations.find(({ id }) => id === command.destinationId);
          if (!destination)
            throw new Error('Choose a current destination for this travel priority.');
          canonical.conditions.push({
            id: id('travel'),
            kind: 'travel',
            destinationId: command.destinationId,
            mode: command.mode,
            label: travelConditionLabel(command.maxMinutes, command.mode, destination.label),
            visible: true,
            maxMinutes: command.maxMinutes,
          });
          break;
        }
        case 'add-place':
          canonical.conditions.push({
            id: id(command.category),
            kind: 'access',
            category: command.category,
            mode: command.mode,
            label: placeConditionLabel(
              command.maxMinutes,
              command.mode,
              command.category,
              command.groceryType,
            ),
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
            throw new Error('That condition cannot be updated with these fields.');
          if (
            command.maxMinutes === undefined &&
            command.destinationId === undefined &&
            command.mode === undefined &&
            command.category === undefined &&
            command.groceryType === undefined
          ) {
            throw new Error('Provide at least one field to update.');
          }
          if (command.maxMinutes !== undefined) target.maxMinutes = command.maxMinutes;
          if (target.kind === 'travel') {
            if (command.category !== undefined || command.groceryType !== undefined) {
              throw new Error('Place fields cannot be applied to a travel priority.');
            }
            if (command.destinationId !== undefined) {
              if (!canonical.destinations.some(({ id }) => id === command.destinationId)) {
                throw new Error('Choose a current destination for this travel priority.');
              }
              target.destinationId = command.destinationId;
            }
            if (command.mode !== undefined) target.mode = command.mode;
            const destination = canonical.destinations.find(
              ({ id }) => id === target.destinationId,
            );
            if (!destination) throw new Error('Destination not found.');
            target.label = travelConditionLabel(target.maxMinutes, target.mode, destination.label);
          } else {
            if (command.destinationId !== undefined || command.mode === 'car') {
              throw new Error('Travel-only fields cannot be applied to a place priority.');
            }
            if (command.category !== undefined) target.category = command.category;
            if (command.mode !== undefined) target.mode = command.mode;
            if (command.groceryType !== undefined) target.groceryType = command.groceryType;
            if (target.category !== 'grocery') target.groceryType = undefined;
            target.label = placeConditionLabel(
              target.maxMinutes,
              target.mode,
              target.category,
              target.groceryType,
            );
          }
          if (canonical.combined && target.kind === 'travel') {
            freshness = 'stale';
            needsAnalysis = false;
          }
          break;
        }
        case 'delete-condition':
          if (!canonical.conditions.some(({ id: conditionId }) => conditionId === command.id)) {
            throw new Error('Condition not found.');
          }
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
          if (
            command.id !== null &&
            !state.derived.candidates.some(({ id: candidateId }) => candidateId === command.id)
          ) {
            throw new Error('Candidate not found.');
          }
          canonical.selectedCandidateId = command.id;
          needsAnalysis = false;
          break;
        case 'remove-candidate':
          if (!state.derived.candidates.some(({ id }) => id === command.id)) {
            throw new Error('Candidate not found.');
          }
          canonical.removedCandidateIds = [
            ...new Set([...canonical.removedCandidateIds, command.id]),
          ];
          if (canonical.selectedCandidateId === command.id) canonical.selectedCandidateId = null;
          break;
      }

      canonical = CanonicalWorkspaceSchema.parse(canonical);
      const derived = needsAnalysis
        ? await getGeoWorker().analyze(canonical)
        : structuredClone(state.derived);
      throwIfAborted(signal);
      if (
        canonical.selectedCandidateId &&
        !derived.candidates.some(({ id }) => id === canonical.selectedCandidateId)
      ) {
        canonical.selectedCandidateId = null;
      }
      if (needsAnalysis) freshness = canonical.combined ? 'fresh' : 'not-combined';
      if (freshness === 'stale') {
        derived.layers = {};
        derived.feasibleRegion = null;
        derived.feasibleAreaKm2 = 0;
        derived.candidates = [];
        derived.restriction = null;
      }
      if (!canonical.combined) freshness = 'not-combined';
      state.commit({
        canonical,
        derived,
        undo: isMeaningfulChange(command) ? before : state.undo,
        activity: withActivity(state.activity, activity(commandMessage(command), command.actor)),
        operation: 'idle',
        analysisFreshness: freshness,
        error: null,
      });
      const warning = persist();
      if (warning) state.commit({ error: warning });
      return {
        ok: true,
        message: warning ?? commandMessage(command),
        data: {
          feasibleAreaKm2: derived.feasibleAreaKm2,
          candidateIds: derived.candidates.map(({ id }) => id),
          freshness,
        },
      };
    } catch (error) {
      if (isAbort(error)) {
        state.setOperation('idle');
        return { ok: false, message: 'The operation was cancelled.' };
      }
      const message = userMessage(error, 'The workspace change failed.');
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
            city: CITIES[state.cityId].name,
            destinations: state.canonical.destinations,
            conditions: state.canonical.conditions.map((condition) =>
              condition.kind === 'preference'
                ? {
                    id: condition.id,
                    label: condition.label,
                    kind: condition.kind,
                    visible: condition.visible,
                  }
                : condition,
            ),
            feasibleAreaKm2: state.derived.feasibleAreaKm2,
            candidates: state.derived.candidates,
            freshness: state.analysisFreshness,
            supportedAnalysis: {
              commuteModes: [...TRAVEL_MODES],
              nearbyModes: [...ACCESS_MODES],
              nearbyCategories: [...PLACE_CATEGORIES],
              unsupported: [
                'public transit',
                'straight-line distance limits',
                'exclusion zones',
                'housing listings',
                'live traffic',
              ],
              instruction:
                'Only claim constraints represented by the current destinations, conditions, and candidate metrics. Ask the user before choosing among ambiguous location matches. Convert distance requests such as within 5 km to travel minutes and say that you did so. Disclose unsupported constraints.',
            },
          },
        };
      case 'search-locations': {
        const matches = await this.searchLocations(query.query);
        return {
          ok: true,
          message:
            matches.length === 0
              ? 'No supported location matched. Do not guess coordinates; ask for a more specific company name, address, street, or landmark.'
              : matches.length === 1
                ? 'One location matched.'
                : 'Multiple locations matched. Ask the user which result they mean before adding a destination.',
          data: matches,
        };
      }
      case 'explain-area': {
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
                cityId: state.cityId,
                datasetVersion: state.datasetVersion || DATASET_VERSION,
                canonical: state.canonical,
                activity: [],
                undo: null,
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
    const normalized = normalizedSearchText(query);
    if (normalized.length < 2) return [];
    const cityId = workspaceSnapshot().cityId;
    const local = this.searchIndex
      .map((match) => ({ match, score: localSearchScore(match.label, query, cityId) }))
      .filter(({ score }) => score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.match.label.localeCompare(b.match.label) ||
          a.match.id.localeCompare(b.match.id),
      );
    const hasStrongLocalMatch = local.some(({ score }) => score >= 700);
    const shouldSearchOnline = !hasStrongLocalMatch || /\d/u.test(normalized);
    const online = shouldSearchOnline ? await searchOnlineLocations(cityId, query) : [];
    return uniqueLocations([...online, ...local.map(({ match }) => match)]);
  }
}

export const workspaceService = new WorkspaceService();
