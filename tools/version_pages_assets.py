"""Give the frontend resources in a Pages build one release-specific URL suffix."""
from argparse import ArgumentParser
from pathlib import Path
import re


HTML_ASSET = re.compile(r'''(\b(?:src|href)\s*=\s*["']\./assets/[\w.-]+\.(?:js|css))(?:\?v=[0-9a-f]+)?(?=["'])''')
MODULE_IMPORT = re.compile(r'''(\bfrom\s+["']\./[\w.-]+\.js)(?:\?v=[0-9a-f]+)?(?=["'])''')


def version_assets(directory: Path, revision: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{7,40}", revision):
        raise ValueError("Expected a Git revision of 7–40 hexadecimal digits.")

    entry = directory / "index.html"
    html, rewritten = HTML_ASSET.subn(rf"\g<1>?v={revision}", entry.read_text(encoding="utf-8"))
    if rewritten < 2:
        raise ValueError("The Pages entry script or stylesheet reference is missing.")
    entry.write_text(html, encoding="utf-8")

    for module in (directory / "assets").glob("*.js"):
        source = module.read_text(encoding="utf-8")
        versioned = MODULE_IMPORT.sub(rf"\g<1>?v={revision}", source)
        if versioned != source:
            module.write_text(versioned, encoding="utf-8")


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("revision")
    args = parser.parse_args()
    version_assets(args.directory, args.revision)
