"""State boundary between the operator page and the ROS 2 Host adapter.

The adapter, not this module or the browser, decides whether device results are
valid and whether the next step is ready. No timer can complete a device task.
"""
import secrets
import time
from collections import deque

DEVICES = ('M1', 'M2', 'warehouse', 'production')
DEVICE_STATES = {'offline', 'idle', 'running', 'done', 'failed', 'unknown'}
ORDER_STATES = {'idle', 'running', 'waiting', 'paused', 'done', 'failed'}


class LiveControl:
    def __init__(self, token='', clock=time.monotonic, timeout=3, order_policy=None):
        self.token = token
        self.order_policy = order_policy or {'quantity_min': 1, 'quantity_max': 2, 'quantity_default': 2}
        self.clock = clock
        self.timeout = timeout
        self.last_report_at = None
        self.revision = -1
        self.report = None
        self.commands = deque(maxlen=32)
        self.last_next = None
        self.start_in_flight = False
        self.log = deque(maxlen=50)
        self.session = secrets.token_hex(16)
        self.controller_id = None

    def connected(self):
        return bool(self.token and self.report is not None and self.clock() - self.last_report_at <= self.timeout)

    def state(self):
        connected = self.connected()
        report = self.report if connected else None
        return {
            'mode': 'live', 'order_policy': self.order_policy, 'bridge_configured': bool(self.token), 'bridge_connected': connected,
            'devices': report['devices'] if report else {
                name: {'state': 'unknown', 'detail': 'Host 보고 대기',
                       'log': self.report['devices'][name]['log'] if self.report else []}
                for name in DEVICES},
            'order': report['order'] if report else None,
            'conditions': report['conditions'] if report else [],
            'can_advance': bool(report and report['can_advance'] and not self.commands),
            'pending_commands': len(self.commands),
            'bridge_session': self.session,
            'runtime_mode': report.get('runtime_mode', 'hardware') if report else 'unknown',
            'manual_inspection': bool(report and report.get('manual_inspection')),
            'can_start': bool(report and report.get('can_start', True) and not self.commands),
            'can_reset': bool(report and report.get('can_reset', False) and not self.commands),
            'reset_pending': bool(report and report.get('reset_pending', False)),
            'can_retry': bool(report and report.get('can_retry') and not self.commands),
            'can_manual_move': bool(report and report.get('can_manual_move') and not self.commands),
            'manual_move_available': {robot: bool(report and not self.commands and
                report.get('manual_move_available', {}).get(robot, report.get('can_manual_move', False)))
                for robot in ('M1','M2')},
            'can_prepare_parked': bool(report and report.get('can_prepare_parked') and not self.commands),
            'manual_move': report.get('manual_move') if report else None,
            'manual_revision': report.get('manual_revision', 0) if report else 0,
            'can_full_reset': bool(report and report.get('can_full_reset') and not self.commands),
            'full_reset': report.get('full_reset') if report else None,
            'movement_reset_available': {d: bool(report and not self.commands and report.get('movement_reset_available', {}).get(d)) for d in ('M1', 'M2')},
            'supports_order_queue': bool(report and report.get('supports_order_queue')),
            'supports_continuous_orders': bool(report and report.get('supports_continuous_orders')),
            'remaining_capacity': report.get('remaining_capacity', {'A':2,'B':2}) if report else {'A':2,'B':2},
            'pending_batches': report.get('pending_batches', []) if report else [],
            'queue_revision': report.get('queue_revision', 0) if report else 0,
            'can_enqueue': bool(report and not self.commands and report.get('can_enqueue')),
            'can_next_batch': bool(report and not self.commands and report.get('can_next_batch')),
            'supports_parked_full_reset': bool(report and report.get('supports_parked_full_reset')),
            'log': (self.report['log'] if self.report else []) + list(self.log),
            'latest_event': self.report['log'][-1] if self.report and self.report['log'] else (self.log[-1] if self.log else ''),
        }

    def check_token(self, supplied):
        if not self.token or not secrets.compare_digest(supplied or '', self.token):
            raise PermissionError('Host 어댑터 인증 실패')

    def update(self, report, supplied):
        self.check_token(supplied)
        controller_id = report.get('controller_id') if isinstance(report, dict) else None
        if controller_id is not None and (not isinstance(controller_id, str) or not controller_id):
            raise ValueError('controller_id 형식 오류')
        changed_controller = controller_id is not None and controller_id != self.controller_id
        if not isinstance(report, dict) or type(report.get('revision')) is not int or (not changed_controller and report['revision'] <= self.revision):
            raise ValueError('증가하는 revision이 필요합니다.')
        devices = report.get('devices')
        if not isinstance(devices, dict) or set(devices) != set(DEVICES):
            raise ValueError('M1, M2, warehouse, production 통신 단위 4개의 상태가 필요합니다.')
        normalized = {}
        for name in DEVICES:
            item = devices[name]
            if not isinstance(item, dict) or item.get('state') not in DEVICE_STATES or not isinstance(item.get('detail', ''), str):
                raise ValueError(f'{name} 상태 형식 오류')
            entries = item.get('log', [])
            if not isinstance(entries, list) or len(entries) > 50 or any(not isinstance(x, str) for x in entries):
                raise ValueError(f'{name} 기록 형식 오류')
            normalized[name] = {'state': item['state'], 'detail': item.get('detail', '')[:160],
                                'log': [x[:200] for x in entries]}
        order = report.get('order')
        if order is not None:
            if not isinstance(order, dict) or order.get('status') not in ORDER_STATES:
                raise ValueError('주문 상태 형식 오류')
            product_type = order.get('product_type', 'A')
            if product_type not in ('A', 'B'):
                raise ValueError('제품은 A 또는 B여야 합니다.')
            for key in ('quantity', 'transport_remaining', 'product_remaining', 'completed', 'stage', 'stage_count'):
                value = order.get(key)
                maximum = 4 if order.get('plan_mode') == 'continuous-v1' else self.order_policy['quantity_max']
                if type(value) is not int or value < 0 or value > (100 if key in ('stage', 'stage_count') else maximum):
                    raise ValueError(f'주문 {key} 형식 오류')
            if not isinstance(order.get('id', ''), str):
                raise ValueError('주문 ID 형식 오류')
            revision = order.get('recovery_revision', 0)
            if type(revision) is not int or revision < 0:
                raise ValueError('복구 revision 형식 오류')
            extra = {'recovery_revision': revision}
            if 'products' in order:
                products = order['products']
                if not isinstance(products, list) or len(products) != order['quantity'] or any(p not in ('A', 'B') for p in products):
                    raise ValueError('묶음 제품 형식 오류')
                extra['products'] = list(products)
                if order.get('plan_mode') == 'continuous-v1' and any(products.count(p)>2 for p in ('A','B')):
                    raise ValueError('A 최대 2개·B 최대 2개입니다.')
            if 'plan_mode' in order:
                if order['plan_mode'] not in ('parallel-v1','continuous-v1'):
                    raise ValueError('지원하지 않는 공정 계획 버전')
                extra['plan_mode'] = order['plan_mode']
            for key in ('auto_advance', 'pause_requested'):
                if key in order:
                    if type(order[key]) is not bool:
                        raise ValueError(f'{key} 형식 오류')
                    extra[key] = order[key]
            for key in ('stage_label', 'fault'):
                if key in order:
                    if not isinstance(order[key], str):
                        raise ValueError(f'{key} 형식 오류')
                    extra[key] = order[key][:200]
            order = {key: order.get(key) for key in ('id', 'status', 'quantity', 'transport_remaining', 'product_remaining', 'completed', 'stage', 'stage_count')}
            order['product_type'] = product_type
            order.update(extra)
        conditions = report.get('conditions', [])
        manual_revision = report.get('manual_revision', 0)
        if type(manual_revision) is not int or manual_revision < 0:
            raise ValueError('수동 이동 revision 형식 오류')
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
        rejected = report.get('rejected_command_ids', [])
        if not isinstance(rejected, list) or any(not isinstance(x, str) for x in rejected) or not set(rejected) <= accepted:
            raise ValueError('거절한 명령 ID 형식 오류')
        rejected = set(rejected)
        if changed_controller:
            self.commands.clear()
            self.start_in_flight = False
            self.last_next = None
            self.controller_id = controller_id
        if any(c['id'] in accepted and c['action'] == 'start' for c in self.commands):
            self.start_in_flight = False
        if any(c['id'] in rejected and c['action'] == 'next' for c in self.commands):
            self.last_next = None  # only explicit rejection permits another request for this stage
        self.commands = deque((c for c in self.commands if c['id'] not in accepted), maxlen=32)
        if order is not None:
            self.start_in_flight = False
        batches = report.get('pending_batches', [])
        queue_revision = report.get('queue_revision', 0)
        if not isinstance(batches, list) or len(batches) > 32 or type(queue_revision) is not int or queue_revision < 0:
            raise ValueError('대기 주문 형식 오류')
        for batch in batches:
            if (not isinstance(batch, dict) or not isinstance(batch.get('products'), list)
                    or not 1 <= len(batch['products']) <= 2 or any(p not in ('A', 'B') for p in batch['products'])):
                raise ValueError('대기 묶음 형식 오류')
        capacity = report.get('remaining_capacity', {'A':2,'B':2})
        if (not isinstance(capacity,dict) or set(capacity) != {'A','B'}
                or any(type(v) is not int or not 0<=v<=2 for v in capacity.values())):
            raise ValueError('추가 가능한 수량 형식 오류')
        self.report = {'supports_order_queue': report.get('supports_order_queue') is True,
                       'supports_continuous_orders': report.get('supports_continuous_orders') is True,
                       'remaining_capacity': dict(capacity),
                       'pending_batches': [{'products': list(b['products'])} for b in batches],
                       'queue_revision': queue_revision, 'can_enqueue': report.get('can_enqueue') is True,
                       'can_next_batch': report.get('can_next_batch') is True,
                       'movement_reset_available': {d: (report.get('movement_reset_available') or {}).get(d) is True for d in ('M1', 'M2')},
                       'devices': normalized, 'order': order, 'conditions': clean_conditions,
                       'can_advance': report['can_advance'], 'log': [x[:200] for x in entries],
                       'can_start': report.get('can_start', True) is True,
                       'can_reset': report.get('can_reset', False) is True,
                       'reset_pending': report.get('reset_pending', False) is True,
                       'can_retry': report.get('can_retry') is True,
                       'can_manual_move': report.get('can_manual_move') is True,
                       'manual_inspection': report.get('manual_inspection') is True,
                       'manual_move_available': {robot: (report.get('manual_move_available') or {}).get(robot,
                            report.get('can_manual_move')) is True for robot in ('M1','M2')},
                       'can_prepare_parked': report.get('can_prepare_parked') is True,
                       'manual_move': report.get('manual_move'),
                       'manual_revision': report.get('manual_revision', 0),
                       'can_full_reset': report.get('can_full_reset') is True,
                       'full_reset': report.get('full_reset'),
                       'supports_parked_full_reset': report.get('supports_parked_full_reset') is True,
                       'runtime_mode': 'mock' if report.get('runtime_mode') == 'mock' else 'hardware'}
        self.revision = report['revision']
        self.last_report_at = self.clock()
        return self.state()

    def issue(self, action, payload):
        if not self.connected():
            raise ValueError('ROS 2 Host 어댑터가 연결되지 않았습니다.')
        if self.commands:
            raise ValueError('이전 지시의 수락을 기다리는 중입니다.')
        order = self.report['order']
        if action == 'reset_movement':
            device = payload.get('device')
            if (not self.report['movement_reset_available'].get(device) or payload.get('operator_confirmed') is not True
                    or payload.get('order_id') != (order or {}).get('id')
                    or type(payload.get('recovery_revision')) is not int
                    or payload['recovery_revision'] != self.report['manual_revision']):
                raise ValueError('로봇 정지·현재 작업·연결 상태를 다시 확인하세요.')
            command = dict(action=action, device=device, order_id=(order or {}).get('id'),
                           recovery_revision=payload['recovery_revision'], operator_confirmed=True)
        elif action in ('enqueue', 'next_batch', 'clear_queue') or (action == 'start' and 'quantities' in payload):
            if not self.report.get('supports_order_queue'):
                raise ValueError('주문 대기열을 지원하는 Host로 갱신해야 합니다.')
            if action in ('start', 'enqueue'):
                quantities = payload.get('quantities')
                if (not isinstance(quantities, dict) or set(quantities) != {'A', 'B'}
                        or any(type(v) is not int or not 0 <= v <= 2 for v in quantities.values())
                        or sum(quantities.values()) == 0):
                    raise ValueError('A·B 각각 0~2개, 합계 1개 이상 선택하세요.')
                flag = 'can_start' if action == 'start' else 'can_enqueue'
                if not self.report.get(flag) or self.start_in_flight:
                    raise ValueError('주문 접수 상태를 확인하세요.')
                if action == 'enqueue' and self.report.get('supports_continuous_orders'):
                    if any(quantities[p]>self.report['remaining_capacity'][p] for p in ('A','B')):
                        raise ValueError('추가 주문을 포함해 A 최대 2개·B 최대 2개입니다.')
                automatic = payload.get('auto_advance', True)
                if type(automatic) is not bool:
                    raise ValueError('auto_advance 형식 오류')
                command = dict(action=action, quantities=quantities, auto_advance=automatic)
            else:
                if (payload.get('operator_confirmed') is not True
                        or payload.get('order_id') != (order or {}).get('id')
                        or type(payload.get('queue_revision')) is not int
                        or payload['queue_revision'] != self.report['queue_revision']
                        or (action == 'next_batch' and not self.report.get('can_next_batch'))):
                    raise ValueError('현재 묶음 완료·대기 주문·팔레트 비움 확인이 필요합니다.')
                command = dict(action=action, order_id=(order or {}).get('id'), operator_confirmed=True,
                               queue_revision=payload['queue_revision'])
        elif action == 'start':
            if not self.report.get('can_start', True):
                raise ValueError('장치 준비 또는 기존 주문의 복구가 필요합니다.')
            product_type = payload.get('product_type', 'A')
            if product_type not in ('A', 'B'):
                raise ValueError('제품은 A 또는 B여야 합니다.')
            quantity = payload.get('quantity')
            if type(quantity) is not int or not self.order_policy['quantity_min'] <= quantity <= self.order_policy['quantity_max']:
                raise ValueError('주문 수량 범위를 확인하세요.')
            if self.start_in_flight:
                raise ValueError('주문 지시의 결과를 기다리는 중입니다.')
            if order and order['status'] not in ('idle', 'done'):
                raise ValueError('진행 중인 주문이 있습니다.')
            command = {'action': action, 'product_type': product_type, 'quantity': quantity}
            if 'auto_advance' in payload:
                if type(payload['auto_advance']) is not bool:
                    raise ValueError('auto_advance는 boolean이어야 합니다.')
                command['auto_advance'] = payload['auto_advance']
        elif action == 'full_reset':
            parked = payload.get('amrs_parked', False)
            if type(parked) is not bool or (parked and (self.report['runtime_mode'] != 'hardware'
                                                       or not self.report.get('supports_parked_full_reset'))):
                raise ValueError('지정 주차 위치 확인은 실물 모드에서만 가능합니다.')
            if (not self.report.get('can_full_reset') or payload.get('operator_confirmed') is not True
                    or payload.get('order_id') != (order or {}).get('id')
                    or type(payload.get('recovery_revision')) is not int
                    or payload['recovery_revision'] != self.report.get('manual_revision', 0)):
                raise ValueError('장치 정지·작업 종료·팔 복귀와 주차 경로 확인 후 다시 실행하세요.')
            command = dict(action=action, order_id=(order or {}).get('id'), operator_confirmed=True,
                           recovery_revision=payload['recovery_revision'])
            if parked: command['amrs_parked'] = True
        elif action == 'cancel_full_reset':
            reset = self.report.get('full_reset') or {}
            if reset.get('status') != 'running' or payload.get('reset_id') != reset.get('id'):
                raise ValueError('진행 중인 전체 초기화가 아닙니다.')
            command = dict(action=action, reset_id=reset['id'])
        elif action == 'prepare_parked':
            if (not self.report.get('can_prepare_parked') or self.report['runtime_mode'] != 'hardware'
                    or order and order['status'] != 'done'
                    or payload.get('device') not in ('M1', 'M2')
                    or payload.get('operator_confirmed') is not True
                    or 'order_id' not in payload
                    or payload['order_id'] != (order['id'] if order else None)
                    or type(payload.get('recovery_revision')) is not int
                    or payload['recovery_revision'] != self.report['manual_revision']):
                raise ValueError('주문 초기화·작업 종료·지정 주차 위치와 방향을 확인하세요.')
            command = dict(action=action, device=payload['device'], operator_confirmed=True,
                           order_id=payload['order_id'], recovery_revision=payload['recovery_revision'])
        elif action in ('retry', 'manual_move'):
            flag = 'can_retry' if action == 'retry' else 'can_manual_move'
            if action == 'manual_move' and not self.report['manual_move_available'].get(payload.get('device')):
                raise ValueError('선택한 로봇 연결·작업 종료 상태를 확인하세요.')
            standalone = action == 'manual_move' and (not order or order['status'] == 'done')
            expected_id = order['id'] if order else None
            expected_stage = order['stage'] if order else 0
            revision = order.get('recovery_revision', 0) if order else self.report.get('manual_revision', 0)
            if ((not standalone and (not order or order['status'] != 'failed')) or not self.report.get(flag)
                    or payload.get('operator_confirmed') is not True
                    or 'order_id' not in payload or payload['order_id'] != expected_id
                    or type(payload.get('stage')) is not int or payload['stage'] != expected_stage
                    or type(payload.get('recovery_revision')) is not int
                    or payload['recovery_revision'] != revision):
                raise ValueError('주문·작업 종료·현장 상태를 다시 확인하세요.')
            command = {key: payload[key] for key in ('order_id', 'stage', 'recovery_revision', 'operator_confirmed')}
            command['action'] = action
            if action == 'manual_move':
                if payload.get('device') not in ('M1', 'M2') or payload.get('destination') not in ('GO_TO_MAT', 'GO_TO_ASM', 'GO_TO_REST', 'GO_TO_PARK'):
                    raise ValueError('M1/M2와 지정된 네 목적지만 지원합니다.')
                command.update(device=payload['device'], destination=payload['destination'])
        elif action == 'reset':
            if not order or order['status'] != 'failed' or not self.report.get('can_reset', False):
                raise ValueError('실패 주문과 장치 연결·정지 응답을 먼저 확인하세요.')
            if payload.get('order_id') != order['id'] or payload.get('operator_confirmed') is not True:
                raise ValueError('현재 주문의 로봇 정지·작업 종료·초기 배치 확인이 필요합니다.')
            command = {'action': action, 'order_id': order['id'], 'operator_confirmed': True}
        elif action == 'next':
            if not self.report['can_advance']:
                raise ValueError('완료 조건을 모두 확인한 뒤에만 다음 단계로 이동합니다.')
            stage_key = (order['id'], order['stage'])
            if self.last_next == stage_key:
                raise ValueError('이 단계의 다음 지시는 이미 전송했습니다.')
            command = {'action': action, 'order_id': order['id'], 'stage': order['stage']}
        elif action in ('pause', 'resume'):
            expected = ('paused',) if action == 'resume' else ('running', 'waiting')
            if not order or order['status'] not in expected:
                raise ValueError('현재 주문 상태에서 사용할 수 없는 지시입니다.')
            command = {'action': action, 'order_id': order['id']}
        else:
            raise ValueError('지원하지 않는 관제 지시입니다.')
        command['id'] = secrets.token_hex(8)
        if self.controller_id:
            command['controller_id'] = self.controller_id
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
