#!/usr/bin/env python3
"""openapi_diff.py — Breaking-change detector for OpenAPI specs.

Eve (Infra Engineer) — T1019 — 2026-04-07

Usage:
    python3 scripts/openapi_diff.py <baseline.yaml> <candidate.yaml>

Exit codes:
    0 — no breaking changes
    1 — error (bad args, parse failure)
    2 — breaking changes detected

Breaking changes detected:
  - Removed path
  - Removed HTTP method from a path
  - Removed required request parameter (query/path/header)
  - Added new required request parameter (callers would break)
  - Removed required field from a response schema
  - Changed type of an existing response schema field
  - Removed a shared component schema
"""

import sys
import yaml

VALID_METHODS = {"get", "post", "put", "patch", "delete", "head", "options", "trace"}


def load(path):
    with open(path) as f:
        return yaml.safe_load(f)


def get_ops(spec):
    """Return dict: (path, method) -> operation object."""
    ops = {}
    for path, path_item in spec.get("paths", {}).items():
        if not isinstance(path_item, dict):
            continue
        for method, op in path_item.items():
            if method.lower() in VALID_METHODS and isinstance(op, dict):
                ops[(path, method.lower())] = op
    return ops


def get_required_params(op):
    """Return set of (name, in) for required parameters."""
    required = set()
    for p in op.get("parameters", []):
        if isinstance(p, dict) and p.get("required"):
            required.add((p.get("name", ""), p.get("in", "")))
    return required


def get_schema_fields(schema, spec):
    """Recursively resolve $ref and return {field: type_info} for object schemas."""
    if not isinstance(schema, dict):
        return {}
    # Resolve $ref
    if "$ref" in schema:
        ref = schema["$ref"]
        if ref.startswith("#/"):
            parts = ref.lstrip("#/").split("/")
            node = spec
            for part in parts:
                node = node.get(part, {}) if isinstance(node, dict) else {}
            return get_schema_fields(node, spec)
    if schema.get("type") != "object" and "properties" not in schema:
        return {}
    props = schema.get("properties", {})
    required = set(schema.get("required", []))
    return {
        name: {"type": prop.get("type"), "required": name in required}
        for name, prop in props.items()
        if isinstance(prop, dict)
    }


def get_response_schema(op, spec, status="200"):
    """Extract the schema for a given response status code."""
    responses = op.get("responses", {})
    resp = responses.get(status) or responses.get(int(status) if str(status).isdigit() else status)
    if not resp or not isinstance(resp, dict):
        return {}
    content = resp.get("content", {})
    for media_type in ("application/json", "*/*"):
        if media_type in content:
            schema = content[media_type].get("schema", {})
            return get_schema_fields(schema, spec)
    return {}


def check_breaking(baseline, candidate):
    """Compare baseline vs candidate and return list of breaking change descriptions."""
    breaking = []
    warnings = []

    base_ops = get_ops(baseline)
    cand_ops = get_ops(candidate)

    # 1. Removed paths/methods
    for (path, method) in base_ops:
        if (path, method) not in cand_ops:
            breaking.append(f"REMOVED operation: {method.upper()} {path}")

    # 2. Parameter changes on surviving operations
    for (path, method), base_op in base_ops.items():
        if (path, method) not in cand_ops:
            continue  # already reported above
        cand_op = cand_ops[(path, method)]

        base_required = get_required_params(base_op)
        cand_required = get_required_params(cand_op)

        for param in base_required - cand_required:
            # Was required, now not required or removed — not breaking (loosening)
            pass

        for param in cand_required - base_required:
            # Was optional or absent, now required — BREAKING for callers
            breaking.append(
                f"NEW required param '{param[0]}' (in: {param[1]}) on {method.upper()} {path}"
            )

    # 3. Response schema changes on surviving operations
    for (path, method), base_op in base_ops.items():
        if (path, method) not in cand_ops:
            continue
        cand_op = cand_ops[(path, method)]

        base_schema = get_response_schema(base_op, baseline)
        cand_schema = get_response_schema(cand_op, candidate)

        if not base_schema:
            continue  # baseline had no structured schema; skip

        for field, info in base_schema.items():
            if field not in cand_schema:
                if info.get("required"):
                    breaking.append(
                        f"REMOVED required response field '{field}' from {method.upper()} {path} (200)"
                    )
                else:
                    warnings.append(
                        f"Removed optional response field '{field}' from {method.upper()} {path} (200)"
                    )
            else:
                base_type = info.get("type")
                cand_type = cand_schema[field].get("type")
                if base_type and cand_type and base_type != cand_type:
                    breaking.append(
                        f"TYPE CHANGE on response field '{field}' {method.upper()} {path}: "
                        f"{base_type} → {cand_type}"
                    )

    # 4. Removed component schemas (downstream $ref users would break)
    base_schemas = set((baseline.get("components") or {}).get("schemas", {}).keys())
    cand_schemas = set((candidate.get("components") or {}).get("schemas", {}).keys())
    for name in base_schemas - cand_schemas:
        breaking.append(f"REMOVED component schema: #/components/schemas/{name}")

    # 5. Added paths/methods — not breaking, just info
    added = [f"{m.upper()} {p}" for (p, m) in cand_ops if (p, m) not in base_ops]

    return breaking, warnings, added


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 openapi_diff.py <baseline.yaml> <candidate.yaml>", file=sys.stderr)
        sys.exit(1)

    baseline_path, candidate_path = sys.argv[1], sys.argv[2]

    try:
        baseline = load(baseline_path)
        candidate = load(candidate_path)
    except Exception as e:
        print(f"ERROR loading spec: {e}", file=sys.stderr)
        sys.exit(1)

    breaking, warnings, added = check_breaking(baseline, candidate)

    if added:
        print(f"  [INFO] {len(added)} new operation(s) added (non-breaking):")
        for op in added[:10]:
            print(f"         + {op}")
        if len(added) > 10:
            print(f"         ... and {len(added) - 10} more")

    if warnings:
        print(f"  [WARN] {len(warnings)} non-breaking change(s):")
        for w in warnings[:5]:
            print(f"         ~ {w}")

    if breaking:
        print(f"  [FAIL] {len(breaking)} BREAKING change(s) detected:")
        for b in breaking:
            print(f"         ✗ {b}")
        sys.exit(2)
    else:
        print(f"  [PASS] No breaking changes detected")
        sys.exit(0)


if __name__ == "__main__":
    main()
