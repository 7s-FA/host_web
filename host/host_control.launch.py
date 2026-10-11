"""Start the local robot panel's web server and ROS bridge together."""
from pathlib import Path
import socket
import sys

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import ExecuteProcess, IncludeLaunchDescription, LogInfo, RegisterEventHandler
from launch.event_handlers import OnProcessExit
from launch.launch_description_sources import AnyLaunchDescriptionSource


def stop_on_exit(event, context):
    if not context.is_shutdown:
        raise RuntimeError(
            f'{event.process_name} 종료(code={event.returncode}): Host 실행을 함께 종료합니다.'
        )


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
        LogInfo(msg='실물 상태: http://localhost:8082/?live=1 | 시뮬레이션: http://localhost:8082/ | Ctrl+C: 웹·rosbridge 종료'),
    ])
