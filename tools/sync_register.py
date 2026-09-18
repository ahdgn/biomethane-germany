# Sync the team register from Airtable into data/pipeline.json.
# The team edits rows in Airtable (schema: see REGISTER.md); this script pulls
# them so the app stays static. Run it whenever the register changed, commit
# the resulting data/pipeline.json via PR.
#
# Env: AIRTABLE_TOKEN (personal access token, scope data.records:read on the
#      base), AIRTABLE_BASE (app...), AIRTABLE_TABLE (default "Sites").
import json
import os
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "pipeline.json")

EVAL_MAP = {
    "Owners known": "owners",
    "Feedstock suppliers nearby": "feedstock",
    "Evaluated & rejected": "rejected",
    "Under evaluation": "evaluating",
}
GRID_MAP = {"Easy": "easy", "Medium": "medium", "Hard": "hard"}
TAG_MAP = {
    "Know the owners": "owners",
    "Know politicians / planning authority": "politicians",
    "Know the technology (advised or built)": "technology",
}

def main():
    token = os.environ.get("AIRTABLE_TOKEN")
    base = os.environ.get("AIRTABLE_BASE")
    table = os.environ.get("AIRTABLE_TABLE", "Sites")
    if not token or not base:
        sys.exit("AIRTABLE_TOKEN and AIRTABLE_BASE must be set — see REGISTER.md. "
                 "data/pipeline.json left untouched.")

    records, offset = [], None
    while True:
        qs = {"pageSize": 100}
        if offset:
            qs["offset"] = offset
        url = (f"https://api.airtable.com/v0/{base}/{urllib.parse.quote(table)}"
               f"?{urllib.parse.urlencode(qs)}")
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        page = json.load(urllib.request.urlopen(req))
        records += page.get("records", [])
        offset = page.get("offset")
        if not offset:
            break

    # Le formulaire cree toujours une nouvelle fiche : en cas de doublon
    # sur un MaStR-Nr, la plus recente l'emporte.
    records.sort(key=lambda r: r.get("createdTime", ""))
    by_site = {}
    for r in records:
        f = r.get("fields", {})
        site = (f.get("MaStR-Nr") or "").strip()
        if not site:
            continue
        e = {"site": site}
        if f.get("Project"):
            e["project"] = f["Project"]
        if f.get("Confidence"):
            e["confidence"] = f["Confidence"]
        if f.get("Relationship status"):
            e["status"] = f["Relationship status"]
            e["eval"] = EVAL_MAP.get(f["Relationship status"], "evaluating")
        if f.get("Grid difficulty"):
            e["grid"] = GRID_MAP.get(f["Grid difficulty"])
        tags = [TAG_MAP[t] for t in f.get("Team tags", []) if t in TAG_MAP]
        if tags:
            e["tags"] = tags
        if f.get("Permitted waste (t/a)"):
            e["waste"] = str(f["Permitted waste (t/a)"])
        if f.get("Notes"):
            e["note"] = f["Notes"]
        by_site[site] = e
    entries = list(by_site.values())

    entries.sort(key=lambda e: (e.get("project") or "~", e["site"]))
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(entries, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"pipeline.json: {len(entries)} register entries synced from Airtable")

if __name__ == "__main__":
    main()
