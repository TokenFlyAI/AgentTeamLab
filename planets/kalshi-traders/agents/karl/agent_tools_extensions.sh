
# ── Artifact & Handoff Helpers (C15/C16/C20) ───────────────────────────

artifact_verify() {
  # Usage: artifact_verify <file_path> [options]
  # Wrapper for artifact_check.js
  local path="$1"; shift
  if [ -z "$path" ]; then echo "Usage: artifact_verify <file_path> [options]"; return 1; fi
  node "${SCRIPTS_DIR}/artifact_check.js" "$path" "$@"
}

artifact_metadata() {
  # Usage: artifact_metadata <file_path> <task_id>
  # Injects C20-compliant metadata into a JSON artifact
  local path="$1" task_id="$2"
  if [ -z "$path" ] || [ -z "$task_id" ]; then
    echo "Usage: artifact_metadata <file_path> <task_id>"
    return 1
  fi
  if [ ! -f "$path" ]; then echo "File not found: $path"; return 1; fi
  if [[ ! "$path" == *.json ]]; then echo "Only JSON supported for metadata injection"; return 1; fi
  
  local agent="${_SELF:-unknown}"
  local ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  
  python3 -c "
import sys, json, os
path = sys.argv[1]
with open(path, 'r') as f: data = json.load(f)
if isinstance(data, dict):
    data['metadata'] = {
        'task_id': int(sys.argv[2]),
        'agent': sys.argv[3],
        'timestamp': sys.argv[4]
    }
    with open(path, 'w') as f: json.dump(data, f, indent=2)
    print(f'Metadata (C20) injected into {path}')
else:
    print('JSON root is not an object, metadata injection skipped.')
" "$path" "$task_id" "$agent" "$ts"
}

handoff() {
  # Usage: handoff <agent> <task_id> <artifact_path> <run_command> ["message"]
  # Full C13/C16 handoff: (1) Check artifact, (2) Post to team_channel, (3) DM recipient, (4) Task in_review
  local to="$1" task_id="$2" path="$3" run_cmd="$4" msg="${5:-Artifact ready for review.}"
  if [ -z "$to" ] || [ -z "$task_id" ] || [ -z "$path" ] || [ -z "$run_cmd" ]; then
    echo "Usage: handoff <agent> <task_id> <artifact_path> <run_command> [\"message\"]"
    return 1
  fi
  
  if [ ! -f "$path" ]; then
    echo "Error: Artifact not found at $path"
    return 1
  fi

  # C20 Metadata check (if JSON)
  if [[ "$path" == *.json ]]; then
    if ! grep -q "\"metadata\"" "$path" || ! grep -q "\"task_id\"" "$path"; then
       echo "Warning: Artifact $path is missing C20 metadata. Suggest: 'artifact_metadata $path $task_id'"
    fi
  fi

  # C16 Handoff
  local ts_marker=$(date -r "$path" +%Y-%m-%dT%H:%M:%S)
  local from="${_SELF:-system}"
  local full_msg="### C16 Handoff: T${task_id} from ${from} to ${to}
- **Artifact**: \`${path}\`
- **Run Command**: \`${run_cmd}\`
- **Freshness**: \`${ts_marker}\`
- **Note**: ${msg}"
  
  post "$full_msg"
  dm "$to" "Handoff for T${task_id}: ${path}. See team_channel for C16 details."
  task_inreview "$task_id" "Handoff to ${to}: ${path} (C16 compliant)"
  
  echo "Handoff complete for T${task_id} to ${to}."
}

check_handoff() {
  # Usage: check_handoff <artifact_path>
  # Convenience for receiving agents to verify an artifact against C15/C16/C20
  local path="$1"
  if [ -z "$path" ]; then echo "Usage: check_handoff <artifact_path>"; return 1; fi
  artifact_verify "$path" --check-metadata --verbose
}
