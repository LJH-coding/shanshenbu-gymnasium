"""Register the headless Shanshenbu environments with Gymnasium."""

from gymnasium.envs.registration import register

from .env import ShanshenbuQuickPlayEnv, ShanshenbuVersusEnv

__all__ = ["ShanshenbuQuickPlayEnv", "ShanshenbuVersusEnv"]

register(
    id="Shanshenbu-v0",
    entry_point="shanshenbu_gym:ShanshenbuQuickPlayEnv",
)
register(
    id="ShanshenbuSelfplay-v0",
    entry_point="shanshenbu_gym:ShanshenbuVersusEnv",
)
