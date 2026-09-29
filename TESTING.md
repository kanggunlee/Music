# Validation

- 12 automated queue/playlist behavior tests pass.
- Application modules pass JavaScript syntax checks.
- 22 integration checks pass in the in-app browser using generated MP3 and AAC MP4 tones. These cover decoding/metadata, invalid media rejection, persistence, rename, seek/pause/next, repeat-one, equalizer gains and native fallback, and playlist cleanup on media deletion.
- Native file picker imports both formats successfully.
- Physical iPhone lock-screen, Bluetooth controls, browser storage eviction, and airplane-mode relaunch require target-device verification. No guarantee of uninterrupted iOS background audio is made.
