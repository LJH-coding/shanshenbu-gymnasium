import unittest

import gymnasium as gym
import numpy as np
from gymnasium.utils.env_checker import check_env

from shanshenbu_gym import ShanshenbuVersusEnv


ENV_ID = "ShanshenbuSelfplay-v0"
PLAYERS = ("player_1", "player_2")
IDLE, ADVANCE, JUMP, KICK = 1, 2, 4, 10
SELF_HP, SELF_HEIGHT, SELF_SPEED = 0, 1, 3
OPPONENT_HP, OPPONENT_HEIGHT, OPPONENT_SPEED = 19, 20, 22
DISTANCE, SELF_BACK, TIME_REMAINING = 38, 40, 42
PROJECTILE_PRESENT, PROJECTILE_OWNER = 43, 47


class VersusEnvTests(unittest.TestCase):
    def test_joint_actions_and_relative_observations(self):
        with gym.make(ENV_ID) as env:
            self.assertIsInstance(env.unwrapped, ShanshenbuVersusEnv)
            check_env(env.unwrapped, skip_render_check=True)
            self.assertIsInstance(env.action_space, gym.spaces.MultiDiscrete)
            np.testing.assert_array_equal(env.action_space.nvec, [18, 18])
            self.assertIsInstance(env.observation_space, gym.spaces.Dict)
            observations, info = env.reset(seed=11)
            self.assertEqual(set(observations), set(PLAYERS))
            self.assertTrue(env.observation_space.contains(observations))
            self.assertEqual(info["frames"], 0)
            self.assertEqual(info["rewards"], dict.fromkeys(PLAYERS, 0))

            for player in PLAYERS:
                self.assertEqual(observations[player].shape, (58,))
                self.assertEqual(observations[player].dtype, np.float32)
                self.assertAlmostEqual(observations[player][DISTANCE], 520 / 1280)
                self.assertAlmostEqual(observations[player][SELF_BACK], 380 / 1280)

            observations, reward, terminated, truncated, info = env.step([ADVANCE, ADVANCE])
            self.assertEqual((reward, terminated, truncated), (0.0, False, False))
            self.assertEqual(info["frames"], 4)
            for player in PLAYERS:
                obs = observations[player]
                self.assertAlmostEqual(obs[DISTANCE], 480 / 1280)
                self.assertAlmostEqual(obs[SELF_BACK], 400 / 1280)
                self.assertAlmostEqual(obs[SELF_SPEED], 300 / 800)
                self.assertAlmostEqual(obs[OPPONENT_SPEED], -300 / 800)

            observations, *_ = env.step(np.array([IDLE, JUMP], dtype=np.int64))
            first, second = (observations[player] for player in PLAYERS)
            self.assertEqual(first[SELF_HEIGHT], 0)
            self.assertGreater(second[SELF_HEIGHT], 0)
            self.assertEqual(first[OPPONENT_HEIGHT], second[SELF_HEIGHT])
            self.assertEqual(second[OPPONENT_HEIGHT], first[SELF_HEIGHT])

    def test_seeded_replay_and_zero_sum_knockouts(self):
        with gym.make(ENV_ID) as live, gym.make(ENV_ID) as replay:
            bouts = (((KICK, IDLE), "player_1", 1.0), ((IDLE, KICK), "player_2", -1.0))
            for action, winner, terminal_reward in bouts:
                with self.subTest(winner=winner):
                    live.reset(seed=123)
                    replay.reset(seed=123)
                    owner_from_first = 1 if action[0] == KICK else -1
                    saw_projectile = False
                    for _ in range(900):
                        observations, reward, terminated, truncated, info = live.step(action)
                        repeated, *result = replay.step(action)
                        self.assertEqual(result, [reward, terminated, truncated, info])
                        self.assertFalse(truncated)
                        self.assertEqual(info["rewards"], {"player_1": reward, "player_2": -reward})
                        for player in PLAYERS:
                            np.testing.assert_array_equal(observations[player], repeated[player])

                        first, second = (observations[player] for player in PLAYERS)
                        if first[PROJECTILE_PRESENT]:
                            saw_projectile = True
                            self.assertEqual(first[PROJECTILE_OWNER], owner_from_first)
                            self.assertEqual(second[PROJECTILE_OWNER], -owner_from_first)
                        self.assertEqual(first[SELF_HP], second[OPPONENT_HP])
                        self.assertEqual(second[SELF_HP], first[OPPONENT_HP])
                        if terminated:
                            break
                        self.assertEqual(reward, 0.0)
                    else:
                        self.fail("Unopposed kicks did not produce a knockout")

                    self.assertTrue(saw_projectile)
                    self.assertEqual(reward, terminal_reward)
                    self.assertEqual((info["winner"], info["reason"]), (winner, "ko"))
                    self.assertEqual(sorted((info["player_1_hp"], info["player_2_hp"])), [0, 200])
                    with self.assertRaises(gym.error.ResetNeeded):
                        live.step(action)

    def test_idle_timeout_is_a_draw(self):
        with gym.make(ENV_ID) as env:
            env.reset(seed=123)
            for _ in range(899):
                _, reward, terminated, truncated, _ = env.step((IDLE, IDLE))
                self.assertEqual((reward, terminated, truncated), (0.0, False, False))

            observations, reward, terminated, truncated, info = env.step((IDLE, IDLE))
            self.assertEqual((reward, terminated, truncated), (0.0, True, False))
            self.assertEqual((info["winner"], info["reason"], info["frames"]), ("draw", "timeout", 3600))
            self.assertEqual(info["rewards"], dict.fromkeys(PLAYERS, 0))
            for player in PLAYERS:
                self.assertEqual(info[f"{player}_hp"], 200)
                self.assertEqual(observations[player][TIME_REMAINING], 0)

    def test_invalid_joint_actions_leave_state_unchanged(self):
        with gym.make(ENV_ID) as env:
            env.reset(seed=123)
            invalid_actions = (
                IDLE, [IDLE], [IDLE, IDLE, IDLE], [IDLE, -1], [18, IDLE],
                [True, IDLE], [IDLE, 1.0],
            )
            for action in invalid_actions:
                with self.subTest(action=action):
                    with self.assertRaises(ValueError):
                        env.step(action)

            _, _, _, _, info = env.step((IDLE, IDLE))
            self.assertEqual(info["frames"], 4)
