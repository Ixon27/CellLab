"""Fit nuclear-count regressors on LIVECell A172 non-D wells; predict every row.

Usage: python fit.py CACHE      (reads CACHE/fields.npz, writes CACHE/predictions.csv)

Everything fitted (normalisation, feature thresholds, ridge penalties, network
weights) uses only rows with line == A172 and well row letter != D. The A172
row-D wells ("within") and all A549 wells ("transfer") are never used for
fitting, tuning, early stopping or hyperparameter selection. Epochs, learning
rate and architecture are fixed constants chosen a priori.

Models (all fitted with errors on the log1p count scale):
  cnn      small CPU conv net on the image alone; pooled nonnegative responses
           predict a total for a fixed field of view, not nuclear locations.
  texture  ridge on calibrated multi-scale edge/blob/spectral image statistics.
  clock    ridge on elapsed hours only (hours, hours^2): a growth-curve baseline.
"""
import csv
import re
import sys
from pathlib import Path

import numpy as np
import torch
from scipy import ndimage
from torch import nn

SEED = 0
EPOCHS = 40
BATCH = 32
LR = 2e-3
WEIGHT_DECAY = 1e-4
ALPHAS = np.logspace(-3, 3, 13)  # ridge grid, selected by well-grouped CV on train only
CV_FOLDS = 5
SIGMAS = (1.0, 2.0, 4.0)
EDGE_QUANTILES = (0.5, 0.75, 0.9, 0.97)  # thresholds calibrated on train gradients
RADIAL_BANDS = 6
COLUMNS = ["line", "well", "filename", "hours", "count", "split", "cnn", "texture", "clock"]


def well_row(well):
    m = re.fullmatch(r"\s*([A-Za-z])\d+\s*", str(well))
    if not m:
        raise ValueError(f"cannot parse plate row from well {well!r}")
    return m.group(1).upper()


def load(cache):
    d = np.load(cache / "fields.npz", allow_pickle=False)
    images = d["images"]
    if images.ndim != 3 or images.dtype != np.uint8:
        raise ValueError(f"images must be uint8 N,H,W; got {images.dtype} {images.shape}")
    line, well, fname = (d[k].astype(str) for k in ("line", "well", "filename"))
    hours = d["hours"].astype(np.float64)
    count = d["count"].astype(np.int64)
    if not (len(images) == len(line) == len(well) == len(fname) == len(hours) == len(count)):
        raise ValueError("fields.npz arrays have inconsistent lengths")
    keys = set()
    for k in zip(line, well, np.round(hours, 3)):
        if k in keys:
            raise ValueError(f"more than one field for line/well/time {k}")
        keys.add(k)
    rows = np.array([well_row(w) for w in well])
    split = np.where(line == "A172", np.where(rows == "D", "within", "train"), "transfer")
    if not (split == "train").any():
        raise ValueError("no A172 non-D training rows")
    return images, line, well, fname, hours, count, split


def standardize_images(images):
    """Per-image zero-mean unit-variance (parameter-free; removes exposure offsets)."""
    x = images.astype(np.float32)
    x -= x.mean(axis=(1, 2), keepdims=True)
    x /= x.std(axis=(1, 2), keepdims=True) + 1e-6
    return x


# ----------------------------- ridge machinery -----------------------------

def ridge_fit(X, y, alpha):
    """Ridge on standardised X with unpenalised intercept; returns (w, b)."""
    xm = X.mean(0)
    ym = y.mean()
    Xc = X - xm
    w = np.linalg.solve(Xc.T @ Xc + alpha * np.eye(X.shape[1]), Xc.T @ (y - ym))
    return w, ym - xm @ w


def fit_ridge_cv(X, y, groups):
    """Standardise on train, choose alpha by well-grouped CV (train rows only), refit."""
    mu, sd = X.mean(0), X.std(0) + 1e-8
    Z = (X - mu) / sd
    ug = np.unique(groups)
    fold_of = {g: i % CV_FOLDS for i, g in enumerate(np.random.default_rng(SEED).permutation(ug))}
    fold = np.array([fold_of[g] for g in groups])
    errs = []
    for a in ALPHAS:
        sse = 0.0
        for f in range(CV_FOLDS):
            tr, va = fold != f, fold == f
            w, b = ridge_fit(Z[tr], y[tr], a)
            sse += np.sum((Z[va] @ w + b - y[va]) ** 2)
        errs.append(sse)
    alpha = ALPHAS[int(np.argmin(errs))]
    w, b = ridge_fit(Z, y, alpha)
    return lambda Xn: np.expm1(np.clip(((Xn - mu) / sd) @ w + b, 0, None))


# ----------------------------- texture features ----------------------------

def gradient_magnitude(g):
    return np.hypot(ndimage.sobel(g, axis=0), ndimage.sobel(g, axis=1)) / 8.0


def calibrate_thresholds(x, train_idx):
    """Edge-strength thresholds per scale = train-set quantiles of gradient magnitude."""
    th = {}
    for s in SIGMAS:
        sample = np.concatenate([
            gradient_magnitude(ndimage.gaussian_filter(x[i], s)).ravel()[::7] for i in train_idx
        ])
        th[s] = np.quantile(sample, EDGE_QUANTILES)
    return th


def radial_edges(h, w):
    fy, fx = np.fft.fftfreq(h)[:, None], np.fft.rfftfreq(w)[None, :]
    r = np.hypot(fy, fx)
    bins = np.digitize(r, np.geomspace(1 / 32, 0.5, RADIAL_BANDS))
    return bins


def texture_features(x, thresholds):
    h, w = x.shape[1:]
    bins = radial_edges(h, w)
    out = []
    for img in x:
        f = []
        for s in SIGMAS:
            g = ndimage.gaussian_filter(img, s)
            gm = gradient_magnitude(g)
            f += [gm.mean(), gm.std()]
            f += [(gm > t).mean() for t in thresholds[s]]  # edge density
            lap = ndimage.gaussian_laplace(img, s) * s * s  # scale-normalised blob response
            f += [np.abs(lap).mean(), lap.std(), (lap < -lap.std()).mean(), (lap > lap.std()).mean()]
            lv = ndimage.uniform_filter(img ** 2, 4 * int(s) + 1) - ndimage.uniform_filter(img, 4 * int(s) + 1) ** 2
            f += [np.log(np.clip(lv, 1e-6, None)).mean()]
        smooth = ndimage.gaussian_filter(img, 2.0)
        peaks = ndimage.maximum_filter(smooth, size=9) == smooth
        f += [peaks.mean()]  # local-maximum density at nucleus scale
        spec = np.abs(np.fft.rfft2(img)) ** 2
        f += [np.log(spec[bins == b].mean() + 1e-8) for b in range(1, RADIAL_BANDS + 1)]
        out.append(f)
    return np.asarray(out, dtype=np.float64)


# --------------------------------- CNN -------------------------------------

def block(cin, cout, stride):
    return [nn.Conv2d(cin, cout, 3, stride, 1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True)]


class CountNet(nn.Module):
    """Fixed-field count regressor; its spatial responses are not supervised masks."""

    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            *block(1, 16, 1), *block(16, 16, 2),
            *block(16, 32, 1), *block(32, 32, 2),
            *block(32, 48, 1), *block(48, 48, 2),
            *block(48, 64, 1),
        )
        self.head = nn.Conv2d(64, 1, 1)
        self.register_buffer("count_scale", torch.tensor(1.0))

    def forward(self, x):
        d = nn.functional.softplus(self.head(self.features(x)))
        return d.mean(dim=(1, 2, 3)) * self.count_scale


def fit_cnn(x, y_log, train_idx, checkpoint):
    torch.manual_seed(SEED)
    net = CountNet()
    # Start near the typical training count instead of guessing the assay scale.
    net.count_scale.fill_(np.expm1(np.median(y_log[train_idx])) / np.log(2))
    opt = torch.optim.AdamW(net.parameters(), lr=LR, weight_decay=WEIGHT_DECAY)
    steps = EPOCHS * int(np.ceil(len(train_idx) / BATCH))
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=LR, total_steps=steps)
    xt = torch.from_numpy(x[train_idx])[:, None]
    yt = torch.from_numpy(y_log[train_idx].astype(np.float32))
    gen = torch.Generator().manual_seed(SEED)
    for epoch in range(EPOCHS):
        net.train()
        perm = torch.randperm(len(xt), generator=gen)
        total = 0.0
        for i in range(0, len(perm), BATCH):
            b = perm[i:i + BATCH]
            xb = xt[b]
            if torch.rand(1, generator=gen) < 0.5:
                xb = xb.flip(3)
            if torch.rand(1, generator=gen) < 0.5:
                xb = xb.flip(2)
            loss = nn.functional.smooth_l1_loss(torch.log1p(net(xb)), yt[b], beta=0.25)
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            total += loss.item() * len(b)
        print(f"cnn epoch {epoch + 1}/{EPOCHS} train_loss {total / len(xt):.4f}", flush=True)
    net.eval()
    torch.save(net.state_dict(), checkpoint)
    preds = []
    with torch.no_grad():
        for i in range(0, len(x), 64):
            preds.append(net(torch.from_numpy(x[i:i + 64])[:, None]).numpy())
    return np.clip(np.concatenate(preds), 0, None)


# --------------------------------- main ------------------------------------

def main():
    if len(sys.argv) != 2:
        sys.exit("usage: python fit.py CACHE")
    cache = Path(sys.argv[1]).expanduser()
    images, line, well, fname, hours, count, split = load(cache)
    train = np.flatnonzero(split == "train")
    y = np.log1p(count.astype(np.float64))
    groups = np.array([f"{l}/{w}" for l, w in zip(line, well)])[train]
    print(f"rows {len(images)}; train {len(train)}, within {(split == 'within').sum()}, "
          f"transfer {(split == 'transfer').sum()}")

    x = standardize_images(images)

    clock_X = np.stack([hours, hours ** 2], axis=1)
    clock = fit_ridge_cv(clock_X[train], y[train], groups)(clock_X)

    thresholds = calibrate_thresholds(x, train)
    tex_X = texture_features(x, thresholds)
    texture = fit_ridge_cv(tex_X[train], y[train], groups)(tex_X)

    cnn = fit_cnn(x, y, train, cache / "cnn.pt")

    with open(cache / "predictions.csv", "w", newline="") as fh:
        wr = csv.writer(fh)
        wr.writerow(COLUMNS)
        for i in range(len(images)):
            wr.writerow([line[i], well[i], fname[i], f"{hours[i]:.6f}", int(count[i]), split[i],
                         f"{cnn[i]:.6f}", f"{texture[i]:.6f}", f"{clock[i]:.6f}"])
    print(f"wrote {cache / 'predictions.csv'}")


if __name__ == "__main__":
    main()
