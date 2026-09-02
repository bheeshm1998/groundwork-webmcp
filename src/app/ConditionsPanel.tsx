import { useEffect, useState } from 'react';
import type { Condition } from '../domain/schemas';
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
  const min = condition.kind === 'bike' ? 5 : 1;
  const max = condition.kind === 'bike' ? 90 : 45;

  useEffect(() => setDraft(condition.maxMinutes), [condition.maxMinutes]);

  const commit = (nextValue: number) => {
    if (!Number.isFinite(nextValue) || nextValue < min || nextValue > max) {
      setDraft(condition.maxMinutes);
      return;
    }
    if (nextValue !== condition.maxMinutes) {
      void workspaceService.execute({
        type: 'update-condition',
        id: condition.id,
        maxMinutes: nextValue,
      });
    }
  };

  return (
    <label className="minutes-control">
      <span className="sr-only">Minutes for {condition.label}</span>
      <input
        aria-label={`Minutes for ${condition.label}`}
        type="number"
        min={min}
        max={max}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.valueAsNumber)}
        onBlur={() => commit(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      <span>min</span>
    </label>
  );
}

function PriorityRow({
  title,
  detail,
  color,
  condition,
  draft,
  setDraft,
  add,
  disabled,
  min,
  max,
}: {
  title: string;
  detail: string;
  color: 'bike' | 'grocery' | 'park';
  condition?: Exclude<Condition, { kind: 'preference' }>;
  draft: number;
  setDraft: (value: number) => void;
  add: () => void;
  disabled: boolean;
  min: number;
  max: number;
}) {
  return (
    <article className={`priority-row ${condition ? 'active' : ''}`}>
      <span className={`condition-swatch ${color}`} aria-hidden="true" />
      <div className="priority-copy">
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
      {condition ? (
        <ConditionMinutes condition={condition} disabled={disabled} />
      ) : (
        <label className="minutes-control">
          <span className="sr-only">Minutes for {title}</span>
          <input
            aria-label={`Minutes for ${title}`}
            type="number"
            min={min}
            max={max}
            value={draft}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.valueAsNumber)}
          />
          <span>min</span>
        </label>
      )}
      <button
        type="button"
        className={condition ? 'priority-toggle active' : 'priority-toggle'}
        aria-label={condition ? `Remove ${title}` : `Add ${title}`}
        aria-pressed={Boolean(condition)}
        disabled={
          disabled || (!condition && (!Number.isFinite(draft) || draft < min || draft > max))
        }
        onClick={() => {
          if (condition) {
            void workspaceService.execute({ type: 'delete-condition', id: condition.id });
          } else {
            add();
          }
        }}
      >
        {condition ? 'Added' : 'Add'}
      </button>
    </article>
  );
}

export function ConditionsPanel() {
  const conditions = useWorkspaceStore((state) => state.canonical.conditions);
  const freshness = useWorkspaceStore((state) => state.analysisFreshness);
  const combined = useWorkspaceStore((state) => state.canonical.combined);
  const operation = useWorkspaceStore((state) => state.operation);
  const [bikeMinutes, setBikeMinutes] = useState(25);
  const [groceryMinutes, setGroceryMinutes] = useState(10);
  const [parkMinutes, setParkMinutes] = useState(8);
  const mutationsDisabled = operation === 'calculating' || operation === 'drawing';
  const bike = conditions.find((condition) => condition.kind === 'bike');
  const grocery = conditions.find(
    (condition): condition is Extract<Condition, { kind: 'access' }> =>
      condition.kind === 'access' && condition.category === 'grocery',
  );
  const park = conditions.find(
    (condition): condition is Extract<Condition, { kind: 'access' }> =>
      condition.kind === 'access' && condition.category === 'park',
  );
  const preference = conditions.find((condition) => condition.kind === 'preference');

  return (
    <section className="setup-section priorities-section" aria-labelledby="priorities-heading">
      <div className="setup-heading-row">
        <div>
          <p className="step-label">2 · Priorities</p>
          <h2 id="priorities-heading">What should be nearby?</h2>
        </div>
        <span className="priority-count">{conditions.length} selected</span>
      </div>
      <p className="setup-description">Add at least two priorities to find matching areas.</p>

      <div className="priority-list">
        <PriorityRow
          title="Bike commute"
          detail="From your destination"
          color="bike"
          condition={bike}
          draft={bikeMinutes}
          setDraft={setBikeMinutes}
          min={5}
          max={90}
          disabled={mutationsDisabled}
          add={() => void workspaceService.execute({ type: 'add-bike', maxMinutes: bikeMinutes })}
        />
        <PriorityRow
          title="Groceries"
          detail="Walk to a supermarket"
          color="grocery"
          condition={grocery}
          draft={groceryMinutes}
          setDraft={setGroceryMinutes}
          min={1}
          max={45}
          disabled={mutationsDisabled}
          add={() =>
            void workspaceService.execute({
              type: 'add-access',
              category: 'grocery',
              maxMinutes: groceryMinutes,
              groceryType: 'supermarket',
            })
          }
        />
        <PriorityRow
          title="Park access"
          detail="Walk to a public park"
          color="park"
          condition={park}
          draft={parkMinutes}
          setDraft={setParkMinutes}
          min={1}
          max={45}
          disabled={mutationsDisabled}
          add={() =>
            void workspaceService.execute({
              type: 'add-access',
              category: 'park',
              maxMinutes: parkMinutes,
            })
          }
        />
      </div>

      <details className="advanced-options">
        <summary>More options</summary>
        <div className="advanced-option-row">
          <div>
            <strong>Preferred area</strong>
            <small>Draw the part of the city you would consider.</small>
          </div>
          {preference ? (
            <button
              type="button"
              className="quiet-button"
              disabled={mutationsDisabled}
              onClick={() =>
                void workspaceService.execute({ type: 'delete-condition', id: preference.id })
              }
            >
              Remove
            </button>
          ) : (
            <button
              type="button"
              className="quiet-button"
              onClick={() => void requestPreferenceDraw().catch(() => undefined)}
              disabled={mutationsDisabled}
            >
              Draw on map
            </button>
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

      {freshness === 'stale' ? (
        <button
          type="button"
          className="primary-button find-areas-button"
          disabled={mutationsDisabled}
          onClick={() => void workspaceService.execute({ type: 'recalculate' })}
        >
          Update matching areas
        </button>
      ) : combined && freshness === 'fresh' ? (
        <div className="results-current" role="status">
          Results are up to date
        </div>
      ) : (
        <button
          type="button"
          className="primary-button find-areas-button"
          onClick={() => void workspaceService.execute({ type: 'combine' })}
          disabled={conditions.length < 2 || mutationsDisabled}
        >
          {conditions.length < 2 ? 'Add one more priority' : 'Find matching areas'}
        </button>
      )}
    </section>
  );
}
