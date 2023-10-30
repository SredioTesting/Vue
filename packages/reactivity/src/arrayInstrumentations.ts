import { TrackOpTypes } from './constants'
import {
  pauseTracking,
  resetTracking,
  pauseScheduling,
  resetScheduling
} from './effect'
import { isProxy, isShallow, toRaw, toReactive } from './reactive'
import { track, ARRAY_ITERATE_KEY } from './reactiveEffect'

export function readArray<T>(array: T[], deep = false) {
  const arr = toRaw(array)
  if (arr === array) {
    return arr
  }
  track(arr, TrackOpTypes.ITERATE, ARRAY_ITERATE_KEY)
  return !deep || isShallow(array) ? arr : arr.map(toReactive)
}

export const arrayInstrumentations: Record<string | symbol, Function> = <any>{
  __proto__: null,

  [Symbol.iterator]() {
    return iterator(this, Symbol.iterator, toReactive)
  },

  concat(...args: unknown[][]) {
    const arr = readArray(this, true)
    return arr.concat(...args.map(x => readArray(x, true)))
  },

  entries() {
    return iterator(this, 'entries', (value: [number, unknown]) => {
      value[1] = toReactive(value[1])
      return value
    })
  },

  every(
    fn: (item: unknown, index: number, array: unknown[]) => unknown,
    thisArg?: unknown
  ) {
    return callback(this, 'every', fn, thisArg)
  },

  filter(
    fn: (item: unknown, index: number, array: unknown[]) => unknown,
    thisArg?: unknown
  ) {
    const result = callback(this, 'filter', fn, thisArg)
    return isProxy(this) && !isShallow(this) ? result.map(toReactive) : result
  },

  find(
    fn: (item: unknown, index: number, array: unknown[]) => boolean,
    thisArg?: unknown
  ) {
    const result = callback(this, 'find', fn, thisArg)
    return isProxy(this) && !isShallow(this) ? toReactive(result) : result
  },

  findIndex(
    fn: (item: unknown, index: number, array: unknown[]) => boolean,
    thisArg?: unknown
  ) {
    return callback(this, 'findIndex', fn, thisArg)
  },

  findLast(
    fn: (item: unknown, index: number, array: unknown[]) => boolean,
    thisArg?: unknown
  ) {
    const result = callback(this, 'findLast', fn, thisArg)
    return isProxy(this) && !isShallow(this) ? toReactive(result) : result
  },

  findLastIndex(
    fn: (item: unknown, index: number, array: unknown[]) => boolean,
    thisArg?: unknown
  ) {
    return callback(this, 'findLastIndex', fn, thisArg)
  },

  // flat, flatMap could benefit from ARRAY_ITERATE but are not straight-forward to implement

  forEach(
    fn: (item: unknown, index: number, array: unknown[]) => unknown,
    thisArg?: unknown
  ) {
    return callback(this, 'forEach', fn, thisArg)
  },

  includes(...args: unknown[]) {
    return searchProxy(this, 'includes', args)
  },

  indexOf(...args: unknown[]) {
    return searchProxy(this, 'indexOf', args)
  },

  join(separator?: string) {
    return readArray(this, true).join(separator)
  },

  // keys() iterator only reads `length`, no optimisation required

  lastIndexOf(...args: unknown[]) {
    return searchProxy(this, 'lastIndexOf', args)
  },

  map(
    fn: (item: unknown, index: number, array: unknown[]) => unknown,
    thisArg?: unknown
  ) {
    return callback(this, 'map', fn, thisArg)
  },

  pop() {
    return noTracking(this, 'pop')
  },

  push(...args: unknown[]) {
    return noTracking(this, 'push', args)
  },

  reduce(
    fn: (
      acc: unknown,
      item: unknown,
      index: number,
      array: unknown[]
    ) => unknown,
    ...args: unknown[]
  ) {
    return reduce(this, 'reduce', fn, args)
  },

  reduceRight(
    fn: (
      acc: unknown,
      item: unknown,
      index: number,
      array: unknown[]
    ) => unknown,
    ...args: unknown[]
  ) {
    return reduce(this, 'reduceRight', fn, args)
  },

  shift() {
    return noTracking(this, 'shift')
  },

  // slice could use ARRAY_ITERATE but also seems to beg for range tracking

  some(
    fn: (item: unknown, index: number, array: unknown[]) => unknown,
    thisArg?: unknown
  ) {
    return callback(this, 'some', fn, thisArg)
  },

  splice(...args: unknown[]) {
    return noTracking(this, 'splice', args)
  },

  toReversed() {
    return readArray(this, true).toReversed()
  },

  toSorted(comparer?: Function) {
    return readArray(this, true).toSorted(comparer as any)
  },

  toSpliced(...args: unknown[]) {
    return (readArray(this, true).toSpliced as any)(...args)
  },

  unshift(...args: unknown[]) {
    return noTracking(this, 'unshift', args)
  },

  values() {
    return iterator(this, 'values', toReactive)
  }
}

// instrument iterators to take ARRAY_ITERATE dependency
function iterator(
  self: unknown[],
  method: keyof Array<any>,
  wrapValue: (value: any) => unknown
) {
  // note that taking ARRAY_ITERATE dependency here is not strictly equivalent
  // to calling iterate on the proxified array.
  // creating the iterator does not access any array property:
  // it is only when .next() is called that length and indexes are accessed.
  // pushed to the extreme, an iterator could be created in one effect scope,
  // partially iterated in another, then iterated more in yet another.
  // given that JS iterator can only be read once, this doesn't seem like
  // a plausible use-case, so this tracking simplification seems ok.
  const arr = readArray(self)
  const iter = (arr[method] as any)()
  if (arr !== self && !isShallow(self)) {
    ;(iter as any)._next = iter.next
    iter.next = () => {
      const result = (iter as any)._next()
      if (result.value) {
        result.value = wrapValue(result.value)
      }
      return result
    }
  }
  return iter
}

// instrument functions that read (potentially) all items
// to take ARRAY_ITERATE dependency
function callback(
  self: unknown[],
  method: keyof Array<any>,
  fn: (item: unknown, index: number, array: unknown[]) => unknown,
  thisArg?: unknown
) {
  const arr = readArray(self)
  let fn2 = fn
  if (arr !== self) {
    if (!isShallow(self)) {
      fn2 = function (this: unknown, item, index) {
        return fn.call(this, toReactive(item), index, self)
      }
    } else if (fn.length > 2) {
      fn2 = function (this: unknown, item, index) {
        return fn.call(this, item, index, self)
      }
    }
  }
  return (arr[method] as any)(fn2, thisArg)
}

// instrument reduce and reduceRight to take ARRAY_ITERATE dependency
function reduce(
  self: unknown[],
  method: keyof Array<any>,
  fn: (acc: unknown, item: unknown, index: number, array: unknown[]) => unknown,
  args: unknown[]
) {
  const arr = readArray(self)
  let fn2 = fn
  if (arr !== self) {
    if (!isShallow(self)) {
      fn2 = function (this: unknown, acc, item, index) {
        return fn.call(this, acc, toReactive(item), index, self)
      }
    } else if (fn.length > 3) {
      fn2 = function (this: unknown, acc, item, index) {
        return fn.call(this, acc, item, index, self)
      }
    }
  }
  return (arr[method] as any)(fn2, ...args)
}

// instrument identity-sensitive methods to account for reactive proxies
function searchProxy(
  self: unknown[],
  method: keyof Array<any>,
  args: unknown[]
) {
  const arr = toRaw(self) as any
  track(arr, TrackOpTypes.ITERATE, ARRAY_ITERATE_KEY)
  // we run the method using the original args first (which may be reactive)
  const res = arr[method](...args)

  // if that didn't work, run it again using raw values.
  if ((res === -1 || res === false) && isProxy(args[0])) {
    args[0] = toRaw(args[0])
    return arr[method](...args)
  }

  return res
}

// instrument length-altering mutation methods to avoid length being tracked
// which leads to infinite loops in some cases (#2137)
function noTracking(
  self: unknown[],
  method: keyof Array<any>,
  args: unknown[] = []
) {
  pauseTracking()
  pauseScheduling()
  const res = (toRaw(self) as any)[method].apply(self, args)
  resetScheduling()
  resetTracking()
  return res
}
