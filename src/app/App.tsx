import { lazy, Suspense, useEffect, useRef, useState } from 'react';
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
  const topbarRef = useRef<HTMLElement>(null);
  const workspaceGridRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const workspaceButtonRef = useRef<HTMLButtonElement>(null);

  const currentStep = hasResults ? 3 : office && conditionCount >= 2 ? 2 : office ? 2 : 1;

  useEffect(() => {
    const initializeWorkspace = () => {
      setShowActivity(false);
      void workspaceService.initialize(requestedCityId);
    };
    initializeWorkspace();
    window.addEventListener('hashchange', initializeWorkspace);
    return () => window.removeEventListener('hashchange', initializeWorkspace);
  }, [requestedCityId]);

  useEffect(() => {
    if (!showActivity) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const outside = [topbarRef.current, workspaceGridRef.current].filter(
      (element): element is HTMLElement => Boolean(element),
    );
    outside.forEach((element) => {
      element.inert = true;
    });
    drawerCloseRef.current?.focus();
    const handleDialogKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowActivity(false);
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = [
        ...drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleDialogKey);
    return () => {
      window.removeEventListener('keydown', handleDialogKey);
      outside.forEach((element) => {
        element.inert = false;
      });
      previousFocus?.focus();
    };
  }, [showActivity]);

  return (
    <main className="app-shell workspace-page">
      <WebMCPBridge />
      <header ref={topbarRef} className="topbar">
        <a className="brand" href="/" aria-label="SweetSpot home">
          <span className="brand-mark">S</span>
          <span>SweetSpot</span>
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
          <button
            ref={workspaceButtonRef}
            type="button"
            className="quiet-button"
            onClick={() => setShowActivity(true)}
          >
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
      <div ref={workspaceGridRef} className={`workspace-grid ${hasResults ? 'has-results' : ''}`}>
        <aside className="planner-sidebar" aria-label="Plan setup">
          <OnboardingPanel />
          {office ? <ConditionsPanel /> : null}
        </aside>
        <section className="map-region">
          {initialized ? (
            <Suspense fallback={<div className="map-loading">Loading map…</div>}>
              <MapView />
            </Suspense>
          ) : operation === 'error' ? (
            <div className="map-error initialization-error" role="alert">
              <strong>Map data could not be prepared</strong>
              <span>{error ?? 'The local analysis dataset failed to load.'}</span>
              <button
                type="button"
                onClick={() => void workspaceService.initialize(requestedCityId)}
              >
                Retry data
              </button>
            </div>
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
            ref={drawerRef}
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
                ref={drawerCloseRef}
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
          <span className="brand-mark">S</span>
          <p>Preparing your map…</p>
        </div>
      ) : null}
      {error && initialized ? (
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
