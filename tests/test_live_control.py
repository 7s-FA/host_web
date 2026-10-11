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
    def test_four_communication_units_required(self):
        self.assertEqual(DEVICES, ('M1', 'M2', 'warehouse', 'production'))
        live = LiveControl('secret')
        self.assertEqual(set(live.state()['devices']), set(DEVICES))
        self.assertTrue(all(item['state'] == 'unknown' and item['log'] == []
                            for item in live.state()['devices'].values()))
        for names in (('M1', 'M2', 'warehouse'), (*DEVICES, 'arm1'),
                      ('burger1', 'burger2', 'arm1', 'arm2', 'arm3')):
            with self.subTest(devices=names):
                invalid = report()
                invalid['devices'] = {name: {'state': 'idle'} for name in names}
                with self.assertRaises(ValueError): live.update(invalid, 'secret')
                self.assertFalse(live.connected())
        state = live.update(report(), 'secret')
        self.assertTrue(all(item['log'] == [] for item in state['devices'].values()))

    def test_product_type_preserved_in_command_and_order(self):
        for fields, expected in (({}, 'A'), ({'product_type': 'A'}, 'A'), ({'product_type': 'B'}, 'B')):
            with self.subTest(product=expected, fields=fields):
                live = LiveControl('secret')
                live.update(report(), 'secret')
                live.issue('start', {'quantity': 2, **fields})
                command = live.pending('secret')[0]
                self.assertEqual(command['product_type'], expected)
                self.assertEqual(command['quantity'], 2)
                state = live.update(report(2, {**order(), **fields}, accepted=[command['id']]), 'secret')
                self.assertEqual(state['order']['product_type'], expected)
                self.assertEqual(live.pending('secret'), [])

    def test_reject_invalid_product_type(self):
        live = LiveControl('secret')
        live.update(report(), 'secret')
        for product_type in ('', 'C', 'a', None, True, 1, [], {}):
            with self.subTest(product_type=product_type):
                with self.assertRaises(ValueError):
                    live.issue('start', {'quantity': 2, 'product_type': product_type})
                self.assertEqual(live.pending('secret'), [])
                with self.assertRaises(ValueError):
                    live.update(report(2, {**order(), 'product_type': product_type}), 'secret')
                self.assertEqual(live.revision, 1)

    def test_separate_logs_remain_available_after_disconnect(self):
        now = [0]
        live = LiveControl('secret', clock=lambda: now[0], timeout=3)
        incoming = report()
        incoming['log'] = ['Host 연결 확인']
        for name in DEVICES:
            incoming['devices'][name]['log'] = [name + ' 수신 기록']
        live.update(incoming, 'secret')
        state = live.issue('start', {'quantity': 1, 'product_type': 'B'})
        self.assertEqual(state['log'][0], 'Host 연결 확인')
        self.assertIn('start 지시 대기', state['log'][1])
        for name in DEVICES:
            self.assertEqual(state['devices'][name]['log'], [name + ' 수신 기록'])
            self.assertNotIn(name + ' 수신 기록', state['log'])
        now[0] = 3.1
        stale = live.state()
        self.assertFalse(stale['bridge_connected'])
        self.assertFalse(stale['can_advance'])
        self.assertIsNone(stale['order'])
        self.assertEqual(stale['conditions'], [])
        self.assertEqual(stale['log'], state['log'])
        for name in DEVICES:
            self.assertEqual(stale['devices'][name]['state'], 'unknown')
            self.assertEqual(stale['devices'][name]['log'], state['devices'][name]['log'])

    def test_log_validation_and_length_limits(self):
        live = LiveControl('secret')
        for source in ('host', *DEVICES):
            for entries in ('text', None, [1], ['line'] * 51):
                with self.subTest(source=source, entries=entries):
                    invalid = report()
                    target = invalid if source == 'host' else invalid['devices'][source]
                    target['log'] = entries
                    with self.assertRaises(ValueError): live.update(invalid, 'secret')
                    self.assertFalse(live.connected())
        incoming = report()
        incoming['log'] = ['x' * 201] * 50
        for name in DEVICES:
            incoming['devices'][name]['log'] = ['y' * 201] * 50
        state = live.update(incoming, 'secret')
        self.assertEqual(state['log'], ['x' * 200] * 50)
        for name in DEVICES:
            self.assertEqual(state['devices'][name]['log'], ['y' * 200] * 50)
        without_logs = report(2)
        without_logs.pop('log')
        state = live.update(without_logs, 'secret')
        self.assertEqual(state['log'], [])
        self.assertTrue(all(item['log'] == [] for item in state['devices'].values()))

    def test_order_quantity_limits(self):
        for quantity in (1, 2):
            with self.subTest(quantity=quantity):
                live = LiveControl('secret')
                live.update(report(), 'secret')
                live.issue('start', {'quantity': quantity})
                self.assertEqual(live.pending('secret')[0]['quantity'], quantity)
        live = LiveControl('secret')
        live.update(report(), 'secret')
        for quantity in (0, 3, 20, True, 1.5, '2'):
            with self.subTest(quantity=quantity):
                with self.assertRaises(ValueError): live.issue('start', {'quantity': quantity})
                self.assertEqual(live.pending('secret'), [])

    def test_reject_order_report_above_quantity_limit(self):
        live = LiveControl('secret')
        for key in ('quantity', 'transport_remaining', 'product_remaining', 'completed'):
            with self.subTest(field=key):
                invalid_order = order()
                invalid_order[key] = 3
                with self.assertRaises(ValueError): live.update(report(order=invalid_order), 'secret')
                self.assertFalse(live.connected())

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
            large_report = report(2)
            large_report['log'] = ['가' * 200] * 50
            for name in DEVICES:
                large_report['devices'][name]['log'] = ['나' * 200] * 50
            encoded_size = len(json.dumps(large_report).encode())
            self.assertGreater(encoded_size, 32768)
            self.assertLess(encoded_size, 1024 * 1024)
            state = post('/api/live/report', large_report, 'test-secret')
            self.assertEqual(state['log'], large_report['log'])
            for name in DEVICES:
                self.assertEqual(state['devices'][name]['log'], large_report['devices'][name]['log'])
            with self.assertRaises(HTTPError) as error:
                post('/api/live/start', {'quantity': 3})
            self.assertEqual(error.exception.code, 400)
            with self.assertRaises(HTTPError) as error:
                post('/api/live/start', {'quantity': 2, 'product_type': 'C'})
            self.assertEqual(error.exception.code, 400)
            post('/api/live/start', {'quantity': 2, 'product_type': 'B'})
            with self.assertRaises(HTTPError) as error:
                urlopen(base+'/api/live/commands')
            self.assertEqual(error.exception.code, 403)
            request = Request(base+'/api/live/commands', headers={'X-Bridge-Token': 'test-secret'})
            commands = json.load(urlopen(request))
            self.assertEqual(commands[0]['action'], 'start')
            self.assertEqual(commands[0]['quantity'], 2)
            self.assertEqual(commands[0]['product_type'], 'B')
        finally:
            server.shutdown();server.server_close();thread.join(timeout=2)
            if previous is None: os.environ.pop('ROBOT3_BRIDGE_TOKEN', None)
            else: os.environ['ROBOT3_BRIDGE_TOKEN'] = previous


if __name__ == '__main__':
    unittest.main()
