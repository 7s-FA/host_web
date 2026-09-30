"""Loopback-only Host PC / browser handshake test. No robot connections."""
import argparse
import sys
import json
import mimetypes
import os
import secrets
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'host'))
from system_config import load as load_system_config
from live_control import LiveControl
SYSTEM_CONFIG = load_system_config()
SCENARIOS = json.loads((ROOT / 'host/scenarios.json').read_text())

SCENARIO_CONFIG = json.loads((ROOT / 'host/scenario-config.json').read_text())

class Host:
    def __init__(self, clock=time.monotonic, system_config=None):
        self.config = system_config or SYSTEM_CONFIG
        self.clock = clock
        self.owner = None
        self.seen = 0
        self.status = 'idle'
        self.order_id = None
        self.quantity = 0
        self.index = -1
        self.pending = None
        self.auto = self.config['order']['auto_advance_default']
        self.log = deque(maxlen=80)
        self.requests = deque(maxlen=256)

    def note(self, kind, detail):
        self.log.append({'at': time.strftime('%H:%M:%S'), 'kind': kind, 'detail': detail})

    def check_timeout(self):
        if self.owner and self.clock() - self.seen > self.config['web_host']['browser_timeout_seconds'] and self.status == 'running':
            self.status = 'paused'
            self.note('HOLD', f"{self.config['web_host']['browser_timeout_seconds']}초 동안 브라우저 응답 없음 · 재개 지시 필요")

    def state(self):
        self.check_timeout()
        stage = SCENARIOS[str(self.quantity)][self.index] if self.index >= 0 else None
        return {'order_policy': self.config['order'], 'simulation_config': SCENARIO_CONFIG, 'protocol': 1, 'scenario_mode': 'destination-v2',
                'sample_stage_count': len(SCENARIOS['2']),
                'stage_count': len(SCENARIOS[str(self.quantity)]) if self.quantity else 0, 'status': self.status, 'order_id': self.order_id,
                'quantity': self.quantity, 'acked_seq': self.index + 1,
                'time': stage['time'] if stage else 0, 'counters': stage,
                'command': self.pending, 'auto': self.auto, 'log': list(self.log)}

    def issue(self):
        stages = SCENARIOS[str(self.quantity)]
        if self.index + 1 >= len(stages):
            self.status = 'done'
            return
        s = stages[self.index + 1]
        self.pending = {'order_id': self.order_id, 'seq': s['seq'], 'target_time': s['time'],
                        'events': s['events']}
        self.status = 'running'
        self.note('COMMAND', f"단계 {s['seq']} 실행 → {s['time']:.2f}초")

    def handle(self, action, data):
        self.check_timeout()
        client = data.get('client_id')
        if not isinstance(client, str) or not 8 <= len(client) <= 100:
            raise ValueError('client_id가 필요합니다.')
        if action == 'connect':
            if self.owner not in (None, client):
                raise ValueError('다른 화면이 연결되어 있습니다. 기존 화면에서 연결 해제하거나 서버를 다시 시작하세요.')
            self.owner = client
            self.seen = self.clock()
            return self.state()
        if client != self.owner:
            raise ValueError('먼저 호스트에 연결하세요.')
        self.seen = self.clock()
        if action == 'heartbeat':
            return self.state()
        request_id = data.get('message_id')
        if not isinstance(request_id, str) or not request_id:
            raise ValueError('message_id가 필요합니다.')
        if request_id in self.requests:
            return self.state()
        if action == 'start':
            q = data.get('quantity')
            policy = self.config['order']
            if type(q) is not int or not policy['quantity_min'] <= q <= policy['quantity_max']:
                raise ValueError(f"수량은 {policy['quantity_min']}~{policy['quantity_max']} 정수여야 합니다.")
            if self.status not in ('idle', 'done'):
                raise ValueError('현재 주문을 초기화한 뒤 새 주문을 시작하세요.')
            self.quantity, self.index = q, -1
            self.order_id = secrets.token_hex(8)
            self.pending = None
            self.status = 'waiting'
            self.note('ORDER', f'A제품 {q}개 · {self.order_id}')
            self.issue()
        elif action == 'next':
            if self.status != 'waiting':
                raise ValueError('완료 회신을 받은 대기 상태에서만 다음 단계로 이동합니다.')
            self.issue()
        elif action == 'ack':
            if data.get('order_id') != self.order_id:
                raise ValueError('이전 주문의 완료 신호입니다.')
            seq = data.get('seq')
            if type(seq) is not int:
                raise ValueError('잘못된 단계 번호입니다.')
            if seq == self.index + 1 and seq > 0:
                return self.state()  # duplicate completion never decrements twice
            if self.status != 'running' or not self.pending or seq != self.pending['seq']:
                raise ValueError('현재 실행 중인 단계의 완료 신호만 허용합니다.')
            if data.get('time') != self.pending['target_time']:
                raise ValueError('완료 위치가 지시한 단계와 다릅니다.')
            self.index += 1
            self.pending = None
            self.note('ACK', f'단계 {seq} 완료 수신')
            final = self.index == len(SCENARIOS[str(self.quantity)]) - 1
            self.status = 'done' if final else 'waiting'
            if final:
                self.note('DONE', '파렛트 적재 및 버거 복귀 완료')
            elif self.auto:
                self.issue()
        elif action == 'pause':
            if self.status not in ('running', 'waiting'):
                raise ValueError('진행 중인 주문이 없습니다.')
            self.status = 'paused'
            self.note('PAUSE', '운영자 일시정지')
        elif action == 'resume':
            if self.status != 'paused':
                raise ValueError('일시정지 상태가 아닙니다.')
            self.status = 'running' if self.pending else 'waiting'
            self.note('RESUME', '운영자 재개')
            if not self.pending and self.auto:
                self.issue()
        elif action == 'auto':
            if type(data.get('enabled')) is not bool:
                raise ValueError('자동 진행 값은 boolean이어야 합니다.')
            self.auto = data['enabled']
            if self.auto and self.status == 'waiting':
                self.issue()
        elif action in ('reset', 'disconnect'):
            self.status, self.quantity, self.index = 'idle', 0, -1
            self.order_id = self.pending = None
            self.note('RESET', '시험 주문 초기화')
            if action == 'disconnect':
                self.owner = None
                self.auto = False
        else:
            raise ValueError('지원하지 않는 명령입니다.')
        self.requests.append(request_id)
        return self.state()

class Handler(BaseHTTPRequestHandler):
    def reply(self, code, data, mime='application/json'):
        if not isinstance(data, bytes):
            data = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

    def valid_host(self):
        return self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}')

    def do_GET(self):
        if not self.valid_host():
            return self.reply(403, {'error': '로컬 호스트 주소만 허용합니다.'})
        path = urlsplit(self.path).path
        if path == '/api/live/state':
            with self.server.lock:
                return self.reply(200, self.server.live.state())
        if path == '/api/live/commands':
            try:
                with self.server.lock:
                    return self.reply(200, self.server.live.pending(self.headers.get('X-Bridge-Token')))
            except PermissionError as e:
                return self.reply(403, {'error': str(e)})
        if path == '/api/state':
            with self.server.lock:
                return self.reply(200, self.server.host.state())
        if path == '/system-config.json':
            return self.reply(200, self.server.host.config)
        if path == '/system-policy.js':
            script = 'window.SYSTEM_ORDER_POLICY = ' + json.dumps(self.server.host.config['order']) + ';'
            return self.reply(200, script.encode(), 'text/javascript')
        name = path.lstrip('/') or 'index.html'
        allowed = name in {'index.html', 'styles.css', 'dashboard.css', 'app.js', 'engine.js', 'host-client.js', 'ros-config.js', 'ros-client.js', 'ROS_BRIDGE_GUIDE.md', 'config.js', 'settings.js', 'admin.html', 'admin.js', 'admin.css', 'downloads.html', 'downloads.css', 'waypoints.html', 'waypoints.css', 'waypoints.js', 'waypoints-burger1.json', 'control.html', 'control.css', 'control.js', 'HOST_CONTROL_GUIDE.md', 'system-config.json'} or (name.startswith('assets/') and '..' not in name)
        target = (ROOT / name).resolve()
        if not allowed or not target.is_relative_to(ROOT) or not target.is_file():
            return self.reply(404, {'error': '파일 없음'})
        return self.reply(200, target.read_bytes(), mimetypes.guess_type(name)[0] or 'application/octet-stream')

    def do_POST(self):
        expected = 'http://' + self.headers.get('Host', '')
        if not self.valid_host() or self.headers.get('Origin') not in (None, expected) or self.headers.get('Content-Type') != 'application/json':
            return self.reply(403, {'error': '동일 호스트의 JSON 요청만 허용합니다.'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            limit = 32768 if urlsplit(self.path).path == '/api/live/report' else 8192
            if not 0 < length <= limit:
                raise ValueError('잘못된 요청 크기')
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError('JSON 객체가 필요합니다.')
            path = urlsplit(self.path).path
            if not path.startswith('/api/'):
                return self.reply(404, {'error': 'API 없음'})
            with self.server.lock:
                if path == '/api/live/report':
                    state = self.server.live.update(data, self.headers.get('X-Bridge-Token'))
                elif path.startswith('/api/live/'):
                    state = self.server.live.issue(path.removeprefix('/api/live/'), data)
                else:
                    state = self.server.host.handle(path[5:], data)
            return self.reply(200, state)
        except PermissionError as e:
            return self.reply(403, {'error': str(e)})
        except (ValueError, TypeError) as e:
            return self.reply(400, {'error': str(e)})

    def log_message(self, fmt, *args):
        pass

def make_server(port=8082):
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.host, server.live, server.lock = Host(), LiveControl(os.environ.get('ROBOT3_BRIDGE_TOKEN', ''), timeout=SYSTEM_CONFIG['ros2']['heartbeat_timeout_seconds'], order_policy=SYSTEM_CONFIG['order']), threading.Lock()
    return server

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=SYSTEM_CONFIG['web_host']['port'])
    args = parser.parse_args()
    with make_server(args.port) as server:
        print(f'Host PC 시험 화면: http://127.0.0.1:{server.server_port}/?host=1', flush=True)
        print(f'실장치 관제 화면: http://127.0.0.1:{server.server_port}/control.html', flush=True)
        print(f'목적지 단위 v2 · A제품 2개: {len(SCENARIOS["2"])}단계 · {ROOT}', flush=True)
        print('Ctrl+C로 종료 · git pull 후에는 서버를 종료하고 다시 실행하세요.', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
