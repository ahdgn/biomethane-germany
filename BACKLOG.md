# Backlog — Biomethan Radar Deutschland

Feedback sources: Daniel's email 09/09/2026 · team call Daniel/Lars 09/09/2026 ·
Esus IM review. One PR per release. Principle from the call: implement only the
most relevant integrations, keep costs low.

## v1.1 — Trust & hygiene (this PR)
- [x] Bundesland mismatch bug: validate coordinates against state polygons (VG2500);
      geometry wins over the self-reported register attribute (47 corrected),
      coordinates outside Germany dropped (36)
- [x] Satellite view toggle (Esri World Imagery)
- [x] Data refresh — extract of 18/09/2026 (14,471 CHP sites, 318 injection units)
- [x] This backlog file

## v1.2 — Team knowledge capture
- [ ] Merge PR #3 (ACR pipeline layer) and PR #4 (relationship status + grid
      difficulty) — prerequisites for everything below
- [ ] Register moves to Airtable (keyed on MaStR-Nr): status, grid rating,
      Daniel's tags (owners / politicians & planning authority / technology
      known-built), permitted waste, free-text notes; ETL pulls into the app
- [ ] Radius search: plants within ~50 km of a chosen site (call, 09/09)
- [ ] DSO name per site (municipality → gas supply-area mapping)

## v2 — Data enrichment
- [ ] Permits layer: computed "likely BImSchG" flag from legal capacity /
      gas-volume thresholds + manual refinement per shortlisted site; permitted
      waste volumes = register field (no central permit register exists)
- [ ] Gas-grid geometry + operator overlay — pending Lars's paid source (name +
      price; likely WGI Gasnetzkarte); OSM pipelines as interim proxy
- [ ] Netztransparenz join (actual kWh + € per plant) — run the EEG-key
      match-rate probe first
- [ ] Feedstock-area polygons (draw supplier zones, stored in the register)

## v2.5 — Prioritization
- [ ] Attractiveness score /100 — weighted composite (size, EEG runway, permit
      class, feedstock, grid, relationship). Blocked on Daniel + Lars delivering
      their screening methodology (their action item, 09/09)
- [ ] Prospection filter v2 = "score ≥ X", thresholds from the workshop

## Parked
- [ ] Access control — GitHub Pages stays public even if the repo goes private
      (and Pages would go DOWN on a free-plan private repo). Real fix = rehost
      behind Cloudflare Access. Deferred by Ahmed, 18/09: public link acceptable
      for now
- [ ] SOURCE_NOTE date automation (ETL writes extract date into the data)
- [ ] anessa.com noted by Daniel — plant-operations AI, not an origination
      screener; watch, don't chase
