import { lazy, Suspense, useEffect } from 'react';
import { ActivityPanel } from './ActivityPanel';
import { ConditionsPanel } from './ConditionsPanel';
import { OnboardingPanel } from './OnboardingPanel';
import { ResultsPanel } from './ResultsPanel';
import { workspaceService } from '../domain/workspace-service';
import { useWorkspaceStore } from '../store/workspace-store';
import { WebMCPBridge } from '../webmcp/WebMCPBridge';

const MapView = lazy(() =>
  import('../map/MapView').then((module) => ({ default: module.MapView })),
);

export function App() {
  const initialized = useWorkspaceStore((state) => state.initialized);
  const operation = useWorkspaceStore((state) => state.operation);
  const error = useWorkspaceStore((state) => state.error);

  useEffect(() => {
    void workspaceService.initialize();
  }, []);

  return (
    <main className="app-shell">
      <WebMCPBridge />
      <header className="topbar">
        <a className="brand" href="/" aria-label="Groundwork home">
          <span className="brand-mark">G</span>
          <span>Groundwork</span>
        </a>
        <div className="topbar-status">
          <span className={`status-dot ${document.modelContext ? 'connected' : ''}`} />
          {document.modelContext ? 'WebMCP connected' : 'Manual mode'}
        </div>
      </header>
      <div className="workspace-grid">
        <aside className="sidebar left-sidebar">
          <OnboardingPanel />
          <ConditionsPanel />
        </aside>
        <section className="map-region">
          <Suspense fallback={<div className="map-loading">Loading map…</div>}>
            <MapView />
          </Suspense>
          {operation === 'calculating' ? (
            <div className="calculation-pill" role="status">
              Calculating on this device…
            </div>
          ) : null}
          {operation === 'drawing' ? (
            <div className="drawing-pill" role="status">
              Click to draw a boundary. Double-click to finish.
            </div>
          ) : null}
        </section>
        <aside className="sidebar right-sidebar">
          <ResultsPanel />
          <ActivityPanel />
        </aside>
      </div>
      {!initialized && operation !== 'error' ? (
        <div className="boot-screen">
          <span className="brand-mark">G</span>
          <p>Loading the San Francisco workspace…</p>
        </div>
      ) : null}
      {error ? (
        <div className="error-toast" role="alert">
          {error}
        </div>
      ) : null}
    </main>
  );
}
