import { currentBlock, isBlockTreeEnabled, VNode } from '../vnode'

export function withMemo(
  memo: any[],
  render: () => VNode<any, any>,
  cache: any[],
  index: number
) {
  const cached = cache[index] as VNode | undefined
  if (cached && isMemoSame(cached.memo!, memo)) {
    // make sure to let parent block track it when returning cached
    if (isBlockTreeEnabled > 0 && currentBlock) {
      currentBlock.push(cached)
    }
    return cached
  }
  const ret = render()

  // shallow clone
  ret.memo = memo.slice(0, memo.length)
  return (cache[index] = ret)
}

export function isMemoSame(prev: any[], next: any[]) {
  if (prev.length != next.length) {
    return false
  }
  for (let i = 0; i < prev.length; i++) {
    if (prev[i] !== next[i]) {
      return false
    }
  }
  return true
}
