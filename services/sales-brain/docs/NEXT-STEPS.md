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

## 7. Decision-maker ranking across sources
The resolver ranks people, but official-source people (officers, qualifiers, RMPs) now
arrive alongside first-party ones and the ranking has not been retuned for them. A
named officer from a state filing should probably outrank an unnamed role inbox.

## 8. Licence-to-trade coverage checking in TDLR
`flDbpr.licenceCoversVertical` checks that the licence found is the licence the trade
needs. TDLR has no equivalent yet, so an electrical licence could satisfy an HVAC
account's check.

## 9. Snapshot refresh scheduling
`loadSnapshot` supersedes correctly but nothing schedules a refresh. A snapshot should
age visibly and re-download on a cadence, with the UI showing the download date — the
read model already reports it honestly.

## 10. Operator visibility for source outcomes
`research_runs.adapter_results.official_sources` records per-source status, match
method, duration and snapshot date. Nothing surfaces it. An operations panel answering
"why does this account have no licence on it" would close the loop.

## Known limitations

- **Sunbiz and State Bar are fixture-tested only.** Their parsers have never seen a
  live page. Structure was inferred from public knowledge of the record layout, so
  expect to adjust selectors on first live contact.
- **TDLR parsing is table-shape dependent.** Two programmes present slightly different
  columns; columns are matched by meaning, but a layout change will need a fixture.
- **No licence-to-trade check for Texas** (see 8).
- **`officialPersonHighlight` prefers RMP then qualifying agent.** It does not yet
  consider officers, because officer seniority is not comparable across states.
