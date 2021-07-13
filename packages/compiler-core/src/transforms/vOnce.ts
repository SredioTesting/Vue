import { NodeTransform } from '../transform'
import { findDir } from '../utils'
import { ElementNode, ForNode, IfNode, NodeTypes } from '../ast'
import { SET_BLOCK_TRACKING } from '../runtimeHelpers'

const seen = new WeakSet()

export const transformOnce: NodeTransform = (node, context) => {
  if (node.type === NodeTypes.ELEMENT && findDir(node, 'once', true)) {
    if (seen.has(node)) {
      return
    }
    seen.add(node)
    const wasInVonce = context.inVOnce
    context.inVOnce = true
    context.helper(SET_BLOCK_TRACKING)
    return () => {
      context.inVOnce = wasInVonce
      const cur = context.currentNode as ElementNode | IfNode | ForNode
      if (cur.codegenNode && !wasInVonce) {
        cur.codegenNode = context.cache(cur.codegenNode, true /* isVNode */)
      }
    }
  }
}
