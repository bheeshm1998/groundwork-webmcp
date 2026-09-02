const outcomes = [
  {
    number: '01',
    title: 'Set your destination',
    description: 'Choose the place you need to reach regularly.',
  },
  {
    number: '02',
    title: 'Add your priorities',
    description: 'Pick comfortable times for cycling, groceries, and parks.',
  },
  {
    number: '03',
    title: 'Compare the best areas',
    description: 'See the overlap and review three balanced options.',
  },
];

export function HomePage() {
  return (
    <main className="landing-page">
      <header className="landing-header">
        <a className="brand brand-dark" href="/" aria-label="Groundwork home">
          <span className="brand-mark">G</span>
          <span>Groundwork</span>
        </a>
        <a className="header-link" href="/app">
          Open planner
        </a>
      </header>

      <section className="hero-section">
        <div className="hero-copy">
          <p className="hero-kicker">Neighborhood planning for San Francisco</p>
          <h1>Find a place that fits your everyday life.</h1>
          <p className="hero-description">
            Combine your commute, grocery, and park preferences to discover the parts of the city
            that work for you.
          </p>
          <a className="primary-link" href="/app">
            Start planning
          </a>
          <p className="hero-note">Free to use. No account needed.</p>
        </div>

        <div className="hero-preview" aria-label="Example Groundwork result">
          <div className="preview-toolbar">
            <span className="preview-window-label">Your search</span>
            <span className="preview-status">3 matches</span>
          </div>
          <div className="preview-body">
            <div className="preview-priorities">
              <span className="preview-pin" />
              <div>
                <small>Destination</small>
                <strong>San Francisco City Hall</strong>
              </div>
              <div className="preview-rule" />
              <div className="preview-priority-row">
                <span className="condition-swatch bike" />
                <span>Bike commute</span>
                <strong>25 min</strong>
              </div>
              <div className="preview-priority-row">
                <span className="condition-swatch grocery" />
                <span>Groceries</span>
                <strong>10 min</strong>
              </div>
              <div className="preview-priority-row">
                <span className="condition-swatch park" />
                <span>Park</span>
                <strong>8 min</strong>
              </div>
            </div>
            <div className="preview-result">
              <span className="result-glow result-glow-one" />
              <span className="result-glow result-glow-two" />
              <div className="preview-match-card">
                <small>Best match</small>
                <strong>Civic Center</strong>
                <span>All three priorities are within reach</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="how-it-works" aria-labelledby="how-heading">
        <div className="section-intro">
          <p className="section-kicker">How it works</p>
          <h2 id="how-heading">From preferences to a shortlist in three steps.</h2>
        </div>
        <div className="outcome-grid">
          {outcomes.map((outcome) => (
            <article key={outcome.number} className="outcome-card">
              <span>{outcome.number}</span>
              <h3>{outcome.title}</h3>
              <p>{outcome.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="closing-cta">
        <div>
          <p className="section-kicker">Make the trade-offs visible</p>
          <h2>Start with the place you need to reach.</h2>
        </div>
        <a className="primary-link" href="/app">
          Open Groundwork
        </a>
      </section>

      <footer className="landing-footer">
        <a className="brand brand-dark" href="/" aria-label="Groundwork home">
          <span className="brand-mark">G</span>
          <span>Groundwork</span>
        </a>
        <p>A planning aid for San Francisco—not a housing listing service.</p>
      </footer>
    </main>
  );
}
