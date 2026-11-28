# Get It Back, 60-second cut and first Table Read: Prime handoff

For a Claude session running **on Prime** (Windows HP, Blender 5.3), opened in this repository's checkout on branch `claude/ecstatic-bell-ispdcf`. The cloud session that wrote this could not reach Prime's files. Everything here that touches Prime is untested on Prime. The tools were tested in the cloud on synthetic and recorded inputs (see `docs/creator/TABLE-READ.md` → Results).

Paste the block below into the Prime session as its prompt.

---

You are finishing the Get It Back episode on Prime. Read `AGENTS.md`, `docs/creator/TABLE-READ.md` and this file first. Work in PowerShell. **Never overwrite** `get-it-back_full.blend`, `proof_phone_call.blend`, `timeline.json`, the lyric JSON, the audio, or anything under the Creator Suite folder. Write new files beside them.

## 0. Read only: what is really on this machine

Report every result before you change anything.

```powershell
$P = "$env:LOCALAPPDATA\McCluster\Productions\get-it-back"
$HQ = "C:\Users\Mattm\Documents\Equity Uprise Show\HQ Blender Studio"
$CS = "C:\Users\Mattm\AppData\Local\Packages\AnthropicPBC.Claude_fnn82j28hfe8t\LocalCache\Local\McClusterDesktop\studio"
$paths = "$P\HANDOFF-PROMPT.md","$P\timeline.json","$P\blend\get-it-back_full.blend","$P\blend\proof_phone_call.blend","$P\lyrics\get-it-back.lyrics.json",
         "C:\Users\Mattm\Downloads\Get It Back.m4a","$HQ\Equity Uprise HQ.blend","$HQ\References\HQ Interior Concept v2",
         "$HQ\Episodes\Get It Back - The Call From Dave - Executive Suite Cutscene.md","$CS\sp_1779260659ba\master.blend","$CS\sp_1779260659ba\drama.mp4","$CS\sp_fb139f721847"
$paths | ForEach-Object { [pscustomobject]@{ Path = $_; Exists = Test-Path -LiteralPath $_ } } | Format-Table -AutoSize
Get-Process blender -ErrorAction SilentlyContinue | Select-Object Id, MainWindowTitle, StartTime
```

- **Stop and tell Matthew** if Blender is open and its title shows an unsaved file (`*`), or names a file that is not one of the above (that may be the unsaved interior rebuild). Do not close, save or touch it.
- Read `HANDOFF-PROMPT.md` and `timeline.json` in full. Where they disagree with this file, they win on content (scenes, frames, what was already rendered); this file wins on safety (no overwrites, scratch labels, no violence on screen).
- Find the proof MP4 that "was incomplete at last check" (`Get-ChildItem $P -Recurse -Filter *.mp4`) and check it with `ffprobe -v error -show_entries format=duration:stream=codec_type,width,height -of compact <file>`. A `moov atom not found` means it was cut off; it will be replaced by step 5's output, not repaired.
- The HQ interior references are mcclusterishere/mccluster#871 (Floor 6 Core v2 plan; the Halo Globe stays suspended). Those images are references, never geometry authority.

## 1. Tools, only what is missing

```powershell
py -m pip list 2>$null | Select-String "mediapipe|opencv|numpy|faster-whisper|ctranslate2"
ffmpeg -version | Select-Object -First 1
```

Install only what is absent, and tell Matthew the sizes first (`docs/creator/TABLE-READ.md` → Downloads): `py -m pip install mediapipe` (≈ 112 MB with OpenCV), plus `face_landmarker.task` (3.76 MB) into `$P\models\`. faster-whisper `base.en` (≈ 220 MB) is optional. If the download stays blocked, use the recovered draft timings in the lyric JSON as they are. Keep video-generation models out.

## 2. Lyrics: review, do not overwrite

```powershell
# optional, if faster-whisper is installed: words heard, CPU int8
py core\src\lyrics\asr_faster_whisper.py "C:\Users\Mattm\Downloads\Get It Back.m4a" --model base.en --compute-type int8 > "$P\lyrics\get-it-back.asr.json"
py tools\get-it-back\review_lyrics.py "$P\lyrics\get-it-back.lyrics.json" --asr "$P\lyrics\get-it-back.asr.json" --out "$P\lyrics\get-it-back.review.md" --apply "$P\lyrics\get-it-back.lyrics.reviewed.json"
```

Without the ASR file, drop `--asr`: the confirmed wording is still checked ("send it stat", "definitely getting hacked for that", "My pole a ghost"), and no word is called unclear without audio evidence. Show Matthew the `[?word]` marks. He confirms by ear; nobody guesses lyrics.

## 3. Scratch dialogue, clearly labelled

Build `$P\audio\lines.json` from the episode script (`Episodes\Get It Back - The Call From Dave - Executive Suite Cutscene.md`), only the 20-second rehab call. The one owner-confirmed line is Dave's "I'm a whole new man, man." Take the rest verbatim from the script; write no new dialogue. Then:

```powershell
powershell -ExecutionPolicy Bypass -File tools\get-it-back\scratch_voice.ps1 -Lines "$P\audio\lines.json" -OutDir "$P\audio"
```

Every file is `SCRATCH_<id>.wav`, made with a stock Windows voice. Nobody's voice is cloned.

## 4. The cut list

Copy `tools\get-it-back\cut-60s.template.json` to `$P\cut-60s.json`. Replace every `FILL_FROM_TIMELINE` with a scene, camera and frame range from `timeline.json` and the scenes in `get-it-back_full.blend`, keeping the brief:

- **0:00–0:40, about 40 s, on the song**: Matthew smiling and vibing in his suite, the RV, the fictional Sick Filet, consequences after Dave acted on his own (aftermath only, **no violence on screen**), Dave behind glass, the wrong Acura in Waterbury. Pick `song.source_in_s` so the reviewed hook lands in this stretch.
- **0:40–1:00, about 20 s**: present day. Dave calls from rehab and says "I'm a whole new man, man." Matthew shows amused nostalgia, then genuine interest in how Dave is doing.

The phone-call shots live in `proof_phone_call.blend` (Floor 6 Core v2, Halo). Bring that scene into a **working copy** of the full file, never the original:

```powershell
Copy-Item "$P\blend\get-it-back_full.blend" "$P\blend\get-it-back_60s_work.blend"
blender "$P\blend\get-it-back_60s_work.blend" -b --python tools\get-it-back\append_scenes.py -- --from "$P\blend\proof_phone_call.blend"
```

## 5. Render the 60-second cut

```powershell
blender "$P\blend\get-it-back_60s_work.blend" -b --python tools\get-it-back\conform_cut.py -- `
  --cut "$P\cut-60s.json" --out "$P\final\get-it-back_60s_720x1280.mp4" --save "$P\blend\get-it-back_60s.blend"
```

It refuses a scene name it cannot find, and prints `problems` and `warnings` (for example, dialogue running past the end). The source scenes' own render engines are used (EEVEE or Cycles as set in the full file).

## 6. Verify playback

```powershell
$F = "$P\final\get-it-back_60s_720x1280.mp4"
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height:format=duration -of compact $F
ffmpeg -v error -i $F -vf "fps=1/5,scale=180:-1,tile=6x2" -frames:v 1 "$P\final\contact-sheet.png"
Start-Process $F
```

Pass means: 720×1280 H.264, an AAC stream, 58–62 s, the contact sheet shows every shot in order, the song is ducked under dialogue, "SCRATCH AUDIO" shows during every scratch line, and Dave's line lands where `<out>.report.json` says. Watch it once through with sound.

## 7. Make it visible in Creator Suite (ask first)

Creator Suite's source is not in any repository the cloud session could read. Before writing anything there, read how it lists projects: list `$CS`, open `sp_1779260659ba` (it holds `master.blend` and `drama.mp4`) and any index or manifest file beside the `sp_*` folders. Then **ask Matthew** before creating a project for Get It Back. If the Suite discovers projects by that folder layout, the project is a new `sp_<id>` with `master.blend` (a copy of `get-it-back_60s.blend`) and `drama.mp4` (a copy of the final MP4). Do not edit the existing `sp_*` folders.

## 8. First Table Read: Dave's rehab call

Live rooms need the Worker (`TABLE_READ_ENABLED`, `TABLE_READ_PASS_KEY`, a TURN choice). Those are owner-approved deploy steps (`docs/creator/TABLE-READ.md` → Release gates). Phones need HTTPS, so the local relay alone cannot serve them. Once rooms are live:

1. On Prime open `https://<platform>/table-read.html`. Load the rehab-call lines (`DAVE:` / `MATTHEW:` from the episode script). Tick "I'm on camera too" only if Matthew reads from Prime. Send the two role links to the two phones.
2. Read with the scroll off. Pause once on purpose and let the reaction play. Use **Sync cue** at the start and the end of the take, and have each actor clap on the white flash. **Ask consent**, **Record take**, **Stop take**.
3. Each phone taps **Send to host** (or **Export**, then copy the files to Prime). On the host tap **Export** for each received take and **Export session**. Put everything in `$P\tableread\take-1\`.
4. Align, curves, Blender:

```powershell
py tools\table-read\prime\align_takes.py "$P\tableread\take-1"
Get-ChildItem "$P\tableread\take-1\*.webm","$P\tableread\take-1\*.mp4" | ForEach-Object { py tools\table-read\prime\face_curves.py $_.FullName --model "$P\models\face_landmarker.task" --smooth 0.3 }
blender "$P\blend\proof_phone_call.blend" -b --python tools\table-read\prime\blender_table_read.py -- `
  --alignment "$P\tableread\take-1\aligned\alignment.json" `
  --curves DAVE="$P\tableread\take-1\<dave>.curves.json" --curves MATTHEW="$P\tableread\take-1\<matthew>.curves.json" `
  [--rig DAVE=<approved object> --rig MATTHEW=<approved object>] --engine EEVEE `
  --out "$P\tableread\render" --save "$P\tableread\render\table_read.blend"
```

Name an approved rig only if Matthew confirms it is approved. Otherwise the clearly labelled stand-ins are used. The rig is copied; the original in `proof_phone_call.blend` is never changed. Shape keys named like MediaPipe's blendshapes (`jawOpen`, `eyeBlinkLeft`, …) are driven; the report lists which ones matched.

5. Retake one line (a new short Table Read that starts on that line, into `take-1-retake\`), then re-render only that shot:

```powershell
py tools\table-read\prime\align_takes.py "$P\tableread\take-1-retake"
blender "$P\tableread\render\table_read.blend" -b --python tools\table-read\prime\blender_table_read.py -- `
  --patch "$P\tableread\take-1-retake\aligned\alignment.json" --patch-curves DAVE="<retake dave>.curves.json" `
  --shot line-NNN --out "$P\tableread\render" --save "$P\tableread\render\table_read.blend"
```

Output: `shot_line-NNN.mp4` (that shot alone) and `proof_retake_line-NNN.mp4` (spliced).

## 9. Report back

Report the real paths, the `ffprobe` lines, the contact sheet, the lyric review summary (unclear words), the conform report's problems and warnings, what was skipped and why, and anything you stopped to ask about.
