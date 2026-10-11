import importlib.util
import io
import subprocess
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('robot_prepare', Path(__file__).resolve().parents[1] / 'host/robot_prepare.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class FakeChild:
    def __init__(self, lines, code):
        self.stdout = io.StringIO(''.join(line + '\n' for line in lines))
        self.code = code

    def wait(self):
        return self.code

    def kill(self):
        pass


class RobotPrepareTest(unittest.TestCase):
    def test_remote_command_matches_amr_prepare(self):
        cmd = m.ssh_command('burger1', 'host-1-b1-1', False)
        self.assertEqual(cmd[0], 'ssh')
        self.assertIn('BatchMode=yes', cmd)
        self.assertEqual(cmd[-2], m.ROBOTS['burger1']['ssh'])
        remote = cmd[-1]
        self.assertTrue(remote.startswith('bash -c '))
        self.assertIn('/home/ubuntu/AMR/.runtime/M1/final_robot_ws/robot/burger1/navigation', remote)
        self.assertIn('./host_prepare.py burger1 --request-id host-1-b1-1', remote)
        self.assertNotIn('--parked', remote)
        self.assertIn('--parked', m.ssh_command('burger2', 'x', True)[-1])
        self.assertIn('/M2/', m.ssh_command('burger2', 'x', True)[-1])

    def test_success_streams_robot_log(self):
        run = lambda *a, **k: FakeChild(['burger1 prepare services', '{"status": "success"}'], 0)
        self.assertTrue(m.prepare_once('burger1', 'id', False, run=run))

    def test_failure_and_ssh_key_guidance(self):
        self.assertFalse(m.prepare_once('burger1', 'id', False, run=lambda *a, **k: FakeChild(['RuntimeError: x'], 1)))
        self.assertFalse(m.prepare_once('burger2', 'id', False,
                                        run=lambda *a, **k: FakeChild(['Permission denied (publickey,password).'], 255)))

    def test_retry_uses_new_request_ids(self):
        ids = []
        original = m.prepare_once
        try:
            m.prepare_once = lambda robot, request_id, parked: ids.append(request_id) or len(ids) == 2
            results = {}
            m.prepare_robot('burger1', False, 2, 0, results, 'host-test')
        finally:
            m.prepare_once = original
        self.assertTrue(results['burger1'])
        self.assertEqual(ids, ['host-test-b1-1', 'host-test-b1-2'])

    def test_invalid_robot_rejected(self):
        with self.assertRaises(SystemExit):
            m.main(['--robots', 'burger3'])


if __name__ == '__main__':
    unittest.main()
