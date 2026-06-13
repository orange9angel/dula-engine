#!/usr/bin/env python3
"""
SmartScheduler - 通用智能时间线调度组件

整合两个调度策略：
1. DialogueScheduler: 防止对话音频重叠（原有功能）
2. ActionScheduler: 确保对话不会出现在关联动作完成之前

用法：
    python smart_scheduler.py <episode_path> [options]

选项：
    --apply           直接应用调整后的时间线到 script.story
    --min-gap N       对话最小间隔（默认 0.3s）
    --action-buffer N 动作完成后到对话的缓冲时间（默认 0.5s）
    --report          输出详细调度报告

输出：
    - script.story.scheduled  调整后的脚本（不覆盖原文件，除非 --apply）
    - scheduling_report.json  调度报告
"""

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple


def format_srt_time(seconds: float) -> str:
    """将秒数转换为 SRT 时间格式 HH:MM:SS,mmm"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds % 1) * 1000))
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


# ============ 数据模型 ============

@dataclass
class StoryEntry:
    """脚本条目"""
    index: int
    start_time: float
    end_time: float
    content: str
    character: Optional[str] = None
    dialogue: Optional[str] = None
    scene: Optional[str] = None
    events: List[Dict] = field(default_factory=list)
    animations: List[Dict] = field(default_factory=list)
    camera: Optional[Dict] = None
    music: Optional[Dict] = None
    sfx: Optional[Dict] = None
    positions: List[Dict] = field(default_factory=list)
    transition: Optional[Dict] = None


@dataclass
class ActionEvent:
    """动作事件"""
    entry_index: int
    event_type: str
    start_time: float
    duration: float
    params: Dict
    
    @property
    def end_time(self) -> float:
        return self.start_time + self.duration


@dataclass
class DialogueEvent:
    """对话事件"""
    entry_index: int
    character: str
    dialogue: str
    start_time: float
    end_time: float
    audio_duration: Optional[float] = None
    
    @property
    def audio_end_time(self) -> float:
        if self.audio_duration:
            return self.start_time + self.audio_duration
        return self.end_time


@dataclass
class ScheduleAdjustment:
    """调度调整记录"""
    entry_index: int
    reason: str
    old_start: float
    new_start: float
    shift: float
    details: str
    adjustment_type: str = "dialogue_overlap"  # 或 "action_blocking"


# ============ 脚本解析 ============

def parse_story(text: str) -> List[StoryEntry]:
    """解析 script.story 文件为结构化条目"""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    entries = []
    i = 0
    
    while i < len(lines):
        if lines[i].strip() == "":
            i += 1
            continue
        
        try:
            index = int(lines[i].strip())
        except ValueError:
            i += 1
            continue
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
            int(m.group(1)) * 3600 + int(m.group(2)) * 60 +
            int(m.group(3)) + int(m.group(4)) / 1000
        )
        end = (
            int(m.group(5)) * 3600 + int(m.group(6)) * 60 +
            int(m.group(7)) + int(m.group(8)) / 1000
        )
        
        content_lines = []
        while i < len(lines) and lines[i].strip() != "":
            content_lines.append(lines[i].rstrip())
            i += 1
        
        content = "\n".join(content_lines)
        entry = StoryEntry(index=index, start_time=start, end_time=end, content=content)
        
        # 场景
        scene_match = re.search(r"^@(\w+)", content, re.MULTILINE)
        if scene_match:
            entry.scene = scene_match.group(1)
        
        # 角色
        char_match = re.search(r"\[(\w+)\]", content)
        if char_match:
            entry.character = char_match.group(1)
        
        # 对话文本（清理标签）
        dialogue = content
        dialogue = re.sub(r"^@\w+\s*", "", dialogue, flags=re.MULTILINE)
        dialogue = re.sub(r"\[\w+\]\s*", "", dialogue)
        dialogue = re.sub(r"\{Camera:[^}]+\}\s*", "", dialogue)
        dialogue = re.sub(r"\{Music:[^}]+\}\s*", "", dialogue)
        dialogue = re.sub(r"\{Voice:[^}]+\}\s*", "", dialogue)
        dialogue = re.sub(r"\{SFX:[^}]+\}\s*", "", dialogue)
        dialogue = re.sub(r"\{Transition:[^}]+\}\s*", "", dialogue)
        dialogue = re.sub(r"\{Position:[^}]+\}\s*", "", dialogue)
        dialogue = re.sub(r"\{\w+\}\{\w+(?:\|[^}]+)?\}\s*", "", dialogue)
        dialogue = re.sub(r"\{\w+\|[^}]+\}\s*", "", dialogue)
        dialogue = re.sub(r"\{(?!\w+:)[\w]+\}\s*", "", dialogue).strip()
        entry.dialogue = dialogue if dialogue else None
        
        # Event 标签
        for ev in re.findall(r"\{Event:([^}]+)\}", content):
            parts = [p.strip() for p in ev.split("|")]
            event_type = parts[0]
            params = {}
            for p in parts[1:]:
                if "=" in p:
                    k, v = p.split("=", 1)
                    try:
                        params[k.strip()] = float(v.strip())
                    except ValueError:
                        params[k.strip()] = v.strip()
            entry.events.append({"type": event_type, "params": params})
        
        # Animation 标签（带角色）
        for char, anim_name, anim_params in re.findall(
            r"\{(\w+)\}\{(\w+)(?:\|([^}]+))?\}", content
        ):
            params = {"character": char, "name": anim_name}
            if anim_params:
                for p in anim_params.split("|"):
                    if "=" in p:
                        k, v = p.split("=", 1)
                        try:
                            params[k.strip()] = float(v.strip())
                        except ValueError:
                            params[k.strip()] = v.strip()
            entry.animations.append(params)
        
        # Camera
        cam_match = re.search(r"\{Camera:([^}]+)\}", content)
        if cam_match:
            parts = [p.strip() for p in cam_match.group(1).split("|")]
            params = {"type": parts[0]}
            for p in parts[1:]:
                if "=" in p:
                    k, v = p.split("=", 1)
                    try:
                        params[k.strip()] = float(v.strip())
                    except ValueError:
                        params[k.strip()] = v.strip()
            entry.camera = params
        
        entries.append(entry)
    
    return entries


def load_manifest(manifest_path: str) -> Dict:
    if not os.path.exists(manifest_path):
        return {"entries": []}
    with open(manifest_path, "r", encoding="utf-8") as f:
        return json.load(f)


# ============ 事件提取 ============

def extract_action_events(entries: List[StoryEntry]) -> List[ActionEvent]:
    """提取动作事件（HurdleRun, Move, Animation 等）"""
    actions = []
    natural_anims = {"Punch", "Kick", "SpinKick", "CrouchJump", "Hook", "Uppercut",
                     "BoxerGuardHop", "SpiritSwordSwing", "SpiritGunFire",
                     "DashForward", "JumpAttack", "HitStagger", "Knockdown"}
    
    for entry in entries:
        for ev in entry.events:
            if ev["type"] in ("HurdleRun", "Move"):
                params = ev["params"]
                duration = params.get("duration", 2.0)
                actions.append(ActionEvent(
                    entry.index, ev["type"], entry.start_time, duration, params
                ))
        
        for anim in entry.animations:
            name = anim.get("name", "")
            if name in natural_anims:
                duration = anim.get("duration", 1.0)
                actions.append(ActionEvent(
                    entry.index, "Animation", entry.start_time, duration, anim
                ))
    
    return actions


def extract_dialogue_events(entries: List[StoryEntry], manifest: Dict) -> List[DialogueEvent]:
    """提取对话事件，关联音频时长"""
    dialogues = []
    manifest_map = {e["index"]: e for e in manifest.get("entries", [])}
    
    for entry in entries:
        if entry.character and entry.dialogue:
            audio_dur = None
            if entry.index in manifest_map:
                audio_dur = manifest_map[entry.index].get("audioDuration")
            
            dialogues.append(DialogueEvent(
                entry.index, entry.character, entry.dialogue,
                entry.start_time, entry.end_time, audio_dur
            ))
    
    return dialogues


# ============ 调度策略 ============

def schedule_dialogues(dialogues: List[DialogueEvent], min_gap: float = 0.3) -> Tuple[Dict[int, float], List[ScheduleAdjustment]]:
    """
    策略1: 防止对话音频重叠。
    返回: (entry_index -> new_start_time, adjustments)
    """
    shifts = {}
    adjustments = []
    sorted_d = sorted(dialogues, key=lambda d: d.start_time)
    
    for i in range(1, len(sorted_d)):
        prev = sorted_d[i - 1]
        curr = sorted_d[i]
        
        prev_audio_end = prev.audio_end_time
        earliest = prev_audio_end + min_gap
        
        if curr.start_time < earliest:
            old_start = curr.start_time
            new_start = round(earliest, 3)
            shift = round(new_start - old_start, 3)
            
            if curr.entry_index not in shifts:
                shifts[curr.entry_index] = new_start
            else:
                shifts[curr.entry_index] = max(shifts[curr.entry_index], new_start)
            
            adjustments.append(ScheduleAdjustment(
                entry_index=curr.entry_index,
                reason=f"避免与前对话重叠 (前音频结束于 {prev_audio_end:.2f}s)",
                old_start=old_start,
                new_start=new_start,
                shift=shift,
                details=f"[{curr.character}] 对话需要延后 {shift:.2f}s",
                adjustment_type="dialogue_overlap"
            ))
    
    return shifts, adjustments


def schedule_actions(
    dialogues: List[DialogueEvent],
    actions: List[ActionEvent],
    entries: List[StoryEntry],
    action_buffer: float = 0.5
) -> Tuple[Dict[int, float], List[ScheduleAdjustment]]:
    """
    策略2: 确保对话不会出现在关联动作完成之前。
    
    检测场景：
    - 场景切换前有大段动作（如 HurdleRun），切换后的对话必须等动作完成
    - 同一场景内，对话不能打断正在进行的动作
    
    返回: (entry_index -> new_start_time, adjustments)
    """
    shifts = {}
    adjustments = []
    
    # 找每个对话之前的场景切换
    for dialogue in dialogues:
        dialogue_entry = next((e for e in entries if e.index == dialogue.entry_index), None)
        if not dialogue_entry:
            continue
        
        # 找最近的场景切换
        prev_scene = None
        for e in entries:
            if e.scene and e.start_time < dialogue.start_time:
                if prev_scene is None or e.start_time > prev_scene.start_time:
                    prev_scene = e
        
        if not prev_scene:
            continue
        
        # 找场景切换前开始、但切换时仍未完成的动作
        blocking_actions = []
        for action in actions:
            if action.start_time < prev_scene.start_time and action.end_time > prev_scene.start_time:
                blocking_actions.append(action)
        
        if not blocking_actions:
            continue
        
        latest_end = max(a.end_time for a in blocking_actions)
        required_start = latest_end + action_buffer
        
        if dialogue.start_time < required_start - 0.01:
            old_start = dialogue.start_time
            new_start = round(required_start, 3)
            shift = round(new_start - old_start, 3)
            
            if dialogue.entry_index not in shifts:
                shifts[dialogue.entry_index] = new_start
            else:
                shifts[dialogue.entry_index] = max(shifts[dialogue.entry_index], new_start)
            
            action_names = ", ".join(set(a.event_type for a in blocking_actions))
            adjustments.append(ScheduleAdjustment(
                entry_index=dialogue.entry_index,
                reason=f"场景切换前动作未完成 ({action_names} 完成于 {latest_end:.2f}s)",
                old_start=old_start,
                new_start=new_start,
                shift=shift,
                details=f"[{dialogue.character}] '{dialogue.dialogue[:30]}...' 需要延后 {shift:.2f}s，等待动作完成",
                adjustment_type="action_blocking"
            ))
    
    return shifts, adjustments


# ============ 应用调整 ============

def apply_shifts(
    entries: List[StoryEntry],
    dialogue_shifts: Dict[int, float],
    action_shifts: Dict[int, float]
) -> List[StoryEntry]:
    """合并两种调度策略的调整，应用到所有条目"""
    
    # 合并 shifts：取最大值
    all_shifts = {}
    for idx, new_start in {**dialogue_shifts, **action_shifts}.items():
        all_shifts[idx] = max(all_shifts.get(idx, 0), new_start)
    
    if not all_shifts:
        return entries
    
    # 计算累积偏移
    adjusted = []
    cumulative_shift = 0.0
    last_shifted_idx = 0
    
    for entry in entries:
        new_entry = StoryEntry(
            index=entry.index,
            start_time=entry.start_time,
            end_time=entry.end_time,
            content=entry.content,
            character=entry.character,
            dialogue=entry.dialogue,
            scene=entry.scene,
            events=entry.events,
            animations=entry.animations,
            camera=entry.camera,
            music=entry.music,
            sfx=entry.sfx,
            positions=entry.positions,
            transition=entry.transition,
        )
        
        if entry.index in all_shifts:
            target = all_shifts[entry.index]
            shift = target - entry.start_time
            if shift > cumulative_shift:
                cumulative_shift = shift
                last_shifted_idx = entry.index
        
        if entry.index >= last_shifted_idx:
            new_entry.start_time += cumulative_shift
            new_entry.end_time += cumulative_shift
        
        adjusted.append(new_entry)
    
    return adjusted


def generate_story_file(entries: List[StoryEntry]) -> str:
    """生成 script.story 格式的文本"""
    lines = []
    for entry in entries:
        lines.append(str(entry.index))
        lines.append(f"{format_srt_time(entry.start_time)} --> {format_srt_time(entry.end_time)}")
        lines.append(entry.content)
        lines.append("")
    return "\n".join(lines)


def generate_report(adjustments: List[ScheduleAdjustment], output_path: str) -> Dict:
    report = {
        "total_adjustments": len(adjustments),
        "total_shift_time": sum(a.shift for a in adjustments),
        "by_type": {
            "dialogue_overlap": len([a for a in adjustments if a.adjustment_type == "dialogue_overlap"]),
            "action_blocking": len([a for a in adjustments if a.adjustment_type == "action_blocking"]),
        },
        "adjustments": [
            {
                "entry_index": a.entry_index,
                "type": a.adjustment_type,
                "reason": a.reason,
                "old_start": round(a.old_start, 3),
                "new_start": round(a.new_start, 3),
                "shift": round(a.shift, 3),
                "details": a.details,
            }
            for a in adjustments
        ]
    }
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    return report


# ============ 主函数 ============

def main():
    parser = argparse.ArgumentParser(description="SmartScheduler - 智能时间线调度")
    parser.add_argument("episode", help="Episode 目录路径")
    parser.add_argument("--apply", action="store_true", help="直接应用调整后的时间线")
    parser.add_argument("--min-gap", type=float, default=0.3, help="对话最小间隔（秒）")
    parser.add_argument("--action-buffer", type=float, default=0.5, help="动作完成后缓冲时间（秒）")
    parser.add_argument("--report", action="store_true", help="输出详细报告")
    args = parser.parse_args()
    
    episode = args.episode
    if not os.path.isabs(episode):
        episode = os.path.join(os.getcwd(), episode)
    
    story_path = os.path.join(episode, "script.story")
    manifest_path = os.path.join(episode, "assets", "audio", "manifest.json")
    output_story = os.path.join(episode, "script.story.scheduled")
    report_path = os.path.join(episode, "scheduling_report.json")
    
    print("=" * 60)
    print("SmartScheduler - 智能时间线调度")
    print("=" * 60)
    print(f"Episode: {episode}")
    print(f"对话最小间隔: {args.min_gap}s")
    print(f"动作缓冲时间: {args.action_buffer}s")
    
    # 读取脚本
    if not os.path.exists(story_path):
        print(f"错误: 找不到脚本文件 {story_path}")
        sys.exit(1)
    
    with open(story_path, "r", encoding="utf-8") as f:
        story_text = f.read()
    
    entries = parse_story(story_text)
    print(f"\n📄 已解析 {len(entries)} 个脚本条目")
    
    # 加载音频 manifest
    manifest = load_manifest(manifest_path)
    manifest_entries = manifest.get("entries", [])
    print(f"🎵 已加载 {len(manifest_entries)} 个音频条目")
    
    # 提取事件
    actions = extract_action_events(entries)
    dialogues = extract_dialogue_events(entries, manifest)
    
    print(f"\n🏃 发现 {len(actions)} 个动作事件")
    print(f"💬 发现 {len(dialogues)} 个对话事件")
    
    # 执行两种调度策略
    print(f"\n{'=' * 60}")
    print("开始智能调度...")
    print(f"{'=' * 60}")
    
    # 策略1: 防止对话重叠
    dialogue_shifts, dialogue_adjs = schedule_dialogues(dialogues, args.min_gap)
    if dialogue_adjs:
        print(f"\n[策略1] 对话防重叠: {len(dialogue_adjs)} 处调整")
        for a in dialogue_adjs:
            print(f"  Entry {a.entry_index}: +{a.shift:.2f}s - {a.reason}")
    
    # 策略2: 动作-对话依赖
    action_shifts, action_adjs = schedule_actions(
        dialogues, actions, entries, args.action_buffer
    )
    if action_adjs:
        print(f"\n[策略2] 动作-对话依赖: {len(action_adjs)} 处调整")
        for a in action_adjs:
            print(f"  Entry {a.entry_index}: +{a.shift:.2f}s - {a.reason}")
    
    all_adjustments = dialogue_adjs + action_adjs
    
    # 应用调整
    if all_adjustments:
        adjusted_entries = apply_shifts(entries, dialogue_shifts, action_shifts)
        
        # 生成调整后的脚本
        new_story = generate_story_file(adjusted_entries)
        with open(output_story, "w", encoding="utf-8") as f:
            f.write(new_story)
        
        # 生成报告
        report = generate_report(all_adjustments, report_path)
        
        print(f"\n{'=' * 60}")
        print("✅ 调度完成!")
        print(f"{'=' * 60}")
        print(f"\n总调整: {report['total_adjustments']} 处")
        print(f"  - 对话防重叠: {report['by_type']['dialogue_overlap']} 处")
        print(f"  - 动作-对话依赖: {report['by_type']['action_blocking']} 处")
        print(f"总延后时间: {report['total_shift_time']:.2f}s")
        print(f"\n输出文件:")
        print(f"  📄 {output_story}")
        print(f"  📊 {report_path}")
        
        if args.apply:
            # 备份原文件
            backup = story_path + ".backup"
            import shutil
            shutil.copy2(story_path, backup)
            shutil.copy2(output_story, story_path)
            print(f"\n✅ 已应用调整:")
            print(f"  原文件备份: {backup}")
            print(f"  脚本已更新: {story_path}")
            print(f"\n下一步: 重新生成音频并渲染")
        else:
            print(f"\n使用方式:")
            print(f"  1. 检查调整后的脚本: {output_story}")
            print(f"  2. 确认无误后应用: python smart_scheduler.py {episode} --apply")
    else:
        print(f"\n✅ 时间线无需调整，所有对话和动作都已正确对齐!")


if __name__ == "__main__":
    main()
