import {
  isString,
  hyphenate,
  capitalize,
  isArray,
  parseStringStyle,
  extend,
  isObject,
  NormalizedStyle
} from '@vue/shared'
import { camelize } from '@vue/runtime-core'

type Style = string | Record<string, string | string[]> | null

export function patchStyle(el: Element, prev: Style, next: Style) {
  const style = (el as HTMLElement).style
  if (!next) {
    el.removeAttribute('style')
  } else if (isString(next)) {
    if (prev !== next) {
      if (prev === null) {
        style.cssText = next
      } else {
        const computedStyle = parseStringStyle(style.cssText)
        const prevStyle = isObject(prev) ? prev : parseStringStyle(prev)
        // #2583
        // `display: xxx` is transformed via vShow and it not in `props.style`.
        // should keep it
        const keepStyle: NormalizedStyle = {}
        for (const key in computedStyle) {
          if (!(key in prevStyle)) {
            keepStyle[key] = computedStyle[key]
          }
        }
        const nextStyle = extend(keepStyle, parseStringStyle(next))
        updateStyle(style, prevStyle, nextStyle)
      }
    }
  } else {
    updateStyle(style, prev, next)
  }
}

function updateStyle(style: CSSStyleDeclaration, prev: any, next: any) {
  for (const key in next) {
    setStyle(style, key, next[key])
  }
  if (prev && !isString(prev)) {
    for (const key in prev) {
      if (next[key] == null) {
        setStyle(style, key, '')
      }
    }
  }
}

const importantRE = /\s*!important$/

function setStyle(
  style: CSSStyleDeclaration,
  name: string,
  val: string | string[]
) {
  if (isArray(val)) {
    val.forEach(v => setStyle(style, name, v))
  } else {
    if (name.startsWith('--')) {
      // custom property definition
      style.setProperty(name, val)
    } else {
      const prefixed = autoPrefix(style, name)
      if (importantRE.test(val)) {
        // !important
        style.setProperty(
          hyphenate(prefixed),
          val.replace(importantRE, ''),
          'important'
        )
      } else {
        style[prefixed as any] = val
      }
    }
  }
}

const prefixes = ['Webkit', 'Moz', 'ms']
const prefixCache: Record<string, string> = {}

function autoPrefix(style: CSSStyleDeclaration, rawName: string): string {
  const cached = prefixCache[rawName]
  if (cached) {
    return cached
  }
  let name = camelize(rawName)
  if (name !== 'filter' && name in style) {
    return (prefixCache[rawName] = name)
  }
  name = capitalize(name)
  for (let i = 0; i < prefixes.length; i++) {
    const prefixed = prefixes[i] + name
    if (prefixed in style) {
      return (prefixCache[rawName] = prefixed)
    }
  }
  return rawName
}
