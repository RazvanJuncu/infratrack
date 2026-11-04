"""No fake production monitoring: test recent change mathematics on synthetic fixtures only."""
import unittest
import numpy as np
from rasterio.transform import from_origin
from scripts.recent_watch import significance,site_candidates,valid_pair,metadata

class RecentWatchTests(unittest.TestCase):
    def scene(self,red=.2,nir=.4,cloud=False):
        arr=lambda value:np.full((40,40),value,dtype=np.float32)
        bands={"red":arr(red),"nir":arr(nir),"blue":arr(.09),
               "green":arr(.16)}
        scl=np.full((40,40),8 if cloud else 4,dtype=np.uint8)
        return ({"id":"test-only","properties":{"datetime":"2026-10-15T00:00:00Z"}},
                 bands,scl)
    def test_clear_and_significant_change(self):
        a=self.scene(red=.12,nir=.65)
        b=self.scene(red=.24,nir=.2)
        score,good,*_=significance(a,b)
        self.assertTrue(good.all())
        self.assertGreater(score.mean(),.3)
        items=site_candidates(score,good,"research-aoi",
            from_origin(500000,5000000,10,10),["2026-09-01","2026-10-01"],8)
        self.assertGreater(len(items),0)
        self.assertTrue(all(x["type"]=="unverified_spectral_change" for x in items))
        self.assertEqual(len(set(x["site_group_suggestion"] for x in items)),len(items))
    def test_cloud_masks_prevent_fake_changes(self):
        a=self.scene(red=.1,nir=.8,cloud=True)
        b=self.scene(red=.8,nir=.1)
        score,good,*_=significance(a,b)
        self.assertFalse(good.any())
        self.assertEqual(int(score.sum()),0)
        items=site_candidates(score,good,"research-aoi",
            from_origin(500000,5000000,10,10),["2026-09-01","2026-10-01"])
        self.assertEqual(items,[])
    def test_scenes_equal_have_no_candidates(self):
        a=self.scene()
        b=self.scene()
        score,good,*_=significance(a,b)
        self.assertTrue(good.all())
        self.assertEqual(len(site_candidates(score,good,"research-aoi",
            from_origin(500000,5000000,10,10),["2026-10-01","2026-10-20"])),0)
    def test_provenance_never_claims_construction(self):
        site={"id":"test-study","name":"Test study","size_km":2}
        p=metadata(site,None,"ready",significant_candidate_count=4)
        self.assertFalse(p["automatic_construction_detection"])
        self.assertIn("not",p["warning"].lower())
