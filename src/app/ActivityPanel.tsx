import { useState } from 'react';
import { getCapabilities } from '../domain/capabilities';
import { workspaceService } from '../domain/workspace-service';
import { useWorkspaceStore } from '../store/workspace-store';

export function ActivityPanel() {
  const [shareMessage, setShareMessage] = useState('');
  const state = useWorkspaceStore();
  const capabilityCount = getCapabilities(
    state.canonical,
    state.derived,
    state.analysisFreshness,
    Boolean(state.undo),
  ).size;

  const share = async () => {
    const result = await workspaceService.query({ type: 'create-share-link' });
    const url = (result.data as { url?: string } | undefined)?.url;
    if (!result.ok || !url) return setShareMessage(result.message);
    try {
      await navigator.clipboard.writeText(url);
      setShareMessage('Link copied');
    } catch {
      setShareMessage(url);
    }
  };

  return (
    <section className="panel activity-panel" aria-labelledby="activity-heading">
      <div className="panel-heading">
        <h2 id="activity-heading">Activity</h2>
        <span className="agent-count">
          <i />
          {capabilityCount} agent actions available
        </span>
      </div>
      <ol className="activity-list">
        {state.activity
          .toReversed()
          .slice(0, 6)
          .map((entry) => (
            <li key={entry.id}>
              <span className={`actor ${entry.actor}`}>{entry.actor}</span>
              {entry.message}
            </li>
          ))}
      </ol>
      <div className="action-row">
        <button
          type="button"
          onClick={() => void workspaceService.execute({ type: 'undo' })}
          disabled={!state.undo}
        >
          Undo last change
        </button>
        <button type="button" onClick={share}>
          Share workspace
        </button>
        <button
          type="button"
          className="ghost-danger"
          onClick={() => void workspaceService.execute({ type: 'reset' })}
        >
          Reset
        </button>
      </div>
      {shareMessage ? <output className="share-output">{shareMessage}</output> : null}
    </section>
  );
}
