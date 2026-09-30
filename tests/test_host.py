import copy
import importlib.util
import json
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path

spec = importlib.util.spec_from_file_location('server', Path(__file__).resolve().parents[1] / 'host/server.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def baseline_system_config():
    c=copy.deepcopy(m.SYSTEM_CONFIG)
    c['order'].update(quantity_min=1,quantity_max=20,quantity_default=2,auto_advance_default=False)
    c['web_host']['browser_timeout_seconds']=5
    return c

class HostTest(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.h = m.Host(lambda: self.now, baseline_system_config())
        self.serial = 0
        self.send('connect')
        self.assertEqual(self.h.state()['scenario_mode'], 'destination-v2')
        self.assertEqual(self.h.state()['sample_stage_count'], len(m.SCENARIOS['2']))

    def test_server_settings_snapshot(self):
        self.assertEqual(self.h.state()['simulation_config'], m.SCENARIO_CONFIG)
        self.assertEqual(m.SCENARIO_CONFIG['version'], 1)

    def send(self, action, **data):
        self.serial += 1
        return self.h.handle(action, {'client_id':'test-client', 'message_id':str(self.serial), **data})

    def ack(self):
        c = self.h.pending
        return self.send('ack', order_id=c['order_id'], seq=c['seq'], time=c['target_time'])

    def test_all_quantities_manual_and_auto(self):
        for q in range(1,21):
            for auto in (False, True):
                self.send('reset')
                self.send('auto', enabled=auto)
                s = self.send('start', quantity=q)
                steps = 0
                while s['status'] != 'done':
                    if s['status'] == 'waiting':
                        s = self.send('next')
                    c = s['command']
                    s = self.ack()
                    before = (self.h.index, self.h.pending)
                    duplicate = self.send('ack', order_id=c['order_id'], seq=c['seq'], time=c['target_time'])
                    self.assertEqual(before, (self.h.index, self.h.pending))
                    self.assertGreaterEqual(duplicate['counters']['remaining'], 0)
                    steps += 1
                self.assertEqual(steps, len(m.SCENARIOS[str(q)]))
                self.assertEqual(s['counters']['completed'], q)
                self.assertEqual(s['counters']['transport'], 0)
                self.assertEqual(s['counters']['remaining'], 0)
                self.assertTrue(s['counters']['done'])

    def test_invalid_and_out_of_order(self):
        for q in (0,21,True,1.5,'2'):
            with self.assertRaises(ValueError): self.send('start', quantity=q)
        self.send('start', quantity=2)
        with self.assertRaises(ValueError): self.send('next')
        c = self.h.pending.copy()
        for fields in ({'seq':99}, {'order_id':'old'}, {'time':123}):
            data = dict(order_id=c['order_id'], seq=c['seq'], time=c['target_time'])
            data.update(fields)
            with self.assertRaises(ValueError): self.send('ack', **data)
        self.assertEqual(self.h.index, -1)
        self.send('reset');self.send('start', quantity=1)
        with self.assertRaises(ValueError): self.send('ack', order_id=c['order_id'], seq=c['seq'], time=c['target_time'])

    def test_pause_timeout_resume_and_ownership(self):
        self.send('start', quantity=2)
        cmd = self.h.pending.copy()
        self.send('pause')
        with self.assertRaises(ValueError): self.ack()
        self.send('resume')
        self.assertEqual(cmd, self.h.pending)
        self.now = 6
        self.assertEqual(self.h.state()['status'], 'paused')
        self.send('heartbeat')
        self.assertEqual(self.h.status, 'paused')
        self.send('resume');self.ack()
        with self.assertRaises(ValueError): self.send('connect', client_id='other-client')
        self.send('disconnect');self.send('connect', client_id='other-client')
        self.assertEqual(self.h.owner, 'other-client')

    def test_same_request_is_idempotent(self):
        a=self.send('start', quantity=2, message_id='same-start')
        b=self.send('start', quantity=2, message_id='same-start')
        self.assertEqual(a['order_id'], b['order_id'])
        self.ack()
        self.send('next', message_id='same-next')
        self.ack()
        index=self.h.index
        self.send('next', message_id='same-next')
        self.assertEqual(self.h.index,index)
        self.assertIsNone(self.h.pending)

class HTTPTest(unittest.TestCase):
    def test_real_http(self):
        server=m.make_server(0)
        server.host=m.Host(system_config=baseline_system_config())
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base=f'http://127.0.0.1:{server.server_port}'
        try:
            with urllib.request.urlopen(base+'/?host=1') as r:
                self.assertIn(b'host-client.js',r.read())
                self.assertEqual(r.headers['Cache-Control'],'no-store')
            for name in ['host-client.js','engine.js','app.js','assets/full-map.jpg']:
                with urllib.request.urlopen(base+'/'+name) as r:
                    self.assertEqual(r.status,200)
                    self.assertTrue(r.read())
            def post(action, origin=base, **data):
                req=urllib.request.Request(base+'/api/'+action,json.dumps({'client_id':'http-test', 'message_id':action,**data}).encode(),{'Content-Type':'application/json','Origin':origin})
                with urllib.request.urlopen(req) as r:return json.load(r)
            post('connect')
            s=post('start',quantity=2)
            c=s['command']
            self.assertEqual(post('ack',order_id=c['order_id'],seq=c['seq'],time=c['target_time'])['status'],'waiting')
            with self.assertRaises(urllib.error.HTTPError): post('reset',origin='https://example.com')
            with self.assertRaises(urllib.error.HTTPError): urllib.request.urlopen(base+'/host/server.py')
        finally:
            server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
