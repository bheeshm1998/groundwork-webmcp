import { useState } from 'react';
import { CITIES, DEFAULT_CITY_ID, type CityId } from '../domain/cities';

const outcomes = [
  {
    number: '01',
    title: 'Add your destinations',
    description: 'Choose up to four places you need to reach regularly.',
  },
  {
    number: '02',
    title: 'Add your priorities',
    description: 'Mix travel modes with a curated set of nearby place categories.',
  },
  {
    number: '03',
    title: 'Compare the best areas',
    description: 'See the overlap and review three balanced options.',
  },
];

export function HomePage() {
  const [cityId, setCityId] = useState<CityId>(DEFAULT_CITY_ID);
  const city = CITIES[cityId];

  return (
    <main className="landing-page">
      <header className="landing-header">
        <a className="brand brand-dark" href="/" aria-label="SweetSpot home">
          <span className="brand-mark">S</span>
          <span>SweetSpot</span>
        </a>
        <nav className="landing-nav" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a className="header-launch" href={`/app?city=${cityId}`}>
            Open planner
          </a>
        </nav>
      </header>

      <section className="hero-section">
        <div className="hero-copy">
          <p className="hero-kicker">A shared map for you and your AI assistant</p>
          <h1>Find the neighborhood where your whole life fits.</h1>
          <p className="hero-description">
            Turn commutes, daily essentials, and the places you love into one honest, explorable
            shortlist. Plan by hand or let ChatGPT work directly on the map with you.
          </p>
          <div className="hero-proof" aria-label="Product highlights">
            <span>Real street-network times</span>
            <span>Private, on-device analysis</span>
            <span>Native WebMCP collaboration</span>
          </div>
          <div className="city-picker" id="choose-city" aria-labelledby="city-picker-label">
            <span id="city-picker-label">Choose your city</span>
            <div className="city-options">
              {(Object.values(CITIES) as Array<(typeof CITIES)[CityId]>).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={cityId === option.id ? 'city-option selected' : 'city-option'}
                  aria-pressed={cityId === option.id}
                  onClick={() => setCityId(option.id)}
                >
                  <strong>{option.name}</strong>
                  <span>{option.country}</span>
                </button>
              ))}
            </div>
            <a className="primary-link" href={`/app?city=${cityId}`}>
              Start planning in {city.name}
            </a>
          </div>
        </div>
        <div className="hero-product" aria-label="SweetSpot collaborative planning preview">
          <div className="preview-topbar">
            <span className="preview-brand">SweetSpot</span>
            <span className="preview-live">Agent connected</span>
          </div>
          <div className="preview-map">
            <div className="preview-street street-one" />
            <div className="preview-street street-two" />
            <div className="preview-street street-three" />
            <div className="preview-region region-one" />
            <div className="preview-region region-two" />
            <span className="preview-pin pin-one">1</span>
            <span className="preview-pin pin-two">2</span>
            <span className="preview-pin pin-three">3</span>
            <div className="preview-agent-card">
              <span className="agent-spark" aria-hidden="true" />
              <div>
                <small>ChatGPT is working</small>
                <strong>Comparing three distinct neighborhoods</strong>
              </div>
            </div>
          </div>
          <div className="preview-results">
            <span>
              <i>1</i>
              <strong>Best balance</strong>
              <small>All priorities fit</small>
            </span>
            <span>
              <i>2</i>
              <strong>Strong alternative</strong>
              <small>More space to commute</small>
            </span>
            <span>
              <i>3</i>
              <strong>Different neighborhood</strong>
              <small>A real second option</small>
            </span>
          </div>
        </div>
      </section>

      <section className="how-it-works" id="how-it-works" aria-labelledby="how-heading">
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
          <p className="section-kicker">Designed for decisions, not demos</p>
          <h2>Your assistant can calculate. You still get the final say.</h2>
        </div>
        <a className="primary-link" href={`/app?city=${cityId}`}>
          Build my shortlist
        </a>
      </section>

      <footer className="landing-footer">
        <a className="brand brand-dark" href="/" aria-label="SweetSpot home">
          <span className="brand-mark">S</span>
          <span>SweetSpot</span>
        </a>
        <p>A planning aid for San Francisco and Hyderabad—not a housing listing service.</p>
      </footer>
    </main>
  );
}
