"""Synthetic arrays are ONLY for unit tests; never used as site observations."""
import unittest
import numpy as np
from infratrack import vegetation_candidates, interpret_landcover, worldcover_tile

class DetectorTests(unittest.TestCase):
    def bands(self,red=.10,green=.12,blue=.08,nir=.48):
        return {k:np.full((36,36),v,dtype=np.float32) for k,v in
                [("red",red),("green",green),("blue",blue),("nir",nir)]}
    def test_no_change(self):
        a=self.bands();scl=np.full((36,36),4,dtype=np.uint8)
        found,valid=vegetation_candidates(a,a,scl,scl)
        self.assertEqual(int(found.sum()),0)
        self.assertEqual(int(valid.sum()),1296)
    def test_change_candidates(self):
        scl=np.full((36,36),4,dtype=np.uint8)
        found,_=vegetation_candidates(self.bands(),self.bands(.27,.30,.27,.34),scl,scl)
        self.assertGreater(int(found.sum()),0)
    def test_cloud_mask(self):
        a=self.bands();b=self.bands(.27,.30,.27,.34)
        found,valid=vegetation_candidates(a,b,np.full((36,36),4),np.full((36,36),9))
        self.assertEqual(int(found.sum()),0)
        self.assertEqual(int(valid.sum()),0)


class LandCoverTriageTests(unittest.TestCase):
    def test_worldcover_tile_for_bucharest(self):
        self.assertEqual(worldcover_tile(44.5128, 26.2795), "N42E024")

    def test_historical_cropland_is_visible_not_dropped(self):
        raw=np.ones((4,4),dtype=bool)
        valid=np.ones((4,4),dtype=bool)
        wc=np.full((4,4),40,dtype=np.uint8)
        after={"red":np.full((4,4),.25), "nir":np.full((4,4),.32)}
        scl=np.full((4,4),4,dtype=np.uint8)
        result=interpret_landcover(raw, valid, wc, after, scl)
        self.assertTrue(result["agricultural_context"].all())
        self.assertEqual(result["persistent_noncrop"].sum(),0)

    def test_non_crop_persistent_low_ndvi(self):
        raw=np.ones((4,4),dtype=bool)
        wc=np.full((4,4),30,dtype=np.uint8)
        follow={"red":np.full((4,4),.25), "nir":np.full((4,4),.30)}
        r=interpret_landcover(raw,raw,wc,follow,np.full((4,4),4))
        self.assertTrue(r["persistent_noncrop"].all())
        self.assertEqual(r["manual_review"].sum(),0)

    def test_regrown_vegetation_downgrades_road_candidate(self):
        raw=np.ones((4,4),dtype=bool)
        wc=np.full((4,4),30,dtype=np.uint8)
        follow={"red":np.full((4,4),.10), "nir":np.full((4,4),.48)}
        r=interpret_landcover(raw,raw,wc,follow,np.full((4,4),4))
        self.assertEqual(r["persistent_noncrop"].sum(),0)
        self.assertTrue(r["manual_review"].all())
