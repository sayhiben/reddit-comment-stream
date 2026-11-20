"""Package already-built userscripts as GitHub Release download assets."""
from hashlib import sha256
from pathlib import Path
from shutil import copyfile
from zipfile import ZIP_DEFLATED, ZipFile


root = Path(__file__).resolve().parent.parent
output = root / "release"
output.mkdir(exist_ok=True)
assets = []
for name in ("reddit-comment-stream", "reddit-comment-stream-old", "reddit-comment-stream-new"):
    destination = output / f"{name}.user.js"
    copyfile(root / "dist" / destination.name, destination)
    assets.append(destination)

zip_path = output / "reddit-comment-stream-ios.zip"
with ZipFile(zip_path, "w", compression=ZIP_DEFLATED) as archive:
    archive.write(assets[0], arcname=assets[0].name)
assets.append(zip_path)
(output / "SHA256SUMS.txt").write_text(
    "".join(f"{sha256(asset.read_bytes()).hexdigest()}  {asset.name}\n" for asset in assets),
    encoding="utf-8",
)
print(f"Packaged {len(assets)} downloads and checksums in {output}")
