"""Start the local robot panel's web server and ROS bridge together.

M1·M2 관제 준비(robot_prepare.py)도 함께 실행한다. 준비 로그는 이 터미널에
[robot_prepare-N] [버거1] ... 로 표시되고, 준비가 끝나도(성공·실패) 웹·rosbridge 는 계속 실행된다.
    ros2 launch host/host_control.launch.py                     # 준비 포함 (기본)
    ros2 launch host/host_control.launch.py parked:=true        # 로봇이 주차 자리에 있을 때
    ros2 launch host/host_control.launch.py robot_prepare:=false  # 준비 없이 웹·rosbridge 만
"""
from pathlib import Path
import socket
import sys

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, ExecuteProcess, IncludeLaunchDescription, LogInfo, OpaqueFunction, RegisterEventHandler
from launch.conditions import IfCondition
from launch.event_handlers import OnProcessExit
from launch.launch_description_sources import AnyLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration

PREPARE_NAME = 'robot_prepare'


def stop_on_exit(event, context):
    # 관제 준비는 끝나는 것이 정상이므로 Host 전체를 종료하지 않는다.
    if event.process_name.startswith(PREPARE_NAME):
        if event.returncode == 0:
            return LogInfo(msg='관제 준비 완료: M1·M2 process 모드 (이동 명령 없음)')
        return LogInfo(msg=f'관제 준비 실패(code={event.returncode}): 위 [버거N] 로그를 확인하세요. '
                           '웹·rosbridge 는 계속 실행됩니다. 다시 준비: python3 host/robot_prepare.py')
    if not context.is_shutdown:
        raise RuntimeError(
            f'{event.process_name} 종료(code={event.returncode}): Host 실행을 함께 종료합니다.'
        )


def prepare_process(context):
    parked = LaunchConfiguration('parked').perform(context).lower() in ('1', 'true', 'yes')
    cmd = [sys.executable, '-u', str(Path(__file__).resolve().with_name('robot_prepare.py'))]
    if parked:
        cmd.append('--parked')
    return [ExecuteProcess(cmd=cmd, name=PREPARE_NAME, output='screen',
                           condition=IfCondition(LaunchConfiguration('robot_prepare')))]


def generate_launch_description():
    try:
        from host_pkg.action import Burger
        from rclpy.type_support import check_for_type_support
        check_for_type_support(Burger)
    except (ImportError, RuntimeError) as exc:
        raise RuntimeError('host_pkg Action 타입을 빌드하고 install_local/local_setup.bash를 source하세요.') from exc

    try:
        from rosbridge_library.capabilities.send_action_goal import SendActionGoal
    except ImportError as exc:
        raise RuntimeError('Action을 지원하는 rosbridge가 필요합니다: sudo apt install ros-jazzy-rosbridge-suite') from exc

    for port in (8082, 9090):
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(('127.0.0.1', port))
            except OSError as exc:
                raise RuntimeError(f'127.0.0.1:{port} 사용 불가: 기존 서버를 종료한 뒤 다시 실행하세요. ({exc})') from exc

    bridge_launch = Path(get_package_share_directory('rosbridge_server')) / 'launch/rosbridge_websocket_launch.xml'
    return LaunchDescription([
        DeclareLaunchArgument('robot_prepare', default_value='true',
                              description='M1·M2 관제 준비 실행 (이동 명령 없음)'),
        DeclareLaunchArgument('parked', default_value='false',
                              description='로봇이 자기 주차 자리에 있을 때 true: 주차 좌표로 위치 설정'),
        RegisterEventHandler(OnProcessExit(on_exit=stop_on_exit)),
        IncludeLaunchDescription(
            AnyLaunchDescriptionSource(str(bridge_launch)),
            launch_arguments={'address': '127.0.0.1', 'port': '9090'}.items(),
        ),
        ExecuteProcess(
            cmd=[sys.executable, str(Path(__file__).resolve().with_name('server.py')), '--port', '8082'],
            name='host_web',
            output='screen',
        ),
        OpaqueFunction(function=prepare_process),
        LogInfo(msg='실물 상태: http://localhost:8082/?live=1 | 시뮬레이션: http://localhost:8082/ | Ctrl+C: 웹·rosbridge 종료'),
    ])
