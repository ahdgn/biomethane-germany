# MaStR data probe — downloads the bulk extract (biomass + gas tables) via
# open-mastr and reports counts, field coverage and screening-relevant stats.
# Output: tools/probe_report.json + tools/probe_schema.txt. Run time: 20-60 min
# (multi-GB download + XML parse); progress in tools/probe.log.
import json
import os
import sys
import traceback
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "probe.log")

def log(msg):
    line = f"{datetime.now():%H:%M:%S}  {msg}"
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")

def main():
    log("probe start")
    from open_mastr import Mastr
    db = Mastr()
    log("downloading bulk extract (biomass + gas) — this is the long part")
    db.download(data=["biomass", "gas"])
    log("download + parse done, computing stats")

    import sqlalchemy as sa
    import pandas as pd
    engine = db.engine

    insp = sa.inspect(engine)
    tables = insp.get_table_names()
    with open(os.path.join(HERE, "probe_schema.txt"), "w", encoding="utf-8") as f:
        for t in tables:
            cols = [c["name"] for c in insp.get_columns(t)]
            try:
                n = pd.read_sql(f'SELECT COUNT(*) AS n FROM "{t}"', engine)["n"][0]
            except Exception:
                n = -1
            f.write(f"{t}  ({n} rows)\n  " + ", ".join(cols) + "\n\n")
    log(f"schema dumped: {len(tables)} tables")

    report = {"generated": datetime.now().isoformat(), "tables": tables}

    def pick(cols, *needles):
        for needle in needles:            # exact match wins over substring
            for c in cols:
                if needle.lower() == c.lower():
                    return c
        for needle in needles:
            for c in cols:
                if needle.lower() in c.lower() and not c.lower().startswith("geplant"):
                    return c
        return None

    # ---- biomass units (the CHP conversion-target universe) ----
    bt = next((t for t in tables if "biomass" in t.lower() and "extended" in t.lower()), None)
    if bt:
        bm = pd.read_sql(f'SELECT * FROM "{bt}"', engine)
        cols = list(bm.columns)
        c_status = pick(cols, "EinheitBetriebsstatus", "Betriebsstatus")
        c_fuel = pick(cols, "Hauptbrennstoff")
        c_power = pick(cols, "Bruttoleistung")
        c_date = pick(cols, "Inbetriebnahmedatum")
        c_lat = pick(cols, "Breitengrad")
        c_lon = pick(cols, "Laengengrad")
        c_ags = pick(cols, "Gemeindeschluessel")
        c_eegnr = pick(cols, "EegMastrNummer")
        c_op = pick(cols, "AnlagenbetreiberMastrNummer", "Anlagenbetreiber")
        c_plz = pick(cols, "Postleitzahl")

        r = {"table": bt, "total_units": int(len(bm))}
        if c_status:
            r["by_status"] = bm[c_status].value_counts(dropna=False).head(10).to_dict()
            active = bm[bm[c_status].astype(str).str.contains("In Betrieb", na=False)]
        else:
            active = bm
        r["active_units"] = int(len(active))
        if c_fuel:
            r["active_by_fuel"] = active[c_fuel].value_counts(dropna=False).head(12).to_dict()
        cov = {}
        for label, c in [("coordinates", c_lat), ("gemeindeschluessel", c_ags),
                         ("commissioning_date", c_date), ("gross_power_kw", c_power),
                         ("eeg_mastr_link", c_eegnr), ("operator_id", c_op), ("plz", c_plz)]:
            if c:
                cov[label] = round(float(active[c].notna().mean()) * 100, 1)
        r["field_coverage_pct_active"] = cov
        if c_power:
            p = pd.to_numeric(active[c_power], errors="coerce")
            r["active_power"] = {
                "sum_MW": round(float(p.sum()) / 1000, 0),
                "median_kW": round(float(p.median()), 0),
                "in_75_500kW": int(((p >= 75) & (p < 500)).sum()),
                "in_500_1500kW": int(((p >= 500) & (p < 1500)).sum()),
                "over_1500kW": int((p >= 1500).sum()),
            }
        if c_date:
            yr = pd.to_datetime(active[c_date], errors="coerce").dt.year
            expiry = (yr + 20).value_counts().sort_index()
            r["eeg_expiry_by_year_2024_2035"] = {int(k): int(v) for k, v in expiry.items()
                                                 if 2024 <= k <= 2035}
            # workshop cut: active biogas units whose EEG ends 2026-2032, by size band
            if c_fuel and c_power:
                bg = active[active[c_fuel].astype(str).str.contains("Biogas", na=False)].copy()
                bg["expiry"] = pd.to_datetime(bg[c_date], errors="coerce").dt.year + 20
                bg["p"] = pd.to_numeric(bg[c_power], errors="coerce")
                win = bg[(bg["expiry"] >= 2026) & (bg["expiry"] <= 2032)]
                r["biogas_eeg_end_2026_2032"] = {
                    "units": int(len(win)),
                    "sum_MW": round(float(win["p"].sum()) / 1000, 0),
                    "in_75_500kW": int(((win["p"] >= 75) & (win["p"] < 500)).sum()),
                    "in_500_1500kW": int(((win["p"] >= 500) & (win["p"] < 1500)).sum()),
                    "over_1500kW": int((win["p"] >= 1500).sum()),
                }
        # biogas-fuelled active units with coordinates — the map-ready core
        if c_fuel and c_lat:
            biogas = active[active[c_fuel].astype(str).str.contains("Biogas", na=False)]
            r["active_biogas_units"] = int(len(biogas))
            r["active_biogas_with_coords_pct"] = round(float(biogas[c_lat].notna().mean()) * 100, 1)
        report["biomass"] = r
        log(f"biomass stats done ({len(bm)} rows)")

    # ---- biomass EEG table (expiry & flags) ----
    et = next((t for t in tables if "biomass" in t.lower() and "eeg" in t.lower()), None)
    if et:
        eeg = pd.read_sql(f'SELECT * FROM "{et}"', engine)
        cols = list(eeg.columns)
        c_key = pick(cols, "AnlagenschluesselEeg", "Anlagenschluessel")
        c_flex = pick(cols, "Flexi", "Flex")
        c_zus = pick(cols, "Zuschlag")
        r = {"table": et, "rows": int(len(eeg))}
        if c_key:
            r["eeg_key_coverage_pct"] = round(float(eeg[c_key].notna().mean()) * 100, 1)
        if c_flex:
            r["flex_flag_column"] = c_flex
            r["flex_counts"] = eeg[c_flex].value_counts(dropna=False).head(5).to_dict()
        if c_zus:
            r["tender_award_column"] = c_zus
            r["tender_award_nonnull"] = int(eeg[c_zus].notna().sum())
        report["biomass_eeg"] = r
        log(f"eeg stats done ({len(eeg)} rows)")

    # ---- gas production units (injection-side universe) ----
    gt = next((t for t in tables if "gas_producer" in t.lower()), None) or \
         next((t for t in tables if "gas" in t.lower() and "producer" in t.lower()), None)
    if gt:
        gp = pd.read_sql(f'SELECT * FROM "{gt}"', engine)
        cols = list(gp.columns)
        c_status = pick(cols, "Betriebsstatus")
        c_tech = pick(cols, "Technologie", "Erzeugungsart", "Gasart")
        r = {"table": gt, "total_units": int(len(gp))}
        if c_status:
            r["by_status"] = gp[c_status].value_counts(dropna=False).head(8).to_dict()
        if c_tech:
            r["by_type"] = gp[c_tech].value_counts(dropna=False).head(8).to_dict()
        report["gas_producer"] = r
        log(f"gas producer stats done ({len(gp)} rows)")

    out = os.path.join(HERE, "probe_report.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)
    log(f"report written: {out}")

if __name__ == "__main__":
    try:
        main()
        open(os.path.join(HERE, "probe.DONE"), "w").write("ok")
    except Exception:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(traceback.format_exc())
        open(os.path.join(HERE, "probe.FAILED"), "w").write("see probe.log")
        sys.exit(1)
