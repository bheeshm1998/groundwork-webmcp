import { useState } from 'react';
import { workspaceService } from '../domain/workspace-service';
import { useWorkspaceStore } from '../store/workspace-store';
import { getWebMcpStatusLabel } from '../webmcp/runtime';

export function ActivityPanel() {
  const [shareMessage, setShareMessage] = useState('');
  const state = useWorkspaceStore();

  const share = async () => {
    const result = await workspaceService.query({ type: 'create-share-link' });
    const url = (result.data as { url?: string } | undefined)?.url;
    if (!result.ok || !url) return setShareMessage(result.message);
    try {
      await navigator.clipboard.writeText(url);
      setShareMessage('Share link copied');
    } catch {
      setShareMessage(url);
    }
  };

  return (
    <div className="activity-panel">
      <div className="workspace-actions">
        <button
          type="button"
          onClick={() => void workspaceService.execute({ type: 'undo' })}
          disabled={
            !state.undo || state.operation === 'calculating' || state.operation === 'drawing'
          }
        >
          Undo last change
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={share}
          disabled={state.operation === 'calculating' || state.operation === 'drawing'}
        >
          Share plan
        </button>
      </div>
      {shareMessage ? <output className="share-output">{shareMessage}</output> : null}
      <p className="share-privacy-note">
        Share links include the current plan, not your history or undo state.
      </p>

      <div className="activity-heading">
        <h3>Recent changes</h3>
        <span>Saved in this browser</span>
      </div>
      {state.activity.length > 0 ? (
        <ol className="activity-list">
          {state.activity
            .toReversed()
            .slice(0, 8)
            .map((entry) => (
              <li key={entry.id} className={`actor-${entry.actor}`}>
                <span>
                  <small>
                    {entry.actor === 'agent'
                      ? 'Agent'
                      : entry.actor === 'user'
                        ? 'You'
                        : 'SweetSpot'}
                  </small>
                  {entry.message}
                </span>
                <time dateTime={new Date(entry.timestamp).toISOString()}>
                  {new Date(entry.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </li>
            ))}
        </ol>
      ) : (
        <p className="empty-activity">Your changes will appear here.</p>
      )}

      <p className="workspace-footnote">
        {document.modelContext
          ? getWebMcpStatusLabel()
          : 'Manual Mode | Browser Assistant not connected'}
      </p>
    </div>
  );
}
