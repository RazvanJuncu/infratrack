"""Offline tests only: portfolio site IDs, status honesty and multi-region label intake."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts.build_portfolio import valid_config, processed_status, osm_way
from scripts.ingest_annotation import validate

class PortfolioTests(unittest.TestCase):
    @staticmethod
    def sample():
        return {"id":"a7-test-region","name":"A7 test",
                "ref":"A7","lat":45.369283,"lon":27.093946,
                "region":"Buzau","size_km":2}

    def test_site_definitions_must_be_valid(self):
        self.assertEqual(len(valid_config([self.sample()])),1)
        with self.assertRaises(ValueError):
            valid_config([self.sample(),self.sample()])
        bad={**self.sample(),"lat":90}
        with self.assertRaises(ValueError):
            valid_config([bad])

    def test_unavailable_site_not_marked_sentinel_ready(self):
        sample=self.sample()
        meta=processed_status(sample,Path("site"),
                        {"status":"unavailable","notes":"Cloud coverage"})
        self.assertEqual(meta["status"],"unavailable")
        self.assertNotIn("scene_signature",meta)

    def test_no_fabricated_osm_road_tags(self):
        class Response:
            content=b"""<osm><node id="1" lat="45.3690" lon="27.0930"/>
              <node id="2" lat="45.3710" lon="27.0940"/>
              <way id="1335112262"><nd ref="1"/><nd ref="2"/>
              <tag k="highway" v="motorway"/><tag k="ref" v="A7"/></way></osm>"""
            def raise_for_status(self): pass
        with patch("scripts.build_portfolio.requests.get",return_value=Response()):
            feat=osm_way(1335112262,"A7",45.3693,27.0939)
            self.assertEqual(feat["properties"]["osm_way_id"],1335112262)
            with self.assertRaises(ValueError):
                osm_way(1335112262,"A1",45.3693,27.0939)

    def test_intake_accepts_registered_new_site(self):
        issue={"number":3,"html_url":"https://github.com/RazvanJuncu/infratrack/issues/3"}
        form={"study_id":"a7-ramnicu-sud-2km-v1",
              "signature":"0123456789abcdef","row":50,"col":90,
              "label":"agriculture","site_group":"block_r02_c03",
              "evidence_url":"https://example.org/dated-aerial-evidence",
              "evidence_date":"2025-01-10",
              "note":"Source-dated aerial imagery independently confirms the crop cycle",
              "attestation":True}
        self.assertEqual(validate(form,issue,"RazvanJuncu")["label"],"agriculture")
        form["study_id"]="a9-unknown-2km-v1"
        with self.assertRaises(ValueError):
            validate(form,issue,"RazvanJuncu")
