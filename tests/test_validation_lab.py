"""Checks featurepack provenance and no-label guard using TEST ARRAYS ONLY."""
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
import numpy as np
from rasterio.transform import from_origin
from feature_v05 import create_featurepack
from scripts.train_validation import produce
from scripts.ingest_annotation import validate, parse_issue

class ValidationLabTests(unittest.TestCase):
    def test_raw_featurepack_no_fake_ground_truth(self):
        with tempfile.TemporaryDirectory() as td:
            target=Path(td)
            fake_scenes=[]
            for j,day in enumerate(("2023-08-03","2025-08-14","2026-06-28","2026-08-17")):
                data={name:np.full((12,12),value,dtype=np.float32) for name,value in
                      (("blue",.08),("red",.13),("green",.11),("nir",.38-j*.02),("swir16",.25))}
                fake_scenes.append(({"id":f"fixture_scene_{j}","properties":{"datetime":day+"T00:00:00Z"}},
                                    data,np.full((12,12),4,dtype=np.uint8)))
            meta=create_featurepack(target,from_origin(300000,5000000,10,10),
                                    fake_scenes,
                                    np.full((12,12),40,dtype=np.uint8),
                                    np.ones((12,12),dtype=bool),{})
            self.assertEqual(meta["status"],"ready")
            encoded=json.loads((target/"inspection_v05.json").read_text())
            self.assertEqual(len(encoded["dates"]),4)
            self.assertTrue(encoded["measurements_not_labels"])
            self.assertEqual(len(encoded["signature"]),16)
            out=produce(target/"features_v05.npz",
                        target/"missing_labels.jsonl",
                        target/"validation_v05.json",
                        target/"model_predictions_v05.png")
            self.assertEqual(out["status"],"needs_labels")
            self.assertIsNone(out["accuracy"])
            self.assertFalse((target/"model_predictions_v05.png").exists())

    def test_evidence_is_mandatory(self):
        data=dict(study_id="a0-nord3-2km-v05",signature="0"*16,row=4,col=3,
                  label="construction",site_group="road_site_01",
                  evidence_url="https://example.com/dates",evidence_date="2025-01-01",
                  note="Construction independently verified from dated aerial photos.",
                  attestation=True)
        issue={"number":1,"html_url":"https://github.com/example/issues/1"}
        valid=validate(data,issue,"RazvanJuncu")
        self.assertEqual(valid["reviewed_by"],"RazvanJuncu")
        self.assertEqual(valid["review_status"],"owner_attested_not_independently_audited")
        data["evidence_url"]=""
        with self.assertRaises(ValueError):
            validate(data,issue,"RazvanJuncu")

    def test_unauthorized_issue_rejected(self):
        message={"issue":{"user":{"login":"someone_else"},"title":"[InfraTrack label] hello","body":"x"}}
        with self.assertRaises(ValueError):
            parse_issue(message)
