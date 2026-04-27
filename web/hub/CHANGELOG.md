# Hub UI changelog

## 2026-04-28

- **Import / New note copy parity:** Path helper is one sentence on both (“Choose ‘Custom’ in **Project**, **Folder**, or **Path**…”). Subfolder helper matches on both (“Choose a subfolder or use **Custom**…”).
- **Import modal:** Same project / folder / path controls as **New note (full)** — facet-backed project dropdown, vault folder picker, subfolders under `projects/<slug>/`, and an editable vault-relative **destination folder** (maps to `project` + `output_dir` on `POST /api/v1/import` and import-url JSON).

## 2026-04-27

- **New note (full form):** Project on disk and subfolder pickers use the same project list as search (`/api/v1/notes/facets`). Subfolder options are derived only from existing vault or indexed paths under `projects/<slug>/`. Custom path remains available.
- **Duplicate / near-duplicate project slug:** If the path’s `projects/<segment>/` is close to an existing facet project but not identical, the Hub shows a confirmation dialog (use existing slug or keep your path) and an inline hint with a one-click fix when typing.
