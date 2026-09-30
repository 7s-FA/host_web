"""Shared Host config loader. ROS addresses/rules are contracts for a future adapter."""
import copy
import json
import math
from pathlib import Path

WEB_ROOT = Path(__file__).resolve().parent.parent
TEAM_CONFIG = WEB_ROOT.parent / 'config' / 'system-config.json'
DEFAULT_PATH = TEAM_CONFIG if WEB_ROOT.name == 'web' and TEAM_CONFIG.is_file() else WEB_ROOT / 'system-config.json'

def validate(config):
    c = copy.deepcopy(config)
    def number(value, low, high, integer=False):
        if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high or (integer and type(value) is not int):
            raise ValueError(f'설정 숫자 범위 오류: {value!r} ({low}~{high})')
    if c.get('version') != 1:
        raise ValueError('system-config version은 1이어야 합니다.')
    o = c['order']
    number(o['quantity_min'], 1, 20, True)
    number(o['quantity_max'], o['quantity_min'], 20, True)
    number(o['quantity_default'], o['quantity_min'], o['quantity_max'], True)
    if o['product_type'] != 'A' or o['parts_per_product'] != 3 or type(o['auto_advance_default']) is not bool:
        raise ValueError('현재 엔진은 A제품·부품 3개만 지원하며 자동 진행은 boolean입니다.')
    number(c['web_host']['port'], 1024, 65535, True)
    number(c['web_host']['browser_timeout_seconds'], 1, 60)
    nav = c['navigation']
    if nav['travel_mode'] != 'NAV2_FORWARD_ONLY' or nav['waiting_parking'] != 'FORWARD_REAR_IR':
        raise ValueError('일반 주행은 Nav2 전진, 대기 주차는 전진·후방 IR 방식입니다.')
    if c['stations']['WAITING']['docking_mode'] != 'FORWARD_REAR_IR':
        raise ValueError('대기장소 도킹은 전진·후방 IR 방식이어야 합니다.')
    departure = nav['dock_departure']
    number(departure['backup_distance_m'], .01, .5)
    if departure['rotate_degrees'] != 180 or departure['stations'] != ['HOME', 'WAREHOUSE', 'ASSEMBLY', 'WAITING'] or departure['stop_between_phases'] is not True:
        raise ValueError('HOME/WAREHOUSE/ASSEMBLY/WAITING 출차: 후진·정지 후 180도 회전이 필요합니다.')
    ros = c['ros2']
    number(ros['domain_id'], 0, 101, True)
    for key in ['heartbeat_hz', 'heartbeat_timeout_seconds', 'goal_response_timeout_seconds']:
        number(ros[key], .1, 60)
    required = {'burger1','burger2','arm1','arm2','arm3'}
    if set(c['devices']) != required:
        raise ValueError('장치 목록은 burger1/2, arm1/2/3이어야 합니다.')
    actions = []
    for name, device in c['devices'].items():
        for key in ['namespace','action_name','state_topic','event_topic','heartbeat_topic','control_service','get_task_service']:
            value = device[key]
            if not isinstance(value, str) or not value.startswith('/') or any(x.isspace() for x in value):
                raise ValueError(f'{name}.{key}: 절대 ROS 이름이 필요합니다.')
        actions.append(device['action_name'])
        if not device['commands'] or any(x not in c['commands'] for x in device['commands']):
            raise ValueError(f'{name}: 정의되지 않은 명령')
    if len(set(actions)) != len(actions):
        raise ValueError('장치별 Action 주소는 달라야 합니다.')
    for name, command in c['commands'].items():
        number(command['execution_timeout_seconds'], 1, 3600)
        if not command['targets'] or command['result_equals'].get('success') is not True:
            raise ValueError(f'{name}: 대상과 성공 판정이 필요합니다.')
        for value in command['result_equals'].values():
            if isinstance(value, str) and value.startswith('$') and value not in ('$goal.target_station', '$order.parts_per_product'):
                raise ValueError('지원하지 않는 결과 조건 참조')
    for name, transition in c['transitions'].items():
        if not transition['requires_all'] or any(x not in c['conditions'] for x in transition['requires_all']):
            raise ValueError(f'{name}: 정의되지 않은 선행 조건')
        if 'command' in transition:
            device, command, target = transition['device'], transition['command'], transition['target']
            if device not in c['devices'] and device not in ('$current_burger','$next_burger','$other_burger'):
                raise ValueError(f'{name}: 장치 오류')
            if command not in c['commands'] or (device in c['devices'] and command not in c['devices'][device]['commands']):
                raise ValueError(f'{name}: 명령 오류')
            if target not in c['commands'][command]['targets'] and target != '$current_burger':
                raise ValueError(f'{name}: 목표 오류')
    return c

def load(path=DEFAULT_PATH):
    try:
        return validate(json.loads(Path(path).read_text()))
    except (KeyError, TypeError, json.JSONDecodeError) as e:
        raise ValueError(f'system-config 형식 오류: {e}') from e

if __name__ == '__main__':
    import sys
    c = load()
    if '--write-web-policy' in sys.argv:
        (WEB_ROOT / 'system-policy.js').write_text('/* Generated from system-config.json; do not edit. */\nwindow.SYSTEM_ORDER_POLICY = '+json.dumps(c['order'], ensure_ascii=False)+';\n')
    print(f"설정 검증 완료: 수량 {c['order']['quantity_min']}~{c['order']['quantity_max']}, 장치 {len(c['devices'])}개")
