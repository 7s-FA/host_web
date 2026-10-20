"""Read-only Action publisher discovery, including ROS hidden _action topics.

Some rosapi versions filter hidden publications from /rosapi/publishers even
when a hidden topic is explicitly requested. Query rclpy's graph directly.
"""
import json
import time
import rclpy
from rclpy.node import Node
from rclpy.executors import ExternalShutdownException
from rosapi_msgs.srv import Publishers
from std_msgs.msg import String

TOPICS = {f'/{device}/data/_action/status' for device in ('M1', 'M2', 'arm1', 'arm2', 'arm3')}


class ActionDiscovery(Node):
    def __init__(self):
        super().__init__('host_action_discovery')
        self.service = self.create_service(Publishers, '/host/action_publishers', self.publishers)
        # One graph sample serves every browser, without creating service clients
        # on rosbridge for each device every second.
        self.graph_publisher = self.create_publisher(String, '/host/device_discovery', 1)
        self.graph_timer = self.create_timer(0.5, self.publish_graph)

    def names(self, topic):
        return sorted({info.node_namespace.rstrip('/') + '/' + info.node_name
                       for info in self.get_publishers_info_by_topic(topic)})

    def publish_graph(self):
        publishers = {topic.split('/')[1]: self.names(topic) for topic in sorted(TOPICS)}
        self.graph_publisher.publish(String(data=json.dumps({
            'protocol': 1, 'stamp_ms': time.time_ns() // 1_000_000, 'publishers': publishers})))

    def publishers(self, request, response):
        if request.topic not in TOPICS:
            response.publishers = []
            return response
        response.publishers = self.names(request.topic)
        return response


def main():
    rclpy.init()
    node = ActionDiscovery()
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, ExternalShutdownException):
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == '__main__':
    main()
