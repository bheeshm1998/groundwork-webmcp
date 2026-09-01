import { useEffect, useState } from 'react';
import { workspaceService } from '../domain/workspace-service';
import { cancelPreferenceDraw, requestPreferenceDraw } from '../map/drawing';
import { useWorkspaceStore } from '../store/workspace-store';

function ConditionMinutes({
  id,
  label,
  value,
  min,
  max,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = (nextValue: number) => {
    if (!Number.isFinite(nextValue) || nextValue < min || nextValue > max) {
      setDraft(value);
      return;
    }
    if (nextValue !== value) {
      void workspaceService.execute({ type: 'update-condition', id, maxMinutes: nextValue });
    }
  };

  return (
    <input
      aria-label={`Minutes for ${label}`}
      type="number"
      min={min}
      max={max}
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.valueAsNumber)}
      onBlur={() => commit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function ConditionsPanel() {
  const conditions = useWorkspaceStore((state) => state.canonical.conditions);
  const freshness = useWorkspaceStore((state) => state.analysisFreshness);
  const operation = useWorkspaceStore((state) => state.operation);
  const [bikeMinutes, setBikeMinutes] = useState(25);
  const [groceryMinutes, setGroceryMinutes] = useState(10);
  const [parkMinutes, setParkMinutes] = useState(8);
  const mutationsDisabled = operation === 'calculating' || operation === 'drawing';

  return (
    <section className="panel" aria-labelledby="conditions-heading">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">Visible reasoning</div>
          <h2 id="conditions-heading">Conditions</h2>
        </div>
        <span className={`freshness ${freshness}`}>{freshness.replace('-', ' ')}</span>
      </div>
      <div className="quick-add-grid">
        <label>
          Bike
          <input
            type="number"
            min="5"
            max="90"
            value={bikeMinutes}
            onChange={(event) => setBikeMinutes(event.target.valueAsNumber)}
          />
        </label>
        <button
          type="button"
          disabled={
            mutationsDisabled ||
            !Number.isFinite(bikeMinutes) ||
            bikeMinutes < 5 ||
            bikeMinutes > 90
          }
          onClick={() =>
            void workspaceService.execute({ type: 'add-bike', maxMinutes: bikeMinutes })
          }
        >
          Set bike
        </button>
        <label>
          Grocery
          <input
            type="number"
            min="1"
            max="45"
            value={groceryMinutes}
            onChange={(event) => setGroceryMinutes(event.target.valueAsNumber)}
          />
        </label>
        <button
          type="button"
          disabled={
            mutationsDisabled ||
            !Number.isFinite(groceryMinutes) ||
            groceryMinutes < 1 ||
            groceryMinutes > 45
          }
          onClick={() =>
            void workspaceService.execute({
              type: 'add-access',
              category: 'grocery',
              maxMinutes: groceryMinutes,
              groceryType: 'supermarket',
            })
          }
        >
          Set grocery
        </button>
        <label>
          Park
          <input
            type="number"
            min="1"
            max="45"
            value={parkMinutes}
            onChange={(event) => setParkMinutes(event.target.valueAsNumber)}
          />
        </label>
        <button
          type="button"
          disabled={
            mutationsDisabled ||
            !Number.isFinite(parkMinutes) ||
            parkMinutes < 1 ||
            parkMinutes > 45
          }
          onClick={() =>
            void workspaceService.execute({
              type: 'add-access',
              category: 'park',
              maxMinutes: parkMinutes,
            })
          }
        >
          Set park
        </button>
      </div>
      <ul className="condition-list">
        {conditions.map((condition) => (
          <li
            key={condition.id}
            className={`condition-item ${condition.kind === 'access' ? condition.category : condition.kind}`}
          >
            <button
              type="button"
              className={`visibility-dot ${condition.visible ? '' : 'muted'}`}
              aria-label={`${condition.visible ? 'Hide' : 'Show'} ${condition.label}`}
              onClick={() =>
                void workspaceService.execute({
                  type: 'set-visibility',
                  id: condition.id,
                  visible: !condition.visible,
                })
              }
              disabled={mutationsDisabled}
            />
            <span>{condition.label}</span>
            {condition.kind !== 'preference' ? (
              <ConditionMinutes
                id={condition.id}
                label={condition.label}
                value={condition.maxMinutes}
                min={condition.kind === 'bike' ? 5 : 1}
                max={condition.kind === 'bike' ? 90 : 45}
                disabled={mutationsDisabled}
              />
            ) : null}
            <button
              type="button"
              className="remove-button"
              aria-label={`Delete ${condition.label}`}
              disabled={mutationsDisabled}
              onClick={() =>
                void workspaceService.execute({ type: 'delete-condition', id: condition.id })
              }
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="action-row">
        <button
          type="button"
          onClick={() => void requestPreferenceDraw().catch(() => undefined)}
          disabled={operation === 'drawing' || operation === 'calculating'}
        >
          {operation === 'drawing' ? 'Draw on the map…' : 'Draw preference'}
        </button>
        {operation === 'drawing' ? (
          <button type="button" className="ghost-danger" onClick={() => cancelPreferenceDraw()}>
            Cancel drawing
          </button>
        ) : null}
        {freshness === 'stale' ? (
          <button
            type="button"
            className="warning-button"
            disabled={mutationsDisabled}
            onClick={() => void workspaceService.execute({ type: 'recalculate' })}
          >
            Recalculate
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void workspaceService.execute({ type: 'combine' })}
            disabled={conditions.length < 2 || mutationsDisabled}
          >
            Combine
          </button>
        )}
      </div>
      <p className="assumption-note">
        Walking and bicycle times follow the bundled OpenStreetMap street graph. Modeled times do
        not include live conditions, hills, or closures.
      </p>
    </section>
  );
}
