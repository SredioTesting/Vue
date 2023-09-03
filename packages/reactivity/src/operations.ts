// using literal strings instead of numbers so that it's easier to inspect
// debugger events

export const enum TrackOpTypes {
  GET = 'get',
  HAS = 'has',
  ITERATE = 'iterate'
}

export const enum TriggerOpTypes {
  SET = 'set',
  ADD = 'add',
  DELETE = 'delete',
  CLEAR = 'clear'
}

export const enum DirtyLevels {
  NotDirty = 0,
  ComputedValueMaybeDirty = 1,
  ComputedValueDirty = 2,
  Dirty = 3
}
