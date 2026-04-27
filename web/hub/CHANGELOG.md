# Hub UI changelog

## 2026-04-27

- **New note (full form):** Project on disk and subfolder pickers use the same project list as search (`/api/v1/notes/facets`). Subfolder options are derived only from existing vault or indexed paths under `projects/<slug>/`. Custom path remains available.
- **Duplicate / near-duplicate project slug:** If the path’s `projects/<segment>/` is close to an existing facet project but not identical, the Hub shows a confirmation dialog (use existing slug or keep your path) and an inline hint with a one-click fix when typing.
