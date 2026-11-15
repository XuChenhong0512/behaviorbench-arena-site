# BehaviorBench Arena — website

Public, read-only results explorer for Beauty Contest, Ultimatum, Trust, Public Goods and Push/Pull. This repository contains only the website and approved display data.

## Results

The default six-model formal experiment has 839 valid matches out of 840 planned matches. Two historical experiments remain separately selectable in Game Settings. Rankings use saved BT/Elo scores; Ultimatum v7 is provisional without an interval.

Battle Replay preserves actual model responses, exact prompts, public outcomes and failed attempts. No inference is performed. Credentials, accounts, private permits, private billing records, original SQLite databases and research implementation are excluded.

## Preview

```sh
python3 -m http.server 8503 --bind 127.0.0.1 --directory pages
```

## Verify

```sh
python3 tools/verify_pages_site.py pages
```

GitHub Actions publishes only the `pages/` directory.
