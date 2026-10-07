#!/bin/sh
# Upstream release SHA-256 pins. Downloads are verified before extraction/execution.
set -eu
destination=${1:?Usage: install-tools.sh DESTINATION}
mkdir -p "$destination"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    trivy_asset=trivy_0.75.0_Linux-64bit.tar.gz
    trivy_sha=c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f
    gitleaks_asset=gitleaks_8.30.1_linux_x64.tar.gz
    gitleaks_sha=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
    ;;
  Darwin-arm64)
    trivy_asset=trivy_0.75.0_macOS-ARM64.tar.gz
    trivy_sha=4a77108cccf8e55c8d6823e1e759939a622277e66cd0daa3c1fc621ed69e4568
    gitleaks_asset=gitleaks_8.30.1_darwin_arm64.tar.gz
    gitleaks_sha=b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5
    ;;
  *) printf 'Unsupported scanner platform\n' >&2; exit 2 ;;
esac
curl --fail --location --silent --show-error --retry 3 \
  "https://github.com/aquasecurity/trivy/releases/download/v0.75.0/$trivy_asset" -o "$destination/trivy.tar.gz"
curl --fail --location --silent --show-error --retry 3 \
  "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/$gitleaks_asset" -o "$destination/gitleaks.tar.gz"
python3 - "$destination" "$trivy_sha" "$gitleaks_sha" <<'PY'
import hashlib
import pathlib
import sys
import tarfile

destination = pathlib.Path(sys.argv[1])
for name, expected in zip(('trivy', 'gitleaks'), sys.argv[2:]):
    archive = destination / f'{name}.tar.gz'
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        raise SystemExit(f'{name}: upstream archive checksum mismatch')
    with tarfile.open(archive) as bundle:
        member = next(item for item in bundle.getmembers() if item.name == name)
        bundle.extract(member, destination, filter='data')
    archive.unlink()
PY
"$destination/trivy" --version
"$destination/gitleaks" version
