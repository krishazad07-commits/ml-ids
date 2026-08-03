import { useState, useEffect } from 'react'
import LiveMonitor from './LiveMonitor'
import Analytics from './Analytics'
import './App.css'

const TABS = [
  { id: 'live',      label: 'Live Monitor'    },
  { id: 'analytics', label: 'Model Analytics' },
]

export default function App() {
  const [tab, setTab] = useState('live')
  const [clock, setClock] = useState(() => new Date())

  // ticking UTC clock in the header — pure chrome, but it's the
  // single cheapest thing that makes a dashboard read as "live"
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const tabIndex = TABS.findIndex(t => t.id === tab)

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <h1>ML-IDS<span>/ NSL-KDD</span></h1>
            <p>XGBoost classifier · 21 features · decision threshold 0.46</p>
          </div>
        </div>

        <div className="readouts">
          <Readout label="Model"  value="xgb_model_v1" />
          <Readout label="Corpus" value="KDDTest+ · 22,544" />
          <Readout label="UTC"    value={clock.toISOString().slice(11, 19)} />
        </div>
      </header>

      <nav
        className="tabs"
        style={{ '--tab-index': tabIndex, '--tab-count': TABS.length }}
      >
        {TABS.map(t => (
          <button
            key={t.id}
            className={t.id === tab ? 'tab active' : 'tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <span className="tab-indicator" />
      </nav>

      {/* key={tab} forces React to throw away the old subtree and mount
          a fresh one, which re-fires the .stage entry animation.
          It is ALSO what unmounts LiveMonitor and runs its interval
          cleanup — the behaviour you already verified on Day 3. */}
      <main key={tab} className="stage">
        {tab === 'live' ? <LiveMonitor /> : <Analytics />}
      </main>
    </div>
  )
}

function Readout({ label, value }) {
  return (
    <div className="readout">
      <span className="label">{label}</span>
      <span className="v">{value}</span>
    </div>
  )
}