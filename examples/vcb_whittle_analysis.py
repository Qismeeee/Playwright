import pandas as pd
import numpy as np
from math import gamma
import scipy.optimize as so
import xgboost as xgb
from sklearn.model_selection import train_test_split
import matplotlib.pyplot as plt

# --- Load data ---
path = "VCB_2015_2025.csv"  # update with actual path
col_price = "Lần cuối"
df = pd.read_csv(path, parse_dates=["Ngày"])
prices = df[col_price].astype(float).values

# Calculate raw price differences (no standardization)
diffs = np.diff(prices)

# --- Whittle estimator ---
def fspec_fgn(h, n):
    hhest = -((2 * h) + 1)
    const = np.sin(np.pi * h) * gamma(-hhest) / np.pi
    nhalfm = (n - 1) // 2
    dpl = 2 * np.pi * np.arange(1, nhalfm + 1) / n
    fspec = np.ones(nhalfm)
    for i in range(nhalfm):
        dpfi = 2 * np.pi * np.arange(200)
        fgi = np.abs(dpl[i] + dpfi) ** hhest
        fhi = np.abs(dpl[i] - dpfi) ** hhest
        dpfi = fgi + fhi
        dpfi[0] /= 2
        dpfi = (1 - np.cos(dpl[i])) * const * dpfi
        fspec[i] = np.sum(dpfi)
    fspec = fspec / np.exp(2 * np.sum(np.log(fspec)) / n)
    return fspec

def whittlefunc(h, gammahat, n):
    gammatheo = fspec_fgn(h, n)
    qml = gammahat / gammatheo
    return 2 * (2 * np.pi / n) * np.sum(qml)

def whittle(data):
    n = len(data)
    nhalfm = (n - 1) // 2
    tmp = np.abs(np.fft.fft(data))
    gammahat = np.exp(2 * np.log(tmp[1:nhalfm + 1])) / (2 * np.pi * n)
    func = lambda H: whittlefunc(H, gammahat, n)
    return so.fminbound(func, 0, 1)

hurst = whittle(diffs)
print("Initial Hurst exponent:", hurst)

# --- Build dataset for XGBoost ---
look_back = 60
X, y = [], []
for i in range(len(diffs) - look_back):
    X.append(diffs[i : i + look_back])
    y.append(diffs[i + look_back])
X = np.array(X)
y = np.array(y)

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, shuffle=False)

dtrain = xgb.DMatrix(X_train, label=y_train)
dtest = xgb.DMatrix(X_test)

params = {
    "objective": "reg:squarederror",
    "eta": 0.05,
    "max_depth": 4,
    "subsample": 0.7,
    "colsample_bytree": 0.7,
}
model = xgb.train(params, dtrain, num_boost_round=200)

pred_mean = model.predict(dtest)
residuals = y_test - pred_mean
pred_scale = np.std(residuals)

# --- Simulate future paths ---
num_samples = 100
rng = np.random.default_rng()
paths = []
for _ in range(num_samples):
    noise = rng.standard_normal(len(pred_mean)) * pred_scale
    paths.append(pred_mean + noise)
paths = np.array(paths)

# --- Metrics ---
hurst_forecasts = [whittle(p) for p in paths]
std_diffs = np.std(np.diff(paths, axis=1), axis=1)
print("Mean forecast Hurst:", np.mean(hurst_forecasts))
print("STD of forecast diffs:", np.mean(std_diffs))

quantile_levels = [0.50, 0.84, 0.95, 0.99]
quantiles = np.quantile(paths, quantile_levels, axis=0)
true_series = y_test
q_errors = np.abs(quantiles - true_series)
print("Quantile MAE (50%, 84%, 95%, 99%):", q_errors.mean(axis=1))

# --- Plot ---
plt.figure(figsize=(12, 6))
plt.plot(true_series, label="common")
plt.plot(true_series, label="quantile 0.50 ground truth")
plt.plot(quantiles[0], label="quantile 0.50 predicted")
plt.plot(true_series, label="quantile 0.84 ground truth")
plt.plot(quantiles[1], label="quantile 0.84 predicted")
plt.plot(true_series, label="quantile 0.95 ground truth")
plt.plot(quantiles[2], label="quantile 0.95 predicted")
plt.plot(true_series, label="quantile 0.99 ground truth")
plt.plot(quantiles[3], label="quantile 0.99 predicted")
plt.legend()
plt.xlabel("Time step")
plt.ylabel("Price diff")
plt.title("VCB Forecast Quantiles")
plt.show()
