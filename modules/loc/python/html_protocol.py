"""LOC static HTML protocol publisher.

Python emits the static document shell while JavaScript/React retain their
existing page rendering and browser behavior. No new runtime route is added.
"""

import json
from pathlib import Path
import re
import sys

_ROUTE = re.compile(r"^/(?:[a-z0-9_-]+/)*$", re.IGNORECASE)


def _metadata(value):
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace('"', "&quot;")


def render_document(page):
    """Emit the existing LOC static HTML document contract byte for byte."""
    route = page["route"]
    if not isinstance(route, str) or not _ROUTE.fullmatch(route):
        raise ValueError("Invalid LOC-owned static path")
    title = _metadata(page["title"])
    description = _metadata(page["description"])
    css_href = page["cssHref"]
    if not isinstance(css_href, str) or not css_href.startswith("/") or '"' in css_href:
        raise ValueError("Invalid LOC stylesheet path")
    css = page["css"]
    entry = page["name"]
    home = page.get("staticHome")
    return "".join([
        '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
        '<title>' + title + '</title>',
        '<meta name="description" content="' + description + '">',
        '<meta name="robots" content="noindex,nofollow">' if page["noIndex"] else '',
        '<link rel="canonical" href="https://loc.lo3rwang.cc' + route + '">',
        '<link rel="icon" href="/assets/site/icons/loc-favicon.png">',
        '<link rel="stylesheet" href="' + css_href + '">',
        css,
        '<script id="loc-native-static-route">' + page["nativeStaticScript"] + '</script>',
        '<script id="loc-theme-bootstrap">' + page["themeScript"] + '</script>',
        '</head><body class="loc-app-shell' + (' loc-static-reading' if home else '') + '"><div id="loc-root">',
        home["html"] if home else '<main class="scope-main"><section class="scope-page"><header class="loc-card scope-hero"><h1>' + title + '</h1></header></section></main>',
        '</div>',
        home["loader"] if home else '<script type="module" src="/' + entry + '.js"></script>',
        '</body></html>',
    ])


def publish(records, output_directory):
    """Publish only the paths supplied by the existing LOC route builder."""
    output = Path(output_directory)
    seen = set()
    for page in records:
        route = page["route"]
        if route in seen:
            raise ValueError("Duplicate LOC static route: " + route)
        seen.add(route)
        document = render_document(page)
        destination = output / route.lstrip("/") / "index.html"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(document, encoding="utf-8")
    return len(seen)


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: html_protocol.py <static-pages.json> <output-directory>")
    with open(sys.argv[1], encoding="utf-8") as source:
        pages = json.load(source)
    if not isinstance(pages, list):
        raise TypeError("LOC static pages must be an array")
    print("[LOC HTML Protocol / Python] " + str(publish(pages, sys.argv[2])) + " static pages")


if __name__ == "__main__":
    main()
