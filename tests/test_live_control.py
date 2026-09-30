"""Real-mode page must never advance from simulation time or unverified reports."""
import json
import os
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'host'))
from live_control import LiveControl, DEVICES
from server import make_server


def report(revision=1, order=None, conditions=None, can_advance=False, accepted=None):
    return {'revision': revision, 'devices': {name: {'state': 'idle', 'detail': '대기'} for name in DEVICES},
            'order': order, 'conditions': conditions or [], 'can_advance': can_advance,
            'accepted_command_ids': accepted or [], 'log': ['장치 상태 수신']}


def order(status='waiting', stage=1):
    return {'id': 'order-1', 'status': status, 'quantity': 2, 'transport_remaining': 1,
            'product_remaining': 2, 'completed': 0, 'stage': stage, 'stage_count': 8}


class LiveControlTest(unittest.TestCase):
    def test_validated_completion_and_stale_bridge(self):
        now = [0]
        live = LiveControl('secret', clock=lambda: now[0], timeout=3)
        self.assertFalse(live.state()['bridge_connected'])
        with self.assertRaises(ValueError): live.issue('start', {'quantity': 2})
        with self.assertRaises(PermissionError): live.update(report(), 'wrong')
        with self.assertRaises(ValueError): live.update(report(order=order(), can_advance=True), 'secret')
        live.update(report(), 'secret')
        self.assertTrue(live.state()['bridge_connected'])
        live.issue('start', {'quantity': 2})
        command = live.pending('secret')[0]
        self.assertEqual(command['action'], 'start')
        with self.assertRaises(ValueError): live.issue('next', {})
        live.update(report(2, order('waiting'), [{'label': '도킹 완료', 'done': True}], True, [command['id']]), 'secret')
        self.assertTrue(live.state()['can_advance'])
        live.issue('next', {})
        next_id = live.pending('secret')[0]['id']
        live.update(report(3, order('waiting'), [{'label': '도킹 완료', 'done': True}], True, [next_id]), 'secret')
        with self.assertRaises(ValueError): live.issue('next', {})  # same order/stage cannot run twice
        with self.assertRaises(ValueError): live.update(report(3), 'secret')
        now[0] = 3.1
        self.assertFalse(live.state()['bridge_connected'])
        self.assertFalse(live.state()['can_advance'])
        with self.assertRaises(ValueError): live.issue('next', {})

    def test_http_page_and_bridge_contract(self):
        previous = os.environ.get('ROBOT3_BRIDGE_TOKEN')
        os.environ['ROBOT3_BRIDGE_TOKEN'] = 'test-secret'
        server = make_server(0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = f'http://127.0.0.1:{server.server_port}'
            self.assertIn(b'HOST PC', urlopen(base+'/control.html').read())
            self.assertIn(b'control-grid', urlopen(base+'/control.css').read())
            self.assertIn(b'/api/live/state', urlopen(base+'/control.js').read())
            def post(path, data, token=None):
                headers = {'Content-Type': 'application/json', 'Origin': base}
                if token: headers['X-Bridge-Token'] = token
                request = Request(base+path, json.dumps(data).encode(), headers)
                return json.load(urlopen(request))
            state = json.load(urlopen(base+'/api/live/state'))
            self.assertFalse(state['bridge_connected'])
            with self.assertRaises(HTTPError) as error:
                post('/api/live/report', report(), 'wrong')
            self.assertEqual(error.exception.code, 403)
            post('/api/live/report', report(), 'test-secret')
            self.assertTrue(json.load(urlopen(base+'/api/live/state'))['bridge_connected'])
            post('/api/live/start', {'quantity': 2})
            with self.assertRaises(HTTPError) as error:
                urlopen(base+'/api/live/commands')
            self.assertEqual(error.exception.code, 403)
            request = Request(base+'/api/live/commands', headers={'X-Bridge-Token': 'test-secret'})
            commands = json.load(urlopen(request))
            self.assertEqual(commands[0]['action'], 'start')
            self.assertEqual(commands[0]['quantity'], 2)
        finally:
            server.shutdown();server.server_close();thread.join(timeout=2)
            if previous is None: os.environ.pop('ROBOT3_BRIDGE_TOKEN', None)
            else: os.environ['ROBOT3_BRIDGE_TOKEN'] = previous


if __name__ == '__main__':
    unittest.main()
