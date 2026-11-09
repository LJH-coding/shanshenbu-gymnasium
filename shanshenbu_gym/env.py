"""Gymnasium interface to the headless JavaScript battle simulation."""

from __future__ import annotations

import json
import subprocess
from copy import deepcopy
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, TypeVar

import gymnasium as gym
import numpy as np


_Observation = TypeVar("_Observation")
_Action = TypeVar("_Action")


def _fighter_observation_space() -> gym.spaces.Box:
    return gym.spaces.Box(low=-np.inf, high=np.inf, shape=(58,), dtype=np.float32)


class _WorkerEnv(gym.Env[_Observation, _Action]):
    """Manage the per-environment Node.js process."""

    metadata = {"render_modes": []}
    _replay_mode: str

    def __init__(
        self,
        render_mode: None = None,
        node_executable: str = "node",
        *,
        record_replay: bool = False,
    ) -> None:
        if render_mode is not None:
            raise ValueError("Shanshenbu environments only support render_mode=None.")

        self.render_mode = render_mode
        self._node_executable = node_executable
        self._process: subprocess.Popen[str] | None = None
        self._request_id = 0
        self._needs_reset = True
        self._record_replay = record_replay
        self._replay_frames: list[dict[str, Any]] = []
        self._replay_result: dict[str, Any] | None = None

    def _reset_worker(self, op: str, seed: int | None, **payload: Any) -> dict[str, Any]:
        super().reset(seed=seed)
        self._needs_reset = True
        if self._record_replay:
            payload["record_replay"] = True
        if self._process is None or self._process.poll() is not None:
            self.close()
            worker = Path(__file__).resolve().parent / "js" / "worker.cjs"
            try:
                self._process = subprocess.Popen(
                    [self._node_executable, str(worker)],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    encoding="utf-8",
                    bufsize=1,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
            except FileNotFoundError as exc:
                raise RuntimeError(
                    f"Node.js executable {self._node_executable!r} was not found. "
                    "Install Node.js and add it to PATH, or set node_executable."
                ) from exc

        worker_seed = int(self.np_random.integers(0, 2**32, dtype=np.uint32))
        reply = self._request(op, seed=worker_seed, **payload)
        if self._record_replay:
            self._replay_frames.clear()
            self._replay_result = None
        self._needs_reset = False
        return reply

    def _check_ready_to_step(self) -> None:
        if self._needs_reset:
            raise gym.error.ResetNeeded("Call reset() before stepping the environment.")

    def _step_worker(self, op: str, **payload: Any) -> dict[str, Any]:
        reply = self._request(op, **payload)
        self._needs_reset = reply["terminated"]
        return reply

    def _capture_replay(self, reply: dict[str, Any]) -> None:
        if not self._record_replay:
            return
        frames = reply.get("replay_frames")
        if not isinstance(frames, list) or not frames:
            self.close()
            raise RuntimeError("Shanshenbu worker did not return replay frames.")
        self._replay_frames.extend(frames)
        self._replay_result = deepcopy(reply["info"])

    def save_replay(self, path: str | Path) -> Path:
        """Save the latest recorded round, including a round still in progress."""
        if not self._record_replay:
            raise RuntimeError("Create the environment with record_replay=True to save replays.")
        if self._replay_result is None:
            raise RuntimeError("Call reset() before saving a replay.")

        destination = Path(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        replay = {
            "format": "shanshenbu-replay",
            "version": 1,
            "fps": 60,
            "mode": self._replay_mode,
            "frames": self._replay_frames,
            "result": self._replay_result,
        }
        temporary = NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=destination.parent, delete=False
        )
        temporary_path = Path(temporary.name)
        try:
            with temporary:
                json.dump(replay, temporary, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            temporary_path.replace(destination)
        finally:
            temporary_path.unlink(missing_ok=True)
        return destination

    def _request(self, op: str, **payload: Any) -> dict[str, Any]:
        process = self._process
        assert process is not None and process.stdin is not None and process.stdout is not None
        self._request_id += 1
        request = {"id": self._request_id, "op": op, **payload}
        try:
            process.stdin.write(json.dumps(request) + "\n")
            process.stdin.flush()
            line = process.stdout.readline()
        except (OSError, UnicodeError) as exc:
            self.close()
            raise RuntimeError(f"Could not communicate with the Shanshenbu worker ({op}).") from exc

        if not line:
            self.close()
            raise RuntimeError(f"Shanshenbu worker exited during {op} (code {process.returncode}).")
        try:
            reply = json.loads(line)
        except json.JSONDecodeError as exc:
            self.close()
            raise RuntimeError("Shanshenbu worker sent an invalid JSON response.") from exc

        if not isinstance(reply, dict) or reply.get("id") != self._request_id:
            self.close()
            raise RuntimeError("Shanshenbu worker response did not match the request.")
        if reply.get("ok") is not True:
            self.close()
            raise RuntimeError(f"Shanshenbu worker failed during {op}: {reply.get('error')}")
        return reply

    def render(self) -> None:
        return None

    def close(self) -> None:
        """Close the worker's input and wait for it to exit."""
        process, self._process = self._process, None
        self._needs_reset = True
        if process is None:
            return

        try:
            if process.stdin is not None:
                try:
                    process.stdin.close()
                except BrokenPipeError:
                    pass
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        finally:
            if process.stdout is not None:
                process.stdout.close()


class ShanshenbuQuickPlayEnv(_WorkerEnv[np.ndarray, int]):
    """Play a single Quick Play round against a fixed CPU difficulty."""

    _replay_mode = "quick_play"

    def __init__(
        self,
        difficulty: str = "weak",
        render_mode: None = None,
        node_executable: str = "node",
        *,
        record_replay: bool = False,
    ) -> None:
        super().__init__(
            render_mode=render_mode, node_executable=node_executable, record_replay=record_replay
        )
        self.difficulty = self._validate_difficulty(difficulty)
        self.action_space = gym.spaces.Discrete(18)
        self.observation_space = _fighter_observation_space()

    @staticmethod
    def _validate_difficulty(difficulty: str) -> str:
        if not isinstance(difficulty, str) or difficulty not in ("weak", "medium", "strong"):
            raise ValueError("Difficulty must be 'weak', 'medium', or 'strong'.")
        return difficulty

    def reset(
        self, *, seed: int | None = None, options: dict[str, Any] | None = None
    ) -> tuple[np.ndarray, dict[str, Any]]:
        """Start a round, optionally overriding difficulty for this episode."""
        difficulty = self._validate_difficulty(
            options.get("difficulty", self.difficulty) if options else self.difficulty
        )
        reply = self._reset_worker("reset", seed, difficulty=difficulty)
        self._capture_replay(reply)
        return np.asarray(reply["observation"], dtype=np.float32), reply["info"]

    def step(self, action: int) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        self._check_ready_to_step()
        if isinstance(action, bool) or not self.action_space.contains(action):
            raise ValueError(f"Expected an integer action from 0 to 17, got {action!r}.")

        reply = self._step_worker("step", action=int(action))
        self._capture_replay(reply)
        return (
            np.asarray(reply["observation"], dtype=np.float32),
            float(reply["reward"]),
            reply["terminated"],
            False,
            reply["info"],
        )


_VersusObservation = dict[str, np.ndarray]
_VersusAction = np.ndarray | list[int] | tuple[int, int]


class ShanshenbuVersusEnv(_WorkerEnv[_VersusObservation, _VersusAction]):
    """Play a single round with simultaneous actions from two policies."""

    _replay_mode = "versus"

    def __init__(
        self,
        render_mode: None = None,
        node_executable: str = "node",
        *,
        record_replay: bool = False,
    ) -> None:
        super().__init__(
            render_mode=render_mode, node_executable=node_executable, record_replay=record_replay
        )
        self.action_space = gym.spaces.MultiDiscrete([18, 18])
        self.observation_space = gym.spaces.Dict(
            {
                "player_1": _fighter_observation_space(),
                "player_2": _fighter_observation_space(),
            }
        )

    def reset(
        self, *, seed: int | None = None, options: dict[str, Any] | None = None
    ) -> tuple[_VersusObservation, dict[str, Any]]:
        reply = self._reset_worker("reset_versus", seed)
        observation, _, info = self._decode_result(reply)
        return observation, info

    def step(
        self, action: _VersusAction
    ) -> tuple[_VersusObservation, float, bool, bool, dict[str, Any]]:
        self._check_ready_to_step()
        actions = np.asarray(action)
        has_boolean = isinstance(action, (list, tuple)) and any(
            isinstance(value, (bool, np.bool_)) for value in action
        )
        if (
            has_boolean
            or not np.issubdtype(actions.dtype, np.integer)
            or not self.action_space.contains(actions)
        ):
            raise ValueError(f"Expected two integer actions from 0 to 17, got {action!r}.")

        reply = self._step_worker("step_versus", actions=actions.tolist())
        observation, reward, info = self._decode_result(reply)
        return observation, reward, reply["terminated"], False, info

    def _decode_result(
        self, reply: dict[str, Any],
    ) -> tuple[_VersusObservation, float, dict[str, Any]]:
        observation = {
            player: np.asarray(values, dtype=np.float32)
            for player, values in reply["observation"].items()
        }
        reward = float(reply["reward"])
        info = reply["info"]
        info["rewards"] = {"player_1": reward, "player_2": -reward}
        self._capture_replay(reply)
        return observation, reward, info
