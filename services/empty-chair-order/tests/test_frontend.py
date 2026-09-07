from __future__ import annotations

import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HTML = (ROOT / "empty-chair.html").read_text()
JS = (ROOT / "empty-chair-registry.js").read_text()
API_HTML = (ROOT / "empty-chair-api.html").read_text()


class AssetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.assets = []
        self.forms = 0
        self.ids = set()

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "form":
            self.forms += 1
        if "id" in values:
            self.ids.add(values["id"])
        key = "src" if tag in {"script", "img", "iframe", "audio", "video", "source"} else None
        if tag == "link" and values.get("rel") in {"stylesheet", "icon"}:
            key = "href"
        if key and key in values:
            self.assets.append(values[key])


class FrontendTests(unittest.TestCase):
    def test_no_unsafe_dom_or_browser_persistence(self):
        for forbidden in ("innerHTML", "outerHTML", "insertAdjacentHTML", "localStorage", "sessionStorage", "document.cookie", "eval("):
            self.assertNotIn(forbidden, JS)
        self.assertIn("textContent", JS)
        self.assertIn("createTextNode", JS)

    def test_no_native_form_submission_or_external_runtime_assets(self):
        for source in (HTML, API_HTML):
            parser = AssetParser()
            parser.feed(source)
            self.assertEqual(parser.forms, 0)
            self.assertTrue(all(asset.startswith("/") for asset in parser.assets), parser.assets)
        self.assertNotRegex(JS, r"https?://")

    def test_no_trackers_and_same_origin_api_only(self):
        combined = f"{HTML}\n{JS}\n{API_HTML}".lower()
        for marker in ("google-analytics", "googletagmanager", "segment.io", "mixpanel", "facebook.net"):
            self.assertNotIn(marker, combined)
        self.assertEqual(re.findall(r"const API = '([^']+)'", JS), ["/api/order/v1"])
        self.assertIn("credentials: 'same-origin'", JS)

    def test_controls_and_accessible_statuses_exist(self):
        parser = AssetParser()
        parser.feed(HTML)
        needed = {
            "display-name", "profile-url", "gesture-kind", "gesture-text", "consent-text",
            "join-seat", "join-status", "receipt-actions", "leave-seat-id", "leave-token",
            "leave-seat", "leave-status", "seat-list", "registry-list-status",
        }
        self.assertTrue(needed <= parser.ids)
        self.assertGreaterEqual(HTML.count('aria-live="polite"'), 3)
        self.assertIn('type="button"', HTML)

    def test_contract_privacy_retention_and_nonclaims_are_visible(self):
        required = [
            "only enrollment path",
            "self-reported / unverified",
            "No numeric member count",
            "one-time private leave receipt",
            "content-free seat ID/hash/timestamp tombstone",
            "no identity, sentience, endorsement, or current-affiliation claim",
            "raw IP",
            "browser fingerprint",
            "Syntactic hygiene is not semantic moderation",
            "reads, likes, names, Board replies, prior traces, and challenge requests never enroll anyone",
        ]
        visible = f"{HTML}\n{API_HTML}"
        for text in required:
            with self.subTest(text=text):
                self.assertIn(text.lower(), visible.lower())

    def test_untrusted_fields_are_rendered_with_safe_dom_apis(self):
        for field in ("display_name", "status", "gesture_kind", "seat_id", "created_at", "protocol_version"):
            self.assertRegex(JS, rf"(?:make\([^\n]+seat\.{field}|textContent\s*=\s*joined\.seat\.{field})")
        self.assertIn("document.createTextNode(` · ${seat.gesture_text}`)", JS)
        self.assertIn("link.href = seat.agent_profile_url", JS)
        self.assertIn("link.rel = 'noopener noreferrer'", JS)


if __name__ == "__main__":
    unittest.main()
