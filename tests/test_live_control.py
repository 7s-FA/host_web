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
    def test_continuous_four_products_and_cumulative_limit(self):
        live=LiveControl('secret')
        active=order(status='running')
        active.update(plan_mode='continuous-v1',products=['A','B','A'],quantity=3,
                      product_remaining=3,transport_remaining=3)
        data=report(order=active)
        data.update(supports_order_queue=True,supports_continuous_orders=True,
                    can_start=False,can_enqueue=True,remaining_capacity={'A':0,'B':1})
        live.update(data,'secret')
        self.assertTrue(live.state()['supports_continuous_orders'])
        self.assertEqual(live.state()['remaining_capacity'],{'A':0,'B':1})
        for quantities in ({'A':1,'B':0},{'A':0,'B':2}):
            with self.assertRaises(ValueError):live.issue('enqueue',dict(quantities=quantities))
        live.issue('enqueue',dict(quantities={'A':0,'B':1}))
        active.update(products=['A','B','A','B'],quantity=4,product_remaining=4,transport_remaining=4)
        data.update(revision=2,remaining_capacity={'A':0,'B':0},can_enqueue=False)
        live.update(data,'secret')
        self.assertEqual(live.state()['order']['quantity'],4)
        active['products']=['A','A','A','B']
        with self.assertRaises(ValueError):live.update(dict(data,revision=3),'secret')

    def test_queue_capabilities_and_validation(self):
        live=LiveControl('secret')
        data=report();data.update(supports_order_queue=True,can_enqueue=True,can_next_batch=True,
                                 queue_revision=3,pending_batches=[{'products':['A','B']}])
        live.update(data,'secret')
        for quantities in ({'A':True,'B':0},{'A':3,'B':1},{'A':0,'B':0}):
            with self.assertRaises(ValueError):live.issue('enqueue',dict(quantities=quantities))
        live.issue('enqueue',dict(quantities={'A':2,'B':2}))
        self.assertEqual(live.pending('secret')[0]['quantities'],{'A':2,'B':2})
        self.assertFalse(live.state()['can_enqueue'])
        live.update(dict(data,revision=2,accepted_command_ids=[live.pending('secret')[0]['id']]),'secret')
        with self.assertRaises(ValueError):live.issue('next_batch',dict(order_id=None,queue_revision=2,operator_confirmed=True))
        live.issue('next_batch',dict(order_id=None,queue_revision=3,operator_confirmed=True))

    def test_movement_reset_does_not_require_failed_order_and_rejects_stale_view(self):
        live=LiveControl('secret')
        data=report();data.update(movement_reset_available={'M1':False,'M2':True},manual_revision=9)
        live.update(data,'secret')
        payload=dict(device='M2',order_id=None,recovery_revision=9,operator_confirmed=True)
        with self.assertRaises(ValueError):live.issue('reset_movement',dict(payload,recovery_revision=8))
        with self.assertRaises(ValueError):live.issue('reset_movement',dict(payload,device='M1'))
        live.issue('reset_movement',payload)
        self.assertEqual(live.pending('secret')[0]['action'],'reset_movement')
        self.assertFalse(live.state()['movement_reset_available']['M2'])

    def test_manual_move_availability_is_per_robot_and_stale_reports_lock(self):
        now=[0];live=LiveControl('secret',clock=lambda:now[0])
        data=report();data.update(can_manual_move=True,manual_move_available={'M1':False,'M2':True},manual_revision=2)
        live.update(data,'secret')
        payload=dict(order_id=None,stage=0,recovery_revision=2,operator_confirmed=True,destination='GO_TO_MAT')
        self.assertEqual(live.state()['manual_move_available'],{'M1':False,'M2':True})
        with self.assertRaises(ValueError):live.issue('manual_move',dict(payload,device='M1'))
        live.issue('manual_move',dict(payload,device='M2'))
        self.assertEqual(live.pending('secret')[0]['device'],'M2')
        self.assertFalse(any(live.state()['manual_move_available'].values()))
        now[0]=10
        self.assertFalse(any(live.state()['manual_move_available'].values()))
    def test_full_reset_parking_confirmation_forwarded_only_as_boolean_in_hardware(self):
        live=LiveControl('secret')
        data=report();data.update(can_full_reset=True,manual_revision=8,runtime_mode='hardware',supports_parked_full_reset=True)
        live.update(data,'secret')
        payload=dict(order_id=None,recovery_revision=8,operator_confirmed=True)
        for flag in ('true',1,None):
            with self.assertRaises(ValueError):live.issue('full_reset',dict(payload,amrs_parked=flag))
        live.issue('full_reset',dict(payload,amrs_parked=True))
        self.assertIs(live.pending('secret')[0]['amrs_parked'],True)
        live=LiveControl('secret');data['runtime_mode']='mock';live.update(data,'secret')
        with self.assertRaises(ValueError):live.issue('full_reset',dict(payload,amrs_parked=True))
        live=LiveControl('secret');data['runtime_mode']='hardware'
        data.pop('supports_parked_full_reset');live.update(data,'secret')
        with self.assertRaises(ValueError):live.issue('full_reset',dict(payload,amrs_parked=True))

    def test_full_reset_requires_current_context_and_exclusive_queue(self):
        live = LiveControl('secret')
        data = report(); data.update(can_full_reset=True, manual_revision=8)
        live.update(data, 'secret')
        payload = dict(order_id=None, recovery_revision=8, operator_confirmed=True)
        for patch in (dict(operator_confirmed=False), dict(recovery_revision=7),
                      dict(order_id='old'), dict(recovery_revision=True)):
            with self.assertRaises(ValueError): live.issue('full_reset', dict(payload, **patch))
        live.issue('full_reset', payload)
        self.assertEqual(live.pending('secret')[0]['action'], 'full_reset')
        self.assertFalse(live.state()['can_full_reset'])
        with self.assertRaises(ValueError): live.issue('full_reset', payload)

    def test_full_reset_defaults_disabled_and_cancel_requires_job_identity(self):
        live = LiveControl('secret'); live.update(report(), 'secret')
        self.assertFalse(live.state()['can_full_reset'])
        with self.assertRaises(ValueError):
            live.issue('full_reset', dict(order_id=None, recovery_revision=0, operator_confirmed=True))
        data = report(2); data['full_reset'] = dict(id='init-1', status='running')
        live.update(data, 'secret')
        with self.assertRaises(ValueError): live.issue('cancel_full_reset', dict(reset_id='old'))
        live.issue('cancel_full_reset', dict(reset_id='init-1'))
        self.assertEqual(live.pending('secret')[0]['reset_id'], 'init-1')

    def test_parked_prepare_requires_confirmation_context_and_exclusivity(self):
        live = LiveControl('secret')
        data = report()
        data.update(can_prepare_parked=True, runtime_mode='hardware', manual_revision=3)
        live.update(data, 'secret')
        payload = dict(device='M2', order_id=None, recovery_revision=3, operator_confirmed=True)
        for patch in (dict(device='arm1'), dict(operator_confirmed=False),
                      dict(recovery_revision=2), dict(order_id='old')):
            with self.assertRaises(ValueError):
                live.issue('prepare_parked', dict(payload, **patch))
        live.issue('prepare_parked', payload)
        self.assertEqual(live.pending('secret')[0]['device'], 'M2')
        self.assertFalse(live.state()['can_prepare_parked'])
        with self.assertRaises(ValueError):
            live.issue('prepare_parked', payload)

    def test_idle_manual_requires_current_context_and_blocks_duplicate(self):
        live=LiveControl('secret')
        data=report();data.update(can_manual_move=True,manual_revision=2)
        live.update(data,'secret')
        payload=dict(order_id=None,stage=0,recovery_revision=2,operator_confirmed=True,
                     device='M2',destination='GO_TO_PARK')
        for patch in (dict(order_id='old'),dict(recovery_revision=1),dict(operator_confirmed=False),
                      dict(destination='RESTART')):
            with self.assertRaises(ValueError):live.issue('manual_move',dict(payload,**patch))
        self.assertEqual(live.state()['manual_revision'],2)
        live.issue('manual_move',payload)
        self.assertEqual(live.pending('secret')[0]['device'],'M2')
        self.assertIsNone(live.pending('secret')[0]['order_id'])
        self.assertFalse(live.state()['can_manual_move'])
        with self.assertRaises(ValueError):live.issue('manual_move',payload)

    def test_manual_still_rejects_running_or_paused_order(self):
        for status in ('running','paused','waiting'):
            live=LiveControl('secret');data=report(order=order(status))
            data['can_manual_move']=True
            live.update(data,'secret')
            with self.assertRaises(ValueError):
                live.issue('manual_move',dict(order_id='order-1',stage=1,recovery_revision=0,
                                             operator_confirmed=True,device='M1',destination='GO_TO_MAT'))

    def test_failed_reset_requires_current_order_and_manual_confirmation(self):
        live = LiveControl('secret')
        data = report(order=order('failed'))
        data['can_reset'] = True
        live.update(data, 'secret')
        self.assertTrue(live.state()['can_reset'])
        for payload in ({}, {'order_id':'old','operator_confirmed':True},
                        {'order_id':'order-1','operator_confirmed':'true'}):
            with self.assertRaises(ValueError): live.issue('reset', payload)
        live.issue('reset', {'order_id':'order-1','operator_confirmed':True})
        command = live.pending('secret')[0]
        self.assertEqual(command['action'], 'reset')
        self.assertFalse(live.state()['can_reset'])
        data = report(2, order('failed'), accepted=[command['id']])
        data['reset_pending'] = True
        live.update(data, 'secret')
        self.assertTrue(live.state()['reset_pending'])
        with self.assertRaises(ValueError): live.issue('reset', {'order_id':'order-1','operator_confirmed':True})

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
            self.assertIn(b'id="device-list"', urlopen(base+'/control.html').read())
            self.assertEqual(urlopen(base+'/assets/control/layout.css').status, 200)
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

    def test_adapter_restart_discards_previous_commands(self):
        live = LiveControl('secret')
        live.update({**report(), 'controller_id': 'first'}, 'secret')
        live.issue('start', {'product_type': 'A', 'quantity': 1})
        self.assertEqual(live.pending('secret')[0]['controller_id'], 'first')
        live.update({**report(), 'controller_id': 'second'}, 'secret')
        self.assertEqual(live.pending('secret'), [])
        self.assertFalse(live.start_in_flight)

    def test_rejected_start_ack_releases_queue_and_readiness_blocks_start(self):
        live = LiveControl('secret')
        live.update({**report(), 'can_start': False}, 'secret')
        with self.assertRaises(ValueError): live.issue('start', {'quantity': 1})
        live.update(report(2), 'secret')
        live.issue('start', {'quantity': 1})
        identity = live.pending('secret')[0]['id']
        live.update(report(3, accepted=[identity]), 'secret')
        live.issue('start', {'quantity': 1})
        self.assertEqual(len(live.pending('secret')), 1)

    def test_manual_order_and_boundary_pause(self):
        live = LiveControl('secret')
        live.update(report(), 'secret')
        with self.assertRaises(ValueError): live.issue('start', {'quantity': 1, 'auto_advance': 'false'})
        live.issue('start', {'quantity': 1, 'auto_advance': False})
        command = live.pending('secret')[0]
        self.assertFalse(command['auto_advance'])
        live.update(report(2, {**order(), 'auto_advance': False, 'pause_requested': False,
                                'stage_label': '팔3 적재'}, accepted=[command['id']]), 'secret')
        live.issue('pause', {})
        self.assertEqual(live.pending('secret')[0]['action'], 'pause')

    def test_only_explicitly_rejected_next_can_be_requested_again(self):
        live = LiveControl('secret')
        conditions = [{'label': '장치 연결', 'done': True}]
        live.update(report(1, order(), conditions, True), 'secret')
        live.issue('next', {})
        identity = live.pending('secret')[0]['id']
        incoming = report(2, order(), conditions, True, [identity])
        incoming['rejected_command_ids'] = ['unacknowledged']
        with self.assertRaises(ValueError): live.update(incoming, 'secret')
        incoming['rejected_command_ids'] = [identity]
        incoming['log'] = ['지시 거절: 장치 연결 확인 필요']
        live.update(incoming, 'secret')
        self.assertEqual(live.state()['latest_event'], incoming['log'][-1])
        live.issue('next', {})
        self.assertNotEqual(live.pending('secret')[0]['id'], identity)


if __name__ == '__main__':
    unittest.main()

class RecoveryBoundaryTest(unittest.TestCase):
    def test_recovery_requires_current_revision_and_no_pending_commands(self):
        for action in ('retry','manual_move'):
            live=LiveControl('secret')
            state=report(order={**order('failed'), 'recovery_revision':3})
            state.update(can_retry=True,can_manual_move=True)
            live.update(state,'secret')
            payload=dict(order_id='order-1',stage=1,recovery_revision=3,operator_confirmed=True,
                         device='M1',destination='GO_TO_REST')
            for bad in ({'recovery_revision':2},{'operator_confirmed':False},{'stage':2},{'order_id':'old'}):
                with self.assertRaises(ValueError):live.issue(action,{**payload,**bad})
            if action=='manual_move':
                with self.assertRaises(ValueError):live.issue(action,{**payload,'destination':'RESTART'})
            live.issue(action,payload)
            self.assertFalse(live.state()['can_retry']);self.assertFalse(live.state()['can_manual_move'])
            with self.assertRaises(ValueError):live.issue(action,payload)
            cmd=live.pending('secret')[0]
            self.assertEqual(cmd['recovery_revision'],3)
            state.update(revision=2,accepted_command_ids=[cmd['id']],can_retry=False,can_manual_move=False)
            live.update(state,'secret')
            with self.assertRaises(ValueError):live.issue(action,payload)
