"""Deterministic geometry tests: inputs are synthetic coordinates, never satellite detections."""
import unittest
import numpy as np
from pyproj import Transformer
from rasterio.transform import from_origin
from corridor_osm import corridor_raster, aoi_bounds, _features

class CorridorTests(unittest.TestCase):
    def test_aoi_bounds_enclose_center(self):
        coords=aoi_bounds(26.2328,44.5065,2000)
        self.assertLess(coords[0][0],44.5065)
        self.assertGreater(coords[1][0],44.5065)
        self.assertLess(coords[0][1],26.2328)
        self.assertGreater(coords[1][1],26.2328)

    def test_osm_way_id_requires_ref_and_coords(self):
        element={"id":1517261128,"tags":{"ref":"A0","highway":"motorway"},
          "geometry":[{"lon":26.2328,"lat":44.5065},
                      {"lon":26.234,"lat":44.507}]}
        self.assertEqual(len(_features([element])["features"]),1)
        bad={**element,"id":1}
        self.assertEqual(len(_features([bad])["features"]),0)

    def test_raster_buffer_is_local_not_entire_scene(self):
        t=Transformer.from_crs("EPSG:4326","EPSG:32635",always_xy=True)
        x,y=t.transform(26.2328,44.5065)
        transform=from_origin(x-1000,y+1000,10,10)
        route={"features":[{"geometry":{"coordinates":[[26.2328,44.501],
                                                        [26.2328,44.512]]}}]}
        mask=corridor_raster(route,transform,200)
        self.assertTrue(mask.any())
        self.assertLess(mask.mean(),.35)
        self.assertGreater(mask.mean(),.03)

    def test_missing_osm_geometry_has_no_road_pixels(self):
        mask=corridor_raster({"features":[]},from_origin(0,0,10,10),200)
        self.assertFalse(mask.any())
