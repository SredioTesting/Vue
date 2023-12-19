import {
  VNode,
  normalizeVNode,
  Text,
  Comment,
  Static,
  Fragment,
  VNodeHook,
  createVNode,
  createTextVNode,
  invokeVNodeHook
} from './vnode'
import { flushPostFlushCbs } from './scheduler'
import { ComponentInternalInstance } from './component'
import { invokeDirectiveHook } from './directives'
import { warn } from './warning'
import { PatchFlags, ShapeFlags, isReservedProp, isOn } from '@vue/shared'
import { needTransition, RendererInternals } from './renderer'
import { setRef } from './rendererTemplateRef'
import {
  SuspenseImpl,
  SuspenseBoundary,
  queueEffectWithSuspense
} from './components/Suspense'
import { TeleportImpl, TeleportVNode } from './components/Teleport'
import { isAsyncWrapper } from './apiAsyncComponent'

export type RootHydrateFunction = (
  vnode: VNode<Node, Element>,
  container: (Element | ShadowRoot) & { _vnode?: VNode }
) => void

const enum DOMNodeTypes {
  ELEMENT = 1,
  TEXT = 3,
  COMMENT = 8
}

let hasMismatch = false

const isSVGContainer = (container: Element) =>
  /svg/.test(container.namespaceURI!) && container.tagName !== 'foreignObject'

const isComment = (node: Node): node is Comment =>
  node.nodeType === DOMNodeTypes.COMMENT

// Note: hydration is DOM-specific
// But we have to place it in core due to tight coupling with core - splitting
// it out creates a ton of unnecessary complexity.
// Hydration also depends on some renderer internal logic which needs to be
// passed in via arguments.
export function createHydrationFunctions(
  rendererInternals: RendererInternals<Node, Element>
) {
  const {
    mt: mountComponent,
    p: patch,
    o: {
      patchProp,
      createText,
      nextSibling,
      parentNode,
      remove,
      insert,
      createComment
    }
  } = rendererInternals

  const hydrate: RootHydrateFunction = (vnode, container) => {
    if (!container.hasChildNodes()) {
      __DEV__ &&
        warn(
          `Attempting to hydrate existing markup but container is empty. ` +
            `Performing full mount instead.`
        )
      patch(null, vnode, container)
      flushPostFlushCbs()
      container._vnode = vnode
      return
    }
    hasMismatch = false
    hydrateNode(container.firstChild!, vnode, null, null, null)
    flushPostFlushCbs()
    container._vnode = vnode
    if (hasMismatch && !__TEST__) {
      // this error should show up in production
      console.error(`Hydration completed but contains mismatches.`)
    }
  }

  const hydrateNode = (
    node: Node,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized = false
  ): Node | null => {
    const isFragmentStart = isComment(node) && node.data === '['
    const onMismatch = () =>
      handleMismatch(
        node,
        vnode,
        parentComponent,
        parentSuspense,
        slotScopeIds,
        isFragmentStart
      )

    const { type, ref, shapeFlag, patchFlag } = vnode
    let domType = node.nodeType
    vnode.el = node

    if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
      if (!('__vnode' in node)) {
        Object.defineProperty(node, '__vnode', {
          value: vnode,
          enumerable: false
        })
      }
      if (!('__vueParentComponent' in node)) {
        Object.defineProperty(node, '__vueParentComponent', {
          value: parentComponent,
          enumerable: false
        })
      }
    }

    if (patchFlag === PatchFlags.BAIL) {
      optimized = false
      vnode.dynamicChildren = null
    }

    let nextNode: Node | null = null
    switch (type) {
      case Text:
        if (domType !== DOMNodeTypes.TEXT) {
          // #5728 empty text node inside a slot can cause hydration failure
          // because the server rendered HTML won't contain a text node
          if (vnode.children === '') {
            insert((vnode.el = createText('')), parentNode(node)!, node)
            nextNode = node
          } else {
            nextNode = onMismatch()
          }
        } else {
          if ((node as Text).data !== vnode.children) {
            hasMismatch = true
            __DEV__ &&
              warn(
                `Hydration text mismatch:` +
                  `\n- Server rendered: ${JSON.stringify(
                    (node as Text).data
                  )}` +
                  `\n- Client rendered: ${JSON.stringify(vnode.children)}`
              )
            ;(node as Text).data = vnode.children as string
          }
          nextNode = nextSibling(node)
        }
        break
      case Comment:
        if (isTemplateNode(node)) {
          nextNode = nextSibling(node)
          // wrapped <transition appear>
          // replace <template> node with inner child
          replaceNode(
            (vnode.el = node.content.firstChild!),
            node,
            parentComponent
          )
        } else if (domType !== DOMNodeTypes.COMMENT || isFragmentStart) {
          nextNode = onMismatch()
        } else {
          nextNode = nextSibling(node)
        }
        break
      case Static:
        if (isFragmentStart) {
          // entire template is static but SSRed as a fragment
          node = nextSibling(node)!
          domType = node.nodeType
        }
        if (domType === DOMNodeTypes.ELEMENT || domType === DOMNodeTypes.TEXT) {
          // determine anchor, adopt content
          nextNode = node
          // if the static vnode has its content stripped during build,
          // adopt it from the server-rendered HTML.
          const needToAdoptContent = !(vnode.children as string).length
          for (let i = 0; i < vnode.staticCount!; i++) {
            if (needToAdoptContent)
              vnode.children +=
                nextNode.nodeType === DOMNodeTypes.ELEMENT
                  ? (nextNode as Element).outerHTML
                  : (nextNode as Text).data
            if (i === vnode.staticCount! - 1) {
              vnode.anchor = nextNode
            }
            nextNode = nextSibling(nextNode)!
          }
          return isFragmentStart ? nextSibling(nextNode) : nextNode
        } else {
          onMismatch()
        }
        break
      case Fragment:
        if (!isFragmentStart) {
          nextNode = onMismatch()
        } else {
          nextNode = hydrateFragment(
            node as Comment,
            vnode,
            parentComponent,
            parentSuspense,
            slotScopeIds,
            optimized
          )
        }
        break
      default:
        if (shapeFlag & ShapeFlags.ELEMENT) {
          if (
            (domType !== DOMNodeTypes.ELEMENT ||
              (vnode.type as string).toLowerCase() !==
                (node as Element).tagName.toLowerCase()) &&
            !isTemplateNode(node)
          ) {
            nextNode = onMismatch()
          } else {
            nextNode = hydrateElement(
              node as Element,
              vnode,
              parentComponent,
              parentSuspense,
              slotScopeIds,
              optimized
            )
          }
        } else if (shapeFlag & ShapeFlags.COMPONENT) {
          // when setting up the render effect, if the initial vnode already
          // has .el set, the component will perform hydration instead of mount
          // on its sub-tree.
          vnode.slotScopeIds = slotScopeIds
          const container = parentNode(node)!

          // Locate the next node.
          if (isFragmentStart) {
            // If it's a fragment: since components may be async, we cannot rely
            // on component's rendered output to determine the end of the
            // fragment. Instead, we do a lookahead to find the end anchor node.
            nextNode = locateClosingAnchor(node)
          } else if (isComment(node) && node.data === 'teleport start') {
            // #4293 #6152
            // If a teleport is at component root, look ahead for teleport end.
            nextNode = locateClosingAnchor(node, node.data, 'teleport end')
          } else {
            nextNode = nextSibling(node)
          }

          mountComponent(
            vnode,
            container,
            null,
            parentComponent,
            parentSuspense,
            isSVGContainer(container),
            optimized
          )

          // #3787
          // if component is async, it may get moved / unmounted before its
          // inner component is loaded, so we need to give it a placeholder
          // vnode that matches its adopted DOM.
          if (isAsyncWrapper(vnode)) {
            let subTree
            if (isFragmentStart) {
              subTree = createVNode(Fragment)
              subTree.anchor = nextNode
                ? nextNode.previousSibling
                : container.lastChild
            } else {
              subTree =
                node.nodeType === 3 ? createTextVNode('') : createVNode('div')
            }
            subTree.el = node
            vnode.component!.subTree = subTree
          }
        } else if (shapeFlag & ShapeFlags.TELEPORT) {
          if (domType !== DOMNodeTypes.COMMENT) {
            nextNode = onMismatch()
          } else {
            nextNode = (vnode.type as typeof TeleportImpl).hydrate(
              node,
              vnode as TeleportVNode,
              parentComponent,
              parentSuspense,
              slotScopeIds,
              optimized,
              rendererInternals,
              hydrateChildren
            )
          }
        } else if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
          nextNode = (vnode.type as typeof SuspenseImpl).hydrate(
            node,
            vnode,
            parentComponent,
            parentSuspense,
            isSVGContainer(parentNode(node)!),
            slotScopeIds,
            optimized,
            rendererInternals,
            hydrateNode
          )
        } else if (__DEV__) {
          warn('Invalid HostVNode type:', type, `(${typeof type})`)
        }
    }

    if (ref != null) {
      setRef(ref, null, parentSuspense, vnode)
    }

    return nextNode
  }

  const hydrateElement = (
    el: Element,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => {
    optimized = optimized || !!vnode.dynamicChildren
    const { type, props, patchFlag, shapeFlag, dirs, transition } = vnode
    // #4006 for form elements with non-string v-model value bindings
    // e.g. <option :value="obj">, <input type="checkbox" :true-value="1">
    const forcePatch = type === 'input' || type === 'option'
    // #7203 elements registered as custom elements should have all properties bound
    const isCustomElement =
      parentComponent?.appContext.config.compilerOptions.isCustomElement?.(
        el.localName
      )
    // skip props & children if this is hoisted static nodes
    // #5405 in dev, always hydrate children for HMR
    if (__DEV__ || forcePatch || patchFlag !== PatchFlags.HOISTED) {
      if (dirs) {
        invokeDirectiveHook(vnode, null, parentComponent, 'created')
      }

      // handle appear transition
      let needCallTransitionHooks = false
      if (isTemplateNode(el)) {
        needCallTransitionHooks =
          needTransition(parentSuspense, transition) &&
          parentComponent &&
          parentComponent.vnode.props &&
          parentComponent.vnode.props.appear

        const content = (el as HTMLTemplateElement).content
          .firstChild as Element

        if (needCallTransitionHooks) {
          transition!.beforeEnter(content)
        }

        // replace <template> node with inner children
        replaceNode(content, el, parentComponent)
        vnode.el = el = content
      }

      // props
      if (props) {
        if (
          forcePatch ||
          !optimized ||
          patchFlag & (PatchFlags.FULL_PROPS | PatchFlags.NEED_HYDRATION)
        ) {
          for (const key in props) {
            if (
              (forcePatch &&
                (key.endsWith('value') || key === 'indeterminate')) ||
              (isOn(key) && !isReservedProp(key)) ||
              // force hydrate v-bind with .prop modifiers
              key[0] === '.' ||
              // hydrate if declared custom element
              isCustomElement
            ) {
              patchProp(
                el,
                key,
                null,
                props[key],
                false,
                undefined,
                parentComponent
              )
            }
          }
        } else if (props.onClick) {
          // Fast path for click listeners (which is most often) to avoid
          // iterating through props.
          patchProp(
            el,
            'onClick',
            null,
            props.onClick,
            false,
            undefined,
            parentComponent
          )
        }
      }
      // vnode / directive hooks
      let vnodeHooks: VNodeHook | null | undefined
      if ((vnodeHooks = props && props.onVnodeBeforeMount)) {
        invokeVNodeHook(vnodeHooks, parentComponent, vnode)
      }

      if (dirs) {
        invokeDirectiveHook(vnode, null, parentComponent, 'beforeMount')
      }

      if (
        (vnodeHooks = props && props.onVnodeMounted) ||
        dirs ||
        needCallTransitionHooks
      ) {
        queueEffectWithSuspense(() => {
          vnodeHooks && invokeVNodeHook(vnodeHooks, parentComponent, vnode)
          needCallTransitionHooks && transition!.enter(el)
          dirs && invokeDirectiveHook(vnode, null, parentComponent, 'mounted')
        }, parentSuspense)
      }
      // children
      if (
        shapeFlag & ShapeFlags.ARRAY_CHILDREN &&
        // skip if element has innerHTML / textContent
        !(props && (props.innerHTML || props.textContent))
      ) {
        let next = hydrateChildren(
          el.firstChild,
          vnode,
          el,
          parentComponent,
          parentSuspense,
          slotScopeIds,
          optimized
        )
        let hasWarned = false
        while (next) {
          hasMismatch = true
          if (__DEV__ && !hasWarned) {
            warn(
              `Hydration children mismatch in <${vnode.type as string}>: ` +
                `server rendered element contains more child nodes than client vdom.`
            )
            hasWarned = true
          }
          // The SSRed DOM contains more nodes than it should. Remove them.
          const cur = next
          next = next.nextSibling
          remove(cur)
        }
      } else if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
        if (el.textContent !== vnode.children) {
          hasMismatch = true
          __DEV__ &&
            warn(
              `Hydration text content mismatch in <${
                vnode.type as string
              }>:\n` +
                `- Server rendered: ${el.textContent}\n` +
                `- Client rendered: ${vnode.children as string}`
            )
          el.textContent = vnode.children as string
        }
      }
    }
    return el.nextSibling
  }

  const hydrateChildren = (
    node: Node | null,
    parentVNode: VNode,
    container: Element,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized: boolean
  ): Node | null => {
    optimized = optimized || !!parentVNode.dynamicChildren
    const children = parentVNode.children as VNode[]
    const l = children.length
    let hasWarned = false
    for (let i = 0; i < l; i++) {
      const vnode = optimized
        ? children[i]
        : (children[i] = normalizeVNode(children[i]))
      if (node) {
        node = hydrateNode(
          node,
          vnode,
          parentComponent,
          parentSuspense,
          slotScopeIds,
          optimized
        )
      } else if (vnode.type === Text && !vnode.children) {
        continue
      } else {
        hasMismatch = true
        if (__DEV__ && !hasWarned) {
          warn(
            `Hydration children mismatch in <${container.tagName.toLowerCase()}>: ` +
              `server rendered element contains fewer child nodes than client vdom.`
          )
          hasWarned = true
        }
        // the SSRed DOM didn't contain enough nodes. Mount the missing ones.
        patch(
          null,
          vnode,
          container,
          null,
          parentComponent,
          parentSuspense,
          isSVGContainer(container),
          slotScopeIds
        )
      }
    }
    return node
  }

  const hydrateFragment = (
    node: Comment,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    optimized: boolean
  ) => {
    const { slotScopeIds: fragmentSlotScopeIds } = vnode
    if (fragmentSlotScopeIds) {
      slotScopeIds = slotScopeIds
        ? slotScopeIds.concat(fragmentSlotScopeIds)
        : fragmentSlotScopeIds
    }

    const container = parentNode(node)!
    const next = hydrateChildren(
      nextSibling(node)!,
      vnode,
      container,
      parentComponent,
      parentSuspense,
      slotScopeIds,
      optimized
    )
    if (next && isComment(next) && next.data === ']') {
      return nextSibling((vnode.anchor = next))
    } else {
      // fragment didn't hydrate successfully, since we didn't get a end anchor
      // back. This should have led to node/children mismatch warnings.
      hasMismatch = true
      // since the anchor is missing, we need to create one and insert it
      insert((vnode.anchor = createComment(`]`)), container, next)
      return next
    }
  }

  const handleMismatch = (
    node: Node,
    vnode: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    slotScopeIds: string[] | null,
    isFragment: boolean
  ): Node | null => {
    hasMismatch = true
    __DEV__ &&
      warn(
        `Hydration node mismatch:\n- Client vnode:`,
        vnode.type,
        `\n- Server rendered DOM:`,
        node,
        node.nodeType === DOMNodeTypes.TEXT
          ? `(text)`
          : isComment(node) && node.data === '['
            ? `(start of fragment)`
            : ``
      )
    vnode.el = null

    if (isFragment) {
      // remove excessive fragment nodes
      const end = locateClosingAnchor(node)
      while (true) {
        const next = nextSibling(node)
        if (next && next !== end) {
          remove(next)
        } else {
          break
        }
      }
    }

    const next = nextSibling(node)
    const container = parentNode(node)!
    remove(node)

    patch(
      null,
      vnode,
      container,
      next,
      parentComponent,
      parentSuspense,
      isSVGContainer(container),
      slotScopeIds
    )
    return next
  }

  // looks ahead for a start and closing comment node
  const locateClosingAnchor = (
    node: Node | null,
    open = '[',
    close = ']'
  ): Node | null => {
    let match = 0
    while (node) {
      node = nextSibling(node)
      if (node && isComment(node)) {
        if (node.data === open) match++
        if (node.data === close) {
          if (match === 0) {
            return nextSibling(node)
          } else {
            match--
          }
        }
      }
    }
    return node
  }

  const replaceNode = (
    newNode: Node,
    oldNode: Node,
    parentComponent: ComponentInternalInstance | null
  ): void => {
    // replace node
    const parentNode = oldNode.parentNode
    if (parentNode) {
      parentNode.replaceChild(newNode, oldNode)
    }

    // update vnode
    let parent = parentComponent
    while (parent) {
      if (parent.vnode.el === oldNode) {
        parent.vnode.el = parent.subTree.el = newNode
      }
      parent = parent.parent
    }
  }

  const isTemplateNode = (node: Node): node is HTMLTemplateElement => {
    return (
      node.nodeType === DOMNodeTypes.ELEMENT &&
      (node as Element).tagName.toLowerCase() === 'template'
    )
  }

  return [hydrate, hydrateNode] as const
}
