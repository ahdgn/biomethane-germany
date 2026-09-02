# ETL: MaStR sqlite (open-mastr) -> data/*.json for the front-end.
# Prerequisite: python tools/mastr_probe.py (fills ~/.open-MaStR sqlite).
# Output: data/chp-anlagen.json (CHP sites, unit->site aggregated on
# LokationMastrNummer) and data/einspeisung.json (gas production units).
import json
import os

import pandas as pd
import sqlalchemy as sa

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
DB = os.path.expanduser("~/.open-MaStR/data/sqlite/open-mastr.db")

CHP_FUELS = ["Biogas", "Biomethan (Bioerdgas)", "Klärgas", "Deponiegas"]

def clean(v):
    return None if pd.isna(v) else v

def main():
    engine = sa.create_engine(f"sqlite:///{DB}")

    # ---- CHP conversion targets (biomass electricity units) ----
    bm = pd.read_sql('SELECT * FROM "biomass_extended"', engine)
    bm = bm[(bm["EinheitBetriebsstatus"] == "In Betrieb")
            & (bm["Hauptbrennstoff"].isin(CHP_FUELS))].copy()
    eeg = pd.read_sql(
        'SELECT "EegMastrNummer","BiogasInanspruchnahmeFlexiPraemie","Zuschlagsnummer"'
        ' FROM "biomass_eeg"', engine)
    bm = bm.merge(eeg, on="EegMastrNummer", how="left", suffixes=("", "_eeg"))

    bm["p"] = pd.to_numeric(bm["Bruttoleistung"], errors="coerce").fillna(0)
    bm["annee"] = pd.to_datetime(bm["Inbetriebnahmedatum"], errors="coerce").dt.year
    bm["site"] = bm["LokationMastrNummer"].fillna(bm["EinheitMastrNummer"])
    bm["flex"] = pd.to_numeric(
        bm["BiogasInanspruchnahmeFlexiPraemie"], errors="coerce").fillna(0) > 0
    bm["zus"] = bm["Zuschlagsnummer"].notna()

    sites = []
    for sid, g in bm.groupby("site"):
        g = g.sort_values("p", ascending=False)
        top = g.iloc[0]
        annee = g["annee"].min()
        sites.append({
            "id": sid,
            "nom": clean(top["NameStromerzeugungseinheit"]) or "Unnamed",
            "op": clean(top["AnlagenbetreiberMastrNummer"]),
            "bl": clean(top["Bundesland"]),
            "lk": clean(top["Landkreis"]),
            "gem": clean(top["Gemeinde"]),
            "ags": clean(top["Gemeindeschluessel"]),
            "ort": clean(top["Ort"]),
            "lat": round(float(top["Breitengrad"]), 5) if pd.notna(top["Breitengrad"]) else None,
            "lon": round(float(top["Laengengrad"]), 5) if pd.notna(top["Laengengrad"]) else None,
            "kw": round(float(g["p"].sum()), 1),
            "n": int(len(g)),
            "annee": int(annee) if pd.notna(annee) else None,
            "dateMes": str(g["Inbetriebnahmedatum"].min())[:10]
                       if g["Inbetriebnahmedatum"].notna().any() else None,
            "fuel": clean(top["Hauptbrennstoff"]),
            "tech": clean(top["Technologie"]),
            "flex": bool(g["flex"].any()),
            "zus": bool(g["zus"].any()),
        })
    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, "chp-anlagen.json"), "w", encoding="utf-8") as f:
        json.dump(sites, f, ensure_ascii=False, separators=(",", ":"))
    print(f"chp-anlagen.json: {len(sites)} sites from {len(bm)} units, "
          f"{round(bm['p'].sum()/1e6, 2)} GW")

    # ---- gas production units (renewable-gas injection universe only:
    # fossil extraction and LNG terminals are out of scope) ----
    gp = pd.read_sql('SELECT * FROM "gas_producer"', engine)
    gp = gp[gp["Technologie"].isin(
        ["Biomethan-Erzeugung", "Power-to-Gas (Wasserstoff)", "Power-to-Gas (Methan)"])]
    # foreign registrations (e.g. Dutch plants) carry no Bundesland and no AGS
    gp = gp[gp["Bundesland"].notna() | gp["Gemeindeschluessel"].notna()]
    gp["annee"] = pd.to_datetime(gp["Inbetriebnahmedatum"], errors="coerce").dt.year
    out = []
    for _, u in gp.iterrows():
        out.append({
            "id": clean(u["EinheitMastrNummer"]),
            "nom": clean(u["NameGaserzeugungseinheit"]) or "Unnamed",
            "op": clean(u["AnlagenbetreiberMastrNummer"]),
            "bl": clean(u["Bundesland"]),
            "gem": clean(u["Gemeinde"]),
            "ags": clean(u["Gemeindeschluessel"]),
            "ort": clean(u["Ort"]),
            "lat": round(float(u["Breitengrad"]), 5) if pd.notna(u["Breitengrad"]) else None,
            "lon": round(float(u["Laengengrad"]), 5) if pd.notna(u["Laengengrad"]) else None,
            "kw": round(float(u["Erzeugungsleistung"]), 1)
                  if pd.notna(u["Erzeugungsleistung"]) else None,
            "annee": int(u["annee"]) if pd.notna(u["annee"]) else None,
            "dateMes": str(u["Inbetriebnahmedatum"])[:10]
                       if pd.notna(u["Inbetriebnahmedatum"]) else None,
            "tech": clean(u["Technologie"]) or "Sonstige",
            "statut": clean(u["EinheitBetriebsstatus"]),
        })
    with open(os.path.join(DATA, "einspeisung.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"einspeisung.json: {len(out)} units")

if __name__ == "__main__":
    main()
