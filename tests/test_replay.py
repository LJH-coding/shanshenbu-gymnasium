import json
import unittest
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory

import gymnasium as gym

from shanshenbu_gym import ShanshenbuQuickPlayEnv, ShanshenbuVersusEnv


class ReplayTests(unittest.TestCase):
    def test_replay_requires_opt_in_and_reset(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "replay.json"
            with ShanshenbuQuickPlayEnv() as env:
                env.reset(seed=7)
                with self.assertRaisesRegex(RuntimeError, "record_replay=True"):
                    env.save_replay(path)
            with ShanshenbuVersusEnv(record_replay=True) as env:
                with self.assertRaisesRegex(RuntimeError, "reset"):
                    env.save_replay(path)
            self.assertFalse(path.exists())

    def test_replay_keeps_initial_frame_and_every_substep(self):
        for env_id, mode, action in (
            ("Shanshenbu-v0", "quick_play", 2),
            ("ShanshenbuSelfplay-v0", "versus", (2, 1)),
        ):
            with self.subTest(mode=mode), TemporaryDirectory() as directory:
                path = Path(directory) / "replays" / "回放.json"
                with gym.make(env_id, record_replay=True) as env:
                    env.reset(seed=7)
                    _, _, _, _, info = env.step(action)
                    expected_info = deepcopy(info)
                    self.assertNotIn("replay_frames", info)
                    info["frames"] = -1
                    if "rewards" in info:
                        info["rewards"]["player_1"] = 99

                self.assertEqual(env.unwrapped.save_replay(path), path)
                replay = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(replay["format"], "shanshenbu-replay")
                self.assertEqual(replay["version"], 1)
                self.assertEqual(replay["fps"], 60)
                self.assertEqual(replay["mode"], mode)
                self.assertEqual(replay["result"], expected_info)
                self.assertEqual(len(replay["frames"]), 5)
                start, *steps = replay["frames"]
                self.assertEqual(set(start), {"p1", "p2", "balls", "timer"})
                self.assertEqual(start["timer"], 60)
                self.assertEqual(start["balls"], [])
                self.assertEqual(
                    [frame["p1"]["x"] - start["p1"]["x"] for frame in steps],
                    [5, 10, 15, 20],
                )

    def test_terminal_replay_and_reset_replaces_previous_frames(self):
        with TemporaryDirectory() as directory, ShanshenbuQuickPlayEnv(record_replay=True) as env:
            path = Path(directory) / "replay.json"
            env.reset(seed=11)
            for _ in range(1_500):
                _, _, terminated, _, info = env.step(1)
                if terminated:
                    break
            else:
                self.fail("The round never ended")
            env.save_replay(path)
            replay = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(replay["result"], info)
            self.assertEqual(len(replay["frames"]), info["frames"] + 1)
            self.assertEqual(replay["frames"][-1]["p1"]["hp"], info["player_hp"])

            env.reset(seed=11)
            env.save_replay(path)
            reset_replay = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(reset_replay["frames"], replay["frames"][:1])
            self.assertIsNone(reset_replay["result"]["winner"])
