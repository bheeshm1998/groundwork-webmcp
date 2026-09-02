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
  const [cityId, setCityId] = useState<CityId>(DEFAULT_CITY_ID);
  const city = CITIES[cityId];

  return (
    <main className="landing-page">
      <header className="landing-header">
        <a className="brand brand-dark" href="/" aria-label="SweetSpot home">
          <span className="brand-mark">S</span>
          <span>SweetSpot</span>
        </a>
      </header>

      <section className="hero-section">
        <div className="hero-copy">
          <p className="hero-kicker">Neighborhood planning for San Francisco and Hyderabad</p>
          <h1>Find places that fits your preferences</h1>
          <div className="city-picker" id="choose-city" aria-labelledby="city-picker-label">
            <br></br>
            <br></br>
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
              Plan in {city.name}
            </a>
          </div>
        </div>

        <div className="hero-preview" aria-label="Example SweetSpot result">
          <div className="preview-toolbar">
            <span className="preview-window-label">Your search</span>
            <span className="preview-status">3 matches</span>
          </div>
          <div className="preview-body">
            <div className="preview-priorities">
              <span className="preview-pin" />
              <div>
                <small>Destination</small>
                <strong>{city.sampleOffice.label}</strong>
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
                <strong>{cityId === 'sf' ? 'Civic Center' : 'Ramanthapur'}</strong>
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
import { useState } from 'react';
import { CITIES, DEFAULT_CITY_ID, type CityId } from '../domain/cities';
