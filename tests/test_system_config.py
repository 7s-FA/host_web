import copy
import importlib.util
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'host'))
from system_config import load, validate
from server import Host

class SystemConfigTest(unittest.TestCase):
    def test_quantity_defaults_and_supported_range(self):
        c=load()
        self.assertEqual((c['order']['quantity_min'],c['order']['quantity_max'],c['order']['quantity_default']),(1,2,2))
        for quantity in (1,2):
            c['order']['quantity_default']=quantity
            self.assertEqual(validate(c)['order']['quantity_default'],quantity)

    def test_reject_bad_config(self):
        for path, value in [(('order','quantity_min'),3),(('order','quantity_max'),3),(('order','quantity_max'),20),(('order','quantity_default'),0),(('order','quantity_default'),3),(('web_host','browser_timeout_seconds'),-1),(('ros2','domain_id'),True)]:
            c=load();c[path[0]][path[1]]=value
            with self.assertRaises(ValueError):validate(c)
        c=load();c['navigation']['dock_departure']['backup_distance_m']=0
        with self.assertRaises(ValueError):validate(c)
        c=load();c['navigation']['waiting_parking']='REVERSE_IR_ONLY'
        with self.assertRaises(ValueError):validate(c)
        c=load();c['stations']['WAITING']['docking_mode']='REVERSE_IR_ONLY'
        with self.assertRaises(ValueError):validate(c)
        c=load();c['navigation']['dock_departure']['stations'].remove('WAITING')
        with self.assertRaises(ValueError):validate(c)
        c=load();c['devices']['burger2']['action_name']=c['devices']['burger1']['action_name']
        with self.assertRaises(ValueError):validate(c)
        c=load();c['transitions']['next_delivery']['requires_all']=['unknown']
        with self.assertRaises(ValueError):validate(c)
    def test_host_policy_and_timeout(self):
        c=load();c['order'].update(quantity_min=2,quantity_max=2,quantity_default=2,auto_advance_default=True);c['web_host']['browser_timeout_seconds']=2
        now=[0];h=Host(lambda:now[0],validate(c))
        h.handle('connect',{'client_id':'test-client'})
        self.assertEqual(h.state()['order_policy']['quantity_default'],2)
        self.assertTrue(h.auto)
        for q in [1,3]:
            with self.assertRaises(ValueError):h.handle('start',{'client_id':'test-client','message_id':str(q),'quantity':q})
        h.handle('start',{'client_id':'test-client','message_id':'valid','quantity':2})
        now[0]=2.1
        self.assertEqual(h.state()['status'],'paused')

if __name__=='__main__':unittest.main()
