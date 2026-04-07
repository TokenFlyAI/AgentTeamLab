# T827 — Task API Archive Drift Root Cause

## Summary

Archived task IDs were not deleted or corrupted. They were moved from `shared/task_board.md` to `shared/task_board_archive.md`, but `GET /api/tasks/:id` still searched only the active board. Result: archived tasks like T714, T716, and T818 returned `{"error":"task not found"}` even though their rows still existed on disk.

## Root Cause

- Active task parsing used `parseTaskBoard()`
- Archive list parsing existed separately in `GET /api/tasks/archive`
- Single-task lookup in `/Users/chenyangcui/Documents/code/aicompany/server.js` used:

```js
const task = parseTaskBoard().find((t) => String(t.id) === String(id));
```

- Once `archiveDoneTasks()` moved a task to `shared/task_board_archive.md`, that lookup path could never find it again

## Evidence

- Archived rows confirmed present:
  - `shared/task_board_archive.md:419` -> T717
  - `shared/task_board_archive.md:420` -> T715
  - `shared/task_board_archive.md:423` -> T716
  - `shared/task_board_archive.md:424` -> T714
  - `shared/task_board_archive.md:427` -> T818
- Before patch: authenticated `GET /api/tasks/714`, `/716`, `/818` returned `task not found`
- After patch on isolated server (`port 3299`): archived task lookups returned full payloads with `"archived": true`

## Recovery

- Added `parseTaskArchive()` in `/Users/chenyangcui/Documents/code/aicompany/server.js`
- Added `findTaskById()` helper that falls back to archived rows
- Updated:
  - `GET /api/tasks/:id`
  - `GET /api/tasks/:id/result`
  - `GET /api/tasks`
  - `GET /api/tasks/archive`
  to use shared archive parsing logic

## Verification

Run on a patched server:

```bash
API_KEY=test curl -H "Authorization: Bearer test" http://localhost:3299/api/tasks/714
API_KEY=test curl -H "Authorization: Bearer test" http://localhost:3299/api/tasks/818
```

Expected:

- HTTP 200
- archived task payload returned
- `"archived": true`

Programmatic check used:

```bash
python3 - <<'PY'
import json, urllib.request
base='http://localhost:3299'
headers={'Authorization':'Bearer test'}
for tid in ('714','818'):
    req=urllib.request.Request(f'{base}/api/tasks/{tid}', headers=headers)
    with urllib.request.urlopen(req) as r:
        body=json.load(r)
    assert str(body['id']) == tid
    assert body.get('archived') is True
    assert body.get('status') == 'done'
print('archive lookup assertions passed for 714 and 818')
PY
```

## Follow-up

- Restart or redeploy the production dashboard on `3199` so the patched `server.js` is loaded
- Reviewers can use archived IDs directly again without replacement tasks when the original work is already complete
