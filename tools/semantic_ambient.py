#!/usr/bin/env python3
"""
Semantic Ambient Analyzer for Dula episodes.

Reads script.story and config/ambient_config.json, then produces a list of
procedural ambient sound events that match the scene, mood, and dialogue.

The output events follow the same shape as `{SFX:Procedural|...}` story tags
and are consumed by `tools.procedural_audio.render()` during `dula-audio`.

Example output:
    [
      {"type": "wind", "start": 0.0, "end": 35.0, "volume": 0.12, "intensity": 0.4},
      {"type": "traffic", "start": 36.0, "end": 90.0, "volume": 0.08},
    ]
"""

import json
import os
import re


class SemanticAmbientAnalyzer:
    """Rule-based semantic analyzer that maps story content to ambient events."""

    # Fields that control semantic layer selection but are not generator args.
    LAYER_CONTROL_FIELDS = {
        "enabled",
        "layers",
        "replace",
        "mode",
        "source",
        "id",
        "kind",
        "semantic",
        "loop",
        "position",
        "radius",
    }

    # Contract audio anchors describe intent rather than exact synthesis
    # parameters. These defaults turn the two common looped indoor anchors
    # into restrained procedural layers.
    CONTRACT_LAYER_DEFAULTS = {
        "room_tone": {"type": "room_tone", "volume": 0.075, "intensity": 0.28},
        "clock_tick": {
            "type": "clock_tick",
            "volume": 0.055,
            "intensity": 0.5,
            "density": 1.0,
        },
    }

    # ───────────────────────────────────────────────────────────────────────
    # Scene -> default ambient profile
    # Profiles use procedural audio types from procedural_audio.registry.
    # Volume is relative to the final mix (kept low so ambient stays ambient).
    # ───────────────────────────────────────────────────────────────────────
    SCENE_PROFILES = {
        # Indoor / quiet
        "RoomScene": None,  # no procedural ambient by default
        "NightRoomScene": None,
        "LockerRoomScene": None,
        "NobitaRoom": None,
        "ClassroomScene": None,
        "HospitalCorridorScene": None,
        "ReceptionScene": None,
        "DrawerScene": None,
        "ShinChanScene": None,

        # Nature
        "ParkScene": {"type": "wind", "volume": 0.08, "intensity": 0.25},
        "SkyScene": {"type": "wind", "volume": 0.15, "intensity": 0.45},
        "StarSkyScene": {"type": "wind", "volume": 0.12, "intensity": 0.35},
        "BeachScene": {"type": "wind", "volume": 0.12, "intensity": 0.35},
        "WhisperingWoodsScene": {"type": "wind", "volume": 0.12, "intensity": 0.30},
        "DestroyedCityScene": {"type": "wind", "volume": 0.14, "intensity": 0.50},
        "SarayashikiRoofScene": {"type": "wind", "volume": 0.16, "intensity": 0.45},
        "FeudalForestScene": {"type": "wind", "volume": 0.12, "intensity": 0.35},
        "PrehistoricJungleScene": {"type": "wind", "volume": 0.13, "intensity": 0.40},
        "PrehistoricScene": {"type": "wind", "volume": 0.12, "intensity": 0.35},
        "SanctuaryIntroScene": {"type": "wind", "volume": 0.10, "intensity": 0.30},

        # Urban
        "CityScene": {"type": "traffic", "volume": 0.10, "density": 0.35},
        "NightStreetScene": {"type": "traffic", "volume": 0.08, "density": 0.20},
        "StreetCourtScene": {"type": "traffic", "volume": 0.06, "density": 0.25},

        # Sci-fi / mechanical
        "SpaceStationScene": {"type": "vault_hum", "volume": 0.10},
        "BrightSpaceStationScene": {"type": "vault_hum", "volume": 0.10},
        "DeepSpaceScene": {"type": "energy_hum", "volume": 0.09},
        "AlienPlanetScene": {"type": "wind", "volume": 0.13, "intensity": 0.40},
        "FrightZoneScene": {"type": "wind", "volume": 0.16, "intensity": 0.65},
        "BrightMoonScene": {"type": "wind", "volume": 0.10, "intensity": 0.30},
        "GLTFArenaScene": {"type": "energy_hum", "volume": 0.08},

        # Arena / sport (no crowd generator yet; use subtle energy hum as placeholder)
        "BasketballArenaScene": {"type": "energy_hum", "volume": 0.06},
        "StadiumScene": {"type": "energy_hum", "volume": 0.07},
        "DuelArenaScene": {"type": "energy_hum", "volume": 0.08},

        # Virtual / studio
        "VirtualStudio": {"type": "energy_hum", "volume": 0.06},

        # Vehicle / highway
        "NeonHighwayScene": {"type": "traffic", "volume": 0.12, "density": 0.40},
        "SpaceChaseScene": {"type": "engine_idle", "volume": 0.12},
        "SpaceshipCabinScene": {"type": "engine_idle", "volume": 0.10},
        "FutureCityScene": {"type": "traffic", "volume": 0.10, "density": 0.35},
        "TimeTunnelScene": {"type": "energy_hum", "volume": 0.10},

        # Industrial / vault
        "PlasmaVaultScene": {"type": "vault_hum", "volume": 0.12},
        "SubwayHubScene": {"type": "traffic", "volume": 0.10, "density": 0.30},
        "UndergroundPipeScene": {"type": "vault_hum", "volume": 0.10},
        "ScrapyardSectorScene": {"type": "wind", "volume": 0.12, "intensity": 0.35},
        "VolcanoBaseScene": {"type": "wind", "volume": 0.12, "intensity": 0.45},

        # Performance / party
        "BugRaveStageScene": {"type": "energy_hum", "volume": 0.07},
    }

    # Fallback heuristic for unknown scene names.
    # Checks substring keywords in the scene name (lowercase).
    SCENE_NAME_HEURISTICS = [
        ("highway", {"type": "traffic", "volume": 0.12, "density": 0.40}),
        ("street", {"type": "traffic", "volume": 0.09, "density": 0.30}),
        ("city", {"type": "traffic", "volume": 0.10, "density": 0.35}),
        ("space", {"type": "energy_hum", "volume": 0.09}),
        ("station", {"type": "vault_hum", "volume": 0.10}),
        ("ship", {"type": "engine_idle", "volume": 0.10}),
        ("jungle", {"type": "wind", "volume": 0.13, "intensity": 0.40}),
        ("forest", {"type": "wind", "volume": 0.12, "intensity": 0.35}),
        ("wood", {"type": "wind", "volume": 0.11, "intensity": 0.30}),
        ("beach", {"type": "wind", "volume": 0.12, "intensity": 0.35}),
        ("roof", {"type": "wind", "volume": 0.14, "intensity": 0.40}),
        ("volcano", {"type": "wind", "volume": 0.12, "intensity": 0.45}),
        ("vault", {"type": "vault_hum", "volume": 0.11}),
        ("arena", {"type": "energy_hum", "volume": 0.07}),
        ("stage", {"type": "energy_hum", "volume": 0.07}),
        ("tunnel", {"type": "energy_hum", "volume": 0.09}),
        ("pipe", {"type": "vault_hum", "volume": 0.10}),
        ("scrapyard", {"type": "wind", "volume": 0.12, "intensity": 0.35}),
        ("subway", {"type": "traffic", "volume": 0.09, "density": 0.30}),
    ]

    # ───────────────────────────────────────────────────────────────────────
    # Keyword modifiers applied per scene segment.
    # Each entry can add an ambient layer or tweak intensity/volume.
    # ───────────────────────────────────────────────────────────────────────
    KEYWORD_MODIFIERS = {
        # Weather / nature
        "雨": {"add": [{"type": "rain", "volume": 0.18, "intensity": 0.45}]},
        "下雨": {"add": [{"type": "rain", "volume": 0.20, "intensity": 0.50}]},
        "rain": {"add": [{"type": "rain", "volume": 0.18, "intensity": 0.45}]},
        "storm": {"add": [{"type": "rain", "volume": 0.22, "intensity": 0.70}, {"type": "wind", "volume": 0.18, "intensity": 0.70}]},
        "暴风雨": {"add": [{"type": "rain", "volume": 0.24, "intensity": 0.75}, {"type": "wind", "volume": 0.20, "intensity": 0.75}]},
        "风": {"boost": {"wind": {"intensity": 0.25, "volume": 0.04}}},
        "wind": {"boost": {"wind": {"intensity": 0.25, "volume": 0.04}}},
        "winds": {"boost": {"wind": {"intensity": 0.25, "volume": 0.04}}},

        # Urban
        "车": {"boost": {"traffic": {"density": 0.20, "volume": 0.03}}},
        "traffic": {"boost": {"traffic": {"density": 0.20, "volume": 0.03}}},
        "街道": {"boost": {"traffic": {"density": 0.10, "volume": 0.02}}},

        # Mechanical / sci-fi
        "机器": {"add": [{"type": "engine_idle", "volume": 0.10}]},
        "machine": {"add": [{"type": "engine_idle", "volume": 0.10}]},
        "engine": {"add": [{"type": "engine_idle", "volume": 0.10}]},
        "能量": {"add": [{"type": "energy_hum", "volume": 0.09}]},
        "energy": {"add": [{"type": "energy_hum", "volume": 0.09}]},
        "vault": {"add": [{"type": "vault_hum", "volume": 0.10}]},
        "飞船": {"add": [{"type": "engine_idle", "volume": 0.12}]},
        "spaceship": {"add": [{"type": "engine_idle", "volume": 0.12}]},

        # Mood / tension
        "战斗": {"add": [{"type": "energy_hum", "volume": 0.08}]},
        "fight": {"add": [{"type": "energy_hum", "volume": 0.08}]},
        "battle": {"add": [{"type": "energy_hum", "volume": 0.10}]},
        "害怕": {"boost": {"energy_hum": {"volume": 0.05}}, "add": [{"type": "energy_hum", "volume": 0.06}]},
        "scared": {"boost": {"energy_hum": {"volume": 0.05}}, "add": [{"type": "energy_hum", "volume": 0.06}]},
        "紧张": {"add": [{"type": "energy_hum", "volume": 0.06}]},
        "tense": {"add": [{"type": "energy_hum", "volume": 0.06}]},

        # Quiet override
        "安静": {"mute": True},
        "quiet": {"mute": True},
        "silent": {"mute": True},
    }

    # ───────────────────────────────────────────────────────────────────────
    # Public API
    # ───────────────────────────────────────────────────────────────────────

    def __init__(self, config=None, scene_contract=None):
        """
        Args:
            config: dict from config/ambient_config.json (optional).
            scene_contract: parsed config/scene_contract.json (optional).
        """
        self.config = config or {}
        self.enabled = self.config.get("enabled", True)
        self.global_volume = float(self.config.get("global_volume", 1.0))
        self.scene_overrides = self.config.get("scene_profiles", {})
        self.scene_contract = scene_contract or {}
        self.contract_scene_layers = self._contract_layers_by_scene(
            self.scene_contract
        )

    def analyze(self, story_text, total_duration=None):
        """
        Analyze a .story file and return ambient events.

        Args:
            story_text: full content of script.story
            total_duration: optional total length of the episode in seconds.
                            If None, inferred from the last entry end time.

        Returns:
            List of event dicts ready for procedural_audio.render().
        """
        if not self.enabled:
            return []

        segments = self._parse_segments(story_text)
        if not segments:
            return []

        # Infer total duration from last segment if not provided.
        if total_duration is None:
            total_duration = max(seg["end"] for seg in segments)

        events = []
        for seg in segments:
            seg_events = self._ambient_for_segment(seg)
            events.extend(seg_events)

        # Merge overlapping events of the same type to avoid redundant generation.
        events = self._merge_same_type_events(events)
        # Clamp to total_duration.
        events = self._clamp_duration(events, total_duration)
        return events

    # ───────────────────────────────────────────────────────────────────────
    # Parsing
    # ───────────────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_segments(story_text):
        """
        Split story into scene segments.

        Returns list of dicts:
            {
              "scene": "RoomScene",
              "start": 0.0,
              "end": 35.0,
              "dialogue": "all dialogue text in this segment",
            }
        """
        lines = story_text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        segments = []
        current_scene = None
        current_start = 0.0
        current_dialogue = []

        def _push_segment(end_time):
            nonlocal current_scene, current_start, current_dialogue
            if current_scene is None:
                return
            segments.append({
                "scene": current_scene,
                "start": current_start,
                "end": end_time,
                "dialogue": " ".join(current_dialogue),
            })

        i = 0
        last_end = 0.0
        while i < len(lines):
            line = lines[i].strip()
            if line == "":
                i += 1
                continue

            # Entry index line
            if line.isdigit():
                i += 1
                if i >= len(lines):
                    break
                time_line = lines[i].strip()
                i += 1
                m = re.match(
                    r"(\d{2}):(\d{2}):(\d{2}),(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2}),(\d{3})",
                    time_line,
                )
                if not m:
                    continue
                start = (
                    int(m.group(1)) * 3600
                    + int(m.group(2)) * 60
                    + int(m.group(3))
                    + int(m.group(4)) / 1000
                )
                end = (
                    int(m.group(5)) * 3600
                    + int(m.group(6)) * 60
                    + int(m.group(7))
                    + int(m.group(8)) / 1000
                )
                last_end = max(last_end, end)

                # Read content lines until blank line
                content_lines = []
                while i < len(lines) and lines[i].strip() != "":
                    content_lines.append(lines[i].strip())
                    i += 1
                content = "\n".join(content_lines)

                # Detect scene switch: @SceneName at the start of an entry
                scene_match = re.match(r"@(\w+)", content)
                if scene_match:
                    new_scene = scene_match.group(1)
                    _push_segment(start)
                    current_scene = new_scene
                    current_start = start
                    current_dialogue = []

                # Strip tags for dialogue analysis
                dialogue = SemanticAmbientAnalyzer._strip_tags(content)
                if dialogue:
                    current_dialogue.append(dialogue)
            else:
                i += 1

        # Close final segment
        _push_segment(last_end)
        return segments

    @staticmethod
    def _strip_tags(content):
        """Remove all tags and scene declarations, leaving plain dialogue."""
        # Remove scene declaration at start
        text = re.sub(r"^@\w+(?:\{[^}]*\})*\s*", "", content)
        # Remove all {Namespace:...} and {Action} tags
        text = re.sub(r"\{[^}]+\}", "", text)
        # Remove [Character] markers
        text = re.sub(r"\[\w+\]\s*", "", text)
        return text.strip()

    # ───────────────────────────────────────────────────────────────────────
    # Ambient generation per segment
    # ───────────────────────────────────────────────────────────────────────

    def _ambient_for_segment(self, seg):
        """Return ambient events for a single scene segment."""
        scene = seg["scene"]
        start = seg["start"]
        end = seg["end"]
        dialogue = seg["dialogue"]
        duration = max(0.0, end - start)
        if duration <= 0:
            return []

        # Scene-level override / disable
        override = self.scene_overrides.get(scene, {})
        if not isinstance(override, dict):
            override = {}
        if override.get("enabled") is False:
            return []

        profile = self._default_profile_for_scene(scene, has_override=bool(override))
        contract_layers = self.contract_scene_layers.get(scene, [])

        # Collect base layers. Explicit `layers` is the multi-layer replacement
        # form; explicit legacy `type` remains a single-layer replacement.
        layers = {}
        if "layers" in override:
            configured_layers = self._coerce_config_layers(override.get("layers"))
            for configured in configured_layers:
                self._put_layer(layers, configured, start, end)
        elif override.get("type") is not None:
            self._put_layer(layers, override, start, end)
        else:
            if profile:
                self._put_layer(layers, profile, start, end)
            for contract_layer in contract_layers:
                self._put_layer(layers, contract_layer, start, end)

            # Backward-compatible scene-profile tweaks such as
            # {"volume": 0.1, "intensity": 0.4}. With contract-derived
            # multi-layer beds, apply the same tweak to every active layer.
            if override:
                tweaks = self._clean_layer(override, require_type=False)
                if tweaks:
                    for sound_type in list(layers):
                        layers[sound_type].update(tweaks)

        # Apply keyword modifiers
        modifiers = self._collect_modifiers(dialogue)
        if modifiers.get("mute"):
            return []

        for add_layer in modifiers.get("add", []):
            t = add_layer["type"]
            if t in layers:
                # Blend additional layer by raising volume slightly
                layers[t]["volume"] = min(1.0, layers[t].get("volume", 0.0) + add_layer.get("volume", 0.0))
                if "intensity" in add_layer:
                    layers[t]["intensity"] = min(1.0, layers[t].get("intensity", 0.0) + add_layer.get("intensity", 0.0))
                if "density" in add_layer:
                    layers[t]["density"] = min(1.0, layers[t].get("density", 0.0) + add_layer.get("density", 0.0))
            else:
                layer = dict(add_layer)
                layer["start"] = start
                layer["end"] = end
                layers[t] = layer

        for sound_type, boost in modifiers.get("boost", {}).items():
            if sound_type not in layers:
                continue
            if "volume" in boost:
                layers[sound_type]["volume"] = min(1.0, layers[sound_type].get("volume", 0.0) + boost["volume"])
            if "intensity" in boost:
                layers[sound_type]["intensity"] = min(1.0, layers[sound_type].get("intensity", 0.0) + boost["intensity"])
            if "density" in boost:
                layers[sound_type]["density"] = min(1.0, layers[sound_type].get("density", 0.0) + boost["density"])

        # Apply global volume and clean up
        events = []
        for layer in layers.values():
            layer = self._clean_layer(layer)
            if not layer:
                continue
            layer["volume"] = round(
                float(layer.get("volume", 0.1)) * self.global_volume, 4
            )
            # Remove redundant zero-volume layers
            if layer["volume"] <= 0.001:
                continue
            # Ensure intensity/density are within 0..1
            for key in ("intensity", "density"):
                if key in layer:
                    layer[key] = max(0.0, min(1.0, float(layer[key])))
            events.append(layer)

        return events

    def _default_profile_for_scene(self, scene, has_override=False):
        """Return a copy of the built-in or inferred single-layer profile."""
        profile = self.SCENE_PROFILES.get(scene)
        if profile is not None:
            return dict(profile)

        # Preserve the legacy behavior where any scene override suppresses
        # name heuristics unless it explicitly supplies a type.
        if has_override:
            return None

        scene_lower = scene.lower()
        for keyword, heuristic in self.SCENE_NAME_HEURISTICS:
            if keyword in scene_lower:
                return dict(heuristic)
        return None

    @classmethod
    def _normalize_layer_type(cls, sound_type):
        """Normalize common semantic/contract aliases to registry type names."""
        if sound_type is None:
            return None
        normalized = re.sub(r"[\s-]+", "_", str(sound_type).strip().lower())
        aliases = {
            "roomtone": "room_tone",
            "room_ambience": "room_tone",
            "indoor_roomtone": "room_tone",
            "clock": "clock_tick",
            "clocktick": "clock_tick",
        }
        return aliases.get(normalized, normalized)

    @classmethod
    def _clean_layer(cls, layer, require_type=True):
        """Remove semantic control metadata before events reach generators."""
        if not isinstance(layer, dict) or layer.get("enabled") is False:
            return None

        cleaned = {
            key: value
            for key, value in layer.items()
            if key not in cls.LAYER_CONTROL_FIELDS
        }
        if "type" in layer:
            cleaned["type"] = cls._normalize_layer_type(layer.get("type"))

        if require_type and not cleaned.get("type"):
            return None
        return cleaned

    @classmethod
    def _coerce_config_layers(cls, raw_layers):
        """Accept a list of layers or a name-keyed layer object."""
        if isinstance(raw_layers, list):
            return raw_layers
        if isinstance(raw_layers, dict):
            if "type" in raw_layers:
                return [raw_layers]
            layers = []
            for name, value in raw_layers.items():
                if not isinstance(value, dict):
                    continue
                layer = dict(value)
                layer.setdefault("type", name)
                layers.append(layer)
            return layers
        return []

    @classmethod
    def _put_layer(cls, layers, layer, start, end):
        """Sanitize and merge a layer into a type-keyed scene bed."""
        cleaned = cls._clean_layer(layer)
        if not cleaned:
            return
        cleaned["start"] = start
        cleaned["end"] = end
        sound_type = cleaned["type"]
        if sound_type in layers:
            layers[sound_type].update(cleaned)
        else:
            layers[sound_type] = cleaned

    @classmethod
    def _contract_anchor_type(cls, anchor):
        """Map a looped scene-contract audio anchor to a procedural type."""
        if not isinstance(anchor, dict) or anchor.get("loop") is not True:
            return None

        kind = str(anchor.get("kind", "")).strip().lower()
        anchor_id = str(anchor.get("id", "")).strip().lower()
        semantic = str(anchor.get("semantic", "")).strip().lower()
        normalized_kind = re.sub(r"[\s_-]+", "", kind)
        searchable = f"{kind} {anchor_id} {semantic}"

        if normalized_kind in {"roomtone", "roomambience", "ambience"}:
            return "room_tone"
        if (
            "roomtone" in searchable.replace(" ", "")
            or "room tone" in searchable
            or "indoor ambience" in searchable
            or "enclosed" in searchable
            or "室内底噪" in searchable
        ):
            return "room_tone"

        if normalized_kind in {"clocktick", "clock"}:
            return "clock_tick"
        if (
            ("clock" in searchable and ("tick" in searchable or "tock" in searchable))
            or "时钟" in searchable
            or "钟表" in searchable
            or "滴答" in searchable
        ):
            return "clock_tick"
        return None

    @classmethod
    def _contract_layers_by_scene(cls, scene_contract):
        """Extract looped room/clock semantic layers from scene audio anchors."""
        result = {}
        if not isinstance(scene_contract, dict):
            return result

        for scene in scene_contract.get("scenes", []):
            if not isinstance(scene, dict):
                continue
            scene_name = (
                scene.get("registryName")
                or scene.get("name")
                or scene.get("implementation", {}).get("name")
            )
            if not scene_name:
                continue

            layers = []
            for anchor in scene.get("audioAnchors", []):
                sound_type = cls._contract_anchor_type(anchor)
                if not sound_type:
                    continue
                layer = dict(cls.CONTRACT_LAYER_DEFAULTS[sound_type])
                for key in ("volume", "intensity", "density"):
                    if key in anchor:
                        layer[key] = anchor[key]
                layers.append(layer)

            if layers:
                result[scene_name] = layers
        return result

    def _collect_modifiers(self, dialogue):
        """Aggregate keyword modifiers from dialogue text."""
        modifiers = {"add": [], "boost": {}, "mute": False}
        text_lower = dialogue.lower()
        for keyword, mod in self.KEYWORD_MODIFIERS.items():
            if keyword.lower() in text_lower:
                if mod.get("mute"):
                    modifiers["mute"] = True
                for layer in mod.get("add", []):
                    modifiers["add"].append(dict(layer))
                for sound_type, boost in mod.get("boost", {}).items():
                    if sound_type not in modifiers["boost"]:
                        modifiers["boost"][sound_type] = {}
                    for k, v in boost.items():
                        modifiers["boost"][sound_type][k] = modifiers["boost"][sound_type].get(k, 0.0) + v
        return modifiers

    # ───────────────────────────────────────────────────────────────────────
    # Post-processing
    # ───────────────────────────────────────────────────────────────────────

    @staticmethod
    def _merge_same_type_events(events):
        """Merge adjacent/overlapping events of the same type."""
        if not events:
            return []
        by_type = {}
        for ev in events:
            t = ev["type"]
            by_type.setdefault(t, []).append(ev)

        merged = []
        for t, evs in by_type.items():
            evs.sort(key=lambda e: e["start"])
            current = dict(evs[0])
            for nxt in evs[1:]:
                # If overlap or gap < 0.5s, merge
                if nxt["start"] <= current["end"] + 0.5:
                    current["end"] = max(current["end"], nxt["end"])
                    # Average volume/intensity/density
                    current["volume"] = round((current.get("volume", 0.0) + nxt.get("volume", 0.0)) / 2, 4)
                    for key in ("intensity", "density"):
                        if key in current or key in nxt:
                            current[key] = round(
                                (current.get(key, 0.0) + nxt.get(key, 0.0)) / 2, 4
                            )
                else:
                    merged.append(current)
                    current = dict(nxt)
            merged.append(current)
        merged.sort(key=lambda e: e["start"])
        return merged

    @staticmethod
    def _clamp_duration(events, total_duration):
        """Ensure events do not exceed total_duration."""
        for ev in events:
            ev["start"] = max(0.0, min(ev["start"], total_duration))
            ev["end"] = max(ev["start"], min(ev["end"], total_duration))
        return events


# ─────────────────────────────────────────────────────────────────────────
# Helpers for the pipeline
# ─────────────────────────────────────────────────────────────────────────

def load_config(episode_dir):
    """Load config/ambient_config.json if present."""
    path = os.path.join(episode_dir, "config", "ambient_config.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def load_scene_contract(episode_dir):
    """Load optional scene semantic metadata from config/scene_contract.json."""
    path = os.path.join(episode_dir, "config", "scene_contract.json")
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[SemanticAmbient] Failed to load scene contract: {exc}")
        return {}


def analyze_story(episode_dir, story_text=None, total_duration=None):
    """
    Convenience entry point used by generate_audio.py.

    Args:
        episode_dir: path to the episode directory.
        story_text: optional pre-read script.story content.
        total_duration: optional total length in seconds.

    Returns:
        List of ambient event dicts.
    """
    config = load_config(episode_dir)
    scene_contract = load_scene_contract(episode_dir)
    if story_text is None:
        story_path = os.path.join(episode_dir, "script.story")
        if not os.path.exists(story_path):
            return []
        with open(story_path, "r", encoding="utf-8") as f:
            story_text = f.read()
    analyzer = SemanticAmbientAnalyzer(config, scene_contract=scene_contract)
    return analyzer.analyze(story_text, total_duration=total_duration)


# ─────────────────────────────────────────────────────────────────────────
# CLI for quick testing
# ─────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python semantic_ambient.py <episode_dir> [total_duration]")
        sys.exit(1)

    episode = sys.argv[1]
    duration = float(sys.argv[2]) if len(sys.argv) > 2 else None
    events = analyze_story(episode, total_duration=duration)
    print(json.dumps(events, indent=2, ensure_ascii=False))
