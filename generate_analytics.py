"""
One-time analytics computation for the AI-IDS dashboard.
Loads the frozen model + held-out test set, computes ROC points,
confusion matrix, and feature importances, saves to models/analytics.json
"""

import joblib
import json
import numpy as np
from sklearn.metrics import roc_curve, roc_auc_score, confusion_matrix, accuracy_score

THRESHOLD = 0.46

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

print("Loading artifacts...")
model = joblib.load("models/xgb_model_v1.pkl")
feature_selector = joblib.load("models/feature_selector.pkl")
X_test = joblib.load("models/X_test.pkl")
y_test = joblib.load("models/y_test.pkl")

X_test = np.asarray(X_test)
y_test = np.asarray(y_test).ravel()
print(f"Test set shape: {X_test.shape}, labels: {y_test.shape}")

# ── Predict once, reuse everywhere ──
probs = model.predict_proba(X_test)[:, 1]
preds = (probs >= THRESHOLD).astype(int)

accuracy = float(accuracy_score(y_test, preds))
auc = float(roc_auc_score(y_test, probs))
print(f"Accuracy @ {THRESHOLD}: {accuracy:.4f}")
print(f"ROC-AUC: {auc:.4f}")

# ── ROC curve, downsampled for the browser ──
fpr, tpr, thresholds = roc_curve(y_test, probs)
print(f"ROC curve has {len(fpr)} raw points")

MAX_POINTS = 200
if len(fpr) > MAX_POINTS:
    idx = np.linspace(0, len(fpr) - 1, MAX_POINTS).astype(int)
else:
    idx = np.arange(len(fpr))

roc_points = [
    {"fpr": round(float(fpr[i]), 5), "tpr": round(float(tpr[i]), 5)}
    for i in idx
]

# ── Confusion matrix at the locked threshold ──
tn, fp, fn, tp = confusion_matrix(y_test, preds).ravel()
print(f"TN={tn}  FP={fp}  FN={fn}  TP={tp}")

precision = float(tp / (tp + fp)) if (tp + fp) else 0.0
recall = float(tp / (tp + fn)) if (tp + fn) else 0.0
f1 = float(2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0

# ── Feature importances, mapped back to real names ──
mask = feature_selector.get_support()
selected_names = [name for name, keep in zip(FEATURE_COLUMNS, mask) if keep]
print(f"Selector kept {len(selected_names)} of {len(FEATURE_COLUMNS)} features")

importances = model.feature_importances_
if len(selected_names) != len(importances):
    raise ValueError(
        f"Name/importance mismatch: {len(selected_names)} names vs "
        f"{len(importances)} importances — selector and model disagree."
    )

feature_importance = sorted(
    [{"feature": n, "importance": round(float(v), 5)}
     for n, v in zip(selected_names, importances)],
    key=lambda d: d["importance"],
    reverse=True
)

# ── Assemble and save ──
analytics = {
    "threshold": THRESHOLD,
    "accuracy": round(accuracy, 4),
    "roc_auc": round(auc, 4),
    "precision_attack": round(precision, 4),
    "recall_attack": round(recall, 4),
    "f1_attack": round(f1, 4),
    "confusion_matrix": {
        "true_negative": int(tn),
        "false_positive": int(fp),
        "false_negative": int(fn),
        "true_positive": int(tp),
    },
    "roc_curve": roc_points,
    "feature_importance": feature_importance,
    "n_test_samples": int(len(y_test)),
}

with open("models/analytics.json", "w") as f:
    json.dump(analytics, f, indent=2)

print("\nSaved models/analytics.json")
print("Top 5 features:")
for d in feature_importance[:5]:
    print(f"  {d['feature']}: {d['importance']}")