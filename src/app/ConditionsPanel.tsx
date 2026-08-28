import { useEffect, useState } from 'react';
import { workspaceService } from '../domain/workspace-service';
import { requestPreferenceDraw } from '../map/drawing';
import { useWorkspaceStore } from '../store/workspace-store';

function ConditionMinutes({ id, label, value }: { id: string; label: string; value: number }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = (nextValue: number) => {
    if (Number.isFinite(nextValue) && nextValue !== value) {
      void workspaceService.execute({ type: 'update-condition', id, maxMinutes: nextValue });
    }
  };

  return (
    <input
      aria-label={`Minutes for ${label}`}
      type="number"
      min="1"
      max="90"
      value={draft}
      onChange={(event) => setDraft(event.target.valueAsNumber)}
      onBlur={() => commit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit(event.currentTarget.valueAsNumber);
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
          onClick={() =>
            void workspaceService.execute({ type: 'add-bike', maxMinutes: bikeMinutes })
          }
        >
          Add
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
          onClick={() =>
            void workspaceService.execute({
              type: 'add-access',
              category: 'grocery',
              maxMinutes: groceryMinutes,
              groceryType: 'supermarket',
            })
          }
        >
          Add
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
          onClick={() =>
            void workspaceService.execute({
              type: 'add-access',
              category: 'park',
              maxMinutes: parkMinutes,
            })
          }
        >
          Add
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
            />
            <span>{condition.label}</span>
            {condition.kind !== 'preference' ? (
              <ConditionMinutes
                id={condition.id}
                label={condition.label}
                value={condition.maxMinutes}
              />
            ) : null}
            <button
              type="button"
              className="remove-button"
              aria-label={`Delete ${condition.label}`}
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
          disabled={operation === 'drawing'}
        >
          {operation === 'drawing' ? 'Draw on the map…' : 'Draw preference'}
        </button>
        {freshness === 'stale' ? (
          <button
            type="button"
            className="warning-button"
            onClick={() => void workspaceService.execute({ type: 'recalculate' })}
          >
            Recalculate
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void workspaceService.execute({ type: 'combine' })}
            disabled={conditions.length < 2}
          >
            Combine
          </button>
        )}
      </div>
      <p className="assumption-note">
        Walking access uses straight-line distance at 1.4 m/s. Bicycle times are modeled estimates.
      </p>
    </section>
  );
}
