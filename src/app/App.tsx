import { lazy, Suspense, useEffect, useState } from 'react';
import { ActivityPanel } from './ActivityPanel';
import { ConditionsPanel } from './ConditionsPanel';
import { HomePage } from './HomePage';
import { OnboardingPanel } from './OnboardingPanel';
import { ResultsPanel } from './ResultsPanel';
import { workspaceService } from '../domain/workspace-service';
import { useWorkspaceStore } from '../store/workspace-store';
import { WebMCPBridge } from '../webmcp/WebMCPBridge';
import { cancelPreferenceDraw } from '../map/drawing';
import { cityFromLocation } from '../domain/cities';

const MapView = lazy(() =>
  import('../map/MapView').then((module) => ({ default: module.MapView })),
);

function WorkspaceApp() {
  const requestedCityId = cityFromLocation();
  const initialized = useWorkspaceStore((state) => state.initialized);
  const operation = useWorkspaceStore((state) => state.operation);
  const error = useWorkspaceStore((state) => state.error);
  const metadata = useWorkspaceStore((state) => state.datasetMetadata);
  const office = useWorkspaceStore((state) => state.canonical.office);
  const conditionCount = useWorkspaceStore((state) => state.canonical.conditions.length);
  const hasResults = useWorkspaceStore((state) => state.canonical.combined);
  const [showActivity, setShowActivity] = useState(false);

  const currentStep = hasResults ? 3 : office && conditionCount >= 2 ? 2 : office ? 2 : 1;

  useEffect(() => {
    void workspaceService.initialize(requestedCityId);
  }, [requestedCityId]);

  useEffect(() => {
    if (!showActivity) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowActivity(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showActivity]);

  return (
    <main className="app-shell workspace-page">
      <WebMCPBridge />
      <header className="topbar">
        <a className="brand" href="/" aria-label="Groundwork home">
          <span className="brand-mark">G</span>
          <span>Groundwork</span>
        </a>
        <nav className="workflow-steps" aria-label="Planning progress">
          {['Destination', 'Priorities', 'Results'].map((label, index) => {
            const step = index + 1;
            return (
              <span
                key={label}
                className={step === currentStep ? 'current' : step < currentStep ? 'complete' : ''}
                aria-current={step === currentStep ? 'step' : undefined}
              >
                <i>{step}</i>
                {label}
              </span>
            );
          })}
        </nav>
        <div className="topbar-actions">
          <button type="button" className="quiet-button" onClick={() => setShowActivity(true)}>
            Workspace
          </button>
          <span
            className={`connection-indicator ${document.modelContext ? 'connected' : ''}`}
            title={
              document.modelContext
                ? 'Browser assistant connected'
                : `Manual mode • local data from ${metadata?.sources[0]?.extractDate ?? 'loading'}`
            }
          />
        </div>
      </header>
      <div className={`workspace-grid ${hasResults ? 'has-results' : ''}`}>
        <aside className="planner-sidebar" aria-label="Plan setup">
          <OnboardingPanel />
          {office ? <ConditionsPanel /> : null}
        </aside>
        <section className="map-region">
          {initialized ? (
            <Suspense fallback={<div className="map-loading">Loading map…</div>}>
              <MapView />
            </Suspense>
          ) : (
            <div className="map-loading">Loading map…</div>
          )}
          {operation === 'calculating' ? (
            <div className="calculation-pill" role="status">
              Calculating on this device…
            </div>
          ) : null}
          {operation === 'drawing' ? (
            <div className="drawing-pill" role="status">
              <span>Draw your preferred area. Double-click to finish.</span>
              <button type="button" onClick={() => cancelPreferenceDraw()}>
                Cancel
              </button>
            </div>
          ) : null}
        </section>
        {hasResults ? (
          <aside className="results-sidebar" aria-label="Matching areas">
            <ResultsPanel />
          </aside>
        ) : null}
      </div>
      {showActivity ? (
        <div
          className="drawer-backdrop"
          role="presentation"
          onMouseDown={() => setShowActivity(false)}
        >
          <aside
            className="workspace-drawer"
            aria-label="Workspace options"
            aria-modal="true"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="drawer-heading">
              <div>
                <p className="section-kicker">Current plan</p>
                <h2>Workspace</h2>
              </div>
              <button
                type="button"
                className="quiet-button"
                aria-label="Close workspace options"
                onClick={() => setShowActivity(false)}
              >
                Close
              </button>
            </div>
            <ActivityPanel />
          </aside>
        </div>
      ) : null}
      {!initialized && operation !== 'error' ? (
        <div className="boot-screen">
          <span className="brand-mark">G</span>
          <p>Preparing your map…</p>
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

export function App() {
  const isSharedWorkspace = window.location.hash.startsWith('#w=');
  return window.location.pathname.startsWith('/app') || isSharedWorkspace ? (
    <WorkspaceApp />
  ) : (
    <HomePage />
  );
}
