#!/usr/bin/env python3
"""Generate only SFX + BGM audio, skip dialogue/TTS."""

import sys
import os

# Add tools dir to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import generate_audio as ga

# Override global paths in generate_audio module
EPISODE = r'D:\opensource\movie\dula-story\episodes\yuyuhakusho'
ga.EPISODE = EPISODE
ga.OUTPUT_DIR = os.path.join(EPISODE, 'assets', 'audio')
ga.STORY_PATH = os.path.join(EPISODE, 'script.story')
ga.MANIFEST_PATH = os.path.join(ga.OUTPUT_DIR, 'manifest.json')
ga.SFX_DIR = os.path.join(ga.OUTPUT_DIR, 'sfx')

with open(ga.STORY_PATH, 'r', encoding='utf-8') as f:
    story_text = f.read()

entries, music_cues, story_events = ga.parse_story(story_text)
print(f'Parsed {len(entries)} entries, {len(music_cues)} music cues, {len(story_events)} story events')

# Discover manual SFX
manual_sfx = ga.discover_manual_sfx()
print(f'Manual SFX: {list(manual_sfx.keys())}')

# Schedule SFX from story events
scheduled_sfx = ga.schedule_sfx_from_events(story_events, manual_sfx)
print(f'Scheduled {len(scheduled_sfx)} SFX events:')
for s in scheduled_sfx:
    print(f'  - {os.path.basename(s["file"])} @ {s["startTime"]:.2f}s')

# Mix BGM
max_time = max(e['endTime'] for e in entries) if entries else 70.0
bgm_path = None
if music_cues:
    cues = []
    for cue in music_cues:
        opts = cue['options']
        cues.append({
            'name': opts.get('name', 'theme'),
            'startTime': cue['startTime'],
            'endTime': opts.get('endTime', max_time),
            'fadeIn': opts.get('fadeIn', 1.0),
            'fadeOut': opts.get('fadeOut', 1.0),
            'baseVolume': opts.get('baseVolume', 0.5),
        })
    if ga.check_bgm_files(cues):
        bgm_path = ga.mix_bgm_track(cues, entries, max_time + 1.0)
    else:
        print('Skipping BGM mix - files missing.')

# Mix audio (no dialogue entries)
manifest = {'entries': []}
ga.mix_audio(manifest, bgm_path, scheduled_sfx if scheduled_sfx else None)
print('Done!')
