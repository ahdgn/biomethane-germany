# Team register (Airtable)

The register is the team-editable layer over the public MaStR data: relationship
status, grid-difficulty ratings, Daniel's knowledge tags, permitted waste and
free-text notes. The team edits rows in Airtable; `tools/sync_register.py`
pulls them into `data/pipeline.json` (committed via PR like any change).

## Airtable base

Live base: **"Biomethane Germany Screening tool"** (`app1HPXkXIa9xYSin`),
table **Sites** — created and seeded with the 7 Fox/Otter entries on 18/09/2026:

| Field | Type | Choices |
|---|---|---|
| MaStR-Nr | Single line text (primary) | the site id from the app popup/CSV, e.g. `SEL986637071388` |
| Plant name | Single line text | convenience only |
| Project | Single line text | e.g. Fox, Otter (candidate A) |
| Relationship status | Single select | Owners known · Feedstock suppliers nearby · Evaluated & rejected · Under evaluation |
| Team tags | Multiple select | Know the owners · Know politicians / planning authority · Know the technology (advised or built) |
| Grid difficulty | Single select | Easy · Medium · Hard |
| Permitted waste (t/a) | Single line text | mostly livestock waste, from the permit |
| Confidence | Single select | confirmed · probable · alternative |
| Notes | Long text | anything: engineering offices nearby, permits, findings |

Field names must match exactly — the sync maps on them.

## Sync

```bash
set AIRTABLE_TOKEN=pat...        # personal access token, scope data.records:read on the base
set AIRTABLE_BASE=app1HPXkXIa9xYSin
python tools/sync_register.py    # rewrites data/pipeline.json
```

Then commit `data/pipeline.json` on a branch and open a PR. Sites absent from
the register default to relationship "Unknown" and grid "Not rated" in the app.

## Qualification form (in-app drawer)

The app's site popups carry a **✎ Qualify** link that opens a right-side
panel: site identity (MaStR data, read-only) + the shared Airtable form,
prefilled with the MaStR-Nr and plant name. To connect it (once):

1. In Airtable, open the **Sites** table → view sidebar → **Form** → create.
2. Keep the fields: Plant name, Project, Relationship status, Team tags,
   Grid difficulty, Permitted waste (t/a), Confidence, Notes. Leave
   **MaStR-Nr in the form** (the app prefills and hides it).
3. Click **Share form** → copy the link (https://airtable.com/app.../shr... or
   https://airtable.com/shr...).
4. Paste it into `REGISTER_FORM_URL` in `js/config.js`, bump the `?v=`
   cache-buster in index.html, PR.

Each submission creates a new row; when several rows share one MaStR-Nr,
the sync keeps the most recent.
