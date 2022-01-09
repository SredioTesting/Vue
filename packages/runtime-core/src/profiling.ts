import { ComponentInternalInstance, formatComponentName } from './component'
import { devtoolsPerfStart, devtoolsPerfEnd } from './devtools'

const perf = typeof window !== 'undefined' && window.performance
const timer = perf ? () => perf.now() : Date.now

export function startMeasure(
  instance: ComponentInternalInstance,
  type: string
) {
  devtoolsPerfStart(instance, type, timer())

  if (perf && instance.appContext.config.performance) {
    perf.mark(`vue-${type}-${instance.uid}`)
  }
}

export function endMeasure(instance: ComponentInternalInstance, type: string) {
  if (perf && instance.appContext.config.performance) {
    const startTag = `vue-${type}-${instance.uid}`
    const endTag = startTag + `:end`
    perf.mark(endTag)
    perf.measure(
      `<${formatComponentName(instance, instance.type)}> ${type}`,
      startTag,
      endTag
    )
    perf.clearMarks(startTag)
    perf.clearMarks(endTag)
  }

  devtoolsPerfEnd(instance, type, timer())
}
