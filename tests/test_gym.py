import unittest

import gymnasium as gym
import numpy as np
from gymnasium.utils.env_checker import check_env

from shanshenbu_gym import ShanshenbuQuickPlayEnv


ENV_ID = "Shanshenbu-v0"
IDLE = 1
RETREAT_JUMP = 3
KICK = 10
TIME_REMAINING = 42


def make_weak_env():
    return ShanshenbuQuickPlayEnv(difficulty="weak")


class QuickPlayEnvTests(unittest.TestCase):
    def test_gym_contract(self):
        env = make_weak_env()
        self.addCleanup(env.close)
        with self.assertRaises(gym.error.ResetNeeded):
            env.step(IDLE)
        check_env(env, skip_render_check=True)

        observation, info = env.reset(seed=11)
        self.assertEqual(env.action_space.n, 18)
        self.assertEqual(observation.shape, (58,))
        self.assertEqual(observation.dtype, np.float32)
        self.assertTrue(env.observation_space.contains(observation))
        self.assertEqual(info["difficulty"], "weak")
        self.assertEqual(info["frames"], 0)

        observation, reward, terminated, truncated, info = env.step(np.int64(IDLE))
        self.assertTrue(env.observation_space.contains(observation))
        self.assertEqual((reward, terminated, truncated), (0.0, False, False))
        self.assertEqual(info["frames"], 4)

    def test_seeded_replay_across_independent_workers(self):
        left = make_weak_env()
        right = make_weak_env()
        self.addCleanup(left.close)
        self.addCleanup(right.close)
        actions = (11, 1, 8, 2, 10, 0, 13, 5, 17) * 6

        for difficulty in ("weak", "medium", "strong"):
            with self.subTest(difficulty=difficulty):
                options = {"difficulty": difficulty}
                first, first_info = left.reset(seed=123, options=options)
                second, second_info = right.reset(seed=123, options=options)
                self.assertEqual(first_info["difficulty"], difficulty)
                self.assertEqual(first_info, second_info)
                np.testing.assert_array_equal(first, second)

                for action in actions:
                    first, *first_state = left.step(action)
                    second, *second_state = right.step(action)
                    np.testing.assert_array_equal(first, second)
                    self.assertEqual(first_state, second_state)
                    _, terminated, truncated, _ = first_state
                    if terminated or truncated:
                        break

        _, info = left.reset(seed=123)
        self.assertEqual(info["difficulty"], "weak")

    def test_game_end_and_reward(self):
        env = make_weak_env()
        self.addCleanup(env.close)
        cases = (
            ("weak", 11, IDLE, "cpu", "ko", -1.0),
            ("weak", 123, KICK, "player", "ko", 1.0),
            ("medium", 11, RETREAT_JUMP, "cpu", "timeout", -1.0),
        )
        for difficulty, seed, action, winner, reason, terminal_reward in cases:
            with self.subTest(winner=winner, reason=reason):
                env.reset(seed=seed, options={"difficulty": difficulty})
                for _ in range(1_500):
                    observation, reward, terminated, truncated, info = env.step(action)
                    self.assertTrue(env.observation_space.contains(observation))
                    self.assertFalse(truncated)
                    if terminated:
                        break
                    self.assertEqual(reward, 0.0)
                else:
                    self.fail("The single round never ended")

                self.assertEqual(info["winner"], winner)
                self.assertEqual(info["reason"], reason)
                self.assertEqual(reward, terminal_reward)
                if reason == "timeout":
                    self.assertEqual(observation[TIME_REMAINING], 0.0)
                    self.assertGreater(info["player_hp"], 0)
                else:
                    self.assertEqual(min(info["player_hp"], info["cpu_hp"]), 0)
                with self.assertRaises(gym.error.ResetNeeded):
                    env.step(IDLE)

        _, info = env.reset(seed=11)
        self.assertEqual(info["frames"], 0)
        self.assertIsNone(info["winner"])

    def test_external_time_limit(self):
        env = gym.make(ENV_ID, max_episode_steps=2)
        self.addCleanup(env.close)
        env.reset(seed=11)

        _, reward, terminated, truncated, info = env.step(IDLE)
        self.assertEqual((reward, terminated, truncated), (0.0, False, False))
        _, reward, terminated, truncated, info = env.step(IDLE)
        self.assertEqual((reward, terminated, truncated), (0.0, False, True))
        self.assertIsNone(info["winner"])
        self.assertEqual(info["frames"], 8)

    def test_spawned_vector_workers(self):
        envs = gym.vector.AsyncVectorEnv([make_weak_env, make_weak_env], context="spawn")
        self.addCleanup(envs.close)
        observations, _ = envs.reset(seed=[17, 17])
        np.testing.assert_array_equal(observations[0], observations[1])

        observations, rewards, terminated, truncated, _ = envs.step([IDLE, IDLE])
        np.testing.assert_array_equal(observations[0], observations[1])
        np.testing.assert_array_equal(rewards, [0.0, 0.0])
        self.assertFalse(terminated.any())
        self.assertFalse(truncated.any())

        observations, _, _, _, _ = envs.step([0, 2])
        self.assertFalse(np.array_equal(observations[0], observations[1]))
