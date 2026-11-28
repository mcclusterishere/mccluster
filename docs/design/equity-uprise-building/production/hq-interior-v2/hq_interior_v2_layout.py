"""Equity Uprise HQ Interior v2 — per-floor placement layout (feet, Core V2 frame).

Frame: origin SW exterior corner, +X east, +Y north, Z up; z is floor-relative (AFF).
rot: degrees about Z; 0 = the item's front faces south (-Y), 90 = east, 180 = north, -90 = west.

Two kinds of rows:
- `csv`   — one of the 52 approved anchors in references/hq-interior-concept-v2/asset-map.csv.
            Position and envelope come from the CSV row (the build reads them from the anchors the
            pack's own place-asset-proxies.py creates); only rot/kit/dressing are added here.
- `board` — dressing read from the approved GPT Image board for that floor (and, where noted, the
            prior builder inventory). Positions are INFERRED by this build and are listed in the
            delivery report. They never move walls, cores, doors or program zones.

NOT FOR CONSTRUCTION.
"""

FLOOR_NAMES = {
    1: "Arrival_Intake", 2: "Public_Forum", 3: "Fellowship_Network", 4: "Media_Culture",
    5: "Policy_Proof", 6: "Executive_Command", 7: "Roof_Mobility",
}

# finish palettes (instancer custom properties) — README: oak F1, terracotta F2, teal F3,
# walnut + burgundy felt F4, olive/gray F5, smoked glass + dark stone F6, galvanized F7.
PALETTE = {
    1: dict(wood="#B8875A", fabric="#4F5B3A", stone="#E6DFD2", accent="#3F4A30", metallic=0.0, rug="#B9A887"),
    2: dict(wood="#B98A5C", fabric="#8C4027", stone="#E3DCD0", accent="#9C7148", metallic=0.0, rug="#8E4C36"),
    3: dict(wood="#6A4630", fabric="#2C5A59", stone="#D9D4CA", accent="#23403F", metallic=0.0, rug="#3E4A48"),
    4: dict(wood="#5B3B26", fabric="#4E1620", stone="#D8CFC2", accent="#3A2A24", metallic=0.0, rug="#5A2128"),
    5: dict(wood="#A77E55", fabric="#6B7046", stone="#D8D2C4", accent="#5F6650", metallic=0.0, rug="#6E7154"),
    6: dict(wood="#3F2A1E", fabric="#4F2F1E", stone="#2E2C2B", accent="#B08A4E", metallic=1.0, rug="#4A4440"),
    7: dict(wood="#8A6A4A", fabric="#6A6A66", stone="#9C9890", accent="#9AA0A3", metallic=1.0, rug="#6A6A66"),
}

BOUCLE = "#E9E3D8"
CREAM = "#D9CDB8"
LEATHER_BROWN = "#5A3A2C"


def _desk(rows, tag, kit, x, y, rot=0, chair="CHAIR_TASK", screen=None, lamp=False, plant=False,
          source="board", note="", w=4.0, d=2.0, **kw):
    """A work surface with its chair (user side = desk front) and optional desktop equipment."""
    import math
    rows.append(dict(tag=tag, kit=kit, x=x, y=y, rot=rot, source=source, note=note, **kw))
    fx, fy = math.sin(math.radians(rot)), -math.cos(math.radians(rot))   # front (user side) unit
    if chair:
        rows.append(dict(tag=tag + "/chair", kit=chair, x=round(x + fx * (d / 2 + 0.75), 2),
                         y=round(y + fy * (d / 2 + 0.75), 2), rot=rot + 180, source="board",
                         note="seat for " + tag))
    if screen:
        bx, by = -fx * 0.25, -fy * 0.25
        rows.append(dict(tag=tag + "/screen", kit=screen, x=round(x + bx, 2), y=round(y + by, 2), z=2.5,
                         rot=rot, source="board", note="desktop equipment for " + tag))
    if lamp:
        rows.append(dict(tag=tag + "/lamp", kit="LAMP_DESK", x=round(x - math.cos(math.radians(rot)) * (w / 2 - 0.45) - fx * 0.2, 2),
                         y=round(y - math.sin(math.radians(rot)) * (w / 2 - 0.45) - fy * 0.2, 2), z=2.5, rot=rot,
                         source="board", note="task light for " + tag))
    if plant:
        rows.append(dict(tag=tag + "/plant", kit="PLANT_DESK", x=round(x + math.cos(math.radians(rot)) * (w / 2 - 0.4), 2),
                         y=round(y + math.sin(math.radians(rot)) * (w / 2 - 0.4) - fy * 0.3, 2), z=2.5, rot=0,
                         source="board", note="desk plant for " + tag))


def _ring(rows, tag, cx, cy, a, b, n, kit="CHAIR_SIDE", start=0.0):
    import math
    for i in range(n):
        t = math.radians(start + i * 360.0 / n)
        x, y = cx + a * math.cos(t), cy + b * math.sin(t)
        # chair faces the table centre: front direction = (cx-x, cy-y)
        rot = math.degrees(math.atan2(cx - x, -(cy - y)))
        rows.append(dict(tag=f"{tag}/seat{i + 1:02d}", kit=kit, x=round(x, 2), y=round(y, 2), rot=round(rot, 1),
                         source="board", note="seat at " + tag))


def _line(rows, tag, xs, y, rot, kit="CHAIR_SIDE", **kw):
    for i, x in enumerate(xs):
        rows.append(dict(tag=f"{tag}/{i + 1:02d}", kit=kit, x=x, y=y, rot=rot, source="board", note="seat at " + tag, **kw))


def floor_rows(f):
    R = []
    if f == 1:
        R.append(dict(tag="1.1", kit="RECEPTION_COUNTER", rot=0, source="csv"))
        _line(R, "1.1", [34.0, 38.0], 47.45, 0, kit="CHAIR_TASK")
        R += [dict(tag="1.1/screen1", kit="MONITOR", x=34.0, y=46.75, z=2.55, rot=180, source="board", note="staff monitor"),
              dict(tag="1.1/screen2", kit="MONITOR", x=38.0, y=46.75, z=2.55, rot=180, source="board", note="badge/access monitor"),
              dict(tag="1.1/lamp", kit="LAMP_DESK", x=40.4, y=44.9, z=3.5, rot=0, source="board", note="counter lamp"),
              dict(tag="1.1/plant", kit="PLANT_DESK", x=31.8, y=44.9, z=3.5, rot=0, source="board", note="counter plant")]
        _desk(R, "1.2", "PASSPORT_STATION", 30, 37, 0, screen="MONITOR", source="csv", w=5, d=2.5)
        _desk(R, "S1.1", "PASSPORT_STATION", 36.5, 37, 0, screen="MONITOR", plant=True, w=5, d=2.5,
              note="second passport station: board shows a row of stations; prior inventory had three passport kiosks")
        _desk(R, "1.3", "WORKPOINT_5x2.5", 43, 37, 0, screen="LAPTOP", lamp=True, source="csv", w=5, d=2.5)
        R.append(dict(tag="1.4", kit="LOUNGE_BANQUETTE", rot=180, source="csv"))
        R += [dict(tag="S1.2", kit="CAFE_TABLE", x=6.5, y=19.7, rot=0, source="board", note="orientation cafe table"),
              dict(tag="S1.3", kit="CAFE_TABLE", x=11.5, y=19.7, rot=0, source="board", note="orientation cafe table"),
              dict(tag="S1.4", kit="POUF", x=6.5, y=22.3, rot=0, source="board", note="olive pouf"),
              dict(tag="S1.5", kit="POUF", x=11.5, y=22.3, rot=0, source="board", note="olive pouf"),
              dict(tag="S1.6", kit="CHAIR_LOUNGE_ROUND", x=5.0, y=25.6, rot=0, fabric=BOUCLE, source="board", note="boucle armchair"),
              dict(tag="S1.7", kit="CHAIR_LOUNGE_ROUND", x=10.0, y=25.6, rot=0, fabric=BOUCLE, source="board", note="boucle armchair"),
              dict(tag="S1.8", kit="SIDE_TABLE", x=7.5, y=25.6, rot=0, source="board", note="lounge side table"),
              dict(tag="S1.9", kit="PLANT_FLOOR", x=3.4, y=14.0, rot=0, source="board", note="lounge plant"),
              dict(tag="S1.10", kit="LAMP_FLOOR", x=15.6, y=16.6, rot=0, source="board", note="lounge floor lamp"),
              dict(tag="S1.11", kit="RUG", x=9.0, y=21.5, sx=13.0, sy=10.0, rot=0, source="board", note="orientation rug")]
        # intake / verification consultation (enclosed room X2-16 Y32-44, door east glass Y34-37)
        R.append(dict(tag="1.5", kit="CONSULT_TABLE", rot=0, source="csv"))
        _line(R, "1.5/s", [7.0, 9.0], 36.4, 180)
        _line(R, "1.5/n", [7.0, 9.0], 39.6, 0)
        R += [dict(tag="S1.12", kit="CREDENZA", x=5.6, y=42.9, rot=180, source="board", note="intake credenza (prior inventory F1-INTAKE-CREDENZA-01)"),
              dict(tag="S1.13", kit="MONITOR", x=6.2, y=42.95, z=2.4, rot=180, source="board", note="intake display (prior F1-INTAKE-DISPLAY-01)"),
              dict(tag="S1.14", kit="LAMP_DESK", x=3.4, y=42.95, z=2.4, rot=0, source="board", note="credenza lamp"),
              dict(tag="S1.15", kit="PLANT_FLOOR", x=14.4, y=42.4, rot=0, source="board", note="intake plant"),
              dict(tag="S1.16", kit="FRAME_ART", x=8.0, y=43.72, z=4.2, rot=180, source="board", note="landscape print"),
              dict(tag="S1.17", kit="RUG", x=8.0, y=38.0, sx=8.0, sy=6.5, rot=0, source="board", note="intake rug")]
        R.append(dict(tag="1.6", kit="DIRECTORY_KIOSK", rot=-90, source="csv"))
        R.append(dict(tag="S1.18", kit="PLANT_FLOOR", x=51.5, y=22.6, rot=0, source="board", note="directory plant"))
        R.append(dict(tag="1.7", kit="JOURNEY_DISPLAY", rot=0, source="csv"))
        # Arrival & Intake coat rack (preserved from the board, south-west of the orientation lounge)
        R.append(dict(tag="S1.19", kit="COAT_RACK", x=6.5, y=8.0, rot=0, source="board",
                      note="Arrival & Intake coat rack (owner: preserve); position inferred from board"))
        # atrium lounge kept west of the vestibule->reception axis (X32-40 stays clear)
        R += [dict(tag="S1.20", kit="SOFA_LONG", x=25.5, y=21.6, rot=0, source="board", note="atrium sectional (olive)"),
              dict(tag="S1.21", kit="CHAIR_LOUNGE_ROUND", x=22.6, y=15.8, rot=180, fabric=BOUCLE, source="board", note="atrium boucle chair"),
              dict(tag="S1.22", kit="CHAIR_LOUNGE_ROUND", x=28.4, y=15.8, rot=180, fabric=BOUCLE, source="board", note="atrium boucle chair"),
              dict(tag="S1.23", kit="COFFEE_TABLE_ROUND", x=25.5, y=18.6, rot=0, source="board", note="atrium coffee table"),
              dict(tag="S1.24", kit="RUG", x=25.5, y=18.7, sx=11.0, sy=10.0, rot=0, source="board", note="atrium jute rug"),
              dict(tag="S1.25", kit="LAMP_FLOOR", x=30.4, y=22.6, rot=0, source="board", note="atrium floor lamp"),
              dict(tag="S1.26", kit="PLANT_TREE", x=30.15, y=6.0, rot=0, source="board", note="vestibule tree (west)"),
              dict(tag="S1.27", kit="PLANT_TREE", x=41.85, y=6.0, rot=0, source="board", note="vestibule tree (east)"),
              dict(tag="S1.28", kit="PLANT_TREE", x=21.2, y=11.4, rot=0, source="board", note="atrium tree"),
              dict(tag="S1.29", kit="PLANT_TREE", x=50.8, y=11.4, rot=0, source="board", note="atrium tree"),
              dict(tag="S1.30", kit="PENDANT_LINEAR", x=33.25, y=37.6, z=8.6, rot=0, source="board", note="passport pendant"),
              dict(tag="S1.31", kit="PENDANT_LINEAR", x=43.0, y=37.6, z=8.6, rot=0, source="board", note="workpoint pendant"),
              dict(tag="S1.32", kit="PENDANT_DRUM", x=8.0, y=38.0, z=7.4, rot=0, source="board", note="intake pendant")]
    elif f == 2:
        R.append(dict(tag="2.1", kit="FORUM_TABLE", rot=0, source="csv"))
        _ring(R, "2.1", 36, 39, 7.35, 6.35, 12, start=15)
        R += [dict(tag="2.1/plant", kit="PLANT_DESK", x=36, y=39, z=2.5, rot=0, source="board", note="forum centrepiece"),
              dict(tag="S2.1", kit="RUG", x=36, y=39, sx=20.0, sy=17.5, rot=0, source="board", note="terracotta forum rug"),
              dict(tag="S2.2", kit="PENDANT_DRUM", x=32.5, y=39, z=7.6, rot=0, source="board", note="forum pendant"),
              dict(tag="S2.3", kit="PENDANT_DRUM", x=39.5, y=39, z=7.6, rot=0, source="board", note="forum pendant")]
        R.append(dict(tag="2.2", kit="LOUNGE_BANQUETTE", rot=180, source="csv"))
        R += [dict(tag="S2.4", kit="CAFE_TABLE", x=5.5, y=23.7, rot=0, source="board", note="listening cafe table"),
              dict(tag="S2.5", kit="CAFE_TABLE", x=10.5, y=23.7, rot=0, source="board", note="listening cafe table"),
              dict(tag="S2.6", kit="CHAIR_LOUNGE_ROUND", x=5.5, y=26.4, rot=0, fabric=BOUCLE, source="board", note="boucle chair"),
              dict(tag="S2.7", kit="CHAIR_LOUNGE_ROUND", x=10.2, y=26.4, rot=0, fabric=BOUCLE, source="board", note="boucle chair"),
              dict(tag="S2.8", kit="RUG", x=8.0, y=23.8, sx=13.0, sy=9.5, rot=0, source="board", note="lounge rug"),
              dict(tag="S2.9", kit="PLANT_TREE", x=3.3, y=16.6, rot=0, source="board", note="lounge tree"),
              dict(tag="S2.10", kit="LAMP_FLOOR", x=2.9, y=24.0, rot=0, source="board", note="lounge floor lamp")]
        R.append(dict(tag="2.3", kit="CHECKIN_KIOSK", rot=-90, source="csv"))
        R.append(dict(tag="S2.11", kit="PLANT_FLOOR", x=51.4, y=30.6, rot=0, source="board", note="check-in plant"))
        R.append(dict(tag="2.4", kit="MEDIA_WALL_14", rot=0, source="csv"))
        _desk(R, "2.5", "WORKPOINT", 14, 27, 0, screen="LAPTOP", lamp=True, source="csv")
        _desk(R, "2.6", "WORKPOINT", 28, 47, 0, screen="LAPTOP", plant=True, source="csv")
        _desk(R, "2.7", "WORKPOINT", 44, 47, 0, screen="LAPTOP", lamp=True, source="csv")
        R += [dict(tag="S2.12", kit="PLANT_TREE", x=24.8, y=50.0, rot=0, source="board", note="feature-wall tree"),
              dict(tag="S2.13", kit="PLANT_TREE", x=47.2, y=50.0, rot=0, source="board", note="feature-wall tree"),
              dict(tag="S2.14", kit="PLANT_TREE", x=68.6, y=4.6, rot=0, source="board", note="south-east corner tree"),
              dict(tag="S2.15", kit="PLANT_TREE", x=3.4, y=4.6, rot=0, source="board", note="south-west corner tree")]
    elif f == 3:
        R.append(dict(tag="3.1", kit="EXCHANGE_TABLE", rot=0, source="csv"))
        _line(R, "3.1/s", [29.6, 32.8, 36.0, 39.2, 42.4], 38.25, 180)
        _line(R, "3.1/n", [29.6, 32.8, 36.0, 39.2, 42.4], 43.75, 0)
        R += [dict(tag="3.1/plant", kit="PLANT_DESK", x=36, y=41, z=2.5, rot=0, source="board", note="exchange centrepiece"),
              dict(tag="S3.1", kit="RUG", x=36, y=41, sx=22.0, sy=10.5, rot=0, source="board", note="exchange rug"),
              dict(tag="S3.2", kit="PENDANT_LINEAR", x=32.0, y=41, z=8.4, rot=0, source="board", note="exchange pendant"),
              dict(tag="S3.3", kit="PENDANT_LINEAR", x=40.0, y=41, z=8.4, rot=0, source="board", note="exchange pendant")]
        _desk(R, "3.2", "WORKPOINT", 7, 28, 0, screen="MONITOR", lamp=True, source="csv")
        _desk(R, "3.3", "WORKPOINT", 25, 46, 0, screen="MONITOR", plant=True, source="csv")
        R.append(dict(tag="3.4", kit="TECH_BENCH", rot=0, source="csv"))
        R.append(dict(tag="3.4/stool", kit="STOOL", x=45, y=45.3, rot=0, source="board", note="bench stool"))
        _desk(R, "3.5", "WORKPOINT", 25, 33, 0, screen="LAPTOP", lamp=True, source="csv")
        _desk(R, "3.6", "WORKPOINT", 45, 33, 0, screen=None, source="csv")
        R += [dict(tag="3.6/screen1", kit="MONITOR", x=44.0, y=33.3, z=2.5, rot=0, source="board", note="monitor station"),
              dict(tag="3.6/screen2", kit="MONITOR", x=46.0, y=33.3, z=2.5, rot=0, source="board", note="monitor station")]
        for tag, x, cx in (("3.7", 8, 3.15), ("3.8", 22, 26.85)):
            R.append(dict(tag=tag, kit="CONSULT_TABLE", rot=0, source="csv"))
            _line(R, tag + "/s", [x - 1, x + 1], 8.4, 180)
            _line(R, tag + "/n", [x - 1, x + 1], 11.6, 0)
            R.append(dict(tag=tag + "/credenza", kit="CREDENZA", x=cx, y=10.0, rot=90 if cx < x else -90, source="board", note="interview credenza"))
            R.append(dict(tag=tag + "/lamp", kit="LAMP_DESK", x=cx, y=12.2, z=2.4, rot=0, source="board", note="credenza lamp"))
        R += [dict(tag="S3.4", kit="PLANT_FLOOR", x=12.8, y=5.4, rot=0, source="board", note="interview A plant"),
              dict(tag="S3.5", kit="PLANT_FLOOR", x=17.4, y=5.4, rot=0, source="board", note="interview B plant"),
              dict(tag="S3.6", kit="SOFA_3SEAT", x=4.1, y=22.0, rot=90, source="board", note="network lounge sofa (teal)"),
              dict(tag="S3.7", kit="COFFEE_TABLE_ROUND", x=8.4, y=22.0, rot=0, source="board", note="lounge coffee table"),
              dict(tag="S3.8", kit="CHAIR_LOUNGE_ROUND", x=12.2, y=22.0, rot=-90, fabric="#8C8278", source="board", note="lounge armchair"),
              dict(tag="S3.9", kit="RUG", x=8.0, y=22.0, sx=12.0, sy=8.0, rot=0, source="board", note="lounge rug"),
              dict(tag="S3.10", kit="BOOKCASE", x=2.85, y=31.2, rot=90, source="board", note="network library"),
              dict(tag="S3.11", kit="CAFE_TABLE", x=14.6, y=30.4, rot=0, source="board", note="lounge round table"),
              dict(tag="S3.12", kit="CHAIR_SIDE", x=14.6, y=28.0, rot=180, source="board", note="lounge chair"),
              dict(tag="S3.13", kit="CHAIR_SIDE", x=14.6, y=32.8, rot=0, source="board", note="lounge chair"),
              dict(tag="S3.14", kit="LAMP_FLOOR", x=3.5, y=17.0, rot=0, source="board", note="lounge floor lamp"),
              dict(tag="S3.15", kit="PLANT_FLOOR", x=17.0, y=32.8, rot=0, source="board", note="lounge plant"),
              dict(tag="S3.16", kit="WHITEBOARD_MOBILE", x=50.0, y=45.0, rot=-90, source="board", note="field-ops planning board"),
              dict(tag="S3.17", kit="PLANT_TREE", x=68.6, y=4.6, rot=0, source="board", note="corner tree"),
              dict(tag="S3.18", kit="PLANT_TREE", x=57.0, y=48.6, rot=0, source="board", note="elevator lobby plant")]
        R.append(dict(tag="3.9", kit="CHECKIN_KIOSK", rot=-90, source="csv"))
    elif f == 4:
        R.append(dict(tag="4.1", kit="LISTENING_ENVELOPE", rot=0, source="csv"))
        R += [dict(tag="4.1/sofa", kit="SOFA_LONG", x=36, y=36.4, rot=180, fabric=LEATHER_BROWN, source="board", note="screening sofa (leather)"),
              dict(tag="4.1/chairW", kit="CHAIR_LOUNGE_ROUND", x=31.2, y=39.9, rot=90, fabric=CREAM, source="board", note="screening armchair"),
              dict(tag="4.1/chairE", kit="CHAIR_LOUNGE_ROUND", x=40.8, y=39.9, rot=-90, fabric=CREAM, source="board", note="screening armchair"),
              dict(tag="4.1/table", kit="COFFEE_TABLE_ROUND", x=36, y=39.9, rot=0, source="board", note="screening table"),
              dict(tag="4.1/console", kit="BOOKCASE_LOW", x=36, y=34.25, rot=0, source="board", note="record console behind sofa"),
              dict(tag="4.1/lampW", kit="LAMP_FLOOR", x=30.6, y=36.4, rot=0, source="board", note="screening lamp"),
              dict(tag="4.1/lampE", kit="LAMP_FLOOR", x=41.4, y=36.4, rot=0, source="board", note="screening lamp"),
              dict(tag="S4.1", kit="RUG", x=36, y=38.2, sx=19.0, sy=12.0, rot=0, source="board", note="burgundy listening rug")]
        R.append(dict(tag="4.2", kit="RELEASE_WALL", rot=0, source="csv"))
        R.append(dict(tag="4.3", kit="ARCHIVE_CABINET", rot=0, source="csv"))
        R += [dict(tag="S4.2", kit="VITRINE", x=12.6, y=23.6, rot=90, source="board", note="culture archive vitrine (glass case)"),
              dict(tag="S4.3", kit="RUG", x=9.5, y=27.0, sx=12.5, sy=17.0, rot=0, source="board", note="gallery runner"),
              dict(tag="S4.4", kit="PLANT_FLOOR", x=16.6, y=36.6, rot=0, source="board", note="gallery plant")]
        for i, y in enumerate((20.4, 23.6, 31.6, 34.8)):
            R.append(dict(tag=f"S4.5/{i + 1}", kit="FRAME_ART", x=0.85, y=y, z=3.6, rot=90, source="board",
                          note="framed release on archive wall"))
        R.append(dict(tag="4.4", kit="VOCAL_RIG", rot=0, source="csv"))
        R += [dict(tag="S4.6", kit="CREDENZA", x=3.2, y=10.0, rot=90, source="board", note="recording desk / interface"),
              dict(tag="S4.7", kit="SPEAKER_PAIR", x=3.2, y=10.0, z=2.4, rot=90, source="board", note="recording monitors"),
              dict(tag="S4.8", kit="RUG", x=8.5, y=9.5, sx=8.5, sy=7.0, rot=0, source="board", note="recording rug"),
              dict(tag="S4.9", kit="LAMP_FLOOR", x=13.6, y=5.4, rot=0, source="board", note="recording lamp")]
        _desk(R, "4.5", "EDIT_DESK", 24, 10, 0, screen=None, source="csv", w=6, d=2.5)
        R += [dict(tag="4.5/screen1", kit="MONITOR", x=23.0, y=10.6, z=2.5, rot=0, source="board", note="edit display"),
              dict(tag="4.5/screen2", kit="MONITOR", x=25.0, y=10.6, z=2.5, rot=0, source="board", note="edit display"),
              dict(tag="S4.10", kit="CREDENZA", x=21.0, y=15.0, rot=180, source="board", note="edit suite credenza"),
              dict(tag="S4.11", kit="PLANT_FLOOR", x=30.0, y=5.3, rot=0, source="board", note="edit suite plant")]
        _desk(R, "4.6", "WORKPOINT", 13, 34, 0, screen="LAPTOP", lamp=True, source="csv")
        _desk(R, "S4.12", "WORKPOINT", 30.5, 30.4, 0, screen="LAPTOP", plant=True,
              note="production desk: board shows two desks south of the screening group; prior inventory F4-PRODUCTION-DESK")
        _desk(R, "S4.13", "WORKPOINT", 41.5, 30.4, 0, screen="LAPTOP", lamp=True,
              note="production desk: board; prior inventory F4-PRODUCTION-DESK")
        R.append(dict(tag="4.7", kit="CHECKIN_KIOSK", rot=-90, source="csv"))
        R.append(dict(tag="4.8", kit="GEAR_LOCKER", rot=0, source="csv"))
        R += [dict(tag="S4.14", kit="ROAD_CASE", x=40.3, y=62.6, rot=0, source="board", note="labelled road case"),
              dict(tag="S4.15", kit="ROAD_CASE", x=40.3, y=62.6, z=2.0, rot=0, source="board", note="stacked road case"),
              dict(tag="S4.16", kit="PLANT_TREE", x=23.4, y=49.6, rot=0, source="board", note="release-wall plant"),
              dict(tag="S4.17", kit="PLANT_TREE", x=48.6, y=49.6, rot=0, source="board", note="release-wall plant")]
    elif f == 5:
        R.append(dict(tag="5.1", kit="POLICY_TABLE", rot=0, source="csv"))
        _line(R, "5.1/s", [30.0, 34.0, 38.0, 42.0], 37.75, 180)
        _line(R, "5.1/n", [30.0, 34.0, 38.0, 42.0], 44.25, 0)
        R += [dict(tag="5.1/plant", kit="PLANT_DESK", x=36, y=41, z=2.5, rot=0, source="board", note="policy table centrepiece"),
              dict(tag="5.1/docs", kit="DOC_STACK", x=32.5, y=40.6, z=2.5, rot=0, source="board", note="open briefs"),
              dict(tag="S5.1", kit="RUG", x=36, y=41, sx=22.0, sy=11.5, rot=0, source="board", note="olive policy rug"),
              dict(tag="S5.2", kit="PENDANT_LINEAR", x=32.0, y=41, z=8.4, rot=0, source="board", note="policy pendant"),
              dict(tag="S5.3", kit="PENDANT_LINEAR", x=40.0, y=41, z=8.4, rot=0, source="board", note="policy pendant")]
        # Evidence + Proof Archive (preserved): steel archive shelving, flat files, reading station
        R.append(dict(tag="5.2", kit="ARCHIVE_CABINET_6x6", rot=0, source="csv"))
        R += [dict(tag="S5.4", kit="ARCHIVE_CABINET_6x6", x=3.0, y=22.4, rot=90, source="board", note="archive shelving (west wall)"),
              dict(tag="S5.5", kit="ARCHIVE_CABINET_6x6", x=3.0, y=28.6, rot=90, source="board", note="archive shelving (west wall)"),
              dict(tag="S5.6", kit="MAP_CABINET", x=14.6, y=33.0, rot=0, source="board", note="olive flat-file cabinet")]
        R.append(dict(tag="5.3", kit="CONSULT_TABLE_5x2.5", rot=0, source="csv"))
        _line(R, "5.3/s", [9.0, 11.0], 25.45, 180)
        _line(R, "5.3/n", [9.0, 11.0], 28.55, 0)
        R += [dict(tag="5.3/lamp", kit="LAMP_DESK", x=11.9, y=27.4, z=2.5, rot=0, source="board", note="reading lamp"),
              dict(tag="5.3/docs", kit="DOC_STACK", x=9.6, y=27.0, z=2.5, rot=0, source="board", note="archive folios"),
              dict(tag="S5.7", kit="RUG", x=10.0, y=27.0, sx=9.5, sy=7.5, rot=0, source="board", note="reading rug")]
        _desk(R, "5.4", "WORKPOINT_5x2.5", 8, 10, 0, screen="MONITOR", lamp=True, source="csv", w=5, d=2.5)
        R += [dict(tag="5.4/guest", kit="CHAIR_SIDE", x=8.0, y=12.7, rot=0, source="board", note="source review guest"),
              dict(tag="S5.8", kit="BOOKCASE", x=3.0, y=10.0, rot=90, source="board", note="source library")]
        _desk(R, "5.5", "WORKPOINT_5x2.5", 24, 10, 0, screen="MONITOR", lamp=True, source="csv", w=5, d=2.5)
        R += [dict(tag="5.5/guest", kit="CHAIR_SIDE", x=24.0, y=12.7, rot=0, source="board", note="publication review guest"),
              dict(tag="S5.9", kit="CREDENZA", x=21.0, y=15.0, rot=180, fabric="#5F6650", source="board", note="publication credenza")]
        _desk(R, "5.6", "WORKPOINT", 46, 46, 0, screen="MONITOR", lamp=True, source="csv")
        for i, x in enumerate((29.0, 36.0, 43.0)):
            _desk(R, f"S5.10/{i + 1}", "WORKPOINT", x, 32.4, 0, screen="MONITOR" if i == 1 else "LAPTOP", lamp=True,
                  note="research carrel: board shows three; prior inventory F5-CARREL-01..06")
        R.append(dict(tag="5.7", kit="CHECKIN_KIOSK", rot=-90, source="csv"))
        R.append(dict(tag="5.8", kit="EVIDENCE_LOCKER", rot=0, source="csv"))
        R += [dict(tag="S5.11", kit="PLANT_TREE", x=23.4, y=49.6, rot=0, source="board", note="policy-wall plant"),
              dict(tag="S5.12", kit="PLANT_TREE", x=49.0, y=49.6, rot=0, source="board", note="policy-wall plant"),
              dict(tag="S5.13", kit="PLANT_FLOOR", x=30.2, y=5.4, rot=0, source="board", note="review room plant")]
    elif f == 6:
        R.append(dict(tag="6.1", kit="COMMAND_TABLE", rot=0, source="csv"))
        _line(R, "6.1/s", [31.0, 36.0, 41.0], 37.75, 180, kit="CHAIR_TASK")
        _line(R, "6.1/n", [31.0, 36.0, 41.0], 44.25, 0, kit="CHAIR_TASK")
        R += [dict(tag="6.1/lampW", kit="LAMP_DESK", x=32.0, y=41.0, z=2.5, rot=0, source="board", note="brass table lamp"),
              dict(tag="6.1/lampE", kit="LAMP_DESK", x=40.0, y=41.0, z=2.5, rot=0, source="board", note="brass table lamp"),
              dict(tag="6.1/plant", kit="PLANT_DESK", x=36.0, y=41.0, z=2.5, rot=0, source="board", note="table centrepiece"),
              dict(tag="S6.1", kit="RUG", x=36, y=41, sx=22.0, sy=12.5, rot=0, source="board", note="command rug"),
              dict(tag="S6.2", kit="PENDANT_LINEAR", x=32.0, y=41, z=8.5, rot=0, source="board", note="command pendant"),
              dict(tag="S6.3", kit="PENDANT_LINEAR", x=40.0, y=41, z=8.5, rot=0, source="board", note="command pendant")]
        # 6.2 is built as its own interactive object (F06_PRIM2_SCREEN) by the build script.
        R.append(dict(tag="6.3", kit="LOUNGE_BANQUETTE", rot=180, source="csv"))
        R += [dict(tag="S6.4", kit="COFFEE_TABLE_ROUND", x=9.0, y=31.3, rot=0, source="board", note="salon coffee table"),
              dict(tag="S6.5", kit="CHAIR_LEATHER", x=5.6, y=34.4, rot=0, fabric="#CDBFA8", source="board", note="salon armchair"),
              dict(tag="S6.6", kit="CHAIR_LEATHER", x=12.4, y=34.4, rot=0, fabric="#CDBFA8", source="board", note="salon armchair"),
              dict(tag="S6.7", kit="RUG", x=9.0, y=31.0, sx=13.0, sy=10.5, rot=0, source="board", note="salon rug"),
              dict(tag="S6.8", kit="BOOKCASE", x=2.85, y=26.4, rot=90, source="board", note="salon library"),
              dict(tag="S6.9", kit="BOOKCASE", x=2.85, y=21.6, rot=90, source="board", note="salon library"),
              dict(tag="S6.10", kit="ROUND_TABLE_4", x=11.0, y=21.4, rot=0, source="board", note="salon round table"),
              dict(tag="S6.11", kit="LAMP_FLOOR", x=15.8, y=30.2, rot=0, source="board", note="salon floor lamp"),
              dict(tag="S6.12", kit="PLANT_TREE", x=16.4, y=36.4, rot=0, source="board", note="salon tree")]
        _ring(R, "S6.10", 11.0, 21.4, 2.75, 2.75, 4, kit="CHAIR_SIDE", start=0)
        for tag, x, cz in (("6.4", 8, None), ("6.5", 24, 21.0)):
            _desk(R, tag, "WORKPOINT_5x2.5", x, 10, 0, screen="MONITOR", lamp=True, source="csv", w=5, d=2.5)
            _line(R, tag + "/guest", [x - 1.25, x + 1.25], 12.7, 0)
        R += [dict(tag="S6.13", kit="BOOKCASE", x=3.0, y=10.0, rot=90, source="board", note="strategy room library"),
              dict(tag="S6.14", kit="CREDENZA_STONE", x=21.0, y=14.95, rot=180, source="board", note="briefing credenza")]
        _desk(R, "6.6", "WORKPOINT", 26, 46, 0, screen="MONITOR_WIDE", lamp=True, source="csv")
        R.append(dict(tag="6.7", kit="CHECKIN_KIOSK", rot=-90, source="csv"))
        # 6.8 Halo Globe is built as its own interactive object (F06_HALO_GLOBE) by the build script.
        # Matthew's executive suite — story staging beside Executive Command and the Halo Globe
        # (README: "not a new floor or a change to these shell plans"): furniture-height screens only.
        R += [dict(tag="S6.M1", kit="EXEC_DESK", x=42.0, y=8.0, rot=0, source="board", note="Matthew McCluster executive desk (story staging)"),
              dict(tag="S6.M2", kit="CHAIR_TASK", x=42.0, y=6.05, rot=180, source="board", note="executive chair"),
              dict(tag="S6.M3", kit="MONITOR_WIDE", x=42.0, y=8.6, z=2.55, rot=0, source="board", note="executive display"),
              dict(tag="S6.M4", kit="LAMP_DESK", x=44.6, y=8.4, z=2.55, rot=0, source="board", note="executive lamp"),
              dict(tag="S6.M5", kit="CHAIR_SIDE", x=40.6, y=10.7, rot=0, source="board", note="suite guest chair"),
              dict(tag="S6.M6", kit="CHAIR_SIDE", x=43.4, y=10.7, rot=0, source="board", note="suite guest chair"),
              dict(tag="S6.M7", kit="CREDENZA_STONE", x=42.0, y=1.7, rot=180, source="board", note="suite credenza at sealed south glazing"),
              dict(tag="S6.M8", kit="CHAIR_LEATHER", x=47.0, y=9.6, rot=90, source="board", note="globe-view armchair"),
              dict(tag="S6.M9", kit="CHAIR_LEATHER", x=47.0, y=14.4, rot=90, source="board", note="globe-view armchair"),
              dict(tag="S6.M10", kit="SIDE_TABLE", x=47.4, y=12.0, rot=0, source="board", note="globe-view side table"),
              dict(tag="S6.M11", kit="RUG", x=42.0, y=9.0, sx=13.0, sy=11.0, rot=0, source="board", note="suite rug"),
              dict(tag="S6.M12", kit="SCREEN_PANEL_SMOKED", x=37.0, y=16.9, rot=0, source="board", note="suite screen (furniture height)"),
              dict(tag="S6.M13", kit="SCREEN_PANEL_SMOKED", x=46.5, y=16.9, rot=0, source="board", note="suite screen (furniture height)"),
              dict(tag="S6.M14", kit="PLANT_TREE", x=35.8, y=4.2, rot=0, source="board", note="suite tree"),
              dict(tag="S6.M15", kit="PLANT_FLOOR", x=48.6, y=3.0, rot=0, source="board", note="suite plant"),
              dict(tag="S6.15", kit="PLANT_TREE", x=23.4, y=49.6, rot=0, source="board", note="command-wall plant"),
              dict(tag="S6.16", kit="PLANT_TREE", x=48.6, y=49.6, rot=0, source="board", note="command-wall plant"),
              dict(tag="S6.17", kit="PLANT_FLOOR", x=68.8, y=4.4, rot=0, source="board", note="corner plant")]
    elif f == 7:
        R.append(dict(tag="7.1", kit="ROUTING_BEACON", rot=-90, source="csv"))
        R.append(dict(tag="7.2", kit="ROOF_BENCH", rot=0, source="csv"))
        R.append(dict(tag="7.3", kit="BOLLARD_LIGHT", rot=0, source="csv"))
        for i, x in enumerate((15.0, 33.0)):
            R.append(dict(tag=f"S7.{i + 1}", kit="BOLLARD_LIGHT", x=x, y=4.0, rot=0, source="board", note="overlook bollard (repeat of 7.3)"))
        for i, x in enumerate((18.6, 29.6, 38.4)):
            R.append(dict(tag=f"S7.{i + 3}", kit="PLANTER_ROOF", x=x, y=3.4, rot=0, source="board", note="overlook planter"))
        R.append(dict(tag="7.4", kit="WEATHER_CONSOLE", rot=-90, source="csv", override=(31.5, 66.0),
                      deviation="CSV (38,66) falls inside the canonical L7 model's F7-MECH-UNIT-01 (X35-40 Y62-68); "
                                "moved to the nearest clear duty point west of the service band, plant access kept clear."))
        R.append(dict(tag="7.5", kit="EXISTING:F7-MECH-UNIT-02", source="csv",
                      deviation="CSV 7.5 is a visual plant proxy; the canonical L7 model already carries that plant as "
                                "F7-MECH-UNIT-02 (X41-46 Y62-68). Realised by tagging the existing unit; no duplicate added."))
    return R
