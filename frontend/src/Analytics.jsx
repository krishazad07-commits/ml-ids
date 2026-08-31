import { useState, useEffect, useRef } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot,
} from 'recharts'
import './Analytics.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/* Honour the OS motion setting in JS — CSS media queries
   cannot reach Recharts' JavaScript-driven animations.   */
function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const on = e => setReduced(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/* rAF-driven count-up with an ease-out cubic curve. */
function useCountUp(target, duration = 1200, enabled = true) {
  const [v, setV] = useState(enabled ? 0 : target)
  const raf = useRef(null)

  useEffect(() => {
    if (!enabled) { setV(target); return }
    let start = null
    const step = t => {
      if (start === null) start = t
      const p = Math.min((t - start) / duration, 1)
      setV(target * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [target, duration, enabled])

  return v
}

function Metric({ k, value, fmt, tone = '', note, reduced }) {
  const v = useCountUp(value, 1200, !reduced)
  return (
    <div className={`met ${tone}`}>
      <div className="met-v">{fmt(v)}</div>
      <div className="label">{k}</div>
      {note && <div className="met-n">{note}</div>}
    </div>
  )
}

function ChartTip({ active, payload, label, unit = '' }) {
  if (!active || !payload?.length) return null
  return (
    <div className="tip">
      <div className="tip-k">{label}</div>
      {payload.map((p, i) => (
        <div className="tip-r" key={i}>
          <span>{p.name}</span>
          <b>{typeof p.value === 'number' ? p.value.toFixed(4) : p.value}{unit}</b>
        </div>
      ))}
    </div>
  )
}

export default function Analytics() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API}/analytics`)
        if (!res.ok) throw new Error(`/analytics returned HTTP ${res.status}`)
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch (e) {
        if (cancelled) return
        setError(
          e.message === 'Failed to fetch'
            ? `Cannot reach ${API} — is the FastAPI server running? (uvicorn app:app --reload)`
            : e.message || String(e)
        )
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (error) return <div className="error">{error}</div>
  if (!data) return <p className="sub">Loading analytics…</p>

  const cm = data.confusion_matrix
  const actualNormal = cm.true_negative  + cm.false_positive
  const actualAttack = cm.false_negative + cm.true_positive
  const pct = (n, d) => ((n / d) * 100).toFixed(1)

  // operating point: where threshold 0.46 sits on the ROC curve
  const opFpr = cm.false_positive / actualNormal
  const opTpr = cm.true_positive  / actualAttack

  const feats = [...data.feature_importance]
    .sort((a, b) => a.importance - b.importance)   // ascending → largest at top
  const top4 = [...data.feature_importance]
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 4)
  const top4Share = (top4.reduce((s, f) => s + f.importance, 0) * 100).toFixed(1)

  const cells = [
    { k: 'tn', big: cm.true_negative,  lab: 'True negative',  sub: `${pct(cm.true_negative,  actualNormal)}% of benign`, d: 0 },
    { k: 'fp', big: cm.false_positive, lab: 'False positive', sub: `${pct(cm.false_positive, actualNormal)}% of benign`, d: 70 },
    { k: 'fn', big: cm.false_negative, lab: 'False negative', sub: `${pct(cm.false_negative, actualAttack)}% of attacks`, d: 140 },
    { k: 'tp', big: cm.true_positive,  lab: 'True positive',  sub: `${pct(cm.true_positive,  actualAttack)}% of attacks`, d: 210 },
  ]

  const ANIM = reduced ? 0 : 1

  return (
    <div className="an">
      <div className="mets">
        <Metric k="Accuracy"  value={data.accuracy * 100}         fmt={v => v.toFixed(2) + '%'} reduced={reduced} note="held-out KDDTest+" />
        <Metric k="ROC-AUC"   value={data.roc_auc}                fmt={v => v.toFixed(4)}       reduced={reduced} tone="accent" note="threshold-independent" />
        <Metric k="Precision" value={data.precision_attack * 100} fmt={v => v.toFixed(2) + '%'} reduced={reduced} tone="accent" note="of flagged, truly attack" />
        <Metric k="Recall"    value={data.recall_attack * 100}    fmt={v => v.toFixed(2) + '%'} reduced={reduced} tone="warn"   note="of attacks, caught" />
        <Metric k="F1"        value={data.f1_attack}              fmt={v => v.toFixed(3)}       reduced={reduced} />
        <Metric k="Threshold" value={data.threshold}              fmt={v => v.toFixed(2)}       reduced={reduced} note="chosen on validation" />
      </div>

      {/* ── confusion matrix ─────────────────────── */}
      <div className="card">
        <h3>Confusion matrix</h3>
        <p className="note">
          {data.n_test_samples.toLocaleString()} held-out KDDTest+ connections at
          decision threshold {data.threshold}. Percentages are row-wise — the share
          of each <em>true</em> class, so each row sums to 100%.
        </p>

        <div className="cm-wrap">
          <div className="cm-axis-y label">Actual</div>
          <div>
            <div className="cm-heads">
              <span className="label">Predicted normal</span>
              <span className="label">Predicted attack</span>
            </div>
            <div className="cm">
              {cells.map(c => (
                <div
                  className={`cm-c ${c.k}`}
                  key={c.k}
                  style={{ '--d': `${reduced ? 0 : c.d}ms` }}
                >
                  <b>{c.big.toLocaleString()}</b>
                  <span>{c.sub}</span>
                  <em>{c.lab}</em>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="insight">
          <span className="insight-n">{(cm.false_negative / cm.false_positive).toFixed(0)}:1</span>
          <p>
            The model produces {cm.false_negative.toLocaleString()} false negatives
            for every {cm.false_positive.toLocaleString()} false positives — a
            roughly {(cm.false_negative / cm.false_positive).toFixed(0)}:1 asymmetry.
            This IDS is <b>quiet but incomplete</b>: it rarely cries wolf, but misses
            about a third of attacks.
          </p>
        </div>
      </div>

      {/* ── ROC curve ────────────────────────────── */}
      <div className="card">
        <h3>ROC curve<span className="feed-sub">AUC {data.roc_auc.toFixed(4)} · {data.roc_curve.length} sampled points</span></h3>
        <p className="note">
          True-positive rate against false-positive rate across every possible
          threshold. The dashed diagonal is a random classifier (AUC 0.5). The
          marked point is the deployed operating threshold of {data.threshold}.
        </p>

        <div className="chart" style={{ height: 340 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.roc_curve} margin={{ top: 8, right: 18, bottom: 24, left: 4 }}>
              <CartesianGrid stroke="#151d2a" strokeDasharray="2 4" />
              <XAxis
                dataKey="fpr" type="number" domain={[0, 1]}
                tickCount={6} stroke="#3d4859"
                tick={{ fill: '#6b7688', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                label={{ value: 'False positive rate', position: 'insideBottom', offset: -14, fill: '#4d5a6d', fontSize: 10 }}
              />
              <YAxis
                type="number" domain={[0, 1]}
                tickCount={6} stroke="#3d4859"
                tick={{ fill: '#6b7688', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                label={{ value: 'True positive rate', angle: -90, position: 'insideLeft', offset: 14, fill: '#4d5a6d', fontSize: 10 }}
              />
              <Tooltip content={<ChartTip />} cursor={{ stroke: '#2b3a4d' }} />
              <ReferenceLine
                segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]}
                stroke="#37445a" strokeDasharray="4 5"
              />
              <Line
                type="monotone" dataKey="tpr" name="TPR"
                stroke="#00e6a0" strokeWidth={2} dot={false}
                isAnimationActive={!reduced}
                animationDuration={1700}
                animationEasing="ease-out"
              />
              <ReferenceDot
                x={opFpr} y={opTpr} r={5}
                fill="#ff4d5e" stroke="#06080c" strokeWidth={2}
                isFront
                label={{
                  value: `t = ${data.threshold}`,
                  position: 'right', fill: '#ff8b95', fontSize: 10,
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="insight">
          <span className="insight-n">0.32</span>
          <p>
            The curve only reaches TPR = 1.0 at FPR ≈ 0.32 — catching <em>every</em>
            attack would mean false-alarming on roughly a third of all benign traffic.
            At the deployed point ({opFpr.toFixed(3)}, {opTpr.toFixed(3)}) the model
            gives up recall to keep the alert stream credible.
          </p>
        </div>
      </div>

      {/* ── feature importance ───────────────────── */}
      <div className="card">
        <h3>Feature importance<span className="feed-sub">XGBoost gain · {feats.length} selected features</span></h3>
        <p className="note">
          Total gain contributed by each of the {feats.length} features surviving
          selection. The top four account for {top4Share}% of the model's decisions.
        </p>

        <div className="chart" style={{ height: 620 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={feats} layout="vertical"
              margin={{ top: 4, right: 30, bottom: 4, left: 8 }}
              barCategoryGap={4}
            >
              <CartesianGrid stroke="#151d2a" strokeDasharray="2 4" horizontal={false} />
              <XAxis
                type="number" stroke="#3d4859"
                tick={{ fill: '#6b7688', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
              />
              <YAxis
                type="category" dataKey="feature" width={132} stroke="#3d4859"
                tick={{ fill: '#8593a8', fontSize: 10.5, fontFamily: 'JetBrains Mono, monospace' }}
              />
              <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,.03)' }} />
              <Bar
                dataKey="importance" name="gain"
                fill="#00e6a0" radius={[0, 2, 2, 0]}
                isAnimationActive={!reduced}
                animationDuration={1400}
                animationEasing="ease-out"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="insight">
          <span className="insight-n">4 / {feats.length}</span>
          <p>
            Every one of the top four — {top4.map((f, i) => (
              <span key={f.feature}>{i > 0 && ', '}<b>{f.feature}</b></span>
            ))} —
            is a <em>connection-statistics</em> feature. Nothing in NSL-KDD's feature
            space inspects payload or credentials, which independently explains why
            DoS and Probe attacks are caught near certainty while R2L and U2R attacks
            are missed systematically. That is a feature-space limitation, not a
            model-capacity one.
          </p>
        </div>
      </div>
    </div>
  )
}