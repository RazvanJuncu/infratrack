"""v0.4 unit tests: generated arrays validate rules only, NOT real-world accuracy."""
import unittest
import numpy as np
from spectral_v04 import indices, triage, report

N=48

def bands(blue,red,nir,swir16):
    values=dict(blue=blue,red=red,nir=nir,swir16=swir16,green=.18)
    return {k:np.full((N,N),v,dtype=np.float32) for k,v in values.items()}

VEGETATED=bands(.07,.08,.49,.18)
EXPOSED=bands(.21,.24,.30,.38)

class MultispectralTests(unittest.TestCase):
    def evaluate(self,spring=None,follow=None,cropland=40,cloud=False):
        scl=np.full((N,N),4,dtype=np.uint8)
        scl_follow=np.full((N,N),9 if cloud else 4,dtype=np.uint8)
        return triage(VEGETATED,EXPOSED,spring or EXPOSED,follow or EXPOSED,
                      scl,scl,scl,scl_follow,
                      np.ones((N,N),dtype=bool),
                      np.full((N,N),cropland,dtype=np.uint8))

    def test_bsi_ndbi_are_finite(self):
        values=indices(EXPOSED)
        self.assertTrue(np.isfinite(values["bsi"]).all())
        self.assertTrue(np.isfinite(values["ndbi"]).all())
        self.assertLess(float(values["ndvi"][0,0]),.37)

    def test_bare_in_three_later_scenes_is_candidate_not_certainty(self):
        masks=self.evaluate()
        self.assertGreater(int(masks["persistent"].sum()),0)
        self.assertEqual(int(masks["regrowth"].sum()),0)
        self.assertFalse(report(masks)["counts_as_construction"])
        self.assertIsNone(report(masks)["model_accuracy"])

    def test_cropland_regrowth_is_not_infrastructure(self):
        masks=self.evaluate(spring=VEGETATED,follow=VEGETATED,cropland=40)
        self.assertEqual(int(masks["persistent"].sum()),0)
        self.assertGreater(int(masks["regrowth"].sum()),0)

    def test_noncrop_regrowth_stays_unresolved(self):
        masks=self.evaluate(spring=VEGETATED,follow=VEGETATED,cropland=30)
        self.assertEqual(int(masks["persistent"].sum()),0)
        self.assertGreater(int(masks["uncertain"].sum()),0)

    def test_missing_clear_followup_never_marks_persistence(self):
        masks=self.evaluate(cloud=True)
        self.assertEqual(int(masks["persistent"].sum()),0)
        self.assertEqual(report(masks)["corridor_valid_percent"],0.0)

    def test_missing_swir_fails_explicitly(self):
        broken=dict(EXPOSED)
        del broken["swir16"]
        with self.assertRaises(ValueError):
            indices(broken)
