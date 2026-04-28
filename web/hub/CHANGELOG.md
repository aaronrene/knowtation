# Hub UI changelog

## 2026-04-28

- **Search / Meaning index:** After vault-changing actions (new note, edit save, delete, import with new notes, proposal approve, bulk delete/rename, hosted new-vault bootstrap, cross-vault copy/move), a **banner** above the search row reminds you that **Meaning** search may be stale until **Re-index** succeeds. State is per vault in `localStorage` (dismiss clears only the current vault’s flag). **Re-index now** triggers the same action as the header **Re-index** button.
- **Note detail — duplicate:** **Duplicate…** (editors) opens **Add to vault → New note (full)** with body/title/tags and other fields prefilled, suggested `…-copy.md` path, same project/folder/path pickers as new note; optional **delete original after successful save** (blocked if destination path equals source). Path info tooltip text updated (duplicate flow + agents/scripts may keep using the old path).
- **Note detail — copy body:** Floating **copy** control on read view copies the Markdown **body** to the clipboard (hidden for proposals, edit mode, and while loading).
- **Note detail (read view):** Info control next to the path explains that vault-relative paths stay fixed after save (agents, search, links), duplicate + optional delete, and that cross-vault copy/move keeps the same path string in the target vault (not inbox).
- **Import / New note copy parity:** Path helper is one sentence on both (“Choose ‘Custom’ in **Project**, **Folder**, or **Path**…”). Subfolder helper matches on both (“Choose a subfolder or use **Custom**…”).
- **Import modal:** Same project / folder / path controls as **New note (full)** — facet-backed project dropdown, vault folder picker, subfolders under `projects/<slug>/`, and an editable vault-relative **destination folder** (maps to `project` + `output_dir` on `POST /api/v1/import` and import-url JSON).

## 2026-04-27

- **Note detail → Edit:** Body (Markdown) uses a **`flex-shrink: 0`** wrapper (so the editor cannot collapse), **`white-space: normal`** on the edit form, default **`height: auto`** / **`max-height`** on the textarea (no fragile initial `style.height` from layout math), and the drag strip only applies a pixel height while dragging (clamped with safe fallbacks).
- **New note (full form):** Project on disk and subfolder pickers use the same project list as search (`/api/v1/notes/facets`). Subfolder options are derived only from existing vault or indexed paths under `projects/<slug>/`. Custom path remains available.
- **Duplicate / near-duplicate project slug:** If the path’s `projects/<segment>/` is close to an existing facet project but not identical, the Hub shows a confirmation dialog (use existing slug or keep your path) and an inline hint with a one-click fix when typing.
