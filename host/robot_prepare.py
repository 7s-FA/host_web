"""Host 시작 때 M1·M2 이동 로봇을 '관제 준비' 상태로 만든다 (이동 명령은 보내지 않음).

각 로봇에 SSH로 접속해 로봇 안의 host_prepare.py 를 실행한다. 로봇 쪽에서
본체(모터·라이다) 시작 → 위치추정·Nav2 확인 → 모터 토크 → Action 서버 확인 → process 모드로 바꾼다.
재부팅 뒤 이 단계를 거치지 않으면 본체가 꺼져 있거나 individual 모드라 Action 명령이 거절·실패한다.

host_control.launch.py 가 웹 서버·rosbridge 와 함께 실행하므로, 로그는 같은 터미널에
[robot_prepare-N] [버거1] ... 형태로 표시된다. 단독 실행도 된다:
    python3 host/robot_prepare.py [--parked] [--robots burger1,burger2]

--parked: 로봇이 자기 주차 자리에 원래 방향으로 놓여 있을 때만 사용한다.
          주차 좌표를 초기 위치로 넣고, 중단된 도킹 표시를 '주차 확인'으로 정리한다.
SSH 는 키 인증(BatchMode)만 쓴다. 비밀번호를 물으면 준비가 멈추므로, 처음 한 번
`ssh-copy-id ubuntu@10.10.142.101`, `ssh-copy-id ubuntu@10.10.142.102` 로 키를 등록한다.
"""
import argparse
import os
import shlex
import subprocess
import sys
import threading
import time

# 로봇 주소. 다른 주소를 쓰면 환경변수 BURGER1_SSH / BURGER2_SSH 로 바꾼다 (예: ubuntu@burger1.local).
ROBOTS = {
    'burger1': {'index': 1, 'ssh': os.environ.get('BURGER1_SSH', 'ubuntu@10.10.142.101')},
    'burger2': {'index': 2, 'ssh': os.environ.get('BURGER2_SSH', 'ubuntu@10.10.142.102')},
}
LABEL = {'burger1': '버거1', 'burger2': '버거2'}
SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
               '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=6']
PREPARE_TIMEOUT_S = 330  # 로봇 쪽 준비 제한 300초 + 여유
print_lock = threading.Lock()
children = []  # 실행 중인 ssh. Ctrl+C 때 함께 정리한다.


def log(robot, text):
    with print_lock:
        print(f'[{LABEL.get(robot, robot)}] {text}', flush=True)


def remote_command(robot, request_id, parked):
    """로봇 안에서 실행할 명령. AMR 의 launcher/robot_prepare.sh 와 같은 절차."""
    index = ROBOTS[robot]['index']
    nav = f'/home/ubuntu/AMR/.runtime/M{index}/final_robot_ws/robot/burger{index}/navigation'
    parts = ['cd', shlex.quote(nav), '&&', 'source', './nav_env.bash', '&&',
             'exec', '/usr/bin/python3', './host_prepare.py', f'burger{index}',
             '--request-id', shlex.quote(request_id)]
    if parked:
        parts.append('--parked')
    return 'bash -c ' + shlex.quote(' '.join(parts))


def ssh_command(robot, request_id, parked):
    return ['ssh', *SSH_OPTIONS, ROBOTS[robot]['ssh'], remote_command(robot, request_id, parked)]


def prepare_once(robot, request_id, parked, run=subprocess.Popen):
    """한 번 준비한다. 로봇이 보내는 진행 로그를 그대로 터미널에 흘린다. 성공이면 True."""
    log(robot, f'관제 준비 시작 (요청 ID {request_id}{", 주차 위치" if parked else ""})')
    try:
        child = run(ssh_command(robot, request_id, parked), stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, text=True, bufsize=1)
        children.append(child)
    except OSError as exc:
        log(robot, f'SSH 실행 실패: {exc}')
        return False
    deadline = time.monotonic() + PREPARE_TIMEOUT_S
    lines = []
    for line in child.stdout:
        line = line.rstrip()
        if line:
            lines.append(line)
            log(robot, line)
        if time.monotonic() > deadline:
            child.kill()
            log(robot, '준비 시간 초과 (5분 30초)')
            break
    code = child.wait()
    if code == 0:
        log(robot, '관제 준비 완료')
        return True
    if code == 255 and any('Permission denied' in line or 'Host key verification' in line for line in lines):
        log(robot, f'SSH 키 인증 실패: 이 PC에서 한 번 `ssh-copy-id {ROBOTS[robot]["ssh"]}` 를 실행하세요.')
    elif code == 255:
        log(robot, '로봇에 접속하지 못했습니다 (전원·Wi-Fi 확인).')
    else:
        log(robot, f'관제 준비 실패 (종료 코드 {code})')
    return False


def prepare_robot(robot, parked, retries, retry_wait, results, session):
    """실패하면 retry_wait 초 뒤 새 요청 ID로 다시 준비한다 (최대 retries 번). 이동 명령은 없다."""
    for attempt in range(retries + 1):
        if attempt:
            log(robot, f'{retry_wait:.0f}초 뒤 다시 준비합니다 ({attempt}/{retries}). 로봇 센서가 안정되길 기다립니다.')
            time.sleep(retry_wait)
        request_id = f'{session}-b{ROBOTS[robot]["index"]}-{attempt + 1}'
        if prepare_once(robot, request_id, parked):
            results[robot] = True
            return
    results[robot] = False


def main(argv=None):
    p = argparse.ArgumentParser(description='M1·M2 관제 준비 (이동 명령 없음)')
    p.add_argument('--parked', action='store_true', help='로봇이 자기 주차 자리에 놓여 있을 때만')
    p.add_argument('--robots', default='burger1,burger2', help='쉼표로 구분 (기본: burger1,burger2)')
    p.add_argument('--retries', type=int, default=2, help='실패 시 다시 시도할 횟수 (기본 2)')
    p.add_argument('--retry-wait', type=float, default=30., help='다시 시도하기 전 대기(초, 기본 30)')
    a = p.parse_args(argv)
    robots = [r.strip() for r in a.robots.split(',') if r.strip()]
    unknown = [r for r in robots if r not in ROBOTS]
    if unknown or not robots:
        p.error('로봇은 burger1, burger2 중에서 고르세요.')
    if a.retries < 0 or a.retry_wait < 0:
        p.error('--retries, --retry-wait 는 0 이상이어야 합니다.')
    session = 'host-' + time.strftime('%m%d%H%M%S')
    results = {}
    # 두 로봇을 동시에 준비한다 (서로 기다리지 않음).
    threads = [threading.Thread(target=prepare_robot, args=(r, a.parked, a.retries, a.retry_wait, results, session),
                                daemon=True) for r in robots]
    for t in threads:
        t.start()
    try:
        for t in threads:
            while t.is_alive():
                t.join(.5)
    except KeyboardInterrupt:
        # Host 를 Ctrl+C 로 끌 때. 로봇 쪽 준비는 이동 명령이 없으므로 중간에 끊어도 안전하다.
        for child in children:
            if child.poll() is None:
                child.terminate()
        with print_lock:
            print('[관제 준비] Ctrl+C 로 중단했습니다.', flush=True)
        return 130
    failed = [LABEL[r] for r in robots if not results.get(r)]
    with print_lock:
        if failed:
            print(f'[관제 준비] 실패: {", ".join(failed)} — 로봇 상태를 확인한 뒤 '
                  f'`python3 host/robot_prepare.py --robots {",".join(r for r in robots if not results.get(r))}` 로 다시 준비하세요. '
                  '웹·rosbridge 는 계속 실행됩니다.', flush=True)
        else:
            print('[관제 준비] 모든 로봇 준비 완료 (process 모드, 이동 명령 없음).', flush=True)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
