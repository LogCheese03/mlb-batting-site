"""Download the Chadwick Bureau register and save each player's MLB Advanced Media id.

The Daily Grid shows a headshot from MLB's image server once a square is filled, and that
server is keyed by this id. Lahman's playerID is the Baseball-Reference id (key_bbref), so
this writes data/raw/mlbam_ids.csv with one row per player: playerID, mlbam.
Source: https://github.com/chadwickbureau/register (one people-N.csv per hex digit).
"""
import csv
import io
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://raw.githubusercontent.com/chadwickbureau/register/master/data/people-{}.csv"


PHOTO = "https://img.mlbstatic.com/mlb-photos/image/upload/w_160,q_auto:best/v1/people/{}/headshot/67/current"


def has_photo(mlbam):
    """True when MLB's server has a real headshot (it answers 404, not a silhouette, without the d_ default)."""
    for _ in range(3):
        try:
            req = urllib.request.Request(PHOTO.format(mlbam), method="HEAD")
            return urllib.request.urlopen(req, timeout=20).status == 200
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return False
        except Exception:
            pass
    return False


def main():
    frames = []
    for d in "0123456789abcdef":
        raw = urllib.request.urlopen(BASE.format(d), timeout=60).read().decode("utf-8")
        df = pd.read_csv(io.StringIO(raw), usecols=["key_mlbam", "key_bbref", "key_retro"], dtype=str)
        frames.append(df)
    reg = pd.concat(frames)
    ids = set(pd.read_csv(ROOT / "data" / "batting.csv").playerID) | set(pd.read_csv(ROOT / "data" / "pitching.csv").playerID)
    # Lahman playerID matches Baseball-Reference's id; fall back on the Retrosheet id (via Lahman People).
    people = pd.read_csv(ROOT / "data" / "raw" / "People.csv", usecols=["playerID", "retroID", "bbrefID"], dtype=str)
    by_bbref = reg.dropna(subset=["key_mlbam", "key_bbref"]).drop_duplicates("key_bbref").set_index("key_bbref").key_mlbam
    by_retro = reg.dropna(subset=["key_mlbam", "key_retro"]).drop_duplicates("key_retro").set_index("key_retro").key_mlbam
    out = {}
    for pid in sorted(ids):
        m = pid[3:] if pid.startswith("mlb") and pid[3:].isdigit() else by_bbref.get(pid)   # 2026 rookies are already keyed by MLB id
        if m is None:
            row = people[people.playerID == pid]
            if len(row):
                m = by_bbref.get(row.bbrefID.iloc[0]) if pd.notna(row.bbrefID.iloc[0]) else None
                if m is None and pd.notna(row.retroID.iloc[0]):
                    m = by_retro.get(row.retroID.iloc[0])
        if m is not None:
            out[pid] = m
    path = ROOT / "data" / "raw" / "mlbam_ids.csv"
    with ThreadPoolExecutor(24) as pool:
        photo = list(pool.map(has_photo, out.values()))
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["playerID", "mlbam", "photo"])
        w.writerows((pid, m, int(ok)) for (pid, m), ok in zip(out.items(), photo))
    print(sum(photo), "have a photo")
    print(f"{len(out)} of {len(ids)} players matched -> {path}")


if __name__ == "__main__":
    main()
