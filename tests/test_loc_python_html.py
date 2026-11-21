"""Python and JavaScript jointly implement LOC's static HTML protocol."""
import tempfile
import unittest
from pathlib import Path

from modules.loc.python.html_protocol import publish, render_document


def page(**changes):
    sample = {
        "route": "/culture/", "title": "LOC & 文化", "description": '關鍵詞 "研究" & 時間',
        "noIndex": False, "cssHref": "/_loc/routes/site.css", "css": '',
        "name": "_loc/routes/p1", "staticHome": None,
        "nativeStaticScript": "window.locStatic=true;", "themeScript": "window.theme='dark';",
    }
    sample.update(changes)
    return sample


class PythonHtmlProtocolTest(unittest.TestCase):
    def test_existing_js_route_bootstrap_and_escaping(self):
        html = render_document(page())
        self.assertIn('<title>LOC &amp; 文化</title>', html)
        self.assertIn('關鍵詞 &quot;研究&quot; &amp; 時間', html)
        self.assertIn('<script type="module" src="/_loc/routes/p1.js"></script>', html)
        self.assertIn("<script id=\"loc-theme-bootstrap\">window.theme='dark';</script>", html)
        self.assertNotIn('loc-static-reading', html)

    def test_existing_static_home_markup_is_preserved_verbatim(self):
        home = {'html': '<main data-view="original">既有展示</main>',
                'loader': '<script>window.hydrate=true;</script>'}
        html = render_document(page(route='/', staticHome=home))
        self.assertIn(home['html'], html)
        self.assertIn(home['loader'], html)
        self.assertIn('loc-static-reading', html)

    def test_static_publisher_uses_existing_route_list_only(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(publish([page(route='/'), page(route='/culture/')], directory), 2)
            self.assertTrue((Path(directory) / 'index.html').is_file())
            self.assertTrue((Path(directory) / 'culture/index.html').is_file())
            self.assertFalse((Path(directory) / '_redirects').exists())

    def test_route_traversal_and_duplicates_rejected(self):
        with self.assertRaises(ValueError):
            render_document(page(route='/../../secret/'))
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
            publish([page(), page()], directory)


if __name__ == '__main__':
    unittest.main()
