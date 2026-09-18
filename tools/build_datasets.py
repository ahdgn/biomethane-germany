# ETL: MaStR sqlite (open-mastr) -> data/*.json for the front-end.
# Prerequisite: python tools/mastr_probe.py (fills ~/.open-MaStR sqlite).
# Output: data/chp-anlagen.json (CHP sites, unit->site aggregated on
# LokationMastrNummer) and data/einspeisung.json (gas production units).
import json
import os

import pandas as pd
import sqlalchemy as sa
from shapely.geometry import Point, shape
from shapely.prepared import prep

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
DB = os.path.expanduser("~/.open-MaStR/data/sqlite/open-mastr.db")

CHP_FUELS = ["Biogas", "Biomethan (Bioerdgas)", "Klärgas", "Deponiegas"]

def clean(v):
    return None if pd.isna(v) else v

class StateValidator:
    """Réconcilie l'attribut Bundesland (auto-déclaré, parfois faux) avec
    la géométrie (polygones VG2500 via deutschlandGeoJSON, dl-de/by-2-0).
    Règle : si le point est clairement dans un autre Land que l'attribut
    (au-delà d'une tolérance frontalière ~2 km), la géométrie fait foi ;
    si le point est hors d'Allemagne, les coordonnées sont jugées fausses
    et supprimées (retour au centroïde de commune côté app)."""

    BORDER_TOL_DEG = 0.02  # ~2 km : jamais de correction en zone frontalière

    def __init__(self):
        gj = json.load(open(os.path.join(HERE, "geo", "bundeslaender.geo.json"),
                            encoding="utf-8"))
        self.states = [(f["properties"]["name"], shape(f["geometry"]))
                       for f in gj["features"]]
        self.prepared = [(name, prep(geom), geom) for name, geom in self.states]
        self.stats = {"checked": 0, "bl_corrected": 0, "coords_dropped": 0}

    def check(self, bl, lat, lon):
        """Returns (bl, lat, lon) possibly corrected."""
        if lat is None or lon is None:
            return bl, lat, lon
        self.stats["checked"] += 1
        pt = Point(lon, lat)
        inside = next((n for n, p, _ in self.prepared if p.covers(pt)), None)
        if inside is None:
            self.stats["coords_dropped"] += 1
            return bl, None, None
        if bl and inside != bl:
            claimed = next((g for n, g in self.states if n == bl), None)
            if claimed is not None and claimed.distance(pt) < self.BORDER_TOL_DEG:
                return bl, lat, lon  # trop près de la frontière : bénéfice du doute
            self.stats["bl_corrected"] += 1
            return inside, lat, lon
        return inside if not bl else bl, lat, lon

def main():
    engine = sa.create_engine(f"sqlite:///{DB}")
    validator = StateValidator()

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
        v_bl, v_lat, v_lon = validator.check(
            clean(top["Bundesland"]),
            round(float(top["Breitengrad"]), 5) if pd.notna(top["Breitengrad"]) else None,
            round(float(top["Laengengrad"]), 5) if pd.notna(top["Laengengrad"]) else None)
        sites.append({
            "id": sid,
            "nom": clean(top["NameStromerzeugungseinheit"]) or "Unnamed",
            "op": clean(top["AnlagenbetreiberMastrNummer"]),
            "bl": v_bl,
            "lk": clean(top["Landkreis"]),
            "gem": clean(top["Gemeinde"]),
            "ags": clean(top["Gemeindeschluessel"]),
            "ort": clean(top["Ort"]),
            "lat": v_lat,
            "lon": v_lon,
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
    # the gas table has no Landkreis column — derive it from the AGS prefix
    # (first 5 digits = Kreis), using the biomass table as lookup
    kreis = pd.read_sql(
        'SELECT DISTINCT SUBSTR("Gemeindeschluessel",1,5) AS k, "Landkreis" AS lk'
        ' FROM "biomass_extended"'
        ' WHERE "Landkreis" IS NOT NULL AND "Gemeindeschluessel" IS NOT NULL', engine)
    kreis_map = dict(zip(kreis["k"], kreis["lk"]))
    gp["annee"] = pd.to_datetime(gp["Inbetriebnahmedatum"], errors="coerce").dt.year
    out = []
    for _, u in gp.iterrows():
        v_bl, v_lat, v_lon = validator.check(
            clean(u["Bundesland"]),
            round(float(u["Breitengrad"]), 5) if pd.notna(u["Breitengrad"]) else None,
            round(float(u["Laengengrad"]), 5) if pd.notna(u["Laengengrad"]) else None)
        out.append({
            "id": clean(u["EinheitMastrNummer"]),
            "nom": clean(u["NameGaserzeugungseinheit"]) or "Unnamed",
            "op": clean(u["AnlagenbetreiberMastrNummer"]),
            "bl": v_bl,
            "lk": kreis_map.get(str(u["Gemeindeschluessel"])[:5])
                  if pd.notna(u["Gemeindeschluessel"]) else None,
            "gem": clean(u["Gemeinde"]),
            "ags": clean(u["Gemeindeschluessel"]),
            "ort": clean(u["Ort"]),
            "lat": v_lat,
            "lon": v_lon,
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
    print(f"geo validation: {validator.stats}")

if __name__ == "__main__":
    main()
