# Revive demo video

Source for the demo video embedded in the main README, built with Remotion.

The video uses real screenshots of the running app, captured with
`npm run screens` from the repository root.

```bash
npm install
npm run dev          # open Remotion Studio
npm run render       # ../docs/media/revive-demo.mp4
npm run render:gif   # ../docs/media/revive-demo.gif
```

Scenes live in `src/scenes.tsx`, shared building blocks in
`src/components.tsx`, and timing and palette in `src/theme.ts`.
