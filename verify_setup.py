import joblib, json, os

REQUIRED = [
    "encoders.pkl",
    "scaler.pkl",
    "feature_selector.pkl",
    "xgb_model_v1.pkl",
    "threshold.json",
]

for name in REQUIRED:
    path = os.path.join("models", name)
    if not os.path.exists(path):
        print("MISSING:", path)
        continue
    if name.endswith(".json"):
        with open(path) as f:
            obj = json.load(f)
    else:
        obj = joblib.load(path)
    print("OK:", name, "->", type(obj).__name__)

enc = joblib.load(os.path.join("models", "encoders.pkl"))
print("encoder keys:", list(enc.keys()))
for col, e in enc.items():
    print(f"  {col}: {len(e.classes_)} classes")