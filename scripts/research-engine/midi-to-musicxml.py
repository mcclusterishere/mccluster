"""Draft-only MIDI to editable MusicXML.
No access to private masters. No invented confidence or automatic publication.
Requires a preinstalled and reviewed music21 version in the isolated worker.
"""
from pathlib import Path
import argparse
import sys

def main():
    p = argparse.ArgumentParser(description="Convert approved MIDI to draft MusicXML")
    p.add_argument("--output", required=True)
    p.add_argument("midi", nargs="+")
    args = p.parse_args()
    from music21 import converter, metadata, stream, instrument, meter
    out = Path(args.output).resolve()
    if out.exists() or out.suffix.lower() != ".musicxml":
        raise ValueError("expected a new MusicXML file")
    if len(args.midi) > 32:
        raise ValueError("no more than 32 approved MIDI files")
    score = stream.Score()
    score.metadata = metadata.Metadata()
    score.metadata.title = "Creator review required — unverified transcription"
    score.metadata.composer = "Unverified auto-transcription — correct before release"
    for i, candidate in enumerate(args.midi):
        inp = Path(candidate).resolve()
        if inp.suffix.lower() != ".mid" or not inp.is_file():
            raise ValueError("only existing approved MIDI inputs allowed")
        source = converter.parse(str(inp))
        for j, part in enumerate(source.parts if source.parts else [source]):
            lane = stream.Part()
            lane.id = f"candidate_{i+1}_{j+1}"
            lane.partName = inp.stem[:70]
            lane.insert(0,instrument.Instrument())
            for item in part.recurse().notesAndRests:
                lane.insert(item.getOffsetInHierarchy(part),item)
            if lane.recurse().notesAndRests:
                score.insert(0,lane)
    if not score.parts:
        raise ValueError("no pitched/percussion note events found in MIDI input")
    out.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    score.write("musicxml",fp=str(out))
    print("musicxml_draft_created",file=sys.stderr)
if __name__=="__main__":
    main()
