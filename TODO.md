# TODO

Work klieg owes that has no other home yet.

## The tube lab's tiles cannot be dragged to reorder

`<Workspace reorderable>` is set, but nothing in a tile starts the drag. labkit moved the drag
surface into a `<Trial>`'s own title bar (weasel `b07b63f80`) and stopped rendering
`.lk-trial-tile__grip`, which the lab's `styles.css` still positions. The lab's tiles are plain
elements, not trials, and labkit exports no hook that makes one draggable (`useTrialDrag` is
internal). Either the panels become trials, or labkit grows a public drag handle; until then the
`.lk-trial-tile__grip` rules and the `reorder` callback in `App.tsx` are dead.
