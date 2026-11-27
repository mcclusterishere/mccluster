import datetime as dt
import unittest
import numpy as np

from fetch import select
from pilot import aggregate, design, evaluate, guarded, rate, stereo_k


class TestPilot(unittest.TestCase):
    def setUp(self):
        self.ix = np.arange(192)
        self.iy = np.arange(96)
        self.lat = np.full((96,192), 84.)
        self.g = np.zeros((4,96,192))
        self.g[0,:,:] = 1e-6

    def calc(self, side, k="target", shift=0, threshold=.75):
        return aggregate(self.g,self.lat,self.ix,self.iy,side,96,threshold,shift,label=(k=="proxy"))

    def test_uniform_analytic_gradient(self):
        true = np.sqrt(2.) * 1e-6 * 86400
        actual,n = self.calc("right")
        np.testing.assert_allclose(actual, [true]*3)
        self.assertGreaterEqual(n,4)

    def test_average_sign_before_norm(self):
        self.g[0,:,::2] *= -1
        self.assertGreater(float(np.mean(rate(self.g))),0.)
        np.testing.assert_allclose(self.calc("right")[0], [0.]*3,atol=1e-15)

    def test_disjoint_label_and_target(self):
        old=self.calc("left","proxy")
        self.g[:,:,105:]*=100
        self.assertEqual(self.calc("left","proxy"),old)
        self.assertGreater(self.calc("right")[0][0],old[0][0]*50)

    def test_rigid_rotation_gives_zero(self):
        self.assertEqual(rate(np.array([0.,1.,-1.,0.])),0.)

    def test_coverage_and_offset(self):
        self.g[:,:,120:125]=np.nan
        loose=self.calc("right",threshold=.75)
        strict=self.calc("right",threshold=1.)
        self.assertLessEqual(strict[1],loose[1])
        self.assertTrue(np.allclose(self.calc("right",shift=8)[0],strict[0]))
        self.g[:]=np.nan
        with self.assertRaisesRegex(ValueError,"coverage"):
            self.calc("right")

    def test_projection_true_scale(self):
        self.assertAlmostEqual(stereo_k(70),1)
        self.assertTrue(1.02<1/stereo_k(85)<1.04)

    def test_model_design(self):
        for k in range(3):
            self.assertEqual(design([0,1],k).shape,(6,2+k))

    @staticmethod
    def rows():
        out=[]
        for i in range(13):
            w=dt.datetime(2019,10,14)+dt.timedelta(days=7*i)
            y=[np.exp(c) for c in (0,0,0)] if i%2==0 else [8.,4.,2.]
            out.append(dict(week=w.date().isoformat(),start=w.isoformat(),end=(w+dt.timedelta(days=1)).isoformat(),
                            scenarios={"primary":dict(proxy_per_day=i%2+.001*i,target_per_day=y)}))
        return out

    def test_guard_filters_neighbor_and_shared_scene(self):
        a,b,c=self.rows()[:3]
        self.assertFalse(guarded(a,b))
        self.assertTrue(guarded(a,c))
        self.assertFalse(guarded(a,dict(c,start=a["end"])))

    def test_holdout_recover_interaction_and_no_threshold_leak(self):
        data=self.rows()
        # Two distinct proxy plateaus; fold medians sometimes split the lower plateau.
        for r in data:
            r["scenarios"]["primary"]["proxy_per_day"]=round(r["scenarios"]["primary"]["proxy_per_day"])
        r=evaluate(data,"primary")
        self.assertEqual(r["n_scored"],13)
        self.assertLess(r["mean_held_out_log_mse"]["group_slopes"],r["mean_held_out_log_mse"]["group_levels"])
        old = r["folds"][0]["threshold_per_day"]
        data[0]["scenarios"]["primary"]["proxy_per_day"]=999.
        self.assertEqual(evaluate(data,"primary")["folds"][0]["threshold_per_day"],old)

    def test_fetch_rejects_cross_week_and_long_acquisition(self):
        head = "Date/Time (start)\tDate/Time (end)\tnetCDF\n"
        name = "pairs_20191015T06021571_20191016T06431571_drift_and_deformation.nc"
        text = head + "\n".join(a+"\t"+b+"\t"+name for a,b in
              [("2019-10-14T00:00","2019-10-16T00:00"),("2019-10-20T00:00","2019-10-21T00:00"),
               ("2019-10-15T06:02","2019-10-16T06:43")])
        self.assertEqual([r["start"] for r in select(text)],["2019-10-15T06:02:00"])

if __name__ == "__main__":
    unittest.main()

