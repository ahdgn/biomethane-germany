# Biomethan Radar Deutschland — screening tool

German replication of [biomethane-france](https://github.com/ahdgn/biomethane-france):
an interactive screening radar for the German biomethane platform — biogas CHP
plants approaching the end of EEG support (conversion targets) alongside the
biomethane injection universe.

**Status: scaffold + data probe.** Front-end forked from the French tool (not yet
Germanised); MaStR data verified; ETL to build.

## Verified data probe (MaStR extract of 02 Sep 2026)

Run: `python tools/mastr_probe.py` (downloads the biomass + gas slices of the
MaStR bulk export via [open-mastr](https://open-mastr.readthedocs.io/), ~10 MB,
and writes `tools/probe_report.json` + `tools/probe_schema.txt`).

Headline results:

- **21,665 active biomass units**, of which **17,980 biogas-fuelled** (9.1 GW,
  median 250 kW) — plus 1,157 already biomethane-fuelled, 1,003 Klärgas, 162 Deponiegas.
- Field coverage on active units: coordinates **96.1 %** (98.1 % on biogas),
  Gemeindeschlüssel, commissioning date, power, operator-ID and EEG link **100 %**.
- **EEG expiry is computable per unit**: 2030 and 2031 are the wave years
  (1,797 and 3,221 units). **9,021 active biogas units (~3.0 GW) see EEG support
  end in 2026–2032** — 6,903 of them in the 75–500 kW band, 1,838 in 500–1,500 kW.
- EEG table: flex-premium flag populated (4,625 units claimed the Flexiprämie),
  tender-award number present on 2,535 units → "already secured" flag works.
- **Gas producers: 399 units, 305 Biomethan-Erzeugung** (370 in operation across
  types) — consistent with the dena Einspeiseatlas (~260 injecting).

Conclusion of the probe: 10 of the 14 screening-record fields are confirmed
buildable from MaStR alone; the Netztransparenz join (production + remuneration)
is the next thing to verify.

## Structure

| Path | Role |
|---|---|
| `js/`, `css/`, `vendor/`, `index.html` | Front-end forked from biomethane-france — Germanisation pending |
| `tools/mastr_probe.py` | MaStR data probe (download + stats) |
| `tools/screening_params.example.json` | The 7 workshop parameters, as config — thresholds live here, not in code |
| `data/` | Output JSON datasets (empty until the ETL lands) |

## Next steps

1. ETL `tools/build_datasets.py`: MaStR → site aggregation → `data/*.json`
2. Netztransparenz join probe (EEG-Anlagenschlüssel match rate)
3. Germanise `js/config.js` (types, units, de-DE formats, `echeance()` = EEG +20y,
   parameterised `prospection()` reading `screening_params`)
4. Overlay layers: evaluation-status register (keyed on MaStR-Nr) and DSO
   difficulty rating (hard / medium / easy)

---
© Nautilus — Tous droits réservés.
