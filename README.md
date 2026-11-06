# Wales 3D world

The Wales 3D world webapp of [cedwyn.bucklerfamily.estate](https://cedwyn.bucklerfamily.estate/wales/), in its own repository.

It was split out of `unclehowell/cedwyn` (branch `section/wales-3d`) on 5 Nov 2026, because that repository holds about 290 branches
(~43 GB with history) and a job on one webapp should never need the rest. This repository is a few MB
(27 files, 3.1 MB at the split).

## Get the code

```
git clone --depth 1 https://github.com/unclehowell/cedwyn-wales-3d.git
```

## Where to send changes

The current `split-repos.json` entry in `unclehowell/cedwyn` sets this app to `mode: split-repo`. **This repository's `main` branch is the source of truth.**

1. Make application changes on a feature branch in this repository.
2. Open a pull request into this repository's `main`.
3. After merge, Cedwyn's scheduled `sync-split-repos` workflow copies `main` into the retained legacy branch `section/wales-3d`.
4. The central `build-cedwyn` workflow assembles the unified site from the synced branch.

Do not open application pull requests against the legacy branch `section/wales-3d`; it is a compatibility mirror, not the development target. Site-wide registry, shared runtime, central catalogue and build changes still belong in `unclehowell/cedwyn` `main`.

Full instructions: [REPO-SPLIT.md](https://github.com/unclehowell/cedwyn/blob/main/docs/REPO-SPLIT.md).


## Previews

Cloudflare Pages builds this repository itself (project `cedwyn-wales-3d`): `main` at https://cedwyn-wales-3d.pages.dev/ and every
branch or pull request at `https://<branch>.cedwyn-wales-3d.pages.dev/`, with the link commented on the pull request.
`preview.yml` is the fallback route (wrangler with the secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`, unset; it stops quietly).

## History before the split

The full history stays on the old branch: https://github.com/unclehowell/cedwyn/commits/section/wales-3d

Latest commits on `section/wales-3d` at the split:

| Date | Commit | Change |
| --- | --- | --- |
| 2026-11-05 | `887c2ce` | section/wales-3d: note the Cloudflare staging preview URL in README |
| 2026-11-04 | `5e21829` | Wales 3D v0.2.0: parcels and H3 cell data from Tithe H3, changelog and build tool |
| 2026-11-04 | `bc960a7` | Wales 3D v0.2.0: always clear (no weather, fog or haze), far zoom-out, H3 and parcels layers |
| 2026-11-04 | `1e57ae2` | Wales 3D v0.1.0: site wrapper (main data-scope wales online, ghf-boot) so the page sits in the Cedwyn chrome — |
| 2026-11-04 | `b0ccbec` | Wales 3D v0.1.0: three.js via jsDelivr ESM (no import map, survives the site build), data path from the script |
| 2026-11-04 | `6d2dbfb` | Wales 3D v0.1.0: data buildings-2.json |
| 2026-11-04 | `3eaaadd` | Wales 3D v0.1.0: data buildings-1.json |
| 2026-11-04 | `04b22d2` | Wales 3D v0.1.0: data buildings-0.json |
| 2026-11-04 | `57c0961` | Wales 3D v0.1.0: data cover2m.png |
| 2026-11-04 | `8fd21a6` | Wales 3D v0.1.0: data dtm4m-11.png |
| 2026-11-04 | `ec048be` | Wales 3D v0.1.0: data dtm4m-10.png |
| 2026-11-04 | `ba1ce87` | Wales 3D v0.1.0: data dtm4m-01.png |

Never force-push; never delete the old branch.
