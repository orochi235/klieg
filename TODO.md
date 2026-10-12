# TODO

Work klieg owes that has no other home yet.

## The tube lab's tiles cannot be dragged to reorder

`<Workspace reorderable>` is set, but nothing in a tile starts the drag. labkit moved the drag
surface into a `<Trial>`'s own title bar (weasel `b07b63f80`) and stopped rendering
`.lk-trial-tile__grip`, which the lab's `styles.css` still positions. The lab's tiles are plain
elements, not trials, and labkit exports no hook that makes one draggable (`useTrialDrag` is
internal), so until one ships the `.lk-trial-tile__grip` rules and the `reorder` callback in
`App.tsx` are dead.

The handle is written and not released: weasel's `tile-grip` branch (`3b81e9335`, in the worktree
`~/src/weasel/.claude/worktrees/tile-grip`, green on the fleet, not merged) adds a public
`<TileGrip>` to labkit. Once a weasel release carries it, pin that release here, wrap the panel's
`.panel__bar` in `<TileGrip>`, and delete the `.lk-trial-tile__grip` rules.
