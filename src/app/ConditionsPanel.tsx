import { useEffect, useState } from 'react';
import {
  ACCESS_MODES,
  PLACE_CATEGORIES,
  TRAVEL_MODES,
  type AccessMode,
  type Condition,
  type PlaceCategory,
  type TravelMode,
} from '../domain/schemas';
import { CATEGORY_LABELS, MODE_LABELS } from '../domain/options';
import { workspaceService } from '../domain/workspace-service';
import { cancelPreferenceDraw, requestPreferenceDraw } from '../map/drawing';
import { useWorkspaceStore } from '../store/workspace-store';

function ConditionMinutes({
  condition,
  disabled,
}: {
  condition: Exclude<Condition, { kind: 'preference' }>;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(condition.maxMinutes);
  const min = condition.kind === 'travel' ? 5 : 1;
  const max = condition.kind === 'travel' ? 90 : 45;

  useEffect(() => setDraft(condition.maxMinutes), [condition.maxMinutes]);

  const commit = () => {
    if (!Number.isFinite(draft) || draft < min || draft > max) {
      setDraft(condition.maxMinutes);
      return;
    }
    if (draft !== condition.maxMinutes) {
      void workspaceService.execute({
        type: 'update-condition',
        id: condition.id,
        maxMinutes: draft,
        actor: 'user',
      });
    }
  };

  return (
    <label className="minutes-control condition-field">
      <span>Minutes</span>
      <span className="number-with-unit">
        <input
          aria-label={`Minutes for ${condition.label}`}
          type="number"
          min={min}
          max={max}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.valueAsNumber)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
        <span>min</span>
      </span>
    </label>
  );
}

function ConditionEditor({ condition, disabled }: { condition: Condition; disabled: boolean }) {
  const destinations = useWorkspaceStore((state) => state.canonical.destinations);

  if (condition.kind === 'preference') {
    return (
      <article className="condition-editor preference-editor">
        <div className="condition-editor-heading">
          <div>
            <strong>{condition.label}</strong>
            <small>Drawn on the map</small>
          </div>
          <button
            type="button"
            className="quiet-button"
            disabled={disabled}
            onClick={() =>
              void workspaceService.execute({
                type: 'set-visibility',
                id: condition.id,
                visible: !condition.visible,
                actor: 'user',
              })
            }
          >
            {condition.visible ? 'Hide layer' : 'Show layer'}
          </button>
        </div>
        <button
          type="button"
          className="text-button danger-text"
          disabled={disabled}
          onClick={() =>
            void workspaceService.execute({
              type: 'delete-condition',
              id: condition.id,
              actor: 'user',
            })
          }
        >
          Delete priority
        </button>
      </article>
    );
  }

  return (
    <article className={`condition-editor ${condition.visible ? '' : 'layer-hidden'}`}>
      <div className="condition-editor-heading">
        <div>
          <strong>{condition.label}</strong>
          <small>{condition.kind === 'travel' ? 'Travel' : 'Nearby place'}</small>
        </div>
        <button
          type="button"
          className="quiet-button"
          disabled={disabled}
          onClick={() =>
            void workspaceService.execute({
              type: 'set-visibility',
              id: condition.id,
              visible: !condition.visible,
              actor: 'user',
            })
          }
        >
          {condition.visible ? 'Hide layer' : 'Show layer'}
        </button>
      </div>

      <div className="condition-fields">
        {condition.kind === 'travel' ? (
          <label className="condition-field">
            <span>Destination</span>
            <select
              aria-label={`Destination for ${condition.label}`}
              value={condition.destinationId}
              disabled={disabled}
              onChange={(event) =>
                void workspaceService.execute({
                  type: 'update-condition',
                  id: condition.id,
                  destinationId: event.target.value,
                  actor: 'user',
                })
              }
            >
              {destinations.map((destination) => (
                <option key={destination.id} value={destination.id}>
                  {destination.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="condition-field">
            <span>Place</span>
            <select
              aria-label={`Place category for ${condition.label}`}
              value={condition.category}
              disabled={disabled}
              onChange={(event) =>
                void workspaceService.execute({
                  type: 'update-condition',
                  id: condition.id,
                  category: event.target.value as PlaceCategory,
                  actor: 'user',
                })
              }
            >
              {PLACE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="condition-field">
          <span>Mode</span>
          <select
            aria-label={`Travel mode for ${condition.label}`}
            value={condition.mode}
            disabled={disabled}
            onChange={(event) =>
              void workspaceService.execute({
                type: 'update-condition',
                id: condition.id,
                mode: event.target.value as TravelMode,
                actor: 'user',
              })
            }
          >
            {(condition.kind === 'travel' ? TRAVEL_MODES : ACCESS_MODES).map((mode) => (
              <option key={mode} value={mode}>
                {MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>

        <ConditionMinutes condition={condition} disabled={disabled} />

        {condition.kind === 'access' && condition.category === 'grocery' ? (
          <label className="condition-field grocery-type-field">
            <span>Grocery type</span>
            <select
              aria-label={`Grocery type for ${condition.label}`}
              value={condition.groceryType ?? 'supermarket'}
              disabled={disabled}
              onChange={(event) =>
                void workspaceService.execute({
                  type: 'update-condition',
                  id: condition.id,
                  groceryType: event.target.value as 'supermarket' | 'supermarket_or_grocery',
                  actor: 'user',
                })
              }
            >
              <option value="supermarket">Supermarkets only</option>
              <option value="supermarket_or_grocery">All groceries</option>
            </select>
          </label>
        ) : null}
      </div>

      <button
        type="button"
        className="text-button danger-text"
        disabled={disabled}
        onClick={() =>
          void workspaceService.execute({
            type: 'delete-condition',
            id: condition.id,
            actor: 'user',
          })
        }
      >
        Delete priority
      </button>
    </article>
  );
}

function AddConditionControl({ disabled }: { disabled: boolean }) {
  const destinations = useWorkspaceStore((state) => state.canonical.destinations);
  const conditionCount = useWorkspaceStore((state) => state.canonical.conditions.length);
  const [kind, setKind] = useState<'travel' | 'place'>(destinations.length ? 'travel' : 'place');
  const [travelMode, setTravelMode] = useState<TravelMode>('car');
  const [accessMode, setAccessMode] = useState<AccessMode>('walk');
  const [category, setCategory] = useState<PlaceCategory>('grocery');
  const [destinationId, setDestinationId] = useState(destinations[0]?.id ?? '');
  const [minutes, setMinutes] = useState(10);
  const [groceryType, setGroceryType] = useState<'supermarket' | 'supermarket_or_grocery'>(
    'supermarket',
  );

  useEffect(() => {
    if (!destinations.some(({ id }) => id === destinationId)) {
      setDestinationId(destinations[0]?.id ?? '');
    }
  }, [destinationId, destinations]);

  const min = kind === 'travel' ? 5 : 1;
  const max = kind === 'travel' ? 90 : 45;
  const canAdd =
    conditionCount < 20 &&
    Number.isFinite(minutes) &&
    minutes >= min &&
    minutes <= max &&
    (kind === 'place' || Boolean(destinationId));

  const add = () => {
    if (!canAdd) return;
    if (kind === 'travel') {
      void workspaceService.execute({
        type: 'add-travel',
        destinationId,
        mode: travelMode,
        maxMinutes: minutes,
        actor: 'user',
      });
    } else {
      void workspaceService.execute({
        type: 'add-place',
        category,
        mode: accessMode,
        maxMinutes: minutes,
        groceryType: category === 'grocery' ? groceryType : undefined,
        actor: 'user',
      });
    }
  };

  return (
    <div className="add-condition-control">
      <div className="condition-fields add-condition-fields">
        <label className="condition-field">
          <span>Priority type</span>
          <select
            aria-label="Priority type"
            value={kind}
            disabled={disabled}
            onChange={(event) => {
              const nextKind = event.target.value as 'travel' | 'place';
              setKind(nextKind);
              setMinutes(nextKind === 'travel' ? 30 : 10);
            }}
          >
            <option value="travel" disabled={destinations.length === 0}>
              Travel to destination
            </option>
            <option value="place">Nearby place</option>
          </select>
        </label>

        {kind === 'travel' ? (
          <label className="condition-field">
            <span>Destination</span>
            <select
              aria-label="New priority destination"
              value={destinationId}
              disabled={disabled || destinations.length === 0}
              onChange={(event) => setDestinationId(event.target.value)}
            >
              {destinations.map((destination) => (
                <option key={destination.id} value={destination.id}>
                  {destination.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="condition-field">
            <span>Place</span>
            <select
              aria-label="New priority place category"
              value={category}
              disabled={disabled}
              onChange={(event) => setCategory(event.target.value as PlaceCategory)}
            >
              {PLACE_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {CATEGORY_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="condition-field">
          <span>Mode</span>
          <select
            aria-label="New priority travel mode"
            value={kind === 'travel' ? travelMode : accessMode}
            disabled={disabled}
            onChange={(event) => {
              if (kind === 'travel') setTravelMode(event.target.value as TravelMode);
              else setAccessMode(event.target.value as AccessMode);
            }}
          >
            {(kind === 'travel' ? TRAVEL_MODES : ACCESS_MODES).map((mode) => (
              <option key={mode} value={mode}>
                {MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>

        <label className="condition-field">
          <span>Minutes</span>
          <span className="number-with-unit">
            <input
              aria-label="New priority minutes"
              type="number"
              min={min}
              max={max}
              value={minutes}
              disabled={disabled}
              onChange={(event) => setMinutes(event.target.valueAsNumber)}
            />
            <span>min</span>
          </span>
        </label>

        {kind === 'place' && category === 'grocery' ? (
          <label className="condition-field grocery-type-field">
            <span>Grocery type</span>
            <select
              aria-label="New priority grocery type"
              value={groceryType}
              disabled={disabled}
              onChange={(event) =>
                setGroceryType(event.target.value as 'supermarket' | 'supermarket_or_grocery')
              }
            >
              <option value="supermarket">Supermarkets only</option>
              <option value="supermarket_or_grocery">All groceries</option>
            </select>
          </label>
        ) : null}
      </div>
      <button
        type="button"
        className="quiet-button add-priority-button"
        disabled={disabled || !canAdd}
        onClick={add}
      >
        Add priority
      </button>
      {kind === 'travel' && destinations.length === 0 ? (
        <p className="form-message">Add a destination before creating a travel priority.</p>
      ) : null}
    </div>
  );
}

export function ConditionsPanel() {
  const conditions = useWorkspaceStore((state) => state.canonical.conditions);
  const freshness = useWorkspaceStore((state) => state.analysisFreshness);
  const combined = useWorkspaceStore((state) => state.canonical.combined);
  const operation = useWorkspaceStore((state) => state.operation);
  const drawingReady = useWorkspaceStore((state) => state.drawingReady);
  const mutationsDisabled = operation === 'calculating' || operation === 'drawing';
  const preference = conditions.find((condition) => condition.kind === 'preference');

  return (
    <section className="setup-section priorities-section" aria-labelledby="priorities-heading">
      <div className="setup-heading-row">
        <div>
          <p className="step-label">2 · Priorities</p>
          <h2 id="priorities-heading">What needs to fit?</h2>
        </div>
        <span className="priority-count">{conditions.length}/20</span>
      </div>
      <p className="setup-description">Add at least two priorities to find matching areas.</p>

      <AddConditionControl disabled={mutationsDisabled} />

      {conditions.length > 0 ? (
        <div className="condition-editor-list">
          {conditions.map((condition) => (
            <ConditionEditor
              key={condition.id}
              condition={condition}
              disabled={mutationsDisabled}
            />
          ))}
        </div>
      ) : null}

      <details className="advanced-options">
        <summary>Draw a preferred area</summary>
        <div className="advanced-option-row">
          <div>
            <strong>Personal boundary</strong>
            <small>Draw the part of the city you would consider.</small>
          </div>
          {!preference ? (
            <button
              type="button"
              className="quiet-button"
              onClick={() => {
                void (async () => {
                  try {
                    const geometry = await requestPreferenceDraw();
                    await workspaceService.execute({
                      type: 'add-preference',
                      geometry,
                      actor: 'user',
                    });
                  } catch {
                    return;
                  }
                })();
              }}
              disabled={mutationsDisabled || !drawingReady || conditions.length >= 20}
            >
              Draw on map
            </button>
          ) : (
            <span>Added</span>
          )}
        </div>
        {operation === 'drawing' ? (
          <button
            type="button"
            className="text-button danger-text"
            onClick={() => cancelPreferenceDraw()}
          >
            Cancel drawing
          </button>
        ) : null}
      </details>

      {!combined ? (
        <button
          type="button"
          className="primary-button find-areas-button"
          onClick={() => void workspaceService.execute({ type: 'combine', actor: 'user' })}
          disabled={conditions.length < 2 || mutationsDisabled}
        >
          {conditions.length < 2 ? 'Add one more priority' : 'Find matching areas'}
        </button>
      ) : freshness === 'fresh' ? (
        <div className="results-current" role="status">
          Results are up to date
        </div>
      ) : (
        <div className="results-current stale" role="status">
          Results need updating
        </div>
      )}
    </section>
  );
}
