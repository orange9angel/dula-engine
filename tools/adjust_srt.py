import os
import re
import subprocess
import sys

ROOT = os.path.join(os.path.dirname(__file__), '..')
EPISODE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'content', 'episodes', 'bichong_qiupai')
if not os.path.isabs(EPISODE):
    EPISODE = os.path.join(ROOT, EPISODE)

STORY_PATH = os.path.join(EPISODE, 'script.story')
AUDIO_DIR = os.path.join(EPISODE, 'assets', 'audio')

def parse_story(path):
    with open(path, 'r', encoding='utf-8') as f:
        text = f.read()
    lines = text.replace('\r\n', '\n').replace('\r', '\n').split('\n')
    entries = []
    i = 0
    while i < len(lines):
        if lines[i].strip() == '':
            i += 1
            continue
        idx = int(lines[i].strip())
        i += 1
        if i >= len(lines):
            break
        m = re.match(r'(\d{2}):(\d{2}):(\d{2}),(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2}),(\d{3})', lines[i].strip())
        i += 1
        if not m:
            continue
        content_lines = []
        while i < len(lines) and lines[i].strip() != '':
            content_lines.append(lines[i].strip())
            i += 1
        content = '\n'.join(content_lines)
        entries.append({
            'index': idx,
            'content': content,
            'scene': re.search(r'^@(\w+)', content),
            'character': re.search(r'\[(\w+)\]', content),
        })
    return entries

def get_mp3_duration(mp3_path):
    result = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', mp3_path],
        capture_output=True, text=True
    )
    return float(result.stdout.strip())

def format_time(t):
    hours = int(t // 3600)
    minutes = int((t % 3600) // 60)
    seconds = int(t % 60)
    millis = int(round((t % 1) * 1000))
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"

def main():
    entries = parse_story(STORY_PATH)
    current_time = 0.0
    gap = 0.4  # silence gap between lines
    scene_gap = 1.5  # extra time for scene transitions
    new_entries = []

    for i, e in enumerate(entries):
        is_scene = bool(e['scene'])
        char = e['character'].group(1) if e['character'] else None

        if is_scene:
            # Scene marker: allocate a short window for transition
            duration = 1.5
            new_entries.append({
                'index': len(new_entries) + 1,
                'start': current_time,
                'end': current_time + duration,
                'content': e['content'],
            })
            current_time += duration + scene_gap
        else:
            mp3 = os.path.join(AUDIO_DIR, f"{str(e['index']).zfill(3)}_{char}.mp3")
            if os.path.exists(mp3):
                audio_dur = get_mp3_duration(mp3)
            else:
                # Estimate ~0.25s per char if no MP3 yet
                text = re.sub(r"\[\w+\]", "", e['content'])
                text = re.sub(r"\{\w+\}", "", text)
                audio_dur = max(1.0, len(text) * 0.25)

            # Ensure minimum visual duration
            duration = max(audio_dur + 0.3, 2.0)
            new_entries.append({
                'index': len(new_entries) + 1,
                'start': current_time,
                'end': current_time + duration,
                'content': e['content'],
            })
            current_time += duration + gap

    # Write new SRT
    lines = []
    for e in new_entries:
        lines.append(str(e['index']))
        lines.append(f"{format_time(e['start'])} --> {format_time(e['end'])}")
        lines.append(e['content'])
        lines.append('')

    with open(STORY_PATH, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    print(f"Adjusted story written to {STORY_PATH}")
    print(f"Total duration: {format_time(current_time)}")

if __name__ == '__main__':
    main()
