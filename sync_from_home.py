#!/usr/bin/env python3
from __future__ import annotations

import argparse
import filecmp
import shutil
import sys
from pathlib import Path
from typing import Any


def parse_scalar(text: str) -> Any:
    if text.startswith("'") and text.endswith("'"):
        return text[1:-1].replace("''", "'")
    if text.startswith('"') and text.endswith('"'):
        return text[1:-1]
    if text.isdigit():
        return int(text)
    return text


class YamlSubsetParser:
    def __init__(self, text: str) -> None:
        self.lines = text.splitlines()
        self.index = 0

    def parse(self) -> dict[str, Any]:
        return self._parse_map(0)

    def _peek_significant(self) -> tuple[int, str] | None:
        i = self.index
        while i < len(self.lines):
            raw = self.lines[i]
            stripped = raw.strip()
            if stripped and not stripped.startswith("#"):
                indent = len(raw) - len(raw.lstrip(" "))
                return indent, raw[indent:]
            i += 1
        return None

    def _consume_significant(self) -> tuple[int, str] | None:
        while self.index < len(self.lines):
            raw = self.lines[self.index]
            self.index += 1
            stripped = raw.strip()
            if stripped and not stripped.startswith("#"):
                indent = len(raw) - len(raw.lstrip(" "))
                return indent, raw[indent:]
        return None

    def _parse_map(self, indent: int) -> dict[str, Any]:
        result: dict[str, Any] = {}
        while True:
            peek = self._peek_significant()
            if peek is None:
                break
            next_indent, content = peek
            if next_indent < indent:
                break
            if next_indent != indent:
                raise ValueError(f"Unexpected indentation at line {self.index + 1}")
            consumed = self._consume_significant()
            if consumed is None:
                break
            _, content = consumed
            if content.startswith("- "):
                raise ValueError(f"Unexpected list item at line {self.index}")
            key, sep, remainder = content.partition(":")
            if not sep:
                raise ValueError(f"Invalid mapping at line {self.index}")
            key = parse_scalar(key.strip())
            remainder = remainder.strip()
            if remainder:
                result[key] = parse_scalar(remainder)
                continue
            peek_child = self._peek_significant()
            if peek_child is None or peek_child[0] <= indent:
                result[key] = {}
                continue
            child_indent, child_content = peek_child
            if child_content.startswith("- "):
                result[key] = self._parse_list(child_indent)
            else:
                result[key] = self._parse_map(child_indent)
        return result

    def _parse_list(self, indent: int) -> list[Any]:
        result: list[Any] = []
        while True:
            peek = self._peek_significant()
            if peek is None:
                break
            next_indent, content = peek
            if next_indent < indent:
                break
            if next_indent != indent:
                raise ValueError(f"Unexpected indentation at line {self.index + 1}")
            consumed = self._consume_significant()
            if consumed is None:
                break
            _, content = consumed
            if not content.startswith("- "):
                raise ValueError(f"Expected list item at line {self.index}")
            result.append(parse_scalar(content[2:].strip()))
        return result


def load_manifest(path: Path) -> dict[str, Any]:
    parser = YamlSubsetParser(path.read_text(encoding="utf-8"))
    data = parser.parse()
    if not isinstance(data, dict) or "tracked" not in data:
        raise ValueError("Manifest must contain a top-level 'tracked' mapping")
    if not isinstance(data["tracked"], dict):
        raise ValueError("Manifest 'tracked' must be a mapping")
    return data


def collect_paths(node: dict[str, Any], prefix: Path = Path()) -> tuple[list[Path], list[Path]]:
    files: list[Path] = []
    dirs: list[Path] = []

    raw_files = node.get("_files", [])
    if raw_files:
        if not isinstance(raw_files, list):
            raise ValueError("_files must be a list")
        for name in raw_files:
            if not isinstance(name, str):
                raise ValueError("_files entries must be strings")
            files.append(prefix / name)

    for key, value in node.items():
        if key == "_files":
            continue
        if key.endswith("/*"):
            if value != "tracked":
                raise ValueError(f"Only 'tracked' is supported for wildcard entries: {key}")
            dirs.append(prefix / key[:-2])
            continue
        if not isinstance(value, dict):
            raise ValueError(f"Expected mapping for key: {key}")
        sub_files, sub_dirs = collect_paths(value, prefix / key)
        files.extend(sub_files)
        dirs.extend(sub_dirs)

    return files, dirs


def iter_files_under(path: Path) -> list[Path]:
    result: list[Path] = []
    if not path.exists():
        return result
    for item in path.rglob("*"):
        if any(part == ".git" for part in item.parts):
            continue
        if item.is_file():
            result.append(item)
    return sorted(result)


def ensure_safe_source(source: Path, repo_root: Path) -> None:
    try:
        source.relative_to(repo_root)
    except ValueError:
        return
    raise ValueError(f"Refusing to copy from inside the repo itself: {source}")


def default_home_from_manifest(manifest: dict[str, Any]) -> Path:
    source = manifest.get("source", {})
    if isinstance(source, dict):
        for key in ("exported_from_work_tree", "work_tree"):
            value = source.get(key)
            if isinstance(value, str) and value:
                return Path(value)
    return Path.home()


def copy_file(src: Path, dst: Path, dry_run: bool) -> None:
    if dry_run:
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() and dst.is_dir():
        shutil.rmtree(dst)
    shutil.copy2(src, dst)


def remove_path(path: Path, dry_run: bool) -> None:
    if dry_run:
        return
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()


def remove_empty_dirs(root: Path, dry_run: bool) -> None:
    if not root.exists() or dry_run:
        return
    for path in sorted((p for p in root.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
        if path == root:
            continue
        try:
            next(path.iterdir())
        except StopIteration:
            path.rmdir()


def format_path(path: Path) -> str:
    return path.as_posix()


def files_match(src: Path, dst: Path) -> bool:
    return dst.exists() and dst.is_file() and filecmp.cmp(src, dst, shallow=False)


def print_path_section(title: str, items: list[str]) -> None:
    print(f"{title}: {len(items)}")
    for item in items:
        print(f"  - {item}")


def main() -> int:
    script_path = Path(__file__).resolve()
    repo_root = script_path.parent

    parser = argparse.ArgumentParser(description="Copy manifest-listed home files into this repo under <repo>/<username>/...")
    parser.add_argument("--manifest", type=Path, default=repo_root / "tracked.yaml")
    parser.add_argument("--home", type=Path, help="Source home directory. Defaults to tracked.yaml source metadata or the current home.")
    parser.add_argument("--target-root", type=Path, help="Destination root. Defaults to <repo>/<home-dir-name>.")
    parser.add_argument("--dry-run", action="store_true", help="Print planned actions only.")
    parser.add_argument("--no-prune", action="store_true", help="Do not delete stale files under the destination root.")
    parser.add_argument("--strict-missing", action="store_true", help="Exit with code 1 if a manifest entry is missing from the source home.")
    args = parser.parse_args()

    manifest = load_manifest(args.manifest)
    source_home = (args.home or default_home_from_manifest(manifest)).resolve()
    target_root = (args.target_root or (repo_root / source_home.name)).resolve()

    tracked_node = manifest["tracked"]
    exact_files, tracked_dirs = collect_paths(tracked_node)

    desired: dict[Path, Path] = {}
    missing_sources: list[Path] = []

    for rel in sorted(set(exact_files)):
        src = (source_home / rel).resolve()
        ensure_safe_source(src, repo_root)
        if not src.exists() or not src.is_file():
            missing_sources.append(rel)
            continue
        desired[rel] = src

    for rel_dir in sorted(set(tracked_dirs)):
        src_dir = (source_home / rel_dir).resolve()
        ensure_safe_source(src_dir, repo_root)
        if not src_dir.exists() or not src_dir.is_dir():
            missing_sources.append(rel_dir)
            continue
        for src in iter_files_under(src_dir):
            rel = src.relative_to(source_home)
            desired[rel] = src

    if not desired:
        print("No files matched the manifest.", file=sys.stderr)
        return 1

    added_files: list[Path] = []
    updated_files: list[Path] = []
    unchanged_files: list[Path] = []

    for rel, src in sorted(desired.items(), key=lambda item: item[0].as_posix().lower()):
        dst = target_root / rel
        if not dst.exists():
            added_files.append(rel)
            continue
        if files_match(src, dst):
            unchanged_files.append(rel)
            continue
        updated_files.append(rel)

    copied_files = [(rel, "added") for rel in added_files] + [(rel, "updated") for rel in updated_files]
    for rel, _kind in copied_files:
        copy_file(desired[rel], target_root / rel, args.dry_run)

    pruned_files: list[Path] = []
    if not args.no_prune and target_root.exists():
        desired_dest_paths = {target_root / rel for rel in desired}
        existing_dest_files = [p for p in target_root.rglob("*") if p.is_file() and ".git" not in p.parts]
        for path in sorted(existing_dest_files, key=lambda p: p.as_posix().lower()):
            if path not in desired_dest_paths:
                pruned_files.append(path.relative_to(target_root))
                remove_path(path, args.dry_run)
        remove_empty_dirs(target_root, args.dry_run)

    missing_labels = [format_path(rel) for rel in sorted(set(missing_sources), key=lambda p: p.as_posix().lower())]
    added_labels = [format_path(rel) for rel in added_files]
    updated_labels = [format_path(rel) for rel in updated_files]
    unchanged_labels = [format_path(rel) for rel in unchanged_files]
    copied_labels = [f"{format_path(rel)} [{kind}]" for rel, kind in copied_files]
    pruned_labels = [format_path(rel) for rel in pruned_files]

    print(f"Source home: {source_home}")
    print(f"Manifest: {args.manifest.resolve()}")
    print(f"Target root: {target_root}")
    print(f"Mode: {'dry-run' if args.dry_run else 'apply'}")
    print(f"Unchanged files: {len(unchanged_labels)}")
    print_path_section("Copied files", copied_labels)
    print_path_section("Added files", added_labels)
    print_path_section("Updated files", updated_labels)
    print_path_section("Pruned files", pruned_labels)
    print_path_section("Missing entries", missing_labels)

    return 1 if missing_sources and args.strict_missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
