"""Review queue and spatial grouping tests use fixtures, not fake production labels."""
import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
from scripts.build_review_queue import build, block_for
from scripts.train_validation import spatial_site_groups, deduplicate_annotations

class ReviewQueueTests(unittest.TestCase):
    def fixture(self,folder):
        n=100
        full=lambda x:np.full((n,n),x,dtype=np.float32)
        bands={}
        for i in range(4):
            bands[f"ndvi_{i}"]=full(.65)
            bands[f"bsi_{i}"]=full(-.14)
            bands[f"ndbi_{i}"]=full(-.08)
        # Introduce 3 synthetic hypothesis regions in separate tiles:
        # persistent bare near road, 2021 cropland regrowth away from it,
        # and unchanged control in remaining space.
        for i,v in enumerate([.68,.1,.14,.12]):
            bands[f"ndvi_{i}"][10:48,10:47]=v
        for i,v in enumerate([-.2,.18,.11,.1]):
            bands[f"bsi_{i}"][10:48,10:47]=v
        for i,v in enumerate([-.1,.05,.06,.03]):
            bands[f"ndbi_{i}"][10:48,10:47]=v
        for i,v in enumerate([.70,.10,.68,.72]):
            bands[f"ndvi_{i}"][60:91,60:91]=v
        for i,v in enumerate([-.2,.14,-.16,-.17]):
            bands[f"bsi_{i}"][60:91,60:91]=v
        # Cropland 2021 only in seasonally recovered negative
        wc=np.full((n,n),30,dtype=np.uint8)
        wc[60:91,60:91]=40
        corridor=np.zeros((n,n),dtype=np.uint8)
        corridor[5:50,5:50]=1
        np.savez_compressed(folder/"features_v05.npz",**bands,
                            worldcover=wc,corridor=corridor,
                            joint_valid=np.ones((n,n),dtype=np.uint8),
                            signature=np.array("0"*16),study_id=np.array("example-test-aoi"))
        (folder/"inspection_v05.json").write_text(json.dumps(
            {"grid":{"origin_easting":300000,"origin_northing":5000000,"pixel_size_m":10}}))
        return folder/"features_v05.npz"

    def test_queue_is_review_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);src=self.fixture(folder)
            data=build(src,folder/"queue.json",per_class=8)
            self.assertTrue(data["all_unverified"])
            self.assertTrue(data["not_independent_validation"])
            types={i["category"] for i in data["items"]}
            self.assertEqual(len(types),3)
            for item in data["items"]:
                self.assertNotIn("label",item)
                self.assertGreater(item["lat"],0)
                self.assertTrue(-180<=item["lon"]<=180)
                self.assertEqual(item["site_group_suggestion"],block_for(item["row"],item["col"]))
            for category in types:
                groups=[i["site_group_suggestion"] for i in data["items"] if i["category"]==category]
                self.assertEqual(len(groups),len(set(groups)))

    def test_duplicate_conflict_is_not_trainable(self):
        rows=[dict(row=0,col=0,label="construction",site_group="site-a"),
              dict(row=0,col=0,label="agriculture",site_group="site-a"),
              dict(row=20,col=20,label="unchanged",site_group="site-b")]
        clean,conflicts=deduplicate_annotations(rows)
        self.assertEqual(len(conflicts),1)
        self.assertEqual(len(clean),1)

    def test_adjacent_pixels_are_same_holdout_group(self):
        rows=[dict(row=0,col=0,label="construction",site_group="differentA"),
              dict(row=24,col=24,label="construction",site_group="differentB"),
              dict(row=55,col=55,label="unchanged",site_group="differentC"),
              dict(row=70,col=70,label="unchanged",site_group="differentC")]
        groups=spatial_site_groups(rows)
        self.assertEqual(groups[0],groups[1])
        self.assertEqual(groups[2],groups[3])
        self.assertNotEqual(groups[0],groups[2])
