# Team register (Airtable)

The register is the team-editable layer over the public MaStR data: relationship
status, grid-difficulty ratings, Daniel's knowledge tags, permitted waste and
free-text notes. The team edits rows in Airtable; `tools/sync_register.py`
pulls them into `data/pipeline.json` (committed via PR like any change).

## Airtable base

One base (e.g. "Biomethan Radar — Register"), one table **Sites**:

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
set AIRTABLE_BASE=app...         # base id (from the base URL)
python tools/sync_register.py    # rewrites data/pipeline.json
```

Then commit `data/pipeline.json` on a branch and open a PR. Sites absent from
the register default to relationship "Unknown" and grid "Not rated" in the app.
