# Sales Brain enrichment — next steps

Ranked by value to a sales rep on a call, which is not the same as engineering
interest.

## 1. Obtain the TSBPE dataset through an official data request
Everything is built: loader, parser, index, matcher, tests, UI. The Responsible Master
Plumber is the single highest-value person on a Texas plumbing account — a named,
state-verified individual tied to the company. It needs one dataset and a flag.

## 2. Arrange Sunbiz access, or find the published bulk download
Sunbiz answered HTTP 403 to an identified research agent, so live automation is off.
The parser, identity rules, persistence and tests are complete and fixture-tested.
Florida is half our P0 market and this is the entity-verification answer for it.

## 3. Sign off the Texas Comptroller adapter and switch it on
Reachable, no robots restriction, simple public form, free — the whole Texas entity
question answered without SOSDirect. It needs a governance sign-off, not code.

## 4. Move DBPR to its published licence files
Currently one search per account. DBPR publishes downloadable licence data; snapshot
infrastructure already exists (migration 053) and would make Florida licence
verification free of per-account requests.

## 5. Vertical profile trigger signals for the new claim keys
The profiles drive hypotheses from `trigger_signals`. The new evidence keys
(`tech_*`, `route_*`, company profile claims) are not referenced by any profile yet, so
today only the hard-coded gap rules use them. Wiring them into profile YAML would let
each vertical express its own openings.

## 6. Service-area geography as structured data
`stated_service_area` is captured as text. Parsing it into ZIP/city lists would let a
rep filter "companies that serve this ZIP but are not located in it" — a real
prospecting axis, and one the data model already keeps separate from the address.

## 7. Decision-maker ranking for officers from filings
Checked during the sprint and left deliberately conservative: the resolver penalises
`EVIDENCE_ONLY_RELATIONSHIPS` (+40) so a qualifier, licence holder, member, officer or
registered agent never wins routing on its own. An explicit `PRESIDENT` on a filing
maps to `PRESIDENT` and ranks normally; an ambiguous officer title falls back to
`OFFICER` and stays evidence-only.

That is the right default under the data rules (OFFICER ≠ OWNER). But for a
three-person LLC the officer on the filing usually *is* the decision maker, and a
size-aware rule — company size, vertical, whether the site names anyone at all — would
beat one constant. Worth revisiting with real data rather than by guessing.

## 8. Snapshot refresh scheduling
`loadSnapshot` supersedes correctly but nothing schedules a refresh. A snapshot should
age visibly and re-download on a cadence, with the UI showing the download date — the
read model already reports it honestly.

## 9. An operations view of source health
The Account page now answers "why is this panel empty" per account
(`src/domain/sourceAudit.ts`). What is still missing is the fleet view: which sources
are failing across all accounts, how often, and how stale the snapshots are. The data
is already recorded per run.

## 10. Live-fire validation of the fixture-only parsers
Sunbiz and the State Bar parsers have never seen a live page, and the Comptroller,
DBPR and TDLR parsers have seen one each during reconnaissance. The first time any of
them runs against production HTML, expect selector adjustments. Budget an hour per
source and keep the fixtures updated from whatever real markup is captured.

## Known limitations

- **Sunbiz and State Bar are fixture-tested only.** Their parsers have never seen a
  live page. Structure was inferred from public knowledge of the record layout, so
  expect to adjust selectors on first live contact.
- **TDLR parsing is table-shape dependent.** Two programmes present slightly different
  columns; columns are matched by meaning, but a layout change will need a fixture.
- **`officialPersonHighlight` prefers RMP then qualifying agent**, and deliberately
  never a registered agent. It does not consider officers, because officer seniority is
  not comparable across states — see 7.
- **Scoring was not changed.** Completeness gained two dimensions (`official_entity`,
  and `license_verified` where a state licenses the trade), but tier scoring is
  untouched, so no account's tier moves because of this branch. Feeding official
  verification into scoring is a deliberate follow-up, not an oversight.
- **Nothing is enabled.** Every live source sits behind a flag or a refusal, so on
  deployment this branch changes what the Account page *can* show, not what it does
  show, until a source is switched on.
