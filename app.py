# ═══════════════════════════════════════════════
# app.py — AI-IDS Prediction API
# ═══════════════════════════════════════════════
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib
import pandas as pd
import random
import json

# ── 1. Load all saved artifacts ONCE, when the server starts ──
encoders          = joblib.load("models/encoders.pkl")
scaler            = joblib.load("models/scaler.pkl")
feature_selector  = joblib.load("models/feature_selector.pkl")
model             = joblib.load("models/xgb_model_v1.pkl")

THRESHOLD = 0.46  # locked from Day 3 validation-based tuning

# Column order MUST match training exactly — 41 raw features
FEATURE_COLUMNS = [
    'duration','protocol_type','service','flag','src_bytes','dst_bytes',
    'land','wrong_fragment','urgent','hot','num_failed_logins','logged_in',
    'num_compromised','root_shell','su_attempted','num_root','num_file_creations',
    'num_shells','num_access_files','num_outbound_cmds','is_host_login',
    'is_guest_login','count','srv_count','serror_rate','srv_serror_rate',
    'rerror_rate','srv_rerror_rate','same_srv_rate','diff_srv_rate',
    'srv_diff_host_rate','dst_host_count','dst_host_srv_count',
    'dst_host_same_srv_rate','dst_host_diff_srv_rate','dst_host_same_src_port_rate',
    'dst_host_srv_diff_host_rate','dst_host_serror_rate','dst_host_srv_serror_rate',
    'dst_host_rerror_rate','dst_host_srv_rerror_rate'
]

app = FastAPI(title="AI-IDS Prediction API")
# ── Allow the React dev server to call this API from a different port ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Load the held-out test set ONCE for traffic replay ──
NSL_COLUMNS = FEATURE_COLUMNS + ['label', 'difficulty']
test_df = pd.read_csv("data/KDDTest+.txt", names=NSL_COLUMNS)
print(f"[startup] Loaded {len(test_df)} test records for simulation")

# ── 2. The shape of a valid incoming request ───────────────────
class Connection(BaseModel):
    duration: float
    protocol_type: str
    service: str
    flag: str
    src_bytes: float
    dst_bytes: float
    land: float
    wrong_fragment: float
    urgent: float
    hot: float
    num_failed_logins: float
    logged_in: float
    num_compromised: float
    root_shell: float
    su_attempted: float
    num_root: float
    num_file_creations: float
    num_shells: float
    num_access_files: float
    num_outbound_cmds: float
    is_host_login: float
    is_guest_login: float
    count: float
    srv_count: float
    serror_rate: float
    srv_serror_rate: float
    rerror_rate: float
    srv_rerror_rate: float
    same_srv_rate: float
    diff_srv_rate: float
    srv_diff_host_rate: float
    dst_host_count: float
    dst_host_srv_count: float
    dst_host_same_srv_rate: float
    dst_host_diff_srv_rate: float
    dst_host_same_src_port_rate: float
    dst_host_srv_diff_host_rate: float
    dst_host_serror_rate: float
    dst_host_srv_serror_rate: float
    dst_host_rerror_rate: float
    dst_host_srv_rerror_rate: float

# ── 3. raw input -> model-ready features, in training order ────
def preprocess(conn: Connection):
    row = pd.DataFrame([conn.model_dump()], columns=FEATURE_COLUMNS)

    # Encode categoricals with the SAME encoders fit during training
    for col in ['protocol_type', 'service', 'flag']:
        try:
            row[col] = encoders[col].transform(row[col])
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Unrecognized value for '{col}': "
                       f"'{row[col].iloc[0]}' was never seen during training."
            )

    # Scale with the SAME scaler fit during training (41 features, 0-1 range)
    row_scaled = pd.DataFrame(scaler.transform(row), columns=FEATURE_COLUMNS)

    # Reduce 41 -> 21 features using the SAME selector fit during training
    row_selected = feature_selector.transform(row_scaled)

    return row_selected

# ── 4. The prediction endpoint ───────────────────────────────────
@app.post("/predict")
def predict(conn: Connection):
    X = preprocess(conn)
    attack_probability = float(model.predict_proba(X)[0][1])
    is_attack = attack_probability >= THRESHOLD

    return {
        "prediction": "attack" if is_attack else "normal",
        "attack_probability": round(attack_probability, 4),
        "threshold_used": THRESHOLD
    }

@app.get("/")
def root():
    return {"status": "AI-IDS API is running", "docs_url": "/docs"}
# ── 5. Simulated traffic replay ──────────────────────────────────
@app.get("/simulate")
def simulate(n: int = 5):
    """Replay n random held-out test records through the live pipeline."""
    if n < 1 or n > 50:
        raise HTTPException(status_code=400, detail="n must be between 1 and 50")

    records = []
    skipped = 0

    for _ in range(n):
        idx = random.randrange(len(test_df))
        row = test_df.iloc[idx]

        conn_dict = {}
        for col in FEATURE_COLUMNS:
            if col in ('protocol_type', 'service', 'flag'):
                conn_dict[col] = str(row[col])
            else:
                conn_dict[col] = float(row[col])

        try:
            conn = Connection(**conn_dict)
            X = preprocess(conn)
        except HTTPException:
            skipped += 1
            continue

        prob = float(model.predict_proba(X)[0][1])
        prediction = "attack" if prob >= THRESHOLD else "normal"
        true_label = "normal" if row['label'] == "normal" else "attack"

        records.append({
            "row_id": int(idx),
            "protocol_type": str(row['protocol_type']),
            "service": str(row['service']),
            "flag": str(row['flag']),
            "src_bytes": float(row['src_bytes']),
            "dst_bytes": float(row['dst_bytes']),
            "prediction": prediction,
            "attack_probability": round(prob, 4),
            "true_label": true_label,
            "attack_type": str(row['label']),
            "correct": prediction == true_label,
        })

    return {"count": len(records), "skipped": skipped, "records": records}
# ── 6. Precomputed model analytics ───────────────────────────────
@app.get("/analytics")
def analytics():
    """Serve precomputed evaluation metrics for the dashboard."""
    try:
        with open("models/analytics.json") as f:
            return json.load(f)
    except FileNotFoundError:
        raise HTTPException(
            status_code=503,
            detail="analytics.json not found — run generate_analytics.py first."
        )