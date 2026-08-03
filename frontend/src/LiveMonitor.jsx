import { useState, useEffect, useRef, useCallback } from 'react'
import './LiveMonitor.css'

const API         = 'http://localhost:8000'
const BATCH       = 3       // rows per poll
const INTERVAL_MS = 2000    // poll period
const MAX_ROWS    = 50      // feed buffer cap
const THRESHOLD   = 0.46

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

const LABEL = {
  tp: 'CAUGHT',
  tn: 'CLEAN',
  fn: 'MISSED',
  fp: 'FALSE ALARM',
}

const isAttack = v => String(v).toLowerCase().includes('attack')

/* Derive the confusion-matrix cell from `prediction` + `correct`.
   Deliberately does NOT parse `true_label`, so it stays correct
   whether the API encodes labels as strings or as 0/1.          */
function classify(r) {
  const predictedAttack = isAttack(r.prediction)
  if (r.correct) return predictedAttack ? 'tp' : 'tn'
  return predictedAttack ? 'fp' : 'fn'
}

/* ── rolling odometer ──────────────────────────────
   Digits roll; any non-digit character (%, ., —)
   is rendered static.                                */
function Odometer({ value }) {
  const chars = String(value).split('')
  return (
    <span className="odo">
      {chars.map((c, i) =>
        /\d/.test(c) ? (
          <span className="odo-d" key={i}>
            <span
              className="odo-col"
              style={{ transform: `translateY(-${Number(c)}em)` }}
            >
              {DIGITS.map(d => <span key={d}>{d}</span>)}
            </span>
          </span>
        ) : (
          <span className="odo-s" key={i}>{c}</span>
        )
      )}
    </span>
  )
}

function Stat({ k, v, tone = '' }) {
  return (
    <div className={`stat ${tone}`}>
      <div className="stat-v"><Odometer value={v} /></div>
      <div className="label">{k}</div>
    </div>
  )
}

function Row({ r }) {
  const p = Number(r.attack_probability)
  return (
    <tr className={`row ${r._v}`} style={{ '--d': `${r._delay}ms` }}>
      <td className="seq">{String(r._seq).padStart(4, '0')}</td>
      <td>{r.protocol_type}</td>
      <td className="svc">{r.service}</td>
      <td>{r.flag}</td>
      <td className="r">{Number(r.src_bytes).toLocaleString()}</td>
      <td className="r">{Number(r.dst_bytes).toLocaleString()}</td>
      <td>
        <div className="pcell">
          <span className="ptrack">
            <span
              className={`pfill ${p >= THRESHOLD ? 'hi' : 'lo'}`}
              style={{ width: `${Math.min(p, 1) * 100}%` }}
            />
          </span>
          <span className="pnum">{p.toFixed(4)}</span>
        </div>
      </td>
      <td className={isAttack(r.prediction) ? 'pred atk' : 'pred nrm'}>
        {r.prediction}
      </td>
      <td className="actual">
        {r.attack_type || (isAttack(r.true_label) ? 'attack' : 'normal')}
      </td>
      <td><span className={`badge ${r._v}`}>{LABEL[r._v]}</span></td>
    </tr>
  )
}

const ZERO = { tp: 0, tn: 0, fp: 0, fn: 0, skipped: 0 }

export default function LiveMonitor() {
  const [running, setRunning] = useState(false)
  const [rows, setRows]       = useState([])
  const [stats, setStats]     = useState(ZERO)
  const [error, setError]     = useState(null)
  const [flash, setFlash]     = useState(false)

  const seqRef   = useRef(0)
  const flashRef = useRef(null)

  const ingest = useCallback(data => {
    const records = data.records || []
    if (records.length === 0) return

    const stamped = records.map((r, i) => ({
      ...r,
      _seq: ++seqRef.current,
      _delay: i * 90,        // frozen at arrival — never recomputed
      _v: classify(r),
    }))

    setRows(prev => [...stamped, ...prev].slice(0, MAX_ROWS))

    setStats(s => {
      const next = { ...s }
      stamped.forEach(r => { next[r._v] += 1 })
      next.skipped += data.skipped || 0
      return next
    })

    // threat flash — only on a genuine false negative
    if (stamped.some(r => r._v === 'fn')) {
      setFlash(true)
      clearTimeout(flashRef.current)
      flashRef.current = setTimeout(() => setFlash(false), 900)
    }
  }, [])

  useEffect(() => {
    if (!running) return

    let cancelled = false

    async function poll() {
      try {
        const res = await fetch(`${API}/simulate?n=${BATCH}`)
        if (!res.ok) throw new Error(`/simulate returned HTTP ${res.status}`)
        const data = await res.json()
        if (cancelled) return
        ingest(data)
      } catch (e) {
        if (cancelled) return
        setError(e.message || String(e))
        setRunning(false)
      }
    }

    poll()                                   // fire at once, don't wait 2s
    const id = setInterval(poll, INTERVAL_MS)

    // cleanup: runs on Stop AND on unmount (tab switch)
    return () => { cancelled = true; clearInterval(id) }
  }, [running, ingest])

  // clear the pending flash timer if the component goes away mid-flash
  useEffect(() => () => clearTimeout(flashRef.current), [])

  const seen = stats.tp + stats.tn + stats.fp + stats.fn
  const acc  = seen ? ((stats.tp + stats.tn) / seen * 100).toFixed(1) + '%' : '––'

  function reset() {
    setRows([])
    setStats(ZERO)
    setError(null)
    seqRef.current = 0
  }

  const statusClass = running ? 'live' : error ? 'bad' : ''
  const statusText  = running
    ? `live · polling /simulate every ${INTERVAL_MS / 1000}s`
    : error ? 'halted on error' : 'idle'

  return (
    <div className={`lm${flash ? ' flash' : ''}`}>
      <div className="lm-bar">
        <button
          className={`btn ${running ? 'stop' : 'go'}`}
          onClick={() => { setError(null); setRunning(r => !r) }}
        >
          {running ? '■ Stop' : '▶ Start monitoring'}
        </button>

        <button className="btn ghost" onClick={reset} disabled={running}>
          Reset
        </button>

        <span className={`status ${statusClass}`}>
          <span className="dot" />{statusText}
        </span>

        <span className="lm-spacer" />

        <span className="lm-meta">
          batch {BATCH} · buffer {rows.length}/{MAX_ROWS} · skipped {stats.skipped}
        </span>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="stats">
        <Stat k="Seen"         v={seen}     />
        <Stat k="Caught"       v={stats.tp} tone="tp" />
        <Stat k="Missed"       v={stats.fn} tone="fn" />
        <Stat k="False alarms" v={stats.fp} tone="fp" />
        <Stat k="Clean"        v={stats.tn} tone="tn" />
        <Stat k="Accuracy"     v={acc}      />
      </div>

      <div className="card feed">
        <h3>
          Traffic feed
          <span className="feed-sub">
            replay of held-out KDDTest+ · newest first · capped at {MAX_ROWS}
          </span>
        </h3>

        <div className="feed-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>proto</th>
                <th>service</th>
                <th>flag</th>
                <th className="r">src_bytes</th>
                <th className="r">dst_bytes</th>
                <th>p(attack)</th>
                <th>predicted</th>
                <th>actual</th>
                <th>verdict</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr className="empty">
                  <td colSpan={10}>No traffic yet — press Start monitoring.</td>
                </tr>
              )}
              {rows.map(r => <Row key={r._seq} r={r} />)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}