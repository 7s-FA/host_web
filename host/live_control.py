"""State boundary between the operator page and a future ROS 2 Host adapter.

The adapter, not this module or the browser, decides whether device results are
valid and whether the next step is ready. No timer can complete a device task.
"""
import secrets
import time
from collections import deque

DEVICES = ('burger1', 'burger2', 'arm1', 'arm2', 'arm3')
DEVICE_STATES = {'offline', 'idle', 'running', 'done', 'failed', 'unknown'}
ORDER_STATES = {'idle', 'running', 'waiting', 'paused', 'done', 'failed'}


class LiveControl:
    def __init__(self, token='', clock=time.monotonic, timeout=3, order_policy=None):
        self.token = token
        self.order_policy = order_policy or {'quantity_min': 1, 'quantity_max': 20, 'quantity_default': 2}
        self.clock = clock
        self.timeout = timeout
        self.last_report_at = None
        self.revision = -1
        self.report = None
        self.commands = deque(maxlen=32)
        self.last_next = None
        self.start_in_flight = False
        self.log = deque(maxlen=50)

    def connected(self):
        return bool(self.token and self.report is not None and self.clock() - self.last_report_at <= self.timeout)

    def state(self):
        connected = self.connected()
        report = self.report if connected else None
        return {
            'mode': 'live', 'order_policy': self.order_policy, 'bridge_configured': bool(self.token), 'bridge_connected': connected,
            'devices': report['devices'] if report else {name: {'state': 'unknown', 'detail': 'Host 보고 대기'} for name in DEVICES},
            'order': report['order'] if report else None,
            'conditions': report['conditions'] if report else [],
            'can_advance': bool(report and report['can_advance'] and not self.commands),
            'pending_commands': len(self.commands),
            'log': report['log'] if report else list(self.log),
        }

    def check_token(self, supplied):
        if not self.token or not secrets.compare_digest(supplied or '', self.token):
            raise PermissionError('Host 어댑터 인증 실패')

    def update(self, report, supplied):
        self.check_token(supplied)
        if not isinstance(report, dict) or type(report.get('revision')) is not int or report['revision'] <= self.revision:
            raise ValueError('증가하는 revision이 필요합니다.')
        devices = report.get('devices')
        if not isinstance(devices, dict) or set(devices) != set(DEVICES):
            raise ValueError('장치 5개의 상태가 필요합니다.')
        normalized = {}
        for name in DEVICES:
            item = devices[name]
            if not isinstance(item, dict) or item.get('state') not in DEVICE_STATES or not isinstance(item.get('detail', ''), str):
                raise ValueError(f'{name} 상태 형식 오류')
            normalized[name] = {'state': item['state'], 'detail': item.get('detail', '')[:160]}
        order = report.get('order')
        if order is not None:
            if not isinstance(order, dict) or order.get('status') not in ORDER_STATES:
                raise ValueError('주문 상태 형식 오류')
            for key in ('quantity', 'transport_remaining', 'product_remaining', 'completed', 'stage', 'stage_count'):
                value = order.get(key)
                if type(value) is not int or value < 0 or value > (100 if key in ('stage', 'stage_count') else 20):
                    raise ValueError(f'주문 {key} 형식 오류')
            if not isinstance(order.get('id', ''), str):
                raise ValueError('주문 ID 형식 오류')
            order = {key: order.get(key) for key in ('id', 'status', 'quantity', 'transport_remaining', 'product_remaining', 'completed', 'stage', 'stage_count')}
        conditions = report.get('conditions', [])
        if not isinstance(conditions, list) or len(conditions) > 30:
            raise ValueError('조건 목록 형식 오류')
        clean_conditions = []
        for item in conditions:
            if not isinstance(item, dict) or not isinstance(item.get('label'), str) or type(item.get('done')) is not bool:
                raise ValueError('조건 항목 형식 오류')
            clean_conditions.append({'label': item['label'][:100], 'done': item['done']})
        if type(report.get('can_advance')) is not bool or (report['can_advance'] and (not order or order['status'] != 'waiting' or not clean_conditions or not all(c['done'] for c in clean_conditions))):
            raise ValueError('다음 단계 조건 불일치')
        entries = report.get('log', [])
        if not isinstance(entries, list) or len(entries) > 50 or any(not isinstance(x, str) for x in entries):
            raise ValueError('기록 형식 오류')
        accepted = report.get('accepted_command_ids', [])
        if not isinstance(accepted, list) or any(not isinstance(x, str) for x in accepted):
            raise ValueError('수락한 명령 ID 형식 오류')
        accepted = set(accepted)
        self.commands = deque((c for c in self.commands if c['id'] not in accepted), maxlen=32)
        if order is not None:
            self.start_in_flight = False
        self.report = {'devices': normalized, 'order': order, 'conditions': clean_conditions,
                       'can_advance': report['can_advance'], 'log': [x[:200] for x in entries]}
        self.revision = report['revision']
        self.last_report_at = self.clock()
        return self.state()

    def issue(self, action, payload):
        if not self.connected():
            raise ValueError('ROS 2 Host 어댑터가 연결되지 않았습니다.')
        if self.commands:
            raise ValueError('이전 지시의 수락을 기다리는 중입니다.')
        order = self.report['order']
        if action == 'start':
            quantity = payload.get('quantity')
            if type(quantity) is not int or not self.order_policy['quantity_min'] <= quantity <= self.order_policy['quantity_max']:
                raise ValueError('주문 수량 범위를 확인하세요.')
            if self.start_in_flight:
                raise ValueError('주문 지시의 결과를 기다리는 중입니다.')
            if order and order['status'] not in ('idle', 'done'):
                raise ValueError('진행 중인 주문이 있습니다.')
            command = {'action': action, 'quantity': quantity}
        elif action == 'next':
            if not self.report['can_advance']:
                raise ValueError('완료 조건을 모두 확인한 뒤에만 다음 단계로 이동합니다.')
            stage_key = (order['id'], order['stage'])
            if self.last_next == stage_key:
                raise ValueError('이 단계의 다음 지시는 이미 전송했습니다.')
            command = {'action': action, 'order_id': order['id'], 'stage': order['stage']}
        elif action in ('pause', 'resume'):
            expected = 'paused' if action == 'resume' else 'running'
            if not order or order['status'] != expected:
                raise ValueError('현재 주문 상태에서 사용할 수 없는 지시입니다.')
            command = {'action': action, 'order_id': order['id']}
        else:
            raise ValueError('지원하지 않는 관제 지시입니다.')
        command['id'] = secrets.token_hex(8)
        self.commands.append(command)
        if action == 'next':
            self.last_next = stage_key
        if action == 'start':
            self.start_in_flight = True
        self.log.append(f"{action} 지시 대기 · {command['id']}")
        return self.state()

    def pending(self, supplied):
        self.check_token(supplied)
        return list(self.commands)
