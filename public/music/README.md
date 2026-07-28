# News Channel background music

Drop audio files (`.mp3`, `.ogg`, `.m4a`, `.wav`) into this folder, then list
their filenames in `playlist.json`:

```json
{
  "tracks": ["track-01.mp3", "track-02.mp3"]
}
```

They'll play (looping the playlist, at low volume) while the News Channel is
open, with a mute toggle in the corner. Leave `tracks` empty for silence.

Note: game-soundtrack rips are copyrighted — fine for personal/local use, but
don't ship them in a public deployment.
