"""Synthetic arrays are ONLY for unit tests; never used as site observations."""
import unittest
import numpy as np
from infratrack import vegetation_candidates

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
