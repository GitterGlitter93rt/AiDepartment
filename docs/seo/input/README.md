# Search Console Export Input Folder

Status: Active internal process document

This folder is the designated drop location for real Google Search
Console indexing exports used to diagnose the ~100-page non-indexation
issue described in `docs/seo/google-indexation-diagnostic.md`.

## Expected filenames

When exporting from Search Console ("Page indexing" report → Export),
save files here using these names:

- `search-console-indexing-export.csv`
  The primary "Page indexing" export (URL, Status/Reason columns).
  Search Console also offers a Google Sheets link — if only the Sheets
  route is used, download it as CSV under this name.
- `search-console-indexing-export-sample.csv` (optional)
  A filtered sample export (e.g. only "Discovered – currently not
  indexed") when working one exclusion group at a time.
- `search-console-canonicals-export.csv` (optional)
  A canonical-pairs export if canonical disputes are being
  investigated.

## Rules

- NO Search Console data has been invented or simulated in this
  repository. If this folder contains no CSV files, then final
  diagnosis of Google's exclusion reasons is NOT yet possible — the
  local audit in `docs/seo/full-site-seo-audit.md` documents
  indexability *potential*, not Google's actual decisions.
- Do not commit real exports containing sensitive account data to any
  public branch; this repo's docs are internal, and exports contain
  only URL/status columns.
- CSVs are considered transient working data, not source of truth:
  conclusions should be recorded in the audit doc, not left buried in
  the raw export.