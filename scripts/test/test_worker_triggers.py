import importlib.util
import pathlib
import unittest
p = pathlib.Path(__file__).resolve().parents[1] / 'worker-triggers.py'
spec = importlib.util.spec_from_file_location('triggers',p)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
class TriggerTests(unittest.TestCase):
    def config(self):
        return dict(name='mccluster', workers_dev=False, preview_urls=False,
                    routes=[{'pattern':'api.example.test','custom_domain':True}], triggers={'crons':['*/5 * * * *']})
    def test_exact_parity(self):
        d=m.desired(self.config());self.assertTrue(m.plan(d,d)['matches'])
    def test_implicit_routes_fail_closed(self):
        c=self.config();del c['routes']
        with self.assertRaises(ValueError):m.desired(c)
    def test_implicit_exposure_fails_closed(self):
        c=self.config();del c['preview_urls']
        with self.assertRaises(ValueError):m.desired(c)
    def test_drift_changes_review_digest(self):
        d=m.desired(self.config());live={**d,'crons':['0 * * * *']}
        a=m.plan(live,d);self.assertFalse(a['matches']);self.assertIn('crons',a['changes'])
        self.assertNotEqual(a['review_digest'],m.plan(d,d)['review_digest'])
    def test_incomplete_inventory_is_not_empty(self):
        d=m.desired(self.config())
        with self.assertRaises(ValueError):m.plan({},d)
    def test_other_worker_refused(self):
        d=m.desired(self.config())
        with self.assertRaises(ValueError):m.plan({**d,'worker':'other'},d)
    def test_error_shape_is_not_empty_routes(self):
        d=m.desired(self.config())
        with self.assertRaises(ValueError):m.plan({**d,'routes':None},d)
if __name__=='__main__':unittest.main()
