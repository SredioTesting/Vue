import {
  VNode,
  VNodeProps,
  createVNode,
  VNodeArrayChildren,
  Fragment,
  Text,
  Comment,
  isVNode
} from './vnode'
import { Teleport, TeleportProps } from './components/Teleport'
import { Suspense, SuspenseProps } from './components/Suspense'
import { isObject, isArray } from '@vue/shared'
import { RawSlots } from './componentSlots'
import {
  FunctionalComponent,
  Component,
  ConcreteComponent,
  ComponentOptions,
  BetterComponent
} from './component'
import { EmitsOptions } from './componentEmits'
import { betterDefineComponent, DefineComponent } from './apiDefineComponent'
import { Prop, Slots } from 'test-dts'
import { BetterComponentOptions } from './componentOptions'
import { RenderComponent } from './componentPublicInstance'

// `h` is a more user-friendly version of `createVNode` that allows omitting the
// props when possible. It is intended for manually written render functions.
// Compiler-generated code uses `createVNode` because
// 1. it is monomorphic and avoids the extra call overhead
// 2. it allows specifying patchFlags for optimization

/*
// type only
h('div')

// type + props
h('div', {})

// type + omit props + children
// Omit props does NOT support named slots
h('div', []) // array
h('div', 'foo') // text
h('div', h('br')) // vnode
h(Component, () => {}) // default slot

// type + props + children
h('div', {}, []) // array
h('div', {}, 'foo') // text
h('div', {}, h('br')) // vnode
h(Component, {}, () => {}) // default slot
h(Component, {}, {}) // named slots

// named slots without props requires explicit `null` to avoid ambiguity
h(Component, null, {})
**/

type RawProps = VNodeProps & {
  // used to differ from a single VNode object as children
  __v_isVNode?: never
  // used to differ from Array children
  [Symbol.iterator]?: never
} & Record<string, any>

type RawChildren =
  | string
  | number
  | boolean
  | VNode
  | VNodeArrayChildren
  | (() => any)

// fake constructor type returned from `defineComponent`
interface Constructor<P = {}, S = any> {
  __isFragment?: never
  __isTeleport?: never
  __isSuspense?: never
  __isDefineComponent?: never
  new (...args: any[]): { $props: P; $slots?: S }
}

// Converts emits value to object
type ExtractEmitEvents<T> = T extends Readonly<Array<infer V>>
  ? { [K in V & string as `on${Capitalize<K>}`]: (...args: any[]) => void }
  : T extends any[]
  ? { [K in T & string as `on${Capitalize<K>}`]: (...args: any[]) => void }
  : {} extends T // if the emit is empty object (usually the default value for emit) should be converted to function
  ? {}
  : {
      [K in keyof T & string as `on${Capitalize<K>}`]: T[K] extends (
        ...args: infer Args
      ) => any
        ? (...args: Args) => void
        : (...args: any[]) => void
    }

// TODO remove `on*` props aka Emit events
type ExtractEmitPropUpdate<
  P = {},
  PK extends keyof P & string = keyof P & string
> = P extends Readonly<Array<infer V>>
  ? { [K in V & string as `onUpdate:${K}`]?: (value: any) => void }
  : P extends any[]
  ? { [K in P & string as `onUpdate:${K}`]?: (value: any) => void }
  : // we need to omit if it infers emit as props
    {
      [K in keyof Omit<P, `on${Capitalize<PK>}`> &
        string as `onUpdate:${K}`]?: (value: P[K]) => void
    }

type RenderProps<P, E extends EmitsOptions = {}> =
  | (Partial<ExtractEmitEvents<E>> & RawProps & P & ExtractEmitPropUpdate<P>)
  | ({} extends P ? Partial<ExtractEmitEvents<E>> | null : never)

type RenderSlots<S> =
  | Slots<S>
  | ({} extends S ? RawSlots : Slots<S>)
  | RawChildren

// The following is a series of overloads for providing props validation of
// manually written render functions.

// functional component
// NOTE: is set on top to allow infer the props when doing
/// const Func = (_props: { foo: string; bar?: number }) => ''
/// h(Func, {})
// otherwise it will default to `h(type: string)`
export function h<P, E extends EmitsOptions = {}>(
  type: FunctionalComponent<P, E>,
  props?: RenderProps<P, E>,
  children?: RawChildren | RawSlots
): VNode
export function h(type: FunctionalComponent): VNode

// element
export function h(type: string, children?: RawChildren): VNode
export function h(
  type: string,
  props?: RawProps | null,
  children?: RawChildren | RawSlots
): VNode

// text/comment
export function h(
  type: typeof Text | typeof Comment,
  children?: string | number | boolean
): VNode
export function h(
  type: typeof Text | typeof Comment,
  props?: null,
  children?: string | number | boolean
): VNode
// fragment
export function h(type: typeof Fragment, children?: VNodeArrayChildren): VNode
export function h(
  type: typeof Fragment,
  props?: RawProps | null,
  children?: VNodeArrayChildren
): VNode

// teleport (target prop is required)
export function h(
  type: typeof Teleport,
  props: RawProps & TeleportProps,
  children: RawChildren
): VNode

// suspense
export function h(type: typeof Suspense, children?: RawChildren): VNode
export function h(
  type: typeof Suspense,
  props?: (RawProps & SuspenseProps) | null,
  children?: RawChildren | RawSlots
): VNode

// functional component
// export function h<P, E extends EmitsOptions = {}>(
//   type: FunctionalComponent<P, E>,
//   props?: (RawProps & P) | ({} extends P ? null : never),
//   children?: RawChildren | RawSlots
// ): VNode

// catch-all for generic component types
export function h(type: Component, children?: RawChildren): VNode

// concrete component
export function h<P, E extends EmitsOptions = {}>(
  type: ConcreteComponent<P, any, any, any, any, any, any, E> | string,
  props?: RenderProps<P, E>,
  children?: RawChildren
): VNode

export function h<P>(
  type: ConcreteComponent | string,
  children?: RawChildren
): VNode

// component without props
export function h(
  type: Component,
  props: null,
  children?: RawChildren | RawSlots
): VNode

// exclude `defineComponent` constructors
export function h<
  P,
  S,
  E extends EmitsOptions = {},
  PP = {},
  Props = {},
  Defaults = {}
>(
  type: ComponentOptions<P, any, any, any, any, any, any, E, S>,
  props?: RenderProps<Partial<Defaults> & Omit<Props & PP, keyof Defaults>, E>,
  children?: (RawChildren & Slots<S>) | ({} extends S ? RawSlots : Slots<S>)
): VNode

// fake constructor type returned by `defineComponent`
export function h<
  P,
  S,
  E extends EmitsOptions = {},
  PP = {},
  Props = {},
  Defaults = {}
>(
  type: DefineComponent<
    P,
    any,
    any,
    any,
    any,
    any,
    any,
    E,
    any,
    S,
    {},
    {},
    string,
    PP,
    Props,
    Defaults
  >,
  props?: RenderProps<Partial<Defaults> & Omit<Props & PP, keyof Defaults>, E>,
  children?: (RawChildren & Slots<S>) | ({} extends S ? RawSlots : Slots<S>)
): VNode
export function h(type: DefineComponent): VNode
export function h(type: DefineComponent, children?: RawChildren): VNode

// fake constructor type returned by `defineComponent` or class component
export function h<P, S, E extends EmitsOptions = {}>(
  type: Constructor<P, S>,
  props?: RenderProps<P, E>,
  children?: (RawChildren & Slots<S>) | ({} extends S ? RawSlots : Slots<S>)
): VNode
export function h(type: Constructor, children?: RawChildren): VNode

// Actual implementation
export function h(type: any, propsOrChildren?: any, children?: any): VNode {
  const l = arguments.length
  if (l === 2) {
    if (isObject(propsOrChildren) && !isArray(propsOrChildren)) {
      // single vnode without props
      if (isVNode(propsOrChildren)) {
        return createVNode(type, null, [propsOrChildren])
      }
      // props without children
      return createVNode(type, propsOrChildren)
    } else {
      // omit props
      return createVNode(type, null, propsOrChildren)
    }
  } else {
    if (l > 3) {
      children = Array.prototype.slice.call(arguments, 2)
    } else if (l === 3 && isVNode(children)) {
      children = [children]
    }
    return createVNode(type, propsOrChildren, children)
  }
}

// declare function betterH<
//   P extends Record<string, unknown>,
//   E extends EmitsOptions,
//   S
// >(
//   type: BetterComponentOptions<P, E, S>,
//   props?: RenderProps<P, E>,
//   children?: (RawChildren & Slots<S>) | ({} extends S ? RawSlots : Slots<S>)
// ): P
export function betterH<
  P extends Record<string, unknown>,
  E extends EmitsOptions,
  S
>(
  type: BetterComponent<P, E, S>,
  props?: RenderProps<P, E>,
  children?: RenderSlots<S>
): P

export function betterH<
  P extends Record<string, unknown>,
  E extends EmitsOptions,
  S
>(
  type: RenderComponent<P, E, S>,
  props?: RenderProps<P, E>,
  children?: RenderSlots<S>
): P
export function betterH(
  type: any,
  propsOrChildren?: any,
  children?: any
): any {}

declare const MyComp: BetterComponent<
  { test: number },
  ['hey'],
  {
    default: null
    typedSlot: { a: number }
  }
>
const r = betterH(
  MyComp,
  {
    test: 2
  },
  {
    default() {
      return {} as unknown as VNode
    },
    typedSlot(e) {
      return {} as unknown as VNode
    }
  }
)

const x = betterH(
  {} as unknown as RenderComponent<
    {
      test: number
    },
    ['tst'],
    {
      default: null
    }
  >,
  {
    test: 2
  }
)

const Comp = betterDefineComponent({
  props: {
    test: Number
  }
})

betterH(
  Comp,
  {
    test: 1
  },
  {}
)

declare function test(t: BetterComponent): boolean
test(Comp)
